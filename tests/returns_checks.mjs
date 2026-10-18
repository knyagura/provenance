// Migrations 030 and 031: saved addresses, returns, and card refunds. Real Postgres (PGlite), through Row Level Security.
// Usage: node returns_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = { SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222', OTHER: '33333333-3333-3333-3333-333333333333', STAFF: '44444444-4444-4444-4444-444444444444' };
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const home = { name: 'Bea Buyer', line1: '1 Test Street', town: 'London', postcode: 'sw112ab' };
let n = 0;
const sold = async (price = 3000) => {
  const l = (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [U.SELLER, `Item ${++n}`, price])).id;
  const c = (await one(U.BUYER, 'select public.start_checkout($1, null) as c', [l])).c;
  await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_' + n, c.total_pence ?? c.quote.buyer_total_pence]);
  return c.order_id;
};
// The item has arrived: skip to the buyer's "confirm" step (the steps before are tested in custody_attacks.mjs).
const arrived = (o) => db.query(`update public.orders set custody_step = 2 where id = $1`, [o]);
const ret = (o, uid = U.BUYER) => one(uid, 'select public.order_return($1) as r', [o]).then((r) => r.r);

console.log('=== Saved addresses ===');
await rejects(as(db, U.BUYER, `select public.save_address(null, 'Home', $1, false)`, [JSON.stringify({ ...home, postcode: 'nope' })]), 'a UK postcode', /UK postcode/);
let a = (await one(U.BUYER, `select public.save_address(null, 'Home', $1, false) as a`, [JSON.stringify(home)])).a;
ok(a.length === 1 && a[0].is_default && a[0].address.postcode === 'SW11 2AB', 'the first address becomes the default, tidied');
a = (await one(U.BUYER, `select public.save_address(null, 'Work', $1, true) as a`, [JSON.stringify({ ...home, line1: '2 Office Road' })])).a;
ok(a.filter((x) => x.is_default).length === 1 && a[0].label === 'Work', 'making another the default moves it');
ok((await one(U.OTHER, 'select public.my_addresses() as a')).a.length === 0, 'nobody else sees them');
await rejects(as(db, U.OTHER, 'select * from public.addresses'), 'the table isn’t readable directly', /permission denied/);
a = (await one(U.BUYER, 'select public.delete_address($1) as a', [a[0].id])).a;
ok(a.length === 1 && a[0].is_default && a[0].label === 'Home', 'deleting the default makes the other one the default');
for (let i = 0; i < 4; i++) await one(U.BUYER, `select public.save_address(null, null, $1, false) as a`, [JSON.stringify(home)]);
await rejects(as(db, U.BUYER, `select public.save_address(null, null, $1, false)`, [JSON.stringify(home)]), 'up to 5', /up to 5/);
const o1 = await sold();
const deliver = (await db.query('select deliver_to from public.orders where id = $1', [o1])).rows[0].deliver_to;
ok(deliver?.line1 === '1 Test Street', 'paying uses the default address');
const asked = (await db.query(`select count(*)::int n from public.notifications where user_id = $1 and dedupe_key = $2`, [U.BUYER, 'address:' + o1])).rows[0].n;
ok(asked === 0, 'so the buyer isn’t asked for one');

console.log('\n=== Returns ===');
await one(U.SELLER, `select public.save_address(null, 'Returns', $1, true) as a`, [JSON.stringify({ name: 'Sam Seller', line1: '9 Shop Lane', town: 'Bristol', postcode: 'BS6 5AA' })]);
ok((await ret(o1)).can_request === false, 'not before it has arrived');
await rejects(as(db, U.BUYER, `select public.request_return($1, 'damaged', null)`, [o1]), 'so asking is refused', /once it has arrived/);
await arrived(o1);
ok((await ret(o1)).can_request === true && (await ret(o1, U.SELLER)).can_request === false, 'once it has arrived, the buyer (only) can ask');
await rejects(as(db, U.BUYER, `select public.request_return($1, 'changed_mind', null)`, [o1]), 'returns are for problems with the item', /Choose why/);
let r = (await one(U.BUYER, `select public.request_return($1, 'not_as_described', 'Stain not shown in photos') as r`, [o1])).r;
ok(r.return.status === 'requested', 'requested');
let o = (await db.query('select custody_state, dispute_reason, payout_status from public.orders where id = $1', [o1])).rows[0];
ok(o.custody_state === 'disputed' && o.dispute_reason === 'return' && o.payout_status === 'held', 'the payment stays held');
const events = (await db.query('select step from public.custody_events where order_id = $1 order by seq', [o1])).rows.map((e) => e.step);
ok(events.at(-1) === 'return_requested', 'and it goes on the custody record');
await rejects(as(db, U.BUYER, `select public.respond_return($1, true, null)`, [o1]), 'only the seller answers', /not found/i);
await rejects(as(db, U.SELLER, `select public.respond_return($1, false, '')`, [o1]), 'declining needs a reason', /why/);
r = (await one(U.SELLER, `select public.respond_return($1, true, null) as r`, [o1])).r;
ok(r.return.status === 'accepted' && r.label?.mode === 'test' && /^P2GTEST/.test(r.label.tracking), 'accepted: a (test) return label is made');
ok(r.label.deliver_to === null, 'the seller’s view doesn’t repeat their address');
ok((await ret(o1)).label.deliver_to.postcode === 'BS6 5AA', 'the buyer’s label goes to the seller’s address');
await rejects(as(db, U.SELLER, `select public.return_received($1)`, [await sold()]), 'only for an order with a return', /no return/);
await one(U.BUYER, 'select public.return_posted($1) as r', [o1]);
ok((await ret(o1)).return.status === 'posted', 'the buyer posts it back');
r = (await one(U.SELLER, 'select public.return_received($1) as r', [o1])).r;
o = (await db.query('select payout_status, dispute_resolution from public.orders where id = $1', [o1])).rows[0];
ok(r.return.status === 'received' && o.payout_status === 'refund' && o.dispute_resolution === 'refund', 'the seller confirms it arrived: refunded');

console.log('\n=== Card refunds ===');
let ref = (await db.query('select * from public.refunds where order_id = $1', [o1])).rows[0];
ok(ref.status === 'queued' && ref.amount_pence > 3000 && ref.payment_ref.startsWith('pi_'), `a card refund of what they paid is queued (£${(ref?.amount_pence / 100).toFixed(2)})`);
ok((await db.query(`select count(*)::int n from public.notifications where user_id = $1 and dedupe_key = $2`, [U.BUYER, 'refund:' + o1])).rows[0].n === 1, 'and the buyer is told');
await rejects(as(db, U.BUYER, 'select * from public.refunds_claim(5)'), 'only the server sends refunds', /permission denied/);
const claim = (await svc('select * from public.refunds_claim(5)')).rows;
ok(claim.length === 1 && claim[0].payment_ref === ref.payment_ref, 'the worker takes it');
await svc('select public.refund_done($1, true, $2, null)', [claim[0].id, 're_123']);
ref = (await db.query('select * from public.refunds where order_id = $1', [o1])).rows[0];
ok(ref.status === 'sent' && ref.refund_ref === 're_123', 'sent');
ok((await one(U.STAFF, 'select public.staff_refunds() as r')).r.length === 1, 'staff can see refunds');

console.log('\n=== Declined, cancelled, and unanswered returns ===');
const o2 = await sold();
await arrived(o2);
await one(U.BUYER, `select public.request_return($1, 'damaged', null) as r`, [o2]);
await one(U.SELLER, `select public.respond_return($1, false, 'It left here in perfect condition') as r`, [o2]);
o = (await db.query('select custody_state, dispute_resolution from public.orders where id = $1', [o2])).rows[0];
ok(o.custody_state === 'disputed' && o.dispute_resolution === null, 'declined: on hold for staff to decide');
const o3 = await sold();
await arrived(o3);
await one(U.BUYER, `select public.request_return($1, 'wrong_item', null) as r`, [o3]);
await one(U.BUYER, 'select public.cancel_return($1) as r', [o3]);
o = (await db.query('select custody_state from public.orders where id = $1', [o3])).rows[0];
ok(o.custody_state === 'in_progress' && (await ret(o3)).return.status === 'cancelled', 'the buyer can cancel: the order carries on');
ok((await ret(o3)).can_request === false, 'one return request per order');
const o4 = await sold();
await arrived(o4);
await one(U.BUYER, `select public.request_return($1, 'damaged', null) as r`, [o4]);
await db.query(`update public.returns set requested_at = now() - interval '49 hours' where order_id = $1`, [o4]);
ok((await db.query('select public.auto_accept_returns() as n')).rows[0].n === 1, 'unanswered after 48 hours: accepted automatically');
ok((await ret(o4)).return.auto_accepted === true && (await ret(o4)).label, 'with a return label');
console.log(failures ? `\n${failures} FAILED` : '\nall returns checks passed');
process.exit(failures ? 1 : 0);
