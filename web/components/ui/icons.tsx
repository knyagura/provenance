// 1.5px line icons on a 24px grid, drawn in currentColor (see the design system's Iconography).
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { filled?: boolean };

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const HeartIcon = ({ filled, ...p }: IconProps) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);
export const TickIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const EyeIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2}><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>
);
export const HomeIcon = (p: IconProps) => <svg {...base(p)}><path d="M4 11l8-7 8 7v9H4z" /></svg>;
export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
);
export const SellIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>
);
export const InboxIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg>
);
export const ProfileIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" /></svg>
);
export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></svg>
);
export const CameraIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
/** A round seal with a tick: authenticated. */
export const SealIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8" /><path d="M8.5 12.2l2.4 2.4 4.6-4.8" /></svg>
);
/** Two overlapping seals: checked twice. */
export const DoubleSealIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="9.5" cy="12" r="6.5" /><circle cx="15" cy="12" r="6.5" /><path d="M12.4 12.3l1.7 1.7 3.2-3.4" /></svg>
);
export const PackageIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v8" /></svg>
);
export const BagIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
);
export const GiftIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 10h16v10H4z" /><path d="M3 7h18v3H3zM12 7v13" /><path d="M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1" /></svg>
);
