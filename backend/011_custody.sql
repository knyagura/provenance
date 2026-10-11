-- Provenance: migration 011 — orders and custody (build step 6).
-- Run AFTER 010. Safe to re-run. Contains no DROP statements.
--
-- The custody chain moves from the browser to the database. The rules are the prototype's (seals,
-- a hash chain, one-time challenge codes), but now only the server can say a step happened:
--   * Each step is accepted only from the person who holds that role on the order (seller, buyer, an
--     independent courier, an authentication hub), only when it is next, and only with its evidence.
--   * Every accepted step is written to custody_events: append-only (no update, delete or truncate,
--     for anyone) and hash-chained, so a changed record breaks every hash after it.
--   * Seal codes are issued by the server. A seal is checked by someone who never saw its code; a
--     different code puts the order on hold. Challenge codes are issued by the server, last a few
--     minutes and work once.
--   * Payment is released (payout due) only when the buyer confirms, or automatically after the
--     protection window. Disputes hold it.
-- Evidence photos and videos go to a private bucket, custody-media, readable only by the order's people.

-- ------------------------------------------------------------
-- 1. Settings (one row; the staff console will edit it)
-- ------------------------------------------------------------
create table if not exists public.custody_settings (
  id smallint primary key default 1 check (id = 1),
  challenge_minutes integer not null default 10 check (challenge_minutes between 1 and 60),
  confirm_window_hours integer not null default 48 check (confirm_window_hours between 1 and 720),
  enhanced_confirm_days integer not null default 7 check (enhanced_confirm_days between 1 and 60),
  weight_tolerance_grams integer not null default 50 check (weight_tolerance_grams between 0 and 10000),
  weight_tolerance_pct integer not null default 5 check (weight_tolerance_pct between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.custody_settings (id) values (1) on conflict (id) do nothing;
alter table public.custody_settings enable row level security;
do $$ begin
  create policy "anyone can read the custody rules" on public.custody_settings for select using (true);
exception when duplicate_object then null; end $$;
grant select on public.custody_settings to anon, authenticated;

-- ------------------------------------------------------------
-- 2. Couriers and authentication hubs (independent of buyer and seller)
-- ------------------------------------------------------------
create table if not exists public.custody_agents (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('courier', 'hub')),
  organisation text not null check (char_length(organisation) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.custody_agents enable row level security;
do $$ begin
  create policy "agents see their own record" on public.custody_agents for select using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.custody_agents from anon, authenticated;
grant select on public.custody_agents to authenticated;

-- ------------------------------------------------------------
-- 3. Custody on the order
-- ------------------------------------------------------------
alter table public.orders add column if not exists custody_tier text;
alter table public.orders add column if not exists custody_state text not null default 'not_started';
alter table public.orders add column if not exists custody_step integer not null default 0;
alter table public.orders add column if not exists custody_head text not null default '0';
alter table public.orders add column if not exists custody_updated_at timestamptz;
alter table public.orders add column if not exists weight_flag boolean not null default false;
alter table public.orders add column if not exists dispute_reason text;
alter table public.orders add column if not exists disputed_at timestamptz;
alter table public.orders add column if not exists confirmed_at timestamptz;
alter table public.orders add column if not exists payout_status text not null default 'held';
do $$ begin
  alter table public.orders add constraint orders_custody_state_check
    check (custody_state in ('not_started', 'in_progress', 'confirmed', 'disputed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_payout_status_check check (payout_status in ('held', 'due', 'paid', 'refund'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_custody_tier_check
    check (custody_tier is null or custody_tier in ('enhanced', 'verified', 'luxury', 'ultraLuxury'));
exception when duplicate_object then null; end $$;
create index if not exists orders_custody_queue_idx on public.orders (custody_state, custody_tier) where payment_status = 'paid';

-- Buyers and sellers can never set custody fields themselves. Only legacy orders (the single-file app)
-- keep their client-written status.
create or replace function public.protect_order_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.listing_id := old.listing_id;
    new.buyer_id := old.buyer_id;
    new.seller_id := old.seller_id;
    new.price_pence := old.price_pence;
    new.protection_payer := old.protection_payer;
    new.shipping_choice := old.shipping_choice;
    new.fees := old.fees;
    new.created_at := old.created_at;
    new.payment_status := old.payment_status;
    new.total_pence := old.total_pence;
    new.postage_pence := old.postage_pence;
    new.fee_version := old.fee_version;
    new.payment_ref := old.payment_ref;
    new.paid_at := old.paid_at;
    new.hold_expires_at := old.hold_expires_at;
    new.listing_revision := old.listing_revision;
    new.listing_snapshot := old.listing_snapshot;
    new.custody_tier := old.custody_tier;
    new.custody_state := old.custody_state;
    new.custody_step := old.custody_step;
    new.custody_head := old.custody_head;
    new.custody_updated_at := old.custody_updated_at;
    new.weight_flag := old.weight_flag;
    new.dispute_reason := old.dispute_reason;
    new.disputed_at := old.disputed_at;
    new.confirmed_at := old.confirmed_at;
    new.payout_status := old.payout_status;
    if old.payment_status <> 'legacy' then
      new.status := old.status;
      new.timeline_state := old.timeline_state;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_order_fields() from public, anon, authenticated;

-- Custody starts the moment an order is paid, whichever way the payment arrives.
create or replace function public.orders_custody_begin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.custody_state = 'not_started' then
    new.custody_tier := coalesce(nullif(new.fees ->> 'tier', ''), 'enhanced');
    new.custody_state := 'in_progress';
    new.custody_step := 0;
    new.custody_head := '0';
    new.custody_updated_at := now();
    new.payout_status := 'held';
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_custody_begin() from public, anon, authenticated;
do $$ begin
  create trigger orders_custody_begin before update of payment_status on public.orders
    for each row execute procedure public.orders_custody_begin();
exception when duplicate_object then null; end $$;

update public.orders
   set custody_tier = coalesce(nullif(fees ->> 'tier', ''), 'enhanced'), custody_state = 'in_progress', custody_updated_at = coalesce(paid_at, now())
 where payment_status = 'paid' and custody_state = 'not_started';

-- ------------------------------------------------------------
-- 4. The steps for each tier (must match backend/fixtures/custody_plans.json)
-- ------------------------------------------------------------
create or replace function public.custody_plan(p_tier text)
returns jsonb
language sql
immutable
set search_path = public
as $plan$
  select coalesce(p -> p_tier, p -> 'enhanced')
    from (select '{"enhanced":[{"key":"pack_photo","actor":"seller","needs":["photo"]},{"key":"ship","actor":"seller","needs":["tracking"]},{"key":"confirm","actor":"buyer","needs":[]}],"verified":[{"key":"handover_code","actor":"seller","needs":["code","video"]},{"key":"handover_item","actor":"seller","needs":["photo"]},{"key":"handover_weight","actor":"seller","needs":["grams"]},{"key":"handover_seal","actor":"seller","needs":["seal"],"seal":"proof","sealMode":"apply"},{"key":"handover_sealed","actor":"seller","needs":["photo"]},{"key":"courier_pickup","actor":"courier","needs":["attest","tracking"]},{"key":"courier_delivery","actor":"courier","needs":["grams"]},{"key":"unbox_code","actor":"buyer","needs":["code","video"]},{"key":"unbox_seal","actor":"buyer","needs":["seal"],"seal":"proof","sealMode":"check"},{"key":"unbox_item","actor":"buyer","needs":["photo"]},{"key":"witness_opening","actor":"courier","needs":["attest"]},{"key":"confirm","actor":"buyer","needs":[]}],"luxury":[{"key":"handover_code","actor":"seller","needs":["code","video"]},{"key":"handover_item","actor":"seller","needs":["photo"]},{"key":"handover_item_seal","actor":"seller","needs":["seal"],"seal":"item","sealMode":"apply"},{"key":"handover_weight","actor":"seller","needs":["grams"]},{"key":"handover_seal","actor":"seller","needs":["seal"],"seal":"proof","sealMode":"apply"},{"key":"handover_sealed","actor":"seller","needs":["photo"]},{"key":"courier_pickup","actor":"courier","needs":["attest","tracking"]},{"key":"hub_seal","actor":"hub","needs":["seal"],"seal":"proof","sealMode":"check"},{"key":"hub_item_seal","actor":"hub","needs":["seal"],"seal":"item","sealMode":"check"},{"key":"hub_code","actor":"hub","needs":["code","video"]},{"key":"hub_inspect","actor":"hub","needs":["photo"]},{"key":"hub_authenticate","actor":"hub","needs":["result"]},{"key":"hub_reseal","actor":"hub","needs":["seal","grams"],"seal":"proof_b","sealMode":"apply"},{"key":"courier_delivery","actor":"courier","needs":["grams"]},{"key":"unbox_code","actor":"buyer","needs":["code","video"]},{"key":"unbox_seal","actor":"buyer","needs":["seal"],"seal":"proof_b","sealMode":"check"},{"key":"unbox_item_seal","actor":"buyer","needs":["seal"],"seal":"item","sealMode":"check"},{"key":"unbox_item","actor":"buyer","needs":["photo"]},{"key":"witness_opening","actor":"courier","needs":["attest"]},{"key":"confirm","actor":"buyer","needs":[]}],"ultraLuxury":[{"key":"handover_code","actor":"seller","needs":["code","video"]},{"key":"handover_item","actor":"seller","needs":["photo"]},{"key":"handover_item_seal","actor":"seller","needs":["seal"],"seal":"item","sealMode":"apply"},{"key":"handover_weight","actor":"seller","needs":["grams"]},{"key":"handover_seal","actor":"seller","needs":["seal"],"seal":"proof","sealMode":"apply"},{"key":"handover_sealed","actor":"seller","needs":["photo"]},{"key":"courier_pickup","actor":"courier","needs":["attest","tracking"]},{"key":"hub_seal","actor":"hub","needs":["seal"],"seal":"proof","sealMode":"check"},{"key":"hub_item_seal","actor":"hub","needs":["seal"],"seal":"item","sealMode":"check"},{"key":"hub_code","actor":"hub","needs":["code","video"]},{"key":"hub_inspect","actor":"hub","needs":["photo"]},{"key":"hub_authenticate","actor":"hub","needs":["result"]},{"key":"hub_second_opinion","actor":"hub2","needs":["result"]},{"key":"hub_reseal","actor":"hub","needs":["seal","grams"],"seal":"proof_b","sealMode":"apply"},{"key":"courier_delivery","actor":"courier","needs":["grams"]},{"key":"unbox_code","actor":"buyer","needs":["code","video"]},{"key":"unbox_seal","actor":"buyer","needs":["seal"],"seal":"proof_b","sealMode":"check"},{"key":"unbox_item_seal","actor":"buyer","needs":["seal"],"seal":"item","sealMode":"check"},{"key":"unbox_item","actor":"buyer","needs":["photo"]},{"key":"witness_opening","actor":"courier","needs":["attest"]},{"key":"confirm","actor":"buyer","needs":[]}]}'::jsonb as p) plans
$plan$;
grant execute on function public.custody_plan(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 5. The hash chain
-- ------------------------------------------------------------
-- Evidence as text: keys in byte order, "key=<bytes>:<value>" joined by ";". Same as lib/domain/custody.ts.
create or replace function public.custody_canonical(p_evidence jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(key || '=' || octet_length(value) || ':' || value, ';' order by key collate "C"), '')
    from jsonb_each_text(coalesce(p_evidence, '{}'::jsonb))
$$;

create or replace function public.custody_hash(p_prev text, p_order uuid, p_seq integer, p_step text, p_role text, p_actor uuid, p_evidence jsonb, p_at timestamptz)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(
    p_prev || '|' || p_order::text || '|' || p_seq || '|' || p_step || '|' || p_role || '|' || coalesce(p_actor::text, '') || '|' ||
    public.custody_canonical(p_evidence) || '|' || to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'UTF8')), 'hex')
$$;
grant execute on function public.custody_canonical(jsonb) to anon, authenticated;
grant execute on function public.custody_hash(text, uuid, integer, text, text, uuid, jsonb, timestamptz) to anon, authenticated;

create table if not exists public.custody_events (
  order_id uuid not null references public.orders(id) on delete restrict,
  seq integer not null check (seq > 0),
  step text not null,
  actor_role text not null check (actor_role in ('seller', 'buyer', 'courier', 'hub', 'hub2', 'system')),
  actor_id uuid references public.profiles(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb,
  at timestamptz not null,
  prev_hash text not null,
  hash text not null,
  primary key (order_id, seq)
);
alter table public.custody_events enable row level security;
-- No policies: people read their orders' events through order_custody(), which hides codes they must check.
revoke all on public.custody_events from anon, authenticated;

create or replace function public.custody_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Custody records can never be changed or removed.' using errcode = '42501';
end;
$$;
revoke execute on function public.custody_events_append_only() from public, anon, authenticated;
do $$ begin
  create trigger custody_events_no_change before update or delete on public.custody_events
    for each row execute procedure public.custody_events_append_only();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger custody_events_no_truncate before truncate on public.custody_events
    for each statement execute procedure public.custody_events_append_only();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 6. Seals and challenge codes (issued by the server only)
-- ------------------------------------------------------------
create table if not exists public.custody_seals (
  order_id uuid not null references public.orders(id) on delete restrict,
  kind text not null check (kind in ('proof', 'proof_b', 'item')),
  code text not null unique,
  issued_to uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  applied_at timestamptz,
  primary key (order_id, kind)
);
alter table public.custody_seals enable row level security;
revoke all on public.custody_seals from anon, authenticated;

create table if not exists public.custody_challenges (
  order_id uuid not null references public.orders(id) on delete restrict,
  step text not null,
  code text not null check (code ~ '^\d{6}$'),
  issued_to uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  primary key (order_id, step)
);
alter table public.custody_challenges enable row level security;
revoke all on public.custody_challenges from anon, authenticated;

-- Crockford base32 (no I, L, O, U), so codes can be read aloud and typed without confusion.
create or replace function public.custody_new_seal_code(p_prefix text)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea;
  out text := '';
  i integer;
  idx integer[] := array[0, 1, 2, 3, 4, 5, 9, 10]; -- skip the uuid's version and variant bytes
begin
  loop
    b := uuid_send(gen_random_uuid());
    out := '';
    foreach i in array idx loop
      out := out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    out := p_prefix || '-' || substr(out, 1, 4) || '-' || substr(out, 5, 4);
    exit when not exists (select 1 from public.custody_seals where code = out);
  end loop;
  return out;
end;
$$;
revoke execute on function public.custody_new_seal_code(text) from public, anon, authenticated;

create or replace function public.custody_new_challenge()
returns text
language sql
volatile
set search_path = public
as $$
  select lpad((((get_byte(b, 0)::bigint << 24) | (get_byte(b, 1) << 16) | (get_byte(b, 2) << 8) | get_byte(b, 3)) % 1000000)::text, 6, '0')
    from (select uuid_send(gen_random_uuid()) as b) x
$$;
revoke execute on function public.custody_new_challenge() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 7. Who may act
-- ------------------------------------------------------------
-- The roles a person holds on an order. Couriers and hubs never act on an order they bought or sold.
create or replace function public.custody_roles(p_order public.orders, p_uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when p_uid = p_order.seller_id then 'seller' end,
    case when p_uid = p_order.buyer_id then 'buyer' end,
    case when a.role = 'courier' and p_uid not in (p_order.buyer_id, p_order.seller_id) then 'courier' end,
    case when a.role = 'hub' and p_uid not in (p_order.buyer_id, p_order.seller_id) then 'hub' end,
    case when a.role = 'hub' and p_uid not in (p_order.buyer_id, p_order.seller_id) then 'hub2' end
  ], null)
  from (select 1) one
  left join public.custody_agents a on a.user_id = p_uid and a.active
$$;
revoke execute on function public.custody_roles(public.orders, uuid) from public, anon, authenticated;

create or replace function public.custody_current(p_order public.orders)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case when p_order.custody_state = 'in_progress' then public.custody_plan(p_order.custody_tier) -> p_order.custody_step end
$$;
revoke execute on function public.custody_current(public.orders) from public, anon, authenticated;

-- Agents see an order while it is their turn, and afterwards if they acted on it.
create or replace function public.custody_can_view(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order and o.payment_status = 'paid'
       and ((select auth.uid()) in (o.buyer_id, o.seller_id)
            or (public.custody_current(o) ->> 'actor') = any (public.custody_roles(o, (select auth.uid())))
            or exists (select 1 from public.custody_events e where e.order_id = o.id and e.actor_id = (select auth.uid())))
  )
$$;
revoke execute on function public.custody_can_view(uuid) from public, anon;
grant execute on function public.custody_can_view(uuid) to authenticated;

create or replace function public.custody_can_upload(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order and o.payment_status = 'paid' and o.custody_state = 'in_progress'
       and (public.custody_current(o) ->> 'actor') = any (public.custody_roles(o, (select auth.uid())))
  )
$$;
revoke execute on function public.custody_can_upload(uuid) from public, anon;
grant execute on function public.custody_can_upload(uuid) to authenticated;

-- A uuid folder name, safely: anything else is not an order.
create or replace function public.custody_folder_order(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|webm|mov)$'
              then split_part(p_name, '/', 1)::uuid end
$$;
grant execute on function public.custody_folder_order(text) to authenticated;

-- ------------------------------------------------------------
-- 8. Private evidence storage
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custody-media', 'custody-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

do $$ begin
  create policy "the person whose turn it is uploads custody evidence" on storage.objects for insert to authenticated
    with check (bucket_id = 'custody-media' and public.custody_can_upload(public.custody_folder_order(name)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "an order's people view its custody evidence" on storage.objects for select to authenticated
    using (bucket_id = 'custody-media' and public.custody_can_view(public.custody_folder_order(name)));
exception when duplicate_object then null; end $$;
-- No update or delete policies: evidence files can't be replaced or removed.

-- ------------------------------------------------------------
-- 9. Codes for the person whose turn it is
-- ------------------------------------------------------------
create or replace function public.issue_challenge(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
  cur jsonb;
  ttl integer;
  c public.custody_challenges%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or me is null or not public.custody_can_view(p_order) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  cur := public.custody_current(o);
  if cur is null or not (cur -> 'needs') ? 'code' then
    raise exception 'This step doesn’t need a code.' using errcode = 'P0001';
  end if;
  if not (cur ->> 'actor') = any (public.custody_roles(o, me)) then
    raise exception 'This step is for the %.', cur ->> 'actor' using errcode = '42501';
  end if;
  select challenge_minutes into ttl from public.custody_settings where id = 1;
  insert into public.custody_challenges (order_id, step, code, issued_to, issued_at, expires_at, used_at)
  values (o.id, cur ->> 'key', public.custody_new_challenge(), me, now(), now() + make_interval(mins => ttl), null)
  on conflict (order_id, step) do update
    set code = excluded.code, issued_to = excluded.issued_to, issued_at = excluded.issued_at, expires_at = excluded.expires_at, used_at = null
  returning * into c;
  return jsonb_build_object('step', c.step, 'code', c.code, 'expires_at', c.expires_at);
end;
$$;
revoke execute on function public.issue_challenge(uuid) from public, anon;
grant execute on function public.issue_challenge(uuid) to authenticated;

create or replace function public.issue_seal(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
  cur jsonb;
  k text;
  sl public.custody_seals%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or me is null or not public.custody_can_view(p_order) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  cur := public.custody_current(o);
  if cur is null or cur ->> 'sealMode' is distinct from 'apply' then
    raise exception 'This step doesn’t fit a seal.' using errcode = 'P0001';
  end if;
  if not (cur ->> 'actor') = any (public.custody_roles(o, me)) then
    raise exception 'This step is for the %.', cur ->> 'actor' using errcode = '42501';
  end if;
  k := cur ->> 'seal';
  select * into sl from public.custody_seals where order_id = o.id and kind = k;
  if not found then
    insert into public.custody_seals (order_id, kind, code, issued_to)
    values (o.id, k, public.custody_new_seal_code(case k when 'proof' then 'PS' when 'proof_b' then 'PB' else 'IS' end), me)
    returning * into sl;
  end if;
  return jsonb_build_object('kind', sl.kind, 'code', sl.code);
end;
$$;
revoke execute on function public.issue_seal(uuid) from public, anon;
grant execute on function public.issue_seal(uuid) to authenticated;

-- ------------------------------------------------------------
-- 10. Writing to the chain
-- ------------------------------------------------------------
create or replace function public.custody_append(p_order public.orders, p_step text, p_role text, p_actor uuid, p_evidence jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  n integer;
  t timestamptz := date_trunc('milliseconds', clock_timestamp());
  h text;
begin
  select coalesce(max(seq), 0) + 1 into n from public.custody_events where order_id = p_order.id;
  h := public.custody_hash(p_order.custody_head, p_order.id, n, p_step, p_role, p_actor, p_evidence, t);
  insert into public.custody_events (order_id, seq, step, actor_role, actor_id, evidence, at, prev_hash, hash)
  values (p_order.id, n, p_step, p_role, p_actor, p_evidence, t, p_order.custody_head, h);
  return h;
end;
$$;
revoke execute on function public.custody_append(public.orders, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.record_custody_step(p_order uuid, p_step text, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
  cfg public.custody_settings%rowtype;
  cur jsonb;
  role text;
  need text;
  e jsonb := '{}'::jsonb;
  v text;
  g integer;
  ref integer;
  sl public.custody_seals%rowtype;
  ch public.custody_challenges%rowtype;
  dispute text;
  h text;
  first_hub uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or me is null or not public.custody_can_view(p_order) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if o.custody_state = 'confirmed' then
    raise exception 'This order is already complete.' using errcode = 'P0001';
  end if;
  if o.custody_state = 'disputed' then
    raise exception 'This order is on hold while a problem is looked into.' using errcode = 'P0001';
  end if;
  cur := public.custody_current(o);
  if cur is null then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if p_step is distinct from cur ->> 'key' then
    raise exception 'That step isn’t next. Refresh to see where this order is.' using errcode = 'P0001', hint = 'out_of_order';
  end if;
  role := cur ->> 'actor';
  if not role = any (public.custody_roles(o, me)) then
    raise exception 'This step is for the %.', role using errcode = '42501';
  end if;
  if role = 'hub2' then
    select actor_id into first_hub from public.custody_events where order_id = o.id and step = 'hub_authenticate' order by seq desc limit 1;
    if first_hub = me then
      raise exception 'The second opinion must come from a different authenticator.' using errcode = '42501';
    end if;
  end if;
  select * into cfg from public.custody_settings where id = 1;
  p_evidence := coalesce(p_evidence, '{}'::jsonb);

  for need in select jsonb_array_elements_text(cur -> 'needs') loop
    if need in ('photo', 'video') then
      v := p_evidence ->> 'media';
      if v is null or public.custody_folder_order(v) is distinct from o.id
         or (need = 'photo' and v !~ '\.(jpg|jpeg|png|webp)$') or (need = 'video' and v !~ '\.(mp4|webm|mov)$') then
        raise exception 'Add the %.', need using errcode = '22023';
      end if;
      if not exists (select 1 from storage.objects so where so.bucket_id = 'custody-media' and so.name = v
                       and coalesce(to_jsonb(so) ->> 'owner_id', to_jsonb(so) ->> 'owner') = me::text) then
        raise exception 'That % hasn’t finished uploading.', need using errcode = '22023';
      end if;
      if exists (select 1 from public.custody_events x where x.order_id = o.id and x.evidence ->> 'media' = v) then
        raise exception 'That % is already part of this order’s record. Take a new one.', need using errcode = '22023';
      end if;
      if coalesce(p_evidence ->> 'media_sha256', '') !~ '^[0-9a-f]{64}$' then
        raise exception 'Add the %.', need using errcode = '22023';
      end if;
      e := e || jsonb_build_object('media', v, 'media_kind', need, 'media_sha256', p_evidence ->> 'media_sha256');
    elsif need = 'code' then
      select * into ch from public.custody_challenges where order_id = o.id and step = cur ->> 'key' for update;
      if not found or ch.issued_to <> me or ch.used_at is not null or ch.expires_at < now()
         or ch.code is distinct from (p_evidence ->> 'code') then
        raise exception 'That code has expired or doesn’t match. Start again for a new code.' using errcode = '22023', hint = 'challenge';
      end if;
      update public.custody_challenges set used_at = now() where order_id = o.id and step = ch.step;
      e := e || jsonb_build_object('code', ch.code, 'code_issued_at', to_char(ch.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    elsif need = 'grams' then
      v := p_evidence ->> 'grams';
      if v is null or v !~ '^\d{1,6}$' or v::integer not between 1 and 100000 then
        raise exception 'Enter the weight in whole grams.' using errcode = '22023';
      end if;
      g := v::integer;
      e := e || jsonb_build_object('grams', g);
      if cur ->> 'key' = 'courier_delivery' then
        select (evidence ->> 'grams')::integer into ref from public.custody_events
         where order_id = o.id and step in ('handover_weight', 'hub_reseal') order by seq desc limit 1;
        if ref is not null and abs(g - ref) > greatest(cfg.weight_tolerance_grams, ref * cfg.weight_tolerance_pct / 100) then
          e := e || jsonb_build_object('weight_flag', true, 'packed_grams', ref);
          o.weight_flag := true;
        end if;
      end if;
    elsif need = 'seal' then
      v := upper(coalesce(p_evidence ->> 'seal', ''));
      if v !~ '^(PS|PB|IS)-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then
        raise exception 'Enter the seal code, like PS-7K2M-9QXD.' using errcode = '22023';
      end if;
      select * into sl from public.custody_seals where order_id = o.id and kind = cur ->> 'seal' for update;
      if cur ->> 'sealMode' = 'apply' then
        if not found or sl.code <> v then
          raise exception 'That isn’t the seal code issued for this parcel.' using errcode = '22023';
        end if;
        update public.custody_seals set applied_at = now() where order_id = o.id and kind = sl.kind;
        e := e || jsonb_build_object('seal', v, 'seal_kind', sl.kind);
      else
        if not found or sl.applied_at is null then
          raise exception 'Order not found.' using errcode = 'P0002';
        end if;
        e := e || jsonb_build_object('seal', v, 'seal_kind', sl.kind, 'match', sl.code = v);
        if sl.code <> v then
          dispute := 'seal_mismatch';
        end if;
      end if;
    elsif need = 'tracking' then
      v := btrim(coalesce(p_evidence ->> 'carrier', ''));
      if char_length(v) not between 1 and 40 then
        raise exception 'Enter the carrier.' using errcode = '22023';
      end if;
      e := e || jsonb_build_object('carrier', v);
      v := btrim(coalesce(p_evidence ->> 'tracking', ''));
      if v !~ '^[A-Za-z0-9 -]{6,40}$' then
        raise exception 'Enter the tracking number.' using errcode = '22023';
      end if;
      e := e || jsonb_build_object('tracking', v);
    elsif need = 'attest' then
      if (p_evidence -> 'attest') is distinct from 'true'::jsonb then
        raise exception 'Tick to confirm.' using errcode = '22023';
      end if;
      e := e || jsonb_build_object('attest', true);
    elsif need = 'result' then
      v := p_evidence ->> 'result';
      if v is null or v not in ('pass', 'fail') then
        raise exception 'Choose pass or fail.' using errcode = '22023';
      end if;
      e := e || jsonb_build_object('result', v);
      if v = 'fail' then
        dispute := 'failed_authentication';
      end if;
    end if;
  end loop;
  v := btrim(coalesce(p_evidence ->> 'note', ''));
  if char_length(v) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = '22023';
  elsif v <> '' then
    e := e || jsonb_build_object('note', v);
  end if;

  h := public.custody_append(o, cur ->> 'key', role, me, e);
  update public.orders
     set custody_step = o.custody_step + 1,
         custody_head = h,
         custody_updated_at = now(),
         weight_flag = o.weight_flag,
         custody_state = case when dispute is not null then 'disputed' when cur ->> 'key' = 'confirm' then 'confirmed' else 'in_progress' end,
         dispute_reason = coalesce(dispute, dispute_reason),
         disputed_at = case when dispute is not null then now() else disputed_at end,
         confirmed_at = case when dispute is null and cur ->> 'key' = 'confirm' then now() else confirmed_at end,
         payout_status = case when dispute is null and cur ->> 'key' = 'confirm' then 'due' else payout_status end
   where id = o.id;
  return public.order_custody(p_order);
end;
$$;

-- The buyer can report a problem at any point before confirming. Payment stays held.
create or replace function public.open_dispute(p_order uuid, p_reason text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
  e jsonb;
  h text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or me is null or me <> o.buyer_id or o.payment_status <> 'paid' then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if o.custody_state <> 'in_progress' then
    raise exception 'This order can’t be disputed now.' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('not_as_described', 'not_arrived', 'damaged', 'other') then
    raise exception 'Choose what went wrong.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = '22023';
  end if;
  e := jsonb_build_object('reason', p_reason);
  if btrim(coalesce(p_note, '')) <> '' then
    e := e || jsonb_build_object('note', btrim(p_note));
  end if;
  h := public.custody_append(o, 'dispute', 'buyer', me, e);
  update public.orders set custody_head = h, custody_updated_at = now(), custody_state = 'disputed',
                           dispute_reason = p_reason, disputed_at = now()
   where id = o.id;
  return public.order_custody(p_order);
end;
$$;
revoke execute on function public.open_dispute(uuid, text, text) from public, anon;
grant execute on function public.open_dispute(uuid, text, text) to authenticated;

-- Confirms orders whose buyer did nothing within the protection window (run by a schedule, see 011b).
create or replace function public.auto_confirm_custody()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.custody_settings%rowtype;
  o public.orders%rowtype;
  h text;
  n integer := 0;
begin
  select * into cfg from public.custody_settings where id = 1;
  for o in
    select * from public.orders
     where payment_status = 'paid' and custody_state = 'in_progress'
       and public.custody_current(orders) ->> 'key' = 'confirm'
       and custody_updated_at < now() - case when custody_tier = 'enhanced' then make_interval(days => cfg.enhanced_confirm_days)
                                             else make_interval(hours => cfg.confirm_window_hours) end
     for update skip locked
  loop
    h := public.custody_append(o, 'confirm', 'system', null, jsonb_build_object('auto', true));
    update public.orders set custody_step = o.custody_step + 1, custody_head = h, custody_updated_at = now(),
                             custody_state = 'confirmed', confirmed_at = now(), payout_status = 'due'
     where id = o.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.auto_confirm_custody() from public, anon, authenticated;
grant execute on function public.auto_confirm_custody() to service_role;

-- ------------------------------------------------------------
-- 11. Reading an order's custody
-- ------------------------------------------------------------
create or replace function public.order_custody(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
  roles text[];
  plan jsonb;
  cur jsonb;
  ev jsonb := '[]'::jsonb;
  r record;
  prev text := '0';
  ok boolean := true;
  hidden text[];
  evd jsonb;
  ch public.custody_challenges%rowtype;
  challenge jsonb;
  seal jsonb;
  sl public.custody_seals%rowtype;
begin
  select * into o from public.orders where id = p_order;
  if not found or me is null or not public.custody_can_view(p_order) then
    return null;
  end if;
  roles := public.custody_roles(o, me);
  plan := public.custody_plan(o.custody_tier);
  cur := public.custody_current(o);
  -- Seal kinds this person must still check: never show them those codes.
  select coalesce(array_agg(distinct s ->> 'seal'), '{}') into hidden
    from jsonb_array_elements(plan) with ordinality as p(s, i)
   where s ->> 'sealMode' = 'check' and (s ->> 'actor') = any (roles) and o.custody_state = 'in_progress' and i - 1 >= o.custody_step;

  for r in select * from public.custody_events where order_id = o.id order by seq loop
    if r.prev_hash <> prev or r.hash <> public.custody_hash(r.prev_hash, r.order_id, r.seq, r.step, r.actor_role, r.actor_id, r.evidence, r.at) then
      ok := false;
    end if;
    prev := r.hash;
    evd := r.evidence;
    if evd ? 'seal' and (evd ->> 'seal_kind') = any (hidden) and r.actor_id is distinct from me then
      evd := evd - 'seal' || jsonb_build_object('seal', 'hidden until you check it');
    end if;
    ev := ev || jsonb_build_object('seq', r.seq, 'step', r.step, 'actor_role', r.actor_role,
                                   'at', to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                   'evidence', evd, 'hash', r.hash, 'mine', r.actor_id = me);
  end loop;
  if prev <> o.custody_head then
    ok := false;
  end if;

  if cur is not null and (cur ->> 'actor') = any (roles) then
    select * into ch from public.custody_challenges
     where order_id = o.id and step = cur ->> 'key' and issued_to = me and used_at is null and expires_at > now();
    if found then
      challenge := jsonb_build_object('code', ch.code, 'expires_at', ch.expires_at);
    end if;
    if cur ->> 'sealMode' = 'apply' then
      select * into sl from public.custody_seals where order_id = o.id and kind = cur ->> 'seal';
      if found then
        seal := jsonb_build_object('kind', sl.kind, 'code', sl.code);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', o.id, 'listing_id', o.listing_id, 'title', coalesce(o.listing_snapshot ->> 'title', 'Item'), 'tier', o.custody_tier, 'state', o.custody_state, 'step', o.custody_step, 'current', cur,
    'events', ev, 'my_roles', to_jsonb(roles), 'chain_ok', ok, 'head', o.custody_head,
    'weight_flag', o.weight_flag, 'dispute_reason', o.dispute_reason, 'payout_status', o.payout_status,
    'challenge', challenge, 'seal', seal);
end;
$$;
revoke execute on function public.order_custody(uuid) from public, anon;
grant execute on function public.order_custody(uuid) to authenticated;

revoke execute on function public.record_custody_step(uuid, text, jsonb) from public, anon;
grant execute on function public.record_custody_step(uuid, text, jsonb) to authenticated;

-- Work waiting for a courier or hub, and orders they have worked on.
create or replace function public.agent_queue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', o.id, 'title', coalesce(o.listing_snapshot ->> 'title', 'Item'), 'tier', o.custody_tier,
           'state', o.custody_state, 'step', public.custody_current(o) ->> 'key', 'actor', public.custody_current(o) ->> 'actor',
           'updated_at', o.custody_updated_at) order by o.custody_updated_at desc), '[]'::jsonb)
    from public.orders o
   where o.payment_status = 'paid'
     and exists (select 1 from public.custody_agents a where a.user_id = (select auth.uid()) and a.active)
     and ((public.custody_current(o) ->> 'actor') = any (public.custody_roles(o, (select auth.uid())))
          or exists (select 1 from public.custody_events e where e.order_id = o.id and e.actor_id = (select auth.uid())))
$$;
revoke execute on function public.agent_queue() from public, anon;
grant execute on function public.agent_queue() to authenticated;
