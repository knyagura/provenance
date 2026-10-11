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
  '/sell', '/inbox', '/profile',
];
const shots = { '/': 'home', '/styleguide': 'styleguide', '/search': 'search', '/item/example-1': 'item', '/developers': 'developers' };
const widths = [360, 768, 1024, 1440];
const schemes = ['light', 'dark'];

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
