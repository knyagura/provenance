/** The home page's picture: a sealed parcel and the record that travels with it. Drawn in the site's colours. */
export function HeroArt() {
  return (
    <svg className="pv-hero__art" viewBox="0 0 420 300" role="img" aria-label="A sealed parcel beside its custody record, every step ticked">
      <ellipse cx="160" cy="262" rx="130" ry="14" fill="var(--ink)" opacity=".08" />
      {/* parcel */}
      <path d="M50 120 L160 80 L270 120 L270 240 L160 280 L50 240 Z" fill="var(--peach)" />
      <path d="M50 120 L160 160 L270 120 L160 80 Z" fill="var(--blush)" />
      <path d="M160 160 L160 280" stroke="var(--terracotta-text)" strokeWidth="2" opacity=".35" />
      <path d="M100 101 L210 141 L210 186" stroke="var(--surface-raised)" strokeWidth="14" opacity=".7" fill="none" />
      {/* seal on the parcel */}
      <g transform="translate(205 205)">
        <circle r="28" fill="none" stroke="var(--terracotta-text)" strokeWidth="2.5" strokeDasharray="4 3" />
        <circle r="20" fill="var(--terracotta)" />
        <path d="M-9 1 l6 6 l12 -13" fill="none" stroke="var(--on-terracotta)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* the record */}
      <g transform="translate(262 40)">
        <rect width="140" height="190" rx="14" fill="var(--surface-raised)" stroke="var(--line)" strokeWidth="2" />
        <rect x="18" y="20" width="70" height="8" rx="4" fill="var(--ink)" opacity=".7" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(18 ${50 + i * 34})`}>
            <circle cx="10" cy="10" r="10" fill={i < 3 ? 'var(--sage)' : 'var(--surface-sand)'} />
            {i < 3 ? <path d="M5 10.5 l3.5 3.5 l6.5 -7" fill="none" stroke="var(--on-sage)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> : null}
            <rect x="28" y="4" width={i % 2 ? 66 : 80} height="6" rx="3" fill="var(--ink-soft)" opacity=".55" />
            <rect x="28" y="14" width="48" height="4" rx="2" fill="var(--ink-muted)" opacity=".35" />
            {i < 3 ? <path d={`M10 22 v12`} stroke="var(--line)" strokeWidth="2" /> : null}
          </g>
        ))}
      </g>
    </svg>
  );
}
