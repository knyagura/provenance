import { config } from '@/lib/config';
import { json } from '@/lib/api/http';
import { openApi } from '@/lib/api/openapi';

export function GET() {
  return json(openApi(config.siteUrl), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
