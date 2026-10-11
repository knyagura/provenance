import { DRAFT_TITLE, missingForPublish } from '@/lib/domain/evidence';
import type { Draft, DraftMedia, Member, Result, SellingBackend } from './types';

// A pretend backend that lives in this browser tab, for tests and demos without a database
// (PV_DATA_SOURCE=examples). Any email and a password of 8+ characters signs in. Nothing leaves the browser.

const KEY = 'pv-example-selling';

interface Store {
  member: Member | null;
  drafts: Draft[];
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
    s.member = { id: 'example-member', email, username: email.split('@')[0] };
    save(s);
    listeners.forEach((l) => l(s.member));
    return ok(s.member);
  },
  async signUp(email, password) {
    if (password.length < 8) return { ok: false, message: 'Choose a password of at least 8 characters.' };
    return ok({ needsConfirmation: !email });
  },
  async signOut() {
    const s = load();
    s.member = null;
    save(s);
    listeners.forEach((l) => l(null));
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
  async deleteDraft(id) {
    const s = load();
    s.drafts = s.drafts.filter((d) => d.id !== id || d.published);
    save(s);
    return ok(undefined);
  },
};
