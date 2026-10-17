-- Provenance: migration 020 — seller tools: bundle discounts, sold history and a sales dashboard.
-- Bundle discount: a seller can take a percentage off when someone buys several of their items in one
-- basket checkout (for example 10% off 2 or more). It is applied on the server when the checkout is made,
-- so every order's price, fees and total (and the one payment) already include it.
-- Safe to re-run.

alter table public.profiles add column if not exists bundle_min_items smallint;
alter table public.profiles add column if not exists bundle_pct smallint;
do $$ begin
  alter table public.profiles add constraint profiles_bundle_check check (
    (bundle_min_items is null and bundle_pct is null)
    or (bundle_min_items between 2 and 10 and bundle_pct between 5 and 50));
exception when duplicate_object then null; end $$;

create or replace function public.set_bundle_discount(p_min integer, p_pct integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_min is null or p_pct is null or p_pct = 0 then
    update public.profiles set bundle_min_items = null, bundle_pct = null where id = me;
  elsif p_min not between 2 and 10 or p_pct not between 5 and 50 then
    raise exception 'Choose 2 to 10 items and 5%% to 50%% off.' using errcode = '22023';
  else
    update public.profiles set bundle_min_items = p_min, bundle_pct = p_pct where id = me;
  end if;
  return (select jsonb_build_object('min_items', bundle_min_items, 'pct', bundle_pct) from public.profiles where id = me);
end;
$$;
revoke execute on function public.set_bundle_discount(integer, integer) from public, anon;
grant execute on function public.set_bundle_discount(integer, integer) to authenticated;

-- Anyone can see a seller's bundle offer (it's shown on their items).
create or replace function public.bundle_offer(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when bundle_pct is null then null else jsonb_build_object('min_items', bundle_min_items, 'pct', bundle_pct) end
    from public.profiles where lower(username) = lower(p_username)
$$;
revoke execute on function public.bundle_offer(text) from public;
grant execute on function public.bundle_offer(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 1. Applying it at basket checkout
-- ------------------------------------------------------------
create or replace function public.apply_bundle_discounts(p_group uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  o public.orders;
  q jsonb;
  newp integer;
  n integer := 0;
begin
  for s in
    select o2.seller_id, p.bundle_min_items, p.bundle_pct, count(*) as items
      from public.orders o2 join public.profiles p on p.id = o2.seller_id
     where o2.group_id = p_group and o2.payment_status = 'awaiting_payment' and o2.offer_id is null and p.bundle_pct is not null
     group by o2.seller_id, p.bundle_min_items, p.bundle_pct
    having count(*) >= p.bundle_min_items
  loop
    for o in select * from public.orders where group_id = p_group and seller_id = s.seller_id and payment_status = 'awaiting_payment' and offer_id is null
                and not (fees ? 'bundle_pct') loop
      newp := greatest(round(o.price_pence * (100 - s.bundle_pct) / 100.0)::integer, 1);
      q := public.compute_fees((select settings from public.fee_settings where version = o.fee_version), newp, o.postage_pence, o.protection_payer, null, o.fee_version)
           || jsonb_build_object('bundle_pct', s.bundle_pct, 'bundle_items', s.items, 'bundle_discount_pence', o.price_pence - newp, 'list_price_pence', o.price_pence);
      update public.orders set price_pence = newp, fees = q, total_pence = (q ->> 'buyer_total_pence')::integer where id = o.id;
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke execute on function public.apply_bundle_discounts(uuid) from public, anon, authenticated;

-- start_basket_checkout (013) finishes by writing the group's total: apply bundles then, and total again.
create or replace function public.checkout_groups_bundles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.total_pence = 0 and new.total_pence > 0 and new.payment_status = 'awaiting_payment' then
    if public.apply_bundle_discounts(new.id) > 0 then
      new.total_pence := coalesce((select sum(total_pence) from public.orders where group_id = new.id and payment_status = 'awaiting_payment'), 0)
                         + coalesce(new.wrap_total_pence, 0);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.checkout_groups_bundles() from public, anon, authenticated;
do $$ begin
  create trigger checkout_groups_bundles before update on public.checkout_groups for each row execute procedure public.checkout_groups_bundles();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 2. Sold history and the sales dashboard
-- ------------------------------------------------------------
create or replace function public.seller_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as uid),
       sold as (
         select o.*, coalesce((o.fees ->> 'seller_payout_pence')::integer, o.price_pence) as payout
           from public.orders o, me where o.seller_id = me.uid and o.payment_status in ('paid', 'legacy'))
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'sold', (select count(*) from sold),
      'gross_pence', (select coalesce(sum(price_pence), 0) from sold),
      'payout_pence', (select coalesce(sum(payout), 0) from sold where payout_status <> 'refund'),
      'held_pence', (select coalesce(sum(payout), 0) from sold where payout_status = 'held'),
      'released_pence', (select coalesce(sum(payout), 0) from sold where payout_status in ('due', 'paid')),
      'refunded', (select count(*) from sold where payout_status = 'refund'),
      'disputed', (select count(*) from sold where disputed_at is not null),
      'avg_handover_hours', (select round(avg(extract(epoch from (confirmed_at - paid_at)) / 3600)::numeric, 1) from sold where confirmed_at is not null and paid_at is not null),
      'live_listings', (select count(*) from public.listings l, me where l.seller_id = me.uid and l.published and l.status = 'active'),
      'bundles', (select count(*) from sold where fees ? 'bundle_pct')),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'sold', c, 'gross_pence', g) order by m)
        from (select to_char(date_trunc('month', s.paid_at), 'YYYY-MM') as m, count(*) as c, sum(s.price_pence) as g
                from sold s where s.paid_at > date_trunc('month', now()) - interval '11 months' group by 1) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r ->> 'paid_at' desc) from (
        select jsonb_build_object('order_id', s.id, 'listing_id', s.listing_id,
                 'title', coalesce(s.listing_snapshot ->> 'title', (select title from public.listings where id = s.listing_id)),
                 'price_pence', s.price_pence, 'payout_pence', s.payout, 'paid_at', s.paid_at,
                 'buyer', (select username from public.profiles where id = s.buyer_id),
                 'state', s.custody_state, 'payout_status', s.payout_status, 'bundle', s.fees ? 'bundle_pct') as r
          from sold s order by s.paid_at desc nulls last limit 100) y), '[]'::jsonb),
    'bundle', (select case when bundle_pct is null then null else jsonb_build_object('min_items', bundle_min_items, 'pct', bundle_pct) end
                 from public.profiles, me where id = me.uid))
$$;
revoke execute on function public.seller_dashboard() from public, anon;
grant execute on function public.seller_dashboard() to authenticated;
