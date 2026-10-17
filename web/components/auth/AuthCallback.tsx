'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useMember } from './MemberProvider';
import { safeNext } from './SignInForm';

/** Where Google and Facebook send people back. Waits for the session, then carries on to where they were going. */
export function AuthCallback() {
  const { member, loading } = useMember();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const err = params.get('error_description') ?? hash.get('error_description');
    if (err) {
      const msg = /cancel|denied/i.test(err) ? 'Sign-in was cancelled.' : 'We couldn’t sign you in with that account. Try again, or use your email.';
      router.replace(`/signin?next=${encodeURIComponent(next)}&error=${encodeURIComponent(msg)}`);
      return;
    }
    if (member) router.replace(next);
    else if (!loading) {
      const t = setTimeout(() => router.replace(`/signin?next=${encodeURIComponent(next)}&error=${encodeURIComponent('That sign-in didn’t finish. Try again.')}`), 8000);
      return () => clearTimeout(t);
    }
  }, [member, loading, next, params, router]);

  return <p role="status">Signing you in…</p>;
}
