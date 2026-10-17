import type { Metadata } from 'next';
import { GiftPage } from '@/components/baskets/GiftPage';

export const metadata: Metadata = { title: 'Your gift', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <GiftPage token={(await params).token} />;
}
