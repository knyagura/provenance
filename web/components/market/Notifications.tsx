'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { AppNotification, NotificationGroup, NotificationPrefs } from '@/lib/selling';
import { useMarketState } from './MarketState';

const REFRESH_MS = 30_000;

export function when(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function useNotifications() {
  const { member, backend } = useMember();
  const { refreshCounts } = useMarketState();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const load = useCallback(() => {
    if (!member) return setItems([]);
    backend.notifications().then(setItems).catch(() => setItems([]));
  }, [member, backend]);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  const markRead = useCallback(async (ids: string[] | null) => {
    setItems((cur) => cur?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) ?? cur);
    await backend.markNotificationsRead(ids);
    refreshCounts();
  }, [backend, refreshCounts]);
  return { items, markRead };
}

function NotificationRows({ items, onOpen }: { items: AppNotification[]; onOpen: (n: AppNotification) => void }) {
  return (
    <ul className="pv-rows pv-notes">
      {items.map((n) => (
        <li key={n.id} className={`pv-note-row${n.read ? '' : ' pv-note-row--unread'}`}>
          <a href={n.link} className="pv-note-row__link" onClick={(e) => { e.preventDefault(); onOpen(n); }}>
            <span className="pv-note-row__top">
              <strong>{n.title}</strong>
              {n.read ? null : <span className="pv-note-row__dot"><span className="pv-visually-hidden">Unread</span></span>}
            </span>
            {n.body ? <span className="pv-note-row__body">{n.body}</span> : null}
            <span className="pv-note">{when(n.createdAt)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Unread updates at the top of the Inbox, with a link to all of them. */
export function InboxUpdates() {
  const router = useRouter();
  const { items, markRead } = useNotifications();
  if (!items) return null;
  const unread = items.filter((n) => !n.read);
  const open = (n: AppNotification) => { void markRead([n.id]); router.push(n.link); };
  return (
    <section className="pv-section" aria-labelledby="updates-h">
      <div className="pv-section__head">
        <h2 id="updates-h">Updates{unread.length ? <span className="pv-count pv-count--inline">{unread.length}<span className="pv-visually-hidden"> unread</span></span> : null}</h2>
        <Link href="/notifications">All updates</Link>
      </div>
      {unread.length ? <NotificationRows items={unread.slice(0, 5)} onOpen={open} /> : <p className="pv-note">You’re up to date.</p>}
    </section>
  );
}

/** Every recent update: sales, offers, messages and handover turns. */
export function NotificationsPage() {
  const { member, loading } = useMember();
  const router = useRouter();
  const { items, markRead } = useNotifications();
  if (loading) return <p role="status">Loading…</p>;
  if (!member) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Updates</h1>
        <p className="pv-lead">Sales, offers, messages and handover steps, in one place.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/notifications">Sign in</Link></p>
      </section>
    );
  }
  if (!items) return <p role="status">Loading your updates…</p>;
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="pv-sell">
      <header className="pv-section">
        <h1>Updates</h1>
        <p className="pv-lead">{unread ? `${unread} unread.` : 'You’re up to date.'} We also email you about these. <Link href="/profile#notifications">Choose which emails you get</Link>.</p>
        {unread ? <div className="pv-actions"><Button onClick={() => markRead(null)}>Mark all as read</Button></div> : null}
      </header>
      {items.length ? (
        <NotificationRows items={items} onOpen={(n) => { void markRead([n.id]); router.push(n.link); }} />
      ) : (
        <p className="pv-note">Nothing yet. When you sell, buy or make an offer, what happens next shows here.</p>
      )}
    </div>
  );
}

const GROUPS: { key: NotificationGroup; label: string; note: string }[] = [
  { key: 'turn', label: 'Your turn in a handover', note: 'When the next step of an order is yours.' },
  { key: 'messages', label: 'Messages', note: 'At most one email per order every 15 minutes.' },
  { key: 'offers', label: 'Offers', note: 'New offers, counter-offers, accepted offers, and offers about to end.' },
  { key: 'sales', label: 'Sales and problems', note: 'Sold, payment released, a problem reported, and our team’s decisions.' },
];

/** Which emails the member gets. The Updates list always shows everything. */
export function NotificationSettings() {
  const { backend } = useMember();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    backend.notificationPrefs().then(setPrefs).catch(() => setPrefs({ turn: true, messages: true, offers: true, sales: true }));
  }, [backend]);
  if (!prefs) return null;
  const change = async (key: NotificationGroup, on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    setBusy(true);
    const r = await backend.setNotificationPrefs(next);
    setBusy(false);
    if (!r.ok) {
      setPrefs(prefs);
      return setMsg({ ok: false, text: r.message });
    }
    setMsg({ ok: true, text: 'Saved' });
  };
  return (
    <section className="pv-panel pv-form" id="notifications" aria-labelledby="notes-h">
      <h2 id="notes-h">Emails</h2>
      <p className="pv-note">Choose what we email you about. Everything still shows in <Link href="/notifications">Updates</Link>.</p>
      <fieldset className="pv-choices">
        <legend className="pv-visually-hidden">Email me about</legend>
        {GROUPS.map((g) => (
          <label key={g.key} className="pv-choice">
            <input type="checkbox" checked={prefs[g.key]} disabled={busy} onChange={(e) => change(g.key, e.target.checked)} />
            <span><strong>{g.label}</strong><br /><span className="pv-note">{g.note}</span></span>
          </label>
        ))}
      </fieldset>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}
