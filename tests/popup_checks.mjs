// Migration 021: popups staff configure. Real Postgres (PGlite), through Row Level Security.
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};
const db = await freshDb();
const MEMBER = '22222222-2222-2222-2222-222222222222';
const STAFF = '44444444-4444-4444-4444-444444444444';
for (const [id, email] of [[MEMBER, 'm@example.com'], [STAFF, 'staff@example.com']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
await db.query('insert into public.staff_members (user_id) values ($1)', [STAFF]);

const live = async (uid) => (await as(db, uid, 'select key from public.site_popups order by priority desc')).rows.map((r) => r.key);
ok(JSON.stringify(await live(null)) === '["how-it-works"]', 'visitors see the live “how it works” popup; the welcome offer starts switched off');
await rejects(as(db, MEMBER, 'select public.staff_popups()'), 'members can’t see the popup settings', /Staff only/);
await rejects(as(db, MEMBER, `update public.site_popups set active = true`), 'or change popups', /permission denied/);
const all = (await as(db, STAFF, 'select public.staff_popups() as p')).rows[0].p;
const offer = all.find((p) => p.key === 'welcome-offer');
await as(db, STAFF, 'select public.staff_save_popup($1, $2::jsonb, false)', [offer.id, JSON.stringify({ active: true, title: 'Join today: 10% off your first order', offer_code: 'welcome10' })]);
ok(JSON.stringify(await live(null)) === '["how-it-works","welcome-offer"]', 'staff switch the welcome offer on');
const after = (await as(db, STAFF, 'select public.staff_popups() as p')).rows[0].p.find((p) => p.key === 'welcome-offer');
ok(after.offer_code === 'WELCOME10' && after.version === 1, 'codes are kept in capitals; the version only moves with “show again”');
await as(db, STAFF, 'select public.staff_save_popup($1, $2::jsonb, true)', [offer.id, '{}']);
ok((await as(db, STAFF, 'select public.staff_popups() as p')).rows[0].p.find((p) => p.key === 'welcome-offer').version === 2, '“show again” bumps the version');
await as(db, STAFF, 'select public.staff_save_popup($1, $2::jsonb, false)', [offer.id, JSON.stringify({ ends_at: '2020-01-01T00:00:00Z' })]);
ok(!(await live(null)).includes('welcome-offer'), 'a popup past its end date stops showing');
await rejects(as(db, STAFF, 'select public.staff_save_popup(null, $1::jsonb, false)', [JSON.stringify({ key: 'bad', title: 'x', cta_href: 'https://evil.example' })]), 'buttons only link within the site', /cta_href|check/);
await as(db, STAFF, 'select public.staff_save_popup(null, $1::jsonb, false)', [JSON.stringify({ key: 'sale-weekend', kind: 'announcement', title: 'Sale weekend', active: true, pages: '*' })]);
ok((await live(MEMBER)).includes('sale-weekend'), 'staff add a new popup and it goes live');
ok((await db.query(`select count(*)::int as n from public.staff_actions where action = 'save_popup'`)).rows[0].n === 4, 'every change is recorded');
console.log(failures ? `\n${failures} FAILED` : '\nall popup checks passed');
process.exit(failures ? 1 : 0);
