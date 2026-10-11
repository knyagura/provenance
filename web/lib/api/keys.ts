import { createHash, randomBytes } from 'node:crypto';

// API key format: pv_<env>_<8-character public prefix>_<43-character secret>
//   e.g. pv_live_Ab3dE6gH_q0Z…  The database stores the prefix in clear and a SHA-256 of the whole key.
// The prefix lets a member recognise a key in their list; the secret is shown once, when it is created.

export const KEY_PATTERN = /^(pv_[a-z]+_[A-Za-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export const SCOPES = [
  'listings:read', 'listings:write', 'orders:read', 'orders:write', 'messages:read', 'messages:write',
  'payouts:read', 'analytics:read', 'boosts:write', 'passport:read', 'passport:write', 'webhooks:manage',
] as const;
export type Scope = (typeof SCOPES)[number];

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function parseKey(key: string): { prefix: string; hash: string } | null {
  const m = KEY_PATTERN.exec(key);
  return m ? { prefix: m[1], hash: hashKey(key) } : null;
}

/** Makes a new key. Only the prefix and hash are stored; the full key is shown to the member once. */
export function generateKey(env = 'live'): { key: string; prefix: string; hash: string } {
  if (!/^[a-z]+$/.test(env)) throw new Error('env must be lower-case letters');
  const bytes = randomBytes(8);
  const id = Array.from(bytes, (b) => ALNUM[b % ALNUM.length]).join('');
  const prefix = `pv_${env}_${id}`;
  const key = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix, hash: hashKey(key) };
}

/** Reads "Authorization: Bearer <key>"; also accepts an "X-Api-Key" header. */
export function keyFromHeaders(h: Headers): string | null {
  const auth = h.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    return m ? m[1] : null;
  }
  return h.get('x-api-key')?.trim() || null;
}
