-- Provenance: migration 002 — listing extras + server-side order integrity
-- Run AFTER supabase_schema.sql. Safe to run more than once (everything is idempotent).
-- Paste into Supabase: Project > SQL Editor > New query > Run.
--
-- What this adds, and why:
--   1. Listing columns the app already uses client-side (status, brand, item code, shipping,
--      who pays triggered protection fees).
--   2. Orders can only be created for a published, still-active listing, at the listed price,
--      by someone other than the seller — and the listing is marked sold in the same
--      transaction, row-locked so two buyers can't both buy the same item.
--   3. The money/party fields of an order can't be edited after it's placed.
--   4. Users can't grant themselves KYC-verified or Pro status.
--   5. Explicit API grants (newer Supabase projects don't always auto-expose new tables).
--   6. Live updates (Realtime) for listings and orders, so a buyer's and seller's phones
--      see each other's changes without refreshing.
-- Still deliberately NOT here (deferred, see product update doc §6): server-side validation
-- of the custody/evidence chain inside orders.timeline_state.

-- ------------------------------------------------------------
-- 1. Listing extras
-- ------------------------------------------------------------
alter table public.listings add column if not exists brand text;
alter table public.listings add column if not exists item_code text;
alter table public.listings add column if not exists shipping_pence integer not null default 295;
alter table public.listings add column if not exists protection_payer text not null default 'buyer';
alter table public.listings add column if not exists status text not null default 'active';

do $$ begin
  alter table public.listings add constraint listings_status_check check (status in ('active','reserved','sold'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_protection_payer_check check (protection_payer in ('buyer','seller'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_shipping_check check (shipping_pence >= 0);
exception when duplicate_object then null; end $$;

create index if not exists listings_seller_idx on public.listings (seller_id);
create index if not exists listings_feed_idx on public.listings (published, status, created_at desc);
create index if not exists orders_buyer_idx on public.orders (buyer_id);
create index if not exists orders_seller_idx on public.orders (seller_id);

-- ------------------------------------------------------------
-- 2. Harden the signup trigger (pin search_path on a security-definer function)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(coalesce(new.email, 'user'), '@', 1) || '_' || substr(new.id::text, 1, 4))
  on conflict (id) do nothing;
  return new;
end;
$$;

alter function public.touch_updated_at() set search_path = public;

-- ------------------------------------------------------------
-- 3. Users can't self-grant KYC / Pro
-- ------------------------------------------------------------
create or replace function public.protect_profile_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only the API roles are restricted; the dashboard / service role can still set these.
  if current_user in ('anon', 'authenticated') then
    new.kyc_verified := old.kyc_verified;
    new.is_pro := old.is_pro;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create or replace trigger profiles_protect_flags
  before update on public.profiles
  for each row execute procedure public.protect_profile_flags();

-- ------------------------------------------------------------
-- 4. Order integrity: validate on insert, mark listing sold
-- ------------------------------------------------------------
create or replace function public.validate_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings%rowtype;
begin
  -- Row-lock the listing so two simultaneous purchases serialise; the second one sees 'sold'.
  select * into l from public.listings where id = new.listing_id for update;
  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if not l.published then
    raise exception 'This listing is not published' using errcode = 'P0001';
  end if;
  if l.status <> 'active' then
    raise exception 'This item has already been sold' using errcode = 'P0001';
  end if;
  if l.seller_id = new.buyer_id then
    raise exception 'You cannot buy your own listing' using errcode = 'P0001';
  end if;
  -- Seller and price always come from the listing, never from the client.
  new.seller_id := l.seller_id;
  new.price_pence := l.price_pence;
  new.protection_payer := l.protection_payer;
  new.created_at := now();
  update public.listings set status = 'sold' where id = l.id;
  return new;
end;
$$;

create or replace trigger orders_validate_insert
  before insert on public.orders
  for each row execute procedure public.validate_new_order();

-- ------------------------------------------------------------
-- 5. Order fields that can't change after purchase
-- ------------------------------------------------------------
create or replace function public.protect_order_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.listing_id := old.listing_id;
    new.buyer_id := old.buyer_id;
    new.seller_id := old.seller_id;
    new.price_pence := old.price_pence;
    new.protection_payer := old.protection_payer;
    new.shipping_choice := old.shipping_choice;
    new.fees := old.fees;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace trigger orders_protect_fields
  before update on public.orders
  for each row execute procedure public.protect_order_fields();

-- ------------------------------------------------------------
-- 6. API grants (RLS policies still decide which rows each user sees)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.listings to anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.listings to authenticated;
grant select, insert, update on public.orders to authenticated;

-- ------------------------------------------------------------
-- 7. Realtime for listings + orders (skipped quietly where Realtime isn't available)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listings') then
      execute 'alter publication supabase_realtime add table public.listings';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;
  end if;
end $$;
