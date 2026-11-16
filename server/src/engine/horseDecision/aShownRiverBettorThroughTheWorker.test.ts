/**
 * A SHOWN RIVER BETTOR REMEMBERED ACROSS A RESTART, THROUGH THE DECISION WORKER (2026-11-15).
 *
 * aShownRiverBettorIsRememberedAcrossARestart.law.test.ts drives the observer reads the worker owns. This file drives
 * the worker itself, the way a live read travels after a restart: a fresh HorseDecisionWorkerRuntime (nothing in
 * process memory, so no 72-hour river buckets for the opponent) receives an accepted hand as OBSERVE_COMPLETED_HAND
 * carrying the opponent's pooled public row with its durable shown river record (horse_exact_profiles.shown_river:
 * thirteen large river first bets, all called and shown strong, the first fourteen days before the decision). The
 * Horse's next decision is requested as DECIDE_FAST with styleLongShownMemory, the second look as DECIDE_DEEP, and
 * the journaled decision is replayed exactly in a process that holds none of this one's rows. Every look and the
 * replay read him as a shown value bettor; without the option each reads the empty window, and the frame is not v16.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { addShownRiverEvidence, type ShownRiverRecord } from '../HorseLongShownMemory.js';
import { OptionSwitchHolder, optionSwitchSourceFromStates } from '../HorseOptionSwitch.js';
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
const WATCHER = '20000000-0000-4000-8000-0000000000c2';
const SEED = 20261115;
/** The decision's own time, fixed (the decision key binds its hour; see anOrdinaryTightRegularThroughTheWorker). */
const DECISION_TIME_MS = Date.UTC(2099, 0, 1, 0, 0, 30);
const DAY = 24 * 3600 * 1000;

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

const allOn = (): StyleSwitchStates =>
  Object.fromEntries(
    STYLE_SWITCH_OPTIONS.map((o) => [o, o === 'styleFoldRatePreRepair' ? 'off' : 'on'])
  ) as StyleSwitchStates;

/** The journal's cash river decision, dealt at a table-speed table, with the option on or off. */
function riverRequest(on: boolean): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const request = {
    ...base,
    decisionTimeMs: DECISION_TIME_MS,
    gameState: { ...base.gameState, publicMemoryDomain: TABLE },
    ...(on ? { opts: { ...(base.opts ?? {}), styleLongShownMemory: true } } : {}),
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

/** Thirteen large river first bets, each called and shown strong, as the accepted-hand database learner keeps them. */
function valueRecord(): ShownRiverRecord {
  let r: ShownRiverRecord | null = null;
  for (let i = 0; i < 13; i++)
    r = addShownRiverEvidence(
      r,
      { b: 'large', shown: 1, strong: 1 },
      DECISION_TIME_MS - 14 * DAY + i * DAY
    );
  return r!;
}

/** An earlier accepted hand at the same kind of table, carrying the opponent's pooled public row. */
function acceptedHand(
  request: FastHorseDecisionRequest,
  villainId: string,
  withRecord: boolean
): ObserveCompletedHandRequest {
  const tableId = request.fence.split(':')[0]!;
  const lease = request.fence.split(':')[3]!;
  const number = 14573100;
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
    committedHandId: '40000000-0000-4000-8000-000000000003',
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
        counters: counters({
          hands: 120,
          vpip: 0.22,
          pfr: 0.15,
          betCheckedToOpp: 30,
          betCheckedTo: 12,
        }),
        ...(withRecord ? { shown_river: valueRecord() } : {}),
      },
    ],
  } as never;
}

interface Seen {
  largeShown: number;
  largeSide: string | null;
}
interface Outcome {
  fast: FastHorseDecisionResult;
  deepAction: string;
  deepAmount: number | null;
  reads: { fast: Seen[]; deep: Seen[] };
  frameVersion: string;
  frameJson: string;
  record: ReturnType<typeof makeHorseJournalRecord>;
}

async function throughTheWorker(
  on: boolean,
  log: Seen[],
  withRecord = true,
  switched?: 'on' | 'off'
): Promise<Outcome> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = riverRequest(on);
  const villainId = request.gameState.players.find(
    (q) => !q.is_folded && q.user_id !== request.player.user_id
  )!.user_id;
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
    styleSwitch: new StyleSwitchHolder(styleSwitchSourceFromStates(allOn()), () => {}),
    // the live option switch (HorseOptionSwitch): a row for styleLongShownMemory, or none
    ...(switched
      ? {
          optionSwitch: new OptionSwitchHolder(
            optionSwitchSourceFromStates({ styleLongShownMemory: switched }),
            () => {}
          ),
        }
      : {}),
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(acceptedHand(request, villainId, withRecord));
  await runtime.drain();
  expect(messages.at(-1), JSON.stringify(messages.at(-1))).toMatchObject({
    type: 'ACK',
    operation: 'OBSERVE_COMPLETED_HAND',
  });
  log.length = 0;
  runtime.receive(request);
  await runtime.drain();
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast || payloads.length !== 1)
    throw new Error(`no journaled FAST decision: ${JSON.stringify(messages.at(-1))}`);
  const fastReads = [...log];
  log.length = 0;
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
  const deepReads = [...log];
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
    fast,
    deepAction: deep.decision.action,
    deepAmount: deep.decision.amount ?? null,
    reads: { fast: fastReads, deep: deepReads },
    frameVersion: frame.version,
    frameJson: frame.json,
    record,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

function watchStyle(villainId: () => string): Seen[] {
  const log: Seen[] = [];
  const original = HorseMind.styleRead.bind(HorseMind);
  vi.spyOn(HorseMind, 'styleRead').mockImplementation((userId: string) => {
    const read = original(userId);
    if (userId === villainId())
      log.push({
        largeShown: read.signals.shownBySize.large.shown,
        largeSide: read.signals.shownBySize.large.side,
      });
    return read;
  });
  return log;
}

describe('a shown river bettor through the decision worker, after a restart', () => {
  const villain = () => {
    const request = riverRequest(false);
    return request.gameState.players.find(
      (q) => !q.is_folded && q.user_id !== request.player.user_id
    )!.user_id;
  };

  it('FAST, DEEP and the exact replay all read his durable shown value bets (frame v16)', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const on = await throughTheWorker(true, log);
    for (const look of [on.reads.fast, on.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.largeShown > 11 && r.largeSide === 'value')).toBe(true);
    }
    expect(on.frameVersion).toBe('horse-decision-reads-v16');
    expect(on.deepAction).toBe(on.fast.decision.action);

    HorseMind.reset();
    log.length = 0;
    const verdict = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(on.fast.decision.action);
    expect(verdict.replayed?.amount).toBe(on.fast.decision.amount ?? null);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.largeShown > 11 && r.largeSide === 'value')).toBe(true);
  });

  it('the option off: the same row reads the empty 72-hour window, and the frame is not v16', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const off = await throughTheWorker(false, log);
    for (const look of [off.reads.fast, off.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.largeShown === 0 && r.largeSide === null)).toBe(true);
    }
    expect(off.frameVersion).not.toBe('horse-decision-reads-v16');
    expect(off.deepAction).toBe(off.fast.decision.action);
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(off.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    // byte-identical to the same row with no record on file (the database before its migration)
    const none = await throughTheWorker(
      false,
      watchStyle(() => id),
      false
    );
    // (the decision's diagnostic timings differ run to run; the action, the amount and the frame do not)
    expect([none.fast.decision.action, none.fast.decision.amount ?? null]).toEqual([
      off.fast.decision.action,
      off.fast.decision.amount ?? null,
    ]);
    expect([none.deepAction, none.deepAmount]).toEqual([off.deepAction, off.deepAmount]);
    expect(none.frameJson).toBe(off.frameJson);
  });

  it('a live switch row ON alone (nothing in the request) carries the record: FAST, DEEP and exact replay read it', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const on = await throughTheWorker(false, log, true, 'on');
    for (const look of [on.reads.fast, on.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.largeShown > 11 && r.largeSide === 'value')).toBe(true);
    }
    expect(on.frameVersion).toBe('horse-decision-reads-v16');
    expect(on.deepAction).toBe(on.fast.decision.action);
    HorseMind.reset();
    log.length = 0;
    const verdict = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.largeShown > 11 && r.largeSide === 'value')).toBe(true);
  });

  it('a live switch row OFF wins over the request: nothing is carried, the frame is not v16, the decision is the off decision', async () => {
    const id = villain();
    const off = await throughTheWorker(
      true,
      watchStyle(() => id),
      true,
      'off'
    );
    for (const look of [off.reads.fast, off.reads.deep])
      expect(look.every((r) => r.largeShown === 0 && r.largeSide === null)).toBe(true);
    expect(off.frameVersion).not.toBe('horse-decision-reads-v16');
    const plain = await throughTheWorker(
      false,
      watchStyle(() => id)
    );
    expect([off.fast.decision.action, off.fast.decision.amount ?? null]).toEqual([
      plain.fast.decision.action,
      plain.fast.decision.amount ?? null,
    ]);
    expect(off.frameJson).toBe(plain.frameJson);
  });
});
