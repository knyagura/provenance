import Link from 'next/link';

/** A friendly "nothing here yet" with a small drawing of an open box and, optionally, somewhere to go. */
export function EmptyState({ title, note, action, heading = false }: { title: string; note: string; action?: { href: string; label: string }; heading?: boolean }) {
  return (
    <div className="pv-empty">
      <svg viewBox="0 0 120 90" aria-hidden="true" focusable="false">
        <ellipse cx="60" cy="80" rx="44" ry="6" fill="var(--ink)" opacity=".08" />
        <path d="M24 40 L60 52 L96 40 L96 74 L60 86 L24 74 Z" fill="var(--peach)" />
        <path d="M24 40 L60 52 L60 86 L24 74 Z" fill="var(--blush)" />
        <path d="M24 40 L10 26 L46 14 L60 28 Z" fill="var(--peach)" opacity=".85" />
        <path d="M96 40 L110 26 L74 14 L60 28 Z" fill="var(--blush)" opacity=".85" />
        <circle cx="60" cy="18" r="3" fill="var(--sage-text)" /><circle cx="72" cy="8" r="2" fill="var(--terracotta-text)" /><circle cx="48" cy="6" r="2" fill="var(--sage-text)" />
      </svg>
      {heading ? <h2>{title}</h2> : <strong>{title}</strong>}
      <span className="pv-note">{note}</span>
      {action ? <Link className="pv-btn pv-btn--secondary" href={action.href}>{action.label}</Link> : null}
    </div>
  );
}
