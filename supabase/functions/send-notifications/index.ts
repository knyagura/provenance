// Supabase Edge Function: send-notifications. Sends waiting notification emails with Resend.
// Called every minute by pg_cron (migration 016b). Deployed with verify_jwt off: it takes no input and
// only sends what the database has queued, so calling it more often sends nothing extra.
//
// Function secrets (set by the project owner in Supabase, never in code or chat):
//   RESEND_API_KEY  required; without it nothing is sent and the emails wait (up to 2 days)
//   RESEND_FROM     optional, e.g. "NuTuYu <hello@your-domain>"; defaults to Resend's test sender,
//                   which only delivers to the Resend account's own address
//   SITE_URL        optional, defaults to the Netlify site
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase itself.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

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
  dispute: 'See the order', decision: 'See the order',
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

Deno.serve(async () => {
  if (!KEY) return Response.json({ sent: 0, waiting: 'RESEND_API_KEY is not set' });
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
  return Response.json({ sent, failed });
});
