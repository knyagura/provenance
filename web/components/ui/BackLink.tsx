'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** Small in-page back control with a safe fallback for direct visits. */
export function BackLink({ fallback = '/profile', label = 'Back' }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <div className="pv-back-wrap">
      <button type="button" className="pv-back" onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }} aria-label={label}>
        <span aria-hidden="true">←</span> {label}
      </button>
      <Link href={fallback} className="pv-back__fallback">Go to {fallback === '/sell' ? 'selling' : fallback === '/profile' ? 'your profile' : 'the previous section'}</Link>
    </div>
  );
}
