/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A LIGHTNING ALL-IN IS PRICED (2026-11-11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Production alert 376656 (`StatsAllInEquityCoverageLow`, 96.69% over 7 days).
 * In the 30 hours to 2026-11-11T09:55Z the two Midway Lightning host tables
 * (NLH 0.25/0.50 `0f84a1ab`, PLO4 0.25/0.50 `ea34f32d`) recorded 3,174 owed
 * all-in runouts and 3,174 of them had no `all_in_equity`. Every physical cash
 * table of the same hours was at 96-100%.
 *
 * The cause is structural, not a timeout. A physical table's equity reaches
 * `ca_hand_facts` through ServerTableEngineRunout.broadcastAllInEquity(): it
 * prices the runout on the equity worker pool and emits an `all_in_equity`
 * event, which TableStateHub.emitEvent hands to captureAllInEquity(). The
 * Lightning host never prices anything and never emits that event, so
 * writeHandFacts found no equity for any Lightning hand while the frozen
 * ALL_IN_RUNOUT witness correctly marked each seat as owed one. The EV line,
 * the luck readouts and EV-adjusted results were therefore wrong for every
 * player in every fast-fold all-in, horse and human alike (CLAUDE.md 10.5).
 *
 * This prices the Lightning runout the same way the physical engine does: the
 * same worker pool, the same exact enumeration, the same variant flags and the
 * same pot-share denominators from the controller's live pots, at the same
 * moment (the first ALL_IN_RUNOUT, before any further card is dealt). The
 * result is handed straight to the hand's facts input rather than through the
 * TableStateHub cache, because the Lightning host owns its hand end to end.
 *
 * Never throws and never rejects: stats capture must not be able to affect a
 * hand. A hand the pool cannot price settles exactly as it did before, still
 * marked owed, so the coverage monitor keeps seeing the gap.
 */
import { getEquityPool } from '../engine/equity/EquityWorkerPool.js';
import type { EquityOptions } from '../engine/equity/equityWorker.js';
import { isHiLoVariant, isOmahaVariant, isShortDeckVariant } from '../engine/VariantRules.js';
import type { Card, Pot } from '../types.js';

/** The facts-layer shape: userId -> pot-share equity as a fraction 0..1. */
export interface PricedAllInEquity {
  byUser: Map<string, number>;
  street: 'preflop' | 'flop' | 'turn';
}

export interface LightningAllInEquityInput {
  /** The ALL_IN_RUNOUT event's active players (cards known at an all-in). */
  players: ReadonlyArray<{ user_id: string; cards?: Card[] | null }>;
  /** Board 1 as it stood at the all-in. */
  board: readonly Card[];
  /** HandController.computeLivePots() at the all-in. */
  pots?: readonly Pot[] | null;
  variant: string;
}

export interface LightningEquityPricer {
  estimateEquity(
    hands: Card[][],
    board: Card[],
    deadCards?: Card[],
    iters?: number,
    opts?: EquityOptions
  ): Promise<number[]>;
}

function streetOf(boardLength: number): PricedAllInEquity['street'] | null {
  if (boardLength === 0) return 'preflop';
  if (boardLength === 3) return 'flop';
  if (boardLength === 4) return 'turn';
  return null; // a river all-in has nothing left to run out
}

/**
 * Price one Lightning all-in runout. Resolves to null whenever the physical
 * engine would also have published no number (fewer than two known hands, a
 * three-card Pineapple holding before its discard, a river board) or the pool
 * could not answer.
 */
export async function priceLightningAllInEquity(
  input: LightningAllInEquityInput,
  pool: LightningEquityPricer = getEquityPool(),
  report: (err: unknown, where: string) => void = () => undefined
): Promise<PricedAllInEquity | null> {
  try {
    const street = streetOf(input.board.length);
    if (!street) return null;
    const players = input.players;
    if (players.length < 2 || players.some((p) => !Array.isArray(p.cards) || p.cards.length < 2)) {
      return null;
    }
    const omaha = isOmahaVariant(input.variant);
    // Same refusal as the physical engine: a three-card Pineapple holding has
    // no legal price until its discard.
    if (!omaha && players.some((p) => (p.cards as Card[]).length > 2)) return null;

    const pots = (input.pots ?? [])
      .filter((p) => p.amount > 0)
      .map((p) => ({
        amount: p.amount,
        eligible: p.eligiblePlayers.map((id) => players.findIndex((pl) => pl.user_id === id)),
      }));
    const fractions = await pool.estimateEquity(
      players.map((p) => [...(p.cards as Card[])]),
      [...input.board],
      [],
      1000,
      {
        exact: true,
        pots: pots.length > 0 ? pots : undefined,
        hiLo: isHiLoVariant(input.variant),
        shortDeck: isShortDeckVariant(input.variant),
        omaha,
      }
    );
    if (
      fractions.length !== players.length ||
      fractions.some((f) => typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1)
    ) {
      report(new Error('Incomplete Lightning all-in equity result'), 'LightningAllInEquity.price');
      return null;
    }
    const byUser = new Map<string, number>();
    players.forEach((p, i) => byUser.set(p.user_id, fractions[i]));
    return { byUser, street };
  } catch (err) {
    try {
      report(err, 'LightningAllInEquity.price');
    } catch {
      /* reporting must not throw */
    }
    return null;
  }
}

/** Wait for a pricing already in flight, but never longer than `ms`. */
export async function settledAllInEquity(
  pricing: Promise<PricedAllInEquity | null> | null,
  ms = 3000
): Promise<PricedAllInEquity | null> {
  if (!pricing) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pricing,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
