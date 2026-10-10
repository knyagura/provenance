import Link from 'next/link';
import { ListingCard } from '@/components/ui';
import { exampleListings } from '@/lib/examples';

export default function HomePage() {
  return (
    <>
      <section className="pv-section">
        <h1>Pre-loved, with proof.</h1>
        <p className="pv-lead">
          This is the new Provenance site, being built in stages. Browsing, selling and buying arrive over the next steps;
          for now you can see the look and feel. The working app is still at{' '}
          <a href="https://knyagura.github.io/provenance/">knyagura.github.io/provenance</a>.
        </p>
        <p>
          <Link href="/styleguide">Open the style guide</Link>
        </p>
      </section>
      <section className="pv-section" aria-labelledby="examples">
        <h2 id="examples">Example listings</h2>
        <p className="pv-note">Examples only. Real listings arrive in step 2.</p>
        <div className="pv-grid">
          {exampleListings.map((l) => (
            <ListingCard key={l.title} {...l} />
          ))}
        </div>
      </section>
    </>
  );
}
