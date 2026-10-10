import Link from 'next/link';

/** Placeholder for a page that a later build step adds. */
export function ComingSoon({ title, step, what }: { title: string; step: number; what: string }) {
  return (
    <section className="pv-section">
      <p className="pv-eyebrow">Build step {step}</p>
      <h1>{title}</h1>
      <p className="pv-lead">{what}</p>
      <p>
        <Link href="/">Back to home</Link>
      </p>
    </section>
  );
}
