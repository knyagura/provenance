'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { DRAG_TYPE, useBaskets } from '@/components/baskets/BasketsState';
import type { Variant } from '@/lib/domain/types';
import { formatPence } from '@/lib/format';

export function leftText(v: Pick<Variant, 'unitsLeft' | 'stock'>): string {
  if (v.unitsLeft <= 0) return 'Sold out';
  if (v.stock > 1 && v.unitsLeft <= 3) return `${v.unitsLeft} left`;
  return v.stock > 1 ? 'In stock' : 'Available';
}

/** Group variants by colour, keeping the order they came in. */
export function byColour(variants: Variant[]): [string, Variant[]][] {
  const out = new Map<string, Variant[]>();
  for (const v of variants) {
    const k = v.colour ?? 'One colour';
    out.set(k, [...(out.get(k) ?? []), v]);
  }
  return [...out.entries()];
}

/**
 * The colours and sizes of an item from a business seller. Each one is its own listing: pick it to see it,
 * or (when shopping for several people) drag it straight onto someone's basket.
 */
export function VariantPicker({ initial, title, category }: { initial: Variant[]; title: string; category: string | null }) {
  const { backend } = useMember();
  const { enabled } = useBaskets();
  const [variants, setVariants] = useState(initial);
  const current = variants.find((v) => v.current);

  // What's left changes as people buy; the page itself is cached for a minute.
  useEffect(() => {
    backend.listingVariants(initial.find((v) => v.current)?.id ?? initial[0].id).then((v) => v.length && setVariants(v)).catch(() => {});
  }, [backend, initial]);

  const groups = byColour(variants);
  const several = variants.length > 1;
  return (
    <section className="pv-variants" aria-labelledby="variants-h">
      <h2 id="variants-h" className="pv-h3">{several ? 'Colours and sizes' : 'Stock'}</h2>
      {current ? (
        <p className="pv-note" role="status">
          {[current.colour, current.size ? `size ${current.size}` : null].filter(Boolean).join(', ')}{current.colour || current.size ? ': ' : ''}
          <strong>{leftText(current)}</strong>
        </p>
      ) : null}
      {several ? groups.map(([colour, list]) => (
        <div key={colour} className="pv-variants__group">
          <span className="pv-variants__colour">{colour}</span>
          <ul className="pv-variants__list">
            {list.map((v) => {
              const label = `${v.colour ?? ''}${v.colour && v.size ? ', ' : ''}${v.size ? `size ${v.size}` : ''}`;
              const gone = v.unitsLeft <= 0;
              return (
                <li key={v.id}>
                  <Link
                    href={`/item/${v.id}`}
                    className={`pv-variant${v.current ? ' pv-variant--current' : ''}${gone ? ' pv-variant--gone' : ''}`}
                    aria-current={v.current ? 'page' : undefined}
                    aria-label={`${label}: ${leftText(v)}${v.pricePence !== current?.pricePence ? `, ${formatPence(v.pricePence)}` : ''}`}
                    draggable={enabled && !gone ? true : undefined}
                    onDragStart={enabled && !gone ? (e) => {
                      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ listingId: v.id, title: `${title} (${label})`, size: v.size, category }));
                      e.dataTransfer.effectAllowed = 'copyMove';
                    } : undefined}
                  >
                    <span>{v.size ?? colour}</span>
                    <span className="pv-variant__left">{gone ? 'Sold out' : v.unitsLeft <= 3 && v.stock > 1 ? `${v.unitsLeft} left` : ''}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )) : null}
      {several && enabled ? <p className="pv-note">Drag a size onto someone’s basket to add that one.</p> : null}
    </section>
  );
}
