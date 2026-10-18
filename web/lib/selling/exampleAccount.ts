// Example mode's saved addresses, privacy tools, identity checks and returns, kept in this browser's localStorage.
// Same rules as migrations 030–033 (tests/returns_checks.mjs and tests/privacy_checks.mjs check the database).
// Example limits: identity checks pass straight away (there's no Stripe), and deleting an example account clears
// what this browser holds for it.
import { stepAt } from '@/lib/domain/custody';
import { exampleNotify } from './exampleNotifications';
import { append, loadMarket, saveMarket, type StoredOrder } from './exampleMarket';
import { cleanAddress } from './shipping';
import type { Address, IdentityStatus, Member, OrderReturn, Result, ReturnReason, SavedAddress, ShippingLabel } from './types';

const KEY = 'pv-example-account';
interface Store {
  addresses: Record<string, SavedAddress[]>;
  identity: Record<string, IdentityStatus>;
  deleted: Record<string, string>;
}
const empty = (): Store => ({ addresses: {}, identity: {}, deleted: {} });
function load(): Store {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) };
  } catch {
    return empty();
  }
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const now = () => new Date().toISOString();

/** The member's default address (used when an example order is paid, and for returns). */
export function exampleDefaultAddress(memberKey: string): Address | null {
  return load().addresses[memberKey]?.find((a) => a.isDefault)?.address ?? null;
}

// ---------- Returns ----------
interface StoredReturn {
  status: NonNullable<OrderReturn['return']>['status']; reason: ReturnReason; note: string | null; sellerNote: string | null; autoAccepted: boolean;
  requestedAt: string; decidedAt: string | null; postedAt: string | null; receivedAt: string | null; label: OrderReturn['label'];
}
type WithReturn = StoredOrder & { ret?: StoredReturn | null; label?: ShippingLabel | null };

function returnView(o: WithReturn, m: Member): OrderReturn {
  const c = o.custody;
  const cur = c ? stepAt(c.tier, c.step, c.state) : null;
  const r = o.ret ?? null;
  return {
    canRequest: o.buyerId === m.id && !r && o.summary.paymentStatus === 'paid' && c?.state === 'in_progress' && cur?.key === 'confirm' && cur.actor === 'buyer',
    return: r ? {
      status: r.status, reason: r.reason, note: r.note, sellerNote: r.sellerNote, autoAccepted: r.autoAccepted, requestedAt: r.requestedAt,
      respondBy: new Date(Date.parse(r.requestedAt) + 48 * 3_600_000).toISOString(), decidedAt: r.decidedAt, postedAt: r.postedAt, receivedAt: r.receivedAt,
    } : null,
    label: r?.label ? { ...r.label, deliverTo: o.buyerId === m.id ? r.label.deliverTo : null } : null,
  };
}

async function withOrder(orderId: string, m: Member | null, fn: (o: WithReturn, market: ReturnType<typeof loadMarket>) => Promise<Result<OrderReturn>> | Result<OrderReturn>): Promise<Result<OrderReturn>> {
  if (!m) return fail('Sign in first.');
  const market = loadMarket();
  const o = market.orders.find((x) => x.summary.id === orderId) as WithReturn | undefined;
  if (!o || (o.buyerId !== m.id && o.sellerId !== m.id)) return fail('Order not found.');
  return fn(o, market);
}

export const exampleAccount = {
  addresses(m: Member | null): SavedAddress[] {
    return m ? load().addresses[m.id] ?? [] : [];
  },
  saveAddress(m: Member | null, id: string | null, label: string, a: Address, makeDefault: boolean): Result<SavedAddress[]> {
    if (!m) return fail('Sign in first.');
    const clean = cleanAddress(a);
    if (typeof clean === 'string') return fail(clean);
    const s = load();
    const list = s.addresses[m.id] ?? [];
    const lbl = label.trim() || null;
    if (lbl && lbl.length > 40) return fail('Keep the label short, like Home or Work.');
    const first = list.length === 0;
    if (makeDefault || first) for (const x of list) if (x.id !== id) x.isDefault = false;
    if (id) {
      const x = list.find((y) => y.id === id);
      if (!x) return fail('Address not found.');
      Object.assign(x, { label: lbl, address: clean, isDefault: makeDefault || x.isDefault });
    } else {
      if (list.length >= 5) return fail('You can keep up to 5 addresses. Delete one first.');
      list.push({ id: crypto.randomUUID(), label: lbl, address: clean, isDefault: makeDefault || first });
    }
    s.addresses[m.id] = list.sort((x, y) => Number(y.isDefault) - Number(x.isDefault));
    save(s);
    return { ok: true, value: s.addresses[m.id] };
  },
  deleteAddress(m: Member | null, id: string): Result<SavedAddress[]> {
    if (!m) return fail('Sign in first.');
    const s = load();
    const list = (s.addresses[m.id] ?? []).filter((a) => a.id !== id);
    if (list.length && !list.some((a) => a.isDefault)) list[0].isDefault = true;
    s.addresses[m.id] = list;
    save(s);
    return { ok: true, value: list };
  },

  exportData(m: Member | null): Result<Record<string, unknown>> {
    if (!m) return fail('Sign in first.');
    const orders = loadMarket().orders.filter((o) => o.buyerId === m.id || o.sellerId === m.id).map((o) => ({
      id: o.summary.id, role: o.buyerId === m.id ? 'buyer' : 'seller', title: o.summary.title, paid_at: o.summary.paidAt, total_pence: o.buyerId === m.id ? o.summary.totalPence : null,
      state: o.custody?.state ?? null,
    }));
    return {
      ok: true,
      value: {
        exported_at: now(), about: 'Example mode: what this browser holds for your example account.',
        account: { email: m.email, username: m.username }, addresses: load().addresses[m.id] ?? [], identity: load().identity[m.id] ?? null, orders,
      },
    };
  },
  blockers(m: Member | null): string[] {
    if (!m) return [];
    const open = (o: StoredOrder) => o.summary.paymentStatus === 'paid' && (o.custody?.state === 'in_progress' || (o.custody?.state === 'disputed' && !(o.custody as { resolution?: string }).resolution));
    const orders = loadMarket().orders;
    return [
      orders.some((o) => o.buyerId === m.id && open(o)) ? 'You have an order on its way to you. Confirm it or wait for it to finish first.' : null,
      orders.some((o) => o.sellerId === m.id && open(o)) ? 'You have a sale in progress. Finish the handover first.' : null,
    ].filter((x): x is string => !!x);
  },
  deleteAccount(m: Member | null, confirm: string): Result {
    if (!m) return fail('Account not found.');
    if (confirm.trim().toLowerCase() !== m.username.toLowerCase()) return fail('Type your username to confirm.');
    const b = this.blockers(m);
    if (b.length) return fail(b[0]);
    const s = load();
    delete s.addresses[m.id];
    delete s.identity[m.id];
    s.deleted[m.id] = now();
    save(s);
    return { ok: true, value: undefined };
  },

  identity(m: Member | null): IdentityStatus | null {
    if (!m) return null;
    return load().identity[m.id] ?? { verified: false, latest: null, canStart: true };
  },
  startIdentity(m: Member | null): Result<{ url: string | null }> {
    if (!m) return fail('Sign in first.');
    const s = load();
    s.identity[m.id] = { verified: true, latest: { status: 'verified', error: null, at: now() }, canStart: false };
    save(s);
    exampleNotify(m.id, 'decision', 'Your identity is checked', 'Thanks. Your profile now shows “Identity checked”.', '/profile', { dedupe: `identity:${m.id}` });
    return { ok: true, value: { url: null } };
  },

  async orderReturn(orderId: string, m: Member | null): Promise<OrderReturn | null> {
    const r = await withOrder(orderId, m, (o) => ({ ok: true, value: returnView(o, m!) }));
    return r.ok ? r.value : null;
  },
  requestReturn(orderId: string, reason: ReturnReason, note: string, m: Member | null) {
    return withOrder(orderId, m, async (o, market) => {
      if (!returnView(o, m!).canRequest) return fail('You can ask to return it once it has arrived, before you confirm.');
      if (!['not_as_described', 'damaged', 'wrong_item'].includes(reason)) return fail('Choose why you’re returning it.');
      const n = note.trim() || null;
      if ((n?.length ?? 0) > 500) return fail('Keep the note under 500 characters.');
      o.ret = { status: 'requested', reason, note: n, sellerNote: null, autoAccepted: false, requestedAt: now(), decidedAt: null, postedAt: null, receivedAt: null, label: null };
      await append(o, 'return_requested', 'buyer', m!.id, n ? { reason, note: n } : { reason });
      Object.assign(o.custody!, { state: 'disputed', disputeReason: 'return' });
      saveMarket(market);
      exampleNotify(o.sellerId, 'turn', 'Return requested', 'The buyer wants to return an item. Accept or decline within 48 hours, or it’s accepted for you.', `/orders/${orderId}`, { orderId, dedupe: `return:${orderId}` });
      return { ok: true, value: returnView(o, m!) };
    });
  },
  respondReturn(orderId: string, accept: boolean, note: string, m: Member | null) {
    return withOrder(orderId, m, async (o, market) => {
      if (o.sellerId !== m!.id || !o.ret) return fail('Order not found.');
      if (o.ret.status !== 'requested') return fail('You’ve already answered this return.');
      if (accept) {
        const dest = exampleDefaultAddress(o.sellerId);
        const hex = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 9).toUpperCase();
        Object.assign(o.ret, {
          status: 'accepted', decidedAt: now(),
          label: dest ? { carrier: 'Evri', service: 'Evri drop-off, 2–3 days', tracking: `P2GTEST${hex}`, mode: 'test', deliverTo: dest, labelUrl: null } : null,
        });
        await append(o, 'return_accepted', 'seller', m!.id, { auto: false });
        exampleNotify(o.buyerId, 'turn', 'Your return is accepted', dest ? 'Print the return label from your order and post it back.' : 'Post it back to the seller; they’ll message you the address.', `/orders/${orderId}`, { orderId, dedupe: `return-accepted:${orderId}` });
      } else {
        if (note.trim().length < 3) return fail('Say why you’re declining: our team will read it.');
        Object.assign(o.ret, { status: 'declined', sellerNote: note.trim(), decidedAt: now() });
        await append(o, 'return_declined', 'seller', m!.id, { note: note.trim() });
      }
      saveMarket(market);
      return { ok: true, value: returnView(o, m!) };
    });
  },
  returnPosted(orderId: string, m: Member | null) {
    return withOrder(orderId, m, async (o, market) => {
      if (o.buyerId !== m!.id || o.ret?.status !== 'accepted') return fail('The return needs accepting first.');
      Object.assign(o.ret, { status: 'posted', postedAt: now() });
      await append(o, 'return_posted', 'buyer', m!.id, o.ret.label ? { carrier: o.ret.label.carrier, tracking: o.ret.label.tracking } : {});
      saveMarket(market);
      exampleNotify(o.sellerId, 'turn', 'Return on its way', 'The buyer has posted the item back. Confirm when it arrives so they’re refunded.', `/orders/${orderId}`, { orderId, dedupe: `return-posted:${orderId}` });
      return { ok: true, value: returnView(o, m!) };
    });
  },
  returnReceived(orderId: string, m: Member | null) {
    return withOrder(orderId, m, async (o, market) => {
      if (o.sellerId !== m!.id) return fail('Order not found.');
      if (!o.ret || !['accepted', 'posted'].includes(o.ret.status)) return fail('There’s no return on its way for this order.');
      Object.assign(o.ret, { status: 'received', receivedAt: now() });
      await append(o, 'return_received', 'seller', m!.id, {});
      Object.assign(o.custody!, { payoutStatus: 'refund', resolution: 'refund' });
      saveMarket(market);
      exampleNotify(o.buyerId, 'decision', 'Your refund is on its way', 'The seller has the item back, so you’re refunded.', `/orders/${orderId}`, { orderId, dedupe: `refund:${orderId}` });
      return { ok: true, value: returnView(o, m!) };
    });
  },
  cancelReturn(orderId: string, m: Member | null) {
    return withOrder(orderId, m, async (o, market) => {
      if (o.buyerId !== m!.id || !o.ret || !['requested', 'accepted'].includes(o.ret.status)) return fail('This return can’t be cancelled now.');
      Object.assign(o.ret, { status: 'cancelled', label: null });
      await append(o, 'return_cancelled', 'buyer', m!.id, {});
      Object.assign(o.custody!, { state: 'in_progress', disputeReason: null });
      saveMarket(market);
      return { ok: true, value: returnView(o, m!) };
    });
  },
};

