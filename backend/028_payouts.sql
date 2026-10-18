-- 028: Seller payouts through Stripe Connect.
-- Sellers connect a Stripe Express account (Stripe collects their bank details and checks who they are; NuTuYu never sees
-- them). When an order's payment is released (payout_status 'due'), a payout is queued for the seller's share, less any
-- live shipping label. The send-payouts Edge Function (028b runs it every 10 minutes) sends queued payouts as Stripe
-- transfers and marks them sent. Nothing moves until the owner adds the Stripe keys.
--
-- payout states: waiting (seller hasn't finished setting up payouts) → queued → sending → sent
--                failed (gave up after 5 tries; staff can retry) · held (staff hold, e.g. an account under review)

-- ------------------------------------------------------------
-- 1. The seller's connected account (private: only its owner and staff read it)
-- ------------------------------------------------------------
create table if not exists public.payout_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payout_accounts enable row level security;
revoke all on public.payout_accounts from anon, authenticated;

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  amount_pence integer not null check (amount_pence >= 0),
  label_pence integer not null default 0 check (label_pence >= 0),
  status text not null default 'waiting' check (status in ('waiting', 'queued', 'sending', 'sent', 'failed', 'held')),
  transfer_ref text,
  attempts integer not null default 0,
  last_error text,
  hold_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists payouts_seller_idx on public.payouts (seller_id, created_at desc);
create index if not exists payouts_status_idx on public.payouts (status, updated_at);
alter table public.payouts enable row level security;
revoke all on public.payouts from anon, authenticated;

-- ------------------------------------------------------------
-- 2. Queue a payout when the payment is released
-- ------------------------------------------------------------
create or replace function public.orders_queue_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  labels integer;
  ready boolean;
  amount integer;
begin
  if new.payout_status = 'due' and old.payout_status is distinct from 'due' and new.payment_status = 'paid' then
    select coalesce(sum(price_pence), 0) into labels from public.shipping_labels where order_id = new.id and status = 'active' and mode = 'live';
    select coalesce(payouts_enabled, false) into ready from public.payout_accounts where user_id = new.seller_id;
    amount := greatest(coalesce((new.fees ->> 'seller_payout_pence')::int, new.price_pence) - labels, 0);
    insert into public.payouts (order_id, seller_id, amount_pence, label_pence, status)
    values (new.id, new.seller_id, amount, labels, case when coalesce(ready, false) then 'queued' else 'waiting' end)
    on conflict (order_id) do nothing;
    if not coalesce(ready, false) then
      perform public.notify(new.seller_id, 'payout', 'Set up payouts to get your money',
        public.notify_pounds(amount) || ' is waiting for you. Add your bank details with Stripe in your account to receive it.',
        '/profile#payouts', p_order => new.id, p_dedupe => 'payout-setup:' || new.seller_id);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_queue_payout() from public, anon, authenticated;
do $$ begin
  create trigger orders_queue_payout after update of payout_status on public.orders
    for each row execute function public.orders_queue_payout();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3. Members
-- ------------------------------------------------------------
create or replace function public.my_payouts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'account', (select jsonb_build_object('connected', true, 'details_submitted', a.details_submitted, 'payouts_enabled', a.payouts_enabled)
                  from public.payout_accounts a where a.user_id = auth.uid()),
    'waiting_pence', (select coalesce(sum(amount_pence), 0) from public.payouts where seller_id = auth.uid() and status in ('waiting', 'queued', 'sending', 'failed', 'held')),
    'sent_pence', (select coalesce(sum(amount_pence), 0) from public.payouts where seller_id = auth.uid() and status = 'sent'),
    'recent', (select coalesce(jsonb_agg(r order by r ->> 'created_at' desc), '[]'::jsonb) from (
                 select jsonb_build_object('id', p.id, 'order_id', p.order_id, 'title', coalesce(o.listing_snapshot ->> 'title', l.title),
                   'amount_pence', p.amount_pence, 'label_pence', p.label_pence, 'status', p.status, 'created_at', p.created_at, 'sent_at', p.sent_at) r
                   from public.payouts p join public.orders o on o.id = p.order_id left join public.listings l on l.id = o.listing_id
                  where p.seller_id = auth.uid() order by p.created_at desc limit 20) x)
  )
$$;
revoke execute on function public.my_payouts() from public, anon;
grant execute on function public.my_payouts() to authenticated;

-- ------------------------------------------------------------
-- 4. The Edge Functions (service role only)
-- ------------------------------------------------------------
-- The connect function: which account belongs to this member (null: none yet).
create or replace function public.payout_account_for(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$ select stripe_account_id from public.payout_accounts where user_id = p_user $$;
revoke execute on function public.payout_account_for(uuid) from public, anon, authenticated;
grant execute on function public.payout_account_for(uuid) to service_role;

create or replace function public.set_payout_account(p_user uuid, p_account text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payout_accounts (user_id, stripe_account_id) values (p_user, p_account)
  on conflict (user_id) do update set stripe_account_id = excluded.stripe_account_id, updated_at = now()
  where payout_accounts.stripe_account_id = excluded.stripe_account_id;  -- never swap a member's account silently
end;
$$;
revoke execute on function public.set_payout_account(uuid, text) from public, anon, authenticated;
grant execute on function public.set_payout_account(uuid, text) to service_role;

-- Stripe told us (account.updated, or the member came back from onboarding) whether payouts can be sent.
create or replace function public.payout_account_updated(p_account text, p_details boolean, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  update public.payout_accounts set details_submitted = p_details, payouts_enabled = p_enabled, updated_at = now()
   where stripe_account_id = p_account returning user_id into uid;
  if uid is not null and p_enabled then
    update public.payouts set status = 'queued', updated_at = now() where seller_id = uid and status = 'waiting';
  end if;
end;
$$;
revoke execute on function public.payout_account_updated(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.payout_account_updated(text, boolean, boolean) to service_role;

-- The sender takes up to p_limit queued payouts (oldest first) and gets what it needs to send each one.
create or replace function public.payouts_claim(p_limit integer)
returns table (id uuid, order_id uuid, amount_pence integer, stripe_account_id text, payment_ref text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Anything stuck "sending" for 15 minutes (a crashed run) goes back to the queue; the idempotency key stops doubles.
  update public.payouts set status = 'queued', updated_at = now() where status = 'sending' and updated_at < now() - interval '15 minutes';
  return query
  with c as (
    select p.id from public.payouts p
      join public.payout_accounts a on a.user_id = p.seller_id and a.payouts_enabled
     where p.status = 'queued' and p.amount_pence > 0
     order by p.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update of p skip locked
  )
  update public.payouts p set status = 'sending', attempts = p.attempts + 1, updated_at = now()
    from c, public.orders o, public.payout_accounts a
   where p.id = c.id and o.id = p.order_id and a.user_id = p.seller_id
  returning p.id, p.order_id, p.amount_pence, a.stripe_account_id,
            coalesce(o.payment_ref, (select g.payment_ref from public.checkout_groups g where g.id = o.group_id)), p.attempts;
end;
$$;
revoke execute on function public.payouts_claim(integer) from public, anon, authenticated;
grant execute on function public.payouts_claim(integer) to service_role;

create or replace function public.payout_done(p_id uuid, p_ok boolean, p_ref text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payouts;
begin
  select * into p from public.payouts where id = p_id for update;
  if not found or p.status <> 'sending' then
    return;
  end if;
  if p_ok then
    update public.payouts set status = 'sent', transfer_ref = p_ref, sent_at = now(), last_error = null, updated_at = now() where id = p_id;
    update public.orders set payout_status = 'paid', updated_at = now() where id = p.order_id and payout_status = 'due';
  else
    update public.payouts set status = case when p.attempts >= 5 then 'failed' else 'queued' end,
           last_error = left(p_error, 300), updated_at = now() where id = p_id;
  end if;
end;
$$;
revoke execute on function public.payout_done(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.payout_done(uuid, boolean, text, text) to service_role;

-- A refund after release (staff decision) must not leave a payout queued.
create or replace function public.orders_cancel_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payout_status = 'refund' and old.payout_status is distinct from 'refund' then
    update public.payouts set status = 'held', hold_reason = 'Order refunded', updated_at = now()
     where order_id = new.id and status in ('waiting', 'queued', 'failed');
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_cancel_payout() from public, anon, authenticated;
do $$ begin
  create trigger orders_cancel_payout after update of payout_status on public.orders
    for each row execute function public.orders_cancel_payout();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 5. Staff
-- ------------------------------------------------------------
create or replace function public.staff_payouts(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*)::int n from public.payouts group by status) x),
    'totals', (select coalesce(jsonb_object_agg(status, s), '{}'::jsonb) from (select status, sum(amount_pence)::bigint s from public.payouts group by status) x),
    'items', (select coalesce(jsonb_agg(r order by r ->> 'updated_at' desc), '[]'::jsonb) from (
                select jsonb_build_object('id', p.id, 'order_id', p.order_id, 'seller', pr.username, 'amount_pence', p.amount_pence, 'status', p.status,
                  'attempts', p.attempts, 'last_error', p.last_error, 'hold_reason', p.hold_reason, 'updated_at', p.updated_at, 'sent_at', p.sent_at,
                  'connected', a.user_id is not null, 'payouts_enabled', coalesce(a.payouts_enabled, false)) r
                  from public.payouts p join public.profiles pr on pr.id = p.seller_id left join public.payout_accounts a on a.user_id = p.seller_id
                 where p_status is null or p.status = p_status
                 order by p.updated_at desc limit 100) x)
  );
end;
$$;
revoke execute on function public.staff_payouts(text) from public, anon;
grant execute on function public.staff_payouts(text) to authenticated;

create or replace function public.staff_payout_action(p_id uuid, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  p public.payouts;
  ready boolean;
begin
  select * into p from public.payouts where id = p_id for update;
  if not found then
    raise exception 'Payout not found.' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Add a short note.' using errcode = '22023';
  end if;
  select coalesce(payouts_enabled, false) into ready from public.payout_accounts where user_id = p.seller_id;
  if p_action = 'hold' and p.status in ('waiting', 'queued', 'failed') then
    update public.payouts set status = 'held', hold_reason = btrim(p_note), updated_at = now() where id = p_id;
  elsif p_action in ('release', 'retry') and p.status in ('held', 'failed')
        and exists (select 1 from public.orders o where o.id = p.order_id and o.payout_status = 'due') then
    update public.payouts set status = case when coalesce(ready, false) then 'queued' else 'waiting' end, hold_reason = null,
           attempts = case when p_action = 'retry' then 0 else attempts end, updated_at = now() where id = p_id;
  else
    raise exception 'That can’t be done to a % payout.', p.status using errcode = '55000';
  end if;
  insert into public.staff_actions (staff_id, action, subject, detail) values (me, 'payout_' || p_action, p_id::text, jsonb_build_object('note', btrim(p_note)));
  return public.staff_payouts(null);
end;
$$;
revoke execute on function public.staff_payout_action(uuid, text, text) from public, anon;
grant execute on function public.staff_payout_action(uuid, text, text) to authenticated;
