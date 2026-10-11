// Validates backend/*.sql against a real Postgres engine (PGlite, Postgres compiled to WASM),
// with minimal stand-ins for the Supabase pieces the schema depends on (auth.users, auth.uid(),
// the anon/authenticated roles). Then acts as real users — through the same Row Level Security
// a browser's API key is subject to — to prove the policies and integrity triggers hold.
//
// Usage: node sql_rls_check.mjs   (needs @electric-sql/pglite; npm install in this folder)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, '..', 'backend', f), 'utf8');

export const SUPABASE_STUBS = `
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to anon, authenticated;
`;

export async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(read('supabase_schema.sql'));
  await db.exec(read('002_listing_status_and_integrity.sql'));
  await db.exec(read('003_advisor_fixes.sql'));
  await db.exec(read('004_browsing_and_api.sql'));
  await db.exec(read('005_listing_media_storage.sql'));
  return db;
}

// Run fn as a given user (or anon when uid is null), exactly as PostgREST does: SET ROLE + JWT sub.
export async function as(db, uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role;'); }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let failures = 0;
  const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
  const rejects = async (p, label, match) => {
    try { await p; ok(false, label + ' (was allowed)'); }
    catch (e) { ok(!match || match.test(e.message), `${label} — rejected: ${e.message}`); }
  };

  const db = await freshDb();
  // Re-running the migration must be harmless.
  await db.exec(read('002_listing_status_and_integrity.sql'));
  await db.exec(read('003_advisor_fixes.sql'));
  await db.exec(read('004_browsing_and_api.sql'));
  await db.exec(read('005_listing_media_storage.sql'));
  ok(true, 'schema + migrations 002-005 apply cleanly, and re-run idempotently');

  const SELLER = '11111111-1111-1111-1111-111111111111';
  const BUYER = '22222222-2222-2222-2222-222222222222';
  const OTHER = '33333333-3333-3333-3333-333333333333';
  for (const [id, email] of [[SELLER, 'sam@example.com'], [BUYER, 'bea@example.com'], [OTHER, 'olly@example.com']]) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  }
  const prof = await db.query('select id, username from public.profiles order by username');
  ok(prof.rows.length === 3, `signup trigger created a profile per user (${prof.rows.map(r => r.username).join(', ')})`);

  // --- profiles ---
  await as(db, SELLER, `update public.profiles set kyc_verified = true, is_pro = true, bio = 'hi' where id = $1`, [SELLER]);
  const p1 = (await db.query('select kyc_verified, is_pro, bio from public.profiles where id = $1', [SELLER])).rows[0];
  ok(p1.bio === 'hi' && !p1.kyc_verified && !p1.is_pro, 'user can edit own bio but cannot self-grant KYC-verified or Pro');
  await as(db, OTHER, `update public.profiles set bio = 'hacked' where id = $1`, [SELLER]);
  ok((await db.query('select bio from public.profiles where id=$1', [SELLER])).rows[0].bio === 'hi', "user cannot edit someone else's profile");

  // --- listings ---
  const L = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, tier, published) values ($1, 'Heirloom Watch', 180000, 'ultraLuxury', false) returning id, status`, [SELLER])).rows[0];
  ok(L.status === 'active', 'seller creates a draft listing (status defaults to active)');
  await rejects(as(db, SELLER, `insert into public.listings (seller_id, title, price_pence) values ($1, 'Fake', 100)`, [OTHER]), 'cannot create a listing in someone else\'s name', /row-level security/);
  ok((await as(db, BUYER, 'select id from public.listings')).rows.length === 0, 'draft is invisible to other users');
  ok((await as(db, null, 'select id from public.listings')).rows.length === 0, 'draft is invisible to signed-out visitors');
  await as(db, BUYER, `update public.listings set price_pence = 1 where id = $1`, [L.id]);
  ok((await db.query('select price_pence from public.listings where id=$1', [L.id])).rows[0].price_pence === 180000, "other users cannot edit a seller's listing");

  await rejects(as(db, BUYER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence) values ($1, $2, $3, 1)`, [L.id, BUYER, SELLER]), 'cannot buy an unpublished listing', /not published/);

  await as(db, SELLER, `update public.listings set published = true where id = $1`, [L.id]);
  ok((await as(db, null, 'select id from public.listings')).rows.length === 1, 'published listing is visible to signed-out visitors');

  // --- orders ---
  await rejects(as(db, SELLER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence) values ($1, $2, $2, 1)`, [L.id, SELLER]), 'seller cannot buy their own listing', /own listing/);
  await rejects(as(db, BUYER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence) values ($1, $2, $3, 1)`, [L.id, OTHER, SELLER]), 'cannot place an order in someone else\'s name', /row-level security/);

  const O = (await as(db, BUYER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence, fees) values ($1, $2, $3, 1, '{"x":1}') returning id, price_pence, seller_id`, [L.id, BUYER, OTHER])).rows[0];
  ok(O.price_pence === 180000 && O.seller_id === SELLER, 'order price and seller are forced from the listing (client sent £0.01 and the wrong seller)');
  ok((await db.query('select status from public.listings where id=$1', [L.id])).rows[0].status === 'sold', 'listing is marked sold in the same transaction');
  await rejects(as(db, OTHER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence) values ($1, $2, $3, 0)`, [L.id, OTHER, SELLER]), 'a second buyer cannot buy the same item', /already been sold/);

  ok((await as(db, SELLER, 'select id from public.orders')).rows.length === 1, 'seller sees the order');
  ok((await as(db, BUYER, 'select id from public.orders')).rows.length === 1, 'buyer sees the order');
  ok((await as(db, OTHER, 'select id from public.orders')).rows.length === 0, 'unrelated user cannot see the order');
  try { ok((await as(db, null, 'select id from public.orders')).rows.length === 0, 'signed-out visitor cannot see any orders'); }
  catch (e) { ok(/permission denied/.test(e.message), 'signed-out visitor cannot see any orders — refused outright'); }

  await as(db, BUYER, `update public.orders set price_pence = 1, buyer_id = $2, status = 'handover', timeline_state = '{"a":1}' where id = $1`, [O.id, OTHER]);
  const o2 = (await db.query('select price_pence, buyer_id, status, timeline_state from public.orders where id=$1', [O.id])).rows[0];
  ok(o2.price_pence === 180000 && o2.buyer_id === BUYER, 'price and parties are immutable after purchase');
  ok(o2.status === 'handover' && o2.timeline_state.a === 1, 'buyer/seller can still progress status and sync custody state');
  await as(db, OTHER, `update public.orders set status = 'confirmed' where id = $1`, [O.id]);
  ok((await db.query('select status from public.orders where id=$1', [O.id])).rows[0].status === 'handover', 'unrelated user cannot change the order');

  await rejects(as(db, SELLER, 'delete from public.listings where id = $1', [L.id]), 'a sold listing with an order cannot be deleted', /foreign key/);


  // --- 004: categories and search ---
  ok((await as(db, null, 'select slug from public.categories')).rows.length >= 9, 'categories are readable by signed-out visitors');
  await rejects(as(db, SELLER, `insert into public.categories (slug, name) values ('x', 'X')`), 'customers cannot add categories');
  const L2 = (await as(db, SELLER, `insert into public.listings (seller_id, title, brand, description, price_pence, published, size_label, colour, category) values ($1, 'Beaufort wax jacket', 'Barbour', 'Re-waxed in March', 12000, true, 'M', 'Olive', 'men') returning id`, [SELLER])).rows[0];
  const hit = await as(db, null, `select id from public.listings where search @@ to_tsquery('simple', 'barbour & jacket:*')`);
  ok(hit.rows.some(r => r.id === L2.id), 'full-text search finds a listing by brand and title prefix');
  await rejects(as(db, SELLER, `update public.listings set item_id = 'nope' where id = $1`, [L2.id]), 'Item ID must look like IT-2026-00001', /item_id_format/);

  // --- 004: listing media ---
  const Ldraft = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence) values ($1, 'Draft lamp', 1500) returning id`, [SELLER])).rows[0];
  await as(db, SELLER, `insert into public.listing_media (listing_id, seller_id, path, shot) values ($1, $2, $3, 'front'), ($4, $2, $5, 'front')`, [L2.id, SELLER, `${SELLER}/${L2.id}/1.jpg`, Ldraft.id, `${SELLER}/${Ldraft.id}/1.jpg`]);
  ok((await as(db, null, 'select listing_id from public.listing_media')).rows.length === 1, 'visitors see media of published listings only, not drafts');
  await rejects(as(db, OTHER, `insert into public.listing_media (listing_id, seller_id, path) values ($1, $2, 'x.jpg')`, [L2.id, OTHER]), "cannot add photos to someone else's listing");
  await as(db, OTHER, `delete from public.listing_media where listing_id = $1`, [L2.id]);
  ok((await db.query('select count(*)::int as n from public.listing_media where listing_id = $1', [L2.id])).rows[0].n === 1, "cannot delete someone else's photos");

  // --- 005: storage folders ---
  await as(db, SELLER, `insert into storage.objects (bucket_id, name) values ('listing-media', $1)`, [`${SELLER}/${L2.id}/2.jpg`]);
  ok((await db.query(`select count(*)::int as n from storage.objects`)).rows[0].n === 1, 'seller can upload into their own folder');
  await rejects(as(db, OTHER, `insert into storage.objects (bucket_id, name) values ('listing-media', $1)`, [`${SELLER}/${L2.id}/evil.jpg`]), "cannot upload into another seller's folder");

  // --- 004: API keys ---
  const { createHash } = await import('node:crypto');
  const secret = 'pv_live_AbCd1234_' + 'x'.repeat(40);
  const hash = createHash('sha256').update(secret).digest('hex');
  await as(db, SELLER, `insert into public.api_keys (owner_id, name, prefix, key_hash, scopes) values ($1, 'Shop sync', 'pv_live_AbCd1234', $2, '{listings:read}')`, [SELLER, hash]);
  await rejects(as(db, SELLER, `insert into public.api_keys (owner_id, name, prefix, key_hash) values ($1, 'x', 'pv_live_ZzZz9999', $2)`, [OTHER, hash]), 'cannot create a key for someone else');
  await rejects(as(db, SELLER, `insert into public.api_keys (owner_id, name, prefix, key_hash, scopes) values ($1, 'x', 'pv_live_YyYy8888', $2, '{admin}')`, [SELLER, hash]), 'unknown scopes are refused', /check/);
  await rejects(as(db, SELLER, 'select key_hash from public.api_keys'), 'owners cannot read a key hash back', /permission denied/);
  ok((await as(db, SELLER, 'select name from public.api_keys')).rows.length === 1, 'owner sees their key');
  ok((await as(db, OTHER, 'select name from public.api_keys')).rows.length === 0, "other users cannot see someone's keys");
  const a1 = (await as(db, null, 'select * from public.api_authenticate($1, $2)', ['pv_live_AbCd1234', hash])).rows;
  const a2 = (await as(db, null, 'select * from public.api_authenticate($1, $2)', ['pv_live_AbCd1234', hash])).rows;
  ok(a1.length === 1 && a1[0].owner_id === SELLER && a1[0].calls === 1 && a2[0].calls === 2, 'a valid key authenticates and calls are counted per minute');
  ok((await as(db, null, 'select * from public.api_authenticate($1, $2)', ['pv_live_AbCd1234', '0'.repeat(64)])).rows.length === 0, 'a wrong secret authenticates nothing');
  await rejects(as(db, null, 'select * from public.api_usage'), 'usage counts are not readable through the API', /permission denied/);
  await as(db, SELLER, `update public.api_keys set revoked_at = now() where prefix = 'pv_live_AbCd1234'`);
  ok((await as(db, null, 'select * from public.api_authenticate($1, $2)', ['pv_live_AbCd1234', hash])).rows.length === 0, 'a revoked key stops working at once');

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL DATABASE / RLS CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
