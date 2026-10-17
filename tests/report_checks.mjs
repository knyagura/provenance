// Migration 027: staff reports. Real Postgres (PGlite).
// Usage: node report_checks.mjs
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
let n = 0;
const sale = async (price, end) => {
  const l = (await as(db, U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published, category) values ($1, $2, $3, 399, true, 'men') returning id`, [U.SELLER, `Item ${++n}`, price])).rows[0].id;
  const c = (await as(db, U.BUYER, 'select public.start_checkout($1, null) as c', [l])).rows[0].c;
  await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_' + n, c.total_pence ?? c.quote.buyer_total_pence]);
  if (end === 'confirmed') await db.query(`update public.orders set custody_state = 'confirmed', paid_at = now() - interval '48 hours', confirmed_at = now() where id = $1`, [c.order_id]);
  if (end === 'disputed') await db.query(`update public.orders set custody_state = 'disputed', disputed_at = now(), dispute_reason = 'damaged' where id = $1`, [c.order_id]);
  if (end === 'refunded') await db.query(`update public.orders set disputed_at = now() - interval '10 hours', dispute_reason = 'not_as_described', dispute_resolution = 'refund', resolved_at = now() where id = $1`, [c.order_id]);
  return c.order_id;
};
const today = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
const report = (uid = U.STAFF, from = since, to = today) => as(db, uid, 'select public.staff_report($1, $2) as r', [from, to]).then((x) => x.rows[0].r);

await rejects(report(U.SELLER), 'members can’t see reports', /Staff only/);
await rejects(report(null), 'nor can visitors', /permission denied|Staff only/);
await rejects(report(U.STAFF, today, '2020-01-01'), 'the range has to make sense', /date range/);

await sale(2000, 'confirmed');
await sale(3000, 'confirmed');
await sale(10000, 'disputed');
await sale(1500, 'refunded');
const r = await report();
ok(r.sales.orders === 4 && r.sales.gmv_pence === 16500 && r.sales.sellers === 1 && r.sales.buyers === 1, `sales: 4 orders, £165 (${r.sales.gmv_pence})`);
ok(r.sales.average_order_pence === 4125, 'and the average order');
ok(r.fees.transaction_pence > 0 && r.fees.processing_pence === 320 && r.fees.net_pence === r.fees.transaction_pence + r.fees.processing_pence + r.fees.commission_pence - r.fees.promotion_pence - r.fees.nutuyu_vouchers_pence,
  `fees: transaction ${r.fees.transaction_pence}, processing 4 × 80p, and NuTuYu’s net`);
ok(r.fees.courier_pence > 0, 'courier charges shown (the £100 item is courier-witnessed)');
ok(r.by_tier.enhanced.orders === 3 && r.by_tier.verified.orders === 1, 'by protection level');
ok(r.by_category[0].category === 'men' && r.by_category[0].orders === 4, 'by category');
ok(r.disputes.opened === 2 && r.disputes.refunded === 1 && r.disputes.open_now === 1 && r.disputes.rate_pct === 50, 'disputes: 2 opened (50%), 1 refunded, 1 still open');
ok(r.disputes.by_reason.damaged === 1 && r.disputes.avg_hours_to_decide === 10, 'by reason, and 10 hours to decide');
ok(r.handover.completed === 2 && r.handover.avg_hours === 48 && r.handover.median_hours === 48, 'handover: 2 completed in about 48 hours');
ok(r.months.length === 12 && r.months.at(-1).orders === 4, '12 months, this month with 4 orders');
ok(!JSON.stringify(r).includes('@') && !JSON.stringify(r).includes(U.BUYER), 'no people in the report');
const empty = await report(U.STAFF, '2025-01-01', '2025-01-31');
ok(empty.sales.orders === 0 && empty.sales.average_order_pence === null && empty.handover.avg_hours === null, 'an empty range is zeros, not errors');
console.log(failures ? `\n${failures} FAILED` : '\nall report checks passed');
process.exit(failures ? 1 : 0);
