// Real-browser layout check for the new site: every page at four widths, light and dark.
// Fails on sideways scrolling, a missing or misplaced bottom bar, unreadable sizes or console errors.
// Usage: npm run build && npm run test:e2e   (starts `next start` itself). Screenshots go to test-results/.
// Runs with PV_DATA_SOURCE=examples: no database needed, the example catalogue stands in.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;
const pages = [
  '/', '/styleguide', '/search', '/search?q=barb%20jack', '/search?category=men&sort=price_asc&min=10',
  '/search?min=abc&condition=Mint', '/search?q=zzzz', '/item/example-1', '/item/example-6', '/developers',
  '/sell', '/inbox', '/profile', '/signin', '/reset', '/passkey', '/member/resole_archive', '/checkout/example-6',
];
const shots = { '/item/example-6': 'item-lux', '/checkout/example-6': 'checkout', '/member/resole_archive': 'member', '/': 'home', '/styleguide': 'styleguide', '/search': 'search', '/item/example-1': 'item', '/developers': 'developers' };
const widths = [360, 768, 1024, 1440];
const schemes = ['light', 'dark'];

// A server left running from an earlier run would serve an old build; refuse rather than test the wrong thing.
try { await fetch(BASE); console.error(`Port ${PORT} is already in use; stop the old server first.`); process.exit(2); } catch {}
const server = spawn('npx', ['next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], { stdio: 'pipe', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', PV_DATA_SOURCE: 'examples' } });
const stop = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('next start did not come up');
}

const failures = [];
const fail = (msg) => { failures.push(msg); console.log('  FAIL ' + msg); };

await waitForServer();
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch();
try {
  for (const scheme of schemes) {
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      for (const path of pages) {
        const where = `${path} @${width}px ${scheme}`;
        const res = await page.goto(BASE + path, { waitUntil: 'load' });
        // Prefetches cancelled by the previous navigation can keep "networkidle" from ever firing, so cap the wait.
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        if (!res || res.status() !== 200) fail(`${where}: status ${res?.status()}`);
        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          const nav = document.querySelector('nav.pv-nav:not(.pv-nav--static)');
          const navBox = nav?.getBoundingClientRect();
          const tiny = [...document.querySelectorAll('body *')].filter((el) => {
            if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            return fs < 11 && el.getBoundingClientRect().width > 0;
          }).map((el) => el.textContent.trim().slice(0, 30));
          const smallTargets = [...document.querySelectorAll('button, .pv-nav__item, .pv-btn, .pv-card__fav')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.height < 44 || r.width < 44);
          }).map((el) => el.textContent.trim().slice(0, 30) || el.getAttribute('aria-label'));
          return {
            overflow: doc.scrollWidth - doc.clientWidth,
            navVisible: !!nav && getComputedStyle(nav).display !== 'none',
            navAtBottom: navBox ? Math.round(innerHeight - navBox.bottom) : null,
            bg: getComputedStyle(document.body).backgroundColor,
            tiny, smallTargets,
          };
        });
        if (m.overflow > 0) fail(`${where}: page scrolls sideways by ${m.overflow}px`);
        if (width < 1024 && !m.navVisible) fail(`${where}: bottom bar missing on a phone/tablet width`);
        if (width < 1024 && m.navAtBottom !== 0) fail(`${where}: bottom bar not at the bottom (${m.navAtBottom}px gap)`);
        if (width >= 1024 && m.navVisible) fail(`${where}: bottom bar should be hidden on desktop`);
        const expectBg = scheme === 'dark' ? 'rgb(35, 33, 29)' : 'rgb(243, 238, 231)';
        if (m.bg !== expectBg) fail(`${where}: page background ${m.bg}, expected ${expectBg}`);
        if (m.tiny.length) fail(`${where}: text under 11px: ${m.tiny.slice(0, 3).join(' | ')}`);
        if (m.smallTargets.length) fail(`${where}: tap targets under 44px: ${m.smallTargets.slice(0, 3).join(' | ')}`);
        if (shots[path]) {
          await page.screenshot({ path: `test-results/${shots[path]}-${width}-${scheme}.png`, fullPage: true });
        }
      }
      if (errors.length) fail(`@${width}px ${scheme}: console errors: ${errors.slice(0, 3).join(' | ')}`);
      await ctx.close();
    }
  }
  // Favourite button toggles and announces its state.
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  const fav = page.getByRole('button', { name: 'Add Barbour Beaufort wax jacket to favourites' });
  await fav.click();
  if ((await page.getByRole('button', { name: 'Remove Barbour Beaufort wax jacket from favourites' }).getAttribute('aria-pressed')) !== 'true') fail('favourite button did not toggle');

  // Browsing journey: search from the top bar, filter, open an item.
  await page.goto(BASE + '/');
  await page.getByRole('searchbox', { name: 'Search for items' }).fill('barb');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/search\?q=barb/);
  if ((await page.getByRole('searchbox', { name: 'Search for items' }).inputValue()) !== 'barb') fail('search box lost the search text');
  const results = await page.getByRole('list', { name: /barb/ }).getByRole('listitem').count();
  if (results !== 1) fail(`search "barb" found ${results} items, expected 1`);
  await page.getByRole('link', { name: /Barbour Beaufort wax jacket/ }).click();
  await page.waitForURL(/\/item\/example-1$/);
  if (!(await page.getByRole('heading', { level: 1, name: 'Barbour Beaufort wax jacket' }).isVisible())) fail('item page heading missing');
  if (!(await page.getByText('Example listing').isVisible())) fail('example item not labelled');
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  if (!og || !og.includes('/item/example-1/opengraph-image')) fail(`item link preview image missing (${og})`);
  else {
    const img = await fetch(BASE + new URL(og).pathname + new URL(og).search);
    if (img.status !== 200 || !img.headers.get('content-type')?.includes('image/png')) fail(`link preview image: ${img.status} ${img.headers.get('content-type')}`);
  }
  // Category chip and filters.
  await page.goto(BASE + '/search');
  await page.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: 'Sport' }).click();
  await page.waitForURL(/category=sport/);
  await page.getByRole('heading', { level: 1, name: 'Sport' }).waitFor();
  if ((await page.getByRole('link', { name: 'Sport' }).getAttribute('aria-current')) !== 'page') fail('current category not marked');
  await page.getByText('Filter and sort').click();
  await page.getByLabel('Highest price in pounds').fill('20');
  await page.getByRole('button', { name: 'Show results' }).click();
  await page.waitForURL(/max=20/);
  await page.getByRole('heading', { level: 1, name: 'Sport' }).waitFor();
  const sport = await page.getByRole('list', { name: 'Sport', exact: true }).getByRole('listitem').count();
  if (sport !== 1) fail(`Sport under £20 found ${sport} items, expected 1 (${page.url()})`);
  // Unknown item is a real 404.
  const missing = await page.goto(BASE + '/item/not-a-real-item');
  if (missing?.status() !== 404) fail(`unknown item returned ${missing?.status()}, expected 404`);
  await ctx.close();

  // Selling journey (example mode: a pretend account that lives in this browser tab).
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAU0lEQVR4nO3PQQ3AIADAQMA3TlCGmongcVnSU9DOe/b4s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaB9d7oCU2vyq0kAAAAASUVORK5CYII=', 'base64'); // 64×48 terracotta PNG
  const photo = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
  for (const width of [360, 1280]) {
    const sctx = await browser.newContext({ viewport: { width, height: 900 } });
    const sp = await sctx.newPage();
    const serr = [];
    sp.on('pageerror', (e) => serr.push(e.message));
    await sp.goto(BASE + '/sell');
    await sp.getByRole('link', { name: 'Sign in to sell' }).click();
    await sp.waitForURL(/\/signin\?next=%2Fsell|\/signin\?next=\/sell/);
    await sp.getByLabel('Email').fill('sian@example.com');
    await sp.getByLabel('Password').fill('short');
    await sp.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (!(await sp.locator('p.pv-errors').textContent())?.includes('8 characters')) fail(`sell @${width}: short password not explained`);
    await sp.getByLabel('Password').fill('a-long-password');
    await sp.getByRole('button', { name: 'Sign in', exact: true }).click();
    await sp.waitForURL(/\/sell$/);
    await sp.getByRole('button', { name: /Women/ }).click();
    await sp.waitForURL(/\/sell\/example-draft-/);
    await sp.getByRole('heading', { name: 'New listing' }).waitFor();
    const publish = sp.getByRole('button', { name: 'Publish listing' });
    if (!(await publish.isDisabled())) fail(`sell @${width}: Publish should be disabled on an empty draft`);
    const needed = await sp.getByRole('list', { name: 'Still needed' }).getByRole('listitem').allTextContents();
    if (needed.join('|') !== 'Photo: Front|Photo: Back|Photo: Size and care label|A title|The condition|A price of at least £1|A parcel size') fail(`sell @${width}: still-needed list was ${needed.join('|')}`);
    await sp.getByLabel('Add Front photo').setInputFiles(photo('front.png'));
    await sp.getByRole('img', { name: 'Front photo' }).waitFor();
    await sp.getByLabel('Add Back photo').setInputFiles(photo('back.png'));
    await sp.getByRole('img', { name: 'Back photo' }).waitFor();
    await sp.getByRole('button', { name: 'No label?' }).click();
    await sp.getByLabel('Title').fill('Wool coat');
    await sp.getByLabel('Condition').selectOption('Good');
    await sp.getByLabel('Price (£)').fill('45');
    await sp.getByLabel('Price (£)').blur();
    if ((await sp.getByLabel('Price (£)').inputValue()) !== '45.00') fail(`sell @${width}: price not tidied to 45.00`);
    await sp.getByText('Large ·').click();
    await sp.getByText('All changes saved').waitFor();
    if (await sp.getByRole('list', { name: 'Still needed' }).count()) fail(`sell @${width}: still-needed list should be gone when complete`);
    await publish.click();
    await sp.getByRole('heading', { name: 'Wool coat is live' }).waitFor();
    // Edit the live listing: it goes off sale, then back on as version 2.
    await sp.getByRole('button', { name: 'Edit listing' }).click();
    await sp.getByText('Off sale while you edit.').waitFor();
    if (await sp.getByRole('button', { name: 'Delete this draft' }).count()) fail(`edit @${width}: a listing that has been live must not offer delete`);
    await sp.getByLabel('Price (£)').fill('40');
    await sp.getByLabel('Price (£)').blur();
    await sp.getByText('All changes saved').waitFor();
    await sp.getByRole('button', { name: 'Publish changes' }).click();
    await sp.getByRole('heading', { name: 'Wool coat is live' }).waitFor();
    if (!(await sp.getByText('Live · version 2').isVisible())) fail(`edit @${width}: republished listing should be version 2`);
    await sp.goto(BASE + '/profile');
    await sp.getByRole('heading', { name: 'sian' }).waitFor();
    if (!(await sp.getByText('Wool coat').isVisible())) fail(`sell @${width}: published listing missing from the account page`);
    const over = await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`sell @${width}: account page scrolls sideways`);
    await sp.getByRole('button', { name: 'Sign out' }).click();
    await sp.waitForURL(BASE + '/');
    if (serr.length) fail(`sell @${width}: page errors: ${serr.slice(0, 2).join(' | ')}`);
    await sctx.close();
  }

  // Account journey: the passkey offer on the third sign-in, adding a passkey, signing in with it,
  // editing the profile and holiday mode. Chrome's virtual authenticator stands in for Face ID.
  {
    // Passkeys need a domain name, not an IP address, so this part uses localhost.
    const ABASE = `http://localhost:${PORT}`;
    const actx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ap = await actx.newPage();
    const aerr = [];
    ap.on('pageerror', (e) => aerr.push(e.message));
    const cdp = await actx.newCDPSession(ap);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    const passwordSignIn = async () => {
      await ap.goto(ABASE + '/signin?next=/profile');
      await ap.getByLabel('Email').fill('kudzai@example.com');
      await ap.getByLabel('Password').fill('a-long-password');
      await ap.getByRole('button', { name: 'Sign in', exact: true }).click();
      await ap.waitForURL((u) => ['/profile', '/passkey'].includes(u.pathname));
      const offered = ap.url().includes('/passkey');
      if (!offered) {
        await ap.getByRole('heading', { level: 1 }).waitFor();
        await ap.getByRole('button', { name: 'Sign out' }).click();
        await ap.waitForURL(ABASE + '/');
      }
      return offered;
    };
    const offers = [await passwordSignIn(), await passwordSignIn(), await passwordSignIn()];
    if (offers.join() !== 'false,false,true') fail(`account: passkey offer pattern was ${offers.join()}, expected only on the third sign-in`);
    await ap.getByRole('button', { name: 'Add a passkey' }).click();
    await ap.getByRole('heading', { name: 'Passkey added' }).waitFor();
    await ap.getByRole('link', { name: 'Continue' }).click();
    await ap.waitForURL((u) => u.pathname === '/profile');
    await ap.getByRole('list', { name: 'Your passkeys' }).waitFor();
    if ((await ap.getByRole('list', { name: 'Your passkeys' }).getByRole('listitem').count()) !== 1) fail('account: passkey not listed');
    await ap.getByRole('button', { name: 'Rename Passkey on this device' }).click();
    await ap.getByLabel('Name for this passkey').fill('Kudzai’s phone');
    await ap.getByRole('button', { name: 'Save', exact: true }).click();
    await ap.getByText('Kudzai’s phone').waitFor();
    // Profile: a bad username is explained; a good one saves and the heading follows.
    await ap.getByLabel('Username').fill('no spaces');
    if (!(await ap.getByText('Use letters, numbers, dots, dashes or underscores only.').isVisible())) fail('account: bad username not explained');
    await ap.getByLabel('Username').fill('kudzai.n');
    await ap.getByLabel('About you (optional)').fill('Vintage cameras and wax jackets.');
    await ap.getByRole('button', { name: 'Save profile' }).click();
    await ap.getByRole('heading', { level: 1, name: 'kudzai.n' }).waitFor();
    const sw = ap.getByRole('switch', { name: 'Holiday mode' });
    await sw.click();
    if ((await sw.getAttribute('aria-checked')) !== 'true') fail('account: holiday switch did not turn on');
    await sw.click();
    // Sign out, then back in with the passkey: no password.
    await ap.getByRole('button', { name: 'Sign out' }).click();
    await ap.waitForURL(ABASE + '/');
    await ap.goto(ABASE + '/signin?next=/profile');
    await ap.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await ap.waitForURL((u) => u.pathname === '/profile');
    await ap.getByRole('heading', { level: 1, name: 'kudzai.n' }).waitFor();
    const over = await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail('account: page scrolls sideways');
    await ap.screenshot({ path: 'test-results/account-390.png', fullPage: true });
    // Remove the passkey; passkey sign-in then fails with a clear message.
    await ap.getByRole('button', { name: 'Remove Kudzai’s phone' }).click();
    await ap.getByText('No passkeys yet.').waitFor();
    // Password reset never says whether an account exists.
    await ap.goto(ABASE + '/reset');
    await ap.getByLabel('Email').fill('nobody@example.com');
    await ap.getByRole('button', { name: 'Email me a link' }).click();
    await ap.getByText('If there’s an account for nobody@example.com').waitFor();
    // A seller's public page.
    await ap.goto(ABASE + '/item/example-1');
    await ap.getByRole('link', { name: 'resole_archive' }).click();
    await ap.waitForURL(/\/member\/resole_archive$/);
    const theirs = await ap.getByRole('list', { name: 'Listings by resole_archive' }).getByRole('listitem').count();
    if (theirs !== 3) fail(`member page lists ${theirs} items, expected 3`);
    const ghost = await ap.goto(ABASE + '/member/nobody-here');
    if (ghost?.status() !== 404) fail(`unknown member returned ${ghost?.status()}, expected 404`);
    if (aerr.length) fail(`account: page errors: ${aerr.slice(0, 2).join(' | ')}`);
    await actx.close();
  }

  // Buying: the breakdown matches the fee model, then a test payment and the order page.
  {
    const bctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bp = await bctx.newPage();
    const berr = [];
    bp.on('pageerror', (e) => berr.push(e.message));
    await bp.goto(BASE + '/item/example-6');
    await bp.getByRole('link', { name: 'Buy now' }).click();
    await bp.waitForURL((u) => u.pathname === '/checkout/example-6');
    await bp.getByRole('link', { name: 'Sign in to buy' }).click();
    await bp.getByLabel('Email').fill('buyer@example.com');
    await bp.getByLabel('Password').fill('a-long-password');
    await bp.getByRole('button', { name: 'Sign in', exact: true }).click();
    await bp.waitForURL((u) => u.pathname === '/checkout/example-6');
    const table = bp.getByRole('table', { name: 'What you pay' });
    await table.waitFor();
    const rows = (await table.getByRole('row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    const want = ['Item£890.00', 'Transaction fee (4%)', '£35.60', 'Processing fee', '£0.80', 'Courier witness', '£5.00', 'Authentication check', '£15.00', 'Total£946.40'];
    for (const w of want) if (!rows.some((r) => r.includes(w))) fail(`checkout: breakdown missing "${w}" (rows: ${rows.join(' | ')})`);
    if (rows.some((r) => r.startsWith('Postage'))) fail('checkout: free postage should not be listed');
    // The seller drops the price while the buyer is looking: nothing is held, and the change is shown.
    await bp.evaluate(() => sessionStorage.setItem('pv-example-edits', JSON.stringify({ 'example-6': { revision: 2, pricePence: 85000 } })));
    await bp.getByRole('button', { name: 'Continue to payment · £946.40' }).click();
    await bp.getByRole('heading', { name: 'The seller changed this listing' }).waitFor();
    if (!(await bp.getByText('Price: £890.00 → £850.00').isVisible())) fail('checkout: price change not shown');
    await bp.getByRole('button', { name: 'Continue with the updated listing' }).click();
    await bp.getByRole('button', { name: 'Continue to payment · £904.80' }).click();
    await bp.getByText('We’re holding this for you until').waitFor();
    await bp.getByRole('button', { name: 'Pay £904.80 (test)' }).click();
    await bp.waitForURL((u) => u.pathname.startsWith('/orders/'));
    await bp.getByRole('heading', { level: 1, name: 'Paid' }).waitFor();
    const bought = await bp.getByRole('heading', { name: 'What you bought' }).locator('..').textContent();
    if (!bought?.includes('version 2') || !bought.includes('£850.00')) fail(`order: "what you bought" should show version 2 at £850 (${bought?.slice(0, 200)})`);
    await bp.goto(BASE + '/profile');
    await bp.getByRole('list', { name: 'Your orders' }).waitFor();
    const ordersText = await bp.getByRole('list', { name: 'Your orders' }).textContent();
    if (!ordersText?.includes('Saint Laurent Kate bag') || !ordersText.includes('£904.80')) fail(`account: order missing (${ordersText})`);
    await bp.goto(BASE + '/checkout/example-6');
    await bp.getByRole('heading', { name: 'This item isn’t available' }).waitFor();
    if (berr.length) fail(`checkout: page errors: ${berr.slice(0, 2).join(' | ')}`);
    await bctx.close();
  }

  // Orders and custody: the buyer's phone, the seller's phone and a courier, sharing one example
  // marketplace (localStorage), each signed in on their own tab. A £75 item: courier-witnessed tier.
  {
    const cctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cerr = [];
    const CLIP = { name: 'clip.webm', mimeType: 'video/webm', buffer: readFileSync(new URL('./fixtures/clip.webm', import.meta.url)) };
    const tab = async (email, next = '/inbox') => {
      const p = await cctx.newPage();
      p.on('pageerror', (e) => cerr.push(`${email}: ${e.message}`));
      await p.goto(`${BASE}/signin?next=${encodeURIComponent(next)}`);
      await p.getByLabel('Email').fill(email);
      await p.getByLabel('Password').fill('a-long-password');
      await p.getByRole('button', { name: 'Sign in', exact: true }).click();
      // The third sign-in on a device offers a passkey; these tabs share a device.
      await p.waitForURL((u) => u.pathname === next || u.pathname === '/passkey');
      if (new URL(p.url()).pathname === '/passkey') {
        await p.getByRole('button', { name: 'Not now' }).click();
        await p.waitForURL((u) => u.pathname === next);
      }
      return p;
    };
    const step = (p, name) => p.getByRole('heading', { level: 2, name, exact: true }).waitFor({ timeout: 10000 });
    const record = async (p) => {
      await p.getByRole('button', { name: 'Record this step' }).click();
      await p.getByRole('button', { name: 'Recording…' }).waitFor({ state: 'detached' }).catch(() => {});
    };
    const addPhoto = async (p) => { await p.getByLabel('Take photo').setInputFiles(photo('evidence.png')); await p.getByText('Photo added.').waitFor(); };
    const addVideo = async (p) => { await p.getByLabel('Record video').setInputFiles(CLIP); await p.getByText('Video added.').waitFor(); };
    const openFromInbox = async (p) => {
      await p.goto(BASE + '/inbox');
      await p.getByRole('heading', { name: 'Your turn' }).waitFor();
      await p.getByRole('link', { name: 'Open LEGO Technic 42110' }).click();
      await p.waitForURL((u) => u.pathname.startsWith('/orders/'));
    };

    // The buyer pays (£75 + £3.99 postage + 6% + £0.80 + £5 courier witness).
    const buyer = await tab('buyer2@example.com', '/checkout/example-11');
    await buyer.getByRole('button', { name: 'Continue to payment · £89.29' }).click();
    await buyer.getByRole('button', { name: 'Pay £89.29 (test)' }).click();
    await buyer.waitForURL((u) => u.pathname.startsWith('/orders/'));
    const orderUrl = buyer.url();
    await buyer.getByText('Waiting for the seller').waitFor();

    // The seller sees it in their inbox and does the handover.
    const seller = await tab('brick_bench@example.test');
    await seller.getByRole('heading', { name: 'Your turn' }).waitFor();
    await seller.screenshot({ path: 'test-results/inbox-seller-390.png', fullPage: true });
    await openFromInbox(seller);
    await step(seller, 'Start recording and read the code aloud');
    await seller.getByRole('button', { name: 'Start recording: get my code' }).click();
    const code = (await seller.locator('.pv-code__value').textContent())?.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code ?? '')) fail(`custody: challenge code looks wrong (${code})`);
    await addVideo(seller);
    await record(seller);
    await step(seller, 'Show the item on camera');
    await addPhoto(seller);
    await record(seller);
    await step(seller, 'Weigh the parcel');
    await seller.getByLabel('Weight in grams').fill('820');
    await record(seller);
    await step(seller, 'Seal the parcel with the ProofSeal');
    await seller.getByRole('button', { name: 'Get the seal code' }).click();
    const seal = (await seller.locator('.pv-code__value').textContent())?.trim() ?? '';
    if (!/^PS-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(seal)) fail(`custody: seal code looks wrong (${seal})`);
    await seller.getByLabel('Type the code on the seal you fitted').fill(seal.toLowerCase().replace(/-/g, ' '));
    await record(seller);
    await step(seller, 'Photograph the sealed parcel');
    await addPhoto(seller);
    await record(seller);
    await seller.getByText('Waiting for the courier').waitFor();
    await seller.screenshot({ path: 'test-results/custody-seller-390.png', fullPage: true });

    // The buyer follows along but never sees the seal code they will have to check.
    await buyer.reload();
    await buyer.getByText('Waiting for the courier').waitFor();
    const buyerText = (await buyer.locator('main').textContent()) ?? '';
    if (buyerText.includes(seal) || !buyerText.includes('hidden until you check it')) fail('custody: the buyer must not see the seal code before checking it');

    // The courier: independent account, own session.
    const courier = await tab('courier@example.test');
    await openFromInbox(courier);
    await step(courier, 'Courier witnesses packing and takes the parcel');
    await courier.getByLabel('Carrier').fill('DPD');
    await courier.getByLabel('Tracking number').fill('15501234567890');
    await courier.getByRole('button', { name: 'Record this step' }).click();
    await courier.getByRole('alert').filter({ hasText: 'Tick to confirm.' }).waitFor();
    await courier.getByLabel('I watched the item being packed and sealed, and I have the parcel.').check();
    await record(courier);
    await step(courier, 'Courier weighs it at your door');
    await courier.getByLabel('Weight in grams').fill('815');
    await record(courier);

    // The buyer opens it on camera and checks the seal.
    await buyer.goto(orderUrl);
    await step(buyer, 'Start recording and read the code aloud');
    await buyer.getByRole('button', { name: 'Start recording: get my code' }).click();
    await addVideo(buyer);
    await record(buyer);
    await step(buyer, 'Check the ProofSeal');
    await buyer.getByLabel('Type the code printed on the seal').fill(seal);
    await record(buyer);
    await step(buyer, 'Photograph the item');
    await addPhoto(buyer);
    await record(buyer);
    await buyer.screenshot({ path: 'test-results/custody-buyer-390.png', fullPage: true });

    await openFromInbox(courier);
    await step(courier, 'Courier confirms the opening');
    await courier.getByLabel('I watched the buyer open the sealed parcel and take out the item.').check();
    await record(courier);

    await buyer.reload();
    await step(buyer, 'Confirm it’s as described');
    await buyer.getByRole('button', { name: 'Confirm it’s as described' }).click();
    await buyer.getByText('The payment has been released to the seller.').waitFor();

    await seller.reload();
    await seller.getByText('released and will be paid out').waitFor();
    if (!(await seller.getByText('Record verified').isVisible())) fail('custody: the seller should see a verified record');
    const done = await seller.locator('.pv-step--done').count();
    if (done !== 12) fail(`custody: expected 12 recorded steps, saw ${done}`);
    const evidence = await seller.locator('.pv-step__media').count();
    if (evidence !== 5) fail(`custody: expected 5 evidence photos and videos, saw ${evidence}`);
    await seller.goto(BASE + '/inbox');
    await seller.getByText('Nothing needs you right now.').waitFor();
    if (cerr.length) fail(`custody: page errors: ${cerr.slice(0, 3).join(' | ')}`);
    await cctx.close();
  }

  // API v1
  const KEY = 'pv_test_Example1_' + 'x'.repeat(43);
  const api = async (path, key) => {
    const r = await fetch(BASE + path, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    return { status: r.status, type: r.headers.get('content-type') ?? '', version: r.headers.get('provenance-api-version'), body: await r.json() };
  };
  const expectApi = (label, r, status, type) => {
    if (r.status !== status) fail(`API ${label}: status ${r.status}, expected ${status}`);
    if (!r.type.includes(type)) fail(`API ${label}: content-type ${r.type}`);
    if (r.version !== '1') fail(`API ${label}: missing version header`);
  };
  expectApi('no key', await api('/api/v1/listings'), 401, 'application/problem+json');
  expectApi('bad key', await api('/api/v1/listings', 'pv_live_nope'), 401, 'application/problem+json');
  const list = await api('/api/v1/listings?q=barb&limit=5', KEY);
  expectApi('search', list, 200, 'application/json');
  if (list.body.data?.length !== 1 || list.body.data[0].price_pence !== 4800 || list.body.data[0].currency !== 'GBP') fail('API search returned the wrong data');
  const bad = await api('/api/v1/listings?sort=random&limit=500', KEY);
  expectApi('bad params', bad, 400, 'application/problem+json');
  if (bad.body.errors?.length !== 2) fail('API bad params should list 2 errors');
  const paged = await api('/api/v1/listings?limit=5', KEY);
  const next = await api(`/api/v1/listings?limit=5&cursor=${paged.body.next_cursor}`, KEY);
  if (!paged.body.next_cursor || next.body.data?.[0]?.id === paged.body.data?.[0]?.id) fail('API paging broken');
  expectApi('one listing', await api('/api/v1/listings/example-2', KEY), 200, 'application/json');
  expectApi('missing listing', await api('/api/v1/listings/00000000-0000-0000-0000-000000000000', KEY), 404, 'application/problem+json');
  const cats = await api('/api/v1/categories', KEY);
  expectApi('categories', cats, 200, 'application/json');
  const q = await api('/api/v1/listings/example-1/quote', KEY);
  expectApi('quote', q, 200, 'application/json');
  if (q.body.data?.total_pence !== 5663 || q.body.data?.protection_pence !== 384 || q.body.data?.transaction_rate_bp !== 800) fail(`API quote wrong: ${JSON.stringify(q.body.data)}`);
  if ('seller_payout_pence' in (q.body.data ?? {})) fail('API quote must not reveal what the seller receives');
  if (cats.body.data?.length !== 9) fail('API categories count');
  expectApi('unknown endpoint', await api('/api/v1/nothing', KEY), 404, 'application/problem+json');
  const spec = await api('/api/v1/openapi.json');
  if (spec.status !== 200 || spec.body.openapi !== '3.1.0') fail('OpenAPI spec not served');
} finally {
  await browser.close();
  stop();
}

console.log(failures.length ? `\n${failures.length} layout problem(s)` : `\nLayout OK: ${pages.length} pages × ${widths.length} widths × 2 themes`);
process.exit(failures.length ? 1 : 0);
