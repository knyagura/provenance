import type { Metadata } from 'next';
import { ProfileView } from '@/components/auth/ProfileView';

export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

export default function ProfilePage() {
  return <ProfileView />;
}
