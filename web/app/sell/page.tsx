import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Sell now' };

export default function Page() {
  return <ComingSoon title="Sell now" step={3} what="Listing an item, with photo prompts for its category, arrives in step 3." />;
}
