// Real-browser layout audit (Playwright + Chromium) — closes the jsdom blind spot
// that let the F4 bug (camera shutter clipped by overflow:hidden) ship.
//
// Unlike the jsdom suite, this renders with a real layout engine at real phone
// viewport sizes, uses Chromium's fake camera so getUserMedia genuinely streams,
// and then checks every interactive control on every screen for:
//   - CLIPPED   : >30% of the control sits outside an overflow:hidden/clip ancestor
//   - COVERED   : after scrolling it into view, something else is on top of its centre
//   - OFFSCREEN : it extends past the viewport's right edge (and isn't in a horizontal scroller)
//   - ZERO      : it's displayed but has no size
//   - PAGE-X    : the page itself scrolls horizontally
//   - SMALL     : tap target under 24x24 CSS px (WCAG 2.2 minimum) — reported, not failed
//
// Usage:  node real_browser_layout.js            (serves ../app on localhost:8765)
// Output: console report + screenshots in ./layout-shots/  ; exit 1 on any hard failure.

const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const APP_DIR = path.join(__dirname, '..', 'app');
const SHOTS = path.join(__dirname, 'layout-shots');
const PORT = 8765;

const VIEWPORTS_ALL = [
  { name: 'fold-280', width: 280, height: 653 },     // Galaxy Fold cover screen — worst case
  { name: 'android-360', width: 360, height: 740 },
  { name: 'iphoneSE-375', width: 375, height: 667 },
  { name: 'iphone15-393', width: 393, height: 852 },
];
const THEMES = process.env.SELFTEST ? ['light'] : ['light', 'dark'];
const VIEWPORTS = process.env.SELFTEST ? VIEWPORTS_ALL.slice(2, 3) : VIEWPORTS_ALL;

// --- tiny static server so we get a secure context (localhost) for camera + SW ---
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(APP_DIR, path.normalize(p));
      if (!f.startsWith(APP_DIR) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(PORT, () => res(srv));
  });
}

// --- in-page audit: runs inside the browser, returns findings for current screen ---
async function audit(page) {
  return page.evaluate(async () => {
    const out = [];
    const vw = window.innerWidth;
    const de = document.documentElement;
    if (de.scrollWidth > vw + 1) {
      // find the widest offender for a useful message
      let worst = null, wr = vw;
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > wr + 1 && getComputedStyle(el).position !== 'fixed') { wr = r.right; worst = el; }
      });
      out.push({ kind: 'PAGE-X', msg: `page scrolls horizontally (${de.scrollWidth}px > ${vw}px)`, el: worst ? desc(worst) : '' });
    }
    function desc(el) {
      const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls}${t ? ` "${t}"` : ''}`;
    }
    const sel = 'button, a[href], a[onclick], input:not([type=hidden]), select, textarea, [onclick], [role=button]';
    const els = [...document.querySelectorAll(sel)].filter(el => {
      // skip nested matches (e.g. [onclick] div inside a button) — audit the outermost
      const p = el.parentElement && el.parentElement.closest(sel);
      return !p;
    });
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
      // skip anything inside a display:none ancestor
      if (!el.getClientRects().length) continue;
      let r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) {
        if (el.type === 'file') continue;          // visually-hidden file inputs are normal
        if (cs.opacity === '0' || cs.position === 'absolute') continue;
        out.push({ kind: 'ZERO', msg: 'displayed but zero-size', el: desc(el) });
        continue;
      }
      // clipping by overflow:hidden/clip ancestors (the F4 class of bug)
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const ox = acs.overflowX, oy = acs.overflowY;
        const clipsX = ox === 'hidden' || ox === 'clip', clipsY = oy === 'hidden' || oy === 'clip';
        if (!clipsX && !clipsY) continue;
        const ar = a.getBoundingClientRect();
        const ix = clipsX ? Math.max(0, Math.min(r.right, ar.right) - Math.max(r.left, ar.left)) : r.width;
        const iy = clipsY ? Math.max(0, Math.min(r.bottom, ar.bottom) - Math.max(r.top, ar.top)) : r.height;
        const visibleFrac = (ix * iy) / (r.width * r.height);
        if (visibleFrac < 0.7) {
          out.push({ kind: 'CLIPPED', msg: `only ${Math.round(visibleFrac * 100)}% visible inside overflow:hidden ${desc(a)}`, el: desc(el) });
          break;
        }
      }
      // horizontal off-screen (ignore things inside a horizontal scroller — carousels are fine)
      let inHScroller = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth) { inHScroller = true; break; }
      }
      if (!inHScroller && (r.right > vw + 1 || r.left < -1)) {
        out.push({ kind: 'OFFSCREEN', msg: `extends past viewport (left ${Math.round(r.left)}, right ${Math.round(r.right)} of ${vw})`, el: desc(el) });
      }
      if ((r.width < 24 || r.height < 24) && !['checkbox', 'radio'].includes(el.type) && cs.display !== 'inline') {
        out.push({ kind: 'SMALL', msg: `tap target ${Math.round(r.width)}x${Math.round(r.height)}px`, el: desc(el) });
      }
      // covered: scroll into view, then hit-test the centre
      if (!inHScroller) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx >= 0 && cx < vw && cy >= 0 && cy < window.innerHeight) {
          const hit = document.elementFromPoint(cx, cy);
          if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
            // label wrapping an input is fine
            if (!(hit.tagName === 'LABEL' && hit.contains(el)) && !(el.labels && [...el.labels].includes(hit))) {
              const hcs = getComputedStyle(hit);
              if (hcs.pointerEvents !== 'none') out.push({ kind: 'COVERED', msg: `centre is covered by ${desc(hit)}`, el: desc(el) });
            }
          }
        }
      }
    }
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach(n => { if (n.scrollTop) n.scrollTop = 0; });
    return out;
  });
}

// --- drive the app into each state we want to audit; each yields a label ---
async function* states(page) {
  const go = (id) => page.evaluate(id => goTo(id), id);
  const ev = (js) => page.evaluate(js);
  const settle = (ms = 250) => page.waitForTimeout(ms);

  for (const s of ['feed', 'protection', 'disputes', 'account', 'inbox']) { await go(s); await settle(); yield s; }
  if (await ev(`typeof setAuthMode==='function'`)) {
    for (const m of ['signup', 'magic']) { await ev(`setAuthMode('${m}')`); await settle(); yield `account:${m}`; }
    await ev(`setAuthMode('signin')`);
  }

  // each demo item: detail, checkout, payment
  const items = await ev(`Object.keys(ITEMS).filter(k=>ITEMS[k].published!==false)`);
  for (const id of items.slice(0, 3)) {
    await ev(`selectItem('${id}')`); await go('item'); await settle(); yield `item:${id}`;
  }
  await ev(`selectItem('${items[0]}')`);
  await go('checkout'); await settle(); yield 'checkout';
  await ev(`setShippingChoice('free')`); await go('payment'); await settle(); yield 'payment';

  // storefronts
  await ev(`viewStorefront('you')`); await go('storefront'); await settle(); yield 'storefront:own';

  // new listing: photo step, live camera open, details step
  await ev(`state.newListing={photos:[]}`); await go('newlisting'); await settle(); yield 'newlisting:photos';
  const hasOpen = await ev(`typeof openListingCamera==='function'`);
  if (hasOpen) { await ev(`openListingCamera()`); await settle(1200); yield 'newlisting:CAMERA-LIVE';
    if (process.env.SELFTEST) {
      // Deliberately re-create the F4 bug: controls back inside a clipped, fixed-height viewfinder.
      await ev(`(()=>{const vf=document.querySelector('#main .viewfinder'),cc=document.querySelector('#main .cam-controls'); if(vf&&cc){vf.style.overflow='hidden'; vf.style.position='relative'; vf.appendChild(cc); cc.style.position='absolute'; cc.style.top='100%';}})()`);
      yield 'SELFTEST:F4-REINTRODUCED';
    }
    await ev(`stopActiveCamera&&stopActiveCamera()`); }
  await ev(`capturePhotoForListing(); goToListingDetailsStep()`); await settle(); yield 'newlisting:details';

  // full custody chain on the Ultra Luxury item (exercises hub + dual verifier)
  const lux = await ev(`Object.keys(ITEMS).find(k=>ITEMS[k].price>=1500)||Object.keys(ITEMS)[0]`);
  await ev(`selectItem('${lux}'); setShippingChoice('free'); selectPaymentMethod('visa'); confirmPurchase()`);
  const flows = [
    { screen: 'handover', key: 'handover', builder: `buildHandoverSteps(ITEMS['${lux}']).steps`, next: 'handoverNext', open: `openCustodyCamera('handover')` },
    { screen: 'verifierhub', key: 'verifierHub', builder: `buildVerifierHubSteps(ITEMS['${lux}']).steps`, next: 'verifierHubNext' },
    { screen: 'unboxing', key: 'unboxing', builder: `buildUnboxingSteps(ITEMS['${lux}']).steps`, next: 'unboxingNext' },
  ];
  for (const f of flows) {
    await go(f.screen); await settle();
    for (let guard = 0; guard < 40; guard++) {
      const st = await ev(`(()=>{const c=state.${f.key};const s=${f.builder};return c.index>=s.length?null:{i:c.index,n:s.length,photo:!!s[c.index].photo,scan:s[c.index].scan||null,cap:!!(c.photoCaptured||{})[c.index]}})()`);
      if (!st) break;
      await page.evaluate(sc => goTo(sc), f.screen); await settle(150);
      yield `${f.screen}:step${st.i + 1}/${st.n}`;
      if (st.photo || st.scan) {
        // open the real camera the way a tap would, and audit the live viewfinder
        const opened = await ev(`(()=>{const b=document.querySelector('#main .cam-open-btn'); if(b){b.click(); return true} return false})()`);
        if (opened) {
          await settle(1200);
          yield `${f.screen}:step${st.i + 1}/${st.n}:CAMERA-LIVE`;
          await ev(`stopScanLoop&&stopScanLoop(); stopActiveCamera&&stopActiveCamera()`);
        }
        if (st.photo && !st.cap) await ev(`capturePhoto(state.${f.key}, state.${f.key}.index)`);
      }
      await ev(`${f.next}()`);
    }
  }
  await go('timeline'); await settle(); yield 'timeline';
  await go('passport'); await settle(); yield 'passport';
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const hard = new Map();   // key -> {kind,msg,el, where:Set}
  const soft = new Map();
  const pageErrors = new Set();
  let statesAudited = 0;

  for (const vp of VIEWPORTS) for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      permissions: ['camera'], colorScheme: theme,
    });
    // Keep the audit deterministic: never talk to the live Supabase project (its contents change).
    await ctx.route(/supabase\.co/, (route) => route.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.add(e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(t => { if (!!state.darkMode !== (t === 'dark')) toggleDarkMode(); }, theme);
    for await (const label of states(page)) {
      statesAudited++;
      const findings = await audit(page);
      const tag = `${vp.name}/${theme}`;
      for (const f of findings) {
        const bucket = f.kind === 'SMALL' ? soft : hard;
        const key = `${f.kind}|${label.replace(/step\d+\/\d+/, 'step*')}|${f.el}|${f.msg.replace(/\d+/g, '#')}`;
        if (!bucket.has(key)) bucket.set(key, { ...f, label, where: new Set() });
        bucket.get(key).where.add(tag);
      }
      const isCam = label.includes('CAMERA');
      if (theme === 'light' && (isCam || ['fold-280', 'iphoneSE-375'].includes(vp.name)) || findings.some(f => f.kind !== 'SMALL')) {
        const fn = `${vp.name}_${theme}_${label.replace(/[^a-z0-9]+/gi, '-')}.png`;
        await page.screenshot({ path: path.join(SHOTS, fn), fullPage: !isCam });
      }
    }
    await ctx.close();
  }
  await browser.close(); srv.close();

  const print = (title, m) => {
    console.log(`\n=== ${title} (${m.size}) ===`);
    for (const f of m.values()) console.log(`[${f.kind}] ${f.label}  ${f.el}\n     ${f.msg}\n     at: ${[...f.where].join(', ')}`);
  };
  console.log(`Audited ${statesAudited} screen-states across ${VIEWPORTS.length} viewports x ${THEMES.length} themes.`);
  print('HARD LAYOUT FAILURES', hard);
  print('SMALL TAP TARGETS (advisory)', soft);
  if (pageErrors.size) { console.log(`\n=== PAGE ERRORS (${pageErrors.size}) ===`); pageErrors.forEach(e => console.log(' ', e)); }
  console.log(hard.size || pageErrors.size ? '\nRESULT: FAIL' : '\nRESULT: PASS — no clipped, covered or off-screen controls');
  process.exit(hard.size || pageErrors.size ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
