-- Provenance: migration 016 — notifications.
-- Every member gets an in-app list of what happened on their orders and offers, and (if they want)
-- an email for each. Emails go through an outbox: the send-notifications Edge Function claims rows,
-- sends them with Resend and marks them sent. Nothing is emailed until RESEND_API_KEY is set.
--
-- Groups (each can be switched off for email in the profile):
--   turn      it's your turn in a handover
--   messages  a new message on an order (at most one email per order every 15 minutes)
--   offers    new offer, counter-offer, offer accepted, offer about to expire
--   sales     sold, payment released, problem reported, staff decision
-- Safe to re-run.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('turn', 'message', 'offer_new', 'offer_counter', 'offer_accepted', 'offer_expiring',
                                     'sold', 'payout', 'dispute', 'decision')),
  grp text not null check (grp in ('turn', 'messages', 'offers', 'sales')),
  title text not null,
  body text not null default '',
  link text not null default '/inbox',
  order_id uuid references public.orders(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  count integer not null default 1,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz,
  -- Email: off (not wanted), pending, sending, sent, skipped (read first), failed, expired (too old to send)
  email_state text not null default 'off' check (email_state in ('off', 'pending', 'sending', 'sent', 'skipped', 'failed', 'expired')),
  email_after timestamptz not null default now(),
  email_attempts integer not null default 0,
  email_claimed_at timestamptz,
  emailed_at timestamptz,
  email_error text
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_outbox_idx on public.notifications (email_after) where email_state in ('pending', 'sending');
create index if not exists notifications_order_idx on public.notifications (order_id);
create index if not exists notifications_offer_idx on public.notifications (offer_id);
create unique index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
alter table public.notifications enable row level security;
do $$ begin
  create policy "members see their own notifications" on public.notifications for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create table if not exists public.notification_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_turn boolean not null default true,
  email_messages boolean not null default true,
  email_offers boolean not null default true,
  email_sales boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
do $$ begin
  create policy "members see their own notification settings" on public.notification_prefs for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke all on public.notification_prefs from anon, authenticated;
grant select on public.notification_prefs to authenticated;

-- ------------------------------------------------------------
-- 1. Adding one
-- ------------------------------------------------------------
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text,
                                         p_order uuid default null, p_offer uuid default null,
                                         p_dedupe text default null, p_delay interval default interval '0')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g text := case when p_kind = 'turn' then 'turn' when p_kind = 'message' then 'messages'
                 when p_kind like 'offer_%' then 'offers' else 'sales' end;
  wants boolean;
begin
  if p_user is null then return; end if;
  select case g when 'turn' then email_turn when 'messages' then email_messages when 'offers' then email_offers else email_sales end
    into wants from public.notification_prefs where user_id = p_user;
  insert into public.notifications (user_id, kind, grp, title, body, link, order_id, offer_id, dedupe_key, email_state, email_after)
  values (p_user, p_kind, g, left(p_title, 200), left(coalesce(p_body, ''), 600), coalesce(p_link, '/inbox'), p_order, p_offer, p_dedupe,
          case when coalesce(wants, true) then 'pending' else 'off' end, now() + p_delay)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;
revoke execute on function public.notify(uuid, text, text, text, text, uuid, uuid, text, interval) from public, anon, authenticated;

create or replace function public.notify_pounds(p integer)
returns text
language sql
immutable
set search_path = public
as $$
  select '£' || case when p % 100 = 0 then (p / 100)::text else to_char(p / 100.0, 'FM999999990.00') end
$$;
revoke execute on function public.notify_pounds(integer) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Orders: sold, your turn, problem reported, staff decision, payment released
-- ------------------------------------------------------------
create or replace function public.orders_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := coalesce((select title from public.listings where id = new.listing_id), 'your item');
  link text := '/orders/' || new.id;
  cur_actor text;
  prev_actor text;
  to_buyer uuid := coalesce(new.recipient_id, new.buyer_id);
  sold_now boolean := new.payment_status = 'paid' and old.payment_status is distinct from 'paid';
begin
  if sold_now then
    perform public.notify(new.seller_id, 'sold', 'Sold: ' || t,
      'Payment is held safely until the buyer confirms. Your first step is ready: open the order to start the handover.', link, new.id);
  end if;

  -- Whose turn it is changed (sellers and buyers only; couriers and hubs work from their own queue).
  if new.custody_state = 'in_progress' and (old.custody_state is distinct from 'in_progress' or old.custody_step <> new.custody_step) then
    cur_actor := public.custody_plan(new.custody_tier) -> new.custody_step ->> 'actor';
    prev_actor := case when old.custody_state = 'in_progress' then public.custody_plan(old.custody_tier) -> old.custody_step ->> 'actor' end;
    if cur_actor is distinct from prev_actor and not (sold_now and cur_actor = 'seller') then
      if cur_actor = 'seller' then
        perform public.notify(new.seller_id, 'turn', 'Your turn: ' || t, 'The next handover step for this order is yours.', link, new.id,
                              null, 'turn:' || new.id || ':' || new.custody_step);
      elsif cur_actor = 'buyer' then
        perform public.notify(to_buyer, 'turn', 'Your turn: ' || t,
          case when public.custody_plan(new.custody_tier) -> new.custody_step ->> 'key' = 'confirm'
               then 'Check the item and confirm it arrived as described, or report a problem.'
               else 'It’s on its way to you. Open the order for the next step.' end,
          link, new.id, null, 'turn:' || new.id || ':' || new.custody_step);
      end if;
    end if;
  end if;

  if new.custody_state = 'disputed' and old.custody_state is distinct from 'disputed' then
    perform public.notify(new.seller_id, 'dispute', 'Problem reported: ' || t,
      'The buyer reported a problem. Payment stays held while our team looks at the record. You can reply in the order’s messages.', link, new.id);
    if new.recipient_id is not null then
      perform public.notify(new.buyer_id, 'dispute', 'Problem reported: ' || t, 'A problem was reported with the gift you sent. Our team will look at it.', link, new.id);
    end if;
  end if;

  if new.dispute_resolution is not null and old.dispute_resolution is null then
    perform public.notify(new.seller_id, 'decision', 'Decision on ' || t,
      case new.dispute_resolution when 'release' then 'Our team has released the payment to you.' else 'Our team has refunded the buyer.' end, link, new.id);
    perform public.notify(new.buyer_id, 'decision', 'Decision on ' || t,
      case new.dispute_resolution when 'release' then 'Our team has released the payment to the seller.' else 'Our team has refunded you.' end, link, new.id);
  elsif new.payout_status = 'due' and old.payout_status is distinct from 'due' then
    perform public.notify(new.seller_id, 'payout', 'Payment released: ' || t,
      'The buyer confirmed the item. The payment is on its way to you.', link, new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_notify() from public, anon, authenticated;
do $$ begin
  create trigger orders_notify after update on public.orders for each row execute procedure public.orders_notify();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3. Messages: one unread notification per order, updated as more arrive; emails at most every 15 minutes
-- ------------------------------------------------------------
create or replace function public.order_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  t text;
  who text := coalesce((select username from public.profiles where id = new.sender_id), 'Someone');
  to_user uuid;
  n public.notifications;
  last_sent timestamptz;
  wants boolean;
begin
  select * into o from public.orders where id = new.order_id;
  t := coalesce((select title from public.listings where id = o.listing_id), 'your order');
  foreach to_user in array array[o.buyer_id, o.seller_id] loop
    continue when to_user = new.sender_id;
    select * into n from public.notifications
     where user_id = to_user and kind = 'message' and order_id = o.id and read_at is null
     order by created_at desc limit 1 for update;
    select max(emailed_at) into last_sent from public.notifications
     where user_id = to_user and kind = 'message' and order_id = o.id and email_state = 'sent';
    if n.id is not null then
      update public.notifications
         set count = n.count + 1, updated_at = now(),
             title = (n.count + 1) || ' new messages about ' || t,
             body = who || ': ' || left(new.body, 400),
             email_state = case when n.email_state in ('sent', 'sending', 'skipped', 'failed', 'expired') then 'pending' else n.email_state end,
             email_after = case when n.email_state = 'pending' then n.email_after
                                else greatest(now() + interval '2 minutes', coalesce(last_sent, n.emailed_at, now()) + interval '15 minutes') end
       where id = n.id;
    else
      select email_messages into wants from public.notification_prefs where user_id = to_user;
      insert into public.notifications (user_id, kind, grp, title, body, link, order_id, email_state, email_after)
      values (to_user, 'message', 'messages', 'New message about ' || t, who || ': ' || left(new.body, 400), '/orders/' || o.id || '#messages', o.id,
              case when coalesce(wants, true) then 'pending' else 'off' end,
              -- A short wait, so someone already looking at the order isn't emailed.
              greatest(now() + interval '2 minutes', coalesce(last_sent, '-infinity') + interval '15 minutes'));
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.order_messages_notify() from public, anon, authenticated;
do $$ begin
  create trigger order_messages_notify after insert on public.order_messages for each row execute procedure public.order_messages_notify();
exception when duplicate_object then null; end $$;

-- Reading an order's messages reads their notification too (and stops a waiting email).
create or replace function public.message_reads_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications set read_at = now()
   where user_id = new.user_id and order_id = new.order_id and kind = 'message' and read_at is null;
  return null;
end;
$$;
revoke execute on function public.message_reads_notify() from public, anon, authenticated;
do $$ begin
  create trigger message_reads_notify after insert or update on public.message_reads for each row execute procedure public.message_reads_notify();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 4. Offers: new, countered, accepted, and about to expire
-- ------------------------------------------------------------
create or replace function public.offers_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := coalesce((select title from public.listings where id = new.listing_id), 'an item');
  buyer text := coalesce((select username from public.profiles where id = new.buyer_id), 'A buyer');
  seller text := coalesce((select username from public.profiles where id = new.seller_id), 'The seller');
  amt text := public.notify_pounds(new.amount_pence);
  until text := to_char(new.expires_at at time zone 'Europe/London', 'Dy HH24:MI');
begin
  if tg_op = 'INSERT' then
    if new.made_by = 'buyer' and new.counter_of is null then
      perform public.notify(new.seller_id, 'offer_new', 'New offer: ' || amt || ' for ' || t,
        buyer || ' offered ' || amt || '. Accept, counter or decline before ' || until || '.', '/inbox', null, new.id);
    elsif new.made_by = 'buyer' then
      perform public.notify(new.seller_id, 'offer_counter', buyer || ' offered ' || amt || ' for ' || t,
        'In reply to your counter-offer. Answer before ' || until || '.', '/inbox', null, new.id);
    else
      perform public.notify(new.buyer_id, 'offer_counter', seller || ' offered ' || amt || ' for ' || t,
        'In reply to your offer. Answer before ' || until || '.', '/item/' || new.listing_id, null, new.id);
    end if;
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    if new.made_by = 'buyer' then
      perform public.notify(new.buyer_id, 'offer_accepted', 'Offer accepted: ' || t,
        seller || ' accepted ' || amt || '. Buy it at that price before ' || until || '.', '/item/' || new.listing_id, null, new.id);
    else
      perform public.notify(new.seller_id, 'offer_accepted', 'Offer accepted: ' || t,
        buyer || ' accepted your ' || amt || '. They have until ' || until || ' to pay.', '/inbox', null, new.id);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.offers_notify() from public, anon, authenticated;
do $$ begin
  create trigger offers_notify after insert or update on public.offers for each row execute procedure public.offers_notify();
exception when duplicate_object then null; end $$;

-- Run hourly: offers that run out within 6 hours, once each.
create or replace function public.notify_expiring_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  n integer := 0;
begin
  for x in
    select o.*, coalesce(l.title, 'an item') as title from public.offers o left join public.listings l on l.id = o.listing_id
     where o.status in ('pending', 'accepted') and o.expires_at > now() and o.expires_at <= now() + interval '6 hours'
  loop
    if x.status = 'pending' then
      perform public.notify(case when x.made_by = 'buyer' then x.seller_id else x.buyer_id end, 'offer_expiring',
        'Offer ending soon: ' || x.title,
        'The offer of ' || public.notify_pounds(x.amount_pence) || ' ends at ' || to_char(x.expires_at at time zone 'Europe/London', 'HH24:MI') || '. Answer it before then.',
        case when x.made_by = 'buyer' then '/inbox' else '/item/' || x.listing_id end, null, x.id, 'offer-expiring:' || x.id);
    else
      perform public.notify(x.buyer_id, 'offer_expiring', 'Pay soon: ' || x.title,
        'Your accepted offer of ' || public.notify_pounds(x.amount_pence) || ' ends at ' || to_char(x.expires_at at time zone 'Europe/London', 'HH24:MI') || '.',
        '/item/' || x.listing_id, null, x.id, 'offer-pay:' || x.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.notify_expiring_offers() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. For members
-- ------------------------------------------------------------
create or replace function public.my_notifications(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'group', n.grp, 'title', n.title, 'body', n.body, 'link', n.link,
           'count', n.count, 'created_at', n.updated_at, 'read', n.read_at is not null, 'emailed', n.email_state = 'sent')
           order by n.updated_at desc), '[]'::jsonb)
    from (select * from public.notifications where user_id = (select auth.uid())
           order by updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) n
$$;
revoke execute on function public.my_notifications(integer) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated;

create or replace function public.unread_notifications()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.notifications where user_id = (select auth.uid()) and read_at is null
$$;
revoke execute on function public.unread_notifications() from public, anon;
grant execute on function public.unread_notifications() to authenticated;

-- Mark some (or, with null, all) of the member's notifications read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql
security definer
set search_path = public
as $$
  with u as (
    update public.notifications set read_at = now()
     where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids))
    returning 1)
  select count(*)::integer from u
$$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function public.my_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('turn', coalesce(p.email_turn, true), 'messages', coalesce(p.email_messages, true),
                            'offers', coalesce(p.email_offers, true), 'sales', coalesce(p.email_sales, true))
    from (select 1) one left join public.notification_prefs p on p.user_id = (select auth.uid())
$$;
revoke execute on function public.my_notification_prefs() from public, anon;
grant execute on function public.my_notification_prefs() to authenticated;

create or replace function public.set_notification_prefs(p_turn boolean, p_messages boolean, p_offers boolean, p_sales boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.notification_prefs (user_id, email_turn, email_messages, email_offers, email_sales, updated_at)
  values (me, coalesce(p_turn, true), coalesce(p_messages, true), coalesce(p_offers, true), coalesce(p_sales, true), now())
  on conflict (user_id) do update set email_turn = excluded.email_turn, email_messages = excluded.email_messages,
    email_offers = excluded.email_offers, email_sales = excluded.email_sales, updated_at = now();
  -- Switching a group off also stops emails already waiting.
  update public.notifications set email_state = 'off'
   where user_id = me and email_state = 'pending'
     and ((grp = 'turn' and not coalesce(p_turn, true)) or (grp = 'messages' and not coalesce(p_messages, true))
       or (grp = 'offers' and not coalesce(p_offers, true)) or (grp = 'sales' and not coalesce(p_sales, true)));
  return public.my_notification_prefs();
end;
$$;
revoke execute on function public.set_notification_prefs(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_notification_prefs(boolean, boolean, boolean, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6. The email outbox (service role only: the send-notifications Edge Function)
-- ------------------------------------------------------------
create or replace function public.notification_outbox_claim(p_limit integer default 25)
returns table (id uuid, email text, username text, kind text, title text, body text, link text, count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Read before the email went: no need to send it.
  update public.notifications n set email_state = 'skipped' where n.email_state = 'pending' and n.read_at is not null;
  -- Too old to be useful.
  update public.notifications n set email_state = 'expired' where n.email_state = 'pending' and n.created_at < now() - interval '2 days';
  -- Claimed but never finished (the function stopped): try again, up to three times.
  update public.notifications n set email_state = case when n.email_attempts >= 3 then 'failed' else 'pending' end
   where n.email_state = 'sending' and n.email_claimed_at < now() - interval '10 minutes';

  return query
  with c as (
    select x.id from public.notifications x
     where x.email_state = 'pending' and x.email_after <= now()
     order by x.email_after limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  ), u as (
    update public.notifications n
       set email_state = 'sending', email_attempts = n.email_attempts + 1, email_claimed_at = now()
      from c where n.id = c.id
    returning n.*
  )
  select u.id, au.email::text, p.username, u.kind, u.title, u.body, u.link, u.count
    from u join auth.users au on au.id = u.user_id left join public.profiles p on p.id = u.user_id;
end;
$$;
revoke execute on function public.notification_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.notification_outbox_claim(integer) to service_role;

create or replace function public.notification_outbox_done(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
     set email_state = case when email_state <> 'sending' then email_state   -- changed while sending (a newer message)
                            when p_ok then 'sent' when email_attempts >= 3 then 'failed' else 'pending' end,
         email_after = case when p_ok and email_state = 'sending' then email_after
                            when p_ok then greatest(email_after, now() + interval '15 minutes')
                            else now() + interval '5 minutes' end,
         emailed_at = case when p_ok then now() else emailed_at end,
         email_error = case when p_ok then null else left(p_error, 300) end
   where id = p_id
$$;
revoke execute on function public.notification_outbox_done(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.notification_outbox_done(uuid, boolean, text) to service_role;
