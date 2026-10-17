// Migration 012 on a real Postgres (PGlite), acting as real users through Row Level Security:
// favourites, order messages, offers, reviews, the Item Passport, inbox counts and the staff console.
// Usage: node marketplace_checks.mjs
import { randomUUID } from 'node:crypto';
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = {
  SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222',
  OTHER: '33333333-3333-3333-3333-333333333333', STAFF: '44444444-4444-4444-4444-444444444444',
  COURIER: '55555555-5555-5555-5555-555555555555',
};
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const shop = async (title, price, seller = U.SELLER) =>
  (await one(seller, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [seller, title, price])).id;
async function pay(orderId) {
  const o = (await db.query('select total_pence from public.orders where id = $1', [orderId])).rows[0];
  return (await svc(`select public.confirm_payment($1, $2, $3) as r`, [orderId, 'pi_' + orderId, o.total_pence])).rows[0].r;
}

console.log('=== Favourites ===');
const coat = await shop('Wool coat', 4000);
await as(db, U.BUYER, 'insert into public.favourites (user_id, listing_id) values ($1, $2)', [U.BUYER, coat]);
ok((await as(db, U.BUYER, 'select listing_id from public.favourites')).rows.length === 1, 'a member saves a listing to their favourites');
ok((await as(db, U.OTHER, 'select listing_id from public.favourites')).rows.length === 0, 'nobody else can see what they saved');
await rejects(as(db, U.BUYER, 'insert into public.favourites (user_id, listing_id) values ($1, $2)', [U.OTHER, coat]), 'nobody can save to someone else’s favourites', /row-level security/);
const draft = (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence) values ($1, 'Draft', 1000) returning id`, [U.SELLER])).id;
await rejects(as(db, U.BUYER, 'insert into public.favourites (user_id, listing_id) values ($1, $2)', [U.BUYER, draft]), 'drafts can’t be saved', /row-level security/);
await as(db, U.BUYER, 'delete from public.favourites where listing_id = $1', [coat]);
ok((await as(db, U.BUYER, 'select listing_id from public.favourites')).rows.length === 0, 'and they can remove it');

console.log('\n=== Offers ===');
const lamp = await shop('Lamp', 6000);
await rejects(as(db, U.SELLER, 'select public.make_offer($1, 5000)', [lamp]), 'sellers can’t make offers on their own items', /own listing/);
await rejects(as(db, U.BUYER, 'select public.make_offer($1, 2000)', [lamp]), 'offers below the minimum share of the price are refused', /start at 40%/);
await rejects(as(db, U.BUYER, 'select public.make_offer($1, 6000)', [lamp]), 'an offer at or above the price is refused', /less than the price/);
const o1 = (await one(U.BUYER, 'select public.make_offer($1, 4200) as o', [lamp])).o;
ok(o1.status === 'pending' && o1.made_by === 'buyer' && o1.amount_pence === 4200, 'a buyer makes an offer of £42 on £60');
await rejects(as(db, U.BUYER, `select public.respond_offer($1, 'accept', null)`, [o1.id]), 'the buyer can’t accept their own offer', /Wait for the other person/);
await rejects(as(db, U.OTHER, `select public.respond_offer($1, 'accept', null)`, [o1.id]), 'strangers can’t touch the offer', /not found/);
await rejects(as(db, U.BUYER, `update public.offers set amount_pence = 1 where id = $1`, [o1.id]), 'nobody can change an offer directly', /permission denied/);
const o2 = (await one(U.SELLER, `select public.respond_offer($1, 'counter', 5000) as o`, [o1.id])).o;
ok(o2.made_by === 'seller' && o2.amount_pence === 5000 && o2.counter_of === o1.id, 'the seller counters at £50');
ok((await db.query('select status from public.offers where id = $1', [o1.id])).rows[0].status === 'countered', 'the first offer is marked countered');
const o3 = (await one(U.BUYER, `select public.respond_offer($1, 'accept', null) as o`, [o2.id])).o;
ok(o3.status === 'accepted', 'the buyer accepts the counter');
await rejects(as(db, U.OTHER, 'select public.start_offer_checkout($1)', [o2.id]), 'only that buyer can check out the offer', /not found/);
const co = (await one(U.BUYER, 'select public.start_offer_checkout($1) as c', [o2.id])).c;
const ord = (await db.query('select price_pence, total_pence, offer_id, payment_status from public.orders where id = $1', [co.order_id])).rows[0];
const expected = (await db.query(`select public.compute_fees((select settings from public.current_fee_settings()), 5000, 399, 'buyer', null, (select version from public.current_fee_settings())) as q`)).rows[0].q;
ok(ord.price_pence === 5000 && ord.offer_id === o2.id && ord.total_pence === expected.buyer_total_pence && ord.payment_status === 'awaiting_payment',
  `checkout is at the agreed £50 with the usual fees (total ${ord.total_pence})`);
ok((await db.query('select status from public.listings where id = $1', [lamp])).rows[0].status === 'reserved', 'and the item is held while the buyer pays');
await rejects(as(db, U.BUYER, `insert into public.orders (listing_id, buyer_id, seller_id, price_pence, offer_id) values ($1, $2, $3, 1, $4)`, [lamp, U.BUYER, U.SELLER, o2.id]),
  'buyers can’t use an offer to insert a cheap order directly', /already been sold|row-level security/);
const other = (await one(U.OTHER, 'select public.make_offer($1, 6000) as o', [await shop('Vase', 10000)])).o;
ok(other.status === 'pending', 'offers on other items are unaffected');
ok((await pay(co.order_id)) === 'paid', 'the payment for the offer price is confirmed');
ok((await db.query('select status from public.offers where id = $1', [o2.id])).rows[0].status === 'used', 'once paid, the offer is used');
await rejects(as(db, U.BUYER, 'select public.start_offer_checkout($1)', [o2.id]), 'and can’t be used again', /ended/);

const rug = (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence) values ($1, 'Rug', 5000, 399) returning id`, [U.SELLER])).id;
await as(db, U.SELLER, 'update public.listings set published = true where id = $1', [rug]);
const r1 = (await one(U.BUYER, 'select public.make_offer($1, 4000) as o', [rug])).o;
await one(U.SELLER, `select public.respond_offer($1, 'accept', null) as o`, [r1.id]);
await as(db, U.SELLER, 'update public.listings set price_pence = 5500 where id = $1', [rug]);
await rejects(as(db, U.BUYER, 'select public.start_offer_checkout($1)', [r1.id]), 'if the seller changes the listing after accepting, the offer can’t be used', /LISTING_CHANGED/);
await db.query(`update public.offers set expires_at = now() - interval '1 minute' where id = $1`, [r1.id]);
ok((await one(U.BUYER, 'select public.my_offers() as o')).o.find((x) => x.id === r1.id).status === 'expired', 'offers past their time show as expired');

console.log('\n=== Messages ===');
const unpaidOrder = (await one(U.BUYER, 'select public.start_checkout($1) as c', [await shop('Unpaid', 2000)])).c.order_id;
await rejects(as(db, U.BUYER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [unpaidOrder, U.BUYER, 'Hi']), 'no messages before an order is paid', /row-level security/);
await as(db, U.BUYER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.BUYER, '  Can you post it on Monday?  ']);
ok((await as(db, U.SELLER, 'select body from public.order_messages where order_id = $1', [co.order_id])).rows[0]?.body === 'Can you post it on Monday?', 'the buyer messages the seller on the order (tidied)');
ok((await as(db, U.OTHER, 'select body from public.order_messages')).rows.length === 0, 'nobody else can read it');
await rejects(as(db, U.OTHER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.OTHER, 'spam']), 'strangers can’t post on the order', /row-level security/);
await rejects(as(db, U.SELLER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.BUYER, 'forged']), 'nobody can post as someone else', /row-level security/);
await rejects(as(db, U.BUYER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.BUYER, '   ']), 'empty messages are refused', /check/);
await rejects(db.query(`update public.order_messages set body = 'edited'`), 'messages can’t be edited, even by the database owner', /can’t be changed/);
await rejects(db.query('delete from public.order_messages'), 'or deleted', /can’t be changed/);
ok((await one(U.SELLER, 'select public.inbox_counts() as c')).c.unread === 1, 'the seller’s inbox counts 1 unread message');
ok((await one(U.SELLER, 'select public.unread_by_order() as u')).u[co.order_id] === 1 && Object.keys((await one(U.BUYER, 'select public.unread_by_order() as u')).u).length === 0, 'and shows it against that order; the sender has none');
await as(db, U.SELLER, 'select public.mark_messages_read($1)', [co.order_id]);
ok((await one(U.SELLER, 'select public.inbox_counts() as c')).c.unread === 0, 'reading it clears the count');

console.log('\n=== Inbox counts ===');
const c1 = (await one(U.SELLER, 'select public.inbox_counts() as c')).c;
ok(c1.turns === 1, `the seller has 1 order waiting for their custody step (turns ${c1.turns})`);
ok((await one(U.BUYER, 'select public.inbox_counts() as c')).c.turns === 0, 'the buyer has none yet');
const vaseOffers = (await one(U.SELLER, 'select public.inbox_counts() as c')).c.offers;
ok(vaseOffers === 1, `the seller has 1 offer to answer (offers ${vaseOffers})`);

console.log('\n=== Reviews and the Item Passport ===');
await rejects(as(db, U.BUYER, 'select public.leave_review($1, 5, $2)', [co.order_id, 'Great']), 'no review before the order is complete', /once the order is complete/);
// Run the order through custody (enhanced tier: photo, tracking, confirm).
const upload = async (uid, order) => { const name = `${order}/${randomUUID()}.jpg`; await as(db, uid, `insert into storage.objects (bucket_id, name, owner) values ('custody-media', $1, $2)`, [name, uid]); return name; };
await as(db, U.SELLER, 'select public.record_custody_step($1, $2, $3::jsonb)', [co.order_id, 'pack_photo', JSON.stringify({ media: await upload(U.SELLER, co.order_id), media_sha256: 'a'.repeat(64) })]);
await as(db, U.SELLER, 'select public.record_custody_step($1, $2, $3::jsonb)', [co.order_id, 'ship', JSON.stringify({ carrier: 'Evri', tracking: 'H01ABC123456' })]);
await as(db, U.BUYER, 'select public.record_custody_step($1, $2, $3::jsonb)', [co.order_id, 'confirm', '{}']);
const rv = (await one(U.BUYER, 'select public.leave_review($1, 5, $2) as r', [co.order_id, 'Quick and well packed'])).r;
ok(rv.rating === 5, 'after confirming, the buyer reviews the seller');
await one(U.SELLER, 'select public.leave_review($1, 4, null) as r', [co.order_id]);
await rejects(as(db, U.BUYER, 'select public.leave_review($1, 1, null)', [co.order_id]), 'one review each per order', /already reviewed/);
await rejects(as(db, U.OTHER, 'select public.leave_review($1, 1, null)', [co.order_id]), 'strangers can’t review', /not found/);
await rejects(as(db, U.BUYER, `insert into public.reviews (order_id, author_id, subject_id, author_role, rating) values ($1, $2, $3, 'buyer', 1)`, [co.order_id, U.BUYER, U.SELLER]), 'reviews can’t be written directly', /permission denied/);
const sellerName = (await db.query('select username from public.profiles where id = $1', [U.SELLER])).rows[0].username;
const mr = (await one(null, 'select public.member_reviews($1) as r', [sellerName])).r;
ok(mr.count === 1 && Number(mr.average) === 5 && mr.latest[0].body === 'Quick and well packed', 'anyone can see the seller’s rating and reviews');

const pp = (await one(null, 'select public.item_passport($1) as p', [lamp])).p;
const sale = pp.sales[0];
ok(pp.title === 'Lamp' && pp.sales.length === 1 && sale.state === 'confirmed' && sale.chain_ok && sale.steps.length === 3, 'anyone can see the item’s passport: one sale, complete, record verified, three steps');
const flat = JSON.stringify(pp);
ok(!flat.includes('H01ABC123456') && !flat.includes('Evri') && !flat.includes(U.BUYER) && !flat.includes(U.SELLER) && !flat.includes(sellerName) && !flat.includes('custody-media') && !flat.includes('aaaa'),
  'the passport shows no names, tracking, file paths or fingerprints');
ok(sale.steps.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date)) && sale.steps[0].photo === true, 'each step shows only its date, its role and whether a photo was taken');
ok((await one(null, 'select public.item_passport($1) as p', [draft])).p === null, 'drafts have no passport');

console.log('\n=== Staff console ===');
await rejects(as(db, U.BUYER, 'select public.staff_queue()'), 'members can’t open the staff queue', /Staff only/);
await rejects(as(db, U.BUYER, 'insert into public.staff_members (user_id) values ($1)', [U.BUYER]), 'members can’t make themselves staff', /permission denied/);
await rejects(as(db, U.BUYER, `select public.staff_set_agent('buyer@example.com', 'courier', 'Me', true)`), 'members can’t make themselves couriers', /Staff only/);
// A disputed order and a payment held for review.
const bag = await shop('Bag', 15000);
const cb = (await one(U.BUYER, 'select public.start_checkout($1) as c', [bag])).c;
await pay(cb.order_id);
await as(db, U.BUYER, `select public.open_dispute($1, 'not_arrived', 'Nothing yet')`, [cb.order_id]);
const held = (await one(U.OTHER, 'select public.start_checkout($1) as c', [await shop('Clock', 3000)])).c;
await svc(`select public.confirm_payment($1, 'pi_short', 1)`, [held.order_id]);
const q = (await one(U.STAFF, 'select public.staff_queue() as q')).q;
ok(q.some((x) => x.order_id === cb.order_id && x.kind === 'dispute') && q.some((x) => x.order_id === held.order_id && x.kind === 'payment'), 'staff see the dispute and the payment held for checking');
const so = (await one(U.STAFF, 'select public.staff_order($1) as o', [co.order_id])).o;
ok(so.events.some((e) => e.evidence.tracking === 'H01ABC123456') && so.messages.length === 1, 'staff see the full record, including tracking and messages');
await rejects(as(db, U.STAFF, `select public.staff_resolve_dispute($1, 'release', '')`, [cb.order_id]), 'a decision needs a note', /short note/);
const res = (await one(U.STAFF, `select public.staff_resolve_dispute($1, 'refund', 'Parcel lost by carrier') as o`, [cb.order_id])).o;
ok(res.dispute_resolution === 'refund' && res.payout_status === 'refund' && res.events.at(-1).step === 'staff_resolution' && res.actions.length === 1,
  'staff refund the dispute: recorded in the custody chain and the staff log');
const v = (await one(U.BUYER, 'select public.order_custody($1) as v', [cb.order_id])).v;
ok(v.chain_ok && v.events.at(-1).actor_role === 'staff', 'the buyer sees the staff decision in a chain that still verifies');
await rejects(as(db, U.STAFF, `select public.staff_resolve_dispute($1, 'release', 'again')`, [cb.order_id]), 'a decided dispute can’t be decided twice', /isn’t waiting/);
const pr = (await one(U.STAFF, `select public.staff_resolve_payment($1, 'refund', 'Amount did not match') as o`, [held.order_id])).o;
ok(pr.payment_status === 'cancelled', 'staff mark a mismatched payment for refund');
await rejects(as(db, U.STAFF, `select public.staff_set_agent('nobody@example.com', 'courier', 'X', true)`), 'adding an agent needs an existing account', /No account/);
const agents = (await one(U.STAFF, `select public.staff_set_agent('courier@example.com', 'courier', 'Test Couriers', true) as a`)).a;
ok(agents.some((a) => a.email === 'courier@example.com' && a.role === 'courier'), 'staff add a courier by email');
await rejects(as(db, U.STAFF, `select public.staff_set_agent('staff@example.com', 'hub', 'Me', true)`), 'staff can’t make themselves agents', /themselves/);
const s1 = (await one(U.STAFF, `select public.staff_update_settings('{"confirm_window_hours": 72}'::jsonb, '{"min_pct": 50}'::jsonb) as s`)).s;
ok(s1.custody.confirm_window_hours === 72 && s1.offers.min_pct === 50, 'staff change the protection window and the offer minimum');
await rejects(as(db, U.STAFF, `select public.staff_update_settings('{"confirm_window_hours": 0}'::jsonb, null)`), 'settings outside their limits are refused', /check/);
const cur = (await db.query('select settings from public.current_fee_settings()')).rows[0].settings;
await rejects(as(db, U.STAFF, `select public.staff_add_fee_version('{"tiers": []}'::jsonb, 'broken', null)`), 'a fee version missing tiers is refused', /four tiers/);
const s2 = (await one(U.STAFF, `select public.staff_add_fee_version($1::jsonb, 'Processing to 90p', null) as s`, [JSON.stringify({ ...cur, processing_pence: 90 })])).s;
ok(s2.current_fee_version === 3 && s2.fees[0].note === 'Processing to 90p', 'staff add fee version 3, which applies at once');
ok((await one(null, 'select public.order_quote($1) as q', [await shop('Mug', 1000)])).q.processing_pence === 90, 'new quotes use it');
await rejects(db.query(`update public.staff_actions set action = 'x'`), 'the staff log can’t be edited', /never be changed/);

console.log(failures ? `\n${failures} MARKETPLACE CHECK(S) FAILED` : '\nALL MARKETPLACE CHECKS PASSED');
process.exit(failures ? 1 : 0);
