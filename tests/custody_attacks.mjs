// Custody chain, server side (migration 011): full journeys for every tier, then the prototype's attack
// tests (attacktest.js) re-aimed at the real trust boundary, plus new ones. Runs on PGlite (real Postgres)
// as real users through Row Level Security, the same way a browser's session is limited.
//
// Usage: node custody_attacks.mjs
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { as, freshDb } from './sql_rls_check.mjs';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`); if (!cond) failures++; };
const rejects = async (p, label, match) => {
  try { await p; ok(false, label + ' (was allowed)'); }
  catch (e) { ok(!match || match.test(e.message), `${label} — refused: ${e.message}`); }
};

const db = await freshDb();
const U = {
  SELLER: '11111111-1111-1111-1111-111111111111',
  BUYER: '22222222-2222-2222-2222-222222222222',
  COURIER: '33333333-3333-3333-3333-333333333333',
  HUB: '44444444-4444-4444-4444-444444444444',
  HUB2: '55555555-5555-5555-5555-555555555555',
  OUTSIDER: '66666666-6666-6666-6666-666666666666',
};
for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name.toLowerCase()}@example.com`]);
await db.query(`insert into public.custody_agents (user_id, role, organisation) values ($1, 'courier', 'Test Couriers'), ($2, 'hub', 'Meridian'), ($3, 'hub', 'Northgate')`, [U.COURIER, U.HUB, U.HUB2]);
await rejects(as(db, U.OUTSIDER, `insert into public.custody_agents (user_id, role, organisation) values ($1, 'hub', 'Me')`, [U.OUTSIDER]), 'members cannot make themselves a courier or hub', /permission denied/);

const svc = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const shop = async (title, price, seller = U.SELLER) =>
  (await as(db, seller, `insert into public.listings (seller_id, title, price_pence, shipping_pence, published) values ($1, $2, $3, 399, true) returning id`, [seller, title, price])).rows[0].id;
async function paidOrder(title, price, buyer = U.BUYER, seller = U.SELLER) {
  const listing = await shop(title, price, seller);
  const c = (await as(db, buyer, 'select public.start_checkout($1) as c', [listing])).rows[0].c;
  await svc(`select public.confirm_payment($1, $2, $3)`, [c.order_id, 'pi_' + title, c.quote.buyer_total_pence]);
  return c.order_id;
}
const view = async (uid, order) => (await as(db, uid, 'select public.order_custody($1) as v', [order])).rows[0].v;
const record = async (uid, order, step, evidence) => (await as(db, uid, 'select public.record_custody_step($1, $2, $3::jsonb) as v', [order, step, JSON.stringify(evidence)])).rows[0].v;
async function upload(uid, order, ext = 'jpg') {
  const name = `${order}/${randomUUID()}.${ext}`;
  await as(db, uid, `insert into storage.objects (bucket_id, name, owner) values ('custody-media', $1, $2)`, [name, uid]);
  return name;
}
const sealOnParcel = async (order, kind) => (await db.query('select code from public.custody_seals where order_id = $1 and kind = $2', [order, kind])).rows[0]?.code;
const SHA = 'a'.repeat(64);

/** Builds honest evidence for the current step and records it as uid. */
async function act(uid, order, overrides = {}) {
  const v = await view(uid, order);
  const step = v.current;
  const e = {};
  for (const need of step.needs) {
    if (need === 'photo') Object.assign(e, { media: await upload(uid, order, 'jpg'), media_sha256: SHA });
    if (need === 'video') Object.assign(e, { media: await upload(uid, order, 'mp4'), media_sha256: SHA });
    if (need === 'code') e.code = (await as(db, uid, 'select public.issue_challenge($1) as c', [order])).rows[0].c.code;
    if (need === 'seal') e.seal = step.sealMode === 'apply' ? (await as(db, uid, 'select public.issue_seal($1) as s', [order])).rows[0].s.code : await sealOnParcel(order, step.seal);
    if (need === 'grams') e.grams = 800;
    if (need === 'tracking') Object.assign(e, { carrier: 'Royal Mail', tracking: 'RM123456789GB' });
    if (need === 'attest') e.attest = true;
    if (need === 'result') e.result = 'pass';
  }
  return record(uid, order, step.key, { ...e, ...overrides });
}
const WHO = { seller: U.SELLER, buyer: U.BUYER, courier: U.COURIER, hub: U.HUB, hub2: U.HUB2 };
async function runToEnd(order) {
  let v = await view(U.BUYER, order);
  while (v.state === 'in_progress') v = await act(WHO[v.current.actor], order);
  return v;
}

// ================= Same rules as the website =================
const fixture = JSON.parse(readFileSync(new URL('../backend/fixtures/custody_plans.json', import.meta.url), 'utf8'));
for (const tier of ['enhanced', 'verified', 'luxury', 'ultraLuxury']) {
  const plan = (await db.query('select public.custody_plan($1) as p', [tier])).rows[0].p;
  ok(isDeepStrictEqual(plan, fixture[tier]), `${tier}: the database's steps match the shared fixture (and so the website's)`);
}
const hx = fixture.hash_example;
const sqlHash = (await db.query('select public.custody_hash($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz) as h',
  [hx.prev, hx.order_id, hx.seq, hx.step, hx.actor_role, hx.actor_id, JSON.stringify(hx.evidence), hx.at])).rows[0].h;
ok(sqlHash === hx.hash, 'the database hashes a record exactly as the website does (fixture hash)');

// ================= Journeys =================
console.log('=== Journeys: every tier, start to finish, only through the server ===');
const plans = { enhanced: 3, verified: 12, luxury: 20, ultraLuxury: 21 };
for (const [tier, price] of [['enhanced', 4000], ['verified', 15000], ['luxury', 80000], ['ultraLuxury', 200000]]) {
  const order = await paidOrder(`${tier} journey`, price);
  const start = await view(U.SELLER, order);
  ok(start.tier === tier && start.state === 'in_progress' && start.current.actor === 'seller' && start.payout_status === 'held', `${tier}: paying starts custody with the seller’s first step, payment held`);
  const end = await runToEnd(order);
  const row = (await db.query('select custody_state, payout_status, confirmed_at from public.orders where id = $1', [order])).rows[0];
  ok(end.state === 'confirmed' && end.events.length === plans[tier] && end.chain_ok && row.payout_status === 'due' && row.confirmed_at,
    `${tier}: all ${plans[tier]} steps recorded, hash chain verified, payment released to the seller`);
}

// ================= Attacks =================
console.log('\n=== ATTACK 1 (from attacktest.js): skip every step and claim "Confirmed" ===');
const o1 = await paidOrder('skip-steps', 15000);
await rejects(record(U.BUYER, o1, 'confirm', {}), 'the buyer cannot confirm before the seller has handed over', /isn’t next|for the seller/);
await rejects(record(U.SELLER, o1, 'handover_seal', { seal: 'PS-0000-0000' }), 'the seller cannot jump ahead to sealing', /isn’t next/);
await as(db, U.BUYER, `update public.orders set custody_state = 'confirmed', payout_status = 'due', custody_step = 11, status = 'confirmed' where id = $1`, [o1]);
await as(db, U.SELLER, `update public.orders set custody_state = 'confirmed', payout_status = 'due' where id = $1`, [o1]);
const r1 = (await db.query('select custody_state, payout_status, custody_step from public.orders where id = $1', [o1])).rows[0];
ok(r1.custody_state === 'in_progress' && r1.payout_status === 'held' && r1.custody_step === 0, 'writing "confirmed" straight into the order changes nothing, for buyer or seller');
await rejects(as(db, U.SELLER, `insert into public.custody_events (order_id, seq, step, actor_role, actor_id, evidence, at, prev_hash, hash) values ($1, 1, 'handover_code', 'seller', $2, '{}', now(), '0', 'x')`, [o1, U.SELLER]), 'nobody can write custody records directly', /permission denied/);
await rejects(as(db, U.SELLER, 'select * from public.custody_events'), 'nobody can read raw custody records (they go through order_custody, which hides codes)', /permission denied/);

console.log('\n=== ATTACK 2 (from attacktest.js): fake the ProofSeal / Item Seal pairing ===');
const o2 = await paidOrder('seal-pairing', 80000);
await act(U.SELLER, o2); // video + code
await act(U.SELLER, o2); // item photo
await rejects(record(U.SELLER, o2, 'handover_item_seal', { seal: 'IS-7K2M-9QXD' }), 'the seller cannot fit a seal code they made up; only the one the server issued', /isn’t the seal code issued/);
await rejects(as(db, U.BUYER, 'select public.issue_seal($1)', [o2]), 'the buyer cannot get the seal codes issued to the seller', /for the seller/);
await rejects(as(db, U.SELLER, 'select * from public.custody_seals'), 'nobody can read the seal register directly', /permission denied/);
while ((await view(U.SELLER, o2)).current.actor !== 'hub') await act(WHO[(await view(U.SELLER, o2)).current.actor], o2);
const hubView = await view(U.HUB, o2);
const shownToHub = hubView.events.filter((e) => e.evidence.seal).map((e) => e.evidence.seal);
ok(shownToHub.length === 2 && shownToHub.every((s) => s === 'hidden until you check it'), 'the hub, who must check both seals, is never shown their codes');
ok((await view(U.SELLER, o2)).events.some((e) => /^PS-/.test(e.evidence.seal ?? '')), 'the seller who fitted the seals still sees their codes');
const swapped = (await sealOnParcel(o2, 'proof')).replace(/.$/, (c) => (c === '0' ? '1' : '0'));
const after = await record(U.HUB, o2, 'hub_seal', { seal: swapped });
const r2 = (await db.query('select custody_state, dispute_reason, payout_status from public.orders where id = $1', [o2])).rows[0];
ok(after.state === 'disputed' && r2.dispute_reason === 'seal_mismatch' && r2.payout_status === 'held' && after.events.at(-1).evidence.match === false,
  'a ProofSeal with a different code is recorded as a mismatch and the order goes on hold, payment held');
await rejects(record(U.HUB, o2, 'hub_item_seal', { seal: await sealOnParcel(o2, 'item') }), 'nothing else can happen on an order on hold', /on hold/);

console.log('\n=== ATTACK 3 (from attacktest.js): the live challenge code must be a real, server-checked step ===');
const o3 = await paidOrder('challenge', 15000);
const media3 = await upload(U.SELLER, o3, 'mp4');
await rejects(record(U.SELLER, o3, 'handover_code', { code: '123456', media: media3, media_sha256: SHA }), 'a code the server never issued is refused', /expired or doesn’t match/);
const c3a = (await as(db, U.SELLER, 'select public.issue_challenge($1) as c', [o3])).rows[0].c.code;
const c3b = (await as(db, U.SELLER, 'select public.issue_challenge($1) as c', [o3])).rows[0].c.code;
if (c3a !== c3b) await rejects(record(U.SELLER, o3, 'handover_code', { code: c3a, media: media3, media_sha256: SHA }), 'starting again replaces the old code', /expired or doesn’t match/);
await db.query(`update public.custody_challenges set expires_at = now() - interval '1 second' where order_id = $1`, [o3]);
await rejects(record(U.SELLER, o3, 'handover_code', { code: c3b, media: media3, media_sha256: SHA }), 'an expired code is refused (footage made before or after can’t borrow it)', /expired or doesn’t match/);
await rejects(as(db, U.BUYER, 'select public.issue_challenge($1)', [o3]), 'only the person whose turn it is can get a code', /for the seller/);
const c3c = (await as(db, U.SELLER, 'select public.issue_challenge($1) as c', [o3])).rows[0].c.code;
await record(U.SELLER, o3, 'handover_code', { code: c3c, media: media3, media_sha256: SHA });
ok((await db.query('select used_at from public.custody_challenges where order_id = $1', [o3])).rows[0].used_at !== null, 'a code works once');
for (const tier of ['verified', 'luxury']) {
  const plan = (await db.query('select public.custody_plan($1) as p', [tier])).rows[0].p;
  ok(plan.filter((s) => s.needs.includes('code')).length === (tier === 'verified' ? 2 : 3), `${tier}: a challenge-code step in every recorded leg (handover${tier === 'luxury' ? ', hub' : ''}, unboxing)`);
}

console.log('\n=== ATTACK 4 (from attacktest.js): the courier witness must be independent of the buyer ===');
const o4 = await paidOrder('courier-is-buyer', 15000, U.COURIER);
while ((await view(U.SELLER, o4)).current.actor === 'seller') await act(U.SELLER, o4);
ok(!(await view(U.COURIER, o4)).my_roles.includes('courier'), 'a courier who bought the item is not a courier on their own order');
await rejects(act(U.COURIER, o4), 'so they cannot witness their own parcel', /for the courier/);
await rejects(act(U.SELLER, o4), 'nor can the seller sign the courier’s step', /for the courier/);
const o4b = await paidOrder('hub-second-opinion', 200000);
while ((await view(U.SELLER, o4b)).current.key !== 'hub_second_opinion') await act(WHO[(await view(U.SELLER, o4b)).current.actor], o4b);
await rejects(act(U.HUB, o4b), 'the second opinion over £1,500 cannot come from the first authenticator', /different authenticator/);
await act(U.HUB2, o4b);
ok((await view(U.HUB2, o4b)).current.key === 'hub_reseal', 'a different authenticator can give it');

console.log('\n=== ATTACK 5 (from attacktest.js): edit an evidence record after the fact ===');
const o5 = await paidOrder('tamper', 4000);
await act(U.SELLER, o5);
await act(U.SELLER, o5);
await rejects(db.query(`update public.custody_events set evidence = evidence || '{"tracking":"FORGED123"}' where order_id = $1`, [o5]), 'even the database owner cannot edit a record', /never be changed/);
await rejects(db.query('delete from public.custody_events where order_id = $1', [o5]), 'or delete one', /never be changed/);
await rejects(db.query('truncate public.custody_events'), 'or empty the table', /never be changed/);
ok((await view(U.BUYER, o5)).chain_ok, 'the untouched chain verifies');
// Someone with full control of the database switches the guard off and rewrites history:
await db.exec('alter table public.custody_events disable trigger custody_events_no_change');
await db.query(`update public.custody_events set evidence = jsonb_set(evidence, '{tracking}', '"FORGED123"') where order_id = $1 and step = 'ship'`, [o5]);
await db.exec('alter table public.custody_events enable trigger custody_events_no_change');
ok((await view(U.BUYER, o5)).chain_ok === false, 'a record rewritten behind the guard’s back breaks the hash chain, and the order shows it');

console.log('\n=== New: evidence files ===');
const o6 = await paidOrder('media', 15000);
const other = await paidOrder('media-other', 15000);
const foreign = await upload(U.SELLER, other, 'mp4');
const c6 = (await as(db, U.SELLER, 'select public.issue_challenge($1) as c', [o6])).rows[0].c.code;
await rejects(record(U.SELLER, o6, 'handover_code', { code: c6, media: foreign, media_sha256: SHA }), 'a video from another order is refused', /Add the video/);
await rejects(record(U.SELLER, o6, 'handover_code', { code: c6, media: `${o6}/${randomUUID()}.mp4`, media_sha256: SHA }), 'a video that was never uploaded is refused', /hasn’t finished uploading/);
await rejects(as(db, U.BUYER, `insert into storage.objects (bucket_id, name, owner) values ('custody-media', $1, $2)`, [`${o6}/${randomUUID()}.mp4`, U.BUYER]), 'the buyer cannot upload evidence while it is the seller’s turn', /row-level security/);
await rejects(as(db, U.OUTSIDER, `insert into storage.objects (bucket_id, name, owner) values ('custody-media', $1, $2)`, [`${o6}/${randomUUID()}.mp4`, U.OUTSIDER]), 'strangers cannot upload into an order', /row-level security/);
await rejects(as(db, U.SELLER, `insert into storage.objects (bucket_id, name, owner) values ('custody-media', $1, $2)`, [`${o6}/../x.mp4`, U.SELLER]), 'odd file names are refused', /row-level security/);
const good6 = await upload(U.SELLER, o6, 'mp4');
await rejects(record(U.SELLER, o6, 'handover_code', { code: c6, media: good6.replace(/\.mp4$/, '.jpg'), media_sha256: SHA }), 'a photo cannot stand in for the video', /Add the video/);
await record(U.SELLER, o6, 'handover_code', { code: c6, media: good6, media_sha256: SHA });
await rejects(record(U.SELLER, o6, 'handover_item', { media: good6, media_sha256: SHA }), 'the same file cannot be used for two steps', /Add the photo|already part/);
ok((await as(db, U.BUYER, `select name from storage.objects where bucket_id = 'custody-media' and name = $1`, [good6])).rows.length === 1, 'the buyer can view the seller’s evidence');
ok((await as(db, U.OUTSIDER, `select name from storage.objects where bucket_id = 'custody-media' and name = $1`, [good6])).rows.length === 0, 'strangers cannot');
await as(db, U.SELLER, `delete from storage.objects where name = $1`, [good6]);
await as(db, U.SELLER, `update storage.objects set name = $2 where name = $1`, [good6, `${o6}/${randomUUID()}.mp4`]);
ok((await db.query('select count(*)::int as n from storage.objects where name = $1', [good6])).rows[0].n === 1, 'evidence files cannot be deleted or replaced, even by the person who took them');

console.log('\n=== New: weight, disputes, waiting, strangers ===');
const o7 = await paidOrder('weight', 15000);
while ((await view(U.SELLER, o7)).current.key !== 'courier_delivery') await act(WHO[(await view(U.SELLER, o7)).current.actor], o7);
const v7 = await act(U.COURIER, o7, { grams: 300 });
ok(v7.weight_flag === true && v7.events.at(-1).evidence.weight_flag === true && v7.events.at(-1).evidence.packed_grams === 800, 'a parcel 500 g lighter at the door than at packing is flagged automatically');
const v7b = await act(U.BUYER, o7);
ok(v7b.state === 'in_progress', 'the flag informs; it doesn’t stop the buyer opening it');

const o8 = await paidOrder('dispute', 15000);
await rejects(as(db, U.SELLER, `select public.open_dispute($1, 'other', 'x')`, [o8]), 'the seller cannot open a buyer dispute', /not found/);
await rejects(as(db, U.BUYER, `select public.open_dispute($1, 'because', null)`, [o8]), 'a dispute needs a known reason', /Choose what went wrong/);
const v8 = (await as(db, U.BUYER, `select public.open_dispute($1, 'not_arrived', 'Nothing after two weeks') as v`, [o8])).rows[0].v;
ok(v8.state === 'disputed' && v8.events.at(-1).step === 'dispute' && v8.chain_ok && v8.payout_status === 'held', 'the buyer can report a problem; it joins the chain and the payment stays held');
await rejects(record(U.SELLER, o8, 'handover_code', {}), 'and the order waits for a person to look', /on hold/);

const o9 = await paidOrder('hub-fail', 80000);
while ((await view(U.SELLER, o9)).current.key !== 'hub_authenticate') await act(WHO[(await view(U.SELLER, o9)).current.actor], o9);
const v9 = await act(U.HUB, o9, { result: 'fail', note: 'Stitching does not match reference' });
ok(v9.state === 'disputed' && (await db.query('select dispute_reason from public.orders where id = $1', [o9])).rows[0].dispute_reason === 'failed_authentication', 'an item that fails authentication goes on hold for a refund');

const o10 = await paidOrder('auto-confirm', 4000);
await act(U.SELLER, o10);
await act(U.SELLER, o10);
ok((await svc('select public.auto_confirm_custody() as n')).rows[0].n === 0, 'nothing confirms itself early');
await db.query(`update public.orders set custody_updated_at = now() - interval '8 days' where id = $1`, [o10]);
ok((await svc('select public.auto_confirm_custody() as n')).rows[0].n === 1, 'after the protection window, a silent buyer’s order confirms itself');
const v10 = await view(U.SELLER, o10);
ok(v10.state === 'confirmed' && v10.events.at(-1).actor_role === 'system' && v10.events.at(-1).evidence.auto === true && v10.chain_ok && v10.payout_status === 'due', 'recorded as an automatic confirmation in the chain, and the payment is released');
await rejects(as(db, U.BUYER, 'select public.auto_confirm_custody()'), 'members cannot run the automatic confirmation', /permission denied/);

const unpaid = (await as(db, U.BUYER, 'select public.start_checkout($1) as c', [await shop('unpaid', 15000)])).rows[0].c.order_id;
await rejects(as(db, U.SELLER, 'select public.issue_challenge($1)', [unpaid]), 'nothing happens on an unpaid order', /not found/);
ok((await view(U.OUTSIDER, o7)) === null, 'strangers see nothing of an order’s custody');
const o11 = await paidOrder('courier-sight', 15000);
ok((await view(U.COURIER, o11)) === null, 'a courier sees an order only when it is their turn…');
while ((await view(U.SELLER, o11)).current.actor === 'seller') await act(U.SELLER, o11);
ok((await view(U.COURIER, o11))?.current.key === 'courier_pickup', '…like now');
const q = (await as(db, U.COURIER, 'select public.agent_queue() as q')).rows[0].q;
ok(q.some((x) => x.order_id === o11 && x.step === 'courier_pickup') && !q.some((x) => x.order_id === o4), 'their queue lists it (and not the order they bought)');
ok((await as(db, U.BUYER, 'select public.agent_queue() as q')).rows[0].q.length === 0, 'members who aren’t agents have no queue');

console.log(failures ? `\n${failures} CUSTODY CHECK(S) FAILED` : '\nALL CUSTODY CHECKS PASSED');
process.exit(failures ? 1 : 0);
