/**
 * A RIVER FULL HOUSE ON A TRIPS BOARD THAT QUADS OR A STRAIGHT FLUSH CAN BEAT IS NOT NUT CLASS (PLO-OWNER lead-7 lane
 * plo-postflop, 2026-11-26; option omahaRiverTripsBoardBoatIsNotNutClass, default OFF, read `=== true`, scopable per
 * game with horse.omahaGameScope).
 *
 * WHY. The nut-class test (omahaNutClassNow / omahaRiverRaiseLicense) licenses a raise with a full house no bigger full
 * house beats and ignores quads. Every Horse river raise Nov 12-26 (PLO4/PLO5 cash; the Horse's own cards and shown
 * cards only): on a PAIRED board those raises earned +8,376 bb (253 raises; 8 of 95 showdowns lost to quads or a
 * straight flush); on a TRIPS board, where any holding with the case card makes quads, 32 raises lost -1,998 bb
 * (-62 bb a raise) and 11 of 21 showdowns, every one to quads or a straight flush. The lead's decision (2026-11-26):
 * keep the test on paired boards, tighten it on trips boards on the river.
 *
 * WHAT IT DOES. PLO4/PLO5 cash, high only, one board, no bomb pot, the river, facing a wager: where the rule chain
 * raises with a full house (not quads) on a board holding three cards of one rank, and some holding of the unseen
 * cards beats it (exact count with the Horse's own cards and the known dead cards removed: holding the case card, or
 * the card a straight flush needs, makes it unbeatable and keeps the raise), the raise becomes the legal call. It may
 * call, never raise. Every other decision is returned as given (the same object). Pure: no telemetry, no state.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { omahaRiverOpeningBins } from './HorseOmahaRiverOpeningBet.js';

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** True when the board holds three or more cards of one rank. */
export function omahaTripsBoard(board: readonly Card[]): boolean {
  const n = new Map<string, number>();
  for (const c of board) n.set(String(c.rank), (n.get(String(c.rank)) ?? 0) + 1);
  return [...n.values()].some((k) => k >= 3);
}

/** The share of holdings of the unseen cards (the Horse's cards and the dead cards removed) that beat the hand. */
export function omahaRiverBeatenShare(hole: Card[], board: Card[], dead: Card[]): number | null {
  const b = omahaRiverOpeningBins(hole, board, dead);
  if (!b) return null;
  let s = 0;
  for (let i = 0; i < b.mass.length; i++) s += b.mass[i] * Math.max(0, 1 - b.beat[i] - b.tie[i]);
  return s;
}

/** The spot: a river full house (not quads) on a trips board that some holding beats. */
export function omahaTripsBoardBoatBeatable(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return false;
    const board = gs.communityCards ?? [];
    if (String(gs.stage) !== 'river' || board.length !== 5 || !omahaTripsBoard(board)) return false;
    const cat = Math.floor(scoreOmahaHiPartial(hero.cards, board) / 0x100000);
    if (cat !== 7) return false;
    const beaten = omahaRiverBeatenShare(hero.cards, board, hero.knownDeadCards ?? []);
    return beaten !== null && beaten > 0;
  } catch {
    return false;
  }
}

export function omahaTripsBoardBoatRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  if (!on) return decision;
  try {
    const toCall = Math.max(0, (gs.currentBet ?? 0) - (fin(hero.bet) ? hero.bet : 0));
    if (!(toCall > 0)) return decision;
    const raising =
      decision.action === 'raise' ||
      (decision.action === 'all_in' &&
        fin(decision.amount) &&
        (decision.amount as number) > (gs.currentBet ?? 0) + 0.005 &&
        hero.stack + (fin(hero.bet) ? hero.bet : 0) > (gs.currentBet ?? 0) + 0.005);
    if (!raising) return decision;
    if (!omahaTripsBoardBoatBeatable(hero, gs)) return decision;
    const legal = legalize({ ...decision, action: 'call', amount: toCall });
    if (legal.action !== 'call' && legal.action !== 'all_in') return decision;
    if (
      legal.action === 'all_in' &&
      fin(legal.amount) &&
      (legal.amount as number) > (gs.currentBet ?? 0) + 0.005
    )
      return decision;
    return { ...decision, action: legal.action, amount: legal.amount };
  } catch {
    return decision;
  }
}
