// Migration 029: questions before buying, reports and staff moderation. Real Postgres (PGlite), through Row Level Security.
// Usage: node moderation_checks.mjs
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
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const name = async (id) => (await db.query('select username from public.profiles where id = $1', [id])).rows[0].username;
const shop = async (title) => (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, 2000, 399, true) returning id`, [U.SELLER, title])).id;
const qs = (uid, l) => one(uid, 'select public.listing_questions($1) as q', [l]).then((r) => r.q);

const dress = await shop('Floral dress');
console.log('=== Questions ===');
await rejects(as(db, null, 'select public.ask_question($1, $2)', [dress, 'Does it fit small?']), 'visitors must sign in', /permission denied|Sign in/);
await rejects(as(db, U.SELLER, 'select public.ask_question($1, $2)', [dress, 'Does it fit small?']), 'not about your own item', /own item/);
await rejects(as(db, U.BUYER, 'select public.ask_question($1, $2)', [dress, 'ok']), 'a real question', /500 characters/);
await rejects(as(db, U.BUYER, 'select public.ask_question($1, $2)', [dress, 'Can I pay you by bank transfer? email me bea@x.com']), 'no contact or payment details', /contact and payment/);
let q = (await one(U.BUYER, 'select public.ask_question($1, $2) as q', [dress, 'Does it come up small?'])).q;
ok(q.length === 1 && q[0].mine && q[0].answer === null, 'a buyer asks; they see their question');
ok((await qs(U.OTHER, dress)).length === 0 && (await qs(null, dress)).length === 0, 'others don’t see unanswered questions');
const told = (await db.query(`select count(*)::int n from public.notifications where user_id = $1 and kind = 'message'`, [U.SELLER])).rows[0].n;
ok(told === 1, 'the seller is told');
const waiting = (await one(U.SELLER, 'select public.my_unanswered_questions() as q')).q;
ok(waiting.length === 1 && waiting[0].title === 'Floral dress', 'and sees it waiting on their selling page');
const sq = await qs(U.SELLER, dress);
ok(sq[0].can_answer && !('asker' in sq[0]), 'the seller can answer; the asker isn’t named');
await rejects(as(db, U.OTHER, 'select public.answer_question($1, $2)', [sq[0].id, 'Yes']), 'only the seller answers', /not found/i);
q = (await one(U.SELLER, 'select public.answer_question($1, $2) as q', [sq[0].id, 'Yes, size up.'])).q;
ok(q[0].answer === 'Yes, size up.', 'answered');
ok((await qs(null, dress))[0].answer === 'Yes, size up.', 'answered questions are public');
await rejects(as(db, U.SELLER, 'select public.answer_question($1, $2)', [sq[0].id, 'again']), 'only one answer', /already answered/);
for (let i = 0; i < 2; i++) await one(U.BUYER, 'select public.ask_question($1, $2) as q', [dress, `Another question ${i}?`]);
await one(U.BUYER, 'select public.ask_question($1, $2) as q', [dress, 'Third open question?']);
await rejects(as(db, U.BUYER, 'select public.ask_question($1, $2)', [dress, 'Fourth open question?']), 'at most 3 open questions per item', /answer your questions first/);
const spam = (await qs(U.SELLER, dress)).find((x) => !x.answer);
await one(U.SELLER, 'select public.remove_question($1) as q', [spam.id]);
ok((await qs(U.SELLER, dress)).length === 3, 'the seller can remove a question');
for (const t of ['A']) await one(U.BUYER, 'select public.ask_question($1, $2) as q', [await shop(t), `About ${t}?`]);
await rejects(as(db, U.BUYER, 'select public.ask_question($1, $2)', [await shop('C'), 'About C?']), 'and 5 an hour', /later/);
await rejects(as(db, U.BUYER, 'select * from public.listing_questions'), 'the table isn’t readable directly', /permission denied/);

console.log('\n=== Reports ===');
await rejects(as(db, U.SELLER, `select public.report($1, null, 'scam', null)`, [dress]), 'not your own listing', /own listing/);
await rejects(as(db, U.BUYER, `select public.report($1, null, 'other', null)`, [dress]), '“other” needs a note', /what’s wrong/);
await one(U.BUYER, `select public.report($1, null, 'counterfeit', 'Label looks fake') as r`, [dress]);
await one(U.BUYER, `select public.report($1, null, 'counterfeit', 'again') as r`, [dress]);
await one(U.OTHER, `select public.report($1, null, 'scam', null) as r`, [dress]);
await one(U.OTHER, `select public.report(null, $1, 'scam', 'Asked me to pay outside') as r`, [await name(U.SELLER)]);
ok((await db.query('select count(*)::int n from public.reports')).rows[0].n === 3, 'reports are counted once per member and target');
await rejects(as(db, U.BUYER, 'select public.staff_moderation()'), 'only staff see reports', /Staff only/);
let m = (await one(U.STAFF, `select public.staff_moderation('open') as m`)).m;
ok(m.open === 3 && m.items[0].kind === 'listing' && m.items[0].count === 2 && m.items[0].reasons.length === 2, 'staff see them grouped: the dress, reported twice');

console.log('\n=== Hiding a listing ===');
await rejects(as(db, U.STAFF, `select public.staff_moderate($1, null, 'hide_listing', '')`, [dress]), 'a decision needs a note', /short note/);
m = (await one(U.STAFF, `select public.staff_moderate($1, null, 'hide_listing', 'Counterfeit label') as m`, [dress])).m;
const l = (await db.query('select published, moderated_at from public.listings where id = $1', [dress])).rows[0];
ok(!l.published && l.moderated_at, 'hidden: off sale');
ok((await as(db, null, 'select id from public.listings where id = $1', [dress])).rows.length === 0, 'visitors can’t see it');
await rejects(as(db, U.SELLER, 'update public.listings set published = true where id = $1', [dress]), 'the seller can’t put it back', /staff have hidden/);
await as(db, U.SELLER, 'update public.listings set moderated_at = null, moderation_note = null where id = $1', [dress]);
ok((await db.query('select moderated_at from public.listings where id = $1', [dress])).rows[0].moderated_at, 'nor clear the hide');
ok((await one(U.SELLER, 'select public.my_hidden_listings() as h')).h[0].note === 'Counterfeit label', 'they see why');
ok(m.open === 1, 'the listing’s reports are closed');
await one(U.STAFF, `select public.staff_moderate($1, null, 'restore_listing', 'Seller sent proof') as m`, [dress]);
ok((await db.query('select published from public.listings where id = $1', [dress])).rows[0].published, 'staff can restore it');

console.log('\n=== Suspending a member ===');
const live = (await db.query('select count(*)::int n from public.listings where seller_id = $1 and published', [U.SELLER])).rows[0].n;
await one(U.STAFF, `select public.staff_moderate(null, $1, 'suspend', 'Asking buyers to pay outside NuTuYu') as m`, [await name(U.SELLER)]);
ok((await db.query('select count(*)::int n from public.listings where seller_id = $1 and published', [U.SELLER])).rows[0].n === 0, 'all their listings come off sale');
await rejects(as(db, U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, 'New', 1000, 0, true)`, [U.SELLER]), 'they can’t list', /suspended/);
await rejects(as(db, U.SELLER, `select public.ask_question($1, $2)`, [await (async () => (await one(U.OTHER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, 'Mug', 900, 0, true) returning id`, [U.OTHER])).id)(), 'Is it chipped?']), 'or ask', /suspended/);
await as(db, U.SELLER, 'update public.profiles set suspended_at = null where id = $1', [U.SELLER]);
ok((await db.query('select suspended_at from public.profiles where id = $1', [U.SELLER])).rows[0].suspended_at, 'they can’t lift it themselves');
ok((await one(U.STAFF, `select public.staff_moderation('open') as m`)).m.open === 0, 'their reports are closed');
await one(U.STAFF, `select public.staff_moderate(null, $1, 'restore_member', 'Spoke to them; warning given') as m`, [await name(U.SELLER)]);
ok((await db.query('select count(*)::int n from public.listings where seller_id = $1 and published', [U.SELLER])).rows[0].n === live, 'restored: their listings come back');
ok((await db.query(`select count(*)::int n from public.staff_actions where action like 'moderation_%'`)).rows[0].n === 4, 'every decision is recorded');
console.log(failures ? `\n${failures} FAILED` : '\nall moderation checks passed');
process.exit(failures ? 1 : 0);
