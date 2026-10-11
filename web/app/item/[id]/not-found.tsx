import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="pv-section">
      <h1>This item isn’t available</h1>
      <p className="pv-lead">It may have been sold or taken down by the seller.</p>
      <p><Link href="/search">See what else is for sale</Link></p>
    </section>
  );
}
