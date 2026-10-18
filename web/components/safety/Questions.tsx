'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { hasContactDetails } from '@/lib/selling/trustAndSafety';
import type { ListingQuestion } from '@/lib/selling/types';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Answer({ q, onDone }: { q: ListingQuestion; onDone: (list: ListingQuestion[]) => void }) {
  const { backend } = useMember();
  const id = useId();
  const [t, setT] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await backend.answerQuestion(q.id, t);
    setBusy(false);
    if (r.ok) onDone(r.value);
    else setError(r.message);
  };
  const remove = async () => {
    const r = await backend.removeQuestion(q.id);
    if (r.ok) onDone(r.value);
    else setError(r.message);
  };
  return (
    <form className="pv-form pv-qa__answer" onSubmit={send}>
      <label htmlFor={`${id}-a`}>Your answer</label>
      <textarea id={`${id}-a`} rows={2} maxLength={1000} value={t} onChange={(e) => setT(e.target.value)} />
      <div className="pv-actions">
        <Button type="submit" variant="primary" disabled={busy || !t.trim()}>Answer</Button>
        <Button variant="quiet" onClick={remove}>Remove question</Button>
      </div>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
    </form>
  );
}

/** Questions before buying: answered ones for everyone, an ask box for buyers, answer boxes for the seller. */
export function Questions({ listingId, seller }: { listingId: string; seller: string }) {
  const { backend, member } = useMember();
  const id = useId();
  const [list, setList] = useState<ListingQuestion[] | null>(null);
  const [t, setT] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    backend.listingQuestions(listingId).then(setList).catch(() => setList([]));
  }, [backend, listingId, member]);
  const isSeller = !!member && member.username.toLowerCase() === seller.toLowerCase();
  const warn = t && hasContactDetails(t);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await backend.askQuestion(listingId, t);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setList(r.value);
    setT('');
    setMsg({ ok: true, text: `Sent. We’ll tell you when ${seller} answers.` });
  };

  return (
    <section className="pv-qa" id="questions" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="pv-h3">Questions</h2>
      {list === null ? <p role="status">Loading questions…</p> : list.length ? (
        <ul className="pv-qa__list">
          {list.map((q) => (
            <li key={q.id}>
              <p className="pv-qa__q"><strong>Q:</strong> {q.body} <span className="pv-note">{q.mine ? 'You asked' : 'A buyer asked'} · {when(q.createdAt)}</span></p>
              {q.answer ? <p className="pv-qa__a"><strong>A:</strong> {q.answer} <span className="pv-note">{seller} · {when(q.answeredAt!)}</span></p>
                : q.canAnswer ? <Answer q={q} onDone={setList} /> : <p className="pv-note">Waiting for {seller} to answer.</p>}
            </li>
          ))}
        </ul>
      ) : <p className="pv-note">No questions yet.</p>}
      {isSeller ? null : member ? (
        <form className="pv-form" onSubmit={ask}>
          <label htmlFor={`${id}-q`}>Ask {seller} a question</label>
          <textarea id={`${id}-q`} rows={2} maxLength={500} value={t} onChange={(e) => setT(e.target.value)} aria-describedby={`${id}-n`} />
          <p id={`${id}-n`} className={warn ? 'pv-errors' : 'pv-note'}>
            {warn ? 'Keep contact and payment details out: buying through NuTuYu is what keeps you protected.' : 'Answered questions are shown here for everyone, without your name.'}
          </p>
          <div className="pv-actions"><Button type="submit" disabled={busy || t.trim().length < 3}>{busy ? 'Sending…' : 'Ask'}</Button></div>
        </form>
      ) : (
        <p><Link href={`/signin?next=${encodeURIComponent(`/item/${listingId}#questions`)}`}>Sign in</Link> to ask {seller} a question.</p>
      )}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}
