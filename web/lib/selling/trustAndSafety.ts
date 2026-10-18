// Payouts, questions and moderation: the database's JSON as the web's shapes (migrations 028, 029).
import type { ListingQuestion, PayoutSummary, StaffModeration, StaffPayouts } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toPayouts = (d: any): PayoutSummary => ({
  account: d?.account ? { connected: true, detailsSubmitted: !!d.account.details_submitted, payoutsEnabled: !!d.account.payouts_enabled } : null,
  waitingPence: Number(d?.waiting_pence ?? 0),
  sentPence: Number(d?.sent_pence ?? 0),
  recent: (d?.recent ?? []).map((r: any) => ({
    id: r.id, orderId: r.order_id, title: r.title ?? 'Item', amountPence: Number(r.amount_pence), labelPence: Number(r.label_pence ?? 0),
    status: r.status, createdAt: r.created_at, sentAt: r.sent_at ?? null,
  })),
});
export const toStaffPayouts = (d: any): StaffPayouts => ({
  counts: d?.counts ?? {}, totals: d?.totals ?? {},
  items: (d?.items ?? []).map((i: any) => ({
    id: i.id, orderId: i.order_id, seller: i.seller, amountPence: Number(i.amount_pence), status: i.status, attempts: Number(i.attempts ?? 0),
    lastError: i.last_error ?? null, holdReason: i.hold_reason ?? null, updatedAt: i.updated_at, sentAt: i.sent_at ?? null,
    connected: !!i.connected, payoutsEnabled: !!i.payouts_enabled,
  })),
});
export const toQuestions = (d: any): ListingQuestion[] => (Array.isArray(d) ? d : []).map((q: any) => ({
  id: q.id, body: q.body, answer: q.answer ?? null, answeredAt: q.answered_at ?? null, createdAt: q.created_at, mine: !!q.mine, canAnswer: !!q.can_answer,
}));
export const toModeration = (d: any): StaffModeration => ({
  open: Number(d?.open ?? 0), suspended: Number(d?.suspended ?? 0), hidden: Number(d?.hidden ?? 0),
  items: (d?.items ?? []).map((i: any) => ({
    kind: i.kind, listingId: i.listing_id ?? null, title: i.title ?? null, hidden: !!i.hidden, member: i.member ?? null, suspended: !!i.suspended,
    count: Number(i.count), latest: i.latest, reasons: i.reasons ?? [], notes: i.notes ?? [],
  })),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export const REPORT_REASONS: Record<string, string> = {
  counterfeit: 'It looks fake',
  prohibited: 'It isn’t allowed on NuTuYu',
  scam: 'Scam, or asking to pay outside NuTuYu',
  offensive: 'Offensive or inappropriate',
  wrong_category: 'Wrong category or misleading',
  other: 'Something else',
};
export const PAYOUT_STATUS: Record<string, string> = {
  waiting: 'Waiting for you to set up payouts',
  queued: 'On its way',
  sending: 'On its way',
  sent: 'Sent to your bank',
  failed: 'Delayed: our team is looking at it',
  held: 'On hold',
};

/** The same contact-details rule as the database, so people see it before sending. */
export function hasContactDetails(t: string): boolean {
  return /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|((\+44|0)7\d{3}[\s-]?\d{6})|(\b(whatsapp|paypal|bank transfer)\b)/i.test(t);
}
