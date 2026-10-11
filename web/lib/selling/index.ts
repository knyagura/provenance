import { exampleBackend } from './exampleBackend';
import { supabaseBackend } from './supabaseBackend';
import type { SellingBackend } from './types';

export * from './types';

/** Example mode is fixed at build time (PV_DATA_SOURCE=examples), so the browser bundle knows which to use. */
export function sellingBackend(): SellingBackend {
  return process.env.NEXT_PUBLIC_PV_DATA_SOURCE === 'examples' ? exampleBackend : supabaseBackend;
}
