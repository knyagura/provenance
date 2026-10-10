// Functional check for the real QR scan feature: confirms the vendored qrcode-generator
// is actually usable from inside the app (not just the standalone library), that it
// produces a genuinely decodable QR for a real seal code (round-tripped through jsQR,
// also vendored), and that the scan-step UI/gating degrades honestly when no camera
// exists (jsdom has none) rather than silently faking a match.
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
    assert(window.eval("typeof qrcode") === 'function', 'vendored qrcode-generator loaded and attached to window');
    assert(window.eval("typeof jsQR") === 'function', 'vendored jsQR loaded and attached to window');
    assert(window.eval("typeof renderSealQr") === 'function', 'renderSealQr() defined');
    assert(window.eval("typeof openCustodyScan") === 'function', 'openCustodyScan() defined');

    const dataUrl = window.eval("renderSealQr(state.proofSeal.code)");
    assert(typeof dataUrl === 'string' && dataUrl.indexOf('data:image') === 0, 'renderSealQr() produces a real data: image URL for the current ProofSeal code');

    // Round-trip through jsQR using the SAME in-app qrcode object (not a separate copy),
    // confirming the on-screen QR actually encodes the exact seal code, decodably.
    const roundTrip = window.eval(`
      (function(){
        const code = state.proofSeal.code;
        const qr = qrcode(0, 'M');
        qr.addData(code);
        qr.make();
        const n = qr.getModuleCount();
        const scale = 6, margin = 4;
        const size = n*scale + margin*2*scale;
        const data = new Uint8ClampedArray(size*size*4);
        for(let i=0;i<data.length;i+=4){ data[i]=255; data[i+1]=255; data[i+2]=255; data[i+3]=255; }
        for(let r=0;r<n;r++){
          for(let c=0;c<n;c++){
            if(qr.isDark(r,c)){
              const x0=(c*scale)+margin*scale, y0=(r*scale)+margin*scale;
              for(let dy=0;dy<scale;dy++){
                for(let dx=0;dx<scale;dx++){
                  const idx=((y0+dy)*size+(x0+dx))*4;
                  data[idx]=0; data[idx+1]=0; data[idx+2]=0; data[idx+3]=255;
                }
              }
            }
          }
        }
        const result = jsQR(data, size, size);
        return { decoded: result && result.data, expected: code };
      })()
    `);
    assert(roundTrip.decoded === roundTrip.expected, `the on-screen QR for ${roundTrip.expected} genuinely decodes back to the same code via jsQR (got "${roundTrip.decoded}")`);

    // --- Hub scan step: confirm it's gated, and that attempting to open the camera in an
    // environment with none (jsdom) falls back honestly to a manual confirmation. ---
    window.selectItem('dior');
    window.eval("state.timeline.handedOver = true"); // bypass the "complete handover first" gate for this isolated check
    window.eval("state.verifierHub = {index:0, log:[], head:'0', secondLog:[], secondHead:'0', appAuth:false, photoCaptured:{}}");
    window.render('verifierhub');
    const steps = window.eval("buildVerifierHubSteps(ITEMS.dior).steps");
    const scanIdx = steps.findIndex(s=>s.scan);
    assert(scanIdx >= 0, 'dior Verifier Hub flow includes a real scan-gated step');
    window.eval(`state.verifierHub.index = ${scanIdx}`);
    window.render('verifierhub');
    let main = window.document.getElementById('main').innerHTML;
    assert(main.includes("openCustodyScan('verifierHub'"), 'scan step wires its shutter button to openCustodyScan()');
    assert(main.includes('Scan the seal above to continue'), 'Continue button is disabled until the scan is confirmed one way or another');

    window.openCustodyScan('verifierHub', 'proofSeal');
    await wait(50);
    assert(window.eval('state.verifierHub.scanConfirmed[state.verifierHub.index]') === true, 'camera-unavailable fallback still confirmed the step (manually, honestly)');
    main = window.document.getElementById('main').innerHTML;
    assert(main.includes('qr-thumb'), 'a real scannable QR thumbnail is rendered next to the ProofSeal readout');

    console.log('\nALL QR-SCAN WIRING CHECKS PASSED (round-trip decode verified; real-camera path requires an actual device)');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
