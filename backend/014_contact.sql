-- 014: The contact form (privacy requests, account and order questions). Anyone can send a message;
-- only staff can read them. No email address is published on the site.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic text not null check (topic in ('privacy', 'account', 'order', 'other')),
  body text not null check (char_length(body) between 10 and 4000),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id)
);
create index if not exists contact_messages_open_idx on public.contact_messages (created_at desc) where handled_at is null;
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

-- Send a message. A few a day per email address, and a cap per hour overall, to keep spam down.
create or replace function public.submit_contact(p_name text, p_email text, p_topic text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Enter your name.' using errcode = '22023';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(e) > 200 then
    raise exception 'Enter an email address we can reply to.' using errcode = '22023';
  end if;
  if coalesce(p_topic, '') not in ('privacy', 'account', 'order', 'other') then
    raise exception 'Choose what your message is about.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 4000 then
    raise exception 'Write a message of 10 to 4,000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.contact_messages where email = e and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You’ve sent several messages today. We’ll reply to those first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.contact_messages where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'We’re getting a lot of messages right now. Please try again in an hour.' using errcode = 'P0001';
  end if;
  insert into public.contact_messages (user_id, name, email, topic, body)
  values (auth.uid(), btrim(p_name), e, p_topic, btrim(p_body));
end;
$$;
revoke execute on function public.submit_contact(text, text, text, text) from public;
grant execute on function public.submit_contact(text, text, text, text) to anon, authenticated;

create or replace function public.staff_contact_messages(p_open_only boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'created_at', m.created_at, 'name', m.name, 'email', m.email, 'topic', m.topic, 'body', m.body,
      'member', (select username from public.profiles where id = m.user_id),
      'handled_at', m.handled_at, 'handled_by', (select username from public.profiles where id = m.handled_by)) order by m.created_at desc)
    from (select * from public.contact_messages where not coalesce(p_open_only, true) or handled_at is null order by created_at desc limit 200) m), '[]'::jsonb);
end;
$$;
revoke execute on function public.staff_contact_messages(boolean) from public, anon;
grant execute on function public.staff_contact_messages(boolean) to authenticated;

create or replace function public.staff_contact_handled(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
begin
  update public.contact_messages set handled_at = now(), handled_by = me where id = p_id and handled_at is null;
  insert into public.staff_actions (staff_id, action, subject) values (me, 'contact_handled', p_id::text);
end;
$$;
revoke execute on function public.staff_contact_handled(uuid) from public, anon;
grant execute on function public.staff_contact_handled(uuid) to authenticated;
