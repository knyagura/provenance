import type { FeeBreakdown } from '@/lib/domain/fees';
import type { ListingVersion } from '@/lib/domain/versions';
import type { AgentTask, CustodyState, CustodyView, Evidence } from '@/lib/domain/custody';
import type { Tier } from '@/lib/domain/types';
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
}

export type ProfileFields = Partial<Pick<Profile, 'username' | 'bio' | 'holidayMode'>>;

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

export interface SellingBackend {
  /** Current member, or null when signed out. */
  member(): Promise<Member | null>;
  onMemberChange(cb: (m: Member | null) => void): () => void;
  signIn(email: string, password: string): Promise<Result<Member>>;
  /** Creates an account. Supabase may ask the person to confirm their email first (needsConfirmation). */
  signUp(email: string, password: string): Promise<Result<{ needsConfirmation: boolean }>>;
  signOut(): Promise<void>;
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
