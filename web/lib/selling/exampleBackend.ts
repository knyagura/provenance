import { DRAFT_TITLE, missingForPublish } from '@/lib/domain/evidence';
import { usernameProblem, BIO_MAX } from '@/lib/account/passkeyOffer';
import { computeFees, DEFAULT_FEES } from '@/lib/domain/fees';
import { exampleCatalogue } from '@/lib/domain/examples';
import type { Draft, DraftMedia, Member, OrderSummary, Passkey, Profile, Result, SellingBackend } from './types';

// A pretend backend that lives in this browser tab, for tests and demos without a database
// (PV_DATA_SOURCE=examples). Any email and a password of 8+ characters signs in. Nothing leaves the browser.

const KEY = 'pv-example-selling';

interface StoredPasskey extends Passkey {
  member: Member;
}

interface Store {
  member: Member | null;
  drafts: Draft[];
  profile?: Profile;
  passkeys?: StoredPasskey[];
  orders?: OrderSummary[];
}

function exampleQuote(listingId: string) {
  const l = exampleCatalogue.find((x) => x.id === listingId);
  return l ? { listing: l, quote: computeFees(DEFAULT_FEES, { pricePence: l.pricePence, postagePence: l.shippingPence, payer: 'buyer', boostBp: null }) } : null;
}

function load(): Store {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable: start empty */
  }
  return { member: null, drafts: [] };
}

function save(s: Store) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: state lasts for this page only */
  }
}

let listeners: ((m: Member | null) => void)[] = [];
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

function setMember(s: Store, m: Member | null) {
  s.member = m;
  if (m && !s.profile) s.profile = { username: m.username, bio: '', holidayMode: false, verified: false, business: false, joined: now() };
  save(s);
  listeners.forEach((l) => l(m));
}
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const now = () => new Date().toISOString();

function update(id: string, fn: (d: Draft) => void): Result {
  const s = load();
  const d = s.drafts.find((x) => x.id === id);
  if (!d) return { ok: false, message: 'That draft no longer exists.' };
  fn(d);
  d.updatedAt = now();
  save(s);
  return ok(undefined);
}

export const exampleBackend: SellingBackend = {
  async member() {
    return load().member;
  },
  onMemberChange(cb) {
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },
  async signIn(email, password) {
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: 'Enter a valid email address.' };
    if (password.length < 8) return { ok: false, message: 'That email and password don’t match an account.' };
    const s = load();
    setMember(s, { id: 'example-member', email, username: s.profile?.username ?? email.split('@')[0] });
    return ok(s.member!);
  },
  async signUp(email, password) {
    if (password.length < 8) return { ok: false, message: 'Choose a password of at least 8 characters.' };
    return ok({ needsConfirmation: !email });
  },
  async signOut() {
    setMember(load(), null);
  },
  // Example passkeys use the browser's real passkey prompt, scoped to this site, and are remembered in this tab.
  async signInWithPasskey() {
    try {
      const cred = (await navigator.credentials.get({ publicKey: { challenge: challenge(), userVerification: 'preferred', timeout: 60_000 } })) as PublicKeyCredential | null;
      const s = load();
      const pk = s.passkeys?.find((p) => p.id === cred?.id);
      if (!pk) return { ok: false, message: 'That passkey isn’t linked to an account here. Sign in with your password, then add a passkey from your account page.' };
      pk.lastUsedAt = now();
      const m = { ...pk.member, username: s.profile?.username ?? pk.member.username };
      setMember(s, m);
      return ok(m);
    } catch {
      return { ok: false, message: 'Passkey cancelled. Try again, or use your password.' };
    }
  },
  async requestPasswordReset() {
    return ok(undefined);
  },
  async setPassword(password) {
    return password.length < 8 ? { ok: false, message: 'Choose a password of at least 8 characters.' } : ok(undefined);
  },
  onPasswordRecovery() {
    return () => {};
  },
  async myProfile() {
    const s = load();
    return s.member ? s.profile ?? null : null;
  },
  async saveProfile(f) {
    const s = load();
    if (!s.member || !s.profile) return { ok: false, message: 'Sign in first.' };
    if (f.username !== undefined && usernameProblem(f.username)) return { ok: false, message: usernameProblem(f.username)! };
    if (f.username !== undefined && f.username.trim().toLowerCase() === 'taken') return { ok: false, message: 'That username is taken. Try another.' };
    if (f.bio !== undefined && f.bio.length > BIO_MAX) return { ok: false, message: 'Keep your bio to 500 characters.' };
    Object.assign(s.profile, Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
    if (f.username !== undefined) s.profile.username = f.username.trim();
    setMember(s, { ...s.member, username: s.profile.username });
    return ok(undefined);
  },
  async passkeys() {
    const s = load();
    return ok((s.passkeys ?? []).filter((p) => p.member.id === s.member?.id).map(({ member: _m, ...p }) => p));
  },
  async addPasskey() {
    const s = load();
    if (!s.member) return { ok: false, message: 'Sign in first.' };
    try {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: challenge(),
          rp: { name: 'Provenance (example)' },
          user: { id: new TextEncoder().encode(s.member.id), name: s.member.email, displayName: s.member.username },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      if (!cred) return { ok: false, message: 'Passkey cancelled. Try again, or use your password.' };
      const pk: StoredPasskey = { id: cred.id, name: 'Passkey on this device', createdAt: now(), lastUsedAt: null, member: s.member };
      s.passkeys = [...(s.passkeys ?? []), pk];
      save(s);
      const { member: _m, ...rest } = pk;
      return ok(rest);
    } catch {
      return { ok: false, message: 'Passkey cancelled. Try again, or use your password.' };
    }
  },
  async renamePasskey(id, name) {
    const s = load();
    const pk = s.passkeys?.find((p) => p.id === id);
    if (!pk) return { ok: false, message: 'That passkey no longer exists.' };
    pk.name = name.trim().slice(0, 120) || pk.name;
    save(s);
    return ok(undefined);
  },
  async removePasskey(id) {
    const s = load();
    s.passkeys = (s.passkeys ?? []).filter((p) => p.id !== id);
    save(s);
    return ok(undefined);
  },
  async myListings() {
    return [...load().drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async createDraft(category) {
    const s = load();
    if (!s.member) return { ok: false, message: 'Sign in to sell.' };
    const id = `example-draft-${Math.random().toString(36).slice(2, 10)}`;
    s.drafts.push({
      id, category, title: '', brand: '', size: '', colour: '', condition: null, description: '', pricePence: null,
      parcelSize: null, declined: [], published: false, media: [], serial: '', updatedAt: now(),
    });
    save(s);
    return ok(id);
  },
  async getDraft(id) {
    return load().drafts.find((d) => d.id === id) ?? null;
  },
  async saveDraft(id, f) {
    return update(id, (d) => {
      if (d.published && f.category !== undefined && f.category !== d.category) return;
      Object.assign(d, Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
      if (d.title === DRAFT_TITLE) d.title = '';
    });
  },
  async saveSerial(id, serial) {
    const d = load().drafts.find((x) => x.id === id);
    if (d?.published) return { ok: false, message: 'The serial number cannot change once the listing is live' };
    return update(id, (x) => {
      x.serial = serial.trim();
    });
  },
  async addMedia(id, shot, media) {
    const d = load().drafts.find((x) => x.id === id);
    if (d?.published) return { ok: false, message: 'Reference photos are fixed once the listing is live' };
    const m: DraftMedia = { id: `m-${Math.random().toString(36).slice(2, 10)}`, shot, kind: media.kind, url: URL.createObjectURL(media.blob) };
    const r = update(id, (x) => {
      x.media.push(m);
    });
    return r.ok ? ok(m) : r;
  },
  async removeMedia(id, mediaId) {
    const d = load().drafts.find((x) => x.id === id);
    if (d?.published) return { ok: false, message: 'Reference photos are fixed once the listing is live' };
    return update(id, (x) => {
      x.media = x.media.filter((m) => m.id !== mediaId);
    });
  },
  async publish(id) {
    const d = load().drafts.find((x) => x.id === id);
    if (!d) return { ok: false, message: 'That draft no longer exists.' };
    const missing = missingForPublish({
      category: d.category, title: d.title, condition: d.condition, pricePence: d.pricePence,
      shots: d.media.map((m) => m.shot), declined: d.declined, hasSerial: Boolean(d.serial), parcelSize: d.parcelSize,
    });
    if (missing.length) return { ok: false, message: `Still needed: ${missing.join(', ')}` };
    return update(id, (x) => {
      x.published = true;
    });
  },
  async quote(listingId) {
    const sold = load().orders?.some((o) => o.listingId === listingId && o.paymentStatus === 'paid');
    return sold ? null : exampleQuote(listingId)?.quote ?? null;
  },
  async startCheckout(listingId) {
    const s = load();
    if (!s.member) return { ok: false, message: 'Sign in to buy' };
    const q = exampleQuote(listingId);
    if (!q || s.orders?.some((o) => o.listingId === listingId && o.paymentStatus === 'paid')) return { ok: false, message: 'This item is not available to buy' };
    const open = s.orders?.find((o) => o.listingId === listingId && o.paymentStatus === 'awaiting_payment');
    if (open) return ok({ orderId: open.id, quote: open.quote!, holdExpiresAt: open.holdExpiresAt! });
    const hold = new Date(Date.now() + DEFAULT_FEES.checkoutHoldMinutes * 60_000).toISOString();
    const o: OrderSummary = {
      id: `example-order-${Math.random().toString(36).slice(2, 10)}`, listingId, title: q.listing.title, photoUrl: null, role: 'buyer',
      paymentStatus: 'awaiting_payment', status: 'purchased', quote: q.quote, totalPence: q.quote.buyerTotalPence,
      holdExpiresAt: hold, paidAt: null, createdAt: now(),
    };
    s.orders = [o, ...(s.orders ?? [])];
    save(s);
    return ok({ orderId: o.id, quote: q.quote, holdExpiresAt: hold });
  },
  async startPayment(orderId) {
    const o = load().orders?.find((x) => x.id === orderId);
    if (!o || o.paymentStatus !== 'awaiting_payment') return { ok: false, message: 'This checkout has ended. Start again from the item.' };
    return ok({ kind: 'simulated' as const, amountPence: o.totalPence ?? 0 });
  },
  async simulatePayment(orderId) {
    const s = load();
    const o = s.orders?.find((x) => x.id === orderId);
    if (!o || o.paymentStatus !== 'awaiting_payment') return { ok: false, message: 'This checkout has ended. Start again from the item.' };
    o.paymentStatus = 'paid';
    o.paidAt = now();
    save(s);
    return ok(undefined);
  },
  async cancelCheckout(orderId) {
    const s = load();
    const o = s.orders?.find((x) => x.id === orderId);
    if (o && o.paymentStatus === 'awaiting_payment') o.paymentStatus = 'cancelled';
    save(s);
  },
  async getOrder(orderId) {
    const s = load();
    return s.member ? s.orders?.find((o) => o.id === orderId) ?? null : null;
  },
  async myOrders() {
    const s = load();
    return s.member ? (s.orders ?? []).filter((o) => o.paymentStatus !== 'cancelled') : [];
  },
  async deleteDraft(id) {
    const s = load();
    s.drafts = s.drafts.filter((d) => d.id !== id || d.published);
    save(s);
    return ok(undefined);
  },
};
