'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { OrderMessage } from '@/lib/selling';
import { useMarketState } from './MarketState';

const REFRESH_MS = 8000;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The buyer and seller's conversation on an order. Kept with the order's record; it refreshes by itself. */
export function OrderMessages({ orderId, otherName }: { orderId: string; otherName: string }) {
  const { backend } = useMember();
  const { refreshCounts } = useMarketState();
  const id = useId();
  const [messages, setMessages] = useState<OrderMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(0);

  const load = useCallback(async () => {
    const m = await backend.messages(orderId).catch(() => null);
    if (!m) return;
    setMessages(m);
    if (m.length !== seen.current) {
      seen.current = m.length;
      await backend.markRead(orderId);
      refreshCounts();
    }
  }, [backend, orderId, refreshCounts]);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await backend.sendMessage(orderId, draft);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setDraft('');
    await load();
  };

  return (
    <section className="pv-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Messages</h2>
      <p className="pv-note">Only you and {otherName} see these. They’re kept with the order, so staff can read them if there’s a problem.</p>
      {messages === null ? (
        <p role="status">Loading messages…</p>
      ) : messages.length ? (
        <ol className="pv-chat" aria-label={`Messages with ${otherName}`} aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={`pv-chat__msg${m.mine ? ' pv-chat__msg--mine' : ''}`}>
              <span className="pv-chat__body">{m.body}</span>
              <span className="pv-note">{m.mine ? 'You' : otherName} · {when(m.at)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pv-note">No messages yet.</p>
      )}
      <form className="pv-chat__form" onSubmit={send}>
        <label htmlFor={`${id}-msg`} className="pv-visually-hidden">Message {otherName}</label>
        <textarea id={`${id}-msg`} rows={2} maxLength={2000} placeholder={`Message ${otherName}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</Button>
      </form>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
    </section>
  );
}
