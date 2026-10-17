import type { Metadata } from 'next';
import Link from 'next/link';
import { TrustTracker } from '@/components/market/Trust';

export const metadata: Metadata = {
  title: 'Trust tracker',
  description: 'Protected handovers completed on NuTuYu, how many were disputed, and how long they take.',
  alternates: { canonical: '/trust' },
};

export default function TrustPage() {
  return (
    <section className="pv-section pv-narrow pv-trustpage" aria-labelledby="trust-h">
      <h1 id="trust-h">Trust tracker</h1>
      <p className="pv-lead">Every order on NuTuYu has a recorded chain of custody. These are the ones completed so far. Each item links to its passport, which shows the record without anyone’s personal details.</p>
      <TrustTracker example={process.env.PV_DATA_SOURCE === 'examples'} />
      <section aria-labelledby="badges-h">
        <h2 id="badges-h" className="pv-h3">Seller badges</h2>
        <ul className="pv-list">
          <li><strong>Identity checked:</strong> NuTuYu has checked the seller’s identity.</li>
          <li><strong>Trusted seller:</strong> identity checked, at least 5 protected handovers completed, and no more than 1 in 20 sales disputed.</li>
          <li>Each seller’s page and items show how many handovers they’ve completed and how often buyers reported a problem, once there are 5 to count.</li>
        </ul>
        <p><Link href="/search">Browse items</Link></p>
      </section>
    </section>
  );
}
