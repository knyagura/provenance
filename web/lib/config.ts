// Public configuration. Only the Supabase publishable key belongs here; it is safe in the browser
// because Row Level Security decides what each user can read or change. Never put a secret key here.
export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://tkjmnivvcrcqkqjywafb.supabase.co',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_KEY ?? 'sb_publishable_LTjW96u1jivRuw1QPaSslw_OP-mrKxV',
} as const;
