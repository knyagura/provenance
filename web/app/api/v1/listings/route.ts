import { authenticate } from '@/lib/api/auth';
import { json, problem } from '@/lib/api/http';
import { listingJson } from '@/lib/api/serialize';
import { config } from '@/lib/config';
import { apiCatalogue } from '@/lib/domain/catalogue';
import { parseApiQuery } from '@/lib/domain/query';

export async function GET(req: Request) {
  const auth = await authenticate(req.headers, 'listings:read');
  if (!auth.ok) return auth.response;
  const parsed = parseApiQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return problem('invalid-request', 'See "errors" for each parameter.', { rate: auth.rate, errors: parsed.errors });
  try {
    const page = await apiCatalogue().search(parsed.query);
    return json({ data: page.items.map((l) => listingJson(l, config.siteUrl)), next_cursor: page.nextCursor }, { rate: auth.rate });
  } catch {
    return problem('unavailable', 'The catalogue could not be reached. Try again shortly.', { rate: auth.rate, headers: { 'Retry-After': '5' } });
  }
}
