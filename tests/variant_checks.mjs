// Migration 018: stock and variants for business sellers. Real Postgres (PGlite), acting through Row Level Security.
// Usage: node variant_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = {
  SHOP: '11111111-1111-1111-1111-111111111111', B1: '22222222-2222-2222-2222-222222222222', B2: '33333333-3333-3333-3333-333333333333',
  B3: '66666666-6666-6666-6666-666666666666', STAFF: '44444444-4444-4444-4444-444444444444', PRIVATE: '55555555-5555-5555-5555-555555555555',
};
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const status = async (id) => (await db.query('select status from public.listings where id = $1', [id])).rows[0].status;
const pay = async (orderId) => {
  const o = (await db.query('select total_pence from public.orders where id = $1', [orderId])).rows[0];
  return (await svc('select public.confirm_payment($1, $2, $3) as r', [orderId, 'pi_' + orderId, o.total_pence])).rows[0].r;
};
async function liveTee(seller) {
  const t = (await one(seller, `insert into public.listings (seller_id, title, price_pence, category, evidence_version, condition_label, parcel_size, size_label, colour, declined_shots)
                                values ($1, 'Merino crew jumper', 4500, 'women', 1, 'New with tags', 'small', 'S', 'Oatmeal', '{label}') returning id`, [seller])).id;
  for (const shot of ['front', 'back']) await as(db, seller, `insert into public.listing_media (listing_id, seller_id, path, shot) values ($1, $2, $3, $4)`, [t, seller, `${seller}/${t}/${shot}.jpg`, shot]);
  await as(db, seller, 'update public.listings set published = true where id = $1', [t]);
  return t;
}

console.log('=== Who can sell stock ===');
const priv = await liveTee(U.PRIVATE);
await rejects(as(db, U.PRIVATE, 'select public.set_listing_stock($1, 5)', [priv]), 'a private seller can’t set stock', /business sellers/);
await rejects(as(db, U.PRIVATE, `select public.add_variant($1, 'Navy', 'M', 2)`, [priv]), 'or add variants', /business sellers/);
await as(db, U.PRIVATE, 'update public.listings set stock = 50, variant_group = gen_random_uuid() where id = $1', [priv]);
const pr = (await db.query('select stock, variant_group from public.listings where id = $1', [priv])).rows[0];
ok(pr.stock === 1 && pr.variant_group === null, 'and can’t set them by editing the listing directly');
await rejects(as(db, U.B1, `select public.staff_set_business('shop', true)`), 'members can’t make themselves business sellers', /Staff only/);
const shopName = (await db.query('select username from public.profiles where id = $1', [U.SHOP])).rows[0].username;
ok((await one(U.STAFF, 'select public.staff_set_business($1, true) as r', [shopName])).r.business === true, 'staff mark the shop as a business seller');

console.log('\n=== Variants ===');
const tee = await liveTee(U.SHOP);
await rejects(as(db, U.B1, 'select public.set_listing_stock($1, 3)', [tee]), 'nobody else can change the stock', /not found/);
let v = (await one(U.SHOP, 'select public.set_listing_stock($1, 2) as v', [tee])).v;
ok(v.length === 1 && v[0].stock === 2 && v[0].units_left === 2, 'the shop has 2 of the oatmeal small');
v = (await one(U.SHOP, `select public.add_variant($1, 'Charcoal', 'M', 3) as v`, [tee])).v;
ok(v.length === 2 && v.some((x) => x.colour === 'Charcoal' && x.size === 'M' && x.stock === 3 && x.units_left === 3), 'and adds a charcoal medium with 3 in stock');
await rejects(as(db, U.SHOP, `select public.add_variant($1, 'charcoal', 'm', 1)`, [tee]), 'the same colour and size can’t be added twice', /already have that/);
await rejects(as(db, U.SHOP, `select public.add_variant($1, null, null, 1)`, [tee]), 'a variant needs a colour or size', /colour, a size/);
const charcoal = v.find((x) => x.colour === 'Charcoal').id;
const media = (await db.query('select path from public.listing_media where listing_id = $1 order by path', [charcoal])).rows.map((r) => r.path);
ok(media.length === 2 && media.every((p) => p.startsWith(`${U.SHOP}/${tee}/`)), 'the new variant shows the original’s photos');
ok((await one(null, 'select published, status from public.listings where id = $1', [charcoal])).published, 'and is live straight away');
await rejects(as(db, U.SHOP, `insert into public.listing_media (listing_id, seller_id, path, shot) values ($1, $2, $3, 'front')`, [charcoal, U.SHOP, `${U.SHOP}/${tee}/x.jpg`]),
  'sellers themselves can’t point a listing at another listing’s files', /own folder|Pause the listing/);
const seen = (await as(db, null, `select id from public.listings where published and status = 'active' and browse_visible and title = 'Merino crew jumper' and seller_id = $1`, [U.SHOP])).rows;
ok(seen.length === 1 && seen[0].id === tee, 'search shows one card for the group');
ok((await one(null, 'select public.listing_variants($1) as v', [charcoal])).v.length === 2, 'anyone sees both options from either page');
await rejects(as(db, U.B1, 'select public.make_offer($1, 3000)', [tee]), 'business prices are fixed: no offers', /prices are fixed/);

console.log('\n=== Every unit is its own order ===');
const c1 = (await one(U.B1, 'select public.start_checkout($1, null) as c', [tee])).c;
ok(await status(tee) === 'active', 'one of two held: still on sale');
const c2 = (await one(U.B2, 'select public.start_checkout($1, null) as c', [tee])).c;
ok(await status(tee) === 'reserved', 'both held: reserved');
await rejects(as(db, U.B3, 'select public.start_checkout($1, null)', [tee]), 'a third buyer waits', /Someone else is buying/);
ok((await one(null, 'select public.listing_variants($1) as v', [tee])).v.find((x) => x.id === tee).units_left === 0, 'none left to buy');
await as(db, U.B2, 'select public.cancel_checkout($1)', [c2.order_id]);
ok(await status(tee) === 'active', 'a buyer cancels: back on sale');
ok(await pay(c1.order_id) === 'paid', 'the first buyer pays');
ok(await status(tee) === 'active', 'one sold, one left: still on sale');
const c3 = (await one(U.B3, 'select public.start_checkout($1, null) as c', [tee])).c;
await db.query(`update public.orders set hold_expires_at = now() - interval '1 minute' where id = $1`, [c3.order_id]);
await db.query('select public.release_expired_checkouts()');
ok(await status(tee) === 'active', 'an expired hold frees its unit');
const c4 = (await one(U.B2, 'select public.start_checkout($1, null) as c', [tee])).c;
ok(await pay(c4.order_id) === 'paid', 'the second buyer pays');
ok(await status(tee) === 'sold', 'both sold: sold out');
ok(await pay(c3.order_id) === 'needs_refund', 'a late payment on the expired hold is sent for a refund (no overselling)');
const orders = (await db.query(`select buyer_id, custody_state from public.orders where listing_id = $1 and payment_status = 'paid'`, [tee])).rows;
ok(orders.length === 2 && orders.every((o) => o.custody_state === 'in_progress') && new Set(orders.map((o) => o.buyer_id)).size === 2, 'two separate orders, each with its own protected handover');
const shown = (await as(db, null, `select id from public.listings where published and status = 'active' and browse_visible and seller_id = $1`, [U.SHOP])).rows;
ok(shown.length === 1 && shown[0].id === charcoal, 'sold out: search shows the charcoal one instead');
await rejects(as(db, U.SHOP, 'select public.set_listing_stock($1, 1)', [tee]), 'stock can’t go below what’s sold', /already sold/);
await as(db, U.SHOP, 'select public.set_listing_stock($1, 4)', [tee]);
ok(await status(tee) === 'active', 'restocking puts it back on sale');
await rejects(as(db, U.B1, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence) values ($1, $2, $2, 1)`, [tee, U.B1]), 'stocked items can only be bought through checkout', /through checkout|row-level/);

console.log(failures ? `\n${failures} FAILED` : '\nall variant checks passed');
process.exit(failures ? 1 : 0);
