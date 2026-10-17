-- Provenance: migration 023 — "near me": collection in person.
-- A seller can say roughly where they are (their postcode district, such as SW11, never their address)
-- and that buyers may collect in person. The district's centre is stored to two decimal places (about
-- 1 km), so search can find items "within 10 miles" and show "about 3 miles away". Safe to re-run.

alter table public.profiles add column if not exists area text;
alter table public.profiles add column if not exists area_lat numeric(5, 2);
alter table public.profiles add column if not exists area_lng numeric(5, 2);
alter table public.profiles add column if not exists collection_ok boolean not null default false;
do $$ begin
  alter table public.profiles add constraint profiles_area_check check (
    (area is null and area_lat is null and area_lng is null)
    or (area ~ '^[A-Z]{1,2}[0-9][0-9A-Z]?$' and area_lat between 49.5 and 61 and area_lng between -8.7 and 2));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_collection_needs_area check (not collection_ok or area is not null);
exception when duplicate_object then null; end $$;
create index if not exists profiles_area_idx on public.profiles (area_lat, area_lng) where collection_ok;

-- Miles between two points (the haversine formula). Good enough for "about 3 miles away".
create or replace function public.miles_between(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select round((3958.8 * 2 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2))))::numeric, 1)
$$;
grant execute on function public.miles_between(numeric, numeric, numeric, numeric) to anon, authenticated;
