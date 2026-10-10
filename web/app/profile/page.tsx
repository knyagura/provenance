import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Profile' };

export default function Page() {
  return <ComingSoon title="Profile" step={4} what="Signing in, your profile and passkeys arrive in step 4." />;
}
