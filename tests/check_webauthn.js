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
    assert(window.eval("typeof verifyBiometric") === 'function', 'verifyBiometric() defined');
    assert(window.eval("webAuthnSupported()") === false, 'jsdom correctly reports no WebAuthn platform support (no PublicKeyCredential)');

    window.selectItem('nike');
    window.eval("state.handover = {index:0, log:[], head:'0', attendantLog:[], attendantHead:'0', challengeCode:null, weighedKg:null, appAuth:false, photoCaptured:{}}");
    const steps = window.eval("buildHandoverSteps(ITEMS.nike).steps");
    const bioIdx = steps.findIndex(s=>s.bio);
    assert(bioIdx >= 0, 'nike handover flow includes a real biometric-gated 2FA step');
    window.eval(`state.handover.index = ${bioIdx}`);
    window.render('handover');
    let main = window.document.getElementById('main').innerHTML;
    assert(main.includes('Verify with Face ID / Fingerprint'), 'bio step shows the real WebAuthn prompt button, not just a plain continue button');

    window.verifyBiometric('handover', 'Seller', 'order IT-TEST');
    await wait(50);
    assert(window.eval('state.handover.bioConfirmed') === true, 'unsupported-WebAuthn fallback still confirms the step honestly');
    assert(window.eval('state.handover.bioMethod') === null, 'fallback leaves bioMethod null so launchApp() uses its own honest simulated text, not a fabricated "real" one');
    main = window.document.getElementById('main').innerHTML;
    assert(!main.includes('Verify with Face ID / Fingerprint'), 'prompt button disappears once confirmed (one way or another)');
    assert(main.includes('onclick="handoverNext()"'), 'normal advance button is now shown');

    // Confirm the audit log still verifies cleanly after advancing past this step
    window.handoverNext();
    assert(window.eval('verifyAppAuthLog()') === true, 'authentication audit log still verifies cleanly after a biometric-gated 2FA step');

    console.log('\nALL WEBAUTHN WIRING CHECKS PASSED (fallback path; real biometric prompt requires an actual device with Face ID/Touch ID/Windows Hello/fingerprint)');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
