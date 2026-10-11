const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** Formats pence as pounds, e.g. 4800 -> "£48.00". */
export function formatPence(pence: number): string {
  if (!Number.isFinite(pence)) throw new Error('Price must be a number of pence');
  return gbp.format(Math.round(pence) / 100);
}

/** "£12.50" or "12.5" → 1250; null when it isn't an amount. */
export function parsePounds(raw: string): number | null {
  const clean = raw.trim().replace(/^£/, '').replace(/,/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
