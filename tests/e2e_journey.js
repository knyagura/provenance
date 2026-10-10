// End-to-end journey: seller lists a product (camera -> details -> publish) ->
// buyer finds it live and buys it -> protection/shipping decisions apply -> full
// custody chain (handover -> [Verifier Hub if triggered] -> unboxing) -> confirmed.
// This is the one canonical, fully-driven journey requested for testability — every
// step is driven the way a real tap would (capturing photos before advancing past a
// photo-gated step, picking a shipping option before continuing to payment, etc.)
// rather than bypassing gates via direct function calls.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname,'..','app','index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const { window } = dom;

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function assert(cond, label){ if(!cond) throw new Error('FAILED: ' + label); console.log('OK:', label); }

// Drives a handover/hub/unboxing-style step flow exactly as a user would: taps the
// shutter on photo-gated steps before advancing, otherwise just advances.
function driveStepFlow(getContainer, getSteps, nextFn, screenId){
  let guard = 0;
  while(true){
    guard++; if(guard > 40) throw new Error('driveStepFlow exceeded step guard — likely stuck');
    const container = window.eval(getContainer);
    const steps = window.eval(getSteps);
    if(container.index >= steps.length) break;
    const step = steps[container.index];
    if(step.photo && !container.photoCaptured[container.index]){
      window.capturePhoto(container, container.index);
    }
    window[nextFn]();
    if(screenId) window.render(screenId);
  }
}

(async () => {
  await wait(300);
  try {
    // ---------- Seller: create and publish a first listing (high price -> dual-verifier journey) ----------
    window.eval("state.newListing = {photos:[]}");
    window.goTo('newlisting');
    window.capturePhotoForListing();
    window.capturePhotoForListing();
    assert(window.eval('state.newListing.photos.length') === 2, 'seller captured 2 product photos');

    window.goToListingDetailsStep();
    window.setListingField('title', 'E2E Test Heirloom Watch');
    window.setListingField('description', 'Running fine, light wear on the strap.');
    window.setListingField('category', 'designer');
    window.setListingField('price', '1800');
    window.goTo('newlisting');
    let main = window.document.getElementById('main').innerHTML;
    assert(main.includes('Ultra Luxury authentication'), 'price of £1800 derives Ultra Luxury tier automatically');
    assert(main.includes('Who should pay for those specifically'), 'payer choice surfaced because this price triggers extra fees');

    window.setProtectionPayer('buyer');
    window.createDraftListing();
    const itemId = window.eval("Object.keys(ITEMS).find(k=>ITEMS[k].title==='E2E Test Heirloom Watch')");
    assert(!!itemId, 'draft listing created');
    assert(window.eval(`ITEMS['${itemId}'].published`) === false, 'new listing starts unpublished (draft)');

    window.goTo('feed');
    main = window.document.getElementById('main').innerHTML;
    assert(!main.includes('E2E Test Heirloom Watch'), 'draft is not visible in the main marketplace feed yet');

    window.viewStorefront('you'); window.goTo('storefront');
    main = window.document.getElementById('main').innerHTML;
    assert(main.includes('>Publish<'), 'Manage Storefront shows a Publish action for the draft');
    window.publishListing(itemId);

    window.goTo('feed');
    main = window.document.getElementById('main').innerHTML;
    assert(main.includes('E2E Test Heirloom Watch'), 'published listing now appears live in the main feed');

    // ---------- Seller: list an additional, second product (lower price -> Enhanced tier) ----------
    window.eval("state.newListing = {photos:[]}");
    window.goTo('newlisting');
    window.capturePhotoForListing();
    window.goToListingDetailsStep();
    window.setListingField('title', 'E2E Test Spare Charger');
    window.setListingField('price', '15');
    window.goTo('newlisting');
    main = window.document.getElementById('main').innerHTML;
    assert(!main.includes('Who should pay for those specifically'), 'low price (Enhanced tier) does not surface a payer choice');
    window.createDraftListing();
    const secondId = window.eval("Object.keys(ITEMS).find(k=>ITEMS[k].title==='E2E Test Spare Charger')");
    assert(!!secondId, 'a second, additional listing was created successfully');

    // ---------- Buyer: discovers the published listing in the feed and buys it ----------
    window.goTo('feed');
    window.selectItem(itemId);
    window.goTo('item');
    main = window.document.getElementById('main').innerHTML;
    assert(main.includes('E2E Test Heirloom Watch'), 'buyer opened the published listing from the feed');
    const score1 = window.eval(`proofScore(ITEMS['${itemId}'])`).score;
    console.log('Proof Score before any custody steps:', score1);

    window.goTo('checkout');
    main = window.document.getElementById('main').innerHTML;
    assert(main.includes('disabled') && main.includes('Continue to payment'), 'checkout blocks continuing until a shipping option is chosen');
    window.setShippingChoice('free');
    window.goTo('checkout');
    main = window.document.getElementById('main').innerHTML;
    assert(!/disabled[^>]*>\s*Continue to payment/.test(main), 'checkout unblocks once a shipping option is picked');

    window.goTo('payment');
    window.selectPaymentMethod('visa');
    window.goTo('payment');
    window.confirmPurchase();
    assert(window.eval('state.timeline.purchased') === true, 'order purchased and payment confirmed');

    // ---------- Seller handover (camera-gated), driven like a real user tapping through ----------
    window.render('handover');
    driveStepFlow(
      'state.handover',
      `buildHandoverSteps(ITEMS['${itemId}']).steps`,
      'handoverNext',
      'handover'
    );
    assert(window.eval('state.timeline.handedOver') === true, 'seller handover completed, camera-gated steps included');

    // ---------- Verifier Hub (this price triggers it) ----------
    const needsHub = window.eval(`ITEMS['${itemId}'].verifierHub`) === true;
    assert(needsHub === true, 'this £1,800 item correctly routes through the Verifier Hub');
    window.goTo('verifierhub');
    driveStepFlow(
      'state.verifierHub',
      `buildVerifierHubSteps(ITEMS['${itemId}']).steps`,
      'verifierHubNext',
      'verifierhub'
    );
    assert(window.eval('state.timeline.resealed') === true, 'Verifier Hub leg completed (both authenticators, since price exceeds the dual-verifier threshold)');
    assert(window.eval('state.timeline.secondHubAuthenticated') === true, 'mandatory second independent authenticator ran for this price');

    // ---------- Buyer unboxing (camera-gated) ----------
    window.goTo('unboxing');
    driveStepFlow(
      'state.unboxing',
      `buildUnboxingSteps(ITEMS['${itemId}']).steps`,
      'unboxingNext',
      'unboxing'
    );
    assert(window.eval('state.timeline.confirmed') === true, 'buyer completed Protected Unboxing; order confirmed');

    // ---------- Final checks: evidence integrity, Timeline, Proof Score ----------
    window.goTo('timeline');
    main = window.document.getElementById('main').innerHTML;
    assert(!main.includes('Evidence chain broken'), 'Timeline shows no broken-evidence warning');
    assert(window.eval(`evidenceIntegrityOk(ITEMS['${itemId}'])`) === true, 'full evidence chain re-verifies cleanly end to end');

    const finalScore = window.eval(`proofScore(ITEMS['${itemId}'])`).score;
    console.log('Proof Score after the full journey:', finalScore);
    assert(finalScore === 100, 'Proof Score reaches 100/100 once the entire journey completes');

    console.log('\nALL END-TO-END JOURNEY CHECKS PASSED');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
