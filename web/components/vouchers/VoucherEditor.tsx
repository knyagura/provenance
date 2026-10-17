'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { describeVoucher } from '@/lib/selling/money';
import type { Voucher, VoucherPatch } from '@/lib/selling';

const pence = (pounds: string) => (pounds.trim() ? Math.round(Number(pounds.replace(/[£,\s]/g, '')) * 100) : null);

/**
 * Voucher codes. Staff make NuTuYu codes (NuTuYu pays the discount; the seller is paid in full).
 * Sellers make codes for their own shop (the discount comes off their price).
 */
export function VoucherEditor({ mode }: { mode: 'staff' | 'shop' }) {
  const { backend } = useMember();
  const id = useId();
  const [list, setList] = useState<Voucher[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('10');
  const [minSpend, setMinSpend] = useState('');
  const [maxOff, setMaxOff] = useState('');
  const [perMember, setPerMember] = useState('1');
  const [maxUses, setMaxUses] = useState('');
  const [firstOnly, setFirstOnly] = useState(false);
  const [ends, setEnds] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (mode === 'staff' ? backend.staffVouchers() : backend.myShopVouchers()).then(setList).catch(() => setList([]));
  }, [backend, mode]);

  const save = (vid: string | null, patch: VoucherPatch) => (mode === 'staff' ? backend.staffSaveVoucher(vid, patch) : backend.saveShopVoucher(vid, patch));
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = kind === 'percent' ? Number(value) : pence(value);
    if (!v || !Number.isFinite(v) || v <= 0) return setMsg({ ok: false, text: kind === 'percent' ? 'Enter a percentage, like 10.' : 'Enter an amount in pounds, like 5.' });
    const r = await save(null, {
      code, kind, value: v, minSpendPence: pence(minSpend) ?? 0, maxDiscountPence: kind === 'percent' ? pence(maxOff) : null, perMember: Number(perMember) || 1,
      maxUses: maxUses.trim() ? Number(maxUses) : null, firstOrderOnly: mode === 'staff' && firstOnly, endsAt: ends ? new Date(ends).toISOString() : null, active: true,
    });
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setList(r.value);
    setMsg({ ok: true, text: `${code.toUpperCase()} is ready to use.` });
    setAdding(false);
    setCode('');
  };
  const toggle = async (v: Voucher) => {
    const r = await save(v.id, { active: !v.active });
    if (r.ok) setList(r.value);
    else setMsg({ ok: false, text: r.message });
  };

  if (!list) return <p role="status">Loading codes…</p>;
  return (
    <section className="pv-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{mode === 'staff' ? 'Voucher codes' : 'Codes for your shop'}</h2>
      <p className="pv-note">
        {mode === 'staff'
          ? 'NuTuYu pays for these: the buyer pays less and the seller still gets their full payout. Use them for sign-up offers and campaigns (show one in a popup).'
          : 'Give these to your customers. The discount comes off your price on your items only, so your fees and payout are worked out on the lower price.'}
      </p>
      {list.length ? (
        <ul className="pv-rows">
          {list.map((v) => (
            <li key={v.id} className="pv-row pv-row--plain">
              <span className="pv-row__text">
                <strong className="pv-mono">{v.code}</strong>
                <span className="pv-note">{describeVoucher(v, formatPence)}{v.shop && mode === 'staff' ? ` · ${v.shop}’s shop` : ''}</span>
                <span className="pv-note">{[v.active ? 'On' : 'Off', `used ${v.uses} ${v.uses === 1 ? 'time' : 'times'}`, v.discountGivenPence ? `${formatPence(v.discountGivenPence)} given` : null, v.maxUses ? `limit ${v.maxUses}` : null, v.endsAt ? `ends ${new Date(v.endsAt).toLocaleDateString('en-GB')}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <Button variant={v.active ? 'quiet' : 'secondary'} onClick={() => toggle(v)} aria-label={`${v.active ? 'Switch off' : 'Switch on'} ${v.code}`}>{v.active ? 'Switch off' : 'Switch on'}</Button>
            </li>
          ))}
        </ul>
      ) : <p className="pv-note">No codes yet.</p>}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      {adding ? (
        <form className="pv-panel pv-form" onSubmit={add} aria-labelledby={`${id}-new`}>
          <h3 id={`${id}-new`} className="pv-h3">New code</h3>
          <div className="pv-grid-2">
            <div className="pv-field"><label htmlFor={`${id}-c`}>Code</label><input id={`${id}-c`} required pattern="[A-Za-z0-9-]{3,20}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-describedby={`${id}-ch`} />
              <span id={`${id}-ch`} className="pv-note">3 to 20 letters, numbers or dashes, like WELCOME10.</span></div>
            <div className="pv-field"><label htmlFor={`${id}-k`}>Discount type</label>
              <select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}><option value="percent">Percentage off</option><option value="amount">Amount off (£)</option></select></div>
            <div className="pv-field"><label htmlFor={`${id}-v`}>{kind === 'percent' ? 'Percentage off' : 'Amount off (£)'}</label><input id={`${id}-v`} inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} /></div>
            <div className="pv-field"><label htmlFor={`${id}-m`}>Minimum spend (£, optional)</label><input id={`${id}-m`} inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} /></div>
            {kind === 'percent' ? <div className="pv-field"><label htmlFor={`${id}-x`}>Most it can take off (£, optional)</label><input id={`${id}-x`} inputMode="decimal" value={maxOff} onChange={(e) => setMaxOff(e.target.value)} /></div> : null}
            <div className="pv-field"><label htmlFor={`${id}-p`}>Uses per person</label><input id={`${id}-p`} type="number" min={1} max={100} value={perMember} onChange={(e) => setPerMember(e.target.value)} /></div>
            <div className="pv-field"><label htmlFor={`${id}-u`}>Total uses (optional)</label><input id={`${id}-u`} type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></div>
            <div className="pv-field"><label htmlFor={`${id}-e`}>Ends (optional)</label><input id={`${id}-e`} type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
          </div>
          {mode === 'staff' ? <label className="pv-check"><input type="checkbox" checked={firstOnly} onChange={(e) => setFirstOnly(e.target.checked)} />First order only (for sign-up offers)</label> : null}
          <div className="pv-actions"><Button type="submit" variant="primary">Make code</Button><Button variant="quiet" onClick={() => setAdding(false)}>Cancel</Button></div>
        </form>
      ) : (
        <div className="pv-actions"><Button variant="secondary" onClick={() => { setAdding(true); setMsg(null); }}>New code</Button></div>
      )}
    </section>
  );
}
