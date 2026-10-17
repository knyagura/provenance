'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import type { BundleOffer } from '@/lib/selling';

/** On an item page: the seller's bundle discount, if they offer one. */
export function BundleNote({ seller }: { seller: string }) {
  const { backend } = useMember();
  const [offer, setOffer] = useState<BundleOffer | null>(null);
  useEffect(() => {
    backend.bundleOffer(seller).then(setOffer).catch(() => setOffer(null));
  }, [backend, seller]);
  if (!offer) return null;
  return (
    <p className="pv-bundle-note">
      <strong>Bundle: {offer.pct}% off {offer.minItems} or more</strong> from {seller}, taken off at basket checkout.{' '}
      <Link href={`/member/${encodeURIComponent(seller)}`}>See their items</Link>
    </p>
  );
}
