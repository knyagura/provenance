'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { addressLines } from '@/lib/selling/shipping';
import type { Address, IdentityStatus, SavedAddress } from '@/lib/selling/types';

const EMPTY: Address = { name: '', line1: '', line2: null, town: '', postcode: '' };

/** Saved addresses: up to 5, one default (used for orders, and for returns when you sell). */
export function AddressBook() {
  const { backend } = useMember();
  const id = useId();
  const [list, setList] = useState<SavedAddress[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [label, setLabel] = useState('');
  const [a, setA] = useState<Address>(EMPTY);
  const [def, setDef] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { backend.myAddresses().then(setList).catch(() => setList([])); }, [backend]);

  const edit = (x: SavedAddress | null) => {
    setEditing(x ? x.id : 'new');
    setLabel(x?.label ?? '');
    setA(x?.address ?? EMPTY);
    setDef(x?.isDefault ?? false);
    setMsg(null);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await backend.saveAddress(editing === 'new' ? null : editing, label, a, def);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setList(r.value);
    setEditing(null);
    setMsg({ ok: true, text: 'Address saved.' });
  };
  const remove = async (aid: string) => {
    const r = await backend.deleteAddress(aid);
    if (r.ok) setList(r.value);
  };
  const field = (k: keyof Address, text: string, auto: string, optional = false) => (
    <div className="pv-field">
      <label htmlFor={`${id}-${k}`}>{text}{optional ? ' (optional)' : ''}</label>
      <input id={`${id}-${k}`} autoComplete={auto} value={a[k] ?? ''} onChange={(e) => setA({ ...a, [k]: e.target.value })} />
    </div>
  );

  return (
    <section className="pv-panel" id="addresses" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Addresses</h2>
      <p className="pv-note">Your default address is used for orders the seller posts, and returns come back to it when you sell. Only you, and a seller on their label, see it.</p>
      {list?.length ? (
        <ul className="pv-addresses" aria-label="Saved addresses">
          {list.map((x) => (
            <li key={x.id}>
              <span><strong>{x.label ?? 'Address'}</strong>{x.isDefault ? ' · default' : ''}</span>
              <address className="pv-address">{addressLines(x.address).map((l) => <span key={l}>{l}</span>)}</address>
              <span className="pv-actions">
                <Button variant="quiet" onClick={() => edit(x)}>Edit</Button>
                <Button variant="quiet" onClick={() => remove(x.id)}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : list ? <p>No saved addresses yet.</p> : null}
      {editing ? (
        <form className="pv-form" onSubmit={save} aria-label={editing === 'new' ? 'New address' : 'Edit address'}>
          <div className="pv-field">
            <label htmlFor={`${id}-label`}>Label (optional)</label>
            <input id={`${id}-label`} placeholder="Home" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          {field('name', 'Name', 'name')}
          {field('line1', 'Address line 1', 'address-line1')}
          {field('line2', 'Address line 2', 'address-line2', true)}
          <div className="pv-grid2">
            {field('town', 'Town or city', 'address-level2')}
            {field('postcode', 'Postcode', 'postal-code')}
          </div>
          <label className="pv-check"><input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} />Make this my default</label>
          <div className="pv-actions">
            <Button type="submit" variant="primary">Save address</Button>
            <Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      ) : (list?.length ?? 0) < 5 ? <div className="pv-actions"><Button onClick={() => edit(null)}>Add an address</Button></div> : null}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}

const ID_STATUS: Record<string, string> = {
  started: 'You started a check but didn’t finish it.',
  processing: 'Stripe is checking your documents. This usually takes a few minutes.',
  requires_input: 'The check didn’t go through. You can try again.',
  canceled: 'The check was cancelled. You can try again.',
};

/** Identity check with Stripe Identity: a photo of an ID document and a selfie, seen only by Stripe. */
export function IdentityCheck() {
  const { backend } = useMember();
  const [s, setS] = useState<IdentityStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { backend.myIdentity().then(setS).catch(() => setS(null)); }, [backend]);
  if (!s) return null;
  const start = async () => {
    setBusy(true);
    setMsg(null);
    const r = await backend.startIdentityCheck();
    if (r.ok && r.value.url) return window.location.assign(r.value.url);
    setBusy(false);
    if (!r.ok) return setMsg(r.message);
    setS(await backend.myIdentity());
  };
  return (
    <section className="pv-panel" id="identity" aria-labelledby="identity-h">
      <h2 id="identity-h">Identity check</h2>
      {s.verified ? (
        <p role="status"><strong>Identity checked.</strong> Buyers see this on your profile and items.</p>
      ) : (
        <>
          <p>Check your identity to show “Identity checked” on your profile, and to earn the Trusted seller badge. You’ll photograph a photo ID and take a selfie on Stripe’s secure page. NuTuYu never sees the images.</p>
          {s.latest && s.latest.status !== 'verified' ? <p className="pv-note">{ID_STATUS[s.latest.status]}</p> : null}
          <div className="pv-actions"><Button variant="primary" disabled={busy || !s.canStart} onClick={start}>{busy ? 'Opening…' : 'Check my identity'}</Button></div>
          {!s.canStart ? <p className="pv-note">You can try 3 times a day. Try again tomorrow.</p> : null}
        </>
      )}
      {msg ? <p className="pv-errors" role="alert">{msg}</p> : null}
    </section>
  );
}

/** Download my data, and delete my account. */
export function PrivacyTools() {
  const { backend, member } = useMember();
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const download = async () => {
    setBusy(true);
    const r = await backend.exportMyData();
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nutuyu-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg({ ok: true, text: 'Your data has downloaded.' });
  };
  const startDelete = async () => {
    setMsg(null);
    setBlockers(await backend.accountDeletionBlockers());
  };
  const del = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await backend.deleteMyAccount(confirm);
    if (!r.ok) {
      setBusy(false);
      return setMsg({ ok: false, text: r.message });
    }
    await backend.signOut().catch(() => {});
    router.push('/?account=deleted');
  };
  return (
    <section className="pv-panel" id="privacy" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Your data</h2>
      <p>Download a copy of everything NuTuYu holds about your account, as a file.</p>
      <div className="pv-actions"><Button disabled={busy} onClick={download}>Download my data</Button></div>
      <h3 className="pv-h3">Delete my account</h3>
      {blockers === null ? (
        <>
          <p className="pv-note">Your profile, addresses, saved items and sign-in are removed. Records of orders are kept, without your name, for 6 years because the law requires it.</p>
          <div className="pv-actions"><Button onClick={startDelete}>Delete my account…</Button></div>
        </>
      ) : blockers.length ? (
        <ul className="pv-list" aria-label="Before you can delete your account">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
      ) : (
        <form className="pv-form" onSubmit={del}>
          <div className="pv-field">
            <label htmlFor={`${id}-c`}>Type your username ({member?.username}) to confirm</label>
            <input id={`${id}-c`} autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <p className="pv-note">This can’t be undone.</p>
          <div className="pv-actions">
            <Button type="submit" variant="primary" disabled={busy || !confirm.trim()}>Delete my account</Button>
            <Button variant="quiet" onClick={() => setBlockers(null)}>Keep my account</Button>
          </div>
        </form>
      )}
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
    </section>
  );
}
