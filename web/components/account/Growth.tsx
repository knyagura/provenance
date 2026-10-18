'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Badge, Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { keyBytes } from '@/lib/selling/growth';
import type { BoostRules, MyPlan, Plan, PlanKey, PushStatus } from '@/lib/selling/types';

const EXAMPLE = process.env.NEXT_PUBLIC_PV_DATA_SOURCE === 'examples';

/** "Notify me on this device": Web Push for the member's updates (same groups as Updates). */
export function PushOnThisDevice() {
  const { backend } = useMember();
  const [s, setS] = useState<PushStatus | null>(null);
  const [here, setHere] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setSupported(EXAMPLE || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window));
    backend.myPush().then(setS).catch(() => {});
    if (!EXAMPLE && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration('/sw.js').then((r) => r?.pushManager.getSubscription()).then((sub) => setHere(sub?.endpoint ?? null)).catch(() => {});
    } else {
      try { setHere(localStorage.getItem('pv-example-push-endpoint')); } catch { /* no storage */ }
    }
  }, [backend]);
  if (!s || !supported) return null;
  const onHere = !!here && s.endpoints.includes(here);

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (EXAMPLE) {
        const endpoint = `https://example.push/${crypto.randomUUID()}`;
        const r = await backend.savePushSubscription({ endpoint, p256dh: 'example', auth: 'example' });
        if (!r.ok) throw new Error(r.message);
        try { localStorage.setItem('pv-example-push-endpoint', endpoint); } catch { /* no storage */ }
        setHere(endpoint);
        setS(r.value);
      } else {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser’s settings, then try again.');
        const key = await backend.pushPublicKey();
        if (!key) throw new Error('Notifications aren’t ready yet. Try again in a minute.');
        const reg = (await navigator.serviceWorker.getRegistration('/sw.js')) ?? (await navigator.serviceWorker.register('/sw.js'));
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
        const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const r = await backend.savePushSubscription({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
        if (!r.ok) throw new Error(r.message);
        setHere(j.endpoint);
        setS(r.value);
      }
      setMsg({ ok: true, text: 'Notifications are on for this device.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || 'That didn’t work. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    if (!here) return;
    const r = await backend.deletePushSubscription(here);
    if (!EXAMPLE) await navigator.serviceWorker.getRegistration('/sw.js').then((reg) => reg?.pushManager.getSubscription()).then((sub) => sub?.unsubscribe()).catch(() => {});
    if (r.ok) setS(r.value);
    setHere(null);
    setMsg({ ok: true, text: 'Notifications are off for this device.' });
  };
  return (
    <section className="pv-panel" id="push" aria-labelledby="push-h">
      <h2 id="push-h">Phone and desktop notifications</h2>
      <p className="pv-note">Get a notification when it’s your turn, an offer arrives or something sells, the same updates you see in Updates.</p>
      <div className="pv-actions">
        {onHere ? <Button onClick={turnOff}>Turn off on this device</Button> : <Button variant="primary" disabled={busy} onClick={turnOn}>{busy ? 'Turning on…' : 'Notify me on this device'}</Button>}
      </div>
      {s.devices ? <p className="pv-note">On for {s.devices} {s.devices === 1 ? 'device' : 'devices'}.</p> : null}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}

const API: Record<string, string> = { none: 'No seller API', core: 'Core seller API', full: 'Full API set' };

/** The plans side by side, with the member's current one and a way to change. */
export function PlanPicker() {
  const { backend, member, loading } = useMember();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [mine, setMine] = useState<MyPlan | null>(null);
  const [busy, setBusy] = useState<PlanKey | 'portal' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    backend.plans().then(setPlans).catch(() => setPlans([]));
    if (member) backend.myPlan().then(setMine).catch(() => {});
    if (new URLSearchParams(window.location.search).get('subscribed')) setMsg({ ok: true, text: 'Thanks: your plan is starting. It may take a moment to show here.' });
  }, [backend, member]);
  const choose = async (p: Plan) => {
    setBusy(p.key);
    setMsg(null);
    if (p.pricePence > 0) {
      const r = await backend.startSubscription(p.key);
      if (r.ok && r.value.url) return window.location.assign(r.value.url);
      setBusy(null);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
    } else {
      const r = await backend.chooseFreePlan(p.key);
      setBusy(null);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
    }
    setMine(await backend.myPlan());
    setMsg({ ok: true, text: `You’re on ${p.name}.` });
  };
  const portal = async () => {
    setBusy('portal');
    const r = await backend.billingPortal();
    setBusy(null);
    if (r.ok) window.location.assign(r.value.url);
    else setMsg({ ok: false, text: r.message });
  };
  if (!plans) return <p role="status">Loading plans…</p>;
  const current = mine?.plan ?? 'standard';
  return (
    <>
      <ul className="pv-plans" aria-label="Plans">
        {plans.map((p) => (
          <li key={p.key} className={`pv-plan${p.key === current && member ? ' pv-plan--current' : ''}`}>
            <h2>{p.name}</h2>
            <p className="pv-plan__price">{p.pricePence ? <>{formatPence(p.pricePence)}<span className="pv-note"> a month</span></> : 'Free'}</p>
            <p>{p.perks.blurb}</p>
            <ul className="pv-list">
              <li>{API[p.perks.api]}</li>
              {p.perks.badge ? <li>A {p.name} badge on your profile</li> : null}
              {p.perks.fee_free_orders ? <li>{p.perks.fee_free_orders} fee-free orders a month</li> : null}
              {p.perks.boost_credits ? <li>{p.perks.boost_credits} free boosts a month</li> : null}
              <li>Full buyer protection on every order</li>
            </ul>
            {loading ? null : !member ? (
              <Link className="pv-btn pv-btn--secondary" href="/signin?next=/plans">Sign in to choose</Link>
            ) : p.key === current ? (
              <Badge tone="verified">Your plan</Badge>
            ) : (
              <Button variant={p.pricePence ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => choose(p)}>
                {busy === p.key ? 'One moment…' : p.pricePence ? `Get ${p.name}` : `Choose ${p.name}`}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {mine?.subscription?.paid ? (
        <p>
          {mine.subscription.cancelAtPeriodEnd && mine.subscription.currentPeriodEnd ? `Your plan ends on ${new Date(mine.subscription.currentPeriodEnd).toLocaleDateString('en-GB')}. ` : ''}
          <Button variant="quiet" disabled={!!busy} onClick={portal}>Manage billing</Button>
        </p>
      ) : null}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </>
  );
}

/** A plan badge (Premium, Premium+) on a member's page. */
export function MemberPlanBadge({ username }: { username: string }) {
  const { backend } = useMember();
  const [p, setP] = useState<{ name: string } | null>(null);
  useEffect(() => { backend.memberPlan(username).then(setP).catch(() => {}); }, [backend, username]);
  return p ? <Badge tone="boosted">{p.name}</Badge> : null;
}

/** On the item page, for its seller: boost it (pay a fee only if it sells) or stop the boost. */
export function BoostControl({ listingId, seller, pricePence, live }: { listingId: string; seller: string; pricePence: number; live: boolean }) {
  const { backend, member } = useMember();
  const id = useId();
  const [rules, setRules] = useState<BoostRules | null>(null);
  const [bp, setBp] = useState<number | null>(null);
  const [pick, setPick] = useState(500);
  const [mine, setMine] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const [r, b] = await Promise.all([backend.boostRules(), backend.listingBoost(listingId)]);
    setRules(r);
    setBp(b);
  }, [backend, listingId]);
  useEffect(() => {
    // Only the seller sees this. Example accounts are known by email; live ones by username.
    const isSeller = !!member && (member.username.toLowerCase() === seller.toLowerCase() || member.email.toLowerCase() === `${seller.toLowerCase()}@example.test`);
    setMine(isSeller);
    if (isSeller) load().catch(() => {});
  }, [member, seller, load]);
  if (!mine || !rules || !live || !rules.on) return null;
  if (pricePence < rules.minPricePence) return <p className="pv-note">Items priced at {formatPence(rules.minPricePence)} or more can be boosted.</p>;
  const fee = (b: number) => formatPence(Math.round((pricePence * b) / 10000) + rules.fixedPence);
  const set = async (v: number | null) => {
    const r = await backend.setBoost(listingId, v);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setBp(r.value.boostBp);
    setMsg({ ok: true, text: v === null ? 'Boost stopped.' : 'Boosted: it now shows first in browse and search.' });
  };
  const steps = [];
  for (let b = rules.minBp; b <= rules.maxBp; b += 100) steps.push(b);
  return (
    <section className="pv-panel pv-boost" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="pv-h3">Boost this listing</h2>
      {bp !== null ? (
        <>
          <p><Badge tone="boosted">Boosted</Badge> at {bp / 100}%: if it sells, you pay {fee(bp)}. Nothing if it doesn’t.</p>
          <Button onClick={() => set(null)}>Stop boosting</Button>
        </>
      ) : (
        <>
          <p className="pv-note">Boosted items show first in browse and search, marked Boosted. You pay a fee only if it sells.</p>
          <div className="pv-field pv-field--inline">
            <label htmlFor={`${id}-r`}>Boost</label>
            <select id={`${id}-r`} value={pick} onChange={(e) => setPick(Number(e.target.value))}>
              {steps.map((b) => <option key={b} value={b}>{b / 100}% (you pay {fee(b)} if it sells)</option>)}
            </select>
          </div>
          <Button variant="primary" onClick={() => set(pick)}>Boost it</Button>
        </>
      )}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}
