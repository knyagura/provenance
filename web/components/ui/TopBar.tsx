import Link from 'next/link';
import { SearchIcon } from './icons';

/** Logo, search and (on desktop) Sell now, Inbox and Profile. */
export function TopBar() {
  return (
    <header className="pv-top">
      <div className="pv-top__inner">
        <Link href="/" className="pv-logo">Provenance</Link>
        <form className="pv-search" role="search" action="/search">
          <SearchIcon />
          <label htmlFor="q" className="pv-visually-hidden">Search for items</label>
          <input id="q" name="q" type="search" placeholder="Search for items" autoComplete="off" />
        </form>
        <nav className="pv-top__actions" aria-label="Account">
          <Link href="/inbox" className="pv-top__link">Inbox</Link>
          <Link href="/profile" className="pv-top__link">Profile</Link>
          <Link href="/sell" className="pv-btn pv-btn--primary">Sell now</Link>
        </nav>
      </div>
    </header>
  );
}
