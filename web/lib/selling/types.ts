import type { BasketCheckout, BasketPatch, Baskets, GiftView, MyGift, SharedBasket } from '@/lib/domain/baskets';
import type { FeeBreakdown } from '@/lib/domain/fees';
import type { ListingVersion } from '@/lib/domain/versions';
import type { AgentTask, CustodyState, CustodyView, Evidence } from '@/lib/domain/custody';
import type { Listing, Tier, Variant } from '@/lib/domain/types';
// The selling and sign-in operations the screens use. Two implementations: Supabase (real) and an
// in-browser example backend for tests and demos without a database. Screens never call Supabase directly.

export interface Member {
  id: string;
  email: string;
  username: string;
}

export interface DraftMedia {
  id: string;
  shot: string;
  kind: 'photo' | 'video';
  url: string;
}

export interface Draft {
  id: string;
  category: string | null;
  title: string;
  brand: string;
  size: string;
  colour: string;
  condition: string | null;
  description: string;
  pricePence: number | null;
  parcelSize: 'small' | 'medium' | 'large' | null;
  declined: string[];
  published: boolean;
  /** 0 until first published; each published change makes the next revision. */
  revision: number;
  /** reserved while someone pays; sold once paid. Both lock the listing. */
  status: 'active' | 'reserved' | 'sold';
  media: DraftMedia[];
  /** The full serial, readable only by the seller. */
  serial: string;
  updatedAt: string;
}

export type DraftFields = Partial<Pick<Draft, 'category' | 'title' | 'brand' | 'size' | 'colour' | 'condition' | 'description' | 'pricePence' | 'parcelSize' | 'declined'>>;

export interface PreparedMedia {
  blob: Blob;
  kind: 'photo' | 'video';
  contentType: string;
  extension: string;
  width: number | null;
  height: number | null;
  sha256: string;
}

export interface Profile {
  username: string;
  bio: string;
  holidayMode: boolean;
  verified: boolean;
  business: boolean;
  joined: string;
  /** Postcode district (never the address) and its centre, for collection in person. */
  area?: { district: string; lat: number; lng: number } | null;
  collectionOk?: boolean;
}

export type ProfileFields = Partial<Pick<Profile, 'username' | 'bio' | 'holidayMode' | 'area' | 'collectionOk'>>;

export interface Passkey {
  id: string;
  /** e.g. "iCloud Keychain" or "Google Password Manager", or the member's own name for it. */
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type PaymentStatus = 'legacy' | 'awaiting_payment' | 'paid' | 'cancelled' | 'expired' | 'review';

export interface OrderSummary {
  id: string;
  listingId: string;
  title: string;
  photoUrl: string | null;
  /** Whether the signed-in member bought or sold it. */
  role: 'buyer' | 'seller';
  paymentStatus: PaymentStatus;
  /** Custody once paid: the tier's steps, how far along, and whether it's complete or on hold. */
  custody: { state: CustodyState; tier: Tier; step: number } | null;
  quote: FeeBreakdown | null;
  /** Exactly what was bought: the listing as it was when checkout started. */
  bought: ListingVersion | null;
  totalPence: number | null;
  holdExpiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CheckoutStarted {
  orderId: string;
  quote: FeeBreakdown;
  holdExpiresAt: string;
  revision: number | null;
}

export type PaymentStart =
  | { kind: 'stripe'; clientSecret: string; publishableKey: string; amountPence: number }
  | { kind: 'simulated'; amountPence: number };

export type Result<T = void> = { ok: true; value: T } | { ok: false; message: string };


// ---------- Favourites, inbox, messages, offers, reviews, passport, staff ----------

export interface InboxCounts {
  /** Orders waiting for your custody step. */
  turns: number;
  unread: number;
  /** Offers waiting for your answer, and accepted offers waiting for you to pay. */
  offers: number;
}

export interface OrderMessage {
  id: string;
  mine: boolean;
  role: 'buyer' | 'seller';
  body: string;
  at: string;
}

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'withdrawn' | 'used' | 'expired';
export type OfferAction = 'accept' | 'decline' | 'counter' | 'withdraw';

export interface Offer {
  id: string;
  listingId: string;
  title: string;
  /** The listed price, for comparison. */
  pricePence: number;
  amountPence: number;
  madeBy: 'buyer' | 'seller';
  status: OfferStatus;
  /** The signed-in member's side of it. */
  role: 'buyer' | 'seller';
  buyer: string;
  seller: string;
  counterOf: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface Review {
  rating: number;
  body: string | null;
  createdAt: string;
  authorRole: 'buyer' | 'seller';
  author?: string;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  latest: Review[];
}

export interface PassportStep {
  step: string;
  actorRole: string;
  date: string;
  sealMatch?: boolean;
  sealKind?: string;
  result?: 'pass' | 'fail';
  photo?: boolean;
}

export interface Passport {
  listingId: string;
  itemId: string | null;
  title: string;
  brand: string | null;
  category: string | null;
  condition: string | null;
  tier: Tier;
  status: 'active' | 'reserved' | 'sold';
  listed: string;
  photos: { url: string; shot: string | null }[];
  sales: { sold: string; tier: Tier; state: 'in_progress' | 'confirmed' | 'on_hold' | 'refunded' | 'not_started'; chainOk: boolean; steps: PassportStep[] }[];
}

export interface StaffQueueItem {
  orderId: string;
  title: string;
  kind: 'dispute' | 'payment' | 'weight';
  reason: string;
  buyer: string;
  seller: string;
  totalPence: number | null;
  tier: Tier | null;
  since: string;
}

export interface StaffOrder {
  orderId: string;
  listingId: string;
  title: string;
  buyer: string;
  seller: string;
  paymentStatus: PaymentStatus;
  paymentRef: string | null;
  totalPence: number | null;
  tier: Tier | null;
  state: string;
  disputeReason: string | null;
  disputeResolution: 'release' | 'refund' | null;
  payoutStatus: string;
  weightFlag: boolean;
  events: { seq: number; step: string; actorRole: string; actor: string | null; at: string; evidence: Record<string, unknown>; hash: string }[];
  messages: { from: string; role: string; body: string; at: string }[];
  actions: { action: string; by: string; detail: Record<string, unknown>; at: string }[];
}

export interface StaffAgent {
  userId: string;
  username: string;
  email: string | null;
  role: 'courier' | 'hub';
  organisation: string;
  active: boolean;
  since: string;
}

export interface StaffSettings {
  custody: Record<string, number>;
  offers: Record<string, number>;
  fees: { version: number; effectiveFrom: string; note: string | null; settings: Record<string, unknown> }[];
  currentFeeVersion: number;
}

export type ContactTopic = 'privacy' | 'account' | 'order' | 'other';
export interface ContactMessage {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  topic: ContactTopic;
  body: string;
  member: string | null;
  handledAt: string | null;
  handledBy: string | null;
}

export type NotificationGroup = 'turn' | 'messages' | 'offers' | 'sales' | 'alerts';
export type NotificationKind =
  | 'turn' | 'message' | 'offer_new' | 'offer_counter' | 'offer_accepted' | 'offer_expiring' | 'sold' | 'payout' | 'dispute' | 'decision'
  | 'search_match' | 'price_drop';
/** Something that happened on the member's orders or offers (migration 016). */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  group: NotificationGroup;
  title: string;
  body: string;
  link: string;
  /** Messages on one order share a notification; this is how many it holds. */
  count: number;
  createdAt: string;
  read: boolean;
  emailed: boolean;
}
/** Which groups the member gets emails for. The in-app list always shows everything. */
export type NotificationPrefs = Record<NotificationGroup, boolean>;

/** A search the member saved, to be told about new matches (migration 019). */
export interface SavedSearch {
  id: string;
  name: string;
  q: string | null;
  category: string | null;
  size: string | null;
  condition: string | null;
  minPence: number | null;
  maxPence: number | null;
  alert: boolean;
  createdAt: string;
  /** Listings matching it right now. */
  liveCount: number;
}
export interface SearchToSave { q?: string; category?: string; size?: string; condition?: string; minPence?: number; maxPence?: number }

export interface BundleOffer { minItems: number; pct: number }
export interface SoldRow {
  orderId: string; listingId: string; title: string; pricePence: number; payoutPence: number; paidAt: string | null;
  buyer: string | null; state: string; payoutStatus: string; bundle: boolean;
}
export interface SellerDashboard {
  totals: {
    sold: number; grossPence: number; payoutPence: number; heldPence: number; releasedPence: number;
    refunded: number; disputed: number; avgHandoverHours: number | null; liveListings: number; bundles: number;
  };
  months: { month: string; sold: number; grossPence: number }[];
  recent: SoldRow[];
  bundle: BundleOffer | null;
}

/** Codes and balance on a checkout (one order, or a basket checkout) — migration 022. */
export interface CheckoutCodes {
  voucher: { code: string; shop: string | null; discountPence: number } | null;
  balancePence: number;
  balanceAvailable: number;
  /** What's left to pay by card. */
  totalPence: number;
  paid: boolean;
}
export interface Voucher {
  id: string; code: string; shop: string | null; kind: 'percent' | 'amount'; value: number; minSpendPence: number; maxDiscountPence: number | null;
  perMember: number; maxUses: number | null; firstOrderOnly: boolean; startsAt: string | null; endsAt: string | null; active: boolean; note: string | null;
  uses: number; discountGivenPence: number;
}
export type VoucherPatch = Partial<Omit<Voucher, 'id' | 'shop' | 'uses' | 'discountGivenPence'>>;
export interface GiftCard {
  id: string; amountPence: number; recipientName: string | null; recipientEmail: string | null; message: string | null;
  paymentStatus: 'awaiting_payment' | 'paid' | 'cancelled' | 'review'; paidAt: string | null; expiresAt: string | null; createdAt: string;
  /** Shown once it's paid for. */
  code: string | null; redeemed: boolean;
}
export interface Balance { balancePence: number; lots: { source: 'gift_card' | 'refund'; amountPence: number; remainingPence: number; expiresAt: string }[] }
/** A popup staff configure: an explanation, an announcement or an offer (migration 021). */
export interface SitePopup {
  id: string;
  key: string;
  kind: 'info' | 'offer' | 'announcement';
  title: string;
  body: string;
  steps: { title: string; note: string }[];
  ctaLabel: string | null;
  ctaHref: string | null;
  offerCode: string | null;
  audience: 'everyone' | 'visitors' | 'members';
  /** Comma-separated path prefixes; "*" for every page. */
  pages: string;
  delaySeconds: number;
  priority: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  version: number;
}
export type PopupPatch = Partial<Omit<SitePopup, 'id' | 'version'>>;

export interface MarketBackend {
  favourites(): Promise<string[]>;
  setFavourite(listingId: string, on: boolean): Promise<Result>;
  savedListings(): Promise<Listing[]>;

  inboxCounts(): Promise<InboxCounts>;
  unreadByOrder(): Promise<Record<string, number>>;
  messages(orderId: string): Promise<OrderMessage[]>;
  sendMessage(orderId: string, body: string): Promise<Result>;
  markRead(orderId: string): Promise<void>;

  makeOffer(listingId: string, amountPence: number): Promise<Result<Offer>>;
  respondOffer(offerId: string, action: OfferAction, amountPence?: number): Promise<Result<Offer>>;
  myOffers(): Promise<Offer[]>;
  startOfferCheckout(offerId: string): Promise<Result<CheckoutStarted> & { code?: string }>;

  leaveReview(orderId: string, rating: number, body: string): Promise<Result>;
  orderReviews(orderId: string): Promise<{ mine: Review | null; theirs: Review | null }>;
  memberReviews(username: string): Promise<ReviewSummary>;

  passport(listingId: string): Promise<Passport | null>;

  isStaff(): Promise<boolean>;
  staffQueue(): Promise<StaffQueueItem[]>;
  staffOrder(orderId: string): Promise<StaffOrder | null>;
  staffResolveDispute(orderId: string, outcome: 'release' | 'refund', note: string): Promise<Result<StaffOrder>>;
  staffResolvePayment(orderId: string, outcome: 'accept' | 'refund', note: string): Promise<Result<StaffOrder>>;
  staffAgents(): Promise<StaffAgent[]>;
  staffSetAgent(email: string, role: 'courier' | 'hub', organisation: string, active: boolean): Promise<Result<StaffAgent[]>>;
  staffSettings(): Promise<StaffSettings | null>;
  staffUpdateSettings(custody: Record<string, number> | null, offers: Record<string, number> | null): Promise<Result<StaffSettings>>;
  staffAddFeeVersion(settings: Record<string, unknown>, note: string): Promise<Result<StaffSettings>>;
  /** The contact form. Anyone can send; only staff read. */
  submitContact(name: string, email: string, topic: ContactTopic, body: string): Promise<Result>;
  staffContactMessages(openOnly: boolean): Promise<ContactMessage[]>;
  staffContactHandled(id: string): Promise<Result>;

  /** Business sellers (set by staff) can sell stock and colours/sizes. */
  isBusiness(): Promise<boolean>;
  listingVariants(listingId: string): Promise<Variant[]>;
  setListingStock(listingId: string, stock: number): Promise<Result<Variant[]>>;
  addVariant(listingId: string, colour: string, size: string, stock: number, pricePence: number | null): Promise<Result<Variant[]>>;
  staffSetBusiness(username: string, on: boolean): Promise<Result<{ username: string; business: boolean }>>;

  sellerDashboard(): Promise<SellerDashboard | null>;
  /** null switches the bundle offer off. */
  setBundleDiscount(offer: BundleOffer | null): Promise<Result<BundleOffer | null>>;
  bundleOffer(username: string): Promise<BundleOffer | null>;

  mySavedSearches(): Promise<SavedSearch[]>;
  saveSearch(name: string, search: SearchToSave): Promise<Result<SavedSearch>>;
  setSearchAlert(id: string, on: boolean): Promise<Result<SavedSearch[]>>;
  deleteSavedSearch(id: string): Promise<Result<SavedSearch[]>>;

  checkoutCodes(target: string): Promise<CheckoutCodes | null>;
  /** A voucher code, or a gift card code (added to the balance and used). */
  applyCode(target: string, code: string): Promise<Result<CheckoutCodes>>;
  removeVoucher(target: string): Promise<Result<CheckoutCodes>>;
  useBalance(target: string, on: boolean): Promise<Result<CheckoutCodes>>;
  staffVouchers(): Promise<Voucher[]>;
  staffSaveVoucher(id: string | null, patch: VoucherPatch): Promise<Result<Voucher[]>>;
  myShopVouchers(): Promise<Voucher[]>;
  saveShopVoucher(id: string | null, patch: VoucherPatch): Promise<Result<Voucher[]>>;
  buyGiftCard(amountPence: number, name: string, email: string, message: string): Promise<Result<GiftCard>>;
  payGiftCard(id: string): Promise<Result<PaymentStart> & { code?: string }>;
  /** Example mode only. */
  simulateGiftCardPayment(id: string): Promise<Result>;
  cancelGiftCard(id: string): Promise<void>;
  myGiftCards(): Promise<GiftCard[]>;
  redeemGiftCard(code: string): Promise<Result<Balance>>;
  myBalance(): Promise<Balance>;
  /** Popups that are live now (anyone). */
  livePopups(): Promise<SitePopup[]>;
  staffPopups(): Promise<SitePopup[]>;
  staffSavePopup(id: string | null, patch: PopupPatch, showAgain: boolean): Promise<Result<SitePopup[]>>;

  /** Shipping for an order the seller posts: the buyer's delivery address and the label (test mode until Parcel2Go is set up). */
  orderShipping(orderId: string): Promise<OrderShipping | null>;
  setDeliveryAddress(orderId: string, address: Address): Promise<Result<OrderShipping>>;
  createLabel(orderId: string, service: string, parcel: ParcelSize): Promise<Result<OrderShipping>>;
  cancelLabel(orderId: string): Promise<Result<OrderShipping>>;

  /** Seller payouts (Stripe Connect). */
  myPayouts(): Promise<PayoutSummary | null>;
  /** Starts (or continues) setting up payouts: a link to Stripe's set-up page. */
  startPayoutSetup(): Promise<Result<{ url: string | null }>>;
  refreshPayoutStatus(): Promise<Result<PayoutSummary>>;
  payoutDashboard(): Promise<Result<{ url: string }>>;
  staffPayouts(status: PayoutStatus | null): Promise<StaffPayouts | null>;
  staffPayoutAction(id: string, action: 'hold' | 'release' | 'retry', note: string): Promise<Result<StaffPayouts>>;

  /** Questions before buying. */
  listingQuestions(listingId: string): Promise<ListingQuestion[]>;
  askQuestion(listingId: string, body: string): Promise<Result<ListingQuestion[]>>;
  answerQuestion(questionId: string, answer: string): Promise<Result<ListingQuestion[]>>;
  removeQuestion(questionId: string): Promise<Result<ListingQuestion[]>>;
  myUnansweredQuestions(): Promise<{ id: string; listingId: string; title: string; body: string; createdAt: string }[]>;

  /** Reports and moderation. */
  report(target: { listingId: string } | { member: string }, reason: ReportReason, note: string): Promise<Result>;
  staffModeration(status: 'open' | 'actioned' | 'dismissed'): Promise<StaffModeration | null>;
  staffModerate(target: { listingId: string } | { member: string }, action: ModerationAction, note: string): Promise<Result<StaffModeration>>;
  myHiddenListings(): Promise<{ id: string; title: string; note: string | null; at: string }[]>;

  /** Saved addresses (the default one is used for orders and returns). */
  myAddresses(): Promise<SavedAddress[]>;
  saveAddress(id: string | null, label: string, address: Address, makeDefault: boolean): Promise<Result<SavedAddress[]>>;
  deleteAddress(id: string): Promise<Result<SavedAddress[]>>;

  /** Privacy: download everything, or delete the account. */
  exportMyData(): Promise<Result<Record<string, unknown>>>;
  accountDeletionBlockers(): Promise<string[]>;
  deleteMyAccount(confirmUsername: string): Promise<Result>;

  /** Identity checks (Stripe Identity). */
  myIdentity(): Promise<IdentityStatus | null>;
  startIdentityCheck(): Promise<Result<{ url: string | null }>>;

  /** Returns (after the item has arrived, before confirming). */
  orderReturn(orderId: string): Promise<OrderReturn | null>;
  requestReturn(orderId: string, reason: ReturnReason, note: string): Promise<Result<OrderReturn>>;
  respondReturn(orderId: string, accept: boolean, note: string): Promise<Result<OrderReturn>>;
  returnPosted(orderId: string): Promise<Result<OrderReturn>>;
  returnReceived(orderId: string): Promise<Result<OrderReturn>>;
  cancelReturn(orderId: string): Promise<Result<OrderReturn>>;
  staffRefunds(): Promise<StaffRefund[]>;

  /** Staff: sales, fees, disputes and handover times between two dates (inclusive, UK time). */
  staffReport(from: string, to: string): Promise<Result<StaffReport>>;
  /** Public: a seller's protected-handover record, and the site-wide tracker. */
  sellerTrust(username: string): Promise<SellerTrust | null>;
  trustStats(): Promise<TrustStats | null>;

  notifications(): Promise<AppNotification[]>;
  unreadNotifications(): Promise<number>;
  /** Marks these (or, with null, all) read. */
  markNotificationsRead(ids: string[] | null): Promise<void>;
  notificationPrefs(): Promise<NotificationPrefs>;
  setNotificationPrefs(prefs: NotificationPrefs): Promise<Result<NotificationPrefs>>;
}

export interface BasketBackend {
  myBaskets(): Promise<Baskets>;
  setMultiBasket(on: boolean): Promise<Result<Baskets>>;
  /** Create (id null) or change a personal basket. */
  saveBasket(id: string | null, patch: BasketPatch): Promise<Result<Baskets>>;
  deleteBasket(id: string): Promise<Result<Baskets>>;
  /** Put an item in a basket (General when basketId is null), or move it there. */
  basketPut(listingId: string, basketId: string | null): Promise<Result<Baskets>>;
  basketSetWrap(listingId: string, wrap: boolean): Promise<Result<Baskets>>;
  basketRemove(listingId: string): Promise<Result<Baskets>>;
  shareBasket(id: string, on: boolean): Promise<Result<Baskets>>;
  sharedBasket(token: string): Promise<SharedBasket | null>;
  startBasketCheckout(shipping: 'combined' | 'separate'): Promise<Result<BasketCheckout>>;
  basketCheckout(groupId: string): Promise<BasketCheckout | null>;
  cancelBasketCheckout(groupId: string): Promise<void>;
  startGroupPayment(groupId: string): Promise<Result<PaymentStart> & { code?: string }>;
  /** Example mode only. */
  simulateGroupPayment(groupId: string): Promise<Result>;
  giftView(token: string): Promise<GiftView | null>;
  claimGift(token: string): Promise<Result<GiftView>>;
  myGifts(): Promise<MyGift[]>;
}

export type SocialProvider = 'google' | 'facebook';

export interface SellingBackend extends MarketBackend, BasketBackend {
  /** Current member, or null when signed out. */
  member(): Promise<Member | null>;
  onMemberChange(cb: (m: Member | null) => void): () => void;
  signIn(email: string, password: string): Promise<Result<Member>>;
  /** Creates an account. Supabase may ask the person to confirm their email first (needsConfirmation). */
  signUp(email: string, password: string): Promise<Result<{ needsConfirmation: boolean }>>;
  signOut(): Promise<void>;
  /** Which social sign-ins are switched on (Google, Facebook). */
  socialProviders(): Promise<Record<SocialProvider, boolean>>;
  /** Sign in or create an account with Google or Facebook. Leaves the page; comes back to /auth/callback?next=… */
  signInWithProvider(provider: SocialProvider, next: string): Promise<Result>;
  /** Sign in with a passkey (Face ID, fingerprint, a password manager). */
  signInWithPasskey(): Promise<Result<Member>>;
  /** Emails a link to set a new password. Always succeeds, so it never reveals who has an account. */
  requestPasswordReset(email: string): Promise<Result>;
  /** Sets a new password for the signed-in member (including after following a reset link). */
  setPassword(password: string): Promise<Result>;
  /** Fires when someone arrives from a password-reset link. */
  onPasswordRecovery(cb: () => void): () => void;

  myProfile(): Promise<Profile | null>;
  saveProfile(fields: ProfileFields): Promise<Result>;
  passkeys(): Promise<Result<Passkey[]>>;
  addPasskey(): Promise<Result<Passkey>>;
  renamePasskey(id: string, name: string): Promise<Result>;
  removePasskey(id: string): Promise<Result>;

  myListings(): Promise<Draft[]>;
  createDraft(category: string): Promise<Result<string>>;
  getDraft(id: string): Promise<Draft | null>;
  saveDraft(id: string, fields: DraftFields): Promise<Result>;
  saveSerial(id: string, serial: string): Promise<Result>;
  addMedia(id: string, shot: string, media: PreparedMedia): Promise<Result<DraftMedia>>;
  removeMedia(id: string, mediaId: string): Promise<Result>;
  publish(id: string): Promise<Result>;
  /** Takes a live listing off sale so it can be edited; publishing again puts it back. */
  pauseForEditing(id: string): Promise<Result>;
  deleteDraft(id: string): Promise<Result>;

  /** Today's price breakdown for a listing; null when it can't be bought. */
  quote(listingId: string): Promise<FeeBreakdown | null>;
  /** Prices the order on the server and holds the item while the buyer pays. */
  /**
   * revision = the version the buyer was looking at. If the seller has changed the listing since, nothing is
   * held and code is 'listing_changed'.
   */
  startCheckout(listingId: string, revision?: number): Promise<Result<CheckoutStarted> & { code?: string }>;
  /** The listing as buyers see it right now, to compare with what was on screen. */
  listingNow(listingId: string): Promise<ListingVersion | null>;
  /** Gets the payment form ready. code 'not_configured' when payments aren't switched on. */
  startPayment(orderId: string): Promise<Result<PaymentStart> & { code?: string }>;
  /** Example mode only: pretend the card payment succeeded. */
  simulatePayment(orderId: string): Promise<Result>;
  cancelCheckout(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<OrderSummary | null>;
  myOrders(): Promise<OrderSummary[]>;

  /** An order's chain of custody as the signed-in person may see it; null if they can't. */
  custody(orderId: string): Promise<CustodyView | null>;
  /** A one-time code to say on camera, for the current step. */
  issueChallenge(orderId: string): Promise<Result<{ code: string; expiresAt: string }>>;
  /** The seal code to fit at the current step. */
  issueSeal(orderId: string): Promise<Result<{ kind: string; code: string }>>;
  /** Uploads a photo or video to the order's private evidence. */
  uploadEvidence(orderId: string, media: PreparedMedia): Promise<Result<{ path: string; sha256: string; kind: 'photo' | 'video' }>>;
  /** Records the current step. The server decides whether it is accepted. */
  recordStep(orderId: string, step: string, evidence: Evidence): Promise<Result<CustodyView>>;
  /** The buyer reports a problem; payment stays held. */
  openDispute(orderId: string, reason: string, note: string): Promise<Result<CustodyView>>;
  /** For couriers and hubs: orders waiting for them, and ones they've worked on. */
  agentTasks(): Promise<AgentTask[]>;
}

export interface Address { name: string; line1: string; line2: string | null; town: string; postcode: string }
export type ParcelSize = 'small' | 'medium' | 'large';
export interface ShippingQuote { service: string; carrier: string; name: string; dropOff: boolean; prices: Record<ParcelSize, number> }
export interface ShippingLabel {
  id: string; carrier: string; service: string; parcel: ParcelSize; pricePence: number; mode: 'test' | 'live';
  tracking: string; labelUrl: string | null; deliverTo: Address; createdAt: string;
}
export interface OrderShipping {
  /** A label can be made now (paid, posted by the seller, not yet recorded as sent). */
  canLabel: boolean;
  /** Shown to the buyer, staff, and the seller once there's a label. */
  address: Address | null;
  hasAddress: boolean;
  addressFromBasket: boolean;
  label: ShippingLabel | null;
  /** For the seller while they can make a label. */
  quotes: ShippingQuote[] | null;
  sizes: { key: ParcelSize; name: string; limit: string }[];
}

export interface SellerTrust {
  verified: boolean;
  /** Confirmed without any dispute. */
  completed: number;
  /** Confirmed or disputed. */
  finished: number;
  disputes: number;
  /** Percent; null until 5 finished. */
  disputeRate: number | null;
  /** null until 3 completed. */
  avgHandoverHours: number | null;
  /** Identity checked, 5+ completed and disputes at most 5%. */
  trusted: boolean;
}
export interface TrustStats {
  completed: number;
  completed30d: number;
  finished: number;
  disputes: number;
  refunds: number;
  avgHandoverHours: number | null;
  byTier: Partial<Record<'enhanced' | 'verified' | 'luxury' | 'ultraLuxury', number>>;
  recent: { listingId: string; title: string; tier: 'enhanced' | 'verified' | 'luxury' | 'ultraLuxury'; confirmedOn: string }[];
}

type TierKey4 = 'enhanced' | 'verified' | 'luxury' | 'ultraLuxury';
export interface StaffReport {
  from: string;
  to: string;
  sales: { orders: number; sellers: number; buyers: number; gmvPence: number; buyerPaidPence: number; postagePence: number; averageOrderPence: number | null; sellerPayoutsPence: number };
  fees: { transactionPence: number; processingPence: number; commissionPence: number; courierPence: number; hubPence: number; promotionPence: number; nutuyuVouchersPence: number; netPence: number };
  byTier: Partial<Record<TierKey4, { orders: number; gmvPence: number }>>;
  byCategory: { category: string; orders: number; gmvPence: number }[];
  disputes: { opened: number; ratePct: number | null; byReason: Record<string, number>; released: number; refunded: number; openNow: number; avgHoursToDecide: number | null };
  handover: { completed: number; avgHours: number | null; medianHours: number | null; byTier: Partial<Record<TierKey4, { completed: number; avgHours: number | null }>> };
  labels: Record<string, number>;
  months: { month: string; orders: number; gmvPence: number; netFeesPence: number; disputes: number }[];
}

export type PayoutStatus = 'waiting' | 'queued' | 'sending' | 'sent' | 'failed' | 'held';
export interface PayoutSummary {
  account: { connected: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean } | null;
  waitingPence: number;
  sentPence: number;
  recent: { id: string; orderId: string; title: string; amountPence: number; labelPence: number; status: PayoutStatus; createdAt: string; sentAt: string | null }[];
}
export interface StaffPayouts {
  counts: Partial<Record<PayoutStatus, number>>;
  totals: Partial<Record<PayoutStatus, number>>;
  items: { id: string; orderId: string; seller: string; amountPence: number; status: PayoutStatus; attempts: number; lastError: string | null; holdReason: string | null; updatedAt: string; sentAt: string | null; connected: boolean; payoutsEnabled: boolean }[];
}
export interface ListingQuestion { id: string; body: string; answer: string | null; answeredAt: string | null; createdAt: string; mine: boolean; canAnswer: boolean }
export type ReportReason = 'counterfeit' | 'prohibited' | 'scam' | 'offensive' | 'wrong_category' | 'other';
export type ModerationAction = 'dismiss' | 'hide_listing' | 'restore_listing' | 'suspend' | 'restore_member';
export interface StaffModeration {
  open: number;
  suspended: number;
  hidden: number;
  items: { kind: 'listing' | 'member'; listingId: string | null; title: string | null; hidden: boolean; member: string | null; suspended: boolean; count: number; latest: string; reasons: ReportReason[]; notes: string[] }[];
}

export interface SavedAddress { id: string; label: string | null; address: Address; isDefault: boolean }
export interface IdentityStatus { verified: boolean; latest: { status: 'started' | 'processing' | 'verified' | 'requires_input' | 'canceled'; error: string | null; at: string } | null; canStart: boolean }
export type ReturnReason = 'not_as_described' | 'damaged' | 'wrong_item';
export interface OrderReturn {
  canRequest: boolean;
  return: {
    status: 'requested' | 'accepted' | 'declined' | 'posted' | 'received' | 'cancelled'; reason: ReturnReason; note: string | null; sellerNote: string | null;
    autoAccepted: boolean; requestedAt: string; respondBy: string; decidedAt: string | null; postedAt: string | null; receivedAt: string | null;
  } | null;
  label: { carrier: string; service: string; tracking: string; mode: 'test' | 'live'; deliverTo: Address | null; labelUrl: string | null } | null;
}
export interface StaffRefund { id: string; orderId: string; amountPence: number; status: 'queued' | 'sending' | 'sent' | 'failed' | 'manual'; attempts: number; lastError: string | null; updatedAt: string }
