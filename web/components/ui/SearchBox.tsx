'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { SearchIcon } from './icons';

/** The top bar's search. On the results page it keeps what was searched for. */
export function SearchBox() {
  const params = useSearchParams();
  const onSearch = usePathname() === '/search';
  return <SearchForm defaultValue={onSearch ? params.get('q') ?? '' : ''} />;
}

export function SearchForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form className="pv-search" role="search" action="/search">
      <SearchIcon />
      <label htmlFor="q" className="pv-visually-hidden">Search for items</label>
      <input key={defaultValue} id="q" name="q" type="search" placeholder="Search for items" autoComplete="off" defaultValue={defaultValue} />
    </form>
  );
}
