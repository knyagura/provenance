const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname,'..','app','index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function assert(cond, label){ if(!cond) throw new Error('FAILED: ' + label); console.log('OK:', label); }

(async () => {
  await wait(300);
  try {
    assert(window.eval("typeof shareContent") === 'function', 'shareContent() defined');
    assert(window.eval("typeof hapticPulse") === 'function', 'hapticPulse() defined');
    assert(window.eval("typeof updateOfflineBanner") === 'function', 'updateOfflineBanner() defined');

    // hapticPulse must be a safe no-op where navigator.vibrate doesn't exist (jsdom, iOS Safari)
    window.eval("hapticPulse(10)");
    console.log('OK: hapticPulse() did not throw with no navigator.vibrate (matches iOS Safari, which has none at all)');

    // shareContent falls back to clipboard or an honest toast when navigator.share is absent
    window.eval("shareContent('t','x','http://example.com')");
    await wait(20);
    console.log('OK: shareContent() did not throw with no navigator.share/clipboard in jsdom');

    // offline banner toggles correctly
    const banner = window.document.getElementById('offlineBanner');
    assert(!!banner, 'offline banner element exists in the shell, outside #main');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.eval('updateOfflineBanner()');
    assert(window.document.getElementById('offlineBanner').style.display === 'block', 'banner shows when navigator.onLine is false');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    window.eval('updateOfflineBanner()');
    assert(window.document.getElementById('offlineBanner').style.display === 'none', 'banner hides again when back online');

    // share buttons present on item detail + timeline
    window.selectItem('nike');
    window.render('item');
    let main = window.document.getElementById('main').innerHTML;
    assert(main.includes('Share this listing'), 'item detail page has a Share this listing button');

    window.render('timeline');
    main = window.document.getElementById('main').innerHTML;
    assert(main.includes('Share my Proof Score'), 'timeline page has a Share my Proof Score button');

    console.log('\nALL M4 (SHARE / HAPTICS / OFFLINE BANNER) CHECKS PASSED');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
