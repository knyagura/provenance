import type { PopupPatch, SitePopup } from './types';

// Example mode's popups (migration 021's two to begin with), in localStorage so the example staff console can edit them.

const KEY = 'pv-example-popups';
export const SEED_POPUPS: SitePopup[] = [
  {
    id: 'popup-how', key: 'how-it-works', kind: 'info', title: 'Pre-loved, with proof',
    body: 'Every item carries its own record, so you know what you’re getting and the seller knows they’ll be paid.',
    steps: [
      { title: 'Listed with proof', note: 'The app asks for the right photos for each kind of item, so the listing is the reference.' },
      { title: 'Sealed and witnessed', note: 'From £75 a courier watches it packed and fits a numbered seal. Over £500 it’s authenticated too.' },
      { title: 'Opened on camera', note: 'You check the seal and open it on camera. The seller is paid when you confirm.' },
    ],
    ctaLabel: 'Start browsing', ctaHref: '/search', offerCode: null, audience: 'everyone', pages: '/', delaySeconds: 2, priority: 10,
    active: false, startsAt: null, endsAt: null, version: 1,
  },
  {
    id: 'popup-welcome', key: 'welcome-offer', kind: 'offer', title: 'New to NuTuYu? Join today',
    body: 'Create a free account to save items, make offers and shop for several people at once.', steps: [],
    ctaLabel: 'Create an account', ctaHref: '/signin?next=/', offerCode: null, audience: 'visitors', pages: '/,/search,/item/', delaySeconds: 20,
    priority: 5, active: false, startsAt: null, endsAt: null, version: 1,
  },
];

function load(): SitePopup[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SitePopup[];
  } catch {
    /* storage unavailable */
  }
  return SEED_POPUPS.map((p) => ({ ...p }));
}
function save(list: SitePopup[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full */
  }
}

export const isLive = (p: SitePopup, now = new Date().toISOString()) => p.active && (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt > now);

export const examplePopups = {
  live(): SitePopup[] {
    return load().filter((p) => isLive(p)).sort((a, b) => b.priority - a.priority);
  },
  all(): SitePopup[] {
    return load().sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  },
  save(id: string | null, patch: PopupPatch, showAgain: boolean): { ok: true; value: SitePopup[] } | { ok: false; message: string } {
    const list = load();
    if (patch.ctaHref && !/^\/(?!\/)/.test(patch.ctaHref)) return { ok: false, message: 'Buttons can only link to pages on NuTuYu (start with /).' };
    if (id) {
      const p = list.find((x) => x.id === id);
      if (!p) return { ok: false, message: 'Popup not found.' };
      Object.assign(p, patch, { version: p.version + (showAgain ? 1 : 0) });
    } else {
      if (!patch.key || !/^[a-z0-9-]{2,40}$/.test(patch.key) || list.some((x) => x.key === patch.key)) return { ok: false, message: 'Give it a short, unique name (letters, numbers and dashes).' };
      list.push({ ...SEED_POPUPS[0], steps: [], ctaLabel: null, ctaHref: null, ...patch, id: `popup-${patch.key}`, version: 1 } as SitePopup);
    }
    save(list);
    return { ok: true, value: this.all() };
  },
};
