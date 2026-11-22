/**
 * omahaColdCallOutsideBigBlindIsMeasured (default OFF; EMERG lane PREFLOP-AUDIT, 2026-11-20).
 *
 * PLO4/PLO5 cash TABLES (not the Lightning pools), high only, one board, no bomb pot, preflop. The
 * Horse faces exactly one raise, has put in less than one big blind (nothing, or the small blind), has
 * not acted voluntarily yet, the raiser is not all in, and the node's final answer is a CALL that
 * leaves chips behind: the cold call of an open from a seat without a big blind posted.
 *
 * MEASURED, NOT ASSUMED. Every such call the Horses made in hands with a person at the table from
 * 2026-10-15 to 2026-11-19 (9,236 calls; all-in-adjusted hand result from the call on, a fold = 0) lost
 * 2.17 +/- 0.40 big blinds against folding, in every strength decile of the hand, every position other
 * than the big blind, every stack band, against Horse and person openers alike, in both halves of the
 * data (fit to 11-14: -2.49 +/- 0.50; held out 11-15 to 11-19: -1.57 +/- 0.66). The big blind's call of
 * the same open did not lose (+0.59 +/- 0.48), so it is not touched; Lightning was inside noise
 * (-0.19 +/- 1.12 for folding), so it is not touched. By the hand's class (OMAHA_COLD_CALL_CLASS_VALUE,
 * the measured value of the call in big blinds and its standard error), the call became a fold only
 * for the classes whose measured value is below zero by more than one standard error; the classes it
 * is not (two queens or jacks with three broadway cards, three broadway cards without a higher class)
 * and a pair of aces (whose measured better play is the re-raise, not the fold) keep the call.
 * Rule as graded: fit +14,878 +/- 2,563 bb over 3,655 hands, held out +5,354 +/- 1,667 bb over 1,847
 * hands (per-hand clustered). docs/horse-option-authority.d/omahaColdCallOutsideBigBlindIsMeasured.md.
 *
 * REAL CHIPS (EMERG lane PREFLOP-2, 2026-11-20; lead 1:42 AM: the metric is the chips that go to
 * persons, rake and Horse-to-Horse chips are internal). Re-graded on that metric (each hand's loss
 * split pro rata over its winners, plus 1.9% of deductions; all-in adjusted where the sign holds) the
 * calls above cost 0.89 +/- 0.25 bb each (fit -0.78 +/- 0.32, held out -1.11 +/- 0.41): real, but a
 * third of the net figure, for 11.7 points of table VPIP. The cost is concentrated in one cell: the
 * SMALL BLIND calling when NOBODY ELSE HAS CALLED the raise, with a hand BELOW THE STRONGEST 20% of
 * the two-card strength order: -2.20 +/- 0.48 bb a call in real chips (n 1,023; fit -2.61 +/- 0.61,
 * held out -1.23 +/- 0.74), 11.2% of the calls. The same seat with a hand in the strongest 20% did
 * not lose (+0.55 +/- 0.87); every other cell cost 0.75 +/- 0.29 a call. The rule now acts in that
 * cell alone (omahaColdCallRealCell).
 *
 * It changes only a call into a fold: a raise (the 3-bet), a fold and every other spot stand. PUBLIC
 * INFORMATION ONLY: the Horse's own cards, the public action history, the chips. The same rule against
 * every opponent, a person or a Horse. Pure: no opponent memory, no draw from the brain's random
 * stream. PLO6, PLO8, hold'em, tournaments and Lightning are never in scope: byte-identical on.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { RANK_VALUES } from './PokerEngine.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { cardToInt } from './omahaMathCore/OmahaMathCoreEval.js';
import { preflopStrength } from './omahaMathCore/OmahaMathCorePreflop.js';

export const OMAHA_COLD_CALL_MEASURED_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

export type OmahaColdCallClass =
  | 'aces'
  | 'kings'
  | 'queens_jacks_broadway'
  | 'rundown_double_suited'
  | 'rundown'
  | 'double_suited'
  | 'broadway'
  | 'pair'
  | 'other';

/**
 * The measured value of the cold call in big blinds against folding, and its standard error (table
 * cash, a seat without a big blind posted, 2026-10-15 to 2026-11-19, hands with a person; n calls).
 * Source: archive repairs/EMERG/PREFLOP-AUDIT.md, script emerg/preflop-audit/work/cand2.py.
 */
export const OMAHA_COLD_CALL_CLASS_VALUE: Readonly<
  Record<OmahaColdCallClass, { n: number; valueBB: number; seBB: number }>
> = Object.freeze({
  aces: { n: 106, valueBB: -3.59, seBB: 3.63 },
  kings: { n: 265, valueBB: -3.93, seBB: 2.34 },
  queens_jacks_broadway: { n: 519, valueBB: 2.08, seBB: 2.18 },
  rundown_double_suited: { n: 560, valueBB: -2.9, seBB: 1.89 },
  rundown: { n: 554, valueBB: -6.25, seBB: 1.56 },
  double_suited: { n: 3644, valueBB: -1.73, seBB: 0.69 },
  broadway: { n: 723, valueBB: -0.71, seBB: 1.58 },
  pair: { n: 1345, valueBB: -2.06, seBB: 0.78 },
  other: { n: 1520, valueBB: -3.32, seBB: 0.67 },
});

/**
 * The hand's class, first match in this order: a pair of aces; a pair of kings; a pair of queens or
 * jacks as the highest pair with three or more cards ten or higher; four or more distinct ranks inside
 * a span of five with two suits of two or more cards; the same span without the suits; two suits of
 * two or more cards; three or more cards ten or higher; any pair; the rest. An ace counts high only.
 */
export function omahaColdCallClass(hole: readonly Card[]): OmahaColdCallClass {
  const count = new Map<number, number>();
  const suits = new Map<string, number>();
  let broadway = 0;
  for (const c of hole) {
    const r = RANK_VALUES[c.rank];
    count.set(r, (count.get(r) ?? 0) + 1);
    suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
    if (r >= 10) broadway++;
  }
  let topPair = 0;
  for (const [r, k] of count) if (k >= 2 && r > topPair) topPair = r;
  const suited = [...suits.values()].filter((k) => k >= 2).length;
  let run = 0;
  for (let lo = 2; lo <= 10; lo++) {
    let k = 0;
    for (const r of count.keys()) if (r >= lo && r <= lo + 4) k++;
    if (k > run) run = k;
  }
  if ((count.get(14) ?? 0) >= 2) return 'aces';
  if (topPair === 13) return 'kings';
  if ((topPair === 12 || topPair === 11) && broadway >= 3) return 'queens_jacks_broadway';
  if (run >= 4 && suited >= 2) return 'rundown_double_suited';
  if (run >= 4) return 'rundown';
  if (suited >= 2) return 'double_suited';
  if (broadway >= 3) return 'broadway';
  if (topPair > 0) return 'pair';
  return 'other';
}

/** True when the class's measured call value is below zero by more than one standard error. */
export function omahaColdCallClassFolds(cls: OmahaColdCallClass): boolean {
  if (cls === 'aces') return false; // the measured better play of aces is the re-raise, never the fold
  const m = OMAHA_COLD_CALL_CLASS_VALUE[cls];
  return m.valueBB + m.seBB < 0;
}

/**
 * The 80th percentile of the two-card strength (omahaMathCore preflopStrength) of random holdings,
 * the same cut as OMAHA_OPEN_MEASURED_CUT (the law test holds the two equal).
 */
export const OMAHA_COLD_CALL_STRENGTH_CUT: Readonly<Record<string, number>> = Object.freeze({
  plo4: 0.539794,
  plo5: 0.541004,
});

/**
 * The real-chip grade of the one cell the rule acts in (chips to persons, bb a call; n calls).
 * Source: archive repairs/EMERG/PREFLOP-2.md, script emerg/preflop-2/work/rg.py cc2.
 */
export const OMAHA_COLD_CALL_REAL_CELL = Object.freeze({
  n: 1023,
  fitBB: -2.61,
  fitSeBB: 0.61,
  heldOutBB: -1.23,
  heldOutSeBB: 0.74,
});

export interface OmahaColdCallSpot {
  toCall: number;
  cls: OmahaColdCallClass;
  /** the Horse has the small blind posted (chips in front, less than a big blind) */
  smallBlind: boolean;
  /** other players who have called the raise */
  callers: number;
  /** the two-card strength of the hand, or null */
  strength: number | null;
  /** the 80th percentile of that strength for the game */
  strengthCut: number;
}

/**
 * The cell measured to cost real chips: the small blind, nobody else has called the raise, a hand
 * below the strongest 20%.
 */
export function omahaColdCallRealCell(spot: OmahaColdCallSpot): boolean {
  return (
    OMAHA_COLD_CALL_REAL_CELL.fitBB + OMAHA_COLD_CALL_REAL_CELL.fitSeBB < 0 &&
    OMAHA_COLD_CALL_REAL_CELL.heldOutBB + OMAHA_COLD_CALL_REAL_CELL.heldOutSeBB < 0 &&
    spot.smallBlind &&
    spot.callers === 0 &&
    spot.strength !== null &&
    spot.strength < spot.strengthCut
  );
}

/** The covered spot, or null. Reads only the request. */
export function omahaColdCallOutsideBigBlindSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaColdCallSpot | null {
  try {
    if (String(gs.stage ?? '') !== 'preflop') return null;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_COLD_CALL_MEASURED_VARIANTS.has(variant)) return null;
    const hole = player.cards ?? [];
    if (hole.length !== (variant === 'plo4' ? 4 : 5)) return null;
    // Cash only, with or without the tournament extension: the measurement holds cash tables alone.
    if (omahaIsTournamentMode(gs)) return null;
    const speed = (gs as { publicMemoryDomain?: { speed?: unknown } | null }).publicMemoryDomain
      ?.speed;
    if (speed === 'lightning') return null;
    if (gs.bombPot === true || gs.allInOrFold === true) return null;
    if ((gs.boardCount ?? 1) > 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.variantRules?.splitLow8OrBetter === true) return null;
    const bb = Number(gs.bigBlind);
    if (!(bb > 0)) return null;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    // A seat with a big blind in front of it (the big blind, a posted dead blind, a limper) is not covered.
    if (heroBet >= bb - 0.005) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    if (toCall <= 0.005 || stack <= toCall + 0.005) return null;
    const history = gs.actionHistory ?? [];
    if (preflopRaiseCount(history) !== 1) return null;
    let raiserSeat = -1;
    let callers = 0;
    for (const a of history) {
      if (a.stage !== 'preflop') continue;
      // a call by another player after the raise (a limp before it is not a call of the raise)
      if (a.seat !== player.seat && a.action === 'call' && raiserSeat >= 0) callers++;
      // the Horse has not acted voluntarily in this hand
      if (
        a.seat === player.seat &&
        (a.action === 'call' ||
          a.action === 'check' ||
          a.action === 'raise' ||
          a.action === 'bet' ||
          a.action === 'all_in')
      )
        return null;
      if (
        a.seat !== player.seat &&
        (a.action === 'raise' || a.action === 'bet' || a.action === 'all_in')
      )
        raiserSeat = a.seat;
    }
    if (raiserSeat < 0) return null;
    const raiser = (gs.players ?? []).find((p) => p.seat === raiserSeat);
    if (!raiser || raiser.is_folded || raiser.is_all_in) return null;
    const strength = preflopStrength(variant, hole.map(cardToInt));
    return {
      toCall,
      cls: omahaColdCallClass(hole),
      smallBlind: heroBet > 0.005,
      callers,
      strength: strength !== null && Number.isFinite(strength) ? strength : null,
      strengthCut: OMAHA_COLD_CALL_STRENGTH_CUT[variant] as number,
    };
  } catch {
    return null;
  }
}

/**
 * The rule: with the option on, in the covered spot, a final call of a class whose measured value is
 * below zero by more than one standard error becomes a fold. Everything else is returned untouched
 * (the same object), so off and out of scope are byte-identical.
 */
export function omahaColdCallOutsideBigBlindRule<
  D extends { action: string; amount?: number | null },
>(decision: D, player: SeatPlayer, gs: HorseGameStateV2, on: boolean): D {
  if (!on || decision.action !== 'call') return decision;
  try {
    const spot = omahaColdCallOutsideBigBlindSpot(player, gs);
    if (!spot || !omahaColdCallClassFolds(spot.cls) || !omahaColdCallRealCell(spot))
      return decision;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return decision;
    const folded = { ...decision, action: 'fold' } as D;
    delete folded.amount;
    return folded;
  } catch {
    return decision;
  }
}
