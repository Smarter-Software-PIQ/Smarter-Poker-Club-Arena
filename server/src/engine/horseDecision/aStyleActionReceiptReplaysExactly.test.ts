/**
 * A STYLE ACTION-CHANGE RECEIPT REPLAYS EXACTLY (2026-11-15, R1), with the production brain.
 *
 * The journal's cash river decision (hero Qc Td, checked to heads-up on 9s Kc 4s 8c As) through the production
 * HorseDecisionWorkerRuntime and HorseLogic, every style option on, against a synthetic opponent who folds rivers
 * (river call 3 of 30), his pooled row delivered the way a live read travels (OBSERVE_COMPLETED_HAND): the postflop-fold bluff option applies. The FAST
 * decision carries styleActionReceipt; the receipt's `without` is what HorseLogic decides from the same RNG position
 * with that option off; the committed action and RNG position are those of the same request decided with the receipt
 * machinery inert; and the journaled record replays exactly, receipt included.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { equityGovernor } from '../EquityLoadGovernor.js';
import { restoreFastRandom, saveFastRandom } from '../HorseEval.js';
import { enableBrainTelemetry } from '../BrainTelemetry.js';
import { liveHorsePhase8Safety } from '../HorsePhase8Safety.js';
import { prepareTournamentFutureHandFacts } from '../HorseTournamentFutureHand.js';
import { solverPolicyArtifactStatus } from '../../gto/SolverPolicyArtifactLoader.js';
import { journalHash, makeHorseJournalRecord } from '../../services/horseDecisionJournal/record.js';
import type { HorseDecision } from '../../types.js';
import type {
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
  ObserveCompletedHandRequest,
} from './protocol.js';
import { EXPLOIT_COUNTER_FIELDS } from '../HorseOpponentExploit.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { buildHorseDecisionKey } from './protocol.js';
import {
  HorseDecisionWorkerRuntime,
  type HorseDecisionWorkerDependencies,
} from './workerRuntime.js';
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
import { counters } from '../HorseOpponentStyle.test-support.js';
import { clearStyleOptionsApplied } from '../HorseStyleShadow.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';

const SOURCE = '6'.repeat(40);
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const SEED = 20261115;
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
const states = (on: boolean): StyleSwitchStates =>
  Object.fromEntries(
    STYLE_SWITCH_OPTIONS.map((o) => [o, on && o !== 'styleFoldRatePreRepair' ? 'on' : 'off'])
  ) as StyleSwitchStates;

function riverRequest(): FastHorseDecisionRequest {
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

const WATCHER = '20000000-0000-4000-8000-0000000000b3';

/** An earlier accepted hand at the same kind of table, carrying the opponent's pooled public row (a river folder). */
function acceptedHand(request: FastHorseDecisionRequest): ObserveCompletedHandRequest {
  const villainId = request.gameState.players.find(
    (q) => !q.is_folded && q.user_id !== request.player.user_id
  )!.user_id;
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
  const size = dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full';
  const c = counters({
    hands: 80,
    vpip: 0.2,
    pfr: 0.12,
    threeBetOpp: 20,
    threeBet: 1,
    betCheckedToOpp: 40,
    betCheckedTo: 12,
    foldToBetOpp: 30,
    foldToBet: 14,
  });
  c.riverCallOpp = 30;
  c.riverCall = 3;
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
        observed_hands: 80,
        initialized: true,
        counters: Object.fromEntries(EXPLOIT_COUNTER_FIELDS.map((f) => [f, c[f]])),
      },
    ],
  } as never;
}

interface Outcome {
  fast: FastHorseDecisionResult;
  record: ReturnType<typeof makeHorseJournalRecord>;
}

async function decideFast(
  on: boolean,
  decide = HorseLogic.decide.bind(HorseLogic)
): Promise<Outcome> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = riverRequest();
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
    decide,
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
    // A frozen clock: the receipt's budget skip (Hand Analysis B1) cannot bind in this test.
    now: () => 0,
    styleSwitch: new StyleSwitchHolder(styleSwitchSourceFromStates(states(on)), () => {}),
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(acceptedHand(request));
  await runtime.drain();
  payloads.length = 0;
  runtime.receive(request);
  await runtime.drain();
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast || payloads.length !== 1)
    throw new Error(`no journaled FAST decision: ${JSON.stringify(messages.at(-1))}`);
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
  return { fast, record };
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('a style action-change receipt replays exactly', () => {
  it('the production brain applies an option, the receipt is right, and the record replays exactly', async () => {
    const on = await decideFast(true);
    const receipt = on.fast.decision.styleActionReceipt;
    expect(receipt, 'an option applied').toBeDefined();
    expect(receipt!.applied).toContain('styleFoldBluff');
    expect(receipt!.actual).toEqual({
      action: on.fast.decision.action,
      amount: on.fast.decision.amount ?? null,
    });
    // `without` is the same request decided with that one option off (the worker passes it as false)
    let without: HorseDecision | null = null;
    const offDecide: typeof HorseLogic.decide = (p, g, s, m, o, ...rest) => {
      const d = HorseLogic.decide(p, g, s, m, { ...o, [receipt!.option]: false }, ...rest);
      without = d;
      return d;
    };
    await decideFast(true, offDecide);
    expect(receipt!.without).toEqual({
      action: without!.action,
      amount: (without as HorseDecision | null)?.amount ?? null,
    });
    expect(receipt!.changed).toBe(
      receipt!.without!.action !== receipt!.actual.action ||
        (receipt!.without!.amount ?? 0) !== (receipt!.actual.amount ?? 0)
    );
    // the committed decision is what it was: the same request decided with the receipt machinery inert (the
    // applied-option registry emptied after the brain answers, so no re-decision runs) gives the same action,
    // amount and RNG position after
    const inert: typeof HorseLogic.decide = (...args) => {
      const d = HorseLogic.decide(...args);
      clearStyleOptionsApplied();
      return d;
    };
    const base = await decideFast(true, inert);
    expect(base.fast.decision.styleActionReceipt).toBeUndefined();
    expect(base.fast.decision.action).toBe(on.fast.decision.action);
    expect(base.fast.decision.amount ?? null).toBe(on.fast.decision.amount ?? null);
    expect(base.fast.rngAfter).toBe(on.fast.rngAfter);
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(on.fast.decision.action);
  });

  it('every option off: no receipt, and the decision is the base decision', async () => {
    const off = await decideFast(false);
    expect(off.fast.decision.styleActionReceipt).toBeUndefined();
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(off.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
  });
});
