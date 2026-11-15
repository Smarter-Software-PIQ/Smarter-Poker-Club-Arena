/**
 * THE PRE-REPAIR DISCOUNT THROUGH THE DECISION WORKER (2026-11-14).
 *
 * thePreRepairDiscountReachesTheDecision.law.test.ts drives the observer reads the worker owns. This file drives the
 * worker itself, the way a live read travels: an accepted hand reaches a HorseDecisionWorkerRuntime as
 * OBSERVE_COMPLETED_HAND carrying the opponent's pooled public row, the Horse's next decision is requested as
 * DECIDE_FAST, the second look as DECIDE_DEEP, and the journaled decision is replayed exactly. Nothing is installed
 * through HorseMind.importDurableOpponentProfiles and no read view is substituted: the runtime's own observer reads
 * assemble the decision's state.
 *
 * The spot is the journal's own cash river hand (queen high on a board of 9 K 4 8 A, first to act): a bluff or a
 * check. The opponent's pooled cash table-speed row says he folds 38 of 40 bets, the figure the pre-repair learner
 * produced by counting folds without the calls, and only 30 post-release opportunities are in.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { equityGovernor } from '../EquityLoadGovernor.js';
import { restoreFastRandom, saveFastRandom } from '../HorseEval.js';
import { enableBrainTelemetry } from '../BrainTelemetry.js';
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
import { counters } from '../HorseOpponentStyle.test-support.js';
import {
  STYLE_SWITCH_OPTIONS,
  StyleSwitchHolder,
  styleSwitchSourceFromStates,
  type StyleSwitchStates,
} from '../HorseStyleSwitch.js';
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

const SOURCE = '5'.repeat(40);
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const LIGHTNING: HorsePublicMemoryDomain = { version: 1, speed: 'lightning', ante: 'none' };
const WATCHER = '20000000-0000-4000-8000-0000000000b1';
const M = 30;
const SEED = 20261114;

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

const states = (arm: 'on' | 'off' | 'shadow'): StyleSwitchStates =>
  Object.fromEntries(
    STYLE_SWITCH_OPTIONS.map((o) => [o, o === 'styleFoldRatePreRepair' ? arm : 'off'])
  ) as StyleSwitchStates;

/** The journal's cash river decision, dealt at a table of the given public domain. */
function riverRequest(domain: HorsePublicMemoryDomain): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const request = {
    ...base,
    // The pooled row is learned now; a decision fenced before it could not read it.
    decisionTimeMs: Date.now() + 60_000,
    gameState: { ...base.gameState, publicMemoryDomain: domain },
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

/** An earlier accepted hand at the same kind of table, carrying the opponent's pooled public row. */
function acceptedHand(
  request: FastHorseDecisionRequest,
  villainId: string
): ObserveCompletedHandRequest {
  const tableId = request.fence.split(':')[0]!;
  const lease = request.fence.split(':')[3]!;
  const number = 14573000;
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
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${tableId}:${number}:${lease}:observe`,
    handKey: `${tableId}:${number}`,
    committedHandId: '40000000-0000-4000-8000-000000000001',
    publicMemoryDomain: request.gameState.publicMemoryDomain,
    actions: [
      {
        userId: villainId,
        seat: villainSeat,
        action: 'raise',
        amount: 2,
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
        size: dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full',
        observed_hands: 80,
        initialized: true,
        counters: counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: 38 }),
      },
    ],
  } as never;
}

interface Outcome {
  request: FastHorseDecisionRequest;
  fast: FastHorseDecisionResult;
  deepAction: string;
  deepAmount: number | null;
  /** what foldToBetPreRepairExcluded answered for the opponent, per look */
  excluded: { fast: boolean[]; deep: boolean[] };
  frameVersion: string;
  frameCarriesProvenance: boolean;
  record: ReturnType<typeof makeHorseJournalRecord>;
  villainId: string;
}

/** One accepted hand, then FAST and DEEP for the river decision, through the production runtime. */
async function throughTheWorker(
  domain: HorsePublicMemoryDomain,
  arm: 'on' | 'off' | 'shadow',
  excludedLog: boolean[]
): Promise<Outcome> {
  HorseMind.reset();
  // every run starts from the same random stream, so two runs differ only by what the test varies
  restoreFastRandom(SEED);
  const request = riverRequest(domain);
  const villainId = request.gameState.players.find(
    (q) => !q.is_folded && q.user_id !== request.player.user_id
  )!.user_id;
  // The boot input the worker's own boot supplies (HorseExploitHydrator): m of this row, for its domain.
  const dealt = request.gameState.dealtSeatIds!.length;
  HorseMind.importPostReleaseObservations([
    {
      user_id: villainId,
      variant: 'nlh',
      mode: 'cash',
      size: dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full',
      domain: 'table:none',
      opportunities: { foldToBet: M, riverCall: M, foldTo3Bet: M, betCheckedTo: M },
    },
  ]);
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
    styleSwitch: new StyleSwitchHolder(styleSwitchSourceFromStates(states(arm)), () => {}),
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(acceptedHand(request, villainId));
  await runtime.drain();
  expect(messages.at(-1), JSON.stringify(messages.at(-1))).toMatchObject({
    type: 'ACK',
    operation: 'OBSERVE_COMPLETED_HAND',
  });
  excludedLog.length = 0;
  runtime.receive(request);
  await runtime.drain();
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast || payloads.length !== 1)
    throw new Error(`no journaled FAST decision: ${JSON.stringify(messages.at(-1))}`);
  const fastExcluded = [...excludedLog];
  excludedLog.length = 0;
  const deepDraft = {
    ...request,
    type: 'DECIDE_DEEP' as const,
    requestId: request.requestId + 1,
    rngBefore: fast.rngBefore,
    deepEquity: 2,
  };
  runtime.receive({ ...deepDraft, decisionKey: buildHorseDecisionKey(deepDraft) } as never);
  await runtime.drain();
  const deep = messages.find((m) => m.type === 'DEEP_RESULT') as
    | { decision: { action: string; amount?: number | null } }
    | undefined;
  if (!deep) throw new Error(`no DEEP result: ${JSON.stringify(messages.at(-1))}`);
  const deepExcluded = [...excludedLog];
  const frame = (payloads[0] as { readFrame: { version: string; json: string } }).readFrame;
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
  return {
    request,
    fast,
    deepAction: deep.decision.action,
    deepAmount: deep.decision.amount ?? null,
    excluded: { fast: fastExcluded, deep: deepExcluded },
    frameVersion: frame.version,
    frameCarriesProvenance: frame.json.includes('pooledProvenance'),
    record,
    villainId,
  };
}

/** A decision without what names the runtime that made it (each runtime draws its own authority epoch) and without
 * the wall-clock measurements a receipt records about its own work. Every decided value stays. */
const sameWorker = (decision: unknown): unknown =>
  JSON.parse(
    JSON.stringify(decision, (key, value) =>
      key === 'epoch' || key === 'latencyMs' || key === 'elapsedMs' ? undefined : value
    )
  );

// CLOCK PIN (2026-11-15, PLO Strategy, to unblock every pre-push gate): this
// file's outcome depended on the wall clock. On an unchanged tree (origin/main
// 54c9aac8) it passed with Date.now before 2026-11-15T07:00Z and failed after
// (FAST bet, DEEP check), shown by shifting Date.now alone. The test is about
// the pre-repair discount, not the clock, so Date.now runs from a fixed
// instant at real speed. The owning lane replaces this with the root cause.
const CLOCK_PIN_MS = Date.parse('2026-11-15T06:30:00Z');
beforeEach(() => {
  const realNow = Date.now.bind(Date);
  const started = realNow();
  vi.spyOn(Date, 'now').mockImplementation(() => CLOCK_PIN_MS + (realNow() - started));
});

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the pre-repair discount through the decision worker', () => {
  /** Record what the brain was told about the opponent's fold-to-bet, whichever look or replay asks. */
  function watchExcluded(): boolean[] {
    const log: boolean[] = [];
    const target = HorseMind as unknown as { foldToBetPreRepairExcluded(userId: string): boolean };
    const original = target.foldToBetPreRepairExcluded.bind(HorseMind);
    vi.spyOn(target, 'foldToBetPreRepairExcluded').mockImplementation((userId: string) => {
      const answer = original(userId);
      log.push(answer);
      return answer;
    });
    return log;
  }

  it('FAST, DEEP and the exact replay of the journaled decision all withhold the pre-repair over-folder read', async () => {
    const log = watchExcluded();
    const on = await throughTheWorker(TABLE, 'on', log);
    // the brain asked, and on both looks the answer was: excluded
    expect(on.excluded.fast.length).toBeGreaterThan(0);
    expect(on.excluded.fast.every((x) => x)).toBe(true);
    expect(on.excluded.deep.length).toBeGreaterThan(0);
    expect(on.excluded.deep.every((x) => x)).toBe(true);
    // the journaled read frame carries the provenance the second look and the replay read
    expect(on.frameVersion).toBe('horse-decision-reads-v14');
    expect(on.frameCarriesProvenance).toBe(true);
    // fast and deep agree on the action
    expect(on.deepAction).toBe(on.fast.decision.action);

    // An exact replay in a process that holds none of this one's pooled rows or boot input.
    HorseMind.reset();
    log.length = 0;
    const verdict = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(on.fast.decision.action);
    expect(verdict.replayed?.amount).toBe(on.fast.decision.amount ?? null);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((x) => x)).toBe(true);
    // and the replay is deterministic
    log.length = 0;
    const again = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(again.outcome).toBe('replayed_exact');
    expect(again.replayed).toEqual(verdict.replayed);
    expect(log.every((x) => x)).toBe(true);
  });

  it('option off (and shadow): the worker decides exactly as it did before the keying reached it', async () => {
    const log = watchExcluded();
    for (const arm of ['off', 'shadow'] as const) {
      const withKeying = await throughTheWorker(TABLE, arm, log);
      expect(withKeying.frameCarriesProvenance).toBe(true);
      // The state a decision had before 2026-11-14: the same pooled row, no keying carried with it.
      const none = vi.spyOn(HorseMind, 'pooledRowProvenance').mockReturnValue(null);
      const before = await throughTheWorker(TABLE, arm, log);
      none.mockRestore();
      expect(before.frameCarriesProvenance).toBe(false);
      expect(before.frameVersion).not.toBe('horse-decision-reads-v14');
      expect(sameWorker(withKeying.fast.decision), arm).toEqual(sameWorker(before.fast.decision));
      expect(withKeying.fast.rngAfter, arm).toBe(before.fast.rngAfter);
      expect([withKeying.deepAction, withKeying.deepAmount], arm).toEqual([
        before.deepAction,
        before.deepAmount,
      ]);
    }
    const off = await throughTheWorker(TABLE, 'off', log);
    // the off decision replays exactly
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(off.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(off.fast.decision.action);
  });

  it('a lightning table is not affected with the option on: nothing is excluded', async () => {
    const log = watchExcluded();
    const lightning = await throughTheWorker(LIGHTNING, 'on', log);
    expect(lightning.excluded.fast.length).toBeGreaterThan(0);
    expect(lightning.excluded.fast.some((x) => x)).toBe(false);
    expect(lightning.excluded.deep.some((x) => x)).toBe(false);
    expect(lightning.frameCarriesProvenance).toBe(false);
  });
});
