import { afterEach, describe, expect, it, vi } from 'vitest';

const SUPA = 'https://tkjmnivvcrcqkqjywafb.supabase.co/storage/v1/object/public/listing-media/a/b.jpg';

describe('photo sizes', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('uses the original everywhere except Netlify', async () => {
    const { photo } = await import('@/lib/images');
    expect(photo(SUPA, '50vw')).toEqual({ src: SUPA });
  });
  it('on Netlify, serves Supabase photos at screen-sized widths, but never SVGs or local files', async () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGE_CDN', 'netlify');
    const { photo } = await import('@/lib/images');
    const p = photo(SUPA, '50vw', [240, 480]);
    expect(p.srcSet).toBe(`/.netlify/images?url=${encodeURIComponent(SUPA)}&w=240&q=75 240w, /.netlify/images?url=${encodeURIComponent(SUPA)}&w=480&q=75 480w`);
    expect(p.sizes).toBe('50vw');
    expect(photo('/examples/example-1-front.svg', '50vw')).toEqual({ src: '/examples/example-1-front.svg' });
    expect(photo('data:image/png;base64,AAAA', '50vw')).toEqual({ src: 'data:image/png;base64,AAAA' });
  });
});
