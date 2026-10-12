import type { Metadata } from 'next';
import tokens from '@/design/tokens.json';
import { Badge, BottomNav, Button, CustodyTimeline, ListingCard, SellIcon, TierBadge } from '@/components/ui';
import { exampleListings, exampleSteps } from '@/lib/examples';
import './styleguide.css';

export const metadata: Metadata = { title: 'Style guide' };

type ColourToken = { name: string; value: string | Record<string, string>; usage: string };
type TypeStyle = { name: string; fontSize: string; lineHeight: string; fontWeight: number; sample?: string; usage?: string; letterSpacing?: string };

const show = (v: ColourToken['value'], theme: string) => (typeof v === 'string' ? v : v[theme] ?? v.light);

export default function StyleGuidePage() {
  const colours = tokens.color.tokens as ColourToken[];
  return (
    <>
      <section className="pv-section">
        <p className="pv-eyebrow">Build step 1</p>
        <h1>Style guide</h1>
        <p className="pv-lead">
          Every colour, type style and component the new site is built from, rendered by the site itself. It follows the{' '}
          <a href="https://claude.ai/artifact/LupKBiAfdki9LXr3a46o87">Provenance Design System</a>. Switch your phone or computer
          between light and dark mode to check both.
        </p>
      </section>

      <section className="pv-section" aria-labelledby="sg-colour">
        <h2 id="sg-colour">Colour</h2>
        <ul className="sg-swatches">
          {colours.map((t) => (
            <li key={t.name} className="sg-swatch">
              <span className="sg-chip" style={{ background: `var(--${t.name})` }} aria-hidden="true" />
              <span className="sg-swatch__text">
                <code>{t.name}</code>
                <span className="sg-hex">
                  {show(t.value, 'light')} · {show(t.value, 'dark')}
                </span>
                <span className="sg-usage">{t.usage}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pv-section" aria-labelledby="sg-type">
        <h2 id="sg-type">Type</h2>
        <ul className="sg-type">
          {tokens.type.groups.flatMap((g) =>
            (g.styles as TypeStyle[]).map((s) => (
              <li key={s.name}>
                <span
                  className="sg-type__sample"
                  style={{
                    fontFamily: `var(--font-${g.family})`,
                    fontSize: s.fontSize,
                    lineHeight: s.lineHeight,
                    fontWeight: s.fontWeight,
                    letterSpacing: s.letterSpacing,
                  }}
                >
                  {s.sample}
                </span>
                <span className="sg-usage">
                  <code>{s.name}</code> · {s.fontSize}/{s.lineHeight} · {s.usage}
                </span>
              </li>
            )),
          )}
        </ul>
      </section>

      <section className="pv-section" aria-labelledby="sg-buttons">
        <h2 id="sg-buttons">Buttons</h2>
        <div className="sg-row">
          <Button variant="primary">Buy now</Button>
          <Button variant="secondary">Make an offer</Button>
          <Button variant="quiet">Ask a question</Button>
          <Button disabled>Sold</Button>
          <Button variant="primary" icon={<SellIcon />}>
            Sell now
          </Button>
        </div>
        <p className="pv-note">One terracotta button per screen. Its label is always dark: white on terracotta is unreadable.</p>
      </section>

      <section className="pv-section" aria-labelledby="sg-badges">
        <h2 id="sg-badges">Badges</h2>
        <div className="sg-row">
          <Badge tone="verified">Verified</Badge>
          <Badge tone="witnessed">Witnessed</Badge>
          <Badge tone="boosted">Boosted</Badge>
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="danger">Chain broken</Badge>
        </div>
        <h3 className="pv-h3">Protection levels</h3>
        <div className="sg-row">
          <TierBadge tier="enhanced" />
          <TierBadge tier="verified" />
          <TierBadge tier="luxury" />
          <TierBadge tier="ultraLuxury" />
        </div>
        <p className="pv-note">Shown on every listing photo and item page: what protects the item on its way, by price band.</p>
      </section>

      <section className="pv-section" aria-labelledby="sg-cards">
        <h2 id="sg-cards">Listing cards</h2>
        <div className="pv-grid">
          {exampleListings.map((l) => (
            <ListingCard key={l.title} {...l} />
          ))}
        </div>
      </section>

      <section className="pv-section" aria-labelledby="sg-custody">
        <h2 id="sg-custody">Custody timeline</h2>
        <CustodyTimeline steps={exampleSteps} label="Example custody steps" />
      </section>

      <section className="pv-section" aria-labelledby="sg-nav">
        <h2 id="sg-nav">Bottom bar</h2>
        <BottomNav current="/" inline />
        <p className="pv-note">Fixed to the bottom of the screen on phones and tablets; replaced by the top bar from 1024px.</p>
      </section>
    </>
  );
}
