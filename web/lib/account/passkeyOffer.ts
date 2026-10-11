// When to offer a passkey ("sign in with Face ID or fingerprint next time").
// The plan: offer it after the third password sign-in on a device, not before, so new members
// aren't asked for something before they trust the site. A passkey belongs to a device, so the count
// is kept per device, in this browser. "Not now" asks again three sign-ins later; "Don't ask again" stops.

export const OFFER_AFTER = 3;
export const SNOOZE_SIGN_INS = 3;
const KEY = 'pv-passkey-offer';

export interface OfferState {
  /** Password sign-ins on this device. */
  signIns: number;
  /** Don't offer before this many sign-ins. */
  nextOfferAt: number;
  never: boolean;
}

export const initialOffer: OfferState = { signIns: 0, nextOfferAt: OFFER_AFTER, never: false };

export function afterPasswordSignIn(s: OfferState, hasPasskey: boolean): { state: OfferState; offer: boolean } {
  const state = { ...s, signIns: s.signIns + 1 };
  return { state, offer: !hasPasskey && !state.never && state.signIns >= state.nextOfferAt };
}

export function notNow(s: OfferState): OfferState {
  return { ...s, nextOfferAt: s.signIns + SNOOZE_SIGN_INS };
}

export function neverAsk(s: OfferState): OfferState {
  return { ...s, never: true };
}

export function loadOffer(): OfferState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<OfferState>;
      if (typeof v.signIns === 'number' && typeof v.nextOfferAt === 'number') return { ...initialOffer, ...v };
    }
  } catch {
    /* storage unavailable */
  }
  return initialOffer;
}

export function saveOffer(s: OfferState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the offer simply comes back later */
  }
}

/** True when this browser can use passkeys at all. */
export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && window.isSecureContext;
}

export const USERNAME_RULE = /^[A-Za-z0-9._-]{3,30}$/;
export const BIO_MAX = 500;

export function usernameProblem(u: string): string | null {
  const t = u.trim();
  if (t.length < 3) return 'Use at least 3 characters.';
  if (t.length > 30) return 'Use at most 30 characters.';
  if (!USERNAME_RULE.test(t)) return 'Use letters, numbers, dots, dashes or underscores only.';
  return null;
}
