-- Provenance: migration 019 — saved searches and price-drop alerts.
-- "Tell me when a size 10 Barbour jacket under £60 appears": members save a search; when a listing that
-- matches goes live (or drops into its price range) they get a notification. Members who saved an item
-- hear when its price drops. Both are a new notification group, "alerts", with its own email switch.
-- Safe to re-run.

-- ------------------------------------------------------------
-- 1. Notifications: the alerts group
-- ------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'turn', 'message', 'offer_new', 'offer_counter', 'offer_accepted', 'offer_expiring', 'sold', 'payout', 'dispute', 'decision',
  'search_match', 'price_drop'));
alter table public.notifications drop constraint if exists notifications_grp_check;
alter table public.notifications add constraint notifications_grp_check check (grp in ('turn', 'messages', 'offers', 'sales', 'alerts'));
alter table public.notification_prefs add column if not exists email_alerts boolean not null default true;

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
                 when p_kind like 'offer_%' then 'offers' when p_kind in ('search_match', 'price_drop') then 'alerts' else 'sales' end;
  wants boolean;
begin
  if p_user is null then return; end if;
  select case g when 'turn' then email_turn when 'messages' then email_messages when 'offers' then email_offers
                when 'alerts' then email_alerts else email_sales end
    into wants from public.notification_prefs where user_id = p_user;
  insert into public.notifications (user_id, kind, grp, title, body, link, order_id, offer_id, dedupe_key, email_state, email_after)
  values (p_user, p_kind, g, left(p_title, 200), left(coalesce(p_body, ''), 600), coalesce(p_link, '/inbox'), p_order, p_offer, p_dedupe,
          case when coalesce(wants, true) then 'pending' else 'off' end, now() + p_delay)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;
revoke execute on function public.notify(uuid, text, text, text, text, uuid, uuid, text, interval) from public, anon, authenticated;

create or replace function public.my_notification_prefs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('turn', coalesce(p.email_turn, true), 'messages', coalesce(p.email_messages, true),
                            'offers', coalesce(p.email_offers, true), 'sales', coalesce(p.email_sales, true),
                            'alerts', coalesce(p.email_alerts, true))
    from (select 1) one left join public.notification_prefs p on p.user_id = (select auth.uid())
$$;
revoke execute on function public.my_notification_prefs() from public, anon;
grant execute on function public.my_notification_prefs() to authenticated;

-- Replaces 016's four-switch version (one function, so calls by name are never ambiguous).
drop function if exists public.set_notification_prefs(boolean, boolean, boolean, boolean);
create or replace function public.set_notification_prefs(p_turn boolean, p_messages boolean, p_offers boolean, p_sales boolean, p_alerts boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.notification_prefs (user_id, email_turn, email_messages, email_offers, email_sales, email_alerts, updated_at)
  values (me, coalesce(p_turn, true), coalesce(p_messages, true), coalesce(p_offers, true), coalesce(p_sales, true), coalesce(p_alerts, true), now())
  on conflict (user_id) do update set email_turn = excluded.email_turn, email_messages = excluded.email_messages,
    email_offers = excluded.email_offers, email_sales = excluded.email_sales, email_alerts = excluded.email_alerts, updated_at = now();
  update public.notifications set email_state = 'off'
   where user_id = me and email_state = 'pending'
     and ((grp = 'turn' and not coalesce(p_turn, true)) or (grp = 'messages' and not coalesce(p_messages, true))
       or (grp = 'offers' and not coalesce(p_offers, true)) or (grp = 'sales' and not coalesce(p_sales, true))
       or (grp = 'alerts' and not coalesce(p_alerts, true)));
  return public.my_notification_prefs();
end;
$$;
revoke execute on function public.set_notification_prefs(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_notification_prefs(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- ------------------------------------------------------------
-- 2. Saved searches
-- ------------------------------------------------------------
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  q text check (q is null or char_length(q) <= 100),
  category text check (category is null or category ~ '^[a-z0-9-]{1,40}$'),
  size text check (size is null or char_length(size) <= 40),
  condition text check (condition is null or char_length(condition) <= 40),
  min_pence integer check (min_pence is null or min_pence >= 0),
  max_pence integer check (max_pence is null or max_pence >= 0),
  alert boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists saved_searches_user_idx on public.saved_searches (user_id, created_at desc);
create index if not exists saved_searches_alert_idx on public.saved_searches (category) where alert;
alter table public.saved_searches enable row level security;
do $$ begin
  create policy "members see their own saved searches" on public.saved_searches for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke all on public.saved_searches from anon, authenticated;
grant select on public.saved_searches to authenticated;

-- The same word matching as the website's search box: every word, as a prefix.
create or replace function public.search_tsquery(p_q text)
returns tsquery
language sql
immutable
set search_path = public
as $$
  select case when count(*) = 0 then null else to_tsquery('simple', string_agg(w || ':*', ' & ')) end
    from regexp_split_to_table(lower(regexp_replace(coalesce(p_q, ''), '[^[:alnum:][:space:]]+', ' ', 'g')), '\s+') w
   where w <> ''
$$;

create or replace function public.search_matches(s public.saved_searches, l public.listings)
returns boolean
language sql
stable
set search_path = public
as $$
  select (s.category is null or l.category = s.category)
     and (s.condition is null or l.condition_label = s.condition)
     and (s.min_pence is null or l.price_pence >= s.min_pence)
     and (s.max_pence is null or l.price_pence <= s.max_pence)
     and (s.size is null or lower(btrim(l.size_label)) = lower(btrim(s.size)))
     and (s.q is null or public.search_tsquery(s.q) is null or l.search @@ public.search_tsquery(s.q))
$$;

create or replace function public.saved_search_json(s public.saved_searches)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'q', s.q, 'category', s.category, 'size', s.size, 'condition', s.condition,
    'min_pence', s.min_pence, 'max_pence', s.max_pence, 'alert', s.alert, 'created_at', s.created_at,
    'live_count', (select count(*) from public.listings l
                    where l.published and l.status = 'active' and l.browse_visible and l.seller_id <> s.user_id and public.search_matches(s, l)))
$$;
revoke execute on function public.saved_search_json(public.saved_searches) from public, anon, authenticated;

create or replace function public.my_saved_searches()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.saved_search_json(s) order by s.created_at desc), '[]'::jsonb)
    from public.saved_searches s where s.user_id = (select auth.uid())
$$;
revoke execute on function public.my_saved_searches() from public, anon;
grant execute on function public.my_saved_searches() to authenticated;

create or replace function public.save_search(p_name text, p_q text, p_category text, p_size text, p_condition text, p_min integer, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  s public.saved_searches;
begin
  if me is null then raise exception 'Sign in to save searches.' using errcode = '42501'; end if;
  if (select count(*) from public.saved_searches where user_id = me) >= 20 then
    raise exception 'You can keep up to 20 saved searches. Delete one to add another.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(btrim(p_q), ''), p_category, nullif(btrim(p_size), ''), p_condition, p_min::text, p_max::text) is null then
    raise exception 'Search for something, or choose a filter, before saving.' using errcode = '22023';
  end if;
  if p_min is not null and p_max is not null and p_min > p_max then
    raise exception 'The highest price must be more than the lowest.' using errcode = '22023';
  end if;
  insert into public.saved_searches (user_id, name, q, category, size, condition, min_pence, max_pence)
  values (me, left(coalesce(nullif(btrim(p_name), ''), 'Saved search'), 80), nullif(btrim(p_q), ''), nullif(p_category, ''),
          nullif(btrim(p_size), ''), nullif(p_condition, ''), p_min, p_max)
  returning * into s;
  return public.saved_search_json(s);
end;
$$;
revoke execute on function public.save_search(text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.save_search(text, text, text, text, text, integer, integer) to authenticated;

create or replace function public.set_search_alert(p_id uuid, p_on boolean)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update public.saved_searches set alert = coalesce(p_on, true) where id = p_id and user_id = (select auth.uid());
  select public.my_saved_searches();
$$;
revoke execute on function public.set_search_alert(uuid, boolean) from public, anon;
grant execute on function public.set_search_alert(uuid, boolean) to authenticated;

create or replace function public.delete_saved_search(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  delete from public.saved_searches where id = p_id and user_id = (select auth.uid());
  select public.my_saved_searches();
$$;
revoke execute on function public.delete_saved_search(uuid) from public, anon;
grant execute on function public.delete_saved_search(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. The alerts: a new match, and a price drop on a saved item
-- ------------------------------------------------------------
-- Named to run before listings_record_revision, so the last version is still the previous one.
create or replace function public.listings_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.saved_searches;
  f record;
  price text := public.notify_pounds(new.price_pence);
  was integer;
  dropped boolean := false;
begin
  if not (new.published and new.status = 'active') then
    return null;
  end if;
  -- The price buyers last saw: the live listing's own, or (republished after an edit) the last version's.
  if tg_op = 'UPDATE' and old.published then
    was := old.price_pence;
  elsif tg_op = 'UPDATE' then
    select (r.snapshot ->> 'price_pence')::integer into was from public.listing_revisions r
     where r.listing_id = new.id and r.revision < new.revision order by r.revision desc limit 1;
  end if;
  dropped := was is not null and new.price_pence < was;
  -- Newly live, or cheaper (it may now be in someone's price range).
  if tg_op = 'INSERT' or not old.published or dropped then
    for s in select * from public.saved_searches x
              where x.alert and x.user_id <> new.seller_id and (x.category is null or x.category = new.category) loop
      if public.search_matches(s, new) then
        perform public.notify(s.user_id, 'search_match', 'New match: ' || new.title || ' · ' || price,
          'For your saved search “' || s.name || '”.' || case when new.size_label is not null then ' Size ' || new.size_label || '.' else '' end,
          '/item/' || new.id, null, null, 'search:' || s.id || ':' || coalesce(new.variant_group, new.id));
      end if;
    end loop;
  end if;
  if dropped then
    for f in select user_id from public.favourites where listing_id = new.id and user_id <> new.seller_id loop
      perform public.notify(f.user_id, 'price_drop', 'Price drop: ' || new.title,
        'Now ' || price || ' (was ' || public.notify_pounds(was) || ').', '/item/' || new.id, null, null,
        'drop:' || new.id || ':' || new.price_pence);
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function public.listings_alerts() from public, anon, authenticated;
do $$ begin
  create trigger listings_alerts after insert or update of published, status, price_pence on public.listings
    for each row execute procedure public.listings_alerts();
exception when duplicate_object then null; end $$;
