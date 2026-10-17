// Checks a password against Have I Been Pwned's list of passwords seen in data breaches, using its
// k-anonymity range API: only the first 5 characters of the password's SHA-1 hash leave the browser,
// never the password. Free, no key. Stands in for Supabase's "leaked password protection" (Pro plan).
// If the service can't be reached, the check passes rather than blocking sign-up.

const RANGE = 'https://api.pwnedpasswords.com/range/';

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** How many times the password appears in known breaches (0 when it doesn't, or when the check couldn't run). */
export async function breachCount(password: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetchImpl(RANGE + prefix, { headers: { 'Add-Padding': 'true' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return 0;
    for (const line of (await r.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export const BREACHED_MESSAGE =
  'That password has appeared in a data breach elsewhere, so it isn’t safe to use. Please choose a different one.';
