import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GiftCardsView } from '@/components/vouchers/GiftCards';

export const metadata: Metadata = { title: 'Gift cards', description: 'Give a NuTuYu gift card from £10 to £250, or add one to your balance.' };

export default function Page() {
  return <Suspense fallback={<p role="status">Loading…</p>}><GiftCardsView /></Suspense>;
}
