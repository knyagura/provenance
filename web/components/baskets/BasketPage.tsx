'use client';

import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { BASKET_TONES, MAX_PERSONAL, budgetState, everything, fitFor, wrapCharge, type Basket } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';
import { BasketItemRow } from './BasketItemRow';
import { BasketSettings } from './BasketSettings';
import { DRAG_TYPE, useBaskets } from './BasketsState';

/**
 * The basket. With multi-basket shopping off it's one ordinary basket. Switched on, it's a General basket
 * plus up to four people, shown either as one list (General always shows everything, each item tagged
 * with its person) or as a board with a column per person.
 */
export function BasketPage() {
  const { member, loading, backend } = useMember();
  const { data, baskets, enabled, view, setView, run } = useBaskets();
  const [busy, setBusy] = useState(false);

  if (loading || (member && !data)) return <p role="status">Loading your basket…</p>;
  if (!member) {
    return (
      <section className="pv-section">
        <h1>Basket</h1>
        <p className="pv-lead">Sign in to keep a basket on every device, and to shop for several people at once.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/basket">Sign in</Link></p>
      </section>
    );
  }
  const all = data!;
  const lines = everything(all);
  const live = lines.filter((l) => l.item.available);
  const subtotal = live.reduce((n, l) => n + l.item.pricePence + l.item.postagePence, 0);
  const wrap = wrapCharge(all);
  const hidden = all.enabled ? 0 : all.baskets.filter((b) => !b.general).reduce((n, b) => n + b.items.length, 0);

  const toggle = async (on: boolean) => {
    setBusy(true);
    await run(() => backend.setMultiBasket(on), on ? 'Multi-basket shopping is on.' : 'Multi-basket shopping is off. Your people’s baskets are kept, hidden.');
    setBusy(false);
  };

  return (
    <div className="pv-baskets">
      <header className="pv-section">
        <h1>Basket</h1>
        <div className="pv-panel pv-optin">
          <div>
            <strong>Shopping for several people?</strong>
            <p className="pv-note">Make a basket for each person (up to {MAX_PERSONAL}) with their sizes, budget and gift wrapping, then pay once for everything.</p>
          </div>
          <label className="pv-switch">
            <input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
            Multi-basket shopping
          </label>
        </div>
        {hidden ? <p className="pv-note" role="note">{hidden} {hidden === 1 ? 'item is' : 'items are'} in your people’s baskets, hidden while multi-basket shopping is off.</p> : null}
        {enabled ? (
          <div className="pv-seg" role="group" aria-label="How to show your baskets">
            <button type="button" aria-pressed={view === 'single'} onClick={() => setView('single')}>One basket</button>
            <button type="button" aria-pressed={view === 'multi'} onClick={() => setView('multi')}>By person</button>
          </div>
        ) : null}
      </header>

      {!lines.length && !enabled ? (
        <EmptyState title="Your basket is empty" note="Add items from any listing, then check out once." action={{ href: '/search', label: 'Start browsing' }} />
      ) : enabled && view === 'multi' ? (
        <Board baskets={baskets} />
      ) : (
        <SingleView />
      )}

      {live.length ? (
        <section className="pv-panel" aria-labelledby="bk-total">
          <h2 id="bk-total">Total</h2>
          <div className="pv-summary-line"><span>{live.length} {live.length === 1 ? 'item' : 'items'}, with postage</span><span>{formatPence(subtotal)}</span></div>
          {wrap.items ? (
            <div className="pv-summary-line">
              <span>Gift wrapping, {wrap.items} {wrap.items === 1 ? 'item' : 'items'}{wrap.charged ? '' : ' (arrives soon, not charged)'}</span>
              <span>{formatPence(wrap.pence)}</span>
            </div>
          ) : null}
          <p className="pv-note">Buyer protection and processing are added per item at checkout, exactly as when you buy one thing.</p>
          <Link className="pv-btn pv-btn--primary pv-btn--block" href="/basket/checkout">Check out{enabled ? ' all baskets' : ''}</Link>
        </section>
      ) : null}
    </div>
  );
}

/** One list. General always shows everything; each item carries its person's tag. */
function SingleView() {
  const { data, baskets, enabled } = useBaskets();
  const [filter, setFilter] = useState<string | 'all'>('all');
  const [grouped, setGrouped] = useState(false);
  const lines = everything(data!);
  const people = baskets.filter((b) => !b.general);
  const shown = lines.filter((l) => filter === 'all' || l.basket.id === filter);
  const budgets = people.map((b) => ({ b, s: budgetState(b) })).filter((x) => x.s);
  const warnings = lines.filter((l) => fitFor(l.basket, l.item) === 'mismatch').length;

  return (
    <section className="pv-section" aria-labelledby="bk-general">
      <h2 id="bk-general">{enabled ? 'General: everything' : 'Your basket'}</h2>
      {enabled && budgets.length ? (
        <div className="pv-budgets" aria-label="Budgets">
          {budgets.map(({ b, s }) => (
            <div key={b.id}>
              <span><span className={`pv-dot pv-dot--${BASKET_TONES[b.position]}`} aria-hidden="true" /> <strong>{b.name}</strong></span>
              <span className="pv-budget" role="meter" aria-label={`${b.name}’s budget`} aria-valuemin={0} aria-valuemax={s!.budget} aria-valuenow={s!.spent} aria-valuetext={`${formatPence(s!.spent)} of ${formatPence(s!.budget)}`}>
                <span className={s!.over ? 'pv-budget__bar pv-budget__bar--over' : 'pv-budget__bar'} style={{ width: `${s!.share * 100}%` }} />
              </span>
              <span className={s!.over ? 'pv-warn-text' : 'pv-note'}>{formatPence(s!.spent)} of {formatPence(s!.budget)}{s!.over ? `, ${formatPence(s!.spent - s!.budget)} over` : ''}</span>
            </div>
          ))}
        </div>
      ) : null}
      {enabled && warnings ? <p className="pv-banner pv-banner--warn" role="note">{warnings} {warnings === 1 ? 'item isn’t' : 'items aren’t'} in their person’s size.</p> : null}
      {enabled ? (
        <div className="pv-actions">
          <div className="pv-chips" role="group" aria-label="Show">
            <button type="button" className="pv-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Everyone</button>
            {baskets.map((b) => (
              <button key={b.id} type="button" className="pv-chip" aria-pressed={filter === b.id} onClick={() => setFilter(b.id)}>
                <span className={`pv-dot pv-dot--${BASKET_TONES[b.position]}`} aria-hidden="true" />{b.general ? 'Not for anyone yet' : b.name}
              </button>
            ))}
          </div>
          <label className="pv-check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />Group by person</label>
        </div>
      ) : null}
      {!shown.length ? <p className="pv-note">Nothing here yet.</p> : grouped ? (
        baskets.filter((b) => shown.some((l) => l.basket.id === b.id)).map((b) => (
          <div key={b.id}>
            <h3 className="pv-h3"><span className={`pv-dot pv-dot--${BASKET_TONES[b.position]}`} aria-hidden="true" /> {b.general ? 'Not for anyone yet' : b.name}</h3>
            <ul className="pv-rows">{shown.filter((l) => l.basket.id === b.id).map((l) => <BasketItemRow key={l.item.listingId} item={l.item} basket={l.basket} showTag={false} />)}</ul>
          </div>
        ))
      ) : (
        <ul className="pv-rows" aria-label="Everything in your baskets">
          {shown.map((l) => <BasketItemRow key={l.item.listingId} item={l.item} basket={l.basket} showTag={enabled} />)}
        </ul>
      )}
    </section>
  );
}

/** A column per basket. Drag items between people, or use each item's menu. */
function Board({ baskets }: { baskets: Basket[] }) {
  const { backend } = useMember();
  const { run, put } = useBaskets();
  const [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const people = baskets.filter((b) => !b.general);

  const add = async () => {
    const r = await run(() => backend.saveBasket(null, { name: `Person ${people.length + 1}` }), 'Basket added. Give it a name and their sizes.');
    if (r.ok) setEditing(r.value.baskets.filter((b) => !b.general).at(-1)?.id ?? null);
  };
  const drop = (b: Basket) => async (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    try {
      const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
      await put(d.listingId, b.general ? null : b.id, d);
    } catch {
      /* not an item */
    }
  };

  return (
    <>
      <div className="pv-board">
        {baskets.map((b) => (
          <section key={b.id} className={`pv-bcol${over === b.id ? ' pv-bcol--over' : ''}`} aria-labelledby={`bcol-${b.id}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(b.id); } }}
            onDragLeave={() => setOver((o) => (o === b.id ? null : o))} onDrop={drop(b)}>
            <div className="pv-bcol__head">
              <h2 id={`bcol-${b.id}`}><span className={`pv-dot pv-dot--${BASKET_TONES[b.position]}`} aria-hidden="true" />{b.general ? 'General' : b.name}</h2>
              {!b.general ? <Button variant="quiet" aria-expanded={editing === b.id} onClick={() => setEditing(editing === b.id ? null : b.id)} aria-label={`Edit ${b.name}’s basket`}>Edit</Button> : null}
            </div>
            {b.general ? <p className="pv-note">For anyone, or not decided yet.</p> : <BasketSummary basket={b} />}
            {editing === b.id ? <BasketSettings basket={b} onDone={() => setEditing(null)} /> : null}
            {b.items.length ? (
              <ul className="pv-rows">{b.items.map((i) => <BasketItemRow key={i.listingId} item={i} basket={b} showTag={false} />)}</ul>
            ) : <p className="pv-note">Drop items here.</p>}
            {!b.general && editing !== b.id ? <BasketTools basket={b} /> : null}
          </section>
        ))}
      </div>
      {people.length < MAX_PERSONAL ? <Button variant="secondary" onClick={add}>Add a person ({people.length} of {MAX_PERSONAL})</Button> : null}
    </>
  );
}

function BasketSummary({ basket: b }: { basket: Basket }) {
  const s = budgetState(b);
  const sizes = Object.entries(b.sizes).map(([k, v]) => `${k} ${v}`).join(' · ');
  return (
    <div className="pv-note">
      <span>{b.ageGroup === 'child' ? 'Child' : 'Adult'}{sizes ? ` · ${sizes}` : ' · no sizes yet'}</span>
      {s ? <><br /><span className={s.over ? 'pv-warn-text' : undefined}>{formatPence(s.spent)} of {formatPence(s.budget)} budget</span></> : null}
      {b.styleNotes ? <><br /><span>Notes: {b.styleNotes}</span></> : null}
      {b.wrapStyle ? <><br /><span>Wrapping: {b.wrapStyle}{b.wrapAll ? ', everything' : ''}</span></> : null}
    </div>
  );
}

function BasketTools({ basket: b }: { basket: Basket }) {
  const { backend } = useMember();
  const { run } = useBaskets();
  const [copied, setCopied] = useState(false);
  const link = b.shareToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/basket/shared/${b.shareToken}` : null;
  return (
    <div className="pv-actions">
      {link ? (
        <>
          <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* shown below */ } }}>Copy share link</Button>
          <Button variant="quiet" onClick={() => void run(() => backend.shareBasket(b.id, false), 'Sharing stopped. The old link no longer works.')}>Stop sharing</Button>
          {copied ? <span className="pv-note" role="status">Link copied.</span> : <span className="pv-note pv-mono" style={{ overflowWrap: 'anywhere' }}>{link}</span>}
        </>
      ) : (
        <Button variant="quiet" onClick={() => void run(() => backend.shareBasket(b.id, true), `${b.name}’s basket can now be shared.`)}>Share this basket</Button>
      )}
      <Button variant="quiet" onClick={() => void run(() => backend.deleteBasket(b.id), `${b.name}’s basket removed. Its items moved to General.`)}>Remove basket</Button>
    </div>
  );
}
