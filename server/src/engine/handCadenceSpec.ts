import { ritRevealTimelineMs } from '../config/handCompletionSpec.js';

/** Maximum cash-bust rebuy pause (Dan 2026-08-24 / CLAUDE.md 10.5). */
export const REBUY_PAUSE_MAX_MS = 5000;

/** Maximum run-it-multiple reveal timeline (3 runs, 3 streets, speed 1). */
export const RIT_REVEAL_MAX_MS = ritRevealTimelineMs({
  runs: 3,
  streetsPerRun: 3,
  speed: 1,
}).doneAt;

/**
 * Actual between-hand pause times recorded on the NEXT hand's
 * `hand_history.cadence` jsonb column so cash busts and run-it-multiple
 * hands are graded by fn_ca_hand_gap_unintended_delay and
 * scripts/sql/hand-gap-unintended-delay.sql.
 */
export interface HandCadenceRecord {
  hold_ms: number;
  rest_ms: number;
  rebuy_pause_ms: number;
  rit_reveal_ms?: number;
  /**
   * Whether the hand's completion hold carried ALL_IN_SHOWDOWN_EXTRA_MS
   * (isAllInShowdown: a shown player was all-in). Recorded because the hand
   * record cannot always say: a call, bet, raise, blind or ante that empties
   * a stack is recorded under its own action name, and an all-in winner keeps
   * a stack. Without it the grader under-counted owed by 500 ms
   * (EngineCutoverMissed 2026-11-22, migration 20261122105551).
   */
  all_in_showdown?: boolean;
}
