import type { AuthError, PostgrestError } from '@supabase/supabase-js';
import { mediaUrl } from '@/lib/domain/catalogue';
import { DRAFT_TITLE, PARCEL_SIZES, profileFor } from '@/lib/domain/evidence';
import { supabase } from '@/lib/supabase';
import type { Draft, DraftFields, DraftMedia, Member, Passkey, Result, SellingBackend } from './types';

// Selling through Supabase with the signed-in member's session. Row Level Security and the database's
// listing rules (migration 006) decide what is allowed; this file only translates.

const DRAFT_COLUMNS =
  'id, category, title, brand, size_label, colour, condition_label, description, price_pence, parcel_size, declined_shots, published, updated_at, ' +
  'media:listing_media(id, shot, kind, path, created_at), secret:listing_secrets(serial_number)';

interface DraftRow {
  id: string;
  category: string | null;
  title: string;
  brand: string | null;
  size_label: string | null;
  colour: string | null;
  condition_label: string | null;
  description: string | null;
  price_pence: number;
  parcel_size: Draft['parcelSize'];
  declined_shots: string[];
  published: boolean;
  updated_at: string;
  media: { id: string; shot: string | null; kind: 'photo' | 'video'; path: string; created_at: string }[] | null;
  secret: { serial_number: string } | { serial_number: string }[] | null;
}

function toDraft(r: DraftRow): Draft {
  const secret = Array.isArray(r.secret) ? r.secret[0] : r.secret;
  return {
    id: r.id,
    category: r.category,
    title: r.title === DRAFT_TITLE ? '' : r.title,
    brand: r.brand ?? '',
    size: r.size_label ?? '',
    colour: r.colour ?? '',
    condition: r.condition_label,
    description: r.description ?? '',
    // A new draft holds 0 until the seller sets a price.
    pricePence: r.price_pence > 0 ? r.price_pence : null,
    parcelSize: r.parcel_size,
    declined: r.declined_shots ?? [],
    published: r.published,
    media: [...(r.media ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ id: m.id, shot: m.shot ?? '', kind: m.kind, url: mediaUrl(m.path) })),
    serial: secret?.serial_number ?? '',
    updatedAt: r.updated_at,
  };
}

/** Plain-English messages for the errors people actually meet. */
export function friendly(e: PostgrestError | AuthError | Error | { message: string; code?: string; name?: string }): string {
  const m = e.message ?? '';
  const code = String((e as { code?: unknown }).code ?? '');
  const name = (e as { name?: string }).name ?? '';
  if (code === 'passkey_disabled') return 'Passkey sign-in isn’t switched on yet. Use your email and password for now.';
  if (code === 'webauthn_credential_not_found') return 'That passkey isn’t linked to an account here. Sign in with your password, then add a passkey from your account page.';
  if (code === 'webauthn_credential_exists') return 'This device already has a passkey for your account.';
  if (code === 'too_many_passkeys') return 'You have the most passkeys allowed. Remove one first.';
  if (code === 'webauthn_challenge_expired' || code === 'webauthn_challenge_not_found') return 'That took too long. Try again.';
  if (code === 'ERROR_CEREMONY_ABORTED' || name === 'NotAllowedError' || /NotAllowedError|cancel|aborted|timed out/i.test(m)) return 'Passkey cancelled. Try again, or use your password.';
  if (code === 'same_password') return 'Choose a password different from your current one.';
  if (code === 'weak_password' || /weak|pwned|compromised/i.test(m)) return 'That password is too easy to guess, or has appeared in a data breach. Choose another.';
  if (/profiles_username_lower_idx|duplicate key.*username/i.test(m)) return 'That username is taken. Try another.';
  if (/profiles_username_format/.test(m)) return 'Use 3–30 letters, numbers, dots, dashes or underscores.';
  if (/profiles_bio_len/.test(m)) return 'Keep your bio to 500 characters.';
  if (/Not ready to publish/.test(m)) return m.replace('Not ready to publish:', 'Still needed:');
  if (/fixed once|cannot change once/.test(m)) return m;
  if (/Invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.';
  if (/already registered|already been registered/i.test(m)) return 'There is already an account with that email. Sign in instead.';
  if (/Password should be/i.test(m)) return 'Choose a password of at least 8 characters.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is too big. Photos and videos can be up to 50 MB.';
  if (/mime type|invalid_mime/i.test(m)) return 'That file type isn’t supported. Use a photo (JPEG, PNG) or a video (MP4, MOV).';
  if (/Failed to fetch|NetworkError|timeout/i.test(m)) return 'We couldn’t reach Provenance. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

const fail = (e: Parameters<typeof friendly>[0]): { ok: false; message: string } => ({ ok: false, message: friendly(e) });

function toPasskey(p: { id: string; friendly_name?: string; created_at: string; last_used_at?: string }): Passkey {
  return { id: p.id, name: p.friendly_name || 'Passkey', createdAt: p.created_at, lastUsedAt: p.last_used_at ?? null };
}

async function memberFromSession(): Promise<Member | null> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const { data: p } = await supabase().from('profiles').select('username').eq('id', user.id).maybeSingle();
  return { id: user.id, email: user.email ?? '', username: p?.username ?? (user.email ?? '').split('@')[0] };
}

async function uid(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

export const supabaseBackend: SellingBackend = {
  member: memberFromSession,

  onMemberChange(cb) {
    const { data } = supabase().auth.onAuthStateChange(() => {
      // Defer: calling Supabase inside this callback can deadlock its auth lock.
      setTimeout(() => void memberFromSession().then(cb), 0);
    });
    return () => data.subscription.unsubscribe();
  },

  async signIn(email, password) {
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) return fail(error);
    const m = await memberFromSession();
    return m ? { ok: true, value: m } : { ok: false, message: 'Signed in, but we couldn’t load your account.' };
  },

  async signUp(email, password) {
    const { data, error } = await supabase().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/signin` },
    });
    if (error) return fail(error);
    return { ok: true, value: { needsConfirmation: !data.session } };
  },

  async signOut() {
    await supabase().auth.signOut();
  },

  async signInWithPasskey() {
    const { error } = await supabase().auth.signInWithPasskey();
    if (error) return fail(error);
    const m = await memberFromSession();
    return m ? { ok: true, value: m } : { ok: false, message: 'Signed in, but we couldn’t load your account.' };
  },

  async requestPasswordReset(email) {
    const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset` });
    // Only rate limits and network problems are worth reporting; never whether the email has an account.
    if (error && /rate limit|fetch|network|timeout/i.test(error.message)) return fail(error);
    return { ok: true, value: undefined };
  },

  async setPassword(password) {
    const { error } = await supabase().auth.updateUser({ password });
    return error ? fail(error) : { ok: true, value: undefined };
  },

  onPasswordRecovery(cb) {
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setTimeout(cb, 0);
    });
    return () => data.subscription.unsubscribe();
  },

  async myProfile() {
    const me = await uid();
    if (!me) return null;
    const { data, error } = await supabase()
      .from('profiles')
      .select('username, bio, holiday_mode, kyc_verified, is_pro, created_at')
      .eq('id', me)
      .maybeSingle();
    if (error) throw new Error(friendly(error));
    if (!data) return null;
    return {
      username: data.username, bio: data.bio ?? '', holidayMode: data.holiday_mode,
      verified: data.kyc_verified, business: data.is_pro, joined: data.created_at,
    };
  },

  async saveProfile(f) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in first.' };
    const row: Record<string, unknown> = {};
    if (f.username !== undefined) row.username = f.username.trim();
    if (f.bio !== undefined) row.bio = f.bio.trim() || null;
    if (f.holidayMode !== undefined) row.holiday_mode = f.holidayMode;
    const { error } = await supabase().from('profiles').update(row).eq('id', me);
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async passkeys() {
    const { data, error } = await supabase().auth.passkey.list();
    return error ? fail(error) : { ok: true, value: (data ?? []).map(toPasskey) };
  },

  async addPasskey() {
    const { data, error } = await supabase().auth.registerPasskey();
    if (error) return fail(error);
    return { ok: true, value: { id: data.id, name: data.friendly_name || 'Passkey', createdAt: data.created_at, lastUsedAt: null } };
  },

  async renamePasskey(id, name) {
    const { error } = await supabase().auth.passkey.update({ passkeyId: id, friendlyName: name.trim().slice(0, 120) });
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async removePasskey(id) {
    const { error } = await supabase().auth.passkey.delete({ passkeyId: id });
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async myListings() {
    const me = await uid();
    if (!me) return [];
    const { data, error } = await supabase()
      .from('listings')
      .select(DRAFT_COLUMNS)
      .eq('seller_id', me)
      .gte('evidence_version', 1)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(friendly(error));
    return (data as unknown as DraftRow[]).map(toDraft);
  },

  async createDraft(category) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in to sell.' };
    const { data, error } = await supabase()
      .from('listings')
      .insert({ seller_id: me, title: DRAFT_TITLE, price_pence: 0, category, evidence_version: 1, published: false })
      .select('id')
      .single();
    return error ? fail(error) : { ok: true, value: data.id as string };
  },

  async getDraft(id) {
    const { data, error } = await supabase().from('listings').select(DRAFT_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(friendly(error));
    return data ? toDraft(data as unknown as DraftRow) : null;
  },

  async saveDraft(id, f) {
    const row: Record<string, unknown> = {};
    if (f.category !== undefined) row.category = f.category;
    if (f.title !== undefined) row.title = f.title.trim() || DRAFT_TITLE;
    if (f.brand !== undefined) row.brand = f.brand.trim() || null;
    if (f.size !== undefined) row.size_label = f.size.trim() || null;
    if (f.colour !== undefined) row.colour = f.colour.trim() || null;
    if (f.condition !== undefined) row.condition_label = f.condition;
    if (f.description !== undefined) row.description = f.description.trim() || null;
    if (f.pricePence !== undefined) row.price_pence = f.pricePence ?? 0;
    if (f.parcelSize !== undefined) row.parcel_size = f.parcelSize;
    if (f.parcelSize !== undefined && f.parcelSize) {
      row.shipping_pence = PARCEL_SIZES.find((p) => p.key === f.parcelSize)!.pence;
    }
    if (f.declined !== undefined) row.declined_shots = f.declined;
    const { error } = await supabase().from('listings').update(row).eq('id', id);
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async saveSerial(id, serial) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in to sell.' };
    const clean = serial.trim();
    if (!clean) {
      const { error } = await supabase().from('listing_secrets').delete().eq('listing_id', id);
      return error ? fail(error) : { ok: true, value: undefined };
    }
    const { error } = await supabase().from('listing_secrets').upsert({ listing_id: id, seller_id: me, serial_number: clean });
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async addMedia(id, shot, media) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in to sell.' };
    const path = `${me}/${id}/${shot}-${crypto.randomUUID()}.${media.extension}`;
    const up = await supabase().storage.from('listing-media').upload(path, media.blob, { contentType: media.contentType, upsert: false });
    if (up.error) return fail(up.error);
    const draft = await supabaseBackend.getDraft(id);
    const order = profileFor(draft?.category)?.shots.findIndex((s) => s.key === shot) ?? 0;
    const { data, error } = await supabase()
      .from('listing_media')
      .insert({ listing_id: id, seller_id: me, path, kind: media.kind, shot, position: Math.max(order, 0), width: media.width, height: media.height, sha256: media.sha256 })
      .select('id')
      .single();
    if (error) {
      await supabase().storage.from('listing-media').remove([path]);
      return fail(error);
    }
    return { ok: true, value: { id: data.id as string, shot, kind: media.kind, url: mediaUrl(path) } satisfies DraftMedia };
  },

  async removeMedia(_id, mediaId) {
    const { data, error } = await supabase().from('listing_media').delete().eq('id', mediaId).select('path').maybeSingle();
    if (error) return fail(error);
    if (data?.path) await supabase().storage.from('listing-media').remove([data.path]);
    return { ok: true, value: undefined };
  },

  async publish(id) {
    const { error } = await supabase().from('listings').update({ published: true }).eq('id', id);
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async deleteDraft(id) {
    const draft = await supabaseBackend.getDraft(id);
    if (!draft) return { ok: true, value: undefined };
    if (draft.published) return { ok: false, message: 'Live listings can’t be deleted here yet.' };
    const me = await uid();
    const { data: rows } = await supabase().from('listing_media').select('path').eq('listing_id', id);
    const { error } = await supabase().from('listings').delete().eq('id', id);
    if (error) return fail(error);
    const paths = (rows ?? []).map((r) => r.path as string).filter((p) => me && p.startsWith(`${me}/`));
    if (paths.length) await supabase().storage.from('listing-media').remove(paths);
    return { ok: true, value: undefined };
  },
};
