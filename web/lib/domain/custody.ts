import type { Tier } from './types';

// The chain of custody: who does what, in what order, for each tier, and how each record is hashed.
// The database (migration 011) is the authority: it accepts a step only from the right person, in order,
// with the right evidence, and writes it to an append-only, hash-chained log. This file mirrors the same
// rules so screens can explain them, and both are tested against backend/fixtures/custody_plans.json.

export type Actor = 'seller' | 'buyer' | 'courier' | 'hub' | 'hub2';
/** What a step's evidence must contain. */
export type Need = 'photo' | 'video' | 'code' | 'grams' | 'seal' | 'tracking' | 'attest' | 'result';
export type SealKind = 'proof' | 'proof_b' | 'item';

export interface StepDef {
  key: string;
  actor: Actor;
  needs: Need[];
  seal?: SealKind;
  sealMode?: 'apply' | 'check';
}

const s = (key: string, actor: Actor, needs: Need[], seal?: SealKind, sealMode?: 'apply' | 'check'): StepDef =>
  seal ? { key, actor, needs, seal, sealMode } : { key, actor, needs };

const SELLER_HANDOVER = [
  s('handover_code', 'seller', ['code', 'video']),
  s('handover_item', 'seller', ['photo']),
];
const SELLER_SEALING = [
  s('handover_weight', 'seller', ['grams']),
  s('handover_seal', 'seller', ['seal'], 'proof', 'apply'),
  s('handover_sealed', 'seller', ['photo']),
  s('courier_pickup', 'courier', ['attest', 'tracking']),
];
const HUB = (second: boolean) => [
  s('hub_seal', 'hub', ['seal'], 'proof', 'check'),
  s('hub_item_seal', 'hub', ['seal'], 'item', 'check'),
  s('hub_code', 'hub', ['code', 'video']),
  s('hub_inspect', 'hub', ['photo']),
  s('hub_authenticate', 'hub', ['result']),
  ...(second ? [s('hub_second_opinion', 'hub2', ['result'])] : []),
  s('hub_reseal', 'hub', ['seal', 'grams'], 'proof_b', 'apply'),
];
const LUXURY = (second: boolean) => [
  ...SELLER_HANDOVER,
  s('handover_item_seal', 'seller', ['seal'], 'item', 'apply'),
  ...SELLER_SEALING,
  ...HUB(second),
  s('courier_delivery', 'courier', ['grams']),
  s('unbox_code', 'buyer', ['code', 'video']),
  s('unbox_seal', 'buyer', ['seal'], 'proof_b', 'check'),
  s('unbox_item_seal', 'buyer', ['seal'], 'item', 'check'),
  s('unbox_item', 'buyer', ['photo']),
  s('witness_opening', 'courier', ['attest']),
  s('confirm', 'buyer', []),
];

export const PLANS: Record<Tier, StepDef[]> = {
  enhanced: [s('pack_photo', 'seller', ['photo']), s('ship', 'seller', ['tracking']), s('confirm', 'buyer', [])],
  verified: [
    ...SELLER_HANDOVER,
    ...SELLER_SEALING,
    s('courier_delivery', 'courier', ['grams']),
    s('unbox_code', 'buyer', ['code', 'video']),
    s('unbox_seal', 'buyer', ['seal'], 'proof', 'check'),
    s('unbox_item', 'buyer', ['photo']),
    s('witness_opening', 'courier', ['attest']),
    s('confirm', 'buyer', []),
  ],
  luxury: LUXURY(false),
  ultraLuxury: LUXURY(true),
};

export function planFor(tier: Tier): StepDef[] {
  return PLANS[tier] ?? PLANS.enhanced;
}

// ---------- Words ----------

const COPY: Record<string, { title: string; note: string }> = {
  pack_photo: { title: 'Photograph the item as you pack it', note: 'One clear photo of the item going into the parcel.' },
  ship: { title: 'Post it with tracking', note: 'Enter the carrier and tracking number so the buyer can follow it.' },
  handover_code: {
    title: 'Start recording and read the code aloud',
    note: 'A one-time code appears when you start. Saying it on camera ties this video to this moment. It expires after a few minutes.',
  },
  handover_item: { title: 'Show the item on camera', note: 'Its condition just before packing.' },
  handover_item_seal: { title: 'Fit the Item Seal', note: 'A breakable tag fitted to the item itself. Enter the code we give you to pair it with this order.' },
  handover_weight: { title: 'Weigh the parcel', note: 'In grams. It is compared with the weight at delivery.' },
  handover_seal: { title: 'Seal the parcel with the ProofSeal', note: 'Use the seal code we give you, then type or scan it to confirm.' },
  handover_sealed: { title: 'Photograph the sealed parcel', note: 'The seal visibly intact before it leaves your hands.' },
  courier_pickup: { title: 'Courier witnesses packing and takes the parcel', note: 'The courier confirms they watched it packed and sealed, and adds the tracking number.' },
  hub_seal: { title: 'Hub checks the ProofSeal', note: 'The code on the seal must match the one fitted at handover.' },
  hub_item_seal: { title: 'Hub checks the Item Seal', note: 'Proves the item itself wasn’t swapped in transit.' },
  hub_code: { title: 'Hub records the opening and reads the code aloud', note: 'A fresh one-time code for this inspection.' },
  hub_inspect: { title: 'Hub inspects on camera', note: 'Nothing happens off the record.' },
  hub_authenticate: { title: 'Authenticated against reference data', note: 'Pass or fail, with notes.' },
  hub_second_opinion: { title: 'Second authenticator reviews it', note: 'Required over £1,500: a different authenticator gives their own verdict.' },
  hub_reseal: { title: 'Hub repacks with a new ProofSeal', note: 'The first seal is retired; a new one carries the final leg. The parcel is weighed again.' },
  courier_delivery: { title: 'Courier weighs it at your door', note: 'Compared automatically with the weight at packing.' },
  unbox_code: { title: 'Start recording and read the code aloud', note: 'Open the parcel on camera while the courier watches.' },
  unbox_seal: { title: 'Check the ProofSeal', note: 'Type or scan the code on the seal before you break it. It must match the seal fitted for this parcel.' },
  unbox_item_seal: { title: 'Check the Item Seal', note: 'The tag on the item must match the one paired at handover.' },
  unbox_item: { title: 'Photograph the item', note: 'As it came out of the parcel.' },
  witness_opening: { title: 'Courier confirms the opening', note: 'From the courier’s own account, not the buyer’s.' },
  confirm: { title: 'Confirm it’s as described', note: 'This releases the payment to the seller. If you do nothing, it confirms itself after the protection window.' },
};

export function stepCopy(step: StepDef, tier: Tier): { title: string; note: string } {
  const c = COPY[step.key] ?? { title: step.key, note: '' };
  if (step.key === 'courier_pickup' && (tier === 'luxury' || tier === 'ultraLuxury')) {
    return { ...c, note: 'The courier confirms they watched it packed and sealed, and takes it to the authentication hub.' };
  }
  return c;
}

export const ACTOR_LABEL: Record<Actor, string> = {
  seller: 'Seller',
  buyer: 'Buyer',
  courier: 'Courier',
  hub: 'Authentication hub',
  hub2: 'Second authenticator',
};

// ---------- Evidence ----------

export type EvidenceValue = string | number | boolean;
export type Evidence = Record<string, EvidenceValue>;

export const MAX_GRAMS = 100_000;
export const TRACKING = /^[A-Za-z0-9 -]{6,40}$/;
export const SEAL_CODE = /^(PS|PB|IS)-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Upper-cases and tidies a seal code as typed: "ps 7k2m 9qxd" → "PS-7K2M-9QXD". */
export function normaliseSeal(raw: string): string {
  const c = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return c.length === 10 ? `${c.slice(0, 2)}-${c.slice(2, 6)}-${c.slice(6)}` : raw.trim().toUpperCase();
}

/** What's still missing from a step's evidence, in plain words. Empty when it can be sent. */
export function evidenceProblems(step: StepDef, e: Evidence): string[] {
  const out: string[] = [];
  for (const need of step.needs) {
    if (need === 'photo' && !(e.media && e.media_kind === 'photo')) out.push('Add a photo.');
    if (need === 'video' && !(e.media && e.media_kind === 'video')) out.push('Add the video.');
    if (need === 'code' && !/^\d{6}$/.test(String(e.code ?? ''))) out.push('Start recording to get your code.');
    if (need === 'grams') {
      const g = Number(e.grams);
      if (!Number.isInteger(g) || g < 1 || g > MAX_GRAMS) out.push('Enter the weight in whole grams.');
    }
    if (need === 'seal' && !SEAL_CODE.test(String(e.seal ?? ''))) out.push('Enter the seal code, like PS-7K2M-9QXD.');
    if (need === 'tracking') {
      if (!String(e.carrier ?? '').trim()) out.push('Enter the carrier.');
      if (!TRACKING.test(String(e.tracking ?? ''))) out.push('Enter the tracking number.');
    }
    if (need === 'attest' && e.attest !== true) out.push('Tick to confirm.');
    if (need === 'result' && e.result !== 'pass' && e.result !== 'fail') out.push('Choose pass or fail.');
  }
  return out;
}

// ---------- The hash chain ----------

/**
 * Evidence as text for hashing: keys in byte order, each value as "key=<bytes>:<value>", joined by ";".
 * The byte length makes the form unambiguous whatever the values contain. Matches the database exactly.
 */
export function canonicalEvidence(e: Evidence): string {
  const enc = new TextEncoder();
  return Object.keys(e)
    .sort()
    .map((k) => {
      const v = String(e[k]);
      return `${k}=${enc.encode(v).length}:${v}`;
    })
    .join(';');
}

export interface ChainLink {
  prev: string;
  orderId: string;
  seq: number;
  step: string;
  actorRole: string;
  actorId: string;
  evidence: Evidence;
  /** ISO time to the millisecond, as the database stores it. */
  at: string;
}

export function canonicalEvent(l: ChainLink): string {
  return [l.prev, l.orderId, l.seq, l.step, l.actorRole, l.actorId, canonicalEvidence(l.evidence), l.at].join('|');
}

export async function hashEvent(l: ChainLink): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalEvent(l)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- What screens show ----------

export type CustodyState = 'not_started' | 'in_progress' | 'confirmed' | 'disputed';

export interface CustodyEvent {
  seq: number;
  step: string;
  actorRole: Actor | 'system';
  at: string;
  /** Recorded by the signed-in person. */
  mine: boolean;
  /** Seal and challenge codes are hidden from anyone who still has to check them. */
  evidence: Evidence;
  hash: string;
}

export interface CustodyView {
  orderId: string;
  listingId: string;
  title: string;
  tier: Tier;
  state: CustodyState;
  /** The next step, or null when finished. */
  current: StepDef | null;
  events: CustodyEvent[];
  /** The roles the signed-in person holds on this order (seller, buyer, courier, hub). */
  myRoles: Actor[];
  /** The server re-checked every hash in the chain. */
  chainOk: boolean;
  head: string;
  weightFlag: boolean;
  disputeReason: string | null;
  payoutStatus: 'held' | 'due' | 'paid' | 'refund';
  /** Media links for the evidence, valid for a short time. */
  mediaUrls: Record<string, string>;
  /** The live challenge code, shown only to the person who asked for it. */
  challenge: { code: string; expiresAt: string } | null;
  /** The seal code to fit, shown only to the person fitting it. */
  seal: { kind: SealKind; code: string } | null;
}

/** The step an order is on, from its tier and position; null when it isn't in progress. */
export function stepAt(tier: Tier, index: number, state: CustodyState): StepDef | null {
  return state === 'in_progress' ? planFor(tier)[index] ?? null : null;
}

/** An order waiting for, or worked on by, a courier or authentication hub. */
export interface AgentTask {
  orderId: string;
  title: string;
  tier: Tier;
  state: CustodyState;
  step: StepDef | null;
  updatedAt: string | null;
}

export function isMyTurn(v: Pick<CustodyView, 'current' | 'myRoles' | 'state'>): boolean {
  return v.state === 'in_progress' || v.state === 'not_started' ? !!v.current && v.myRoles.includes(v.current.actor) : false;
}

export const DISPUTE_REASONS: Record<string, string> = {
  seal_mismatch: 'A seal code didn’t match the one fitted earlier.',
  failed_authentication: 'The item failed authentication.',
  not_as_described: 'The buyer says it isn’t as described.',
  not_arrived: 'The buyer says it hasn’t arrived.',
  damaged: 'The buyer says it arrived damaged.',
  other: 'The buyer reported a problem.',
};

export const BUYER_DISPUTE_REASONS = ['not_as_described', 'not_arrived', 'damaged', 'other'] as const;

/** A short line about where the order is, for lists. */
export function custodyHeadline(v: Pick<CustodyView, 'state' | 'current' | 'myRoles' | 'tier'>): string {
  if (v.state === 'confirmed') return 'Complete — payment released to the seller';
  if (v.state === 'disputed') return 'On hold — a problem was reported';
  if (!v.current) return 'Complete';
  const who = v.myRoles.includes(v.current.actor) ? 'Your turn' : `Waiting for the ${ACTOR_LABEL[v.current.actor].toLowerCase()}`;
  return `${who}: ${stepCopy(v.current, v.tier).title.toLowerCase()}`;
}

/** A short, human summary of one event's evidence. */
export function describeEvidence(e: Evidence): string {
  const parts: string[] = [];
  if (e.seal) parts.push(`Seal ${e.seal}${e.match === false ? ' — does not match' : e.match === true ? ' — matches' : ''}`);
  if (e.grams) parts.push(`${e.grams} g${e.weight_flag ? ' — differs from packing weight' : ''}`);
  if (e.tracking) parts.push(`${e.carrier ?? ''} ${e.tracking}`.trim());
  if (e.result) parts.push(e.result === 'pass' ? 'Passed' : 'Failed');
  if (e.code) parts.push(`Code ${e.code}`);
  if (e.media_kind) parts.push(e.media_kind === 'video' ? 'Video' : 'Photo');
  if (e.attest === true) parts.push('Confirmed');
  if (e.auto === true) parts.push('Confirmed automatically after the protection window');
  if (e.note) parts.push(String(e.note));
  return parts.join(' · ');
}
