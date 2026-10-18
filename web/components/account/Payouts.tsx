'use client';

import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { PAYOUT_STATUS } from '@/lib/selling/trustAndSafety';
import type { PayoutSummary } from '@/lib/selling/types';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Getting paid: connect a bank account through Stripe, and see what's on its way. */
export function PayoutsPanel() {
  const { backend } = useMember();
  const [p, setP] = useState<PayoutSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // Back from Stripe's set-up page: ask Stripe how it went.
    const back = new URLSearchParams(window.location.search).get('payouts');
    (back ? backend.refreshPayoutStatus().then((r) => (r.ok ? r.value : backend.myPayouts())) : backend.myPayouts())
      .then(setP).catch(() => setP(null));
  }, [backend]);

  const setUp = async () => {
    setBusy(true);
    setMsg(null);
    const r = await backend.startPayoutSetup();
    if (r.ok && r.value.url) {
      window.location.assign(r.value.url);
      return;
    }
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setP(await backend.myPayouts());
    setMsg({ ok: true, text: 'Payouts are set up.' });
  };
  const dashboard = async () => {
    const r = await backend.payoutDashboard();
    if (r.ok) window.open(r.value.url, '_blank', 'noopener');
    else setMsg({ ok: false, text: r.message });
  };

  if (p === undefined) return null;
  const a = p?.account;
  return (
    <section className="pv-panel pv-payouts" id="payouts" aria-labelledby="payouts-h">
      <h2 id="payouts-h">Getting paid</h2>
      {a?.payoutsEnabled ? (
        <p>Payouts are set up. When a buyer confirms an item, your money is sent to your bank, usually within a few working days.</p>
      ) : a ? (
        <p>Stripe needs a few more details before it can pay you. It only takes a couple of minutes.</p>
      ) : (
        <p>To receive money for what you sell, add your bank details with Stripe, our payments partner. NuTuYu never sees your bank details.</p>
      )}
      {p && (p.waitingPence || p.sentPence) ? (
        <p className="pv-note">{formatPence(p.waitingPence)} on its way or waiting · {formatPence(p.sentPence)} paid so far</p>
      ) : null}
      <div className="pv-actions">
        {!a?.payoutsEnabled ? <Button variant="primary" disabled={busy} onClick={setUp}>{busy ? 'Opening Stripe…' : a ? 'Finish setting up payouts' : 'Set up payouts'}</Button> : null}
        {a ? <Button onClick={dashboard}>Payout details and bank account</Button> : null}
      </div>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      {p?.recent.length ? (
        <ul className="pv-payouts__list" aria-label="Recent payouts">
          {p.recent.map((r) => (
            <li key={r.id}>
              <span>{r.title}</span>
              <strong>{formatPence(r.amountPence)}</strong>
              <span className="pv-note">{PAYOUT_STATUS[r.status]} · {day(r.sentAt ?? r.createdAt)}{r.labelPence ? ` · label ${formatPence(r.labelPence)} taken off` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
