'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { SIZE_KINDS, UK_POSTCODE, WRAP_STYLES, type Address, type Basket, type BasketPatch, type SizeKind, type WrapStyle } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';
import { useBaskets } from './BasketsState';

const pounds = (p: number | null) => (p ? (p / 100).toFixed(0) : '');

/** A person's basket: who it's for, their sizes, budget, notes, wrapping and gift options. */
export function BasketSettings({ basket, onDone }: { basket: Basket; onDone?: () => void }) {
  const { backend } = useMember();
  const { run, data } = useBaskets();
  const id = useId();
  const [name, setName] = useState(basket.name);
  const [ageGroup, setAgeGroup] = useState(basket.ageGroup ?? 'adult');
  const [sizes, setSizes] = useState<Partial<Record<SizeKind, string>>>(basket.sizes);
  const [budget, setBudget] = useState(pounds(basket.budgetPence));
  const [notes, setNotes] = useState(basket.styleNotes ?? '');
  const [wrapStyle, setWrapStyle] = useState<WrapStyle | ''>(basket.wrapStyle ?? '');
  const [wrapAll, setWrapAll] = useState(basket.wrapAll);
  const [message, setMessage] = useState(basket.giftMessage ?? '');
  const [hidePrices, setHidePrices] = useState(basket.hidePrices);
  const [deliverBy, setDeliverBy] = useState(basket.deliverBy ?? '');
  const [receipt, setReceipt] = useState(basket.giftReceipt);
  const [addr, setAddr] = useState<Address>(basket.recipientAddress ?? { name: '', line1: '', line2: '', town: '', postcode: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kinds = SIZE_KINDS.filter((k) => (ageGroup === 'child' ? k.key === 'kids' || k.key === 'shoe' : k.key !== 'kids'));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const b = budget.trim() ? Math.round(Number(budget.replace(/[£,\s]/g, '')) * 100) : null;
    if (b !== null && (!Number.isFinite(b) || b < 100)) return setError('Enter a budget in pounds, like 150, or leave it empty.');
    const hasAddr = addr.name.trim() || addr.line1.trim() || addr.town.trim() || addr.postcode.trim();
    if (hasAddr && (!addr.name.trim() || !addr.line1.trim() || !addr.town.trim() || !UK_POSTCODE.test(addr.postcode.trim()))) {
      return setError('For their address, enter the name, first line, town and a UK postcode, or leave it all empty.');
    }
    const patch: BasketPatch = {
      name, ageGroup, sizes: Object.fromEntries(kinds.map((k) => [k.key, sizes[k.key] ?? ''])), budgetPence: b, styleNotes: notes,
      wrapStyle: wrapStyle || null, wrapAll: wrapAll && !!wrapStyle, giftMessage: message, hidePrices, deliverBy: deliverBy || null, giftReceipt: receipt,
      recipientAddress: hasAddr ? addr : null,
    };
    setBusy(true);
    const r = await run(() => backend.saveBasket(basket.id, patch), `${name}’s basket saved.`);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    onDone?.();
  };

  return (
    <form className="pv-bform" onSubmit={save} aria-label={`${basket.name}’s basket settings`}>
      <div className="pv-field"><label htmlFor={`${id}-n`}>Who it’s for</label><input id={`${id}-n`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required /></div>
      <fieldset className="pv-field">
        <legend>Sizes</legend>
        <div className="pv-seg" role="group" aria-label="Adult or child sizes">
          <button type="button" aria-pressed={ageGroup === 'adult'} onClick={() => setAgeGroup('adult')}>Adult</button>
          <button type="button" aria-pressed={ageGroup === 'child'} onClick={() => setAgeGroup('child')}>Child</button>
        </div>
        <div className="pv-grid2">
          {kinds.map((k) => (
            <div className="pv-field" key={k.key}>
              <label htmlFor={`${id}-${k.key}`}>{k.label}</label>
              <input id={`${id}-${k.key}`} value={sizes[k.key] ?? ''} placeholder={k.hint} maxLength={20} onChange={(e) => setSizes({ ...sizes, [k.key]: e.target.value })} />
            </div>
          ))}
        </div>
        <span className="pv-note">Items in other sizes show a warning, and you can filter to only their sizes while you shop.</span>
      </fieldset>
      <div className="pv-field"><label htmlFor={`${id}-b`}>Budget (£, optional)</label><input id={`${id}-b`} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
      <div className="pv-field"><label htmlFor={`${id}-s`}>Style notes</label><textarea id={`${id}-s`} rows={2} maxLength={500} value={notes} placeholder="Colours, brands, things they love or avoid" onChange={(e) => setNotes(e.target.value)} /></div>

      <fieldset className="pv-field">
        <legend>Gift wrapping {data && !data.wrappingLive ? <span className="pv-soon">Wrapping arrives soon</span> : null}</legend>
        <p className="pv-note">
          One paper for everything you wrap in this basket{data?.wrapFeePence ? `, ${formatPence(data.wrapFeePence)} an item` : ''}.
          {data && !data.wrappingLive ? ' Choose it now; nothing is charged and items arrive unwrapped until wrapping starts.' : ''}
        </p>
        <div className="pv-wraps" role="radiogroup" aria-label="Wrapping paper">
          <label className="pv-wrapopt"><input type="radio" className="pv-visually-hidden" name={`${id}-wrap`} checked={!wrapStyle} onChange={() => setWrapStyle('')} /><span className="pv-swatch" aria-hidden="true" />No wrapping</label>
          {WRAP_STYLES.map((w) => (
            <label key={w.key} className="pv-wrapopt">
              <input type="radio" className="pv-visually-hidden" name={`${id}-wrap`} checked={wrapStyle === w.key} onChange={() => setWrapStyle(w.key)} />
              <span className={`pv-swatch pv-swatch--${w.key}`} aria-hidden="true" />{w.label}
            </label>
          ))}
        </div>
        <label className="pv-check"><input type="checkbox" checked={wrapAll} disabled={!wrapStyle} onChange={(e) => setWrapAll(e.target.checked)} />Wrap everything I add to this basket</label>
      </fieldset>

      <fieldset className="pv-field">
        <legend>Gift options</legend>
        <div className="pv-field"><label htmlFor={`${id}-m`}>Gift message</label><textarea id={`${id}-m`} rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        <label className="pv-check"><input type="checkbox" checked={hidePrices} onChange={(e) => setHidePrices(e.target.checked)} />Hide prices from {name || 'them'}</label>
        <label className="pv-check"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} />Include a gift receipt (no prices)</label>
        <div className="pv-field"><label htmlFor={`${id}-d`}>Deliver by (optional)</label><input id={`${id}-d`} type="date" value={deliverBy} onChange={(e) => setDeliverBy(e.target.value)} /></div>
      </fieldset>

      <fieldset className="pv-field">
        <legend>Their address (to send it straight to them)</legend>
        <div className="pv-field"><label htmlFor={`${id}-an`}>Name</label><input id={`${id}-an`} autoComplete="off" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} /></div>
        <div className="pv-field"><label htmlFor={`${id}-a1`}>Address line 1</label><input id={`${id}-a1`} autoComplete="off" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} /></div>
        <div className="pv-field"><label htmlFor={`${id}-a2`}>Address line 2</label><input id={`${id}-a2`} autoComplete="off" value={addr.line2 ?? ''} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} /></div>
        <div className="pv-grid2">
          <div className="pv-field"><label htmlFor={`${id}-at`}>Town</label><input id={`${id}-at`} autoComplete="off" value={addr.town} onChange={(e) => setAddr({ ...addr, town: e.target.value })} /></div>
          <div className="pv-field"><label htmlFor={`${id}-ap`}>Postcode</label><input id={`${id}-ap`} autoComplete="off" value={addr.postcode} onChange={(e) => setAddr({ ...addr, postcode: e.target.value })} /></div>
        </div>
        <span className="pv-note">Only the sellers of their items see it, after you’ve paid.</span>
      </fieldset>

      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <div className="pv-actions">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        {onDone ? <Button variant="quiet" onClick={onDone}>Close</Button> : null}
      </div>
    </form>
  );
}
