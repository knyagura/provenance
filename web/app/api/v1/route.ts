import { config } from '@/lib/config';
import { json } from '@/lib/api/http';

export function GET() {
  return json({
    name: 'NuTuYu API',
    version: '1',
    docs: `${config.siteUrl}/developers`,
    openapi: `${config.siteUrl}/api/v1/openapi.json`,
    endpoints: ['/api/v1/listings', '/api/v1/listings/{id}', '/api/v1/listings/{id}/quote', '/api/v1/categories'],
  });
}
