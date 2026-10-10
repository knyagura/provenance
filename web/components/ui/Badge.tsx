import type { ReactNode } from 'react';
import { AlertIcon, EyeIcon, TickIcon } from './icons';

export type BadgeTone = 'verified' | 'witnessed' | 'boosted' | 'neutral' | 'danger';

const toneClass: Record<BadgeTone, string> = {
  verified: 'pv-badge--verified',
  witnessed: 'pv-badge--verified',
  boosted: 'pv-badge--boosted',
  neutral: 'pv-badge--neutral',
  danger: 'pv-badge--danger',
};

const toneIcon: Partial<Record<BadgeTone, ReactNode>> = {
  verified: <TickIcon />,
  witnessed: <EyeIcon />,
  danger: <AlertIcon />,
};

/** A short label for a proven or set state. Every badge carries a word, so state never relies on colour alone. */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`pv-badge ${toneClass[tone]}`}>
      {toneIcon[tone]}
      {children}
    </span>
  );
}
