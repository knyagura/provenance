'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Shown when a page fails to load. Nothing the person was doing is lost by trying again. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="pv-section pv-narrow" role="alert">
      <h1>Something went wrong</h1>
      <p className="pv-lead">This page didn’t load properly. It’s usually a brief connection problem. Anything you’ve already recorded or paid for is safe.</p>
      <div className="pv-actions">
        <button type="button" className="pv-btn pv-btn--primary" onClick={reset}>Try again</button>
        <Link className="pv-btn pv-btn--secondary" href="/">Go to the home page</Link>
      </div>
      {error.digest ? <p className="pv-note">If it keeps happening, <Link href="/contact">tell us</Link> and quote reference {error.digest}.</p> : null}
    </section>
  );
}
