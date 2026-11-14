import React, { useId } from 'react';
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
  reason?: HandsOwedReason | null;
  paused?: number | null;
}): React.ReactElement | null {
  const helpId = useId();
  const owing = hands !== null && hands > 0;
  const count = owing ? hands : paused;
  if (!count || count <= 0) return null;
  const why = owing ? handsOwedReasonText(reason) : pausedHandsLeftText(count);
  const label = owing ? HIT_RUN_COUNT_LABEL : HIT_RUN_PAUSED_LABEL;
  return (
    <>
      <div
        role="status"
        aria-label={owing ? undefined : countdownPausedText(count)}
        data-testid={owing ? 'hit-run-count-pill' : 'hit-run-paused-pill'}
      >
        <button
          type="button"
          className="hit-run-pill"
          popoverTarget={helpId}
          aria-label={`${label}: ${count}. Explain The Hand Count`}
        >
          <span className="hit-run-pill__label">{label}</span>
          <span className="hit-run-pill__count">{count}</span>
          {why && (
            <span
              className="hit-run-pill__reason"
              data-testid={owing ? 'hit-run-count-reason' : undefined}
            >
              {why}
            </span>
          )}
        </button>
      </div>
      <div
        id={helpId}
        popover="auto"
        role="dialog"
        aria-label="Hand Count Rules"
        className="hit-run-pill__help"
      >
        <strong>Hand Count Rules</strong>
        <p>
          Once You Are In Profit, Each Later Hand You Finish In Profit Counts. Doubling Your Stack
          From The Rule’s Reference Stack Adds Another Set Of Hands. Losing Your Profit Pauses This
          Count. Returning To Profit Resumes It Where You Left Off.
        </p>
        <p>
          A Net Win Of 250 Big Blinds Or More Starts A Separate Ten-Hand Count That Continues Even
          Out Of Profit. If Both Rules Apply, The Larger Remaining Count Is Shown.
        </p>
        <p>If You Leave With Hands Owed, Your Seat Posts Blinds And Folds Until The Count Ends.</p>
        <button type="button" popoverTarget={helpId} popoverTargetAction="hide">
          Close
        </button>
      </div>
    </>
  );
}
