/**
 * V81 OMAHA BIG-BET CALL DISCIPLINE (2026-11-02, Phase 4 of the horse
 * improvement program). PLO4 / PLO5 only.
 *
 * Evidence: the DECISION EV of the horses' own turn/river CALLS of a bet they
 * did not start (net + chips already invested at the node, in bb: the call's
 * value against folding, chops at their fractional return, later streets
 * included), hand_history + ca_hand_facts on the old engine eed06fe5, every
 * hand kept, 95% CIs clustered by hand. The hand is classified AT THE
 * DECISION with the engine's own evaluator (omahaNutStatus), not from the
 * final board. Excluded from measurement and from the rule: heads-up tables,
 * bounty / PKO / mystery-bounty events, 20bb effective or less. Two
 * independent days, 47,806 calls in all (day A 2026-10-31 16:00 to 11-01 16:00
 * UTC, day B 11-01 16:00 to 11-02 16:00 UTC). Facing a wager of >= 0.9 pot:
 *
 *   RIVER                           day A                    day B
 *   straight, flush possible     -43.4 [-53.8, -33.0] n 42  -43.5 [-50.8, -36.1] n 60
 *   straight, not the nut        -48.9 [-61.5, -36.3] n 138 -36.8 [-43.8, -29.9] n 113
 *   straight, paired board       -33.0 [-42.9, -23.1] n 41  -21.0 [-29.1, -13.0] n 25
 *   flush, 3rd nut or worse      -53.6 [-82.2, -25.0] n 44  -77.9 [-113.2, -42.5] n 50
 *   nut flush, paired board      -44.6 [-60.4, -28.9] n 31  -38.0 [-56.3, -19.7] n 18
 *   two pair (cash; all formats) -44.2 [-50.6, -37.9] n 106 -40.6 [-47.6, -33.6] n 78
 *   TURN
 *   flush, 3rd nut or worse      -23.5 [-38.5, -8.5] n 136  -13.8 [-27.3, -0.2] n 128
 *   straight, paired board       -32.0 [-57.0, -6.9] n 14   -16.5 [-30.6, -2.4] n 15
 *
 * Each class is below zero in PLO4 and PLO5 separately on at least one day
 * and never above zero. Two pair is admitted in cash only: tournament two
 * pair straddled zero on both days. NOT admitted (a CI straddles zero on a
 * day, or the class wins): turn calls with a straight on a flush board, a
 * non-nut straight or two pair; the 0.5-0.9 pot band; second-nut flushes;
 * sets and trips; full houses (the evaluator cannot tell a nut boat from an
 * underboat here); nut straights and unpaired nut flushes (both win); one
 * pair (wins). Complements the live paired-board fold
 * (HorsePloPairedBoardFold: no committing call without a full house on a
 * paired board): V81's paired-board cells are the NON-committing pot-sized
 * calls that rule leaves open.
 *
 * A bettor MEASURED as a postflop over-bluffer (isPostflopManiac; never the
 * PLO preflop presumption) keeps today's call-down (HorseManiacPressure).
 *
 * Limits: only the horses' own calls are observed (no counterfactual fold
 * policy), ICM is not modelled, the price ignores players still to act, and a
 * call with chips of its own already in this street (hero.bet > 0) is out of
 * scope because its wager is not measured the same way.
 */
import type { Card } from '../types.js';
import { omahaNutStatus } from './HorseEval.js';

export const V81_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
export const V81_MIN_POT_FRAC = 0.9;
export const V81_MIN_EFFECTIVE_BB = 20;

const RV: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** Three distinct board ranks inside some 5-rank window (wheel included). */
export function omahaStraightPossible(board: Card[]): boolean {
  const r = new Set(board.map((c) => RV[c.rank]));
  if (r.has(14)) r.add(1);
  for (let lo = 1; lo <= 10; lo++) {
    let n = 0;
    for (let k = 0; k < 5; k++) if (r.has(lo + k)) n++;
    if (n >= 3) return true;
  }
  return false;
}

/** The made-hand class at the decision, as measured (omaha-call-cells.ts). */
export function omahaCallClass(hole: Card[], board: Card[]): string {
  const st = omahaNutStatus(hole, board);
  const paired = new Set(board.map((c) => c.rank)).size < board.length;
  const c = st.category;
  if (c >= 7) return 'full_house_plus';
  if (c === 6) {
    const f =
      st.higherFlushRanks === 0 ? 'nut' : st.higherFlushRanks === 1 ? 'second' : 'dominated';
    return `flush_${f}${paired ? '_paired' : ''}`;
  }
  if (c === 5) {
    if (st.flushPossible) return `straight_flushboard${paired ? '_paired' : ''}`;
    if (paired) return 'straight_paired';
    return st.straightIsNut ? 'straight_nut' : 'straight_nonnut';
  }
  if (c === 4)
    return `trips_set_${st.flushPossible || omahaStraightPossible(board) ? 'drawy' : 'dry'}`;
  if (c === 3) return 'two_pair';
  if (c === 2) return 'one_pair';
  return 'no_pair';
}

const RIVER_CELLS = new Set([
  'straight_flushboard',
  'straight_flushboard_paired',
  'straight_nonnut',
  'straight_paired',
  'flush_dominated',
  'flush_dominated_paired',
  'flush_nut_paired',
]);
const TURN_CELLS = new Set(['flush_dominated', 'flush_dominated_paired', 'straight_paired']);

export interface V81Input {
  variant: string;
  street: string;
  hole: Card[];
  board: Card[];
  /** The wager faced as a share of the pot before it. */
  potFrac: number;
  effectiveBB: number;
  tournament: boolean;
  headsUpTable: boolean;
  bountyEvent: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  /** The horse already has chips in on this street. */
  heroHasStreetChips: boolean;
}

/** The measured cell this call falls in, or null when V81 does not apply. */
export function v81Cell(i: V81Input): string | null {
  if (!V81_VARIANTS.has(String(i.variant).toLowerCase())) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.headsUpTable || i.bountyEvent) return null;
  if (i.heroHasStreetChips) return null;
  if (!(i.potFrac >= V81_MIN_POT_FRAC) || !(i.effectiveBB > V81_MIN_EFFECTIVE_BB)) return null;
  const vh = String(i.variant).toLowerCase() === 'plo4' ? 4 : 5;
  if (!Array.isArray(i.hole) || i.hole.length !== vh) return null;
  if (i.street === 'river' && i.board.length === 5) {
    const cls = omahaCallClass(i.hole, i.board);
    if (RIVER_CELLS.has(cls)) return cls;
    if (cls === 'two_pair' && !i.tournament) return cls;
    return null;
  }
  if (i.street === 'turn' && i.board.length === 4) {
    const cls = omahaCallClass(i.hole, i.board);
    return TURN_CELLS.has(cls) ? cls : null;
  }
  return null;
}
