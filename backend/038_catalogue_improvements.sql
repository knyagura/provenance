-- NuTuYu catalogue improvements: nested categories, listing materials and safe deletion.
-- Run after migration 037. Additive and safe to re-run.

alter table public.listings
  add column if not exists materials text[] not null default '{}';

do $$ begin
  alter table public.listings add constraint listings_materials_count
    check (cardinality(materials) <= 8);
exception when duplicate_object then null; end $$;
create or replace function public.validate_listing_materials()
returns trigger language plpgsql set search_path = public as $body$
begin
  if cardinality(new.materials) > 8 then raise exception 'Choose up to 8 materials.'; end if;
  if exists (select 1 from unnest(new.materials) m where char_length(m) > 40) then raise exception 'Material names must be 40 characters or fewer.'; end if;
  return new;
end; $body$;
drop trigger if exists listings_validate_materials on public.listings;
create trigger listings_validate_materials before insert or update of materials on public.listings for each row execute procedure public.validate_listing_materials();

-- Rename the existing top-level categories without changing their stable slugs.
update public.categories set name = case slug
  when 'women' then 'Women''s Wear'
  when 'men' then 'Men''s Wear'
  when 'kids' then 'Children''s Wear'
  when 'designer' then 'Designer Fashion'
  when 'home' then 'Home and Living'
  when 'electronics' then 'Electronics and Tech'
  when 'books-media' then 'Books and Media'
  when 'hobbies' then 'Hobbies and Collectables'
  when 'sport' then 'Sports and Outdoors'
  else name end
where slug in ('women','men','kids','designer','home','electronics','books-media','hobbies','sport');

insert into public.categories (slug, name, parent_slug, position) values
  ('women-accessories','Accessories','women',1), ('women-accessories-belts','Belts','women-accessories',1), ('women-accessories-hats','Hats','women-accessories',2), ('women-accessories-jewellery','Jewellery','women-accessories',3), ('women-accessories-scarves','Scarves','women-accessories',4), ('women-accessories-sunglasses','Sunglasses','women-accessories',5),
  ('women-bags','Bags','women',2), ('women-bags-handbags','Handbags','women-bags',1), ('women-bags-shoulder-bags','Shoulder bags','women-bags',2), ('women-bags-tote-bags','Tote bags','women-bags',3), ('women-bags-clutches','Clutches','women-bags',4),
  ('women-clothing','Clothing','women',3), ('women-clothing-dresses','Dresses','women-clothing',1), ('women-clothing-tops','Tops','women-clothing',2), ('women-clothing-trousers','Trousers','women-clothing',3), ('women-clothing-jeans','Jeans','women-clothing',4), ('women-clothing-skirts','Skirts','women-clothing',5), ('women-clothing-knitwear','Knitwear','women-clothing',6), ('women-clothing-outerwear','Outerwear','women-clothing',7), ('women-clothing-shorts','Shorts','women-clothing',8), ('women-clothing-activewear','Activewear','women-clothing',9), ('women-clothing-underwear','Underwear and nightwear','women-clothing',10),
  ('women-shoes','Shoes','women',4), ('women-shoes-boots','Boots','women-shoes',1), ('women-shoes-flats','Flats','women-shoes',2), ('women-shoes-heels','Heels','women-shoes',3), ('women-shoes-trainers','Trainers','women-shoes',4), ('women-shoes-sandals','Sandals','women-shoes',5),
  ('men-accessories','Accessories','men',1), ('men-accessories-belts','Belts','men-accessories',1), ('men-accessories-hats','Hats','men-accessories',2), ('men-accessories-watches','Watches','men-accessories',3), ('men-bags','Bags','men',2), ('men-clothing','Clothing','men',3), ('men-clothing-shirts','Shirts','men-clothing',1), ('men-clothing-t-shirts','T-shirts','men-clothing',2), ('men-clothing-trousers','Trousers','men-clothing',3), ('men-clothing-jeans','Jeans','men-clothing',4), ('men-clothing-knitwear','Knitwear','men-clothing',5), ('men-clothing-outerwear','Outerwear','men-clothing',6), ('men-clothing-suits','Suits and tailoring','men-clothing',7), ('men-shoes','Shoes','men',4), ('men-shoes-boots','Boots','men-shoes',1), ('men-shoes-trainers','Trainers','men-shoes',2), ('men-shoes-formal','Formal shoes','men-shoes',3), ('men-shoes-sandals','Sandals','men-shoes',4),
  ('kids-accessories','Accessories','kids',1), ('kids-bags','Bags and backpacks','kids',2), ('kids-clothing','Clothing','kids',3), ('kids-clothing-dresses','Dresses','kids-clothing',1), ('kids-clothing-tops','Tops','kids-clothing',2), ('kids-clothing-trousers','Trousers','kids-clothing',3), ('kids-clothing-outerwear','Outerwear','kids-clothing',4), ('kids-clothing-school-uniform','School uniform','kids-clothing',5), ('kids-shoes','Shoes','kids',4), ('kids-shoes-boots','Boots','kids-shoes',1), ('kids-shoes-trainers','Trainers','kids-shoes',2), ('kids-shoes-flats','Flats','kids-shoes',3), ('kids-shoes-sandals','Sandals','kids-shoes',4),
  ('designer-bags','Bags','designer',1), ('designer-clothing','Clothing','designer',2), ('designer-shoes','Shoes','designer',3), ('designer-accessories','Accessories','designer',4),
  ('home-furniture','Furniture','home',1), ('home-decor','Home decor','home',2), ('home-kitchen','Kitchen and dining','home',3), ('home-bedding','Bedding and textiles','home',4), ('home-lighting','Lighting','home',5),
  ('electronics-phones','Phones and accessories','electronics',1), ('electronics-computers','Computers and tablets','electronics',2), ('electronics-cameras','Cameras','electronics',3), ('electronics-audio','Audio','electronics',4),
  ('books-media-books','Books','books-media',1), ('books-media-records','Records and vinyl','books-media',2), ('books-media-films','Films and TV','books-media',3),
  ('hobbies-toys','Toys and games','hobbies',1), ('hobbies-collectables','Collectables','hobbies',2), ('hobbies-building-sets','Building sets','hobbies',3),
  ('sport-clothing','Sportswear','sport',1), ('sport-shoes','Sports shoes','sport',2), ('sport-equipment','Equipment','sport',3)
on conflict (slug) do update set name = excluded.name, parent_slug = excluded.parent_slug, position = excluded.position;

-- Sellers may remove only an active listing with no order history. Any order history is preserved.
create or replace function public.delete_listing_if_safe(p_listing uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_status text;
  listing_seller uuid;
begin
  select status, seller_id into listing_status, listing_seller
    from public.listings where id = p_listing for update;
  if not found then return true; end if;
  if listing_seller is distinct from auth.uid() then
    raise exception 'You can only delete your own listing.' using errcode = '42501';
  end if;
  if listing_status <> 'active' then
    raise exception 'This listing is currently being bought or has been sold and cannot be deleted.';
  end if;
  if exists (select 1 from public.orders where listing_id = p_listing) then
    raise exception 'This listing has order history and cannot be deleted.';
  end if;
  delete from public.listings where id = p_listing;
  return true;
end;
$$;
revoke all on function public.delete_listing_if_safe(uuid) from public, anon;
grant execute on function public.delete_listing_if_safe(uuid) to authenticated;
