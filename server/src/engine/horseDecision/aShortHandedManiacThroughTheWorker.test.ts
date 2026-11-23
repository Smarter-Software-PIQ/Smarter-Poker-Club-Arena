/**
 * SHORT-HANDED MANIAC REACH THROUGH THE DECISION WORKER (2026-11-22 regression proof;
 * option `holdemManiacShortHandedReach` paired with live `holdemManiacSampleGate` +
 * `holdemGearShiftReach` switch rows).
 *
 * Proves that on the real `HorseDecisionWorkerRuntime` path (FAST, DEEP, and exact replay):
 *  1. Live switch rows `holdemManiacShortHandedReach: 'on'`, `holdemManiacSampleGate: 'on'`,
 *     and `holdemGearShiftReach: 'on'` reach `HorseMind.opponentRead` on a short-handed NLH
 *     decision (`dealtCount = 4` -> `holdem:short`), attach `maniacReach`, yield a non-null
 *     `maniacRaiseWidth` (not shadowed by `holdemManiacSampleGate`), and fire the live receipt
 *     `holdem_maniac_short_handed_reach_seen`.
 *  2. Against a Horse-envelope / non-sticky opponent (the live `horse_exact_profiles` short/hu
 *     population, where `betCheckedTo` rarely engages high and none clear the sticky leg
 *     `foldToBet.mean <= 0.36` simultaneously), the same live switch bundle produces zero
 *     `holdem_maniac_short_handed_reach_seen` fires and `maniacRaiseWidth === null`.
 *  3. With `holdemManiacShortHandedReach: 'off'` on the live switch, or below `minHands = 15`,
 *     the same postflop maniac gets no `maniacReach` and zero fires.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionSwitchHolder, optionSwitchSourceFromStates } from '../HorseOptionSwitch.js';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import {
  MANIAC_MIN_RAISE_WIDTH,
  maniacRaiseWidth,
  type ExploitCounters,
  type OpponentExploitRead,
} from '../HorseOpponentExploit.js';
import { equityGovernor } from '../EquityLoadGovernor.js';
import { restoreFastRandom, saveFastRandom } from '../HorseEval.js';
import {
  disarmBrainTelemetryForTest,
  drainFires,
  enableBrainTelemetry,
} from '../BrainTelemetry.js';
import { liveHorsePhase8Safety } from '../HorsePhase8Safety.js';
import { prepareTournamentFutureHandFacts } from '../HorseTournamentFutureHand.js';
import { solverPolicyArtifactStatus } from '../../gto/SolverPolicyArtifactLoader.js';
import { journalHash, makeHorseJournalRecord } from '../../services/horseDecisionJournal/record.js';
import type {
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
  ObserveCompletedHandRequest,
} from './protocol.js';
import { buildHorseDecisionKey } from './protocol.js';
import {
  HorseDecisionWorkerRuntime,
  type HorseDecisionWorkerDependencies,
} from './workerRuntime.js';
import { raiser } from '../maniacReadGrid.test-support.js';
import { currentReplaySolverStores } from './replay/references.js';
import { qualifiedReplayAdmissions } from './replay/qualifiedAuthority.js';
import { exactReplayHorseDecisionRecord } from './replay/exactReplay.js';
import {
  PHASE6C_FIXTURE_IDS as IDS,
  phase6cFixtureBody,
  phase6cFixtureRecord,
} from './replay/fixtures/index.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';

const SOURCE = '6'.repeat(40);
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const WATCHER = '20000000-0000-4000-8000-0000000000d9';
const SEED = 20261122;
const DECISION_TIME_MS = Date.UTC(2099, 0, 1, 0, 0, 30);

const readiness = () => {
  const { identity, charts, postflop, postflopV31, postflopV31Dataset } =
    currentReplaySolverStores();
  return {
    solverStores: { charts, postflop, postflopV31, postflopV31Dataset },
    solverStoreIdentity: identity,
    solverPolicyArtifact: solverPolicyArtifactStatus(),
    governor: equityGovernor.snapshot(),
  };
};

/** Short-handed NLH (`dealt = 4` -> `holdem:short`) cash river decision fixture. */
function shortHandedNlhRequest(): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const request = {
    ...base,
    decisionTimeMs: DECISION_TIME_MS,
    gameState: { ...base.gameState, publicMemoryDomain: TABLE },
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

function buildCounters(hands: number, pfr: number, bet: number, fold: number): ExploitCounters {
  const c = raiser({ hands, pfr, rfi: Math.min(1, pfr + 0.2) });
  const post = hands * 0.6;
  const fast = Math.min(hands, 12.05) * 0.6;
  c.betCheckedToOpp = post;
  c.betCheckedTo = post * bet;
  c.foldToBetOpp = post;
  c.foldToBet = post * fold;
  c.fBetCheckedToOpp = fast;
  c.fBetCheckedTo = fast * bet;
  c.fFoldToBetOpp = fast;
  c.fFoldToBet = fast * fold;
  return c;
}

function acceptedHand(
  request: FastHorseDecisionRequest,
  villainId: string,
  profileCounters: ExploitCounters
): ObserveCompletedHandRequest {
  const tableId = request.fence.split(':')[0]!;
  const lease = request.fence.split(':')[3]!;
  const number = 14573200;
  const dealt = request.gameState.dealtSeatIds!.length;
  const villainSeat = request.gameState.players.find((p) => p.user_id === villainId)!.seat;
  const watcher = {
    player: { user_id: WATCHER, seat: request.player.seat },
    gameState: {
      ...request.gameState,
      players: request.gameState.players.map((p) =>
        p.seat === request.player.seat ? { ...p, user_id: WATCHER } : p
      ),
    },
  };
  const size = dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full';
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${tableId}:${number}:${lease}:observe`,
    handKey: `${tableId}:${number}`,
    committedHandId: '40000000-0000-4000-8000-000000000009',
    publicMemoryDomain: request.gameState.publicMemoryDomain,
    actions: [
      {
        userId: villainId,
        seat: villainSeat,
        action: 'fold',
        origin: 'player',
        amount: 0,
        stage: 'preflop',
        timestamp: 1,
      },
    ],
    bigBlind: request.gameState.bigBlind,
    observerParticipants: {
      version: 1,
      handKey: `${tableId}:${number}:${lease}`,
      status: 'bound',
      contexts: [horseObserverReadContextFromRequest(watcher as never)!],
    },
    durableOpponentProfiles: [
      {
        public_memory_domain: request.gameState.publicMemoryDomain,
        user_id: villainId,
        variant: 'nlh',
        mode: 'cash',
        size,
        observed_hands: 300,
        initialized: true,
        counters: profileCounters,
      },
    ],
  } as never;
}

interface ObservedRead {
  reachWidth: number | null;
  width: number | null;
}

function watchOpponentRead(villainId: string): ObservedRead[] {
  const seen: ObservedRead[] = [];
  const original = HorseMind.opponentRead.bind(HorseMind);
  vi.spyOn(HorseMind, 'opponentRead').mockImplementation((userId: string) => {
    const read: OpponentExploitRead | null = original(userId);
    if (userId === villainId) {
      seen.push({
        reachWidth: read?.maniacReach?.width ?? null,
        width: maniacRaiseWidth(read),
      });
    }
    return read;
  });
  return seen;
}

async function runWorker(
  profileCounters: ExploitCounters,
  switchStates: Record<string, 'on' | 'off'>
) {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = shortHandedNlhRequest();
  expect(request.gameState.dealtSeatIds!.length).toBe(4);
  const villainId = request.gameState.players.find(
    (q) => !q.is_folded && q.user_id !== request.player.user_id
  )!.user_id;
  const seen = watchOpponentRead(villainId);
  const payloads: unknown[] = [];
  const messages: HorseDecisionWorkerResponse[] = [];
  const deps: HorseDecisionWorkerDependencies = {
    ...qualifiedReplayAdmissions,
    journalEnabled: () => true,
    journalDecision: (_snapshot, payload) => {
      payloads.push(payload);
    },
    async startServices() {
      prepareTournamentFutureHandFacts();
      return readiness();
    },
    async stopServices() {},
    decide: HorseLogic.decide.bind(HorseLogic),
    decideDiscard: HorseLogic.decideDiscard.bind(HorseLogic),
    captureDecisionEffects: (fn) => HorseMind.captureDecisionEffects(fn),
    applyDecisionEffects: () => {},
    saveRng: saveFastRandom,
    restoreRng: restoreFastRandom,
    governorScale: () => equityGovernor.current(),
    atGovernorScale: (fn) => equityGovernor.withDecisionScale(fn),
    workerReadiness: readiness,
    phase8SafetyDisabledReason: () => liveHorsePhase8Safety.disabledReason,
    observeCompletedHand: () => {},
    noteDecision: () => {},
    noteFeature: () => {},
    now: () => performance.now(),
    optionSwitch: new OptionSwitchHolder(optionSwitchSourceFromStates(switchStates), () => {}),
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(acceptedHand(request, villainId, profileCounters));
  await runtime.drain();
  expect(messages.at(-1)).toMatchObject({ type: 'ACK', operation: 'OBSERVE_COMPLETED_HAND' });

  seen.length = 0;
  drainFires();
  runtime.receive(request);
  await runtime.drain();
  const fastFires = drainFires();
  const reachFires =
    fastFires.find((row) => row.feature === 'holdem_maniac_short_handed_reach_seen')?.fires ?? 0;
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast || payloads.length !== 1) {
    throw new Error(`no journaled FAST decision: ${JSON.stringify(messages.at(-1))}`);
  }
  const fastReads = [...seen];

  seen.length = 0;
  const deepDraft = {
    ...request,
    type: 'DECIDE_DEEP' as const,
    requestId: request.requestId + 1,
    rngBefore: fast.rngBefore,
    deepEquity: 2,
  };
  runtime.receive({ ...deepDraft, decisionKey: buildHorseDecisionKey(deepDraft) } as never);
  await runtime.drain();
  const deep = messages.find((m) => m.type === 'DEEP_RESULT');
  if (!deep) throw new Error(`no DEEP result: ${JSON.stringify(messages.at(-1))}`);
  const deepReads = [...seen];

  const record = makeHorseJournalRecord(
    {
      producerId: randomUUID(),
      sequence: 1,
      atMs: Math.trunc(request.decisionTimeMs),
      sourceRelease: SOURCE,
      kind: 'decision',
      handKey: journalHash(`hand:${request.decisionKey}`),
      turnKey: journalHash(
        JSON.stringify([
          request.generation,
          request.fence,
          request.requestId,
          request.decisionKey,
          request.decisionTimeMs,
        ])
      ),
    },
    payloads[0]
  );
  return { fast, fastReads, deepReads, reachFires, record, villainId };
}

afterEach(() => {
  vi.restoreAllMocks();
  disarmBrainTelemetryForTest();
  drainFires();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('holdemManiacShortHandedReach through the live decision worker switch bundle', () => {
  const LIVE_BUNDLE = {
    holdemManiacShortHandedReach: 'on' as const,
    holdemManiacSampleGate: 'on' as const,
    holdemGearShiftReach: 'on' as const,
  };

  it('fires receipt, attaches maniacReach on FAST/DEEP, and replays exactly against a short-handed postflop maniac', async () => {
    const maniac = buildCounters(43.78, 0.4, 0.9, 0.1);
    const out = await runWorker(maniac, LIVE_BUNDLE);

    expect(out.reachFires).toBeGreaterThan(0);
    for (const reads of [out.fastReads, out.deepReads]) {
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((r) => r.reachWidth !== null && r.width !== null)).toBe(true);
      expect(reads.every((r) => r.width! >= MANIAC_MIN_RAISE_WIDTH)).toBe(true);
    }

    HorseMind.reset();
    const replayReads = watchOpponentRead(out.villainId);
    const verdict = await exactReplayHorseDecisionRecord(out.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(out.fast.decision.action);
    expect(replayReads.length).toBeGreaterThan(0);
    expect(replayReads.every((r) => r.reachWidth !== null)).toBe(true);
  });

  it('stays quiet (0 fires) against a non-sticky high-betting Horse-envelope profile even with the live bundle ON', async () => {
    // Representative of the 3 highest live betCheckedTo-engaged short/hu rows in horse_exact_profiles
    // (all tournament Horses with foldToBet posterior mean 0.43-0.70 > 0.36).
    const horseOutlier = buildCounters(43.78, 0.32, 0.72, 0.45);
    const out = await runWorker(horseOutlier, LIVE_BUNDLE);

    expect(out.reachFires).toBe(0);
    expect(out.fastReads.length).toBeGreaterThan(0);
    expect(out.fastReads.every((r) => r.reachWidth === null && r.width === null)).toBe(true);
  });

  it('stays quiet when holdemManiacShortHandedReach is OFF on the switch or below the 15-hand floor', async () => {
    const maniac = buildCounters(43.78, 0.4, 0.9, 0.1);
    const off = await runWorker(maniac, {
      ...LIVE_BUNDLE,
      holdemManiacShortHandedReach: 'off',
    });
    expect(off.reachFires).toBe(0);
    expect(off.fastReads.length).toBeGreaterThan(0);
    expect(off.fastReads.every((r) => r.reachWidth === null && r.width === null)).toBe(true);

    const smallSample = buildCounters(10, 0.4, 0.9, 0.1);
    const underFloor = await runWorker(smallSample, LIVE_BUNDLE);
    expect(underFloor.reachFires).toBe(0);
    expect(underFloor.fastReads.every((r) => r.reachWidth === null && r.width === null)).toBe(true);
  });
});
