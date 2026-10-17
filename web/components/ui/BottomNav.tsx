'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { InboxBadge } from '@/components/market/InboxBadge';
import { HomeIcon, InboxIcon, ProfileIcon, SearchIcon, SellIcon } from './icons';

const tabs = [
  { href: '/', label: 'Home', Icon: HomeIcon },
  { href: '/search', label: 'Search', Icon: SearchIcon },
  { href: '/sell', label: 'Sell', Icon: SellIcon, sell: true },
  { href: '/inbox', label: 'Inbox', Icon: InboxIcon },
  { href: '/profile', label: 'Profile', Icon: ProfileIcon },
];

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

/** Phone and tablet navigation on charcoal-olive. Hidden from 1024px, where the top bar takes over. */
export function BottomNav({ current, inline }: { current?: string; /** Render in the page flow (style guide) instead of fixed to the screen. */ inline?: boolean }) {
  const pathname = usePathname() ?? '/';
  const here = current ?? pathname;
  return (
    <nav className={inline ? 'pv-nav pv-nav--static' : 'pv-nav'} aria-label={inline ? 'Example bottom bar' : 'Main'}>
      {tabs.map(({ href, label, Icon, sell }) => (
        <Link
          key={href}
          href={href}
          className={`pv-nav__item${sell ? ' pv-nav__sell' : ''}`}
          aria-current={isActive(here, href) ? 'page' : undefined}
        >
          <span className="pv-nav__icon"><Icon />{href === '/inbox' && !inline ? <InboxBadge /> : null}</span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
