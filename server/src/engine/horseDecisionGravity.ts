/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HOW BIG IS THIS DECISION? (owner request 2026-11-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * People take longer when it matters and act quickly when it does not: a fold
 * of rags preflop or a check in a small pot is fast; a river call for a big
 * share of the stack, or an all-in either way, gets a long look.
 *
 * HorseLogic.computeThinkTime already weighs the spot (preflop, a free check,
 * a big river call, the brain's own difficulty hint, the per-horse tempo). This
 * module adds the one thing it did not read: the SIZE of the decision, as a
 * single 0..1 gravity plus an "easy" flag, which computeThinkTime folds into
 * its existing mode weights and shaping. It decides no durations of its own
 * and draws no randomness, so the shipped PRNG stream is unchanged, and every
 * duration it shapes still passes through the caller's action-clock cap and
 * time-bank rules (ServerTableEngineTurns: the same clock and the same bank a
 * person has, never more).
 *
 * Pure, deterministic, no I/O.
 */

export interface DecisionSpot {
  stage: string;
  action: string;
  /** Chips this seat must add to continue (0 when it may check). */
  toCall: number;
  /** The pot being contested before this action. */
  pot: number;
  /** This seat's stack behind before acting. */
  heroStack: number;
  /** The largest stack behind among the opponents still in the hand. */
  opponentStack: number;
  /** The amount of a bet or raise, when there is one. */
  amount?: number;
}

export interface DecisionGravity {
  /** 0 nothing at stake ... 1 a stack-deciding river or all-in. */
  gravity: number;
  /** A fold preflop, or a check in a small pot: the decisions people make fast. */
  easy: boolean;
}

const STREET: Readonly<Record<string, number>> = {
  preflop: 0,
  flop: 0.08,
  turn: 0.18,
  river: 0.32,
};

function finite(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function decisionGravity(spot: DecisionSpot): DecisionGravity {
  const toCall = finite(spot.toCall);
  const pot = finite(spot.pot);
  const hero = finite(spot.heroStack);
  const opp = finite(spot.opponentStack);
  const effective = opp > 0 ? Math.min(hero, opp) : hero;
  const action = String(spot.action);

  // All-in either way: calling off, being put all in, or shoving.
  const allIn =
    action === 'all_in' ||
    (toCall > 0 && hero > 0 && toCall >= hero * 0.999) ||
    (finite(spot.amount) > 0 && hero > 0 && finite(spot.amount) >= hero * 0.999);
  // Facing a big bet: nothing below a third of the pot counts; a pot-size bet is the full weight.
  const betShare =
    toCall > 0 && pot > 0 ? Math.min(1, Math.max(0, (toCall / pot - 0.33) / 0.67)) : 0;
  // A big pot: how much of what could still be won is already in the middle.
  const potCommit = pot > 0 && effective >= 0 ? pot / (pot + effective) : 0;
  // How much of the seat's own stack this call risks.
  const risk = toCall > 0 && hero > 0 ? Math.min(1, toCall / hero) : 0;
  const street = STREET[spot.stage] ?? 0;

  // Noisy-OR: any one of these makes the decision big; together they stack, capped at 1.
  const parts = [allIn ? 0.6 : 0, betShare * 0.45, potCommit * 0.4, risk * 0.35, street];
  let keep = 1;
  for (const p of parts) keep *= 1 - Math.min(0.95, p);
  const gravity = Math.round((1 - keep) * 1000) / 1000;

  const easy =
    !allIn &&
    ((spot.stage === 'preflop' && action === 'fold') ||
      (action === 'check' && toCall === 0 && potCommit < 0.2));
  return { gravity, easy };
}
