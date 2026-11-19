/**
 * A LIGHTNING RUNOUT CARRIES ITS EQUITY (2026-11-18, StatsAllInEquityCoverageLow).
 *
 * Every Classic table prices an all-in runout on the equity worker pool the
 * moment betting closes with cards to come (ServerTableEngineRunout
 * broadcastAllInEquity), and the stats facts read that first price. The
 * Lightning host handled ALL_IN_RUNOUT by running the board out and never
 * priced it: on 2026-11-17/18 all 581 owed Lightning runout seats in a day
 * (nlh 229, plo5 210, plo4 142) were written with no all_in_equity, while
 * Classic cash (734) and tournaments (34,453) were complete. That alone held
 * the 7-day coverage under 99% and kept the alert escalated.
 *
 * This prices the runout with the same rules and the same pool request as
 * Classic: no number for a hand nobody may hold (three cards outside Omaha),
 * none for a missing opponent, multi-board as the equal-share average, live
 * pots by eligible index. It resolves null when there is no honest number and
 * never rejects: stats must never affect a hand.
 */
import type { Card } from '../types.js';
import { getEquityPool } from '../engine/equity/EquityWorkerPool.js';
import { isHiLoVariant, isOmahaVariant } from '../engine/VariantRules.js';

export interface RunoutEquity {
  /** userId -> equity as a fraction 0..1, the facts writer's unit. */
  byUser: Map<string, number>;
  street: string;
}

export interface RunoutEquityInput {
  players: ReadonlyArray<{ user_id: string; cards?: Card[] | null }>;
  /** Live boards, board 1 first. */
  boards: ReadonlyArray<Card[]>;
  variant: string;
  pots?: ReadonlyArray<{ amount: number; eligiblePlayers: string[] }> | null;
  deadCards?: Card[];
}

export type RunoutPricer = (
  hands: Card[][],
  board: Card[],
  deadCards: Card[],
  iters: number,
  opts: {
    exact: boolean;
    pots?: Array<{ amount: number; eligible: number[] }>;
    hiLo: boolean;
    shortDeck: boolean;
    omaha: boolean;
  }
) => Promise<number[]>;

const poolPricer: RunoutPricer = (hands, board, dead, iters, opts) =>
  getEquityPool().estimateEquity(hands, board, dead, iters, opts);

export function streetOfBoard(boardLength: number): string {
  if (boardLength >= 5) return 'river';
  if (boardLength === 4) return 'turn';
  if (boardLength === 3) return 'flop';
  return 'preflop';
}

export async function priceLightningRunout(
  input: RunoutEquityInput,
  price: RunoutPricer = poolPricer
): Promise<RunoutEquity | null> {
  try {
    const players = input.players ?? [];
    const omaha = isOmahaVariant(input.variant);
    // A hand nobody is allowed to hold is never priced (Crazy Pineapple).
    if (players.some((p) => (p.cards ?? []).length > 2) && !omaha) return null;
    // A missing opponent is unknown, never a smaller field priced as fact.
    if (players.length < 2 || players.some((p) => (p.cards ?? []).length < 2)) return null;
    const boards = (input.boards ?? []).filter(
      (b, i) => i === 0 || (Array.isArray(b) && b.length > 0)
    );
    if (boards.length === 0) return null;
    // A river runout has no cards to come: nothing to price.
    if ((boards[0] ?? []).length >= 5) return null;
    const hands = players.map((p) => [...(p.cards ?? [])]);
    const pots = (input.pots ?? [])
      .filter((p) => p.amount > 0)
      .map((p) => ({
        amount: p.amount,
        eligible: p.eligiblePlayers.map((id) => players.findIndex((pl) => pl.user_id === id)),
      }));
    const iters = Math.max(400, Math.ceil(1000 / boards.length));
    const opts = {
      exact: true,
      pots: pots.length > 0 ? pots : undefined,
      hiLo: isHiLoVariant(input.variant),
      shortDeck: input.variant === 'short_deck',
      omaha,
    };
    const perBoard = await Promise.all(
      boards.map((b, i) =>
        price(
          hands,
          b,
          [...(input.deadCards ?? []), ...boards.flatMap((other, j) => (j === i ? [] : other))],
          iters,
          opts
        )
      )
    );
    if (
      perBoard.some(
        (values) =>
          !Array.isArray(values) ||
          values.length !== hands.length ||
          values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
      )
    ) {
      return null;
    }
    const byUser = new Map<string, number>();
    players.forEach((p, i) => {
      byUser.set(p.user_id, perBoard.reduce((s, f) => s + f[i], 0) / boards.length);
    });
    return { byUser, street: streetOfBoard((boards[0] ?? []).length) };
  } catch {
    return null;
  }
}
