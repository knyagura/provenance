-- 031: Card refunds, and returns.
--
-- Refunds: whenever an order ends in a refund (a staff decision, or a return the seller received), a refund of what
-- the buyer paid by card is queued and sent through Stripe by the send-payouts worker (it now moves money both ways).
-- The NuTuYu-balance part is already put back by migration 022.
--
-- Returns: when the item has arrived and it's the buyer's turn to confirm, they can ask to return it (not as
-- described, damaged, or the wrong item). The payment stays held. The seller accepts (a return label to their
-- default address is made, test mode like ADR 0018) or declines (staff decide, as for any dispute). If the seller
-- does nothing for 48 hours the return is accepted for them. The buyer posts it back; when the seller confirms it
-- arrived, the buyer is refunded. Every step goes on the order's custody record.

-- ------------------------------------------------------------
-- 1. Refunds
-- ------------------------------------------------------------
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  amount_pence integer not null check (amount_pence >= 0),
  payment_ref text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'manual')),
  refund_ref text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists refunds_status_idx on public.refunds (status, created_at);
alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;

create or replace function public.orders_queue_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref text;
  amount integer;
begin
  if new.payout_status = 'refund' and old.payout_status is distinct from 'refund' and new.payment_status = 'paid' then
    ref := coalesce(new.payment_ref, (select g.payment_ref from public.checkout_groups g where g.id = new.group_id));
    amount := coalesce(new.total_pence, 0);
    insert into public.refunds (order_id, amount_pence, payment_ref, status, sent_at)
    values (new.id, amount, ref,
            case when amount = 0 then 'sent' when ref like 'pi\_%' then 'queued' else 'manual' end,
            case when amount = 0 then now() end)
    on conflict (order_id) do nothing;
    if amount > 0 then
      perform public.notify(new.buyer_id, 'decision', 'Your refund is on its way',
        public.notify_pounds(amount) || ' goes back to your card. Banks usually take 5 to 10 working days to show it.',
        '/orders/' || new.id, p_order => new.id, p_dedupe => 'refund:' || new.id);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_queue_refund() from public, anon, authenticated;
do $$ begin
  create trigger orders_queue_refund after update of payout_status on public.orders
    for each row execute function public.orders_queue_refund();
exception when duplicate_object then null; end $$;

create or replace function public.refunds_claim(p_limit integer)
returns table (id uuid, order_id uuid, amount_pence integer, payment_ref text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.refunds set status = 'queued', updated_at = now() where status = 'sending' and updated_at < now() - interval '15 minutes';
  return query
  with c as (
    select r.id from public.refunds r where r.status = 'queued' order by r.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 50)) for update skip locked
  )
  update public.refunds r set status = 'sending', attempts = r.attempts + 1, updated_at = now()
    from c where r.id = c.id
  returning r.id, r.order_id, r.amount_pence, r.payment_ref, r.attempts;
end;
$$;
revoke execute on function public.refunds_claim(integer) from public, anon, authenticated;
grant execute on function public.refunds_claim(integer) to service_role;

create or replace function public.refund_done(p_id uuid, p_ok boolean, p_ref text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.refunds
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         refund_ref = case when p_ok then p_ref else refund_ref end,
         sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(p_error, 300) end,
         updated_at = now()
   where id = p_id and status = 'sending';
end;
$$;
revoke execute on function public.refund_done(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.refund_done(uuid, boolean, text, text) to service_role;

create or replace function public.staff_refunds()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'order_id', r.order_id, 'amount_pence', r.amount_pence, 'status', r.status,
            'attempts', r.attempts, 'last_error', r.last_error, 'updated_at', r.updated_at) order by r.updated_at desc), '[]'::jsonb)
            from public.refunds r where r.status in ('queued', 'sending', 'failed', 'manual') or r.updated_at > now() - interval '30 days');
end;
$$;
revoke execute on function public.staff_refunds() from public, anon;
grant execute on function public.staff_refunds() to authenticated;

-- ------------------------------------------------------------
-- 2. Returns
-- ------------------------------------------------------------
alter table public.shipping_labels add column if not exists direction text not null default 'out';
do $$ begin
  alter table public.shipping_labels add constraint shipping_labels_direction_check check (direction in ('out', 'return'));
exception when duplicate_object then null; end $$;
drop index if exists public.shipping_labels_one_active;
create unique index if not exists shipping_labels_one_active_way on public.shipping_labels (order_id, direction) where status = 'active';

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  reason text not null check (reason in ('not_as_described', 'damaged', 'wrong_item')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'posted', 'received', 'cancelled')),
  seller_note text check (seller_note is null or char_length(seller_note) <= 500),
  auto_accepted boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  posted_at timestamptz,
  received_at timestamptz
);
create index if not exists returns_open_idx on public.returns (status, requested_at) where status in ('requested', 'accepted', 'posted');
alter table public.returns enable row level security;
revoke all on public.returns from anon, authenticated;

create or replace function public.order_return(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.orders;
  r public.returns;
  cur jsonb;
  lab public.shipping_labels;
begin
  select * into o from public.orders where id = p_order;
  if not found or auth.uid() is null or (auth.uid() not in (o.buyer_id, o.seller_id) and not public.is_staff()) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  select * into r from public.returns where order_id = o.id;
  select * into lab from public.shipping_labels where order_id = o.id and direction = 'return' and status = 'active';
  cur := public.custody_current(o);
  return jsonb_build_object(
    -- The buyer can ask while it's their turn to confirm (the item has arrived), once per order.
    'can_request', auth.uid() = o.buyer_id and r.id is null and o.payment_status = 'paid' and o.custody_state = 'in_progress'
                   and cur ->> 'actor' = 'buyer' and cur ->> 'key' = 'confirm',
    'return', case when r.id is null then null else jsonb_build_object(
      'status', r.status, 'reason', r.reason, 'note', r.note, 'seller_note', r.seller_note, 'auto_accepted', r.auto_accepted,
      'requested_at', r.requested_at, 'decided_at', r.decided_at, 'posted_at', r.posted_at, 'received_at', r.received_at,
      'respond_by', r.requested_at + interval '48 hours') end,
    'label', case when lab.id is null then null else jsonb_build_object('carrier', lab.carrier, 'service', lab.service_name, 'tracking', lab.tracking,
      'mode', lab.mode, 'deliver_to', case when auth.uid() = o.buyer_id or public.is_staff() then lab.deliver_to end, 'label_url', lab.label_url) end
  );
end;
$$;
revoke execute on function public.order_return(uuid) from public, anon;
grant execute on function public.order_return(uuid) to authenticated;

create or replace function public.request_return(p_order uuid, p_reason text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders;
  h text;
  n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into o from public.orders where id = p_order for update;
  if not found or me is distinct from o.buyer_id then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if not coalesce((public.order_return(o.id) ->> 'can_request')::boolean, false) then
    raise exception 'You can ask to return it once it has arrived, before you confirm.' using errcode = '55000';
  end if;
  if p_reason not in ('not_as_described', 'damaged', 'wrong_item') then
    raise exception 'Choose why you’re returning it.' using errcode = '22023';
  end if;
  if char_length(coalesce(n, '')) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = '22023';
  end if;
  insert into public.returns (order_id, reason, note) values (o.id, p_reason, n);
  h := public.custody_append(o, 'return_requested', 'buyer', me, jsonb_strip_nulls(jsonb_build_object('reason', p_reason, 'note', n)));
  update public.orders set custody_head = h, custody_updated_at = now(), custody_state = 'disputed', dispute_reason = 'return', disputed_at = now()
   where id = o.id;
  perform public.notify(o.seller_id, 'turn', 'Return requested', 'The buyer wants to return an item. Accept or decline within 48 hours, or it’s accepted for you.',
    '/orders/' || o.id, p_order => o.id, p_dedupe => 'return:' || o.id);
  return public.order_return(o.id);
end;
$$;
revoke execute on function public.request_return(uuid, text, text) from public, anon;
grant execute on function public.request_return(uuid, text, text) to authenticated;

-- Accepting makes a return label to the seller's default address (test mode until Parcel2Go is live).
create or replace function public.return_accept(o public.orders, p_actor uuid, p_role text, p_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dest jsonb := (select address from public.addresses where user_id = o.seller_id and is_default);
  h text;
begin
  update public.returns set status = 'accepted', decided_at = now(), auto_accepted = p_auto where order_id = o.id;
  if dest is not null then
    insert into public.shipping_labels (order_id, seller_id, service_key, carrier, service_name, parcel, price_pence, mode, tracking, deliver_to, direction)
    select o.id, o.seller_id, s.key, s.carrier, s.name, 'small', 0, 'test', 'P2GTEST' || upper(substr(md5(gen_random_uuid()::text), 1, 9)), dest, 'return'
      from public.shipping_services s where s.key = 'evri_dropoff'
    on conflict do nothing;
  end if;
  h := public.custody_append(o, 'return_accepted', p_role, p_actor, jsonb_build_object('auto', p_auto));
  update public.orders set custody_head = h, custody_updated_at = now() where id = o.id;
  perform public.notify(o.buyer_id, 'turn', 'Your return is accepted',
    case when dest is null then 'Post it back to the seller; they’ll message you the address.' else 'Print the return label from your order and post it back.' end,
    '/orders/' || o.id, p_order => o.id, p_dedupe => 'return-accepted:' || o.id);
end;
$$;
revoke execute on function public.return_accept(public.orders, uuid, text, boolean) from public, anon, authenticated;

create or replace function public.respond_return(p_order uuid, p_accept boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders;
  r public.returns;
  n text := nullif(btrim(coalesce(p_note, '')), '');
  h text;
begin
  select * into o from public.orders where id = p_order for update;
  select * into r from public.returns where order_id = p_order for update;
  if o.id is null or me is distinct from o.seller_id or r.id is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'requested' then
    raise exception 'You’ve already answered this return.' using errcode = '55000';
  end if;
  if p_accept then
    perform public.return_accept(o, me, 'seller', false);
  else
    if char_length(coalesce(n, '')) < 3 then
      raise exception 'Say why you’re declining: our team will read it.' using errcode = '22023';
    end if;
    update public.returns set status = 'declined', seller_note = n, decided_at = now() where id = r.id;
    h := public.custody_append(o, 'return_declined', 'seller', me, jsonb_build_object('note', n));
    -- It stays on hold as a dispute for staff to decide.
    update public.orders set custody_head = h, custody_updated_at = now() where id = o.id;
    perform public.notify(o.buyer_id, 'decision', 'The seller declined your return',
      'Our team will look at it and decide. The payment stays held until then.', '/orders/' || o.id, p_order => o.id, p_dedupe => 'return-declined:' || o.id);
  end if;
  return public.order_return(o.id);
end;
$$;
revoke execute on function public.respond_return(uuid, boolean, text) from public, anon;
grant execute on function public.respond_return(uuid, boolean, text) to authenticated;

create or replace function public.return_posted(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  h text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or auth.uid() is distinct from o.buyer_id then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  update public.returns set status = 'posted', posted_at = now() where order_id = o.id and status = 'accepted';
  if not found then
    raise exception 'The return needs accepting first.' using errcode = '55000';
  end if;
  h := public.custody_append(o, 'return_posted', 'buyer', auth.uid(),
    coalesce((select jsonb_build_object('carrier', carrier, 'tracking', tracking) from public.shipping_labels where order_id = o.id and direction = 'return' and status = 'active'), '{}'::jsonb));
  update public.orders set custody_head = h, custody_updated_at = now() where id = o.id;
  perform public.notify(o.seller_id, 'turn', 'Return on its way', 'The buyer has posted the item back. Confirm when it arrives so they’re refunded.',
    '/orders/' || o.id, p_order => o.id, p_dedupe => 'return-posted:' || o.id);
  return public.order_return(o.id);
end;
$$;
revoke execute on function public.return_posted(uuid) from public, anon;
grant execute on function public.return_posted(uuid) to authenticated;

-- The seller confirms it's back: the buyer is refunded (which queues the card refund above).
create or replace function public.return_received(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  h text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or auth.uid() is distinct from o.seller_id then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  update public.returns set status = 'received', received_at = now() where order_id = o.id and status in ('accepted', 'posted');
  if not found then
    raise exception 'There’s no return on its way for this order.' using errcode = '55000';
  end if;
  h := public.custody_append(o, 'return_received', 'seller', auth.uid(), '{}'::jsonb);
  update public.orders set custody_head = h, custody_updated_at = now(), dispute_resolution = 'refund', resolved_at = now(), payout_status = 'refund'
   where id = o.id;
  return public.order_return(o.id);
end;
$$;
revoke execute on function public.return_received(uuid) from public, anon;
grant execute on function public.return_received(uuid) to authenticated;

-- The buyer changes their mind before posting it: the order carries on (their turn to confirm).
create or replace function public.cancel_return(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  h text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or auth.uid() is distinct from o.buyer_id then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  update public.returns set status = 'cancelled' where order_id = o.id and status in ('requested', 'accepted');
  if not found then
    raise exception 'This return can’t be cancelled now.' using errcode = '55000';
  end if;
  update public.shipping_labels set status = 'cancelled', cancelled_at = now() where order_id = o.id and direction = 'return' and status = 'active';
  h := public.custody_append(o, 'return_cancelled', 'buyer', auth.uid(), '{}'::jsonb);
  update public.orders set custody_head = h, custody_updated_at = now(), custody_state = 'in_progress', dispute_reason = null, disputed_at = null
   where id = o.id;
  return public.order_return(o.id);
end;
$$;
revoke execute on function public.cancel_return(uuid) from public, anon;
grant execute on function public.cancel_return(uuid) to authenticated;

-- Run hourly (031b): accepts returns the seller hasn't answered in 48 hours.
create or replace function public.auto_accept_returns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  n integer := 0;
begin
  for o in select x.* from public.orders x join public.returns r on r.order_id = x.id
            where r.status = 'requested' and r.requested_at < now() - interval '48 hours' for update of x skip locked loop
    perform public.return_accept(o, null, 'system', true);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.auto_accept_returns() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Outbound labels ignore return labels (same functions as 025, filtered by direction)
-- ------------------------------------------------------------

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
  select * into lab from public.shipping_labels where order_id = o.id and direction = 'out' and status = 'active';
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
  if exists (select 1 from public.shipping_labels where order_id = o.id and direction = 'out' and status = 'active') then
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
  update public.shipping_labels set status = 'cancelled', cancelled_at = now() where order_id = o.id and direction = 'out' and status = 'active';
  if not found then
    raise exception 'There’s no label to cancel.' using errcode = 'P0002';
  end if;
  return public.order_shipping(o.id);
end;
$$;
revoke execute on function public.cancel_label(uuid) from public, anon;
grant execute on function public.cancel_label(uuid) to authenticated;
