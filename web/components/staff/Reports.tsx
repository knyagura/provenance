'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { handoverTime } from '@/components/market/Trust';
import { DISPUTE_REASONS } from '@/lib/domain/custody';
import { TIER_LABEL } from '@/lib/domain/present';
import { fallbackCategories } from '@/lib/domain/examples';
import { formatPence } from '@/lib/format';
import { reportCsv } from '@/lib/selling/reports';
import type { StaffReport } from '@/lib/selling/types';

const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const daysAgo = (n: number) => day(new Date(Date.now() - n * 86_400_000));
const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: '7', label: 'Last 7 days', range: () => [daysAgo(6), day(new Date())] },
  { key: '30', label: 'Last 30 days', range: () => [daysAgo(29), day(new Date())] },
  { key: 'month', label: 'This month', range: () => [day(new Date()).slice(0, 8) + '01', day(new Date())] },
  { key: 'year', label: 'Last 12 months', range: () => [daysAgo(364), day(new Date())] },
];
const less = (p: number) => (p ? `−${formatPence(p)}` : formatPence(0));
const hours = (h: number | null) => (h === null ? '–' : handoverTime(h));
const monthName = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const catName = (k: string) => fallbackCategories.find((c) => c.slug === k)?.name ?? (k === 'other' ? 'Other' : k);

function Rows({ rows, label }: { rows: [string, string | number][]; label: string }) {
  return (
    <table className="pv-report__table">
      <caption className="pv-visually-hidden">{label}</caption>
      <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
    </table>
  );
}

/** Staff: sales, fees, disputes and handover times for a period, with 12 months by month and a CSV download. */
export function Reports() {
  const { backend } = useMember();
  const id = useId();
  const [range, setRange] = useState<[string, string]>(PRESETS[1].range());
  const [r, setR] = useState<StaffReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (from: string, to: string) => {
    setBusy(true);
    setError(null);
    const res = await backend.staffReport(from, to);
    setBusy(false);
    if (res.ok) setR(res.value);
    else setError(res.message);
  }, [backend]);
  useEffect(() => { run(...PRESETS[1].range()); }, [run]);

  const submit = (e: FormEvent) => { e.preventDefault(); run(range[0], range[1]); };
  const preset = (k: string) => { const p = PRESETS.find((x) => x.key === k)!.range(); setRange(p); run(...p); };
  const download = () => {
    if (!r) return;
    const url = URL.createObjectURL(new Blob([reportCsv(r)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `nutuyu-report-${r.from}-to-${r.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const maxGmv = Math.max(1, ...(r?.months.map((m) => m.gmvPence) ?? [1]));

  return (
    <div className="pv-report">
      <form className="pv-form pv-report__range" onSubmit={submit} aria-label="Report period">
        <div className="pv-chips" role="group" aria-label="Quick periods">
          {PRESETS.map((p) => <button key={p.key} type="button" className="pv-chip" onClick={() => preset(p.key)}>{p.label}</button>)}
        </div>
        <div className="pv-grid2">
          <div className="pv-field"><label htmlFor={`${id}-from`}>From</label><input id={`${id}-from`} type="date" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} /></div>
          <div className="pv-field"><label htmlFor={`${id}-to`}>To</label><input id={`${id}-to`} type="date" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} /></div>
        </div>
        <div className="pv-actions">
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Working…' : 'Show report'}</Button>
          {r ? <Button onClick={download}>Download CSV</Button> : null}
        </div>
      </form>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {r ? (
        <>
          <p className="pv-note" role="status">
            {new Date(r.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to {new Date(r.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, UK time.
          </p>
          <dl className="pv-stats" aria-label="Headline figures">
            <div><dt>Orders</dt><dd>{r.sales.orders}</dd></div>
            <div><dt>Items sold</dt><dd>{formatPence(r.sales.gmvPence)}</dd></div>
            <div><dt>Net to NuTuYu</dt><dd>{formatPence(r.fees.netPence)}</dd></div>
            <div><dt>Disputed</dt><dd>{r.disputes.ratePct === null ? '–' : `${r.disputes.ratePct}%`}</dd></div>
            <div><dt>Average handover</dt><dd>{hours(r.handover.avgHours)}</dd></div>
          </dl>
          <div className="pv-report__grid">
            <section aria-labelledby={`${id}-sales`}>
              <h3 id={`${id}-sales`}>Sales</h3>
              <Rows label="Sales" rows={[
                ['Orders paid', r.sales.orders], ['Sellers', r.sales.sellers], ['Buyers', r.sales.buyers],
                ['Items sold', formatPence(r.sales.gmvPence)], ['Buyers paid', formatPence(r.sales.buyerPaidPence)],
                ['Average item', r.sales.averageOrderPence === null ? '–' : formatPence(r.sales.averageOrderPence)],
                ['Due to sellers', formatPence(r.sales.sellerPayoutsPence)],
                ...(Object.keys(TIER_LABEL) as (keyof typeof TIER_LABEL)[]).filter((k) => r.byTier[k]).map((k): [string, string] => [TIER_LABEL[k], `${r.byTier[k]!.orders} · ${formatPence(r.byTier[k]!.gmvPence)}`]),
              ]} />
            </section>
            <section aria-labelledby={`${id}-fees`}>
              <h3 id={`${id}-fees`}>Fees</h3>
              <Rows label="Fees" rows={[
                ['Transaction fees', formatPence(r.fees.transactionPence)], ['Processing', formatPence(r.fees.processingPence)],
                ['Boost commission', formatPence(r.fees.commissionPence)], ['Promotions covered', less(r.fees.promotionPence)],
                ['NuTuYu voucher codes', less(r.fees.nutuyuVouchersPence)], ['Net to NuTuYu', formatPence(r.fees.netPence)],
                ['Courier charges (passed on)', formatPence(r.fees.courierPence)], ['Authentication (passed on)', formatPence(r.fees.hubPence)],
              ]} />
            </section>
            <section aria-labelledby={`${id}-disputes`}>
              <h3 id={`${id}-disputes`}>Disputes</h3>
              <Rows label="Disputes" rows={[
                ['Opened', r.disputes.opened], ['Rate (of orders paid)', r.disputes.ratePct === null ? '–' : `${r.disputes.ratePct}%`],
                ['Released to the seller', r.disputes.released], ['Refunded', r.disputes.refunded], ['Waiting for a decision now', r.disputes.openNow],
                ['Time to decide', hours(r.disputes.avgHoursToDecide)],
                ...Object.entries(r.disputes.byReason).map(([k, n]): [string, number] => [DISPUTE_REASONS[k] ?? k, n]),
              ]} />
            </section>
            <section aria-labelledby={`${id}-hand`}>
              <h3 id={`${id}-hand`}>Handover time</h3>
              <Rows label="Handover time" rows={[
                ['Completed', r.handover.completed], ['Average', hours(r.handover.avgHours)], ['Median', hours(r.handover.medianHours)],
                ...(Object.keys(TIER_LABEL) as (keyof typeof TIER_LABEL)[]).filter((k) => r.handover.byTier[k]).map((k): [string, string] => [TIER_LABEL[k], `${r.handover.byTier[k]!.completed} · ${hours(r.handover.byTier[k]!.avgHours)}`]),
                ...Object.entries(r.labels).map(([k, n]): [string, number] => [`Labels: ${k}`, n]),
              ]} />
            </section>
            {r.byCategory.length ? (
              <section aria-labelledby={`${id}-cat`}>
                <h3 id={`${id}-cat`}>Top categories</h3>
                <Rows label="Top categories" rows={r.byCategory.map((c): [string, string] => [catName(c.category), `${c.orders} · ${formatPence(c.gmvPence)}`])} />
              </section>
            ) : null}
          </div>
          <section aria-labelledby={`${id}-months`}>
            <h3 id={`${id}-months`}>Last 12 months</h3>
            <div className="pv-report__scroll">
              <table className="pv-report__months">
                <caption className="pv-visually-hidden">Orders, items sold, net fees and disputes by month</caption>
                <thead><tr><th scope="col">Month</th><th scope="col">Orders</th><th scope="col">Items sold</th><th scope="col">Net fees</th><th scope="col">Disputes</th></tr></thead>
                <tbody>
                  {r.months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{monthName(m.month)}</th>
                      <td>{m.orders}</td>
                      <td><span className="pv-report__bar" style={{ width: `${Math.round((m.gmvPence / maxGmv) * 100)}%` }} aria-hidden="true" />{formatPence(m.gmvPence)}</td>
                      <td>{formatPence(m.netFeesPence)}</td>
                      <td>{m.disputes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
