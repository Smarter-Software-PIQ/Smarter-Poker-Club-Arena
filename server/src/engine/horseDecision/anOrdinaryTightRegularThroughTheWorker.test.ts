/**
 * AN ORDINARY TIGHT REGULAR THROUGH THE DECISION WORKER (2026-11-15).
 *
 * anOrdinaryTightRegularIsReadAsTight.law.test.ts drives the observer reads the worker owns. This file drives the
 * worker itself, the way a live read travels: an accepted hand reaches a HorseDecisionWorkerRuntime as
 * OBSERVE_COMPLETED_HAND carrying the opponent's pooled public row (his 27 counters and the 120-hand long participation
 * window the database learner keeps, horse_exact_profiles.long_counters), the Horse's next decision is requested as
 * DECIDE_FAST, the second look as DECIDE_DEEP, and the journaled decision is replayed exactly. Nothing is installed
 * through HorseMind.importDurableOpponentProfiles and no read view is substituted.
 *
 * The spot is the journal's own cash river hand. The opponent's row is 300 hands of a regular between the 30-hand and
 * the 120-hand ceilings of the spot's table size (full ring 14% / 7%, short-handed 26% / 15%, heads-up 33% / 25%):
 * readable as tight only from the long window. Every style option is on except the fold-rate pre-repair discount (it
 * reads other statistics), so the brain takes his style read; each look, and the replay, must read him tight.
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
import {
  EXPLOIT_COUNTER_FIELDS,
  exploitHandIncrements,
  observeExploitRow,
  type ExploitCounters,
} from '../HorseOpponentExploit.js';
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
const WATCHER = '20000000-0000-4000-8000-0000000000b2';
const SEED = 20261115;
const LONG_DECAY = Math.pow(0.5, 1 / 120);
const PHI = (Math.sqrt(5) - 1) / 2;

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

/** The journal's cash river decision, dealt at a table-speed table. */
function riverRequest(): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const request = {
    ...base,
    // The pooled row is learned now; a decision fenced before it could not read it.
    decisionTimeMs: Date.now() + 60_000,
    gameState: { ...base.gameState, publicMemoryDomain: TABLE },
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

/** 300 hands of a regular between the two ceilings of this table size, as the accepted-hand database learner keeps
 * them: counters and long window. */
function tightRow(villainId: string, size: 'hu' | 'short' | 'full') {
  const [vpip, pfr] =
    size === 'full' ? [0.14, 0.07] : size === 'short' ? [0.26, 0.15] : [0.33, 0.25];
  const rows = new Map<string, ExploitCounters>();
  const long = { lHands: 0, lVpip: 0, lPfr: 0 };
  for (let n = 0; n < 300; n++) {
    const u = ((n + 1) * PHI) % 1;
    const action = u < pfr ? 'raise' : u < vpip ? 'call' : 'fold';
    const inc = exploitHandIncrements([
      {
        userId: villainId,
        stage: 'preflop',
        action,
        origin: 'player',
        amount: 2,
        isFullRaise: action === 'raise' ? true : undefined,
      },
    ]).get(villainId)!;
    observeExploitRow(rows, villainId, inc, 1_000_000, true);
    long.lHands = long.lHands * LONG_DECAY + inc.hands;
    long.lVpip = long.lVpip * LONG_DECAY + inc.vpip;
    long.lPfr = long.lPfr * LONG_DECAY + inc.pfr;
  }
  const row = rows.get(villainId)!;
  return {
    counters: Object.fromEntries(
      EXPLOIT_COUNTER_FIELDS.map((f) => [f, row[f]])
    ) as unknown as ExploitCounters,
    long_counters: long,
  };
}

/** An earlier accepted hand at the same kind of table, carrying the opponent's pooled public row. */
function acceptedHand(
  request: FastHorseDecisionRequest,
  villainId: string,
  withLong: boolean
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
  const size = dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full';
  const row = tightRow(villainId, size);
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${tableId}:${number}:${lease}:observe`,
    handKey: `${tableId}:${number}`,
    committedHandId: '40000000-0000-4000-8000-000000000002',
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
        counters: row.counters,
        ...(withLong ? { long_counters: row.long_counters } : {}),
      },
    ],
  } as never;
}

interface Seen {
  participation: string;
  longWindow: readonly string[];
}
interface Outcome {
  fast: FastHorseDecisionResult;
  deepAction: string;
  deepAmount: number | null;
  reads: { fast: Seen[]; deep: Seen[] };
  frameVersion: string;
  frameCarriesLong: boolean;
  record: ReturnType<typeof makeHorseJournalRecord>;
}

/** One accepted hand, then FAST and DEEP for the river decision, through the production runtime. */
async function throughTheWorker(withLong: boolean, log: Seen[]): Promise<Outcome> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = riverRequest();
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
  runtime.receive(acceptedHand(request, villainId, withLong));
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
    frameCarriesLong: frame.json.includes('exploitLong'),
    record,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

/** Record the style read the brain took of the opponent, whichever look or replay asks. */
function watchStyle(villainId: () => string): Seen[] {
  const log: Seen[] = [];
  const original = HorseMind.styleRead.bind(HorseMind);
  vi.spyOn(HorseMind, 'styleRead').mockImplementation((userId: string) => {
    const read = original(userId);
    if (userId === villainId())
      log.push({ participation: read.participation.side, longWindow: read.receipt.longWindow });
    return read;
  });
  return log;
}

describe('an ordinary tight regular through the decision worker', () => {
  const villain = () => {
    const request = riverRequest();
    return request.gameState.players.find(
      (q) => !q.is_folded && q.user_id !== request.player.user_id
    )!.user_id;
  };

  it('FAST, DEEP and the exact replay of the journaled decision all read him tight from the long window', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const on = await throughTheWorker(true, log);
    for (const look of [on.reads.fast, on.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.participation === 'tight')).toBe(true);
      expect(look.every((r) => r.longWindow.includes('vpip'))).toBe(true);
    }
    expect(on.frameVersion).toBe('horse-decision-reads-v15');
    expect(on.frameCarriesLong).toBe(true);
    expect(on.deepAction).toBe(on.fast.decision.action);

    // An exact replay in a process that holds none of this one's pooled rows.
    HorseMind.reset();
    log.length = 0;
    const verdict = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
    expect(verdict.replayed?.action).toBe(on.fast.decision.action);
    expect(verdict.replayed?.amount).toBe(on.fast.decision.amount ?? null);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.participation === 'tight')).toBe(true);
    log.length = 0;
    const again = await exactReplayHorseDecisionRecord(on.record, { runningSource: SOURCE });
    expect(again.outcome).toBe('replayed_exact');
    expect(again.replayed).toEqual(verdict.replayed);
  });

  it('the same row without its long window (a row before the migration): the 30-hand read, neutral', async () => {
    const id = villain();
    const log = watchStyle(() => id);
    const before = await throughTheWorker(false, log);
    for (const look of [before.reads.fast, before.reads.deep]) {
      expect(look.length).toBeGreaterThan(0);
      expect(look.every((r) => r.participation === 'neutral')).toBe(true);
      expect(look.every((r) => r.longWindow.length === 0)).toBe(true);
    }
    expect(before.frameCarriesLong).toBe(false);
    expect(before.frameVersion).not.toBe('horse-decision-reads-v15');
    HorseMind.reset();
    const verdict = await exactReplayHorseDecisionRecord(before.record, { runningSource: SOURCE });
    expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
  });
});
