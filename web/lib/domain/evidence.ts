import { categoryRoot } from './taxonomy';

// What a seller must capture before a listing can go live, by category. The database holds the same
// profiles (migration 006) and enforces them when a listing is published; a unit test keeps the two equal.
// Here they drive the guided camera checklist, so the seller knows what is missing before they press Publish.

export interface Shot {
  key: string;
  label: string;
  /** One line telling the seller how to take it. */
  hint: string;
  kind: 'photo' | 'video';
  required: boolean;
  /** When set, the seller may say this shot doesn't exist (e.g. "No label") instead of taking it. */
  decline?: string;
}

export interface EvidenceProfile {
  shots: Shot[];
  /** Serial number, IMEI or date code. Kept private; buyers see the last 4 characters. */
  serial: { required: boolean; label: string } | null;
}

const front = (hint = 'The whole item, straight on, in good light.'): Shot => ({ key: 'front', label: 'Front', hint, kind: 'photo', required: true });
const back = (hint = 'The whole item from behind.'): Shot => ({ key: 'back', label: 'Back', hint, kind: 'photo', required: true });
const wear: Shot = { key: 'wear', label: 'Any wear or marks', hint: 'Close-ups of anything a buyer should know about.', kind: 'photo', required: false };

const clothing: EvidenceProfile = {
  shots: [
    front(),
    back(),
    { key: 'label', label: 'Size and care label', hint: 'Close enough to read the brand and size.', kind: 'photo', required: true, decline: 'No label' },
    wear,
  ],
  serial: null,
};

const footwear: EvidenceProfile = {
  shots: [
    front('Both shoes together, from the side and top.'),
    back('Both heels and the backs of the shoes.'),
    { key: 'sole', label: 'Soles and tread', hint: 'Show the wear on the soles and heels.', kind: 'photo', required: true },
    { key: 'label', label: 'Size and maker label', hint: 'Show the size label inside the shoe or on the box, if available.', kind: 'photo', required: true, decline: 'No label' },
    wear,
  ],
  serial: null,
};

const bag: EvidenceProfile = {
  shots: [
    front('The whole bag, including its shape and handles.'),
    back(),
    { key: 'interior', label: 'Interior', hint: 'Show the lining, pockets and inside label.', kind: 'photo', required: true },
    { key: 'hardware', label: 'Hardware and closures', hint: 'Show zips, clasps, buckles and any maker marks.', kind: 'photo', required: true },
    wear,
  ],
  serial: null,
};

export const EVIDENCE_PROFILES: Record<string, EvidenceProfile> = {
  women: clothing,
  men: clothing,
  kids: clothing,
  sport: clothing,
  designer: {
    shots: [
      front(),
      back(),
      { key: 'label', label: 'Brand stamp or label', hint: 'Sharp enough to read the lettering.', kind: 'photo', required: true },
      { key: 'serial', label: 'Serial or date code', hint: 'Usually inside a pocket, on a tag or under the base.', kind: 'photo', required: true, decline: 'No code' },
      { key: 'hardware', label: 'Hardware close-up', hint: 'Zips, clasps, buckles or engraving.', kind: 'photo', required: true },
      wear,
      { key: 'receipt', label: 'Proof of purchase', hint: 'Receipt or authenticity card, with personal details covered.', kind: 'photo', required: false },
    ],
    serial: { required: false, label: 'Serial or date code' },
  },
  electronics: {
    shots: [
      front('Switched on, showing the screen if it has one.'),
      back(),
      { key: 'serial', label: 'Serial number or IMEI', hint: 'On the label, in Settings, or under the battery.', kind: 'photo', required: true },
      { key: 'working', label: 'Working video', hint: 'Up to 30 seconds: switch it on and show it working.', kind: 'video', required: true },
      { key: 'accessories', label: 'Accessories', hint: 'Chargers, cables and boxes included in the sale.', kind: 'photo', required: false },
    ],
    serial: { required: true, label: 'Serial number or IMEI' },
  },
  home: {
    shots: [
      front(),
      { key: 'mark', label: "Maker's mark or label", hint: 'Underneath or on the back.', kind: 'photo', required: true, decline: 'No mark' },
      wear,
    ],
    serial: null,
  },
  'books-media': {
    shots: [
      front('The front cover.'),
      { key: 'spine', label: 'Spine', hint: 'Shows the title and condition of the spine.', kind: 'photo', required: true },
      wear,
    ],
    serial: null,
  },
  hobbies: {
    shots: [
      front(),
      { key: 'contents', label: 'All the parts', hint: 'Everything included, laid out together.', kind: 'photo', required: true },
      { key: 'box', label: 'Box or maker', hint: 'The box, set number or maker’s mark.', kind: 'photo', required: false },
    ],
    serial: null,
  },
};

export function profileFor(category: string | null | undefined): EvidenceProfile | null {
  if (!category) return null;
  const direct = EVIDENCE_PROFILES[category];
  if (direct) return direct;
  const family = ['women-shoes', 'men-shoes', 'kids-shoes', 'women-bags', 'men-bags', 'designer-bags'].find((prefix) => category.startsWith(prefix + '-'));
  if (family) return family.includes('shoes') ? footwear : bag;
  const root = categoryRoot(category);
  return root ? EVIDENCE_PROFILES[root] ?? null : null;
}

/** Price bands that set how a sale is witnessed (the add-on tiers in the fee model). Set by the database too. */
export function tierForPrice(pence: number): 'enhanced' | 'verified' | 'luxury' | 'ultraLuxury' {
  if (pence >= 150_000) return 'ultraLuxury';
  if (pence >= 50_000) return 'luxury';
  if (pence >= 7_500) return 'verified';
  return 'enhanced';
}

export const MIN_PRICE_PENCE = 100;
export const MAX_PRICE_PENCE = 5_000_000;
export const DRAFT_TITLE = 'Untitled draft';

export interface DraftState {
  category: string | null;
  title: string;
  condition: string | null;
  pricePence: number | null;
  /** Shots captured, by key. */
  shots: string[];
  /** Shots the seller said don't exist. */
  declined: string[];
  hasSerial: boolean;
  parcelSize: string | null;
}

/**
 * Everything still missing before this draft can be published, in the order the seller fixes them.
 * Mirrors the database's publish check, which has the final say.
 */
export function missingForPublish(d: DraftState): string[] {
  const missing: string[] = [];
  const profile = profileFor(d.category);
  if (!profile) return ['Choose a category'];
  for (const s of profile.shots) {
    if (!s.required) continue;
    if (d.shots.includes(s.key)) continue;
    if (s.decline && d.declined.includes(s.key)) continue;
    missing.push(s.kind === 'video' ? `${s.label} (video)` : `Photo: ${s.label}`);
  }
  if (profile.serial?.required && !d.hasSerial) missing.push(profile.serial.label);
  if (!d.title.trim() || d.title.trim() === DRAFT_TITLE) missing.push('A title');
  if (!d.condition) missing.push('The condition');
  if (d.pricePence === null || d.pricePence < MIN_PRICE_PENCE) missing.push('A price of at least £1');
  else if (d.pricePence > MAX_PRICE_PENCE) missing.push('A price under £50,000');
  if (!d.parcelSize) missing.push('A parcel size');
  return missing;
}

export const PARCEL_SIZES = [
  { key: 'small', label: 'Small', note: 'Fits a large envelope: clothes, books', pence: 295 },
  { key: 'medium', label: 'Medium', note: 'Shoebox size: shoes, bags, small electronics', pence: 399 },
  { key: 'large', label: 'Large', note: 'Up to a large box: coats, lamps, games consoles', pence: 599 },
] as const;
