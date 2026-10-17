'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import type { Balance, GiftCard, PaymentStart } from '@/lib/selling';

const StripePay = dynamic(() => import('@/components/checkout/StripePay').then((m) => m.StripePay), { ssr: false, loading: () => <p role="status">Loading the payment form…</p> });
const PRESETS = [1000, 2500, 5000, 10000];
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** Gift cards: buy one (£10–£250), see the codes you've bought, redeem one into your NuTuYu balance. */
export function GiftCardsView() {
  const { member, loading, backend } = useMember();
  const params = useSearchParams();
  const [cards, setCards] = useState<GiftCard[] | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const load = useCallback(() => {
    if (!member) return;
    backend.myGiftCards().then(setCards).catch(() => setCards([]));
    backend.myBalance().then(setBalance).catch(() => setBalance(null));
  }, [member, backend]);
  useEffect(load, [load]);

  if (loading) return <p role="status">Loading…</p>;
  const here = `/gift-cards${params?.get('code') ? `?code=${encodeURIComponent(params.get('code')!)}` : ''}`;
  return (
    <div className="pv-sell pv-giftcards">
      <header className="pv-section">
        <p className="pv-eyebrow">Gift cards</p>
        <h1>Give pre-loved, with proof</h1>
        <p className="pv-lead">A NuTuYu gift card from £10 to £250. They add it to their NuTuYu balance and spend it on anything, in one go or bit by bit, for 2 years.</p>
      </header>
      {!member ? (
        <section className="pv-panel">
          <p>Sign in to buy a gift card, or to add one you’ve been given to your balance.</p>
          <Link className="pv-btn pv-btn--primary" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in</Link>
        </section>
      ) : (
        <>
          <Redeem initial={params?.get('code') ?? ''} balance={balance} onRedeemed={(b) => { setBalance(b); load(); }} />
          <Buy onBought={load} />
          {cards?.length ? (
            <section aria-labelledby="mine-h">
              <h2 id="mine-h">Gift cards you’ve bought</h2>
              <ul className="pv-rows">
                {cards.map((c) => (
                  <li key={c.id} className="pv-row pv-row--plain">
                    <span className="pv-row__text">
                      <strong>{formatPence(c.amountPence)}{c.recipientName ? ` for ${c.recipientName}` : ''}</strong>
                      {c.code ? (
                        <span>Code <strong className="pv-mono pv-giftcode">{c.code}</strong></span>
                      ) : <span className="pv-note">Waiting for payment</span>}
                      <span className="pv-note">{[c.redeemed ? 'Redeemed' : c.paymentStatus === 'paid' ? `Valid until ${date(c.expiresAt)}` : null, c.recipientEmail ? `Emailed to ${c.recipientEmail}` : 'Send them the code yourself'].filter(Boolean).join(' · ')}</span>
                    </span>
                    {c.code && !c.redeemed ? <CopyButton text={c.code} label={`Copy the code for the ${formatPence(c.amountPence)} gift card`} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="quiet" aria-label={label} onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      } catch {
        /* copying isn't allowed here; the code is on screen */
      }
    }}>{copied ? 'Copied' : 'Copy'}</Button>
  );
}

function Redeem({ initial, balance, onRedeemed }: { initial: string; balance: Balance | null; onRedeemed: (b: Balance) => void }) {
  const { backend } = useMember();
  const id = useId();
  const [code, setCode] = useState(initial.toUpperCase());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    const r = await backend.redeemGiftCard(code);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setMsg({ ok: true, text: `Added. Your balance is now ${formatPence(r.value.balancePence)}.` });
    setCode('');
    onRedeemed(r.value);
  };
  return (
    <section className="pv-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Your NuTuYu balance: {formatPence(balance?.balancePence ?? 0)}</h2>
      {balance?.lots.length ? (
        <ul className="pv-list">
          {balance.lots.map((l, i) => <li key={i}>{formatPence(l.remainingPence)} {l.source === 'refund' ? 'refunded' : 'from a gift card'}, until {date(l.expiresAt)}</li>)}
        </ul>
      ) : null}
      <p className="pv-note">Your balance is offered at checkout, and pays for all or part of an order.</p>
      <form className="pv-codes__form" onSubmit={go}>
        <label htmlFor={`${id}-c`}>Add a gift card</label>
        <span className="pv-codes__row">
          <input id={`${id}-c`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} maxLength={24} />
          <Button type="submit" variant="secondary" disabled={!code.trim()}>Add to balance</Button>
        </span>
      </form>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}

function Buy({ onBought }: { onBought: () => void }) {
  const { backend } = useMember();
  const id = useId();
  const [amount, setAmount] = useState('25');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [card, setCard] = useState<GiftCard | null>(null);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    const p = Math.round(Number(amount.replace(/[£,\s]/g, '')) * 100);
    if (!Number.isFinite(p) || p < 1000 || p > 25000) return setError('Choose an amount from £10 to £250.');
    setBusy(true);
    const r = await backend.buyGiftCard(p, name, email, message);
    if (!r.ok) {
      setBusy(false);
      return setError(r.message);
    }
    const pay = await backend.payGiftCard(r.value.id);
    setBusy(false);
    if (!pay.ok) {
      await backend.cancelGiftCard(r.value.id);
      return setError(pay.message);
    }
    setError(null);
    setCard(r.value);
    setPayment(pay.value);
  };
  const finished = () => {
    setDone(true);
    setCard(null);
    setPayment(null);
    onBought();
  };

  return (
    <section className="pv-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Buy a gift card</h2>
      {done ? <p className="pv-note" role="status">Paid. The code is below{email ? `, and we’ve emailed it to ${email}` : ''}.</p> : null}
      {card && payment ? (
        <>
          <p><strong>{formatPence(card.amountPence)} gift card{card.recipientName ? ` for ${card.recipientName}` : ''}</strong></p>
          {payment.kind === 'stripe' ? (
            <StripePay clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} amountPence={payment.amountPence} orderId={card.id} returnPath="/gift-cards" onPaid={finished} />
          ) : (
            <>
              <p className="pv-banner" role="note"><strong>Test payment.</strong> This site is running on example data, so no card is needed and no money moves.</p>
              <Button variant="primary" block disabled={busy} onClick={async () => { setBusy(true); const r = await backend.simulateGiftCardPayment(card.id); setBusy(false); if (r.ok) finished(); else setError(r.message); }}>
                {`Pay ${formatPence(payment.amountPence)} (test)`}
              </Button>
            </>
          )}
          <Button variant="quiet" onClick={async () => { await backend.cancelGiftCard(card.id); setCard(null); setPayment(null); }}>Cancel</Button>
        </>
      ) : (
        <form className="pv-form" onSubmit={start}>
          <fieldset className="pv-field">
            <legend>Amount</legend>
            <div className="pv-chips">
              {PRESETS.map((p) => (
                <button key={p} type="button" className="pv-chip" aria-pressed={Number(amount) * 100 === p} onClick={() => setAmount(String(p / 100))}>{formatPence(p).replace('.00', '')}</button>
              ))}
            </div>
            <label htmlFor={`${id}-a`}>Or any amount from £10 to £250</label>
            <input id={`${id}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </fieldset>
          <div className="pv-grid-2">
            <div className="pv-field"><label htmlFor={`${id}-n`}>Their name (optional)</label><input id={`${id}-n`} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="pv-field"><label htmlFor={`${id}-e`}>Email it to them (optional)</label><input id={`${id}-e`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={`${id}-eh`} />
              <span id={`${id}-eh`} className="pv-note">Leave it blank to give them the code yourself.</span></div>
          </div>
          <div className="pv-field"><label htmlFor={`${id}-m`}>Message (optional)</label><textarea id={`${id}-m`} rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
          <div className="pv-actions"><Button type="submit" variant="primary" disabled={busy}>{busy ? 'One moment…' : 'Continue to payment'}</Button></div>
          <p className="pv-note">Gift cards are valid for 2 years from purchase, can’t be exchanged for cash, and are spent at checkout.</p>
        </form>
      )}
    </section>
  );
}
