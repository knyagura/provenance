// Migration 026: trust badges (seller figures) and the public handover tracker. Real Postgres (PGlite).
// Usage: node trust_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };

const db = await freshDb();
const U = { SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222', NEW: '33333333-3333-3333-3333-333333333333' };
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const name = async (id) => (await db.query('select username from public.profiles where id = $1', [id])).rows[0].username;
let n = 0;
// A paid order, then (as the server would) finished: confirmed after `hours`, or disputed.
const sale = async (end, hours = 48) => {
  const l = (await as(db, U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, 2000, 399, true) returning id`, [U.SELLER, `Item ${++n}`])).rows[0].id;
  const c = (await as(db, U.BUYER, 'select public.start_checkout($1, null) as c', [l])).rows[0].c;
  await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_' + n, c.total_pence ?? c.quote.buyer_total_pence]);
  if (end === 'confirmed') await db.query(`update public.orders set custody_state = 'confirmed', paid_at = now() - make_interval(hours => $2), confirmed_at = now() where id = $1`, [c.order_id, hours]);
  if (end === 'disputed') await db.query(`update public.orders set custody_state = 'disputed', disputed_at = now() where id = $1`, [c.order_id]);
  if (end === 'refunded') await db.query(`update public.orders set custody_state = 'confirmed', disputed_at = now(), dispute_resolution = 'refund', confirmed_at = now() where id = $1`, [c.order_id]);
  return c.order_id;
};
const trust = async (id, uid = null) => (await as(db, uid, 'select public.seller_trust($1) as t', [await name(id)])).rows[0].t;

console.log('=== A new seller ===');
let t = await trust(U.NEW);
ok(t.completed === 0 && t.dispute_rate === null && t.trusted === false, 'nothing finished: no rate shown, not trusted');
ok((await as(db, null, 'select public.seller_trust($1) as t', ['nobody-here'])).rows[0].t === null, 'an unknown name gives nothing');

console.log('\n=== Building a record ===');
for (let i = 0; i < 4; i++) await sale('confirmed', 24 + i * 24);
await sale('in_progress');
t = await trust(U.SELLER);
ok(t.completed === 4 && t.finished === 4 && t.dispute_rate === null, '4 completed: still too few for a rate (in-progress orders don’t count)');
ok(t.avg_handover_hours === 60, `the average handover time is shown from 3 completed (${t.avg_handover_hours} hours)`);
await sale('confirmed', 48);
t = await trust(U.SELLER);
ok(t.completed === 5 && t.dispute_rate === 0, '5 completed, none disputed: 0%');
ok(t.trusted === false, 'not “trusted” without identity checked');
await db.query('update public.profiles set kyc_verified = true where id = $1', [U.SELLER]);
t = await trust(U.SELLER, U.BUYER);
ok(t.verified && t.trusted, 'identity checked + 5 completed + no disputes: trusted (anyone can see it)');
await sale('disputed');
t = await trust(U.SELLER);
ok(t.disputes === 1 && t.finished === 6 && t.dispute_rate === 16.7 && !t.trusted, 'one dispute in 6 finished: 16.7%, and the trusted badge goes');
ok(!('buyers' in t) && !JSON.stringify(t).includes('@'), 'only totals, no personal details');

console.log('\n=== The public tracker ===');
await sale('refunded');
const s = (await as(db, null, 'select public.trust_stats() as s')).rows[0].s;
ok(s.completed === 5 && s.completed_30d === 5, `completed protected handovers are counted, not refunded ones (${s.completed})`);
ok(s.finished === 7 && s.disputes === 2 && s.refunds === 1, 'disputes and refunds are counted');
ok(s.by_tier.enhanced === 5, 'by protection level');
ok(s.recent.length === 5 && s.recent.every((r) => r.title && r.tier && /^\d{4}-\d{2}-\d{2}$/.test(r.confirmed_on) && !('buyer' in r) && !('seller' in r)), 'recent completions list the item, level and day, never people');
console.log(failures ? `\n${failures} FAILED` : '\nall trust checks passed');
process.exit(failures ? 1 : 0);
