'use client';

import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { handoverTime } from '@/components/market/Trust';
import { formatPence } from '@/lib/format';
import type { OwnerDashboard, Plan, PlanKey } from '@/lib/selling/types';

function change(now: number, prev: number): string {
  if (!prev) return now ? 'new this week' : 'same as last week';
  const pct = Math.round(((now - prev) / prev) * 100);
  return pct === 0 ? 'same as last week' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on last week`;
}
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Staff: this week against last, what needs attention, 30 days day by day, and top sellers. */
export function OwnerDashboardPanel({ go }: { go: (tab: string) => void }) {
  const { backend } = useMember();
  const [d, setD] = useState<OwnerDashboard | null | undefined>(undefined);
  useEffect(() => { backend.staffDashboard().then(setD).catch(() => setD(null)); }, [backend]);
  if (d === undefined) return <p role="status">Loading the dashboard…</p>;
  if (!d) return <p className="pv-errors" role="alert">Couldn’t load the dashboard.</p>;
  const tiles: [string, string, string][] = [
    ['Orders this week', String(d.week.orders), change(d.week.orders, d.week.ordersPrev)],
    ['Items sold this week', formatPence(d.week.gmvPence), change(d.week.gmvPence, d.week.gmvPrevPence)],
    ['NuTuYu’s fees this week', formatPence(d.week.netFeesPence), change(d.week.netFeesPence, d.week.netFeesPrevPence)],
    ['New members this week', String(d.members.new), change(d.members.new, d.members.newPrev)],
    ['New listings this week', String(d.listings.new), change(d.listings.new, d.listings.newPrev)],
    ['Live listings', String(d.listings.live), `${d.listings.boosted} boosted`],
    ['Members', String(d.members.total), `${d.members.paidPlans} on paid plans · ${d.members.identityChecked} identity checked`],
    ['Last 30 days', `${d.month.completed} completed`, `${d.month.orders} orders · ${d.month.orders ? Math.round((100 * d.month.disputed) / d.month.orders) : 0}% disputed${d.month.avgHandoverHours !== null ? ` · ${handoverTime(d.month.avgHandoverHours)}` : ''}`],
  ];
  const a = d.attention;
  const todo: [string, number, string][] = [
    ['Disputes waiting for a decision', a.disputes, 'queue'],
    ['Payments to check', a.paymentsToCheck, 'queue'],
    ['Open reports', a.reports, 'moderation'],
    ['Payouts that failed', a.payoutsFailed, 'payouts'],
    ['Refunds to do by hand', a.refundsByHand, 'payouts'],
    ['Contact messages', a.contact, 'messages'],
  ];
  const max = Math.max(1, ...d.daily.map((x) => x.gmvPence));
  return (
    <div className="pv-report">
      <ul className="pv-tiles" aria-label="This week">
        {tiles.map(([label, value, note]) => (
          <li key={label} className="pv-tile"><span className="pv-tile__label">{label}</span><strong className="pv-tile__value">{value}</strong><span className="pv-note">{note}</span></li>
        ))}
      </ul>
      <section aria-labelledby="todo-h">
        <h3 id="todo-h">Needs attention</h3>
        {todo.some(([, n]) => n) || a.payoutsWaitingPence ? (
          <ul className="pv-attention">
            {todo.filter(([, n]) => n).map(([label, n, tab]) => (
              <li key={label}><strong>{n}</strong> {label} <Button variant="quiet" onClick={() => go(tab)}>Open</Button></li>
            ))}
            {a.payoutsWaitingPence ? <li><strong>{formatPence(a.payoutsWaitingPence)}</strong> waiting for sellers to set up payouts</li> : null}
          </ul>
        ) : <p>Nothing waiting. 🎉</p>}
      </section>
      <section aria-labelledby="daily-h">
        <h3 id="daily-h">Last 30 days</h3>
        <div className="pv-report__scroll">
          <table className="pv-report__months">
            <caption className="pv-visually-hidden">Orders, items sold, new members and new listings each day</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Orders</th><th scope="col">Items sold</th><th scope="col">Members</th><th scope="col">Listings</th></tr></thead>
            <tbody>
              {[...d.daily].reverse().map((x) => (
                <tr key={x.day}>
                  <th scope="row">{dayName(x.day)}</th>
                  <td>{x.orders}</td>
                  <td><span className="pv-report__bar" style={{ width: `${Math.round((x.gmvPence / max) * 100)}%` }} aria-hidden="true" />{formatPence(x.gmvPence)}</td>
                  <td>{x.members}</td>
                  <td>{x.listings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {d.topSellers.length ? (
        <section aria-labelledby="top-h">
          <h3 id="top-h">Top sellers, last 30 days</h3>
          <ol className="pv-list">{d.topSellers.map((s) => <li key={s.seller}>{s.seller}: {s.orders} {s.orders === 1 ? 'order' : 'orders'}, {formatPence(s.gmvPence)}</li>)}</ol>
        </section>
      ) : null}
    </div>
  );
}

/** Staff: plan prices and perks (Standard is always free). */
export function PlansEditor() {
  const { backend } = useMember();
  const [plans, setPlans] = useState<(Plan & { active: boolean; members: number })[] | null>(null);
  const [edit, setEdit] = useState<Record<string, { price: string; fee: string; boosts: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { backend.staffPlans().then(setPlans).catch(() => setPlans([])); }, [backend]);
  if (!plans) return <p role="status">Loading plans…</p>;
  const val = (p: Plan) => edit[p.key] ?? { price: (p.pricePence / 100).toFixed(2), fee: String(p.perks.fee_free_orders), boosts: String(p.perks.boost_credits) };
  const save = async (p: Plan) => {
    const v = val(p);
    const r = await backend.staffSavePlan(p.key as PlanKey, Math.round(Number(v.price) * 100), { fee_free_orders: Number(v.fee), boost_credits: Number(v.boosts) });
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setPlans(r.value);
    setMsg({ ok: true, text: `${p.name} saved.` });
  };
  return (
    <section className="pv-panel" aria-labelledby="plans-ed-h">
      <h3 id="plans-ed-h">Plans</h3>
      <ul className="pv-staff-list" aria-label="Plan settings">
        {plans.map((p) => {
          const v = val(p);
          const set = (k: keyof typeof v, x: string) => setEdit({ ...edit, [p.key]: { ...v, [k]: x } });
          return (
            <li key={p.key} className="pv-panel">
              <p><strong>{p.name}</strong> · {p.members} {p.members === 1 ? 'member' : 'members'}</p>
              <div className="pv-grid2">
                <div className="pv-field"><label htmlFor={`pl-${p.key}-p`}>Price a month (£)</label><input id={`pl-${p.key}-p`} inputMode="decimal" value={v.price} disabled={p.key === 'standard'} onChange={(e) => set('price', e.target.value)} /></div>
                <div className="pv-field"><label htmlFor={`pl-${p.key}-f`}>Fee-free orders a month</label><input id={`pl-${p.key}-f`} inputMode="numeric" value={v.fee} onChange={(e) => set('fee', e.target.value)} /></div>
                <div className="pv-field"><label htmlFor={`pl-${p.key}-b`}>Free boosts a month</label><input id={`pl-${p.key}-b`} inputMode="numeric" value={v.boosts} onChange={(e) => set('boosts', e.target.value)} /></div>
              </div>
              <div className="pv-actions"><Button onClick={() => save(p)}>Save {p.name}</Button></div>
            </li>
          );
        })}
      </ul>
      <p className="pv-note">New prices apply to new subscriptions; members already paying keep their price until they change plan.</p>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}
