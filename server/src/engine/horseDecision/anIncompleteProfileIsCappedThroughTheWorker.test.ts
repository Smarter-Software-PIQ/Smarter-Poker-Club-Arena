/**
 * AN INCOMPLETE PROFILE IS CAPPED, THROUGH THE DECISION WORKER (2026-11-15, option holdemProfileCompletenessCap).
 *
 * The production path: an earlier accepted hand carries the opponent's pooled public row. When that row's stored
 * profile is not complete (legacy back-fill pending: initialized false) and the decision's options carry the option,
 * the style read's confidence is capped at incompleteProfileCap (0.4) on DECIDE_FAST, on DECIDE_DEEP and in the
 * exact replay of the journaled decision (read frame v17). With the option off, or with a complete row, nothing is
 * carried: the frame is not v17 and the decision is what it was.
 */
import { OptionSwitchHolder, optionSwitchSourceFromStates } from '../HorseOptionSwitch.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { horsePlanBatchBindingFromRequest, horsePlanContextKey } from '../HorsePlanHandIdentity.js';
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
const WATCHER = '20000000-0000-4000-8000-0000000000c7';
const SEED = 20261115;
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

/** The journal's cash river decision, dealt at a table-speed table, with the option on or off. */
function riverRequest(on: boolean): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const request = {
    ...base,
    decisionTimeMs: DECISION_TIME_MS,
    gameState: { ...base.gameState, publicMemoryDomain: TABLE },
    ...(on ? { opts: { ...(base.opts ?? {}), holdemProfileCompletenessCap: true } } : {}),
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

/** An earlier accepted hand at the same kind of table, carrying the opponent's pooled public row. */
function acceptedHand(
  request: FastHorseDecisionRequest,
  villainId: string,
  complete: boolean
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
        initialized: complete,
        counters: counters({
          hands: 120,
          vpip: 0.22,
          pfr: 0.15,
          betCheckedToOpp: 30,
          betCheckedTo: 12,
        }),
      },
    ],
  } as never;
}

interface Seen {
  cap: number;
}
interface Outcome {
  fast: FastHorseDecisionResult;
  deepAction: string;
  deepAmount: number | null;
  reads: { fast: Seen[]; deep: Seen[] };
  capReceiptFires: number;
  frameVersion: string;
  frameJson: string;
  record: ReturnType<typeof makeHorseJournalRecord>;
}

async function throughTheWorker(
  on: boolean,
  log: Seen[],
  complete = false,
  switched?: 'on' | 'off',
  issued?: {
    receipt?: unknown;
    ranInIssuedView?: boolean;
    payload?: unknown;
    withPlanEffect?: boolean;
    after?: HorseDecisionWorkerResponse[];
  }
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
    decide: issued?.withPlanEffect
      ? (...args: Parameters<typeof HorseLogic.decide>) => {
          // the real decision runs (its reads are what this file watches); the wager is then fixed to a legal bet
          // so the worker issues a plan batch for it
          HorseLogic.decide(...args);
          const wager = { action: 'bet' as const, amount: request.gameState.pot };
          return {
            ...wager,
            thinkTime: 500,
            // the reference wager retained to the end: the shape the worker requires before it issues a plan batch
            policyGraph: {
              version: 'horse-policy-order-v3',
              transitions: [{ node: 'reference', after: wager }],
              finalAction: wager,
            },
          } as never;
        }
      : HorseLogic.decide.bind(HorseLogic),
    decideDiscard: HorseLogic.decideDiscard.bind(HorseLogic),
    captureDecisionEffects: (fn) => {
      const captured = HorseMind.captureDecisionEffects(fn);
      return issued?.withPlanEffect
        ? {
            ...captured,
            effects: [
              ...captured.effects,
              {
                type: 'plan' as const,
                handKey: horsePlanContextKey(
                  horsePlanBatchBindingFromRequest(request).planContext
                )!,
                userId: request.player.user_id,
                barrelIntent: true,
              },
            ],
          }
        : captured;
    },
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
    // the live option switch alone may turn the cap on or off (the read view sees the effective option)
    ...(switched
      ? {
          optionSwitch: new OptionSwitchHolder(
            optionSwitchSourceFromStates({ holdemProfileCompletenessCap: switched }),
            () => {}
          ),
        }
      : {}),
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(acceptedHand(request, villainId, complete));
  await runtime.drain();
  expect(messages.at(-1), JSON.stringify(messages.at(-1))).toMatchObject({
    type: 'ACK',
    operation: 'OBSERVE_COMPLETED_HAND',
  });
  log.length = 0;
  drainFires();
  runtime.receive(request);
  await runtime.drain();
  const fastFires = drainFires();
  const capReceiptFires =
    fastFires.find((row) => row.feature === 'holdem_profile_completeness_cap_seen')?.fires ?? 0;
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast || payloads.length !== 1)
    throw new Error(`no journaled FAST decision: ${JSON.stringify(messages.at(-1))}`);
  const fastReads = [...log];
  log.length = 0;
  if (issued) {
    // What every effect commit of this decision does first (workerRuntime, COMMIT_DECISION_EFFECTS): run inside the
    // observer view issued for THIS request object. It throws when the view was stored under any other object.
    const views = (
      runtime as unknown as {
        observerReads: { runIssued<T>(r: unknown, fn: () => T): T; receipt(r: unknown): unknown };
      }
    ).observerReads;
    issued.receipt = views.receipt(request);
    issued.ranInIssuedView = views.runIssued(request, () => true);
    issued.payload = payloads[0];
    if (issued.withPlanEffect) {
      runtime.receive({
        type: 'COMMIT_DECISION_EFFECTS',
        requestId: request.requestId + 1,
        planBinding: fast.planBinding,
        generation: request.generation,
        fence: request.fence,
        effects: fast.effects,
        acceptance: {
          version: 'horse-plan-acceptance-v1',
          action: fast.decision.action,
          amount: fast.decision.amount ?? 0,
          witness: null,
        },
      } as never);
      await runtime.drain();
      issued.after = messages.slice(messages.indexOf(fast) + 1);
    }
  }
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
    capReceiptFires,
    frameVersion: frame.version,
    frameJson: frame.json,
    record,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  disarmBrainTelemetryForTest();
  drainFires();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

function watchStyle(villainId: () => string): Seen[] {
  const log: Seen[] = [];
  const original = HorseMind.styleRead.bind(HorseMind);
  vi.spyOn(HorseMind, 'styleRead').mockImplementation((userId: string) => {
    const read = original(userId);
    if (userId === villainId()) log.push({ cap: read.confidenceCap });
    return read;
  });
  return log;
}

describe('an incomplete pooled profile through the decision worker', () => {
  const villain = () => {
    const request = riverRequest(false);
    return request.gameState.players.find(
      (q) => !q.is_folded && q.user_id !== request.player.user_id
    )!.user_id;
  };

  it('FAST, DEEP and the exact replay all cap the read of a back-fill-pending row (frame v17)', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const on = await throughTheWorker(true, log);
    for (const look of [on.reads.fast, on.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.cap <= 0.4 + 1e-12)).toBe(true);
    }
    expect(on.capReceiptFires).toBeGreaterThan(0);
    expect(on.frameVersion).toBe('horse-decision-reads-v17');
    // (FAST and DEEP carry different decision keys, and this river spot is mixed: the reads are compared, and the
    // exact replay below pins the action)

    HorseMind.reset();
    log.length = 0;
    const verdict = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(on.fast.decision.action);
    expect(verdict.replayed?.amount).toBe(on.fast.decision.amount ?? null);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.cap <= 0.4 + 1e-12)).toBe(true);
  });

  it('a live switch row ON alone (nothing in the request) caps the read; a row OFF beats the request', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const rowOn = await throughTheWorker(false, log, false, 'on');
    expect(rowOn.reads.fast.length).toBeGreaterThan(0);
    expect(rowOn.reads.fast.every((r) => r.cap <= 0.4 + 1e-12)).toBe(true);
    expect(rowOn.capReceiptFires).toBeGreaterThan(0);
    expect(rowOn.frameVersion).toBe('horse-decision-reads-v17');
    log.length = 0;
    const rowOff = await throughTheWorker(true, log, false, 'off');
    expect(rowOff.capReceiptFires).toBe(0);
    expect(rowOff.frameVersion).not.toBe('horse-decision-reads-v17');
  });

  it('a live switch row ON alone: the decision keeps the observer view issued for its own request', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const issued: { receipt?: unknown; ranInIssuedView?: boolean; payload?: unknown } = {};
    const rowOn = await throughTheWorker(false, log, false, 'on', issued);
    // the row did turn the cap on for this decision
    expect(rowOn.frameVersion).toBe('horse-decision-reads-v17');
    // and the view is stored under the ORIGINAL request: its receipt is found, the journal carries the reads, and
    // the effect-commit path (runIssued) finds the view instead of throwing "view unavailable"
    expect(issued.receipt).toBeTruthy();
    expect((issued.payload as { observerReads?: unknown }).observerReads).toBeTruthy();
    expect(issued.ranInIssuedView).toBe(true);
  });

  it('a live switch row ON alone: an issued plan batch commits (applied_volatile), with its receipt', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const issued: {
      receipt?: unknown;
      ranInIssuedView?: boolean;
      payload?: unknown;
      withPlanEffect: boolean;
      after?: HorseDecisionWorkerResponse[];
    } = { withPlanEffect: true };
    const rowOn = await throughTheWorker(false, log, false, 'on', issued);
    expect(rowOn.frameVersion).toBe('horse-decision-reads-v17');
    // the FAST issued a plan batch for a retained reference wager ...
    expect(rowOn.fast.planIssueDisposition).toBe('issued');
    expect(rowOn.fast.effects.length).toBe(1);
    expect(issued.receipt).toBeTruthy();
    // ... and the table's commit of exactly that batch is applied, never an error
    expect(issued.after?.filter((m) => m.type === 'ERROR')).toEqual([]);
    expect(issued.after?.find((m) => m.type === 'ACK')).toMatchObject({
      operation: 'COMMIT_DECISION_EFFECTS',
      planDisposition: 'applied_volatile',
    });
  });

  it('the option off: the same incomplete row is read uncapped, the frame is not v17, as with a complete row', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const off = await throughTheWorker(false, log);
    for (const look of [off.reads.fast, off.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.cap > 0.4)).toBe(true);
    }
    expect(off.frameVersion).not.toBe('horse-decision-reads-v17');
    expect(off.deepAction).toBe(off.fast.decision.action);
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(off.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    // byte-identical to the same row stored complete, with the option off
    const complete = await throughTheWorker(
      false,
      watchStyle(() => id),
      true
    );
    expect([complete.fast.decision.action, complete.fast.decision.amount ?? null]).toEqual([
      off.fast.decision.action,
      off.fast.decision.amount ?? null,
    ]);
    expect([complete.deepAction, complete.deepAmount]).toEqual([off.deepAction, off.deepAmount]);
    expect(complete.frameJson).toBe(off.frameJson);
  });

  it('the option on with a complete row: nothing is carried, and the frame equals the option off', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const on = await throughTheWorker(true, log, true);
    expect(on.reads.fast.length).toBeGreaterThan(0);
    expect(on.reads.fast.every((r) => r.cap > 0.4)).toBe(true);
    // Complete rows (initialized=true with valid public_memory_domain, matching 100% of horse_exact_profiles)
    // never trip the cap and emit zero holdem_profile_completeness_cap_seen receipts.
    expect(on.capReceiptFires).toBe(0);
    expect(on.frameVersion).not.toBe('horse-decision-reads-v17');
    const off = await throughTheWorker(
      false,
      watchStyle(() => id),
      true
    );
    // the read frame, which is everything the decision reads of its opponents, is the option-off frame (the request's
    // options are part of its decision key, so a mixed spot may still draw differently)
    expect(on.frameJson).toBe(off.frameJson);
    expect(on.reads.deep.every((r) => r.cap > 0.4)).toBe(true);
  });
});
