import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Badge, Button, CustodyTimeline, type CustodyStep } from '@/components/ui';
import { getListing } from '@/lib/domain/catalogue';
import { fallbackCategories } from '@/lib/domain/examples';
import { categoryName, placeholderFor, TIER_LABEL } from '@/lib/domain/present';
import type { Listing } from '@/lib/domain/types';
import { formatPence } from '@/lib/format';

export const revalidate = 60;

type Props = { params: Promise<{ id: string }> };

// One database read per request, shared by the page and its metadata.
const load = cache(async (id: string) => getListing(id));

function summary(l: Listing): string {
  const bits = [formatPence(l.pricePence), l.brand, l.size ? `Size ${l.size}` : null, l.condition].filter(Boolean).join(' · ');
  return `${bits}. Sold with its custody record on Provenance.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = await load((await params).id);
  if (!l) return { title: 'Item not found' };
  const photo = l.media.find((m) => m.kind === 'photo');
  return {
    title: l.title,
    description: summary(l),
    alternates: { canonical: `/item/${l.id}` },
    robots: l.example ? { index: false } : undefined,
    openGraph: {
      type: 'website',
      title: `${l.title} · ${formatPence(l.pricePence)}`,
      description: summary(l),
      url: `/item/${l.id}`,
      // With a real photo, use it; otherwise opengraph-image.tsx draws a card.
      ...(photo ? { images: [{ url: photo.url, alt: l.title }] } : {}),
    },
  };
}

function journey(l: Listing): CustodyStep[] {
  const witnessed = l.tier !== 'enhanced';
  return [
    { title: 'Photographed when listed', note: 'The seller took these photos in the app; they are the reference for the item.', state: 'done' },
    witnessed
      ? { title: 'Packed in front of a courier', note: 'The courier watches it go into the box, seals it and records the weight.', state: 'later' }
      : { title: 'Packed and sealed on camera', note: 'The seller films the item going into the box and the seal going on.', state: 'later' },
    { title: 'Opened on camera', note: 'You film the seal before you cut it. It takes about a minute.', state: 'later' },
    { title: 'Payment released', note: 'The seller is paid once you confirm the item is as described.', state: 'later' },
  ];
}

export default async function ItemPage({ params }: Props) {
  const l = await load((await params).id);
  if (!l) notFound();
  const cat = categoryName(fallbackCategories, l.category);
  const photos = l.media.filter((m) => m.kind === 'photo');
  const exampleMode = process.env.PV_DATA_SOURCE === 'examples';
  const buyable = l.status === 'active' && !l.seller.away && (!l.example || exampleMode);
  const videos = l.media.filter((m) => m.kind === 'video');
  const details: [string, string | null][] = [
    ['Brand', l.brand],
    ['Size', l.size],
    ['Condition', l.condition],
    ['Colour', l.colour],
    ['Category', cat ?? null],
    ['Evidence', TIER_LABEL[l.tier]],
    ['Serial ends', l.serialHint],
  ];

  return (
    <article className="pv-item">
      <nav className="pv-crumbs" aria-label="Breadcrumb">
        <ol>
          <li><Link href="/">Home</Link></li>
          {cat ? <li><Link href={`/search?category=${l.category}`}>{cat}</Link></li> : null}
          <li aria-current="page">{l.title}</li>
        </ol>
      </nav>

      <div className="pv-item__gallery">
        {photos.length ? (
          <ul className="pv-gallery" aria-label="Photos">
            {photos.map((m, i) => (
              <li key={m.url}>
                <img src={m.url} alt={`${l.title}, photo ${i + 1} of ${photos.length}${m.shot ? ` (${m.shot})` : ''}`} loading={i ? 'lazy' : 'eager'} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="pv-gallery__empty" style={{ background: `var(--${placeholderFor(l.id)})` }} role="img" aria-label={l.example ? 'Example item: no photo' : 'No photo yet'} />
        )}
        {videos.map((v) => (
          <figure key={v.url} className="pv-item__video">
            <video src={v.url} controls playsInline preload="metadata" aria-label={`${l.title}: ${v.shot === 'working' ? 'working video' : 'video'}`} />
            <figcaption className="pv-note">{v.shot === 'working' ? 'Working video, recorded by the seller when listing' : 'Video'}</figcaption>
          </figure>
        ))}
      </div>

      <div className="pv-item__buy">
        {l.example ? <Badge tone="neutral">Example listing</Badge> : null}
        <h1>{l.title}</h1>
        <p className="pv-item__price">{formatPence(l.pricePence)}</p>
        <p className="pv-note">
          {l.shippingPence ? `Postage ${formatPence(l.shippingPence)}` : 'Free postage'} · Buyer protection is added at checkout
        </p>
        {l.status !== 'active' ? <Badge tone="neutral">{l.status === 'sold' ? 'Sold' : 'Reserved'}</Badge> : null}
        {l.seller.away ? <p className="pv-banner" role="note">{l.seller.username} is on holiday, so buying is paused until they’re back.</p> : null}
        <div className="pv-item__actions">
          {buyable ? (
            <Link className="pv-btn pv-btn--primary pv-btn--block" href={`/checkout/${l.id}`}>Buy now</Link>
          ) : (
            <Button variant="primary" block disabled aria-describedby="buy-note">Buy now</Button>
          )}
          <Button variant="secondary" block disabled aria-describedby="buy-note">Make an offer</Button>
          <p id="buy-note" className="pv-note">
            {l.example && !exampleMode
              ? 'This is an example listing, so it can’t be bought.'
              : l.status !== 'active'
                ? 'This item is no longer available.'
                : l.seller.away
                  ? 'Buying is paused while the seller is away.'
                  : 'Offers arrive in a later build step.'}
          </p>
        </div>

        <section className="pv-seller" aria-label="Seller">
          <span className="pv-seller__avatar" aria-hidden="true">{l.seller.username.slice(0, 2).toUpperCase()}</span>
          <span>
            <Link href={`/member/${encodeURIComponent(l.seller.username)}`}><strong>{l.seller.username}</strong></Link>
            <span className="pv-note">
              {[l.seller.verified ? 'Identity checked' : null, l.seller.business ? 'Business seller' : null].filter(Boolean).join(' · ') || 'Member'}
            </span>
          </span>
        </section>

        <dl className="pv-details">
          {details.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
          {l.itemId ? <div><dt>Item ID</dt><dd className="pv-mono">{l.itemId}</dd></div> : null}
        </dl>

        {l.description ? (
          <section aria-labelledby="desc">
            <h2 id="desc" className="pv-h3">Description</h2>
            <p className="pv-item__desc">{l.description}</p>
          </section>
        ) : null}
      </div>

      <section className="pv-item__journey" aria-labelledby="journey">
        <h2 id="journey">How this item reaches you</h2>
        <p className="pv-lead">Each step is recorded, so if anything goes wrong there is evidence to settle it.</p>
        <CustodyTimeline steps={journey(l)} label="How this item reaches you" />
      </section>
    </article>
  );
}
