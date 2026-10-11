import { authenticate } from '@/lib/api/auth';
import { json, problem } from '@/lib/api/http';
import { quoteJson } from '@/lib/api/serialize';
import { apiCatalogue } from '@/lib/domain/catalogue';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req.headers, 'listings:read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const q = await apiCatalogue().quote(id);
    if (!q) return problem('not-found', 'No listing with that ID can be bought right now.', { rate: auth.rate });
    return json({ data: quoteJson(id, q) }, { rate: auth.rate });
  } catch {
    return problem('unavailable', 'The catalogue could not be reached. Try again shortly.', { rate: auth.rate, headers: { 'Retry-After': '5' } });
  }
}
