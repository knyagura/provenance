'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { ContactTopic } from '@/lib/selling';

const TOPICS: { key: ContactTopic; label: string }[] = [
  { key: 'order', label: 'An order' },
  { key: 'account', label: 'My account' },
  { key: 'privacy', label: 'Privacy, or a request about my information' },
  { key: 'other', label: 'Something else' },
];

export function ContactForm() {
  const { member, backend } = useMember();
  const params = useSearchParams();
  const initial = (TOPICS.find((t) => t.key === params.get('topic'))?.key ?? 'order') as ContactTopic;
  const [topic, setTopic] = useState<ContactTopic>(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (member) {
      setEmail((e) => e || member.email);
      setName((n) => n || member.username);
    }
  }, [member]);

  if (sent) {
    return (
      <div className="pv-panel" role="status">
        <h2>Thanks, we’ve got your message</h2>
        <p>We’ll reply to {email}. {topic === 'privacy' ? 'Privacy requests are answered within one month.' : ''}</p>
        <p><Link href="/">Back to NuTuYu</Link></p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (trap) return setSent(true); // a bot filled the hidden field
    setBusy(true);
    const r = await backend.submitContact(name, email, topic, body);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setSent(true);
  };

  return (
    <form className="pv-panel pv-form" onSubmit={submit} noValidate>
      <fieldset className="pv-field">
        <legend>What’s it about?</legend>
        {TOPICS.map((t) => (
          <label key={t.key} className="pv-check">
            <input type="radio" name="topic" checked={topic === t.key} onChange={() => setTopic(t.key)} /> {t.label}
          </label>
        ))}
      </fieldset>
      <div className="pv-field"><label htmlFor="c-name">Your name</label><input id="c-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></div>
      <div className="pv-field"><label htmlFor="c-email">Email to reply to</label><input id="c-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div className="pv-field">
        <label htmlFor="c-body">Your message</label>
        <textarea id="c-body" rows={6} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="c-note" required />
        <span id="c-note" className="pv-note">If it’s about an order, include the item’s name. Please don’t send card details or passwords.</span>
      </div>
      <div className="pv-visually-hidden" aria-hidden="true">
        <label htmlFor="c-website">Leave this empty</label>
        <input id="c-website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" block disabled={busy}>{busy ? 'Sending…' : 'Send message'}</Button>
      <p className="pv-note">We use what you send only to reply. See our <Link href="/privacy">privacy notice</Link>.</p>
    </form>
  );
}
