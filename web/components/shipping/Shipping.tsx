'use client';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { addressLines } from '@/lib/selling/shipping';
import type { Address, OrderShipping, ParcelSize, SavedAddress, ShippingLabel } from '@/lib/selling/types';

function useShipping(orderId: string) {
  const { backend, member } = useMember();
  const [s, setS] = useState<OrderShipping | null | undefined>(undefined);
  useEffect(() => {
    if (!member) return;
    backend.orderShipping(orderId).then(setS).catch(() => setS(null));
  }, [backend, member, orderId]);
  return [s, setS] as const;
}

function LabelSummary({ label, orderId }: { label: ShippingLabel; orderId: string }) {
  return (
    <div className="pv-shiplabel">
      <p>
        <strong>{label.carrier}</strong> · {label.service}
        {label.mode === 'test' ? <span className="pv-shiplabel__test"> Test label</span> : null}
      </p>
      <p>Tracking number <span className="pv-mono">{label.tracking}</span></p>
      <p className="pv-note">To {label.deliverTo.name}, {label.deliverTo.postcode}</p>
      {label.labelUrl ? <a className="pv-btn pv-btn--secondary" href={label.labelUrl} target="_blank" rel="noopener">Print label</a>
        : <Link className="pv-btn pv-btn--secondary" href={`/orders/${orderId}/shipping-label`}>Print label</Link>}
    </div>
  );
}

/** Seller, at the "posted with tracking" step: get a label, which fills in the carrier and tracking number. */
export function LabelMaker({ orderId, onLabel }: { orderId: string; onLabel: (l: { carrier: string; tracking: string }) => void }) {
  const { backend } = useMember();
  const id = useId();
  const [s, setS] = useShipping(orderId);
  const [parcel, setParcel] = useState<ParcelSize>('small');
  const [service, setService] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (s?.label) onLabel({ carrier: s.label.carrier, tracking: s.label.tracking });
  }, [s?.label, onLabel]);
  if (!s || (!s.canLabel && !s.label)) return null;

  const run = async (fn: () => ReturnType<typeof backend.createLabel>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) setS(r.value);
    else setError(r.message);
  };
  const create = () => {
    if (!service) return setError('Choose a delivery service.');
    run(() => backend.createLabel(orderId, service, parcel));
  };

  return (
    <section className="pv-panel pv-shipping" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Shipping label</h3>
      {s.label ? (
        <>
          <LabelSummary label={s.label} orderId={orderId} />
          {s.label.mode === 'test' ? <p className="pv-note">This is a test label: it can’t be posted. Real labels from Parcel2Go arrive once NuTuYu switches them on.</p> : null}
          <p className="pv-note">We’ve filled in the carrier and tracking number below.</p>
          {s.canLabel ? <Button variant="quiet" disabled={busy} onClick={() => run(() => backend.cancelLabel(orderId))}>Cancel label</Button> : null}
        </>
      ) : !s.hasAddress ? (
        <p className="pv-note" role="status">Waiting for the buyer’s delivery address. We’ve asked them for it; you can still post it your own way and enter the tracking number below.</p>
      ) : s.quotes ? (
        // Not a <form>: this sits inside the step's own form.
        <div className="pv-form" role="group" aria-label="Make a shipping label">
          <p className="pv-note">Get a tracked label for this parcel. The buyer’s address is printed on it.</p>
          <fieldset className="pv-field pv-choices">
            <legend>Parcel size</legend>
            {s.sizes.map((z) => (
              <label key={z.key} className="pv-choice">
                <input type="radio" name={`${id}-size`} checked={parcel === z.key} onChange={() => setParcel(z.key)} />
                <span><strong>{z.name}</strong> <span className="pv-note">{z.limit}</span></span>
              </label>
            ))}
          </fieldset>
          <fieldset className="pv-field pv-choices">
            <legend>Delivery service</legend>
            {s.quotes.map((q) => (
              <label key={q.service} className="pv-choice">
                <input type="radio" name={`${id}-svc`} checked={service === q.service} onChange={() => setService(q.service)} />
                <span><strong>{q.name}</strong> <span className="pv-note">{formatPence(q.prices[parcel])}{q.dropOff ? ' · drop off at a shop' : ''}</span></span>
              </label>
            ))}
          </fieldset>
          <p className="pv-note">Test mode: no charge, and the label can’t be posted.</p>
          <div className="pv-actions"><Button variant="primary" disabled={busy} onClick={create}>{busy ? 'Making the label…' : 'Create test label'}</Button></div>
        </div>
      ) : null}
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
    </section>
  );
}

const EMPTY: Address = { name: '', line1: '', line2: null, town: '', postcode: '' };

/** Buyer: where the item should go, and its tracking once the seller has a label. */
export function DeliveryAddress({ orderId }: { orderId: string }) {
  const { backend } = useMember();
  const id = useId();
  const [s, setS] = useShipping(orderId);
  const [edit, setEdit] = useState(false);
  const [a, setA] = useState<Address>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  useEffect(() => { backend.myAddresses().then(setSaved).catch(() => {}); }, [backend]);
  if (!s || (!s.canLabel && !s.label && !s.address)) return null;
  const open = !s.address || edit;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await backend.setDeliveryAddress(orderId, a);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setS(r.value);
    setEdit(false);
    setMsg({ ok: true, text: 'Saved. The seller will print it on the label.' });
  };
  const field = (k: keyof Address, label: string, auto: string, optional = false) => (
    <div className="pv-field">
      <label htmlFor={`${id}-${k}`}>{label}{optional ? ' (optional)' : ''}</label>
      <input id={`${id}-${k}`} autoComplete={auto} value={a[k] ?? ''} onChange={(e) => setA({ ...a, [k]: e.target.value })} />
    </div>
  );

  return (
    <section className="pv-panel pv-shipping" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Delivery</h2>
      {s.label ? (
        <p>Sent with <strong>{s.label.carrier}</strong>. Tracking number <span className="pv-mono">{s.label.tracking}</span>{s.label.mode === 'test' ? ' (test label)' : ''}.</p>
      ) : null}
      {s.address && !edit ? (
        <>
          <address className="pv-address">{addressLines(s.address).map((l) => <span key={l}>{l}</span>)}</address>
          {s.addressFromBasket ? <p className="pv-note">From your basket’s delivery address.</p> : null}
          {s.canLabel && !s.label ? <Button variant="quiet" onClick={() => { setA(s.address!); setEdit(true); setMsg(null); }}>Change address</Button> : null}
        </>
      ) : null}
      {open && s.canLabel && !s.label ? (
        <form className="pv-form" onSubmit={save} aria-label="Delivery address">
          {!s.address ? <p className="pv-note">The seller posts this item. Where should it go? Only the seller sees it, printed on the label.</p> : null}
          {saved.length ? (
            <div className="pv-chips" role="group" aria-label="Your saved addresses">
              {saved.map((x) => <button key={x.id} type="button" className="pv-chip" onClick={() => setA(x.address)}>{x.label ?? 'Saved'}: {x.address.postcode}</button>)}
            </div>
          ) : null}
          {field('name', 'Name', 'name')}
          {field('line1', 'Address line 1', 'address-line1')}
          {field('line2', 'Address line 2', 'address-line2', true)}
          <div className="pv-grid2">
            {field('town', 'Town or city', 'address-level2')}
            {field('postcode', 'Postcode', 'postal-code')}
          </div>
          <div className="pv-actions">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</Button>
            {edit ? <Button variant="quiet" onClick={() => setEdit(false)}>Keep the old one</Button> : null}
          </div>
        </form>
      ) : null}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}

/** The printable label: carrier, service, tracking (with a QR code), the buyer's address and the order. */
export function ShippingLabelSheet({ orderId }: { orderId: string }) {
  const { member, loading } = useMember();
  const [s] = useShipping(orderId);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!s?.label) return;
    QRCode.toDataURL(s.label.tracking, { errorCorrectionLevel: 'M', margin: 1, width: 240 }).then(setQr).catch(() => setQr(null));
  }, [s?.label]);
  if (loading || (member && s === undefined)) return <p role="status">Loading…</p>;
  if (!member) return <p><Link href={`/signin?next=/orders/${orderId}/shipping-label`}>Sign in</Link> to print the label.</p>;
  const back = <p className="pv-noprint"><Link href={`/orders/${orderId}`}>Back to the order</Link></p>;
  if (!s?.label) {
    return (
      <section className="pv-section pv-narrow">
        <h1>No shipping label yet</h1>
        <p className="pv-lead">Make a label on the order page, at the step where you post the item.</p>
        {back}
      </section>
    );
  }
  const l = s.label;
  return (
    <section className="pv-section pv-narrow">
      <h1 className="pv-noprint">Shipping label</h1>
      <div className="pv-noprint pv-actions"><Button variant="primary" onClick={() => window.print()}>Print</Button></div>
      <div className="pv-shipsheet" aria-label="Label to print">
        {l.mode === 'test' ? <p className="pv-shipsheet__test">TEST — not valid for posting</p> : null}
        <div className="pv-shipsheet__head"><strong>{l.carrier}</strong><span>{l.service}</span><span>{l.parcel[0].toUpperCase() + l.parcel.slice(1)} parcel</span></div>
        <div className="pv-shipsheet__to">
          <span className="pv-note">Deliver to</span>
          <address>{addressLines(l.deliverTo).map((x) => <span key={x}>{x}</span>)}</address>
        </div>
        <div className="pv-shipsheet__track">
          {qr ? <img src={qr} alt={`Tracking code ${l.tracking}`} width={120} height={120} /> : null}
          <span className="pv-mono">{l.tracking}</span>
        </div>
        <p className="pv-note">NuTuYu order {orderId.replace(/-/g, '').slice(-8).toUpperCase()} · sent via Parcel2Go</p>
      </div>
      {back}
    </section>
  );
}
