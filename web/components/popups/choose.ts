import type { SitePopup } from '@/lib/selling/types';

export const POPUP_EVENT = 'pv-open-popup';
export const POPUPS_OFF = 'pv-popups-off';
export const dismissKey = (p: Pick<SitePopup, 'key' | 'version'>) => `pv-popup-seen:${p.key}:${p.version}`;

/** Does this popup belong on this page? "/" is the home page only; other entries match as prefixes; "*" matches all. */
export function onPage(pages: string, pathname: string): boolean {
  return pages.split(',').map((s) => s.trim()).filter(Boolean).some((p) => p === '*' || (p === '/' ? pathname === '/' : pathname.startsWith(p)));
}

/** The popup to show automatically, if any: the highest priority one for this person and page that they haven't closed. */
export function choosePopup(popups: SitePopup[], ctx: { pathname: string; signedIn: boolean; seen: (key: string) => boolean }): SitePopup | null {
  return [...popups]
    .sort((a, b) => b.priority - a.priority)
    .find((p) => onPage(p.pages, ctx.pathname)
      && (p.audience === 'everyone' || (p.audience === 'members') === ctx.signedIn)
      && !ctx.seen(dismissKey(p))) ?? null;
}
