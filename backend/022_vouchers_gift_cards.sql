-- Provenance: migration 022 — voucher codes, gift cards and a NuTuYu balance.
--
-- Vouchers come in two kinds:
--   * NuTuYu codes (seller_id null), made by staff and paid for by NuTuYu: the buyer pays less and the
--     seller still receives their full payout;
--   * shop codes (seller_id set), made by a seller for their own items and paid for by them: the item
--     price comes down, so the fees and the seller's payout are worked out on the lower price.
-- A code is applied to a checkout that is waiting for payment (one order, or a basket checkout), and is
-- "held" until the payment arrives ("used") or the checkout ends ("released").
--
-- Gift cards: £10 to £250, bought by card. The code is shown to the buyer once it is paid (and emailed to
-- the recipient, when they give an address). Redeeming it adds it to the member's NuTuYu balance, which
-- lasts 2 years from purchase and pays for orders, in full or in part. Like a NuTuYu code it lowers what
-- the buyer pays by card; the seller is paid in full.
-- Safe to re-run.

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{3,20}$'),
  seller_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0),
  min_spend_pence integer not null default 0 check (min_spend_pence >= 0),
  max_discount_pence integer check (max_discount_pence is null or max_discount_pence > 0),
  per_member integer not null default 1 check (per_member between 1 and 100),
  max_uses integer check (max_uses is null or max_uses > 0),
  first_order_only boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (kind <> 'amount' or value <= 50000)
);
create index if not exists vouchers_seller_idx on public.vouchers (seller_id);
alter table public.vouchers enable row level security;
revoke all on public.vouchers from anon, authenticated;

create table if not exists public.voucher_uses (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  target uuid not null,                    -- the order, or the basket checkout, it was applied to
  discount_pence integer not null check (discount_pence >= 0),
  prev_price integer not null,
  prev_fees jsonb not null,
  prev_total integer not null,
  state text not null default 'held' check (state in ('held', 'used', 'released')),
  created_at timestamptz not null default now()
);
create index if not exists voucher_uses_voucher_idx on public.voucher_uses (voucher_id, state);
create index if not exists voucher_uses_order_idx on public.voucher_uses (order_id);
create index if not exists voucher_uses_buyer_idx on public.voucher_uses (buyer_id);
alter table public.voucher_uses enable row level security;
revoke all on public.voucher_uses from anon, authenticated;

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  purchaser_id uuid not null references public.profiles(id),
  recipient_name text check (recipient_name is null or char_length(recipient_name) <= 80),
  recipient_email text check (recipient_email is null or recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  message text check (message is null or char_length(message) <= 300),
  amount_pence integer not null check (amount_pence between 1000 and 25000),
  payment_status text not null default 'awaiting_payment' check (payment_status in ('awaiting_payment', 'paid', 'cancelled', 'review')),
  payment_ref text,
  paid_at timestamptz,
  expires_at timestamptz,
  redeemed_by uuid references public.profiles(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists gift_cards_purchaser_idx on public.gift_cards (purchaser_id, created_at desc);
create index if not exists gift_cards_redeemed_idx on public.gift_cards (redeemed_by);
alter table public.gift_cards enable row level security;
revoke all on public.gift_cards from anon, authenticated;

create table if not exists public.balance_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('gift_card', 'refund')),
  gift_card_id uuid references public.gift_cards(id),
  amount_pence integer not null check (amount_pence > 0),
  remaining_pence integer not null check (remaining_pence >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists balance_lots_user_idx on public.balance_lots (user_id, expires_at);
create index if not exists balance_lots_card_idx on public.balance_lots (gift_card_id);
alter table public.balance_lots enable row level security;
revoke all on public.balance_lots from anon, authenticated;

create table if not exists public.balance_spends (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.balance_lots(id),
  user_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_pence integer not null check (amount_pence > 0),
  state text not null default 'held' check (state in ('held', 'used', 'released', 'refunded')),
  created_at timestamptz not null default now()
);
create index if not exists balance_spends_order_idx on public.balance_spends (order_id);
create index if not exists balance_spends_lot_idx on public.balance_spends (lot_id);
create index if not exists balance_spends_user_idx on public.balance_spends (user_id);
alter table public.balance_spends enable row level security;
revoke all on public.balance_spends from anon, authenticated;

-- Emails to people who may not have an account (gift card recipients). Sent by send-notifications.
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  link text,
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_pending_idx on public.email_outbox (created_at) where state in ('pending', 'sending');
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- ------------------------------------------------------------
-- 2. Helpers
-- ------------------------------------------------------------
create or replace function public.new_gift_card_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';  -- no 0/O, 1/I/L, U
  b bytea;
  out text;
  i integer;
begin
  loop
    b := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    out := '';
    for i in 0..15 loop
      out := out || substr(alphabet, (get_byte(b, i) % 30) + 1, 1);
      if i in (3, 7, 11) then out := out || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.gift_cards where code = out);
  end loop;
  return out;
end;
$$;
revoke execute on function public.new_gift_card_code() from public, anon, authenticated;

-- The member's orders behind a checkout waiting for payment: one order, or a basket checkout.
create or replace function public.code_targets(p_target uuid, p_me uuid)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select * from public.orders
   where buyer_id = p_me and payment_status = 'awaiting_payment' and hold_expires_at > now()
     and (id = p_target or group_id = p_target)
   order by created_at, id
   for update
$$;
revoke execute on function public.code_targets(uuid, uuid) from public, anon, authenticated;

create or replace function public.balance_available(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(remaining_pence), 0)::integer from public.balance_lots where user_id = p_user and expires_at > now()
$$;
revoke execute on function public.balance_available(uuid) from public, anon, authenticated;

-- What's applied to a checkout, and its total(s), for the checkout screens.
create or replace function public.checkout_codes(p_target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as uid),
       o as (select * from public.orders, me where buyer_id = me.uid and (id = p_target or group_id = p_target))
  select jsonb_build_object(
    'voucher', (select jsonb_build_object('code', v.code, 'shop', s.username, 'discount_pence', sum(u.discount_pence))
                  from public.voucher_uses u join public.vouchers v on v.id = u.voucher_id left join public.profiles s on s.id = v.seller_id
                 where u.target = p_target and u.state <> 'released' group by v.code, s.username limit 1),
    'balance_pence', (select coalesce(sum(b.amount_pence), 0) from public.balance_spends b join o on o.id = b.order_id where b.state in ('held', 'used')),
    'balance_available', (select public.balance_available(uid) from me),
    'total_pence', (select coalesce(sum(total_pence), 0) from o where payment_status in ('awaiting_payment', 'paid'))
           + coalesce((select wrap_total_pence from public.checkout_groups where id = p_target), 0),
    'paid', not exists (select 1 from o where payment_status <> 'paid') and exists (select 1 from o))
$$;
revoke execute on function public.checkout_codes(uuid) from public, anon;
grant execute on function public.checkout_codes(uuid) to authenticated;

-- A basket checkout's total follows its orders (and its wrapping).
create or replace function public.refresh_group_total(p_group uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_groups g
     set total_pence = coalesce((select sum(total_pence) from public.orders where group_id = g.id and payment_status = 'awaiting_payment'), 0) + coalesce(g.wrap_total_pence, 0)
   where g.id = p_group and g.payment_status = 'awaiting_payment'
$$;
revoke execute on function public.refresh_group_total(uuid) from public, anon, authenticated;

-- Nothing left to pay by card: the checkout is paid there and then.
create or replace function public.settle_if_free(p_target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  g public.checkout_groups;
begin
  select * into g from public.checkout_groups where id = p_target;
  if found then
    if g.payment_status = 'awaiting_payment' and g.total_pence = 0 then
      perform public.confirm_group_payment(g.id, 'balance', 0);
      return true;
    end if;
    return false;
  end if;
  select * into o from public.orders where id = p_target;
  if found and o.payment_status = 'awaiting_payment' and o.total_pence = 0 then
    perform public.confirm_payment(o.id, 'balance', 0);
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.settle_if_free(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Voucher codes at checkout
-- ------------------------------------------------------------
create or replace function public.apply_voucher(p_target uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v public.vouchers;
  shop text;
  subtotal integer;
  discount integer;
  left_to_share integer;
  n integer;
  i integer := 0;
  o public.orders;
  d integer;
  q jsonb;
  newp integer;
  is_group boolean := exists (select 1 from public.checkout_groups where id = p_target);
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.vouchers where code = upper(btrim(coalesce(p_code, '')));
  if not found or not v.active or (v.starts_at is not null and v.starts_at > now()) or (v.ends_at is not null and v.ends_at <= now()) then
    raise exception 'That code isn’t valid.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.voucher_uses where target = p_target and state = 'held') then
    raise exception 'A code is already applied. Remove it to use another.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.balance_spends b join public.orders x on x.id = b.order_id
              where b.state = 'held' and x.buyer_id = me and (x.id = p_target or x.group_id = p_target)) then
    raise exception 'Apply your code before using your balance.' using errcode = 'P0001';
  end if;
  if v.max_uses is not null and (select count(distinct target) from public.voucher_uses where voucher_id = v.id and state <> 'released') >= v.max_uses then
    raise exception 'That code has been used up.' using errcode = 'P0001';
  end if;
  if (select count(distinct target) from public.voucher_uses where voucher_id = v.id and buyer_id = me and state <> 'released') >= v.per_member then
    raise exception 'You’ve already used that code.' using errcode = 'P0001';
  end if;
  if v.first_order_only and exists (select 1 from public.orders where buyer_id = me and payment_status in ('paid', 'legacy')) then
    raise exception 'That code is for your first order.' using errcode = 'P0001';
  end if;
  shop := (select username from public.profiles where id = v.seller_id);

  -- Which orders it covers: all of them (NuTuYu codes) or that shop's (shop codes).
  select coalesce(sum(price_pence), 0), count(*) into subtotal, n
    from public.code_targets(p_target, me) t where v.seller_id is null or t.seller_id = v.seller_id;
  if n = 0 then
    raise exception '%', case when v.seller_id is not null then 'That code is for items from ' || shop || '.' else 'This checkout has ended. Start again.' end using errcode = 'P0001';
  end if;
  if subtotal < v.min_spend_pence then
    raise exception 'Spend at least % on % to use that code.', public.notify_pounds(v.min_spend_pence), case when v.seller_id is null then 'items' else shop || '’s items' end using errcode = 'P0001';
  end if;
  discount := case when v.kind = 'percent' then round(subtotal * v.value / 100.0)::integer else least(v.value, subtotal) end;
  if v.max_discount_pence is not null then discount := least(discount, v.max_discount_pence); end if;
  left_to_share := discount;

  -- Shared across the orders it covers, in proportion to their prices.
  for o in select * from public.code_targets(p_target, me) t where v.seller_id is null or t.seller_id = v.seller_id loop
    i := i + 1;
    d := case when i = n then left_to_share else least(left_to_share, round(discount * o.price_pence / greatest(subtotal, 1)::numeric)::integer) end;
    left_to_share := left_to_share - d;
    if v.seller_id is null then
      -- NuTuYu pays: the card total comes down, the seller's payout doesn't.
      d := least(d, o.total_pence);
      if o.total_pence - d between 1 and 29 then d := o.total_pence - 30; end if;  -- card payments start at 30p
      d := greatest(d, 0);
      q := o.fees || jsonb_build_object('voucher_code', v.code, 'voucher_pence', d, 'voucher_funder', 'nutuyu');
      insert into public.voucher_uses (voucher_id, buyer_id, order_id, target, discount_pence, prev_price, prev_fees, prev_total)
      values (v.id, me, o.id, p_target, d, o.price_pence, o.fees, o.total_pence);
      update public.orders set fees = q, total_pence = o.total_pence - d where id = o.id;
    else
      -- The shop pays: the price comes down, and the fees and payout are worked out on it.
      newp := greatest(o.price_pence - d, 1);
      q := o.fees
           || public.compute_fees((select settings from public.fee_settings where version = o.fee_version), newp, o.postage_pence, o.protection_payer, null, o.fee_version)
           || jsonb_build_object('voucher_code', v.code, 'voucher_pence', o.price_pence - newp, 'voucher_funder', 'seller', 'list_price_pence', coalesce((o.fees ->> 'list_price_pence')::integer, o.price_pence));
      insert into public.voucher_uses (voucher_id, buyer_id, order_id, target, discount_pence, prev_price, prev_fees, prev_total)
      values (v.id, me, o.id, p_target, o.price_pence - newp, o.price_pence, o.fees, o.total_pence);
      update public.orders set price_pence = newp, fees = q, total_pence = (q ->> 'buyer_total_pence')::integer where id = o.id;
    end if;
  end loop;
  if is_group then perform public.refresh_group_total(p_target); end if;
  perform public.settle_if_free(p_target);
  return public.checkout_codes(p_target);
end;
$$;
revoke execute on function public.apply_voucher(uuid, text) from public, anon;
grant execute on function public.apply_voucher(uuid, text) to authenticated;

create or replace function public.remove_voucher(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  u public.voucher_uses;
begin
  if exists (select 1 from public.balance_spends b join public.orders x on x.id = b.order_id
              where b.state = 'held' and x.buyer_id = me and (x.id = p_target or x.group_id = p_target)) then
    raise exception 'Stop using your balance first, then remove the code.' using errcode = 'P0001';
  end if;
  for u in select vu.* from public.voucher_uses vu join public.orders o on o.id = vu.order_id
            where vu.target = p_target and vu.buyer_id = me and vu.state = 'held' and o.payment_status = 'awaiting_payment' loop
    update public.orders set price_pence = u.prev_price, fees = u.prev_fees, total_pence = u.prev_total where id = u.order_id;
    update public.voucher_uses set state = 'released' where id = u.id;
  end loop;
  perform public.refresh_group_total(p_target);
  return public.checkout_codes(p_target);
end;
$$;
revoke execute on function public.remove_voucher(uuid) from public, anon;
grant execute on function public.remove_voucher(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. NuTuYu balance at checkout
-- ------------------------------------------------------------
create or replace function public.use_balance(p_target uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.orders;
  lot public.balance_lots;
  want integer;
  take integer;
  used integer;
  s public.balance_spends;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce(p_on, true) then
    for o in select * from public.code_targets(p_target, me) loop
      continue when exists (select 1 from public.balance_spends where order_id = o.id and state = 'held');
      want := o.total_pence;
      -- Leave nothing or at least 30p for the card.
      if want > 0 and public.balance_available(me) < want and want - public.balance_available(me) < 30 then
        want := want - 30;
      end if;
      used := 0;
      for lot in select * from public.balance_lots where user_id = me and remaining_pence > 0 and expires_at > now() order by expires_at, created_at for update loop
        exit when used >= want;
        take := least(lot.remaining_pence, want - used);
        update public.balance_lots set remaining_pence = remaining_pence - take where id = lot.id;
        insert into public.balance_spends (lot_id, user_id, order_id, amount_pence) values (lot.id, me, o.id, take);
        used := used + take;
      end loop;
      if used > 0 then
        update public.orders set total_pence = total_pence - used, fees = fees || jsonb_build_object('balance_pence', used) where id = o.id;
      end if;
    end loop;
  else
    for s in select b.* from public.balance_spends b join public.orders x on x.id = b.order_id
              where b.state = 'held' and x.buyer_id = me and x.payment_status = 'awaiting_payment' and (x.id = p_target or x.group_id = p_target) loop
      update public.balance_lots set remaining_pence = remaining_pence + s.amount_pence where id = s.lot_id;
      update public.balance_spends set state = 'released' where id = s.id;
      update public.orders set total_pence = total_pence + s.amount_pence,
             fees = case when coalesce((fees ->> 'balance_pence')::integer, 0) - s.amount_pence > 0
                         then fees || jsonb_build_object('balance_pence', (fees ->> 'balance_pence')::integer - s.amount_pence)
                         else fees - 'balance_pence' end
       where id = s.order_id;
    end loop;
  end if;
  perform public.refresh_group_total(p_target);
  perform public.settle_if_free(p_target);
  return public.checkout_codes(p_target);
end;
$$;
revoke execute on function public.use_balance(uuid, boolean) from public, anon;
grant execute on function public.use_balance(uuid, boolean) to authenticated;

-- When a checkout is paid, its code and balance are spent; when it ends unpaid, they come back.
-- A refund after a dispute puts the balance part back too (for 2 years).
create or replace function public.orders_codes_settle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.balance_spends;
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    update public.voucher_uses set state = 'used' where order_id = new.id and state = 'held';
    update public.balance_spends set state = 'used' where order_id = new.id and state = 'held';
  elsif new.payment_status in ('cancelled', 'expired') and old.payment_status = 'awaiting_payment' then
    update public.voucher_uses set state = 'released' where order_id = new.id and state = 'held';
    for s in select * from public.balance_spends where order_id = new.id and state = 'held' loop
      update public.balance_lots set remaining_pence = remaining_pence + s.amount_pence where id = s.lot_id;
      update public.balance_spends set state = 'released' where id = s.id;
    end loop;
  end if;
  if new.payout_status = 'refund' and old.payout_status is distinct from 'refund' then
    for s in select * from public.balance_spends where order_id = new.id and state = 'used' loop
      insert into public.balance_lots (user_id, source, amount_pence, remaining_pence, expires_at)
      values (s.user_id, 'refund', s.amount_pence, s.amount_pence, now() + interval '2 years');
      update public.balance_spends set state = 'refunded' where id = s.id;
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_codes_settle() from public, anon, authenticated;
do $$ begin
  create trigger orders_codes_settle after update of payment_status, payout_status on public.orders
    for each row execute procedure public.orders_codes_settle();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 5. Gift cards
-- ------------------------------------------------------------
create or replace function public.gift_card_json(c public.gift_cards)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', c.id, 'amount_pence', c.amount_pence, 'recipient_name', c.recipient_name, 'recipient_email', c.recipient_email,
    'message', c.message, 'payment_status', c.payment_status, 'paid_at', c.paid_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'code', case when c.payment_status = 'paid' then c.code end, 'redeemed', c.redeemed_at is not null)
$$;
revoke execute on function public.gift_card_json(public.gift_cards) from public, anon, authenticated;

create or replace function public.buy_gift_card(p_amount integer, p_name text, p_email text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  c public.gift_cards;
begin
  if me is null then raise exception 'Sign in to buy a gift card.' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 1000 or p_amount > 25000 then
    raise exception 'Gift cards are £10 to £250.' using errcode = '22023';
  end if;
  if (select count(*) from public.gift_cards where purchaser_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You’ve bought several gift cards today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.gift_cards (code, purchaser_id, recipient_name, recipient_email, message, amount_pence)
  values (public.new_gift_card_code(), me, nullif(btrim(p_name), ''), nullif(lower(btrim(p_email)), ''), nullif(btrim(p_message), ''), p_amount)
  returning * into c;
  return public.gift_card_json(c);
end;
$$;
revoke execute on function public.buy_gift_card(integer, text, text, text) from public, anon;
grant execute on function public.buy_gift_card(integer, text, text, text) to authenticated;

create or replace function public.cancel_gift_card(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gift_cards set payment_status = 'cancelled'
   where id = p_id and purchaser_id = (select auth.uid()) and payment_status = 'awaiting_payment'
$$;
revoke execute on function public.cancel_gift_card(uuid) from public, anon;
grant execute on function public.cancel_gift_card(uuid) to authenticated;

-- Payment service only (the Stripe webhook).
create or replace function public.confirm_gift_card_payment(p_card uuid, p_ref text, p_amount integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.gift_cards;
begin
  select * into c from public.gift_cards where id = p_card for update;
  if not found then return 'unknown_card'; end if;
  if c.payment_status = 'paid' then return 'already_paid'; end if;
  if p_amount is distinct from c.amount_pence then
    update public.gift_cards set payment_status = 'review', payment_ref = p_ref where id = c.id;
    return 'amount_mismatch';
  end if;
  update public.gift_cards set payment_status = 'paid', payment_ref = p_ref, paid_at = now(), expires_at = now() + interval '2 years'
   where id = c.id returning * into c;
  if c.recipient_email is not null then
    insert into public.email_outbox (to_email, subject, body, link)
    values (c.recipient_email,
      coalesce((select username from public.profiles where id = c.purchaser_id), 'Someone') || ' sent you a ' || public.notify_pounds(c.amount_pence) || ' NuTuYu gift card',
      coalesce('Hi ' || c.recipient_name || ',' || E'\n\n', '') || coalesce('“' || c.message || '”' || E'\n\n', '') ||
        'Your code is ' || c.code || '. Sign in or create a free account, then redeem it under Account → Gift cards. It’s valid until ' ||
        to_char(c.expires_at at time zone 'Europe/London', 'FMDD Month YYYY') || '.',
      '/gift-cards?code=' || c.code);
  end if;
  return 'paid';
end;
$$;
revoke execute on function public.confirm_gift_card_payment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_gift_card_payment(uuid, text, integer) to service_role;

create or replace function public.redeem_gift_card(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  c public.gift_cards;
begin
  if me is null then raise exception 'Sign in to redeem a gift card.' using errcode = '42501'; end if;
  select * into c from public.gift_cards where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or c.payment_status <> 'paid' then
    raise exception 'That gift card code isn’t valid.' using errcode = 'P0001';
  end if;
  if c.redeemed_at is not null then
    raise exception '%', case when c.redeemed_by = me then 'You’ve already added this gift card to your balance.' else 'This gift card has already been used.' end using errcode = 'P0001';
  end if;
  if c.expires_at <= now() then
    raise exception 'This gift card expired on %.', to_char(c.expires_at at time zone 'Europe/London', 'FMDD Month YYYY') using errcode = 'P0001';
  end if;
  update public.gift_cards set redeemed_by = me, redeemed_at = now() where id = c.id;
  insert into public.balance_lots (user_id, source, gift_card_id, amount_pence, remaining_pence, expires_at)
  values (me, 'gift_card', c.id, c.amount_pence, c.amount_pence, c.expires_at);
  return public.my_balance();
end;
$$;

create or replace function public.my_balance()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'balance_pence', public.balance_available((select auth.uid())),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'amount_pence', amount_pence, 'remaining_pence', remaining_pence, 'expires_at', expires_at)
                                       order by expires_at)
                        from public.balance_lots where user_id = (select auth.uid()) and remaining_pence > 0 and expires_at > now()), '[]'::jsonb))
$$;
revoke execute on function public.my_balance() from public, anon;
grant execute on function public.my_balance() to authenticated;
revoke execute on function public.redeem_gift_card(text) from public, anon;
grant execute on function public.redeem_gift_card(text) to authenticated;

create or replace function public.my_gift_cards()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.gift_card_json(c) order by c.created_at desc), '[]'::jsonb)
    from public.gift_cards c where c.purchaser_id = (select auth.uid()) and c.payment_status <> 'cancelled'
$$;
revoke execute on function public.my_gift_cards() from public, anon;
grant execute on function public.my_gift_cards() to authenticated;

-- One box at checkout: a voucher code is applied; a gift card code is added to the balance, which is then used.
create or replace function public.apply_code(p_target uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(btrim(coalesce(p_code, '')));
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from public.vouchers where code = c) then
    return public.apply_voucher(p_target, c);
  end if;
  if exists (select 1 from public.gift_cards where code = c) then
    perform public.redeem_gift_card(c);
    return public.use_balance(p_target, true);
  end if;
  raise exception 'That code isn’t valid.' using errcode = 'P0001';
end;
$$;
revoke execute on function public.apply_code(uuid, text) from public, anon;
grant execute on function public.apply_code(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 6. Making codes: staff (NuTuYu pays) and sellers (their shop pays)
-- ------------------------------------------------------------
create or replace function public.voucher_json(v public.vouchers)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', v.id, 'code', v.code, 'shop', (select username from public.profiles where id = v.seller_id), 'kind', v.kind, 'value', v.value,
    'min_spend_pence', v.min_spend_pence, 'max_discount_pence', v.max_discount_pence, 'per_member', v.per_member, 'max_uses', v.max_uses,
    'first_order_only', v.first_order_only, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'active', v.active, 'note', v.note, 'created_at', v.created_at,
    'uses', (select count(distinct target) from public.voucher_uses where voucher_id = v.id and state = 'used'),
    'discount_given_pence', (select coalesce(sum(discount_pence), 0) from public.voucher_uses where voucher_id = v.id and state = 'used'))
$$;
revoke execute on function public.voucher_json(public.vouchers) from public, anon, authenticated;

create or replace function public.save_voucher_row(p_id uuid, p_seller uuid, p jsonb, p_by uuid)
returns public.vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vouchers;
begin
  if p_id is null then
    insert into public.vouchers (code, seller_id, kind, value, min_spend_pence, max_discount_pence, per_member, max_uses, first_order_only, starts_at, ends_at, active, note, created_by)
    values (upper(btrim(p ->> 'code')), p_seller, p ->> 'kind', (p ->> 'value')::int, coalesce((p ->> 'min_spend_pence')::int, 0),
            nullif(p ->> 'max_discount_pence', '')::int, coalesce((p ->> 'per_member')::int, 1), nullif(p ->> 'max_uses', '')::int,
            coalesce((p ->> 'first_order_only')::boolean, false), nullif(p ->> 'starts_at', '')::timestamptz, nullif(p ->> 'ends_at', '')::timestamptz,
            coalesce((p ->> 'active')::boolean, true), nullif(btrim(p ->> 'note'), ''), p_by)
    returning * into v;
  else
    -- Once made, a code's terms stay as people saw them: only on/off, the end date and the use limit change.
    update public.vouchers set
      active = coalesce((p ->> 'active')::boolean, active),
      ends_at = case when p ? 'ends_at' then nullif(p ->> 'ends_at', '')::timestamptz else ends_at end,
      max_uses = case when p ? 'max_uses' then nullif(p ->> 'max_uses', '')::int else max_uses end,
      note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end
     where id = p_id and seller_id is not distinct from p_seller returning * into v;
    if v.id is null then raise exception 'Code not found.' using errcode = 'P0002'; end if;
  end if;
  return v;
exception when unique_violation then
  raise exception 'That code is taken. Choose another.' using errcode = '23505';
end;
$$;
revoke execute on function public.save_voucher_row(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function public.staff_vouchers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return coalesce((select jsonb_agg(public.voucher_json(v) order by v.created_at desc) from public.vouchers v), '[]'::jsonb);
end;
$$;
revoke execute on function public.staff_vouchers() from public, anon;
grant execute on function public.staff_vouchers() to authenticated;

create or replace function public.staff_save_voucher(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  v public.vouchers;
begin
  v := public.save_voucher_row(p_id, (select seller_id from public.vouchers where id = p_id), p, me);
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'save_voucher', v.id::text, jsonb_build_object('code', v.code, 'active', v.active));
  return public.staff_vouchers();
end;
$$;
revoke execute on function public.staff_save_voucher(uuid, jsonb) from public, anon;
grant execute on function public.staff_save_voucher(uuid, jsonb) to authenticated;

create or replace function public.my_shop_vouchers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.voucher_json(v) order by v.created_at desc), '[]'::jsonb)
    from public.vouchers v where v.seller_id = (select auth.uid())
$$;
revoke execute on function public.my_shop_vouchers() from public, anon;
grant execute on function public.my_shop_vouchers() to authenticated;

create or replace function public.save_shop_voucher(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_id is null and (select count(*) from public.vouchers where seller_id = me and active) >= 20 then
    raise exception 'You can have up to 20 codes switched on.' using errcode = 'P0001';
  end if;
  if p_id is null and (p ->> 'kind') = 'percent' and (p ->> 'value')::int > 50 then
    raise exception 'Shop codes can take up to 50%% off.' using errcode = '22023';
  end if;
  perform public.save_voucher_row(p_id, me, p - 'first_order_only', me);
  return public.my_shop_vouchers();
end;
$$;
revoke execute on function public.save_shop_voucher(uuid, jsonb) from public, anon;
grant execute on function public.save_shop_voucher(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 7. Emails to non-members (service role only)
-- ------------------------------------------------------------
create or replace function public.email_outbox_claim(p_limit integer default 25)
returns table (id uuid, to_email text, subject text, body text, link text)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_outbox e set state = case when e.attempts >= 3 then 'failed' else 'pending' end
   where e.state = 'sending' and e.claimed_at < now() - interval '10 minutes';
  return query
  with c as (select x.id from public.email_outbox x where x.state = 'pending' order by x.created_at limit least(greatest(coalesce(p_limit, 25), 1), 100) for update skip locked),
       u as (update public.email_outbox e set state = 'sending', attempts = e.attempts + 1, claimed_at = now() from c where e.id = c.id returning e.*)
  select u.id, u.to_email, u.subject, u.body, u.link from u;
end;
$$;
revoke execute on function public.email_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.email_outbox_claim(integer) to service_role;

create or replace function public.email_outbox_done(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_outbox set state = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
         sent_at = case when p_ok then now() end, error = case when p_ok then null else left(p_error, 300) end
   where id = p_id
$$;
revoke execute on function public.email_outbox_done(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.email_outbox_done(uuid, boolean, text) to service_role;
