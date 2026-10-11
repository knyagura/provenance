'use client';

import Link from 'next/link';
import { categoryName } from '@/lib/domain/present';
import { fallbackCategories } from '@/lib/domain/examples';
import type { Draft } from '@/lib/selling';
import { formatPence } from '@/lib/format';

/** A seller's drafts and live listings, newest first. */
export function MyListings({ drafts, heading }: { drafts: Draft[]; heading: string }) {
  if (!drafts.length) return null;
  return (
    <section className="pv-section" aria-labelledby="mine">
      <h2 id="mine">{heading}</h2>
      <ul className="pv-rows">
        {drafts.map((d) => {
          const thumb = d.media.find((m) => m.kind === 'photo');
          return (
            <li key={d.id} className="pv-row">
              <span className="pv-row__thumb" aria-hidden="true">{thumb ? <img src={thumb.url} alt="" /> : null}</span>
              <span className="pv-row__text">
                <strong>{d.title || 'Untitled draft'}</strong>
                <span className="pv-note">
                  {[categoryName(fallbackCategories, d.category), d.pricePence ? formatPence(d.pricePence) : null, d.published ? 'Live' : 'Draft'].filter(Boolean).join(' · ')}
                </span>
              </span>
              {d.published && !d.id.startsWith('example-') ? (
                <Link className="pv-btn pv-btn--secondary" href={`/item/${d.id}`}>View</Link>
              ) : d.published ? (
                <span className="pv-badge pv-badge--verified">Live</span>
              ) : (
                <Link className="pv-btn pv-btn--secondary" href={`/sell/${d.id}`}>Continue</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
