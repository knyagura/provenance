-- Provenance: migration 004 — browsing, search, categories, listing media and the API platform.
-- Run AFTER 003. Additive and safe to re-run. Contains no DROP statements.
--
--   1. Categories (public, admin-maintained), with the evidence profile each one needs.
--   2. Listing columns for browsing (size, colour, Item ID) and a full-text search column.
--   3. Listing media: one row per photo or video, pointing at Supabase Storage (see 005).
--   4. API platform (backlog B58): API keys stored hashed with scopes, per-minute usage,
--      and one security-definer function the API calls to authenticate a key and count the call.

-- ------------------------------------------------------------
-- 1. Categories
-- ------------------------------------------------------------
create table if not exists public.categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  parent_slug text references public.categories(slug) on delete restrict,
  position integer not null default 0,
  evidence_profile jsonb not null default '{}'::jsonb
);
alter table public.categories enable row level security;
do $$ begin
  create policy "categories are public" on public.categories for select using (true);
exception when duplicate_object then null; end $$;
grant select on public.categories to anon, authenticated;
create index if not exists categories_parent_idx on public.categories (parent_slug);

insert into public.categories (slug, name, position) values
  ('women', 'Women', 1), ('men', 'Men', 2), ('designer', 'Designer', 3), ('kids', 'Kids', 4),
  ('home', 'Home', 5), ('electronics', 'Electronics', 6), ('books-media', 'Books and media', 7),
  ('hobbies', 'Hobbies and collectables', 8), ('sport', 'Sport', 9)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- 2. Listing columns for browsing, and search
-- ------------------------------------------------------------
alter table public.listings add column if not exists size_label text;
alter table public.listings add column if not exists colour text;
alter table public.listings add column if not exists item_id text;
alter table public.listings add column if not exists search tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored;

do $$ begin
  alter table public.listings add constraint listings_size_len check (size_label is null or char_length(size_label) <= 30);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_colour_len check (colour is null or char_length(colour) <= 30);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_item_id_format check (item_id is null or item_id ~ '^IT-[0-9]{4}-[0-9]{5}$');
exception when duplicate_object then null; end $$;

create index if not exists listings_search_idx on public.listings using gin (search);
create index if not exists listings_browse_idx on public.listings (published, status, category, price_pence);

-- ------------------------------------------------------------
-- 3. Listing media
-- ------------------------------------------------------------
create table if not exists public.listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  path text not null check (char_length(path) <= 300),
  kind text not null default 'photo' check (kind in ('photo', 'video')),
  shot text check (shot is null or char_length(shot) <= 40),
  position integer not null default 0,
  width integer,
  height integer,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  is_reference boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists listing_media_listing_idx on public.listing_media (listing_id, position);
create index if not exists listing_media_seller_idx on public.listing_media (seller_id);
alter table public.listing_media enable row level security;

do $$ begin
  create policy "media of published listings is public" on public.listing_media for select
    using (exists (select 1 from public.listings l where l.id = listing_id and (l.published = true or l.seller_id = (select auth.uid()))));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers add media to their own listings" on public.listing_media for insert
    with check (seller_id = (select auth.uid())
      and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers change their own media" on public.listing_media for update
    using (seller_id = (select auth.uid()))
    with check (seller_id = (select auth.uid())
      and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers remove their own media" on public.listing_media for delete
    using (seller_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
grant select on public.listing_media to anon;
grant select, insert, update, delete on public.listing_media to authenticated;

-- ------------------------------------------------------------
-- 4. API platform
-- ------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  prefix text not null unique check (prefix ~ '^pv_[a-z]+_[A-Za-z0-9]{8}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default '{}' check (scopes <@ array[
    'listings:read', 'listings:write', 'orders:read', 'orders:write', 'messages:read', 'messages:write',
    'payouts:read', 'analytics:read', 'boosts:write', 'passport:read', 'passport:write', 'webhooks:manage'
  ]::text[]),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_owner_idx on public.api_keys (owner_id);
alter table public.api_keys enable row level security;

do $$ begin
  create policy "owners see their own keys" on public.api_keys for select using (owner_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "owners create their own keys" on public.api_keys for insert with check (owner_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "owners revoke their own keys" on public.api_keys for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
exception when duplicate_object then null; end $$;

-- Owners never read the hash back, and can only change the name or revoke.
revoke all on public.api_keys from anon, authenticated;
grant select (id, owner_id, name, prefix, scopes, created_at, last_used_at, revoked_at) on public.api_keys to authenticated;
grant insert (owner_id, name, prefix, key_hash, scopes) on public.api_keys to authenticated;
grant update (name, revoked_at) on public.api_keys to authenticated;

create table if not exists public.api_usage (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  minute timestamptz not null,
  calls integer not null default 0,
  primary key (key_id, minute)
);
alter table public.api_usage enable row level security; -- no policies on purpose: only api_authenticate touches it
revoke all on public.api_usage from anon, authenticated;

-- Called by the API for every keyed request. Returns the key's owner and scopes and the number of
-- calls this minute including this one; returns no row for an unknown, wrong or revoked key.
-- Guessing is not a risk: the hash is SHA-256 of a 32-byte random secret.
-- The database advisor flags this as callable without signing in. That is intended: the API
-- server calls it with the publishable key. It reveals nothing without the 32-byte secret.
create or replace function public.api_authenticate(p_prefix text, p_hash text)
returns table (key_id uuid, owner_id uuid, scopes text[], calls integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  k public.api_keys%rowtype;
  n integer;
begin
  select * into k from public.api_keys
   where prefix = p_prefix and key_hash = p_hash and revoked_at is null;
  if not found then
    return;
  end if;
  insert into public.api_usage as u (key_id, minute, calls)
  values (k.id, date_trunc('minute', now()), 1)
  on conflict (key_id, minute) do update set calls = u.calls + 1
  returning u.calls into n;
  update public.api_keys set last_used_at = now() where id = k.id;
  return query select k.id, k.owner_id, k.scopes, n;
end;
$$;
revoke execute on function public.api_authenticate(text, text) from public;
grant execute on function public.api_authenticate(text, text) to anon, authenticated;
