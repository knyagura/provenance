import { authenticate } from '@/lib/api/auth';
import { json, problem } from '@/lib/api/http';
import { listingJson } from '@/lib/api/serialize';
import { config } from '@/lib/config';
import { apiCatalogue } from '@/lib/domain/catalogue';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req.headers, 'listings:read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const listing = await apiCatalogue().get(id);
    if (!listing) return problem('not-found', 'No live listing has that ID.', { rate: auth.rate });
    return json({ data: listingJson(listing, config.siteUrl) }, { rate: auth.rate });
  } catch {
    return problem('unavailable', 'The catalogue could not be reached. Try again shortly.', { rate: auth.rate, headers: { 'Retry-After': '5' } });
  }
}
