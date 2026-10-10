const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname,'..','app','index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const { window } = dom;

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(300); // let inline scripts + DOMContentLoaded run

  const errors = [];
  const origErr = window.console.error;
  window.console.error = (...a) => { errors.push(a.join(' ')); origErr(...a); };

  function assert(cond, label) {
    if (!cond) throw new Error('FAILED: ' + label);
    console.log('OK:', label);
  }

  // Sanity: core globals exist
  assert(typeof window.selectItem === 'function', 'selectItem exists');
  assert(typeof window.goTo === 'function', 'goTo exists');
  assert(typeof window.handoverNext === 'function', 'handoverNext exists');
  assert(typeof window.verifierHubNext === 'function', 'verifierHubNext exists');
  assert(typeof window.unboxingNext === 'function', 'unboxingNext exists');
  assert(typeof window.eval('launchApp') === 'function', 'launchApp exists');
  assert(typeof window.eval('verifyAppAuthLog') === 'function', 'verifyAppAuthLog exists');
  assert(typeof window.eval('dualVerifierRequired') === 'function', 'dualVerifierRequired exists');
  assert(typeof window.eval('evidenceIntegrityOk') === 'function', 'evidenceIntegrityOk exists');
  assert(typeof window.eval('weightMismatchFlag') === 'function', 'weightMismatchFlag exists');
  assert(typeof window.eval('sealsPairMatch') === 'function', 'sealsPairMatch exists');

  // Identity layer persists globally and is not wiped by selectItem/freshState
  assert(window.eval('state.identity.kycVerified') === true, 'global KYC identity present before any item selected');
  assert(window.eval('ITEMS.dior.price') > 1500, 'dior price is over the £1,500 dual-verifier threshold');
  assert(window.eval('dualVerifierRequired(ITEMS.dior)') === true, 'dior requires dual verification');
  assert(window.eval('dualVerifierRequired(ITEMS.nike)') === false, 'nike (no verifier hub) does not require dual verification');

  // ---- Non-hub item (nike) full regression run ----
  window.selectItem('nike');
  window.goTo('item');
  window.goTo('checkout');
  window.goTo('handover');
  const nikeHandoverHtml = window.document.getElementById('main').innerHTML;
  assert(nikeHandoverHtml.includes('Item Seal'), 'nike handover shows Item Seal row (pairedSeals item)');
  assert(nikeHandoverHtml.includes("verify it's you"), 'nike handover includes a 2FA app-auth step');
  const nikeHandoverSteps = window.eval('buildHandoverSteps(ITEMS.nike).steps.length');
  for (let i = 0; i < nikeHandoverSteps; i++) { window.handoverNext(); }
  assert(window.eval('state.timeline.handedOver') === true, 'nike handover completed');
  assert(window.eval('state.identity.kycVerified') === true, 'identity still intact after switching/completing nike handover');
  assert(window.eval('verifyAppAuthLog()') === true, 'authentication audit log verifies cleanly after nike handover');

  window.goTo('unboxing');
  assert(!window.document.getElementById('main').innerHTML.includes('Nothing to unbox yet'), 'nike unboxing is ready after handover');
  const nikeUnboxHtml1 = window.document.getElementById('main').innerHTML;
  assert(nikeUnboxHtml1.includes("don't cut it"), 'nike unboxing warns not to cut the Item Seal early');
  const nikeUnboxSteps = window.eval('buildUnboxingSteps(ITEMS.nike).steps.length');
  for (let i = 0; i < nikeUnboxSteps; i++) { window.unboxingNext(); }
  const nikeUnboxHtmlFinal = window.document.getElementById('main').innerHTML;
  assert(nikeUnboxHtmlFinal.includes('Photographed still attached'), 'nike unboxing records the Item Seal photo at completion');
  assert(window.eval('state.timeline.confirmed') === true, 'nike order confirmed');
  assert(window.eval('evidenceIntegrityOk(ITEMS.nike)') === true, 'nike evidence chain verifies cleanly end to end');

  window.goTo('timeline');
  const nikeTlHtml = window.document.getElementById('main').innerHTML;
  assert(!nikeTlHtml.includes('arrivedAtVerifier'), 'nike timeline has no raw hub key leakage');
  assert(!nikeTlHtml.includes('Arrived at Verifier Hub'), 'nike timeline does not show hub-only steps');
  assert(!nikeTlHtml.includes('Second authenticator reviewed'), 'nike timeline does not show the dual-verifier-only row');
  assert(!nikeTlHtml.includes('Evidence chain broken'), 'nike timeline shows no broken-chain warning on a clean run');
  window.goTo('passport');
  window.goTo('protection');
  const protHtmlForNike = window.document.getElementById('main').innerHTML;
  assert(protHtmlForNike.includes('Identity &amp; access') || protHtmlForNike.includes('Identity & access'), 'protection page has an Identity & access section');
  assert(protHtmlForNike.includes('bank-style'), 'protection page describes bank-style KYC');
  assert(protHtmlForNike.includes('Every launch is audited, always'), 'protection page describes always-on auth audit log');
  window.goTo('disputes');

  // ---- Hub item (dior) full two-leg run, including mandatory dual verification ----
  window.selectItem('dior');
  window.goTo('item');
  assert(window.document.getElementById('main').innerHTML.includes('Meridian Authentication Partners'), 'dior item page names the primary Verifier Hub');
  window.goTo('checkout');
  const diorCheckoutHtml = window.document.getElementById('main').innerHTML;
  assert(diorCheckoutHtml.includes('Verifier Hub fee'), 'checkout shows Verifier Hub fee line');
  assert(window.eval('fees(ITEMS.dior).verifier') === 44, 'dior (dual-verifier required) is charged the doubled £44 verifier fee');

  window.goTo('verifierhub');
  assert(window.document.getElementById('main').innerHTML.includes('Nothing to verify yet'), 'verifier hub blocks before handover done');

  window.goTo('handover');
  assert(window.document.getElementById('main').innerHTML.includes('Verifier Hub'), 'dior handover steps reference the hub');
  const diorHandoverSteps = window.eval('buildHandoverSteps(ITEMS.dior).steps.length');
  for (let i = 0; i < diorHandoverSteps; i++) { window.handoverNext(); window.render('handover'); }
  assert(window.document.getElementById('main').innerHTML.includes('Continue to Verifier Hub'), 'dior handover completed, routes to hub');

  window.goTo('unboxing');
  assert(window.document.getElementById('main').innerHTML.includes('Nothing to unbox yet'), 'unboxing still blocked before hub resealed');

  window.goTo('verifierhub');
  const hubHtml1 = window.document.getElementById('main').innerHTML;
  assert(hubHtml1.includes('Scan the paired Item Seal'), 'verifier hub step list includes Item Seal check');
  assert(hubHtml1.includes('Second independent authenticator'), 'verifier hub step list includes the mandatory second authenticator step for dior');
  const diorHubSteps = window.eval('buildVerifierHubSteps(ITEMS.dior).steps.length');
  for (let i = 0; i < diorHubSteps; i++) { window.verifierHubNext(); window.render('verifierhub'); }
  const hubHtmlFinal = window.document.getElementById('main').innerHTML;
  assert(hubHtmlFinal.includes('Continue to buyer unboxing'), 'verifier hub flow completed');
  assert(hubHtmlFinal.includes('stays with the item'), 'verifier hub confirms Item Seal left untouched');
  assert(window.eval('state.timeline.secondHubAuthenticated') === true, 'second hub authentication flag set for dior');

  window.goTo('unboxing');
  assert(!window.document.getElementById('main').innerHTML.includes('Nothing to unbox yet'), 'unboxing unlocked after reseal');
  assert(window.document.getElementById('main').innerHTML.includes('Meridian Authentication Partners'), 'unboxing notes hub-issued seal');
  const diorUnboxSteps = window.eval('buildUnboxingSteps(ITEMS.dior).steps.length');
  for (let i = 0; i < diorUnboxSteps; i++) { window.unboxingNext(); }
  assert(window.document.getElementById('main').innerHTML.includes('Photographed still attached'), 'dior unboxing records Item Seal photo at completion');
  assert(window.eval('evidenceIntegrityOk(ITEMS.dior)') === true, 'dior full dual-verifier evidence chain verifies cleanly end to end');

  window.goTo('timeline');
  const tlHtml = window.document.getElementById('main').innerHTML;
  assert(tlHtml.includes('Arrived at Verifier Hub'), 'dior timeline shows hub arrival step');
  assert(tlHtml.includes('Independently authenticated'), 'dior timeline shows authentication step');
  assert(tlHtml.includes('Second authenticator reviewed'), 'dior timeline shows the mandatory second-authenticator step');
  assert(tlHtml.includes('Re-sealed for final leg'), 'dior timeline shows reseal step');
  assert(!tlHtml.includes('Evidence chain broken'), 'dior timeline shows no broken-chain warning on a clean run');

  window.goTo('passport');
  const passHtml = window.document.getElementById('main').innerHTML;
  assert(passHtml.includes('Independent authentication'), 'dior passport has independent authentication entry');
  assert(passHtml.includes('Second independent authenticator'), 'dior passport has the second-authenticator entry');
  assert(passHtml.includes('Meridian Authentication Partners'), 'dior passport names the primary hub');
  assert(passHtml.includes('Northgate Provenance Labs'), 'dior passport names the second, independent hub');

  window.goTo('protection');
  const protHtml = window.document.getElementById('main').innerHTML;
  assert(protHtml.includes('Verifier Hub'), 'protection page luxury row mentions Verifier Hub');
  assert(protHtml.includes('Guarding against AI-generated evidence'), 'protection page has AI-fraud mitigation section');
  assert(protHtml.includes('Two seals, bound as one real pair'), 'protection page explains the bound seal-pairing record');
  assert(protHtml.includes('Hash-chained evidence logs'), 'protection page explains hash-chained evidence logs');
  assert(protHtml.includes('Witnessed Packing'), 'protection page mentions Witnessed Packing');
  assert(protHtml.includes('1,500'), 'protection page states the £1,500 dual-verifier threshold');
  assert(protHtml.includes('Preserving evidence, not just capturing it'), 'protection page explains do-not-remove evidence rule');

  // ---- Witnessed Opening + Witnessed Packing add-ons together (nike) ----
  window.selectItem('nike');
  window.goTo('item');
  window.goTo('checkout');
  const checkoutHtmlBefore = window.document.getElementById('main').innerHTML;
  assert(checkoutHtmlBefore.includes('Witnessed Opening'), 'checkout shows Witnessed Opening add-on panel');
  assert(checkoutHtmlBefore.includes('Witnessed Packing'), 'checkout shows Witnessed Packing add-on panel');
  assert(window.eval('state.addOns.witnessedOpening') === false, 'witnessedOpening starts off');
  assert(window.eval('state.addOns.witnessedPacking') === false, 'witnessedPacking starts off');
  window.toggleWitnessedOpening();
  window.toggleWitnessedPacking();
  assert(window.eval('state.addOns.witnessedOpening') === true, 'witnessedOpening toggled on');
  assert(window.eval('state.addOns.witnessedPacking') === true, 'witnessedPacking toggled on');
  const checkoutHtmlAfter = window.document.getElementById('main').innerHTML;
  assert(checkoutHtmlAfter.includes('Witnessed Opening fee'), 'checkout ledger shows Witnessed Opening fee row once added');
  assert(checkoutHtmlAfter.includes('Witnessed Packing fee'), 'checkout ledger shows Witnessed Packing fee row once added');

  window.goTo('handover');
  const handoverHtmlWitnessed = window.document.getElementById('main').innerHTML;
  assert(handoverHtmlWitnessed.includes('attendant'), 'handover with Witnessed Packing on mentions the attendant');
  const nikeHandoverStepsWP = window.eval('buildHandoverSteps(ITEMS.nike).steps.length');
  for (let i = 0; i < nikeHandoverStepsWP; i++) { window.handoverNext(); }
  assert(window.eval('verifySignedLog(state.handover, "attendantLog")') === true, 'attendant log verifies cleanly after Witnessed Packing run');

  window.goTo('unboxing');
  const witnessUnboxHtml1 = window.document.getElementById('main').innerHTML;
  assert(witnessUnboxHtml1.includes('Witnessed Opening — the courier stays and co-confirms'), 'unboxing shows Witnessed Opening chip');
  assert(witnessUnboxHtml1.includes("Courier opens their own Provenance App"), 'unboxing step list includes the courier\'s own 2FA app-launch step');
  const nikeUnboxStepsWO = window.eval('buildUnboxingSteps(ITEMS.nike).steps.length');
  for (let i = 0; i < nikeUnboxStepsWO; i++) { window.unboxingNext(); }
  const witnessUnboxHtmlFinal = window.document.getElementById('main').innerHTML;
  assert(witnessUnboxHtmlFinal.includes('Photographed still attached'), 'nike+witness unboxing still records Item Seal photo at completion');
  assert(witnessUnboxHtmlFinal.includes("courier’s own authenticated session") || witnessUnboxHtmlFinal.includes("courier's own authenticated session"), 'courier witness confirmation logged at completion, from its own session');
  assert(window.eval('state.unboxing.courierLog.length') > 0, 'courier has its own separate evidence log with entries');
  assert(window.eval('state.unboxing.courierLog.length !== state.unboxing.log.length || state.unboxing.courierLog !== state.unboxing.log'), 'courier log is a genuinely separate array from the buyer log');
  assert(window.eval('verifySignedLog(state.unboxing, "courierLog")') === true, "courier's own hash-chained log verifies cleanly");
  assert(window.eval('evidenceIntegrityOk(ITEMS.nike)') === true, 'nike with both witness add-ons still verifies cleanly end to end');

  const protHtmlWitness = (window.goTo('protection'), window.document.getElementById('main').innerHTML);
  assert(protHtmlWitness.includes('Witnessed Opening (optional, £7.50)'), 'protection page AI-fraud section mentions Witnessed Opening add-on');
  assert(protHtmlWitness.includes('Witnessed Packing (optional, £4.50)'), 'protection page AI-fraud section mentions Witnessed Packing add-on');

  // toggle back off so it doesn't leak into other item flows (defensive, not strictly required since selectItem resets state)
  window.toggleWitnessedOpening();
  window.toggleWitnessedPacking();

  // ---- tee item (standard) regression ----
  window.selectItem('tee');
  window.goTo('item');
  window.goTo('checkout');
  const teeCheckoutHtml = window.document.getElementById('main').innerHTML;
  assert(!teeCheckoutHtml.includes('Witnessed Opening'), 'tee (not sealEligible) does not show Witnessed Opening add-on');
  assert(!teeCheckoutHtml.includes('Witnessed Packing'), 'tee (not sealEligible) does not show Witnessed Packing add-on');
  window.goTo('protection');

  // ---- Identity/2FA audit log is global and persists across item switches ----
  const auditLenAfterAll = window.eval('appAuthLog.length');
  assert(auditLenAfterAll > 0, 'authentication audit log accumulated entries across the whole session');
  assert(window.eval('verifyAppAuthLog()') === true, 'authentication audit log still verifies cleanly after the full session');
  assert(window.eval('state.identity.kycVerified') === true, 'global identity survived every selectItem() call made during this run');

  if (errors.length) {
    console.log('CONSOLE ERRORS CAPTURED:', errors);
    process.exit(1);
  }
  console.log('\nALL SMOKE TESTS PASSED');
})().catch(e => {
  console.error('SMOKE TEST FAILURE:', e.message);
  console.error(e.stack);
  process.exit(1);
});
