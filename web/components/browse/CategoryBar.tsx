import Link from 'next/link';
import type { Category } from '@/lib/domain/types';

/** Horizontally scrolling category links. The current one is marked for screen readers too. */
export function CategoryBar({ categories, current }: { categories: Category[]; current?: string }) {
  return (
    <nav className="pv-cats" aria-label="Categories">
      <ul>
        <li>
          <Link href="/search" prefetch={false} className="pv-chip" aria-current={current === undefined ? 'page' : undefined}>All</Link>
        </li>
        {categories.filter((c) => !c.parentSlug).map((c) => (
          <li key={c.slug}>
            <Link href={`/search?category=${c.slug}`} prefetch={false} className="pv-chip" aria-current={current === c.slug ? 'page' : undefined}>
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
