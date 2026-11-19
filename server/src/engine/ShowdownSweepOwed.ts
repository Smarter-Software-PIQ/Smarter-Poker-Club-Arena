/**
 * IS THERE ANYTHING ON THE FELT TO SWEEP? (hand delay, 2026-11-18)
 *
 * Dan 2026-11-17: "hand delay" is the time to finish one hand, move the button
 * and start the next hand; under a second, two seconds at most.
 *
 * The end-of-hand hold (handCompletionHoldMs) counts BETS_SWEEP_MS, the 500 ms
 * pdCollect animation that carries the last street's bets into the pot before
 * the pot ships. TablePage plays that sweep only when chips are still on the
 * felt when pot_win arrives (`betsStillOnFelt` in its pot_win handler) and
 * otherwise ships the pot at once. On a showdown whose river carried no chips
 * - an all-in run out, or a river checked through - nothing is on the felt by
 * then: the river's own collect ran when the river was dealt, and pot_win is
 * sent SHOWDOWN_READ_BASE_MS (1.4 s) after WINNERS. So the hold sat half a
 * second after the muck with no animation playing. Measured on production
 * 2026-11-18: 97% of tournament showdowns and 70% of cash showdowns.
 *
 * This answers "is the sweep owed?" and is deliberately conservative. Anything
 * it cannot prove keeps the sweep, so the hold is never shorter than the felt:
 *
 *   - a hand that did not go to showdown keeps it (a fold win always leaves the
 *     winning bet or the blinds on the felt);
 *   - a run-it-multiple hand keeps it (its reveal timeline owns the ship);
 *   - a board short of five cards keeps it;
 *   - a variant whose streets are not preflop/flop/turn/river keeps it;
 *   - any chip committed on the river (bet, call, raise, all-in, a forced
 *     post) keeps it. The uncalled-bet return is a refund, not a commitment;
 *     the bet it refunds is itself a river action and already keeps it.
 *
 * Horses are players (CLAUDE.md 10.5): nothing here reads who acted.
 */

const FLOP_GAME_STREETS = new Set(['preflop', 'flop', 'turn', 'river']);

export interface SweepActionFact {
  readonly stage?: string;
  readonly action?: string;
  readonly amount?: number;
  readonly historyEvent?: string;
}

export function showdownSweepOwed(input: {
  wentToShowdown: boolean;
  ritRuns: number;
  boardCardCount: number;
  actions: readonly SweepActionFact[];
}): boolean {
  if (!input.wentToShowdown) return true;
  if ((input.ritRuns ?? 0) >= 2) return true;
  if (!(input.boardCardCount >= 5)) return true;
  if (!Array.isArray(input.actions) || input.actions.length === 0) return true;
  for (const a of input.actions) {
    if (!a || typeof a.stage !== 'string') return true;
    // Multi-board pseudo-actions are stamped 'river' with no amount; they
    // never carry chips, so they fall through the amount test below.
    if (!FLOP_GAME_STREETS.has(a.stage)) return true;
    if (a.stage !== 'river') continue;
    if (a.historyEvent === 'uncalled_bet_returned' || a.action === 'return') continue;
    const amount = Number(a.amount ?? 0);
    if (!Number.isFinite(amount)) return true;
    if (amount > 0) return true;
  }
  return false;
}
