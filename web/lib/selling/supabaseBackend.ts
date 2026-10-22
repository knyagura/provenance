import type { AuthError, PostgrestError } from '@supabase/supabase-js';
import { mediaUrl } from '@/lib/domain/catalogue';
import { DRAFT_TITLE, PARCEL_SIZES, profileFor } from '@/lib/domain/evidence';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { BREACHED_MESSAGE, breachCount } from '@/lib/account/pwned';
import { breakdownFromJson } from '@/lib/domain/fees';
import { versionFromSnapshot, type ListingVersion } from '@/lib/domain/versions';
import { planFor, type Actor, type AgentTask, type CustodyEvent, type CustodyState, type CustodyView, type Evidence, type SealKind, type StepDef } from '@/lib/domain/custody';
import type { Tier } from '@/lib/domain/types';
import { supabaseBaskets } from './supabaseBaskets';
import { supabaseMarket } from './supabaseMarket';
import type { Draft, DraftFields, DraftMedia, Member, OrderSummary, Passkey, Result, SellingBackend } from './types';

const ORDER_COLUMNS =
  'id, listing_id, buyer_id, seller_id, payment_status, custody_state, custody_tier, custody_step, fees, total_pence, hold_expires_at, paid_at, created_at, listing_snapshot, ' +
  'listing:listings(title, media:listing_media(path, kind, position))';

interface OrderRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  payment_status: OrderSummary['paymentStatus'];
  custody_state: CustodyState;
  custody_tier: Tier | null;
  custody_step: number;
  fees: Record<string, unknown> | null;
  total_pence: number | null;
  hold_expires_at: string | null;
  paid_at: string | null;
  created_at: string;
  listing_snapshot: Record<string, unknown> | null;
  listing: { title: string; media: { path: string; kind: string; position: number }[] | null } | null;
}

function toOrder(r: OrderRow, me: string): OrderSummary {
  const bought = (r.listing_snapshot?.media as { path: string; kind: string }[] | undefined)?.find((m) => m.kind === 'photo');
  const photo = bought ?? [...(r.listing?.media ?? [])].filter((m) => m.kind === 'photo').sort((a, b) => a.position - b.position)[0];
  const fees = r.fees && Object.keys(r.fees).length && 'buyer_total_pence' in r.fees ? r.fees : null;
  return {
    id: r.id,
    listingId: r.listing_id,
    title: (r.listing_snapshot?.title as string | undefined) ?? r.listing?.title ?? 'Item',
    photoUrl: photo ? mediaUrl(photo.path) : null,
    role: r.buyer_id === me ? 'buyer' : 'seller',
    paymentStatus: r.payment_status,
    custody: r.payment_status === 'paid' && r.custody_tier ? { state: r.custody_state, tier: r.custody_tier, step: r.custody_step } : null,
    quote: breakdownFromJson(fees),
    bought: versionFromSnapshot(r.listing_snapshot),
    totalPence: r.total_pence,
    holdExpiresAt: r.hold_expires_at,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  };
}

interface CustodyJson {
  order_id: string;
  listing_id: string;
  title: string;
  tier: Tier;
  state: CustodyState;
  current: StepDef | null;
  events: { seq: number; step: string; actor_role: CustodyEvent['actorRole']; at: string; evidence: Evidence; hash: string; mine: boolean }[];
  my_roles: Actor[];
  chain_ok: boolean;
  head: string;
  weight_flag: boolean;
  dispute_reason: string | null;
  payout_status: CustodyView['payoutStatus'];
  challenge: { code: string; expires_at: string } | null;
  seal: { kind: SealKind; code: string } | null;
}

const EVIDENCE_BUCKET = 'custody-media';

async function toCustody(j: CustodyJson | null): Promise<CustodyView | null> {
  if (!j) return null;
  const paths = j.events.map((e) => e.evidence.media).filter((p): p is string => typeof p === 'string');
  const mediaUrls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await supabase().storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) mediaUrls[d.path] = d.signedUrl;
  }
  return {
    orderId: j.order_id, listingId: j.listing_id, title: j.title, tier: j.tier, state: j.state, current: j.current,
    events: j.events.map((e) => ({ seq: e.seq, step: e.step, actorRole: e.actor_role, at: e.at, evidence: e.evidence, hash: e.hash, mine: e.mine })),
    myRoles: j.my_roles, chainOk: j.chain_ok, head: j.head, weightFlag: j.weight_flag, disputeReason: j.dispute_reason,
    payoutStatus: j.payout_status, mediaUrls,
    challenge: j.challenge ? { code: j.challenge.code, expiresAt: j.challenge.expires_at } : null,
    seal: j.seal,
  };
}

// Selling through Supabase with the signed-in member's session. Row Level Security and the database's
// listing rules (migration 006) decide what is allowed; this file only translates.

const DRAFT_COLUMNS =
  'id, category, materials, title, brand, size_label, colour, condition_label, description, price_pence, parcel_size, declined_shots, published, revision, status, updated_at, ' +
  'media:listing_media(id, shot, kind, path, created_at, retired_at), secret:listing_secrets(serial_number)';

interface DraftRow {
  id: string;
  category: string | null;
  materials: string[] | null;
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
  revision: number;
  status: Draft['status'];
  updated_at: string;
  media: { id: string; shot: string | null; kind: 'photo' | 'video'; path: string; created_at: string; retired_at: string | null }[] | null;
  secret: { serial_number: string } | { serial_number: string }[] | null;
}

function toDraft(r: DraftRow): Draft {
  const secret = Array.isArray(r.secret) ? r.secret[0] : r.secret;
  return {
    id: r.id,
    category: r.category,
    materials: r.materials ?? [],
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
    revision: r.revision ?? 0,
    status: r.status ?? 'active',
    media: [...(r.media ?? [])]
      .filter((m) => !m.retired_at)
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
  if (/LISTING_CHANGED/.test(m)) return 'The seller changed this listing while you were looking. Check the changes before you pay.';
  if (/fixed once|cannot change once|buying this right now|not available to buy|cannot buy your own|Sign in to buy|can't be changed|kept for its history|Pause the listing/.test(m)) return m;
  if (/Invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.';
  if (/already registered|already been registered/i.test(m)) return 'There is already an account with that email. Sign in instead.';
  if (/Password should be/i.test(m)) return 'Choose a password of at least 8 characters.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is too big. Photos and videos can be up to 50 MB.';
  if (/mime type|invalid_mime/i.test(m)) return 'That file type isn’t supported. Use a photo (JPEG, PNG) or a video (MP4, MOV).';
  if (/Failed to fetch|NetworkError|timeout/i.test(m)) return 'We couldn’t reach NuTuYu. Check your connection and try again.';
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
  ...supabaseMarket,
  ...supabaseBaskets,
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

  async socialProviders() {
    try {
      const r = await fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseKey } });
      const j = await r.json();
      return { google: !!j?.external?.google, facebook: !!j?.external?.facebook };
    } catch {
      return { google: false, facebook: false };
    }
  },

  async signInWithProvider(provider, next) {
    const { error } = await supabase().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        scopes: provider === 'facebook' ? 'email public_profile' : undefined,
      },
    });
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async signUp(email, password) {
    if ((await breachCount(password)) > 0) return { ok: false, message: BREACHED_MESSAGE };
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
    if ((await breachCount(password)) > 0) return { ok: false, message: BREACHED_MESSAGE };
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
      .select('username, bio, holiday_mode, kyc_verified, is_pro, created_at, area, area_lat, area_lng, collection_ok')
      .eq('id', me)
      .maybeSingle();
    if (error) throw new Error(friendly(error));
    if (!data) return null;
    return {
      username: data.username, bio: data.bio ?? '', holidayMode: data.holiday_mode,
      verified: data.kyc_verified, business: data.is_pro, joined: data.created_at,
      area: data.area ? { district: data.area, lat: Number(data.area_lat), lng: Number(data.area_lng) } : null,
      collectionOk: Boolean(data.collection_ok),
    };
  },

  async saveProfile(f) {
    const me = await uid();
    if (!me) return { ok: false, message: 'Sign in first.' };
    const row: Record<string, unknown> = {};
    if (f.username !== undefined) row.username = f.username.trim();
    if (f.bio !== undefined) row.bio = f.bio.trim() || null;
    if (f.holidayMode !== undefined) row.holiday_mode = f.holidayMode;
    if (f.area !== undefined) Object.assign(row, { area: f.area?.district ?? null, area_lat: f.area?.lat ?? null, area_lng: f.area?.lng ?? null });
    if (f.collectionOk !== undefined) row.collection_ok = f.collectionOk;
    if (f.area === null) row.collection_ok = false;
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
    if (f.materials !== undefined) row.materials = f.materials;
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

  async removeMedia(id, mediaId) {
    // A listing that has been live keeps every photo for its history: retire it instead of deleting.
    const { data: l } = await supabase().from('listings').select('revision').eq('id', id).maybeSingle();
    if ((l?.revision ?? 0) > 0) {
      const { error } = await supabase().from('listing_media').update({ retired_at: new Date().toISOString() }).eq('id', mediaId);
      return error ? fail(error) : { ok: true, value: undefined };
    }
    const { data, error } = await supabase().from('listing_media').delete().eq('id', mediaId).select('path').maybeSingle();
    if (error) return fail(error);
    if (data?.path) await supabase().storage.from('listing-media').remove([data.path]);
    return { ok: true, value: undefined };
  },

  async publish(id) {
    const { error } = await supabase().from('listings').update({ published: true }).eq('id', id);
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async pauseForEditing(id) {
    const { error } = await supabase().from('listings').update({ published: false }).eq('id', id);
    return error ? fail(error) : { ok: true, value: undefined };
  },

  async quote(listingId) {
    const { data, error } = await supabase().rpc('order_quote', { p_listing: listingId });
    if (error) throw new Error(friendly(error));
    return breakdownFromJson(data as Record<string, unknown> | null);
  },

  async startCheckout(listingId, revision) {
    const { data, error } = revision === undefined
      ? await supabase().rpc('start_checkout', { p_listing: listingId })
      : await supabase().rpc('start_checkout', { p_listing: listingId, p_revision: revision });
    if (error) return { ...fail(error), code: /LISTING_CHANGED/.test(error.message) ? 'listing_changed' : undefined };
    const d = data as { order_id: string; quote: Record<string, unknown>; hold_expires_at: string; revision: number | null };
    return { ok: true, value: { orderId: d.order_id, quote: breakdownFromJson(d.quote)!, holdExpiresAt: d.hold_expires_at, revision: d.revision ?? null } };
  },

  async listingNow(listingId) {
    const { data, error } = await supabase()
      .from('listings')
      .select('revision, title, description, brand, size_label, colour, condition_label, price_pence, shipping_pence, serial_hint, media:listing_media(path, kind, shot, position, created_at, retired_at)')
      .eq('id', listingId)
      .maybeSingle();
    if (error || !data) return null;
    const media = [...((data.media as { path: string; kind: 'photo' | 'video'; shot: string | null; position: number; created_at: string; retired_at: string | null }[]) ?? [])]
      .filter((m) => !m.retired_at)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    return {
      revision: data.revision, title: data.title, description: data.description, brand: data.brand, size: data.size_label, colour: data.colour,
      condition: data.condition_label, pricePence: data.price_pence, shippingPence: data.shipping_pence, serialHint: data.serial_hint,
      // Compared with what the page showed, which uses public URLs.
      media: media.map((m) => ({ path: mediaUrl(m.path), kind: m.kind, shot: m.shot })),
    } satisfies ListingVersion;
  },

  async startPayment(orderId) {
    const { data, error } = await supabase().functions.invoke('checkout', { body: { order_id: orderId } });
    if (error) {
      // The function answers with { error, message }; read it from the response when there is one.
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (body?.error === 'payments_not_configured') {
        return { ok: false, code: 'not_configured', message: 'Payments aren’t switched on yet, so no money has been taken.' };
      }
      return { ok: false, code: body?.error, message: body?.message ?? friendly(error) };
    }
    return { ok: true, value: { kind: 'stripe', clientSecret: data.client_secret, publishableKey: data.publishable_key, amountPence: data.amount_pence } };
  },

  async simulatePayment() {
    return { ok: false, message: 'Test payments only work in example mode.' };
  },

  async cancelCheckout(orderId) {
    await supabase().rpc('cancel_checkout', { p_order: orderId });
  },

  async getOrder(orderId) {
    const me = await uid();
    if (!me) return null;
    const { data, error } = await supabase().from('orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
    if (error) throw new Error(friendly(error));
    return data ? toOrder(data as unknown as OrderRow, me) : null;
  },

  async myOrders() {
    const me = await uid();
    if (!me) return [];
    const { data, error } = await supabase()
      .from('orders')
      .select(ORDER_COLUMNS)
      .or(`buyer_id.eq.${me},seller_id.eq.${me}`)
      .neq('payment_status', 'legacy')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(friendly(error));
    return (data as unknown as OrderRow[]).map((r) => toOrder(r, me));
  },

  async custody(orderId) {
    const { data, error } = await supabase().rpc('order_custody', { p_order: orderId });
    if (error) throw new Error(friendly(error));
    return toCustody(data as CustodyJson | null);
  },

  async issueChallenge(orderId) {
    const { data, error } = await supabase().rpc('issue_challenge', { p_order: orderId });
    if (error) return fail(error);
    const d = data as { code: string; expires_at: string };
    return { ok: true, value: { code: d.code, expiresAt: d.expires_at } };
  },

  async issueSeal(orderId) {
    const { data, error } = await supabase().rpc('issue_seal', { p_order: orderId });
    return error ? fail(error) : { ok: true, value: data as { kind: string; code: string } };
  },

  async uploadEvidence(orderId, media) {
    const path = `${orderId}/${crypto.randomUUID()}.${media.extension}`;
    const { error } = await supabase().storage.from(EVIDENCE_BUCKET).upload(path, media.blob, { contentType: media.contentType, upsert: false });
    return error ? fail(error) : { ok: true, value: { path, sha256: media.sha256, kind: media.kind } };
  },

  async recordStep(orderId, step, evidence) {
    const { data, error } = await supabase().rpc('record_custody_step', { p_order: orderId, p_step: step, p_evidence: evidence });
    if (error) return fail(error);
    const v = await toCustody(data as CustodyJson);
    return v ? { ok: true, value: v } : { ok: false, message: 'Order not found.' };
  },

  async openDispute(orderId, reason, note) {
    const { data, error } = await supabase().rpc('open_dispute', { p_order: orderId, p_reason: reason, p_note: note });
    if (error) return fail(error);
    const v = await toCustody(data as CustodyJson);
    return v ? { ok: true, value: v } : { ok: false, message: 'Order not found.' };
  },

  async agentTasks() {
    const { data, error } = await supabase().rpc('agent_queue');
    if (error) throw new Error(friendly(error));
    return ((data as { order_id: string; title: string; tier: Tier; state: CustodyState; step: string | null; updated_at: string | null }[]) ?? []).map((t) => {
      const step = t.step ? planFor(t.tier).find((p) => p.key === t.step) ?? null : null;
      return { orderId: t.order_id, title: t.title, tier: t.tier, state: t.state, step, updatedAt: t.updated_at } satisfies AgentTask;
    });
  },

  async deleteListing(id) {
    const { error } = await supabase().rpc('delete_listing_if_safe', { p_listing: id });
    if (error) return fail(error);
    return { ok: true, value: undefined };
  },

  async deleteDraft(id) {
    const draft = await supabaseBackend.getDraft(id);
    if (!draft) return { ok: true, value: undefined };
    if (draft.published || draft.revision > 0) return { ok: false, message: 'A listing that has been live is kept for its history. Pause it to take it off sale.' };
    const me = await uid();
    const { data: rows } = await supabase().from('listing_media').select('path').eq('listing_id', id);
    const { error } = await supabase().from('listings').delete().eq('id', id);
    if (error) return fail(error);
    const paths = (rows ?? []).map((r) => r.path as string).filter((p) => me && p.startsWith(`${me}/`));
    if (paths.length) await supabase().storage.from('listing-media').remove(paths);
    return { ok: true, value: undefined };
  },
};
