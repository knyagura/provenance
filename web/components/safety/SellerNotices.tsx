'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';

/** On the selling page: questions waiting for an answer, and listings staff have hidden (with why). */
export function SellerNotices() {
  const { backend } = useMember();
  const [questions, setQuestions] = useState<Awaited<ReturnType<typeof backend.myUnansweredQuestions>>>([]);
  const [hidden, setHidden] = useState<Awaited<ReturnType<typeof backend.myHiddenListings>>>([]);
  useEffect(() => {
    backend.myUnansweredQuestions().then(setQuestions).catch(() => {});
    backend.myHiddenListings().then(setHidden).catch(() => {});
  }, [backend]);
  if (!questions.length && !hidden.length) return null;
  return (
    <>
      {hidden.length ? (
        <section className="pv-banner pv-banner--warn" aria-labelledby="hidden-h">
          <h2 id="hidden-h" className="pv-h3">Hidden by NuTuYu staff</h2>
          <ul className="pv-list">
            {hidden.map((h) => <li key={h.id}><strong>{h.title}</strong>{h.note ? `: ${h.note}` : ''}</li>)}
          </ul>
          <p>These can’t be bought. <Link href="/contact">Contact us</Link> if you think that’s wrong.</p>
        </section>
      ) : null}
      {questions.length ? (
        <section className="pv-panel" aria-labelledby="unanswered-h">
          <h2 id="unanswered-h">Questions to answer</h2>
          <ul className="pv-list">
            {questions.map((q) => <li key={q.id}><Link href={`/item/${q.listingId}#questions`}>{q.title}</Link>: “{q.body}”</li>)}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** On an example item page: staff hid it in this browser (example items stay in browse, so the page says so). */
export function ExampleHiddenNotice({ listingId }: { listingId: string }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (listingId.startsWith('example-')) import('@/lib/selling/exampleSafety').then((m) => setNote(m.exampleSafety.hiddenNote(listingId))).catch(() => {});
  }, [listingId]);
  if (!note) return null;
  return <p className="pv-banner pv-banner--warn" role="note">Hidden by NuTuYu staff: {note}</p>;
}
