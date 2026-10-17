// Migration 016: notifications. Real Postgres (PGlite), acting as real users through Row Level Security.
// Usage: node notification_checks.mjs
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
};
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const shop = async (title, price) =>
  (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [U.SELLER, title, price])).id;
const pay = async (orderId) => {
  const o = (await db.query('select total_pence from public.orders where id = $1', [orderId])).rows[0];
  await svc('select public.confirm_payment($1, $2, $3)', [orderId, 'pi_' + orderId, o.total_pence]);
};
const list = async (uid) => (await one(uid, 'select public.my_notifications() as n')).n;
const kinds = async (uid) => (await list(uid)).map((n) => n.kind);
const upload = async (uid, order) => { const name = `${order}/${randomUUID()}.jpg`; await as(db, uid, `insert into storage.objects (bucket_id, name, owner) values ('custody-media', $1, $2)`, [name, uid]); return name; };
// Let waiting emails become due.
const due = () => db.query(`update public.notifications set email_after = now() - interval '1 second' where email_state = 'pending'`);

console.log('=== Offers ===');
const lamp = await shop('Lamp', 6000);
const o1 = (await one(U.BUYER, 'select public.make_offer($1, 4200) as o', [lamp])).o;
let s = await list(U.SELLER);
ok(s.length === 1 && s[0].kind === 'offer_new' && s[0].title === 'New offer: £42 for Lamp' && !s[0].read, 'the seller is told about a new offer');
ok((await list(U.BUYER)).length === 0, 'the buyer who made it isn’t');
const o2 = (await one(U.SELLER, `select public.respond_offer($1, 'counter', 5000) as o`, [o1.id])).o;
const b = await list(U.BUYER);
ok(b[0].kind === 'offer_counter' && b[0].title.includes('£50') && b[0].link === `/item/${lamp}`, 'the buyer is told about the counter-offer, linking to the item');
await one(U.BUYER, `select public.respond_offer($1, 'accept', null) as o`, [o2.id]);
ok((await kinds(U.SELLER)).includes('offer_accepted'), 'the seller is told their counter was accepted');
await db.query(`update public.offers set expires_at = now() + interval '2 hours' where id = $1`, [o2.id]);
await db.query('select public.notify_expiring_offers()');
await db.query('select public.notify_expiring_offers()');
ok((await kinds(U.BUYER)).filter((k) => k === 'offer_expiring').length === 1, 'the buyer is reminded to pay before the accepted offer runs out — once, however often the job runs');
await rejects(as(db, U.BUYER, 'select public.notify_expiring_offers()'), 'members can’t run the reminder job', /permission denied/);

console.log('\n=== Sold, your turn, payment released ===');
const coat = await shop('Coat', 4000);
const co = (await one(U.BUYER, 'select public.start_checkout($1) as c', [coat])).c;
await pay(co.order_id);
s = await list(U.SELLER);
ok(s[0].kind === 'sold' && s[0].title === 'Sold: Coat' && s[0].link === `/orders/${co.order_id}`, 'the seller is told the item sold');
ok(!s.some((n) => n.kind === 'turn'), 'without a separate “your turn” for the same moment');
await as(db, U.SELLER, 'select public.record_custody_step($1, $2, $3::jsonb)', [co.order_id, 'pack_photo', JSON.stringify({ media: await upload(U.SELLER, co.order_id), media_sha256: 'a'.repeat(64) })]);
ok(!(await kinds(U.SELLER)).includes('turn'), 'the seller’s next step is still theirs: no new notification');
await as(db, U.SELLER, 'select public.record_custody_step($1, $2, $3::jsonb)', [co.order_id, 'ship', JSON.stringify({ carrier: 'Evri', tracking: 'H01ABC123456' })]);
const bt = (await list(U.BUYER)).find((n) => n.kind === 'turn');
ok(bt && bt.title === 'Your turn: Coat' && bt.body.startsWith('Check the item'), 'the buyer is told it’s their turn to check and confirm');
await as(db, U.BUYER, 'select public.record_custody_step($1, $2, $3::jsonb)', [co.order_id, 'confirm', '{}']);
ok((await kinds(U.SELLER)).includes('payout'), 'the seller is told the payment was released');
ok(!(await kinds(U.OTHER)).length, 'nobody else hears anything');
await rejects(as(db, U.OTHER, 'select * from public.notifications where user_id = $1', [U.SELLER]).then((r) => { if (r.rows.length) throw new Error('saw them'); throw new Error('row-level security: none'); }),
  'members only ever see their own notifications', /row-level security/);
await rejects(as(db, U.SELLER, `insert into public.notifications (user_id, kind, grp, title) values ($1, 'sold', 'sales', 'x')`, [U.SELLER]), 'nobody writes notifications directly', /permission denied/);
await rejects(as(db, U.SELLER, `select public.notify($1, 'sold', 'x', 'y', '/')`, [U.BUYER]), 'or sends one to someone else', /permission denied/);

console.log('\n=== Messages: grouped, read with the order, emailed at most every 15 minutes ===');
await as(db, U.BUYER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.BUYER, 'Thanks, it fits!']);
await as(db, U.BUYER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.BUYER, 'Lovely coat']);
let m = (await list(U.SELLER)).filter((n) => n.kind === 'message');
ok(m.length === 1 && m[0].count === 2 && m[0].title === '2 new messages about Coat' && m[0].body.endsWith('Lovely coat'), 'two messages make one notification showing the latest');
ok((await one(U.SELLER, 'select public.unread_notifications() as c')).c >= 1, 'it counts as unread');
let pending = (await db.query(`select email_state, email_after > now() as later from public.notifications where kind = 'message'`)).rows[0];
ok(pending.email_state === 'pending' && pending.later, 'its email waits a couple of minutes in case they’re already reading');
await as(db, U.SELLER, 'select public.mark_messages_read($1)', [co.order_id]);
ok((await list(U.SELLER)).find((n) => n.kind === 'message').read, 'reading the order’s messages reads the notification');
await due();
const firstBatch = (await svc('select * from public.notification_outbox_claim(50)')).rows;
ok(firstBatch.length >= 6 && !firstBatch.some((r) => r.kind === 'message'), `the outbox hands over the waiting emails (${firstBatch.length}) but not the read one`);
for (const r of firstBatch) await svc('select public.notification_outbox_done($1, true, null)', [r.id]);
ok((await db.query(`select email_state from public.notifications where kind = 'message'`)).rows[0].email_state === 'skipped', 'so its email is never sent');

await as(db, U.SELLER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.SELLER, 'Glad it fits']);
await due();
const claimed = (await svc('select * from public.notification_outbox_claim(50)')).rows;
const msg = claimed.find((r) => r.kind === 'message');
ok(msg && msg.email === 'buyer@example.com' && msg.title === 'New message about Coat', 'the outbox hands the buyer’s message email over with their address');
ok((await svc('select * from public.notification_outbox_claim(50)')).rows.length === 0, 'an email being sent isn’t handed over twice');
for (const r of claimed) await svc('select public.notification_outbox_done($1, true, null)', [r.id]);
ok((await db.query(`select count(*)::int as c from public.notifications where email_state = 'sent'`)).rows[0].c === firstBatch.length + claimed.length, 'sent emails are marked sent');
await as(db, U.SELLER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [co.order_id, U.SELLER, 'Enjoy it']);
const again = (await db.query(`select count, email_state, email_after > now() + interval '10 minutes' as waits from public.notifications where kind = 'message' and user_id = $1 and read_at is null`, [U.BUYER])).rows[0];
ok(again.count === 2 && again.email_state === 'pending' && again.waits, 'another message soon after joins it, and its email waits for the 15 minutes to pass');
ok((await svc('select * from public.notification_outbox_claim(50)')).rows.length === 0, 'so nothing is sent yet');
await rejects(as(db, U.BUYER, 'select * from public.notification_outbox_claim(5)'), 'members can’t read the outbox (other people’s emails)', /permission denied/);

console.log('\n=== Problem reported and staff decision ===');
const bag = await shop('Bag', 15000);
const cb = (await one(U.BUYER, 'select public.start_checkout($1) as c', [bag])).c;
await pay(cb.order_id);
await as(db, U.BUYER, `select public.open_dispute($1, 'not_arrived', 'Nothing yet')`, [cb.order_id]);
ok((await kinds(U.SELLER)).includes('dispute'), 'the seller is told a problem was reported');
await as(db, U.STAFF, `select public.staff_resolve_dispute($1, 'refund', 'Tracking never moved')`, [cb.order_id]);
const sd = (await list(U.SELLER)).find((n) => n.kind === 'decision');
const bd = (await list(U.BUYER)).find((n) => n.kind === 'decision');
ok(sd?.body === 'Our team has refunded the buyer.' && bd?.body === 'Our team has refunded you.', 'both are told the staff decision');
ok(!(await list(U.SELLER)).some((n) => n.kind === 'payout' && n.title.includes('Bag')), 'a refund isn’t reported as a payment released');

console.log('\n=== Reading and email settings ===');
const before = (await one(U.SELLER, 'select public.unread_notifications() as c')).c;
const first = (await list(U.SELLER)).find((n) => !n.read);
await as(db, U.SELLER, 'select public.mark_notifications_read($1::uuid[])', [[first.id]]);
ok((await one(U.SELLER, 'select public.unread_notifications() as c')).c === before - 1, 'one can be marked read');
await as(db, U.OTHER, 'select public.mark_notifications_read(null)');
ok((await one(U.SELLER, 'select public.unread_notifications() as c')).c === before - 1, 'someone else marking “all read” doesn’t touch them');
await as(db, U.SELLER, 'select public.mark_notifications_read(null)');
ok((await one(U.SELLER, 'select public.unread_notifications() as c')).c === 0, 'and all can be marked read');
ok(JSON.stringify((await one(U.BUYER, 'select public.my_notification_prefs() as p')).p) === JSON.stringify({ turn: true, sales: true, offers: true, messages: true }), 'every email is on to begin with');
const p = (await one(U.BUYER, 'select public.set_notification_prefs(true, false, true, true) as p')).p;
ok(p.messages === false && p.turn === true, 'a member switches off message emails');
ok((await db.query(`select email_state from public.notifications where kind = 'message' and user_id = $1 and read_at is null`, [U.BUYER])).rows[0].email_state === 'off', 'which stops the one already waiting');
await as(db, U.SELLER, 'insert into public.order_messages (order_id, sender_id, body) values ($1, $2, $3)', [cb.order_id, U.SELLER, 'Sorry about that']);
ok((await db.query(`select email_state from public.notifications where kind = 'message' and order_id = $1 and user_id = $2`, [cb.order_id, U.BUYER])).rows[0].email_state === 'off', 'new messages still show in the app, without an email');
await rejects(as(db, null, 'select public.set_notification_prefs(true, true, true, true)'), 'signed-out visitors have no settings', /permission denied|Sign in/);

console.log(failures ? `\n${failures} FAILED` : '\nall notification checks passed');
process.exit(failures ? 1 : 0);
