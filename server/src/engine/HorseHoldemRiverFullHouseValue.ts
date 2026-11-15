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
