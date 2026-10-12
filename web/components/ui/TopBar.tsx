import Link from 'next/link';
import { Suspense } from 'react';
import { SearchBox, SearchForm } from './SearchBox';
import { LogoMark } from './Logo';

/** Logo, search and (on desktop) Sell now, Inbox and Profile. */
export function TopBar() {
  return (
    <header className="pv-top">
      <div className="pv-top__inner">
        <Link href="/" className="pv-logo"><LogoMark className="pv-logo__mark" />Provenance</Link>
        <Suspense fallback={<SearchForm />}>
          <SearchBox />
        </Suspense>
        <nav className="pv-top__actions" aria-label="Account">
          <Link href="/inbox" className="pv-top__link">Inbox</Link>
          <Link href="/profile" className="pv-top__link">Profile</Link>
          <Link href="/sell" className="pv-btn pv-btn--primary">Sell now</Link>
        </nav>
      </div>
    </header>
  );
}
