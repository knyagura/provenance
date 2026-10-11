import type { Metadata } from 'next';
import { Inbox } from '@/components/custody/Inbox';

export const metadata: Metadata = { title: 'Inbox', robots: { index: false } };

export default function Page() {
  return <Inbox />;
}
