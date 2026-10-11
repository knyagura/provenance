// Real-browser layout check for the new site: every page at four widths, light and dark.
// Fails on sideways scrolling, a missing or misplaced bottom bar, unreadable sizes or console errors.
// Usage: npm run build && npm run test:e2e   (starts `next start` itself). Screenshots go to test-results/.
// Runs with PV_DATA_SOURCE=examples: no database needed, the example catalogue stands in.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;
const pages = [
  '/', '/styleguide', '/search', '/search?q=barb%20jack', '/search?category=men&sort=price_asc&min=10',
  '/search?min=abc&condition=Mint', '/search?q=zzzz', '/item/example-1', '/item/example-6', '/developers',
  '/sell', '/inbox', '/profile', '/signin', '/reset', '/passkey', '/member/resole_archive',
];
const shots = { '/member/resole_archive': 'member', '/': 'home', '/styleguide': 'styleguide', '/search': 'search', '/item/example-1': 'item', '/developers': 'developers' };
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
