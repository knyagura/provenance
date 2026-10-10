import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Inbox' };

export default function Page() {
  return <ComingSoon title="Inbox" step={6} what="Your orders and the custody steps arrive in step 6." />;
}
