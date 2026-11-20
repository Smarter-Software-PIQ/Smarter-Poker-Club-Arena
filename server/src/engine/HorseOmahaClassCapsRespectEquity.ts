/**
 * omahaClassCapsRespectEquity (V40CAP lane 2026-11-19, default OFF, read `=== true`).
 *
 * THE BUG (EMERG AUDIT-04 item 1, exact replay of 4,343 PLO4/PLO5 cash decisions on #11401 b83b44ffa7d): the V40
 * Omaha pressure cap (HorseLogic.ts, "V40 OMAHA PRESSURE CAP") replaces the Horse's measured equity with a fixed
 * ceiling per HAND CLASS (air/pair 0.28, board two pair 0.30, low two pair 0.32/0.36, top two pair 0.34/0.50, weak
 * trips 0.50, set 0.62; +0.10 flop, +0.12 nutty draw) whenever a bet of 0.6 pot or more is faced, without looking at
 * the measured equity; the V38 EV verdict then folds (v38_ev_fold). The V15 cap does the same for dominated flushes
 * and straights (0.25-0.55, CODESWEEP). With the cap not running, 27 flop folds against persons became calls,
 * +358.6 bb on 46 graded spots; the folded hands held 0.75-0.90 equity against the person's real cards (hands
 * 60039965, 60040003, 60028949, 60009904, 60036778, 60009275).
 *
 * THE FIX (an interim fix for the reference brain; the math core replaces it): with the option on, in PLO4 and
 * PLO5 cash (table and Lightning; one board, high only, no bomb pot), facing a bet, the class caps may lower the
 * equity the decision uses only DOWN TO the Horse's own measured equity against the bettor's range for this line
 * and size, never below it. That equity is a fresh, non-adaptive Monte Carlo of at least
 * OMAHA_CLASS_CAP_FLOOR_MIN_SAMPLES samples on the same public-information range the reference already uses (the
 * preflop band from public preflop actions and the V40 tiered aggressor sampler keyed on the public line: streets
 * bet, the size as a pot share, raises; a value share of the range per tier, the rest left as other holdings). No
 * hidden card enters it. When the governor allows fewer samples than the floor, no floor is applied (the caps act as
 * today). PLO6, PLO8, tournaments, multi-board and bomb pots are untouched (owner 2026-11-19 8:26 PM: do not touch
 * PLO6).
 */

/** Minimum Monte Carlo samples for the measured equity floor (SE <= 0.025 at any equity). */
export const OMAHA_CLASS_CAP_FLOOR_MIN_SAMPLES = 400;

export interface OmahaClassCapsRespectEquityScope {
  enabled: boolean;
  gameVariant: unknown;
  tournament: boolean;
  hiLo: boolean;
  extraBoards: number;
  bombPot: boolean;
  toCall: number;
}

/** True only where the option acts: PLO4/PLO5 cash, single board, high only, facing a bet. */
export function omahaClassCapsRespectEquityInScope(s: OmahaClassCapsRespectEquityScope): boolean {
  if (s.enabled !== true) return false;
  const v = String(s.gameVariant ?? '').toLowerCase();
  if (v !== 'plo4' && v !== 'plo5') return false;
  return !s.tournament && !s.hiLo && s.extraBoards === 0 && !s.bombPot && s.toCall > 0;
}

/**
 * The equity a class cap may hand the decision. `before` is the equity entering the cap, `capped` what the cap
 * made of it, `measured` the floor (null: no floor). Never above `before`, never below `capped`.
 */
export function classCapRespectingEquity(
  before: number,
  capped: number,
  measured: number | null
): number {
  if (measured == null || !Number.isFinite(measured) || !(capped < before)) return capped;
  return Math.max(capped, Math.min(before, measured));
}

/**
 * The floor protects the CALL only. When the floor lifted the equity in a decision and the reference then chose
 * a raise (or an all-in that is more than a call), the answer is the call: the class caps keep pricing the raise
 * as before, and a raise is never created by the floor. An all-in that is only the call (the stack does not
 * cover the bet) stays as it is. Folds, checks and calls are returned unchanged.
 */
export function classCapFloorKeepsTheCall<
  D extends { action: string; amount?: number; thinkTime?: number },
>(
  decision: D,
  owed: number,
  stack: number
): D | { action: 'call'; amount: number; thinkTime: number } {
  if (decision.action !== 'raise' && decision.action !== 'all_in') return decision;
  if (!(owed > 0) || !(stack > owed)) return decision;
  return { action: 'call', amount: owed, thinkTime: decision.thinkTime ?? 0 };
}
