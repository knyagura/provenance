import type { ReactNode } from 'react';
import { TickIcon } from './icons';

export type StepState = 'done' | 'now' | 'later';

export interface CustodyStep {
  title: string;
  note: string;
  state: StepState;
  /** The record in mono type: seal number, hash fragment, time. */
  evidence?: string;
  /** Show "Your turn" when the current step is this person's action. */
  yourTurn?: boolean;
  /** Evidence to show with the step: a photo, a video, a seal. */
  extra?: ReactNode;
}

/** An order's chain of evidence: done steps in sage, the current step in terracotta. */
export function CustodyTimeline({ steps, label = 'Custody steps' }: { steps: CustodyStep[]; label?: string }) {
  return (
    <ol className="pv-steps" aria-label={label}>
      {steps.map((s, i) => (
        <li key={`${i}-${s.title}`} className={`pv-step pv-step--${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
          <span className="pv-step__dot" aria-hidden="true">
            {s.state === 'done' ? <TickIcon /> : i + 1}
          </span>
          <div className="pv-step__body">
            {s.state === 'now' && s.yourTurn ? <div className="pv-step__turn">Your turn</div> : null}
            <div className="pv-step__title">
              {s.title}
              <span className="pv-visually-hidden">
                {s.state === 'done' ? ' (done)' : s.state === 'now' ? ' (current step)' : ' (to come)'}
              </span>
            </div>
            <div className="pv-step__note">{s.note}</div>
            {s.evidence ? <div className="pv-step__evidence">{s.evidence}</div> : null}
            {s.extra ? <div className="pv-step__extra">{s.extra}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
