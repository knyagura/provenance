// Migrations 032 and 033: download my data, delete my account, retention, and identity checks. Real Postgres (PGlite).
// Usage: node privacy_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = { SELLER: '11111111-1111-1111-1111-111111111111', BUYER: '22222222-2222-2222-2222-222222222222', OTHER: '33333333-3333-3333-3333-333333333333' };
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const name = async (id) => (await db.query('select username from public.profiles where id = $1', [id])).rows[0].username;
const listing = (await one(U.SELLER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, 'Lamp', 2000, 399, true) returning id`, [U.SELLER])).id;
await one(U.BUYER, `select public.save_address(null, 'Home', $1, true) as a`, [JSON.stringify({ name: 'Bea', line1: '1 Street', town: 'London', postcode: 'SW11 2AB' })]);
await as(db, U.BUYER, 'insert into public.favourites (user_id, listing_id) values ($1, $2)', [U.BUYER, listing]);

console.log('=== Download my data ===');
const x = (await one(U.BUYER, 'select public.export_my_data() as x')).x;
ok(x.account.email === 'buyer@example.com' && x.addresses.length === 1 && x.favourites.length === 1, 'it includes the account, addresses and favourites');
ok(!JSON.stringify(x).includes('seller@example.com'), 'and nobody else’s details');
await rejects(as(db, null, 'select public.export_my_data()'), 'signed-in members only', /permission denied/);

console.log('\n=== Delete my account ===');
const c = (await one(U.BUYER, 'select public.start_checkout($1, null) as c', [listing])).c;
await svc('select public.confirm_payment($1, $2, $3)', [c.order_id, 'pi_1', c.total_pence ?? c.quote.buyer_total_pence]);
ok((await one(U.BUYER, 'select public.account_deletion_blockers() as b')).b.length === 1, 'an order on its way blocks deletion');
ok((await one(U.SELLER, 'select public.account_deletion_blockers() as b')).b.length === 1, 'so does a sale in progress');
await rejects(as(db, U.BUYER, 'select public.delete_my_account($1)', [await name(U.BUYER)]), 'refused while it’s in progress', /on its way/);
await db.query(`update public.orders set custody_state = 'confirmed', confirmed_at = now() where id = $1`, [c.order_id]);
await rejects(as(db, U.BUYER, 'select public.delete_my_account($1)', ['not-my-name']), 'the username must be typed to confirm', /username/);
const r = (await one(U.BUYER, 'select public.delete_my_account($1) as r', [await name(U.BUYER)])).r;
ok(r.deleted === true, 'deleted');
const p = (await db.query('select username, bio, deleted_at from public.profiles where id = $1', [U.BUYER])).rows[0];
ok(/^deleted_[0-9a-f]{10}$/.test(p.username) && p.deleted_at, `anonymised as ${p.username}`);
ok((await db.query('select count(*)::int n from public.addresses where user_id = $1', [U.BUYER])).rows[0].n === 0, 'addresses removed');
ok((await db.query('select count(*)::int n from public.favourites where user_id = $1', [U.BUYER])).rows[0].n === 0, 'favourites removed');
ok((await db.query('select count(*)::int n from public.orders where id = $1', [c.order_id])).rows[0].n === 1, 'the order record is kept');
ok((await db.query('select email from auth.users where id = $1', [U.BUYER])).rows[0].email.endsWith('@invalid.nutuyu'), 'the sign-in email is removed');
const l2 = (await one(U.OTHER, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, 'Mug', 900, 0, true) returning id`, [U.OTHER])).id;
await rejects(as(db, U.BUYER, 'select public.start_checkout($1, null)', [l2]), 'a deleted account can’t buy', /suspended/);
await rejects(as(db, U.BUYER, 'select public.delete_my_account($1)', [p.username]), 'or be deleted twice', /not found/i);

console.log('\n=== Retention ===');
await db.query(`insert into public.notifications (user_id, kind, grp, title, body, link, created_at) values ($1, 'sold', 'sales', 'Old', '', '/', now() - interval '13 months'), ($1, 'sold', 'sales', 'New', '', '/', now())`, [U.SELLER]);
const kept = await db.query('select public.apply_retention() as r');
ok(kept.rows[0].r.notifications === 1, 'notifications over a year old are removed');
ok((await db.query(`select count(*)::int n from public.notifications where user_id = $1 and title = 'New'`, [U.SELLER])).rows[0].n === 1, 'newer ones stay');
await rejects(as(db, U.SELLER, 'select public.apply_retention()'), 'only the schedule runs it', /permission denied/);

console.log('\n=== Identity checks ===');
let id = (await one(U.SELLER, 'select public.my_identity() as i')).i;
ok(id.verified === false && id.latest === null && id.can_start, 'not checked yet');
await rejects(as(db, U.SELLER, `select public.identity_session_started($1, 'vs_123456789')`, [U.SELLER]), 'members can’t record a check themselves', /permission denied/);
await svc(`select public.identity_session_started($1, 'vs_ABCdef123456')`, [U.SELLER]);
await svc(`select public.identity_updated('vs_ABCdef123456', 'requires_input', 'document_expired')`);
id = (await one(U.SELLER, 'select public.my_identity() as i')).i;
ok(id.verified === false && id.latest.status === 'requires_input' && id.latest.error === 'document_expired', 'a failed check says why');
await svc(`select public.identity_updated('vs_ABCdef123456', 'verified', null)`);
ok((await db.query('select kyc_verified from public.profiles where id = $1', [U.SELLER])).rows[0].kyc_verified === true, 'a pass marks the profile Identity checked');
await svc(`select public.identity_updated('vs_ABCdef123456', 'canceled', null)`);
ok((await one(U.SELLER, 'select public.my_identity() as i')).i.latest.status === 'verified', 'a later event can’t undo a pass');
await as(db, U.OTHER, 'update public.profiles set kyc_verified = true where id = $1', [U.OTHER]);
ok((await db.query('select kyc_verified from public.profiles where id = $1', [U.OTHER])).rows[0].kyc_verified === false, 'members still can’t set it themselves');
ok((await svc('select public.identity_can_start($1) as c', [U.SELLER])).rows[0].c === false, 'no new checks once verified');
console.log(failures ? `\n${failures} FAILED` : '\nall privacy checks passed');
process.exit(failures ? 1 : 0);
