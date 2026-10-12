import type { Evidence } from '@/lib/domain/custody';

/**
 * A drawing of the numbered seal, with its code, and whether the check matched. The state is always
 * written out as well as drawn, so it never relies on colour.
 */
export function SealMark({ evidence }: { evidence: Evidence }) {
  const code = String(evidence.seal ?? '');
  const hidden = code.startsWith('hidden');
  const state = hidden ? 'hidden' : evidence.match === true ? 'match' : evidence.match === false ? 'mismatch' : 'fitted';
  const kind = evidence.seal_kind === 'item' ? 'Item Seal' : 'ProofSeal';
  const words = { hidden: 'Code hidden until you check it', match: 'Matches the seal fitted', mismatch: 'Does not match', fitted: 'Fitted' }[state];
  return (
    <span className={`pv-seal pv-seal--${state}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle cx="20" cy="20" r="17" className="pv-seal__ring" />
        <circle cx="20" cy="20" r="12" className="pv-seal__core" />
        {state === 'match' ? <path d="M14 20.5l4 4 8-8.5" className="pv-seal__glyph" /> : null}
        {state === 'mismatch' ? <path d="M15 15l10 10M25 15l-10 10" className="pv-seal__glyph" /> : null}
        {state === 'hidden' ? <path d="M15 21h10v6H15zM17 21v-3a3 3 0 0 1 6 0v3" className="pv-seal__glyph" /> : null}
        {state === 'fitted' ? <path d="M13 20h14" className="pv-seal__glyph" /> : null}
      </svg>
      <span className="pv-seal__text">
        <span className="pv-seal__kind">{kind}</span>
        {hidden ? null : <span className="pv-mono">{code}</span>}
        <span className="pv-seal__state">{words}</span>
      </span>
    </span>
  );
}
