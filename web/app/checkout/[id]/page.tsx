import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { getListing } from '@/lib/domain/catalogue';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const l = await getListing((await params).id);
  if (!l) notFound();
  if (l.example && process.env.PV_DATA_SOURCE !== 'examples') {
    return (
      <section className="pv-section pv-narrow">
        <h1>Example listings can’t be bought</h1>
        <p className="pv-lead">This item only shows how the site will look. Real listings can be bought as soon as they’re published.</p>
        <p><Link href={`/item/${l.id}`}>Back to the item</Link></p>
      </section>
    );
  }
  const photo = l.media.find((m) => m.kind === 'photo');
  return <CheckoutView item={{ id: l.id, title: l.title, seller: l.seller.username, photoUrl: photo?.url ?? null }} />;
}
