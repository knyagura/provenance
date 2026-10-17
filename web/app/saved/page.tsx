import type { Metadata } from 'next';
import { SavedList } from '@/components/market/SavedList';

export const metadata: Metadata = { title: 'Saved', robots: { index: false } };

export default function Page() {
  return <SavedList />;
}
