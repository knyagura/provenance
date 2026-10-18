-- 035: Account plans (Standard, Premium, Premium+) and boosted listings.
--
-- Plans: prices and perks are settings staff can change (Staff console → Settings → Plans). Standard and Premium are
-- free for now; Premium+ is £17.50 a month (agreed 11 Oct 2026). Paid plans are Stripe subscriptions: the subscribe
-- Edge Function opens Stripe Checkout, Stripe's webhook keeps the subscription here up to date, and members manage or
-- cancel in Stripe's billing portal. Perks: API access level, a plan badge, and fee-free orders and boost credits per
-- month (both 0 until modelled, as decided).
--
-- Boosts: a seller can boost a live listing priced at £25 or more. They pay an advertising fee only if it sells (the
-- fee settings' boost rate, 3–8%, plus 80p; a share can come off the buyer's charges, 0% for now). Boosted
-- listings come first in browse and search (newest order) and say "Boosted".

-- ------------------------------------------------------------
-- 1. Plans
-- ------------------------------------------------------------
create table if not exists public.plans (
  key text primary key check (key in ('standard', 'premium', 'premium_plus')),
  name text not null check (char_length(name) between 1 and 40),
  price_pence integer not null check (price_pence between 0 and 100000),
  perks jsonb not null default '{}'::jsonb check (jsonb_typeof(perks) = 'object'),
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;

insert into public.plans (key, name, price_pence, perks, sort) values
  ('standard', 'Standard', 0, '{"api": "none", "badge": false, "fee_free_orders": 0, "boost_credits": 0, "blurb": "Buy and sell with full buyer protection."}', 1),
  ('premium', 'Premium', 0, '{"api": "core", "badge": true, "fee_free_orders": 0, "boost_credits": 0, "blurb": "For regular sellers: the core seller API and a Premium badge."}', 2),
  ('premium_plus', 'Premium+', 1750, '{"api": "full", "badge": true, "fee_free_orders": 0, "boost_credits": 0, "blurb": "Everything in Premium, the full API set, and new perks first."}', 3)
on conflict (key) do nothing;

create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan_key text not null references public.plans(key),
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;

-- The plan a member is on now: a paid plan while active (or within its period after a failed payment), else Standard.
create or replace function public.plan_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.plan_key from public.subscriptions s
                    where s.user_id = p_user
                      and (s.status = 'active' or (s.status = 'past_due' and coalesce(s.current_period_end, now()) > now() - interval '7 days'))), 'standard')
$$;
revoke execute on function public.plan_of(uuid) from public, anon;
grant execute on function public.plan_of(uuid) to authenticated;

create or replace function public.plans_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'price_pence', price_pence, 'perks', perks) order by sort), '[]'::jsonb)
    from public.plans where active
$$;
revoke execute on function public.plans_list() from public;
grant execute on function public.plans_list() to anon, authenticated;

create or replace function public.my_plan()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plan', public.plan_of(auth.uid()),
    'subscription', (select jsonb_build_object('plan', s.plan_key, 'status', s.status, 'paid', s.stripe_subscription_id is not null,
                       'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end)
                       from public.subscriptions s where s.user_id = auth.uid()))
$$;
revoke execute on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- Free plans switch straight away. Leaving a paid plan goes through Stripe's portal (so billing stops properly).
create or replace function public.choose_free_plan(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.plans;
  s public.subscriptions;
begin
  select * into p from public.plans where key = p_key and active;
  if me is null or not found then
    raise exception 'Choose a plan.' using errcode = '22023';
  end if;
  if p.price_pence > 0 then
    raise exception 'That plan is paid: continue to payment.' using errcode = '22023';
  end if;
  select * into s from public.subscriptions where user_id = me;
  if s.stripe_subscription_id is not null and s.status in ('active', 'past_due') and not s.cancel_at_period_end then
    raise exception 'Cancel your paid plan first, in Manage billing. You keep it until the end of the period you’ve paid for.' using errcode = '55000';
  end if;
  insert into public.subscriptions (user_id, plan_key, status) values (me, p_key, 'active')
  on conflict (user_id) do update set plan_key = p_key, status = 'active', stripe_subscription_id = null, current_period_end = null,
                                      cancel_at_period_end = false, updated_at = now();
  return public.my_plan();
end;
$$;
revoke execute on function public.choose_free_plan(text) from public, anon;
grant execute on function public.choose_free_plan(text) to authenticated;

-- A plan badge for member pages (only plans with a badge).
create or replace function public.member_plan(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when (p.perks ->> 'badge')::boolean then jsonb_build_object('key', p.key, 'name', p.name) end
    from public.profiles pr join public.plans p on p.key = public.plan_of(pr.id)
   where lower(pr.username) = lower(btrim(p_username)) and pr.deleted_at is null
$$;
revoke execute on function public.member_plan(text) from public;
grant execute on function public.member_plan(text) to anon, authenticated;

-- For the subscribe Edge Function (service role).
create or replace function public.subscription_context(p_user uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plan', (select jsonb_build_object('key', key, 'name', name, 'price_pence', price_pence) from public.plans where key = p_key and active),
    'customer', (select stripe_customer_id from public.subscriptions where user_id = p_user),
    'paid_active', exists (select 1 from public.subscriptions where user_id = p_user and stripe_subscription_id is not null and status in ('active', 'past_due')))
$$;
revoke execute on function public.subscription_context(uuid, text) from public, anon, authenticated;
grant execute on function public.subscription_context(uuid, text) to service_role;

-- Stripe's word on a subscription (checkout completed, or customer.subscription.updated / deleted).
create or replace function public.subscription_synced(p_user uuid, p_key text, p_customer text, p_subscription text, p_status text,
                                                      p_period_end timestamptz, p_cancel_at_end boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  st text := case when p_status in ('active', 'trialing') then 'active' when p_status in ('past_due', 'unpaid') then 'past_due'
                  when p_status in ('canceled', 'incomplete_expired') then 'canceled' else 'incomplete' end;
  uid uuid := p_user;
begin
  if uid is null then
    select user_id into uid from public.subscriptions where stripe_subscription_id = p_subscription;
  end if;
  if uid is null or not exists (select 1 from public.plans where key = coalesce(p_key, 'premium_plus')) then
    return;
  end if;
  insert into public.subscriptions (user_id, plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end)
  values (uid, coalesce(p_key, 'premium_plus'), st, p_customer, p_subscription, p_period_end, coalesce(p_cancel_at_end, false))
  on conflict (user_id) do update set
    plan_key = coalesce(p_key, subscriptions.plan_key), status = st, stripe_customer_id = coalesce(p_customer, subscriptions.stripe_customer_id),
    stripe_subscription_id = p_subscription, current_period_end = p_period_end, cancel_at_period_end = coalesce(p_cancel_at_end, false), updated_at = now();
end;
$$;
revoke execute on function public.subscription_synced(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.subscription_synced(uuid, text, text, text, text, timestamptz, boolean) to service_role;

create or replace function public.staff_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return (select coalesce(jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'price_pence', p.price_pence, 'perks', p.perks, 'active', p.active,
            'members', (select count(*) from public.subscriptions s where s.plan_key = p.key and s.status in ('active', 'past_due'))) order by p.sort), '[]'::jsonb)
            from public.plans p);
end;
$$;
revoke execute on function public.staff_plans() from public, anon;
grant execute on function public.staff_plans() to authenticated;

create or replace function public.staff_save_plan(p_key text, p_price integer, p_perks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
begin
  if p_key = 'standard' and p_price <> 0 then
    raise exception 'Standard is always free.' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 or p_price > 100000 then
    raise exception 'Price must be between £0 and £1,000.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_perks) <> 'object' or coalesce(p_perks ->> 'api', 'none') not in ('none', 'core', 'full')
     or coalesce((p_perks ->> 'fee_free_orders')::int, 0) not between 0 and 100 or coalesce((p_perks ->> 'boost_credits')::int, 0) not between 0 and 100 then
    raise exception 'Check the perks: API none, core or full; up to 100 fee-free orders and boosts a month.' using errcode = '22023';
  end if;
  update public.plans set price_pence = p_price, perks = perks || p_perks, updated_at = now() where key = p_key;
  if not found then
    raise exception 'Plan not found.' using errcode = 'P0002';
  end if;
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'plan_saved', p_key, jsonb_build_object('price_pence', p_price, 'perks', p_perks));
  return public.staff_plans();
end;
$$;
revoke execute on function public.staff_save_plan(text, integer, jsonb) from public, anon;
grant execute on function public.staff_save_plan(text, integer, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 2. Boosts
-- ------------------------------------------------------------
alter table public.listings add column if not exists boost_bp smallint;
alter table public.listings add column if not exists boosted_at timestamptz;
do $$ begin
  alter table public.listings add constraint listings_boost_check check (boost_bp is null or boost_bp between 100 and 2000);
exception when duplicate_object then null; end $$;
alter table public.listings add column if not exists boosted boolean generated always as (boost_bp is not null) stored;
create index if not exists listings_boosted_idx on public.listings (boosted, created_at desc) where published;

-- Members can't set it directly (set_boost checks the price and the allowed rates).
create or replace function public.protect_boost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.boost_bp := null; new.boosted_at := null;
    else
      new.boost_bp := old.boost_bp; new.boosted_at := old.boosted_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_boost() from public, anon, authenticated;
do $$ begin
  create trigger listings_protect_boost before insert or update on public.listings for each row execute function public.protect_boost();
exception when duplicate_object then null; end $$;

create or replace function public.boost_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('on', coalesce((s.settings ->> 'boost_on')::boolean, false),
    'min_price_pence', (s.settings ->> 'boost_min_price_pence')::int, 'min_bp', (s.settings ->> 'boost_min_bp')::int,
    'max_bp', (s.settings ->> 'boost_max_bp')::int, 'fixed_pence', (s.settings ->> 'boost_fixed_pence')::int)
    from public.current_fee_settings() s
$$;
revoke execute on function public.boost_rules() from public;
grant execute on function public.boost_rules() to anon, authenticated;

create or replace function public.set_boost(p_listing uuid, p_bp integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.listings;
  r jsonb := public.boost_rules();
begin
  select * into l from public.listings where id = p_listing for update;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found.' using errcode = 'P0002';
  end if;
  if p_bp is null then
    update public.listings set boost_bp = null, boosted_at = null where id = l.id;
    return jsonb_build_object('boost_bp', null);
  end if;
  if not (r ->> 'on')::boolean then
    raise exception 'Boosts are switched off at the moment.' using errcode = '55000';
  end if;
  if not l.published or l.status <> 'active' then
    raise exception 'Only live listings can be boosted.' using errcode = '55000';
  end if;
  if l.price_pence < (r ->> 'min_price_pence')::int then
    raise exception 'Boosts are for items priced at % or more.', public.notify_pounds((r ->> 'min_price_pence')::int) using errcode = '22023';
  end if;
  if p_bp not between (r ->> 'min_bp')::int and (r ->> 'max_bp')::int then
    raise exception '%', 'Choose a boost between ' || ((r ->> 'min_bp')::int / 100) || '% and ' || ((r ->> 'max_bp')::int / 100) || '%.' using errcode = '22023';
  end if;
  update public.listings set boost_bp = p_bp, boosted_at = coalesce(boosted_at, now()) where id = l.id;
  return jsonb_build_object('boost_bp', p_bp);
end;
$$;
revoke execute on function public.set_boost(uuid, integer) from public, anon;
grant execute on function public.set_boost(uuid, integer) to authenticated;

-- A boost ends when the item sells or comes off sale.
create or replace function public.listings_end_boost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.boost_bp is not null and (new.status <> 'active' or not new.published) then
    new.boost_bp := null;
    new.boosted_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.listings_end_boost() from public, anon, authenticated;
do $$ begin
  -- Named to run after listings_protect_boost (triggers run in name order), so a member taking it off sale also ends the boost.
  create trigger listings_zz_end_boost before update of status, published on public.listings for each row execute function public.listings_end_boost();
exception when duplicate_object then null; end $$;

-- Quotes now include the listing's boost (the advertising fee the seller pays, and the buyer's promotion).
create or replace function public.order_quote(p_listing uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  l record;
  cfg record;
begin
  select li.price_pence, li.shipping_pence, li.protection_payer, li.status, li.published, li.boost_bp, p.holiday_mode
    into l
    from public.listings li join public.profiles p on p.id = li.seller_id
   where li.id = p_listing;
  if not found or not l.published or l.status <> 'active' or l.holiday_mode then
    return null;
  end if;
  select * into cfg from public.current_fee_settings();
  return public.compute_fees(cfg.settings, l.price_pence, l.shipping_pence, l.protection_payer, l.boost_bp, cfg.version);
end;
$$;
grant execute on function public.order_quote(uuid) to anon, authenticated;

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
  select li.shipping_pence, li.protection_payer, li.boost_bp into l from public.listings li where li.id = p_listing;
  select * into cfg from public.current_fee_settings();
  return public.compute_fees(cfg.settings, p_amount, l.shipping_pence, l.protection_payer, l.boost_bp, cfg.version);
end;
$$;
revoke execute on function public.offer_quote(uuid, integer) from public, anon, authenticated;
