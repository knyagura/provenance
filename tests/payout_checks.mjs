// Migration 028: seller payouts (Stripe Connect). Real Postgres (PGlite), through Row Level Security.
// Usage: node payout_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = { SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222', STAFF: '44444444-4444-4444-4444-444444444444' };
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
let n = 0;
const sold = async (price) => {
  const l = (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [U.SELLER, `Item ${++n}`, price])).id;
  const c = (await one(U.BUYER, 'select public.start_checkout($1, null) as c', [l])).c;
  await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_' + n, c.total_pence ?? c.quote.buyer_total_pence]);
  return c.order_id;
};
const release = (o) => db.query(`update public.orders set custody_state = 'confirmed', confirmed_at = now(), payout_status = 'due' where id = $1`, [o]);
const payout = async (o) => (await db.query('select * from public.payouts where order_id = $1', [o])).rows[0];

console.log('=== Released before the seller has set up payouts ===');
const o1 = await sold(3000);
ok(!(await payout(o1)), 'nothing is queued while the payment is held');
await release(o1);
let p = await payout(o1);
ok(p.status === 'waiting' && p.amount_pence === 3000, 'released: £30 waits for the seller to set up payouts');
const asked = (await db.query(`select count(*)::int n from public.notifications where user_id = $1 and dedupe_key = $2`, [U.SELLER, 'payout-setup:' + U.SELLER])).rows[0].n;
ok(asked === 1, 'the seller is told to set up payouts');
const mine = (await one(U.SELLER, 'select public.my_payouts() as m')).m;
ok(mine.account === null && mine.waiting_pence === 3000 && mine.recent[0].title === 'Item 1', 'they see £30 waiting and no account yet');
ok((await one(U.BUYER, 'select public.my_payouts() as m')).m.recent.length === 0, 'buyers see nobody else’s payouts');
await rejects(as(db, U.SELLER, 'select * from public.payouts'), 'the table isn’t readable directly', /permission denied/);
await rejects(as(db, U.SELLER, `select public.set_payout_account($1, 'acct_123456789')`, [U.SELLER]), 'members can’t attach an account themselves', /permission denied/);
await rejects(as(db, U.SELLER, 'select * from public.payouts_claim(10)'), 'nor run the sender', /permission denied/);

console.log('\n=== Connecting a Stripe account ===');
await svc(`select public.set_payout_account($1, 'acct_1ABCdef234')`, [U.SELLER]);
await svc(`select public.set_payout_account($1, 'acct_9ZZZzzz999')`, [U.SELLER]);
ok((await svc('select public.payout_account_for($1) as a', [U.SELLER])).rows[0].a === 'acct_1ABCdef234', 'a member’s account is never swapped silently');
await svc(`select public.payout_account_updated('acct_1ABCdef234', true, false)`);
ok((await payout(o1)).status === 'waiting', 'details sent but Stripe not ready yet: still waiting');
await svc(`select public.payout_account_updated('acct_1ABCdef234', true, true)`);
ok((await payout(o1)).status === 'queued', 'Stripe enables payouts: the waiting payout is queued');
ok((await one(U.SELLER, 'select public.my_payouts() as m')).m.account.payouts_enabled === true, 'and the seller sees they’re set up');

console.log('\n=== Sending ===');
const o2 = await sold(2000);
await release(o2);
ok((await payout(o2)).status === 'queued', 'with an account, a released payment queues straight away');
let claimed = (await svc('select * from public.payouts_claim(10)')).rows;
ok(claimed.length === 2 && claimed.every((c) => c.stripe_account_id === 'acct_1ABCdef234' && /^pi_/.test(c.payment_ref)), 'the sender gets both, with the account and the payment to send from');
ok((await svc('select * from public.payouts_claim(10)')).rows.length === 0, 'a second run doesn’t take them again');
await svc('select public.payout_done($1, true, $2, null)', [claimed[0].id, 'tr_123']);
const firstOrder = claimed[0].order_id;
ok((await payout(firstOrder)).status === 'sent', 'sent');
ok((await db.query('select payout_status from public.orders where id = $1', [firstOrder])).rows[0].payout_status === 'paid', 'and the order shows it paid');
await svc('select public.payout_done($1, false, null, $2)', [claimed[1].id, 'insufficient funds']);
p = (await db.query('select * from public.payouts where id = $1', [claimed[1].id])).rows[0];
ok(p.status === 'queued' && p.last_error === 'insufficient funds', 'a failure goes back in the queue to try again');
for (let i = 0; i < 5; i++) {
  const c = (await svc('select * from public.payouts_claim(10)')).rows;
  if (c.length) await svc('select public.payout_done($1, false, null, $2)', [c[0].id, 'still failing']);
}
ok((await db.query('select status from public.payouts where id = $1', [claimed[1].id])).rows[0].status === 'failed', 'after 5 tries it stops and waits for staff');

console.log('\n=== Staff ===');
await rejects(as(db, U.SELLER, 'select public.staff_payouts(null)'), 'only staff see all payouts', /Staff only/);
const st = (await one(U.STAFF, 'select public.staff_payouts(null) as s')).s;
ok(st.counts.sent === 1 && st.counts.failed === 1 && st.items.length === 2, 'staff see counts and each payout');
await rejects(as(db, U.STAFF, `select public.staff_payout_action($1, 'retry', '')`, [claimed[1].id]), 'a decision needs a note', /note/);
await one(U.STAFF, `select public.staff_payout_action($1, 'retry', 'Balance topped up') as s`, [claimed[1].id]);
ok((await db.query('select status, attempts from public.payouts where id = $1', [claimed[1].id])).rows[0].attempts === 0, 'staff retry a failed payout');
await one(U.STAFF, `select public.staff_payout_action($1, 'hold', 'Checking a complaint') as s`, [claimed[1].id]);
ok((await db.query('select status from public.payouts where id = $1', [claimed[1].id])).rows[0].status === 'held', 'or hold one');
ok((await svc('select * from public.payouts_claim(10)')).rows.length === 0, 'held payouts aren’t sent');
await rejects(as(db, U.STAFF, `select public.staff_payout_action($1, 'hold', 'again')`, [firstOrder]), 'a sent payout can’t be held', /not found|can’t be done/);
ok((await db.query(`select count(*)::int n from public.staff_actions where action like 'payout_%'`)).rows[0].n === 2, 'staff decisions are recorded');

console.log('\n=== Refunds ===');
const o3 = await sold(1500);
await release(o3);
await db.query(`update public.orders set payout_status = 'refund' where id = $1`, [o3]);
ok((await payout(o3)).status === 'held', 'a refund after release stops the payout');
console.log(failures ? `\n${failures} FAILED` : '\nall payout checks passed');
process.exit(failures ? 1 : 0);
