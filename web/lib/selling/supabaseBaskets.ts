import { supabase } from '@/lib/supabase';
import { formatPence } from '@/lib/format';
import { mediaUrl } from '@/lib/domain/catalogue';
import type { Basket, BasketCheckout, BasketItem, BasketPatch, Baskets, GiftView, MyGift, SharedBasket } from '@/lib/domain/baskets';
import type { BasketBackend, Result } from './types';

// Baskets, the one-payment basket checkout and gift links, through the functions in migration 013.

type Err = { message: string };
const tidy = (m: string) =>
  /permission denied|row-level security/i.test(m) ? 'You can’t do that here.'
    : /Failed to fetch|NetworkError|timeout/i.test(m) ? 'We couldn’t reach NuTuYu. Check your connection and try again.'
      : m;
const fail = (e: Err): { ok: false; message: string } => ({ ok: false, message: tidy(e.message) });

/* eslint-disable @typescript-eslint/no-explicit-any */
const item = (i: any): BasketItem => ({
  listingId: i.listing_id, title: i.title, pricePence: i.price_pence, postagePence: i.postage_pence ?? 0, size: i.size ?? null, category: i.category ?? null,
  available: !!i.available, photoUrl: i.photo ? mediaUrl(i.photo) : null, seller: i.seller, wrap: !!i.wrap, addedAt: i.added_at,
});
const basket = (b: any): Basket => ({
  id: b.id, position: b.position, name: b.name, general: !!b.general, ageGroup: b.age_group ?? null, sizes: b.sizes ?? {},
  budgetPence: b.budget_pence ?? null, styleNotes: b.style_notes ?? null, wrapStyle: b.wrap_style ?? null, wrapAll: !!b.wrap_all,
  giftMessage: b.gift_message ?? null, hidePrices: b.hide_prices !== false, deliverBy: b.deliver_by ?? null, giftReceipt: !!b.gift_receipt,
  recipientAddress: b.recipient_address ?? null, shareToken: b.share_token ?? null, items: (b.items ?? []).map(item),
});
const baskets = (x: any): Baskets => ({
  enabled: !!x.enabled, wrapFeePence: x.wrap_fee_pence ?? 0, wrappingLive: !!x.wrapping_live, baskets: (x.baskets ?? []).map(basket),
});
const group = (g: any): BasketCheckout => ({
  groupId: g.group_id, shipping: g.shipping, paymentStatus: g.payment_status, totalPence: g.total_pence, wrapFeePence: g.wrap_fee_pence,
  wrappedItems: g.wrapped_items, wrapTotalPence: g.wrap_total_pence, holdExpiresAt: g.hold_expires_at,
  orders: (g.orders ?? []).map((o: any) => ({
    orderId: o.order_id, listingId: o.listing_id, title: o.title, basket: o.basket ?? null, totalPence: o.total_pence, wrap: !!o.wrap,
    gift: !!o.gift, giftToken: o.gift_token ?? null, shipTo: o.ship_to ?? null,
    discountNote: o.quote?.bundle_pct ? `Bundle: ${o.quote.bundle_pct}% off (was ${formatPence(Number(o.quote.list_price_pence))})` : null,
  })),
});
const gift = (g: any): GiftView => ({
  orderId: g.order_id ?? null, title: g.title, photo: g.photo ? mediaUrl(g.photo) : null, for: g.for ?? null, from: g.from, message: g.message ?? null,
  deliverBy: g.deliver_by ?? null, giftReceipt: !!g.gift_receipt, wrapped: !!g.wrapped, claimed: !!g.claimed, mine: !!g.mine, paid: !!g.paid,
  custodyState: g.custody_state ?? null, snapshot: g.snapshot ?? { brand: null, size: null, colour: null, condition: null }, itemId: g.item_id ?? null, soldOn: g.sold_on ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const patchJson = (p: BasketPatch) => {
  const out: Record<string, unknown> = {};
  const map: Record<string, string> = {
    name: 'name', ageGroup: 'age_group', sizes: 'sizes', budgetPence: 'budget_pence', styleNotes: 'style_notes', wrapStyle: 'wrap_style',
    wrapAll: 'wrap_all', giftMessage: 'gift_message', hidePrices: 'hide_prices', deliverBy: 'deliver_by', giftReceipt: 'gift_receipt', recipientAddress: 'recipient_address',
  };
  for (const [k, v] of Object.entries(p)) if (map[k]) out[map[k]] = v ?? null;
  return out;
};

async function rpcBaskets(fn: string, args: Record<string, unknown>): Promise<Result<Baskets>> {
  const { data, error } = await supabase().rpc(fn, args);
  return error ? fail(error) : { ok: true, value: baskets(data) };
}

export const supabaseBaskets: BasketBackend = {
  async myBaskets() {
    const { data, error } = await supabase().rpc('my_baskets');
    if (error) throw new Error(tidy(error.message));
    return baskets(data);
  },
  setMultiBasket: (on) => rpcBaskets('set_multi_basket', { p_on: on }),
  saveBasket: (id, patch) => rpcBaskets('save_basket', { p_id: id, p: patchJson(patch) }),
  deleteBasket: (id) => rpcBaskets('delete_basket', { p_id: id }),
  basketPut: (listingId, basketId) => rpcBaskets('basket_put', { p_listing: listingId, p_basket: basketId }),
  basketSetWrap: (listingId, wrap) => rpcBaskets('basket_set_wrap', { p_listing: listingId, p_wrap: wrap }),
  basketRemove: (listingId) => rpcBaskets('basket_remove', { p_listing: listingId }),
  shareBasket: (id, on) => rpcBaskets('share_basket', { p_id: id, p_on: on }),
  async sharedBasket(token) {
    const { data, error } = await supabase().rpc('shared_basket', { p_token: token });
    if (error || !data) return null;
    return { name: data.name, ageGroup: data.age_group ?? null, sizes: data.sizes ?? {}, styleNotes: data.style_notes ?? null, items: (data.items ?? []).map(item) } satisfies SharedBasket;
  },
  async startBasketCheckout(shipping) {
    const { data, error } = await supabase().rpc('start_basket_checkout', { p_shipping: shipping });
    return error ? fail(error) : { ok: true, value: group(data) };
  },
  async basketCheckout(groupId) {
    const { data, error } = await supabase().rpc('basket_checkout', { p_group: groupId });
    return error || !data ? null : group(data);
  },
  async cancelBasketCheckout(groupId) {
    await supabase().rpc('cancel_basket_checkout', { p_group: groupId });
  },
  async startGroupPayment(groupId) {
    const { data, error } = await supabase().functions.invoke('checkout', { body: { group_id: groupId } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (body?.error === 'payments_not_configured') return { ok: false, code: 'not_configured', message: 'Payments aren’t switched on yet, so no money has been taken.' };
      return { ok: false, code: body?.error, message: body?.message ?? tidy(error.message) };
    }
    return { ok: true, value: { kind: 'stripe', clientSecret: data.client_secret, publishableKey: data.publishable_key, amountPence: data.amount_pence } };
  },
  async simulateGroupPayment() {
    return { ok: false, message: 'Test payments only work in example mode.' };
  },
  async giftView(token) {
    const { data, error } = await supabase().rpc('gift_view', { p_token: token });
    return error || !data ? null : gift(data);
  },
  async claimGift(token) {
    const { data, error } = await supabase().rpc('claim_gift', { p_token: token });
    return error ? fail(error) : { ok: true, value: gift(data) };
  },
  async myGifts() {
    const { data, error } = await supabase().rpc('my_gifts');
    if (error || !data) return [];
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    return (data as any[]).map((g): MyGift => ({ orderId: g.order_id, token: g.token, title: g.title, photo: g.photo ? mediaUrl(g.photo) : null, from: g.from, custodyState: g.custody_state ?? null }));
  },
};
