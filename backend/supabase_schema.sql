-- Provenance: v1 backend schema (accounts + listings + orders)
-- Paste this whole file into Supabase's SQL Editor (Project > SQL Editor > New query) and click Run.
-- Safe to run once on a brand-new project. Does NOT touch Supabase's built-in auth.users table structure.

-- ============================================================
-- 1. PROFILES (extends Supabase's built-in auth.users)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  bio text,
  avatar_url text,
  kyc_verified boolean not null default false,
  is_pro boolean not null default false,
  holiday_mode boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are publicly viewable"
  on public.profiles for select
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up (email+password OR magic link).
-- Username defaults to the part of their email before the @ sign; they can change it later.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4));
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2. LISTINGS
-- ============================================================
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  price_pence integer not null check (price_pence >= 0),
  category text,
  condition_label text,
  tier text not null default 'enhanced' check (tier in ('enhanced','verified','luxury','ultraLuxury')),
  photos jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  views integer not null default 0,
  favourites integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listings enable row level security;

create policy "published listings are publicly viewable"
  on public.listings for select
  using (published = true or seller_id = auth.uid());

create policy "sellers can insert their own listings"
  on public.listings for insert
  with check (seller_id = auth.uid());

create policy "sellers can update their own listings"
  on public.listings for update
  using (seller_id = auth.uid());

create policy "sellers can delete their own listings"
  on public.listings for delete
  using (seller_id = auth.uid());

-- ============================================================
-- 3. ORDERS
-- ============================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  price_pence integer not null check (price_pence >= 0),
  protection_payer text not null default 'buyer' check (protection_payer in ('buyer','seller')),
  shipping_choice text not null default 'free' check (shipping_choice in ('free','paid')),
  fees jsonb not null default '{}'::jsonb,
  status text not null default 'purchased'
    check (status in ('purchased','handover','hub','unboxing','confirmed','disputed')),
  -- Custody/evidence-chain detail stays client-side for now (unchanged from the current prototype) --
  -- this column just lets it sync across devices; it is NOT yet validated server-side.
  timeline_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "buyer or seller can view their own orders"
  on public.orders for select
  using (buyer_id = auth.uid() or seller_id = auth.uid());

create policy "buyer can create an order"
  on public.orders for insert
  with check (buyer_id = auth.uid());

create policy "buyer or seller can update their own order"
  on public.orders for update
  using (buyer_id = auth.uid() or seller_id = auth.uid());

-- ============================================================
-- 4. Keep updated_at fresh automatically
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger listings_touch_updated_at
  before update on public.listings
  for each row execute procedure public.touch_updated_at();

create or replace trigger orders_touch_updated_at
  before update on public.orders
  for each row execute procedure public.touch_updated_at();
