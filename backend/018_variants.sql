-- Provenance: migration 018 — variants and stock for business sellers.
-- A business seller (profiles.is_pro) can sell more than one of an item, and offer it in several colours
-- and sizes. Each colour/size is its own listing, so it has its own price, stock, basket entry and
-- checkout, and every unit sold is its own protected order with its own custody record. Variants of one
-- item share a variant_group and its reference photos. Search shows one card per group.
-- Business prices are fixed: no offers on stocked or variant listings.
-- Safe to re-run.

alter table public.listings add column if not exists stock integer not null default 1;
alter table public.listings add column if not exists variant_group uuid;
alter table public.listings add column if not exists browse_visible boolean not null default true;
do $$ begin
  alter table public.listings add constraint listings_stock_check check (stock between 1 and 9999);
exception when duplicate_object then null; end $$;
create index if not exists listings_variant_group_idx on public.listings (variant_group) where variant_group is not null;
create unique index if not exists listings_variant_unique_idx
  on public.listings (variant_group, lower(coalesce(colour, '')), lower(coalesce(size_label, ''))) where variant_group is not null;
create index if not exists listings_browse_idx on public.listings (created_at desc) where published and status = 'active' and browse_visible;

-- ------------------------------------------------------------
-- 1. Units: how many are paid for, and held by someone paying
-- ------------------------------------------------------------
create or replace function public.listing_units_taken(p_listing uuid, p_except uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.orders o
   where o.listing_id = p_listing and o.id is distinct from p_except
     and (o.payment_status in ('paid', 'legacy') or (o.payment_status = 'awaiting_payment' and o.hold_expires_at > now()))
$$;
revoke execute on function public.listing_units_taken(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Listing status follows the stock; only business sellers set stock or variants
-- ------------------------------------------------------------
create or replace function public.listing_stock_rules()
returns trigger
language plpgsql
security invoker  -- current_user must be the caller, to tell customers from the platform
set search_path = public
as $$
declare
  customer boolean := current_user in ('anon', 'authenticated');
  paid integer;
  used integer;
begin
  if customer then
    -- Stock, groups and search visibility change only through the functions below.
    if tg_op = 'INSERT' then
      new.stock := 1;
      new.variant_group := null;
      new.browse_visible := true;
    else
      new.stock := old.stock;
      new.variant_group := old.variant_group;
      new.browse_visible := old.browse_visible;
    end if;
  end if;
  if new.stock <= 1 and (tg_op = 'INSERT' or old.stock <= 1) then
    return new;  -- one of a kind: the single-item rules in 008 and 012 apply as before
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  -- Recount only when something asks to change the status or the stock (not, say, search visibility,
  -- which can change while an order is half-way through being saved).
  if new.status is not distinct from old.status and new.stock = old.stock then
    return new;
  end if;
  select count(*) filter (where payment_status in ('paid', 'legacy'))::integer,
         count(*) filter (where payment_status in ('paid', 'legacy') or (payment_status = 'awaiting_payment' and hold_expires_at > now()))::integer
    into paid, used
    from public.orders where listing_id = new.id;
  -- An order being created asks to hold the item: that order isn't saved yet, so count it.
  if new.status = 'reserved' and old.status = 'active' then
    used := used + 1;
  end if;
  new.status := case when paid >= new.stock then 'sold' when used >= new.stock then 'reserved' else 'active' end;
  return new;
end;
$$;
revoke execute on function public.listing_stock_rules() from public, anon, authenticated;
-- Named to run after listings_rules (triggers run in name order).
do $$ begin
  create trigger listings_stock before insert or update on public.listings for each row execute procedure public.listing_stock_rules();
exception when duplicate_object then null; end $$;

-- One card per group in search: the oldest variant that can be bought (or the oldest, if none can).
create or replace function public.refresh_variant_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  lead uuid;
begin
  if p_group is null then return; end if;
  select id into lead from public.listings
   where variant_group = p_group and published
   order by (status = 'active') desc, created_at, id limit 1;
  update public.listings set browse_visible = (id = lead)
   where variant_group = p_group and browse_visible is distinct from (id = lead);
end;
$$;
revoke execute on function public.refresh_variant_group(uuid) from public, anon, authenticated;

create or replace function public.listings_variant_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.variant_group is not null then
    perform public.refresh_variant_group(new.variant_group);
  end if;
  if tg_op = 'UPDATE' and old.variant_group is not null and old.variant_group is distinct from new.variant_group then
    perform public.refresh_variant_group(old.variant_group);
  end if;
  return null;
end;
$$;
revoke execute on function public.listings_variant_refresh() from public, anon, authenticated;
do $$ begin
  create trigger listings_variant_refresh after insert or update of status, published, variant_group on public.listings
    for each row execute procedure public.listings_variant_refresh();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3. Orders and offers on stocked listings
-- ------------------------------------------------------------
-- Stocked items are bought only through checkout (never the old single-file app's direct orders).
create or replace function public.orders_stock_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (select stock from public.listings where id = new.listing_id) > 1
     and (current_user in ('anon', 'authenticated') or new.payment_status is distinct from 'awaiting_payment') then
    raise exception 'Buy this item through checkout.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_stock_guard() from public, anon, authenticated;
-- "orders_a…" runs before orders_validate_insert.
do $$ begin
  create trigger orders_a_stock_guard before insert on public.orders for each row execute procedure public.orders_stock_guard();
exception when duplicate_object then null; end $$;

create or replace function public.offers_fixed_price_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.listings where id = new.listing_id and (stock > 1 or variant_group is not null)) then
    raise exception 'This seller’s prices are fixed, so it doesn’t take offers.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.offers_fixed_price_guard() from public, anon, authenticated;
do $$ begin
  create trigger offers_fixed_price_guard before insert on public.offers for each row execute procedure public.offers_fixed_price_guard();
exception when duplicate_object then null; end $$;

-- Expired holds free their unit (replaces 008's version: stocked listings are recounted).
create or replace function public.release_expired_checkouts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lids uuid[];
  n integer;
begin
  with gone as (
    update public.orders set payment_status = 'expired'
     where payment_status = 'awaiting_payment' and hold_expires_at < now()
     returning listing_id
  )
  select coalesce(array_agg(distinct listing_id), '{}') into lids from gone;
  update public.listings l set status = 'active'
   where l.id = any (lids) and l.status = 'reserved' and l.stock <= 1
     and not exists (select 1 from public.orders o where o.listing_id = l.id and o.payment_status in ('awaiting_payment', 'paid', 'legacy'));
  get diagnostics n = row_count;
  -- Stocked: asking for 'active' makes the status trigger recount.
  update public.listings set status = 'active' where id = any (lids) and stock > 1 and status = 'reserved';
  return n;
end;
$$;
revoke execute on function public.release_expired_checkouts() from public, anon, authenticated;

-- Cancelling a checkout on a stocked listing: 008's cancel_checkout sets 'active' only when 'reserved',
-- which the status trigger recounts. Nothing more is needed.

-- Payment confirmed (replaces 008's version): a stocked listing has room while units are left.
create or replace function public.confirm_payment(p_order uuid, p_ref text, p_amount integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  l public.listings%rowtype;
  taken boolean;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    return 'unknown_order';
  end if;
  if o.payment_status = 'paid' then
    return 'already_paid';
  end if;
  select * into l from public.listings where id = o.listing_id for update;
  if p_amount is distinct from o.total_pence then
    update public.orders set payment_status = 'review', payment_ref = p_ref where id = o.id;
    return 'amount_mismatch';
  end if;
  taken := case when l.stock > 1 then public.listing_units_taken(l.id, o.id) >= l.stock
                else exists (select 1 from public.orders x where x.listing_id = o.listing_id and x.id <> o.id and x.payment_status in ('paid', 'legacy', 'awaiting_payment'))
                     or l.status = 'sold' end;
  if o.payment_status not in ('awaiting_payment', 'expired', 'cancelled') or taken then
    update public.orders set payment_status = 'review', payment_ref = p_ref where id = o.id;
    return 'needs_refund';
  end if;
  update public.orders set payment_status = 'paid', payment_ref = p_ref, paid_at = now() where id = o.id;
  update public.listings set status = 'sold' where id = o.listing_id;  -- stocked listings: recounted by the trigger
  return 'paid';
end;
$$;
revoke execute on function public.confirm_payment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_payment(uuid, text, integer) to service_role;

-- Staff decision on a payment held for review (replaces 012's version, the same apart from stock).
create or replace function public.staff_resolve_payment(p_order uuid, p_outcome text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  o public.orders%rowtype;
  l public.listings%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.payment_status <> 'review' then
    raise exception 'This payment isn’t waiting for a decision.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 1000 then
    raise exception 'Write a short note saying why.' using errcode = '22023';
  end if;
  select * into l from public.listings where id = o.listing_id for update;
  if p_outcome = 'accept' then
    if (l.stock > 1 and public.listing_units_taken(l.id, o.id) >= l.stock)
       or (l.stock <= 1 and (l.status = 'sold' or exists (select 1 from public.orders x where x.listing_id = l.id and x.id <> o.id and x.payment_status in ('paid', 'awaiting_payment')))) then
      raise exception 'The item has gone to someone else, so this payment must be refunded.' using errcode = 'P0001';
    end if;
    update public.orders set payment_status = 'paid', paid_at = coalesce(paid_at, now()) where id = o.id;
    update public.listings set status = 'sold' where id = l.id;
  elsif p_outcome = 'refund' then
    update public.orders set payment_status = 'cancelled' where id = o.id;
  else
    raise exception 'Choose accept or refund.' using errcode = '22023';
  end if;
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'resolve_payment', o.id::text, jsonb_build_object('outcome', p_outcome, 'note', btrim(p_note)));
  return public.staff_order(p_order);
end;
$$;
revoke execute on function public.staff_resolve_payment(uuid, text, text) from public, anon;
grant execute on function public.staff_resolve_payment(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Variant photos: a variant shows its group's reference photos (replaces 009's media rules)
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
  select li.published, li.status, li.evidence_version, li.revision, li.variant_group into l from public.listings li where li.id = lid;
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
  if new.path not like new.seller_id::text || '/' || new.listing_id::text || '/%'
     -- Shared by a variant: only the platform copies these, from another listing in the same group.
     and not (current_user not in ('anon', 'authenticated') and l.variant_group is not null
              and exists (select 1 from public.listings s where s.variant_group = l.variant_group and s.seller_id = new.seller_id
                            and new.path like new.seller_id::text || '/' || s.id::text || '/%')) then
    raise exception 'Media must be stored in the listing''s own folder' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.listing_media_rules() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. For sellers and shoppers
-- ------------------------------------------------------------
-- The colours and sizes of an item (just itself when it has none), with what's left of each.
create or replace function public.listing_variants(p_listing uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as uid),
       base as (select * from public.listings where id = p_listing)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'colour', l.colour, 'size', l.size_label, 'price_pence', l.price_pence, 'stock', l.stock,
           'units_left', case when l.published and l.status <> 'sold' then greatest(l.stock - public.listing_units_taken(l.id), 0) else 0 end,
           'status', l.status, 'published', l.published, 'current', l.id = p_listing)
         order by l.colour nulls first, l.size_label nulls first, l.created_at), '[]'::jsonb)
    from public.listings l, base b, me
   where (l.id = b.id or (b.variant_group is not null and l.variant_group = b.variant_group))
     and (l.published or l.seller_id = me.uid)
     and (b.published or b.seller_id = me.uid)
$$;
revoke execute on function public.listing_variants(uuid) from public;
grant execute on function public.listing_variants(uuid) to anon, authenticated;

create or replace function public.require_business_listing(p_listing uuid)
returns public.listings
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found or l.seller_id is distinct from (select auth.uid()) then
    raise exception 'Listing not found.' using errcode = 'P0002';
  end if;
  if not coalesce((select is_pro from public.profiles where id = l.seller_id), false) then
    raise exception 'Stock and variants are for business sellers. Ask us to set up your business account.' using errcode = '42501';
  end if;
  return l;
end;
$$;
revoke execute on function public.require_business_listing(uuid) from public, anon, authenticated;

-- How many the seller has in stock in total (sold ones included). Can't go below what's already sold or being paid for.
create or replace function public.set_listing_stock(p_listing uuid, p_stock integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings := public.require_business_listing(p_listing);
  taken integer := public.listing_units_taken(p_listing);
begin
  if p_stock is null or p_stock < 1 or p_stock > 9999 then
    raise exception 'Stock must be between 1 and 9,999.' using errcode = '22023';
  end if;
  if p_stock < taken then
    raise exception '% already sold or being paid for, so stock can’t go below that.', taken using errcode = 'P0001';
  end if;
  if p_stock = 1 and taken > 0 and l.stock > 1 then
    raise exception 'Keep stock above 1 while units are sold or being paid for.' using errcode = 'P0001';
  end if;
  -- The status trigger recounts when the stock changes.
  update public.listings set stock = p_stock where id = p_listing;
  return public.listing_variants(p_listing);
end;
$$;
revoke execute on function public.set_listing_stock(uuid, integer) from public, anon;
grant execute on function public.set_listing_stock(uuid, integer) to authenticated;

-- Another colour or size of a live listing: same details, photos and price, its own stock.
create or replace function public.add_variant(p_listing uuid, p_colour text, p_size text, p_stock integer, p_price integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings := public.require_business_listing(p_listing);
  g uuid;
  nid uuid;
  v_colour text := nullif(btrim(coalesce(p_colour, '')), '');
  v_size text := nullif(btrim(coalesce(p_size, '')), '');
begin
  if not l.published or l.evidence_version < 1 then
    raise exception 'Publish the listing first, then add its other colours and sizes.' using errcode = 'P0001';
  end if;
  if v_colour is null and v_size is null then
    raise exception 'Give the new variant a colour, a size, or both.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_colour, '')) > 40 or char_length(coalesce(v_size, '')) > 40 then
    raise exception 'Keep colour and size under 40 characters.' using errcode = '22023';
  end if;
  if p_stock is null or p_stock < 1 or p_stock > 9999 then
    raise exception 'Stock must be between 1 and 9,999.' using errcode = '22023';
  end if;
  if p_price is not null and (p_price < 100 or p_price > 5000000) then
    raise exception 'Price must be between £1 and £50,000.' using errcode = '22023';
  end if;
  if coalesce((select (evidence_profile -> 'serial' ->> 'required')::boolean from public.categories where slug = l.category), false) then
    raise exception 'Items with serial numbers are each listed on their own.' using errcode = 'P0001';
  end if;
  g := coalesce(l.variant_group, gen_random_uuid());
  if l.variant_group is null then
    update public.listings set variant_group = g where id = l.id;
  end if;
  if exists (select 1 from public.listings where variant_group = g
               and lower(coalesce(colour, '')) = lower(coalesce(v_colour, ''))
               and lower(coalesce(size_label, '')) = lower(coalesce(v_size, ''))) then
    raise exception 'You already have that colour and size.' using errcode = '23505';
  end if;
  insert into public.listings (seller_id, title, description, brand, category, size_label, colour, condition_label, price_pence,
                               shipping_pence, parcel_size, protection_payer, declined_shots, evidence_version, published, stock, variant_group)
  values (l.seller_id, l.title, l.description, l.brand, l.category, v_size, v_colour, l.condition_label, coalesce(p_price, l.price_pence),
          l.shipping_pence, l.parcel_size, l.protection_payer, l.declined_shots, l.evidence_version, false, p_stock, g)
  returning id into nid;
  insert into public.listing_media (listing_id, seller_id, path, kind, shot, position, width, height, sha256, is_reference)
  select nid, m.seller_id, m.path, m.kind, m.shot, m.position, m.width, m.height, m.sha256, m.is_reference
    from public.listing_media m where m.listing_id = l.id and m.retired_at is null;
  update public.listings set published = true where id = nid;
  return public.listing_variants(nid);
end;
$$;
revoke execute on function public.add_variant(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.add_variant(uuid, text, text, integer, integer) to authenticated;

-- Staff mark (or unmark) a member as a business seller.
create or replace function public.staff_set_business(p_username text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  pid uuid;
begin
  update public.profiles set is_pro = coalesce(p_on, false) where lower(username) = lower(btrim(p_username)) returning id into pid;
  if pid is null then
    raise exception 'No member called %.', p_username using errcode = 'P0002';
  end if;
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'set_business', pid::text, jsonb_build_object('on', coalesce(p_on, false)));
  return jsonb_build_object('username', (select username from public.profiles where id = pid), 'business', coalesce(p_on, false));
end;
$$;
revoke execute on function public.staff_set_business(text, boolean) from public, anon;
grant execute on function public.staff_set_business(text, boolean) to authenticated;
