// Migration 020: bundle discounts, sold history and the sales dashboard. Real Postgres (PGlite), through Row Level Security.
// Usage: node seller_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = { SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222', OTHER: '33333333-3333-3333-3333-333333333333' };
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const shop = async (title, price, seller = U.SELLER) =>
  (await one(seller, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [seller, title, price])).id;
const sellerName = (await db.query('select username from public.profiles where id = $1', [U.SELLER])).rows[0].username;

console.log('=== Bundle discount settings ===');
await rejects(as(db, U.SELLER, 'select public.set_bundle_discount(1, 10)'), 'a bundle needs at least 2 items', /2 to 10 items/);
await rejects(as(db, U.SELLER, 'select public.set_bundle_discount(2, 80)'), 'and at most 50% off', /5% to 50%/);
const set = (await one(U.SELLER, 'select public.set_bundle_discount(2, 10) as b')).b;
ok(set.min_items === 2 && set.pct === 10, 'the seller offers 10% off 2 or more');
ok((await one(null, 'select public.bundle_offer($1) as b', [sellerName])).b.pct === 10, 'anyone can see the offer');
await rejects(as(db, U.OTHER, 'update public.profiles set bundle_pct = 90, bundle_min_items = 2 where id = $1', [U.OTHER]), 'the rules hold for direct edits too', /profiles_bundle_check/);

console.log('\n=== Applied at basket checkout ===');
const a = await shop('Linen shirt', 3000);
const b = await shop('Wool scarf', 2000);
const c = await shop('Other seller’s mug', 1500, U.OTHER);
for (const l of [a, b, c]) await as(db, U.BUYER, 'select public.basket_put($1, null)', [l]);
const g = (await one(U.BUYER, `select public.start_basket_checkout('combined') as g`)).g;
const byTitle = Object.fromEntries(g.orders.map((o) => [o.title ?? o.listing_id, o]));
const shirt = g.orders.find((o) => o.listing_id === a);
const mug = g.orders.find((o) => o.listing_id === c);
ok(shirt.quote.price_pence === 2700 && shirt.quote.bundle_discount_pence === 300 && shirt.quote.list_price_pence === 3000, 'two items from one seller: £30 shirt now £27');
ok(!('bundle_pct' in mug.quote), 'the other seller’s single item is full price');
const sum = g.orders.reduce((t, o) => t + o.total_pence, 0);
ok(g.total_pence === sum + (g.wrap_total_pence ?? 0), `the one payment matches the discounted orders (£${(g.total_pence / 100).toFixed(2)})`);
const fees = (await db.query('select fees, total_pence from public.orders where id = $1', [shirt.order_id])).rows[0];
ok(fees.total_pence === fees.fees.buyer_total_pence && fees.fees.seller_payout_pence === 2700, 'fees and the seller’s payout are worked out on the discounted price');
const paid = (await svc('select public.confirm_group_payment($1, $2, $3) as r', [g.group_id, 'pi_group', g.total_pence])).rows[0].r;
ok(/paid/.test(JSON.stringify(paid)), 'the group is paid at the discounted total');
ok(Object.keys(byTitle).length === 3, '(three orders in the checkout)');

console.log('\n=== Sold history and dashboard ===');
const d = (await one(U.SELLER, 'select public.seller_dashboard() as d')).d;
ok(d.totals.sold === 2 && d.totals.gross_pence === 4500 && d.totals.bundles === 2, 'the dashboard counts 2 sold, £45 taken, both in a bundle');
ok(d.totals.held_pence > 0 && d.totals.released_pence === 0, 'payment is held until the buyers confirm');
ok(d.recent.length === 2 && d.recent.every((r) => r.buyer && r.bundle && r.state === 'in_progress'), 'the sold history lists each order with its buyer and handover state');
ok(d.months.length === 1 && d.months[0].sold === 2, 'and this month’s sales');
ok(d.bundle.pct === 10, 'with the bundle offer');
const other = (await one(U.OTHER, 'select public.seller_dashboard() as d')).d;
ok(other.totals.sold === 1 && other.recent.every((r) => r.listing_id === c), 'each seller sees only their own sales');
ok((await one(U.BUYER, 'select public.seller_dashboard() as d')).d.totals.sold === 0, 'buyers see nothing of the sellers’');
await as(db, U.SELLER, 'select public.set_bundle_discount(null, null)');
ok((await one(null, 'select public.bundle_offer($1) as b', [sellerName])).b === null, 'the seller can switch the bundle offer off');

console.log(failures ? `\n${failures} FAILED` : '\nall seller checks passed');
process.exit(failures ? 1 : 0);
