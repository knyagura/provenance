-- NuTuYu (formerly Provenance): migration 012 — favourites, order messages, offers, reviews,
-- the Item Passport, inbox counts and the first staff console.
-- Run AFTER 011. Safe to re-run. Its only DROP widens one check constraint (custody records may now come from staff).

-- ------------------------------------------------------------
-- 1. Staff
-- ------------------------------------------------------------
-- Staff are ordinary accounts listed here. Only another staff member (or the database owner) adds one.
create table if not exists public.staff_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now()
);
alter table public.staff_members enable row level security;
do $$ begin
  create policy "staff see their own record" on public.staff_members for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.staff_members from anon, authenticated;
grant select on public.staff_members to authenticated;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = (select auth.uid()))
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Everything staff change is written here, append-only.
create table if not exists public.staff_actions (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.profiles(id),
  action text not null,
  subject text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
alter table public.staff_actions enable row level security;
revoke all on public.staff_actions from anon, authenticated;
create or replace function public.staff_actions_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Staff records can never be changed or removed.' using errcode = '42501';
end;
$$;
revoke execute on function public.staff_actions_append_only() from public, anon, authenticated;
do $$ begin
  create trigger staff_actions_no_change before update or delete on public.staff_actions
    for each row execute procedure public.staff_actions_append_only();
exception when duplicate_object then null; end $$;

create or replace function public.staff_require()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke execute on function public.staff_require() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Favourites
-- ------------------------------------------------------------
create table if not exists public.favourites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists favourites_listing_idx on public.favourites (listing_id);
alter table public.favourites enable row level security;
do $$ begin
  create policy "members see their own favourites" on public.favourites for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members save live listings" on public.favourites for insert to authenticated
    with check (user_id = (select auth.uid())
                and exists (select 1 from public.listings l where l.id = listing_id and l.published));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "members remove their own favourites" on public.favourites for delete using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
grant select, insert, delete on public.favourites to authenticated;

-- ------------------------------------------------------------
-- 3. Messages on an order (buyer and seller)
-- ------------------------------------------------------------
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists order_messages_order_idx on public.order_messages (order_id, created_at);
alter table public.order_messages enable row level security;
do $$ begin
  create policy "an order's buyer and seller read its messages" on public.order_messages for select
    using (exists (select 1 from public.orders o where o.id = order_id and (select auth.uid()) in (o.buyer_id, o.seller_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "an order's buyer and seller write on paid orders" on public.order_messages for insert to authenticated
    with check (sender_id = (select auth.uid())
                and exists (select 1 from public.orders o where o.id = order_id and (select auth.uid()) in (o.buyer_id, o.seller_id)
                              and o.payment_status in ('paid', 'review')));
exception when duplicate_object then null; end $$;
grant select, insert on public.order_messages to authenticated;
-- Messages are part of the order's record: never edited or removed (no update or delete policy).
create or replace function public.order_messages_fixed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.body := btrim(new.body);
    return new;
  end if;
  raise exception 'Messages are kept with the order and can’t be changed.' using errcode = '42501';
end;
$$;
revoke execute on function public.order_messages_fixed() from public, anon, authenticated;
do $$ begin
  create trigger order_messages_fixed before insert or update or delete on public.order_messages
    for each row execute procedure public.order_messages_fixed();
exception when duplicate_object then null; end $$;

create table if not exists public.message_reads (
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (order_id, user_id)
);
alter table public.message_reads enable row level security;
do $$ begin
  create policy "members see their own read marks" on public.message_reads for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
grant select on public.message_reads to authenticated;

create or replace function public.mark_messages_read(p_order uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.message_reads (order_id, user_id, read_at)
  select o.id, (select auth.uid()), now() from public.orders o
   where o.id = p_order and (select auth.uid()) in (o.buyer_id, o.seller_id)
  on conflict (order_id, user_id) do update set read_at = excluded.read_at
$$;
revoke execute on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Offers
-- ------------------------------------------------------------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id),
  seller_id uuid not null references public.profiles(id),
  amount_pence integer not null check (amount_pence > 0),
  made_by text not null check (made_by in ('buyer', 'seller')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'countered', 'withdrawn', 'used')),
  counter_of uuid references public.offers(id),
  listing_revision integer,
  listing_price_pence integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz
);
alter table public.offers add column if not exists listing_price_pence integer;
create index if not exists offers_listing_idx on public.offers (listing_id, status);
create index if not exists offers_buyer_idx on public.offers (buyer_id, created_at desc);
create index if not exists offers_seller_idx on public.offers (seller_id, created_at desc);
alter table public.offers enable row level security;
do $$ begin
  create policy "buyer and seller see their offers" on public.offers for select
    using ((select auth.uid()) in (buyer_id, seller_id));
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.offers from anon, authenticated;
grant select on public.offers to authenticated;

alter table public.orders add column if not exists offer_id uuid references public.offers(id);

-- Offer rules (settings): at least this share of the price, and how long each step lasts.
create table if not exists public.offer_settings (
  id smallint primary key default 1 check (id = 1),
  min_pct integer not null default 40 check (min_pct between 1 and 100),
  reply_hours integer not null default 48 check (reply_hours between 1 and 336),
  checkout_hours integer not null default 24 check (checkout_hours between 1 and 168)
);
insert into public.offer_settings (id) values (1) on conflict (id) do nothing;
alter table public.offer_settings enable row level security;
do $$ begin
  create policy "anyone can read the offer rules" on public.offer_settings for select using (true);
exception when duplicate_object then null; end $$;
grant select on public.offer_settings to anon, authenticated;

create or replace function public.offer_json(o public.offers)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', o.id, 'listing_id', o.listing_id, 'amount_pence', o.amount_pence, 'made_by', o.made_by,
    'status', case when o.status = 'pending' and o.expires_at < now() then 'expired'
                   when o.status = 'accepted' and o.expires_at < now() then 'expired' else o.status end,
    'counter_of', o.counter_of, 'created_at', o.created_at, 'expires_at', o.expires_at,
    'role', case when (select auth.uid()) = o.buyer_id then 'buyer' else 'seller' end,
    'buyer', (select username from public.profiles where id = o.buyer_id),
    'seller', (select username from public.profiles where id = o.seller_id),
    'title', (select title from public.listings where id = o.listing_id),
    'price_pence', (select price_pence from public.listings where id = o.listing_id))
$$;
revoke execute on function public.offer_json(public.offers) from public, anon, authenticated;

create or replace function public.make_offer(p_listing uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  l public.listings%rowtype;
  cfg public.offer_settings%rowtype;
  o public.offers%rowtype;
begin
  if me is null then
    raise exception 'Sign in to make an offer.' using errcode = '42501';
  end if;
  select * into l from public.listings where id = p_listing;
  if not found or not l.published or l.status <> 'active' or exists (select 1 from public.profiles where id = l.seller_id and holiday_mode) then
    raise exception 'This item isn’t taking offers.' using errcode = 'P0001';
  end if;
  if l.seller_id = me then
    raise exception 'You can’t make an offer on your own listing.' using errcode = 'P0001';
  end if;
  select * into cfg from public.offer_settings where id = 1;
  if p_amount is null or p_amount >= l.price_pence then
    raise exception 'Offer less than the price, or just buy it.' using errcode = '22023';
  end if;
  if p_amount < ceil(l.price_pence * cfg.min_pct / 100.0) then
    raise exception 'Offers start at % of the price.', cfg.min_pct || '%' using errcode = '22023';
  end if;
  update public.offers set status = 'withdrawn', responded_at = now()
   where listing_id = p_listing and buyer_id = me and status = 'pending';
  insert into public.offers (listing_id, buyer_id, seller_id, amount_pence, made_by, listing_revision, listing_price_pence, expires_at)
  values (p_listing, me, l.seller_id, p_amount, 'buyer', l.revision, l.price_pence, now() + make_interval(hours => cfg.reply_hours))
  returning * into o;
  return public.offer_json(o);
end;
$$;
revoke execute on function public.make_offer(uuid, integer) from public, anon;
grant execute on function public.make_offer(uuid, integer) to authenticated;

-- Answer an offer made to you: accept, decline, or counter with another amount.
create or replace function public.respond_offer(p_offer uuid, p_action text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.offers%rowtype;
  l public.listings%rowtype;
  cfg public.offer_settings%rowtype;
  n public.offers%rowtype;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or me not in (o.buyer_id, o.seller_id) then
    raise exception 'Offer not found.' using errcode = 'P0002';
  end if;
  if p_action = 'withdraw' then
    if (o.made_by = 'buyer' and me <> o.buyer_id) or (o.made_by = 'seller' and me <> o.seller_id) or o.status <> 'pending' then
      raise exception 'Only a pending offer you made can be withdrawn.' using errcode = 'P0001';
    end if;
    update public.offers set status = 'withdrawn', responded_at = now() where id = o.id returning * into o;
    return public.offer_json(o);
  end if;
  if (o.made_by = 'buyer' and me <> o.seller_id) or (o.made_by = 'seller' and me <> o.buyer_id) then
    raise exception 'Wait for the other person to reply.' using errcode = 'P0001';
  end if;
  if o.status <> 'pending' or o.expires_at < now() then
    raise exception 'This offer has ended.' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = o.listing_id;
  select * into cfg from public.offer_settings where id = 1;
  if p_action = 'decline' then
    update public.offers set status = 'declined', responded_at = now() where id = o.id returning * into o;
    return public.offer_json(o);
  end if;
  if l.status <> 'active' or not l.published then
    raise exception 'This item is no longer for sale.' using errcode = 'P0001';
  end if;
  if p_action = 'accept' then
    update public.offers set status = 'accepted', responded_at = now(), expires_at = now() + make_interval(hours => cfg.checkout_hours)
     where id = o.id returning * into o;
    return public.offer_json(o);
  end if;
  if p_action = 'counter' then
    if p_amount is null or p_amount >= l.price_pence or p_amount < ceil(l.price_pence * cfg.min_pct / 100.0) then
      raise exception 'A counter offer must be under the price and at least % of it.', cfg.min_pct || '%' using errcode = '22023';
    end if;
    if p_amount = o.amount_pence then
      raise exception 'That’s the same amount: accept it instead.' using errcode = '22023';
    end if;
    update public.offers set status = 'countered', responded_at = now() where id = o.id;
    insert into public.offers (listing_id, buyer_id, seller_id, amount_pence, made_by, counter_of, listing_revision, listing_price_pence, expires_at)
    values (o.listing_id, o.buyer_id, o.seller_id, p_amount, case when me = o.seller_id then 'seller' else 'buyer' end, o.id, l.revision, l.price_pence,
            now() + make_interval(hours => cfg.reply_hours))
    returning * into n;
    return public.offer_json(n);
  end if;
  raise exception 'Choose accept, decline or counter.' using errcode = '22023';
end;
$$;
revoke execute on function public.respond_offer(uuid, text, integer) from public, anon;
grant execute on function public.respond_offer(uuid, text, integer) to authenticated;

create or replace function public.my_offers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.offer_json(o) order by o.created_at desc), '[]'::jsonb)
    from public.offers o
   where (select auth.uid()) in (o.buyer_id, o.seller_id) and o.created_at > now() - interval '60 days'
$$;
revoke execute on function public.my_offers() from public, anon;
grant execute on function public.my_offers() to authenticated;

-- The price for this listing as a quote, at an agreed offer amount instead of the listed price.
create or replace function public.offer_quote(p_listing uuid, p_amount integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l record;
  cfg record;
begin
  select li.shipping_pence, li.protection_payer into l from public.listings li where li.id = p_listing;
  select * into cfg from public.current_fee_settings();
  return public.compute_fees(cfg.settings, p_amount, l.shipping_pence, l.protection_payer, null, cfg.version);
end;
$$;
revoke execute on function public.offer_quote(uuid, integer) from public, anon, authenticated;

-- Checkout for an accepted offer: the same hold and fees as a normal checkout, at the agreed price.
create or replace function public.start_offer_checkout(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.offers%rowtype;
  l public.listings%rowtype;
  existing public.orders%rowtype;
  q jsonb;
  cfg record;
  oid uuid;
  hold timestamptz;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or me is distinct from o.buyer_id then
    raise exception 'Offer not found.' using errcode = 'P0002';
  end if;
  perform public.release_expired_checkouts();
  select * into existing from public.orders
   where offer_id = o.id and buyer_id = me and payment_status = 'awaiting_payment' and hold_expires_at > now() limit 1;
  if found then
    return jsonb_build_object('order_id', existing.id, 'quote', existing.fees, 'hold_expires_at', existing.hold_expires_at, 'revision', existing.listing_revision);
  end if;
  if o.status <> 'accepted' or o.expires_at < now() then
    raise exception 'This offer has ended. Make a new one from the item page.' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = o.listing_id for update;
  if l.revision is distinct from o.listing_revision or l.price_pence is distinct from o.listing_price_pence then
    raise exception 'LISTING_CHANGED: The seller changed this listing after the offer. Make a new offer from the item page.' using errcode = 'P0001';
  end if;
  if l.status = 'reserved' then
    raise exception 'Someone else is buying this right now. Try again in a few minutes.' using errcode = 'P0001';
  end if;
  if l.status <> 'active' or not l.published then
    raise exception 'This item is no longer for sale.' using errcode = 'P0001';
  end if;
  q := public.offer_quote(l.id, o.amount_pence);
  select * into cfg from public.current_fee_settings();
  hold := now() + make_interval(mins => coalesce((cfg.settings ->> 'checkout_hold_minutes')::int, 30));
  insert into public.orders (listing_id, buyer_id, seller_id, price_pence, fees, payment_status, total_pence, postage_pence,
                             fee_version, hold_expires_at, listing_revision, listing_snapshot, offer_id)
  values (l.id, me, me, o.amount_pence, q, 'awaiting_payment', (q ->> 'buyer_total_pence')::int,
          (q ->> 'postage_pence')::int, (q ->> 'fee_version')::int, hold, l.revision, public.listing_snapshot(l.id), o.id)
  returning id into oid;
  return jsonb_build_object('order_id', oid, 'quote', q, 'hold_expires_at', hold, 'revision', l.revision);
end;
$$;
revoke execute on function public.start_offer_checkout(uuid) from public, anon;
grant execute on function public.start_offer_checkout(uuid) to authenticated;

-- Order insert rules, now with offers: the platform may price an order at an accepted offer.
create or replace function public.validate_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings%rowtype;
  o public.offers%rowtype;
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
  if customer then
    new.offer_id := null;
  elsif new.offer_id is not null then
    select * into o from public.offers where id = new.offer_id;
    if not found or o.status <> 'accepted' or o.buyer_id <> new.buyer_id or o.listing_id <> l.id then
      raise exception 'That offer can’t be used.' using errcode = 'P0001';
    end if;
    new.price_pence := o.amount_pence;
  end if;
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

-- When an offer's order is paid, the offer is used; other open offers on the item end.
create or replace function public.orders_offer_paid()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    update public.offers set status = 'used', responded_at = now() where id = new.offer_id;
    update public.offers set status = 'declined', responded_at = now()
     where listing_id = new.listing_id and status in ('pending', 'accepted') and id is distinct from new.offer_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_offer_paid() from public, anon, authenticated;
do $$ begin
  create trigger orders_offer_paid after update of payment_status on public.orders
    for each row execute procedure public.orders_offer_paid();
exception when duplicate_object then null; end $$;

alter table public.orders add column if not exists dispute_resolution text;
alter table public.orders add column if not exists resolved_at timestamptz;
do $$ begin
  alter table public.orders add constraint orders_dispute_resolution_check check (dispute_resolution is null or dispute_resolution in ('release', 'refund'));
exception when duplicate_object then null; end $$;

-- Buyers and sellers can't set the new order fields either.
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
    new.custody_tier := old.custody_tier;
    new.custody_state := old.custody_state;
    new.custody_step := old.custody_step;
    new.custody_head := old.custody_head;
    new.custody_updated_at := old.custody_updated_at;
    new.weight_flag := old.weight_flag;
    new.dispute_reason := old.dispute_reason;
    new.disputed_at := old.disputed_at;
    new.confirmed_at := old.confirmed_at;
    new.payout_status := old.payout_status;
    new.offer_id := old.offer_id;
    new.dispute_resolution := old.dispute_resolution;
    new.resolved_at := old.resolved_at;
    if old.payment_status <> 'legacy' then
      new.status := old.status;
      new.timeline_state := old.timeline_state;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_order_fields() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Reviews
-- ------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  author_id uuid not null references public.profiles(id),
  subject_id uuid not null references public.profiles(id),
  author_role text not null check (author_role in ('buyer', 'seller')),
  rating integer not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 500),
  created_at timestamptz not null default now(),
  unique (order_id, author_id)
);
create index if not exists reviews_subject_idx on public.reviews (subject_id, created_at desc);
alter table public.reviews enable row level security;
do $$ begin
  create policy "reviews are public" on public.reviews for select using (true);
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;

create or replace function public.leave_review(p_order uuid, p_rating integer, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
  r public.reviews%rowtype;
begin
  select * into o from public.orders where id = p_order;
  if not found or me is null or me not in (o.buyer_id, o.seller_id) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if o.custody_state <> 'confirmed' then
    raise exception 'You can leave a review once the order is complete.' using errcode = 'P0001';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose 1 to 5 stars.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 500 then
    raise exception 'Keep the review under 500 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.reviews where order_id = o.id and author_id = me) then
    raise exception 'You’ve already reviewed this order.' using errcode = 'P0001';
  end if;
  insert into public.reviews (order_id, author_id, subject_id, author_role, rating, body)
  values (o.id, me, case when me = o.buyer_id then o.seller_id else o.buyer_id end,
          case when me = o.buyer_id then 'buyer' else 'seller' end, p_rating, nullif(btrim(coalesce(p_body, '')), ''))
  returning * into r;
  return jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at);
end;
$$;
revoke execute on function public.leave_review(uuid, integer, text) from public, anon;
grant execute on function public.leave_review(uuid, integer, text) to authenticated;

-- A member's rating and latest reviews, by username, for member pages and listings.
create or replace function public.member_reviews(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with m as (select id from public.profiles where lower(username) = lower(p_username))
  select jsonb_build_object(
    'count', (select count(*) from public.reviews r, m where r.subject_id = m.id),
    'average', (select round(avg(rating)::numeric, 1) from public.reviews r, m where r.subject_id = m.id),
    'latest', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object('rating', r.rating, 'body', r.body, 'created_at', r.created_at, 'author_role', r.author_role,
                                  'author', p.username) as x
          from public.reviews r join m on r.subject_id = m.id join public.profiles p on p.id = r.author_id
         order by r.created_at desc limit 10) t), '[]'::jsonb))
$$;
grant execute on function public.member_reviews(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 6. The Item Passport (public)
-- ------------------------------------------------------------
-- What anyone can see of an item's record. Shown: the listing's photos and details, its protection level,
-- each completed custody step with its date and who did it (as a role), whether each seal check matched,
-- authentication verdicts, and whether the record verifies. Never: names, codes, weights, videos, tracking.
create or replace function public.item_passport(p_listing uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.listings%rowtype;
  sales jsonb := '[]'::jsonb;
  o public.orders%rowtype;
  steps jsonb;
  r record;
  prev text;
  ok boolean;
begin
  select * into l from public.listings where id = p_listing;
  if not found or (not l.published and l.status <> 'sold') then
    return null;
  end if;
  for o in
    select * from public.orders
     where payment_status = 'paid'
       and (listing_id = l.id or (l.item_id is not null and listing_id in (select id from public.listings where item_id = l.item_id)))
     order by paid_at
  loop
    steps := '[]'::jsonb;
    prev := '0';
    ok := true;
    for r in select * from public.custody_events where order_id = o.id order by seq loop
      if r.prev_hash <> prev or r.hash <> public.custody_hash(r.prev_hash, r.order_id, r.seq, r.step, r.actor_role, r.actor_id, r.evidence, r.at) then
        ok := false;
      end if;
      prev := r.hash;
      if r.step <> 'dispute' then
        steps := steps || jsonb_strip_nulls(jsonb_build_object(
          'step', r.step, 'actor_role', r.actor_role, 'date', to_char(r.at at time zone 'UTC', 'YYYY-MM-DD'),
          'seal_match', case when r.evidence ? 'match' then (r.evidence -> 'match') end,
          'seal_kind', case when r.evidence ? 'match' then r.evidence -> 'seal_kind' end,
          'result', r.evidence -> 'result',
          'photo', case when r.evidence ->> 'media_kind' = 'photo' then true end));
      end if;
    end loop;
    if prev <> o.custody_head then
      ok := false;
    end if;
    sales := sales || jsonb_build_object(
      'sold', to_char(o.paid_at at time zone 'UTC', 'YYYY-MM'), 'tier', o.custody_tier,
      'state', case when o.custody_state = 'disputed' and o.dispute_resolution is null then 'on_hold'
                    when o.dispute_resolution = 'refund' then 'refunded' else o.custody_state end,
      'chain_ok', ok, 'steps', steps);
  end loop;
  return jsonb_build_object(
    'listing_id', l.id, 'item_id', l.item_id, 'title', l.title, 'brand', l.brand, 'category', l.category,
    'condition', l.condition_label, 'tier', l.tier, 'status', l.status, 'listed', to_char(l.created_at at time zone 'UTC', 'YYYY-MM'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'shot', m.shot) order by m.position)
                          from public.listing_media m where m.listing_id = l.id and m.kind = 'photo' and m.retired_at is null), '[]'::jsonb),
    'sales', sales);
end;
$$;
grant execute on function public.item_passport(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 7. What needs the signed-in member (the Inbox badge)
-- ------------------------------------------------------------
create or replace function public.inbox_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
  turns as (
    select count(*) as n from public.orders o, me
     where o.payment_status = 'paid' and o.custody_state = 'in_progress'
       and (public.custody_current(o) ->> 'actor') = any (public.custody_roles(o, me.id))
  ),
  unread as (
    select count(*) as n from public.order_messages m join public.orders o on o.id = m.order_id, me
     where me.id in (o.buyer_id, o.seller_id) and m.sender_id <> me.id
       and m.created_at > coalesce((select read_at from public.message_reads r where r.order_id = o.id and r.user_id = me.id), '-infinity')
  ),
  offers as (
    select count(*) as n from public.offers f, me
     where f.status = 'pending' and f.expires_at > now()
       and ((f.made_by = 'buyer' and f.seller_id = me.id) or (f.made_by = 'seller' and f.buyer_id = me.id))
  ),
  accepted as (
    select count(*) as n from public.offers f, me where f.status = 'accepted' and f.expires_at > now() and f.buyer_id = me.id
  )
  select jsonb_build_object('turns', (select n from turns), 'unread', (select n from unread),
                            'offers', (select n from offers) + (select n from accepted))
$$;
revoke execute on function public.inbox_counts() from public, anon;
grant execute on function public.inbox_counts() to authenticated;

-- Unread messages per order, for the inbox rows.
create or replace function public.unread_by_order()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(order_id, n), '{}'::jsonb) from (
    select m.order_id, count(*) as n
      from public.order_messages m join public.orders o on o.id = m.order_id
     where (select auth.uid()) in (o.buyer_id, o.seller_id) and m.sender_id <> (select auth.uid())
       and m.created_at > coalesce((select read_at from public.message_reads r where r.order_id = o.id and r.user_id = (select auth.uid())), '-infinity')
     group by m.order_id) t
$$;
revoke execute on function public.unread_by_order() from public, anon;
grant execute on function public.unread_by_order() to authenticated;

-- ------------------------------------------------------------
-- 8. Staff console
-- ------------------------------------------------------------
alter table public.custody_events drop constraint if exists custody_events_actor_role_check;
do $$ begin
  alter table public.custody_events add constraint custody_events_actor_role_check_v2
    check (actor_role in ('seller', 'buyer', 'courier', 'hub', 'hub2', 'system', 'staff'));
exception when duplicate_object then null; end $$;

-- Orders that need a person: disputes, payments held for checking, weights that didn't match.
create or replace function public.staff_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'title', coalesce(o.listing_snapshot ->> 'title', l.title),
      'kind', case when o.payment_status = 'review' then 'payment' when o.custody_state = 'disputed' then 'dispute' else 'weight' end,
      'reason', coalesce(o.dispute_reason, case when o.payment_status = 'review' then 'payment_review' else 'weight_flag' end),
      'buyer', b.username, 'seller', s.username, 'total_pence', o.total_pence, 'tier', o.custody_tier,
      'since', coalesce(o.disputed_at, o.custody_updated_at, o.created_at)) order by coalesce(o.disputed_at, o.custody_updated_at, o.created_at))
    from public.orders o join public.listings l on l.id = o.listing_id
    join public.profiles b on b.id = o.buyer_id join public.profiles s on s.id = o.seller_id
   where o.payment_status = 'review'
      or (o.custody_state = 'disputed' and o.dispute_resolution is null)
      or (o.weight_flag and o.custody_state = 'in_progress')), '[]'::jsonb);
end;
$$;
revoke execute on function public.staff_queue() from public, anon;
grant execute on function public.staff_queue() to authenticated;

-- Everything about one order, including what customers never see (codes, weights, tracking, messages).
create or replace function public.staff_order(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
begin
  perform public.staff_require();
  select * into o from public.orders where id = p_order;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'order_id', o.id, 'listing_id', o.listing_id, 'title', coalesce(o.listing_snapshot ->> 'title', 'Item'),
    'buyer', (select username from public.profiles where id = o.buyer_id),
    'seller', (select username from public.profiles where id = o.seller_id),
    'payment_status', o.payment_status, 'payment_ref', o.payment_ref, 'total_pence', o.total_pence, 'fees', o.fees,
    'tier', o.custody_tier, 'state', o.custody_state, 'step', o.custody_step, 'dispute_reason', o.dispute_reason,
    'dispute_resolution', o.dispute_resolution, 'payout_status', o.payout_status, 'weight_flag', o.weight_flag,
    'events', coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'step', e.step, 'actor_role', e.actor_role,
                         'actor', (select username from public.profiles where id = e.actor_id),
                         'at', to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'evidence', e.evidence, 'hash', e.hash) order by e.seq)
                       from public.custody_events e where e.order_id = o.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('from', (select username from public.profiles where id = m.sender_id),
                           'role', case when m.sender_id = o.buyer_id then 'buyer' else 'seller' end, 'body', m.body, 'at', m.created_at) order by m.created_at)
                         from public.order_messages m where m.order_id = o.id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'by', (select username from public.profiles where id = a.staff_id),
                          'detail', a.detail, 'at', a.at) order by a.at)
                        from public.staff_actions a where a.subject = o.id::text), '[]'::jsonb));
end;
$$;
revoke execute on function public.staff_order(uuid) from public, anon;
grant execute on function public.staff_order(uuid) to authenticated;

-- Settle a dispute: release the payment to the seller, or refund the buyer. Recorded in the custody chain.
create or replace function public.staff_resolve_dispute(p_order uuid, p_outcome text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  o public.orders%rowtype;
  h text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.custody_state <> 'disputed' or o.dispute_resolution is not null then
    raise exception 'This order isn’t waiting for a decision.' using errcode = 'P0001';
  end if;
  if p_outcome not in ('release', 'refund') then
    raise exception 'Choose release or refund.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 1000 then
    raise exception 'Write a short note saying why.' using errcode = '22023';
  end if;
  h := public.custody_append(o, 'staff_resolution', 'staff', me, jsonb_build_object('outcome', p_outcome, 'note', btrim(p_note)));
  update public.orders set custody_head = h, custody_updated_at = now(), dispute_resolution = p_outcome, resolved_at = now(),
         payout_status = case when p_outcome = 'release' then 'due' else 'refund' end,
         custody_state = case when p_outcome = 'release' then 'confirmed' else 'disputed' end,
         confirmed_at = case when p_outcome = 'release' then now() else confirmed_at end
   where id = o.id;
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'resolve_dispute', o.id::text, jsonb_build_object('outcome', p_outcome, 'note', btrim(p_note)));
  return public.staff_order(p_order);
end;
$$;
revoke execute on function public.staff_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.staff_resolve_dispute(uuid, text, text) to authenticated;

-- A payment held for checking: accept it (the order goes ahead) or mark it for a refund.
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
    if l.status = 'sold' or exists (select 1 from public.orders x where x.listing_id = l.id and x.id <> o.id and x.payment_status in ('paid', 'awaiting_payment')) then
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

-- Couriers and hubs.
create or replace function public.staff_agents()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'username', p.username, 'email', u.email,
            'role', a.role, 'organisation', a.organisation, 'active', a.active, 'since', a.created_at) order by a.created_at desc)
    from public.custody_agents a join public.profiles p on p.id = a.user_id left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end;
$$;
revoke execute on function public.staff_agents() from public, anon;
grant execute on function public.staff_agents() to authenticated;

create or replace function public.staff_set_agent(p_email text, p_role text, p_organisation text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No account uses that email. Ask them to sign up first.' using errcode = 'P0002';
  end if;
  if uid = me then
    raise exception 'Staff can’t make themselves a courier or hub.' using errcode = '42501';
  end if;
  if p_role not in ('courier', 'hub') then
    raise exception 'Choose courier or hub.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_organisation, ''))) not between 1 and 80 then
    raise exception 'Enter the company or hub name.' using errcode = '22023';
  end if;
  insert into public.custody_agents (user_id, role, organisation, active)
  values (uid, p_role, btrim(p_organisation), coalesce(p_active, true))
  on conflict (user_id) do update set role = excluded.role, organisation = excluded.organisation, active = excluded.active;
  insert into public.staff_actions (staff_id, action, subject, detail)
  values (me, 'set_agent', uid::text, jsonb_build_object('role', p_role, 'organisation', btrim(p_organisation), 'active', coalesce(p_active, true)));
  return public.staff_agents();
end;
$$;
revoke execute on function public.staff_set_agent(text, text, text, boolean) from public, anon;
grant execute on function public.staff_set_agent(text, text, text, boolean) to authenticated;

create or replace function public.staff_add_staff(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No account uses that email.' using errcode = 'P0002';
  end if;
  insert into public.staff_members (user_id, added_by) values (uid, me) on conflict (user_id) do nothing;
  insert into public.staff_actions (staff_id, action, subject) values (me, 'add_staff', uid::text);
end;
$$;
revoke execute on function public.staff_add_staff(text) from public, anon;
grant execute on function public.staff_add_staff(text) to authenticated;

-- Custody and offer settings.
create or replace function public.staff_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return jsonb_build_object(
    'custody', (select to_jsonb(c) - 'id' from public.custody_settings c where id = 1),
    'offers', (select to_jsonb(f) - 'id' from public.offer_settings f where id = 1),
    'fees', coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'effective_from', v.effective_from, 'note', v.note, 'settings', v.settings) order by v.version desc)
                      from public.fee_settings v), '[]'::jsonb),
    'current_fee_version', (select version from public.current_fee_settings()));
end;
$$;
revoke execute on function public.staff_settings() from public, anon;
grant execute on function public.staff_settings() to authenticated;

create or replace function public.staff_update_settings(p_custody jsonb, p_offers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
begin
  if p_custody is not null then
    update public.custody_settings set
      challenge_minutes = coalesce((p_custody ->> 'challenge_minutes')::int, challenge_minutes),
      confirm_window_hours = coalesce((p_custody ->> 'confirm_window_hours')::int, confirm_window_hours),
      enhanced_confirm_days = coalesce((p_custody ->> 'enhanced_confirm_days')::int, enhanced_confirm_days),
      weight_tolerance_grams = coalesce((p_custody ->> 'weight_tolerance_grams')::int, weight_tolerance_grams),
      weight_tolerance_pct = coalesce((p_custody ->> 'weight_tolerance_pct')::int, weight_tolerance_pct),
      updated_at = now()
     where id = 1;
  end if;
  if p_offers is not null then
    update public.offer_settings set
      min_pct = coalesce((p_offers ->> 'min_pct')::int, min_pct),
      reply_hours = coalesce((p_offers ->> 'reply_hours')::int, reply_hours),
      checkout_hours = coalesce((p_offers ->> 'checkout_hours')::int, checkout_hours)
     where id = 1;
  end if;
  insert into public.staff_actions (staff_id, action, detail) values (me, 'update_settings', jsonb_build_object('custody', p_custody, 'offers', p_offers));
  return public.staff_settings();
end;
$$;
revoke execute on function public.staff_update_settings(jsonb, jsonb) from public, anon;
grant execute on function public.staff_update_settings(jsonb, jsonb) to authenticated;

-- A new fee version, starting now or later. It must price a test basket, and the transaction fee
-- range must stay within 0–100%. Old versions are never edited.
create or replace function public.staff_add_fee_version(p_settings jsonb, p_note text, p_effective timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  v integer;
  test jsonb;
begin
  if p_settings is null or jsonb_typeof(p_settings -> 'tiers') <> 'array' or jsonb_array_length(p_settings -> 'tiers') <> 4 then
    raise exception 'A fee version needs all four tiers.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 300 then
    raise exception 'Write a short note on what changed.' using errcode = '22023';
  end if;
  if coalesce(p_effective, now()) < now() - interval '5 minutes' then
    raise exception 'A new version can’t start in the past.' using errcode = '22023';
  end if;
  begin
    test := public.compute_fees(p_settings, 4000, 399, 'buyer', null, 0);
  exception when others then
    raise exception 'Those settings can’t price an order: %', sqlerrm using errcode = '22023';
  end;
  if test is null or (test ->> 'buyer_total_pence')::int < 4000 then
    raise exception 'Those settings give a total below the item price.' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v from public.fee_settings;
  insert into public.fee_settings (version, effective_from, note, settings) values (v, coalesce(p_effective, now()), btrim(p_note), p_settings);
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'add_fee_version', v::text, jsonb_build_object('note', btrim(p_note)));
  return public.staff_settings();
end;
$$;
revoke execute on function public.staff_add_fee_version(jsonb, text, timestamptz) from public, anon;
grant execute on function public.staff_add_fee_version(jsonb, text, timestamptz) to authenticated;
