import type { Metadata } from 'next';
import { NotificationsPage } from '@/components/market/Notifications';

export const metadata: Metadata = { title: 'Updates', robots: { index: false } };

export default function Page() {
  return <NotificationsPage />;
}
