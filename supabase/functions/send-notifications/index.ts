// Supabase Edge Function: send-notifications. Sends waiting notification emails with Resend.
// Called every minute by pg_cron (migrations 016b, 017). Deployed with verify_jwt off because it checks its
// own caller: the x-worker-token header must match the token kept in Supabase Vault (migration 017).
//
// Function secrets (set by the project owner in Supabase, never in code or chat):
//   RESEND_API_KEY  required; without it nothing is sent and the emails wait (up to 2 days)
//   RESEND_FROM     optional, e.g. "NuTuYu <hello@your-domain>"; defaults to Resend's test sender,
//                   which only delivers to the Resend account's own address
//   SITE_URL        optional, defaults to the Netlify site
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase itself.
// Pushes to phones and desktops (migration 034) need no setup: the first run makes the Web Push keys and keeps them in Vault.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import webpush from 'npm:web-push@3.6.7';

const KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('RESEND_FROM') || 'NuTuYu <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') || 'https://lucky-gnome-de81b6.netlify.app').replace(/\/$/, '');

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Row { id: string; email: string | null; username: string | null; kind: string; title: string; body: string; link: string; count: number }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ACTION: Record<string, string> = {
  turn: 'Open the order', message: 'Read and reply', offer_new: 'Answer the offer', offer_counter: 'Answer the offer',
  offer_accepted: 'See the offer', offer_expiring: 'See the offer', sold: 'Start the handover', payout: 'See the order',
  dispute: 'See the order', decision: 'See the order', search_match: 'See the item', price_drop: 'See the item',
};

function email(r: Row) {
  const url = SITE + (r.link.startsWith('/') ? r.link : '/inbox');
  const hi = r.username ? `Hi ${esc(r.username)},` : 'Hi,';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ee;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2a20">
<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="font-weight:700;font-size:18px;margin:0 0 16px">NuTuYu</p>
<div style="background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 12px">${hi}</p>
<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${esc(r.title)}</h1>
<p style="margin:0 0 20px;line-height:1.5;white-space:pre-line">${esc(r.body)}</p>
<a href="${esc(url)}" style="display:inline-block;background:#3d5a40;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">${ACTION[r.kind] ?? 'Open NuTuYu'}</a>
</div>
<p style="font-size:13px;color:#5b6b5e;line-height:1.5;margin:16px 0 0">You get this email because you have an account on NuTuYu.
<a href="${esc(SITE)}/profile#notifications" style="color:#3d5a40">Choose which emails you get</a>.</p>
</div></body></html>`;
  const text = `${hi}\n\n${r.title}\n\n${r.body}\n\n${url}\n\nChoose which emails you get: ${SITE}/profile#notifications`;
  return { from: FROM, to: [r.email!], subject: r.title, html, text, headers: { 'List-Unsubscribe': `<${SITE}/profile#notifications>` } };
}

Deno.serve(async (req) => {
  const token = req.headers.get('x-worker-token');
  const { data: allowed } = await admin.rpc('notification_worker_ok', { p_token: token });
  if (allowed !== true) return Response.json({ error: 'forbidden' }, { status: 403 });
  const pushed = await sendPushes().catch((e) => ({ pushed: 0, push_error: String(e).slice(0, 200) }));
  if (!KEY) return Response.json({ sent: 0, waiting: 'RESEND_API_KEY is not set', ...pushed });
  const { data, error } = await admin.rpc('notification_outbox_claim', { p_limit: 25 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  let failed = 0;
  for (const r of (data ?? []) as Row[]) {
    if (!r.email) {
      await admin.rpc('notification_outbox_done', { p_id: r.id, p_ok: false, p_error: 'no email address' });
      failed++;
      continue;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `notification-${r.id}-${r.count}` },
        body: JSON.stringify(email(r)),
      });
      const ok = res.ok;
      await admin.rpc('notification_outbox_done', { p_id: r.id, p_ok: ok, p_error: ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}` });
      if (ok) sent++;
      else failed++;
    } catch (e) {
      await admin.rpc('notification_outbox_done', { p_id: r.id, p_ok: false, p_error: String(e).slice(0, 200) });
      failed++;
    }
  }
  // Emails to people without an account yet (gift cards sent to them).
  const { data: plain } = await admin.rpc('email_outbox_claim', { p_limit: 25 });
  for (const m of (plain ?? []) as { id: string; to_email: string; subject: string; body: string; link: string | null }[]) {
    try {
      const url = SITE + (m.link?.startsWith('/') ? m.link : '/');
      const html = `<!doctype html><html><body style="margin:0;background:#f6f4ee;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2a20">
<div style="max-width:520px;margin:0 auto;padding:24px"><p style="font-weight:700;font-size:18px;margin:0 0 16px">NuTuYu</p>
<div style="background:#fff;border-radius:12px;padding:24px"><h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${esc(m.subject)}</h1>
<p style="margin:0 0 20px;line-height:1.5;white-space:pre-line">${esc(m.body)}</p>
<a href="${esc(url)}" style="display:inline-block;background:#3d5a40;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">Open NuTuYu</a></div></div></body></html>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `outbox-${m.id}` },
        body: JSON.stringify({ from: FROM, to: [m.to_email], subject: m.subject, html, text: `${m.body}\n\n${url}` }),
      });
      await admin.rpc('email_outbox_done', { p_id: m.id, p_ok: res.ok, p_error: res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}` });
      if (res.ok) sent++;
      else failed++;
    } catch (e) {
      await admin.rpc('email_outbox_done', { p_id: m.id, p_ok: false, p_error: String(e).slice(0, 200) });
      failed++;
    }
  }
  return Response.json({ sent, failed, ...pushed });
});

/** Web Push: the Vault keys (made on the first run), then each waiting notification to each of the member's devices. */
async function sendPushes(): Promise<{ pushed: number; push_failed?: number }> {
  let { data: keys } = await admin.rpc('push_vapid');
  if (!keys) {
    const k = webpush.generateVAPIDKeys();
    await admin.rpc('push_vapid_set', { p_public: k.publicKey, p_private: k.privateKey });
    ({ data: keys } = await admin.rpc('push_vapid'));
  }
  if (!keys) return { pushed: 0 };
  const { data, error } = await admin.rpc('push_outbox_claim', { p_limit: 100 });
  if (error) throw error;
  let pushed = 0;
  let failed = 0;
  for (const n of (data ?? []) as { id: string; title: string; body: string; link: string; devices: { endpoint: string; p256dh: string; auth: string }[] }[]) {
    const gone: string[] = [];
    let any = false;
    const payload = JSON.stringify({ title: n.title, body: n.body.slice(0, 180), url: SITE + (n.link?.startsWith('/') ? n.link : '/inbox'), tag: n.id });
    for (const d of n.devices) {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload,
          { TTL: 3600, urgency: 'normal', vapidDetails: { subject: SITE, publicKey: keys.public, privateKey: keys.private } });
        any = true;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(d.endpoint);
      }
    }
    await admin.rpc('push_done', { p_id: n.id, p_ok: any, p_gone: gone.length ? gone : null });
    if (any) pushed++;
    else failed++;
  }
  return { pushed, push_failed: failed };
}
