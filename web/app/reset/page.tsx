import type { Metadata } from 'next';
import { ResetPassword } from '@/components/account/ResetPassword';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function ResetPage() {
  return <ResetPassword />;
}
