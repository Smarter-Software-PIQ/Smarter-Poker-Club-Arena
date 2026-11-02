import type { ActionResult } from '../services/GameServerAPI';

/** Presentation and submission share the same capability readiness gate.
 * A withheld token is never replaced by a previous decision's token.
 */
export function tableDecisionIsReady(input: {
  actionContext: string | undefined;
  allowContextless: boolean;
  clientStateStale?: boolean;
}): boolean {
  return !input.clientStateStale && (input.allowContextless || Boolean(input.actionContext));
}

/** An absent token means input is not ready, never that a context-free tap is safe.
 * Refresh once and return the choice to the player. Never rebind or replay an
 * old choice against a different decision, even when it was only a fold.
 */
export async function submitTableDecision(input: {
  actionContext: string | undefined;
  allowContextless: boolean;
  clientStateStale?: boolean;
  send: (context: string | undefined) => Promise<ActionResult>;
  refresh: () => Promise<boolean>;
}): Promise<ActionResult & { outcomeUnconfirmed?: true }> {
  if (!tableDecisionIsReady(input)) {
    await input.refresh();
    return {
      success: false,
      code: 'CLIENT_DECISION_REFRESHED',
      error: 'Your Action Was Not Sent. Please Review The Table And Try Again.',
    };
  }
  const result = await input.send(input.actionContext);
  if (
    result.code === 'ACTION_CONTEXT_REQUIRED' ||
    result.code === 'STALE_ACTION' ||
    result.code === 'ACTION_NOT_DELIVERED' ||
    result.code === 'ACTION_STATE_PENDING' ||
    result.code === 'ACTION_NOT_ACCEPTED'
  ) {
    const observed = await input.refresh();
    if (
      observed !== true &&
      (result.code === 'ACTION_NOT_DELIVERED' || result.code === 'ACTION_STATE_PENDING')
    ) {
      return { ...result, outcomeUnconfirmed: true };
    }
  }
  if (result.code === 'ACTION_CONTEXT_REQUIRED') {
    return {
      ...result,
      error: 'Your Action Was Not Sent. Please Review The Table And Try Again.',
    };
  }
  return result;
}

export interface SnapshotActionContextCarryInput {
  incomingActionContext: string | undefined;
  previousActionContext: string | undefined;
  answeredDecision: string | null | undefined;
  sameHand: boolean;
  nextCurrentSeat: number;
  previousCurrentSeat: number;
  nextStage: string;
  previousStage: string;
  nextCurrentBet: number | undefined;
  previousCurrentBet: number | undefined;
  nextMinRaise: number | undefined;
  previousMinRaise: number | undefined;
  nextLastRaise: number | undefined;
  previousLastRaise: number | undefined;
  nextWagersCapped: boolean | undefined;
  previousWagersCapped: boolean | undefined;
  nextBettingStructure: string | undefined;
  previousBettingStructure: string | undefined;
  nextFixedBetSize: number | undefined;
  previousFixedBetSize: number | undefined;
  nextFixedRaiseSize: number | undefined;
  previousFixedRaiseSize: number | undefined;
  nextPotLimitPot: number | undefined;
  previousPotLimitPot: number | undefined;
  nextActorBet: number | undefined;
  previousActorBet: number | undefined;
  nextActorStatus: string | undefined;
  previousActorStatus: string | undefined;
  isTimeBankActive: boolean;
  nextTurnStartTimeMs: number | undefined;
  previousTurnStartTimeMs: number | undefined;
}

/**
 * Preserve an already-retained `actionContext` across a mid-turn `time_bank_active`
 * snapshot whose `action_context` was temporarily scrubbed by the hub's
 * retention boundary (`TIME_BANK_ACTIVATED`).
 *
 * When `isTimeBankActive` is false, an incoming snapshot with `action_context: null`
 * is authoritative that the input token is withheld (e.g. a retention boundary),
 * so `resolveSnapshotActionContext` returns `undefined`.
 *
 * Even when `isTimeBankActive` is true, never carries a token across hand,
 * street, seat, turn-clock (`turn_start_time_ms` is preserved by the engine on
 * `TIME_BANK_ACTIVATED`), answered-fence, or legal-action bound (`currentBet`,
 * `minRaise`, `lastRaise`, `wagersCapped`, `bettingStructure`, `fixedBetSize`,
 * `fixedRaiseSize`, `potLimitPot`, or the acting seat's bet/status) changes.
 */
export function resolveSnapshotActionContext(
  input: SnapshotActionContextCarryInput
): string | undefined {
  if (typeof input.incomingActionContext === 'string' && input.incomingActionContext.length > 0) {
    return input.incomingActionContext;
  }
  if (!input.isTimeBankActive) return undefined;
  if (!input.sameHand) return undefined;
  if (typeof input.previousActionContext !== 'string' || input.previousActionContext.length === 0) {
    return undefined;
  }
  if (input.answeredDecision && input.answeredDecision === input.previousActionContext) {
    return undefined;
  }
  if (input.nextCurrentSeat <= 0 || input.previousCurrentSeat !== input.nextCurrentSeat) {
    return undefined;
  }
  if (input.previousStage !== input.nextStage) return undefined;
  if (
    input.nextActorStatus === 'folded' ||
    input.nextActorStatus === 'all_in' ||
    input.previousActorStatus !== input.nextActorStatus
  ) {
    return undefined;
  }
  if ((input.previousCurrentBet ?? 0) !== (input.nextCurrentBet ?? 0)) return undefined;
  if ((input.previousMinRaise ?? 0) !== (input.nextMinRaise ?? 0)) return undefined;
  if ((input.previousLastRaise ?? 0) !== (input.nextLastRaise ?? 0)) return undefined;
  if (Boolean(input.previousWagersCapped) !== Boolean(input.nextWagersCapped)) return undefined;
  if ((input.previousBettingStructure ?? '') !== (input.nextBettingStructure ?? '')) {
    return undefined;
  }
  if ((input.previousFixedBetSize ?? 0) !== (input.nextFixedBetSize ?? 0)) return undefined;
  if ((input.previousFixedRaiseSize ?? 0) !== (input.nextFixedRaiseSize ?? 0)) return undefined;
  if ((input.previousPotLimitPot ?? 0) !== (input.nextPotLimitPot ?? 0)) return undefined;
  if ((input.previousActorBet ?? 0) !== (input.nextActorBet ?? 0)) return undefined;
  const samePositiveTurnClock =
    typeof input.nextTurnStartTimeMs === 'number' &&
    Number.isFinite(input.nextTurnStartTimeMs) &&
    input.nextTurnStartTimeMs > 0 &&
    input.nextTurnStartTimeMs === input.previousTurnStartTimeMs;
  if (!samePositiveTurnClock) {
    return undefined;
  }
  return input.previousActionContext;
}

export interface TurnChangeActionContextCarryInput {
  incomingActionContext: string | undefined;
  previousActionContext: string | undefined;
  answeredDecision: string | null | undefined;
  isHandInProgress: boolean;
  newSeat: number;
  previousCurrentSeat: number;
  eventHandNumber?: number;
  previousHandNumber?: number;
  eventTimestampMs?: number;
  previousTurnStartTimeMs?: number;
}

/**
 * Resolve `actionContext` on a discrete `TURN_CHANGE` event.
 *
 * When `TURN_CHANGE` omits `action_context` (or has an empty string), preserve
 * `previousActionContext` ONLY if it is the exact same active turn on the same
 * hand and seat, with a matching turn start timestamp, and the token was not
 * already answered.
 */
export function resolveTurnChangeActionContext(
  input: TurnChangeActionContextCarryInput
): string | undefined {
  if (typeof input.incomingActionContext === 'string' && input.incomingActionContext.length > 0) {
    return input.incomingActionContext;
  }
  if (!input.isHandInProgress) return undefined;
  if (typeof input.previousActionContext !== 'string' || input.previousActionContext.length === 0) {
    return undefined;
  }
  if (input.answeredDecision && input.answeredDecision === input.previousActionContext) {
    return undefined;
  }
  if (input.newSeat <= 0 || input.previousCurrentSeat !== input.newSeat) {
    return undefined;
  }
  if (
    typeof input.eventHandNumber === 'number' &&
    input.eventHandNumber > 0 &&
    typeof input.previousHandNumber === 'number' &&
    input.previousHandNumber > 0 &&
    input.eventHandNumber !== input.previousHandNumber
  ) {
    return undefined;
  }
  if (
    typeof input.eventTimestampMs === 'number' &&
    Number.isFinite(input.eventTimestampMs) &&
    input.eventTimestampMs > 0 &&
    typeof input.previousTurnStartTimeMs === 'number' &&
    Number.isFinite(input.previousTurnStartTimeMs) &&
    input.previousTurnStartTimeMs > 0 &&
    Math.abs(input.eventTimestampMs - input.previousTurnStartTimeMs) > 50
  ) {
    return undefined;
  }
  return input.previousActionContext;
}

export interface MissingDecisionPollerDeps {
  requestSnapshot: () => void;
  fetchTableState?: () => Promise<Record<string, unknown> | null>;
  onTableState?: (state: Record<string, unknown>) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  setIntervalTimer?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalTimer?: (id: ReturnType<typeof setInterval>) => void;
  initialDelayMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Bounded, non-overlapping 350ms recovery poller for a hero turn whose
 * `actionContext` is still withheld on the client.
 *
 * - Recovers across >6 attempts (default `maxAttempts = 24`, ~8.4s window).
 * - Never overlaps in-flight `fetchTableState` HTTP requests.
 * - Backs off HTTP calls exponentially on consecutive null/error responses so
 *   an unreachable or refusing endpoint never causes excessive load.
 * - Stops immediately when `stop()` is called (turn ends, decision arrives,
 *   table changes, or component unmounts) or when `maxAttempts` is reached.
 */
export function startMissingDecisionPoller(deps: MissingDecisionPollerDeps): () => void {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));
  const setIntervalTimer = deps.setIntervalTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalTimer = deps.clearIntervalTimer ?? ((id) => clearInterval(id));
  const initialDelayMs = deps.initialDelayMs ?? 350;
  const intervalMs = deps.intervalMs ?? 350;
  const maxAttempts = deps.maxAttempts ?? 24;

  let cancelled = false;
  let httpInFlight = false;
  let attempts = 0;
  let consecutiveHttpFailures = 0;
  let httpCooldownTicks = 0;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let retryInterval: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    cancelled = true;
    if (initialTimer !== null) {
      clearTimer(initialTimer);
      initialTimer = null;
    }
    if (retryInterval !== null) {
      clearIntervalTimer(retryInterval);
      retryInterval = null;
    }
  };

  const tick = () => {
    if (cancelled) return;
    if (attempts >= maxAttempts) {
      stop();
      return;
    }
    attempts += 1;
    deps.requestSnapshot();
    if (!deps.fetchTableState || httpInFlight) return;
    if (httpCooldownTicks > 0) {
      httpCooldownTicks -= 1;
      return;
    }
    httpInFlight = true;
    void Promise.resolve()
      .then(() => deps.fetchTableState!())
      .catch(() => null)
      .then((live) => {
        if (cancelled) return;
        if (live && typeof live === 'object') {
          consecutiveHttpFailures = 0;
          httpCooldownTicks = 0;
          deps.onTableState?.(live);
        } else {
          consecutiveHttpFailures += 1;
          httpCooldownTicks = Math.min(8, Math.pow(2, consecutiveHttpFailures - 1));
        }
      })
      .finally(() => {
        httpInFlight = false;
      });
  };

  if (initialDelayMs !== intervalMs) {
    initialTimer = setTimer(tick, initialDelayMs);
  }
  retryInterval = setIntervalTimer(tick, intervalMs);
  return stop;
}
