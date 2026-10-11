import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { getListing } from '@/lib/domain/catalogue';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };
// Always the listing as it is now: checkout compares this revision with the one in the database.
export const dynamic = 'force-dynamic';

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
  const version = {
    revision: l.revision, title: l.title, description: l.description, brand: l.brand, size: l.size, colour: l.colour, condition: l.condition,
    pricePence: l.pricePence, shippingPence: l.shippingPence, serialHint: l.serialHint,
    media: l.media.map((m) => ({ path: m.url, kind: m.kind, shot: m.shot })),
  };
  return <CheckoutView item={{ id: l.id, title: l.title, seller: l.seller.username, photoUrl: photo?.url ?? null, version }} />;
}
