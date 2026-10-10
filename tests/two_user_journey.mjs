// Two people, two separate browsers, one shared backend — the scenario the backend exists for.
//
// Runs the real app in Chromium (fake camera), pointed at tests/mock_supabase.mjs (real Postgres +
// the real schema/RLS). A seller and a buyer each sign up through the actual Account screen; the
// seller photographs, lists and publishes; the buyer finds it in their own feed and buys; then the
// custody chain is completed across the two devices (seller handover → hub → buyer unboxing) with
// every step synced through the database. Also checks role guards, tamper detection after a
// round-trip through the database, and that hostile listing text can't run script in another
// user's browser.
//
// Usage: node two_user_journey.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock_supabase.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app');
const APP_PORT = 8766, API_PORT = 54329;

let failures = 0;
const ok = (c, label) => { console.log(`${c ? 'OK' : 'FAIL'}: ${label}`); if (!c) failures++; };

function serveApp() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(APP, path.normalize(p));
      if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/json' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(APP_PORT, () => res(srv));
  });
}

async function newPhone(browser, label, errors) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
  await ctx.addInitScript((api) => { window.PROVENANCE_CONFIG_OVERRIDE = { supabaseUrl: api, supabaseKey: 'mock-publishable-key' }; }, `http://localhost:${API_PORT}`);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`http://localhost:${APP_PORT}/`);
  await page.waitForFunction(() => typeof PV !== 'undefined' && PV.enabled === true);
  return page;
}
const tab = (page, id) => page.click(`.bottom-nav-item[data-tab="${id}"]`);
const mainText = (page) => page.locator('#main').innerText();
async function waitMain(page, re, timeout = 8000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('main').innerText), re.source, { timeout });
}

async function signUp(page, email) {
  await tab(page, 'profile');
  await waitMain(page, /Sign in/);
  await page.click('button.store-tab:has-text("Create account")');
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', 'correct-horse-battery');
  await page.click('form.auth-form button[type=submit]');
  await waitMain(page, /Signed in as/);
}

// Drive one custody leg the way the jsdom e2e does: capture on photo-gated steps, then advance.
async function driveLeg(page, key, builder, nextFn) {
  return page.evaluate(({ key, builder, nextFn }) => {
    const it = ITEMS[state.activeItemId];
    const build = { handover: buildHandoverSteps, hub: buildVerifierHubSteps, unboxing: (i) => buildUnboxingSteps(i) }[builder];
    let n = 0;
    for (let guard = 0; guard < 40; guard++) {
      const c = state[key], steps = build(it).steps;
      if (c.index >= steps.length) break;
      if (steps[c.index].photo && !(c.photoCaptured || {})[c.index]) capturePhoto(c, c.index);
      window[nextFn](); n++;
    }
    return n;
  }, { key, builder, nextFn });
}
const dbOrder = async (mock) => (await mock.db.query('select * from public.orders order by created_at desc limit 1')).rows[0];
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const SHOTS = path.join(here, 'layout-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `journey_${name}.png`), fullPage: true });
async function openFromInbox(page, name) {
  await tab(page, 'inbox');
  await page.click('button:has-text("Refresh")');
  await page.waitForSelector('.order-row');
  if (name) await shot(page, name);
  await page.click('.order-row');
  await settle(page, 400);
}

const mock = await startMock(API_PORT);
const appSrv = await serveApp();
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors = [];
try {
  const seller = await newPhone(browser, 'seller', errors);
  const buyer = await newPhone(browser, 'buyer', errors);

  // ---------- accounts ----------
  await tab(seller, 'profile'); await waitMain(seller, /Sign in/); await shot(seller, 'account-signed-out');
  await signUp(seller, 'sam.seller@example.com');
  ok(true, 'seller created an account through the Account screen and is signed in');
  await signUp(buyer, 'bea.buyer@example.com');
  ok(true, 'buyer created a separate account on a separate device');
  ok((await mock.db.query('select count(*)::int n from public.profiles')).rows[0].n === 2, 'database trigger created a profile for each sign-up');

  // ---------- seller lists with the real camera, then publishes ----------
  await tab(seller, 'sell');
  await seller.evaluate(() => openListingCamera());
  await seller.waitForSelector('.shutter-btn');
  await settle(seller, 1200);
  await seller.click('.shutter-btn');
  await seller.evaluate(() => {
    goToListingDetailsStep();
    setListingField('title', 'Heirloom Chronograph'); setListingField('description', 'Runs perfectly, original strap.');
    setListingField('category', 'designer'); setListingField('price', '1800'); setProtectionPayer('buyer');
    createDraftListing();
  });
  await seller.waitForFunction(() => /Draft saved/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  const L = (await mock.db.query('select * from public.listings')).rows[0];
  ok(L && L.title === 'Heirloom Chronograph' && L.price_pence === 180000 && L.tier === 'ultraLuxury' && L.published === false, 'draft saved to the database with price in pence and tier derived from price (Ultra Luxury)');
  const photo = (L.photos || [])[0] || '';
  ok(/^data:image\/jpeg;base64,/.test(photo) && photo.length < 250000, `real camera photo stored, downscaled to ${Math.round(photo.length / 1024)} KB`);
  ok((await buyer.evaluate(() => Object.values(ITEMS).some((i) => i.title === 'Heirloom Chronograph'))) === false, 'buyer cannot see the draft');

  await seller.click('.btn-mini:has-text("Publish")');
  await seller.waitForFunction(() => /Published/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  ok((await mock.db.query('select published from public.listings where id=$1', [L.id])).rows[0].published === true, 'publish persisted to the database');

  // ---------- buyer finds it on their own device and buys ----------
  await tab(buyer, 'home');
  await buyer.evaluate(() => backendReload());
  await waitMain(buyer, /Heirloom Chronograph/);
  ok(true, "published listing appears in the buyer's feed on a different device");
  await shot(buyer, 'buyer-feed-live');
  ok(await buyer.locator('.card:has-text("Heirloom Chronograph") .live-tag').count() === 1, 'it is tagged Live');
  await buyer.click('.card:has-text("Heirloom Chronograph")');
  await buyer.evaluate(() => { goTo('checkout'); setShippingChoice('free'); goTo('payment'); selectPaymentMethod('visa'); goTo('payment'); confirmPurchase(); });
  await waitMain(buyer, /Live order/);
  let o = await dbOrder(mock);
  ok(o && o.price_pence === 180000 && o.status === 'purchased', 'order written to the database at the listed price');
  ok((await mock.db.query('select status from public.listings where id=$1', [L.id])).rows[0].status === 'sold', 'listing marked sold server-side');
  ok(o.timeline_state && o.timeline_state.proofSeal && /^PS-/.test(o.timeline_state.proofSeal.code), 'custody state (incl. single-use ProofSeal code) stored with the order');

  await shot(buyer, 'buyer-after-purchase');
  // ---------- seller: handover on their phone ----------
  await openFromInbox(seller, 'seller-inbox-your-turn');
  ok(/Verified Handover|handover/i.test(await mainText(seller)), 'seller opens the order from Inbox and lands on the handover');
  ok(await seller.evaluate(() => state.proofSeal.code) === o.timeline_state.proofSeal.code, "seller's device has the same ProofSeal code the buyer's device generated");
  await driveLeg(seller, 'handover', 'handover', 'handoverNext');
  await settle(seller);
  o = await dbOrder(mock);
  ok(o.status === 'hub' && o.timeline_state.timeline.handedOver === true, 'handover synced; order moved to the Verifier Hub stage');

  // ---------- role guard ----------
  await openFromInbox(buyer);
  await buyer.evaluate(() => goTo('handover'));
  ok(/This step is for the seller/.test(await mainText(buyer)), "buyer cannot perform the seller's handover");

  // ---------- hub (either party in this test build), then buyer unboxing ----------
  await openFromInbox(buyer);
  ok(await buyer.evaluate(() => PV.currentScreen) === 'verifierhub', 'order routes to the Verifier Hub step');
  await driveLeg(buyer, 'verifierHub', 'hub', 'verifierHubNext');
  await settle(buyer);
  o = await dbOrder(mock);
  ok(o.status === 'unboxing' && o.timeline_state.timeline.secondHubAuthenticated === true, 'both independent authenticators recorded (≥ £1,500 rule)');
  await seller.evaluate(() => goTo('unboxing'));
  ok(/This step is for the buyer/.test(await mainText(seller)), "seller cannot perform the buyer's unboxing");

  await openFromInbox(buyer);
  ok(await buyer.evaluate(() => PV.currentScreen) === 'unboxing', 'buyer lands on Protected Unboxing');
  await driveLeg(buyer, 'unboxing', 'unboxing', 'unboxingNext');
  await settle(buyer);
  o = await dbOrder(mock);
  ok(o.status === 'confirmed', 'order confirmed in the database');

  // ---------- seller sees the confirmed order, evidence intact after the round trip ----------
  await openFromInbox(seller);
  ok(/Confirmed/.test(await mainText(seller)) || await seller.evaluate(() => state.timeline.confirmed), 'seller sees the order confirmed on their device');
  ok(await seller.evaluate(() => evidenceIntegrityOk(activeItem())) === true, 'full evidence chain re-verifies on the other device after syncing through the database');
  ok(!/Evidence chain broken/.test(await mainText(seller)), 'timeline shows no broken-evidence warning');

  // ---------- tampering with the stored evidence is still detected ----------
  await mock.db.query(`update public.orders set timeline_state = jsonb_set(timeline_state, '{handover,log,0,text}', '"Packed (edited later)"') where id = $1`, [o.id]);
  await seller.evaluate(() => backendReload());
  await openFromInbox(seller);
  ok(await seller.evaluate(() => evidenceIntegrityOk(activeItem())) === false, 'an edit to stored evidence breaks the hash chain on reload');
  ok(/Evidence chain broken/.test(await mainText(seller)), 'and the timeline flags it');

  // ---------- hostile listing text must not run in someone else's browser ----------
  await seller.evaluate(async () => {
    const r = await PV.client.from('listings').insert({
      seller_id: myUid(), title: '<img src=x onerror="window.__pwned=1">Nice bag', description: "ok');window.__pwned=2;('",
      brand: '"><script>window.__pwned=3</script>', price_pence: 2500, published: true, photos: ['javascript:alert(1)', '#fff" onmouseover="window.__pwned=4'],
    });
    if (r.error) throw new Error(r.error.message);
  });
  await buyer.evaluate(() => backendReload());
  await tab(buyer, 'home');
  await waitMain(buyer, /Nice bag/);
  await buyer.click('.card:has-text("Nice bag")');
  await buyer.evaluate(() => { goTo('item'); goTo('checkout'); goTo('passport'); });
  await buyer.evaluate(() => goTo('item'));
  const shareBtn = buyer.locator('button:has-text("Share this listing")');
  if (await shareBtn.count()) await shareBtn.click().catch(() => {});
  await settle(buyer, 300);
  ok(await buyer.evaluate(() => window.__pwned) === undefined, 'hostile title/description/brand/photo values did not execute script');
  ok(await buyer.evaluate(() => document.querySelectorAll('#main img[onerror], #main [onmouseover], #main script').length) === 0, 'no injected markup reached the page');

  // ---------- data stays private ----------
  const third = await newPhone(browser, 'stranger', errors);
  await signUp(third, 'olly.other@example.com');
  ok(await third.evaluate(async () => (await PV.client.from('orders').select('*')).data.length) === 0, 'an unrelated account sees none of the orders');

  ok(errors.length === 0, `no uncaught page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e); failures++;
} finally {
  await browser.close(); appSrv.close(); await mock.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nTWO-USER JOURNEY PASSED');
process.exit(failures ? 1 : 0);
