-- 034: Phone and desktop notifications (Web Push).
-- A member turns on notifications on a device (Account → Notifications → "Notify me on this device"); the browser gives
-- a push subscription, kept here. Every new notification for that member is then also pushed to their devices, unless
-- they switch pushes off. The send-notifications worker sends them every minute with the VAPID keys kept in Vault
-- (034b; the worker makes the keys itself the first time, so nobody has to). A device that's gone (410) is removed.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

alter table public.notification_prefs add column if not exists push_on boolean not null default true;
alter table public.notifications add column if not exists push_state text;
do $$ begin
  alter table public.notifications add constraint notifications_push_state_check check (push_state is null or push_state in ('pending', 'sending', 'sent', 'failed'));
exception when duplicate_object then null; end $$;
create index if not exists notifications_push_pending_idx on public.notifications (created_at) where push_state = 'pending';

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_agent text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if (select count(*) from public.push_subscriptions where user_id = me) >= 10
     and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint) then
    -- Oldest device makes way.
    delete from public.push_subscriptions where id = (select id from public.push_subscriptions where user_id = me order by created_at limit 1);
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_agent, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0;
  insert into public.notification_prefs (user_id, push_on) values (me, true)
  on conflict (user_id) do update set push_on = true, updated_at = now();
  return public.my_push();
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return public.my_push();
end;
$$;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

create or replace function public.set_push_on(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_prefs (user_id, push_on) values (auth.uid(), p_on)
  on conflict (user_id) do update set push_on = p_on, updated_at = now();
  return public.my_push();
end;
$$;
revoke execute on function public.set_push_on(boolean) from public, anon;
grant execute on function public.set_push_on(boolean) to authenticated;

create or replace function public.my_push()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'on', coalesce((select push_on from public.notification_prefs where user_id = auth.uid()), true),
    'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid())::int,
    'endpoints', (select coalesce(jsonb_agg(endpoint), '[]'::jsonb) from public.push_subscriptions where user_id = auth.uid())
  )
$$;
revoke execute on function public.my_push() from public, anon;
grant execute on function public.my_push() to authenticated;

-- New notifications are queued for push when the member has a device and hasn't switched pushes off.
create or replace function public.notifications_queue_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id)
     and coalesce((select push_on from public.notification_prefs where user_id = new.user_id), true) then
    new.push_state := 'pending';
  end if;
  return new;
end;
$$;
revoke execute on function public.notifications_queue_push() from public, anon, authenticated;
do $$ begin
  create trigger notifications_queue_push before insert on public.notifications for each row execute function public.notifications_queue_push();
exception when duplicate_object then null; end $$;

-- The worker: pending pushes (oldest first) with each member's devices.
create or replace function public.push_outbox_claim(p_limit integer)
returns table (id uuid, title text, body text, link text, devices jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications set push_state = 'pending' where push_state = 'sending' and updated_at < now() - interval '10 minutes';
  -- Anything over a day old isn't worth a buzz any more.
  update public.notifications set push_state = 'failed' where push_state = 'pending' and created_at < now() - interval '1 day';
  return query
  with c as (
    select n.id from public.notifications n where n.push_state = 'pending'
     order by n.created_at limit greatest(1, least(coalesce(p_limit, 50), 200)) for update skip locked
  ), u as (
    update public.notifications n set push_state = 'sending', updated_at = now() from c where n.id = c.id
    returning n.id, n.user_id, n.title, n.body, n.link
  )
  select u.id, u.title, u.body, u.link,
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from public.push_subscriptions s where s.user_id = u.user_id), '[]'::jsonb)
    from u;
end;
$$;
revoke execute on function public.push_outbox_claim(integer) from public, anon, authenticated;
grant execute on function public.push_outbox_claim(integer) to service_role;

create or replace function public.push_done(p_id uuid, p_ok boolean, p_gone text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications set push_state = case when p_ok then 'sent' else 'failed' end where id = p_id and push_state = 'sending';
  if p_gone is not null then
    delete from public.push_subscriptions where endpoint = any(p_gone);
  end if;
end;
$$;
revoke execute on function public.push_done(uuid, boolean, text[]) from public, anon, authenticated;
grant execute on function public.push_done(uuid, boolean, text[]) to service_role;
