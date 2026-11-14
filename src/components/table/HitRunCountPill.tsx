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
  HIT_RUN_PAUSED_NOTE,
  handsOwedReasonText,
  type HandsOwedReason,
} from '../../lib/hitAndRun';
import './HitRunCountPill.css';

export default function HitRunCountPill({
  hands,
  reason = null,
  paused = false,
}: {
  hands: number | null;
  /** Why they are owed (owner 2026-11-11); shown under the label when known. */
  reason?: HandsOwedReason | null;
  /**
   * THE COUNT IS PAUSED (owner 2026-11-13): `hands` is what is left of a
   * countdown the player fell out of profit on. Nothing is owed right now.
   */
  paused?: boolean;
}): React.ReactElement | null {
  if (hands === null || !(hands > 0)) return null;
  const why = paused ? HIT_RUN_PAUSED_NOTE : handsOwedReasonText(reason);
  return (
    <div
      className="hit-run-pill"
      role="status"
      data-testid={paused ? 'hit-run-paused-pill' : 'hit-run-count-pill'}
    >
      <span className="hit-run-pill__label">
        {paused ? HIT_RUN_PAUSED_LABEL : HIT_RUN_COUNT_LABEL}
      </span>
      <span className="hit-run-pill__count">{hands}</span>
      {why ? (
        <span className="hit-run-pill__reason" data-testid="hit-run-count-reason">
          {why}
        </span>
      ) : null}
    </div>
  );
}
