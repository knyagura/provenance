import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCallback } from '@/components/auth/AuthCallback';

export const metadata: Metadata = { title: 'Signing you in', robots: { index: false } };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Signing you in…</p>}>
      <AuthCallback />
    </Suspense>
  );
}
