/**
 * OMAHA RIVER: ONLY THE NUTS RAISE A BET (Dan 2026-11-14, hand 59401453).
 *
 * PLO5 1/2, six handed. A Horse with top set on an unpaired river board with
 * no possible flush and three different possible straights faced a full-pot
 * lead and moved all in over it. It was called by the nut straight. Dan: a
 * Horse that does not hold the nuts never raises a river bet, whatever it
 * reads the bettor to be; it calls at most and leans toward folding.
 *
 * Why the raise happened: the low-SPR commitment branch of the facing-a-bet
 * path jams any hand whose equity estimate clears 0.42 unless a flat rule
 * names it, and the Omaha flat rule there (preferFlat15) only knew flushes
 * and straights (omahaNutStatus is read for those two categories). A set is
 * neither, so three aces were re-shoved at 0.57 to 0.62 estimated equity.
 * A river raise over a bet is called by the hands that beat it and folds out
 * the hands it beats: against any range it is worth no more than the call.
 *
 * The rule, after every strategy owner (the policy graph's wager_rules node,
 * before the call-discipline folds so they judge the call it leaves): in
 * pot-limit or no-limit Omaha high (PLO4, PLO5, PLO6) on one board, a river
 * raise or an all-in for more than the call, facing a wager, stands only
 * when the hand is licensed:
 *   - the exact river nuts (hasRiverNuts), or
 *   - the engine's existing effective-nut classes: a full house or better
 *     that no bigger full house beats (omahaBoatsAbove; only quads or a
 *     straight flush are over it), the nut flush on an unpaired board, the
 *     nut straight on an unpaired board with no possible flush.
 * Every other raise becomes a call of the wager. When the reference decision
 * was a fold and a later owner turned it into the raise, the fold is restored.
 * An all-in that is itself the call (the stack is no more than the call) is a
 * call and is left alone.
 *
 * Out of scope, unchanged: Hi-Lo (a low half changes what a raise wins),
 * more than one board (the nuts are per board), fixed limit, all-in-or-fold
 * tables (no call exists), a street other than the river, a decision that
 * faces no wager, and every game that is not Omaha.
 *
 * Public information only: hero's cards, the board and hero's known dead
 * cards. No opponent read is consulted: the rule is the same against every
 * bettor, Horse or human.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { omahaBoatsAbove, omahaNutStatus, variantInfo } from './HorseEval.js';

export const OMAHA_RIVER_NUT_RAISE_VARIANTS: ReadonlySet<string> = new Set([
  'plo4',
  'plo5',
  'plo6',
]);

export type OmahaRiverRaiseLicense = 'nuts' | 'effective_nuts';

const toCallOf = (hero: SeatPlayer, gs: HorseGameStateV2): number =>
  Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));

/** True when the rule governs this node at all (variant, street, board, wager). */
export function omahaRiverNutRaiseInScope(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_RIVER_NUT_RAISE_VARIANTS.has(variant)) return false;
  if (gs.stage !== 'river') return false;
  const vi = variantInfo(variant);
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return false;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return false;
  if (
    (gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0
  )
    return false;
  if (gs.allInOrFold === true) return false;
  const board = gs.communityCards ?? [];
  if (board.length !== 5) return false;
  if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return false;
  return toCallOf(hero, gs) > 0.005;
}

/**
 * The license a river raise needs, or null. Reads the board and hero's cards
 * with the engine's own classifiers; an evaluator failure is no license.
 */
export function omahaRiverRaiseLicense(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverRaiseLicense | null {
  try {
    if (hasRiverNuts(hero, gs)) return 'nuts';
    const hole: Card[] = hero.cards;
    const board: Card[] = gs.communityCards ?? [];
    const status = omahaNutStatus(hole, board);
    const paired = new Set(board.map((c) => c.rank)).size < board.length;
    // A full house or better: no bigger full house is available. Quads over
    // it (the case card on a trip board, the one pocket pair on a paired one)
    // do not take the license away; the engine has always raised that hand.
    if (status.category >= 7)
      return omahaBoatsAbove(hole, board).boats > 0 ? null : 'effective_nuts';
    if (status.category === 6)
      return status.higherFlushRanks === 0 && !paired ? 'effective_nuts' : null;
    if (status.category === 5)
      return status.straightIsNut && !status.flushPossible && !paired ? 'effective_nuts' : null;
    return null;
  } catch {
    return null;
  }
}

export interface OmahaRiverNutRaiseResult {
  decision: HorseDecision;
  /** 'flatted': the raise became a call. 'fold_restored': the reference fold
   *  a later owner had raised over came back. null: nothing changed. */
  changed: 'flatted' | 'fold_restored' | null;
}

/**
 * Final strategy invariant. `reference` is the decision the brain made before
 * the later policy owners ran; when it was a fold, an unlicensed raise goes
 * back to that fold rather than becoming a call nobody priced.
 */
export function omahaRiverNutRaiseOnly(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  enabled: boolean,
  reference?: HorseDecision | null
): OmahaRiverNutRaiseResult {
  const same: OmahaRiverNutRaiseResult = { decision, changed: null };
  if (!enabled) return same;
  if (decision.action !== 'raise' && decision.action !== 'all_in') return same;
  try {
    if (!omahaRiverNutRaiseInScope(hero, gs)) return same;
    const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
    const toCall = toCallOf(hero, gs);
    // A shove for no more than the call is a call, not a raise.
    if (decision.action === 'all_in' && stack <= toCall + 0.005) return same;
    if (omahaRiverRaiseLicense(hero, gs) !== null) return same;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    if (reference && reference.action === 'fold' && (!legal || legal.includes('fold'))) {
      const folded: HorseDecision = { ...decision, action: 'fold' };
      delete folded.amount;
      return { decision: folded, changed: 'fold_restored' };
    }
    if (legal && !legal.includes('call')) return same;
    return {
      decision: { ...decision, action: 'call', amount: Math.round(toCall * 100) / 100 },
      changed: 'flatted',
    };
  } catch {
    return same;
  }
}
