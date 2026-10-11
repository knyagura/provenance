-- Provenance: migration 006 — selling (build step 3).
-- Run AFTER 005. Additive and safe to re-run. Contains no DROP statements.
--
--   1. Evidence profiles per category: the photos (and video, serial) a listing needs before it goes live.
--      The website shows the same list as a checklist (web/lib/domain/evidence.ts; a test keeps them equal).
--   2. New listing columns: evidence_version (1 = made on the new site, so the rules below apply),
--      declined shots ("No label"), the last 4 characters of a serial, and parcel size.
--   3. Serial numbers kept private in listing_secrets; buyers only ever see the last 4 characters.
--   4. Fields customers cannot set (Item ID, counters, serial hint); tier set from the price.
--   5. The publish check: a new-site listing cannot go live until its evidence is complete.
--   6. Reference photos are fixed once a listing is live, and must sit in <seller>/<listing>/.
--   7. The photo bucket also takes iPhone video (.mov) and files up to 50 MB.
--
-- Listings from the current single-file app have evidence_version 0 and are not affected.

-- ------------------------------------------------------------
-- 1. Evidence profiles
-- ------------------------------------------------------------
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"back","label":"Back","hint":"The whole item from behind.","kind":"photo","required":true},{"key":"label","label":"Size and care label","hint":"Close enough to read the brand and size.","kind":"photo","required":true,"decline":"No label"},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'women';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"back","label":"Back","hint":"The whole item from behind.","kind":"photo","required":true},{"key":"label","label":"Size and care label","hint":"Close enough to read the brand and size.","kind":"photo","required":true,"decline":"No label"},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'men';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"back","label":"Back","hint":"The whole item from behind.","kind":"photo","required":true},{"key":"label","label":"Size and care label","hint":"Close enough to read the brand and size.","kind":"photo","required":true,"decline":"No label"},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'kids';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"back","label":"Back","hint":"The whole item from behind.","kind":"photo","required":true},{"key":"label","label":"Size and care label","hint":"Close enough to read the brand and size.","kind":"photo","required":true,"decline":"No label"},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'sport';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"back","label":"Back","hint":"The whole item from behind.","kind":"photo","required":true},{"key":"label","label":"Brand stamp or label","hint":"Sharp enough to read the lettering.","kind":"photo","required":true},{"key":"serial","label":"Serial or date code","hint":"Usually inside a pocket, on a tag or under the base.","kind":"photo","required":true,"decline":"No code"},{"key":"hardware","label":"Hardware close-up","hint":"Zips, clasps, buckles or engraving.","kind":"photo","required":true},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false},{"key":"receipt","label":"Proof of purchase","hint":"Receipt or authenticity card, with personal details covered.","kind":"photo","required":false}],"serial":{"required":false,"label":"Serial or date code"}}'::jsonb where slug = 'designer';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"Switched on, showing the screen if it has one.","kind":"photo","required":true},{"key":"back","label":"Back","hint":"The whole item from behind.","kind":"photo","required":true},{"key":"serial","label":"Serial number or IMEI","hint":"On the label, in Settings, or under the battery.","kind":"photo","required":true},{"key":"working","label":"Working video","hint":"Up to 30 seconds: switch it on and show it working.","kind":"video","required":true},{"key":"accessories","label":"Accessories","hint":"Chargers, cables and boxes included in the sale.","kind":"photo","required":false}],"serial":{"required":true,"label":"Serial number or IMEI"}}'::jsonb where slug = 'electronics';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"mark","label":"Maker''s mark or label","hint":"Underneath or on the back.","kind":"photo","required":true,"decline":"No mark"},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'home';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The front cover.","kind":"photo","required":true},{"key":"spine","label":"Spine","hint":"Shows the title and condition of the spine.","kind":"photo","required":true},{"key":"wear","label":"Any wear or marks","hint":"Close-ups of anything a buyer should know about.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'books-media';
update public.categories set evidence_profile = '{"shots":[{"key":"front","label":"Front","hint":"The whole item, straight on, in good light.","kind":"photo","required":true},{"key":"contents","label":"All the parts","hint":"Everything included, laid out together.","kind":"photo","required":true},{"key":"box","label":"Box or maker","hint":"The box, set number or maker’s mark.","kind":"photo","required":false}],"serial":null}'::jsonb where slug = 'hobbies';
-- ------------------------------------------------------------
-- 2. Listing columns
-- ------------------------------------------------------------
alter table public.listings add column if not exists evidence_version integer not null default 0;
alter table public.listings add column if not exists declined_shots text[] not null default '{}';
alter table public.listings add column if not exists serial_hint text;
alter table public.listings add column if not exists parcel_size text;

do $$ begin
  alter table public.listings add constraint listings_parcel_size_check check (parcel_size is null or parcel_size in ('small', 'medium', 'large'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_declined_len check (cardinality(declined_shots) <= 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_title_len check (char_length(title) between 1 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_description_len check (description is null or char_length(description) <= 2000);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3. Private serial numbers
-- ------------------------------------------------------------
create table if not exists public.listing_secrets (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  serial_number text not null check (char_length(serial_number) between 4 and 60),
  updated_at timestamptz not null default now()
);
create index if not exists listing_secrets_seller_idx on public.listing_secrets (seller_id);
alter table public.listing_secrets enable row level security;

do $$ begin
  create policy "sellers see their own serials" on public.listing_secrets for select using (seller_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers add serials to their own listings" on public.listing_secrets for insert
    with check (seller_id = (select auth.uid())
      and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers change their own serials" on public.listing_secrets for update
    using (seller_id = (select auth.uid()))
    with check (seller_id = (select auth.uid())
      and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "sellers remove their own serials" on public.listing_secrets for delete using (seller_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke all on public.listing_secrets from anon;
grant select, insert, update, delete on public.listing_secrets to authenticated;

-- Keeps listings.serial_hint (last 4 characters) in step with the private serial.
create or replace function public.sync_serial_hint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.listings set serial_hint = null where id = old.listing_id;
    return old;
  end if;
  if exists (select 1 from public.listings where id = new.listing_id and published and evidence_version >= 1) then
    raise exception 'The serial number cannot change once the listing is live' using errcode = 'P0001';
  end if;
  update public.listings set serial_hint = upper(right(regexp_replace(new.serial_number, '\s', '', 'g'), 4)) where id = new.listing_id;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.sync_serial_hint() from public, anon, authenticated;  -- runs only as a trigger

create or replace trigger listing_secrets_hint
  before insert or update on public.listing_secrets
  for each row execute procedure public.sync_serial_hint();
create or replace trigger listing_secrets_hint_clear
  after delete on public.listing_secrets
  for each row execute procedure public.sync_serial_hint();

-- ------------------------------------------------------------
-- 4 and 5. Protected fields, tier from price, and the publish check
-- ------------------------------------------------------------
create or replace function public.listing_rules()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller, to tell customers from the platform
set search_path = public
as $$
declare
  profile jsonb;
  req jsonb;
  missing text[] := '{}';
  customer boolean := current_user in ('anon', 'authenticated');
begin
  -- Fields only the platform sets.
  if customer then
    if tg_op = 'INSERT' then
      new.item_id := null;
      new.views := 0;
      new.favourites := 0;
      new.serial_hint := null;
    else
      new.item_id := old.item_id;
      new.views := old.views;
      new.favourites := old.favourites;
      new.serial_hint := old.serial_hint;
      new.seller_id := old.seller_id;
      new.created_at := old.created_at;
      new.evidence_version := greatest(old.evidence_version, new.evidence_version);
    end if;
  end if;

  if new.evidence_version < 1 then
    return new;  -- made in the current single-file app: its own rules apply
  end if;

  -- The witnessing tier follows the price (the add-on bands in the fee model).
  new.tier := case
    when new.price_pence >= 150000 then 'ultraLuxury'
    when new.price_pence >= 50000 then 'luxury'
    when new.price_pence >= 7500 then 'verified'
    else 'enhanced' end;

  -- Once live, the category (and so the evidence it needed) is fixed.
  if tg_op = 'UPDATE' and old.published and old.evidence_version >= 1 and new.category is distinct from old.category then
    raise exception 'The category cannot change once the listing is live' using errcode = 'P0001';
  end if;

  -- The publish check, when a listing goes live.
  if new.published and (tg_op = 'INSERT' or not old.published) then
    select c.evidence_profile into profile from public.categories c where c.slug = new.category;
    if profile is null or profile = '{}'::jsonb then
      raise exception 'Not ready to publish: choose a category' using errcode = 'P0001';
    end if;
    for req in select * from jsonb_array_elements(profile -> 'shots') loop
      continue when not (req ->> 'required')::boolean;
      continue when exists (
        select 1 from public.listing_media m
         where m.listing_id = new.id and m.shot = req ->> 'key' and m.kind = req ->> 'kind');
      continue when req ? 'decline' and (req ->> 'key') = any (new.declined_shots);
      missing := missing || (req ->> 'label');
    end loop;
    if (profile -> 'serial' ->> 'required')::boolean is true
       and not exists (select 1 from public.listing_secrets s where s.listing_id = new.id) then
      missing := missing || (profile -> 'serial' ->> 'label');
    end if;
    if new.title is null or btrim(new.title) = '' or new.title = 'Untitled draft' then missing := missing || 'title'::text; end if;
    if new.condition_label is null then missing := missing || 'condition'::text; end if;
    if new.price_pence < 100 or new.price_pence > 5000000 then missing := missing || 'price between £1 and £50,000'::text; end if;
    if new.parcel_size is null then missing := missing || 'parcel size'::text; end if;
    if cardinality(missing) > 0 then
      raise exception 'Not ready to publish: %', array_to_string(missing, ', ') using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.listing_rules() from public, anon, authenticated;

create or replace trigger listings_rules
  before insert or update on public.listings
  for each row execute procedure public.listing_rules();

-- ------------------------------------------------------------
-- 6. Media rules
-- ------------------------------------------------------------
create or replace function public.listing_media_rules()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller, to tell customers from the platform
set search_path = public
as $$
declare
  lid uuid;
  live boolean;
begin
  if tg_op = 'DELETE' then lid := old.listing_id; else lid := new.listing_id; end if;
  select l.published and l.evidence_version >= 1 into live from public.listings l where l.id = lid;
  if current_user in ('anon', 'authenticated') and coalesce(live, false) then
    raise exception 'Reference photos are fixed once the listing is live' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.path not like new.seller_id::text || '/' || new.listing_id::text || '/%' then
    raise exception 'Media must be stored in the listing''s own folder' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.listing_media_rules() from public, anon, authenticated;

create or replace trigger listing_media_rules
  before insert or update or delete on public.listing_media
  for each row execute procedure public.listing_media_rules();

-- ------------------------------------------------------------
-- 7. Bucket: iPhone video and longer clips
-- ------------------------------------------------------------
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
 where id = 'listing-media';
