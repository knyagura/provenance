import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PasskeyOffer } from '@/components/account/PasskeyOffer';

export const metadata: Metadata = { title: 'Add a passkey', robots: { index: false } };

export default function PasskeyPage() {
  return (
    <Suspense fallback={null}>
      <PasskeyOffer />
    </Suspense>
  );
}
