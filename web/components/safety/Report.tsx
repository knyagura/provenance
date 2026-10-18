'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { REPORT_REASONS } from '@/lib/selling/trustAndSafety';
import type { ReportReason } from '@/lib/selling/types';

/** "Report this listing / member": a reason and an optional note, read by NuTuYu staff. */
export function ReportButton({ target, label }: { target: { listingId: string } | { member: string }; label: string }) {
  const { backend, member } = useMember();
  const path = usePathname() ?? '/';
  const id = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMine = !!member && 'member' in target && target.member.toLowerCase() === member.username.toLowerCase();
  if (isMine) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError('Choose a reason.');
    setBusy(true);
    const r = await backend.report(target, reason, note);
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.message);
  };

  return (
    <details className="pv-report-btn">
      <summary>{label}</summary>
      {done ? <p role="status">Thanks. Our team will look at it. We don’t tell the seller who reported it.</p> : !member ? (
        <p><Link href={`/signin?next=${encodeURIComponent(path)}`}>Sign in</Link> to report this.</p>
      ) : (
        <form className="pv-form" onSubmit={send}>
          <fieldset className="pv-field pv-choices">
            <legend>What’s wrong?</legend>
            {(Object.keys(REPORT_REASONS) as ReportReason[]).filter((k) => 'listingId' in target || k !== 'wrong_category').map((k) => (
              <label key={k} className="pv-choice">
                <input type="radio" name={`${id}-r`} checked={reason === k} onChange={() => setReason(k)} />
                <span>{REPORT_REASONS[k]}</span>
              </label>
            ))}
          </fieldset>
          <div className="pv-field">
            <label htmlFor={`${id}-n`}>Anything else we should know{reason === 'other' ? '' : ' (optional)'}</label>
            <textarea id={`${id}-n`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
          <div className="pv-actions"><Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</Button></div>
        </form>
      )}
    </details>
  );
}
