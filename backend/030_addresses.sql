-- 030: Saved addresses.
-- Members keep up to 5 addresses, one marked as their default. When an order the seller posts is paid and the buyer
-- has a default address (and the basket didn't give one), it becomes the order's delivery address straight away, so
-- the buyer isn't asked. Sellers' default address is where returns go (migration 031). Only the owner reads them.

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text check (label is null or char_length(label) between 1 and 40),
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id, created_at);
create unique index if not exists addresses_one_default on public.addresses (user_id) where is_default;
alter table public.addresses enable row level security;
revoke all on public.addresses from anon, authenticated;

create or replace function public.my_addresses()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'address', address, 'is_default', is_default)
         order by is_default desc, created_at), '[]'::jsonb)
    from public.addresses where user_id = auth.uid()
$$;
revoke execute on function public.my_addresses() from public, anon;
grant execute on function public.my_addresses() to authenticated;

create or replace function public.save_address(p_id uuid, p_label text, p_address jsonb, p_default boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean jsonb := public.clean_address(p_address);
  lbl text := nullif(btrim(coalesce(p_label, '')), '');
  first boolean;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if char_length(coalesce(lbl, '')) > 40 then
    raise exception 'Keep the label short, like Home or Work.' using errcode = '22023';
  end if;
  first := not exists (select 1 from public.addresses where user_id = me);
  if p_default or first then
    update public.addresses set is_default = false where user_id = me and is_default and id is distinct from p_id;
  end if;
  if p_id is null then
    if (select count(*) from public.addresses where user_id = me) >= 5 then
      raise exception 'You can keep up to 5 addresses. Delete one first.' using errcode = '54000';
    end if;
    insert into public.addresses (user_id, label, address, is_default) values (me, lbl, clean, coalesce(p_default, false) or first);
  else
    update public.addresses set label = lbl, address = clean, is_default = coalesce(p_default, false) or is_default, updated_at = now()
     where id = p_id and user_id = me;
    if not found then
      raise exception 'Address not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.my_addresses();
end;
$$;
revoke execute on function public.save_address(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.save_address(uuid, text, jsonb, boolean) to authenticated;

create or replace function public.delete_address(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  was_default boolean;
begin
  delete from public.addresses where id = p_id and user_id = auth.uid() returning is_default into was_default;
  if was_default then
    -- The oldest remaining one becomes the default.
    update public.addresses set is_default = true
     where id = (select id from public.addresses where user_id = auth.uid() order by created_at limit 1);
  end if;
  return public.my_addresses();
end;
$$;
revoke execute on function public.delete_address(uuid) from public, anon;
grant execute on function public.delete_address(uuid) to authenticated;

-- When an order is paid, use the buyer's default address if the order has none.
create or replace function public.orders_default_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.deliver_to is null and new.ship_to is null then
    new.deliver_to := (select address from public.addresses where user_id = new.buyer_id and is_default);
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_default_address() from public, anon, authenticated;
do $$ begin
  create trigger orders_default_address before update of payment_status on public.orders
    for each row execute function public.orders_default_address();
exception when duplicate_object then null; end $$;
