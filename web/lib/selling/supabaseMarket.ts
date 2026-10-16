import { supabase } from '@/lib/supabase';
import { breakdownFromJson } from '@/lib/domain/fees';
import { mediaUrl, toListing } from '@/lib/domain/catalogue';
import type { Tier } from '@/lib/domain/types';
import type {
  CheckoutStarted, MarketBackend, Offer, OrderMessage, Passport, Result, Review, StaffAgent, StaffOrder, StaffQueueItem, StaffSettings,
} from './types';

// Favourites, messages, offers, reviews, the Item Passport and the staff console, through Supabase.
// Row Level Security and the functions in migration 012 decide what is allowed; this file only translates.

type Err = { message: string; code?: string };
const fail = (e: Err): { ok: false; message: string } => ({ ok: false, message: tidy(e.message) });
const done = { ok: true as const, value: undefined };

/** Database errors are already written for people; strip the technical prefix some carry. */
function tidy(m: string): string {
  if (/permission denied|row-level security/i.test(m)) return 'You can’t do that here.';
  if (/Failed to fetch|NetworkError|timeout/i.test(m)) return 'We couldn’t reach NuTuYu. Check your connection and try again.';
  return m.replace(/^LISTING_CHANGED:\s*/, '');
}

async function uid(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

const LISTING_COLUMNS = [
  'id', 'item_id', 'title', 'description', 'brand', 'category', 'size_label', 'colour', 'condition_label',
  'price_pence', 'shipping_pence', 'tier', 'status', 'created_at', 'serial_hint', 'revision',
  'seller:profiles!listings_seller_id_fkey(username, kyc_verified, is_pro, holiday_mode)',
  'media:listing_media(path, kind, shot, position, retired_at)',
].join(', ');

interface OfferJson {
  id: string; listing_id: string; title: string; price_pence: number; amount_pence: number; made_by: 'buyer' | 'seller';
  status: Offer['status']; role: 'buyer' | 'seller'; buyer: string; seller: string; counter_of: string | null; created_at: string; expires_at: string;
}
const toOffer = (o: OfferJson): Offer => ({
  id: o.id, listingId: o.listing_id, title: o.title, pricePence: o.price_pence, amountPence: o.amount_pence, madeBy: o.made_by,
  status: o.status, role: o.role, buyer: o.buyer, seller: o.seller, counterOf: o.counter_of, createdAt: o.created_at, expiresAt: o.expires_at,
});

interface ReviewRow { rating: number; body: string | null; created_at: string; author_role: 'buyer' | 'seller'; author?: string; author_id?: string }
const toReview = (r: ReviewRow): Review => ({ rating: r.rating, body: r.body, createdAt: r.created_at, authorRole: r.author_role, author: r.author });

function toStaffOrder(j: Record<string, unknown> | null): StaffOrder | null {
  if (!j) return null;
  return {
    orderId: j.order_id as string, listingId: j.listing_id as string, title: j.title as string, buyer: j.buyer as string, seller: j.seller as string,
    paymentStatus: j.payment_status as StaffOrder['paymentStatus'], paymentRef: (j.payment_ref as string) ?? null, totalPence: (j.total_pence as number) ?? null,
    tier: (j.tier as Tier) ?? null, state: j.state as string, disputeReason: (j.dispute_reason as string) ?? null,
    disputeResolution: (j.dispute_resolution as StaffOrder['disputeResolution']) ?? null, payoutStatus: j.payout_status as string, weightFlag: Boolean(j.weight_flag),
    events: ((j.events as Record<string, unknown>[]) ?? []).map((e) => ({
      seq: e.seq as number, step: e.step as string, actorRole: e.actor_role as string, actor: (e.actor as string) ?? null, at: e.at as string,
      evidence: (e.evidence as Record<string, unknown>) ?? {}, hash: e.hash as string,
    })),
    messages: ((j.messages as Record<string, unknown>[]) ?? []).map((m) => ({ from: m.from as string, role: m.role as string, body: m.body as string, at: m.at as string })),
    actions: ((j.actions as Record<string, unknown>[]) ?? []).map((a) => ({ action: a.action as string, by: a.by as string, detail: (a.detail as Record<string, unknown>) ?? {}, at: a.at as string })),
  };
}

function toSettings(j: Record<string, unknown> | null): StaffSettings | null {
  if (!j) return null;
  return {
    custody: (j.custody as Record<string, number>) ?? {},
    offers: (j.offers as Record<string, number>) ?? {},
    fees: ((j.fees as Record<string, unknown>[]) ?? []).map((f) => ({
      version: f.version as number, effectiveFrom: f.effective_from as string, note: (f.note as string) ?? null, settings: f.settings as Record<string, unknown>,
    })),
    currentFeeVersion: j.current_fee_version as number,
  };
}

const toAgents = (rows: Record<string, unknown>[] | null): StaffAgent[] =>
  (rows ?? []).map((a) => ({
    userId: a.user_id as string, username: a.username as string, email: (a.email as string) ?? null, role: a.role as 'courier' | 'hub',
    organisation: a.organisation as string, active: Boolean(a.active), since: a.since as string,
  }));

export const supabaseMarket: MarketBackend = {
  async favourites() {
    if (!(await uid())) return [];
    const { data } = await supabase().from('favourites').select('listing_id');
    return (data ?? []).map((r) => r.listing_id as string);
  },
  async setFavourite(listingId, on) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in to save items.' };
    const { error } = on
      ? await supabase().from('favourites').upsert({ user_id: me, listing_id: listingId }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })
      : await supabase().from('favourites').delete().eq('listing_id', listingId).eq('user_id', me);
    return error ? fail(error) : done;
  },
  async savedListings() {
    if (!(await uid())) return [];
    const { data, error } = await supabase().from('favourites').select(`created_at, listing:listings(${LISTING_COLUMNS})`).order('created_at', { ascending: false });
    if (error) throw new Error(tidy(error.message));
    return ((data ?? []) as unknown as { listing: Parameters<typeof toListing>[0] | null }[]).filter((r) => r.listing).map((r) => toListing(r.listing!));
  },

  async inboxCounts() {
    if (!(await uid())) return { turns: 0, unread: 0, offers: 0 };
    const { data, error } = await supabase().rpc('inbox_counts');
    if (error) throw new Error(tidy(error.message));
    return data as { turns: number; unread: number; offers: number };
  },
  async unreadByOrder() {
    if (!(await uid())) return {};
    const { data } = await supabase().rpc('unread_by_order');
    return (data as Record<string, number>) ?? {};
  },
  async messages(orderId) {
    const me = await uid();
    const [{ data, error }, { data: order }] = await Promise.all([
      supabase().from('order_messages').select('id, sender_id, body, created_at').eq('order_id', orderId).order('created_at'),
      supabase().from('orders').select('buyer_id').eq('id', orderId).maybeSingle(),
    ]);
    if (error) throw new Error(tidy(error.message));
    return (data ?? []).map((m): OrderMessage => ({
      id: m.id, mine: m.sender_id === me, role: m.sender_id === order?.buyer_id ? 'buyer' : 'seller', body: m.body, at: m.created_at,
    }));
  },
  async sendMessage(orderId, body) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in first.' };
    if (!body.trim()) return { ok: false, message: 'Write a message first.' };
    if (body.length > 2000) return { ok: false, message: 'Keep messages under 2,000 characters.' };
    const { error } = await supabase().from('order_messages').insert({ order_id: orderId, sender_id: me, body });
    return error ? fail(error) : done;
  },
  async markRead(orderId) {
    await supabase().rpc('mark_messages_read', { p_order: orderId });
  },

  async makeOffer(listingId, amountPence) {
    const { data, error } = await supabase().rpc('make_offer', { p_listing: listingId, p_amount: amountPence });
    return error ? fail(error) : { ok: true, value: toOffer(data as OfferJson) };
  },
  async respondOffer(offerId, action, amountPence) {
    const { data, error } = await supabase().rpc('respond_offer', { p_offer: offerId, p_action: action, p_amount: amountPence ?? null });
    return error ? fail(error) : { ok: true, value: toOffer(data as OfferJson) };
  },
  async myOffers() {
    if (!(await uid())) return [];
    const { data, error } = await supabase().rpc('my_offers');
    if (error) throw new Error(tidy(error.message));
    return ((data as OfferJson[]) ?? []).map(toOffer);
  },
  async startOfferCheckout(offerId) {
    const { data, error } = await supabase().rpc('start_offer_checkout', { p_offer: offerId });
    if (error) return { ...fail(error), code: /LISTING_CHANGED/.test(error.message) ? 'listing_changed' : undefined };
    const d = data as { order_id: string; quote: Record<string, unknown>; hold_expires_at: string; revision: number | null };
    return { ok: true, value: { orderId: d.order_id, quote: breakdownFromJson(d.quote)!, holdExpiresAt: d.hold_expires_at, revision: d.revision ?? null } satisfies CheckoutStarted };
  },

  async leaveReview(orderId, rating, body) {
    const { error } = await supabase().rpc('leave_review', { p_order: orderId, p_rating: rating, p_body: body });
    return error ? fail(error) : done;
  },
  async orderReviews(orderId) {
    const me = await uid();
    const { data } = await supabase().from('reviews').select('rating, body, created_at, author_role, author_id').eq('order_id', orderId);
    const rows = (data ?? []) as ReviewRow[];
    const mine = rows.find((r) => r.author_id === me);
    const theirs = rows.find((r) => r.author_id !== me);
    return { mine: mine ? toReview(mine) : null, theirs: theirs ? toReview(theirs) : null };
  },
  async memberReviews(username) {
    const { data } = await supabase().rpc('member_reviews', { p_username: username });
    const d = (data ?? { count: 0, average: null, latest: [] }) as { count: number; average: number | string | null; latest: ReviewRow[] };
    return { count: Number(d.count) || 0, average: d.average === null ? null : Number(d.average), latest: (d.latest ?? []).map(toReview) };
  },

  async passport(listingId) {
    const { data, error } = await supabase().rpc('item_passport', { p_listing: listingId });
    if (error || !data) return null;
    const p = data as Record<string, unknown>;
    return {
      listingId: p.listing_id as string, itemId: (p.item_id as string) ?? null, title: p.title as string, brand: (p.brand as string) ?? null,
      category: (p.category as string) ?? null, condition: (p.condition as string) ?? null, tier: p.tier as Tier, status: p.status as Passport['status'],
      listed: p.listed as string,
      photos: ((p.photos as { path: string; shot: string | null }[]) ?? []).map((m) => ({ url: mediaUrl(m.path), shot: m.shot })),
      sales: ((p.sales as Record<string, unknown>[]) ?? []).map((s) => ({
        sold: s.sold as string, tier: s.tier as Tier, state: s.state as Passport['sales'][number]['state'], chainOk: Boolean(s.chain_ok),
        steps: ((s.steps as Record<string, unknown>[]) ?? []).map((st) => ({
          step: st.step as string, actorRole: st.actor_role as string, date: st.date as string,
          sealMatch: st.seal_match as boolean | undefined, sealKind: st.seal_kind as string | undefined,
          result: st.result as 'pass' | 'fail' | undefined, photo: st.photo as boolean | undefined,
        })),
      })),
    };
  },

  async isStaff() {
    if (!(await uid())) return false;
    const { data } = await supabase().rpc('is_staff');
    return Boolean(data);
  },
  async staffQueue() {
    const { data, error } = await supabase().rpc('staff_queue');
    if (error) throw new Error(tidy(error.message));
    return ((data as Record<string, unknown>[]) ?? []).map((q): StaffQueueItem => ({
      orderId: q.order_id as string, title: q.title as string, kind: q.kind as StaffQueueItem['kind'], reason: q.reason as string,
      buyer: q.buyer as string, seller: q.seller as string, totalPence: (q.total_pence as number) ?? null, tier: (q.tier as Tier) ?? null, since: q.since as string,
    }));
  },
  async staffOrder(orderId) {
    const { data, error } = await supabase().rpc('staff_order', { p_order: orderId });
    if (error) throw new Error(tidy(error.message));
    return toStaffOrder(data as Record<string, unknown> | null);
  },
  async staffResolveDispute(orderId, outcome, note) {
    const { data, error } = await supabase().rpc('staff_resolve_dispute', { p_order: orderId, p_outcome: outcome, p_note: note });
    return error ? fail(error) : { ok: true, value: toStaffOrder(data as Record<string, unknown>)! };
  },
  async staffResolvePayment(orderId, outcome, note) {
    const { data, error } = await supabase().rpc('staff_resolve_payment', { p_order: orderId, p_outcome: outcome, p_note: note });
    return error ? fail(error) : { ok: true, value: toStaffOrder(data as Record<string, unknown>)! };
  },
  async staffAgents() {
    const { data, error } = await supabase().rpc('staff_agents');
    if (error) throw new Error(tidy(error.message));
    return toAgents(data as Record<string, unknown>[]);
  },
  async staffSetAgent(email, role, organisation, active) {
    const { data, error } = await supabase().rpc('staff_set_agent', { p_email: email, p_role: role, p_organisation: organisation, p_active: active });
    return error ? fail(error) : { ok: true, value: toAgents(data as Record<string, unknown>[]) };
  },
  async staffSettings() {
    const { data, error } = await supabase().rpc('staff_settings');
    if (error) return null;
    return toSettings(data as Record<string, unknown>);
  },
  async staffUpdateSettings(custody, offers) {
    const { data, error } = await supabase().rpc('staff_update_settings', { p_custody: custody, p_offers: offers });
    return error ? fail(error) : { ok: true, value: toSettings(data as Record<string, unknown>)! };
  },
  async staffAddFeeVersion(settings, note) {
    const { data, error } = await supabase().rpc('staff_add_fee_version', { p_settings: settings, p_note: note, p_effective: null });
    return error ? fail(error) : { ok: true, value: toSettings(data as Record<string, unknown>)! };
  },
};
