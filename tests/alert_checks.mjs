// Migration 019: saved searches and price-drop alerts. Real Postgres (PGlite), acting through Row Level Security.
// Usage: node alert_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const SELLER = '11111111-1111-1111-1111-111111111111';
const SHOPPER = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
for (const [id, email] of [[SELLER, 'sam@example.com'], [SHOPPER, 'bea@example.com'], [OTHER, 'olly@example.com']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
const one = async (uid, sql, params) => (await as(db, uid, sql, params)).rows[0];
const notes = async (uid, kind) => (await one(uid, 'select public.my_notifications() as n')).n.filter((n) => !kind || n.kind === kind);
async function jacket(title, price, size, publish = true) {
  const t = (await one(SELLER, `insert into public.listings (seller_id, title, brand, price_pence, category, evidence_version, condition_label, parcel_size, size_label, declined_shots)
                                values ($1, $2, 'Barbour', $3, 'women', 1, 'Good', 'medium', $4, '{label}') returning id`, [SELLER, title, price, size])).id;
  for (const shot of ['front', 'back']) await as(db, SELLER, `insert into public.listing_media (listing_id, seller_id, path, shot) values ($1, $2, $3, $4)`, [t, SELLER, `${SELLER}/${t}/${shot}.jpg`, shot]);
  if (publish) await as(db, SELLER, 'update public.listings set published = true where id = $1', [t]);
  return t;
}

console.log('=== Saved searches ===');
await rejects(as(db, null, `select public.save_search('x', 'barbour', null, null, null, null, null)`), 'visitors can’t save searches', /permission denied|Sign in/);
await rejects(as(db, SHOPPER, `select public.save_search('Everything', null, null, null, null, null, null)`), 'an empty search can’t be saved', /choose a filter/);
await rejects(as(db, SHOPPER, `select public.save_search('x', 'coat', null, null, null, 5000, 1000)`), 'a back-to-front price range is refused', /more than the lowest/);
const early = await jacket('Barbour Beadnell wax jacket', 5500, '10');
const s = (await one(SHOPPER, `select public.save_search('Barbour size 10 under £60', 'barbour jacket', 'women', ' 10 ', null, null, 6000) as s`)).s;
ok(s.size === '10' && s.max_pence === 6000 && s.alert === true, 'a shopper saves “Barbour jacket, size 10, under £60”');
ok(s.live_count === 1, 'and sees 1 matches already');
ok((await as(db, OTHER, 'select * from public.saved_searches')).rows.length === 0, 'nobody else can see it');
await rejects(as(db, SHOPPER, `insert into public.saved_searches (user_id, name, q) values ($1, 'x', 'y')`, [SHOPPER]), 'searches are saved only through the function', /permission denied/);

console.log('\n=== New matches ===');
await jacket('Barbour Beadnell jacket', 5800, '10');
let m = await notes(SHOPPER, 'search_match');
ok(m.length === 1 && m[0].title === 'New match: Barbour Beadnell jacket · £58' && m[0].body.includes('Size 10'), 'a matching jacket goes live: the shopper is told');
await jacket('Barbour Bedale jacket', 5800, '12');
await jacket('Barbour Liddesdale jacket', 7500, '10');
await jacket('Barbour Beaufort jacket', 5000, '10', false);
ok((await notes(SHOPPER, 'search_match')).length === 1, 'wrong size, too dear, or not live yet: no alert');
const dear = (await db.query(`select id from public.listings where title = 'Barbour Liddesdale jacket'`)).rows[0].id;
await as(db, SELLER, 'update public.listings set published = false where id = $1', [dear]);
await as(db, SELLER, 'update public.listings set price_pence = 5900 where id = $1', [dear]);
await as(db, SELLER, 'update public.listings set published = true where id = $1', [dear]);
m = await notes(SHOPPER, 'search_match');
ok(m.length === 2 && m[0].title.includes('Liddesdale'), 'repriced into the range: now it matches');
await as(db, SELLER, 'update public.listings set published = false where id = $1', [dear]);
await as(db, SELLER, 'update public.listings set published = true where id = $1', [dear]);
ok((await notes(SHOPPER, 'search_match')).length === 2, 'republishing doesn’t alert twice');
await as(db, SHOPPER, 'select public.set_search_alert($1, false)', [s.id]);
await jacket('Barbour Acorn jacket', 4000, '10');
ok((await notes(SHOPPER, 'search_match')).length === 2, 'alerts switched off: no more');
const after = (await one(SHOPPER, 'select public.delete_saved_search($1) as r', [s.id])).r;
ok(after.length === 0, 'and the search can be deleted');

console.log('\n=== Price drops on saved items ===');
await as(db, SHOPPER, 'insert into public.favourites (user_id, listing_id) values ($1, $2)', [SHOPPER, early]);
await as(db, SELLER, 'update public.listings set published = false where id = $1', [early]);
await as(db, SELLER, 'update public.listings set price_pence = 4900 where id = $1', [early]);
ok((await notes(SHOPPER, 'price_drop')).length === 0, 'nothing while the seller is still editing');
await as(db, SELLER, 'update public.listings set published = true where id = $1', [early]);
const d = await notes(SHOPPER, 'price_drop');
ok(d.length === 1 && d[0].title === 'Price drop: Barbour Beadnell wax jacket' && d[0].body === 'Now £49 (was £55).', 'published cheaper: “Now £49 (was £55)”');
await as(db, SELLER, 'update public.listings set published = false where id = $1', [early]);
await as(db, SELLER, 'update public.listings set price_pence = 5200 where id = $1', [early]);
await as(db, SELLER, 'update public.listings set published = true where id = $1', [early]);
ok((await notes(SHOPPER, 'price_drop')).length === 1, 'a price rise says nothing');
ok((await notes(SELLER)).length === 0, 'sellers aren’t alerted about their own items');

console.log('\n=== Email switch ===');
const p = (await one(SHOPPER, 'select public.set_notification_prefs(true, true, true, true, false) as p')).p;
ok(p.alerts === false && p.sales === true, 'alert emails can be switched off on their own');
const prefsOld = (await one(SHOPPER, 'select public.set_notification_prefs(true, true, true, true) as p')).p;
ok(prefsOld.alerts === true, 'the four-switch call still works (alerts on by default)');

console.log(failures ? `\n${failures} FAILED` : '\nall alert checks passed');
process.exit(failures ? 1 : 0);
