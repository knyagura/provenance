import type { Metadata } from 'next';
import { SellerDashboardView } from '@/components/sell/SellerDashboard';

export const metadata: Metadata = { title: 'Your sales', robots: { index: false } };

export default function Page() {
  return <SellerDashboardView />;
}
