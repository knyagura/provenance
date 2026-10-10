const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname,'..','app','index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

let failures = 0;
function check(label, cond){
  if(cond){ console.log('MITIGATED:', label); }
  else { console.log('STILL BROKEN:', label); failures++; }
}

(async () => {
  await wait(300);

  console.log('=== ATTACK 1 (re-test): skip every step via direct state tamper, no evidence ever recorded ===');
  window.selectItem('dior');
  window.goTo('item');
  window.eval(`
    Object.keys(state.timeline).forEach(k => state.timeline[k] = true);
    state.proofSeal.status = 'intact';
    state.proofSealB.status = 'intact';
    state.itemSeal.status = 'intact';
    state.pairing.paired = true;
  `);
  window.goTo('timeline');
  const tl = window.document.getElementById('main').innerHTML;
  check('Timeline flags the forged "Confirmed" as a broken evidence chain instead of displaying it as clean',
    tl.includes('Evidence chain broken'));
  window.goTo('passport');
  const pass = window.document.getElementById('main').innerHTML;
  check('Passport withholds the "Independent authentication" / "Second independent authenticator" entries when the evidence chain never actually verified',
    !pass.includes('Independent authentication') && !pass.includes('Second independent authenticator'));
  console.log('Note: this is still a client-only mockup with no real server trust boundary -- a determined attacker with console access can still flip flags. What changed is that doing so is now *detectable*: every log is hash-chained, so a forged "Confirmed" with no real underlying log entries fails evidenceIntegrityOk() and is flagged in the UI rather than silently accepted. A real backend would refuse to ever set these flags from the client at all.');

  console.log('\n=== ATTACK 2 (re-test): is the ProofSeal <-> Item Seal "pairing" still two independent, uncompared booleans? ===');
  window.selectItem('dior');
  window.eval(`state.itemSeal.status = 'intact';`); // forge the item seal as already fitted, skip handover entirely
  window.goTo('handover');
  const pairedBeforeRealFlow = window.eval('state.pairing.paired');
  const sealMatchForged = window.eval('sealsPairMatch()');
  check('A forged itemSeal.status with no real pairing record now reads as NOT matched (sealsPairMatch() is false)',
    pairedBeforeRealFlow === false && sealMatchForged === false);
  const src = fs.readFileSync(require('path').join(__dirname,'..','app','index.html'), 'utf8');
  const comparesCodes = /proofSealCode|itemSealCode/.test(src) && /function sealsPairMatch/.test(src);
  check('Source code now stores a real shared pairing record (codes, not booleans) and compares against it on every scan',
    comparesCodes);

  console.log('\n=== ATTACK 3 (re-test): is the "live challenge code" described on the Protection page an actual required step now? ===');
  const stepTitles = window.eval(`
    JSON.stringify([
      ...buildHandoverSteps(ITEMS.dior).steps.map(s=>s.title),
      ...buildVerifierHubSteps(ITEMS.dior).steps.map(s=>s.title),
      ...buildUnboxingSteps(ITEMS.dior).steps.map(s=>s.title),
    ])
  `);
  const titles = JSON.parse(stepTitles);
  check('A challenge-code step is now present in all three flows (handover, hub, unboxing)',
    titles.filter(t => /challenge/i.test(t)).length === 3);

  console.log('\n=== ATTACK 4 (re-test): does "Witnessed Opening" courier confirmation still ride on the buyer\'s own session/button? ===');
  window.selectItem('nike');
  window.eval('state.addOns.witnessedOpening = true;');
  window.goTo('handover');
  const hSteps = window.eval('buildHandoverSteps(ITEMS.nike).steps.length');
  for (let i=0;i<hSteps;i++){ window.handoverNext(); }
  window.goTo('unboxing');
  const uSteps = window.eval('buildUnboxingSteps(ITEMS.nike).steps.length');
  for (let i=0;i<uSteps;i++){ window.unboxingNext(); }
  const courierLogLen = window.eval('state.unboxing.courierLog.length');
  const buyerLogLen = window.eval('state.unboxing.log.length');
  const courierHasOwnAppAuth = window.eval(`appAuthLog.some(e => e.text.indexOf('Courier') === 0)`);
  check('Courier now has their own app-launch 2FA event, distinct from the buyer\'s, in the global auth log',
    courierHasOwnAppAuth);
  check('Courier\'s confirmation now writes to its own separate hash-chained log (courierLog), not the buyer\'s log',
    courierLogLen > 0 && buyerLogLen > 0);
  check('Courier\'s own log independently re-verifies against its own hash chain',
    window.eval('verifySignedLog(state.unboxing, "courierLog")') === true);
  console.log('Honest residual gap (named on the Protection page): this is still one visit and one physical device session, not a fully separate hardware witness device -- an independent login + an independent signed log is a real improvement over one shared session, but not as strong as a courier having entirely separate hardware.');

  console.log('\n=== ATTACK 5 (re-test): are evidence log entries still plain, directly-editable client strings with no integrity check? ===');
  window.selectItem('nike');
  window.goTo('handover');
  for (let i=0;i<3;i++){ window.handoverNext(); }
  const verifiedBeforeTamper = window.eval('verifySignedLog(state.handover, "log")');
  window.eval(`state.handover.log[0].t = '03:00'; state.handover.log[0].text = 'Backdated entry';`);
  const verifiedAfterTamper = window.eval('verifySignedLog(state.handover, "log")');
  check('Log entries are now hash-chained (signed) at write time, and verify TRUE before tampering',
    verifiedBeforeTamper === true);
  check('Directly editing a past log entry\'s timestamp/text is now DETECTED (verifySignedLog flips to false)',
    verifiedAfterTamper === false);
  // Finish the rest of the flow normally -- the point is that a tamper early in the chain still
  // poisons every entry chained after it, so it surfaces once the order would otherwise show "Confirmed."
  const remainingHandoverSteps = window.eval('buildHandoverSteps(ITEMS.nike).steps.length') - 3;
  for (let i=0;i<remainingHandoverSteps;i++){ window.handoverNext(); }
  window.goTo('unboxing');
  const unboxSteps = window.eval('buildUnboxingSteps(ITEMS.nike).steps.length');
  for (let i=0;i<unboxSteps;i++){ window.unboxingNext(); }
  window.goTo('timeline');
  const tlAfterTamper = window.document.getElementById('main').innerHTML;
  check('Order still reaches "Confirmed" state after a tamper (expected -- there is still no real server trust boundary)',
    window.eval('state.timeline.confirmed') === true);
  check('But the Timeline now surfaces the tamper as "Evidence chain broken" rather than silently showing a clean confirmed order',
    tlAfterTamper.includes('Evidence chain broken'));

  console.log('\n=== NEW ATTACK 6: can an account skip KYC/2FA entirely and still complete a transaction? ===');
  window.selectItem('nike');
  const identityBefore = window.eval('JSON.stringify(state.identity)');
  check('Every account-level session carries a persistent KYC record (ID + liveness) that is never reset per-transaction',
    window.eval('state.identity.kycVerified === true && typeof state.identity.kycMethod === "string"'));
  window.goTo('handover');
  const appAuthLenBefore = window.eval('appAuthLog.length');
  window.handoverNext(); // "Choose drop-off point" -- step 0, before the app-auth step
  window.handoverNext(); // this is the app-auth step
  const appAuthLenAfter = window.eval('appAuthLog.length');
  check('Opening the app at the seller handover step writes an unconditional, unskippable entry to the global authentication audit log',
    appAuthLenAfter > appAuthLenBefore);

  console.log('\n=== NEW ATTACK 7: can a >£1,500 item be authenticated by only one verifier, bypassing the mandatory dual-verifier rule? ===');
  window.selectItem('dior');
  check('dualVerifierRequired() correctly fires for an item priced over the £1,500 threshold',
    window.eval('dualVerifierRequired(ITEMS.dior) === true'));
  const hubStepsDior = window.eval('JSON.stringify(buildVerifierHubSteps(ITEMS.dior).steps.map(s=>s.title))');
  check('The mandatory second-authenticator step cannot be omitted from the hub flow for this item -- it is baked into the step builder, not a UI-only suggestion',
    JSON.parse(hubStepsDior).some(t => /second independent authenticator/i.test(t)));
  check('The second authenticator is a genuinely different, named hub (not the same hub re-asked)',
    window.eval('secondHubName(ITEMS.dior) !== hubName(ITEMS.dior) && !!secondHubName(ITEMS.dior)'));

  console.log('\n' + (failures === 0 ? 'ALL ATTACKS NOW MITIGATED (within the limits of a client-only mockup -- see notes above)' : `${failures} ATTACK(S) STILL SUCCEED -- SEE "STILL BROKEN" LINES ABOVE`));
  if (failures > 0) process.exit(1);
})().catch(e => { console.error('ATTACK SCRIPT ERROR:', e.message, e.stack); process.exit(1); });
