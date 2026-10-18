-- 036: The owner's dashboard (Staff console → Dashboard): this week against last week, 30 days day by day, and what
-- needs attention now. Staff only; totals, plus the top sellers by name (staff can see members anyway).

create or replace function public.staff_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w0 timestamptz := now() - interval '7 days';
  w1 timestamptz := now() - interval '14 days';
  m0 timestamptz := now() - interval '30 days';
begin
  perform public.staff_require();
  return jsonb_build_object(
    'week', (select jsonb_build_object(
        'orders', count(*) filter (where paid_at >= w0), 'orders_prev', count(*) filter (where paid_at >= w1 and paid_at < w0),
        'gmv_pence', coalesce(sum(price_pence) filter (where paid_at >= w0), 0), 'gmv_prev_pence', coalesce(sum(price_pence) filter (where paid_at >= w1 and paid_at < w0), 0),
        'net_fees_pence', coalesce(sum(public.order_net_fees(fees)) filter (where paid_at >= w0), 0),
        'net_fees_prev_pence', coalesce(sum(public.order_net_fees(fees)) filter (where paid_at >= w1 and paid_at < w0), 0))
      from public.orders where payment_status = 'paid' and paid_at >= w1),
    'members', jsonb_build_object(
        'total', (select count(*) from public.profiles where deleted_at is null)::int,
        'new', (select count(*) from public.profiles where created_at >= w0)::int,
        'new_prev', (select count(*) from public.profiles where created_at >= w1 and created_at < w0)::int,
        'paid_plans', (select count(*) from public.subscriptions where stripe_subscription_id is not null and status in ('active', 'past_due'))::int,
        'identity_checked', (select count(*) from public.profiles where kyc_verified)::int),
    'listings', jsonb_build_object(
        'live', (select count(*) from public.listings where published and status = 'active')::int,
        'new', (select count(*) from public.listings where published and created_at >= w0)::int,
        'new_prev', (select count(*) from public.listings where published and created_at >= w1 and created_at < w0)::int,
        'boosted', (select count(*) from public.listings where published and boosted)::int),
    'month', (select jsonb_build_object(
        'completed', count(*) filter (where custody_state = 'confirmed' and dispute_resolution is distinct from 'refund'),
        'disputed', count(*) filter (where disputed_at is not null),
        'orders', count(*),
        'avg_handover_hours', round(avg(extract(epoch from (confirmed_at - paid_at)) / 3600) filter (where custody_state = 'confirmed' and confirmed_at is not null))::int)
      from public.orders where payment_status = 'paid' and paid_at >= m0),
    'attention', jsonb_build_object(
        'disputes', (select count(*) from public.orders where custody_state = 'disputed' and dispute_resolution is null)::int,
        'payments_to_check', (select count(*) from public.orders where payment_status = 'review')::int,
        'reports', (select count(*) from public.reports where status = 'open')::int,
        'payouts_failed', (select count(*) from public.payouts where status = 'failed')::int,
        'payouts_waiting_pence', (select coalesce(sum(amount_pence), 0) from public.payouts where status = 'waiting')::bigint,
        'refunds_by_hand', (select count(*) from public.refunds where status in ('manual', 'failed'))::int,
        'contact', (select count(*) from public.contact_messages where handled_at is null)::int),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'orders', coalesce(o.n, 0), 'gmv_pence', coalesce(o.g, 0),
                 'members', coalesce(p.n, 0), 'listings', coalesce(l.n, 0)) order by d), '[]'::jsonb)
                from generate_series(date_trunc('day', now() at time zone 'Europe/London') - interval '29 days', date_trunc('day', now() at time zone 'Europe/London'), interval '1 day') d
                left join (select date_trunc('day', paid_at at time zone 'Europe/London') k, count(*)::int n, sum(price_pence)::bigint g
                             from public.orders where payment_status = 'paid' and paid_at >= m0 - interval '1 day' group by 1) o on o.k = d
                left join (select date_trunc('day', created_at at time zone 'Europe/London') k, count(*)::int n
                             from public.profiles where created_at >= m0 - interval '1 day' group by 1) p on p.k = d
                left join (select date_trunc('day', created_at at time zone 'Europe/London') k, count(*)::int n
                             from public.listings where published and created_at >= m0 - interval '1 day' group by 1) l on l.k = d),
    'top_sellers', (select coalesce(jsonb_agg(jsonb_build_object('seller', s.username, 'orders', s.n, 'gmv_pence', s.g) order by s.g desc), '[]'::jsonb)
                      from (select pr.username, count(*)::int n, sum(o.price_pence)::bigint g
                              from public.orders o join public.profiles pr on pr.id = o.seller_id
                             where o.payment_status = 'paid' and o.paid_at >= m0 group by pr.username order by 3 desc limit 5) s)
  );
end;
$$;
revoke execute on function public.staff_dashboard() from public, anon;
grant execute on function public.staff_dashboard() to authenticated;

-- What NuTuYu keeps from one order (the same rule as the staff report, migration 027).
create or replace function public.order_net_fees(f jsonb)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce((f ->> 'protection_pence')::int, 0) + coalesce((f ->> 'processing_pence')::int, 0)
       + coalesce((f ->> 'commission_pence')::int, 0) - coalesce((f ->> 'promotion_pence')::int, 0)
$$;
revoke execute on function public.order_net_fees(jsonb) from public, anon, authenticated;
