'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { LiveListing } from './LiveListing';
import { BackLink } from '@/components/ui/BackLink';
import { fallbackCategories } from '@/lib/domain/examples';
import { CATEGORY_TREE, categoryPath, materialSuggestions, sizeConversions, sizeKindFor, sizeSuggestions } from '@/lib/domain/taxonomy';
import { MAX_PRICE_PENCE, MIN_PRICE_PENCE, PARCEL_SIZES, missingForPublish, profileFor, tierForPrice, type Shot } from '@/lib/domain/evidence';
import { TIER_LABEL } from '@/lib/domain/present';
import { CONDITIONS } from '@/lib/domain/types';
import { formatPence, parsePounds } from '@/lib/format';
import { MediaProblem, preparePhoto, prepareVideo } from '@/lib/media';
import type { Draft, DraftFields } from '@/lib/selling';

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

export function DraftEditor({ id }: { id: string }) {
  const { member, loading, backend } = useMember();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [uploading, setUploading] = useState<string | null>(null);
  const [shotError, setShotError] = useState<{ shot: string; message: string } | null>(null);
  const [priceText, setPriceText] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const pending = useRef(new Set<Promise<unknown>>());

  const reload = useCallback(async () => {
    const d = await backend.getDraft(id);
    setDraft(d);
    if (d && d.pricePence !== null) setPriceText((d.pricePence / 100).toFixed(2));
  }, [backend, id]);

  useEffect(() => {
    if (member) reload().catch(() => setDraft(null));
  }, [member, reload]);

  // Every save is tracked, so Publish waits for the last one to land.
  const track = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    pending.current.add(p);
    p.finally(() => pending.current.delete(p));
    return p;
  }, []);

  const save = useCallback(async (fields: DraftFields) => {
    setDraft((d) => (d ? { ...d, ...fields } : d));
    setStatus({ kind: 'saving' });
    const r = await track(backend.saveDraft(id, fields));
    setStatus(r.ok ? { kind: 'saved' } : { kind: 'error', message: r.message });
  }, [backend, id, track]);

  if (loading || (member && draft === undefined)) return <p role="status">Loading your draft…</p>;
  if (!member) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Sell an item</h1>
        <p><Link className="pv-btn pv-btn--primary" href={`/signin?next=/sell/${id}`}>Sign in to carry on</Link></p>
      </section>
    );
  }
  if (!draft) {
    return (
      <section className="pv-section">
        <h1>Draft not found</h1>
        <p>It may have been deleted. <Link href="/sell">Start a new listing</Link></p>
      </section>
    );
  }
  if (draft.published || draft.status !== 'active') {
    return (
      <LiveListing
        draft={draft}
        onPause={async () => {
          const r = await backend.pauseForEditing(draft.id);
          if (!r.ok) return r.message;
          await reload();
          return null;
        }}
        onDelete={async () => {
          const r = await backend.deleteListing(draft.id);
          if (!r.ok) return r.message;
          window.location.assign('/profile');
          return null;
        }}
      />
    );
  }

  const d = draft;
  const profile = profileFor(d.category);
  const shots = profile?.shots ?? [];
  const missing = missingForPublish({
    category: d.category, title: d.title, condition: d.condition, pricePence: d.pricePence,
    shots: d.media.map((m) => m.shot), declined: d.declined, hasSerial: Boolean(d.serial), parcelSize: d.parcelSize,
  });
  const required = shots.filter((s) => s.required);
  const requiredDone = required.filter((s) => d.media.some((m) => m.shot === s.key) || (s.decline && d.declined.includes(s.key))).length;

  async function capture(shot: Shot, file: File | undefined) {
    if (!file) return;
    setShotError(null);
    setUploading(shot.key);
    try {
      const prepared = shot.kind === 'video' ? await prepareVideo(file) : await preparePhoto(file);
      const old = d.media.filter((m) => m.shot === shot.key);
      const r = await track(backend.addMedia(d.id, shot.key, prepared));
      if (!r.ok) {
        setShotError({ shot: shot.key, message: r.message });
        return;
      }
      for (const m of old) await track(backend.removeMedia(d.id, m.id));
      if (d.declined.includes(shot.key)) await save({ declined: d.declined.filter((k) => k !== shot.key) });
      await reload();
    } catch (e) {
      setShotError({ shot: shot.key, message: e instanceof MediaProblem ? e.message : 'We couldn’t add that. Try again.' });
    } finally {
      setUploading(null);
    }
  }

  async function remove(mediaId: string, shot: string) {
    setShotError(null);
    const r = await track(backend.removeMedia(d.id, mediaId));
    if (!r.ok) setShotError({ shot, message: r.message });
    await reload();
  }

  async function publish() {
    setPublishError(null);
    setPublishing(true);
    try {
      await Promise.allSettled([...pending.current]);
      const r = await backend.publish(d.id);
      if (!r.ok) setPublishError(r.message);
      else await reload();
    } finally {
      setPublishing(false);
    }
  }

  async function discard() {
    const r = await backend.deleteDraft(d.id);
    if (r.ok) window.location.assign('/sell');
    else setStatus({ kind: 'error', message: r.message });
  }

  const tier = d.pricePence ? tierForPrice(d.pricePence) : null;
  const editingLive = d.revision > 0;

  return (
    <div className="pv-sell">
      <BackLink fallback="/profile" label="Back to your listings" />
      <header className="pv-section">
        <p className="pv-eyebrow">{editingLive ? `Editing · version ${d.revision}` : 'New listing · draft'}</p>
        <h1>{d.title || 'New listing'}</h1>
        {editingLive ? (
          <p className="pv-banner" role="note">
            <strong>Off sale while you edit.</strong> Buyers can’t buy it until you publish your changes. Earlier versions and their photos are kept.
          </p>
        ) : null}
        <p className="pv-note" role="status" aria-live="polite">
          {status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? 'All changes saved' : status.kind === 'error' ? '' : 'Your draft saves as you go.'}
        </p>
        {status.kind === 'error' ? <p className="pv-errors" role="alert">{status.message}</p> : null}
      </header>

      <section className="pv-panel pv-form" aria-labelledby="cat">
        <h2 id="cat">Category</h2>
        <div className="pv-field">
          <label htmlFor="category">What is it?</label>
          <select id="category" value={d.category ?? ''} onChange={(e) => save({ category: e.target.value || null })}>
            <option value="">Choose a category…</option>
            {fallbackCategories.filter((c) => !c.parentSlug).map((root) => (
              <optgroup key={root.slug} label={root.name}>
                {CATEGORY_TREE.filter((c) => c.slug === root.slug || categoryPath(c.slug).startsWith(`${root.name} /`)).map((c) => (
                  <option key={c.slug} value={c.slug}>{c.slug === root.slug ? c.name : categoryPath(c.slug).slice(root.name.length + 3)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="pv-note">Changing this changes the photos we ask for.</span>
        </div>
      </section>

      <section className="pv-panel" aria-labelledby="photos">
        <div className="pv-panel__head">
          <h2 id="photos">Photos{shots.some((s) => s.kind === 'video') ? ' and video' : ''}</h2>
          <span className="pv-note">{requiredDone} of {required.length} needed</span>
        </div>
        <p className="pv-note">These become the item’s record: buyers see them, and they settle any dispute. Taken photos are resized and their location data removed.</p>
        <ol className="pv-shots">
          {shots.map((s) => {
            const have = d.media.find((m) => m.shot === s.key);
            const declined = Boolean(s.decline && d.declined.includes(s.key));
            const inputId = `shot-${s.key}`;
            const busy = uploading === s.key;
            return (
              <li key={s.key} className={`pv-shot${have || declined ? ' pv-shot--done' : ''}`}>
                <div className="pv-shot__frame" aria-hidden={!have}>
                  {have ? (
                    have.kind === 'video'
                      ? <video src={have.url} controls muted playsInline preload="metadata" aria-label={`${s.label} video`} />
                      : <img src={have.url} alt={`${s.label} photo`} />
                  ) : <span className="pv-shot__empty">{declined ? s.decline : s.kind === 'video' ? 'Video' : 'Photo'}</span>}
                </div>
                <div className="pv-shot__body">
                  <h3 className="pv-shot__title">
                    {s.label}{' '}
                    <span className="pv-note">{s.required ? (have || declined ? '· done' : '· needed') : '· optional'}</span>
                  </h3>
                  <p className="pv-note">{s.hint}</p>
                  <div className="pv-actions">
                    <input
                      id={inputId}
                      className="pv-visually-hidden"
                      type="file"
                      accept={s.kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : 'image/*'}
                      capture="environment"
                      disabled={Boolean(uploading)}
                      aria-label={`${have ? 'Replace' : 'Add'} ${s.label} ${s.kind}`}
                      onChange={(e) => { void capture(s, e.target.files?.[0]); e.target.value = ''; }}
                    />
                    <label htmlFor={inputId} className={`pv-btn ${have ? 'pv-btn--secondary' : 'pv-btn--primary'}${busy || uploading ? ' pv-btn--busy' : ''}`}>
                      {busy ? 'Uploading…' : have ? (s.kind === 'video' ? 'Record again' : 'Retake') : s.kind === 'video' ? 'Record video' : 'Take photo'}
                    </label>
                    {have && !s.required ? (
                      <button type="button" className="pv-btn pv-btn--quiet" onClick={() => remove(have.id, s.key)}>Remove</button>
                    ) : null}
                    {s.decline && !have ? (
                      <button
                        type="button"
                        className="pv-btn pv-btn--quiet"
                        aria-pressed={declined}
                        onClick={() => save({ declined: declined ? d.declined.filter((k) => k !== s.key) : [...d.declined, s.key] })}
                      >
                        {declined ? `Undo “${s.decline}”` : `${s.decline}?`}
                      </button>
                    ) : null}
                  </div>
                  {shotError?.shot === s.key ? <p className="pv-errors" role="alert">{shotError.message}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {profile?.serial ? (
        <section className="pv-panel pv-form" aria-labelledby="serial-h">
          <h2 id="serial-h">{profile.serial.label}</h2>
          <div className="pv-field">
            <label htmlFor="serial">{profile.serial.label}{profile.serial.required ? '' : ' (optional)'}</label>
            <input
              id="serial" defaultValue={d.serial} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={60}
              aria-describedby="serial-note"
              onBlur={async (e) => {
                const v = e.target.value.trim();
                if (v === d.serial) return;
                if (v && v.length < 4) return setStatus({ kind: 'error', message: 'A serial number has at least 4 characters.' });
                setStatus({ kind: 'saving' });
                const r = await track(backend.saveSerial(d.id, v));
                setStatus(r.ok ? { kind: 'saved' } : { kind: 'error', message: r.message });
                setDraft((x) => (x ? { ...x, serial: v } : x));
              }}
            />
            <span id="serial-note" className="pv-note">Kept private. Buyers see only the last 4 characters, so they can match it to the item when it arrives.</span>
          </div>
        </section>
      ) : null}

      <section className="pv-panel pv-form" aria-labelledby="details">
        <h2 id="details">Details</h2>
        <div className="pv-field">
          <label htmlFor="title">Title</label>
          <input id="title" defaultValue={d.title} maxLength={100} placeholder="e.g. Barbour Beaufort wax jacket" onBlur={(e) => e.target.value.trim() !== d.title && save({ title: e.target.value.trim() })} />
        </div>
        <div className="pv-field">
          <label htmlFor="materials">Materials (optional)</label>
          <p className="pv-note">Select all that apply. Suggestions are based on the category; choose Other to enter a material not listed.</p>
          <div className="pv-materials" id="materials">
            {materialSuggestions(d.category).filter((m) => m !== 'Other').map((material) => <label key={material} className="pv-materials__option"><input type="checkbox" checked={d.materials.includes(material)} onChange={(e) => {
              const next = e.target.checked ? [...d.materials.filter((m) => m !== material && m !== 'Other'), material] : d.materials.filter((m) => m !== material); void save({ materials: next });
            }} /> {material}</label>)}
            <label className="pv-materials__option"><input type="checkbox" checked={d.materials.some((m) => !materialSuggestions(d.category).includes(m))} onChange={(e) => {
              const known = d.materials.filter((m) => materialSuggestions(d.category).includes(m)); const custom = d.materials.find((m) => !materialSuggestions(d.category).includes(m) && m !== 'Other');
              void save({ materials: e.target.checked ? [...known, custom ?? 'Other'] : known });
            }} /> Other</label>
          </div>
          {d.materials.some((m) => !materialSuggestions(d.category).includes(m)) ? <input aria-label="Other material" defaultValue={d.materials.find((m) => !materialSuggestions(d.category).includes(m) && m !== 'Other') ?? ''} maxLength={40} placeholder="Enter other material" onBlur={(e) => {
            const value = e.target.value.trim(); void save({ materials: [...d.materials.filter((m) => materialSuggestions(d.category).includes(m)), ...(value ? [value] : [])].slice(0, 8) });
          }} /> : null}
        </div>
        <div className="pv-grid2">
          <div className="pv-field">
            <label htmlFor="brand">Brand (optional)</label>
            <input id="brand" defaultValue={d.brand} maxLength={60} onBlur={(e) => e.target.value.trim() !== d.brand && save({ brand: e.target.value })} />
          </div>
          <div className="pv-field">
            <label htmlFor="size">Size (optional)</label>
            <input id="size" list={sizeSuggestions(d.category).length ? "size-options" : undefined} defaultValue={d.size} maxLength={30} placeholder={sizeSuggestions(d.category).length ? 'Choose or enter a size' : 'Enter size, if applicable'} onBlur={(e) => e.target.value.trim() !== d.size && save({ size: e.target.value })} />
            {sizeSuggestions(d.category).length ? <datalist id="size-options">{sizeSuggestions(d.category).map((size) => <option key={size} value={size} />)}</datalist> : null}
            {sizeConversions(sizeKindFor(d.category)).length ? <details className="pv-size-chart"><summary>View UK / EU / US size conversion chart</summary>
              <table><thead><tr><th>UK</th><th>EU</th><th>US</th></tr></thead><tbody>{sizeConversions(sizeKindFor(d.category)).map((row) => <tr key={`${row.uk}-${row.eu}-${row.us}`}><td>{row.uk}</td><td>{row.eu}</td><td>{row.us}</td></tr>)}</tbody></table>
              <p className="pv-note">Conversions are approximate and vary by brand. Check the item’s label when possible.</p>
            </details> : null}
          </div>
          <div className="pv-field">
            <label htmlFor="colour">Colour (optional)</label>
            <input id="colour" defaultValue={d.colour} maxLength={30} onBlur={(e) => e.target.value.trim() !== d.colour && save({ colour: e.target.value })} />
          </div>
          <div className="pv-field">
            <label htmlFor="condition">Condition</label>
            <select id="condition" value={d.condition ?? ''} onChange={(e) => save({ condition: e.target.value || null })}>
              <option value="">Choose…</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="pv-field">
          <label htmlFor="description">Description (optional)</label>
          <textarea id="description" defaultValue={d.description} maxLength={2000} rows={4} placeholder="What it is, how it’s been used, anything a buyer should know." onBlur={(e) => e.target.value.trim() !== d.description && save({ description: e.target.value })} />
        </div>
      </section>

      <section className="pv-panel pv-form" aria-labelledby="price-h">
        <h2 id="price-h">Price and postage</h2>
        <div className="pv-field">
          <label htmlFor="price">Price (£)</label>
          <input
            id="price" inputMode="decimal" value={priceText} placeholder="0.00" aria-invalid={priceError ? true : undefined} aria-describedby="price-note"
            onChange={(e) => setPriceText(e.target.value)}
            onBlur={() => {
              if (!priceText.trim()) return;
              const p = parsePounds(priceText);
              if (p === null) return setPriceError('Enter an amount, for example 25 or 25.50.');
              if (p < MIN_PRICE_PENCE || p > MAX_PRICE_PENCE) return setPriceError('Prices run from £1 to £50,000.');
              setPriceError(null);
              setPriceText((p / 100).toFixed(2));
              if (p !== d.pricePence) void save({ pricePence: p });
            }}
          />
          {priceError ? <span className="pv-errors" role="alert">{priceError}</span> : null}
          <span id="price-note" className="pv-note">
            {tier ? `At ${formatPence(d.pricePence!)} the sale is ${TIER_LABEL[tier].toLowerCase()}. ` : ''}The buyer pays buyer protection on top.
          </span>
        </div>
        <fieldset className="pv-field pv-choices">
          <legend>Parcel size</legend>
          {PARCEL_SIZES.map((p) => (
            <label key={p.key} className="pv-choice">
              <input type="radio" name="parcel" value={p.key} checked={d.parcelSize === p.key} onChange={() => save({ parcelSize: p.key })} />
              <span><strong>{p.label}</strong> · {formatPence(p.pence)}<br /><span className="pv-note">{p.note}</span></span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="pv-panel pv-publish" aria-labelledby="publish-h">
        <h2 id="publish-h">Publish</h2>
        {missing.length ? (
          <>
            <p>Before it can go live, add:</p>
            <ul className="pv-list" aria-label="Still needed">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </>
        ) : (
          <p>{editingLive ? 'Everything’s in place. Publishing puts the item back on sale as a new version.' : 'Everything’s in place. You can still edit it until someone buys it.'}</p>
        )}
        {publishError ? <p className="pv-errors" role="alert">{publishError}</p> : null}
        <button type="button" className="pv-btn pv-btn--primary pv-btn--block" disabled={missing.length > 0 || publishing || Boolean(uploading)} onClick={publish}>
          {publishing ? 'Publishing…' : editingLive ? 'Publish changes' : 'Publish listing'}
        </button>
        {editingLive ? null : <button type="button" className="pv-btn pv-btn--quiet" onClick={discard}>Delete this draft</button>}
      </section>
    </div>
  );
}
