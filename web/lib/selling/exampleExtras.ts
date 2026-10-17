import { computeFees, DEFAULT_FEES, feeSettingsFromJson } from '@/lib/domain/fees';
import { exampleCatalogue } from '@/lib/domain/examples';
import type { Listing } from '@/lib/domain/types';
import { stepAt } from '@/lib/domain/custody';
import { formatPence } from '@/lib/format';
import { exampleSource } from '@/lib/domain/catalogue';
import { ALL_EMAILS, exampleNotifications, exampleNotify, exampleNotifyMessage, exampleReadOrderMessages, offerWords } from './exampleNotifications';
import { exampleCustody, EXAMPLE_AGENTS_KEY, exampleChainOk, exampleOrders, exampleSellerId, exampleStaffResolve, loadMarket, memberId, saveMarket, type StoredOrder } from './exampleMarket';
import type {
  CheckoutStarted, ContactMessage, MarketBackend, Member, Offer, OfferStatus, OrderMessage, Passport, Result, Review, StaffAgent, StaffOrder, StaffSettings,
} from './types';

// Example mode's favourites, messages, offers, reviews, passport and staff console, shared between tabs in
// localStorage like the example orders. They follow the rules of migration 012, which the database enforces
// for real (tests/marketplace_checks.mjs). Example staff: any email starting "staff".

const KEY = 'pv-example-extras';

interface StoredMessage { id: string; orderId: string; senderId: string; body: string; at: string }
interface StoredOffer {
  id: string; listingId: string; buyerId: string; sellerId: string; buyer: string; seller: string; amountPence: number;
  madeBy: 'buyer' | 'seller'; status: Exclude<OfferStatus, 'expired'>; counterOf: string | null; revision: number; pricePence: number;
  createdAt: string; expiresAt: string;
}
interface StoredReview { orderId: string; authorId: string; subjectId: string; author: string; authorRole: 'buyer' | 'seller'; rating: number; body: string | null; createdAt: string }
interface Extras {
  favourites: Record<string, string[]>;
  messages: StoredMessage[];
  reads: Record<string, string>;
  offers: StoredOffer[];
  reviews: StoredReview[];
  settings?: { custody: Record<string, number>; offers: Record<string, number>; fees: StaffSettings['fees'] };
  actions: { orderId: string; action: string; by: string; detail: Record<string, unknown>; at: string }[];
  contact?: ContactMessage[];
}

function load(): Extras {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { favourites: {}, messages: [], reads: {}, offers: [], reviews: [], actions: [], ...JSON.parse(raw) } as Extras;
  } catch {
    /* storage unavailable */
  }
  return { favourites: {}, messages: [], reads: {}, offers: [], reviews: [], actions: [] };
}
function save(x: Extras) {
  try {
    localStorage.setItem(KEY, JSON.stringify(x));
  } catch {
    /* storage full */
  }
}

const OFFER_MIN_PCT = 40;
const REPLY_HOURS = 48;
const CHECKOUT_HOURS = 24;
const now = () => new Date().toISOString();
const later = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const done = { ok: true as const, value: undefined };
const username = (m: Member) => m.username;
const sellerName = (sellerId: string) => sellerId.replace(/^example:/, '').replace(/@example\.test$/, '');

function listing(listingId: string): Listing | undefined {
  return exampleCatalogue.find((l) => l.id === listingId);
}
function sold(listingId: string): boolean {
  return loadMarket().orders.some((o) => o.summary.listingId === listingId && (o.summary.paymentStatus === 'paid' || (o.summary.paymentStatus === 'awaiting_payment' && (o.summary.holdExpiresAt ?? '') > now())));
}
function offerView(o: StoredOffer, me: Member): Offer {
  const status: OfferStatus = (o.status === 'pending' || o.status === 'accepted') && o.expiresAt < now() ? 'expired' : o.status;
  return {
    id: o.id, listingId: o.listingId, title: listing(o.listingId)?.title ?? 'Item', pricePence: o.pricePence, amountPence: o.amountPence,
    madeBy: o.madeBy, status, role: me.id === o.buyerId ? 'buyer' : 'seller', buyer: o.buyer, seller: o.seller, counterOf: o.counterOf,
    createdAt: o.createdAt, expiresAt: o.expiresAt,
  };
}
const isStaffMember = (m: Member | null) => !!m && m.email.toLowerCase().startsWith('staff');
const party = (o: StoredOrder, me: Member) => o.buyerId === me.id || o.sellerId === me.id;

const DEFAULT_SETTINGS = (): NonNullable<Extras['settings']> => ({
  custody: { challenge_minutes: 10, confirm_window_hours: 48, enhanced_confirm_days: 7, weight_tolerance_grams: 50, weight_tolerance_pct: 5 },
  offers: { min_pct: OFFER_MIN_PCT, reply_hours: REPLY_HOURS, checkout_hours: CHECKOUT_HOURS },
  fees: [{ version: DEFAULT_FEES.version, effectiveFrom: '2026-10-11T00:00:00Z', note: 'Transaction fee 3–8% by price band, plus £0.80 processing', settings: {} }],
});

export function makeExampleMarket(me: () => Member | null): MarketBackend {
  async function staffOrderFor(o: StoredOrder): Promise<StaffOrder> {
    const x = load();
    return {
      orderId: o.summary.id, listingId: o.summary.listingId, title: o.summary.title, buyer: o.buyerId.replace(/^example:/, ''), seller: sellerName(o.sellerId),
      paymentStatus: o.summary.paymentStatus, paymentRef: 'example', totalPence: o.summary.totalPence, tier: o.custody?.tier ?? null,
      state: o.custody?.state ?? 'not_started', disputeReason: o.custody?.disputeReason ?? null,
      disputeResolution: ((o.custody as { resolution?: 'release' | 'refund' } | null)?.resolution) ?? null, payoutStatus: o.custody?.payoutStatus ?? 'held',
      weightFlag: o.custody?.weightFlag ?? false,
      events: (o.custody?.events ?? []).map((e) => ({ seq: e.seq, step: e.step, actorRole: e.actorRole, actor: e.actorId?.replace(/^example:/, '') ?? null, at: e.at, evidence: e.evidence, hash: e.hash })),
      messages: x.messages.filter((m) => m.orderId === o.summary.id).map((m) => ({ from: m.senderId.replace(/^example:/, ''), role: m.senderId === o.buyerId ? 'buyer' : 'seller', body: m.body, at: m.at })),
      actions: x.actions.filter((a) => a.orderId === o.summary.id).map(({ orderId: _o, ...a }) => a),
    };
  }

  return {
    async favourites() {
      const m = me();
      return m ? load().favourites[m.id] ?? [] : [];
    },
    async setFavourite(listingId, on) {
      const m = me();
      if (!m) return fail('Sign in to save items.');
      const x = load();
      const list = new Set(x.favourites[m.id] ?? []);
      if (on) list.add(listingId);
      else list.delete(listingId);
      x.favourites[m.id] = [...list];
      save(x);
      return done;
    },
    async savedListings() {
      const m = me();
      if (!m) return [];
      return (load().favourites[m.id] ?? []).slice().reverse().map(listing).filter((l): l is Listing => !!l);
    },

    async inboxCounts() {
      const m = me();
      if (!m) return { turns: 0, unread: 0, offers: 0 };
      const x = load();
      const orders = loadMarket().orders.filter((o) => party(o, m));
      const unread = x.messages.filter((msg) => orders.some((o) => o.summary.id === msg.orderId) && msg.senderId !== m.id && msg.at > (x.reads[`${msg.orderId}|${m.id}`] ?? '')).length;
      const offers = x.offers.filter((o) => o.expiresAt > now() && ((o.status === 'pending' && ((o.madeBy === 'buyer' && o.sellerId === m.id) || (o.madeBy === 'seller' && o.buyerId === m.id))) || (o.status === 'accepted' && o.buyerId === m.id))).length;
      let turns = orders.filter((o) => {
        const c = o.custody;
        const step = c ? stepAt(c.tier, c.step, c.state) : null;
        return !!step && ((step.actor === 'seller' && o.sellerId === m.id) || (step.actor === 'buyer' && o.buyerId === m.id));
      }).length;
      turns += (await exampleCustody.agentTasks(m)).filter((t) => t.step && t.state === 'in_progress').length;
      return { turns, unread, offers };
    },
    async unreadByOrder() {
      const m = me();
      if (!m) return {};
      const x = load();
      const out: Record<string, number> = {};
      for (const msg of x.messages) {
        const o = loadMarket().orders.find((y) => y.summary.id === msg.orderId);
        if (o && party(o, m) && msg.senderId !== m.id && msg.at > (x.reads[`${msg.orderId}|${m.id}`] ?? '')) out[msg.orderId] = (out[msg.orderId] ?? 0) + 1;
      }
      return out;
    },
    async messages(orderId) {
      const m = me();
      const o = loadMarket().orders.find((y) => y.summary.id === orderId);
      if (!m || !o || !party(o, m)) return [];
      return load().messages.filter((msg) => msg.orderId === orderId)
        .map((msg): OrderMessage => ({ id: msg.id, mine: msg.senderId === m.id, role: msg.senderId === o.buyerId ? 'buyer' : 'seller', body: msg.body, at: msg.at }));
    },
    async sendMessage(orderId, body) {
      const m = me();
      const o = loadMarket().orders.find((y) => y.summary.id === orderId);
      if (!m || !o || !party(o, m)) return fail('Order not found.');
      if (o.summary.paymentStatus !== 'paid') return fail('Messages open once the order is paid.');
      if (!body.trim()) return fail('Write a message first.');
      if (body.length > 2000) return fail('Keep messages under 2,000 characters.');
      const x = load();
      x.messages.push({ id: id('msg'), orderId, senderId: m.id, body: body.trim(), at: now() });
      save(x);
      exampleNotifyMessage(m.id === o.buyerId ? o.sellerId : o.buyerId, orderId, o.summary.title, username(m), body.trim());
      return done;
    },
    async markRead(orderId) {
      const m = me();
      if (!m) return;
      const x = load();
      x.reads[`${orderId}|${m.id}`] = now();
      save(x);
      exampleReadOrderMessages(m.id, orderId);
    },

    async makeOffer(listingId, amountPence) {
      const m = me();
      if (!m) return fail('Sign in to make an offer.');
      const l = listing(listingId);
      const sellerId = exampleSellerId(listingId);
      if (!l || sold(listingId)) return fail('This item isn’t taking offers.');
      if (sellerId === m.id) return fail('You can’t make an offer on your own listing.');
      if ((l.stock ?? 1) > 1 || l.variantGroup) return fail('This seller’s prices are fixed, so it doesn’t take offers.');
      if (!Number.isInteger(amountPence) || amountPence >= l.pricePence) return fail('Offer less than the price, or just buy it.');
      if (amountPence < Math.ceil((l.pricePence * OFFER_MIN_PCT) / 100)) return fail(`Offers start at ${OFFER_MIN_PCT}% of the price.`);
      const x = load();
      for (const o of x.offers) if (o.listingId === listingId && o.buyerId === m.id && o.status === 'pending') o.status = 'withdrawn';
      const o: StoredOffer = {
        id: id('offer'), listingId, buyerId: m.id, sellerId: sellerId!, buyer: username(m), seller: l.seller.username, amountPence, madeBy: 'buyer',
        status: 'pending', counterOf: null, revision: l.revision, pricePence: l.pricePence, createdAt: now(), expiresAt: later(REPLY_HOURS),
      };
      x.offers.push(o);
      save(x);
      exampleNotify(o.sellerId, 'offer_new', ...offerWords.newOffer(l.title, o.buyer, amountPence), '/inbox');
      return { ok: true, value: offerView(o, m) };
    },
    async respondOffer(offerId, action, amountPence) {
      const m = me();
      const x = load();
      const o = x.offers.find((y) => y.id === offerId);
      if (!m || !o || (o.buyerId !== m.id && o.sellerId !== m.id)) return fail('Offer not found.');
      const maker = o.madeBy === 'buyer' ? o.buyerId : o.sellerId;
      if (action === 'withdraw') {
        if (maker !== m.id || o.status !== 'pending') return fail('Only a pending offer you made can be withdrawn.');
        o.status = 'withdrawn';
        save(x);
        return { ok: true, value: offerView(o, m) };
      }
      if (maker === m.id) return fail('Wait for the other person to reply.');
      if (o.status !== 'pending' || o.expiresAt < now()) return fail('This offer has ended.');
      if (action === 'decline') o.status = 'declined';
      else if (sold(o.listingId)) return fail('This item is no longer for sale.');
      else if (action === 'accept') {
        Object.assign(o, { status: 'accepted', expiresAt: later(CHECKOUT_HOURS) });
        if (o.madeBy === 'buyer') exampleNotify(o.buyerId, 'offer_accepted', ...offerWords.accepted(listing(o.listingId)?.title ?? 'your offer', `${o.seller} accepted ${formatPence(o.amountPence)}. Buy it at that price soon.`), `/item/${o.listingId}`);
        else exampleNotify(o.sellerId, 'offer_accepted', ...offerWords.accepted(listing(o.listingId)?.title ?? 'your offer', `${o.buyer} accepted your ${formatPence(o.amountPence)}.`), '/inbox');
      }
      else if (action === 'counter') {
        const a = amountPence ?? 0;
        if (!Number.isInteger(a) || a >= o.pricePence || a < Math.ceil((o.pricePence * OFFER_MIN_PCT) / 100)) {
          return fail(`A counter offer must be under the price and at least ${OFFER_MIN_PCT}% of it.`);
        }
        if (a === o.amountPence) return fail('That’s the same amount: accept it instead.');
        o.status = 'countered';
        const n: StoredOffer = { ...o, id: id('offer'), amountPence: a, madeBy: m.id === o.sellerId ? 'seller' : 'buyer', status: 'pending', counterOf: o.id, createdAt: now(), expiresAt: later(REPLY_HOURS) };
        x.offers.push(n);
        save(x);
        const title = listing(o.listingId)?.title ?? 'an item';
        if (n.madeBy === 'seller') exampleNotify(n.buyerId, 'offer_counter', ...offerWords.counter(title, n.seller, a), `/item/${n.listingId}`);
        else exampleNotify(n.sellerId, 'offer_counter', ...offerWords.counter(title, n.buyer, a), '/inbox');
        return { ok: true, value: offerView(n, m) };
      } else return fail('Choose accept, decline or counter.');
      save(x);
      return { ok: true, value: offerView(o, m) };
    },
    async myOffers() {
      const m = me();
      if (!m) return [];
      return load().offers.filter((o) => o.buyerId === m.id || o.sellerId === m.id).reverse().map((o) => offerView(o, m));
    },
    async startOfferCheckout(offerId) {
      const m = me();
      const x = load();
      const o = x.offers.find((y) => y.id === offerId);
      if (!m || !o || o.buyerId !== m.id) return fail('Offer not found.');
      const market = loadMarket();
      const open = market.orders.find((y) => (y as StoredOrder & { offerId?: string }).offerId === offerId && y.summary.paymentStatus === 'awaiting_payment' && (y.summary.holdExpiresAt ?? '') > now());
      if (open) return { ok: true, value: { orderId: open.summary.id, quote: open.summary.quote!, holdExpiresAt: open.summary.holdExpiresAt!, revision: open.summary.bought?.revision ?? null } };
      if (o.status !== 'accepted' || o.expiresAt < now()) return fail('This offer has ended. Make a new one from the item page.');
      const l = listing(o.listingId)!;
      if (sold(o.listingId)) return fail('Someone else is buying this right now. Try again in a few minutes.');
      const quote = computeFees(DEFAULT_FEES, { pricePence: o.amountPence, postagePence: l.shippingPence, payer: 'buyer', boostBp: null });
      const hold = new Date(Date.now() + DEFAULT_FEES.checkoutHoldMinutes * 60_000).toISOString();
      const order: StoredOrder & { offerId: string } = {
        summary: {
          id: id('example-order'), listingId: l.id, title: l.title, photoUrl: l.media.find((md) => md.kind === 'photo')?.url ?? null,
          paymentStatus: 'awaiting_payment', quote, totalPence: quote.buyerTotalPence, holdExpiresAt: hold, paidAt: null, createdAt: now(),
          bought: { revision: l.revision, title: l.title, description: l.description, brand: l.brand, size: l.size, colour: l.colour, condition: l.condition,
            pricePence: o.amountPence, shippingPence: l.shippingPence, serialHint: l.serialHint, media: l.media.map((md) => ({ path: md.url, kind: md.kind, shot: md.shot })) },
        },
        buyerId: m.id, sellerId: o.sellerId, custody: null, offerId,
      };
      market.orders = [order, ...market.orders];
      saveMarket(market);
      return { ok: true, value: { orderId: order.summary.id, quote, holdExpiresAt: hold, revision: l.revision } satisfies CheckoutStarted };
    },

    async leaveReview(orderId, rating, body) {
      const m = me();
      const o = loadMarket().orders.find((y) => y.summary.id === orderId);
      if (!m || !o || !party(o, m)) return fail('Order not found.');
      if (o.custody?.state !== 'confirmed') return fail('You can leave a review once the order is complete.');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail('Choose 1 to 5 stars.');
      if (body.length > 500) return fail('Keep the review under 500 characters.');
      const x = load();
      if (x.reviews.some((r) => r.orderId === orderId && r.authorId === m.id)) return fail('You’ve already reviewed this order.');
      const buyer = o.buyerId === m.id;
      x.reviews.push({ orderId, authorId: m.id, subjectId: buyer ? o.sellerId : o.buyerId, author: username(m), authorRole: buyer ? 'buyer' : 'seller', rating, body: body.trim() || null, createdAt: now() });
      save(x);
      return done;
    },
    async orderReviews(orderId) {
      const m = me();
      const rows = load().reviews.filter((r) => r.orderId === orderId);
      const toR = (r: StoredReview | undefined): Review | null => (r ? { rating: r.rating, body: r.body, createdAt: r.createdAt, authorRole: r.authorRole, author: r.author } : null);
      return { mine: toR(rows.find((r) => r.authorId === m?.id)), theirs: toR(rows.find((r) => r.authorId !== m?.id)) };
    },
    async memberReviews(name) {
      const subject = memberId(`${name}@example.test`);
      const rows = load().reviews.filter((r) => r.subjectId === subject || r.subjectId.replace(/^example:/, '').split('@')[0] === name.toLowerCase()).reverse();
      const avg = rows.length ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / rows.length) * 10) / 10 : null;
      return { count: rows.length, average: avg, latest: rows.slice(0, 10).map((r) => ({ rating: r.rating, body: r.body, createdAt: r.createdAt, authorRole: r.authorRole, author: r.author })) };
    },

    async passport(listingId) {
      const l = listing(listingId);
      if (!l) return null;
      const sales: Passport['sales'] = [];
      for (const o of exampleOrders().filter((y) => y.summary.listingId === listingId && y.summary.paymentStatus === 'paid' && y.custody)) {
        const c = o.custody!;
        const resolution = (c as { resolution?: string }).resolution;
        sales.push({
          sold: (o.summary.paidAt ?? o.summary.createdAt).slice(0, 7), tier: c.tier,
          state: resolution === 'refund' ? 'refunded' : c.state === 'disputed' ? 'on_hold' : c.state,
          chainOk: await exampleChainOk(o),
          steps: c.events.filter((e) => e.step !== 'dispute').map((e) => ({
            step: e.step, actorRole: e.actorRole, date: e.at.slice(0, 10),
            ...(typeof e.evidence.match === 'boolean' ? { sealMatch: e.evidence.match, sealKind: String(e.evidence.seal_kind) } : {}),
            ...(e.evidence.result ? { result: e.evidence.result as 'pass' | 'fail' } : {}),
            ...(e.evidence.media_kind === 'photo' ? { photo: true } : {}),
          })),
        });
      }
      return {
        listingId: l.id, itemId: l.itemId, title: l.title, brand: l.brand, category: l.category, condition: l.condition, tier: l.tier,
        status: sales.length ? 'sold' : 'active', listed: l.createdAt.slice(0, 7), photos: l.media.filter((md) => md.kind === 'photo').map((md) => ({ url: md.url, shot: md.shot })), sales,
      };
    },

    async isStaff() {
      return isStaffMember(me());
    },
    async staffQueue() {
      if (!isStaffMember(me())) throw new Error('Staff only.');
      return exampleOrders()
        .filter((o) => o.summary.paymentStatus === 'review' || (o.custody?.state === 'disputed' && !(o.custody as { resolution?: string }).resolution) || (o.custody?.weightFlag && o.custody.state === 'in_progress'))
        .map((o) => ({
          orderId: o.summary.id, title: o.summary.title,
          kind: o.summary.paymentStatus === 'review' ? 'payment' : o.custody?.state === 'disputed' ? 'dispute' : 'weight',
          reason: o.custody?.disputeReason ?? (o.summary.paymentStatus === 'review' ? 'payment_review' : 'weight_flag'),
          buyer: o.buyerId.replace(/^example:/, ''), seller: sellerName(o.sellerId), totalPence: o.summary.totalPence, tier: o.custody?.tier ?? null,
          since: o.custody?.events.at(-1)?.at ?? o.summary.createdAt,
        }));
    },
    async staffOrder(orderId) {
      if (!isStaffMember(me())) throw new Error('Staff only.');
      const o = exampleOrders().find((y) => y.summary.id === orderId);
      return o ? staffOrderFor(o) : null;
    },
    async staffResolveDispute(orderId, outcome, note) {
      const m = me();
      if (!isStaffMember(m)) return fail('Staff only.');
      const r = await exampleStaffResolve(orderId, outcome, note, m!);
      if (!r.ok) return r;
      const x = load();
      x.actions.push({ orderId, action: 'resolve_dispute', by: m!.username, detail: { outcome, note }, at: now() });
      save(x);
      return { ok: true, value: (await staffOrderFor(exampleOrders().find((y) => y.summary.id === orderId)!)) };
    },
    async staffResolvePayment(orderId) {
      return isStaffMember(me()) ? fail(`Example orders are never held for payment review (${orderId.slice(0, 8)}).`) : fail('Staff only.');
    },
    async staffAgents() {
      if (!isStaffMember(me())) throw new Error('Staff only.');
      let added: { email: string; role: 'courier' | 'hub'; organisation: string; active: boolean; since: string }[] = [];
      try {
        added = JSON.parse(localStorage.getItem(EXAMPLE_AGENTS_KEY) ?? '[]');
      } catch {
        /* none */
      }
      return added.map((a): StaffAgent => ({ userId: memberId(a.email), username: a.email.split('@')[0], email: a.email, role: a.role, organisation: a.organisation, active: a.active, since: a.since }));
    },
    async staffSetAgent(email, role, organisation, active) {
      const m = me();
      if (!isStaffMember(m)) return fail('Staff only.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Enter their email address.');
      if (email.toLowerCase() === m!.email.toLowerCase()) return fail('Staff can’t make themselves a courier or hub.');
      if (!organisation.trim()) return fail('Enter the company or hub name.');
      let added: { email: string; role: string; organisation: string; active: boolean; since: string }[] = [];
      try {
        added = JSON.parse(localStorage.getItem(EXAMPLE_AGENTS_KEY) ?? '[]');
      } catch {
        /* none */
      }
      added = [{ email: email.trim().toLowerCase(), role, organisation: organisation.trim(), active, since: now() }, ...added.filter((a) => a.email !== email.trim().toLowerCase())];
      localStorage.setItem(EXAMPLE_AGENTS_KEY, JSON.stringify(added));
      return { ok: true, value: await this.staffAgents() };
    },
    async staffSettings() {
      if (!isStaffMember(me())) return null;
      const s = load().settings ?? DEFAULT_SETTINGS();
      return { ...s, currentFeeVersion: Math.max(...s.fees.map((f) => f.version)) };
    },
    async staffUpdateSettings(custody, offers) {
      if (!isStaffMember(me())) return fail('Staff only.');
      const x = load();
      const s = x.settings ?? DEFAULT_SETTINGS();
      if (custody?.confirm_window_hours !== undefined && (custody.confirm_window_hours < 1 || custody.confirm_window_hours > 720)) return fail('The protection window must be 1 to 720 hours.');
      x.settings = { ...s, custody: { ...s.custody, ...(custody ?? {}) }, offers: { ...s.offers, ...(offers ?? {}) } };
      save(x);
      return { ok: true, value: { ...x.settings, currentFeeVersion: Math.max(...x.settings.fees.map((f) => f.version)) } };
    },
    async staffAddFeeVersion(settings, note) {
      if (!isStaffMember(me())) return fail('Staff only.');
      if (note.trim().length < 3) return fail('Write a short note on what changed.');
      try {
        feeSettingsFromJson(0, settings);
      } catch {
        return fail('Those settings can’t price an order.');
      }
      const x = load();
      const s = x.settings ?? DEFAULT_SETTINGS();
      const version = Math.max(...s.fees.map((f) => f.version)) + 1;
      x.settings = { ...s, fees: [{ version, effectiveFrom: now(), note: note.trim(), settings }, ...s.fees] };
      save(x);
      return { ok: true, value: { ...x.settings, currentFeeVersion: version } };
    },
    async submitContact(name, email, topic, body) {
      if (!name.trim()) return fail('Enter your name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return fail('Enter an email address we can reply to.');
      if (body.trim().length < 10 || body.trim().length > 4000) return fail('Write a message of 10 to 4,000 characters.');
      const x = load();
      const e = email.trim().toLowerCase();
      const day = Date.now() - 86_400_000;
      if ((x.contact ?? []).filter((m) => m.email === e && Date.parse(m.createdAt) > day).length >= 5) return fail('You’ve sent several messages today. We’ll reply to those first.');
      x.contact = [{ id: id('contact'), createdAt: now(), name: name.trim(), email: e, topic, body: body.trim(), member: me()?.username ?? null, handledAt: null, handledBy: null }, ...(x.contact ?? [])];
      save(x);
      return done;
    },
    async staffContactMessages(openOnly) {
      if (!isStaffMember(me())) return [];
      return (load().contact ?? []).filter((m) => !openOnly || !m.handledAt);
    },
    async isBusiness() {
      const m = me();
      return !!m && (/^shop/i.test(m.email) || exampleCatalogue.some((l) => l.seller.business && memberId(`${l.seller.username}@example.test`) === m.id));
    },
    async listingVariants(listingId) {
      return exampleSource.variants(listingId);
    },
    async setListingStock() {
      return fail('Example listings can’t be restocked. Sign in to the live site with a business account to try it.');
    },
    async addVariant() {
      return fail('Example listings can’t get new variants. Sign in to the live site with a business account to try it.');
    },
    async staffSetBusiness(username, on) {
      if (!isStaffMember(me())) return fail('Staff only.');
      return { ok: true, value: { username, business: on } };
    },
    async notifications() {
      const m = me();
      return m ? exampleNotifications.list(m.id) : [];
    },
    async unreadNotifications() {
      const m = me();
      return m ? exampleNotifications.unread(m.id) : 0;
    },
    async markNotificationsRead(ids) {
      const m = me();
      if (m) exampleNotifications.markRead(m.id, ids);
    },
    async notificationPrefs() {
      const m = me();
      return m ? exampleNotifications.prefs(m.id) : { ...ALL_EMAILS };
    },
    async setNotificationPrefs(p) {
      const m = me();
      if (!m) return fail('Sign in first.');
      return { ok: true, value: exampleNotifications.setPrefs(m.id, p) };
    },
    async staffContactHandled(cid) {
      const m = me();
      if (!isStaffMember(m)) return fail('Staff only.');
      const x = load();
      const c = (x.contact ?? []).find((y) => y.id === cid);
      if (c && !c.handledAt) Object.assign(c, { handledAt: now(), handledBy: m!.username });
      save(x);
      return done;
    },
  };
}

export type { Result };
