// Migration 037: the October security review. Real Postgres (PGlite), through Row Level Security.
// Usage: node security_checks.mjs
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = { MEMBER: '11111111-1111-1111-1111-111111111111', OTHER: '22222222-2222-2222-2222-222222222222', STAFF: '44444444-4444-4444-4444-444444444444' };
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query('insert into public.staff_members (user_id) values ($1)', [U.STAFF]);
const name = (await db.query('select username from public.profiles where id = $1', [U.MEMBER])).rows[0].username;

await as(db, U.STAFF, `select public.staff_moderate(null, $1, 'suspend', 'Selling counterfeit trainers')`, [name]);
const pub = (await as(db, U.OTHER, 'select suspended_at, suspended_reason from public.profiles where id = $1', [U.MEMBER])).rows[0];
ok(pub.suspended_at && pub.suspended_reason === null, 'other members can’t read why someone was suspended');
ok((await as(db, U.MEMBER, 'select public.my_suspension() as s')).rows[0].s.reason === 'Selling counterfeit trainers', 'the member can');
await rejects(as(db, U.OTHER, 'select * from public.member_moderation_notes'), 'the notes table isn’t readable', /permission denied/);
await as(db, U.STAFF, `select public.staff_moderate(null, $1, 'restore_member', 'Cleared after review')`, [name]);
ok((await db.query('select count(*)::int n from public.member_moderation_notes')).rows[0].n === 0, 'restoring removes the note');

const first = (await as(db, null, 'select public.trust_stats() as s')).rows[0].s;
await db.query(`update public.cached_stats set value = value || '{"completed": 999}' where key = 'trust_stats'`);
ok((await as(db, null, 'select public.trust_stats() as s')).rows[0].s.completed === 999, 'the trust tracker is served from a 5-minute cache');
await db.query(`update public.cached_stats set updated_at = now() - interval '6 minutes'`);
ok((await as(db, null, 'select public.trust_stats() as s')).rows[0].s.completed === first.completed, 'and worked out again when it’s older');
await rejects(as(db, null, 'select public.trust_stats_live()'), 'the uncached count isn’t callable', /permission denied/);
await rejects(as(db, U.OTHER, `select public.clean_address('{}')`), 'nor are internal helpers', /permission denied/);
await rejects(as(db, U.OTHER, `select public.is_suspended($1)`, [U.MEMBER]), 'such as is_suspended', /permission denied/);
console.log(failures ? `\n${failures} FAILED` : '\nall security checks passed');
process.exit(failures ? 1 : 0);
