/**
 * A LIGHTNING WORKER FAILURE SAYS WHY (TASK #8, 2026-11-20).
 *
 * Seven PLO4/PLO5 Lightning turn folds (hands 59815321 ... 60117459, Nov 16-19) were the liveness answer of a
 * failed decision job. Their cause is in no database row: the Lightning path counted a Prometheus metric and
 * the legalizer reason `lightning_timeout`, and the error went only to the engine host log. Replayed through the brain of the
 * builds that dealt them (28372c9a17, f3e99378cc) and today's, every one of the seven nodes decides without a
 * throw (a fold), so the failure was the job, not the strategy. The reason and the street are now horse
 * telemetry counters (horse_brain_telemetry) and the answer carries the reason.
 *
 * These hands run through the real host and HandController with a scripted lane that fails only on the turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FastHorseDecisionResult,
  LiveHorseDecisionLane,
  LiveHorseDecisionSnapshot,
} from '../engine/horseDecision/index.js';
import type { HorseDecision } from '../types.js';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning host fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning host fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const kit = await import('../testing/lightningHostTestKit.js');
const {
  resetBrainWatchcountersForTest,
  enableBrainTelemetry,
  disarmBrainTelemetryForTest,
  drainFires,
} = await import('../engine/BrainTelemetry.js');
const { markHorseDecisionRejection } = await import('../engine/horseDecision/fallbackReason.js');
const { buildHost, formedHand, flush } = kit;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetBrainWatchcountersForTest({ armRelay: false });
  enableBrainTelemetry();
  drainFires();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  disarmBrainTelemetryForTest();
  errorSpy.mockRestore();
});

const gs = (snap: LiveHorseDecisionSnapshot) =>
  snap.gameState as unknown as { stage: string; toCall: number };
const isEarlyLook = (snap: LiveHorseDecisionSnapshot) => snap.fence.endsWith(':early');

function laneFailingOnTurn(makeError: () => unknown) {
  const calls: LiveHorseDecisionSnapshot[] = [];
  const lane = {
    decideFast: vi.fn(async (snap: LiveHorseDecisionSnapshot) => {
      calls.push(snap);
      if (!isEarlyLook(snap) && gs(snap).stage === 'turn') throw makeError();
      const answer =
        gs(snap).toCall > 0 ? { action: 'call', amount: gs(snap).toCall } : { action: 'check' };
      return {
        type: 'FAST_RESULT',
        requestId: calls.length,
        generation: snap.generation,
        fence: snap.fence,
        decision: { ...answer, thinkTime: 300 } as unknown as HorseDecision,
        planBinding: null,
        planIssueDisposition: 'no_effects',
        effects: [],
        rngBefore: 0,
        rngAfter: 0,
        computeMs: 1,
        governorScale: 1,
      } as unknown as FastHorseDecisionResult;
    }),
    commitDecisionEffects: vi.fn(async () => ({ type: 'ACK' }) as never),
    runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
    observeCompletedHand: vi.fn(async () => ({ type: 'ACK' }) as never),
  };
  return { lane: lane as unknown as LiveHorseDecisionLane, calls };
}

async function playHand(base: number, makeError: () => unknown) {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const formed = formedHand(2, base);
  const scripted = laneFailingOnTurn(makeError);
  const t = buildHost(formed, [100, 100], {
    horses: new Set(formed.players),
    deps: { horseLane: () => scripted.lane, random: () => 0.5 },
  });
  await t.host.start();
  for (let i = 0; i < 1_800 && t.host.lifecycle === 'dealing'; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    await flush(4);
  }
  expect(t.host.lifecycle).toBe('complete');
  const actions = (
    (t.host as unknown as { actions: Array<Record<string, unknown>> }).actions ?? []
  ).filter((a) => a.origin === 'horse_policy' || a.origin === 'horse_fallback');
  const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  return { actions, fires, calls: scripted.calls };
}

describe('a Lightning worker failure records why and where', () => {
  it('names a stamped reason and the street, and only the failed turn falls back', async () => {
    const hand = await playHand(8100, () =>
      markHorseDecisionRejection(new Error('deadline passed'), 'expired')
    );
    const turnFallbacks = hand.actions.filter((a) => a.origin === 'horse_fallback');
    expect(turnFallbacks.length).toBeGreaterThan(0);
    expect(turnFallbacks.every((a) => a.stage === 'turn')).toBe(true);
    expect(hand.fires['lightning_horse_fallback_expired_seen']).toBe(turnFallbacks.length);
    expect(hand.fires['lightning_horse_fallback_street_turn_seen']).toBe(turnFallbacks.length);
    expect(hand.fires['lightning_horse_fallback_street_flop_seen']).toBeUndefined();
    expect(hand.fires['lightning_horse_fallback_unknown_seen']).toBeUndefined();
  });

  it('an unstamped error is counted as unknown, never dropped', async () => {
    const hand = await playHand(8200, () => new Error('worker down'));
    const n = hand.actions.filter((a) => a.origin === 'horse_fallback').length;
    expect(n).toBeGreaterThan(0);
    expect(hand.fires['lightning_horse_fallback_unknown_seen']).toBe(n);
    expect(hand.fires['lightning_horse_fallback_street_turn_seen']).toBe(n);
  });
});
