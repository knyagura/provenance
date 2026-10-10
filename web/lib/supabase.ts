import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';

let client: SupabaseClient | undefined;

/** One shared browser client. Screens should call domain modules, not this directly. */
export function supabase(): SupabaseClient {
  client ??= createClient(config.supabaseUrl, config.supabaseKey);
  return client;
}
