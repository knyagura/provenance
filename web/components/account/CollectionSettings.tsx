'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { locateDistrict, toDistrict } from '@/lib/domain/places';

/** Sellers: where they are (postcode district only) and whether buyers may collect in person. */
export function CollectionSettings() {
  const { backend } = useMember();
  const id = useId();
  const [district, setDistrict] = useState('');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    backend.myProfile().then((p) => {
      setDistrict(p?.area?.district ?? '');
      setOn(Boolean(p?.collectionOk));
    }).catch(() => {});
  }, [backend]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let area: { district: string; lat: number; lng: number } | null = null;
    if (district.trim()) {
      const d = toDistrict(district);
      const p = d ? await locateDistrict(d) : null;
      if (!d || !p) {
        setBusy(false);
        return setMsg({ ok: false, text: 'We couldn’t find that postcode. Use the first half, like SW11.' });
      }
      area = { district: d, ...p };
    }
    const r = await backend.saveProfile({ area, collectionOk: on && !!area });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setDistrict(area?.district ?? '');
    setMsg({ ok: true, text: area && on ? `Saved. Buyers near ${area.district} can find your items to collect.` : 'Saved.' });
  };

  return (
    <form className="pv-panel pv-form" onSubmit={save} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Collection in person</h2>
      <p className="pv-note">Let buyers nearby find your items and collect them. We only show the first half of your postcode (like SW11) and roughly how far away you are, never your address.</p>
      <div className="pv-field">
        <label htmlFor={`${id}-d`}>Your postcode or its first half</label>
        <input id={`${id}-d`} value={district} maxLength={8} autoComplete="postal-code" onChange={(e) => setDistrict(e.target.value.toUpperCase())} />
      </div>
      <label className="pv-check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />Buyers can collect from me</label>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      <div className="pv-actions"><Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Saving…' : 'Save collection settings'}</Button></div>
    </form>
  );
}
