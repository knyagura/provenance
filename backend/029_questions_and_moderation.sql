-- 029: Questions before buying, reports, and staff moderation.
--
-- Questions: any signed-in member can ask about a live listing ("Does it come up small?"). The seller answers.
-- Answered questions are public on the item page, without the asker's name; unanswered ones are seen only by the
-- asker and the seller. Limits stop spam: 5 questions an hour and 20 a day per member, 3 open ones per listing.
--
-- Reports: members flag a listing or a member (fake, banned item, scam, offensive, wrong category, other). Staff see
-- them grouped in a queue and can dismiss, hide the listing, or suspend the member. Hiding takes the listing off sale
-- (unpublished) and the seller can't put it back. Suspending hides all their listings, holds their payouts, and stops
-- them buying, selling, offering, asking and messaging until staff restore the account. Every decision is recorded
-- in staff_actions with the staff member's name.

-- ------------------------------------------------------------
-- 1. Moderation state
-- ------------------------------------------------------------
alter table public.listings add column if not exists moderated_at timestamptz;
alter table public.listings add column if not exists moderation_note text;
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_reason text;

-- Members can't clear a staff hide, re-publish a hidden listing, or lift their own suspension.
create or replace function public.protect_moderation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_table_name = 'listings' then
      new.moderated_at := case when tg_op = 'INSERT' then null else old.moderated_at end;
      new.moderation_note := case when tg_op = 'INSERT' then null else old.moderation_note end;
      if new.moderated_at is not null and new.published then
        raise exception 'NuTuYu staff have hidden this listing, so it can’t be published. Contact us if you think that’s wrong.' using errcode = '42501';
      end if;
    else
      new.suspended_at := case when tg_op = 'INSERT' then null else old.suspended_at end;
      new.suspended_reason := case when tg_op = 'INSERT' then null else old.suspended_reason end;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_moderation() from public, anon, authenticated;
do $$ begin
  create trigger listings_protect_moderation before insert or update on public.listings for each row execute function public.protect_moderation();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger profiles_protect_moderation before insert or update on public.profiles for each row execute function public.protect_moderation();
exception when duplicate_object then null; end $$;

create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select suspended_at is not null from public.profiles where id = p_user), false) $$;
revoke execute on function public.is_suspended(uuid) from public, anon;
grant execute on function public.is_suspended(uuid) to authenticated;

-- A suspended member can't start anything new. Works whichever function does the insert.
create or replace function public.block_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
begin
  -- One branch per table: plpgsql can't read a column a table doesn't have.
  if tg_table_name = 'orders' then
    who := new.buyer_id;
  elsif tg_table_name = 'offers' then
    who := case when new.made_by = 'seller' then new.seller_id else new.buyer_id end;
  elsif tg_table_name = 'order_messages' then
    who := new.sender_id;
  elsif tg_table_name = 'listing_questions' then
    who := new.asker_id;
  elsif tg_table_name = 'listings' then
    if not (new.published and (tg_op = 'INSERT' or not old.published)) then
      return new;
    end if;
    who := new.seller_id;
  end if;
  if who is not null and public.is_suspended(who) then
    raise exception 'Your account is suspended, so you can’t do that. Contact us if you think that’s wrong.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.block_suspended() from public, anon, authenticated;
do $$ begin
  create trigger orders_block_suspended before insert on public.orders for each row execute function public.block_suspended();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger offers_block_suspended before insert on public.offers for each row execute function public.block_suspended();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger messages_block_suspended before insert on public.order_messages for each row execute function public.block_suspended();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger listings_block_suspended before insert or update of published on public.listings for each row execute function public.block_suspended();
exception when duplicate_object then null; end $$;

-- A suspended seller's new payouts are held.
create or replace function public.payouts_hold_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_suspended(new.seller_id) then
    new.status := 'held';
    new.hold_reason := 'Account suspended';
  end if;
  return new;
end;
$$;
revoke execute on function public.payouts_hold_suspended() from public, anon, authenticated;
do $$ begin
  create trigger payouts_hold_suspended before insert on public.payouts for each row execute function public.payouts_hold_suspended();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 2. Questions
-- ------------------------------------------------------------
create table if not exists public.listing_questions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  asker_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 3 and 500),
  answer text check (answer is null or char_length(btrim(answer)) between 1 and 1000),
  answered_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists listing_questions_listing_idx on public.listing_questions (listing_id, created_at desc);
create index if not exists listing_questions_asker_idx on public.listing_questions (asker_id, created_at desc);
alter table public.listing_questions enable row level security;
revoke all on public.listing_questions from anon, authenticated;
do $$ begin
  create trigger questions_block_suspended before insert on public.listing_questions for each row execute function public.block_suspended();
exception when duplicate_object then null; end $$;

-- What the item page shows: answered questions to everyone; unanswered ones to the asker and the seller.
create or replace function public.listing_questions(p_listing uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'body', q.body, 'answer', q.answer, 'answered_at', q.answered_at, 'created_at', q.created_at,
      'mine', q.asker_id = auth.uid(), 'can_answer', l.seller_id = auth.uid() and q.answer is null)
      order by coalesce(q.answered_at, q.created_at) desc), '[]'::jsonb)
    from public.listing_questions q join public.listings l on l.id = q.listing_id
   where q.listing_id = p_listing and q.hidden_at is null
     and (l.published or l.seller_id = auth.uid())
     and (q.answer is not null or q.asker_id = auth.uid() or l.seller_id = auth.uid())
$$;
revoke execute on function public.listing_questions(uuid) from public;
grant execute on function public.listing_questions(uuid) to anon, authenticated;

create or replace function public.ask_question(p_listing uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  l public.listings;
  t text := btrim(coalesce(p_body, ''));
begin
  if me is null then
    raise exception 'Sign in to ask a question.' using errcode = '42501';
  end if;
  select * into l from public.listings where id = p_listing;
  if not found or not l.published or l.status <> 'active' then
    raise exception 'This item isn’t for sale.' using errcode = 'P0002';
  end if;
  if l.seller_id = me then
    raise exception 'You can’t ask about your own item.' using errcode = '22023';
  end if;
  if char_length(t) not between 3 and 500 then
    raise exception 'Write a question of up to 500 characters.' using errcode = '22023';
  end if;
  -- Contact details would take the sale off NuTuYu, outside buyer protection.
  if t ~* '([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|((\+44|0)7\d{3}[\s-]?\d{6})|(\b(whatsapp|paypal|bank transfer)\b)' then
    raise exception 'Keep contact and payment details out of questions: buying through NuTuYu is what keeps you protected.' using errcode = '22023';
  end if;
  if (select count(*) from public.listing_questions where asker_id = me and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.listing_questions where asker_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That’s a lot of questions. Try again a little later.' using errcode = '54000';
  end if;
  if (select count(*) from public.listing_questions where asker_id = me and listing_id = l.id and answer is null and hidden_at is null) >= 3 then
    raise exception 'Wait for the seller to answer your questions first.' using errcode = '54000';
  end if;
  insert into public.listing_questions (listing_id, asker_id, body) values (l.id, me, t);
  perform public.notify(l.seller_id, 'message', 'Question about ' || l.title, left(t, 400), '/item/' || l.id || '#questions',
    p_dedupe => 'question:' || l.id || ':' || md5(t || now()::text));
  return public.listing_questions(l.id);
end;
$$;
revoke execute on function public.ask_question(uuid, text) from public, anon;
grant execute on function public.ask_question(uuid, text) to authenticated;

create or replace function public.answer_question(p_question uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.listing_questions;
  l public.listings;
  t text := btrim(coalesce(p_answer, ''));
begin
  select * into q from public.listing_questions where id = p_question for update;
  select * into l from public.listings where id = q.listing_id;
  if q.id is null or l.seller_id is distinct from auth.uid() or q.hidden_at is not null then
    raise exception 'Question not found.' using errcode = 'P0002';
  end if;
  if q.answer is not null then
    raise exception 'You’ve already answered this.' using errcode = '55000';
  end if;
  if char_length(t) not between 1 and 1000 then
    raise exception 'Write an answer of up to 1,000 characters.' using errcode = '22023';
  end if;
  if t ~* '([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|((\+44|0)7\d{3}[\s-]?\d{6})' then
    raise exception 'Keep contact details out of answers: buying through NuTuYu is what keeps you both protected.' using errcode = '22023';
  end if;
  update public.listing_questions set answer = t, answered_at = now() where id = q.id;
  perform public.notify(q.asker_id, 'message', 'Answer about ' || l.title, left(t, 400), '/item/' || l.id || '#questions',
    p_dedupe => 'answer:' || q.id);
  return public.listing_questions(l.id);
end;
$$;
revoke execute on function public.answer_question(uuid, text) from public, anon;
grant execute on function public.answer_question(uuid, text) to authenticated;

-- The seller can remove a question (spam, rude); so can the asker, before it's answered.
create or replace function public.remove_question(p_question uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.listing_questions;
  seller uuid;
begin
  select * into q from public.listing_questions where id = p_question for update;
  select seller_id into seller from public.listings where id = q.listing_id;
  if q.id is null or not (seller = auth.uid() or (q.asker_id = auth.uid() and q.answer is null) or public.is_staff()) then
    raise exception 'Question not found.' using errcode = 'P0002';
  end if;
  update public.listing_questions set hidden_at = now() where id = q.id;
  return public.listing_questions(q.listing_id);
end;
$$;
revoke execute on function public.remove_question(uuid) from public, anon;
grant execute on function public.remove_question(uuid) to authenticated;

-- Waiting for the seller's answer, for the selling page.
create or replace function public.my_unanswered_questions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'listing_id', l.id, 'title', l.title, 'body', q.body, 'created_at', q.created_at)
         order by q.created_at), '[]'::jsonb)
    from public.listing_questions q join public.listings l on l.id = q.listing_id
   where l.seller_id = auth.uid() and q.answer is null and q.hidden_at is null
$$;
revoke execute on function public.my_unanswered_questions() from public, anon;
grant execute on function public.my_unanswered_questions() to authenticated;

-- ------------------------------------------------------------
-- 3. Reports
-- ------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  member_id uuid references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('counterfeit', 'prohibited', 'scam', 'offensive', 'wrong_category', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  outcome text,
  created_at timestamptz not null default now(),
  check ((listing_id is null) <> (member_id is null))
);
create unique index if not exists reports_once_listing on public.reports (reporter_id, listing_id) where status = 'open' and listing_id is not null;
create unique index if not exists reports_once_member on public.reports (reporter_id, member_id) where status = 'open' and member_id is not null;
create index if not exists reports_open_idx on public.reports (status, created_at);
create index if not exists reports_listing_idx on public.reports (listing_id);
create index if not exists reports_member_idx on public.reports (member_id);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create or replace function public.report(p_listing uuid, p_member text, p_reason text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target uuid;
  n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null then
    raise exception 'Sign in to report something.' using errcode = '42501';
  end if;
  if (p_listing is null) = (p_member is null) then
    raise exception 'Report one listing or one member.' using errcode = '22023';
  end if;
  if p_reason not in ('counterfeit', 'prohibited', 'scam', 'offensive', 'wrong_category', 'other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  if p_reason = 'other' and n is null then
    raise exception 'Tell us what’s wrong.' using errcode = '22023';
  end if;
  if char_length(coalesce(n, '')) > 1000 then
    raise exception 'Keep it under 1,000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You’ve sent a lot of reports today. Our team will look at them; try again tomorrow.' using errcode = '54000';
  end if;
  if p_listing is not null then
    select seller_id into target from public.listings where id = p_listing and (published or seller_id = me);
    if target is null then raise exception 'Listing not found.' using errcode = 'P0002'; end if;
    if target = me then raise exception 'You can’t report your own listing.' using errcode = '22023'; end if;
    insert into public.reports (reporter_id, listing_id, reason, note) values (me, p_listing, p_reason, n) on conflict do nothing;
  else
    select id into target from public.profiles where lower(username) = lower(btrim(p_member));
    if target is null then raise exception 'Member not found.' using errcode = 'P0002'; end if;
    if target = me then raise exception 'You can’t report yourself.' using errcode = '22023'; end if;
    insert into public.reports (reporter_id, member_id, reason, note) values (me, target, p_reason, n) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.report(uuid, text, text, text) from public, anon;
grant execute on function public.report(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Staff
-- ------------------------------------------------------------
-- Open reports grouped by what was reported, most-reported first.
create or replace function public.staff_moderation(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require();
  return jsonb_build_object(
    'open', (select count(*) from public.reports where status = 'open')::int,
    'suspended', (select count(*) from public.profiles where suspended_at is not null)::int,
    'hidden', (select count(*) from public.listings where moderated_at is not null)::int,
    'items', (select coalesce(jsonb_agg(g order by (g ->> 'count')::int desc, g ->> 'latest' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'kind', case when r.listing_id is not null then 'listing' else 'member' end,
        'listing_id', r.listing_id, 'title', l.title, 'hidden', l.moderated_at is not null,
        'member', coalesce(pm.username, ps.username), 'suspended', coalesce(pm.suspended_at, ps.suspended_at) is not null,
        'count', count(*), 'latest', max(r.created_at),
        'reasons', jsonb_agg(distinct r.reason),
        'notes', (jsonb_agg(r.note order by r.created_at desc) filter (where r.note is not null)),
        'report_ids', jsonb_agg(r.id)) g
        from public.reports r
        left join public.listings l on l.id = r.listing_id
        left join public.profiles ps on ps.id = l.seller_id
        left join public.profiles pm on pm.id = r.member_id
       where r.status = coalesce(p_status, 'open')
       group by r.listing_id, r.member_id, l.title, l.moderated_at, pm.username, ps.username, pm.suspended_at, ps.suspended_at
       limit 100) x)
  );
end;
$$;
revoke execute on function public.staff_moderation(text) from public, anon;
grant execute on function public.staff_moderation(text) to authenticated;

-- One decision about a listing or a member. Closes their open reports as actioned (or dismissed).
create or replace function public.staff_moderate(p_listing uuid, p_member text, p_action text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
  uid uuid;
  v_note text := btrim(coalesce(p_note, ''));
  l public.listings;
begin
  if char_length(v_note) < 3 then
    raise exception 'Add a short note: it’s shown to the member and kept with the decision.' using errcode = '22023';
  end if;
  if p_listing is not null then
    select * into l from public.listings where id = p_listing for update;
    if not found then raise exception 'Listing not found.' using errcode = 'P0002'; end if;
    uid := l.seller_id;
  else
    select id into uid from public.profiles where lower(username) = lower(btrim(p_member));
    if uid is null then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  end if;

  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed', handled_by = me, handled_at = now(), outcome = v_note
     where status = 'open' and (listing_id = p_listing or (p_listing is null and member_id = uid));
  elsif p_action = 'hide_listing' and p_listing is not null then
    update public.listings set moderated_at = now(), moderation_note = v_note, published = false where id = p_listing;
    perform public.notify(uid, 'decision', 'Your listing was hidden: ' || l.title, 'NuTuYu staff took it off sale. ' || v_note, '/sell', p_dedupe => 'hidden:' || p_listing || ':' || now()::text);
  elsif p_action = 'restore_listing' and p_listing is not null then
    if public.is_suspended(uid) then raise exception 'Restore the member’s account first.' using errcode = '55000'; end if;
    update public.listings set moderated_at = null, moderation_note = null, published = true where id = p_listing and moderated_at is not null;
    perform public.notify(uid, 'decision', 'Your listing is back on sale: ' || l.title, v_note, '/item/' || p_listing, p_dedupe => 'restored:' || p_listing || ':' || now()::text);
  elsif p_action = 'suspend' then
    update public.profiles set suspended_at = now(), suspended_reason = v_note where id = uid and suspended_at is null;
    update public.listings set moderated_at = now(), moderation_note = 'Account suspended', published = false
     where seller_id = uid and published and moderated_at is null;
    update public.payouts set status = 'held', hold_reason = 'Account suspended', updated_at = now()
     where seller_id = uid and status in ('waiting', 'queued', 'failed');
    perform public.notify(uid, 'decision', 'Your account is suspended', v_note || ' Contact us if you think this is wrong.', '/contact', p_dedupe => 'suspended:' || uid || ':' || now()::text);
  elsif p_action = 'restore_member' then
    update public.profiles set suspended_at = null, suspended_reason = null where id = uid;
    -- Only listings hidden by the suspension come back; ones hidden for their own reasons stay hidden.
    update public.listings set moderated_at = null, moderation_note = null, published = true
     where seller_id = uid and moderation_note = 'Account suspended' and status = 'active';
    update public.payouts set status = case when exists (select 1 from public.payout_accounts a where a.user_id = uid and a.payouts_enabled) then 'queued' else 'waiting' end,
           hold_reason = null, updated_at = now()
     where seller_id = uid and status = 'held' and hold_reason = 'Account suspended';
    perform public.notify(uid, 'decision', 'Your account is restored', v_note, '/profile', p_dedupe => 'restored-member:' || uid || ':' || now()::text);
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;

  if p_action not in ('dismiss', 'restore_listing', 'restore_member') then
    update public.reports set status = 'actioned', handled_by = me, handled_at = now(), outcome = p_action || ': ' || v_note
     where status = 'open'
       and ((p_listing is not null and listing_id = p_listing)
            or (p_action = 'suspend' and (member_id = uid or listing_id in (select id from public.listings where seller_id = uid))));
  end if;
  insert into public.staff_actions (staff_id, action, subject, detail)
  values (me, 'moderation_' || p_action, coalesce(p_listing::text, uid::text), jsonb_build_object('note', v_note, 'member', uid));
  return public.staff_moderation('open');
end;
$$;
revoke execute on function public.staff_moderate(uuid, text, text, text) from public, anon;
grant execute on function public.staff_moderate(uuid, text, text, text) to authenticated;

-- Sellers see why a listing is hidden (their own only).
create or replace function public.my_hidden_listings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'note', moderation_note, 'at', moderated_at) order by moderated_at desc), '[]'::jsonb)
    from public.listings where seller_id = auth.uid() and moderated_at is not null
$$;
revoke execute on function public.my_hidden_listings() from public, anon;
grant execute on function public.my_hidden_listings() to authenticated;
