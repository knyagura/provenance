// Migration 022: voucher codes (NuTuYu's and shops'), gift cards and the NuTuYu balance.
// Real Postgres (PGlite), acting through Row Level Security. Usage: node voucher_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = {
  SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222', FRIEND: '33333333-3333-3333-3333-333333333333',
  STAFF: '44444444-4444-4444-4444-444444444444', SHOP2: '55555555-5555-5555-5555-555555555555',
};
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const shop = async (title, price, seller = U.SELLER) =>
  (await one(seller, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [seller, title, price])).id;
const order = async (id) => (await db.query('select price_pence, total_pence, fees, payment_status from public.orders where id = $1', [id])).rows[0];
const checkout = async (listing, uid = U.BUYER) => (await one(uid, 'select public.start_checkout($1, null) as c', [listing])).c.order_id;

console.log('=== Making codes ===');
await rejects(as(db, U.BUYER, `select public.staff_save_voucher(null, '{"code":"FREE","kind":"percent","value":90}')`), 'members can’t make NuTuYu codes', /Staff only/);
await as(db, U.STAFF, `select public.staff_save_voucher(null, $1::jsonb)`, [JSON.stringify({ code: 'welcome10', kind: 'percent', value: 10, first_order_only: true, max_discount_pence: 1000 })]);
await as(db, U.STAFF, `select public.staff_save_voucher(null, $1::jsonb)`, [JSON.stringify({ code: 'FIVER', kind: 'amount', value: 500, min_spend_pence: 2000, per_member: 1 })]);
await rejects(as(db, U.STAFF, `select public.staff_save_voucher(null, $1::jsonb)`, [JSON.stringify({ code: 'FIVER', kind: 'amount', value: 100 })]), 'codes are unique', /taken/);
const shopCodes = (await one(U.SELLER, `select public.save_shop_voucher(null, $1::jsonb) as v`, [JSON.stringify({ code: 'SAMSHOP', kind: 'percent', value: 20 })])).v;
ok(shopCodes.length === 1 && shopCodes[0].shop && shopCodes[0].code === 'SAMSHOP', 'a seller makes a 20% code for their own shop');
await rejects(as(db, U.SELLER, `select public.save_shop_voucher(null, $1::jsonb)`, [JSON.stringify({ code: 'HALFOFF', kind: 'percent', value: 60 })]), 'shop codes go up to 50%', /50%/);
await rejects(as(db, U.BUYER, 'select * from public.vouchers'), 'members can’t list the codes', /permission denied/);

console.log('\n=== NuTuYu code: the buyer pays less, the seller still gets their full payout ===');
const coat = await shop('Coat', 4000);
const o1 = await checkout(coat);
const before = await order(o1);
let c = (await one(U.BUYER, `select public.apply_code($1, 'welcome10') as c`, [o1])).c;
let after = await order(o1);
ok(c.voucher.code === 'WELCOME10' && c.voucher.discount_pence === 400, '10% off a £40 coat is £4');
ok(after.total_pence === before.total_pence - 400 && after.price_pence === 4000 && after.fees.seller_payout_pence === before.fees.seller_payout_pence, 'the card total drops £4; price and seller payout don’t');
await rejects(as(db, U.BUYER, `select public.apply_code($1, 'FIVER')`, [o1]), 'one code per checkout', /already applied/);
c = (await one(U.BUYER, 'select public.remove_voucher($1) as c', [o1])).c;
ok(c.voucher === null && (await order(o1)).total_pence === before.total_pence, 'removing the code puts the total back');

await rejects(as(db, U.BUYER, `select public.apply_code($1, 'NOPE')`, [o1]), 'an unknown code is refused', /isn’t valid/);
await rejects(as(db, U.FRIEND, `select public.apply_code($1, 'WELCOME10')`, [o1]), 'nobody can apply a code to someone else’s checkout', /ended/);
await as(db, U.BUYER, `select public.apply_code($1, 'welcome10')`, [o1]);
const paidTotal = (await order(o1)).total_pence;
ok((await svc('select public.confirm_payment($1, $2, $3) as r', [o1, 'pi_1', paidTotal])).rows[0].r === 'paid', 'the buyer pays the discounted total');
ok((await db.query(`select state from public.voucher_uses where order_id = $1 order by created_at`, [o1])).rows.map((r) => r.state).join() === 'released,used', 'the removed one is released; the one paid with is spent');
const o2 = await checkout(await shop('Scarf', 3000));
await rejects(as(db, U.BUYER, `select public.apply_code($1, 'WELCOME10')`, [o2]), 'a first-order code doesn’t work twice', /already used|first order/);
await rejects(as(db, U.BUYER, `select public.apply_code($1, 'FIVER')`, [await checkout(await shop('Pin', 900))]), 'minimum spend is checked', /Spend at least £20/);

console.log('\n=== Shop code: the seller pays, on their items only ===');
const hat = await shop('Hat', 2000);
const mug = await shop('Mug', 1500, U.SHOP2);
for (const l of [hat, mug]) await as(db, U.BUYER, 'select public.basket_put($1, null)', [l]);
const g = (await one(U.BUYER, `select public.start_basket_checkout('combined') as g`)).g;
const gBefore = g.total_pence;
c = (await one(U.BUYER, `select public.apply_code($1, 'SAMSHOP') as c`, [g.group_id])).c;
const hatOrder = g.orders.find((o) => o.listing_id === hat).order_id;
const mugOrder = g.orders.find((o) => o.listing_id === mug).order_id;
const h = await order(hatOrder);
ok(h.price_pence === 1600 && h.fees.voucher_funder === 'seller' && h.fees.seller_payout_pence <= 1600, 'the hat’s price drops 20% and the payout is worked out on £16');
ok((await order(mugOrder)).price_pence === 1500, 'the other shop’s mug is untouched');
const gNow = (await db.query('select total_pence from public.checkout_groups where id = $1', [g.group_id])).rows[0].total_pence;
ok(gNow < gBefore && gNow === c.total_pence, `the one payment comes down too (£${(gBefore / 100).toFixed(2)} → £${(gNow / 100).toFixed(2)})`);
await as(db, U.BUYER, 'select public.cancel_basket_checkout($1)', [g.group_id]);
ok((await db.query(`select state from public.voucher_uses where target = $1`, [g.group_id])).rows.every((r) => r.state === 'released'), 'cancelling the checkout gives the code back');

console.log('\n=== Gift cards and the balance ===');
await rejects(as(db, U.FRIEND, 'select public.buy_gift_card(500, null, null, null)'), 'gift cards start at £10', /£10 to £250/);
const card = (await one(U.FRIEND, `select public.buy_gift_card(2500, 'Bea', 'Bea@Example.com', 'Happy birthday!') as c`)).c;
ok(card.code === null && card.payment_status === 'awaiting_payment', 'a friend buys a £25 card; the code stays hidden until it’s paid');
await rejects(as(db, U.FRIEND, 'select public.confirm_gift_card_payment($1, $2, 2500)', [card.id, 'pi_x']), 'members can’t mark it paid', /permission denied/);
ok((await svc('select public.confirm_gift_card_payment($1, $2, 2500) as r', [card.id, 'pi_gc'])).rows[0].r === 'paid', 'the payment service confirms it');
const mine = (await one(U.FRIEND, 'select public.my_gift_cards() as c')).c[0];
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(mine.code) && mine.expires_at, 'now the buyer sees the code, valid for 2 years');
const mail = (await db.query('select to_email, subject, body from public.email_outbox')).rows[0];
ok(mail.to_email === 'bea@example.com' && mail.body.includes(mine.code) && mail.body.includes('Happy birthday!'), 'and it is emailed to the recipient with the message');
ok((await one(U.BUYER, 'select public.my_gift_cards() as c')).c.length === 0, 'nobody else sees it');
const bal = (await one(U.BUYER, 'select public.redeem_gift_card($1) as b', [mine.code.toLowerCase()])).b;
ok(bal.balance_pence === 2500, 'the recipient redeems it: £25 balance');
await rejects(as(db, U.FRIEND, 'select public.redeem_gift_card($1)', [mine.code]), 'a card can only be redeemed once', /already been used/);

const bag = await shop('Bag', 1800);
const o3 = await checkout(bag);
const o3total = (await order(o3)).total_pence;
c = (await one(U.BUYER, 'select public.use_balance($1, true) as c', [o3])).c;
ok(c.paid === true && (await order(o3)).payment_status === 'paid', `the balance covers the whole £${(o3total / 100).toFixed(2)}: paid without a card`);
const left = (await one(U.BUYER, 'select public.my_balance() as b', [])).b.balance_pence;
ok(left === 2500 - o3total, `£${(left / 100).toFixed(2)} left`);
const lamp = await shop('Lamp', 4500);
const o4 = await checkout(lamp);
const o4total = (await order(o4)).total_pence;
c = (await one(U.BUYER, 'select public.use_balance($1, true) as c', [o4])).c;
ok((await order(o4)).total_pence === o4total - left && c.balance_available === 0, 'part payment: the rest of the balance comes off, the card pays the remainder');
await rejects(as(db, U.BUYER, `select public.apply_code($1, 'FIVER')`, [o4]), 'codes go on before the balance', /before using your balance/);
await as(db, U.BUYER, 'select public.use_balance($1, false)', [o4]);
ok((await order(o4)).total_pence === o4total && (await one(U.BUYER, 'select public.my_balance() as b')).b.balance_pence === left, 'switching the balance off puts both back');
await as(db, U.BUYER, 'select public.use_balance($1, true)', [o4]);
await as(db, U.BUYER, 'select public.cancel_checkout($1)', [o4]);
ok((await one(U.BUYER, 'select public.my_balance() as b')).b.balance_pence === left, 'an abandoned checkout returns the balance');

console.log('\n=== A gift card code typed at checkout ===');
const card2 = (await one(U.FRIEND, `select public.buy_gift_card(1000, null, null, null) as c`)).c;
await svc('select public.confirm_gift_card_payment($1, $2, 1000)', [card2.id, 'pi_gc2']);
const code2 = (await one(U.FRIEND, 'select public.my_gift_cards() as c')).c.find((x) => x.id === card2.id).code;
const o5 = await checkout(await shop('Book', 2400));
c = (await one(U.BUYER, 'select public.apply_code($1, $2) as c', [o5, code2])).c;
ok(c.balance_pence === 1000 + left && c.voucher === null, 'typed in the code box, it is redeemed and used straight away');
await rejects(as(db, U.BUYER, 'select * from public.gift_cards'), 'gift cards can’t be read directly', /permission denied/);
await rejects(as(db, U.BUYER, 'select * from public.balance_lots'), 'nor balances', /permission denied/);

console.log(failures ? `\n${failures} FAILED` : '\nall voucher and gift card checks passed');
process.exit(failures ? 1 : 0);
