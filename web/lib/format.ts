const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** Formats pence as pounds, e.g. 4800 -> "£48.00". */
export function formatPence(pence: number): string {
  if (!Number.isFinite(pence)) throw new Error('Price must be a number of pence');
  return gbp.format(Math.round(pence) / 100);
}
