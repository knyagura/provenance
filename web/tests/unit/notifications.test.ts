import { beforeEach, describe, expect, it } from 'vitest';
import { when } from '@/components/market/Notifications';
import type { StoredOrder } from '@/lib/selling/exampleMarket';
import { exampleNotifications, exampleNotifyMessage, exampleNotifyOrderChange, exampleReadOrderMessages, groupOf } from '@/lib/selling/exampleNotifications';

// A tiny localStorage for node.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});

const SELLER = 'example:sam@example.test';
const BUYER = 'example:bea@example.com';
function order(over: Partial<StoredOrder['custody']> | null, paid = true): StoredOrder {
  return {
    summary: { id: 'o1', title: 'Coat', paymentStatus: paid ? 'paid' : 'awaiting_payment' } as StoredOrder['summary'],
    buyerId: BUYER, sellerId: SELLER,
    custody: over === null ? null : {
      tier: 'enhanced', state: 'in_progress', step: 0, head: '0', events: [], challenges: {}, seals: {}, weightFlag: false, disputeReason: null, payoutStatus: 'held', ...over,
    },
  };
}
const kinds = (id: string) => exampleNotifications.list(id).map((n) => n.kind);

describe('example notifications follow migration 016', () => {
  beforeEach(() => store.clear());

  it('tells the seller about a sale, without a separate turn notification', () => {
    exampleNotifyOrderChange(order(null, false), order({}));
    expect(kinds(SELLER)).toEqual(['sold']);
    expect(kinds(BUYER)).toEqual([]);
  });

  it('only says “your turn” when the turn moves to the other person', () => {
    exampleNotifyOrderChange(order({ step: 0 }), order({ step: 1 }));
    expect(kinds(SELLER)).toEqual([]);
    exampleNotifyOrderChange(order({ step: 1 }), order({ step: 2 }));
    const [n] = exampleNotifications.list(BUYER);
    expect(n.kind).toBe('turn');
    expect(n.body).toMatch(/^Check the item/);
    exampleNotifyOrderChange(order({ step: 1 }), order({ step: 2 }));
    expect(kinds(BUYER)).toEqual(['turn']);
  });

  it('reports payment released, problems and decisions', () => {
    exampleNotifyOrderChange(order({ step: 2 }), order({ step: 3, state: 'confirmed', payoutStatus: 'due' }));
    expect(kinds(SELLER)).toEqual(['payout']);
    exampleNotifyOrderChange(order({ step: 2 }), order({ step: 2, state: 'disputed' }));
    exampleNotifyOrderChange(order({ state: 'disputed' }), order({ state: 'disputed', payoutStatus: 'refund', resolution: 'refund' } as never));
    expect(kinds(SELLER)).toEqual(['decision', 'dispute', 'payout']);
    expect(exampleNotifications.list(BUYER)[0].body).toBe('Our team has refunded you.');
  });

  it('groups messages on an order until they are read', () => {
    exampleNotifyMessage(SELLER, 'o1', 'Coat', 'bea', 'Hello');
    exampleNotifyMessage(SELLER, 'o1', 'Coat', 'bea', 'Still there?');
    let [n] = exampleNotifications.list(SELLER);
    expect(n.count).toBe(2);
    expect(n.title).toBe('2 new messages about Coat');
    expect(n.body).toBe('bea: Still there?');
    expect(exampleNotifications.unread(SELLER)).toBe(1);
    exampleReadOrderMessages(SELLER, 'o1');
    expect(exampleNotifications.unread(SELLER)).toBe(0);
    exampleNotifyMessage(SELLER, 'o1', 'Coat', 'bea', 'Thanks');
    [n] = exampleNotifications.list(SELLER);
    expect(n.count).toBe(1);
    expect(exampleNotifications.list(SELLER)).toHaveLength(2);
  });

  it('keeps email choices per person and marks read', () => {
    expect(exampleNotifications.prefs(BUYER)).toEqual({ turn: true, messages: true, offers: true, sales: true, alerts: true });
    exampleNotifications.setPrefs(BUYER, { turn: true, messages: false, offers: true, sales: true, alerts: true });
    expect(exampleNotifications.prefs(BUYER).messages).toBe(false);
    expect(exampleNotifications.prefs(SELLER).messages).toBe(true);
    exampleNotifyMessage(SELLER, 'o1', 'Coat', 'bea', 'Hi');
    exampleNotifications.markRead(SELLER, null);
    expect(exampleNotifications.unread(SELLER)).toBe(0);
  });

  it('groups kinds and words times', () => {
    expect(groupOf('offer_expiring')).toBe('offers');
    expect(groupOf('decision')).toBe('sales');
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(when('2026-10-17T11:59:40Z', now)).toBe('just now');
    expect(when('2026-10-17T11:45:00Z', now)).toBe('15 min ago');
    expect(when('2026-10-17T09:00:00Z', now)).toBe('3 hours ago');
  });
});
