import type { Metadata } from 'next';
import { SellStart } from '@/components/sell/SellStart';

export const metadata: Metadata = { title: 'Sell an item', robots: { index: false } };

export default function SellPage() {
  return <SellStart />;
}
