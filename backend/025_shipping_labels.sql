-- 025: Shipping labels (Parcel2Go), test mode first.
-- For items the seller posts themselves (Photo evidence, the "ship" step), the seller can get a label from the order page.
-- Until NuTuYu's Parcel2Go key is added, labels are TEST labels: a made-up tracking number, a printable label marked
-- "TEST - not valid for posting", and no charge. Live labels will be bought by an Edge Function with the key and recorded
-- through record_live_label(), which only the service role may run.
--
-- The buyer gives a delivery address on the order page (or the basket's recipient address is used). Only the buyer, the
-- seller (on the label) and staff see it, and only for that order.

-- ------------------------------------------------------------
-- 1. Delivery address on the order
-- ------------------------------------------------------------
alter table public.orders add column if not exists deliver_to jsonb;
do $$ begin
  alter table public.orders add constraint orders_deliver_to_check check (deliver_to is null or jsonb_typeof(deliver_to) = 'object');
exception when duplicate_object then null; end $$;

-- Members never write it directly; set_delivery_address() does, with its checks.
create or replace function public.protect_order_delivery()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then new.deliver_to := null; else new.deliver_to := old.deliver_to; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_order_delivery() from public, anon, authenticated;
do $$ begin
  create trigger orders_protect_delivery before insert or update on public.orders
    for each row execute function public.protect_order_delivery();
exception when duplicate_object then null; end $$;

create or replace function public.clean_address(addr jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  if addr is null or jsonb_typeof(addr) <> 'object'
     or char_length(btrim(coalesce(addr ->> 'name', ''))) not between 1 and 80
     or char_length(btrim(coalesce(addr ->> 'line1', ''))) not between 1 and 120
     or char_length(coalesce(addr ->> 'line2', '')) > 120
     or char_length(btrim(coalesce(addr ->> 'town', ''))) not between 1 and 80
     or upper(btrim(coalesce(addr ->> 'postcode', ''))) !~ '^[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}$' then
    raise exception 'Enter the name, first line, town and a UK postcode.' using errcode = '22023';
  end if;
  return jsonb_build_object('name', btrim(addr ->> 'name'), 'line1', btrim(addr ->> 'line1'),
    'line2', nullif(btrim(coalesce(addr ->> 'line2', '')), ''), 'town', btrim(addr ->> 'town'),
    'postcode', regexp_replace(upper(btrim(addr ->> 'postcode')), '^([A-Z]{1,2}[0-9][0-9A-Z]?) ?([0-9][A-Z]{2})$', '\1 \2'));
end;
$$;
grant execute on function public.clean_address(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 2. Services and labels
-- ------------------------------------------------------------
create table if not exists public.shipping_services (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  carrier text not null check (char_length(carrier) between 1 and 40),
  name text not null check (char_length(name) between 1 and 80),
  drop_off boolean not null default true,
  -- Price in pence for each parcel size: {"small": 319, "medium": 449, "large": 799}.
  prices jsonb not null check (jsonb_typeof(prices) = 'object'),
  active boolean not null default true,
  sort integer not null default 0
);
alter table public.shipping_services enable row level security;
drop policy if exists "anyone reads services" on public.shipping_services;
create policy "anyone reads services" on public.shipping_services for select using (true);
revoke insert, update, delete on public.shipping_services from anon, authenticated;
grant select on public.shipping_services to anon, authenticated;

insert into public.shipping_services (key, carrier, name, drop_off, prices, sort) values
  ('evri_dropoff', 'Evri', 'Evri drop-off, 2–3 days', true, '{"small": 319, "medium": 449, "large": 799}', 1),
  ('royalmail_48', 'Royal Mail', 'Royal Mail Tracked 48', true, '{"small": 379, "medium": 529, "large": 949}', 2),
  ('dpd_pickup', 'DPD', 'DPD Pickup, next day', true, '{"small": 499, "medium": 599, "large": 899}', 3)
on conflict (key) do nothing;

create table if not exists public.shipping_labels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  service_key text not null references public.shipping_services(key),
  carrier text not null,
  service_name text not null,
  parcel text not null check (parcel in ('small', 'medium', 'large')),
  price_pence integer not null check (price_pence >= 0),
  mode text not null check (mode in ('test', 'live')),
  tracking text not null check (tracking ~ '^[A-Za-z0-9 -]{6,40}$'),
  -- Live labels: the provider's order reference and a link to the label file.
  provider_ref text,
  label_url text,
  deliver_to jsonb not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index if not exists shipping_labels_one_active on public.shipping_labels (order_id) where status = 'active';
create index if not exists shipping_labels_seller_idx on public.shipping_labels (seller_id, created_at desc);
create index if not exists shipping_labels_service_idx on public.shipping_labels (service_key);
alter table public.shipping_labels enable row level security;
-- No policies: read through order_shipping(); written only by the functions below.
revoke all on public.shipping_labels from anon, authenticated;

-- Parcel sizes, for people and for checks.
create or replace function public.parcel_sizes()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select '[{"key":"small","name":"Small","limit":"Up to 2 kg, 45 × 35 × 16 cm"},{"key":"medium","name":"Medium","limit":"Up to 5 kg, 61 × 46 × 46 cm"},{"key":"large","name":"Large","limit":"Up to 10 kg, 100 × 50 × 50 cm"}]'::jsonb
$$;
grant execute on function public.parcel_sizes() to anon, authenticated;

-- ------------------------------------------------------------
-- 3. What the order page shows
-- ------------------------------------------------------------
-- Labels are for orders the seller posts themselves, paid, before the parcel is recorded as sent.
create or replace function public.order_can_label(o public.orders)
returns boolean
language sql
stable
set search_path = public
as $$
  select o.payment_status = 'paid' and o.custody_state = 'in_progress'
     and exists (select 1 from jsonb_array_elements(public.custody_plan(o.custody_tier)) s where s ->> 'key' = 'ship')
     and not exists (select 1 from public.custody_events e where e.order_id = o.id and e.step = 'ship')
$$;
revoke execute on function public.order_can_label(public.orders) from public, anon, authenticated;

create or replace function public.order_shipping(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.orders;
  me uuid := auth.uid();
  lab public.shipping_labels;
  addr jsonb;
begin
  select * into o from public.orders where id = p_order;
  if not found or me is null or (me not in (o.buyer_id, o.seller_id) and not public.is_staff()) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  select * into lab from public.shipping_labels where order_id = o.id and status = 'active';
  addr := coalesce(o.deliver_to, o.ship_to);
  return jsonb_build_object(
    'can_label', public.order_can_label(o),
    -- Who can see the address: the buyer always; the seller once there's a label (it's printed on it); staff.
    'address', case when me = o.buyer_id or public.is_staff() or lab.id is not null then addr end,
    'has_address', addr is not null,
    'address_from_basket', o.deliver_to is null and o.ship_to is not null,
    'label', case when lab.id is null then null else jsonb_build_object(
      'id', lab.id, 'carrier', lab.carrier, 'service', lab.service_name, 'parcel', lab.parcel, 'price_pence', lab.price_pence,
      'mode', lab.mode, 'tracking', lab.tracking, 'label_url', lab.label_url, 'deliver_to', lab.deliver_to, 'created_at', lab.created_at) end,
    'quotes', case when me = o.seller_id and lab.id is null and public.order_can_label(o) then (
      select coalesce(jsonb_agg(jsonb_build_object('service', s.key, 'carrier', s.carrier, 'name', s.name, 'drop_off', s.drop_off, 'prices', s.prices) order by s.sort), '[]'::jsonb)
        from public.shipping_services s where s.active) end,
    'sizes', public.parcel_sizes()
  );
end;
$$;
revoke execute on function public.order_shipping(uuid) from public, anon;
grant execute on function public.order_shipping(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Buyer: delivery address
-- ------------------------------------------------------------
create or replace function public.set_delivery_address(p_order uuid, p_address jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.buyer_id is distinct from auth.uid() then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if o.payment_status <> 'paid' or o.custody_state in ('confirmed', 'disputed')
     or exists (select 1 from public.custody_events e where e.order_id = o.id and e.step = 'ship') then
    raise exception 'The parcel is already on its way, so the address can’t change now. Message the seller.' using errcode = '55000';
  end if;
  if exists (select 1 from public.shipping_labels where order_id = o.id and status = 'active') then
    raise exception 'The seller has already printed a label. Message them to change the address.' using errcode = '55000';
  end if;
  update public.orders set deliver_to = public.clean_address(p_address), updated_at = now() where id = o.id;
  return public.order_shipping(o.id);
end;
$$;
revoke execute on function public.set_delivery_address(uuid, jsonb) from public, anon;
grant execute on function public.set_delivery_address(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 5. Seller: labels
-- ------------------------------------------------------------
create or replace function public.create_label(p_order uuid, p_service text, p_parcel text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  s public.shipping_services;
  addr jsonb;
  price integer;
  tracking text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.seller_id is distinct from auth.uid() then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if not public.order_can_label(o) then
    raise exception 'Labels are for paid orders you post yourself, before you’ve recorded sending it.' using errcode = '55000';
  end if;
  if exists (select 1 from public.shipping_labels where order_id = o.id and status = 'active') then
    raise exception 'This order already has a label. Cancel it to make a new one.' using errcode = '55000';
  end if;
  addr := coalesce(o.deliver_to, o.ship_to);
  if addr is null then
    raise exception 'The buyer hasn’t given a delivery address yet. We’ve asked them to.' using errcode = '55000';
  end if;
  select * into s from public.shipping_services where key = p_service and active;
  if not found then
    raise exception 'Choose a delivery service.' using errcode = '22023';
  end if;
  price := (s.prices ->> p_parcel)::integer;
  if p_parcel not in ('small', 'medium', 'large') or price is null then
    raise exception 'Choose a parcel size.' using errcode = '22023';
  end if;
  -- Test mode: a made-up tracking number in the provider's style, no charge.
  tracking := 'P2GTEST' || upper(substr(md5(gen_random_uuid()::text), 1, 9));
  insert into public.shipping_labels (order_id, seller_id, service_key, carrier, service_name, parcel, price_pence, mode, tracking, deliver_to)
  values (o.id, o.seller_id, s.key, s.carrier, s.name, p_parcel, 0, 'test', tracking, addr);
  perform public.notify(o.buyer_id, 'turn', 'Your item has a shipping label',
    format('The seller has a %s label for your order and will post it soon.', s.carrier), '/orders/' || o.id, p_order => o.id, p_dedupe => 'label:' || o.id);
  return public.order_shipping(o.id);
end;
$$;
revoke execute on function public.create_label(uuid, text, text) from public, anon;
grant execute on function public.create_label(uuid, text, text) to authenticated;

create or replace function public.cancel_label(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.seller_id is distinct from auth.uid() then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.custody_events e where e.order_id = o.id and e.step = 'ship') then
    raise exception 'You’ve already recorded sending it, so the label can’t be cancelled.' using errcode = '55000';
  end if;
  update public.shipping_labels set status = 'cancelled', cancelled_at = now() where order_id = o.id and status = 'active';
  if not found then
    raise exception 'There’s no label to cancel.' using errcode = 'P0002';
  end if;
  return public.order_shipping(o.id);
end;
$$;
revoke execute on function public.cancel_label(uuid) from public, anon;
grant execute on function public.cancel_label(uuid) to authenticated;

-- Live labels (later): the Edge Function buys the label from Parcel2Go and records it here. Service role only.
create or replace function public.record_live_label(p_order uuid, p_service text, p_parcel text, p_price integer, p_tracking text, p_ref text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  s public.shipping_services;
begin
  select * into o from public.orders where id = p_order for update;
  select * into s from public.shipping_services where key = p_service;
  if o.id is null or s.key is null or not public.order_can_label(o) then
    raise exception 'Order or service not found.' using errcode = 'P0002';
  end if;
  insert into public.shipping_labels (order_id, seller_id, service_key, carrier, service_name, parcel, price_pence, mode, tracking, provider_ref, label_url, deliver_to)
  values (o.id, o.seller_id, s.key, s.carrier, s.name, p_parcel, p_price, 'live', p_tracking, p_ref, p_url, coalesce(o.deliver_to, o.ship_to));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.record_live_label(uuid, text, text, integer, text, text, text) from public, anon, authenticated;

-- When the parcel is paid for, remind the buyer to give an address if there isn't one (the seller needs it for the label).
create or replace function public.orders_ask_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.deliver_to is null and new.ship_to is null
     and exists (select 1 from jsonb_array_elements(public.custody_plan(new.custody_tier)) s where s ->> 'key' = 'ship') then
    perform public.notify(new.buyer_id, 'turn', 'Where should it be delivered?',
      'Add your delivery address so the seller can post your item.', '/orders/' || new.id, p_order => new.id, p_dedupe => 'address:' || new.id);
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_ask_address() from public, anon, authenticated;
do $$ begin
  create trigger orders_ask_address after update of payment_status on public.orders
    for each row execute function public.orders_ask_address();
exception when duplicate_object then null; end $$;
