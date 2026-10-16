'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type DragEvent } from 'react';
import { BASKET_TONES, budgetState, type Basket } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';
import { DRAG_TYPE, useBaskets } from './BasketsState';

const SHOPPING = /^\/($|search|item\/|member\/|saved)/;

/**
 * The baskets beside the shopping area: drop an item on a person to put it in their basket.
 * Wide screens get a rail on the right; narrower ones a row of baskets above the navigation bar.
 * Only shown once a member has switched multi-basket shopping on.
 */
export function BasketRail() {
  const { enabled, baskets, focus, setFocus, onlyFits, setOnlyFits, notice, put } = useBaskets();
  const pathname = usePathname() ?? '/';
  const [over, setOver] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const show = enabled && SHOPPING.test(pathname);

  useEffect(() => {
    document.body.classList.toggle('pv-has-rail', show);
    return () => document.body.classList.remove('pv-has-rail');
  }, [show]);
  useEffect(() => {
    if (!notice) return;
    setToast(notice);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!show) return null;

  const drop = (b: Basket) => async (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as { listingId: string; title: string; size: string | null; category: string | null };
      await put(d.listingId, b.general ? null : b.id, d);
    } catch {
      /* not one of our cards */
    }
  };
  const allow = (b: Basket) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(b.id);
  };

  return (
    <aside className="pv-rail" aria-label="Your baskets">
      <div className="pv-rail__head">
        <strong>Baskets</strong>
        <Link href="/basket" className="pv-rail__open">Open</Link>
      </div>
      <p className="pv-note pv-rail__hint">Drag an item onto a person, or use the bag on each item.</p>
      <ul className="pv-rail__list">
        {baskets.map((b) => {
          const budget = budgetState(b);
          return (
            <li key={b.id}>
              <div
                className={`pv-drop pv-drop--${BASKET_TONES[b.position]}${over === b.id ? ' pv-drop--over' : ''}${focus?.id === b.id ? ' pv-drop--focus' : ''}`}
                onDragOver={allow(b)} onDragEnter={allow(b)} onDragLeave={() => setOver((o) => (o === b.id ? null : o))} onDrop={drop(b)}
                data-basket={b.name}
              >
                <span className="pv-drop__name">{b.name}</span>
                <span className="pv-drop__count">{b.items.length} {b.items.length === 1 ? 'item' : 'items'}</span>
                {budget ? (
                  <span className="pv-budget" role="meter" aria-label={`${b.name}’s budget`} aria-valuemin={0} aria-valuemax={budget.budget} aria-valuenow={budget.spent}
                    aria-valuetext={`${formatPence(budget.spent)} of ${formatPence(budget.budget)}`}>
                    <span className={budget.over ? 'pv-budget__bar pv-budget__bar--over' : 'pv-budget__bar'} style={{ width: `${budget.share * 100}%` }} />
                  </span>
                ) : null}
                {!b.general ? (
                  <button type="button" className="pv-drop__focus" aria-pressed={focus?.id === b.id} onClick={() => setFocus(focus?.id === b.id ? null : b.id)}>
                    {focus?.id === b.id ? 'Shopping for them' : 'Shop for them'}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {focus ? (
        <label className="pv-rail__fits">
          <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />
          Only show {focus.name}’s sizes
        </label>
      ) : null}
      {toast ? <p className="pv-rail__toast" aria-hidden="true">{toast}</p> : null}
    </aside>
  );
}
