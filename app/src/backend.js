/* ============== BACKEND (Supabase) — accounts, listings, orders ==============
   Source of truth for this block: app/src/backend.js. tools/build.py inlines it (plus the
   vendored supabase-js UMD bundle) into app/index.html between the BACKEND markers, so the
   app stays a single self-contained file with no runtime dependency on a CDN.

   Design rules:
   - Signed OUT  = the original demo, completely unchanged (local in-memory state only).
   - Signed IN   = your listings and purchases are real rows in Supabase, visible across devices.
   - Everything here wraps the existing prototype functions rather than editing them, so the
     jsdom regression suite (which never signs in) exercises exactly the code it always did.
   - Other people's data is untrusted: every string from the database is neutralised before it
     can reach innerHTML or an inline onclick (see clean()).
   - The custody/evidence chain itself still runs client-side and syncs via orders.timeline_state
     (deliberately deferred server-side validation — see docs/provenance-product-update.md §6). */
const PROVENANCE_CONFIG = Object.assign({
  supabaseUrl: 'https://tkjmnivvcrcqkqjywafb.supabase.co',
  // Publishable (public) key — safe in client code; Row Level Security decides what it can touch.
  // NEVER put a secret / service_role key here.
  supabaseKey: 'sb_publishable_LTjW96u1jivRuw1QPaSslw_OP-mrKxV',
}, window.PROVENANCE_CONFIG_OVERRIDE || {});   // tests / local dev: point at tests/mock_supabase.mjs

const PV = {
  client: null, enabled: false, session: null, user: null, profile: null,
  orders: [], loading: false, lastError: null, authMode: 'signin', authMsg: null,
  currentScreen: 'feed', syncTimer: null, reloadTimer: null, busy: false,
};

/* ---------- untrusted-data hygiene ---------- */
// Makes a value safe in BOTH an HTML text context and inside a single/double-quoted inline
// onclick string (the prototype uses both). Quotes become typographic equivalents.
function clean(v, max){
  if(v===null || v===undefined) return '';
  let s = String(v).slice(0, max || 2000);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/'/g,'’').replace(/"/g,'”').replace(/`/g,'ʼ').replace(/\\/g,'/');
}
function cleanUsername(v){
  let s = String(v||'').toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0, 30);
  if(!/[a-z]/.test(s)) s = 'u' + s;
  return s;
}
function safePhoto(p){
  return (typeof p==='string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)) ? p : null;
}
function safeColour(c){ return (typeof c==='string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : null; }
// Custody state written by the other party: neutralise markup everywhere. Log entries keep their
// quotes (their text is hash-chained, so changing it would falsely break verification) but lose
// < and >, which genuine app-generated entries never contain — a tampered entry fails its hash.
function cleanCustody(v, inLog){
  if(typeof v === 'string'){
    const s = v.slice(0, 4000).replace(/</g,'‹').replace(/>/g,'›');
    return inLog ? s : s.replace(/'/g,'’').replace(/"/g,'”').replace(/`/g,'ʼ').replace(/\\/g,'/');
  }
  if(Array.isArray(v)) return v.slice(0, 200).map(x=>cleanCustody(x, inLog));
  if(v && typeof v === 'object'){
    const out = {};
    const isLogEntry = 'sig' in v && 'text' in v;
    for(const k of Object.keys(v).slice(0, 100)){
      if(k==='__proto__' || k==='constructor' || k==='prototype') continue;
      out[k] = cleanCustody(v[k], inLog || isLogEntry);
    }
    return out;
  }
  return (typeof v==='number' || typeof v==='boolean' || v===null) ? v : null;
}

/* ---------- setup ---------- */
function backendInit(){
  try{
    if(typeof window.supabase === 'undefined' || !window.supabase.createClient) return;
    if(typeof fetch !== 'function' || /jsdom/i.test(navigator.userAgent)) return; // test runners: stay in demo mode
    if(!PROVENANCE_CONFIG.supabaseUrl || !PROVENANCE_CONFIG.supabaseKey) return;
    PV.client = window.supabase.createClient(PROVENANCE_CONFIG.supabaseUrl, PROVENANCE_CONFIG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    PV.enabled = true;
  }catch(e){ console.warn('[backend] init failed — staying in demo mode', e); return; }

  PV.client.auth.onAuthStateChange((event, session)=>{
    const wasIn = !!PV.user;
    PV.session = session; PV.user = session ? session.user : null;
    if(PV.user && !wasIn){ PV.authMsg = null; afterSignIn(); }
    if(!PV.user && wasIn){ afterSignOut(); }
    if(event==='INITIAL_SESSION' && !PV.user) backendReload();
  });
  // Live updates: other people's listings, and both sides of your orders.
  try{
    PV.client.channel('provenance-live')
      .on('postgres_changes', {event:'*', schema:'public', table:'listings'}, ()=> scheduleReload())
      .on('postgres_changes', {event:'*', schema:'public', table:'orders'}, ()=> scheduleReload())
      .subscribe();
  }catch(e){ /* Realtime unavailable — focus/refresh still keeps data fresh */ }
  window.addEventListener('focus', ()=> scheduleReload());
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) scheduleReload(); });
}
function isSignedIn(){ return !!(PV.enabled && PV.user); }
function myUid(){ return PV.user ? PV.user.id : null; }

async function afterSignIn(){
  await loadProfile();
  await backendReload();
  if(PV.currentScreen==='account'){ viewStorefront(MY_SELLER_ID); goTo('storefront'); }
  showToast(`Signed in as ${PV.profile ? PV.profile.username : PV.user.email}.`);
}
function afterSignOut(){
  PV.profile = null; PV.orders = [];
  dropRemoteItems();
  SELLERS[MY_SELLER_ID].username = MY_SELLER_ID;
  if(state.orderId){ selectItem('nike'); }
  backendReload();
  refreshIfSafe(true);
}

async function loadProfile(){
  if(!isSignedIn()) return;
  const {data, error} = await PV.client.from('profiles').select('*').eq('id', myUid()).maybeSingle();
  if(error){ PV.lastError = error.message; return; }
  PV.profile = data || {username: cleanUsername((PV.user.email||'me').split('@')[0])};
  const me = SELLERS[MY_SELLER_ID];
  me.displayName = cleanUsername(PV.profile.username);
  me.bio = clean(PV.profile.bio || me.bio, 500);
  if(PV.profile.created_at) me.joinedDate = monthYear(PV.profile.created_at);
}
function monthYear(iso){
  try{ return new Date(iso).toLocaleDateString('en-GB', {month:'short', year:'numeric'}); }catch(e){ return ''; }
}

/* ---------- loading remote listings / orders into the prototype's model ---------- */
function dropRemoteItems(){
  for(const k of Object.keys(ITEMS)) if(ITEMS[k].live) delete ITEMS[k];
  for(const k of Object.keys(SELLERS)) if(SELLERS[k].live) delete SELLERS[k];
}
function scheduleReload(){
  if(!PV.enabled) return;
  clearTimeout(PV.reloadTimer);
  PV.reloadTimer = setTimeout(()=> backendReload(), 350);
}
async function backendReload(){
  if(!PV.enabled || PV.loading) return;
  PV.loading = true;
  try{
    const {data: rows, error} = await PV.client.from('listings').select('*').order('created_at', {ascending:false}).limit(300);
    if(error) throw error;
    const sellerIds = [...new Set(rows.map(r=>r.seller_id))];
    let profiles = [];
    if(sellerIds.length){
      const res = await PV.client.from('profiles').select('id,username,bio,kyc_verified,is_pro,created_at').in('id', sellerIds);
      if(res.error) throw res.error;
      profiles = res.data;
    }
    let orders = [];
    if(isSignedIn()){
      const res = await PV.client.from('orders').select('*').order('created_at', {ascending:false}).limit(200);
      if(res.error) throw res.error;
      orders = res.data;
    }
    dropRemoteItems();
    const byId = Object.fromEntries(profiles.map(p=>[p.id, p]));
    for(const p of profiles) if(p.id !== myUid()) mapSeller(p);
    for(const r of rows) mapListing(r, byId[r.seller_id]);
    // Real listings first (newest first, as queried), then the demo catalogue.
    for(const [k, v] of Object.entries(ITEMS)) if(!v.live){ delete ITEMS[k]; ITEMS[k] = v; }
    const prev = PV.orders;
    PV.orders = orders;
    PV.lastError = null;
    applyRemoteOrderUpdate(prev);
  }catch(e){
    PV.lastError = (e && e.message) || String(e);
    console.warn('[backend] reload failed', e);
  }finally{
    PV.loading = false;
  }
  refreshIfSafe();
}
function sellerKey(p){
  let u = cleanUsername(p && p.username);
  if(SELLERS[u] && !SELLERS[u].live) u = u + '-1';   // never shadow a demo seller
  return u;
}
function mapSeller(p){
  const u = sellerKey(p);
  SELLERS[u] = {
    live:true, uid:p.id, username:u, location:'United Kingdom', joinedDate: monthYear(p.created_at),
    lastSeenLabel:'', bio: clean(p.bio || 'New to Provenance.', 500),
    followers:0, following:0, verifiedInfo:{google:false, email:true, phone:false},
    kycVerified: !!p.kyc_verified, salesCount:0,
    memberReviews:{avg:0, count:0}, autoReviews:{avg:0, count:0},
    responseTimeLabel:'', accountType: p.is_pro ? 'pro' : 'personal',
    discountRules:{bundle2:0, bundle3:0}, isBoosted:false, boostExpiresAt:null,
  };
  return u;
}
const TIERS = ['enhanced','verified','luxury','ultraLuxury'];
function mapListing(r, profile){
  const mine = r.seller_id === myUid();
  const tier = TIERS.includes(r.tier) ? r.tier : 'enhanced';
  const photos = Array.isArray(r.photos) ? r.photos : [];
  const photo = photos.map(safePhoto).find(Boolean) || null;
  const swatch = photos.map(safeColour).find(Boolean) || '#D6CDB8';
  const seller = mine ? MY_SELLER_ID : (profile ? sellerKey(profile) : 'unknown');
  if(!mine && !SELLERS[seller]) mapSeller(profile || {id:r.seller_id, username:'unknown'});
  const status = ['active','reserved','sold'].includes(r.status) ? r.status : 'active';
  const sealEligible = tier !== 'enhanced';
  const id = 'L-' + r.id;
  ITEMS[id] = {
    id, live:true, remoteId:r.id, sellerUid:r.seller_id,
    itemId: clean(r.item_code || ('IT-' + r.id.slice(0,8).toUpperCase()), 40),
    title: clean(r.title, 120), brand: clean(r.brand || '', 60),
    price: (r.price_pence||0)/100, shipping: (r.shipping_pence==null ? 295 : r.shipping_pence)/100,
    tier, authenticated: tier !== 'enhanced',
    seller, condition: clean(r.description || 'Not yet described', 600),
    conditionLabel: clean(r.condition_label || 'Good', 40), category: clean(r.category || 'home', 30),
    swatch, photo, photoCredit: photo ? 'Photo: seller' : '',
    allPhotos: photos.map(safePhoto).filter(Boolean),
    sealEligible, pairedSeals: sealEligible, sealAnchor:'the item',
    verifierHub: tier==='luxury' || tier==='ultraLuxury', expectedWeightKg:0.5,
    views: r.views||0, favourites: r.favourites||0, status,
    // Someone else's sold item drops out of the feed, but stays loadable for its order.
    published: !!r.published && (mine || status==='active'),
    photographed: true,
    protectionPayer: tier!=='enhanced' ? (r.protection_payer==='seller' ? 'seller' : 'buyer') : undefined,
  };
  return id;
}

/* ---------- re-render without breaking a live camera ---------- */
const PASSIVE_SCREENS = ['feed','storefront','inbox','account','timeline','passport','item'];
function refreshIfSafe(force){
  if(typeof activeCameraStream !== 'undefined' && activeCameraStream) return;
  if(!force && !PASSIVE_SCREENS.includes(PV.currentScreen)) return;
  const a = document.activeElement;
  if(!force && a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && document.getElementById('main').contains(a)) return; // don't wipe half-typed input
  if(PV.currentScreen==='item' && !ITEMS[state.activeItemId]) return;
  render(PV.currentScreen);
}

/* ---------- photos: downscale before storing ---------- */
function downscalePhoto(dataUrl, maxDim, quality){
  return new Promise(resolve=>{
    if(!safePhoto(dataUrl)) return resolve(dataUrl);
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, (maxDim||900) / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width*scale); c.height = Math.round(img.height*scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality||0.72));
    };
    img.onerror = ()=> resolve(null);
    img.src = dataUrl;
  });
}
function newUuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/* ---------- wrapped prototype actions ---------- */
const _orig = {
  render, selectItem, createDraftListing, publishListing, setListingStatus, hideListing,
  confirmPurchase, renderStorefront, renderFeed, cardHtml, renderTimeline,
  handoverNext, verifierHubNext, unboxingNext,
};

render = function(screenId){
  PV.currentScreen = screenId;
  if(screenId==='account'){ document.getElementById('main').innerHTML = renderAccount(); return; }
  if(screenId==='inbox'){ document.getElementById('main').innerHTML = renderInbox(); return; }
  // On a live order, each person only performs their own leg of the custody chain.
  if(state.orderId && ((screenId==='handover' && state.orderRole!=='seller') || (screenId==='unboxing' && state.orderRole!=='buyer'))){
    const who = screenId==='handover' ? 'seller' : 'buyer';
    document.getElementById('main').innerHTML = `
      <div class="eyebrow">Live order</div>
      <h1 class="page-title">This step is for the ${who}</h1>
      <p class="page-sub">On a live order, the ${who} completes this on their own phone. You’ll see their progress here and in your Inbox as soon as they do.</p>
      <div class="btn-row"><button class="btn" onclick="goTo('timeline')">View timeline</button><button class="btn btn--ghost" onclick="goTo('inbox')">All orders</button></div>`;
    return;
  }
  return _orig.render(screenId);
};

selectItem = function(id){
  _orig.selectItem(id);
  state.orderId = null; state.orderRole = null;
};

createDraftListing = function(){
  if(!isSignedIn()) return _orig.createDraftListing();
  const nl = state.newListing;
  if(!nl || nl.photos.length===0 || !nl.title || !nl.title.trim()) return _orig.createDraftListing();
  const photos = nl.photos.slice();
  const fields = {title:nl.title.trim(), description:(nl.description||'').trim(), category:nl.category||'home', payer:nl.protectionPayer};
  const before = new Set(Object.keys(ITEMS));
  _orig.createDraftListing();                          // builds the local item exactly as before + navigates
  const localKey = Object.keys(ITEMS).find(k=>!before.has(k));
  if(!localKey) return;
  const it = ITEMS[localKey];
  const uuid = newUuid();
  // Re-key the draft to its permanent database id straight away (optimistic), then save.
  delete ITEMS[localKey];
  it.id = 'L-'+uuid; it.live = true; it.remoteId = uuid; it.sellerUid = myUid(); it.saving = true;
  ITEMS[it.id] = it;
  render('storefront');
  (async ()=>{
    const stored = [];
    for(const p of photos) stored.push(isRealPhoto(p) ? await downscalePhoto(p, 900, 0.72) : p);
    const real = stored.filter(p=>safePhoto(p));
    if(real.length){ it.photo = real[0]; it.photoCredit = 'Photo: seller'; it.swatch = '#D6CDB8'; }
    const {error} = await PV.client.from('listings').insert({
      id: uuid, seller_id: myUid(), title: fields.title, description: fields.description || null,
      price_pence: Math.round(it.price*100), category: fields.category, condition_label: it.conditionLabel,
      tier: it.tier, photos: stored.filter(Boolean), published: false, item_code: it.itemId,
      shipping_pence: Math.round(it.shipping*100), protection_payer: fields.payer==='seller' ? 'seller' : 'buyer',
    });
    it.saving = false;
    if(error){
      delete ITEMS[it.id];
      showToast('Could not save your listing: ' + error.message);
    }else{
      showToast('Draft saved to your account. Publish it from your storefront when ready.');
    }
    refreshIfSafe();
  })();
};

async function remoteUpdateListing(id, patch, okMsg){
  const it = ITEMS[id];
  if(!it || !it.live || !isSignedIn()) return true;
  const {error} = await PV.client.from('listings').update(patch).eq('id', it.remoteId);
  if(error){ showToast('Could not update listing: ' + error.message); scheduleReload(); return false; }
  if(okMsg) showToast(okMsg);
  return true;
}
publishListing = function(id){
  _orig.publishListing(id);
  if(ITEMS[id] && ITEMS[id].live) remoteUpdateListing(id, {published:true}, 'Published — live for everyone, on every device.');
};
setListingStatus = function(id, status){
  _orig.setListingStatus(id, status);
  if(ITEMS[id] && ITEMS[id].live) remoteUpdateListing(id, {status});
};
hideListing = function(id){
  const it = ITEMS[id];
  if(!it || !it.live) return _orig.hideListing(id);
  (async ()=>{
    const {error} = await PV.client.from('listings').delete().eq('id', it.remoteId);
    if(error){
      showToast(/foreign key|RESTRICT/i.test(error.message) ? "This item has an order, so it can't be deleted." : 'Could not delete: ' + error.message);
    }else{
      delete ITEMS[id]; showToast('Listing deleted.');
    }
    refreshIfSafe();
  })();
};

/* ---------- orders ---------- */
const CUSTODY_KEYS = ['timeline','proofSeal','proofSealB','itemSeal','pairing','addOns','verifierAssignment','handover','verifierHub','unboxing','payment','shippingChoice'];
function serializeCustody(){
  const o = {};
  for(const k of CUSTODY_KEYS) o[k] = JSON.parse(JSON.stringify(state[k] === undefined ? null : state[k]));
  return o;
}
function deriveOrderStatus(it){
  const t = state.timeline;
  if(t.confirmed) return 'confirmed';
  if(t.handedOver && it.verifierHub && !t.resealed) return 'hub';
  if(t.handedOver) return 'unboxing';
  if(state.handover.index > 0) return 'handover';
  return 'purchased';
}

confirmPurchase = function(){
  const it = activeItem();
  if(!it || !it.live) return _orig.confirmPurchase();
  if(!isSignedIn()){ showToast('Sign in to buy this item — it’s a real listing.'); goTo('account'); return; }
  if(it.sellerUid === myUid()){ showToast("You can't buy your own listing."); return; }
  if(PV.busy) return;
  PV.busy = true;
  state.timeline.purchased = true;
  const f = fees(it);
  (async ()=>{
    const {data, error} = await PV.client.from('orders').insert({
      listing_id: it.remoteId, buyer_id: myUid(), seller_id: it.sellerUid,
      price_pence: Math.round(it.price*100), protection_payer: it.protectionPayer==='seller' ? 'seller' : 'buyer',
      shipping_choice: state.shippingChoice==='paid' ? 'paid' : 'free',
      fees: JSON.parse(JSON.stringify(f)), status: 'purchased', timeline_state: serializeCustody(),
    }).select().single();
    PV.busy = false;
    if(error){
      state.timeline.purchased = false;
      showToast('Purchase failed: ' + error.message);
      scheduleReload();
      return;
    }
    state.orderId = data.id; state.orderRole = 'buyer';
    PV.orders = [data, ...PV.orders.filter(o=>o.id!==data.id)];
    hapticPulse([10,40,10]);
    showToast('Payment authorised (test mode — no money moves). The seller has been notified to start their Verified Handover.');
    goTo('timeline');
    scheduleReload();
  })();
};

function scheduleOrderSync(){
  if(!state.orderId || !isSignedIn()) return;
  clearTimeout(PV.syncTimer);
  PV.syncTimer = setTimeout(syncOrderNow, 300);
}
async function syncOrderNow(){
  if(!state.orderId || !isSignedIn()) return;
  const it = activeItem();
  const patch = {timeline_state: serializeCustody(), status: deriveOrderStatus(it)};
  const {error} = await PV.client.from('orders').update(patch).eq('id', state.orderId);
  if(error) showToast('Could not sync this step: ' + error.message);
  else { const o = PV.orders.find(x=>x.id===state.orderId); if(o) Object.assign(o, patch); }
}
for(const fn of ['handoverNext','verifierHubNext','unboxingNext','capturePhoto','snapCustodyPhoto',
                 'confirmScanManually','snapScanAttempt','toggleWitnessedOpening','toggleWitnessedPacking']){
  const orig = window[fn];
  if(typeof orig !== 'function') continue;
  window[fn] = function(){ const r = orig.apply(this, arguments); scheduleOrderSync(); return r; };
}
// Re-bind the global names the inline onclick handlers use (function declarations are writable).
handoverNext = window.handoverNext; verifierHubNext = window.verifierHubNext; unboxingNext = window.unboxingNext;
capturePhoto = window.capturePhoto;

function orderParty(o){ return o.buyer_id === myUid() ? 'buyer' : 'seller'; }
function loadOrderIntoState(o){
  const key = 'L-' + o.listing_id;
  if(!ITEMS[key]) return false;
  _orig.selectItem(key);
  const saved = cleanCustody(o.timeline_state || {});
  for(const k of CUSTODY_KEYS) if(saved[k] !== undefined && saved[k] !== null) state[k] = saved[k];
  state.orderId = o.id; state.orderRole = orderParty(o);
  return true;
}
function nextScreenFor(o){
  const it = ITEMS['L-' + o.listing_id];
  const t = state.timeline;
  const role = orderParty(o);
  if(t.confirmed) return 'timeline';
  if(!t.handedOver) return role==='seller' ? 'handover' : 'timeline';
  if(it && it.verifierHub && !t.resealed) return 'verifierhub';   // test build: either party can act as the hub
  return role==='buyer' ? 'unboxing' : 'timeline';
}
function openOrder(orderId){
  const o = PV.orders.find(x=>x.id===orderId);
  if(!o) return;
  if(!loadOrderIntoState(o)){ showToast('Loading this order’s listing…'); scheduleReload(); return; }
  goTo(nextScreenFor(o));
}
// When the other party moves an order on, pull their progress into the screen you're looking at.
function applyRemoteOrderUpdate(prev){
  if(!state.orderId) return;
  const o = PV.orders.find(x=>x.id===state.orderId);
  const old = (prev||[]).find(x=>x.id===state.orderId);
  if(!o || !old || o.updated_at === old.updated_at) return;
  if(!PASSIVE_SCREENS.includes(PV.currentScreen)) return;   // never clobber an in-progress camera/step flow
  loadOrderIntoState(o);
  const next = nextScreenFor(o);
  if(next !== 'timeline' && PV.currentScreen === 'timeline') showToast('Your turn — this order is ready for your next step. Open it from Inbox.');
}

/* ---------- screen additions ---------- */
function orderStatusLabel(o){
  const s = o.status, role = orderParty(o);
  const map = {
    purchased: role==='seller' ? 'Sold — start your Verified Handover' : 'Paid — waiting for the seller to hand over',
    handover:  role==='seller' ? 'Handover in progress' : 'Seller is packing and sealing',
    hub:       'At the Verifier Hub for authentication',
    unboxing:  role==='buyer' ? 'Delivered — record your Protected Unboxing' : 'Delivered — waiting for the buyer’s unboxing',
    confirmed: 'Confirmed — funds released',
    disputed:  'In dispute',
  };
  return map[s] || s;
}
function yourTurn(o){
  const role = orderParty(o);
  return (role==='seller' && (o.status==='purchased' || o.status==='handover')) ||
         (role==='buyer' && o.status==='unboxing') || o.status==='hub';
}
function renderInbox(){
  if(!PV.enabled) return `<div class="eyebrow">Inbox</div><h1 class="page-title">Inbox</h1><p class="page-sub">Messages and order updates arrive once the app is connected to its backend.</p>`;
  if(!isSignedIn()) return `
    <div class="eyebrow">Inbox</div><h1 class="page-title">Your orders</h1>
    <p class="page-sub">Sign in to see what you’re buying and selling, on any device.</p>
    <div class="btn-row"><button class="btn" onclick="goTo('account')">Sign in or create an account</button></div>`;
  const rows = PV.orders.map(o=>{
    const it = ITEMS['L-'+o.listing_id];
    const role = orderParty(o);
    const other = role==='buyer' ? (it ? it.seller : 'seller') : 'buyer';
    return `
      <button class="order-row ${yourTurn(o)?'order-row--turn':''}" onclick="openOrder('${o.id}')">
        <div class="order-row-main">
          <span class="order-row-role">${role==='buyer'?'Buying':'Selling'}</span>
          <strong>${it ? it.title : 'Listing'}</strong>
          <span class="order-row-status">${orderStatusLabel(o)}</span>
        </div>
        <div class="order-row-side">
          <span>${money((o.price_pence||0)/100)}</span>
          ${yourTurn(o) ? '<span class="order-row-turn">Your turn</span>' : `<span class="order-row-muted">${role==='buyer'?'from '+other:''}</span>`}
        </div>
      </button>`;
  }).join('');
  return `
    <div class="eyebrow">Inbox</div>
    <h1 class="page-title">Your orders</h1>
    <p class="page-sub">Live across your devices — when the other person completes a step, it shows up here.</p>
    <div class="btn-row" style="margin-bottom:14px;"><button class="btn btn--ghost" onclick="backendReload()">Refresh</button></div>
    ${PV.lastError ? `<div class="panel" style="border-color:var(--seal);"><strong>Couldn’t reach the server.</strong> ${clean(PV.lastError, 200)}</div>` : ''}
    ${rows || '<p style="color:var(--muted);font-size:14px;">No orders yet. Anything you buy or sell (signed in) appears here.</p>'}`;
}

function setAuthMode(m){ PV.authMode = m; PV.authMsg = null; render('account'); }
function authField(id){ const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setAuthMsg(kind, text){ PV.authMsg = {kind, text}; if(PV.currentScreen==='account') render('account'); }
async function authSubmit(){
  if(!PV.enabled || PV.busy) return;
  const email = authField('auth-email'), password = (document.getElementById('auth-password')||{}).value || '';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setAuthMsg('err', 'Enter a valid email address.');
  PV.busy = true; setAuthMsg('info', 'Working…');
  const redirect = location.origin + location.pathname;
  let res;
  try{
    if(PV.authMode==='signin'){
      if(!password) { PV.busy=false; return setAuthMsg('err', 'Enter your password.'); }
      res = await PV.client.auth.signInWithPassword({email, password});
      if(!res.error) PV.authMsg = null;
    }else if(PV.authMode==='signup'){
      if(password.length < 8){ PV.busy=false; return setAuthMsg('err', 'Use at least 8 characters for your password.'); }
      res = await PV.client.auth.signUp({email, password, options:{emailRedirectTo: redirect}});
      if(!res.error && !res.data.session) setAuthMsg('ok', `Almost there — we’ve emailed ${clean(email)} a confirmation link. Open it on this device to finish signing up.`);
    }else{
      res = await PV.client.auth.signInWithOtp({email, options:{emailRedirectTo: redirect}});
      if(!res.error) setAuthMsg('ok', `Check ${clean(email)} — we’ve sent you a sign-in link. Open it on this device.`);
    }
    if(res && res.error) setAuthMsg('err', res.error.message);
  }catch(e){ setAuthMsg('err', 'Could not reach the server. Check your connection and try again.'); }
  PV.busy = false;
}
async function signOut(){
  if(!PV.enabled) return;
  await PV.client.auth.signOut();
  showToast('Signed out — you’re back in demo mode.');
  goTo('account');
}
async function saveUsername(){
  const raw = authField('acct-username');
  const u = cleanUsername(raw);
  if(u.length < 3) return showToast('Usernames need at least 3 letters or numbers.');
  const {error} = await PV.client.from('profiles').update({username:u}).eq('id', myUid());
  if(error) return showToast(/duplicate|unique/i.test(error.message) ? 'That username is taken.' : 'Could not save: ' + error.message);
  await loadProfile(); showToast('Username saved.'); render('account');
}
function renderAccount(){
  if(!PV.enabled) return `
    <div class="eyebrow">Account</div><h1 class="page-title">Accounts are offline</h1>
    <p class="page-sub">This copy of the app isn’t connected to its backend, so it’s running as a local demo.</p>`;
  const msg = PV.authMsg ? `<div class="auth-msg auth-msg--${PV.authMsg.kind}" role="status">${PV.authMsg.text}</div>` : '';
  if(isSignedIn()){
    const p = PV.profile || {};
    return `
      <div class="eyebrow">Account</div>
      <h1 class="page-title">${cleanUsername(p.username || 'you')}</h1>
      <p class="page-sub">Signed in as ${clean(PV.user.email)}. Your listings and orders are saved to your account and sync across devices.</p>
      <div class="panel">
        <label class="auth-label" for="acct-username">Username</label>
        <div class="auth-inline">
          <input id="acct-username" class="auth-input" value="${cleanUsername(p.username||'')}" autocomplete="username" maxlength="30">
          <button class="btn btn--ghost" onclick="saveUsername()">Save</button>
        </div>
        <p class="auth-hint">Letters, numbers, dots, dashes and underscores.</p>
      </div>
      <div class="btn-row">
        <button class="btn" onclick="viewStorefront(MY_SELLER_ID); goTo('storefront')">My storefront</button>
        <button class="btn btn--ghost" onclick="goTo('inbox')">My orders</button>
        <button class="btn btn--ghost" onclick="signOut()">Sign out</button>
      </div>`;
  }
  const mode = PV.authMode;
  const tab = (m, label)=> `<button class="store-tab ${mode===m?'active':''}" onclick="setAuthMode('${m}')">${label}</button>`;
  return `
    <div class="eyebrow">Account</div>
    <h1 class="page-title">${mode==='signup' ? 'Create your account' : 'Sign in'}</h1>
    <p class="page-sub">Sign in to list and buy for real — your listings and orders sync across your devices and with other testers. Signed out, the app stays a local demo.</p>
    <div class="store-tabs">${tab('signin','Password')}${tab('signup','Create account')}${tab('magic','Email me a link')}</div>
    <form class="panel auth-form" onsubmit="authSubmit(); return false;">
      <label class="auth-label" for="auth-email">Email</label>
      <input id="auth-email" class="auth-input" type="email" autocomplete="email" inputmode="email" required>
      ${mode!=='magic' ? `
      <label class="auth-label" for="auth-password">Password</label>
      <input id="auth-password" class="auth-input" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" minlength="${mode==='signup'?8:1}" required>` : ''}
      ${msg}
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn" type="submit">${mode==='signin' ? 'Sign in' : mode==='signup' ? 'Create account' : 'Send me a sign-in link'}</button>
      </div>
    </form>`;
}

// Storefront: the signed-in owner sees who they are; "you" stays the internal owner key.
renderStorefront = function(){
  let html = _orig.renderStorefront();
  const seller = activeSeller();
  if(isSignedIn() && seller.username === MY_SELLER_ID){
    const name = cleanUsername((PV.profile && PV.profile.username) || 'you');
    html = `<div class="live-strip">Signed in as <strong>${name}</strong> · <a href="#" onclick="goTo('account'); return false;">Account</a></div>` + html;
  }
  return html;
};
renderFeed = function(){
  let strip = '';
  if(PV.enabled){
    strip = isSignedIn()
      ? `<div class="live-strip">Signed in as <strong>${cleanUsername((PV.profile&&PV.profile.username)||'you')}</strong>. Listings tagged <span class="live-tag">Live</span> are real and shared with other testers.</div>`
      : `<div class="live-strip">Browsing the demo. <a href="#" onclick="goTo('account'); return false;">Sign in</a> to list and buy for real, across devices.</div>`;
  }
  return strip + _orig.renderFeed();
};
cardHtml = function(item){
  const html = _orig.cardHtml(item);
  return item.live ? html.replace('<span class="tier-tag">', '<span class="live-tag live-tag--card">Live</span><span class="tier-tag">') : html;
};
renderTimeline = function(){
  let html = _orig.renderTimeline();
  if(state.orderId){
    const o = PV.orders.find(x=>x.id===state.orderId);
    if(o) html = `<div class="live-strip">Live order · ${orderParty(o)==='buyer'?'You’re the buyer':'You’re the seller'} · ${orderStatusLabel(o)} · <a href="#" onclick="goTo('inbox'); return false;">All orders</a></div>` + html;
  }
  return html;
};

// Bottom nav: Inbox now opens the orders list; Profile goes to sign-in when signed out.
(function patchNav(){
  const inbox = BOTTOM_TABS.find(t=>t.id==='inbox');
  if(inbox){ inbox.screen = 'inbox'; inbox.matches = (s)=> s==='inbox'; }
  const profile = BOTTOM_TABS.find(t=>t.id==='profile');
  if(profile){
    Object.defineProperty(profile, 'screen', {get(){ return (PV.enabled && !isSignedIn()) ? 'account' : 'storefront'; }});
    profile.matches = (s)=> s==='account' || (s==='storefront' && state.viewingSellerId===MY_SELLER_ID);
  }
})();

backendInit();
if(PV.enabled) render(PV.currentScreen);   // pick up the sign-in strip on first paint
