'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { Variant } from '@/lib/domain/types';
import { formatPence } from '@/lib/format';

/** Business sellers: stock for this listing, and its other colours and sizes. */
export function VariantManager({ listingId }: { listingId: string }) {
  const { backend } = useMember();
  const id = useId();
  const [business, setBusiness] = useState<boolean | null>(null);
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [colour, setColour] = useState('');
  const [size, setSize] = useState('');
  const [stock, setStock] = useState('1');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    backend.isBusiness().then(setBusiness).catch(() => setBusiness(false));
    backend.listingVariants(listingId).then(setVariants).catch(() => setVariants([]));
  }, [backend, listingId]);

  if (!business || !variants) return null;

  const saveStock = async (v: Variant) => {
    const n = Number(stockDraft[v.id]);
    if (!Number.isInteger(n) || n < 1) return setMsg({ ok: false, text: 'Stock is a whole number, 1 or more.' });
    setBusy(true);
    const r = await backend.setListingStock(v.id, n);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setVariants(r.value);
    setStockDraft((d) => ({ ...d, [v.id]: '' }));
    setMsg({ ok: true, text: 'Stock saved' });
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(stock);
    const p = price.trim() ? Math.round(Number(price.replace(/[£,\s]/g, '')) * 100) : null;
    if (!Number.isInteger(n) || n < 1) return setMsg({ ok: false, text: 'Stock is a whole number, 1 or more.' });
    if (p !== null && !Number.isFinite(p)) return setMsg({ ok: false, text: 'Enter the price in pounds, or leave it blank to keep the same price.' });
    setBusy(true);
    const r = await backend.addVariant(listingId, colour, size, n, p);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setVariants(r.value.map((v) => ({ ...v, current: v.id === listingId })));
    setColour('');
    setSize('');
    setStock('1');
    setPrice('');
    setMsg({ ok: true, text: 'Added. It’s live with the same photos.' });
  };

  return (
    <section className="pv-panel pv-form pv-narrow" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Stock, colours and sizes</h2>
      <p className="pv-note">As a business seller you can sell more than one, and offer other colours and sizes. Each one sold is its own protected order. Prices are fixed (no offers).</p>
      <div className="pv-table-wrap"><table className="pv-table">
        <thead><tr><th scope="col">Colour</th><th scope="col">Size</th><th scope="col">Price</th><th scope="col">Left</th><th scope="col">Stock</th></tr></thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} aria-current={v.current ? 'true' : undefined}>
              <td>{v.colour ?? '—'}</td>
              <td>{v.size ?? '—'}</td>
              <td>{formatPence(v.pricePence)}</td>
              <td>{v.unitsLeft}</td>
              <td>
                <span className="pv-inline-form">
                  <label className="pv-visually-hidden" htmlFor={`${id}-s-${v.id}`}>Stock for {[v.colour, v.size].filter(Boolean).join(' ') || 'this item'}</label>
                  <input id={`${id}-s-${v.id}`} inputMode="numeric" size={4} placeholder={String(v.stock)} value={stockDraft[v.id] ?? ''}
                    onChange={(e) => setStockDraft((d) => ({ ...d, [v.id]: e.target.value }))} />
                  <Button variant="quiet" disabled={busy || !stockDraft[v.id]} onClick={() => saveStock(v)}>Save</Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <form className="pv-form" onSubmit={add} aria-labelledby={`${id}-add`}>
        <h3 id={`${id}-add`} className="pv-h3">Add a colour or size</h3>
        <div className="pv-grid-2">
          <div className="pv-field"><label htmlFor={`${id}-c`}>Colour</label><input id={`${id}-c`} value={colour} maxLength={40} onChange={(e) => setColour(e.target.value)} /></div>
          <div className="pv-field"><label htmlFor={`${id}-z`}>Size</label><input id={`${id}-z`} value={size} maxLength={40} onChange={(e) => setSize(e.target.value)} /></div>
          <div className="pv-field"><label htmlFor={`${id}-n`}>How many</label><input id={`${id}-n`} inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} /></div>
          <div className="pv-field"><label htmlFor={`${id}-p`}>Price (£, optional)</label><input id={`${id}-p`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-describedby={`${id}-ph`} />
            <span id={`${id}-ph`} className="pv-note">Blank keeps this listing’s price.</span></div>
        </div>
        <div className="pv-actions"><Button type="submit" variant="secondary" disabled={busy || (!colour.trim() && !size.trim())}>Add</Button></div>
      </form>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}
