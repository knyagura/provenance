import { describe, expect, it, vi } from 'vitest';
import { breachCount } from '@/lib/account/pwned';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
describe('breached password check', () => {
  it('sends only the first five characters of the hash and finds the match', async () => {
    const f = vi.fn(async () => new Response('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n'));
    expect(await breachCount('password', f as unknown as typeof fetch)).toBe(9545824);
    expect(f).toHaveBeenCalledWith('https://api.pwnedpasswords.com/range/5BAA6', expect.anything());
    expect(JSON.stringify(f.mock.calls)).not.toContain('1E4C9B93F3F0682250B6CF8331B7EE68FD8');
    expect(JSON.stringify(f.mock.calls)).not.toContain('"password"');
  });
  it('is 0 for an unseen password, and never blocks when the service is down', async () => {
    expect(await breachCount('password', (async () => new Response('ABC:1')) as unknown as typeof fetch)).toBe(0);
    expect(await breachCount('password', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(0);
    expect(await breachCount('password', (async () => new Response('', { status: 503 })) as unknown as typeof fetch)).toBe(0);
  });
});
