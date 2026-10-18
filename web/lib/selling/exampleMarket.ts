import { exampleCatalogue } from '@/lib/domain/examples';
import {
  evidenceProblems,
  hashEvent,
  normaliseSeal,
  planFor,
  stepAt,
  type Actor,
  type AgentTask,
  type CustodyEvent,
  type CustodyState,
  type CustodyView,
  type Evidence,
  type SealKind,
} from '@/lib/domain/custody';
import type { Tier } from '@/lib/domain/types';
import { exampleNotifyOrderChange } from './exampleNotifications';
import type { Member, OrderSummary, PreparedMedia, Result } from './types';

// Example mode's shared marketplace: orders and their custody, kept in localStorage so that two tabs
// (signed in as the buyer and the seller, or a courier) see the same orders, like two phones would.
// It follows the database's custody rules (migration 011) so the screens can be tested without one;
// the database remains the authority and has its own tests (tests/custody_attacks.mjs).
//
// Example people: any email signs in. The seller of an example listing is <their username>@example.test.
// Emails starting "courier" are couriers; emails starting "hub" are authentication hubs.

const KEY = 'pv-example-market';
const CHALLENGE_MINUTES = 10;
const WEIGHT_TOLERANCE_G = 50;
const WEIGHT_TOLERANCE_PCT = 5;

interface StoredEvent extends Omit<CustodyEvent, 'mine'> {
  actorId: string | null;
  prevHash: string;
}

interface StoredCustody {
  tier: Tier;
  state: CustodyState;
  step: number;
  head: string;
  events: StoredEvent[];
  challenges: Record<string, { code: string; issuedTo: string; expiresAt: string; used: boolean }>;
  seals: Partial<Record<SealKind, { code: string; issuedTo: string; applied: boolean }>>;
  weightFlag: boolean;
  disputeReason: string | null;
  payoutStatus: CustodyView['payoutStatus'];
}

export interface StoredOrder {
  summary: Omit<OrderSummary, 'role' | 'custody'>;
  buyerId: string;
  sellerId: string;
  custody: StoredCustody | null;
  /** A basket checkout's gift: who it's for, once they open the gift link. */
  recipientId?: string | null;
  groupId?: string | null;
  basketName?: string | null;
  gift?: { wrap: boolean; wrapRequested: boolean; wrapStyle: string | null; message: string | null; hidePrices: boolean; deliverBy: string | null; giftReceipt: boolean } | null;
  giftToken?: string | null;
  shipTo?: Record<string, unknown> | null;
}

interface Market {
  orders: StoredOrder[];
  /** Uploaded evidence: who uploaded it, and a small copy to show (large videos aren't kept). */
  media: Record<string, { owner: string; dataUrl: string | null }>;
}

export function memberId(email: string): string {
  return `example:${email.trim().toLowerCase()}`;
}

export function exampleSellerId(listingId: string): string | null {
  const l = exampleCatalogue.find((x) => x.id === listingId);
  return l ? memberId(`${l.seller.username}@example.test`) : null;
}

/** Couriers and hubs added in the example staff console, by email. */
export const EXAMPLE_AGENTS_KEY = 'pv-example-agents';

function agentRole(m: Member): 'courier' | 'hub' | null {
  const e = m.email.toLowerCase();
  try {
    const added = JSON.parse(localStorage.getItem(EXAMPLE_AGENTS_KEY) ?? '[]') as { email: string; role: 'courier' | 'hub'; active: boolean }[];
    const a = added.find((x) => x.email.toLowerCase() === e);
    if (a) return a.active ? a.role : null;
  } catch {
    /* none added */
  }
  return e.startsWith('courier') ? 'courier' : e.startsWith('hub') ? 'hub' : null;
}

export function loadMarket(): Market {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Market;
  } catch {
    /* storage unavailable */
  }
  return { orders: [], media: {} };
}

export function saveMarket(m: Market): void {
  // Tell people what changed, as the database's notification triggers do.
  const before = new Map(loadMarket().orders.map((o) => [o.summary.id, o]));
  for (const o of m.orders) {
    const b = before.get(o.summary.id);
    if (!b || JSON.stringify(b.summary.paymentStatus) !== JSON.stringify(o.summary.paymentStatus) || JSON.stringify(b.custody) !== JSON.stringify(o.custody)) {
      exampleNotifyOrderChange(b, o);
    }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage full or unavailable: keep going for this page */
  }
}

export function toSummary(o: StoredOrder, me: Member): OrderSummary {
  return {
    ...o.summary,
    role: o.buyerId === me.id ? 'buyer' : 'seller',
    custody: o.custody ? { state: o.custody.state, tier: o.custody.tier, step: o.custody.step } : null,
  };
}

/** Starts custody when an example order is paid. */
export function beginCustody(o: StoredOrder): void {
  o.custody = {
    tier: o.summary.quote?.tier ?? 'enhanced', state: 'in_progress', step: 0, head: '0', events: [],
    challenges: {}, seals: {}, weightFlag: false, disputeReason: null, payoutStatus: 'held',
  };
}

function rolesFor(o: StoredOrder, me: Member): Actor[] {
  const roles: Actor[] = [];
  if (me.id === o.sellerId) roles.push('seller');
  if (me.id === o.buyerId || (!!o.recipientId && me.id === o.recipientId)) roles.push('buyer');
  const agent = agentRole(me);
  if (agent && me.id !== o.sellerId && me.id !== o.buyerId && me.id !== o.recipientId) roles.push(...(agent === 'courier' ? (['courier'] as Actor[]) : (['hub', 'hub2'] as Actor[])));
  return roles;
}

function canView(o: StoredOrder, me: Member): boolean {
  if (!o.custody || o.summary.paymentStatus !== 'paid') return false;
  if (me.id === o.buyerId || me.id === o.sellerId || (!!o.recipientId && me.id === o.recipientId)) return true;
  const cur = stepAt(o.custody.tier, o.custody.step, o.custody.state);
  return (!!cur && rolesFor(o, me).includes(cur.actor)) || o.custody.events.some((e) => e.actorId === me.id);
}

function view(o: StoredOrder, me: Member, market: Market, chainOk: boolean): CustodyView {
  const c = o.custody!;
  const roles = rolesFor(o, me);
  const plan = planFor(c.tier);
  const cur = stepAt(c.tier, c.step, c.state);
  const hidden = new Set(
    c.state === 'in_progress' ? plan.filter((s, i) => i >= c.step && s.sealMode === 'check' && roles.includes(s.actor)).map((s) => s.seal) : [],
  );
  const mine = cur && roles.includes(cur.actor);
  const ch = mine ? c.challenges[cur.key] : undefined;
  const sl = mine && cur.sealMode === 'apply' && cur.seal ? c.seals[cur.seal] : undefined;
  const mediaUrls: Record<string, string> = {};
  for (const e of c.events) {
    const p = e.evidence.media;
    if (typeof p === 'string' && market.media[p]?.dataUrl) mediaUrls[p] = market.media[p].dataUrl!;
  }
  return {
    orderId: o.summary.id, listingId: o.summary.listingId, title: o.summary.title, tier: c.tier, state: c.state, current: cur,
    events: c.events.map(({ actorId, prevHash: _p, ...e }) => ({
      ...e,
      mine: actorId === me.id,
      evidence: e.evidence.seal && hidden.has(e.evidence.seal_kind as SealKind) && actorId !== me.id ? { ...e.evidence, seal: 'hidden until you check it' } : e.evidence,
    })),
    myRoles: roles, chainOk, head: c.head, weightFlag: c.weightFlag, disputeReason: c.disputeReason, payoutStatus: c.payoutStatus, mediaUrls,
    challenge: ch && !ch.used && ch.issuedTo === me.id && ch.expiresAt > new Date().toISOString() ? { code: ch.code, expiresAt: ch.expiresAt } : null,
    seal: sl && cur?.seal ? { kind: cur.seal, code: sl.code } : null,
  };
}

async function verifyChain(o: StoredOrder): Promise<boolean> {
  let prev = '0';
  for (const e of o.custody!.events) {
    const h = await hashEvent({ prev, orderId: o.summary.id, seq: e.seq, step: e.step, actorRole: e.actorRole, actorId: e.actorId ?? '', evidence: e.evidence, at: e.at });
    if (e.prevHash !== prev || e.hash !== h) return false;
    prev = e.hash;
  }
  return prev === o.custody!.head;
}

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const random6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const sealCode = (prefix: string) => {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const c = [...b].map((x) => CROCKFORD[x % 32]).join('');
  return `${prefix}-${c.slice(0, 4)}-${c.slice(4)}`;
};

function find(market: Market, orderId: string, me: Member | null): StoredOrder | null {
  const o = market.orders.find((x) => x.summary.id === orderId);
  return o && me && canView(o, me) ? o : null;
}

export async function append(o: StoredOrder, step: string, role: Actor | 'system' | 'staff', actorId: string | null, evidence: Evidence): Promise<void> {
  const c = o.custody!;
  const seq = c.events.length + 1;
  const at = new Date().toISOString();
  const hash = await hashEvent({ prev: c.head, orderId: o.summary.id, seq, step, actorRole: role, actorId: actorId ?? '', evidence, at });
  c.events.push({ seq, step, actorRole: role, actorId, evidence, at, hash, prevHash: c.head });
  c.head = hash;
}

export const exampleCustody = {
  async custody(orderId: string, me: Member | null): Promise<CustodyView | null> {
    const market = loadMarket();
    const o = find(market, orderId, me);
    return o && me ? view(o, me, market, await verifyChain(o)) : null;
  },

  async issueChallenge(orderId: string, me: Member | null): Promise<Result<{ code: string; expiresAt: string }>> {
    const market = loadMarket();
    const o = find(market, orderId, me);
    if (!o || !me) return fail('Order not found.');
    const cur = stepAt(o.custody!.tier, o.custody!.step, o.custody!.state);
    if (!cur?.needs.includes('code')) return fail('This step doesn’t need a code.');
    if (!rolesFor(o, me).includes(cur.actor)) return fail(`This step is for the ${cur.actor}.`);
    const c = { code: random6(), issuedTo: me.id, expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString(), used: false };
    o.custody!.challenges[cur.key] = c;
    saveMarket(market);
    return { ok: true, value: { code: c.code, expiresAt: c.expiresAt } };
  },

  async issueSeal(orderId: string, me: Member | null): Promise<Result<{ kind: string; code: string }>> {
    const market = loadMarket();
    const o = find(market, orderId, me);
    if (!o || !me) return fail('Order not found.');
    const cur = stepAt(o.custody!.tier, o.custody!.step, o.custody!.state);
    if (cur?.sealMode !== 'apply' || !cur.seal) return fail('This step doesn’t fit a seal.');
    if (!rolesFor(o, me).includes(cur.actor)) return fail(`This step is for the ${cur.actor}.`);
    const seals = o.custody!.seals;
    seals[cur.seal] ??= { code: sealCode(cur.seal === 'proof' ? 'PS' : cur.seal === 'proof_b' ? 'PB' : 'IS'), issuedTo: me.id, applied: false };
    saveMarket(market);
    return { ok: true, value: { kind: cur.seal, code: seals[cur.seal]!.code } };
  },

  async uploadEvidence(orderId: string, media: PreparedMedia, me: Member | null): Promise<Result<{ path: string; sha256: string; kind: 'photo' | 'video' }>> {
    const market = loadMarket();
    const o = find(market, orderId, me);
    const cur = o ? stepAt(o.custody!.tier, o.custody!.step, o.custody!.state) : null;
    if (!o || !me || !cur || !rolesFor(o, me).includes(cur.actor)) return fail('It isn’t your turn on this order.');
    const path = `${orderId}/${crypto.randomUUID()}.${media.extension}`;
    let dataUrl: string | null = null;
    if (media.blob.size < 1_500_000) {
      dataUrl = await new Promise<string | null>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
        r.onerror = () => resolve(null);
        r.readAsDataURL(media.blob);
      });
    }
    market.media[path] = { owner: me.id, dataUrl };
    saveMarket(market);
    return { ok: true, value: { path, sha256: media.sha256, kind: media.kind } };
  },

  async recordStep(orderId: string, stepKey: string, input: Evidence, me: Member | null): Promise<Result<CustodyView>> {
    const market = loadMarket();
    const o = find(market, orderId, me);
    if (!o || !me) return fail('Order not found.');
    const c = o.custody!;
    if (c.state === 'confirmed') return fail('This order is already complete.');
    if (c.state === 'disputed') return fail('This order is on hold while a problem is looked into.');
    const cur = stepAt(c.tier, c.step, c.state)!;
    if (cur.key !== stepKey) return fail('That step isn’t next. Refresh to see where this order is.');
    if (!rolesFor(o, me).includes(cur.actor)) return fail(`This step is for the ${cur.actor}.`);
    if (cur.actor === 'hub2' && [...c.events].reverse().find((e) => e.step === 'hub_authenticate')?.actorId === me.id) {
      return fail('The second opinion must come from a different authenticator.');
    }
    const ev: Evidence = { ...input };
    if (typeof ev.seal === 'string') ev.seal = normaliseSeal(ev.seal);
    const problems = evidenceProblems(cur, ev);
    if (problems.length) return fail(problems[0]);

    const e: Evidence = {};
    let dispute: string | null = null;
    for (const need of cur.needs) {
      if (need === 'photo' || need === 'video') {
        const p = String(ev.media);
        if (!p.startsWith(`${orderId}/`) || market.media[p]?.owner !== me.id) return fail(`That ${need} hasn’t finished uploading.`);
        if (c.events.some((x) => x.evidence.media === p)) return fail(`That ${need} is already part of this order’s record. Take a new one.`);
        Object.assign(e, { media: p, media_kind: need, media_sha256: String(ev.media_sha256 ?? '') });
      }
      if (need === 'code') {
        const ch = c.challenges[cur.key];
        if (!ch || ch.issuedTo !== me.id || ch.used || ch.expiresAt < new Date().toISOString() || ch.code !== ev.code) {
          return fail('That code has expired or doesn’t match. Start again for a new code.');
        }
        ch.used = true;
        e.code = ch.code;
      }
      if (need === 'grams') {
        const g = Number(ev.grams);
        e.grams = g;
        if (cur.key === 'courier_delivery') {
          const ref = [...c.events].reverse().find((x) => x.step === 'handover_weight' || x.step === 'hub_reseal')?.evidence.grams;
          if (typeof ref === 'number' && Math.abs(g - ref) > Math.max(WEIGHT_TOLERANCE_G, Math.floor((ref * WEIGHT_TOLERANCE_PCT) / 100))) {
            Object.assign(e, { weight_flag: true, packed_grams: ref });
            c.weightFlag = true;
          }
        }
      }
      if (need === 'seal' && cur.seal) {
        const sl = c.seals[cur.seal];
        if (cur.sealMode === 'apply') {
          if (!sl || sl.code !== ev.seal) return fail('That isn’t the seal code issued for this parcel.');
          sl.applied = true;
          Object.assign(e, { seal: ev.seal, seal_kind: cur.seal });
        } else {
          if (!sl?.applied) return fail('Order not found.');
          Object.assign(e, { seal: ev.seal, seal_kind: cur.seal, match: sl.code === ev.seal });
          if (sl.code !== ev.seal) dispute = 'seal_mismatch';
        }
      }
      if (need === 'tracking') Object.assign(e, { carrier: String(ev.carrier).trim(), tracking: String(ev.tracking).trim() });
      if (need === 'attest') e.attest = true;
      if (need === 'result') {
        e.result = ev.result;
        if (ev.result === 'fail') dispute = 'failed_authentication';
      }
    }
    const note = String(ev.note ?? '').trim();
    if (note.length > 500) return fail('Keep the note under 500 characters.');
    if (note) e.note = note;

    await append(o, cur.key, cur.actor, me.id, e);
    c.step += 1;
    if (dispute) Object.assign(c, { state: 'disputed', disputeReason: dispute });
    else if (cur.key === 'confirm') Object.assign(c, { state: 'confirmed', payoutStatus: 'due' });
    saveMarket(market);
    return { ok: true, value: view(o, me, market, await verifyChain(o)) };
  },

  async openDispute(orderId: string, reason: string, note: string, me: Member | null): Promise<Result<CustodyView>> {
    const market = loadMarket();
    const o = find(market, orderId, me);
    if (!o || !me || o.buyerId !== me.id) return fail('Order not found.');
    if (o.custody!.state !== 'in_progress') return fail('This order can’t be disputed now.');
    if (!['not_as_described', 'not_arrived', 'damaged', 'other'].includes(reason)) return fail('Choose what went wrong.');
    const e: Evidence = { reason };
    if (note.trim()) e.note = note.trim().slice(0, 500);
    await append(o, 'dispute', 'buyer', me.id, e);
    Object.assign(o.custody!, { state: 'disputed', disputeReason: reason });
    saveMarket(market);
    return { ok: true, value: view(o, me, market, await verifyChain(o)) };
  },

  async agentTasks(me: Member | null): Promise<AgentTask[]> {
    if (!me || !agentRole(me)) return [];
    return loadMarket()
      .orders.filter((o) => canView(o, me) && o.buyerId !== me.id && o.sellerId !== me.id && o.recipientId !== me.id)
      .map((o) => ({
        orderId: o.summary.id, title: o.summary.title, tier: o.custody!.tier, state: o.custody!.state,
        step: stepAt(o.custody!.tier, o.custody!.step, o.custody!.state), updatedAt: o.custody!.events.at(-1)?.at ?? o.summary.paidAt,
      }));
  },
};

/** Example staff decision on a dispute: recorded in the order's chain, as the database does. */
export async function exampleStaffResolve(orderId: string, outcome: 'release' | 'refund', note: string, staff: Member): Promise<Result> {
  const market = loadMarket();
  const o = market.orders.find((x) => x.summary.id === orderId);
  if (!o?.custody || o.custody.state !== 'disputed' || (o.custody as StoredCustody & { resolution?: string }).resolution) {
    return fail('This order isn’t waiting for a decision.');
  }
  if (note.trim().length < 3) return fail('Write a short note saying why.');
  await append(o, 'staff_resolution', 'staff', staff.id, { outcome, note: note.trim() });
  Object.assign(o.custody, { resolution: outcome, payoutStatus: outcome === 'release' ? 'due' : 'refund', state: outcome === 'release' ? 'confirmed' : 'disputed' });
  saveMarket(market);
  return { ok: true, value: undefined };
}

/** Every stored order, for the example staff console and passport. */
export function exampleOrders(): StoredOrder[] {
  return loadMarket().orders;
}

export async function exampleChainOk(o: StoredOrder): Promise<boolean> {
  return o.custody ? verifyChain(o) : true;
}
