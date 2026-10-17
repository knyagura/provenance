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
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
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
  await db.exec(read('006_selling.sql'));
  await db.exec(read('007_accounts.sql'));
  await db.exec(read('008_checkout.sql'));
  await db.exec(read('009_listing_edits.sql'));
  await db.exec(read('010_transaction_fee.sql'));
  await db.exec(read('011_custody.sql'));
  await db.exec(read('012_marketplace.sql'));
  await db.exec(read('013_baskets.sql'));
  await db.exec(read('014_contact.sql'));
  await db.exec(read('015_fk_indexes.sql'));
  await db.exec(read('016_notifications.sql'));
  await db.exec(read('018_variants.sql'));
  await db.exec(read('019_saved_searches.sql'));
  await db.exec(read('020_seller_tools.sql'));
  await db.exec(read('021_popups.sql'));
  await db.exec(read('022_vouchers_gift_cards.sql'));
  await db.exec(read('024_popup_off.sql'));
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
  await db.exec(read('006_selling.sql'));
  await db.exec(read('007_accounts.sql'));
  await db.exec(read('008_checkout.sql'));
  await db.exec(read('009_listing_edits.sql'));
  await db.exec(read('010_transaction_fee.sql'));
  await db.exec(read('011_custody.sql'));
  await db.exec(read('012_marketplace.sql'));
  await db.exec(read('013_baskets.sql'));
  await db.exec(read('014_contact.sql'));
  await db.exec(read('015_fk_indexes.sql'));
  await db.exec(read('016_notifications.sql'));
  await db.exec(read('018_variants.sql'));
  await db.exec(read('019_saved_searches.sql'));
  await db.exec(read('020_seller_tools.sql'));
  await db.exec(read('021_popups.sql'));
  await db.exec(read('022_vouchers_gift_cards.sql'));
  await db.exec(read('024_popup_off.sql'));
  ok(true, 'schema + migrations 002-016, 018-022 and 024 apply cleanly, and re-run idempotently');

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
  await rejects(db.query(`update public.listings set item_id = 'nope' where id = $1`, [L2.id]), 'Item ID must look like IT-2026-00001', /item_id_format/);
  await as(db, SELLER, `update public.listings set item_id = 'IT-2026-00001', views = 999 where id = $1`, [L2.id]);
  const prot = (await db.query('select item_id, views from public.listings where id = $1', [L2.id])).rows[0];
  ok(prot.item_id === null && prot.views === 0, 'sellers cannot set the Item ID or view counts themselves');

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

  // --- 006: selling ---
  const prof006 = (await as(db, null, `select evidence_profile from public.categories where slug = 'electronics'`)).rows[0].evidence_profile;
  ok(prof006.shots.some(x => x.key === 'working' && x.kind === 'video' && x.required) && prof006.serial.required, 'electronics needs a working video and a serial number');
  const E = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, category, evidence_version, item_id, views) values ($1, 'Untitled draft', 98000, 'electronics', 1, 'IT-2026-00009', 5) returning id, tier, item_id, views`, [SELLER])).rows[0];
  ok(E.tier === 'luxury' && E.item_id === null && E.views === 0, 'a new draft gets its tier from the price (£980 → luxury) and cannot set platform fields');
  await rejects(as(db, SELLER, `update public.listings set published = true where id = $1`, [E.id]), 'an empty draft cannot be published, and the reason lists what is missing', /Front.*Back.*Serial number or IMEI.*Working video.*title.*condition.*parcel size/);
  const put = (shot, kind = 'photo', listing = E.id, who = SELLER) => as(db, who, `insert into public.listing_media (listing_id, seller_id, path, shot, kind) values ($1, $2, $3, $4, $5)`, [listing, who, `${who}/${listing}/${shot}.jpg`, shot, kind]);
  await put('front'); await put('back'); await put('serial');
  await put('working', 'photo');
  await as(db, SELLER, `update public.listings set title = 'Fujifilm X100V', condition_label = 'Very good', parcel_size = 'medium' where id = $1`, [E.id]);
  await rejects(as(db, SELLER, `update public.listings set published = true where id = $1`, [E.id]), 'a photo does not count where the profile needs a video, and the serial is still missing', /Working video, Serial number or IMEI$/);
  await put('working', 'video');
  await rejects(as(db, SELLER, `insert into public.listing_media (listing_id, seller_id, path, shot) values ($1, $2, $3, 'x')`, [E.id, SELLER, `${SELLER}/someone-else/x.jpg`]), 'media must sit in the listing’s own folder', /own folder/);
  await rejects(as(db, OTHER, `insert into public.listing_secrets (listing_id, seller_id, serial_number) values ($1, $2, 'ABCD1234')`, [E.id, OTHER]), "cannot add a serial to someone else's listing", /row-level security/);
  await as(db, SELLER, `insert into public.listing_secrets (listing_id, seller_id, serial_number) values ($1, $2, '7k3 m 4d7k')`, [E.id, SELLER]);
  await as(db, SELLER, `update public.listings set published = true where id = $1`, [E.id]);
  const Epub = (await as(db, null, 'select published, serial_hint from public.listings where id = $1', [E.id])).rows[0];
  ok(Epub.published && Epub.serial_hint === '4D7K', 'with every required shot, the video and the serial, the listing goes live; buyers see only the last 4 characters');
  ok((await as(db, BUYER, 'select * from public.listing_secrets')).rows.length === 0, 'other users cannot read the serial number');
  await rejects(as(db, null, 'select * from public.listing_secrets'), 'signed-out visitors cannot read serial numbers', /permission denied/);
  ok((await as(db, SELLER, 'select serial_number from public.listing_secrets')).rows[0].serial_number === '7k3 m 4d7k', 'the seller can read their own serial');
  await rejects(as(db, SELLER, `delete from public.listing_media where listing_id = $1 and shot = 'front'`, [E.id]), 'photos of a live listing cannot be removed without pausing it', /Pause the listing/);
  await rejects(put('extra'), 'nor can photos be added while it is live', /Pause the listing/);
  await rejects(as(db, SELLER, `update public.listing_secrets set serial_number = 'ZZZZ9999' where listing_id = $1`, [E.id]), 'the serial cannot change while live', /Pause the listing to change its serial/);
  await rejects(as(db, SELLER, `update public.listings set category = 'home' where id = $1`, [E.id]), 'changing category while live is refused unless the new category’s evidence is there', /Not ready to publish: Maker's mark/);
  await as(db, SELLER, `update public.listings set evidence_version = 0, price_pence = 5000 where id = $1`, [E.id]);
  const Edown = (await db.query('select evidence_version, tier from public.listings where id = $1', [E.id])).rows[0];
  ok(Edown.evidence_version === 1 && Edown.tier === 'enhanced', 'sellers cannot switch the rules off; a lower price lowers the tier (£50 → enhanced)');
  const C = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, category, evidence_version, condition_label, parcel_size) values ($1, 'Wool coat', 4500, 'women', 1, 'Good', 'large') returning id`, [SELLER])).rows[0];
  await put('front', 'photo', C.id); await put('back', 'photo', C.id);
  await rejects(as(db, SELLER, `update public.listings set published = true where id = $1`, [C.id]), 'clothing needs its label photo', /Size and care label/);
  await as(db, SELLER, `update public.listings set declined_shots = '{label}', published = true where id = $1`, [C.id]);
  ok((await as(db, null, 'select id from public.listings where id = $1', [C.id])).rows.length === 1, 'or the seller can say "No label" and publish');
  const D = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, category, evidence_version, condition_label, parcel_size, declined_shots) values ($1, 'Bag', 90000, 'designer', 1, 'Good', 'medium', '{front,back,label,hardware}') returning id`, [SELLER])).rows[0];
  await rejects(as(db, SELLER, `update public.listings set published = true where id = $1`, [D.id]), 'shots without a "No …" option cannot be declined', /Front, Back, Brand stamp or label, Serial or date code, Hardware close-up/);
  await rejects(as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, category, evidence_version, published) values ($1, 'Instant', 1000, 'home', 1, true)`, [SELLER]), 'a listing cannot be created already live without its evidence', /Not ready/);
  const legacy = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, published) values ($1, 'From the old app', 1000, true) returning published`, [SELLER])).rows[0];
  ok(legacy.published, 'listings from the current app (evidence version 0) publish as before');
  ok((await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'listing-media'`)).rows[0].allowed_mime_types.includes('video/quicktime'), 'the photo bucket accepts iPhone video');

  // --- 007: accounts ---
  await as(db, SELLER, `update public.profiles set username = 'Resole_Archive' where id = $1`, [SELLER]);
  await rejects(as(db, OTHER, `update public.profiles set username = 'resole_archive' where id = $1`, [OTHER]), 'usernames are unique ignoring case', /profiles_username_lower_idx|duplicate key/);
  for (const bad of ['ab', 'has space', 'emoji😀', 'x'.repeat(31), 'semi;colon']) {
    await rejects(as(db, SELLER, `update public.profiles set username = $2 where id = $1`, [SELLER, bad]), `username "${bad.slice(0, 12)}" is refused`, /profiles_username_format/);
  }
  await rejects(as(db, SELLER, `update public.profiles set bio = $2 where id = $1`, [SELLER, 'x'.repeat(501)]), 'a bio is at most 500 characters', /profiles_bio_len/);
  await as(db, SELLER, `update public.profiles set holiday_mode = true where id = $1`, [SELLER]);
  ok((await db.query('select holiday_mode from public.profiles where id = $1', [SELLER])).rows[0].holiday_mode === true, 'a seller can turn holiday mode on');
  await as(db, SELLER, `update public.profiles set holiday_mode = false where id = $1`, [SELLER]);
  await db.query(`insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'Jo+Shop!@Example.com'), ('55555555-5555-5555-5555-555555555555', '+@example.com')`);
  const made = (await db.query(`select username from public.profiles where id in ('44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555') order by id`)).rows.map(r => r.username);
  ok(made[0] === 'joshop_4444' && made[1] === 'member_5555', `sign-up makes usernames that fit the rules (${made.join(', ')})`);

  // --- 008: fees and checkout ---
  const baskets = JSON.parse(fs.readFileSync(path.join(here, '..', 'backend', 'fixtures', 'fee_baskets.json'), 'utf8')).baskets;
  const camel = { promotionShareBp: 'promotion_share_bp', transactionMaxBp: 'transaction_max_bp' };
  let basketFails = [];
  for (const b of baskets) {
    const over = Object.fromEntries(Object.entries(b.settings ?? {}).map(([k, v]) => [camel[k], v]));
    const r = (await as(db, null, `select public.compute_fees((select settings from public.fee_settings where version = $6) || $1::jsonb, $2, $3, $4, $5, $6) as q`, [JSON.stringify(over), b.price, b.postage, b.payer, b.boostBp, b.version])).rows[0].q;
    const got = { tier: r.tier, protection: r.protection_pence, processing: r.processing_pence, courier: r.courier_pence, hub: r.hub_pence, promotion: r.promotion_pence, buyerTotal: r.buyer_total_pence, commission: r.commission_pence, sellerFees: r.seller_fees_pence, sellerPayout: r.seller_payout_pence };
    if (JSON.stringify(got) !== JSON.stringify(b.expect)) basketFails.push(`${b.name}: ${JSON.stringify(got)}`);
  }
  ok(basketFails.length === 0, `the database's fee engine gives the agreed figures for all ${baskets.length} test baskets${basketFails.length ? ' — ' + basketFails.join(' | ') : ''}`);
  await rejects(as(db, BUYER, `insert into public.fee_settings (version, settings) values (2, '{}')`), 'customers cannot change the fees', /permission denied/);

  const shop = async (title, price, ship) => (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, $4, true) returning id`, [SELLER, title, price, ship])).rows[0].id;
  const coat = await shop('Wool coat to buy', 4000, 399);
  const quote = (await as(db, null, 'select public.order_quote($1) as q', [coat])).rows[0].q;
  ok(quote.buyer_total_pence === 4799 && quote.fee_version === 2 && quote.transaction_rate_bp === 800, 'anyone can see the price breakdown for a live listing, on fee version 2 (£40 + £3.99 postage + 8% + £0.80 → £47.99)');
  await rejects(as(db, null, 'select public.start_checkout($1)', [coat]), 'signed-out visitors cannot start a checkout', /permission denied|Sign in/);
  const co = (await as(db, BUYER, 'select public.start_checkout($1) as c', [coat])).rows[0].c;
  const ord = (await db.query('select * from public.orders where id = $1', [co.order_id])).rows[0];
  const held = (await db.query('select status from public.listings where id = $1', [coat])).rows[0].status;
  ok(ord.payment_status === 'awaiting_payment' && ord.total_pence === 4799 && ord.fee_version === 2 && ord.seller_id === SELLER && held === 'reserved', 'checkout prices the order on the server and holds the item');
  const again = (await as(db, BUYER, 'select public.start_checkout($1) as c', [coat])).rows[0].c;
  ok(again.order_id === co.order_id, 'pressing Pay twice continues the same order');
  await rejects(as(db, OTHER, 'select public.start_checkout($1)', [coat]), 'a second buyer cannot take a held item', /buying this right now/);
  await rejects(as(db, SELLER, 'select public.start_checkout($1)', [await shop('Own lamp', 1500, 295)]), 'sellers cannot buy their own items', /own listing/);
  await as(db, BUYER, `update public.orders set payment_status = 'paid', total_pence = 1, status = 'handover' where id = $1`, [co.order_id]);
  const tamper = (await db.query('select payment_status, total_pence, status from public.orders where id = $1', [co.order_id])).rows[0];
  ok(tamper.payment_status === 'awaiting_payment' && tamper.total_pence === 4799 && tamper.status === 'purchased', 'buyers cannot mark an order paid, change its total or move an unpaid order along');
  await rejects(as(db, BUYER, `select public.confirm_payment($1, 'pi_fake', 4799)`, [co.order_id]), 'buyers cannot confirm their own payment', /permission denied/);
  const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
  ok((await svc(`select public.confirm_payment($1, 'pi_short', 100) as r`, [co.order_id])).rows[0].r === 'amount_mismatch', 'a payment for the wrong amount is held for review');
  await db.query(`update public.orders set payment_status = 'awaiting_payment' where id = $1`, [co.order_id]);
  ok((await svc(`select public.confirm_payment($1, 'pi_1', 4799) as r`, [co.order_id])).rows[0].r === 'paid', 'the payment service confirms a payment for the right amount');
  ok((await svc(`select public.confirm_payment($1, 'pi_1', 4799) as r`, [co.order_id])).rows[0].r === 'already_paid', 'the same payment confirmed twice changes nothing');
  ok((await db.query('select status from public.listings where id = $1', [coat])).rows[0].status === 'sold', 'once paid, the item is sold');
  await as(db, BUYER, `update public.orders set status = 'confirmed', custody_state = 'confirmed', payout_status = 'due', custody_step = 3 where id = $1`, [co.order_id]);
  const cs = (await db.query('select status, custody_state, payout_status, custody_step, custody_tier from public.orders where id = $1', [co.order_id])).rows[0];
  ok(cs.custody_state === 'in_progress' && cs.custody_tier === 'enhanced' && cs.custody_step === 0 && cs.payout_status === 'held' && cs.status === 'purchased',
    'paying starts custody; buyers cannot move a paid order along or release its payment themselves (only custody steps can)');

  const belt = await shop('Belt to abandon', 1400, 295);
  const c2 = (await as(db, BUYER, 'select public.start_checkout($1) as c', [belt])).rows[0].c;
  await as(db, BUYER, 'select public.cancel_checkout($1)', [c2.order_id]);
  ok((await db.query('select status from public.listings where id = $1', [belt])).rows[0].status === 'active', 'cancelling a checkout frees the item');
  const c3 = (await as(db, OTHER, 'select public.start_checkout($1) as c', [belt])).rows[0].c;
  await db.query(`update public.orders set hold_expires_at = now() - interval '1 minute' where id = $1`, [c3.order_id]);
  const c4 = (await as(db, BUYER, 'select public.start_checkout($1) as c', [belt])).rows[0].c;
  ok(c4.order_id !== c3.order_id && (await db.query('select payment_status from public.orders where id = $1', [c3.order_id])).rows[0].payment_status === 'expired', 'an unpaid hold expires, and the next buyer can check out');
  ok((await svc(`select public.confirm_payment($1, 'pi_late', $2) as r`, [c3.order_id, c3.quote.buyer_total_pence])).rows[0].r === 'needs_refund', 'a late payment for an item someone else now holds is flagged for a refund');

  const lamp = await shop('Lamp from someone away', 1500, 295);
  await as(db, SELLER, `update public.profiles set holiday_mode = true where id = $1`, [SELLER]);
  ok((await as(db, null, 'select public.order_quote($1) as q', [lamp])).rows[0].q === null, 'items from sellers on holiday cannot be bought');
  await as(db, SELLER, `update public.profiles set holiday_mode = false where id = $1`, [SELLER]);
  const legacyItem = await shop('Bought in the old app', 2000, 0);
  await as(db, BUYER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence, payment_status, paid_at) values ($1, $2, $2, 1, 'paid', now())`, [legacyItem, BUYER]);
  const lo = (await db.query('select payment_status, paid_at, price_pence from public.orders where listing_id = $1', [legacyItem])).rows[0];
  ok(lo.payment_status === 'legacy' && lo.paid_at === null && lo.price_pence === 2000, 'orders from the current app still work, and cannot claim to be paid');

  // --- 009: editing live listings, with history ---
  const vase = (await as(db, SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, category, evidence_version, condition_label, parcel_size) values ($1, 'Studio vase', 3000, 399, 'home', 1, 'Good', 'small') returning id`, [SELLER])).rows[0].id;
  const media = (shot, file, who = SELLER) => as(db, who, `insert into public.listing_media (listing_id, seller_id, path, shot, kind) values ($1, $2, $3, $4, 'photo') returning id`, [vase, who, `${who}/${vase}/${file}`, shot]);
  const front1 = (await media('front', 'front-1.jpg')).rows[0].id;
  await media('mark', 'mark-1.jpg');
  await as(db, SELLER, `update public.listings set published = true where id = $1`, [vase]);
  const rev = async () => (await db.query('select revision, tier, status from public.listings where id = $1', [vase])).rows[0];
  const r1 = (await db.query('select snapshot from public.listing_revisions where listing_id = $1 and revision = 1', [vase])).rows[0]?.snapshot;
  ok((await rev()).revision === 1 && r1?.media?.length === 2 && r1.price_pence === 3000, 'publishing makes revision 1 and keeps a snapshot of exactly what buyers see');
  await as(db, SELLER, `update public.listings set price_pence = 8000 where id = $1`, [vase]);
  ok((await rev()).revision === 2 && (await rev()).tier === 'verified', 'a seller can change the price of a live listing: revision 2, and the tier follows (£80 → courier witnessed)');
  await as(db, SELLER, `update public.listings set price_pence = 3000 where id = $1`, [vase]);
  await rejects(as(db, SELLER, `update public.listings set title = '' where id = $1`, [vase]), 'a live listing cannot be changed into one that would fail the publish check', /Not ready to publish: title/);
  await as(db, SELLER, `update public.listings set published = false where id = $1`, [vase]);
  await as(db, SELLER, `update public.listing_media set retired_at = now(), path = 'tampered' where id = $1`, [front1]);
  const retired = (await db.query('select retired_at, path from public.listing_media where id = $1', [front1])).rows[0];
  ok(retired.retired_at !== null && retired.path.endsWith('front-1.jpg'), 'pausing lets the seller retire a photo; the file it points at cannot be swapped');
  await rejects(as(db, SELLER, 'delete from public.listing_media where id = $1', [front1]), 'photos of a listing that has been live are never deleted', /kept for its history/);
  await rejects(as(db, SELLER, `update public.listings set published = true where id = $1`, [vase]), 'it cannot go back live with a required photo missing', /Not ready to publish: Front/);
  await media('front', 'front-2.jpg');
  await as(db, SELLER, `update public.listings set title = 'Studio vase, signed', category = 'home', published = true where id = $1`, [vase]);
  ok((await rev()).revision === 4, 'publishing the changes makes the next revision');
  const shown = (await as(db, null, `select path from public.listing_media where listing_id = $1 and shot = 'front'`, [vase])).rows.map((x) => x.path);
  ok(shown.length === 1 && shown[0].endsWith('front-2.jpg'), 'buyers see only the current photo; the retired one is hidden');
  const r1again = (await db.query('select snapshot from public.listing_revisions where listing_id = $1 and revision = 1', [vase])).rows[0].snapshot;
  ok(r1again.media.some((m) => m.path.endsWith('front-1.jpg')) && r1again.title === 'Studio vase', 'the first revision still records the original title and photo');
  await db.query(`insert into storage.objects (bucket_id, name) values ('listing-media', $1)`, [`${SELLER}/${vase}/front-1.jpg`]);
  await as(db, SELLER, 'delete from storage.objects where name = $1', [`${SELLER}/${vase}/front-1.jpg`]);
  ok((await db.query('select count(*)::int as n from storage.objects where name = $1', [`${SELLER}/${vase}/front-1.jpg`])).rows[0].n === 1, 'a photo file that history points at cannot be deleted from storage');
  await rejects(as(db, SELLER, 'delete from public.listings where id = $1', [vase]), 'a listing that has been live cannot be deleted', /kept for its history/);
  ok((await as(db, SELLER, 'select revision from public.listing_revisions where listing_id = $1 order by revision', [vase])).rows.map((x) => x.revision).join() === '1,2,3,4', 'the seller can see every revision of their listing');
  ok((await as(db, BUYER, 'select * from public.listing_revisions where listing_id = $1', [vase])).rows.length === 0, 'other members cannot read a listing’s history');

  // Someone viewing revision 3 while the seller publishes revision 4.
  await rejects(as(db, BUYER, 'select public.start_checkout($1, 3)', [vase]), 'a buyer who was looking at an older version is stopped before anything is held', /LISTING_CHANGED/);
  ok((await rev()).status === 'active', 'and the item is not held');
  const c9 = (await as(db, BUYER, 'select public.start_checkout($1, 4) as c', [vase])).rows[0].c;
  const o9 = (await db.query('select listing_revision, listing_snapshot from public.orders where id = $1', [c9.order_id])).rows[0];
  ok(o9.listing_revision === 4 && o9.listing_snapshot.title === 'Studio vase, signed' && o9.listing_snapshot.media.some((m) => m.path.endsWith('front-2.jpg')), 'the order records the revision and a snapshot of exactly what was bought');
  await rejects(as(db, SELLER, `update public.listings set price_pence = 2000 where id = $1`, [vase]), 'while someone is paying, the seller cannot change the listing', /buying this item right now/);
  await rejects(as(db, SELLER, `update public.listings set published = false where id = $1`, [vase]), 'or pause it', /buying this item right now/);
  await rejects(media('extra', 'extra.jpg'), 'or change its photos', /buying this item right now/);
  await as(db, BUYER, `update public.orders set listing_snapshot = '{}'::jsonb, listing_revision = 1 where id = $1`, [c9.order_id]);
  ok((await db.query('select listing_revision from public.orders where id = $1', [c9.order_id])).rows[0].listing_revision === 4, 'buyers cannot rewrite the record of what they bought');
  await svc(`select public.confirm_payment($1, 'pi_vase', $2)`, [c9.order_id, c9.quote.buyer_total_pence]);
  await rejects(as(db, SELLER, `update public.listings set description = 'changed after sale' where id = $1`, [vase]), 'once sold, the listing is locked for good', /has been sold/);

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
