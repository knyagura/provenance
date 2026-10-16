'use client';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { CustodyView } from '@/lib/domain/custody';

const KIND: Record<string, string> = { proof: 'ProofSeal: fit across the parcel opening', proof_b: 'ProofSeal (second leg): fit across the parcel opening', item: 'Item Seal: fit to the item' };

/** A printable sheet with the seal code the member holds for this order, as text and as a QR code. */
export function SealLabels({ orderId }: { orderId: string }) {
  const { member, loading, backend } = useMember();
  const [view, setView] = useState<CustodyView | null | undefined>(undefined);
  const [qr, setQr] = useState<string | null>(null);
  const [copies, setCopies] = useState(2);

  useEffect(() => {
    if (!member) return;
    backend.custody(orderId).then(setView).catch(() => setView(null));
  }, [member, backend, orderId]);
  useEffect(() => {
    if (!view?.seal) return;
    QRCode.toDataURL(`nutuyu:seal:${view.seal.code}`, { errorCorrectionLevel: 'M', margin: 1, width: 280 }).then(setQr).catch(() => setQr(null));
  }, [view?.seal]);

  if (loading || (member && view === undefined)) return <p role="status">Loading…</p>;
  if (!member) return <p><Link href={`/signin?next=/orders/${orderId}/labels`}>Sign in</Link> to print seal labels.</p>;
  const back = <p className="pv-noprint"><Link href={`/orders/${orderId}`}>Back to the order</Link></p>;
  if (!view?.seal) {
    return (
      <section className="pv-section pv-narrow">
        <h1>No seal code yet</h1>
        <p className="pv-lead">A seal code is issued at the step where you fit a seal. Get the code on the order page first, then come back to print it.</p>
        {back}
      </section>
    );
  }
  const seal = view.seal;
  return (
    <section className="pv-section">
      <div className="pv-noprint">
        <h1>Seal labels</h1>
        <p className="pv-lead">Print these and stick one to the seal, or next to it, so the next person can scan it. Only print for this order: each code belongs to one parcel.</p>
        <div className="pv-actions">
          <label className="pv-field pv-field--inline">
            <span>Copies</span>
            <select value={copies} onChange={(e) => setCopies(Number(e.target.value))}>{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <Button variant="primary" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <div className="pv-labels" aria-label="Labels to print">
        {Array.from({ length: copies }, (_, i) => (
          <div className="pv-label" key={i}>
            {qr ? <img src={qr} alt={`QR code for seal ${seal.code}`} /> : null}
            <strong>{seal.code}</strong>
            <span>{KIND[seal.kind] ?? 'Seal'}</span>
            <span>NuTuYu · order {orderId.slice(-6)}</span>
          </div>
        ))}
      </div>
      {back}
    </section>
  );
}
