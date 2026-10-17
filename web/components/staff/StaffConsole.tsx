'use client';

import { Reports } from './Reports';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import type { ContactMessage, StaffAgent, StaffQueueItem, StaffSettings } from '@/lib/selling';
import { StaffGate } from './StaffGate';
import { VoucherEditor } from '@/components/vouchers/VoucherEditor';
import { PopupEditor } from './PopupEditor';

type Tab = 'queue' | 'messages' | 'reports' | 'agents' | 'vouchers' | 'popups' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'messages', label: 'Messages' },
  { key: 'agents', label: 'Couriers and hubs' },
  { key: 'vouchers', label: 'Vouchers' },
  { key: 'popups', label: 'Popups' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
];
const KIND: Record<StaffQueueItem['kind'], string> = { dispute: 'Dispute', payment: 'Payment check', weight: 'Weight mismatch' };
const since = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function StaffConsole() {
  const [tab, setTab] = useState<Tab>('queue');
  return (
    <StaffGate>
      <div className="pv-sell pv-staff">
        <header className="pv-section">
          <p className="pv-eyebrow">NuTuYu staff</p>
          <h1>Staff console</h1>
          <p className="pv-lead">Every decision here is recorded with your name and can’t be edited afterwards.</p>
        </header>
        <div className="pv-tabs" role="tablist" aria-label="Staff sections">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`}
              className={`pv-tab${tab === t.key ? ' pv-tab--on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'queue' ? <Queue /> : tab === 'messages' ? <Messages /> : tab === 'agents' ? <Agents /> : tab === 'vouchers' ? <VoucherEditor mode="staff" /> : tab === 'popups' ? <PopupEditor /> : tab === 'reports' ? <Reports /> : <Settings />}
        </div>
      </div>
    </StaffGate>
  );
}

function Queue() {
  const { backend } = useMember();
  const [items, setItems] = useState<StaffQueueItem[] | null>(null);
  useEffect(() => {
    backend.staffQueue().then(setItems).catch(() => setItems([]));
  }, [backend]);
  if (!items) return <p role="status">Loading the queue…</p>;
  if (!items.length) return <p className="pv-note">Nothing waiting. Disputes, payments in review and weight mismatches appear here.</p>;
  return (
    <ul className="pv-rows">
      {items.map((q) => (
        <li key={`${q.kind}-${q.orderId}`} className="pv-row pv-row--plain">
          <span className="pv-row__text">
            <span className="pv-row__top"><strong>{q.title}</strong><span className={`pv-status pv-status--${q.kind === 'dispute' ? 'held' : 'turn'}`}>{KIND[q.kind]}</span></span>
            <span className="pv-note">{q.reason} · buyer {q.buyer} · seller {q.seller}{q.totalPence ? ` · ${formatPence(q.totalPence)}` : ''} · since {since(q.since)}</span>
          </span>
          <Link className="pv-btn pv-btn--secondary" href={`/staff/orders/${q.orderId}`} aria-label={`Open ${q.title}`}>Open</Link>
        </li>
      ))}
    </ul>
  );
}

function Agents() {
  const { backend } = useMember();
  const id = useId();
  const [agents, setAgents] = useState<StaffAgent[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'courier' | 'hub'>('courier');
  const [org, setOrg] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => backend.staffAgents().then(setAgents).catch(() => setAgents([])), [backend]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await backend.staffSetAgent(email.trim(), role, org.trim(), true);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setAgents(r.value);
    setMsg({ ok: true, text: `${email.trim()} can now record ${role} steps.` });
    setEmail('');
  };
  const toggle = async (a: StaffAgent) => {
    if (!a.email) return;
    const r = await backend.staffSetAgent(a.email, a.role, a.organisation, !a.active);
    if (r.ok) setAgents(r.value);
    else setMsg({ ok: false, text: r.message });
  };

  return (
    <>
      <form className="pv-panel pv-form" onSubmit={add} aria-labelledby={`${id}-h`}>
        <h2 id={`${id}-h`}>Add a courier or hub account</h2>
        <p className="pv-note">The person signs up as an ordinary member first. Adding them here lets them record that role’s steps on any order.</p>
        <div className="pv-field"><label htmlFor={`${id}-e`}>Their account email</label><input id={`${id}-e`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="pv-field">
          <label htmlFor={`${id}-r`}>Role</label>
          <select id={`${id}-r`} value={role} onChange={(e) => setRole(e.target.value as 'courier' | 'hub')}><option value="courier">Courier</option><option value="hub">Authentication hub</option></select>
        </div>
        <div className="pv-field"><label htmlFor={`${id}-o`}>Organisation</label><input id={`${id}-o`} required value={org} onChange={(e) => setOrg(e.target.value)} /></div>
        {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
        <div className="pv-actions"><Button type="submit" variant="primary">Add</Button></div>
      </form>
      {!agents ? <p role="status">Loading…</p> : agents.length ? (
        <ul className="pv-rows">
          {agents.map((a) => (
            <li key={`${a.userId}-${a.role}`} className="pv-row pv-row--plain">
              <span className="pv-row__text">
                <strong>{a.username} · {a.role === 'hub' ? 'Hub' : 'Courier'}</strong>
                <span className="pv-note">{[a.organisation, a.email, a.active ? 'Active' : 'Switched off'].filter(Boolean).join(' · ')}</span>
              </span>
              <Button variant={a.active ? 'quiet' : 'secondary'} onClick={() => toggle(a)}>{a.active ? 'Switch off' : 'Switch on'}</Button>
            </li>
          ))}
        </ul>
      ) : <p className="pv-note">No courier or hub accounts yet.</p>}
      <BusinessSellers />
    </>
  );
}

/** Mark a member as a business seller, so they can sell stock and colours/sizes. */
function BusinessSellers() {
  const { backend } = useMember();
  const id = useId();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = async (on: boolean) => {
    if (!name.trim()) return setMsg({ ok: false, text: 'Enter their username.' });
    const r = await backend.staffSetBusiness(name.trim(), on);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setMsg({ ok: true, text: on ? `${r.value.username} is now a business seller.` : `${r.value.username} is no longer a business seller.` });
  };
  return (
    <form className="pv-panel pv-form" onSubmit={(e) => { e.preventDefault(); void set(true); }} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Business sellers</h2>
      <p className="pv-note">Business sellers can sell more than one of an item, in several colours and sizes, at fixed prices. Their listings show “Business seller”.</p>
      <div className="pv-field"><label htmlFor={`${id}-u`}>Username</label><input id={`${id}-u`} value={name} onChange={(e) => setName(e.target.value)} /></div>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      <div className="pv-actions">
        <Button type="submit" variant="primary">Make business seller</Button>
        <Button variant="quiet" onClick={() => set(false)}>Remove</Button>
      </div>
    </form>
  );
}

const CUSTODY_LABEL: Record<string, string> = {
  challenge_minutes: 'Minutes a spoken code lasts',
  confirm_window_hours: 'Hours before a standard order confirms itself',
  enhanced_confirm_days: 'Days before a protected order confirms itself',
  weight_tolerance_grams: 'Weight difference allowed (grams)',
  weight_tolerance_pct: 'Weight difference allowed (%)',
};
const OFFER_LABEL: Record<string, string> = {
  min_pct: 'Lowest offer, as % of price',
  reply_hours: 'Hours to answer an offer',
  checkout_hours: 'Hours to pay after an offer is accepted',
  wrap_fee_pence: 'Gift wrapping, per item (pence)',
};

function Settings() {
  const { backend } = useMember();
  const id = useId();
  const [s, setS] = useState<StaffSettings | null | undefined>(undefined);
  const [custody, setCustody] = useState<Record<string, string>>({});
  const [offers, setOffers] = useState<Record<string, string>>({});
  const [feeJson, setFeeJson] = useState('');
  const [feeNote, setFeeNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const take = (v: StaffSettings | null) => {
    setS(v);
    if (!v) return;
    setCustody(Object.fromEntries(Object.entries(v.custody).map(([k, n]) => [k, String(n)])));
    setOffers(Object.fromEntries(Object.entries(v.offers).map(([k, n]) => [k, String(n)])));
    const current = v.fees.find((f) => f.version === v.currentFeeVersion) ?? v.fees[0];
    setFeeJson(current ? JSON.stringify(current.settings, null, 2) : '{}');
  };
  useEffect(() => {
    backend.staffSettings().then(take).catch(() => setS(null));
  }, [backend]);

  if (s === undefined) return <p role="status">Loading settings…</p>;
  if (!s) return <p className="pv-errors">Settings couldn’t be loaded.</p>;

  const nums = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await backend.staffUpdateSettings(nums(custody), nums(offers));
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    take(r.value);
    setMsg({ ok: true, text: 'Settings saved. They apply to new orders and offers.' });
  };
  const addFees = async (e: FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(feeJson);
    } catch {
      return setMsg({ ok: false, text: 'The fee settings aren’t valid JSON.' });
    }
    const r = await backend.staffAddFeeVersion(parsed, feeNote.trim());
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    take(r.value);
    setFeeNote('');
    setMsg({ ok: true, text: `Fee version ${r.value.currentFeeVersion} added. Orders already started keep the version they were quoted.` });
  };

  const fields = (vals: Record<string, string>, set: (v: Record<string, string>) => void, labels: Record<string, string>, prefix: string) =>
    Object.keys(vals).map((k) => (
      <div className="pv-field" key={k}>
        <label htmlFor={`${id}-${prefix}-${k}`}>{labels[k] ?? k}</label>
        <input id={`${id}-${prefix}-${k}`} type="number" inputMode="numeric" min={0} value={vals[k]} onChange={(e) => set({ ...vals, [k]: e.target.value })} />
      </div>
    ));

  return (
    <>
      {msg ? <p className={msg.ok ? 'pv-banner' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      <form className="pv-panel pv-form" onSubmit={save}>
        <h2>Custody</h2>
        {fields(custody, setCustody, CUSTODY_LABEL, 'c')}
        <h2>Offers and gifts</h2>
        {fields(offers, setOffers, OFFER_LABEL, 'o')}
        <div className="pv-actions"><Button type="submit" variant="primary">Save settings</Button></div>
      </form>
      <form className="pv-panel pv-form" onSubmit={addFees}>
        <h2>Fees</h2>
        <p className="pv-note">Current version {s.currentFeeVersion}. A new version applies to quotes from now on; it never changes an order already quoted. Transaction fees must stay between 3% and 8%, plus the processing fee.</p>
        <div className="pv-field">
          <label htmlFor={`${id}-fees`}>Settings for the new version (JSON)</label>
          <textarea id={`${id}-fees`} className="pv-mono" rows={12} value={feeJson} onChange={(e) => setFeeJson(e.target.value)} spellCheck={false} />
        </div>
        <div className="pv-field"><label htmlFor={`${id}-fnote`}>Why it changed</label><input id={`${id}-fnote`} required value={feeNote} onChange={(e) => setFeeNote(e.target.value)} /></div>
        <div className="pv-actions"><Button type="submit">Add fee version</Button></div>
        <details>
          <summary>Earlier versions</summary>
          <ul className="pv-list">{s.fees.map((f) => <li key={f.version}>Version {f.version}, from {since(f.effectiveFrom)}{f.note ? `: ${f.note}` : ''}</li>)}</ul>
        </details>
      </form>
    </>
  );
}

const TOPIC: Record<ContactMessage['topic'], string> = { privacy: 'Privacy', account: 'Account', order: 'Order', other: 'Other' };

/** Contact form messages. Reply by email, then mark handled. Privacy requests must be answered within one month. */
function Messages() {
  const { backend } = useMember();
  const [openOnly, setOpenOnly] = useState(true);
  const [list, setList] = useState<ContactMessage[] | null>(null);
  const load = useCallback(() => backend.staffContactMessages(openOnly).then(setList).catch(() => setList([])), [backend, openOnly]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!list) return <p role="status">Loading messages…</p>;
  return (
    <>
      <label className="pv-check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Only messages not yet handled</label>
      {!list.length ? <p className="pv-note">No messages.</p> : (
        <ul className="pv-rows">
          {list.map((m) => (
            <li key={m.id} className="pv-row pv-row--plain">
              <span className="pv-row__text">
                <span className="pv-row__top"><strong>{m.name}</strong><span className={`pv-status pv-status--${m.topic === 'privacy' ? 'held' : 'turn'}`}>{TOPIC[m.topic]}</span></span>
                <span className="pv-note"><a href={`mailto:${m.email}?subject=${encodeURIComponent('Your message to NuTuYu')}`}>{m.email}</a>{m.member ? ` · member ${m.member}` : ''} · {since(m.createdAt)}{m.handledAt ? ` · handled by ${m.handledBy ?? 'staff'}` : ''}</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
              </span>
              {!m.handledAt ? <Button variant="secondary" onClick={async () => { await backend.staffContactHandled(m.id); void load(); }}>Mark handled</Button> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
