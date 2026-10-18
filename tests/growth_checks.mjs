// Migrations 034–036: push notifications, plans, boosts and the owner's dashboard. Real Postgres (PGlite).
// Usage: node growth_checks.mjs
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
const name = async (id) => (await db.query('select username from public.profiles where id = $1', [id])).rows[0].username;
const shop = async (title, price) => (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [U.SELLER, title, price])).id;
const P = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

console.log('=== Push notifications ===');
await rejects(as(db, U.BUYER, `select public.save_push_subscription('http://evil.example/x', $1, 'abcdefghijklmnop', null)`, [P]), 'only https push services', /check/);
let push = (await one(U.BUYER, `select public.save_push_subscription('https://push.example/abc', $1, 'abcdefghijklmnop', 'Test phone') as p`, [P])).p;
ok(push.devices === 1 && push.on, 'a device is added and pushes are on');
await db.query(`select public.notify($1, 'sold', 'Sold: Lamp', 'Hello', '/inbox')`, [U.BUYER]);
let n = (await db.query(`select push_state from public.notifications where user_id = $1`, [U.BUYER])).rows[0];
ok(n.push_state === 'pending', 'a new notification is queued for push');
await db.query(`select public.notify($1, 'sold', 'Sold: Mug', 'Hello', '/inbox')`, [U.SELLER]);
ok((await db.query(`select push_state from public.notifications where user_id = $1`, [U.SELLER])).rows[0].push_state === null, 'not for members without a device');
await rejects(as(db, U.BUYER, 'select * from public.push_outbox_claim(10)'), 'only the worker sends pushes', /permission denied/);
const claim = (await svc('select * from public.push_outbox_claim(10)')).rows;
ok(claim.length === 1 && claim[0].devices[0].endpoint === 'https://push.example/abc' && claim[0].title === 'Sold: Lamp', 'the worker gets it with the member’s devices');
await svc(`select public.push_done($1, false, array['https://push.example/abc'])`, [claim[0].id]);
ok((await one(U.BUYER, 'select public.my_push() as p')).p.devices === 0, 'a device that’s gone is removed');
await one(U.BUYER, `select public.save_push_subscription('https://push.example/abc', $1, 'abcdefghijklmnop', null) as p`, [P]);
await one(U.BUYER, 'select public.set_push_on(false) as p');
await db.query(`select public.notify($1, 'sold', 'Sold: Hat', 'Hello', '/inbox')`, [U.BUYER]);
ok((await db.query(`select push_state from public.notifications where user_id = $1 and title = 'Sold: Hat'`, [U.BUYER])).rows[0].push_state === null, 'switched off: no pushes');
await rejects(as(db, U.SELLER, 'select * from public.push_subscriptions'), 'devices aren’t readable directly', /permission denied/);

console.log('\n=== Plans ===');
const plans = (await one(null, 'select public.plans_list() as p')).p;
ok(plans.map((p) => p.key).join() === 'standard,premium,premium_plus' && plans[2].price_pence === 1750, 'three plans; Premium+ is £17.50');
ok((await one(U.SELLER, 'select public.my_plan() as p')).p.plan === 'standard', 'everyone starts on Standard');
await rejects(as(db, U.SELLER, `select public.choose_free_plan('premium_plus')`), 'a paid plan needs payment', /continue to payment/);
ok((await one(U.SELLER, `select public.choose_free_plan('premium') as p`)).p.plan === 'premium', 'Premium is free: chosen straight away');
ok((await one(null, 'select public.member_plan($1) as p', [await name(U.SELLER)])).p.name === 'Premium', 'and shows as a badge');
await rejects(as(db, U.SELLER, `select public.subscription_synced($1, 'premium_plus', 'cus_x', 'sub_x', 'active', now(), false)`, [U.SELLER]), 'members can’t grant themselves a paid plan', /permission denied/);
await svc(`select public.subscription_synced($1, 'premium_plus', 'cus_ABC123', 'sub_ABC123', 'active', now() + interval '30 days', false)`, [U.BUYER]);
ok((await one(U.BUYER, 'select public.my_plan() as p')).p.plan === 'premium_plus', 'Stripe says paid: Premium+');
await rejects(as(db, U.BUYER, `select public.choose_free_plan('standard')`), 'leaving a paid plan goes through billing', /Cancel your paid plan/);
await svc(`select public.subscription_synced(null, null, null, 'sub_ABC123', 'canceled', now(), false)`);
ok((await one(U.BUYER, 'select public.my_plan() as p')).p.plan === 'standard', 'cancelled: back to Standard');
await rejects(as(db, U.SELLER, `select public.staff_save_plan('premium', 500, '{}')`), 'only staff change plans', /Staff only/);
await rejects(as(db, U.STAFF, `select public.staff_save_plan('standard', 100, '{}')`), 'Standard is always free', /always free/);
const sp = (await one(U.STAFF, `select public.staff_save_plan('premium_plus', 1500, '{"boost_credits": 2}') as p`)).p;
ok(sp[2].price_pence === 1500 && sp[2].perks.boost_credits === 2 && sp[2].perks.api === 'full', 'staff change a price and a perk; other perks stay');

console.log('\n=== Boosts ===');
const coat = await shop('Wool coat', 6000);
const mug = await shop('Mug', 900);
await as(db, U.SELLER, 'update public.listings set boost_bp = 800 where id = $1', [coat]);
ok((await db.query('select boost_bp from public.listings where id = $1', [coat])).rows[0].boost_bp === null, 'members can’t set a boost directly');
await rejects(as(db, U.SELLER, 'select public.set_boost($1, 500)', [mug]), 'boosts are for items of £25 or more', /£25/);
await rejects(as(db, U.SELLER, 'select public.set_boost($1, 2000)', [coat]), 'within the allowed rates', /between 3% and 8%/);
await rejects(as(db, U.BUYER, 'select public.set_boost($1, 500)', [coat]), 'only the seller', /not found/i);
await one(U.SELLER, 'select public.set_boost($1, 500) as b', [coat]);
const q = (await one(null, 'select public.order_quote($1) as q', [coat])).q;
ok(q.commission_pence === 380 && q.seller_payout_pence === 6000 - 380, 'a boosted sale pays the advertising fee (5% + 80p) from the seller’s share');
ok(q.promotion_pence === 0, 'the buyer’s promotion share is a fee setting, 0% for now');
ok((await db.query('select boosted from public.listings where id = $1', [coat])).rows[0].boosted === true, 'marked boosted (for browse order)');
await as(db, U.SELLER, 'update public.listings set published = false where id = $1', [coat]);
ok((await db.query('select boost_bp from public.listings where id = $1', [coat])).rows[0].boost_bp === null, 'taking it off sale ends the boost');

console.log('\n=== Owner dashboard ===');
await rejects(as(db, U.SELLER, 'select public.staff_dashboard()'), 'staff only', /Staff only/);
const l = await shop('Lamp', 3000);
const c = (await one(U.BUYER, 'select public.start_checkout($1, null) as c', [l])).c;
await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_1', c.total_pence ?? c.quote.buyer_total_pence]);
const d = (await one(U.STAFF, 'select public.staff_dashboard() as d')).d;
ok(d.week.orders === 1 && d.week.gmv_pence === 3000 && d.week.net_fees_pence > 0, 'this week: 1 order, £30, and NuTuYu’s fees');
ok(d.members.total === 3 && d.members.new === 3 && d.listings.live >= 1, `members and live listings (${JSON.stringify([d.members, d.listings])})`);
ok(d.daily.length === 30 && d.daily.at(-1).orders === 1, '30 days, today with the order');
ok(d.top_sellers[0].orders === 1 && d.attention.disputes === 0, 'top sellers and what needs attention');
console.log(failures ? `\n${failures} FAILED` : '\nall growth checks passed');
process.exit(failures ? 1 : 0);
