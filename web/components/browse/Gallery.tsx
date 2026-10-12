'use client';

import { useEffect, useRef, useState } from 'react';
import { shotLabel } from '@/lib/domain/present';
import type { Media } from '@/lib/domain/types';

/**
 * An item's photos: swipe (or use the thumbnails) to move between them. Each photo is labelled with the
 * shot it is (Front, Label, Close-up…), because the reference shots are part of the item's evidence.
 */
export function Gallery({ photos, title }: { photos: Media[]; title: string }) {
  const track = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);

  // Follow swipes: whichever slide is mostly in view is the current one.
  useEffect(() => {
    const el = track.current;
    if (!el || photos.length < 2) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.index));
      },
      { root: el, threshold: 0.6 },
    );
    el.querySelectorAll('li').forEach((li) => io.observe(li));
    return () => io.disconnect();
  }, [photos.length]);

  const go = (i: number) => {
    setCurrent(i);
    const li = track.current?.children[i] as HTMLElement | undefined;
    track.current?.scrollTo({ left: li ? li.offsetLeft - track.current.offsetLeft : 0, behavior: 'smooth' });
  };

  const label = (m: Media, i: number) => `${title}, photo ${i + 1} of ${photos.length}${m.shot ? ` (${shotLabel(m.shot)})` : ''}`;

  return (
    <div className="pv-gal">
      <ul ref={track} className="pv-gal__track" aria-label="Photos" tabIndex={0}>
        {photos.map((m, i) => (
          <li key={m.url} data-index={i}>
            <img src={m.url} alt={label(m, i)} loading={i ? 'lazy' : 'eager'} />
            {m.shot ? <span className="pv-gal__shot" aria-hidden="true">{shotLabel(m.shot)}</span> : null}
          </li>
        ))}
      </ul>
      {photos.length > 1 ? (
        <div className="pv-gal__thumbs" role="group" aria-label="Choose a photo">
          {photos.map((m, i) => (
            <button
              key={m.url}
              type="button"
              className="pv-gal__thumb"
              aria-current={i === current ? 'true' : undefined}
              aria-label={`Show photo ${i + 1}${m.shot ? `: ${shotLabel(m.shot)}` : ''}`}
              onClick={() => go(i)}
            >
              <img src={m.url} alt="" loading="lazy" />
            </button>
          ))}
          <span className="pv-gal__count pv-note" aria-live="polite">{current + 1} / {photos.length}</span>
        </div>
      ) : null}
    </div>
  );
}
