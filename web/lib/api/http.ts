// Shared HTTP behaviour for API v1: JSON bodies, problem+json errors (RFC 9457) and standard headers.

export const API_VERSION = '1';
export const DOCS_URL = '/developers';

export interface RateInfo {
  limit: number;
  remaining: number;
}

function baseHeaders(rate?: RateInfo): Headers {
  const h = new Headers({
    'Provenance-Api-Version': API_VERSION,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (rate) {
    h.set('RateLimit-Limit', String(rate.limit));
    h.set('RateLimit-Remaining', String(Math.max(0, rate.remaining)));
  }
  return h;
}

export function json(body: unknown, init: { status?: number; rate?: RateInfo; headers?: Record<string, string> } = {}): Response {
  const h = baseHeaders(init.rate);
  h.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(init.headers ?? {})) h.set(k, v);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: h });
}

export type ProblemCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'invalid-request'
  | 'rate-limited'
  | 'unavailable'
  | 'method-not-allowed';

const TITLES: Record<ProblemCode, [number, string]> = {
  unauthenticated: [401, 'API key missing or not valid'],
  forbidden: [403, 'This key does not have the scope needed'],
  'not-found': [404, 'Not found'],
  'invalid-request': [400, 'Some parameters are not valid'],
  'rate-limited': [429, 'Too many requests'],
  unavailable: [503, 'Temporarily unavailable'],
  'method-not-allowed': [405, 'Method not allowed'],
};

export function problem(
  code: ProblemCode,
  detail: string,
  extra: { rate?: RateInfo; headers?: Record<string, string>; errors?: { name: string; reason: string }[] } = {},
): Response {
  const [status, title] = TITLES[code];
  const h = baseHeaders(extra.rate);
  h.set('Content-Type', 'application/problem+json; charset=utf-8');
  for (const [k, v] of Object.entries(extra.headers ?? {})) h.set(k, v);
  if (status === 401) h.set('WWW-Authenticate', 'Bearer realm="provenance"');
  const body: Record<string, unknown> = { type: `${DOCS_URL}#problem-${code}`, title, status, detail };
  if (extra.errors?.length) body.errors = extra.errors;
  return new Response(JSON.stringify(body), { status, headers: h });
}
