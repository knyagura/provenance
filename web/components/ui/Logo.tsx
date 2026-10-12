/** The Provenance mark: a numbered seal with a P, beside the wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--terracotta-text)" strokeWidth="1.6" strokeDasharray="3 2.2" />
      <circle cx="16" cy="16" r="11" fill="var(--terracotta)" />
      <path d="M13 22.5V10h4.2a3.7 3.7 0 0 1 0 7.4H13" fill="none" stroke="var(--on-terracotta)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
