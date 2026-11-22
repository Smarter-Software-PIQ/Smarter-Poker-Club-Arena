/**
 * omahaOpenNeedsMeasuredStrength (default OFF; EMERG lane PREFLOP-AUDIT, 2026-11-20).
 *
 * PLO4/PLO5 cash (tables and the Lightning pools), high only, one board, no bomb pot, preflop, three
 * or more players dealt in. Nobody has entered the pot (no raise, no limp), the Horse is not on the
 * button, and the node's final answer is a RAISE: the first-in open from a seat that is not the button.
 *
 * MEASURED, NOT ASSUMED. Every first-in open the Horses made in hands with a person at the table from
 * 2026-10-15 to 2026-11-19 (10,017 opens; all-in-adjusted hand result from the open on, a fold = 0),
 * by the hand's place in the two-card strength order (omahaMathCore preflopStrength: equity against one
 * random holding, public combinatorics only): the strongest 10% won +2.60 +/- 1.04 bb an open, the next
 * 10% +0.61 +/- 0.89, and the opens BELOW the strongest 20% lost: from the seats that are not the
 * button -2.24 +/- 0.72 bb an open against folding (n 2,968; fit to 11-14 -2.18 +/- 0.90, held out
 * 11-15 to 11-19 -2.38 +/- 1.17; tables -2.19 and -3.57, Lightning -2.17 and -1.12). On the button the
 * same opens did not lose (+0.50 +/- 0.88), so the button is not touched. With the option on such an
 * open becomes a fold. A pair of aces and the rundowns (four ranks inside a span of five) keep the
 * open: the strength order is equity against a random hand, which undervalues a rundown, and their
 * measured value below the cut is not negative (rundown +2.08 +/- 2.66 an open).
 * docs/horse-option-authority.d/omahaOpenNeedsMeasuredStrength.md.
 *
 * It changes only a raise into a fold. PUBLIC INFORMATION ONLY: the Horse's own cards, the public
 * action history, the seats. The same rule against every opponent. Pure: no opponent memory, no draw
 * from the brain's random stream. PLO6, PLO8, hold'em and tournaments are never in scope.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaColdCallClass, type OmahaColdCallClass } from './HorseOmahaColdCallMeasured.js';
import { cardToInt } from './omahaMathCore/OmahaMathCoreEval.js';
import { preflopStrength } from './omahaMathCore/OmahaMathCorePreflop.js';

/**
 * The strength (preflopStrength.v1.json) at the 80th percentile of uniformly random holdings: the cut
 * the measurement was graded at (40,000 random holdings a game, seed 11; a 400,000 sample gives
 * 0.53958 +/- 0.00023 and 0.54070 +/- 0.00018). Source: emerg/preflop-audit/work/thr.py.
 */
export const OMAHA_OPEN_MEASURED_CUT: Readonly<Record<string, number>> = Object.freeze({
  plo4: 0.539794,
  plo5: 0.541004,
});

/** Classes that keep the open below the cut (see the header). */
export const OMAHA_OPEN_MEASURED_KEPT: ReadonlySet<OmahaColdCallClass> = new Set([
  'aces',
  'rundown',
  'rundown_double_suited',
]);

/**
 * The cell the rule acts in (EMERG lane PREFLOP-2, 2026-11-20). The rule as first built (every seat
 * but the button, both games, tables and Lightning) removed 23.8% of the Horses' first-in opens and
 * its PLO4 held-out slice was negative (-311 +/- 291 bb). Split by game and pool on the same record,
 * in REAL chips (chips to persons; lead 1:42 AM: rake and Horse-to-Horse chips are internal), the
 * value of these opens against folding was: PLO5 tables -1.94 +/- 1.35 bb an open fit (n 523) and
 * -4.58 +/- 3.18 held out (n 194), the only cell below zero by more than one standard error in both
 * periods (net: folding gains +1,976 +/- 1,029 and +1,378 +/- 737 bb); PLO5 Lightning +4.55 +/-
 * 2.85 and -0.92 +/- 1.70; PLO4 tables -0.86 +/- 0.68 and -0.12 +/- 0.88; PLO4 Lightning -1.81 +/-
 * 1.64 and +2.57 +/- 1.55; the PLO4 hijack alone -1.77 +/- 1.45 and -0.06 +/- 0.63. So the rule
 * acts in PLO5 on a table only: 7.2% of first-in opens. Source: emerg/preflop-2/work/rg.py rr.
 */
export function omahaOpenMeasuredCell(variant: string, lightning: boolean): boolean {
  return variant === 'plo5' && !lightning;
}

export interface OmahaOpenMeasuredSpot {
  strength: number;
  cut: number;
  cls: OmahaColdCallClass;
}

/** The covered spot, or null. Reads only the request. */
export function omahaOpenMeasuredSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaOpenMeasuredSpot | null {
  try {
    if (String(gs.stage ?? '') !== 'preflop') return null;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    const cut = OMAHA_OPEN_MEASURED_CUT[variant];
    if (cut === undefined) return null;
    const hole = player.cards ?? [];
    if (hole.length !== (variant === 'plo4' ? 4 : 5)) return null;
    if (omahaIsTournamentMode(gs)) return null;
    if (gs.bombPot === true || gs.allInOrFold === true) return null;
    if ((gs.boardCount ?? 1) > 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.variantRules?.splitLow8OrBetter === true) return null;
    const dealt = (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in);
    if (dealt.length < 3) return null;
    if (player.seat === gs.dealerSeat) return null;
    // The one cell that passes on fit and on held-out data in real chips (EMERG lane PREFLOP-2).
    const speed = (gs as { publicMemoryDomain?: { speed?: unknown } | null }).publicMemoryDomain
      ?.speed;
    if (!omahaOpenMeasuredCell(variant, speed === 'lightning')) return null;
    const history = gs.actionHistory ?? [];
    if (preflopRaiseCount(history) !== 0) return null;
    for (const a of history) {
      if (a.stage !== 'preflop') continue;
      // nobody has entered the pot: no limp, no raise, and the Horse has not acted
      if (
        a.action === 'call' ||
        a.action === 'raise' ||
        a.action === 'bet' ||
        a.action === 'all_in' ||
        (a.seat === player.seat && a.action === 'check')
      )
        return null;
    }
    const strength = preflopStrength(variant, hole.map(cardToInt));
    if (strength === null || !Number.isFinite(strength)) return null;
    return { strength, cut, cls: omahaColdCallClass(hole) };
  } catch {
    return null;
  }
}

/**
 * The rule: with the option on, in the covered spot, a final raise with a hand below the cut that is
 * not a kept class becomes a fold. Everything else is returned untouched (the same object).
 */
export function omahaOpenMeasuredRule<D extends { action: string; amount?: number | null }>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean
): D {
  if (!on || decision.action !== 'raise') return decision;
  try {
    const spot = omahaOpenMeasuredSpot(player, gs);
    if (!spot || spot.strength >= spot.cut || OMAHA_OPEN_MEASURED_KEPT.has(spot.cls))
      return decision;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return decision;
    const folded = { ...decision, action: 'fold' } as D;
    delete folded.amount;
    return folded;
  } catch {
    return decision;
  }
}
