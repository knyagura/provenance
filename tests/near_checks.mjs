// Migration 023: sellers' rough location (postcode district) and collection in person.
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};
const db = await freshDb();
const S = '11111111-1111-1111-1111-111111111111';
const O = '22222222-2222-2222-2222-222222222222';
for (const [id, email] of [[S, 'sam@example.com'], [O, 'olly@example.com']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
await as(db, S, `update public.profiles set area = 'SW11', area_lat = 51.46, area_lng = -0.16, collection_ok = true where id = $1`, [S]);
ok((await as(db, null, 'select area, collection_ok from public.profiles where id = $1', [S])).rows[0].area === 'SW11', 'a seller sets their district and offers collection; anyone can see the district');
await rejects(as(db, S, `update public.profiles set area = '10 Downing Street', area_lat = 51.5, area_lng = -0.12 where id = $1`, [S]), 'only a postcode district, never an address', /profiles_area_check/);
await rejects(as(db, S, `update public.profiles set area = 'SW11', area_lat = 40.7, area_lng = -74 where id = $1`, [S]), 'and only in the UK', /profiles_area_check/);
await rejects(as(db, O, `update public.profiles set collection_ok = true where id = $1`, [O]), 'collection needs a district', /profiles_collection_needs_area/);
const miles = Number((await db.query('select public.miles_between(51.46, -0.16, 51.55, -0.06) as m')).rows[0].m);
ok(miles > 6 && miles < 9, `SW11 to E8 is about ${miles} miles`);
console.log(failures ? `\n${failures} FAILED` : '\nall near-me checks passed');
process.exit(failures ? 1 : 0);
