-- Provenance: migration 008 — fees and checkout (build step 5).
-- Run AFTER 007. Additive and safe to re-run. Contains no DROP statements.
--
--   1. fee_settings: versioned fee rules, seeded with the fee model's defaults (version 1). Anyone can read
--      them (fees are public); only the platform can add a version. Staff edit them in the console later.
--   2. compute_fees(): the fee engine, the same rules as web/lib/domain/fees.ts, tested on the same baskets.
--   3. order_quote(listing): what this item costs right now, with every line shown.
--   4. Orders gain payment fields. The new site creates orders only through start_checkout(), which prices
--      them on the server and holds the item while the buyer pays. Orders the current single-file app inserts
--      directly are marked 'legacy' and behave as before.
--   5. confirm_payment(): marks an order paid. Only the payment service (Supabase Edge Function holding the
--      Stripe keys) can call it.
--   6. release_expired_checkouts(): frees items whose buyer didn't pay in time (also run every 5 minutes, 008b).
--
-- The database advisor lists start_checkout and cancel_checkout as callable by signed-in users. That is
-- intended: they act only for auth.uid(), and they run as the platform so prices can't be supplied by the buyer.

-- ------------------------------------------------------------
-- 1. Fee settings
-- ------------------------------------------------------------
create table if not exists public.fee_settings (
  version integer primary key check (version > 0),
  effective_from timestamptz not null default now(),
  settings jsonb not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.fee_settings enable row level security;
do $$ begin
  create policy "fee settings are public" on public.fee_settings for select using (true);
exception when duplicate_object then null; end $$;
revoke all on public.fee_settings from anon, authenticated;
grant select on public.fee_settings to anon, authenticated;

insert into public.fee_settings (version, effective_from, note, settings) values (1, '2026-10-11T00:00:00Z', 'Fee model defaults, agreed 11 Oct 2026', '{
  "tiers": [
    {"key": "enhanced",    "from_pence": 0,      "protection_bp": 500, "courier_pence": 0,   "hub_pence": 0},
    {"key": "verified",    "from_pence": 7500,   "protection_bp": 500, "courier_pence": 500, "hub_pence": 0},
    {"key": "luxury",      "from_pence": 50000,  "protection_bp": 500, "courier_pence": 500, "hub_pence": 1500},
    {"key": "ultraLuxury", "from_pence": 150000, "protection_bp": 500, "courier_pence": 500, "hub_pence": 3000}
  ],
  "processing_pence": 80,
  "protection_min_pence": 50,
  "protection_max_pence": 25000,
  "boost_on": true,
  "boost_min_price_pence": 2500,
  "boost_min_bp": 300,
  "boost_max_bp": 800,
  "boost_fixed_pence": 80,
  "promotion_share_bp": 0,
  "promotion_covers": {"protection": true, "processing": true, "add_ons": false},
  "checkout_hold_minutes": 30
}'::jsonb)
on conflict (version) do nothing;

-- The version in force now.
create or replace function public.current_fee_settings()
returns table (version integer, settings jsonb)
language sql stable
set search_path = public
as $$
  select f.version, f.settings from public.fee_settings f
   where f.effective_from <= now() order by f.effective_from desc, f.version desc limit 1;
$$;
grant execute on function public.current_fee_settings() to anon, authenticated;

-- ------------------------------------------------------------
-- 2. The fee engine (pence and basis points; halves round up)
-- ------------------------------------------------------------
create or replace function public.compute_fees(s jsonb, p_price integer, p_postage integer, p_payer text, p_boost_bp integer, p_version integer default null)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  t jsonb;
  x jsonb;
  protection integer;
  processing integer := (s ->> 'processing_pence')::int;
  add_ons integer;
  commission integer := 0;
  promotion integer := 0;
  rate integer;
  coverable integer;
  buyer_fees integer;
  seller_fees integer;
begin
  if p_price is null or p_price < 0 or p_postage is null or p_postage < 0 then
    raise exception 'Prices are whole pence' using errcode = '22023';
  end if;
  if p_payer not in ('buyer', 'seller') then
    raise exception 'Payer must be buyer or seller' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(s -> 'tiers') loop
    if t is null or p_price >= (x ->> 'from_pence')::int then t := x; end if;
  end loop;
  protection := least((s ->> 'protection_max_pence')::int,
                greatest((s ->> 'protection_min_pence')::int, (p_price::bigint * (t ->> 'protection_bp')::int + 5000) / 10000));
  add_ons := (t ->> 'courier_pence')::int + (t ->> 'hub_pence')::int;

  if p_boost_bp is not null and (s ->> 'boost_on')::boolean and p_price >= (s ->> 'boost_min_price_pence')::int then
    rate := least((s ->> 'boost_max_bp')::int, greatest((s ->> 'boost_min_bp')::int, p_boost_bp));
    commission := ((p_price::bigint * rate + 5000) / 10000)::int + (s ->> 'boost_fixed_pence')::int;
    coverable := case when (s -> 'promotion_covers' ->> 'protection')::boolean and p_payer = 'buyer' then protection else 0 end
               + case when (s -> 'promotion_covers' ->> 'processing')::boolean and p_payer = 'buyer' then processing else 0 end
               + case when (s -> 'promotion_covers' ->> 'add_ons')::boolean then add_ons else 0 end;
    promotion := least(coverable, ((commission::bigint * (s ->> 'promotion_share_bp')::int + 5000) / 10000)::int);
  end if;

  buyer_fees := case when p_payer = 'buyer' then protection + processing else 0 end;
  seller_fees := case when p_payer = 'seller' then protection + processing else 0 end;
  return jsonb_build_object(
    'fee_version', p_version,
    'tier', t ->> 'key',
    'price_pence', p_price,
    'postage_pence', p_postage,
    'protection_pence', protection,
    'processing_pence', processing,
    'courier_pence', (t ->> 'courier_pence')::int,
    'hub_pence', (t ->> 'hub_pence')::int,
    'promotion_pence', promotion,
    'buyer_total_pence', p_price + p_postage + buyer_fees + add_ons - promotion,
    'commission_pence', commission,
    'seller_fees_pence', seller_fees,
    'seller_payout_pence', p_price - commission - seller_fees,
    'payer', p_payer
  );
end;
$$;
grant execute on function public.compute_fees(jsonb, integer, integer, text, integer, integer) to anon, authenticated;

-- ------------------------------------------------------------
-- 3. A quote for one listing
-- ------------------------------------------------------------
-- Returns null when the listing can't be bought: not live, not for sale, or its seller is on holiday.
create or replace function public.order_quote(p_listing uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  l record;
  cfg record;
begin
  select li.price_pence, li.shipping_pence, li.protection_payer, li.status, li.published, p.holiday_mode
    into l
    from public.listings li join public.profiles p on p.id = li.seller_id
   where li.id = p_listing;
  if not found or not l.published or l.status <> 'active' or l.holiday_mode then
    return null;
  end if;
  select * into cfg from public.current_fee_settings();
  return public.compute_fees(cfg.settings, l.price_pence, l.shipping_pence, l.protection_payer, null, cfg.version);
end;
$$;
grant execute on function public.order_quote(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Orders: payment fields, and the two ways an order is made
-- ------------------------------------------------------------
alter table public.orders add column if not exists payment_status text not null default 'legacy';
alter table public.orders add column if not exists total_pence integer;
alter table public.orders add column if not exists postage_pence integer;
alter table public.orders add column if not exists fee_version integer references public.fee_settings(version);
alter table public.orders add column if not exists payment_ref text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists hold_expires_at timestamptz;
do $$ begin
  alter table public.orders add constraint orders_payment_status_check
    check (payment_status in ('legacy', 'awaiting_payment', 'paid', 'cancelled', 'expired', 'review'));
exception when duplicate_object then null; end $$;
create index if not exists orders_awaiting_idx on public.orders (hold_expires_at) where payment_status = 'awaiting_payment';
create index if not exists orders_fee_version_idx on public.orders (fee_version);

-- Order insert rules. A customer inserting directly (the current single-file app) gets a 'legacy' order,
-- exactly as before. start_checkout() (which runs as the platform) makes 'awaiting_payment' orders, which
-- only reserve the item; it is sold when the payment is confirmed.
create or replace function public.validate_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings%rowtype;
  customer boolean := current_user in ('anon', 'authenticated');
begin
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
  new.seller_id := l.seller_id;
  new.price_pence := l.price_pence;
  new.protection_payer := l.protection_payer;
  new.created_at := now();
  if customer or new.payment_status is distinct from 'awaiting_payment' then
    new.payment_status := 'legacy';
    new.total_pence := null;
    new.postage_pence := null;
    new.fee_version := null;
    new.payment_ref := null;
    new.paid_at := null;
    new.hold_expires_at := null;
    update public.listings set status = 'sold' where id = l.id;
  else
    update public.listings set status = 'reserved' where id = l.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_new_order() from public, anon, authenticated;

-- Customers can't change prices or payment fields, and can't move an unpaid order along.
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
    if old.payment_status not in ('legacy', 'paid') then
      new.status := old.status;
      new.timeline_state := old.timeline_state;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_order_fields() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6 (used by 4). Free items whose buyer didn't pay in time
-- ------------------------------------------------------------
create or replace function public.release_expired_checkouts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with gone as (
    update public.orders set payment_status = 'expired'
     where payment_status = 'awaiting_payment' and hold_expires_at < now()
     returning id, listing_id
  )
  -- (The CTE's own changes aren't visible below, so the expired orders are excluded by id.)
  update public.listings l set status = 'active'
    from gone where l.id = gone.listing_id and l.status = 'reserved'
      and not exists (select 1 from public.orders o where o.listing_id = l.id and o.id not in (select id from gone)
                        and o.payment_status in ('awaiting_payment', 'paid', 'legacy'));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.release_expired_checkouts() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4 (continued). Checkout: price on the server, hold the item
-- ------------------------------------------------------------
create or replace function public.start_checkout(p_listing uuid)
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
begin
  if me is null then
    raise exception 'Sign in to buy' using errcode = '42501';
  end if;
  perform public.release_expired_checkouts();

  -- Pressing Pay twice, or coming back within the hold, continues the same order.
  select * into existing from public.orders
   where listing_id = p_listing and buyer_id = me and payment_status = 'awaiting_payment' and hold_expires_at > now()
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('order_id', existing.id, 'quote', existing.fees, 'hold_expires_at', existing.hold_expires_at);
  end if;

  perform 1 from public.listings where id = p_listing for update;
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

  insert into public.orders (listing_id, buyer_id, seller_id, price_pence, fees, payment_status, total_pence, postage_pence, fee_version, hold_expires_at)
  values (p_listing, me, me, (q ->> 'price_pence')::int, q, 'awaiting_payment', (q ->> 'buyer_total_pence')::int,
          (q ->> 'postage_pence')::int, (q ->> 'fee_version')::int, hold)
  returning id into oid;
  return jsonb_build_object('order_id', oid, 'quote', q, 'hold_expires_at', hold);
end;
$$;
revoke execute on function public.start_checkout(uuid) from public, anon;
grant execute on function public.start_checkout(uuid) to authenticated;

create or replace function public.cancel_checkout(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and buyer_id = auth.uid() for update;
  if not found or o.payment_status <> 'awaiting_payment' then
    return;
  end if;
  update public.orders set payment_status = 'cancelled' where id = o.id;
  update public.listings set status = 'active' where id = o.listing_id and status = 'reserved';
end;
$$;
revoke execute on function public.cancel_checkout(uuid) from public, anon;
grant execute on function public.cancel_checkout(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Payment confirmed (payment service only)
-- ------------------------------------------------------------
-- Idempotent: Stripe may send the same event more than once. A payment that arrives after the hold
-- expired still wins the item if nobody else has it; otherwise the order goes to 'review' for a refund.
create or replace function public.confirm_payment(p_order uuid, p_ref text, p_amount integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  l public.listings%rowtype;
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
  if o.payment_status not in ('awaiting_payment', 'expired', 'cancelled')
     or exists (select 1 from public.orders x where x.listing_id = o.listing_id and x.id <> o.id and x.payment_status in ('paid', 'legacy', 'awaiting_payment'))
     or l.status = 'sold' then
    update public.orders set payment_status = 'review', payment_ref = p_ref where id = o.id;
    return 'needs_refund';
  end if;
  update public.orders set payment_status = 'paid', payment_ref = p_ref, paid_at = now() where id = o.id;
  update public.listings set status = 'sold' where id = o.listing_id;
  return 'paid';
end;
$$;
revoke execute on function public.confirm_payment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_payment(uuid, text, integer) to service_role;
