import { CONDITIONS } from '@/lib/domain/types';
import { DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/domain/query';
import { RATE_LIMIT_PER_MINUTE } from './auth';
import { SCOPES } from './keys';

// The API v1 description (OpenAPI 3.1). Served at /api/v1/openapi.json and rendered at /developers.
// Only endpoints that exist are listed; the rest of the plan (orders, messages, passport…) is added as each is built.

const problem = { $ref: '#/components/responses/Problem' };

export function openApi(siteUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'NuTuYu API',
      version: '1.0.0',
      description:
        `Read the NuTuYu catalogue from your own shop or tools. Every call needs an API key from a Premium or Premium+ account, ` +
        `sent as "Authorization: Bearer <key>". Each key can make ${RATE_LIMIT_PER_MINUTE} calls a minute. Errors use application/problem+json.`,
    },
    servers: [{ url: `${siteUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    paths: {
      '/listings': {
        get: {
          operationId: 'listListings',
          summary: 'Search live listings',
          description: 'Listings that are published and still for sale. Newest first unless you choose another order.',
          'x-scope': 'listings:read',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Words to find in the title, brand or description. Each word matches the start of a word, so "barb" finds "Barbour".' },
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'A category slug from /categories.' },
            { name: 'seller', in: 'query', schema: { type: 'string' }, description: 'Only this seller’s listings, by username. Without it, sellers on holiday are left out.' },
            { name: 'condition', in: 'query', schema: { type: 'string', enum: CONDITIONS } },
            { name: 'size', in: 'query', schema: { type: 'string', maxLength: 40 }, description: 'Exact size label, ignoring case (for example 10, M or UK 9).' },
            { name: 'min_price_pence', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'max_price_pence', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'price_asc', 'price_desc'], default: 'newest' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'next_cursor from the previous page. Paging stops after 1,000 results; narrow the search instead.' },
          ],
          responses: {
            '200': {
              description: 'A page of listings',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Listing' } }, next_cursor: { type: ['string', 'null'] } } } } },
            },
            '400': problem, '401': problem, '403': problem, '429': problem,
          },
        },
      },
      '/listings/{id}': {
        get: {
          operationId: 'getListing',
          summary: 'Get one listing',
          'x-scope': 'listings:read',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'The listing', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Listing' } } } } } },
            '401': problem, '403': problem, '404': problem, '429': problem,
          },
        },
      },
      '/listings/{id}/quote': {
        get: {
          operationId: 'quoteListing',
          summary: 'What a buyer would pay',
          description: 'Today’s full price breakdown: item, postage, buyer protection, processing, courier witness and authentication. Only what the buyer pays; never the seller’s fees.',
          'x-scope': 'listings:read',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'The breakdown', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Quote' } } } } } },
            '401': problem, '403': problem, '404': problem, '429': problem,
          },
        },
      },
      '/categories': {
        get: {
          operationId: 'listCategories',
          summary: 'List categories',
          'x-scope': 'listings:read',
          responses: {
            '200': { description: 'All categories', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Category' } } } } } } },
            '401': problem, '403': problem, '429': problem,
          },
        },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: `Scopes: ${SCOPES.join(', ')}.` } },
      responses: {
        Problem: { description: 'Something went wrong; the body says what.', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
      },
      schemas: {
        Problem: {
          type: 'object',
          properties: {
            type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' },
            errors: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } } } },
          },
        },
        Quote: {
          type: 'object',
          properties: {
            listing_id: { type: 'string', format: 'uuid' }, currency: { type: 'string', const: 'GBP' }, fee_version: { type: 'integer' },
            tier: { type: 'string', enum: ['enhanced', 'verified', 'luxury', 'ultraLuxury'] },
            price_pence: { type: 'integer' }, postage_pence: { type: 'integer' },
            transaction_rate_bp: { type: 'integer', description: 'The transaction fee rate in basis points (800 = 8%); 3–8% by price band.' },
            protection_pence: { type: 'integer', description: 'The transaction fee, which pays for buyer protection.' }, processing_pence: { type: 'integer' },
            courier_witness_pence: { type: 'integer' }, authentication_pence: { type: 'integer' }, promotion_pence: { type: 'integer' }, total_pence: { type: 'integer' },
          },
        },
        Category: { type: 'object', properties: { slug: { type: 'string' }, name: { type: 'string' }, parent: { type: ['string', 'null'] } } },
        Listing: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            item_id: { type: ['string', 'null'], description: 'The item’s own ID, kept across resales.', pattern: '^IT-[0-9]{4}-[0-9]{5}$' },
            url: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            brand: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            size: { type: ['string', 'null'] },
            colour: { type: ['string', 'null'] },
            condition: { type: ['string', 'null'] },
            serial_hint: { type: ['string', 'null'], description: 'Last 4 characters of the serial number or IMEI, to match against the item on arrival. The full number is never shared.' },
            price_pence: { type: 'integer' },
            shipping_pence: { type: 'integer' },
            currency: { type: 'string', const: 'GBP' },
            tier: { type: 'string', enum: ['enhanced', 'verified', 'luxury', 'ultraLuxury'] },
            status: { type: 'string', enum: ['active', 'reserved', 'sold'] },
            revision: { type: 'integer', description: 'Goes up each time the seller publishes a change.' },
            media: { type: 'array', items: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, kind: { type: 'string', enum: ['photo', 'video'] }, shot: { type: ['string', 'null'] } } } },
            seller: { type: 'object', properties: { username: { type: 'string' }, verified: { type: 'boolean' }, business: { type: 'boolean' }, away: { type: 'boolean', description: 'On holiday: buying is paused.' } } },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  };
}
