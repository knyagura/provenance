-- 027: Staff reports. Sales, fees, disputes and handover times for a date range, plus 12 months by month.
-- Staff only. Totals, never people: no buyer or seller names leave this function.

create or replace function public.staff_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t0 timestamptz;
  t1 timestamptz;
  r jsonb;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'Choose a date range of up to two years.' using errcode = '22023';
  end if;
  -- Whole days, UK time.
  t0 := (p_from::timestamp at time zone 'Europe/London');
  t1 := ((p_to + 1)::timestamp at time zone 'Europe/London');

  with paid as (
    select o.*, coalesce(nullif(o.fees ->> 'payer', ''), 'buyer') as payer
      from public.orders o
     where o.payment_status = 'paid' and o.paid_at >= t0 and o.paid_at < t1
  ), f as (
    select count(*)::int as orders,
           count(distinct seller_id)::int as sellers,
           count(distinct buyer_id)::int as buyers,
           coalesce(sum(price_pence), 0)::bigint as gmv,
           coalesce(sum(total_pence), 0)::bigint as buyer_paid,
           coalesce(sum((fees ->> 'postage_pence')::int), 0)::bigint as postage,
           coalesce(sum((fees ->> 'protection_pence')::int), 0)::bigint as transaction_fees,
           coalesce(sum((fees ->> 'processing_pence')::int), 0)::bigint as processing,
           coalesce(sum((fees ->> 'commission_pence')::int), 0)::bigint as commission,
           coalesce(sum((fees ->> 'courier_pence')::int), 0)::bigint as courier,
           coalesce(sum((fees ->> 'hub_pence')::int), 0)::bigint as hub,
           coalesce(sum((fees ->> 'promotion_pence')::int), 0)::bigint as promotion,
           coalesce(sum((fees ->> 'seller_payout_pence')::int), 0)::bigint as payouts
      from paid
  ), v as (
    -- NuTuYu-funded voucher codes (a seller's own shop codes come off their price instead).
    select coalesce(sum(u.discount_pence), 0)::bigint as nutuyu_vouchers
      from public.voucher_uses u join public.vouchers vo on vo.id = u.voucher_id join paid on paid.id = u.order_id
     where u.state = 'used' and vo.seller_id is null
  ), hand as (
    select o.custody_tier, extract(epoch from (o.confirmed_at - o.paid_at)) / 3600 as h
      from public.orders o
     where o.custody_state = 'confirmed' and o.dispute_resolution is distinct from 'refund'
       and o.confirmed_at >= t0 and o.confirmed_at < t1 and o.paid_at is not null
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales', (select jsonb_build_object('orders', orders, 'sellers', sellers, 'buyers', buyers, 'gmv_pence', gmv, 'buyer_paid_pence', buyer_paid,
              'postage_pence', postage, 'average_order_pence', case when orders > 0 then round(gmv::numeric / orders) end, 'seller_payouts_pence', payouts) from f),
    'fees', (select jsonb_build_object('transaction_pence', transaction_fees, 'processing_pence', processing, 'commission_pence', commission,
              'courier_pence', courier, 'hub_pence', hub, 'promotion_pence', promotion, 'nutuyu_vouchers_pence', v.nutuyu_vouchers,
              -- What NuTuYu keeps: fees and commission, less promotions it covered and its own voucher codes.
              -- Courier and hub charges pass through to partners, so they're shown but not counted.
              'net_pence', transaction_fees + processing + commission - promotion - v.nutuyu_vouchers) from f, v),
    'by_tier', (select coalesce(jsonb_object_agg(k, jsonb_build_object('orders', n, 'gmv_pence', g)), '{}'::jsonb)
                  from (select coalesce(custody_tier, 'enhanced') k, count(*)::int n, sum(price_pence)::bigint g from paid group by 1) x),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', k, 'orders', n, 'gmv_pence', g) order by g desc), '[]'::jsonb)
                  from (select coalesce(l.category, 'other') k, count(*)::int n, sum(paid.price_pence)::bigint g
                          from paid join public.listings l on l.id = paid.listing_id group by 1 order by 3 desc limit 10) x),
    'disputes', jsonb_build_object(
      'opened', (select count(*) from public.orders where disputed_at >= t0 and disputed_at < t1)::int,
      'rate_pct', (select case when f.orders > 0 then round(100.0 * (select count(*) from paid where disputed_at is not null) / f.orders, 1) end from f),
      'by_reason', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
                      select coalesce(dispute_reason, 'other') k, count(*)::int n from public.orders
                       where disputed_at >= t0 and disputed_at < t1 group by 1) x),
      'released', (select count(*) from public.orders where resolved_at >= t0 and resolved_at < t1 and dispute_resolution = 'release')::int,
      'refunded', (select count(*) from public.orders where resolved_at >= t0 and resolved_at < t1 and dispute_resolution = 'refund')::int,
      'open_now', (select count(*) from public.orders where custody_state = 'disputed' and dispute_resolution is null)::int,
      'avg_hours_to_decide', (select round(avg(extract(epoch from (resolved_at - disputed_at)) / 3600))::int from public.orders
                               where resolved_at >= t0 and resolved_at < t1 and disputed_at is not null)
    ),
    'handover', jsonb_build_object(
      'completed', (select count(*) from hand)::int,
      'avg_hours', (select round(avg(h))::int from hand),
      'median_hours', (select round((percentile_cont(0.5) within group (order by h))::numeric)::int from hand),
      'by_tier', (select coalesce(jsonb_object_agg(k, jsonb_build_object('completed', n, 'avg_hours', a)), '{}'::jsonb)
                    from (select coalesce(custody_tier, 'enhanced') k, count(*)::int n, round(avg(h))::int a from hand group by 1) x)
    ),
    'labels', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
                 select carrier || case when mode = 'test' then ' (test)' else '' end k, count(*)::int n
                   from public.shipping_labels where status = 'active' and created_at >= t0 and created_at < t1 group by 1) x),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'orders', coalesce(s.n, 0), 'gmv_pence', coalesce(s.g, 0),
                 'net_fees_pence', coalesce(s.fee, 0), 'disputes', coalesce(d.n, 0)) order by m), '[]'::jsonb)
                 from generate_series(date_trunc('month', now() at time zone 'Europe/London') - interval '11 months',
                                      date_trunc('month', now() at time zone 'Europe/London'), interval '1 month') m
                 left join (select date_trunc('month', paid_at at time zone 'Europe/London') k, count(*)::int n, sum(price_pence)::bigint g,
                                   sum(coalesce((fees ->> 'protection_pence')::int, 0) + coalesce((fees ->> 'processing_pence')::int, 0)
                                       + coalesce((fees ->> 'commission_pence')::int, 0) - coalesce((fees ->> 'promotion_pence')::int, 0))::bigint fee
                              from public.orders where payment_status = 'paid' and paid_at > now() - interval '13 months' group by 1) s on s.k = m
                 left join (select date_trunc('month', disputed_at at time zone 'Europe/London') k, count(*)::int n
                              from public.orders where disputed_at > now() - interval '13 months' group by 1) d on d.k = m)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.staff_report(date, date) from public, anon;
grant execute on function public.staff_report(date, date) to authenticated;

create index if not exists orders_paid_at_idx on public.orders (paid_at) where payment_status = 'paid';
create index if not exists orders_disputed_at_idx on public.orders (disputed_at) where disputed_at is not null;
create index if not exists orders_resolved_at_idx on public.orders (resolved_at) where resolved_at is not null;
