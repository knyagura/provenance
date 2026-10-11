-- Provenance: migration 009 — editing live listings, with history (requested 11 Oct 2026).
-- Run AFTER 008. Additive and safe to re-run. Contains no DROP statements.
--
--   1. Every listing has a revision number. Publishing makes revision 1; every change buyers can see makes
--      the next one, and a snapshot of exactly what buyers saw (fields and photos) goes into listing_revisions.
--   2. A seller edits a live listing by pausing it (published = false), changing anything, including the
--      category and photos, and publishing again. The publish check runs again, so the evidence stays complete.
--   3. Photos of a listing that has ever been live are never deleted: removing one marks it retired and the
--      file stays, because earlier revisions and orders point at it.
--   4. Locked while someone is checking out (reserved) and once sold: no field, photo or serial can change.
--   5. Checkout is told which revision the buyer was looking at. If the seller changed the listing since,
--      checkout stops and the buyer is shown what changed. Each order keeps the revision and a full snapshot
--      of what was bought.
-- Listings from the current single-file app (evidence version 0) are not affected.

-- ------------------------------------------------------------
-- 1. Revisions
-- ------------------------------------------------------------
alter table public.listings add column if not exists revision integer not null default 0;
alter table public.listings add column if not exists edited_at timestamptz;
alter table public.listing_media add column if not exists retired_at timestamptz;

create table if not exists public.listing_revisions (
  listing_id uuid not null references public.listings(id) on delete cascade,
  revision integer not null check (revision > 0),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, revision)
);
create index if not exists listing_revisions_seller_idx on public.listing_revisions (seller_id);
alter table public.listing_revisions enable row level security;
do $$ begin
  create policy "sellers see their own listing history" on public.listing_revisions for select using (seller_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke all on public.listing_revisions from anon, authenticated;
grant select on public.listing_revisions to authenticated;

-- What buyers see of a listing right now: its fields and its current (not retired) photos and video.
create or replace function public.listing_snapshot(p_listing uuid)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'listing_id', l.id, 'revision', l.revision, 'title', l.title, 'description', l.description, 'brand', l.brand,
    'category', l.category, 'size', l.size_label, 'colour', l.colour, 'condition', l.condition_label,
    'price_pence', l.price_pence, 'shipping_pence', l.shipping_pence, 'parcel_size', l.parcel_size,
    'protection_payer', l.protection_payer, 'tier', l.tier, 'serial_hint', l.serial_hint, 'declined_shots', l.declined_shots,
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path, 'kind', m.kind, 'shot', m.shot, 'sha256', m.sha256) order by m.position, m.created_at)
                         from public.listing_media m where m.listing_id = l.id and m.retired_at is null), '[]'::jsonb),
    'taken_at', now())
  from public.listings l where l.id = p_listing;
$$;
revoke execute on function public.listing_snapshot(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2 and 4. Listing rules, replacing migration 006's version
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
  visible_change boolean := false;
begin
  -- Fields only the platform sets.
  if customer then
    if tg_op = 'INSERT' then
      new.item_id := null;
      new.views := 0;
      new.favourites := 0;
      new.serial_hint := null;
      new.revision := 0;
      new.edited_at := null;
      if new.evidence_version >= 1 then
        new.status := 'active';
      end if;
    else
      new.item_id := old.item_id;
      new.views := old.views;
      new.favourites := old.favourites;
      new.serial_hint := old.serial_hint;
      new.seller_id := old.seller_id;
      new.created_at := old.created_at;
      new.evidence_version := greatest(old.evidence_version, new.evidence_version);
      new.revision := old.revision;
      new.edited_at := old.edited_at;
      if old.evidence_version >= 1 then
        new.status := old.status;
      end if;
    end if;
  end if;

  if new.evidence_version < 1 then
    return new;  -- made in the current single-file app: its own rules apply
  end if;

  -- Locked while someone is paying, and once sold.
  if customer and tg_op = 'UPDATE' and old.status in ('reserved', 'sold') then
    raise exception '%', case when old.status = 'sold' then 'This item has been sold, so its listing can''t be changed'
                              else 'Someone is buying this item right now, so its listing can''t be changed' end
      using errcode = 'P0001';
  end if;

  -- The witnessing tier follows the price (the add-on bands in the fee model).
  new.tier := case
    when new.price_pence >= 150000 then 'ultraLuxury'
    when new.price_pence >= 50000 then 'luxury'
    when new.price_pence >= 7500 then 'verified'
    else 'enhanced' end;

  if tg_op = 'UPDATE' then
    visible_change := (new.title, new.description, new.brand, new.category, new.size_label, new.colour, new.condition_label,
                       new.price_pence, new.shipping_pence, new.parcel_size, new.protection_payer, new.declined_shots, new.serial_hint)
                      is distinct from
                      (old.title, old.description, old.brand, old.category, old.size_label, old.colour, old.condition_label,
                       old.price_pence, old.shipping_pence, old.parcel_size, old.protection_payer, old.declined_shots, old.serial_hint);
  end if;

  -- The publish check: when a listing goes live, and whenever a live listing changes.
  if new.published and (tg_op = 'INSERT' or not old.published or visible_change) then
    select c.evidence_profile into profile from public.categories c where c.slug = new.category;
    if profile is null or profile = '{}'::jsonb then
      raise exception 'Not ready to publish: choose a category' using errcode = 'P0001';
    end if;
    for req in select * from jsonb_array_elements(profile -> 'shots') loop
      continue when not (req ->> 'required')::boolean;
      continue when exists (
        select 1 from public.listing_media m
         where m.listing_id = new.id and m.shot = req ->> 'key' and m.kind = req ->> 'kind' and m.retired_at is null);
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
    -- A new revision of what buyers see.
    new.revision := coalesce(old.revision, 0) + 1;
    new.edited_at := case when coalesce(old.revision, 0) > 0 then now() else null end;
  end if;
  return new;
end;
$$;
revoke execute on function public.listing_rules() from public, anon, authenticated;

-- After a new revision is saved, keep a snapshot of exactly what buyers saw.
create or replace function public.record_listing_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.evidence_version >= 1 and new.revision > coalesce(old.revision, 0) then
    insert into public.listing_revisions (listing_id, revision, seller_id, snapshot)
    values (new.id, new.revision, new.seller_id, public.listing_snapshot(new.id))
    on conflict (listing_id, revision) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.record_listing_revision() from public, anon, authenticated;

create or replace trigger listings_record_revision
  after insert or update on public.listings
  for each row execute procedure public.record_listing_revision();

-- A listing that has ever been live can't be deleted by its seller: its history and any orders need it.
create or replace function public.keep_listing_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and old.evidence_version >= 1 and old.revision > 0 then
    raise exception 'A listing that has been live is kept for its history. Pause it to take it off sale.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke execute on function public.keep_listing_history() from public, anon, authenticated;

create or replace trigger listings_keep_history
  before delete on public.listings
  for each row execute procedure public.keep_listing_history();

-- ------------------------------------------------------------
-- 3 and 4. Photo and video rules, replacing migration 006's version
-- ------------------------------------------------------------
create or replace function public.listing_media_rules()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller, to tell customers from the platform
set search_path = public
as $$
declare
  lid uuid;
  l record;
begin
  if tg_op = 'DELETE' then lid := old.listing_id; else lid := new.listing_id; end if;
  select li.published, li.status, li.evidence_version, li.revision into l from public.listings li where li.id = lid;
  if current_user in ('anon', 'authenticated') and coalesce(l.evidence_version, 0) >= 1 then
    if l.status in ('reserved', 'sold') then
      raise exception '%', case when l.status = 'sold' then 'This item has been sold, so its photos can''t be changed'
                                else 'Someone is buying this item right now, so its photos can''t be changed' end
        using errcode = 'P0001';
    end if;
    if l.published then
      raise exception 'Pause the listing to change its photos, then publish your changes' using errcode = 'P0001';
    end if;
    if tg_op = 'DELETE' and l.revision > 0 then
      raise exception 'Photos of a listing that has been live are kept for its history: retire them instead' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' then
      -- Only retiring (or un-retiring before republishing) and re-ordering are allowed; the file itself never changes.
      new.path := old.path;
      new.kind := old.kind;
      new.sha256 := old.sha256;
      new.listing_id := old.listing_id;
      new.seller_id := old.seller_id;
      new.created_at := old.created_at;
    end if;
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

-- Retired photos are hidden from everyone but the seller (orders keep their own copies of the paths).
alter policy "media of published listings is public" on public.listing_media
  using (exists (select 1 from public.listings l where l.id = listing_id
                   and ((l.published = true and retired_at is null) or l.seller_id = (select auth.uid()))));

-- A file that any photo row points at can't be deleted or overwritten, so history can't be rewritten.
alter policy "sellers delete their own listing media" on storage.objects
  using (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (select 1 from public.listing_media m where m.path = name));
alter policy "sellers replace their own listing media" on storage.objects
  using (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (select 1 from public.listing_media m where m.path = name))
  with check (bucket_id = 'listing-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Serial numbers: changeable while the listing is paused for editing; locked while live, reserved or sold.
create or replace function public.sync_serial_hint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
begin
  if tg_op = 'DELETE' then
    select published, status, evidence_version into l from public.listings where id = old.listing_id;
  else
    select published, status, evidence_version into l from public.listings where id = new.listing_id;
  end if;
  if coalesce(l.evidence_version, 0) >= 1 and (l.published or l.status <> 'active') then
    raise exception 'Pause the listing to change its serial number' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    update public.listings set serial_hint = null where id = old.listing_id;
    return old;
  end if;
  update public.listings set serial_hint = upper(right(regexp_replace(new.serial_number, '\s', '', 'g'), 4)) where id = new.listing_id;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.sync_serial_hint() from public, anon, authenticated;

-- The delete trigger must run before the row goes, so the check can stop it.
create or replace trigger listing_secrets_hint_clear
  before delete on public.listing_secrets
  for each row execute procedure public.sync_serial_hint();

-- ------------------------------------------------------------
-- 5. Checkout knows which revision the buyer saw; orders keep what was bought
-- ------------------------------------------------------------
alter table public.orders add column if not exists listing_revision integer;
alter table public.orders add column if not exists listing_snapshot jsonb;

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
    new.payment_status := old.payment_status;
    new.total_pence := old.total_pence;
    new.postage_pence := old.postage_pence;
    new.fee_version := old.fee_version;
    new.payment_ref := old.payment_ref;
    new.paid_at := old.paid_at;
    new.hold_expires_at := old.hold_expires_at;
    new.listing_revision := old.listing_revision;
    new.listing_snapshot := old.listing_snapshot;
    if old.payment_status not in ('legacy', 'paid') then
      new.status := old.status;
      new.timeline_state := old.timeline_state;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_order_fields() from public, anon, authenticated;

-- p_revision: the revision the buyer was looking at. If the listing has changed since, nothing is held
-- and the buyer is told; the screen then shows what changed. Null skips the check (partners using the API).
create or replace function public.start_checkout(p_listing uuid, p_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing public.orders%rowtype;
  q jsonb;
  cfg record;
  oid uuid;
  hold timestamptz;
  current_revision integer;
begin
  if me is null then
    raise exception 'Sign in to buy' using errcode = '42501';
  end if;
  perform public.release_expired_checkouts();

  select * into existing from public.orders
   where listing_id = p_listing and buyer_id = me and payment_status = 'awaiting_payment' and hold_expires_at > now()
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('order_id', existing.id, 'quote', existing.fees, 'hold_expires_at', existing.hold_expires_at,
                              'revision', existing.listing_revision);
  end if;

  select revision into current_revision from public.listings where id = p_listing for update;
  if p_revision is not null and current_revision is distinct from p_revision then
    raise exception 'LISTING_CHANGED: The seller changed this listing while you were looking. Check the changes before you pay.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.listings where id = p_listing and status = 'reserved') then
    raise exception 'Someone else is buying this right now. Try again in a few minutes.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.listings where id = p_listing and seller_id = me) then
    raise exception 'You cannot buy your own listing' using errcode = 'P0001';
  end if;
  q := public.order_quote(p_listing);
  if q is null then
    raise exception 'This item is not available to buy' using errcode = 'P0001';
  end if;
  select * into cfg from public.current_fee_settings();
  hold := now() + make_interval(mins => coalesce((cfg.settings ->> 'checkout_hold_minutes')::int, 30));

  insert into public.orders (listing_id, buyer_id, seller_id, price_pence, fees, payment_status, total_pence, postage_pence,
                             fee_version, hold_expires_at, listing_revision, listing_snapshot)
  values (p_listing, me, me, (q ->> 'price_pence')::int, q, 'awaiting_payment', (q ->> 'buyer_total_pence')::int,
          (q ->> 'postage_pence')::int, (q ->> 'fee_version')::int, hold, current_revision, public.listing_snapshot(p_listing))
  returning id into oid;
  return jsonb_build_object('order_id', oid, 'quote', q, 'hold_expires_at', hold, 'revision', current_revision);
end;
$$;
revoke execute on function public.start_checkout(uuid, integer) from public, anon;
grant execute on function public.start_checkout(uuid, integer) to authenticated;

-- The one-argument form (migration 008) now records the snapshot too.
create or replace function public.start_checkout(p_listing uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.start_checkout(p_listing, null::integer);
$$;
revoke execute on function public.start_checkout(uuid) from public, anon;
grant execute on function public.start_checkout(uuid) to authenticated;
