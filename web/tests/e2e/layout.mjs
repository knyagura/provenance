// Real-browser layout check for the new site: every page at four widths, light and dark.
// Fails on sideways scrolling, a missing or misplaced bottom bar, unreadable sizes or console errors.
// Usage: npm run build && npm run test:e2e   (starts `next start` itself). Screenshots go to test-results/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;
const pages = ['/', '/styleguide', '/search', '/sell', '/inbox', '/profile'];
const widths = [360, 768, 1024, 1440];
const schemes = ['light', 'dark'];

const server = spawn('npx', ['next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], { stdio: 'pipe', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
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
        const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
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
        if (path === '/styleguide' || path === '/') {
          await page.screenshot({ path: `test-results/${path === '/' ? 'home' : 'styleguide'}-${width}-${scheme}.png`, fullPage: true });
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
  const fav = page.getByRole('button', { name: 'Add Barbour jacket to favourites' });
  await fav.click();
  if ((await page.getByRole('button', { name: 'Remove Barbour jacket from favourites' }).getAttribute('aria-pressed')) !== 'true') fail('favourite button did not toggle');
  await ctx.close();
} finally {
  await browser.close();
  stop();
}

console.log(failures.length ? `\n${failures.length} layout problem(s)` : `\nLayout OK: ${pages.length} pages × ${widths.length} widths × 2 themes`);
process.exit(failures.length ? 1 : 0);
