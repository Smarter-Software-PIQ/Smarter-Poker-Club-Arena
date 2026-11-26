/**
 * The opener response record (HorseOpenerAnswersThreeBet, horse_exact_profiles.opener_response) through the decision
 * worker, the way aReraiseResponseThroughTheWorker.test.ts drives the re-raise response record: one PLO4 decision
 * after an OBSERVE_COMPLETED_HAND carrying the opponent's pooled public row, with a full record, with the column null
 * and with no such column at all (the engine before the migration). With the record the read frame is v21 and
 * carries his 8 numbers; FAST, DEEP and the exact replay agree; no decision reads the record without its default-off
 * option, so the decision bytes are identical with and without it and nothing asks for it. A malformed record is
 * dropped.
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
import {
  addOpenerResponseEvidence,
  emptyOpenerResponse,
  openerResponseRow,
  type OpenerResponseCounters,
} from '../HorseOpenerAnswersThreeBet.js';
import { withoutMeasurements } from '../HorseDeclaredWork.test-support.js';
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
const SEED = 20261117;
/** The decision's own time, fixed (the decision key binds its hour; see anOrdinaryTightRegularThroughTheWorker). */
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

const allOn = (): StyleSwitchStates =>
  Object.fromEntries(
    STYLE_SWITCH_OPTIONS.map((o) => [o, o === 'styleFoldRatePreRepair' ? 'off' : 'on'])
  ) as StyleSwitchStates;

/** The journal's cash PLO4 decision, dealt at a table-speed table. */
function plo4Request(): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashPlo4Preflop)
  ).snapshot;
  const request = {
    ...base,
    decisionTimeMs: DECISION_TIME_MS,
    gameState: { ...base.gameState, publicMemoryDomain: TABLE },
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

/** Forty 3-bet opens of a player who never 4-bets, as the accepted-hand database learner keeps them. */
function stubbornOpener(): OpenerResponseCounters {
  let r: OpenerResponseCounters | null = null;
  for (let i = 0; i < 40; i++) {
    const inc = emptyOpenerResponse();
    if (i % 3 === 0) inc.outOfPosition = { opp: 1, fold: 1, call: 0, raise: 0 };
    else inc.inPosition = { opp: 1, fold: 0, call: 1, raise: 0 };
    r = addOpenerResponseEvidence(r, inc);
  }
  return r!;
}

/** An earlier accepted hand at the same kind of table, carrying the opponent's pooled public row. */
function acceptedHand(
  request: FastHorseDecisionRequest,
  villainId: string,
  street: OpenerResponseCounters | null | undefined
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
        variant: 'plo4',
        mode: 'cash',
        size,
        observed_hands: 300,
        initialized: true,
        counters: counters({
          hands: 120,
          vpip: 0.45,
          pfr: 0.2,
          betCheckedToOpp: 30,
          betCheckedTo: 12,
        }),
        ...(street === undefined ? {} : { opener_response: street }),
      },
    ],
  } as never;
}

/** A decision's bytes without its run-to-run timings and without the qualified-authority epoch, a random id each
 *  worker start mints (every run here starts its own worker). Everything else is compared. */
const decisionBytes = (d: unknown): string =>
  JSON.stringify(withoutMeasurements(d), (key, v) =>
    key === 'epoch' && typeof v === 'string' ? 'worker-start-epoch' : v
  );

interface Outcome {
  fast: FastHorseDecisionResult;
  /** the FAST decision without its run-to-run timings */
  fastBytes: string;
  deepBytes: string;
  deepAction: string;
  asked: number;
  frameVersion: string;
  frameJson: string;
  villainId: string;
  record: ReturnType<typeof makeHorseJournalRecord>;
}

async function throughTheWorker(
  street: OpenerResponseCounters | null | undefined
): Promise<Outcome> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = plo4Request();
  const asked = vi.spyOn(HorseMind, 'openerResponseOf');
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
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(acceptedHand(request, villainId, street));
  await runtime.drain();
  expect(messages.at(-1), JSON.stringify(messages.at(-1))).toMatchObject({
    type: 'ACK',
    operation: 'OBSERVE_COMPLETED_HAND',
  });
  runtime.receive(request);
  await runtime.drain();
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast || payloads.length !== 1)
    throw new Error(`no journaled FAST decision: ${JSON.stringify(messages.at(-1))}`);
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
  const askedCalls = asked.mock.calls.length;
  asked.mockRestore();
  if (!deep) throw new Error(`no DEEP result: ${JSON.stringify(messages.at(-1))}`);
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
    fastBytes: decisionBytes(fast.decision),
    deepBytes: decisionBytes(deep.decision),
    deepAction: deep.decision.action,
    asked: askedCalls,
    frameVersion: frame.version,
    frameJson: frame.json,
    villainId,
    record,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the opener response record through the decision worker', () => {
  it('column full: the frame is v21 and carries his record; FAST, DEEP and the exact replay agree', async () => {
    const record = stubbornOpener();
    const full = await throughTheWorker(record);
    expect(full.frameVersion).toBe('horse-decision-reads-v21');
    const rows = (JSON.parse(full.frameJson) as { openerResponse: Array<[string, number[]]> })
      .openerResponse;
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toContain(full.villainId);
    expect(rows[0]![0].startsWith('plo4:cash:')).toBe(true);
    expect(rows[0]![1]).toEqual(openerResponseRow(record));
    expect(full.deepAction).toBe(full.fast.decision.action);
    expect(full.asked).toBe(0);

    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(full.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(full.fast.decision.action);
    expect(verdict.replayed?.amount).toBe(full.fast.decision.amount ?? null);
  });

  it('column empty or full: FAST and DEEP are byte-identical decisions; empty keeps the frame it had', async () => {
    const full = await throughTheWorker(stubbornOpener());
    const nulled = await throughTheWorker(null);
    const absent = await throughTheWorker(undefined);
    // the decision: the same bytes with the record, with the column null and with no column
    expect(full.fastBytes).toBe(absent.fastBytes);
    expect(nulled.fastBytes).toBe(absent.fastBytes);
    expect(full.deepBytes).toBe(absent.deepBytes);
    expect(nulled.deepBytes).toBe(absent.deepBytes);
    expect([full.asked, nulled.asked, absent.asked]).toEqual([0, 0, 0]);
    // the frame: an empty column changes nothing at all; a full one adds the street rows and the version only
    expect(absent.frameVersion).not.toBe('horse-decision-reads-v21');
    expect(nulled.frameJson).toBe(absent.frameJson);
    const withRows = JSON.parse(full.frameJson) as Record<string, unknown>;
    const without = JSON.parse(absent.frameJson) as Record<string, unknown>;
    for (const key of Object.keys(without))
      if (key !== 'version') expect(withRows[key], key).toEqual(without[key]);
    const added = Object.keys(withRows).filter((k) => !(k in without));
    for (const key of added) {
      // the v21 body's own list: the opener rows, and the predecessor lists a newer version always carries (empty)
      if (key === 'openerResponse') continue;
      expect(withRows[key], key).toEqual([]);
    }
    expect(added).toContain('openerResponse');
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(absent.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
  });

  it('a malformed record is dropped at the worker: the decision and the frame are those of an empty column', async () => {
    const absent = await throughTheWorker(undefined);
    const broken = {
      ...stubbornOpener(),
      inPosition: { opp: 1, fold: 9, call: 0, raise: 0 },
    };
    const dropped = await throughTheWorker(broken as never);
    expect(dropped.fastBytes).toBe(absent.fastBytes);
    expect(dropped.frameJson).toBe(absent.frameJson);
  });
});
