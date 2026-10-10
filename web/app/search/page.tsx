import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Search' };

export default function Page() {
  return <ComingSoon title="Search" step={2} what="Search and filters arrive in step 2, with item pages at their own addresses." />;
}
