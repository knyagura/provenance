import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/SignInForm';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function SignInPage() {
  return (
    <section className="pv-section pv-narrow">
      <h1>Sign in</h1>
      <p className="pv-lead">Use the same email and password as the current NuTuYu (formerly Provenance) app.</p>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
      
    </section>
  );
}
