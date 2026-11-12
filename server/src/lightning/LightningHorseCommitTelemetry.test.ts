/**
 * THE LIGHTNING COMMIT DENOMINATOR (2026-11-12).
 *
 * A Lightning turn counted `decision_started` and nothing else: the table
 * engine counts `commit_evaluated` where a horse's answer reaches its commit
 * stage (ServerTableEngineTurns), and the Lightning host, which commits
 * through its own two doors, counted nothing there. On the serving engine
 * the cash series read 37,449 started against 9,652 committed for Hold'em
 * and 28,269 against 10,423 for PLO4 while every table-only series agreed to
 * a fraction of a percent, with zero fallbacks and zero abandoned turns: the
 * difference was the two Lightning pools, uncounted.
 *
 * These hands run through the real host and the real HandController. The
 * lane is a scripted stand-in, so the test decides what every horse answers
 * and can tell a turn's answer from an early look's by its fence.
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
const { peekBrainWatchcounters, resetBrainWatchcountersForTest } =
  await import('../engine/BrainTelemetry.js');
const { noteLightningHorseCommitEvaluated } = await import('./LightningHorse.js');
const { buildHost, formedHand, flush } = kit;

beforeEach(() => {
  resetBrainWatchcountersForTest({ armRelay: false });
});
afterEach(() => {
  vi.useRealTimers();
});

type Answer = { action: string; amount?: number };
type Decide = (snap: LiveHorseDecisionSnapshot) => Answer;

const gs = (snap: LiveHorseDecisionSnapshot) =>
  snap.gameState as unknown as { stage: string; toCall: number };
const passive: Decide = (snap) =>
  gs(snap).toCall > 0 ? { action: 'call', amount: gs(snap).toCall } : { action: 'check' };
const foldWhenOwing: Decide = (snap) =>
  gs(snap).toCall > 0 ? { action: 'fold' } : { action: 'check' };
const isEarlyLook = (snap: LiveHorseDecisionSnapshot) => snap.fence.endsWith(':early');

function scriptedLane(decide: Decide, opts: { failOnTurn?: boolean } = {}) {
  const calls: LiveHorseDecisionSnapshot[] = [];
  const lane = {
    decideFast: vi.fn(async (snap: LiveHorseDecisionSnapshot) => {
      calls.push(snap);
      if (opts.failOnTurn && !isEarlyLook(snap)) throw new Error('worker down');
      const answer = decide(snap);
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
  return { lane: lane as unknown as LiveHorseDecisionLane, calls, raw: lane };
}

function opportunity(reason: string): number {
  return peekBrainWatchcounters()
    .poker_horse_telemetry_opportunities_total.series.filter(
      (s) => s.variant === 'nlh' && s.mode === 'cash' && s.reason === reason
    )
    .reduce((sum, s) => sum + s.value, 0);
}

async function playHand(
  seats: number,
  base: number,
  decide: Decide,
  opts: { failOnTurn?: boolean; refuseFastFoldDoor?: boolean } = {}
) {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const formed = formedHand(seats, base);
  const scripted = scriptedLane(decide, opts);
  const t = buildHost(
    formed,
    Array.from({ length: seats }, () => 100),
    { horses: new Set(formed.players), deps: { horseLane: () => scripted.lane } }
  );
  let fastFoldDoorOffers = 0;
  if (opts.refuseFastFoldDoor) {
    // The Lightning Fold door refuses every horse: an answer already folding
    // is offered to that door first and then goes on to the ordinary path.
    const host = t.host as unknown as {
      handlePlayerAction: (userId: string, action: string, ...rest: unknown[]) => unknown;
    };
    const real = host.handlePlayerAction.bind(host);
    host.handlePlayerAction = (userId, action, ...rest) => {
      if (action === 'fast_fold') {
        fastFoldDoorOffers += 1;
        return { success: false, error: 'fixture: door refused' };
      }
      return real(userId, action, ...rest);
    };
  }
  await t.host.start();
  for (let i = 0; i < 1_800 && t.host.lifecycle === 'dealing'; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    await flush(4);
  }
  expect(t.host.lifecycle).toBe('complete');
  const actions = (
    (t.host as unknown as { actions: Array<Record<string, unknown>> }).actions ?? []
  ).filter((a) => a.origin === 'horse_policy' || a.origin === 'horse_fallback');
  const onTurn = scripted.calls.filter((snap) => !isEarlyLook(snap));
  const early = scripted.calls.filter(isEarlyLook);
  return { t, scripted, actions, onTurn, early, fastFoldDoorOffers: () => fastFoldDoorOffers };
}

describe('a Lightning turn that reaches its commit stage is counted once', () => {
  it('counts one commit for every turn decision in a hand played to showdown', async () => {
    const hand = await playHand(2, 7100, passive);

    expect(hand.onTurn.length).toBeGreaterThanOrEqual(4);
    expect(opportunity('decision_started')).toBe(hand.onTurn.length);
    expect(opportunity('commit_evaluated')).toBe(hand.onTurn.length);
    // Every turn's answer landed as that horse's own action.
    expect(hand.actions.length).toBe(hand.onTurn.length);
  });

  it('counts the liveness answer of a failed lane, as the table engine does', async () => {
    const hand = await playHand(2, 7200, passive, { failOnTurn: true });

    expect(hand.onTurn.length).toBeGreaterThan(0);
    expect(opportunity('decision_started')).toBe(hand.onTurn.length);
    expect(opportunity('commit_evaluated')).toBe(hand.onTurn.length);
    expect(hand.actions.every((a) => a.origin === 'horse_fallback')).toBe(true);
  });

  it('counts nothing for a fold an early look lands off the turn', async () => {
    const hand = await playHand(6, 7300, foldWhenOwing);

    // The fixture is only meaningful if early looks ran and landed folds:
    // more horse actions landed than turns were asked.
    expect(hand.early.length).toBeGreaterThan(0);
    expect(hand.onTurn.length).toBeGreaterThan(0);
    expect(hand.actions.length).toBeGreaterThan(hand.onTurn.length);
    // Only the turns were counted, at either boundary: the folds the early
    // looks landed added no start and no commit.
    expect(opportunity('decision_started')).toBe(hand.onTurn.length);
    expect(opportunity('commit_evaluated')).toBe(hand.onTurn.length);
  });

  it('counts an answer once when the Lightning Fold door refuses it and the turn path takes it', async () => {
    const hand = await playHand(6, 7400, foldWhenOwing, { refuseFastFoldDoor: true });

    // The door was offered on-turn answers (early looks cannot land at all
    // here, so every landed action came from a turn).
    expect(hand.fastFoldDoorOffers()).toBeGreaterThan(0);
    expect(opportunity('decision_started')).toBe(hand.onTurn.length);
    expect(opportunity('commit_evaluated')).toBe(hand.actions.length);
    expect(opportunity('commit_evaluated')).toBeLessThanOrEqual(hand.onTurn.length);
  });

  it('ignores an answer it was never told started on a turn, and a second offer', () => {
    const stranger = { action: 'fold', thinkTime: 0, workerFallback: false, fast: null };
    noteLightningHorseCommitEvaluated(stranger);
    noteLightningHorseCommitEvaluated(stranger);
    expect(opportunity('commit_evaluated')).toBe(0);
  });
});
