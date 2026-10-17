// Migration 025: delivery addresses and shipping labels (test mode). Real Postgres (PGlite), through Row Level Security.
// Usage: node label_checks.mjs
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
const shop = async (title, price) =>
  (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [U.SELLER, title, price])).id;
const buy = async (title, price) => {
  const c = (await one(U.BUYER, 'select public.start_checkout($1, null) as c', [await shop(title, price)])).c;
  await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_' + title, c.total_pence ?? c.quote.buyer_total_pence]);
  return c.order_id;
};
const ship = (order, uid = U.SELLER) => one(uid, 'select public.order_shipping($1) as s', [order]).then((r) => r.s);
const addr = { name: 'Bea Buyer', line1: '1 Test Street', town: 'London', postcode: 'sw112ab' };

const o = await buy('Linen shirt', 3000);
console.log('=== Before an address ===');
let s = await ship(o);
ok(s.can_label && !s.has_address && s.address === null, 'the seller can label a paid, posted order, but there is no address yet');
ok(s.quotes.length === 3 && s.quotes[0].prices.small === 319, 'and sees the services with prices for each parcel size');
const asked = (await db.query(`select count(*)::int n from public.notifications where user_id = $1 and dedupe_key = $2`, [U.BUYER, 'address:' + o])).rows[0].n;
ok(asked === 1, 'the buyer was asked for a delivery address when they paid');
await rejects(as(db, U.SELLER, 'select public.create_label($1, $2, $3)', [o, 'evri_dropoff', 'small']), 'no label without an address', /delivery address/);

console.log('\n=== Delivery address ===');
await rejects(as(db, U.SELLER, 'select public.set_delivery_address($1, $2)', [o, JSON.stringify(addr)]), 'only the buyer sets it', /not found/i);
await rejects(as(db, U.BUYER, 'select public.set_delivery_address($1, $2)', [o, JSON.stringify({ ...addr, postcode: '12345' })]), 'a UK postcode is needed', /UK postcode/);
await rejects(as(db, U.BUYER, `update public.orders set deliver_to = '{"name":"x"}' where id = $1`, [o]).then(async () => {
  if ((await db.query('select deliver_to from public.orders where id = $1', [o])).rows[0].deliver_to) throw new Error('changed');
  throw new Error('ignored');
}), 'members can’t write it directly', /ignored|permission/);
s = await one(U.BUYER, 'select public.set_delivery_address($1, $2) as s', [o, JSON.stringify(addr)]).then((r) => r.s);
ok(s.address.postcode === 'SW11 2AB', 'the buyer adds it; the postcode is tidied');
s = await ship(o);
ok(s.has_address && s.address === null, 'the seller knows there is one, but doesn’t see it until they make a label');
await rejects(as(db, U.OTHER, 'select public.order_shipping($1)', [o]), 'nobody else sees the order’s shipping', /not found/i);

console.log('\n=== Labels ===');
await rejects(as(db, U.BUYER, 'select public.create_label($1, $2, $3)', [o, 'evri_dropoff', 'small']), 'only the seller makes a label', /not found/i);
await rejects(as(db, U.SELLER, 'select public.create_label($1, $2, $3)', [o, 'nope', 'small']), 'a real service', /delivery service/);
await rejects(as(db, U.SELLER, 'select public.create_label($1, $2, $3)', [o, 'evri_dropoff', 'huge']), 'a real parcel size', /parcel size/);
s = (await one(U.SELLER, 'select public.create_label($1, $2, $3) as s', [o, 'royalmail_48', 'medium'])).s;
ok(s.label.mode === 'test' && /^P2GTEST[0-9A-F]{9}$/.test(s.label.tracking) && s.label.price_pence === 0, 'a test label: made-up tracking number, no charge');
ok(s.label.carrier === 'Royal Mail' && s.label.deliver_to.postcode === 'SW11 2AB' && s.address.name === 'Bea Buyer', 'with the carrier and the buyer’s address, which the seller now sees');
ok(s.quotes === null, 'no quotes while there is a label');
await rejects(as(db, U.SELLER, 'select public.create_label($1, $2, $3)', [o, 'evri_dropoff', 'small']), 'one label at a time', /already has a label/);
await rejects(as(db, U.BUYER, 'select public.set_delivery_address($1, $2)', [o, JSON.stringify(addr)]), 'the address is fixed once there’s a label', /already printed/);
await rejects(as(db, U.BUYER, 'select * from public.shipping_labels'), 'the labels table isn’t readable directly', /permission denied/);
ok((await ship(o, U.BUYER)).label.tracking === s.label.tracking, 'the buyer sees the tracking number');
s = (await one(U.SELLER, 'select public.cancel_label($1) as s', [o])).s;
ok(s.label === null && s.quotes.length === 3, 'the seller can cancel it and choose again');
s = (await one(U.SELLER, 'select public.create_label($1, $2, $3) as s', [o, 'evri_dropoff', 'small'])).s;
ok(s.label.carrier === 'Evri', 'a new label');

console.log('\n=== Once sent ===');
await db.query(`insert into public.custody_events (order_id, seq, step, actor_role, actor_id, evidence, at, prev_hash, hash) values ($1, 99, 'ship', 'seller', $2, '{}', now(), 'x', 'y')`, [o, U.SELLER]);
s = await ship(o);
ok(!s.can_label && s.label, 'after recording it sent, no new labels; the label stays on the order');
await rejects(as(db, U.SELLER, 'select public.cancel_label($1)', [o]), 'and it can’t be cancelled', /already recorded/);
await rejects(as(db, U.BUYER, 'select public.set_delivery_address($1, $2)', [o, JSON.stringify(addr)]), 'nor the address changed', /on its way/);

console.log('\n=== Courier-witnessed orders don’t use labels ===');
const w = await buy('Camera', 60000);
s = await ship(w);
ok(!s.can_label && s.quotes === null, 'a £600 order is collected by a courier, so no label');
await rejects(as(db, U.SELLER, 'select public.record_live_label($1, $2, $3, $4, $5, $6, $7)', [o, 'evri_dropoff', 'small', 319, 'ABC123456', 'r', 'u']), 'live labels are recorded by the server only', /permission denied/);

console.log(failures ? `\n${failures} FAILED` : '\nall label checks passed');
process.exit(failures ? 1 : 0);
