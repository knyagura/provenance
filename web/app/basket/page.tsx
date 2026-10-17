import type { Metadata } from 'next';
import { BasketPage } from '@/components/baskets/BasketPage';

export const metadata: Metadata = { title: 'Basket', robots: { index: false } };

export default function Page() {
  return <BasketPage />;
}
