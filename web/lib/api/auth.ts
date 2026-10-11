import { createClient } from '@supabase/supabase-js';
import { config } from '@/lib/config';
import { keyFromHeaders, parseKey, type Scope } from './keys';
import { problem, type RateInfo } from './http';

// Every API v1 call needs a key, including reads. Our own website does not go through here: its pages
// call the same domain modules on the server. Keys are counted per minute in the database.

/** Calls per key per minute. Becomes a per-plan setting in the staff console (backlog B60). */
export const RATE_LIMIT_PER_MINUTE = 120;

export interface Caller {
  keyId: string;
  ownerId: string;
  scopes: string[];
  calls: number;
}

export interface KeyVerifier {
  verify(prefix: string, hash: string): Promise<Caller | null>;
}

const supabaseVerifier: KeyVerifier = {
  async verify(prefix, hash) {
    const db = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
    });
    const { data, error } = await db.rpc('api_authenticate', { p_prefix: prefix, p_hash: hash });
    if (error) throw error;
    const row = (data as { key_id: string; owner_id: string; scopes: string[]; calls: number }[] | null)?.[0];
    return row ? { keyId: row.key_id, ownerId: row.owner_id, scopes: row.scopes, calls: row.calls } : null;
  },
};

/**
 * Local tests run without a database (PV_DATA_SOURCE=examples). This key only works in that mode,
 * where the API serves nothing but the example catalogue.
 */
export const EXAMPLE_MODE_KEY = 'pv_test_Example1_' + 'x'.repeat(43);
const exampleVerifier: KeyVerifier = {
  async verify(prefix) {
    return prefix === 'pv_test_Example1'
      ? { keyId: 'example', ownerId: 'example', scopes: ['listings:read'], calls: 1 }
      : null;
  },
};

export function verifier(): KeyVerifier {
  return process.env.PV_DATA_SOURCE === 'examples' ? exampleVerifier : supabaseVerifier;
}

export type AuthResult = { ok: true; caller: Caller; rate: RateInfo } | { ok: false; response: Response };

export async function authenticate(headers: Headers, scope: Scope, v: KeyVerifier = verifier()): Promise<AuthResult> {
  const key = keyFromHeaders(headers);
  if (!key) {
    return { ok: false, response: problem('unauthenticated', 'Send your API key as "Authorization: Bearer <key>".') };
  }
  const parsed = parseKey(key);
  if (!parsed) return { ok: false, response: problem('unauthenticated', 'That is not a Provenance API key.') };

  let caller: Caller | null;
  try {
    caller = await v.verify(parsed.prefix, parsed.hash);
  } catch {
    return { ok: false, response: problem('unavailable', 'We could not check your key just now. Try again shortly.', { headers: { 'Retry-After': '5' } }) };
  }
  if (!caller) return { ok: false, response: problem('unauthenticated', 'This key is not recognised or has been revoked.') };

  const rate = { limit: RATE_LIMIT_PER_MINUTE, remaining: RATE_LIMIT_PER_MINUTE - caller.calls };
  if (caller.calls > RATE_LIMIT_PER_MINUTE) {
    const retry = String(60 - new Date().getUTCSeconds());
    return { ok: false, response: problem('rate-limited', `Each key can make ${RATE_LIMIT_PER_MINUTE} calls a minute.`, { rate, headers: { 'Retry-After': retry } }) };
  }
  if (!caller.scopes.includes(scope)) {
    return { ok: false, response: problem('forbidden', `This call needs the "${scope}" scope. Add it to the key in your account settings.`, { rate }) };
  }
  return { ok: true, caller, rate };
}
