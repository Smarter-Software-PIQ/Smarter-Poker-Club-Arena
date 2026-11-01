/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REALTIME DEGRADATION POLICY — one rule for every MasterBus channel hook
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 2026-10-31, production evidence (client_error_events, 24h): ONE tab on the
 * Member Management page raised 15,302 "The Live Member Connection Could Not
 * Be Established." toasts in six hours. Each channel failure status
 * (CHANNEL_ERROR / TIMED_OUT / CLOSED), every private-record rebind and every
 * recovery attempt called the page's `onSubscriptionError`, and the page
 * toasted every time. A channel that stays down is ONE degraded episode, not
 * one popup per retry.
 *
 * The policy, applied inside useMasterBusChannel and
 * useMasterBusBroadcastChannel so no page has to remember it:
 *
 *   1. EPISODES. A channel is degraded from its first failure status until it
 *      reports SUBSCRIBED again. `onSubscriptionError` runs once per episode
 *      per mounted hook; a `degradedToast` is shown once per episode per
 *      CHANNEL NAME, across remounts (module-level registry below).
 *
 *   2. BACKOFF. Automatic resubscribes (the MasterBus health-monitor factory,
 *      auth/online retries) are spaced by exponential backoff with jitter,
 *      capped at 30 s. The first retry after the first failure stays
 *      immediate, so a single blip recovers as fast as before; SUBSCRIBED
 *      resets the count.
 *
 * Pages surface degradation with the hooks' `degradedToast` option, never by
 * calling toast from `onSubscriptionError` (tests/unit/realtimeDegradationPolicy.test.ts
 * pins that no page does).
 */

import { masterBus } from '../core/MasterBus';

export const RESUBSCRIBE_BACKOFF = {
  baseMs: 1_000,
  capMs: 30_000,
} as const;

/**
 * Delay before the next automatic resubscribe, given how many consecutive
 * attempts have failed. 0 or 1 failures: immediate. Then 1 s, 2 s, 4 s ...
 * capped at 30 s, with "equal jitter" (half fixed, half random) so a fleet of
 * tabs that lost the same socket does not reconnect in lockstep.
 */
export function resubscribeDelayMs(failures: number, random: () => number = Math.random): number {
  if (!Number.isFinite(failures) || failures <= 1) return 0;
  const exponent = Math.min(failures - 2, 30);
  const ceiling = Math.min(RESUBSCRIBE_BACKOFF.capMs, RESUBSCRIBE_BACKOFF.baseMs * 2 ** exponent);
  let r = 0;
  try {
    r = random();
  } catch {
    r = 0;
  }
  if (!Number.isFinite(r) || r < 0) r = 0;
  if (r > 1) r = 1;
  return Math.round(ceiling / 2 + (ceiling / 2) * r);
}

export interface ResubscribeScheduler {
  /** Record that attempt `attempt` failed. Idempotent per attempt id. */
  noteFailure(attempt: number): void;
  /** SUBSCRIBED: the episode is over, the next failure starts from zero. */
  noteSubscribed(): void;
  /** Run `fn` now or after the backoff delay; a pending run absorbs later requests. */
  run(fn: () => void): void;
  /** Drop any pending run (effect cleanup). */
  cancel(): void;
  /** Consecutive failed attempts in the current episode. */
  failures(): number;
}

export interface ResubscribeSchedulerDeps {
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createResubscribeScheduler(
  deps: ResubscribeSchedulerDeps = {}
): ResubscribeScheduler {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let failed = 0;
  let lastFailedAttempt: number | null = null;
  let pending: unknown = null;

  return {
    noteFailure(attempt) {
      if (lastFailedAttempt === attempt) return;
      lastFailedAttempt = attempt;
      failed++;
    },
    noteSubscribed() {
      failed = 0;
      lastFailedAttempt = null;
    },
    run(fn) {
      if (pending !== null) return;
      const delay = resubscribeDelayMs(failed, deps.random);
      if (delay <= 0) {
        fn();
        return;
      }
      pending = setTimer(() => {
        pending = null;
        fn();
      }, delay);
    },
    cancel() {
      if (pending !== null) clearTimer(pending);
      pending = null;
    },
    failures: () => failed,
  };
}

/** Once-per-episode gate for one mounted hook's `onSubscriptionError`. */
export interface DegradationGate {
  /** True exactly once per episode: the first failure since the last SUBSCRIBED. */
  shouldNotify(): boolean;
  recovered(): void;
  isDegraded(): boolean;
}

export function createDegradationGate(): DegradationGate {
  let degraded = false;
  return {
    shouldNotify() {
      if (degraded) return false;
      degraded = true;
      return true;
    },
    recovered() {
      degraded = false;
    },
    isDegraded: () => degraded,
  };
}

/** Channel names whose degraded toast has already been shown this episode. */
const toastedChannels = new Set<string>();

/**
 * Claim the one degraded-connection toast for `channelName` in its current
 * episode. True only for the first caller; false until the channel recovers.
 */
export function claimDegradedToast(channelName: string): boolean {
  if (toastedChannels.has(channelName)) return false;
  toastedChannels.add(channelName);
  return true;
}

/** SUBSCRIBED on `channelName`: its next failure is a new episode. */
export function noteChannelRecovered(channelName: string): void {
  toastedChannels.delete(channelName);
}

/**
 * Show the degraded-connection toast through the one Toast layer, via the
 * bus (BusToastBridge, mounted in App, maps 'critical' to an error toast).
 * The hooks do not import the Toast module: they run in many tests and
 * surfaces outside a ToastProvider.
 */
export function showDegradedToast(message: string, channelName: string): void {
  masterBus.emit('SHOW_TOAST', {
    severity: 'critical',
    message,
    source: `realtimeDegradation:${channelName}`,
  });
}

/** Test-only reset of the module registry. */
export function __resetRealtimeDegradationPolicyForTests(): void {
  toastedChannels.clear();
}
