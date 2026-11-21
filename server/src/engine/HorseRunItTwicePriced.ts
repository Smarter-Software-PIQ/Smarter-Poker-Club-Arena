/**
 * ── RUN IT TWICE, PRICED (option horseRunItTwiceIsPriced, DEFAULT OFF) ──────
 *
 * HORSE DECISIONS lane, UNOWNED-RULES, 2026-11-20. Owner order 3:27 PM Chicago:
 * "THERE SHOULD NEVER EVER EVER BY ANY BLANKET RULES." HorseRunItTwice.ts decides
 * with fixed numbers (0.25/0.75, 40 bb, 0.35, 0.58, a 5-in-10 gate, a 0.42-0.58
 * band, a 1-in-4 gate). This module is its priced replacement. With the option
 * off nothing here runs and HorseRunItTwice.ts answers exactly as before.
 *
 * HOW THE ANSWER IS PRICED
 * 1. Chip EV. The number of boards does not change a player's expected share of
 *    the pot: rake and BBJ are deducted once from the live pot structure
 *    (RunItTwiceEngine, scaleWinnerCentsForRake), so the EV gap between one run
 *    and k runs is exactly 0 (RUN_IT_TWICE_EV_GAP_BB below, asserted by a test
 *    against the settlement). Every answer is therefore inside the indifference
 *    band (HORSE_INDIFFERENCE_EV_BAND_BB): no answer is ever chosen over a better
 *    one.
 * 2. Between EV-equal answers the mix is MEASURED, not assumed: p(multi) is the
 *    rate at which people (never Horses) chose or accepted more than one run in
 *    the same public cell: role (chooser / responder), the variance a multi-run
 *    removes (the Horse's e(1-e), normalised by the fair-share value for the
 *    number of players all in), and the pot in big blinds. Kernel-smoothed and
 *    shrunk to the role's pooled rate where the cell is thin (HorseRunItTwicePeople.data.ts,
 *    compiled offline from 90 days of public action logs; the engine never queries
 *    a database). P(3 runs | multi, table allows 3) comes from the same data.
 * 3. The Horse's own style seed (runItTwicePreference, about the Horse itself,
 *    never about the opponent) tilts p on the logit scale by at most
 *    RUN_IT_TWICE_PERSONA_LOGIT_BOUND; it can never take p to 0 or 1 by itself.
 * 4. The draw is a deterministic hash of (horse, hand), so a replay answers the
 *    same way; no Math.random and no engine random stream.
 *
 * OWNER CUT (explicit, not a strategy constant). People's own data runs lopsided
 * spots more than once (90 days: chooser at 90%+ equity 28 of 57; answering at
 * 10% or less 39 of 89). The owner ruled on 2026-11-13 23:37 Chicago: "HORSE WITH
 * BOTTOM SET SHOULD NOT BE AGREEING TO RUN IT 3 TIMES WITH ONE OUT. AND HORSES
 * SHOULD ONLY BE RUNNING IT MULTIPLE TIMES (SOMETIMES) NOT ALL THE TIME." So where
 * the measured mix would run a lopsided all-in more than once, this module runs
 * once, and says so in its receipt (horse_rit_priced_owner_cut). "Lopsided" is the
 * definition already serving that order (HORSE_RIT_LOPSIDED_LOW / HIGH); three
 * runs with one out lies inside it, so one cut covers both sentences.
 * Unknown equity runs once: no data, not a threshold.
 */
import {
  HORSE_RIT_LOPSIDED_HIGH,
  HORSE_RIT_LOPSIDED_LOW,
  horseRunItTwiceRuns,
} from './HorseRunItTwice.js';
import { indifferenceStyleSeedsFor } from './HorsePersona.js';
import {
  RUN_IT_TWICE_PEOPLE_CURVE,
  type RunItTwicePeopleCurve,
} from './HorseRunItTwicePeople.data.js';
import { runItTwiceVarianceShare, type RunItTwiceRole } from './HorseRunItTwiceCell.js';

export { runItTwiceVarianceShare, type RunItTwiceRole };

export interface HorseRunItTwicePricedInput {
  horseId: string;
  handNumber: number;
  potBB: number;
  equity: number | null;
  maxRuns: 1 | 2 | 3;
  role: RunItTwiceRole;
  /** players all in at the offer (2 = heads-up) */
  playersAllIn: number;
}

export type RunItTwicePricedReason =
  | 'no_multi_allowed'
  | 'equity_unknown'
  | 'owner_cut_lopsided'
  | 'measured_once'
  | 'measured_multi'
  | 'measured_three';

export interface HorseRunItTwicePricedAnswer {
  runs: 1 | 2 | 3;
  reason: RunItTwicePricedReason;
  /** measured p(multi) after the persona tilt (null when not reached) */
  pMulti: number | null;
  /** measured p(3 | multi) (null when not reached) */
  pThree: number | null;
}

/** EV(k runs) - EV(1 run) in big blinds: zero, rake and BBJ are taken once. */
export const RUN_IT_TWICE_EV_GAP_BB = 0;
/** The most the Horse's own preference may move p(multi), in logits. Declared in
 *  criteria/horseRunItTwiceIsPriced.md before any replay. */
export const RUN_IT_TWICE_PERSONA_LOGIT_BOUND = 0.5;

function bucket01(horseId: string, handNumber: number, salt: string): number {
  const text = `${salt}|${horseId}|${handNumber}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Bilinear read of one role's grid at (variance share, ln pot bb). */
export function readRunItTwiceCurve(
  curve: RunItTwicePeopleCurve,
  role: RunItTwiceRole,
  varianceShare: number,
  potBB: number,
  field: 'pMulti' | 'pThree'
): number {
  const g = curve.roles[role];
  const vs = curve.varianceGrid;
  const ps = curve.lnPotGrid;
  const lp = Math.log(Math.max(1, Number.isFinite(potBB) ? potBB : 1));
  const locate = (grid: readonly number[], x: number): [number, number, number] => {
    if (x <= grid[0]) return [0, 0, 0];
    if (x >= grid[grid.length - 1]) return [grid.length - 1, grid.length - 1, 0];
    let i = 0;
    while (grid[i + 1] < x) i++;
    return [i, i + 1, (x - grid[i]) / (grid[i + 1] - grid[i])];
  };
  const [v0, v1, tv] = locate(vs, clamp01(varianceShare));
  const [p0, p1, tp] = locate(ps, lp);
  const at = (vi: number, pi: number) => g[field][vi][pi];
  const a = at(v0, p0) * (1 - tp) + at(v0, p1) * tp;
  const b = at(v1, p0) * (1 - tp) + at(v1, p1) * tp;
  return clamp01(a * (1 - tv) + b * tv);
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function horseRunItTwiceRunsPriced(
  input: HorseRunItTwicePricedInput,
  curve: RunItTwicePeopleCurve = RUN_IT_TWICE_PEOPLE_CURVE
): HorseRunItTwicePricedAnswer {
  const maxRuns = Math.max(1, Math.min(3, Math.floor(Number(input.maxRuns) || 1))) as 1 | 2 | 3;
  if (maxRuns < 2) return { runs: 1, reason: 'no_multi_allowed', pMulti: null, pThree: null };
  const e = input.equity;
  if (e === null || typeof e !== 'number' || !Number.isFinite(e))
    return { runs: 1, reason: 'equity_unknown', pMulti: null, pThree: null };
  // OWNER CUT 2026-11-13 23:37 Chicago (see header): never a lopsided multi-run.
  if (e <= HORSE_RIT_LOPSIDED_LOW || e >= HORSE_RIT_LOPSIDED_HIGH)
    return { runs: 1, reason: 'owner_cut_lopsided', pMulti: null, pThree: null };
  const vs = runItTwiceVarianceShare(e, input.playersAllIn);
  const measured = readRunItTwiceCurve(curve, input.role, vs, input.potBB, 'pMulti');
  const pref = indifferenceStyleSeedsFor(input.horseId, 'cash').runItTwicePreference;
  const tilt = RUN_IT_TWICE_PERSONA_LOGIT_BOUND * (2 * clamp01(pref) - 1);
  const pm = Math.min(1 - 1e-6, Math.max(1e-6, measured));
  const pMulti = sigmoid(logit(pm) + tilt);
  if (bucket01(input.horseId, input.handNumber, 'rit-priced-multi') >= pMulti)
    return { runs: 1, reason: 'measured_once', pMulti, pThree: null };
  const pThree =
    maxRuns === 3 && input.role === 'chooser'
      ? readRunItTwiceCurve(curve, 'chooser', vs, input.potBB, 'pThree')
      : 0;
  if (maxRuns === 3 && bucket01(input.horseId, input.handNumber, 'rit-priced-three') < pThree)
    return { runs: 3, reason: 'measured_three', pMulti, pThree };
  return { runs: 2, reason: 'measured_multi', pMulti, pThree };
}

/**
 * The one call site's answer (ServerTableEngineRunout.horseRitRuns). With the option off it is
 * horseRunItTwiceRuns, untouched (role and playersAllIn are ignored); with it on, the priced answer.
 */
export function horseRunItTwiceAnswer(
  input: HorseRunItTwicePricedInput,
  pricedOn: boolean
): { runs: 1 | 2 | 3; priced: HorseRunItTwicePricedAnswer | null } {
  if (pricedOn !== true) {
    return {
      runs: horseRunItTwiceRuns({
        horseId: input.horseId,
        handNumber: input.handNumber,
        potBB: input.potBB,
        equity: input.equity,
        maxRuns: input.maxRuns,
      }),
      priced: null,
    };
  }
  const priced = horseRunItTwiceRunsPriced(input);
  return { runs: priced.runs, priced };
}

/** Receipt name for a priced answer. */
export function horseRunItTwicePricedReceipt(a: HorseRunItTwicePricedAnswer): string {
  switch (a.reason) {
    case 'owner_cut_lopsided':
      return 'horse_rit_priced_owner_cut';
    case 'equity_unknown':
      return 'horse_rit_priced_equity_unknown';
    case 'measured_three':
      return 'horse_rit_priced_three';
    case 'measured_multi':
      return 'horse_rit_priced_multi';
    default:
      return 'horse_rit_priced_once';
  }
}
