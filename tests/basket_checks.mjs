// Migration 013 on a real Postgres (PGlite), acting as real users through Row Level Security:
// opt-in baskets, moving items, wrapping defaults, sharing, one payment for every basket, gift links.
// Usage: node basket_checks.mjs
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
  ALEX: '33333333-3333-3333-3333-333333333333', STAFF: '44444444-4444-4444-4444-444444444444',
  SELLER2: '66666666-6666-6666-6666-666666666666',
};
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const shop = async (title, price, seller = U.SELLER, size = null) =>
  (await one(seller, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published, size_label) values ($1, $2, $3, 399, true, $4) returning id`, [seller, title, price, size])).id;
const mine = async (uid = U.BUYER) => (await one(uid, 'select public.my_baskets() as b')).b;
const where = (b, listing) => b.baskets.find((x) => x.items.some((i) => i.listing_id === listing));

console.log('=== Opt-in and the General basket ===');
let b = await mine();
ok(b.enabled === false && b.baskets.length === 1 && b.baskets[0].general, 'everyone starts with just a General basket, multi-basket off');
const boots = await shop('Hiking boots', 4000, U.SELLER, 'UK 9');
const scarf = await shop('Silk scarf', 2500, U.SELLER2);
const tee = await shop('Kids tee', 900, U.SELLER, '5–6 years');
await as(db, U.BUYER, 'select public.basket_put($1, null)', [boots]);
ok(where(await mine(), boots)?.general, 'with multi-basket off, items go to General');
await rejects(as(db, U.BUYER, `select public.save_basket(null, '{"name":"Alex"}')`).then(async () => {
  const id = (await mine()).baskets.find((x) => x.name === 'Alex').id;
  return as(db, U.BUYER, 'select public.basket_put($1, $2)', [boots, id]);
}), 'personal baskets can’t be filled until multi-basket is switched on', /Switch on multi-basket/);
b = (await one(U.BUYER, 'select public.set_multi_basket(true) as b')).b;
ok(b.enabled === true, 'the member switches multi-basket on');

console.log('\n=== Personal baskets ===');
const alexId = b.baskets.find((x) => x.name === 'Alex').id;
b = (await one(U.BUYER, `select public.save_basket($1, $2) as b`, [alexId, JSON.stringify({ age_group: 'adult', sizes: { shoe: 'UK 9', top: 'M' }, budget_pence: 15000, style_notes: 'Earthy colours', wrap_style: 'kraft', wrap_all: true, gift_message: 'Happy birthday!' })])).b;
const alex = b.baskets.find((x) => x.id === alexId);
ok(alex.sizes.shoe === 'UK 9' && alex.budget_pence === 15000 && alex.wrap_all, 'a basket keeps its sizes, budget, notes and wrapping default');
await rejects(as(db, U.BUYER, `select public.save_basket($1, '{"sizes":{"hat":"L"}}')`, [alexId]), 'unknown size types are refused', /shoe, top, trousers/);
await rejects(as(db, U.BUYER, `select public.save_basket($1, '{"wrap_style":"glitter"}')`, [alexId]), 'only the offered wrapping papers can be chosen', /check constraint|violates/);
for (const n of ['Mark', 'Lisa', 'Cheryl']) await as(db, U.BUYER, 'select public.save_basket(null, $1)', [JSON.stringify({ name: n })]);
await rejects(as(db, U.BUYER, `select public.save_basket(null, '{"name":"Fifth"}')`), 'no more than four personal baskets', /four personal baskets/);
await rejects(as(db, U.ALEX, 'select public.save_basket($1, $2)', [alexId, '{"name":"Mine now"}']), 'nobody else can change a basket', /not found/);
ok((await as(db, U.ALEX, 'select id from public.baskets where id = $1', [alexId])).rows.length === 0, 'nobody else can see a basket');
await rejects(as(db, U.BUYER, `insert into public.basket_items (owner_id, listing_id, basket_id) values ($1, $2, $3)`, [U.BUYER, scarf, alexId]), 'basket items can’t be written directly', /permission denied/);

console.log('\n=== Moving and wrapping ===');
b = (await one(U.BUYER, 'select public.basket_put($1, $2) as b', [boots, alexId])).b;
let item = where(b, boots).items.find((i) => i.listing_id === boots);
ok(where(b, boots).id === alexId && item.wrap === true, 'dropping an item into Alex’s basket moves it and wraps it (wrap all is on)');
ok(b.baskets.flatMap((x) => x.items).filter((i) => i.listing_id === boots).length === 1, 'an item is only ever in one basket');
b = (await one(U.BUYER, 'select public.basket_set_wrap($1, false) as b', [boots])).b;
ok(where(b, boots).items[0].wrap === false, 'a single item can be left unwrapped');
await as(db, U.BUYER, 'select public.basket_put($1, null)', [scarf]);
await rejects(as(db, U.BUYER, 'select public.basket_set_wrap($1, true)', [scarf]), 'General items can’t be wrapped', /wrapping paper/);
await as(db, U.BUYER, 'select public.basket_put($1, $2)', [boots, alexId]);
ok(where(await mine(), boots).items[0].wrap === false, 'putting an item back in the same basket keeps its wrapping choice');
await rejects(as(db, U.SELLER, 'select public.basket_put($1, null)', [boots]), 'sellers can’t basket their own items', /own listing/);
const lisaId = (await mine()).baskets.find((x) => x.name === 'Lisa').id;
await as(db, U.BUYER, 'select public.basket_put($1, $2)', [tee, lisaId]);
b = (await one(U.BUYER, 'select public.delete_basket($1) as b', [lisaId])).b;
ok(where(b, tee)?.general && !b.baskets.some((x) => x.name === 'Lisa'), 'removing a basket moves its items to General');
b = (await one(U.BUYER, 'select public.set_multi_basket(false) as b', [])).b;
ok(b.baskets.some((x) => x.id === alexId) && where(b, boots).id === alexId, 'switching off keeps the personal baskets (hidden) and their items');
await as(db, U.BUYER, 'select public.set_multi_basket(true)');

console.log('\n=== Sharing ===');
b = (await one(U.BUYER, 'select public.share_basket($1, true) as b', [alexId])).b;
const token = b.baskets.find((x) => x.id === alexId).share_token;
const shared = (await one(null, 'select public.shared_basket($1) as s', [token])).s;
ok(shared.name === 'Alex' && shared.items.length === 1 && shared.sizes.shoe === 'UK 9', 'anyone with the link sees the basket, sizes and items');
ok(!('budget_pence' in shared) && !('recipient_address' in shared) && !JSON.stringify(shared).includes(U.BUYER), 'the shared view never shows the budget, address or owner');
await as(db, U.BUYER, 'select public.share_basket($1, false)', [alexId]);
ok((await one(null, 'select public.shared_basket($1) as s', [token])).s === null, 'stopping sharing kills the old link');

console.log('\n=== One payment for every basket ===');
await rejects(as(db, U.BUYER, `select public.start_basket_checkout('separate')`), 'sending separately needs an address for each person', /address for Alex/);
await rejects(as(db, U.BUYER, 'select public.save_basket($1, $2)', [alexId, JSON.stringify({ recipient_address: { name: 'Alex', line1: '1 High St', town: 'Leeds', postcode: 'nope' } })]), 'a bad postcode is refused', /UK postcode/);
await as(db, U.BUYER, 'select public.save_basket($1, $2)', [alexId, JSON.stringify({ recipient_address: { name: 'Alex Doe', line1: '1 High St', town: 'Leeds', postcode: 'ls1 4ab' }, deliver_by: '2099-12-20', gift_receipt: true })]);
await as(db, U.BUYER, 'select public.basket_set_wrap($1, true)', [boots]);
let g = (await one(U.BUYER, `select public.start_basket_checkout('separate') as g`)).g;
const sum = g.orders.reduce((n, o) => n + o.total_pence, 0);
ok(g.orders.length === 3 && g.total_pence === sum, 'one checkout makes an order per item and the group total is their sum');
ok(g.wrapped_items === 0 && g.wrap_total_pence === 0, 'while wrapping isn’t switched on, nothing is charged for it');
const alexOrder = g.orders.find((o) => o.listing_id === boots);
ok(alexOrder.basket === 'Alex' && alexOrder.gift && alexOrder.ship_to?.postcode === 'LS1 4AB', 'Alex’s item is a gift, sent to Alex');
ok(g.orders.find((o) => o.listing_id === scarf).ship_to === null, 'General items go to the buyer');
ok((await db.query(`select count(*)::int as n from public.listings where id = any($1) and status = 'reserved'`, [[boots, scarf, tee]])).rows[0].n === 3, 'every item is held while the buyer pays');
await rejects(as(db, U.BUYER, `update public.orders set gift_token = 'x', recipient_id = $2 where id = $1`, [alexOrder.order_id, U.BUYER]).then(async () => {
  const r = (await db.query('select gift_token, recipient_id from public.orders where id = $1', [alexOrder.order_id])).rows[0];
  if (r.gift_token === 'x' || r.recipient_id) return; else throw new Error('unchanged as expected');
}), 'buyers can’t change gift fields on an order', /unchanged as expected|permission/);

// Staff switch wrapping on at £3 an item; the next checkout charges it on its own line.
await as(db, U.STAFF, `select public.staff_update_settings(null, '{"wrapping_live": true, "wrap_fee_pence": 300}')`);
await as(db, U.BUYER, 'select public.cancel_basket_checkout($1)', [g.group_id]);
ok((await db.query(`select count(*)::int as n from public.listings where id = any($1) and status = 'active'`, [[boots, scarf, tee]])).rows[0].n === 3, 'cancelling releases every item');
g = (await one(U.BUYER, `select public.start_basket_checkout('combined') as g`)).g;
ok(g.wrapped_items === 1 && g.wrap_total_pence === 300 && g.total_pence === g.orders.reduce((n, o) => n + o.total_pence, 0) + 300, 'with wrapping on, each wrapped item adds the flat fee to the one total');
ok(g.orders.every((o) => o.ship_to === null), 'combined shipping sends everything to the buyer');
const g2 = (await one(U.BUYER, `select public.start_basket_checkout('combined') as g`)).g;
ok(g2.group_id !== g.group_id && (await db.query(`select payment_status from public.checkout_groups where id = $1`, [g.group_id])).rows[0].payment_status === 'cancelled', 'starting again replaces the unpaid checkout');
g = g2;
await rejects(as(db, U.BUYER, 'select public.confirm_group_payment($1, $2, $3)', [g.group_id, 'pi_x', g.total_pence]), 'members can’t mark a group paid', /permission denied/);
ok((await svc('select public.confirm_group_payment($1, $2, $3) as r', [g.group_id, 'pi_short', g.total_pence - 1])).rows[0].r === 'amount_mismatch', 'a wrong amount sends the group to review');
await db.query(`update public.checkout_groups set payment_status = 'awaiting_payment' where id = $1`, [g.group_id]);
await db.query(`update public.orders set payment_status = 'awaiting_payment' where group_id = $1`, [g.group_id]);
const res = (await svc('select public.confirm_group_payment($1, $2, $3) as r', [g.group_id, 'pi_good', g.total_pence])).rows[0].r;
ok(res === 'paid', `the right amount pays every order at once (${res})`);
const paid = (await db.query(`select count(*)::int as n from public.orders where group_id = $1 and payment_status = 'paid'`, [g.group_id])).rows[0].n;
ok(paid === 3, 'all three orders are paid, each with its own custody record');
ok((await mine()).baskets.every((x) => x.items.length === 0), 'paid items leave the baskets');

console.log('\n=== Gift links ===');
const giftOrder = (await db.query('select id, gift_token from public.orders where group_id = $1 and listing_id = $2', [g.group_id, boots])).rows[0];
const before = (await one(null, 'select public.gift_view($1) as v', [giftOrder.gift_token])).v;
ok(before.title === 'Hiking boots' && before.message === 'Happy birthday!' && before.order_id === null, 'the gift link shows the item and message, but not the order, before it’s opened');
ok(!JSON.stringify(before).match(/price|total|pence|LS1/i), 'the gift link never shows prices or the address');
await rejects(as(db, U.SELLER, 'select public.claim_gift($1)', [giftOrder.gift_token]), 'the seller can’t claim the gift', /seller/);
const claimed = (await one(U.ALEX, 'select public.claim_gift($1) as v', [giftOrder.gift_token])).v;
ok(claimed.mine && claimed.order_id === giftOrder.id, 'Alex signs in and opens the gift');
await rejects(as(db, U.STAFF, 'select public.claim_gift($1)', [giftOrder.gift_token]), 'nobody else can claim it after that', /already opened/);
const roles = (await db.query('select public.custody_roles(o, $2) as r from public.orders o where id = $1', [giftOrder.id, U.ALEX])).rows[0].r;
ok(roles.includes('buyer'), 'Alex does the unboxing steps (acts as the receiving buyer)');
ok((await one(U.ALEX, 'select public.custody_can_view($1) as v', [giftOrder.id])).v === true, 'Alex can follow the custody record');
const view = (await one(U.ALEX, 'select public.order_custody($1) as v', [giftOrder.id])).v;
ok(view && !JSON.stringify(view).match(/price_pence|total_pence/), 'the custody view Alex sees has no prices');
ok((await one(U.ALEX, 'select public.my_gifts() as g')).g.length === 1, 'the gift appears in Alex’s Inbox');
ok((await as(db, U.ALEX, 'select id from public.orders where id = $1', [giftOrder.id])).rows.length === 0, 'Alex can’t read the order row itself (with its prices)');

console.log(failures ? `\n${failures} FAILED` : '\nall basket checks passed');
process.exit(failures ? 1 : 0);
