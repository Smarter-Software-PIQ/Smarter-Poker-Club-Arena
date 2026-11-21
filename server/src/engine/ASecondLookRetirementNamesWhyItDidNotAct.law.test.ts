/**
 * LAW: a retired V44 second look names why it did not replace the fast answer,
 * and a journaled DECIDE_DEEP record carries its own isolated ruleReceipts.
 *
 * Regression guard for 48h Omaha audit findings F-03 and M-05:
 *  1. Previously, whenever `ServerTableEngineTurns.secondLookVerdict` returned
 *     `null`, `scheduleHorseAction` retired the deep execution witness as
 *     `'second_look_unchanged'` — lumping discarded deep raises/bets
 *     (`'second_look_wager_ignored'`) and fast `omahaMathCore`-owned decisions
 *     (`'second_look_math_core_kept'`) into `'second_look_unchanged'`.
 *  2. Previously, `withSecondLookFireCapture` dropped `noteDecisionRuleReceipt`
 *     calls so `DECIDE_DEEP` journal records omitted `ruleReceipts` even when
 *     a second look flipped the live table action or proposed a discarded raise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAIN_TELEMETRY_FEATURE_MAX_LENGTH,
  drainFires,
  enableBrainTelemetry,
  noteDecisionRuleReceipt,
  noteFire,
  type DecisionRuleReceipt,
} from './BrainTelemetry.js';
import {
  HORSE_NOT_EXECUTED_RETIREMENT_REASONS,
  createHorseExecutionWitness,
  retireHorseExecutionWitness,
  settleHorseExecutionWitness,
  type HorseExecutionWitness,
} from './HorseExecutionWitness.js';
import { ServerTableEngineTurns } from './ServerTableEngineTurns.js';
import { HorseLogic } from './HorseLogic.js';
import {
  HorseDecisionWorkerRuntime,
  defaultHorseDecisionWorkerDependencies,
} from './horseDecision/workerRuntime.js';
import {
  buildHorseDecisionKey,
  type DeepHorseDecisionRequest,
  type FastHorseDecisionRequest,
  type HorseDecisionWorkerResponse,
} from './horseDecision/protocol.js';
import {
  bindHorseDecisionToCommittedHand,
  captureHorseHandJournalContext,
} from './HorseDecisionHandBinding.js';
import { jointPolicyFixture } from './multiway/JointRangeFixture.test-support.js';
import {
  HorseDecisionJournalPublisher,
  type HorseJournalWorker,
} from '../services/HorseDecisionJournal.js';
import { HorseDecisionJournalStore } from '../services/horseDecisionJournal/store.js';
import { horseLifecycleKeys } from '../services/horseDecisionJournal/lifecycle.js';
import { journalHash, type HorseJournalRecord } from '../services/horseDecisionJournal/record.js';
import { reconcileHorseJournalHand } from '../services/horseDecisionJournal/review.js';
import { kernelReconciledExecutionDisposition } from '../services/horseCorrectiveReview/kernelOriginalInput.js';
import type { HorseDecision } from '../types.js';

const TABLE = '10000000-0000-4000-8000-00000000f03a';
const HAND = 59743208;
const LEASE = '9';
const HAND_KEY = journalHash(`${TABLE}:${HAND}:${LEASE}`);

class InProcessJournalWorker implements HorseJournalWorker {
  private readonly listeners = new Map<string, (message: unknown) => void>();
  constructor(private readonly store: HorseDecisionJournalStore) {}
  on(event: string, fn: (message: unknown) => void) {
    this.listeners.set(event, fn);
  }
  emit(message: unknown) {
    this.listeners.get('message')?.(message);
  }
  async terminate() {
    return 0;
  }
  postMessage(message: Parameters<HorseJournalWorker['postMessage']>[0]) {
    if (message.type === 'STOP') {
      queueMicrotask(() => this.emit({ type: 'STOPPED' }));
      return;
    }
    if (message.type !== 'APPEND') return;
    const statuses = this.store.appendBatch(message.records);
    queueMicrotask(() =>
      this.emit({
        type: 'ACK',
        receipts: message.records.map((r, i) => ({
          eventId: r.eventId,
          sha256: r.sha256,
          status: statuses[i],
        })),
      })
    );
  }
}

const cleanup: Array<() => Promise<void>> = [];

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
});

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  drainFires();
});

function buildFastSnapshot(requestId = 1, generation = 7): FastHorseDecisionRequest {
  const { hero, state } = JSON.parse(
    JSON.stringify(jointPolicyFixture('nlh', 1, 'cash', 'preflop')),
    (_key, v) =>
      typeof v === 'string' && /^p[0-9]$/.test(v)
        ? `20000000-0000-4000-8000-00000000000${Number(v.slice(1)) + 1}`
        : v
  );
  const request: FastHorseDecisionRequest = {
    type: 'DECIDE_FAST',
    requestId,
    generation,
    fence: `${TABLE}:${HAND}:${hero.seat}:${LEASE}:${generation}`,
    decisionTimeMs: Date.UTC(2026, 10, 19, 18, 0, 0) + requestId,
    decisionKey: '',
    player: hero,
    gameState: state,
    opts: {
      phase8Postflop: 'off',
      phase10Plo4: 'off',
      phase11Omaha: 'off',
      phase12Remaining: 'off',
      phase13Joint: 'off',
    },
    handJournalContext: captureHorseHandJournalContext(state.actionHistory),
  };
  request.decisionKey = buildHorseDecisionKey(request);
  return request;
}

function createWorkerHarness(decide: typeof HorseLogic.decide) {
  const scratchRoot = process.env.TMPDIR || tmpdir();
  const directory = mkdtempSync(join(scratchRoot, 'horse-second-look-law-'));
  const store = new HorseDecisionJournalStore(directory);
  const writer = new InProcessJournalWorker(store);
  const publisher = new HorseDecisionJournalPublisher(writer, () => {});
  writer.emit({ type: 'READY' });
  const messages: HorseDecisionWorkerResponse[] = [];
  const decisionPayloads: Array<{
    type: string;
    requestId: number;
    payload: Record<string, unknown>;
  }> = [];
  const recordExecution = (w: HorseExecutionWitness) =>
    publisher.record(
      'execution',
      `${TABLE}:${HAND}:${LEASE}`,
      JSON.stringify([
        w.identity.generation,
        w.identity.fence,
        w.identity.requestId,
        w.identity.decisionKey,
        w.identity.decisionTimeMs,
      ]),
      w
    );
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaultHorseDecisionWorkerDependencies,
    startServices: async () => defaultHorseDecisionWorkerDependencies.workerReadiness(),
    stopServices: async () => {
      await publisher.stop();
    },
    journalEnabled: () => true,
    journalLifecycle: publisher.requestLifecycle.bind(publisher),
    journalDecision: (snapshot, payload) => {
      const s = snapshot as FastHorseDecisionRequest | DeepHorseDecisionRequest;
      decisionPayloads.push({
        type: s.type,
        requestId: s.requestId,
        payload: payload as Record<string, unknown>,
      });
      const keys = horseLifecycleKeys(s);
      publisher.record('decision', keys.hand, keys.turn, payload);
    },
    journalExecution: recordExecution,
    journalAcceptedHand: (h) =>
      publisher.record(
        'accepted_hand',
        `${TABLE}:${HAND}:${LEASE}`,
        `${TABLE}:${HAND}:${LEASE}`,
        h
      ),
    observeCompletedHand: () => {},
    noteFeature: () => {},
    noteDecision: () => {},
    decide,
  });
  cleanup.push(async () => {
    await publisher.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { runtime, store, messages, decisionPayloads, recordExecution };
}

describe('LAW: a retired V44 second look names why it did not replace the fast answer', () => {
  it('partitions every non-replacing second look into its exact reason without changing secondLookVerdict', () => {
    const T = ServerTableEngineTurns;

    // 1. Deep agrees with fast -> second_look_unchanged
    expect(
      T.secondLookDisposition({ action: 'call', amount: 20 }, { action: 'call', amount: 20 })
    ).toEqual({
      kind: 'retire',
      reason: 'second_look_unchanged',
    });
    expect(
      T.secondLookVerdict({ action: 'call', amount: 20 }, { action: 'call', amount: 20 })
    ).toBeNull();

    // 2. Deep proposes a bet or raise (F-03: 27 discarded deep raises in 48h audit) -> second_look_wager_ignored
    for (const fast of [{ action: 'fold' }, { action: 'call', amount: 20 }] as const) {
      for (const deep of [
        { action: 'raise', amount: 60 },
        { action: 'bet', amount: 40 },
      ] as const) {
        expect(T.secondLookDisposition(fast, deep)).toEqual({
          kind: 'retire',
          reason: 'second_look_wager_ignored',
        });
        expect(T.secondLookVerdict(fast, deep)).toBeNull();
      }
    }

    // 3. Fast decision owned by omahaMathCore -> second_look_math_core_kept
    const mathCoreFast = {
      action: 'call',
      amount: 20,
      omahaMathCore: {
        applied: true,
        switch: 'omahaMathCore',
        action: 'call',
        amount: 20,
      } as never,
    };
    expect(T.secondLookDisposition(mathCoreFast, { action: 'fold' })).toEqual({
      kind: 'retire',
      reason: 'second_look_math_core_kept',
    });
    expect(T.secondLookVerdict(mathCoreFast, { action: 'fold' })).toBeNull();

    // 4. Deep exception fallback -> brain_exception
    expect(
      T.secondLookDisposition(
        { action: 'call', amount: 20 },
        { action: 'fold', policyFallback: 'brain_exception' }
      )
    ).toEqual({
      kind: 'retire',
      reason: 'brain_exception',
    });
    expect(
      T.secondLookVerdict(
        { action: 'call', amount: 20 },
        { action: 'fold', policyFallback: 'brain_exception' }
      )
    ).toBeNull();

    // 5. Differing call/fold/all_in replaces fast decision identically
    expect(T.secondLookDisposition({ action: 'call', amount: 20 }, { action: 'fold' })).toEqual({
      kind: 'replace',
      action: 'fold',
      amount: undefined,
    });
    expect(T.secondLookVerdict({ action: 'call', amount: 20 }, { action: 'fold' })).toEqual({
      action: 'fold',
      amount: undefined,
    });
  });

  it('every second-look retirement counter fits BrainTelemetry bounds and SQL daily agreement regex', () => {
    const sqlRegex = /^phase15_deep_execution_retired_([a-z_]+)$/;
    for (const reason of [
      'second_look_unchanged',
      'second_look_wager_ignored',
      'second_look_math_core_kept',
      'brain_exception',
    ] as const) {
      expect(HORSE_NOT_EXECUTED_RETIREMENT_REASONS).toContain(reason);
      const feature = `phase15_deep_execution_retired_${reason}`;
      expect(feature.length).toBeLessThanOrEqual(BRAIN_TELEMETRY_FEATURE_MAX_LENGTH);
      expect(sqlRegex.exec(feature)?.[1]).toBe(reason);
    }
  });

  it('scheduleHorseAction routes non-replacing second looks through secondLookDisposition.reason', () => {
    const turnsPath = fileURLToPath(new URL('./ServerTableEngineTurns.ts', import.meta.url));
    const src = readFileSync(turnsPath, 'utf8');
    expect(src).toContain('const disposition = ServerTableEngineTurns.secondLookDisposition(');
    expect(src).toContain('retireDecision(deepResult.decision, disposition.reason);');
    expect(src).not.toContain("retireDecision(deepResult.decision, 'second_look_unchanged')");
  });

  it('reconciles a discarded deep wager end-to-end as second_look_wager_ignored and journals isolated DECIDE_DEEP ruleReceipts', async () => {
    const { runtime, store, messages, decisionPayloads } = createWorkerHarness(
      (_player, _gs, _style, _mods, opts) => {
        if (opts?.deepEquity && opts.deepEquity > 1) {
          const wager: HorseDecision = { action: 'bet', amount: 10, thinkTime: 1000 };
          noteFire('omaha_aces_measured_reraise_seen');
          noteDecisionRuleReceipt(
            'omaha_aces_measured_reraise',
            { action: 'fold', amount: null },
            wager
          );
          return wager;
        }
        return { action: 'fold', thinkTime: 1200 };
      }
    );
    await runtime.start();

    const fastReq = buildFastSnapshot(1, 7);
    runtime.receive(fastReq);
    await runtime.drain();
    const fastRes = messages.find((m) => m.type === 'FAST_RESULT') as Extract<
      HorseDecisionWorkerResponse,
      { type: 'FAST_RESULT' }
    >;
    expect(fastRes.decision.action).toBe('fold');

    const deepReq: DeepHorseDecisionRequest = {
      ...fastReq,
      type: 'DECIDE_DEEP',
      requestId: 2,
      rngBefore: fastRes.rngBefore,
      deepEquity: 6,
    };
    deepReq.decisionKey = buildHorseDecisionKey(deepReq);
    runtime.receive(deepReq);
    await runtime.drain();
    const deepRes = messages.find((m) => m.type === 'DEEP_RESULT') as Extract<
      HorseDecisionWorkerResponse,
      { type: 'DEEP_RESULT' }
    >;
    expect(deepRes.decision.action).toBe('bet');

    const disposition = ServerTableEngineTurns.secondLookDisposition(
      fastRes.decision,
      deepRes.decision
    );
    expect(disposition).toEqual({ kind: 'retire', reason: 'second_look_wager_ignored' });

    const fastWitness = createHorseExecutionWitness(fastReq, fastRes.decision, {
      requestId: fastReq.requestId,
      lane: 'fast',
      computeMs: fastRes.computeMs,
      governorScale: fastRes.governorScale,
    });
    const deepWitness = createHorseExecutionWitness(deepReq, deepRes.decision, {
      requestId: deepReq.requestId,
      lane: 'deep',
      computeMs: deepRes.computeMs,
      governorScale: deepRes.governorScale,
    });

    const acceptedFoldRecord = {
      seat: fastReq.player.seat,
      userId: fastReq.player.user_id,
      action: 'fold' as const,
      amount: 0,
      stage: 'preflop' as const,
      timestamp: 1000,
    };
    drainFires();
    retireHorseExecutionWitness(
      deepWitness,
      disposition.kind === 'retire' ? disposition.reason : 'second_look_unchanged'
    );
    settleHorseExecutionWitness(fastWitness, {
      applied: true,
      acceptedActions: [
        {
          intended: true,
          record: acceptedFoldRecord,
        },
      ],
    });
    const committedHandId = '30000000-0000-4000-8000-00000000f03a';
    const completedHand = {
      type: 'OBSERVE_COMPLETED_HAND' as const,
      requestId: 5,
      generation: HAND,
      fence: `${TABLE}:${HAND}:${LEASE}:observe`,
      handKey: `${TABLE}:${HAND}`,
      committedHandId,
      bigBlind: 2,
      actions: [
        {
          ...acceptedFoldRecord,
          origin: 'horse_policy' as const,
          observationIdentity: {
            status: 'bound' as const,
            version: 1 as const,
            handId: committedHandId,
            actionOrdinal: 0,
            observationId: `${committedHandId}:0`,
            sessionKey: 'a'.repeat(64),
          } as never,
          publicNode: {
            status: 'captured' as const,
            actorSeat: fastReq.player.seat,
            street: 'preflop' as const,
          } as never,
        },
      ],
    };
    fastWitness.committedHand = bindHorseDecisionToCommittedHand(fastWitness, completedHand);
    const witnessFires = drainFires();
    expect(witnessFires).toContainEqual({
      feature: 'phase15_deep_execution_retired_second_look_wager_ignored',
      fires: 1,
    });
    expect(
      witnessFires.some((f) => f.feature === 'phase15_deep_execution_retired_second_look_unchanged')
    ).toBe(false);

    // Hole cards never enter an execution witness or telemetry key.
    for (const card of fastReq.player.cards ?? []) {
      const cardToken = `${card.rank}${card.suit}`;
      expect(JSON.stringify(deepWitness)).not.toContain(cardToken);
      expect(JSON.stringify(witnessFires)).not.toContain(cardToken);
    }

    runtime.receive({
      type: 'OBSERVE_EXECUTION',
      requestId: 3,
      generation: 7,
      fence: deepReq.fence,
      witness: deepWitness,
    });
    runtime.receive({
      type: 'OBSERVE_EXECUTION',
      requestId: 4,
      generation: 7,
      fence: fastReq.fence,
      witness: fastWitness,
    });
    runtime.receive(completedHand);
    await runtime.drain();
    await Promise.resolve();

    const rows: readonly HorseJournalRecord[] = store.readHand(HAND_KEY);
    const reconciled = reconcileHorseJournalHand(rows, HAND_KEY);
    expect(reconciled).toMatchObject({
      status: 'reconciled',
      gaps: [],
      acceptedHorseActions: 1,
      matchedActions: 1,
      retiredDecisions: 1,
      requestLifecycleVerified: true,
    });

    const execRecords = rows.filter((r) => r.kind === 'execution');
    expect(execRecords).toHaveLength(2);
    const deepExec = execRecords.find((r) => JSON.parse(r.body).identity.lane === 'deep')!;
    const fastExec = execRecords.find((r) => JSON.parse(r.body).identity.lane === 'fast')!;
    expect(kernelReconciledExecutionDisposition(deepExec)).toBe('retired');
    expect(kernelReconciledExecutionDisposition(fastExec)).toBe('accepted');

    // M-05: DECIDE_DEEP carries its own ruleReceipts without polluting DECIDE_FAST.
    const fastPayload = decisionPayloads.find((p) => p.type === 'DECIDE_FAST')!.payload;
    const deepPayload = decisionPayloads.find((p) => p.type === 'DECIDE_DEEP')!.payload;
    expect(deepPayload.ruleReceipts as DecisionRuleReceipt[]).toContainEqual({
      receipt: 'omaha_aces_measured_reraise',
      before: { action: 'fold', amount: null },
      after: { action: 'bet', amount: 10 },
    });
    expect(
      ((fastPayload.ruleReceipts as DecisionRuleReceipt[] | undefined) ?? []).some(
        (r) => r.receipt === 'omaha_aces_measured_reraise'
      )
    ).toBe(false);
  });
});
