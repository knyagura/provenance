import { describe, expect, it } from 'vitest';
import { formatPence } from '@/lib/format';

describe('formatPence', () => {
  it('formats pence as pounds', () => {
    expect(formatPence(4800)).toBe('£48.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(123456)).toBe('£1,234.56');
  });
  it('rejects non-numbers', () => {
    expect(() => formatPence(Number.NaN)).toThrow();
  });
});
