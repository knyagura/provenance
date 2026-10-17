import { computeFees, DEFAULT_FEES } from '@/lib/domain/fees';
import { loadMarket, saveMarket, type StoredOrder } from './exampleMarket';
import type { Balance, CheckoutCodes, GiftCard, Member, Result, Voucher, VoucherPatch } from './types';

// Example mode's voucher codes, gift cards and balance, in localStorage, following migration 022
// (tests/voucher_checks.mjs). Seeded with WELCOME10 (NuTuYu: 10% off a first order, up to £10) and
// RESOLE15 (resole_archive's shop: 15% off). No money moves in example mode.

const KEY = 'pv-example-money';
interface Use { voucherId: string; buyerId: string; orderId: string; target: string; discount: number; prev: { price: number; quote: unknown; total: number }; state: 'held' | 'used' | 'released' }
interface Card extends GiftCard { purchaserId: string; code: string; redeemedBy: string | null }
interface Lot { id: string; userId: string; source: 'gift_card' | 'refund'; amount: number; remaining: number; expiresAt: string }
interface Spend { id: string; lotId: string; userId: string; orderId: string; amount: number; state: 'held' | 'used' | 'released' }
interface Store { vouchers: (Voucher & { sellerId: string | null })[]; uses: Use[]; cards: Card[]; lots: Lot[]; spends: Spend[] }

const now = () => new Date().toISOString();
const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const sellerOf = (username: string) => `example:${username}@example.test`;
const SEED: Store['vouchers'] = [
  { id: 'v-welcome', code: 'WELCOME10', shop: null, sellerId: null, kind: 'percent', value: 10, minSpendPence: 0, maxDiscountPence: 1000, perMember: 1, maxUses: null,
    firstOrderOnly: true, startsAt: null, endsAt: null, active: true, note: 'Sign-up offer', uses: 0, discountGivenPence: 0 },
  { id: 'v-resole', code: 'RESOLE15', shop: 'resole_archive', sellerId: sellerOf('resole_archive'), kind: 'percent', value: 15, minSpendPence: 0, maxDiscountPence: null,
    perMember: 3, maxUses: null, firstOrderOnly: false, startsAt: null, endsAt: null, active: true, note: null, uses: 0, discountGivenPence: 0 },
];

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable */
  }
  return { vouchers: SEED.map((v) => ({ ...v })), uses: [], cards: [], lots: [], spends: [] };
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full */
  }
}

const live = (o: StoredOrder) => o.summary.paymentStatus === 'awaiting_payment' && (o.summary.holdExpiresAt ?? '') > now();
const targets = (target: string, me: Member) =>
  loadMarket().orders.filter((o) => o.buyerId === me.id && live(o) && (o.summary.id === target || o.groupId === target));
const available = (s: Store, userId: string) => s.lots.filter((l) => l.userId === userId && l.expiresAt > now()).reduce((n, l) => n + l.remaining, 0);

export function exampleCodes(target: string, me: Member): CheckoutCodes {
  const s = load();
  const all = loadMarket().orders.filter((o) => o.buyerId === me.id && (o.summary.id === target || o.groupId === target));
  const uses = s.uses.filter((u) => u.target === target && u.state !== 'released');
  const v = uses.length ? s.vouchers.find((x) => x.id === uses[0].voucherId) : null;
  return {
    voucher: v ? { code: v.code, shop: v.shop, discountPence: uses.reduce((n, u) => n + u.discount, 0) } : null,
    balancePence: s.spends.filter((x) => x.state !== 'released' && all.some((o) => o.summary.id === x.orderId)).reduce((n, x) => n + x.amount, 0),
    balanceAvailable: available(s, me.id),
    totalPence: all.filter((o) => ['awaiting_payment', 'paid'].includes(o.summary.paymentStatus)).reduce((n, o) => n + (o.summary.totalPence ?? 0), 0),
    paid: all.length > 0 && all.every((o) => o.summary.paymentStatus === 'paid'),
  };
}

function applyVoucher(s: Store, target: string, code: string, me: Member): Result<void> {
  const v = s.vouchers.find((x) => x.code === code);
  if (!v || !v.active || (v.startsAt && v.startsAt > now()) || (v.endsAt && v.endsAt <= now())) return fail('That code isn’t valid.');
  if (s.uses.some((u) => u.target === target && u.state === 'held')) return fail('A code is already applied. Remove it to use another.');
  if (s.spends.some((x) => x.state === 'held' && targets(target, me).some((o) => o.summary.id === x.orderId))) return fail('Apply your code before using your balance.');
  const usedBy = (pred: (u: Use) => boolean) => new Set(s.uses.filter((u) => u.voucherId === v.id && u.state !== 'released' && pred(u)).map((u) => u.target)).size;
  if (v.maxUses && usedBy(() => true) >= v.maxUses) return fail('That code has been used up.');
  if (usedBy((u) => u.buyerId === me.id) >= v.perMember) return fail('You’ve already used that code.');
  if (v.firstOrderOnly && loadMarket().orders.some((o) => o.buyerId === me.id && o.summary.paymentStatus === 'paid')) return fail('That code is for your first order.');
  const market = loadMarket();
  const eligible = market.orders.filter((o) => o.buyerId === me.id && live(o) && (o.summary.id === target || o.groupId === target) && (!v.sellerId || o.sellerId === v.sellerId));
  if (!eligible.length) return fail(v.shop ? `That code is for items from ${v.shop}.` : 'This checkout has ended. Start again.');
  const subtotal = eligible.reduce((n, o) => n + (o.summary.quote?.pricePence ?? 0), 0);
  if (subtotal < v.minSpendPence) return fail(`Spend at least £${(v.minSpendPence / 100).toFixed(0)} to use that code.`);
  let discount = v.kind === 'percent' ? Math.round((subtotal * v.value) / 100) : Math.min(v.value, subtotal);
  if (v.maxDiscountPence) discount = Math.min(discount, v.maxDiscountPence);
  let left = discount;
  eligible.forEach((o, i) => {
    const q = o.summary.quote!;
    let d = i === eligible.length - 1 ? left : Math.min(left, Math.round((discount * q.pricePence) / Math.max(subtotal, 1)));
    left -= d;
    const prev = { price: q.pricePence, quote: q, total: o.summary.totalPence ?? q.buyerTotalPence };
    if (!v.sellerId) {
      d = Math.min(d, prev.total);
      if (prev.total - d > 0 && prev.total - d < 30) d = Math.max(prev.total - 30, 0);
      o.summary.totalPence = prev.total - d;
      o.summary.quote = { ...q, voucher: { code: v.code, pence: d, funder: 'nutuyu' } } as typeof q;
    } else {
      const price = Math.max(q.pricePence - d, 1);
      const next = computeFees(DEFAULT_FEES, { pricePence: price, postagePence: q.postagePence, payer: q.payer, boostBp: null });
      d = q.pricePence - price;
      o.summary.quote = { ...next, bundle: q.bundle, voucher: { code: v.code, pence: d, funder: 'seller' } } as typeof q;
      o.summary.totalPence = next.buyerTotalPence;
    }
    s.uses.push({ voucherId: v.id, buyerId: me.id, orderId: o.summary.id, target, discount: d, prev, state: 'held' });
  });
  saveMarket(market);
  return { ok: true, value: undefined };
}

function redeem(s: Store, code: string, me: Member): Result<void> {
  const c = s.cards.find((x) => x.code === code && x.paymentStatus === 'paid');
  if (!c) return fail('That gift card code isn’t valid.');
  if (c.redeemedBy) return fail(c.redeemedBy === me.id ? 'You’ve already added this gift card to your balance.' : 'This gift card has already been used.');
  if ((c.expiresAt ?? '') <= now()) return fail('This gift card has expired.');
  c.redeemedBy = me.id;
  c.redeemed = true;
  s.lots.push({ id: id('lot'), userId: me.id, source: 'gift_card', amount: c.amountPence, remaining: c.amountPence, expiresAt: c.expiresAt! });
  return { ok: true, value: undefined };
}

function useBalance(s: Store, target: string, on: boolean, me: Member) {
  const market = loadMarket();
  if (on) {
    for (const o of market.orders.filter((x) => x.buyerId === me.id && live(x) && (x.summary.id === target || x.groupId === target))) {
      if (s.spends.some((x) => x.orderId === o.summary.id && x.state === 'held')) continue;
      let want = o.summary.totalPence ?? 0;
      const have = available(s, me.id);
      if (want > 0 && have < want && want - have < 30) want -= 30;
      let used = 0;
      for (const lot of s.lots.filter((l) => l.userId === me.id && l.remaining > 0 && l.expiresAt > now()).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))) {
        if (used >= want) break;
        const take = Math.min(lot.remaining, want - used);
        lot.remaining -= take;
        s.spends.push({ id: id('spend'), lotId: lot.id, userId: me.id, orderId: o.summary.id, amount: take, state: 'held' });
        used += take;
      }
      o.summary.totalPence = (o.summary.totalPence ?? 0) - used;
    }
  } else {
    for (const x of s.spends.filter((sp) => sp.state === 'held' && sp.userId === me.id)) {
      const o = market.orders.find((y) => y.summary.id === x.orderId && (y.summary.id === target || y.groupId === target) && live(y));
      if (!o) continue;
      s.lots.find((l) => l.id === x.lotId)!.remaining += x.amount;
      x.state = 'released';
      o.summary.totalPence = (o.summary.totalPence ?? 0) + x.amount;
    }
  }
  saveMarket(market);
}

/** Paid or ended orders settle their held codes and balance (the database does this with a trigger). */
export function exampleSettle(): void {
  const s = load();
  const orders = loadMarket().orders;
  let changed = false;
  for (const u of s.uses.filter((x) => x.state === 'held')) {
    const o = orders.find((y) => y.summary.id === u.orderId);
    if (o?.summary.paymentStatus === 'paid') { u.state = 'used'; changed = true; }
    else if (o && ['cancelled', 'expired'].includes(o.summary.paymentStatus)) { u.state = 'released'; changed = true; }
  }
  for (const x of s.spends.filter((y) => y.state === 'held')) {
    const o = orders.find((y) => y.summary.id === x.orderId);
    if (o?.summary.paymentStatus === 'paid') { x.state = 'used'; changed = true; }
    else if (o && ['cancelled', 'expired'].includes(o.summary.paymentStatus)) { x.state = 'released'; s.lots.find((l) => l.id === x.lotId)!.remaining += x.amount; changed = true; }
  }
  if (changed) save(s);
}

export const exampleMoney = {
  codes: (target: string, me: Member) => { exampleSettle(); return exampleCodes(target, me); },
  applyCode(target: string, raw: string, me: Member): Result<CheckoutCodes> {
    const s = load();
    const code = raw.trim().toUpperCase();
    let r: Result<void>;
    if (s.vouchers.some((v) => v.code === code)) r = applyVoucher(s, target, code, me);
    else if (s.cards.some((c) => c.code === code)) {
      r = redeem(s, code, me);
      if (r.ok) useBalance(s, target, true, me);
    } else r = fail('That code isn’t valid.');
    if (!r.ok) return r;
    save(s);
    return { ok: true, value: exampleCodes(target, me) };
  },
  removeVoucher(target: string, me: Member): Result<CheckoutCodes> {
    const s = load();
    if (s.spends.some((x) => x.state === 'held' && targets(target, me).some((o) => o.summary.id === x.orderId))) return fail('Stop using your balance first, then remove the code.');
    const market = loadMarket();
    for (const u of s.uses.filter((x) => x.target === target && x.state === 'held' && x.buyerId === me.id)) {
      const o = market.orders.find((y) => y.summary.id === u.orderId);
      if (o && o.summary.paymentStatus === 'awaiting_payment') {
        o.summary.quote = u.prev.quote as StoredOrder['summary']['quote'];
        o.summary.totalPence = u.prev.total;
      }
      u.state = 'released';
    }
    saveMarket(market);
    save(s);
    return { ok: true, value: exampleCodes(target, me) };
  },
  useBalance(target: string, on: boolean, me: Member): Result<CheckoutCodes> {
    const s = load();
    useBalance(s, target, on, me);
    save(s);
    return { ok: true, value: exampleCodes(target, me) };
  },
  /** Every code (staff), or one shop's. */
  vouchers(sellerId?: string): Voucher[] {
    const s = load();
    return s.vouchers.filter((v) => sellerId === undefined || v.sellerId === sellerId).map(({ sellerId: _s, ...v }) => ({
      ...v,
      uses: new Set(s.uses.filter((u) => u.voucherId === v.id && u.state === 'used').map((u) => u.target)).size,
      discountGivenPence: s.uses.filter((u) => u.voucherId === v.id && u.state === 'used').reduce((n, u) => n + u.discount, 0),
    }));
  },
  saveVoucher(vid: string | null, patch: VoucherPatch, seller: { id: string; username: string } | null): Result<void> {
    const s = load();
    if (vid) {
      const v = s.vouchers.find((x) => x.id === vid && (seller ? x.sellerId === seller.id : true));
      if (!v) return fail('Code not found.');
      Object.assign(v, { active: patch.active ?? v.active, endsAt: patch.endsAt !== undefined ? patch.endsAt : v.endsAt, maxUses: patch.maxUses !== undefined ? patch.maxUses : v.maxUses, note: patch.note ?? v.note });
    } else {
      const code = (patch.code ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,20}$/.test(code)) return fail('Codes are 3 to 20 letters, numbers or dashes.');
      if (s.vouchers.some((x) => x.code === code)) return fail('That code is taken. Choose another.');
      if (!patch.kind || !patch.value || patch.value <= 0) return fail('Choose the discount.');
      if (seller && patch.kind === 'percent' && patch.value > 50) return fail('Shop codes can take up to 50% off.');
      s.vouchers.unshift({
        id: id('v'), code, shop: seller?.username ?? null, sellerId: seller?.id ?? null, kind: patch.kind, value: patch.value, minSpendPence: patch.minSpendPence ?? 0,
        maxDiscountPence: patch.maxDiscountPence ?? null, perMember: patch.perMember ?? 1, maxUses: patch.maxUses ?? null, firstOrderOnly: seller ? false : !!patch.firstOrderOnly,
        startsAt: patch.startsAt ?? null, endsAt: patch.endsAt ?? null, active: patch.active ?? true, note: patch.note ?? null, uses: 0, discountGivenPence: 0,
      });
    }
    save(s);
    return { ok: true, value: undefined };
  },
  buyCard(me: Member, amount: number, name: string, email: string, message: string): Result<GiftCard> {
    if (!Number.isInteger(amount) || amount < 1000 || amount > 25000) return fail('Gift cards are £10 to £250.');
    const s = load();
    const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    const code = Array.from({ length: 16 }, (_, i) => alphabet[Math.floor(Math.random() * 30)] + ([3, 7, 11].includes(i) ? '-' : '')).join('');
    const c: Card = {
      id: id('card'), amountPence: amount, recipientName: name.trim() || null, recipientEmail: email.trim().toLowerCase() || null, message: message.trim() || null,
      paymentStatus: 'awaiting_payment', paidAt: null, expiresAt: null, createdAt: now(), code, redeemed: false, purchaserId: me.id, redeemedBy: null,
    };
    s.cards.unshift(c);
    save(s);
    return { ok: true, value: { ...c, code: null } as GiftCard };
  },
  payCard(me: Member, cid: string): Result<void> {
    const s = load();
    const c = s.cards.find((x) => x.id === cid && x.purchaserId === me.id && x.paymentStatus === 'awaiting_payment');
    if (!c) return fail('Start again from Gift cards.');
    Object.assign(c, { paymentStatus: 'paid', paidAt: now(), expiresAt: new Date(Date.now() + 2 * 365 * 86_400_000).toISOString() });
    save(s);
    return { ok: true, value: undefined };
  },
  cancelCard(me: Member, cid: string) {
    const s = load();
    const c = s.cards.find((x) => x.id === cid && x.purchaserId === me.id && x.paymentStatus === 'awaiting_payment');
    if (c) c.paymentStatus = 'cancelled';
    save(s);
  },
  myCards(me: Member): GiftCard[] {
    return load().cards.filter((c) => c.purchaserId === me.id && c.paymentStatus !== 'cancelled')
      .map(({ purchaserId: _p, redeemedBy: _r, ...c }) => ({ ...c, code: c.paymentStatus === 'paid' ? c.code : null }));
  },
  redeem(me: Member, code: string): Result<Balance> {
    const s = load();
    const r = redeem(s, code.trim().toUpperCase(), me);
    if (!r.ok) return r;
    save(s);
    return { ok: true, value: this.balance(me) };
  },
  balance(me: Member): Balance {
    exampleSettle();
    const s = load();
    return {
      balancePence: available(s, me.id),
      lots: s.lots.filter((l) => l.userId === me.id && l.remaining > 0 && l.expiresAt > now()).map((l) => ({ source: l.source, amountPence: l.amount, remainingPence: l.remaining, expiresAt: l.expiresAt })),
    };
  },
};
