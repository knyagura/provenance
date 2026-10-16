import type { Metadata } from 'next';
import { BasketCheckoutView } from '@/components/baskets/BasketCheckoutView';

export const metadata: Metadata = { title: 'Checkout: baskets', robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ group?: string; paid?: string }> }) {
  const { group, paid } = await searchParams;
  return <BasketCheckoutView groupId={group ?? null} paid={paid === '1'} />;
}
