-- Provenance: migration 003 — fixes from Supabase's security & performance advisors.
-- Run AFTER 002. Safe to re-run. Contains no DROP statements.

-- 1. Trigger functions shouldn't be callable as API endpoints (/rest/v1/rpc/...). Postgres won't run
--    a trigger function called directly anyway; this just removes the exposure. Triggers still fire.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.validate_new_order() from public, anon, authenticated;
revoke execute on function public.protect_profile_flags() from public, anon, authenticated;
revoke execute on function public.protect_order_fields() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- 2. Evaluate auth.uid() once per query instead of once per row (same rules, faster at scale).
alter policy "users can update their own profile" on public.profiles
  using ((select auth.uid()) = id);
alter policy "published listings are publicly viewable" on public.listings
  using (published = true or seller_id = (select auth.uid()));
alter policy "sellers can insert their own listings" on public.listings
  with check (seller_id = (select auth.uid()));
alter policy "sellers can update their own listings" on public.listings
  using (seller_id = (select auth.uid()));
alter policy "sellers can delete their own listings" on public.listings
  using (seller_id = (select auth.uid()));
alter policy "buyer or seller can view their own orders" on public.orders
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));
alter policy "buyer can create an order" on public.orders
  with check (buyer_id = (select auth.uid()));
alter policy "buyer or seller can update their own order" on public.orders
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

-- 3. Index the orders → listings foreign key.
create index if not exists orders_listing_idx on public.orders (listing_id);
