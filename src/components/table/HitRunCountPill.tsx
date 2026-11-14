/**
 * HIT AND RUN (owner 2026-11-06): "THOSE 10 HANDS SHOULD BE DISPLAYED AND
 * COUNTED DOWN AFTER THE COMPLETION OF EACH HAND SO THE USER CAN SEE IT."
 *
 * Beside the hero's seat the count rides HeroVpipTracker. Between Lightning
 * hands the hero has no seat on the felt to stand beside, so the count is
 * shown here, centred above the action area, until the next hand is dealt.
 */
import React from 'react';
import {
  HIT_RUN_COUNT_LABEL,
  HIT_RUN_PAUSED_LABEL,
  countdownPausedText,
  handsOwedReasonText,
  pausedHandsLeftText,
  type HandsOwedReason,
} from '../../lib/hitAndRun';
import './HitRunCountPill.css';

export default function HitRunCountPill({
  hands,
  reason = null,
  paused = null,
}: {
  hands: number | null;
  /** Why they are owed (owner 2026-11-11); shown under the label when known. */
  reason?: HandsOwedReason | null;
  /** Hands left on a countdown paused out of profit (owner 2026-11-13). */
  paused?: number | null;
}): React.ReactElement | null {
  if (hands === null || !(hands > 0)) {
    if (paused === null || !(paused > 0)) return null;
    return (
      <div
        className="hit-run-pill"
        role="status"
        aria-label={countdownPausedText(paused)}
        data-testid="hit-run-paused-pill"
      >
        <span className="hit-run-pill__label">{HIT_RUN_PAUSED_LABEL}</span>
        <span className="hit-run-pill__count">{paused}</span>
        <span className="hit-run-pill__reason">{pausedHandsLeftText(paused)}</span>
      </div>
    );
  }
  const why = handsOwedReasonText(reason);
  return (
    <div className="hit-run-pill" role="status" data-testid="hit-run-count-pill">
      <span className="hit-run-pill__label">{HIT_RUN_COUNT_LABEL}</span>
      <span className="hit-run-pill__count">{hands}</span>
      {why ? (
        <span className="hit-run-pill__reason" data-testid="hit-run-count-reason">
          {why}
        </span>
      ) : null}
    </div>
  );
}
