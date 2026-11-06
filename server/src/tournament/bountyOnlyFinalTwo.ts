/**
 * A BOUNTY ONLY PKO ENDS WITH TWO PLAYERS (owner rule, Dan 2026-11-05).
 *
 * "The top two guys that are left should keep the bounties on both of their
 * heads. Tournament is over with 2 players left."
 *
 * A bounty only PKO (free entry, no guarantee, zero place pool, PKO heads)
 * pays nothing for finishing position. Played to heads up, the last knockout
 * moved half of the loser's head into the winner's wallet and half onto the
 * winner's head, which the terminal then paid him as the champion's own head:
 * one player took both final heads. Now, once the bust that leaves two players
 * has settled, the manager parks every table after its hand and asks
 * fn_ca_bounty_only_pko_final_two to close the field at two. That authority
 * orders the pair from the locked roster (more chips first, then the larger
 * head, then earlier registration, then user id), pays the second player his
 * own head and records second place. The ordinary finish then pays the first
 * player his own head through the unchanged terminal authority.
 *
 * This module is the manager's decision with its inputs passed in, so the
 * maintained code is what the tests run (BountyOnlyFinalTwo.test.ts).
 */

/** A free, unguaranteed, non-mystery PKO whose place pool is zero pays only knockouts. */
export function isBountyOnlyPkoRow(t: unknown): boolean {
  const row = t as Record<string, unknown> | null | undefined;
  if (!row || row.is_pko !== true || row.is_mystery_bounty === true) return false;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return n(row.buy_in_amount) <= 0 && n(row.guaranteed_prize) <= 0 && n(row.prize_pool) <= 0;
}

/** How long the first final-two park (before the claim) may hold a table before the engine's safety net lifts it. */
export const BOUNTY_ONLY_FINAL_TWO_PARK_MS = 60_000;
/** How soon the manager looks again while the tables finish their hands. */
export const BOUNTY_ONLY_FINAL_TWO_RECHECK_MS = 1_000;
/** How soon the manager asks again after "not yet" or an unreachable authority. */
export const BOUNTY_ONLY_FINAL_TWO_RETRY_MS = BOUNTY_ONLY_FINAL_TWO_RECHECK_MS * 5;
/**
 * A TOURNAMENT MUST NEVER FREEZE (owner rule). While the authority decides,
 * the tables are parked untilResumed, which the engine's safety timer will
 * not lift (ServerTableEngineBase refuses to self-resume such a park). So the
 * retries are bounded: after this many asks, or this long since the first
 * one, a "not yet" or an unreachable authority is treated as a rule refusal
 * and the final two play on heads up.
 */
export const BOUNTY_ONLY_FINAL_TWO_MAX_RETRIES = 12;
export const BOUNTY_ONLY_FINAL_TWO_MAX_RETRY_MS = 60_000;

/** Refusals that mean "not yet": the field is still settling. */
export const BOUNTY_ONLY_FINAL_TWO_TRANSIENT: ReadonlySet<string> = new Set([
  'busts_not_settled',
  'field_is_not_two',
  'a_live_stack_is_empty',
]);

export interface FinalTwoTable {
  pauseAfterHand(maxWaitMs?: number, opts?: { untilResumed?: boolean }): void;
  isParkedBetweenHands(): boolean;
}

export interface FinalTwoState {
  /** Set once the manager asked the tables to park for the close. */
  parked: boolean;
  /** Set once the authority refused for a reason waiting cannot change. */
  refused: boolean;
  /** How many times the authority answered "not yet" or could not be reached. */
  retryCount?: number;
  /** When the first of those answers came, in ms (deps.now). */
  firstRetryAt?: number | null;
}

export interface FinalTwoDeps {
  tournamentId: string;
  tables: readonly FinalTwoTable[];
  state: FinalTwoState;
  rpc: (
    fn: 'fn_ca_bounty_only_pko_final_two',
    args: { p_tournament_id: string }
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  recheckAfter: (delayMs: number) => void;
  /** Lift this close's park, leaving any other owner's pause (a break) in place. */
  release: () => void;
  report: (error: Error, tag: string) => void;
  /** Wall clock in ms; defaults to Date.now. */
  now?: () => number;
  /**
   * Record the refusal where the database watch can read it
   * (ca_bounty_only_final_two_refusals), so a refused close is not alerted as
   * a missed one. Best effort: a failed write is reported, never thrown.
   */
  recordRefusal?: (reason: string) => PromiseLike<unknown> | void;
}

export type FinalTwoOutcome = 'closed' | 'waiting' | 'retry' | 'refused';

/**
 * Close a bounty only PKO at two. 'closed' means second place is recorded and
 * paid, and the caller finishes the event with the one player left. 'waiting'
 * and 'retry' mean look again shortly; 'retry' is bounded by
 * BOUNTY_ONLY_FINAL_TWO_MAX_RETRIES and BOUNTY_ONLY_FINAL_TWO_MAX_RETRY_MS.
 * 'refused' means the event plays on heads up, as it did before this rule,
 * and the refusal was reported once.
 */
export async function closeBountyOnlyPkoAtTwo(deps: FinalTwoDeps): Promise<FinalTwoOutcome> {
  const { state, tables } = deps;
  if (state.refused) return 'refused';
  // Every look re-asks any table still dealing: a park the engine's safety
  // timer lifted while the authority said "not yet" is taken again here.
  state.parked = true;
  for (const table of tables) {
    if (!table.isParkedBetweenHands()) table.pauseAfterHand(BOUNTY_ONLY_FINAL_TWO_PARK_MS);
  }
  if (!tables.every((table) => table.isParkedBetweenHands())) {
    deps.recheckAfter(BOUNTY_ONLY_FINAL_TWO_RECHECK_MS);
    return 'waiting';
  }

  // From here the park is a claim: the engine's safety timer may not lift it
  // while the authority decides, because a hand dealt after the close would
  // seat a player who has already finished second. Only release() (a rule
  // refusal, or retries that outlasted their budget below) or the finish that
  // closes the tables ends it.
  for (const table of tables)
    table.pauseAfterHand(BOUNTY_ONLY_FINAL_TWO_PARK_MS, { untilResumed: true });

  let data: unknown = null;
  let error: { message?: string } | null = null;
  try {
    ({ data, error } = await deps.rpc('fn_ca_bounty_only_pko_final_two', {
      p_tournament_id: deps.tournamentId,
    }));
  } catch (thrown) {
    error = { message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
  const answer = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string }
    | null
    | undefined;
  if (!error && answer?.ok === true) return 'closed';

  let reason = String(answer?.reason);
  if (error || BOUNTY_ONLY_FINAL_TWO_TRANSIENT.has(reason)) {
    // Keep the tables parked: the next look usually sees the settled field.
    // Nothing else lifts this park (the engine's safety timer refuses an
    // untilResumed park), so the retries are bounded here: a "not yet" that
    // outlasts the budget is a refusal and the final two play on heads up.
    const now = (deps.now ?? Date.now)();
    state.retryCount = (state.retryCount ?? 0) + 1;
    if (state.firstRetryAt == null) state.firstRetryAt = now;
    const exhausted =
      state.retryCount >= BOUNTY_ONLY_FINAL_TWO_MAX_RETRIES ||
      now - state.firstRetryAt >= BOUNTY_ONLY_FINAL_TWO_MAX_RETRY_MS;
    if (!exhausted) {
      deps.recheckAfter(BOUNTY_ONLY_FINAL_TWO_RETRY_MS);
      return 'retry';
    }
    reason = `${error ? `authority_unreachable: ${error.message ?? 'unknown'}` : reason}; gave up after ${state.retryCount} tries in ${Math.round((now - state.firstRetryAt) / 1000)}s`;
  }

  // A rule refusal (not this format, not running, heads that do not match the
  // open pool), or a "not yet" that outlasted the retry budget, does not hold
  // the table. The event plays on heads up and says why once.
  state.refused = true;
  state.parked = false;
  deps.release();
  try {
    void Promise.resolve(deps.recordRefusal?.(reason)).catch((err: unknown) =>
      deps.report(
        err instanceof Error ? err : new Error(String(err)),
        'Tournament.bounty_only_final_two_refusal_record_failed'
      )
    );
  } catch (err) {
    deps.report(
      err instanceof Error ? err : new Error(String(err)),
      'Tournament.bounty_only_final_two_refusal_record_failed'
    );
  }
  deps.report(
    new Error(
      `[Tournament:${deps.tournamentId.slice(0, 8)}] bounty only PKO could not close at two players (${reason}); the event plays on heads up`
    ),
    'Tournament.bounty_only_final_two_refused'
  );
  return 'refused';
}
