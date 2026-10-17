// Migration 014: the contact form. Anyone can write in; only staff can read.
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

await as(db, null, `select public.submit_contact('Ana', 'Ana@Example.com', 'privacy', 'Please send me a copy of my data.')`);
ok(true, 'someone signed out can send a privacy request');
await as(db, MEMBER, `select public.submit_contact('Mo', 'mo@example.com', 'order', 'Where is my parcel please?')`);
await rejects(as(db, null, `select public.submit_contact('X', 'not-an-email', 'other', 'Hello there friends')`), 'a bad email is refused', /email address/);
await rejects(as(db, null, `select public.submit_contact('X', 'x@example.com', 'sales', 'Hello there friends')`), 'an unknown topic is refused', /what your message/);
await rejects(as(db, null, `select public.submit_contact('X', 'x@example.com', 'other', 'Hi')`), 'a too-short message is refused', /10 to 4,000/);
for (let i = 0; i < 4; i++) await as(db, null, `select public.submit_contact('Ana', 'ana@example.com', 'other', 'Another message here ${i}')`);
await rejects(as(db, null, `select public.submit_contact('Ana', 'ana@example.com', 'other', 'One message too many')`), 'more than five a day from one address is refused', /several messages/);
await rejects(as(db, MEMBER, 'select * from public.contact_messages'), 'members can’t read messages', /permission denied/);
await rejects(as(db, MEMBER, 'select public.staff_contact_messages(true)'), 'members can’t use the staff view', /Staff only/);
const list = (await as(db, STAFF, 'select public.staff_contact_messages(true) as m')).rows[0].m;
ok(list.length === 6 && list.some((m) => m.member === null && m.email === 'ana@example.com') && list.some((m) => m.topic === 'order'), 'staff see open messages, with the email lower-cased');
await as(db, STAFF, 'select public.staff_contact_handled($1)', [list[0].id]);
ok((await as(db, STAFF, 'select public.staff_contact_messages(true) as m')).rows[0].m.length === 5, 'marking one handled takes it off the open list');
console.log(failures ? `\n${failures} FAILED` : '\nall contact checks passed');
process.exit(failures ? 1 : 0);
