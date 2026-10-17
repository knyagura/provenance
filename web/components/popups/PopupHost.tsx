'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { CameraIcon, EyeIcon, PackageIcon } from '@/components/ui';
import type { SitePopup } from '@/lib/selling/types';
import { choosePopup, dismissKey, POPUP_EVENT, POPUPS_OFF } from './choose';

const STEP_ICONS = [<CameraIcon key="c" />, <PackageIcon key="p" />, <EyeIcon key="e" />];

function seen(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1' || localStorage.getItem(POPUPS_OFF) === '1';
  } catch {
    return false;
  }
}
function markSeen(p: SitePopup) {
  try {
    localStorage.setItem(dismissKey(p), '1');
  } catch {
    /* private window: it may show again next visit */
  }
}

/** Opens a popup by its key from anywhere ("How protection works"). */
export function openPopup(key: string) {
  window.dispatchEvent(new CustomEvent(POPUP_EVENT, { detail: key }));
}

/**
 * The popup staff set up in the console: shown once per person, on the pages, to the people and after the
 * delay they chose. Closing it (the button, Esc, or outside it) means it isn't shown again until staff
 * choose "show again".
 */
export function PopupHost() {
  const { member, loading, backend } = useMember();
  const pathname = usePathname() ?? '/';
  const [popups, setPopups] = useState<SitePopup[] | null>(null);
  const [current, setCurrent] = useState<SitePopup | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    backend.livePopups().then(setPopups).catch(() => setPopups([]));
  }, [backend]);

  // Shown by itself after its delay.
  useEffect(() => {
    if (!popups || loading || current) return;
    const p = choosePopup(popups, { pathname, signedIn: !!member, seen });
    if (!p) return;
    const t = setTimeout(() => setCurrent(p), p.delaySeconds * 1000);
    return () => clearTimeout(t);
  }, [popups, loading, member, pathname, current]);

  // Opened on purpose by a link.
  useEffect(() => {
    const open = (e: Event) => {
      const p = popups?.find((x) => x.key === (e as CustomEvent<string>).detail);
      if (p) setCurrent(p);
    };
    window.addEventListener(POPUP_EVENT, open);
    return () => window.removeEventListener(POPUP_EVENT, open);
  }, [popups]);

  useEffect(() => {
    const d = ref.current;
    if (current && d && !d.open) d.showModal();
  }, [current]);

  if (!current) return null;
  const close = () => {
    markSeen(current);
    ref.current?.close();
    setCurrent(null);
    setCopied(false);
  };
  return (
    <dialog
      ref={ref}
      className={`pv-popup pv-popup--${current.kind}`}
      aria-labelledby="popup-title"
      onClose={close}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="pv-popup__inner">
        <button type="button" className="pv-popup__close" onClick={close} aria-label="Close">×</button>
        {current.kind === 'offer' ? <p className="pv-eyebrow">Offer</p> : null}
        <h2 id="popup-title">{current.title}</h2>
        {current.body ? <p className="pv-popup__body">{current.body}</p> : null}
        {current.steps.length ? (
          <ol className="pv-popup__steps">
            {current.steps.map((s, i) => (
              <li key={s.title}>
                <span className="pv-how__icon" aria-hidden="true">{STEP_ICONS[i % STEP_ICONS.length]}</span>
                <span><strong>{s.title}</strong><span className="pv-note">{s.note}</span></span>
              </li>
            ))}
          </ol>
        ) : null}
        {current.offerCode ? (
          <p className="pv-popup__code">
            Use code <strong className="pv-mono">{current.offerCode}</strong>
            <button type="button" className="pv-btn pv-btn--quiet" onClick={async () => {
              try {
                await navigator.clipboard.writeText(current.offerCode!);
                setCopied(true);
              } catch {
                /* copying isn't allowed here; the code is on screen */
              }
            }}>{copied ? 'Copied' : 'Copy'}</button>
          </p>
        ) : null}
        <div className="pv-actions">
          {current.ctaLabel && current.ctaHref ? (
            <Link className="pv-btn pv-btn--primary" href={current.ctaHref} onClick={close}>{current.ctaLabel}</Link>
          ) : null}
          <button type="button" className="pv-btn pv-btn--quiet" onClick={close}>{current.ctaLabel ? 'Not now' : 'Close'}</button>
        </div>
      </div>
    </dialog>
  );
}

/** A link that opens a popup (for example "How protection works" above the items). */
export function PopupLink({ popupKey, children }: { popupKey: string; children: React.ReactNode }) {
  return <button type="button" className="pv-linkbtn" onClick={() => openPopup(popupKey)}>{children}</button>;
}
