-- 037: Security review of the October features (ADR 0029).
--
-- 1. A suspension's reason is for the member and staff only. Profiles are readable by anyone (usernames, bios), so
--    the reason moves to a private table as it's written; staff_moderate keeps working unchanged.
-- 2. The public trust tracker counts every order. It's now worked out at most once every 5 minutes and kept, so
--    loading /trust over and over can't load the database.
-- 3. Tidy: helper functions that don't need to be callable from the API aren't.

-- 1. Private suspension reasons
create table if not exists public.member_moderation_notes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  suspended_reason text,
  updated_at timestamptz not null default now()
);
alter table public.member_moderation_notes enable row level security;
revoke all on public.member_moderation_notes from anon, authenticated;

create or replace function public.profiles_private_reason()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.suspended_reason is not null then
    insert into public.member_moderation_notes (user_id, suspended_reason) values (new.id, new.suspended_reason)
    on conflict (user_id) do update set suspended_reason = excluded.suspended_reason, updated_at = now();
    new.suspended_reason := null;
  elsif new.suspended_at is null and old.suspended_at is not null then
    delete from public.member_moderation_notes where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_private_reason() from public, anon, authenticated;
do $$ begin
  -- After profiles_protect_moderation (names run in order), so members still can't touch it.
  create trigger profiles_zz_private_reason before update on public.profiles for each row execute function public.profiles_private_reason();
exception when duplicate_object then null; end $$;
-- Reasons already written move now.
insert into public.member_moderation_notes (user_id, suspended_reason)
select id, suspended_reason from public.profiles where suspended_reason is not null
on conflict (user_id) do nothing;
update public.profiles set suspended_reason = null where suspended_reason is not null;

-- The member can read their own reason (to see why), and staff can.
create or replace function public.my_suspension()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p.suspended_at is null then null else jsonb_build_object('at', p.suspended_at, 'reason', n.suspended_reason) end
    from public.profiles p left join public.member_moderation_notes n on n.user_id = p.id
   where p.id = auth.uid()
$$;
revoke execute on function public.my_suspension() from public, anon;
grant execute on function public.my_suspension() to authenticated;

-- 2. Trust tracker, cached for 5 minutes
create table if not exists public.cached_stats (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.cached_stats enable row level security;
revoke all on public.cached_stats from anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'trust_stats_live' and pronamespace = 'public'::regnamespace) then
    alter function public.trust_stats() rename to trust_stats_live;
  end if;
end $$;
revoke execute on function public.trust_stats_live() from public, anon, authenticated;

create or replace function public.trust_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cached_stats;
  v jsonb;
begin
  select * into c from public.cached_stats where key = 'trust_stats';
  if found and c.updated_at > now() - interval '5 minutes' then
    return c.value;
  end if;
  v := public.trust_stats_live();
  insert into public.cached_stats (key, value, updated_at) values ('trust_stats', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end;
$$;
revoke execute on function public.trust_stats() from public;
grant execute on function public.trust_stats() to anon, authenticated;

-- 3. Helpers that only other functions use
revoke execute on function public.clean_address(jsonb) from public, anon, authenticated;
revoke execute on function public.is_suspended(uuid) from public, anon, authenticated;
