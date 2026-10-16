import type { Metadata } from 'next';
import { SealLabels } from '@/components/custody/SealLabels';

export const metadata: Metadata = { title: 'Seal labels', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SealLabels orderId={(await params).id} />;
}
