import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderView } from '@/components/checkout/OrderView';

export const metadata: Metadata = { title: 'Your order', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <OrderView id={id} />
    </Suspense>
  );
}
