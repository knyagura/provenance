import type { Metadata } from 'next';
import { SharedBasketView } from '@/components/baskets/SharedBasketView';

export const metadata: Metadata = { title: 'Shared basket', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <SharedBasketView token={(await params).token} />;
}
