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
 * Actual between-hand pause times and bounded boolean shape facts recorded on
 * the NEXT hand's `hand_history.cadence` jsonb column so
 * `fn_ca_hand_gap_unintended_delay`, `scripts/sql/hand-gap-unintended-delay.sql`,
 * and `reliability_runbook_hand_gap_classification` compute the exact same owed
 * beats as `handCompletionHoldMs`:
 *
 * - `hold_ms`, `rest_ms`, `rebuy_pause_ms`, `rit_reveal_ms`: pause durations
 *   (cash_bust rebuy pause and RIT reveal are clamped to spec maxes in SQL).
 * - `all_in_showdown`: exact boolean passed to `handCompletionHoldMs`
 *   (`isAllInShowdown`). Covers all-in calls, bets, raises, blinds, and antes
 *   whose `actions[]` entry is not `'all_in'` and where the all-in player won
 *   or chopped (`stack > 0`). In SQL this selects only `ALL_IN_SHOWDOWN_EXTRA_MS`
 *   (2000 ms) vs `WINNING_CARDS_EXTRA_MS` (1500 ms) on `shown_n >= 2` (+500 ms
 *   bounded spec beat; can never excuse arbitrary delay).
 * - `bets_sweep_owed`: exact boolean returned by `showdownSweepOwed`. Covers
 *   conservative sweep holds (non-5-card boards, non-flop street actions, etc.).
 *   In SQL this selects only `BETS_SWEEP_MS` (500 ms) on `shown_n >= 2`.
 */
export interface HandCadenceRecord {
  hold_ms: number;
  rest_ms: number;
  rebuy_pause_ms: number;
  rit_reveal_ms?: number;
  all_in_showdown?: boolean;
  bets_sweep_owed?: boolean;
}
