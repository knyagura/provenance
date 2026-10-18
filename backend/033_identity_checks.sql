-- 033: Identity checks with Stripe Identity.
-- A member taps "Check my identity": Stripe shows them its own pages to photograph an ID document and take a selfie.
-- NuTuYu never receives the images; Stripe tells us only whether the check passed. A pass sets profiles.kyc_verified,
-- which shows as "Identity checked" and counts towards the Trusted seller badge (ADR 0019). Off until the owner adds
-- the Stripe keys and turns on Identity in Stripe. Staff can still set it by hand for exceptions.

create table if not exists public.identity_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id text not null unique check (session_id ~ '^vs_[A-Za-z0-9]{6,64}$'),
  status text not null default 'started' check (status in ('started', 'processing', 'verified', 'requires_input', 'canceled')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists identity_checks_user_idx on public.identity_checks (user_id, created_at desc);
alter table public.identity_checks enable row level security;
revoke all on public.identity_checks from anon, authenticated;

create or replace function public.my_identity()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'verified', coalesce((select kyc_verified from public.profiles where id = auth.uid()), false),
    'latest', (select jsonb_build_object('status', c.status, 'error', c.last_error, 'at', c.updated_at)
                 from public.identity_checks c where c.user_id = auth.uid() order by c.created_at desc limit 1),
    -- Up to 3 tries a day (each costs NuTuYu money at Stripe).
    'can_start', (select count(*) from public.identity_checks c where c.user_id = auth.uid() and c.created_at > now() - interval '1 day') < 3
  )
$$;
revoke execute on function public.my_identity() from public, anon;
grant execute on function public.my_identity() to authenticated;

create or replace function public.identity_session_started(p_user uuid, p_session text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.identity_checks (user_id, session_id) values (p_user, p_session) on conflict (session_id) do nothing;
end;
$$;
revoke execute on function public.identity_session_started(uuid, text) from public, anon, authenticated;
grant execute on function public.identity_session_started(uuid, text) to service_role;

create or replace function public.identity_can_start(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select kyc_verified from public.profiles where id = p_user), false)
     and (select count(*) from public.identity_checks where user_id = p_user and created_at > now() - interval '1 day') < 3
$$;
revoke execute on function public.identity_can_start(uuid) from public, anon, authenticated;
grant execute on function public.identity_can_start(uuid) to service_role;

-- Stripe's answer (webhook, or the member came back). Only "verified" changes the profile.
create or replace function public.identity_updated(p_session text, p_status text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  if p_status not in ('processing', 'verified', 'requires_input', 'canceled') then
    return;
  end if;
  update public.identity_checks set status = p_status, last_error = left(p_error, 200), updated_at = now()
   where session_id = p_session and status <> 'verified' returning user_id into uid;
  if uid is not null and p_status = 'verified' then
    update public.profiles set kyc_verified = true where id = uid;
    perform public.notify(uid, 'decision', 'Your identity is checked', 'Thanks. Your profile now shows “Identity checked”.', '/profile', p_dedupe => 'identity:' || uid);
  end if;
end;
$$;
revoke execute on function public.identity_updated(text, text, text) from public, anon, authenticated;
grant execute on function public.identity_updated(text, text, text) to service_role;
