/**
 * The NuTuYu mark: two arms form a circle and hand a sealed parcel from one person to the next.
 * Sleeves are terracotta (the giver) and sage (the receiver); the hands are two different people.
 * Drawn in the site's colour tokens, so it adapts to dark mode.
 */
const Hand = ({ skin }: { skin: string }) => (
  <g transform="translate(81.5 37.5) rotate(135) scale(1.15)">
    <rect x="-2.4" y="-6.8" width="3.4" height="13.6" rx="1.2" fill="var(--surface-raised)" />
    <g fill={skin}>
      <path d="M1 -6.2 H7 V6.2 H1 Z" />
      <rect x="5" y="-6.2" width="9" height="3.3" rx="1.65" />
      <rect x="5" y="-2.6" width="10" height="3.3" rx="1.65" />
      <rect x="5" y="1" width="9.4" height="3.3" rx="1.65" />
      <rect x="5" y="3.6" width="7.6" height="2.8" rx="1.4" />
      <ellipse cx="5.2" cy="-7.6" rx="4.8" ry="2.2" transform="rotate(-30 5.2 -7.6)" />
    </g>
  </g>
);

const Arm = ({ sleeve, skin }: { sleeve: string; skin: string }) => (
  <>
    <path d="M17 80 A46 46 0 0 1 93 26 L84 35" fill="none" stroke={sleeve} strokeWidth="13" strokeLinejoin="round" />
    <circle cx="17" cy="80" r="6.5" fill={sleeve} />
    <Hand skin={skin} />
  </>
);

export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <path d="M60 41 L78 50 L78 70 L60 79 L42 70 L42 50 Z" fill="var(--peach)" />
      <path d="M60 41 L78 50 L60 59 L42 50 Z" fill="var(--blush)" />
      <path d="M60 59 V79" stroke="var(--terracotta-text)" strokeWidth="1" opacity=".4" />
      <path d="M51 45.5 L69 54.5 V61" stroke="var(--surface-raised)" strokeWidth="3" fill="none" opacity=".8" />
      <circle cx="69.5" cy="67.5" r="5.5" fill="var(--terracotta)" stroke="var(--terracotta-text)" strokeWidth="1" strokeDasharray="1.6 1.1" />
      <Arm sleeve="var(--terracotta-text)" skin="#E7C6AC" />
      <g transform="rotate(180 60 60)">
        <Arm sleeve="var(--sage-text)" skin="#B98A68" />
      </g>
    </svg>
  );
}
