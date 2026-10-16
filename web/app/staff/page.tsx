import type { Metadata } from 'next';
import { StaffConsole } from '@/components/staff/StaffConsole';

export const metadata: Metadata = { title: 'Staff console', robots: { index: false } };

export default function Page() {
  return <StaffConsole />;
}
