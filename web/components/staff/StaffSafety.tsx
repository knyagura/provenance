'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { REPORT_REASONS } from '@/lib/selling/trustAndSafety';
import type { ModerationAction, PayoutStatus, StaffModeration, StaffPayouts } from '@/lib/selling/types';

const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATUS: Record<PayoutStatus, string> = { waiting: 'Waiting for seller', queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', held: 'Held' };

/** Staff: every payout, with hold, release and retry (each needs a note, kept with the decision). */
export function StaffPayoutsPanel() {
  const { backend } = useMember();
  const id = useId();
  const [filter, setFilter] = useState<PayoutStatus | ''>('');
  const [d, setD] = useState<StaffPayouts | null | undefined>(undefined);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => backend.staffPayouts(filter || null).then(setD).catch(() => setD(null)), [backend, filter]);
  useEffect(() => { load(); }, [load]);
  const act = async (pid: string, action: 'hold' | 'release' | 'retry') => {
    setError(null);
    const r = await backend.staffPayoutAction(pid, action, notes[pid] ?? '');
    if (!r.ok) return setError(r.message);
    await load();
  };
  if (d === undefined) return <p role="status">Loading payouts…</p>;
  if (!d) return <p className="pv-errors" role="alert">Couldn’t load payouts.</p>;
  return (
    <div className="pv-report">
      <dl className="pv-stats" aria-label="Payouts by status">
        {(['waiting', 'queued', 'failed', 'held', 'sent'] as PayoutStatus[]).map((s) => (
          <div key={s}><dt>{STATUS[s]}</dt><dd>{d.counts[s] ?? 0}<span className="pv-note"> · {formatPence(d.totals[s] ?? 0)}</span></dd></div>
        ))}
      </dl>
      <div className="pv-field pv-field--inline">
        <label htmlFor={`${id}-f`}>Show</label>
        <select id={`${id}-f`} value={filter} onChange={(e) => setFilter(e.target.value as PayoutStatus | '')}>
          <option value="">Everything</option>
          {(Object.keys(STATUS) as PayoutStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
        </select>
      </div>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {d.items.length ? (
        <ul className="pv-staff-list" aria-label="Payouts">
          {d.items.map((p) => (
            <li key={p.id} className="pv-panel">
              <p><strong>{formatPence(p.amountPence)}</strong> to {p.seller} · {STATUS[p.status]} · <Link href={`/orders/${p.orderId}`}>order</Link></p>
              <p className="pv-note">
                {p.connected ? (p.payoutsEnabled ? 'Stripe account ready' : 'Stripe set-up unfinished') : 'No Stripe account yet'} · updated {at(p.updatedAt)}
                {p.attempts ? ` · ${p.attempts} ${p.attempts === 1 ? 'try' : 'tries'}` : ''}{p.lastError ? ` · ${p.lastError}` : ''}{p.holdReason ? ` · held: ${p.holdReason}` : ''}
              </p>
              {['waiting', 'queued', 'failed', 'held'].includes(p.status) ? (
                <div className="pv-actions">
                  <label className="pv-visually-hidden" htmlFor={`${id}-${p.id}`}>Note for payout to {p.seller}</label>
                  <input id={`${id}-${p.id}`} placeholder="Note (required)" value={notes[p.id] ?? ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                  {p.status === 'held' ? <Button onClick={() => act(p.id, 'release')}>Release</Button> : <Button onClick={() => act(p.id, 'hold')}>Hold</Button>}
                  {p.status === 'failed' ? <Button onClick={() => act(p.id, 'retry')}>Retry</Button> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p>No payouts here.</p>}
    </div>
  );
}

/** Staff: reported listings and members, grouped, with hide, suspend, restore and dismiss. */
export function StaffModerationPanel() {
  const { backend } = useMember();
  const id = useId();
  const [status, setStatus] = useState<'open' | 'actioned' | 'dismissed'>('open');
  const [d, setD] = useState<StaffModeration | null | undefined>(undefined);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => backend.staffModeration(status).then(setD).catch(() => setD(null)), [backend, status]);
  useEffect(() => { load(); }, [load]);
  const act = async (key: string, target: { listingId: string } | { member: string }, action: ModerationAction, label: string) => {
    setError(null);
    setDone(null);
    const r = await backend.staffModerate(target, action, notes[key] ?? '');
    if (!r.ok) return setError(r.message);
    setDone(label);
    await load();
  };
  if (d === undefined) return <p role="status">Loading reports…</p>;
  if (!d) return <p className="pv-errors" role="alert">Couldn’t load reports.</p>;
  return (
    <div className="pv-report">
      <dl className="pv-stats" aria-label="Moderation">
        <div><dt>Open reports</dt><dd>{d.open}</dd></div>
        <div><dt>Hidden listings</dt><dd>{d.hidden}</dd></div>
        <div><dt>Suspended members</dt><dd>{d.suspended}</dd></div>
      </dl>
      <div className="pv-field pv-field--inline">
        <label htmlFor={`${id}-s`}>Show</label>
        <select id={`${id}-s`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Open</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option>
        </select>
      </div>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {done ? <p className="pv-note" role="status">{done}</p> : null}
      {d.items.length ? (
        <ul className="pv-staff-list" aria-label="Reports">
          {d.items.map((g) => {
            const key = g.listingId ?? `m:${g.member}`;
            const target = g.listingId ? { listingId: g.listingId } : { member: g.member! };
            return (
              <li key={key} className="pv-panel">
                <p>
                  <strong>{g.kind === 'listing' ? (g.listingId ? <Link href={`/item/${g.listingId}`}>{g.title}</Link> : g.title) : g.member}</strong>
                  {g.kind === 'listing' && g.member ? <> by <Link href={`/member/${encodeURIComponent(g.member)}`}>{g.member}</Link></> : null}
                  {' · '}{g.count} {g.count === 1 ? 'report' : 'reports'}{g.hidden ? ' · hidden' : ''}{g.suspended ? ' · member suspended' : ''}
                </p>
                <p className="pv-note">{g.reasons.map((r) => REPORT_REASONS[r] ?? r).join(' · ')} · latest {at(g.latest)}</p>
                {g.notes.length ? <ul className="pv-list">{g.notes.slice(0, 5).map((n, i) => <li key={i}>“{n}”</li>)}</ul> : null}
                {status === 'open' || g.hidden || g.suspended ? (
                  <div className="pv-actions">
                    <label className="pv-visually-hidden" htmlFor={`${id}-${key}`}>Note for {g.title ?? g.member}</label>
                    <input id={`${id}-${key}`} placeholder="Note to the member (required)" value={notes[key] ?? ''} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} />
                    {status === 'open' ? <Button onClick={() => act(key, target, 'dismiss', 'Dismissed.')}>Dismiss</Button> : null}
                    {g.listingId && !g.hidden ? <Button onClick={() => act(key, target, 'hide_listing', 'Listing hidden.')}>Hide listing</Button> : null}
                    {g.listingId && g.hidden ? <Button onClick={() => act(key, target, 'restore_listing', 'Listing restored.')}>Restore listing</Button> : null}
                    {g.member && !g.suspended ? <Button onClick={() => act(key, { member: g.member! }, 'suspend', `${g.member} suspended.`)}>Suspend {g.member}</Button> : null}
                    {g.member && g.suspended ? <Button onClick={() => act(key, { member: g.member! }, 'restore_member', `${g.member} restored.`)}>Restore {g.member}</Button> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p>{status === 'open' ? 'No open reports.' : 'Nothing here.'}</p>}
    </div>
  );
}
