/**
 * LAW: HOLD JITTER DOES NOT STACK ONTO REST (incident 1e532243, 2026-11-21).
 *
 * Clean tournament fold hands (0% bust, 0% seat move) crossed the 250 ms
 * `ENGINE_BETWEEN_HANDS_BUDGET_MS` unintended-delay budget (+254 ms) when
 * `mainEventLoopGovernor` spiked (~191 ms p99) because:
 *   1. Any delay between `HAND_COMPLETE` (`acceptedHandEndedAt`, written to
 *      `hand_history.ended_at`) and entering `awaitHandCompletionDisplay`
 *      added directly to `next_start - ended_at`, and
 *   2. `awaitHandCompletionDisplay(resultDisplayMs)` and `armNextHandRest(restMs)`
 *      performed two consecutive uncompensated `setTimeout` sleeps, stacking
 *      hold overshoot onto rest overshoot.
 *
 * This law pins:
 *   - `awaitHandCompletionDisplay` anchors to `lastAcceptedHandEndedAtMs` so
 *     real elapsed time after `HAND_COMPLETE` is absorbed without ever
 *     shortening the visible client completion hold below `targetHoldMs`;
 *   - `armNextHandRest` absorbs hold-deadline overshoot up to
 *     `MAX_HOLD_OVERSHOOT_ABSORB_MS` while preserving at least the board-clear
 *     floor so timer jitter from the two sleeps never stacks past budget;
 *   - direct calls without `HAND_COMPLETE` and backward clock steps keep the
 *     full hold and rest untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/engineAlerts.js', () => ({
  raiseEngineAlert: vi.fn(async () => true),
  resolveEngineAlert: vi.fn(async () => true),
  firingFingerprints: vi.fn(() => []),
}));

import { ServerTableEngine } from './ServerTableEngine.js';
import { ServerTableEngineBase } from './ServerTableEngineBase.js';
import {
  ENGINE_BETWEEN_HANDS_BUDGET_MS,
  HAND_COMPLETION,
  handCompletionHoldMs,
  owedBetweenHandsMs,
} from '../config/handCompletionSpec.js';

const engines: any[] = [];

function makeEngine(): any {
  const e: any = new ServerTableEngine('hold-jitter-anchor');
  engines.push(e);
  e.running = true;
  e.handCount = 1;
  e.currentHandRitBoards = 0;
  e.currentHandBBJHit = null;
  e.completedOriginalShowdownReadMs = 0;
  return e;
}

afterEach(() => {
  for (const e of engines.splice(0)) {
    e.clearLooseHandTimers();
    e.preciseTimer.dispose();
    e.actionValidator.dispose();
    e.timeBankEngine.disposeAll();
    e.engineTelemetry.dispose();
  }
  vi.useRealTimers();
});

describe('hold jitter does not stack onto rest', () => {
  const FOLD_HOLD = handCompletionHoldMs({ wentToShowdown: false });
  const REST = HAND_COMPLETION.NEXT_HAND_REST_MS;
  const OWED = owedBetweenHandsMs({ wentToShowdown: false });

  it('absorbs entry lag after HAND_COMPLETE without shortening the visible hold', async () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const endedAt = Date.now();
    e.lastAcceptedHandEndedAtMs = endedAt;

    // 80 ms passes between HAND_COMPLETE (acceptedHandEndedAt) and entering post_hand_hold.
    await vi.advanceTimersByTimeAsync(80);

    let done = false;
    const hold = e.awaitHandCompletionDisplay(FOLD_HOLD).then(() => {
      done = true;
    });

    // Client must still get the full FOLD_HOLD from endedAt.
    await vi.advanceTimersByTimeAsync(FOLD_HOLD - 80 - 1);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await hold;
    expect(done).toBe(true);
    expect(Date.now() - endedAt).toBe(FOLD_HOLD);
    expect(e.lastAcceptedHandEndedAtMs).toBeNull();
  });

  it('absorbs hold timer overshoot into rest so stacked jitter stays within budget', async () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const endedAt = Date.now();
    e.lastAcceptedHandEndedAtMs = endedAt;

    // Synthetic entry lag (70 ms) + hold timer overshoot (190 ms) + rest timer overshoot (120 ms).
    // Uncompensated: 70 + 190 + 120 = 380 ms > 250 ms budget.
    const entryLagMs = 70;
    const holdOvershootMs = 190;
    const restOvershootMs = 120;

    e.sleep = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms + holdOvershootMs);
    };

    await vi.advanceTimersByTimeAsync(entryLagMs);
    await e.awaitHandCompletionDisplay(FOLD_HOLD);
    expect(Date.now() - endedAt).toBe(FOLD_HOLD + holdOvershootMs);

    const armedAt = Date.now();
    e.armNextHandRest(REST);

    // Rest deadline is anchored back to endedAt + FOLD_HOLD + REST, while
    // keeping a healthy visible rest window above BOARD_CLEAR_SHOWDOWN_MS.
    const effectiveRestMs = e.nextHandNotBeforeMs - armedAt;
    expect(effectiveRestMs).toBe(REST - holdOvershootMs);
    expect(effectiveRestMs).toBeGreaterThanOrEqual(HAND_COMPLETION.BOARD_CLEAR_SHOWDOWN_MS);
    expect(e.nextHandNotBeforeMs - endedAt).toBe(OWED);

    // Simulate rest timer firing 120 ms late: total unintended delay is only 120 ms <= 250 ms.
    const nextStartAt = e.nextHandNotBeforeMs + restOvershootMs;
    const unintendedDelayMs = nextStartAt - endedAt - OWED;
    expect(unintendedDelayMs).toBe(restOvershootMs);
    expect(unintendedDelayMs).toBeLessThanOrEqual(ENGINE_BETWEEN_HANDS_BUDGET_MS);
  });

  it('caps overshoot absorption so board-clear and Rabbit Hunt visibility stay intact', async () => {
    vi.useFakeTimers();
    const e = makeEngine();
    const endedAt = Date.now();
    e.lastAcceptedHandEndedAtMs = endedAt;

    // Extreme 900 ms event-loop stall during post_hand_hold.
    e.sleep = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms + 900);
    };

    await e.awaitHandCompletionDisplay(FOLD_HOLD);
    const armedAt = Date.now();
    e.armNextHandRest(REST);

    const effectiveRestMs = e.nextHandNotBeforeMs - armedAt;
    expect(effectiveRestMs).toBe(REST - ServerTableEngineBase.MAX_HOLD_OVERSHOOT_ABSORB_MS);
    expect(effectiveRestMs).toBeGreaterThanOrEqual(HAND_COMPLETION.BOARD_CLEAR_SHOWDOWN_MS);
  });

  it('preserves full hold and rest on direct calls and backward clock steps', async () => {
    vi.useFakeTimers();
    const e = makeEngine();

    // Direct armNextHandRest without prior hold: full REST.
    const t0 = Date.now();
    e.armNextHandRest(REST);
    expect(e.nextHandNotBeforeMs - t0).toBe(REST);

    // Backward clock step (lastAcceptedHandEndedAtMs in the future): full FOLD_HOLD.
    const t1 = Date.now();
    e.lastAcceptedHandEndedAtMs = t1 + 500;
    const hold = e.awaitHandCompletionDisplay(FOLD_HOLD);
    await vi.advanceTimersByTimeAsync(FOLD_HOLD);
    await hold;
    expect(Date.now() - t1).toBe(FOLD_HOLD);
  });

  it('stamps acceptedHandEndedAt in settlement and resets per-hand anchor state in dealHand', () => {
    const settlement = readFileSync(
      fileURLToPath(new URL('./ServerTableEngineSettlement.ts', import.meta.url)),
      'utf8'
    );
    const dealing = readFileSync(
      fileURLToPath(new URL('./ServerTableEngineDealing.ts', import.meta.url)),
      'utf8'
    );
    expect(settlement).toContain('this.lastAcceptedHandEndedAtMs = acceptedHandEndedAt;');
    expect(dealing).toContain('this.lastAcceptedHandEndedAtMs = null;');
    expect(dealing).toContain('this.lastHoldDeadlineMs = null;');
  });
});
