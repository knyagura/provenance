// Example mode's payouts, questions, reports and moderation, kept in this browser's localStorage. They follow the
// rules of migrations 028 and 029, which the database enforces for real (tests/payout_checks.mjs and
// tests/moderation_checks.mjs). Example limits: there's no Stripe, so "Set up payouts" connects straight away and
// released payments show as sent; staff hiding an example item marks it hidden on its page, but example items stay
// in browse (they come from a fixed catalogue).
import { exampleCatalogue } from '@/lib/domain/examples';
import { exampleNotify } from './exampleNotifications';
import { loadMarket, memberId } from './exampleMarket';
import { hasContactDetails } from './trustAndSafety';
import type {
  ListingQuestion, Member, ModerationAction, PayoutSummary, ReportReason, Result, StaffModeration, StaffPayouts,
} from './types';

const KEY = 'pv-example-safety';
interface StoredQuestion { id: string; listingId: string; askerId: string; body: string; answer: string | null; answeredAt: string | null; hidden: boolean; createdAt: string }
interface StoredReport { id: string; reporterId: string; listingId: string | null; member: string | null; reason: ReportReason; note: string | null; status: 'open' | 'actioned' | 'dismissed'; createdAt: string }
interface Safety {
  accounts: Record<string, true>;
  questions: StoredQuestion[];
  reports: StoredReport[];
  hidden: Record<string, { note: string; at: string }>;
  suspended: Record<string, { note: string; at: string }>;
  held: Record<string, string>;
}
const empty = (): Safety => ({ accounts: {}, questions: [], reports: [], hidden: {}, suspended: {}, held: {} });
function load(): Safety {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) };
  } catch {
    return empty();
  }
}
function save(s: Safety) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const isStaff = (m: Member | null) => !!m && m.email.toLowerCase().startsWith('staff');
const nameOf = (memberKey: string) => memberKey.replace(/^example:/, '').split('@')[0].toLowerCase();
const listing = (lid: string) => exampleCatalogue.find((l) => l.id === lid);
const sellerKeyOf = (lid: string) => { const l = listing(lid); return l ? memberId(`${l.seller.username}@example.test`) : null; };
const sellerNameOf = (lid: string) => listing(lid)?.seller.username.toLowerCase() ?? null;
// Example accounts are known by their sign-in email (the example profile name can carry over between sign-ins).
const isSellerOf = (lid: string, m: Member | null) => !!m && m.id === sellerKeyOf(lid);
const suspended = (s: Safety, m: Member) => !!s.suspended[nameOf(m.id)];

// ---------- Payouts ----------
function payouts(m: Member): PayoutSummary {
  const s = load();
  const connected = !!s.accounts[m.id];
  const recent = loadMarket().orders
    .filter((o) => o.sellerId === m.id && (o.custody?.payoutStatus === 'due' || o.custody?.payoutStatus === 'paid'))
    .map((o) => {
      const amount = o.summary.quote?.sellerPayoutPence ?? o.summary.quote?.pricePence ?? 0;
      const held = s.held[o.summary.id];
      const status = held ? 'held' as const : connected ? 'sent' as const : 'waiting' as const;
      const at = o.custody?.events.at(-1)?.at ?? o.summary.createdAt;
      return { id: `payout-${o.summary.id}`, orderId: o.summary.id, title: o.summary.title, amountPence: amount, labelPence: 0, status, createdAt: at, sentAt: status === 'sent' ? at : null };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    account: connected ? { connected: true, detailsSubmitted: true, payoutsEnabled: true } : null,
    waitingPence: recent.filter((r) => r.status !== 'sent').reduce((t, r) => t + r.amountPence, 0),
    sentPence: recent.filter((r) => r.status === 'sent').reduce((t, r) => t + r.amountPence, 0),
    recent,
  };
}

function staffPayouts(): StaffPayouts {
  const s = load();
  const items = loadMarket().orders
    .filter((o) => o.custody?.payoutStatus === 'due' || o.custody?.payoutStatus === 'paid')
    .map((o) => {
      const connected = !!s.accounts[o.sellerId];
      const status = s.held[o.summary.id] ? 'held' as const : connected ? 'sent' as const : 'waiting' as const;
      const at = o.custody?.events.at(-1)?.at ?? o.summary.createdAt;
      return {
        id: `payout-${o.summary.id}`, orderId: o.summary.id, seller: nameOf(o.sellerId), amountPence: o.summary.quote?.sellerPayoutPence ?? 0, status,
        attempts: 0, lastError: null, holdReason: s.held[o.summary.id] ?? null, updatedAt: at, sentAt: status === 'sent' ? at : null, connected, payoutsEnabled: connected,
      };
    });
  const counts: StaffPayouts['counts'] = {};
  const totals: StaffPayouts['totals'] = {};
  for (const i of items) { counts[i.status] = (counts[i.status] ?? 0) + 1; totals[i.status] = (totals[i.status] ?? 0) + i.amountPence; }
  return { counts, totals, items };
}

// ---------- Questions ----------
function questionsFor(lid: string, m: Member | null): ListingQuestion[] {
  const seller = sellerKeyOf(lid);
  const mine = (q: StoredQuestion) => !!m && q.askerId === m.id;
  const isSeller = isSellerOf(lid, m) || (!!m && m.id === seller);
  return load().questions
    .filter((q) => q.listingId === lid && !q.hidden && (q.answer !== null || mine(q) || isSeller))
    .sort((a, b) => (b.answeredAt ?? b.createdAt).localeCompare(a.answeredAt ?? a.createdAt))
    .map((q) => ({ id: q.id, body: q.body, answer: q.answer, answeredAt: q.answeredAt, createdAt: q.createdAt, mine: mine(q), canAnswer: isSeller && q.answer === null }));
}

// ---------- Moderation ----------
function moderation(status: 'open' | 'actioned' | 'dismissed'): StaffModeration {
  const s = load();
  const groups = new Map<string, StaffModeration['items'][number]>();
  for (const r of s.reports.filter((x) => x.status === status)) {
    const k = r.listingId ? `l:${r.listingId}` : `m:${r.member}`;
    const g = groups.get(k) ?? {
      kind: r.listingId ? 'listing' as const : 'member' as const, listingId: r.listingId, title: r.listingId ? listing(r.listingId)?.title ?? 'Listing' : null,
      hidden: !!(r.listingId && s.hidden[r.listingId]), member: r.member ?? (r.listingId ? sellerNameOf(r.listingId) : null),
      suspended: !!s.suspended[(r.member ?? (r.listingId ? sellerNameOf(r.listingId) : '') ?? '').toLowerCase()], count: 0, latest: r.createdAt, reasons: [], notes: [],
    };
    g.count += 1;
    if (r.createdAt > g.latest) g.latest = r.createdAt;
    if (!g.reasons.includes(r.reason)) g.reasons.push(r.reason);
    if (r.note) g.notes.push(r.note);
    groups.set(k, g);
  }
  return {
    open: s.reports.filter((r) => r.status === 'open').length, suspended: Object.keys(s.suspended).length, hidden: Object.keys(s.hidden).length,
    items: [...groups.values()].sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest)),
  };
}

export const exampleSafety = {
  payouts(m: Member | null): PayoutSummary | null {
    return m ? payouts(m) : null;
  },
  connect(m: Member | null): Result<{ url: string | null }> {
    if (!m) return fail('Sign in first.');
    const s = load();
    s.accounts[m.id] = true;
    save(s);
    return { ok: true, value: { url: null } };
  },
  staffPayouts(m: Member | null): StaffPayouts | null {
    return isStaff(m) ? staffPayouts() : null;
  },
  staffPayoutAction(m: Member | null, pid: string, action: 'hold' | 'release' | 'retry', note: string): Result<StaffPayouts> {
    if (!isStaff(m)) return fail('Staff only.');
    if (note.trim().length < 3) return fail('Add a short note.');
    const s = load();
    const orderId = pid.replace(/^payout-/, '');
    if (action === 'hold') s.held[orderId] = note.trim();
    else delete s.held[orderId];
    save(s);
    return { ok: true, value: staffPayouts() };
  },

  questions(lid: string, m: Member | null): ListingQuestion[] {
    return questionsFor(lid, m);
  },
  ask(lid: string, body: string, m: Member | null): Result<ListingQuestion[]> {
    if (!m) return fail('Sign in to ask a question.');
    const s = load();
    const t = body.trim();
    const l = listing(lid);
    if (!l) return fail('This item isn’t for sale.');
    if (suspended(s, m)) return fail('Your account is suspended, so you can’t do that. Contact us if you think that’s wrong.');
    if (isSellerOf(lid, m)) return fail('You can’t ask about your own item.');
    if (t.length < 3 || t.length > 500) return fail('Write a question of up to 500 characters.');
    if (hasContactDetails(t)) return fail('Keep contact and payment details out of questions: buying through NuTuYu is what keeps you protected.');
    const mine = s.questions.filter((q) => q.askerId === m.id);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    if (mine.filter((q) => q.createdAt > hourAgo).length >= 5) return fail('That’s a lot of questions. Try again a little later.');
    if (mine.filter((q) => q.listingId === lid && !q.answer && !q.hidden).length >= 3) return fail('Wait for the seller to answer your questions first.');
    s.questions.push({ id: id(), listingId: lid, askerId: m.id, body: t, answer: null, answeredAt: null, hidden: false, createdAt: now() });
    save(s);
    exampleNotify(sellerKeyOf(lid), 'message', `Question about ${l.title}`, t.slice(0, 400), `/item/${lid}#questions`);
    return { ok: true, value: questionsFor(lid, m) };
  },
  answer(qid: string, answer: string, m: Member | null): Result<ListingQuestion[]> {
    const s = load();
    const q = s.questions.find((x) => x.id === qid);
    if (!m || !q || q.hidden || !isSellerOf(q.listingId, m)) return fail('Question not found.');
    if (q.answer) return fail('You’ve already answered this.');
    const t = answer.trim();
    if (!t || t.length > 1000) return fail('Write an answer of up to 1,000 characters.');
    if (hasContactDetails(t)) return fail('Keep contact details out of answers: buying through NuTuYu is what keeps you both protected.');
    q.answer = t;
    q.answeredAt = now();
    save(s);
    exampleNotify(q.askerId, 'message', `Answer about ${listing(q.listingId)?.title ?? 'an item'}`, t.slice(0, 400), `/item/${q.listingId}#questions`);
    return { ok: true, value: questionsFor(q.listingId, m) };
  },
  remove(qid: string, m: Member | null): Result<ListingQuestion[]> {
    const s = load();
    const q = s.questions.find((x) => x.id === qid);
    const allowed = !!m && !!q && (isSellerOf(q.listingId, m) || (q.askerId === m.id && !q.answer) || isStaff(m));
    if (!allowed) return fail('Question not found.');
    q!.hidden = true;
    save(s);
    return { ok: true, value: questionsFor(q!.listingId, m) };
  },
  unanswered(m: Member | null) {
    if (!m) return [];
    return load().questions
      .filter((q) => !q.answer && !q.hidden && isSellerOf(q.listingId, m))
      .map((q) => ({ id: q.id, listingId: q.listingId, title: listing(q.listingId)?.title ?? 'Item', body: q.body, createdAt: q.createdAt }));
  },

  report(target: { listingId: string } | { member: string }, reason: ReportReason, note: string, m: Member | null): Result {
    if (!m) return fail('Sign in to report something.');
    const s = load();
    const n = note.trim() || null;
    if (reason === 'other' && !n) return fail('Tell us what’s wrong.');
    if ('listingId' in target) {
      if (!listing(target.listingId)) return fail('Listing not found.');
      if (isSellerOf(target.listingId, m)) return fail('You can’t report your own listing.');
    } else if (target.member.toLowerCase() === m.username.toLowerCase()) return fail('You can’t report yourself.');
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    if (s.reports.filter((r) => r.reporterId === m.id && r.createdAt > dayAgo).length >= 10) return fail('You’ve sent a lot of reports today. Our team will look at them; try again tomorrow.');
    const listingId = 'listingId' in target ? target.listingId : null;
    const member = 'member' in target ? target.member.toLowerCase() : null;
    if (!s.reports.some((r) => r.reporterId === m.id && r.status === 'open' && r.listingId === listingId && r.member === member)) {
      s.reports.push({ id: id(), reporterId: m.id, listingId, member, reason, note: n, status: 'open', createdAt: now() });
      save(s);
    }
    return { ok: true, value: undefined };
  },
  moderation(m: Member | null, status: 'open' | 'actioned' | 'dismissed'): StaffModeration | null {
    return isStaff(m) ? moderation(status) : null;
  },
  moderate(m: Member | null, target: { listingId: string } | { member: string }, action: ModerationAction, note: string): Result<StaffModeration> {
    if (!isStaff(m)) return fail('Staff only.');
    const n = note.trim();
    if (n.length < 3) return fail('Add a short note: it’s shown to the member and kept with the decision.');
    const s = load();
    const lid = 'listingId' in target ? target.listingId : null;
    const member = ('member' in target ? target.member : sellerNameOf(lid!) ?? '').toLowerCase();
    const close = (pred: (r: StoredReport) => boolean, st: 'actioned' | 'dismissed') => { for (const r of s.reports) if (r.status === 'open' && pred(r)) r.status = st; };
    if (action === 'dismiss') close((r) => (lid ? r.listingId === lid : r.member === member), 'dismissed');
    else if (action === 'hide_listing' && lid) { s.hidden[lid] = { note: n, at: now() }; close((r) => r.listingId === lid, 'actioned'); }
    else if (action === 'restore_listing' && lid) { if (s.suspended[member]) return fail('Restore the member’s account first.'); delete s.hidden[lid]; }
    else if (action === 'suspend') { s.suspended[member] = { note: n, at: now() }; close((r) => r.member === member || (!!r.listingId && sellerNameOf(r.listingId) === member), 'actioned'); }
    else if (action === 'restore_member') delete s.suspended[member];
    else return fail('Unknown action.');
    save(s);
    return { ok: true, value: moderation('open') };
  },
  hiddenFor(m: Member | null) {
    if (!m) return [];
    const s = load();
    return Object.entries(s.hidden)
      .filter(([lid]) => isSellerOf(lid, m))
      .map(([lid, h]) => ({ id: lid, title: listing(lid)?.title ?? 'Listing', note: h.note, at: h.at }));
  },
  /** For the item page: hidden by staff (example items only show a banner). */
  hiddenNote(lid: string): string | null {
    return load().hidden[lid]?.note ?? null;
  },
};
