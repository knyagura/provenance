import { stepAt } from '@/lib/domain/custody';
import { formatPence } from '@/lib/format';
import type { StoredOrder } from './exampleMarket';
import type { AppNotification, NotificationGroup, NotificationKind, NotificationPrefs } from './types';

// Example mode's notifications, shared between tabs in localStorage like the example orders. They follow
// the database triggers in migration 016 (tests/notification_checks.mjs); no emails are sent here.

const KEY = 'pv-example-notifications';
const MAX_PER_PERSON = 100;

interface Stored extends AppNotification { userId: string; orderId: string | null; dedupe: string | null }
interface Store { items: Stored[]; prefs: Record<string, NotificationPrefs> }

export const ALL_EMAILS: NotificationPrefs = { turn: true, messages: true, offers: true, sales: true, alerts: true };

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { items: [], prefs: {}, ...JSON.parse(raw) } as Store;
  } catch {
    /* storage unavailable */
  }
  return { items: [], prefs: {} };
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full */
  }
}

export function groupOf(kind: NotificationKind): NotificationGroup {
  if (kind === 'turn') return 'turn';
  if (kind === 'message') return 'messages';
  if (kind.startsWith('offer_')) return 'offers';
  if (kind === 'search_match' || kind === 'price_drop') return 'alerts';
  return 'sales';
}

export function exampleNotify(userId: string | null | undefined, kind: NotificationKind, title: string, body: string, link: string,
  opts: { orderId?: string | null; dedupe?: string | null } = {}): void {
  if (!userId) return;
  const s = load();
  if (opts.dedupe && s.items.some((n) => n.userId === userId && n.dedupe === opts.dedupe)) return;
  const at = new Date().toISOString();
  s.items.push({
    id: `note-${Math.random().toString(36).slice(2, 10)}`, userId, kind, group: groupOf(kind), title, body, link, count: 1, createdAt: at,
    read: false, emailed: false, orderId: opts.orderId ?? null, dedupe: opts.dedupe ?? null,
  });
  s.items = s.items.filter((n) => n.userId !== userId).concat(s.items.filter((n) => n.userId === userId).slice(-MAX_PER_PERSON));
  save(s);
}

/** A new message: one unread notification per order, showing the latest. */
export function exampleNotifyMessage(toUserId: string, orderId: string, title: string, from: string, body: string): void {
  const s = load();
  const n = s.items.find((x) => x.userId === toUserId && x.kind === 'message' && x.orderId === orderId && !x.read);
  if (!n) return exampleNotify(toUserId, 'message', `New message about ${title}`, `${from}: ${body.slice(0, 400)}`, `/orders/${orderId}#messages`, { orderId });
  n.count += 1;
  n.title = `${n.count} new messages about ${title}`;
  n.body = `${from}: ${body.slice(0, 400)}`;
  n.createdAt = new Date().toISOString();
  save(s);
}

export function exampleReadOrderMessages(userId: string, orderId: string): void {
  const s = load();
  for (const n of s.items) if (n.userId === userId && n.orderId === orderId && n.kind === 'message') n.read = true;
  save(s);
}

/** What changed on an order, as the database's orders_notify trigger sees it. */
export function exampleNotifyOrderChange(before: StoredOrder | undefined, o: StoredOrder): void {
  const t = o.summary.title;
  const link = `/orders/${o.summary.id}`;
  const id = o.summary.id;
  const soldNow = o.summary.paymentStatus === 'paid' && before?.summary.paymentStatus !== 'paid';
  // Seller posts it themselves and there's no address yet: ask the buyer (as migration 025 does).
  const tier = o.custody?.tier ?? o.summary.quote?.tier ?? 'enhanced';
  if (soldNow && tier === 'enhanced' && !o.shipTo && !(o as { deliverTo?: unknown }).deliverTo) {
    exampleNotify(o.buyerId, 'turn', 'Where should it be delivered?', 'Add your delivery address so the seller can post your item.', link, { orderId: id, dedupe: `address:${id}` });
  }
  if (soldNow) exampleNotify(o.sellerId, 'sold', `Sold: ${t}`, 'Payment is held safely until the buyer confirms. Your first step is ready: open the order to start the handover.', link, { orderId: id });

  const c = o.custody;
  const b = before?.custody ?? null;
  if (c && c.state === 'in_progress' && (b?.state !== 'in_progress' || b.step !== c.step)) {
    const cur = stepAt(c.tier, c.step, c.state);
    const prev = b ? stepAt(b.tier, b.step, b.state) : null;
    if (cur && cur.actor !== prev?.actor && !(soldNow && cur.actor === 'seller')) {
      const dedupe = `turn:${id}:${c.step}`;
      if (cur.actor === 'seller') exampleNotify(o.sellerId, 'turn', `Your turn: ${t}`, 'The next handover step for this order is yours.', link, { orderId: id, dedupe });
      if (cur.actor === 'buyer') {
        exampleNotify(o.recipientId || o.buyerId, 'turn', `Your turn: ${t}`,
          cur.key === 'confirm' ? 'Check the item and confirm it arrived as described, or report a problem.' : 'It’s on its way to you. Open the order for the next step.',
          link, { orderId: id, dedupe });
      }
    }
  }
  if (c?.state === 'disputed' && b?.state !== 'disputed') {
    exampleNotify(o.sellerId, 'dispute', `Problem reported: ${t}`, 'The buyer reported a problem. Payment stays held while our team looks at the record. You can reply in the order’s messages.', link, { orderId: id });
  }
  const res = (c as { resolution?: string } | null)?.resolution;
  if (res && !(b as { resolution?: string } | null)?.resolution) {
    exampleNotify(o.sellerId, 'decision', `Decision on ${t}`, res === 'release' ? 'Our team has released the payment to you.' : 'Our team has refunded the buyer.', link, { orderId: id });
    exampleNotify(o.buyerId, 'decision', `Decision on ${t}`, res === 'release' ? 'Our team has released the payment to the seller.' : 'Our team has refunded you.', link, { orderId: id });
  } else if (c?.payoutStatus === 'due' && b?.payoutStatus !== 'due') {
    exampleNotify(o.sellerId, 'payout', `Payment released: ${t}`, 'The buyer confirmed the item. The payment is on its way to you.', link, { orderId: id });
  }
}

export const offerWords = {
  newOffer: (title: string, buyer: string, pence: number) => [`New offer: ${formatPence(pence)} for ${title}`, `${buyer} offered ${formatPence(pence)}. Accept, counter or decline.`] as const,
  counter: (title: string, who: string, pence: number) => [`${who} offered ${formatPence(pence)} for ${title}`, 'In reply to your offer.'] as const,
  accepted: (title: string, text: string) => [`Offer accepted: ${title}`, text] as const,
};

export const exampleNotifications = {
  list(userId: string): AppNotification[] {
    return load().items.filter((n) => n.userId === userId).reverse()
      .map(({ userId: _u, orderId: _o, dedupe: _d, ...n }) => n);
  },
  unread(userId: string): number {
    return load().items.filter((n) => n.userId === userId && !n.read).length;
  },
  markRead(userId: string, ids: string[] | null): void {
    const s = load();
    for (const n of s.items) if (n.userId === userId && (!ids || ids.includes(n.id))) n.read = true;
    save(s);
  },
  prefs(userId: string): NotificationPrefs {
    return { ...ALL_EMAILS, ...load().prefs[userId] };
  },
  setPrefs(userId: string, p: NotificationPrefs): NotificationPrefs {
    const s = load();
    s.prefs[userId] = { ...p };
    save(s);
    return { ...p };
  },
};
