import type { Tier } from '@/lib/domain/types';
import { TIER_LABEL } from '@/lib/domain/present';
import { CameraIcon, DoubleSealIcon, EyeIcon, SealIcon } from './icons';

const ICON = { enhanced: CameraIcon, verified: EyeIcon, luxury: SealIcon, ultraLuxury: DoubleSealIcon };

/** How well an item is protected on its way to the buyer, by price band. Always a word, never colour alone. */
export function TierBadge({ tier, size = 'small' }: { tier: Tier; size?: 'small' | 'large' }) {
  const Icon = ICON[tier];
  return (
    <span className={`pv-tier pv-tier--${tier}${size === 'large' ? ' pv-tier--large' : ''}`}>
      <Icon />
      {TIER_LABEL[tier]}
    </span>
  );
}
