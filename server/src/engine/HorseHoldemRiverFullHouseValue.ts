/**
 * HOLD'EM RIVER FULL HOUSE VALUE (2026-11-15, Hold'em Strategy lane; option holdemRiverFullHouseValue, read
 * === true, default OFF).
 *
 * The owner's shared audit of Hold'em hands against people (review-v9, 131 flagged river decisions holding a full
 * house or better) was replayed on main: 50 of the 67 "checked with players behind" spots still check, 48 of them
 * at the V11 initiative gate (a player without the betting lead, out of position, checks to the prior aggressor
 * on a blank river). On the river there is no later street: when the aggressor checks back, a full house wins
 * the pot it already had. The calls, check-backs and folds in the audit no longer reproduce except with an
 * under-full or a board that plays, where the flat call or check is correct.
 *
 * This file is the hand test only: a no-limit hold'em river full house or better that uses a hole card and that
 * no single board-paired card beats. Excluded on purpose (they keep today's check): the board's own five cards
 * play; an under-full (a board pair above hero's trips); a boat made on a trips board (any higher pocket pair or
 * higher board card beats it).
 */
import type { Card } from '../types.js';

const RANK_ORDER = '23456789TJQKA';
const rankValue = (rank: string): number => RANK_ORDER.indexOf(rank === '10' ? 'T' : rank);

/** [8, quads rank, 0] | [7, trips rank, pair rank] | null for the best full house or quads in the cards. */
function boatOf(cards: readonly Card[]): [number, number, number] | null {
  const counts = new Map<number, number>();
  for (const c of cards) {
    const v = rankValue(String(c.rank));
    if (v < 0) return null;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const ranks = [...counts.entries()];
  const quads = ranks.filter(([, n]) => n === 4).map(([r]) => r);
  if (quads.length) return [8, Math.max(...quads), 0];
  const trips = ranks.filter(([, n]) => n >= 3).map(([r]) => r);
  if (!trips.length) return null;
  const top = Math.max(...trips);
  const pairs = ranks.filter(([r, n]) => n >= 2 && r !== top).map(([r]) => r);
  if (!pairs.length) return null;
  return [7, top, Math.max(...pairs)];
}

const beatsOrTies = (a: [number, number, number], b: [number, number, number]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

/** True for a two-card hold'em hand on a five-card board that holds a full house or better worth leading. */
export function holdemRiverLeadBoat(hole: readonly Card[], board: readonly Card[]): boolean {
  if (hole.length !== 2 || board.length !== 5) return false;
  const mine = boatOf([...hole, ...board]);
  if (!mine) return false;
  const boards = boatOf(board);
  if (boards && beatsOrTies(boards, mine)) return false; // the board plays
  const boardCounts = new Map<number, number>();
  for (const c of board) {
    const v = rankValue(String(c.rank));
    boardCounts.set(v, (boardCounts.get(v) ?? 0) + 1);
  }
  if (mine[0] === 8) return (boardCounts.get(mine[1]) ?? 0) < 4;
  for (const [r, n] of boardCounts) if (n >= 2 && r > mine[1]) return false; // under-full
  if ((boardCounts.get(mine[1]) ?? 0) === 3) return false; // trips board
  return true;
}

/** The share of qualifying river spots that lead; the rest keep the check (and its check-raise). */
export const HOLDEM_RIVER_BOAT_LEAD_FREQUENCY = 0.7;

/**
 * holdemRiverFullHouseValueIsPriced (ROWFIX 2026-11-18, Horse Switch lane; default OFF, read === true,
 * unevaluated). NLH-CASH improvement I1: the lead above is a fixed 70% on a hand-class gate, priced by
 * nothing. With this option on (and holdemRiverFullHouseValue on) a qualifying boat leads exactly when the
 * expected value of the lead beats the expected value of the check, heads-up, from the aggressor's measured
 * rates; no random number is drawn. HorseLogic passes:
 *
 *   pot        the pot before the lead
 *   lead       the lead the monster branch would size (the midpoint of its mixed size), capped by both stacks
 *   equity     hero's equity against the aggressor's range (the engine's river figure, 0..1)
 *   callShare  the aggressor's measured share of river bets he calls or raises (riverCall), posterior mean
 *   betShare   the aggressor's measured share of spots checked to him that he bets (betCheckedTo), posterior
 *
 * Both rates are the exploit layer's Beta posteriors (HorseOpponentExploit.statRead) on his decayed counters,
 * centred on the population cell of the table's variant and size (OPPONENT_EXPLOIT_ENVELOPE, MEASURED
 * 2026-10-16 from production, version horse-population-2026-10-16: 1,186,859 hands, the pooled Horse rate per
 * game and table size; nlh:short riverCall 0.4337, betCheckedTo 0.3115). That population is the Horses', not
 * the people's: with no read on a person the prior is the Horse figure (stated in the authority file).
 *
 *   EV(lead)  = (1 - callShare) * pot + callShare * (equity * (pot + 2 * lead) - lead)
 *   EV(check) = (1 - betShare) * equity * pot + betShare * (equity * (pot + 2 * lead) - lead)
 *
 * The check prices his bet at the lead's own size (an assumption, no measurement: the two lines are
 * compared at one size) and hero calling it; a raise by either side is left out of both lines alike. With
 * equity near one the comparison is callShare against betShare: lead into a player who calls more often than
 * he bets when checked to, check to one who bets more often than he calls.
 */
export interface HoldemRiverBoatLeadPriceInput {
  pot: number;
  lead: number;
  equity: number;
  callShare: number;
  betShare: number;
}
export interface HoldemRiverBoatLeadPrice {
  evLead: number;
  evCheck: number;
  lead: boolean;
}
const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
/** The lead-or-check comparison above; null when an input is not a usable number. */
export function holdemRiverBoatLeadPrice(
  i: HoldemRiverBoatLeadPriceInput
): HoldemRiverBoatLeadPrice | null {
  if (!(Number.isFinite(i.pot) && i.pot > 0) || !(Number.isFinite(i.lead) && i.lead > 0))
    return null;
  if (![i.equity, i.callShare, i.betShare].every(Number.isFinite)) return null;
  const eq = clamp01(i.equity);
  const c = clamp01(i.callShare);
  const b = clamp01(i.betShare);
  const called = eq * (i.pot + 2 * i.lead) - i.lead;
  const evLead = (1 - c) * i.pot + c * called;
  const evCheck = (1 - b) * eq * i.pot + b * called;
  return { evLead, evCheck, lead: evLead > evCheck };
}
