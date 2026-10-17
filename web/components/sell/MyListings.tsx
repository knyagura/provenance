'use client';

import { photo, SIZES, THUMB_WIDTHS } from '@/lib/images';
import Link from 'next/link';
import { categoryName } from '@/lib/domain/present';
import { fallbackCategories } from '@/lib/domain/examples';
import type { Draft } from '@/lib/selling';
import { formatPence } from '@/lib/format';

function stateLabel(d: Draft): string {
  if (d.status === 'sold') return 'Sold';
  if (d.status === 'reserved') return 'Being bought';
  if (d.published) return 'Live';
  return d.revision > 0 ? 'Paused while you edit' : 'Draft';
}

const verb = (d: Draft) => (d.published ? 'Edit' : d.revision > 0 ? 'Finish editing' : 'Continue');

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
              <span className="pv-row__thumb" aria-hidden="true">{thumb ? <img {...photo(thumb.url, SIZES.thumb, THUMB_WIDTHS)} alt="" loading="lazy" decoding="async" /> : null}</span>
              <span className="pv-row__text">
                <strong>{d.title || 'Untitled draft'}</strong>
                <span className="pv-note">
                  {[categoryName(fallbackCategories, d.category), d.pricePence ? formatPence(d.pricePence) : null, stateLabel(d)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {d.status === 'active' ? (
                <Link className="pv-btn pv-btn--secondary" href={`/sell/${d.id}`} aria-label={`${verb(d)}: ${d.title || 'draft'}`}>
                  {verb(d)}
                </Link>
              ) : (
                <Link className="pv-btn pv-btn--secondary" href={`/sell/${d.id}`}>Details</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
