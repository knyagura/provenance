'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import type { CheckoutCodes } from '@/lib/selling';

/**
 * At checkout: a voucher or gift card code, and the member's NuTuYu balance. The server works out the
 * discount and what's left to pay by card; onChange gets the new figures (paid: nothing left to pay).
 */
export function CodesBox({ target, onChange }: { target: string; onChange: (c: CheckoutCodes) => void }) {
  const { backend } = useMember();
  const id = useId();
  const [codes, setCodes] = useState<CheckoutCodes | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.checkoutCodes(target).then(setCodes).catch(() => setCodes(null));
  }, [backend, target]);

  const done = useCallback((r: { ok: true; value: CheckoutCodes } | { ok: false; message: string }) => {
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setCodes(r.value);
    onChange(r.value);
  }, [onChange]);

  if (!codes) return null;
  const apply = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    done(await backend.applyCode(target, code));
    setCode('');
  };
  const canBalance = codes.balanceAvailable > 0 || codes.balancePence > 0;
  return (
    <div className="pv-codes">
      {codes.voucher ? (
        <div className="pv-summary-line">
          <span>Code <strong className="pv-mono">{codes.voucher.code}</strong>{codes.voucher.shop ? <span className="pv-note"> · from {codes.voucher.shop}</span> : null}</span>
          <span>−{formatPence(codes.voucher.discountPence)} <Button variant="quiet" disabled={busy} onClick={async () => { setBusy(true); done(await backend.removeVoucher(target)); }} aria-label={`Remove code ${codes.voucher.code}`}>Remove</Button></span>
        </div>
      ) : (
        <form className="pv-codes__form" onSubmit={apply}>
          <label htmlFor={`${id}-code`}>Voucher or gift card code</label>
          <span className="pv-codes__row">
            <input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} />
            <Button type="submit" variant="secondary" disabled={busy || !code.trim()}>Apply</Button>
          </span>
        </form>
      )}
      {canBalance ? (
        <label className="pv-check">
          <input type="checkbox" checked={codes.balancePence > 0} disabled={busy}
            onChange={async (e) => { setBusy(true); done(await backend.useBalance(target, e.target.checked)); }} />
          {codes.balancePence > 0 ? `Using ${formatPence(codes.balancePence)} of your NuTuYu balance` : `Use my NuTuYu balance (${formatPence(codes.balanceAvailable)})`}
        </label>
      ) : null}
      {codes.voucher || codes.balancePence ? (
        <div className="pv-summary-line pv-summary-line--total"><span>To pay by card</span><span>{formatPence(codes.totalPence)}</span></div>
      ) : null}
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {!canBalance ? <p className="pv-note">Got a gift card? Enter its code here, or add it to your balance in <Link href="/gift-cards">Gift cards</Link>.</p> : null}
    </div>
  );
}
