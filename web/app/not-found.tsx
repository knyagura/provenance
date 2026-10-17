import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="pv-section pv-narrow">
      <h1>We can’t find that page</h1>
      <p className="pv-lead">The item may have been sold and removed, or the link may be wrong.</p>
      <div className="pv-actions">
        <Link className="pv-btn pv-btn--primary" href="/search">Browse items</Link>
        <Link className="pv-btn pv-btn--secondary" href="/">Home</Link>
      </div>
    </section>
  );
}
