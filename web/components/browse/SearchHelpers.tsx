'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useBaskets } from '@/components/baskets/BasketsState';
import { SIZE_KINDS } from '@/lib/domain/baskets';

/** "Use my location": the browser's location, rounded to about 1 km, for collection in person. */
export function NearMeButton({ miles }: { miles: number }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/search';
  const params = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);
  // Decided after loading: the server can't know whether this browser offers location.
  const [can, setCan] = useState(false);
  useEffect(() => setCan('geolocation' in navigator), []);
  if (!can) return null;
  const go = () => {
    setMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const sp = new URLSearchParams(params?.toString() ?? '');
        sp.delete('near');
        sp.delete('cursor');
        sp.set('lat', pos.coords.latitude.toFixed(2));
        sp.set('lng', pos.coords.longitude.toFixed(2));
        sp.set('miles', String(miles));
        setMsg(null);
        router.push(`${pathname}?${sp.toString()}`);
      },
      () => setMsg('We couldn’t get your location. Type your postcode instead.'),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };
  return (
    <span className="pv-near__me">
      <button type="button" className="pv-btn pv-btn--quiet" onClick={go}>Use my location</button>
      {msg ? <span className="pv-note" role="status">{msg}</span> : null}
    </span>
  );
}

/** Sizes from the member's baskets (when shopping for several people), one tap to filter by them. */
export function BasketSizes({ current }: { current: string | null }) {
  const { enabled, baskets } = useBaskets();
  const params = useSearchParams();
  const pathname = usePathname() ?? '/search';
  if (!enabled) return null;
  const chips = baskets.flatMap((b) => SIZE_KINDS.filter((k) => b.sizes[k.key]).map((k) => ({ who: b.name, kind: k.label.toLowerCase(), size: b.sizes[k.key]! })));
  if (!chips.length) return null;
  const href = (size: string) => {
    const sp = new URLSearchParams(params?.toString() ?? '');
    sp.delete('cursor');
    if (current?.toLowerCase() === size.toLowerCase()) sp.delete('size');
    else sp.set('size', size);
    return `${pathname}?${sp.toString()}`;
  };
  return (
    <div className="pv-basket-sizes">
      <span className="pv-note">From your baskets:</span>
      <span className="pv-chips">
        {chips.map((c) => (
          <Link key={`${c.who}-${c.kind}`} href={href(c.size)} className="pv-chip" aria-current={current?.toLowerCase() === c.size.toLowerCase() ? 'true' : undefined}>
            {c.who}’s {c.kind}: {c.size}
          </Link>
        ))}
      </span>
    </div>
  );
}
