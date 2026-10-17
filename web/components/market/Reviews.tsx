'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { Review, ReviewSummary } from '@/lib/selling';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Five stars drawn, with the rating in words for screen readers. */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="pv-stars" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z" fill={value >= n - 0.25 ? 'var(--terracotta-text)' : 'none'} stroke="var(--terracotta-text)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}

/** A short rating line: "4.8 ★ · 12 reviews" or "No reviews yet". */
export function RatingLine({ username }: { username: string }) {
  const { backend } = useMember();
  const [r, setR] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    backend.memberReviews(username).then(setR).catch(() => setR(null));
  }, [backend, username]);
  if (!r) return null;
  if (!r.count) return <span className="pv-note">No reviews yet</span>;
  return (
    <span className="pv-rating">
      <Stars value={r.average ?? 0} size={14} />
      <span className="pv-note">{r.average?.toFixed(1)} · {r.count} {r.count === 1 ? 'review' : 'reviews'}</span>
    </span>
  );
}

/** A member page's reviews. */
export function MemberReviews({ username }: { username: string }) {
  const { backend } = useMember();
  const [r, setR] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    backend.memberReviews(username).then(setR).catch(() => setR({ count: 0, average: null, latest: [] }));
  }, [backend, username]);
  if (!r) return <p role="status">Loading reviews…</p>;
  return (
    <section className="pv-section" aria-labelledby="reviews-h">
      <div className="pv-section__head">
        <h2 id="reviews-h">Reviews</h2>
        {r.count ? <span className="pv-rating"><Stars value={r.average ?? 0} /> <span>{r.average?.toFixed(1)} from {r.count}</span></span> : null}
      </div>
      {r.latest.length ? (
        <ul className="pv-reviews">
          {r.latest.map((v, i) => (
            <li key={i}>
              <Stars value={v.rating} size={14} />
              {v.body ? <p>{v.body}</p> : null}
              <span className="pv-note">{v.author ?? 'A member'} · {v.authorRole === 'buyer' ? 'bought from them' : 'sold to them'} · {when(v.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-note">No reviews yet. Reviews appear after an order is complete.</p>
      )}
    </section>
  );
}

/** On a completed order: leave your review, and see theirs. */
export function OrderReview({ orderId, role }: { orderId: string; role: 'buyer' | 'seller' }) {
  const { backend } = useMember();
  const id = useId();
  const [state, setState] = useState<{ mine: Review | null; theirs: Review | null } | null>(null);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => backend.orderReviews(orderId).then(setState).catch(() => setState({ mine: null, theirs: null }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  const other = role === 'buyer' ? 'the seller' : 'the buyer';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) return setError('Choose 1 to 5 stars.');
    setBusy(true);
    const r = await backend.leaveReview(orderId, rating, body);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    await load();
  };
  if (!state) return null;
  return (
    <section className="pv-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Review</h2>
      {state.mine ? (
        <p>Your review of {other}: <Stars value={state.mine.rating} size={14} /> {state.mine.body ? `“${state.mine.body}”` : ''}</p>
      ) : (
        <form className="pv-form" onSubmit={submit}>
          <fieldset className="pv-field">
            <legend>How was {other}?</legend>
            <div className="pv-star-pick">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="pv-star-pick__opt">
                  <input type="radio" name={`${id}-stars`} value={n} checked={rating === n} onChange={() => setRating(n)} className="pv-visually-hidden" />
                  <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z" fill={rating >= n ? 'var(--terracotta-text)' : 'none'} stroke="var(--terracotta-text)" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                  <span className="pv-visually-hidden">{n} {n === 1 ? 'star' : 'stars'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="pv-field">
            <label htmlFor={`${id}-body`}>A few words (optional)</label>
            <textarea id={`${id}-body`} rows={3} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
          <div className="pv-actions"><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Sending…' : 'Post review'}</Button></div>
        </form>
      )}
      {state.theirs ? <p className="pv-note">{other.charAt(0).toUpperCase() + other.slice(1)} gave you <Stars value={state.theirs.rating} size={14} /> {state.theirs.body ? `“${state.theirs.body}”` : ''}</p> : null}
    </section>
  );
}
