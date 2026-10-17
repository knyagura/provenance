import { exampleCatalogue } from '@/lib/domain/examples';
import { exampleUnitsLeft } from '@/lib/domain/exampleStock';
import { MAX_PERSONAL, UK_POSTCODE, type Basket, type BasketCheckout, type BasketItem, type BasketPatch, type Baskets, type GiftView, type SizeKind } from '@/lib/domain/baskets';
import { exampleSellerId, loadMarket, saveMarket, type StoredOrder } from './exampleMarket';
import { bundledQuote, exampleBundle } from './exampleBundles';
import type { BasketBackend, Member, Result, SellingBackend } from './types';

// Example mode's baskets, one-payment checkout and gift links, in localStorage. Same rules as migration
// 013, which the database enforces for real (tests/basket_checks.mjs).

const KEY = 'pv-example-baskets';
const SETTINGS_KEY = 'pv-example-extras';

interface StoredItem { listingId: string; basketId: string; wrap: boolean; addedAt: string }
type StoredBasket = Omit<Basket, 'items'> & { ownerId: string };
interface StoredGroup { id: string; buyerId: string; shipping: 'combined' | 'separate'; orderIds: string[]; wrapFeePence: number; wrappedItems: number; status: BasketCheckout['paymentStatus']; holdExpiresAt: string }
interface Store { enabled: Record<string, boolean>; baskets: StoredBasket[]; items: Record<string, StoredItem[]>; groups: StoredGroup[] }

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { enabled: {}, baskets: [], items: {}, groups: [], ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { enabled: {}, baskets: [], items: {}, groups: [] };
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full */
  }
}
/** Staff settings live with the other example extras. */
function giftSettings(): { wrapFeePence: number; wrappingLive: boolean } {
  try {
    const x = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const o = x?.settings?.offers ?? {};
    return { wrapFeePence: Number.isFinite(o.wrap_fee_pence) ? o.wrap_fee_pence : 300, wrappingLive: o.wrapping_live === true || o.wrapping_live === 1 };
  } catch {
    return { wrapFeePence: 300, wrappingLive: false };
  }
}

const now = () => new Date().toISOString();
const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const token = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const listing = (lid: string) => exampleCatalogue.find((l) => l.id === lid);
const available = (lid: string) => exampleUnitsLeft(lid, listing(lid)?.stock ?? 1) > 0;

const blank = (ownerId: string, position: number, name: string): StoredBasket => ({
  ownerId, id: id('basket'), position, name, general: position === 0, ageGroup: null, sizes: {}, budgetPence: null, styleNotes: null, wrapStyle: null,
  wrapAll: false, giftMessage: null, hidePrices: position > 0, deliverBy: null, giftReceipt: false, recipientAddress: null, shareToken: null,
});

export function makeExampleBaskets(me: () => Member | null, backend: () => SellingBackend): BasketBackend {
  const general = (s: Store, owner: string) => {
    let g = s.baskets.find((b) => b.ownerId === owner && b.position === 0);
    if (!g) {
      g = blank(owner, 0, 'General');
      s.baskets.push(g);
    }
    return g;
  };
  const toItem = (i: StoredItem): BasketItem | null => {
    const l = listing(i.listingId);
    if (!l) return null;
    return {
      listingId: l.id, title: l.title, pricePence: l.pricePence, postagePence: l.shippingPence, size: l.size, category: l.category ?? null,
      available: available(l.id), photoUrl: l.media.find((m) => m.kind === 'photo')?.url ?? null, seller: l.seller.username, wrap: i.wrap, addedAt: i.addedAt,
    };
  };
  const view = (s: Store, owner: string): Baskets => {
    general(s, owner);
    const items = s.items[owner] ?? [];
    return {
      enabled: !!s.enabled[owner], ...giftSettings(),
      baskets: s.baskets.filter((b) => b.ownerId === owner).sort((a, b) => a.position - b.position).map(({ ownerId: _o, ...b }) => ({
        ...b, items: items.filter((i) => i.basketId === b.id).map(toItem).filter((x): x is BasketItem => !!x),
      })),
    };
  };
  const withMe = async (fn: (s: Store, m: Member) => string | void): Promise<Result<Baskets>> => {
    const m = me();
    if (!m) return fail('Sign in to use baskets.');
    const s = load();
    general(s, m.id);
    const err = fn(s, m);
    if (err) return fail(err);
    save(s);
    return { ok: true, value: view(s, m.id) };
  };
  const groupView = (g: StoredGroup): BasketCheckout => {
    const market = loadMarket();
    const orders = g.orderIds.map((oid) => market.orders.find((o) => o.summary.id === oid)).filter((o): o is StoredOrder => !!o);
    const sum = orders.reduce((n, o) => n + (o.summary.totalPence ?? 0), 0);
    return {
      groupId: g.id, shipping: g.shipping, paymentStatus: g.status, wrapFeePence: g.wrapFeePence, wrappedItems: g.wrappedItems,
      wrapTotalPence: g.wrapFeePence * g.wrappedItems, totalPence: sum + g.wrapFeePence * g.wrappedItems, holdExpiresAt: g.holdExpiresAt,
      orders: orders.map((o) => ({
        orderId: o.summary.id, listingId: o.summary.listingId, title: o.summary.title, basket: o.basketName ?? null, totalPence: o.summary.totalPence ?? 0,
        wrap: !!o.gift?.wrap, gift: !!o.gift, giftToken: o.giftToken ?? null, shipTo: (o.shipTo as BasketCheckout['orders'][number]['shipTo']) ?? null,
      })),
    };
  };
  const giftOf = (o: StoredOrder, m: Member | null): GiftView => {
    const l = listing(o.summary.listingId);
    return {
      orderId: m && (m.id === o.recipientId || m.id === o.buyerId) ? o.summary.id : null,
      title: o.summary.title, photo: o.summary.photoUrl, for: o.basketName ?? null, from: o.buyerId.replace(/^example:/, '').replace(/@.*$/, ''),
      message: o.gift?.message ?? null, deliverBy: o.gift?.deliverBy ?? null, giftReceipt: !!o.gift?.giftReceipt, wrapped: !!o.gift?.wrap,
      claimed: !!o.recipientId, mine: !!m && m.id === o.recipientId, paid: o.summary.paymentStatus === 'paid', custodyState: o.custody?.state ?? null,
      snapshot: { brand: l?.brand ?? null, size: l?.size ?? null, colour: l?.colour ?? null, condition: l?.condition ?? null }, itemId: l?.itemId ?? null,
      soldOn: o.summary.paidAt,
    };
  };

  return {
    async myBaskets() {
      const m = me();
      if (!m) throw new Error('Sign in to use baskets.');
      const s = load();
      const v = view(s, m.id);
      save(s);
      return v;
    },
    setMultiBasket: (on) => withMe((s, m) => { s.enabled[m.id] = on; }),
    saveBasket: (basketId, p: BasketPatch) =>
      withMe((s, m) => {
        let b: StoredBasket | undefined;
        if (basketId === null) {
          const used = new Set(s.baskets.filter((x) => x.ownerId === m.id).map((x) => x.position));
          const pos = [1, 2, 3, 4].find((n) => !used.has(n));
          if (!pos || used.size > MAX_PERSONAL) return 'You can have four personal baskets. Remove one to add another.';
          b = blank(m.id, pos, 'Basket');
          s.baskets.push(b);
        } else {
          b = s.baskets.find((x) => x.id === basketId && x.ownerId === m.id);
          if (!b) return 'Basket not found.';
        }
        if (p.name !== undefined) {
          if (!p.name.trim() || p.name.trim().length > 40) return 'Give the basket a name of up to 40 characters.';
          b.name = p.name.trim();
        }
        if (b.general) return;
        if (p.sizes !== undefined) {
          for (const [k, v] of Object.entries(p.sizes)) if (!['shoe', 'top', 'trousers', 'dress', 'kids'].includes(k) || (v ?? '').length > 20) return 'Sizes can be shoe, top, trousers, dress or kids, each up to 20 characters.';
          b.sizes = Object.fromEntries(Object.entries(p.sizes).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()])) as Partial<Record<SizeKind, string>>;
        }
        if (p.recipientAddress) {
          const a = p.recipientAddress;
          if (!a.name?.trim() || !a.line1?.trim() || !a.town?.trim() || !UK_POSTCODE.test(a.postcode?.trim() ?? '')) return 'Enter the name, first line, town and a UK postcode.';
          b.recipientAddress = { name: a.name.trim(), line1: a.line1.trim(), line2: a.line2?.trim() || null, town: a.town.trim(), postcode: a.postcode.trim().toUpperCase() };
        } else if (p.recipientAddress === null) b.recipientAddress = null;
        if (p.deliverBy && p.deliverBy < now().slice(0, 10)) return 'The deliver-by date has passed.';
        if (p.budgetPence !== undefined && p.budgetPence !== null && (p.budgetPence < 100 || p.budgetPence > 10_000_000)) return 'Set a budget between £1 and £100,000.';
        for (const k of ['ageGroup', 'budgetPence', 'styleNotes', 'wrapStyle', 'wrapAll', 'giftMessage', 'hidePrices', 'deliverBy', 'giftReceipt'] as const) {
          if (p[k] !== undefined) (b as Record<string, unknown>)[k] = p[k] === '' ? null : p[k];
        }
        if (b.wrapAll && b.wrapStyle) for (const i of s.items[m.id] ?? []) if (i.basketId === b.id) i.wrap = true;
      }),
    deleteBasket: (basketId) =>
      withMe((s, m) => {
        const b = s.baskets.find((x) => x.id === basketId && x.ownerId === m.id);
        if (!b || b.general) return 'Basket not found.';
        const g = general(s, m.id);
        for (const i of s.items[m.id] ?? []) if (i.basketId === b.id) Object.assign(i, { basketId: g.id, wrap: false });
        s.baskets = s.baskets.filter((x) => x !== b);
      }),
    basketPut: (listingId, basketId) =>
      withMe((s, m) => {
        const b = basketId ? s.baskets.find((x) => x.id === basketId && x.ownerId === m.id) : general(s, m.id);
        if (!b) return 'Basket not found.';
        if (!b.general && !s.enabled[m.id]) return 'Switch on multi-basket shopping to use personal baskets.';
        const l = listing(listingId);
        if (!l || !available(listingId) || l.status !== 'active') return 'This item isn’t for sale.';
        if (exampleSellerId(listingId) === m.id) return 'You can’t add your own listing.';
        const list = (s.items[m.id] ??= []);
        const cur = list.find((i) => i.listingId === listingId);
        const wrap = !b.general && b.wrapAll && !!b.wrapStyle;
        if (cur) {
          if (cur.basketId !== b.id) Object.assign(cur, { basketId: b.id, wrap });
        } else {
          if (list.length >= 60) return 'Your baskets are full (60 items).';
          list.push({ listingId, basketId: b.id, wrap, addedAt: now() });
        }
      }),
    basketSetWrap: (listingId, wrap) =>
      withMe((s, m) => {
        const i = (s.items[m.id] ?? []).find((x) => x.listingId === listingId);
        const b = i && s.baskets.find((x) => x.id === i.basketId);
        if (!i || !b) return 'That item isn’t in your baskets.';
        if (wrap && (b.general || !b.wrapStyle)) return 'Choose a wrapping paper for this basket first.';
        i.wrap = wrap;
      }),
    basketRemove: (listingId) =>
      withMe((s, m) => {
        s.items[m.id] = (s.items[m.id] ?? []).filter((i) => i.listingId !== listingId);
      }),
    shareBasket: (basketId, on) =>
      withMe((s, m) => {
        const b = s.baskets.find((x) => x.id === basketId && x.ownerId === m.id);
        if (!b || b.general) return 'Basket not found.';
        b.shareToken = on ? (b.shareToken ?? token()) : null;
      }),
    async sharedBasket(t) {
      const s = load();
      const b = s.baskets.find((x) => x.shareToken === t && !x.general);
      if (!b) return null;
      const items = (s.items[b.ownerId] ?? []).filter((i) => i.basketId === b.id).map(toItem).filter((x): x is BasketItem => !!x);
      return { name: b.name, ageGroup: b.ageGroup, sizes: b.sizes, styleNotes: b.styleNotes, items };
    },
    async startBasketCheckout(shipping) {
      const m = me();
      if (!m) return fail('Sign in to buy.');
      const s = load();
      for (const g of s.groups.filter((x) => x.buyerId === m.id && x.status === 'awaiting_payment')) {
        for (const oid of g.orderIds) await backend().cancelCheckout(oid);
        g.status = 'cancelled';
      }
      const v = view(s, m.id);
      const multi = v.enabled;
      const { wrapFeePence, wrappingLive } = giftSettings();
      const lines = v.baskets.filter((b) => multi || b.general).flatMap((b) => b.items.map((i) => ({ b, i })));
      if (!lines.length) return fail('Your baskets are empty.');
      const missing = lines.find(({ b }) => shipping === 'separate' && !b.general && !b.recipientAddress);
      if (missing) return fail(`Add an address for ${missing.b.name}, or send everything to you.`);
      const started: string[] = [];
      let wrapped = 0;
      for (const { b, i } of lines) {
        const r = await backend().startCheckout(i.listingId);
        if (!r.ok) {
          for (const oid of started) await backend().cancelCheckout(oid);
          return fail(`“${i.title}” can’t be bought right now: ${r.message}`);
        }
        started.push(r.value.orderId);
        const market = loadMarket();
        const o = market.orders.find((x) => x.summary.id === r.value.orderId)!;
        const personal = multi && !b.general;
        Object.assign(o, {
          basketName: personal ? b.name : null,
          gift: personal ? { wrap: i.wrap && wrappingLive, wrapRequested: i.wrap, wrapStyle: b.wrapStyle, message: b.giftMessage, hidePrices: b.hidePrices, deliverBy: b.deliverBy, giftReceipt: b.giftReceipt } : null,
          shipTo: shipping === 'separate' && personal ? b.recipientAddress : null,
          giftToken: personal ? token() : null,
        });
        saveMarket(market);
        if (personal && i.wrap && wrappingLive) wrapped++;
      }
      // Bundle discounts: several items from one seller in this checkout (migration 020).
      {
        const mk = loadMarket();
        const mine = started.map((oid) => mk.orders.find((o) => o.summary.id === oid)!);
        const bySeller = new Map<string, StoredOrder[]>();
        for (const o of mine) bySeller.set(o.sellerId, [...(bySeller.get(o.sellerId) ?? []), o]);
        for (const [sellerId, list] of bySeller) {
          const offer = exampleBundle(sellerId.replace(/^example:/, '').replace(/@example\.test$/, ''));
          if (!offer || list.length < offer.minItems) continue;
          for (const o of list) {
            if (!o.summary.quote || o.summary.quote.bundle) continue;
            o.summary.quote = bundledQuote(o.summary.quote, offer);
            o.summary.totalPence = o.summary.quote.buyerTotalPence;
          }
        }
        saveMarket(mk);
      }
      const market = loadMarket();
      const hold = started.map((oid) => market.orders.find((o) => o.summary.id === oid)!.summary.holdExpiresAt!).sort()[0];
      const g: StoredGroup = { id: id('example-group'), buyerId: m.id, shipping, orderIds: started, wrapFeePence, wrappedItems: wrapped, status: 'awaiting_payment', holdExpiresAt: hold };
      for (const oid of started) Object.assign(market.orders.find((o) => o.summary.id === oid)!, { groupId: g.id });
      saveMarket(market);
      const s2 = load();
      s2.groups.push(g);
      save(s2);
      return { ok: true, value: groupView(g) };
    },
    async basketCheckout(groupId) {
      const m = me();
      const g = load().groups.find((x) => x.id === groupId && x.buyerId === m?.id);
      return g ? groupView(g) : null;
    },
    async cancelBasketCheckout(groupId) {
      const s = load();
      const g = s.groups.find((x) => x.id === groupId && x.buyerId === me()?.id && x.status === 'awaiting_payment');
      if (!g) return;
      for (const oid of g.orderIds) await backend().cancelCheckout(oid);
      g.status = 'cancelled';
      save(s);
    },
    async startGroupPayment(groupId) {
      const g = load().groups.find((x) => x.id === groupId && x.buyerId === me()?.id);
      if (!g || g.status !== 'awaiting_payment' || g.holdExpiresAt < now()) return fail('This checkout has ended. Start again from your baskets.');
      return { ok: true, value: { kind: 'simulated' as const, amountPence: groupView(g).totalPence } };
    },
    async simulateGroupPayment(groupId) {
      const m = me();
      const s = load();
      const g = s.groups.find((x) => x.id === groupId && x.buyerId === m?.id);
      if (!m || !g || g.status !== 'awaiting_payment') return fail('This checkout has ended. Start again from your baskets.');
      for (const oid of g.orderIds) {
        const r = await backend().simulatePayment(oid);
        if (!r.ok) return r;
      }
      g.status = 'paid';
      const bought = new Set(loadMarket().orders.filter((o) => g.orderIds.includes(o.summary.id)).map((o) => o.summary.listingId));
      s.items[m.id] = (s.items[m.id] ?? []).filter((i) => !bought.has(i.listingId));
      save(s);
      return { ok: true, value: undefined };
    },
    async giftView(t) {
      const o = loadMarket().orders.find((x) => x.giftToken === t);
      return o ? giftOf(o, me()) : null;
    },
    async claimGift(t) {
      const m = me();
      if (!m) return fail('Sign in to open your gift.');
      const market = loadMarket();
      const o = market.orders.find((x) => x.giftToken === t);
      if (!o || o.summary.paymentStatus !== 'paid') return fail('This gift link isn’t working.');
      if (o.recipientId && o.recipientId !== m.id) return fail('Someone has already opened this gift link.');
      if (o.sellerId === m.id) return fail('The seller can’t be the gift’s recipient.');
      if (m.id !== o.buyerId) o.recipientId = m.id;
      saveMarket(market);
      return { ok: true, value: giftOf(o, m) };
    },
    async myGifts() {
      const m = me();
      if (!m) return [];
      return loadMarket().orders.filter((o) => o.recipientId === m.id && o.summary.paymentStatus === 'paid').map((o) => ({
        orderId: o.summary.id, token: o.giftToken!, title: o.summary.title, photo: o.summary.photoUrl, from: o.buyerId.replace(/^example:/, '').replace(/@.*$/, ''), custodyState: o.custody?.state ?? null,
      }));
    },
  };
}
