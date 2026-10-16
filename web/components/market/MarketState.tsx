'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import type { InboxCounts } from '@/lib/selling';

interface MarketState {
  /** Listings the member has saved. */
  saved: Set<string>;
  toggleSaved: (listingId: string) => Promise<void>;
  counts: InboxCounts;
  /** Everything waiting for the member: custody turns, unread messages and offers to answer. */
  attention: number;
  refreshCounts: () => void;
}

const Ctx = createContext<MarketState | null>(null);
const ZERO: InboxCounts = { turns: 0, unread: 0, offers: 0 };
const REFRESH_MS = 30_000;

/** Favourites and the Inbox count, shared by every card and both navigation bars. */
export function MarketStateProvider({ children }: { children: React.ReactNode }) {
  const { member, backend } = useMember();
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<InboxCounts>(ZERO);

  useEffect(() => {
    if (!member) {
      setSaved(new Set());
      return;
    }
    backend.favourites().then((ids) => setSaved(new Set(ids))).catch(() => {});
  }, [member, backend]);

  const refreshCounts = useCallback(() => {
    if (!member) return setCounts(ZERO);
    backend.inboxCounts().then(setCounts).catch(() => {});
  }, [member, backend]);

  useEffect(() => {
    refreshCounts();
    if (!member) return;
    const t = setInterval(refreshCounts, REFRESH_MS);
    const onShow = () => document.visibilityState === 'visible' && refreshCounts();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [member, refreshCounts, pathname]);

  const toggleSaved = useCallback(
    async (listingId: string) => {
      if (!member) {
        router.push(`/signin?next=${encodeURIComponent(pathname ?? '/')}`);
        return;
      }
      const on = !saved.has(listingId);
      setSaved((cur) => {
        const next = new Set(cur);
        if (on) next.add(listingId);
        else next.delete(listingId);
        return next;
      });
      const r = await backend.setFavourite(listingId, on);
      if (!r.ok) {
        setSaved((cur) => {
          const next = new Set(cur);
          if (on) next.delete(listingId);
          else next.add(listingId);
          return next;
        });
      }
    },
    [member, saved, backend, router, pathname],
  );

  const value = useMemo(
    () => ({ saved, toggleSaved, counts, attention: counts.turns + counts.unread + counts.offers, refreshCounts }),
    [saved, toggleSaved, counts, refreshCounts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: MarketState = { saved: new Set(), toggleSaved: async () => {}, counts: ZERO, attention: 0, refreshCounts: () => {} };

/** Works outside the provider too (the style guide), with nothing saved. */
export function useMarketState(): MarketState {
  return useContext(Ctx) ?? FALLBACK;
}
