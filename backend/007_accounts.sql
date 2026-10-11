-- Provenance: migration 007 — accounts (build step 4).
-- Run AFTER 006. Additive and safe to re-run. Contains no DROP statements.
--
--   1. Usernames: 3–30 letters, digits, dots, underscores or hyphens; unique ignoring case.
--      The sign-up trigger now makes a username that always fits those rules.
--   2. Bio: at most 500 characters.
--   Holiday mode (profiles.holiday_mode, already there) needs no change here: the website and API
--   leave those sellers' listings out of browsing and search, and item pages say buying is paused.
--   Passkeys need no tables of ours: Supabase Auth stores them (Authentication → Passkeys).

-- ------------------------------------------------------------
-- 1. Usernames
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := left(regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), 25);
begin
  if char_length(base) < 3 then base := 'member'; end if;
  insert into public.profiles (id, username)
  values (new.id, base || '_' || substr(replace(new.id::text, '-', ''), 1, 4))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

do $$ begin
  alter table public.profiles add constraint profiles_username_format check (username ~ '^[A-Za-z0-9._-]{3,30}$');
exception when duplicate_object then null; end $$;
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- ------------------------------------------------------------
-- 2. Bio
-- ------------------------------------------------------------
do $$ begin
  alter table public.profiles add constraint profiles_bio_len check (bio is null or char_length(bio) <= 500);
exception when duplicate_object then null; end $$;

