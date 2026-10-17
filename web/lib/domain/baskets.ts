// Multi-basket shopping: the shapes, and the rules the screens share (size fit, budgets, wrapping, totals).
// The database keeps the baskets and checks every change; these helpers only decide what to show.

export type SizeKind = 'shoe' | 'top' | 'trousers' | 'dress' | 'kids';
export const SIZE_KINDS: { key: SizeKind; label: string; hint: string }[] = [
  { key: 'top', label: 'Tops', hint: 'XS to XXL' },
  { key: 'trousers', label: 'Trousers', hint: 'Waist, like 32' },
  { key: 'dress', label: 'Dresses', hint: 'UK size, like 12' },
  { key: 'shoe', label: 'Shoes', hint: 'UK size, like 7' },
  { key: 'kids', label: 'Children’s clothes', hint: 'Age, like 5–6 years' },
];

export const WRAP_STYLES = [
  { key: 'kraft', label: 'Brown kraft with twine' },
  { key: 'sage', label: 'Sage green' },
  { key: 'terracotta', label: 'Terracotta' },
  { key: 'stripe', label: 'Cream stripe' },
  { key: 'confetti', label: 'Confetti' },
] as const;
export type WrapStyle = (typeof WRAP_STYLES)[number]['key'];

export const MAX_PERSONAL = 4;
/** One colour per basket position, so a tag reads the same everywhere. General is neutral. */
export const BASKET_TONES = ['neutral', 'terracotta', 'sage', 'peach', 'blush'] as const;

export interface Address { name: string; line1: string; line2?: string | null; town: string; postcode: string }

export interface BasketItem {
  listingId: string;
  title: string;
  pricePence: number;
  postagePence: number;
  size: string | null;
  category: string | null;
  available: boolean;
  photoUrl: string | null;
  seller: string;
  wrap: boolean;
  addedAt: string;
}

export interface Basket {
  id: string;
  position: number;
  name: string;
  general: boolean;
  ageGroup: 'adult' | 'child' | null;
  sizes: Partial<Record<SizeKind, string>>;
  budgetPence: number | null;
  styleNotes: string | null;
  wrapStyle: WrapStyle | null;
  wrapAll: boolean;
  giftMessage: string | null;
  hidePrices: boolean;
  deliverBy: string | null;
  giftReceipt: boolean;
  recipientAddress: Address | null;
  shareToken: string | null;
  items: BasketItem[];
}

export interface Baskets {
  enabled: boolean;
  wrapFeePence: number;
  /** Wrapping is chosen now; it's charged only once NuTuYu switches it on. */
  wrappingLive: boolean;
  baskets: Basket[];
}

export type BasketPatch = Partial<Pick<Basket, 'name' | 'ageGroup' | 'sizes' | 'budgetPence' | 'styleNotes' | 'wrapStyle' | 'wrapAll' | 'giftMessage' | 'hidePrices' | 'deliverBy' | 'giftReceipt' | 'recipientAddress'>>;

export interface SharedBasket { name: string; ageGroup: string | null; sizes: Partial<Record<SizeKind, string>>; styleNotes: string | null; items: BasketItem[] }

export interface GroupOrder { orderId: string; listingId: string; title: string; basket: string | null; totalPence: number; wrap: boolean; gift: boolean; giftToken: string | null; shipTo: Address | null }
export interface BasketCheckout {
  groupId: string;
  shipping: 'combined' | 'separate';
  paymentStatus: 'awaiting_payment' | 'paid' | 'cancelled' | 'expired' | 'review';
  totalPence: number;
  wrapFeePence: number;
  wrappedItems: number;
  wrapTotalPence: number;
  holdExpiresAt: string;
  orders: GroupOrder[];
}

export interface GiftView {
  orderId: string | null;
  title: string;
  photo: string | null;
  for: string | null;
  from: string;
  message: string | null;
  deliverBy: string | null;
  giftReceipt: boolean;
  wrapped: boolean;
  claimed: boolean;
  mine: boolean;
  paid: boolean;
  custodyState: string | null;
  snapshot: { brand: string | null; size: string | null; colour: string | null; condition: string | null };
  itemId: string | null;
  soldOn: string | null;
}
export interface MyGift { orderId: string; token: string; title: string; photo: string | null; from: string; custodyState: string | null }

// ---------- Size fit ----------

const LETTER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const clean = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').replace(/[–—]/g, '-').trim();

/** What kind of size a listing's size label is, from the label and its category. */
export function sizeKindOf(size: string | null, category: string | null): SizeKind | null {
  if (!size) return null;
  const s = clean(size);
  if (category === 'kids' || /\b(YEARS?|YRS?|MONTHS?|MTHS?)\b/.test(s)) return 'kids';
  if (/^(UK|EU|US)\s?\d/.test(s) || category === 'shoes') return 'shoe';
  if (LETTER.includes(s)) return 'top';
  const n = Number(s.replace(/(W|IN|")$/, ''));
  if (Number.isInteger(n)) {
    if (category === 'men' && n >= 26 && n <= 48) return 'trousers';
    if (n >= 4 && n <= 26 && n % 2 === 0) return 'dress';
  }
  return null;
}

const norm = (kind: SizeKind, s: string) => {
  const c = clean(s);
  if (kind === 'shoe') return c.replace(/^UK\s?/, '');
  if (kind === 'kids') return c.replace(/\s?(YEARS?|YRS?)$/, '').replace(/\s/g, '');
  if (kind === 'trousers') return c.replace(/(W|IN|")$/, '');
  return c;
};

export type Fit = 'fits' | 'mismatch' | 'unknown';

/** Whether an item's size matches a basket's profile. Items with no size (a lamp, a book) always fit. */
const ADULT_KINDS: SizeKind[] = ['top', 'trousers', 'dress'];
const ageClash = (basket: Pick<Basket, 'ageGroup'>, kind: SizeKind) =>
  (basket.ageGroup === 'child' && ADULT_KINDS.includes(kind)) || (basket.ageGroup === 'adult' && kind === 'kids');

export function fitFor(basket: Pick<Basket, 'sizes' | 'general' | 'ageGroup'>, item: { size: string | null; category: string | null }): Fit {
  if (basket.general || !item.size) return 'unknown';
  const kind = sizeKindOf(item.size, item.category);
  if (!kind) return 'unknown';
  if (ageClash(basket, kind)) return 'mismatch';
  const want = basket.sizes[kind];
  if (!want) return 'unknown';
  return norm(kind, want) === norm(kind, item.size) ? 'fits' : 'mismatch';
}

export function fitNote(basket: Basket, item: { size: string | null; category: string | null }): string | null {
  const f = fitFor(basket, item);
  if (f !== 'mismatch') return null;
  const kind = sizeKindOf(item.size, item.category)!;
  if (ageClash(basket, kind)) return kind === 'kids' ? `This is a children’s size, but ${basket.name}’s basket is for an adult.` : `This is an adult size, but ${basket.name}’s basket is for a child.`;
  const label = SIZE_KINDS.find((k) => k.key === kind)!.label.toLowerCase();
  return `Size ${item.size}, but ${basket.name}’s ${label} size is ${basket.sizes[kind]}.`;
}

export interface SizeCheck {
  /** What happened, in words. */
  note: string | null;
  /** The size to save to the basket now (the basket had none for this kind of item). */
  learn: { kind: SizeKind; size: string } | null;
  /** The size the person could switch the basket to, when it doesn't match. */
  offer: { kind: SizeKind; size: string } | null;
}

/**
 * What to do with sizes when an item lands in a person's basket. If the basket has no size yet for that kind
 * of item, the item's size becomes the basket's size; if it has a different one, say so and offer to switch.
 */
export function sizeCheck(basket: Basket, item: { size: string | null; category: string | null }): SizeCheck {
  const none: SizeCheck = { note: null, learn: null, offer: null };
  if (basket.general || !item.size) return none;
  const kind = sizeKindOf(item.size, item.category);
  if (!kind) return none;
  const label = SIZE_KINDS.find((k) => k.key === kind)!.label.toLowerCase();
  if (ageClash(basket, kind)) return { ...none, note: fitNote(basket, item) };
  const want = basket.sizes[kind];
  if (!want) return { note: `${basket.name}’s ${label} size is now ${item.size}, from this item.`, learn: { kind, size: item.size }, offer: null };
  if (norm(kind, want) === norm(kind, item.size)) return { ...none, note: `It’s ${basket.name}’s size.` };
  return { note: fitNote(basket, item), learn: null, offer: { kind, size: item.size } };
}

// ---------- Money ----------

export function basketSpend(b: Basket): number {
  return b.items.filter((i) => i.available).reduce((n, i) => n + i.pricePence + i.postagePence, 0);
}

export function budgetState(b: Basket): { spent: number; budget: number; over: boolean; share: number } | null {
  if (!b.budgetPence) return null;
  const spent = basketSpend(b);
  return { spent, budget: b.budgetPence, over: spent > b.budgetPence, share: Math.min(1, spent / b.budgetPence) };
}

/** What wrapping adds, on its own line. Nothing is charged until wrapping is switched on. */
export function wrapCharge(all: Baskets): { items: number; pence: number; charged: boolean } {
  const items = all.baskets.filter((b) => !b.general && b.wrapStyle).flatMap((b) => b.items).filter((i) => i.wrap && i.available).length;
  return { items, pence: all.wrappingLive ? items * all.wrapFeePence : 0, charged: all.wrappingLive };
}

/** The baskets a member can see: General only while multi-basket is off. */
export function visibleBaskets(all: Baskets): Basket[] {
  return all.enabled ? all.baskets : all.baskets.filter((b) => b.general);
}

/** Every item with the basket it belongs to, for the single (General) view. */
export function everything(all: Baskets): { item: BasketItem; basket: Basket }[] {
  return visibleBaskets(all).flatMap((basket) => basket.items.map((item) => ({ item, basket }))).sort((a, b) => a.item.addedAt.localeCompare(b.item.addedAt));
}

export const UK_POSTCODE = /^[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}$/i;
