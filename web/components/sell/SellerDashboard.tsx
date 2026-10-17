'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import type { SellerDashboard } from '@/lib/selling';
import { VoucherEditor } from '@/components/vouchers/VoucherEditor';

const STATE: Record<string, string> = { in_progress: 'Handover under way', confirmed: 'Complete', disputed: 'Problem reported', not_started: 'Starting' };
const PAYOUT: Record<string, string> = { held: 'Held', due: 'Released', paid: 'Paid out', refund: 'Refunded' };
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** A seller's sales at a glance: totals, the last year by month, every sale, and their bundle discount. */
export function SellerDashboardView() {
  const { member, loading, backend } = useMember();
  const [d, setD] = useState<SellerDashboard | null | undefined>(undefined);
  useEffect(() => {
    if (member) backend.sellerDashboard().then(setD).catch(() => setD(null));
  }, [member, backend]);

  if (loading) return <p role="status">Loading…</p>;
  if (!member) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Your sales</h1>
        <p className="pv-lead">Sign in to see what you’ve sold and what you’re owed.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/selling">Sign in</Link></p>
      </section>
    );
  }
  if (d === undefined) return <p role="status">Loading your sales…</p>;
  if (!d) return <p className="pv-banner pv-banner--warn" role="status">We couldn’t load your sales just now. Try again in a minute.</p>;
  const t = d.totals;
  const max = Math.max(1, ...d.months.map((m) => m.grossPence));
  const tiles: [string, string, string?][] = [
    ['Sold', String(t.sold), t.bundles ? `${t.bundles} in bundles` : undefined],
    ['Taken', formatPence(t.grossPence), 'Item prices'],
    ['Held', formatPence(t.heldPence), 'Until buyers confirm'],
    ['Released', formatPence(t.releasedPence), 'Paid or on its way'],
    ['Average handover', t.avgHandoverHours === null ? '—' : t.avgHandoverHours < 48 ? `${Math.round(t.avgHandoverHours)} h` : `${Math.round(t.avgHandoverHours / 24)} days`, 'Paid to confirmed'],
    ['Problems', String(t.disputed), t.refunded ? `${t.refunded} refunded` : 'Reported by buyers'],
  ];
  return (
    <div className="pv-sell pv-dash">
      <header className="pv-section">
        <p className="pv-eyebrow">Selling</p>
        <h1>Your sales</h1>
        <div className="pv-actions">
          <Link className="pv-btn pv-btn--primary" href="/sell">Sell an item</Link>
          <Link className="pv-btn pv-btn--secondary" href="/profile">Your listings</Link>
        </div>
      </header>

      <section aria-labelledby="dash-totals">
        <h2 id="dash-totals" className="pv-visually-hidden">Totals</h2>
        <ul className="pv-tiles">
          {tiles.map(([label, value, note]) => (
            <li key={label} className="pv-tile"><span className="pv-tile__label">{label}</span><strong className="pv-tile__value">{value}</strong>{note ? <span className="pv-note">{note}</span> : null}</li>
          ))}
        </ul>
      </section>

      {d.months.length ? (
        <section aria-labelledby="dash-months">
          <h2 id="dash-months">By month</h2>
          <table className="pv-bars">
            <caption className="pv-visually-hidden">Sales by month</caption>
            <thead className="pv-visually-hidden"><tr><th scope="col">Month</th><th scope="col">Taken</th><th scope="col">Items</th></tr></thead>
            <tbody>
              {d.months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthName(m.month)}</th>
                  <td><span className="pv-bars__bar" style={{ width: `${Math.max(2, (m.grossPence / max) * 100)}%` }} aria-hidden="true" />{formatPence(m.grossPence)}</td>
                  <td>{m.sold} {m.sold === 1 ? 'item' : 'items'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <BundleSettings initial={d.bundle} />
      <VoucherEditor mode="shop" />

      <section aria-labelledby="dash-sold">
        <h2 id="dash-sold">Sold</h2>
        {d.recent.length ? (
          <div className="pv-table-wrap">
            <table className="pv-table">
              <thead><tr><th scope="col">Item</th><th scope="col">Sold</th><th scope="col">Price</th><th scope="col">You get</th><th scope="col">Buyer</th><th scope="col">Handover</th><th scope="col">Payment</th></tr></thead>
              <tbody>
                {d.recent.map((r) => (
                  <tr key={r.orderId}>
                    <td><Link href={`/orders/${r.orderId}`}>{r.title}</Link>{r.bundle ? <span className="pv-note"> · bundle</span> : null}</td>
                    <td>{r.paidAt ? new Date(r.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                    <td>{formatPence(r.pricePence)}</td>
                    <td>{formatPence(r.payoutPence)}</td>
                    <td>{r.buyer ?? '—'}</td>
                    <td>{STATE[r.state] ?? r.state}</td>
                    <td>{PAYOUT[r.payoutStatus] ?? r.payoutStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pv-note">Nothing sold yet. When something sells it appears here with its handover and payment.</p>}
      </section>
    </div>
  );
}

function BundleSettings({ initial }: { initial: SellerDashboard['bundle'] }) {
  const { backend } = useMember();
  const id = useId();
  const [on, setOn] = useState(!!initial);
  const [min, setMin] = useState(String(initial?.minItems ?? 2));
  const [pct, setPct] = useState(String(initial?.pct ?? 10));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await backend.setBundleDiscount(on ? { minItems: Number(min), pct: Number(pct) } : null);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setMsg({ ok: true, text: r.value ? `Saved: ${r.value.pct}% off ${r.value.minItems} or more of your items.` : 'Bundle discount switched off.' });
  };
  return (
    <form className="pv-panel pv-form" onSubmit={save} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Bundle discount</h2>
      <p className="pv-note">Take a percentage off when someone buys several of your items in one checkout. Your items show the offer, and the discount comes off your price.</p>
      <label className="pv-check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />Offer a bundle discount</label>
      {on ? (
        <div className="pv-grid-2">
          <div className="pv-field"><label htmlFor={`${id}-n`}>When they buy at least</label>
            <select id={`${id}-n`} value={min} onChange={(e) => setMin(e.target.value)}>{[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} items</option>)}</select></div>
          <div className="pv-field"><label htmlFor={`${id}-p`}>Discount</label>
            <select id={`${id}-p`} value={pct} onChange={(e) => setPct(e.target.value)}>{[5, 10, 15, 20, 25, 30, 40, 50].map((n) => <option key={n} value={n}>{n}% off</option>)}</select></div>
        </div>
      ) : null}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      <div className="pv-actions"><Button type="submit" variant="secondary">Save</Button></div>
    </form>
  );
}
