'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { sizeCheck, visibleBaskets, type Basket, type Baskets } from '@/lib/domain/baskets';
import type { Result } from '@/lib/selling';

type View = 'single' | 'multi';

interface BasketsState {
  data: Baskets | null;
  /** The baskets shown: General only while multi-basket is off. */
  baskets: Basket[];
  enabled: boolean;
  count: number;
  /** Where each listing is, by id. */
  placement: Map<string, Basket>;
  view: View;
  setView: (v: View) => void;
  /** The person being shopped for: filters and size warnings follow their profile. */
  focus: Basket | null;
  setFocus: (id: string | null) => void;
  onlyFits: boolean;
  setOnlyFits: (on: boolean) => void;
  /** The last thing that happened, for the polite announcement. */
  notice: string | null;
  put: (listingId: string, basketId: string | null, item?: { size: string | null; category: string | null; title: string }) => Promise<boolean>;
  run: (fn: () => Promise<Result<Baskets>>, okNote?: string) => Promise<Result<Baskets>>;
  reload: () => void;
}

const Ctx = createContext<BasketsState | null>(null);
const VIEW_KEY = 'pv-basket-view';
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'single' ? 'single' : 'multi';
  } catch {
    return 'multi';
  }
};

/** Everyone's baskets, shared by the cards, the basket rail and the basket pages. */
export function BasketsProvider({ children }: { children: React.ReactNode }) {
  const { member, backend } = useMember();
  const [data, setData] = useState<Baskets | null>(null);
  const [view, setViewState] = useState<View>('multi');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [onlyFits, setOnlyFits] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<{ label: string; run: () => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    setToast(notice);
    const t = setTimeout(() => { setToast(null); setAction(null); }, action ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [notice, action]);

  useEffect(() => setViewState(readView()), []);
  const reload = useCallback(() => {
    if (!member) return setData(null);
    backend.myBaskets().then(setData).catch(() => setData(null));
  }, [member, backend]);
  useEffect(() => {
    reload();
  }, [reload]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
  }, []);

  const run = useCallback(async (fn: () => Promise<Result<Baskets>>, okNote?: string) => {
    const r = await fn();
    if (r.ok) {
      setData(r.value);
      if (okNote) setNotice(okNote);
    } else setNotice(r.message);
    return r;
  }, []);

  const put = useCallback(
    async (listingId: string, basketId: string | null, item?: { size: string | null; category: string | null; title: string }) => {
      setAction(null);
      const r = await backend.basketPut(listingId, basketId);
      if (!r.ok) {
        setNotice(r.message);
        return false;
      }
      let all = r.value;
      const b = all.baskets.find((x) => (basketId ? x.id === basketId : x.general))!;
      const placed = b.items.find((i) => i.listingId === listingId);
      const head = `${item?.title ?? 'Item'} added to ${b.name}${placed?.wrap ? ', to be wrapped' : ''}.`;
      const check = item ? sizeCheck(b, item) : { note: null, learn: null, offer: null };
      // The basket had no size for this kind of item yet: the item's size becomes the person's size.
      if (check.learn) {
        const saved = await backend.saveBasket(b.id, { sizes: { ...b.sizes, [check.learn.kind]: check.learn.size } });
        if (saved.ok) all = saved.value;
      }
      setData(all);
      if (check.offer) {
        const { kind, size } = check.offer;
        setAction({
          label: `Make ${size} ${b.name}’s size`,
          run: async () => {
            const cur = (await backend.myBaskets()).baskets.find((x) => x.id === b.id);
            const saved = await backend.saveBasket(b.id, { sizes: { ...(cur?.sizes ?? b.sizes), [kind]: size } });
            setAction(null);
            if (saved.ok) {
              setData(saved.value);
              setNotice(`${b.name}’s size is now ${size}.`);
            } else setNotice(saved.message);
          },
        });
      }
      setNotice(check.note ? `${head} ${check.note}` : head);
      return true;
    },
    [backend],
  );

  const value = useMemo<BasketsState>(() => {
    const baskets = data ? visibleBaskets(data) : [];
    const placement = new Map<string, Basket>();
    for (const b of baskets) for (const i of b.items) placement.set(i.listingId, b);
    const focus = (data?.enabled && baskets.find((b) => b.id === focusId && !b.general)) || null;
    return {
      data, baskets, enabled: !!data?.enabled, count: placement.size, placement, view, setView, focus, setFocus: setFocusId,
      onlyFits: onlyFits && !!focus, setOnlyFits, notice, put, run, reload,
    };
  }, [data, view, setView, focusId, onlyFits, notice, put, run, reload]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <p className="pv-visually-hidden" role="status" aria-live="polite">{notice ?? ''}</p>
      {toast ? (
        <div className="pv-toast" aria-hidden={action ? undefined : true}>
          <span>{toast}</span>
          {action ? <button type="button" className="pv-toast__action" onClick={action.run}>{action.label}</button> : null}
          {action ? <button type="button" className="pv-toast__close" aria-label="Dismiss" onClick={() => { setToast(null); setAction(null); }}>×</button> : null}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

const FALLBACK: BasketsState = {
  data: null, baskets: [], enabled: false, count: 0, placement: new Map(), view: 'multi', setView: () => {}, focus: null, setFocus: () => {},
  onlyFits: false, setOnlyFits: () => {}, notice: null, put: async () => false, run: async () => ({ ok: false, message: '' }), reload: () => {},
};

export function useBaskets(): BasketsState {
  return useContext(Ctx) ?? FALLBACK;
}

export const DRAG_TYPE = 'application/x-nutuyu-listing';
