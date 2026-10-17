-- 026: Trust badges and the public handover tracker.
-- Everything here is counted from orders and their custody records. No personal details are exposed: a seller's figures
-- are totals, and the tracker lists items (as their public passports do), never buyers or sellers.

-- Finished orders: the buyer confirmed (or it confirmed itself), or a dispute was raised. Every order that had a dispute
-- counts as disputed, whatever the outcome.
create or replace function public.seller_trust(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select id, kyc_verified from public.profiles where lower(username) = lower(btrim(p_username))
  ), o as (
    select o.custody_state, o.disputed_at, o.dispute_resolution, o.paid_at, o.confirmed_at
      from public.orders o join p on p.id = o.seller_id
     where o.payment_status = 'paid' and o.custody_state in ('confirmed', 'disputed')
  ), t as (
    select count(*) filter (where custody_state = 'confirmed' and disputed_at is null)::int as completed,
           count(*)::int as finished,
           count(*) filter (where disputed_at is not null)::int as disputes,
           round(avg(extract(epoch from (confirmed_at - paid_at)) / 3600) filter (where custody_state = 'confirmed' and confirmed_at is not null and paid_at is not null))::int as avg_hours
      from o
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'verified', (select kyc_verified from p),
    'completed', t.completed,
    'finished', t.finished,
    'disputes', t.disputes,
    -- Shown once there are 5 finished orders; before that one dispute would say too much.
    'dispute_rate', case when t.finished >= 5 then round(100.0 * t.disputes / t.finished, 1) end,
    'avg_handover_hours', case when t.completed >= 3 then t.avg_hours end,
    'trusted', (select kyc_verified from p) and t.completed >= 5 and t.disputes * 20 <= t.finished
  ) end
  from t
$$;
revoke execute on function public.seller_trust(text) from public;
grant execute on function public.seller_trust(text) to anon, authenticated;

create or replace function public.trust_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with o as (
    -- A completed handover: confirmed and not refunded (a dispute released to the seller still completed).
    select o.id, o.listing_id, o.custody_tier, o.custody_state, o.disputed_at, o.dispute_resolution, o.paid_at, o.confirmed_at,
           o.custody_state = 'confirmed' and o.dispute_resolution is distinct from 'refund' as done
      from public.orders o
     where o.payment_status = 'paid' and o.custody_state in ('confirmed', 'disputed')
  )
  select jsonb_build_object(
    'completed', (select count(*) from o where done)::int,
    'completed_30d', (select count(*) from o where done and confirmed_at > now() - interval '30 days')::int,
    'finished', (select count(*) from o)::int,
    'disputes', (select count(*) from o where disputed_at is not null)::int,
    'refunds', (select count(*) from o where dispute_resolution = 'refund')::int,
    'avg_handover_hours', (select round(avg(extract(epoch from (confirmed_at - paid_at)) / 3600))::int from o where done and confirmed_at is not null and paid_at is not null),
    'by_tier', (select coalesce(jsonb_object_agg(custody_tier, n), '{}'::jsonb)
                  from (select custody_tier, count(*)::int n from o where done group by custody_tier) x),
    'recent', (select coalesce(jsonb_agg(r order by r ->> 'confirmed_on' desc), '[]'::jsonb) from (
                  select jsonb_build_object('listing_id', o.listing_id, 'title', l.title, 'tier', o.custody_tier, 'confirmed_on', to_char(o.confirmed_at, 'YYYY-MM-DD')) r
                    from o join public.listings l on l.id = o.listing_id
                   where o.done and o.confirmed_at is not null
                   order by o.confirmed_at desc limit 8) y)
  )
$$;
revoke execute on function public.trust_stats() from public;
grant execute on function public.trust_stats() to anon, authenticated;

create index if not exists orders_seller_finished_idx on public.orders (seller_id) where payment_status = 'paid' and custody_state in ('confirmed', 'disputed');
create index if not exists orders_confirmed_at_idx on public.orders (confirmed_at desc) where custody_state = 'confirmed';
