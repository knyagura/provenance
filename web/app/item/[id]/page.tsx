import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Badge, Button, CustodyTimeline, TierBadge, type CustodyStep } from '@/components/ui';
import { Gallery } from '@/components/browse/Gallery';
import { OfferBox } from '@/components/market/OfferBox';
import { ItemBasketButton } from '@/components/baskets/ItemBasketButton';
import { RatingLine } from '@/components/market/Reviews';
import { TrustLine } from '@/components/market/Trust';
import { Questions } from '@/components/safety/Questions';
import { ReportButton } from '@/components/safety/Report';
import { ExampleHiddenNotice } from '@/components/safety/SellerNotices';
import { BoostControl } from '@/components/account/Growth';
import { BundleNote } from '@/components/market/BundleNote';
import { getListing, getSimilar, getVariants } from '@/lib/domain/catalogue';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { VariantPicker } from '@/components/browse/VariantPicker';
import { fallbackCategories } from '@/lib/domain/examples';
import { categoryPath } from '@/lib/domain/taxonomy';
import { categoryName, placeholderFor, TIER_NOTE } from '@/lib/domain/present';
import type { Listing, Tier } from '@/lib/domain/types';
import { formatPence } from '@/lib/format';
import { config } from '@/lib/config';
import { breadcrumbLd, jsonLd } from '@/lib/domain/landing';

export const revalidate = 60;

type Props = { params: Promise<{ id: string }> };

// One database read per request, shared by the page and its metadata.
const load = cache(async (id: string) => getListing(id));

function summary(l: Listing): string {
  const bits = [formatPence(l.pricePence), l.brand, l.size ? `Size ${l.size}` : null, l.condition].filter(Boolean).join(' · ');
  return `${bits}. Sold with its custody record on NuTuYu.`;
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
      ...(photo && !l.example ? { images: [{ url: photo.url, alt: l.title }] } : {}),
    },
  };
}

/** What happens after buying, for this item's level of protection (the same stages as the order's custody record). */
function journey(tier: Tier): CustodyStep[] {
  const witnessed = tier !== 'enhanced';
  const hub = tier === 'luxury' || tier === 'ultraLuxury';
  const steps: CustodyStep[] = [
    { title: 'Photographed when listed', note: 'The seller took these photos in the app; they are the reference for the item.', state: 'done' },
    witnessed
      ? {
          title: 'Parcel handed over to the courier',
          note: `The seller records the parcel being packed, weighs it and seals it with a unique code while the courier is present${hub ? ', with an extra seal on the item itself' : ''}.`,
          state: 'later',
        }
      : { title: 'Photographed as it’s packed, posted with tracking', note: 'The seller photographs it going into the parcel and adds the tracking number.', state: 'later' },
  ];
  if (hub) {
    steps.push({
      title: tier === 'ultraLuxury' ? 'Checked by two specialists' : 'Checked by a specialist',
      note: `A specialist checks the item and its seals on camera, then seals it again for delivery${tier === 'ultraLuxury' ? ' before a second independent specialist carries out another check' : ''}.`,
      state: 'later',
    });
  }
  if (witnessed) {
    steps.push({ title: 'You check and open your parcel', note: 'The courier weighs the parcel at your door. Check the seal, then record yourself opening it so there is a clear record if something is wrong.', state: 'later' });
  }
  steps.push({ title: 'Confirm everything is right', note: 'Once you confirm the item is as expected, the seller is paid. If there is a problem, report it so the payment can be held while it is reviewed.', state: 'later' });
  return steps;
}

export default async function ItemPage({ params }: Props) {
  const l = await load((await params).id);
  if (!l) notFound();
  const cat = l.category ? categoryPath(l.category) || categoryName(fallbackCategories, l.category) : undefined;
  const photos = l.media.filter((m) => m.kind === 'photo');
  const exampleMode = process.env.PV_DATA_SOURCE === 'examples';
  // Business sellers: colours, sizes and stock. Fixed prices, so no offers.
  const fixed = (l.stock ?? 1) > 1 || !!l.variantGroup;
  const [variants, similar] = await Promise.all([fixed ? getVariants(l.id).catch(() => []) : Promise.resolve([]), getSimilar(l)]);
  const buyable = l.status === 'active' && !l.seller.away && (!l.example || exampleMode);
  const videos = l.media.filter((m) => m.kind === 'video');
  const details: [string, string | null][] = [
    ['Brand', l.brand],
    ['Size', l.size],
    ['Condition', l.condition],
    ['Colour', l.colour],
    ['Materials', l.materials?.length ? l.materials.join(', ') : null],
    ['Category', cat ?? null],
    ['Serial ends', l.serialHint],
  ];

  // Structured data, so search engines can show the item with its price, photo and availability.
  const ld = l.example ? null : {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: l.title,
    description: l.description ?? undefined,
    image: photos.map((m) => m.url).slice(0, 5),
    sku: l.itemId ?? l.id,
    brand: l.brand ? { '@type': 'Brand', name: l.brand } : undefined,
    itemCondition: /new with tags/i.test(l.condition ?? '') ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
    offers: {
      '@type': 'Offer',
      url: `${config.siteUrl}/item/${l.id}`,
      priceCurrency: 'GBP',
      price: (l.pricePence / 100).toFixed(2),
      availability: l.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      seller: { '@type': 'Person', name: l.seller.username },
    },
  };
  return (
    <article className="pv-item">
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} /> : null}
      {l.example ? null : <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd([
        { name: 'Home', path: '/' }, ...(cat && l.category ? [{ name: cat, path: `/c/${l.category}` }] : []), { name: l.title, path: `/item/${l.id}` },
      ])) }} />}
      <nav className="pv-crumbs" aria-label="Breadcrumb">
        <ol>
          <li><Link href="/">Home</Link></li>
          {cat ? <li><Link href={`/c/${l.category}`}>{cat}</Link></li> : null}
          <li aria-current="page">{l.title}</li>
        </ol>
      </nav>

      <div className="pv-item__gallery">
        {photos.length ? (
          <Gallery photos={photos} title={l.title} />
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
        {l.boosted ? <Badge tone="boosted">Boosted</Badge> : null}
        <ExampleHiddenNotice listingId={l.id} />
        <h1>{l.title}</h1>
        <p className="pv-item__price">{formatPence(l.pricePence)}</p>
        <div className="pv-item__tier">
          <TierBadge tier={l.tier} size="large" />
          <span className="pv-note">{TIER_NOTE[l.tier]}</span>
        </div>
        {variants.length ? <VariantPicker initial={variants} title={l.title} category={l.category} /> : null}
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
          {buyable ? <ItemBasketButton listingId={l.id} title={l.title} size={l.size} category={l.category} /> : null}
          {fixed ? null : buyable ? (
            <OfferBox listingId={l.id} pricePence={l.pricePence} available sellerName={l.seller.username} />
          ) : (
            <Button variant="secondary" block disabled aria-describedby="buy-note">Make an offer</Button>
          )}
          <p id="buy-note" className="pv-note">
            {l.example && !exampleMode
              ? 'This is an example listing, so it can’t be bought.'
              : l.status !== 'active'
                ? 'This item is no longer available.'
                : l.seller.away
                  ? 'Buying is paused while the seller is away.'
                  : fixed
                    ? 'A fixed price from a business seller. Each one you buy is its own protected order.'
                    : 'Make an offer and the seller can accept, decline or reply with another amount.'}
          </p>
        </div>

        <section className="pv-seller" aria-label="Seller">
          <span className="pv-seller__avatar" aria-hidden="true">{l.seller.username.slice(0, 2).toUpperCase()}</span>
          <span>
            <Link href={`/member/${encodeURIComponent(l.seller.username)}`}><strong>{l.seller.username}</strong></Link>
            <span className="pv-note">
              {[l.seller.verified ? 'Identity checked' : null, l.seller.business ? 'Business seller' : null].filter(Boolean).join(' · ') || 'Member'}
            </span>
            <RatingLine username={l.seller.username} />
            <TrustLine username={l.seller.username} />
          </span>
        </section>
        {buyable ? <BundleNote seller={l.seller.username} /> : null}
        <BoostControl listingId={l.id} seller={l.seller.username} pricePence={l.pricePence} live={l.status === 'active'} />

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

        <Questions listingId={l.id} seller={l.seller.username} />
        <ReportButton target={{ listingId: l.id }} label="Report this listing" />
      </div>

      <section className="pv-item__journey" aria-labelledby="journey">
        <h2 id="journey">How this item reaches you</h2>
        <p className="pv-lead">We keep a record from listing to delivery, so there is evidence to help resolve problems if something goes wrong.</p>
        <CustodyTimeline steps={journey(l.tier)} label="How this item reaches you" />
        <p><Link href={`/passport/${l.id}`}>See this item’s passport</Link>: its recorded history, without anyone’s personal details.</p>
      </section>

      {similar.length ? (
        <section className="pv-item__similar" aria-labelledby="similar">
          <h2 id="similar">Similar items</h2>
          <ListingGrid listings={similar} label="Similar items" />
        </section>
      ) : null}
    </article>
  );
}
