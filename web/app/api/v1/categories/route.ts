import { authenticate } from '@/lib/api/auth';
import { json, problem } from '@/lib/api/http';
import { categoryJson } from '@/lib/api/serialize';
import { apiCatalogue } from '@/lib/domain/catalogue';

export async function GET(req: Request) {
  const auth = await authenticate(req.headers, 'listings:read');
  if (!auth.ok) return auth.response;
  try {
    const cats = await apiCatalogue().categories();
    return json({ data: cats.map(categoryJson) }, { rate: auth.rate });
  } catch {
    return problem('unavailable', 'The catalogue could not be reached. Try again shortly.', { rate: auth.rate, headers: { 'Retry-After': '5' } });
  }
}
