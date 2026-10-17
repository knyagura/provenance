-- 013: Multi-basket shopping, gift wrapping and gift links.
--
-- A member can switch on multi-basket shopping. They then have a General basket (always there, and the
-- only one shown in the single-basket view, where it lists everything) and up to four personal baskets,
-- each for one person with a size profile, budget, style notes, wrapping style and gift options.
-- Every item in any basket belongs to exactly one of them; "General" holds items for no one in particular.
--
-- One payment covers every basket: start_basket_checkout makes one order per item (each priced, held and
-- protected exactly like a single checkout), grouped under a checkout_group whose total is what is paid.
-- Gift wrapping is a flat fee per wrapped item, on its own line, charged only once wrapping is switched on
-- (who wraps is still being decided; until then the choice is saved and nothing is charged).
--
-- A personal basket's orders are gifts: each gets a private gift link. The person it's for opens it,
-- signs in, and does the unboxing steps themselves; they never see prices.
--
-- Nothing here is writable by members directly: every change goes through a function that checks it.

-- ------------------------------------------------------------
-- 1. Settings
-- ------------------------------------------------------------
alter table public.offer_settings add column if not exists wrap_fee_pence integer not null default 300;
alter table public.offer_settings add column if not exists wrapping_live boolean not null default false;
do $$ begin
  alter table public.offer_settings add constraint offer_settings_wrap_fee_check check (wrap_fee_pence between 0 and 2000);
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists multi_basket boolean not null default false;

-- ------------------------------------------------------------
-- 2. Baskets
-- ------------------------------------------------------------
create table if not exists public.baskets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  position smallint not null check (position between 0 and 4),
  name text not null check (char_length(name) between 1 and 40),
  age_group text check (age_group is null or age_group in ('adult', 'child')),
  sizes jsonb not null default '{}'::jsonb check (jsonb_typeof(sizes) = 'object'),
  budget_pence integer check (budget_pence is null or budget_pence between 100 and 10000000),
  style_notes text check (style_notes is null or char_length(style_notes) <= 500),
  wrap_style text check (wrap_style is null or wrap_style in ('kraft', 'sage', 'terracotta', 'stripe', 'confetti')),
  wrap_all boolean not null default false,
  gift_message text check (gift_message is null or char_length(gift_message) <= 300),
  hide_prices boolean not null default true,
  deliver_by date,
  gift_receipt boolean not null default false,
  recipient_address jsonb check (recipient_address is null or jsonb_typeof(recipient_address) = 'object'),
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, position)
);
alter table public.baskets enable row level security;
do $$ begin
  create policy "members see their own baskets" on public.baskets for select using ((select auth.uid()) = owner_id);
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.baskets from anon, authenticated;
grant select on public.baskets to authenticated;

create table if not exists public.basket_items (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  basket_id uuid not null references public.baskets(id) on delete cascade,
  wrap boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (owner_id, listing_id)
);
create index if not exists basket_items_basket_idx on public.basket_items (basket_id);
create index if not exists basket_items_listing_idx on public.basket_items (listing_id);
alter table public.basket_items enable row level security;
do $$ begin
  create policy "members see their own basket items" on public.basket_items for select using ((select auth.uid()) = owner_id);
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.basket_items from anon, authenticated;
grant select on public.basket_items to authenticated;

-- The General basket, made on first use.
create or replace function public.basket_general(p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
begin
  select id into bid from public.baskets where owner_id = p_owner and position = 0;
  if bid is null then
    insert into public.baskets (owner_id, position, name, hide_prices) values (p_owner, 0, 'General', false)
    on conflict (owner_id, position) do nothing returning id into bid;
    if bid is null then
      select id into bid from public.baskets where owner_id = p_owner and position = 0;
    end if;
  end if;
  return bid;
end;
$$;
revoke execute on function public.basket_general(uuid) from public, anon, authenticated;

create or replace function public.basket_json(b public.baskets)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'position', b.position, 'name', b.name, 'general', b.position = 0,
    'age_group', b.age_group, 'sizes', b.sizes, 'budget_pence', b.budget_pence, 'style_notes', b.style_notes,
    'wrap_style', b.wrap_style, 'wrap_all', b.wrap_all, 'gift_message', b.gift_message, 'hide_prices', b.hide_prices,
    'deliver_by', b.deliver_by, 'gift_receipt', b.gift_receipt, 'recipient_address', b.recipient_address,
    'shared', b.share_token is not null, 'share_token', b.share_token,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'listing_id', l.id, 'title', l.title, 'price_pence', l.price_pence, 'postage_pence', l.shipping_pence,
               'size', l.size_label, 'category', l.category, 'tier', l.tier, 'status', l.status, 'available', l.published and l.status = 'active',
               'photo', (select m.path from public.listing_media m where m.listing_id = l.id and m.kind = 'photo' and m.retired_at is null order by m.position, m.created_at limit 1),
               'seller', p.username, 'wrap', i.wrap, 'added_at', i.added_at) order by i.added_at)
        from public.basket_items i
        join public.listings l on l.id = i.listing_id
        join public.profiles p on p.id = l.seller_id
       where i.basket_id = b.id), '[]'::jsonb))
$$;
revoke execute on function public.basket_json(public.baskets) from public, anon, authenticated;

-- Everything the basket screens need, in one call.
create or replace function public.my_baskets()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to use baskets.' using errcode = '42501';
  end if;
  perform public.basket_general(me);
  return jsonb_build_object(
    'enabled', (select multi_basket from public.profiles where id = me),
    'wrap_fee_pence', (select wrap_fee_pence from public.offer_settings where id = 1),
    'wrapping_live', (select wrapping_live from public.offer_settings where id = 1),
    'baskets', (select jsonb_agg(public.basket_json(b) order by b.position) from public.baskets b where b.owner_id = me));
end;
$$;
revoke execute on function public.my_baskets() from public, anon;
grant execute on function public.my_baskets() to authenticated;

-- Opt in or out. Switching off keeps the personal baskets (hidden), so switching back on restores them.
create or replace function public.set_multi_basket(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to use baskets.' using errcode = '42501';
  end if;
  update public.profiles set multi_basket = coalesce(p_on, false) where id = me;
  return public.my_baskets();
end;
$$;
revoke execute on function public.set_multi_basket(boolean) from public, anon;
grant execute on function public.set_multi_basket(boolean) to authenticated;

-- Create (p_id null) or change a personal basket. The General basket can only be renamed.
create or replace function public.save_basket(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.baskets%rowtype;
  pos smallint;
  sz jsonb;
  k text;
  addr jsonb;
begin
  if me is null then
    raise exception 'Sign in to use baskets.' using errcode = '42501';
  end if;
  p := coalesce(p, '{}'::jsonb);
  perform public.basket_general(me);
  if p_id is null then
    select min(s) into pos from generate_series(1, 4) s where not exists (select 1 from public.baskets x where x.owner_id = me and x.position = s);
    if pos is null then
      raise exception 'You can have four personal baskets. Remove one to add another.' using errcode = 'P0001';
    end if;
    insert into public.baskets (owner_id, position, name) values (me, pos, 'Basket') returning * into b;
  else
    select * into b from public.baskets where id = p_id and owner_id = me for update;
    if not found then
      raise exception 'Basket not found.' using errcode = 'P0002';
    end if;
  end if;

  if p ? 'name' then
    if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 40 then
      raise exception 'Give the basket a name of up to 40 characters.' using errcode = '22023';
    end if;
    b.name := btrim(p ->> 'name');
  end if;
  if b.position = 0 then
    update public.baskets set name = b.name, updated_at = now() where id = b.id;
    return public.my_baskets();
  end if;

  if p ? 'age_group' then
    b.age_group := nullif(p ->> 'age_group', '');
  end if;
  if p ? 'sizes' then
    sz := coalesce(p -> 'sizes', '{}'::jsonb);
    if jsonb_typeof(sz) <> 'object' then
      raise exception 'Sizes must be a list of size types.' using errcode = '22023';
    end if;
    for k in select jsonb_object_keys(sz) loop
      if k not in ('shoe', 'top', 'trousers', 'dress', 'kids') or jsonb_typeof(sz -> k) <> 'string' or char_length(sz ->> k) > 20 then
        raise exception 'Sizes can be shoe, top, trousers, dress or kids, each up to 20 characters.' using errcode = '22023';
      end if;
    end loop;
    b.sizes := (select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) from jsonb_each_text(sz) where btrim(value) <> '');
  end if;
  if p ? 'budget_pence' then
    b.budget_pence := (p ->> 'budget_pence')::integer;
  end if;
  if p ? 'style_notes' then
    b.style_notes := nullif(btrim(p ->> 'style_notes'), '');
  end if;
  if p ? 'wrap_style' then
    b.wrap_style := nullif(p ->> 'wrap_style', '');
  end if;
  if p ? 'wrap_all' then
    b.wrap_all := coalesce((p ->> 'wrap_all')::boolean, false);
  end if;
  if p ? 'gift_message' then
    b.gift_message := nullif(btrim(p ->> 'gift_message'), '');
  end if;
  if p ? 'hide_prices' then
    b.hide_prices := coalesce((p ->> 'hide_prices')::boolean, true);
  end if;
  if p ? 'deliver_by' then
    b.deliver_by := nullif(p ->> 'deliver_by', '')::date;
    if b.deliver_by is not null and b.deliver_by < current_date then
      raise exception 'The deliver-by date has passed.' using errcode = '22023';
    end if;
  end if;
  if p ? 'gift_receipt' then
    b.gift_receipt := coalesce((p ->> 'gift_receipt')::boolean, false);
  end if;
  if p ? 'recipient_address' then
    addr := p -> 'recipient_address';
    if addr is null or jsonb_typeof(addr) = 'null' then
      b.recipient_address := null;
    else
      if jsonb_typeof(addr) <> 'object'
         or char_length(btrim(coalesce(addr ->> 'name', ''))) not between 1 and 80
         or char_length(btrim(coalesce(addr ->> 'line1', ''))) not between 1 and 120
         or char_length(coalesce(addr ->> 'line2', '')) > 120
         or char_length(btrim(coalesce(addr ->> 'town', ''))) not between 1 and 80
         or upper(btrim(coalesce(addr ->> 'postcode', ''))) !~ '^[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}$' then
        raise exception 'Enter the name, first line, town and a UK postcode.' using errcode = '22023';
      end if;
      b.recipient_address := jsonb_build_object('name', btrim(addr ->> 'name'), 'line1', btrim(addr ->> 'line1'),
        'line2', nullif(btrim(coalesce(addr ->> 'line2', '')), ''), 'town', btrim(addr ->> 'town'), 'postcode', upper(btrim(addr ->> 'postcode')));
    end if;
  end if;

  update public.baskets set name = b.name, age_group = b.age_group, sizes = b.sizes, budget_pence = b.budget_pence,
         style_notes = b.style_notes, wrap_style = b.wrap_style, wrap_all = b.wrap_all, gift_message = b.gift_message,
         hide_prices = b.hide_prices, deliver_by = b.deliver_by, gift_receipt = b.gift_receipt,
         recipient_address = b.recipient_address, updated_at = now()
   where id = b.id;
  -- Turning "wrap everything" on wraps what's already there.
  if b.wrap_all and b.wrap_style is not null then
    update public.basket_items set wrap = true where basket_id = b.id;
  end if;
  return public.my_baskets();
end;
$$;
revoke execute on function public.save_basket(uuid, jsonb) from public, anon;
grant execute on function public.save_basket(uuid, jsonb) to authenticated;

-- Removing a personal basket moves its items to General.
create or replace function public.delete_basket(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.baskets%rowtype;
begin
  select * into b from public.baskets where id = p_id and owner_id = me;
  if not found or b.position = 0 then
    raise exception 'Basket not found.' using errcode = 'P0002';
  end if;
  update public.basket_items set basket_id = public.basket_general(me), wrap = false where basket_id = b.id;
  delete from public.baskets where id = b.id;
  return public.my_baskets();
end;
$$;
revoke execute on function public.delete_basket(uuid) from public, anon;
grant execute on function public.delete_basket(uuid) to authenticated;

-- Put an item in a basket (General when p_basket is null), or move it. Its wrapping follows the basket's default.
create or replace function public.basket_put(p_listing uuid, p_basket uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.baskets%rowtype;
  l public.listings%rowtype;
begin
  if me is null then
    raise exception 'Sign in to use baskets.' using errcode = '42501';
  end if;
  if p_basket is null then
    p_basket := public.basket_general(me);
  end if;
  select * into b from public.baskets where id = p_basket and owner_id = me;
  if not found then
    raise exception 'Basket not found.' using errcode = 'P0002';
  end if;
  if b.position > 0 and not (select multi_basket from public.profiles where id = me) then
    raise exception 'Switch on multi-basket shopping to use personal baskets.' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = p_listing;
  if not found or not l.published or l.status <> 'active' then
    raise exception 'This item isn’t for sale.' using errcode = 'P0001';
  end if;
  if l.seller_id = me then
    raise exception 'You can’t add your own listing.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.basket_items where owner_id = me and listing_id <> p_listing) >= 60 then
    raise exception 'Your baskets are full (60 items).' using errcode = 'P0001';
  end if;
  insert into public.basket_items (owner_id, listing_id, basket_id, wrap)
  values (me, p_listing, b.id, b.position > 0 and b.wrap_all and b.wrap_style is not null)
  on conflict (owner_id, listing_id) do update
    set basket_id = excluded.basket_id, wrap = excluded.wrap
  where basket_items.basket_id is distinct from excluded.basket_id;
  return public.my_baskets();
end;
$$;
revoke execute on function public.basket_put(uuid, uuid) from public, anon;
grant execute on function public.basket_put(uuid, uuid) to authenticated;

create or replace function public.basket_set_wrap(p_listing uuid, p_wrap boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.baskets%rowtype;
begin
  select bk.* into b from public.basket_items i join public.baskets bk on bk.id = i.basket_id where i.owner_id = me and i.listing_id = p_listing;
  if not found then
    raise exception 'That item isn’t in your baskets.' using errcode = 'P0002';
  end if;
  if p_wrap and (b.position = 0 or b.wrap_style is null) then
    raise exception 'Choose a wrapping paper for this basket first.' using errcode = 'P0001';
  end if;
  update public.basket_items set wrap = coalesce(p_wrap, false) where owner_id = me and listing_id = p_listing;
  return public.my_baskets();
end;
$$;
revoke execute on function public.basket_set_wrap(uuid, boolean) from public, anon;
grant execute on function public.basket_set_wrap(uuid, boolean) to authenticated;

create or replace function public.basket_remove(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.basket_items where owner_id = auth.uid() and listing_id = p_listing;
  return public.my_baskets();
end;
$$;
revoke execute on function public.basket_remove(uuid) from public, anon;
grant execute on function public.basket_remove(uuid) to authenticated;

-- Share a basket read-only (p_on false stops sharing; the old link stops working).
create or replace function public.share_basket(p_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  update public.baskets
     set share_token = case when p_on then coalesce(share_token, encode(uuid_send(gen_random_uuid()), 'hex')) end, updated_at = now()
   where id = p_id and owner_id = me and position > 0;
  if not found then
    raise exception 'Basket not found.' using errcode = 'P0002';
  end if;
  return public.my_baskets();
end;
$$;
revoke execute on function public.share_basket(uuid, boolean) from public, anon;
grant execute on function public.share_basket(uuid, boolean) to authenticated;

-- What a shared link shows: the basket's name, sizes, notes and items. Never the budget, address or owner.
create or replace function public.shared_basket(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', b.name, 'age_group', b.age_group, 'sizes', b.sizes, 'style_notes', b.style_notes,
           'items', (public.basket_json(b) -> 'items'))
    from public.baskets b
   where p_token ~ '^[0-9a-f]{32}$' and b.share_token = p_token and b.position > 0
$$;
revoke execute on function public.shared_basket(text) from public;
grant execute on function public.shared_basket(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 3. One payment for every basket
-- ------------------------------------------------------------
create table if not exists public.checkout_groups (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  shipping text not null check (shipping in ('combined', 'separate')),
  wrap_fee_pence integer not null default 0,
  wrapped_items integer not null default 0,
  wrap_total_pence integer not null default 0,
  total_pence integer not null,
  payment_status text not null default 'awaiting_payment' check (payment_status in ('awaiting_payment', 'paid', 'cancelled', 'expired', 'review')),
  payment_ref text,
  hold_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists checkout_groups_buyer_idx on public.checkout_groups (buyer_id, created_at desc);
alter table public.checkout_groups enable row level security;
do $$ begin
  create policy "buyers see their own checkout groups" on public.checkout_groups for select using ((select auth.uid()) = buyer_id);
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.checkout_groups from anon, authenticated;
grant select on public.checkout_groups to authenticated;

alter table public.orders add column if not exists group_id uuid references public.checkout_groups(id);
alter table public.orders add column if not exists basket_name text;
alter table public.orders add column if not exists gift jsonb;
alter table public.orders add column if not exists ship_to jsonb;
alter table public.orders add column if not exists gift_token text unique;
alter table public.orders add column if not exists recipient_id uuid references public.profiles(id);
create index if not exists orders_group_idx on public.orders (group_id);
create index if not exists orders_recipient_idx on public.orders (recipient_id);

-- Members never set these columns, on insert or update.
create or replace function public.protect_order_gift_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.group_id := null; new.basket_name := null; new.gift := null; new.ship_to := null; new.gift_token := null; new.recipient_id := null;
    else
      new.group_id := old.group_id; new.basket_name := old.basket_name; new.gift := old.gift; new.ship_to := old.ship_to;
      new.gift_token := old.gift_token; new.recipient_id := old.recipient_id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_order_gift_fields() from public, anon, authenticated;
do $$ begin
  create trigger orders_protect_gift_fields before insert or update on public.orders
    for each row execute function public.protect_order_gift_fields();
exception when duplicate_object then null; end $$;

create or replace function public.group_json(g public.checkout_groups)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'group_id', g.id, 'shipping', g.shipping, 'payment_status', g.payment_status, 'total_pence', g.total_pence,
    'wrap_fee_pence', g.wrap_fee_pence, 'wrapped_items', g.wrapped_items, 'wrap_total_pence', g.wrap_total_pence,
    'hold_expires_at', g.hold_expires_at, 'paid_at', g.paid_at,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'listing_id', o.listing_id, 'title', o.listing_snapshot ->> 'title',
                 'basket', o.basket_name, 'quote', o.fees, 'total_pence', o.total_pence, 'wrap', coalesce((o.gift ->> 'wrap')::boolean, false),
                 'gift', o.gift is not null, 'gift_token', o.gift_token, 'ship_to', o.ship_to) order by o.basket_name nulls first, o.created_at)
             from public.orders o where o.group_id = g.id), '[]'::jsonb))
$$;
revoke execute on function public.group_json(public.checkout_groups) from public, anon, authenticated;

-- p_shipping: 'combined' sends everything to the buyer; 'separate' sends each personal basket to its person.
create or replace function public.start_basket_checkout(p_shipping text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  multi boolean;
  cfg public.offer_settings%rowtype;
  r record;
  started jsonb;
  gid uuid;
  wrapped integer := 0;
  total integer := 0;
  hold timestamptz;
  n integer := 0;
begin
  if me is null then
    raise exception 'Sign in to buy.' using errcode = '42501';
  end if;
  if p_shipping not in ('combined', 'separate') then
    raise exception 'Choose how to send the baskets.' using errcode = '22023';
  end if;
  select multi_basket into multi from public.profiles where id = me;
  select * into cfg from public.offer_settings where id = 1;

  -- An unpaid group still on hold is reused rather than duplicated.
  select id into gid from public.checkout_groups where buyer_id = me and payment_status = 'awaiting_payment' and hold_expires_at > now() order by created_at desc limit 1;
  if gid is not null then
    perform public.cancel_basket_checkout(gid);
    gid := null;
  end if;

  insert into public.checkout_groups (buyer_id, shipping, total_pence, hold_expires_at) values (me, p_shipping, 0, now()) returning id into gid;
  for r in
    select i.listing_id, i.wrap, b.* , l.title
      from public.basket_items i
      join public.baskets b on b.id = i.basket_id
      join public.listings l on l.id = i.listing_id
     where i.owner_id = me and (multi or b.position = 0)
     order by b.position, i.added_at
  loop
    if p_shipping = 'separate' and r.position > 0 and r.recipient_address is null then
      raise exception 'Add an address for %, or send everything to you.', r.name using errcode = 'P0001';
    end if;
    begin
      started := public.start_checkout(r.listing_id, null);
    exception when others then
      raise exception '“%” can’t be bought right now: %', r.title, regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '') using errcode = 'P0001';
    end;
    update public.orders set
      group_id = gid,
      basket_name = case when multi and r.position > 0 then r.name end,
      gift = case when multi and r.position > 0 then jsonb_build_object(
               'wrap', r.wrap and cfg.wrapping_live, 'wrap_requested', r.wrap, 'wrap_style', r.wrap_style, 'message', r.gift_message,
               'hide_prices', r.hide_prices, 'deliver_by', r.deliver_by, 'gift_receipt', r.gift_receipt) end,
      ship_to = case when p_shipping = 'separate' and multi and r.position > 0 then r.recipient_address end,
      gift_token = case when multi and r.position > 0 then encode(uuid_send(gen_random_uuid()), 'hex') end
     where id = (started ->> 'order_id')::uuid;
    if multi and r.position > 0 and r.wrap and cfg.wrapping_live then
      wrapped := wrapped + 1;
    end if;
    total := total + (started -> 'quote' ->> 'buyer_total_pence')::integer;
    hold := least(coalesce(hold, (started ->> 'hold_expires_at')::timestamptz), (started ->> 'hold_expires_at')::timestamptz);
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'Your baskets are empty.' using errcode = 'P0001';
  end if;
  update public.checkout_groups set wrapped_items = wrapped, wrap_fee_pence = cfg.wrap_fee_pence, wrap_total_pence = wrapped * cfg.wrap_fee_pence,
         total_pence = total + wrapped * cfg.wrap_fee_pence, hold_expires_at = hold
   where id = gid;
  return (select public.group_json(g) from public.checkout_groups g where g.id = gid);
end;
$$;
revoke execute on function public.start_basket_checkout(text) from public, anon;
grant execute on function public.start_basket_checkout(text) to authenticated;

create or replace function public.basket_checkout(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.group_json(g) from public.checkout_groups g where g.id = p_group and g.buyer_id = (select auth.uid())
$$;
revoke execute on function public.basket_checkout(uuid) from public, anon;
grant execute on function public.basket_checkout(uuid) to authenticated;

create or replace function public.cancel_basket_checkout(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  oid uuid;
begin
  if not exists (select 1 from public.checkout_groups where id = p_group and buyer_id = auth.uid() and payment_status = 'awaiting_payment') then
    return;
  end if;
  for oid in select id from public.orders where group_id = p_group and payment_status = 'awaiting_payment' loop
    perform public.cancel_checkout(oid);
  end loop;
  update public.checkout_groups set payment_status = 'cancelled' where id = p_group;
end;
$$;
revoke execute on function public.cancel_basket_checkout(uuid) from public, anon;
grant execute on function public.cancel_basket_checkout(uuid) to authenticated;

-- Stripe's webhook, for a group payment. Each order is confirmed as if paid on its own; the amount must
-- be the group's total. Paid items leave the baskets.
create or replace function public.confirm_group_payment(p_group uuid, p_ref text, p_amount integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.checkout_groups%rowtype;
  o public.orders%rowtype;
  res text;
  bad boolean := false;
begin
  select * into g from public.checkout_groups where id = p_group for update;
  if not found then
    return 'unknown_group';
  end if;
  if g.payment_status = 'paid' then
    return 'already_paid';
  end if;
  if p_amount is distinct from g.total_pence then
    update public.checkout_groups set payment_status = 'review', payment_ref = p_ref where id = g.id;
    update public.orders set payment_status = 'review', payment_ref = p_ref where group_id = g.id and payment_status <> 'paid';
    return 'amount_mismatch';
  end if;
  for o in select * from public.orders where group_id = g.id loop
    res := public.confirm_payment(o.id, p_ref, o.total_pence);
    if res not in ('paid', 'already_paid') then
      bad := true;
    end if;
  end loop;
  update public.checkout_groups set payment_status = case when bad then 'review' else 'paid' end, payment_ref = p_ref, paid_at = now() where id = g.id;
  delete from public.basket_items bi using public.orders po
   where po.group_id = g.id and po.payment_status = 'paid' and bi.owner_id = g.buyer_id and bi.listing_id = po.listing_id;
  return case when bad then 'needs_review' else 'paid' end;
end;
$$;
revoke execute on function public.confirm_group_payment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_group_payment(uuid, text, integer) to service_role;

-- Paid items also leave the baskets when bought one at a time.
create or replace function public.basket_drop_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    delete from public.basket_items where listing_id = new.listing_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.basket_drop_paid() from public, anon, authenticated;
do $$ begin
  create trigger orders_basket_drop_paid after update of payment_status on public.orders
    for each row execute function public.basket_drop_paid();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 4. Gift links: the person a basket is for unboxes it
-- ------------------------------------------------------------
-- What the gift link shows before and after it is claimed. Never prices, the buyer's details or the address.
create or replace function public.gift_view(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_id', case when (select auth.uid()) in (o.recipient_id, o.buyer_id) then o.id end,
    'title', o.listing_snapshot ->> 'title',
    'photo', o.listing_snapshot -> 'media' -> 0 ->> 'path',
    'for', o.basket_name,
    'from', (select username from public.profiles where id = o.buyer_id),
    'message', o.gift ->> 'message',
    'deliver_by', o.gift ->> 'deliver_by',
    'gift_receipt', coalesce((o.gift ->> 'gift_receipt')::boolean, false),
    'wrapped', coalesce((o.gift ->> 'wrap')::boolean, false),
    'claimed', o.recipient_id is not null,
    'mine', (select auth.uid()) = o.recipient_id,
    'paid', o.payment_status = 'paid',
    'custody_state', o.custody_state,
    'snapshot', jsonb_build_object('brand', o.listing_snapshot ->> 'brand', 'size', o.listing_snapshot ->> 'size',
                                   'colour', o.listing_snapshot ->> 'colour', 'condition', o.listing_snapshot ->> 'condition'),
    'item_id', (select item_id from public.listings where id = o.listing_id),
    'sold_on', o.paid_at)
    from public.orders o
   where p_token ~ '^[0-9a-f]{32}$' and o.gift_token = p_token
$$;
revoke execute on function public.gift_view(text) from public;
grant execute on function public.gift_view(text) to anon, authenticated;

create or replace function public.claim_gift(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  o public.orders%rowtype;
begin
  if me is null then
    raise exception 'Sign in to open your gift.' using errcode = '42501';
  end if;
  select * into o from public.orders where p_token ~ '^[0-9a-f]{32}$' and gift_token = p_token for update;
  if not found or o.payment_status <> 'paid' then
    raise exception 'This gift link isn’t working.' using errcode = 'P0002';
  end if;
  if o.recipient_id is not null and o.recipient_id <> me then
    raise exception 'Someone has already opened this gift link.' using errcode = 'P0001';
  end if;
  if me = o.seller_id then
    raise exception 'The seller can’t be the gift’s recipient.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.custody_agents a where a.user_id = me and a.active) then
    raise exception 'Courier and hub accounts can’t receive gifts. Use a personal account.' using errcode = 'P0001';
  end if;
  if me <> o.buyer_id then
    update public.orders set recipient_id = me where id = o.id;
  end if;
  return public.gift_view(p_token);
end;
$$;
revoke execute on function public.claim_gift(text) from public, anon;
grant execute on function public.claim_gift(text) to authenticated;

-- The recipient does the buyer's unboxing steps. The buyer (who paid) can still do them, and still
-- decides disputes. Couriers and hubs never act on an order they bought, sold or receive.
create or replace function public.custody_roles(p_order public.orders, p_uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when p_uid = p_order.seller_id then 'seller' end,
    case when p_uid = p_order.buyer_id or (p_order.recipient_id is not null and p_uid = p_order.recipient_id) then 'buyer' end,
    case when a.role = 'courier' and p_uid not in (p_order.buyer_id, p_order.seller_id) and p_uid is distinct from p_order.recipient_id then 'courier' end,
    case when a.role = 'hub' and p_uid not in (p_order.buyer_id, p_order.seller_id) and p_uid is distinct from p_order.recipient_id then 'hub' end,
    case when a.role = 'hub' and p_uid not in (p_order.buyer_id, p_order.seller_id) and p_uid is distinct from p_order.recipient_id then 'hub2' end
  ], null)
  from (select 1) one
  left join public.custody_agents a on a.user_id = p_uid and a.active
$$;
revoke execute on function public.custody_roles(public.orders, uuid) from public, anon, authenticated;

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
            or (o.recipient_id is not null and (select auth.uid()) = o.recipient_id)
            or (public.custody_current(o) ->> 'actor') = any (public.custody_roles(o, (select auth.uid())))
            or exists (select 1 from public.custody_events e where e.order_id = o.id and e.actor_id = (select auth.uid())))
  )
$$;
revoke execute on function public.custody_can_view(uuid) from public, anon;
grant execute on function public.custody_can_view(uuid) to authenticated;

-- Gifts waiting for the signed-in recipient, for their Inbox.
create or replace function public.my_gifts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'token', o.gift_token, 'title', o.listing_snapshot ->> 'title',
           'photo', o.listing_snapshot -> 'media' -> 0 ->> 'path', 'from', p.username,
           'custody_state', o.custody_state, 'custody_step', o.custody_step, 'custody_tier', o.custody_tier) order by o.paid_at desc), '[]'::jsonb)
    from public.orders o join public.profiles p on p.id = o.buyer_id
   where o.recipient_id = (select auth.uid()) and o.payment_status = 'paid'
$$;
revoke execute on function public.my_gifts() from public, anon;
grant execute on function public.my_gifts() to authenticated;

-- ------------------------------------------------------------
-- 5. Staff: the wrapping fee and switching wrapping on
-- ------------------------------------------------------------
create or replace function public.staff_update_settings(p_custody jsonb, p_offers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.staff_require();
begin
  if p_custody is not null then
    update public.custody_settings set
      challenge_minutes = coalesce((p_custody ->> 'challenge_minutes')::int, challenge_minutes),
      confirm_window_hours = coalesce((p_custody ->> 'confirm_window_hours')::int, confirm_window_hours),
      enhanced_confirm_days = coalesce((p_custody ->> 'enhanced_confirm_days')::int, enhanced_confirm_days),
      weight_tolerance_grams = coalesce((p_custody ->> 'weight_tolerance_grams')::int, weight_tolerance_grams),
      weight_tolerance_pct = coalesce((p_custody ->> 'weight_tolerance_pct')::int, weight_tolerance_pct),
      updated_at = now()
     where id = 1;
  end if;
  if p_offers is not null then
    update public.offer_settings set
      min_pct = coalesce((p_offers ->> 'min_pct')::int, min_pct),
      reply_hours = coalesce((p_offers ->> 'reply_hours')::int, reply_hours),
      checkout_hours = coalesce((p_offers ->> 'checkout_hours')::int, checkout_hours),
      wrap_fee_pence = coalesce((p_offers ->> 'wrap_fee_pence')::int, wrap_fee_pence),
      wrapping_live = coalesce((p_offers ->> 'wrapping_live')::boolean, wrapping_live)
     where id = 1;
  end if;
  insert into public.staff_actions (staff_id, action, detail) values (me, 'update_settings', jsonb_build_object('custody', p_custody, 'offers', p_offers));
  return public.staff_settings();
end;
$$;
revoke execute on function public.staff_update_settings(jsonb, jsonb) from public, anon;
grant execute on function public.staff_update_settings(jsonb, jsonb) to authenticated;
