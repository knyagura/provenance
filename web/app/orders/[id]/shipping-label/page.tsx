import type { Metadata } from 'next';
import { ShippingLabelSheet } from '@/components/shipping/Shipping';

export const metadata: Metadata = { title: 'Shipping label', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ShippingLabelSheet orderId={(await params).id} />;
}
