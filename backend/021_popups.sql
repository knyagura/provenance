-- Provenance: migration 021 — site popups that staff configure.
-- The home page goes straight to the items. Explanations and promotions ("How NuTuYu protects you",
-- a welcome offer for people who sign up) appear as a popup instead, chosen by staff in the console:
-- who sees it (everyone, visitors who aren't signed in, or members), on which pages, after how long,
-- and between which dates. Each person sees a popup once; editing it with "show again" shows it again.
-- Safe to re-run.

create table if not exists public.site_popups (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9-]{2,40}$'),
  kind text not null default 'info' check (kind in ('info', 'offer', 'announcement')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 1000),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 6),
  cta_label text check (cta_label is null or char_length(cta_label) between 1 and 40),
  cta_href text check (cta_href is null or (cta_href ~ '^/[^/]' or cta_href = '/') and char_length(cta_href) <= 200),
  offer_code text check (offer_code is null or offer_code ~ '^[A-Z0-9-]{3,20}$'),
  audience text not null default 'everyone' check (audience in ('everyone', 'visitors', 'members')),
  pages text not null default '/' check (char_length(pages) <= 300),
  delay_seconds integer not null default 2 check (delay_seconds between 0 and 120),
  priority integer not null default 0,
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.site_popups enable row level security;
do $$ begin
  create policy "anyone sees live popups" on public.site_popups for select
    using (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
exception when duplicate_object then null; end $$;
revoke all on public.site_popups from anon, authenticated;
grant select on public.site_popups to anon, authenticated;

insert into public.site_popups (key, kind, title, body, steps, cta_label, cta_href, audience, pages, delay_seconds, priority, active)
values
  ('how-it-works', 'info', 'Pre-loved, with proof',
   'Every item carries its own record, so you know what you’re getting and the seller knows they’ll be paid.',
   '[{"title":"Listed with proof","note":"The app asks for the right photos for each kind of item, so the listing is the reference."},
     {"title":"Sealed and witnessed","note":"From £75 a courier watches it packed and fits a numbered seal. Over £500 it’s authenticated too."},
     {"title":"Opened on camera","note":"You check the seal and open it on camera. The seller is paid when you confirm."}]'::jsonb,
   'Start browsing', '/search', 'everyone', '/', 2, 10, true),
  ('welcome-offer', 'offer', 'New to NuTuYu? Join today',
   'Create a free account to save items, make offers and shop for several people at once.',
   '[]'::jsonb, 'Create an account', '/signin?next=/', 'visitors', '/,/search,/item/', 20, 5, false)
on conflict (key) do nothing;

create or replace function public.popup_json(p public.site_popups)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('id', p.id, 'key', p.key, 'kind', p.kind, 'title', p.title, 'body', p.body, 'steps', p.steps,
    'cta_label', p.cta_label, 'cta_href', p.cta_href, 'offer_code', p.offer_code, 'audience', p.audience, 'pages', p.pages,
    'delay_seconds', p.delay_seconds, 'priority', p.priority, 'active', p.active, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
    'version', p.version, 'updated_at', p.updated_at)
$$;

create or replace function public.staff_popups()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return coalesce((select jsonb_agg(public.popup_json(p) order by p.priority desc, p.key) from public.site_popups p), '[]'::jsonb);
end;
$$;
revoke execute on function public.staff_popups() from public, anon;
grant execute on function public.staff_popups() to authenticated;

-- Create (no id) or change a popup. p_show_again makes everyone who closed it see it again.
create or replace function public.staff_save_popup(p_id uuid, p jsonb, p_show_again boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  saved public.site_popups;
begin
  if p_id is null then
    insert into public.site_popups (key, kind, title, body, steps, cta_label, cta_href, offer_code, audience, pages, delay_seconds, priority, active, starts_at, ends_at, updated_by)
    values (lower(btrim(p ->> 'key')), coalesce(p ->> 'kind', 'info'), btrim(p ->> 'title'), coalesce(p ->> 'body', ''), coalesce(p -> 'steps', '[]'::jsonb),
            nullif(btrim(p ->> 'cta_label'), ''), nullif(btrim(p ->> 'cta_href'), ''), nullif(upper(btrim(p ->> 'offer_code')), ''),
            coalesce(p ->> 'audience', 'everyone'), coalesce(nullif(btrim(p ->> 'pages'), ''), '/'), coalesce((p ->> 'delay_seconds')::int, 2),
            coalesce((p ->> 'priority')::int, 0), coalesce((p ->> 'active')::boolean, false),
            nullif(p ->> 'starts_at', '')::timestamptz, nullif(p ->> 'ends_at', '')::timestamptz, me)
    returning * into saved;
  else
    update public.site_popups set
      kind = coalesce(p ->> 'kind', kind), title = coalesce(btrim(p ->> 'title'), title), body = coalesce(p ->> 'body', body),
      steps = coalesce(p -> 'steps', steps), cta_label = nullif(btrim(coalesce(p ->> 'cta_label', cta_label)), ''),
      cta_href = nullif(btrim(coalesce(p ->> 'cta_href', cta_href)), ''), offer_code = nullif(upper(btrim(coalesce(p ->> 'offer_code', offer_code))), ''),
      audience = coalesce(p ->> 'audience', audience), pages = coalesce(nullif(btrim(p ->> 'pages'), ''), pages),
      delay_seconds = coalesce((p ->> 'delay_seconds')::int, delay_seconds), priority = coalesce((p ->> 'priority')::int, priority),
      active = coalesce((p ->> 'active')::boolean, active),
      starts_at = case when p ? 'starts_at' then nullif(p ->> 'starts_at', '')::timestamptz else starts_at end,
      ends_at = case when p ? 'ends_at' then nullif(p ->> 'ends_at', '')::timestamptz else ends_at end,
      version = version + case when coalesce(p_show_again, false) then 1 else 0 end,
      updated_at = now(), updated_by = me
     where id = p_id returning * into saved;
    if saved.id is null then raise exception 'Popup not found.' using errcode = 'P0002'; end if;
  end if;
  if saved.starts_at is not null and saved.ends_at is not null and saved.ends_at <= saved.starts_at then
    raise exception 'The end date must be after the start date.' using errcode = '22023';
  end if;
  insert into public.staff_actions (staff_id, action, subject, detail)
  values (me, 'save_popup', saved.id::text, jsonb_build_object('key', saved.key, 'active', saved.active, 'show_again', coalesce(p_show_again, false)));
  return public.staff_popups();
end;
$$;
revoke execute on function public.staff_save_popup(uuid, jsonb, boolean) from public, anon;
grant execute on function public.staff_save_popup(uuid, jsonb, boolean) to authenticated;
