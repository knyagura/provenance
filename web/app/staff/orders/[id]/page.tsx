import type { Metadata } from 'next';
import { StaffOrderView } from '@/components/staff/StaffOrderView';

export const metadata: Metadata = { title: 'Staff: order', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <StaffOrderView orderId={(await params).id} />;
}
