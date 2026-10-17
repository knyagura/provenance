'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { PopupPatch, SitePopup } from '@/lib/selling';

/** "Title — note" per line, for a popup's steps. */
export function stepsToText(steps: SitePopup['steps']): string {
  return steps.map((s) => `${s.title} — ${s.note}`).join('\n');
}
export function textToSteps(text: string): SitePopup['steps'] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).map((l) => {
    const [title, ...rest] = l.split(/\s+[—–-]\s+/);
    return { title: title.trim(), note: rest.join(' – ').trim() };
  });
}
const local = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const iso = (v: string) => (v ? new Date(v).toISOString() : null);

const BLANK: PopupPatch = {
  key: '', kind: 'announcement', title: '', body: '', steps: [], ctaLabel: '', ctaHref: '', offerCode: '', audience: 'everyone',
  pages: '/', delaySeconds: 2, priority: 0, active: false, startsAt: null, endsAt: null,
};

/** Staff: the popups shown on the site (how protection works, offers, announcements). */
export function PopupEditor() {
  const { backend } = useMember();
  const id = useId();
  const [list, setList] = useState<SitePopup[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<PopupPatch>(BLANK);
  const [stepsText, setStepsText] = useState('');
  const [again, setAgain] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    backend.staffPopups().then(setList).catch(() => setList([]));
  }, [backend]);

  const start = (p: SitePopup | null) => {
    setEditing(p ? p.id : 'new');
    setForm(p ? { ...p } : { ...BLANK });
    setStepsText(p ? stepsToText(p.steps) : '');
    setAgain(false);
    setMsg(null);
  };
  const set = <K extends keyof PopupPatch>(k: K, v: PopupPatch[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const patch: PopupPatch = { ...form, steps: textToSteps(stepsText) };
    if (editing !== 'new') delete patch.key;
    const r = await backend.staffSavePopup(editing === 'new' ? null : editing, patch, again);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    setList(r.value);
    setEditing(null);
    setMsg({ ok: true, text: `Saved “${form.title}”.` });
  };

  if (!list) return <p role="status">Loading popups…</p>;
  return (
    <>
      <p className="pv-note">Popups appear once per person, after the delay you set, on the pages you list. Use them to explain how protection works, announce things, or show an offer when people sign up.</p>
      <ul className="pv-rows">
        {list.map((p) => (
          <li key={p.id} className="pv-row pv-row--plain">
            <span className="pv-row__text">
              <strong>{p.title}</strong>
              <span className="pv-note">{[p.active ? 'Live' : 'Off', p.kind, p.audience === 'everyone' ? 'Everyone' : p.audience === 'visitors' ? 'Visitors (not signed in)' : 'Members', `pages ${p.pages}`].join(' · ')}</span>
            </span>
            <Button variant="secondary" onClick={() => start(p)} aria-label={`Edit ${p.title}`}>Edit</Button>
          </li>
        ))}
      </ul>
      {msg ? <p className={msg.ok ? 'pv-note' : 'pv-errors'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      {editing ? (
        <form className="pv-panel pv-form" onSubmit={save} aria-labelledby={`${id}-h`}>
          <h2 id={`${id}-h`}>{editing === 'new' ? 'New popup' : `Edit “${form.title}”`}</h2>
          {editing === 'new' ? (
            <div className="pv-field"><label htmlFor={`${id}-key`}>Short name</label>
              <input id={`${id}-key`} required pattern="[a-z0-9-]{2,40}" value={form.key ?? ''} onChange={(e) => set('key', e.target.value.toLowerCase())} aria-describedby={`${id}-keyh`} />
              <span id={`${id}-keyh`} className="pv-note">Letters, numbers and dashes, for example spring-sale. Can’t be changed later.</span></div>
          ) : null}
          <div className="pv-grid-2">
            <div className="pv-field"><label htmlFor={`${id}-kind`}>Type</label>
              <select id={`${id}-kind`} value={form.kind} onChange={(e) => set('kind', e.target.value as SitePopup['kind'])}>
                <option value="info">Explanation</option><option value="offer">Offer</option><option value="announcement">Announcement</option>
              </select></div>
            <div className="pv-field"><label htmlFor={`${id}-aud`}>Who sees it</label>
              <select id={`${id}-aud`} value={form.audience} onChange={(e) => set('audience', e.target.value as SitePopup['audience'])}>
                <option value="everyone">Everyone</option><option value="visitors">Visitors who aren’t signed in</option><option value="members">Members</option>
              </select></div>
          </div>
          <div className="pv-field"><label htmlFor={`${id}-title`}>Title</label><input id={`${id}-title`} required maxLength={120} value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} /></div>
          <div className="pv-field"><label htmlFor={`${id}-body`}>Text</label><textarea id={`${id}-body`} rows={3} maxLength={1000} value={form.body ?? ''} onChange={(e) => set('body', e.target.value)} /></div>
          <div className="pv-field"><label htmlFor={`${id}-steps`}>Steps (optional)</label>
            <textarea id={`${id}-steps`} rows={3} value={stepsText} onChange={(e) => setStepsText(e.target.value)} aria-describedby={`${id}-stepsh`} />
            <span id={`${id}-stepsh`} className="pv-note">One per line: Title — explanation. Up to 6.</span></div>
          <div className="pv-grid-2">
            <div className="pv-field"><label htmlFor={`${id}-cl`}>Button text</label><input id={`${id}-cl`} maxLength={40} value={form.ctaLabel ?? ''} onChange={(e) => set('ctaLabel', e.target.value)} /></div>
            <div className="pv-field"><label htmlFor={`${id}-ch`}>Button goes to</label><input id={`${id}-ch`} placeholder="/search" value={form.ctaHref ?? ''} onChange={(e) => set('ctaHref', e.target.value)} /></div>
            <div className="pv-field"><label htmlFor={`${id}-code`}>Offer code (optional)</label><input id={`${id}-code`} maxLength={20} value={form.offerCode ?? ''} onChange={(e) => set('offerCode', e.target.value.toUpperCase())} /></div>
            <div className="pv-field"><label htmlFor={`${id}-pages`}>Pages</label><input id={`${id}-pages`} value={form.pages ?? ''} onChange={(e) => set('pages', e.target.value)} aria-describedby={`${id}-pagesh`} />
              <span id={`${id}-pagesh`} className="pv-note">/ is the home page; /search, /item/ and so on; * for every page. Separate with commas.</span></div>
            <div className="pv-field"><label htmlFor={`${id}-delay`}>Show after (seconds)</label><input id={`${id}-delay`} type="number" min={0} max={120} value={form.delaySeconds ?? 0} onChange={(e) => set('delaySeconds', Number(e.target.value))} /></div>
            <div className="pv-field"><label htmlFor={`${id}-prio`}>Priority</label><input id={`${id}-prio`} type="number" value={form.priority ?? 0} onChange={(e) => set('priority', Number(e.target.value))} aria-describedby={`${id}-prioh`} />
              <span id={`${id}-prioh`} className="pv-note">Higher shows first. One popup at a time.</span></div>
            <div className="pv-field"><label htmlFor={`${id}-from`}>From (optional)</label><input id={`${id}-from`} type="datetime-local" value={local(form.startsAt ?? null)} onChange={(e) => set('startsAt', iso(e.target.value))} /></div>
            <div className="pv-field"><label htmlFor={`${id}-to`}>Until (optional)</label><input id={`${id}-to`} type="datetime-local" value={local(form.endsAt ?? null)} onChange={(e) => set('endsAt', iso(e.target.value))} /></div>
          </div>
          <label className="pv-check"><input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)} />Live</label>
          {editing !== 'new' ? <label className="pv-check"><input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />Show again to people who already closed it</label> : null}
          <div className="pv-actions">
            <Button type="submit" variant="primary">Save popup</Button>
            <Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="pv-actions"><Button variant="secondary" onClick={() => start(null)}>New popup</Button></div>
      )}
    </>
  );
}
