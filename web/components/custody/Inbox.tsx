'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { custodyHeadline, isMyTurn, stepAt, type AgentTask } from '@/lib/domain/custody';
import { formatPence } from '@/lib/format';
import type { OrderSummary } from '@/lib/selling';

const REFRESH_MS = 15000;
const PAYMENT: Record<OrderSummary['paymentStatus'], string> = {
  paid: 'Paid', awaiting_payment: 'Waiting for payment', cancelled: 'Cancelled', expired: 'Checkout ended', review: 'Payment being checked', legacy: '',
};

interface Row {
  id: string;
  title: string;
  photoUrl: string | null;
  line: string;
  turn: boolean;
  group: 'buying' | 'selling' | 'work';
  amount: string | null;
}

function orderRow(o: OrderSummary): Row {
  const step = o.custody ? stepAt(o.custody.tier, o.custody.step, o.custody.state) : null;
  const v = o.custody ? { state: o.custody.state, current: step, myRoles: [o.role], tier: o.custody.tier } : null;
  return {
    id: o.id, title: o.title, photoUrl: o.photoUrl,
    line: v ? custodyHeadline(v) : PAYMENT[o.paymentStatus],
    turn: v ? isMyTurn(v) : false,
    group: o.role === 'buyer' ? 'buying' : 'selling',
    amount: o.totalPence ? formatPence(o.role === 'buyer' ? o.totalPence : o.quote?.sellerPayoutPence ?? 0) : null,
  };
}

function taskRow(t: AgentTask): Row {
  const turn = t.state === 'in_progress' && !!t.step;
  return {
    id: t.orderId, title: t.title, photoUrl: null,
    line: turn ? custodyHeadline({ state: t.state, current: t.step, myRoles: [t.step!.actor], tier: t.tier }) : custodyHeadline({ state: t.state, current: t.step, myRoles: [], tier: t.tier }),
    turn, group: 'work', amount: null,
  };
}

const GROUPS: { key: Row['group']; title: string }[] = [
  { key: 'work', title: 'Courier and hub work' },
  { key: 'buying', title: 'Buying' },
  { key: 'selling', title: 'Selling' },
];

/** Every order the member is part of, with the ones waiting for them first. Refreshes by itself. */
export function Inbox() {
  const { member, loading, backend } = useMember();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [orders, tasks] = await Promise.all([backend.myOrders(), backend.agentTasks()]);
      setRows([...tasks.map(taskRow), ...orders.map(orderRow)]);
      setError(false);
    } catch {
      setError(true);
      setRows((r) => r ?? []);
    }
  }, [backend]);

  useEffect(() => {
    if (!member) return;
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [member, load]);

  if (loading) return <p role="status">Loading…</p>;
  if (!member) {
    return (
      <section className="pv-section">
        <h1>Inbox</h1>
        <p className="pv-lead">Your orders and the steps waiting for you, on every device.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/inbox">Sign in</Link></p>
      </section>
    );
  }
  if (!rows) return <p role="status">Loading your orders…</p>;

  const turn = rows.filter((r) => r.turn);
  return (
    <div className="pv-sell">
      <header className="pv-section">
        <h1>Inbox</h1>
        <p className="pv-lead">
          {turn.length ? `${turn.length} ${turn.length === 1 ? 'order needs' : 'orders need'} you.` : 'Nothing needs you right now.'} This page updates by itself.
        </p>
      </header>
      {error ? <p className="pv-banner pv-banner--warn" role="status">We couldn’t refresh just now. We’ll keep trying.</p> : null}
      {rows.length === 0 ? <p>No orders yet. Anything you buy or sell appears here.</p> : null}
      {turn.length ? <RowList title="Your turn" rows={turn} /> : null}
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.group === g.key && !r.turn);
        return list.length ? <RowList key={g.key} title={g.title} rows={list} /> : null;
      })}
    </div>
  );
}

function RowList({ title, rows }: { title: string; rows: Row[] }) {
  const id = `inbox-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="pv-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul className="pv-rows">
        {rows.map((r) => (
          <li key={`${r.group}-${r.id}`} className={`pv-row${r.turn ? ' pv-row--turn' : ''}`}>
            <span className="pv-row__thumb" aria-hidden="true">{r.photoUrl ? <img src={r.photoUrl} alt="" /> : null}</span>
            <span className="pv-row__text">
              <strong>{r.title}</strong>
              <span className="pv-note">{[r.group === 'buying' ? 'Buying' : r.group === 'selling' ? 'Selling' : null, r.amount].filter(Boolean).join(' · ')}</span>
              <span className={r.turn ? 'pv-turn-line' : 'pv-note'}>{r.line}</span>
            </span>
            <Link className={`pv-btn ${r.turn ? 'pv-btn--primary' : 'pv-btn--secondary'}`} href={`/orders/${r.id}`} aria-label={`${r.turn ? 'Open' : 'View'} ${r.title}`}>
              {r.turn ? 'Open' : 'View'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
