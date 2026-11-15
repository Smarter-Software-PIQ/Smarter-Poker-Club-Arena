/**
 * A STYLE ACTION-CHANGE RECEIPT NAMES A CHANGED ACTION (2026-11-15, R1).
 *
 * The read-time style receipts say a read was made or an input moved. The decision-level receipt
 * (HorseDecision.styleActionReceipt, counter <option>_changed_action_seen) says the committed action moved: the worker
 * decides the same FAST request once more with the one applied option off, from the same RNG position, and compares
 * the final action and amount. Driven through the production HorseDecisionWorkerRuntime with a scripted brain, so
 * every input is fixed and the expected answer is known:
 *  - present and changed exactly when the action without the option differs, and counted once;
 *  - present and unchanged (not counted) when the option applied but the action is the same;
 *  - absent when no option applied, and then the brain is asked once only;
 *  - the committed decision, its RNG position after, and the second look are what they were;
 *  - the read-time receipts are counted at most once per FAST decision and not in the second look.
 */
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { equityGovernor } from '../EquityLoadGovernor.js';
import { fastRandom, restoreFastRandom, saveFastRandom } from '../HorseEval.js';
import { drainFires, enableBrainTelemetry, noteFire } from '../BrainTelemetry.js';
import { liveHorsePhase8Safety } from '../HorsePhase8Safety.js';
import { prepareTournamentFutureHandFacts } from '../HorseTournamentFutureHand.js';
import { solverPolicyArtifactStatus } from '../../gto/SolverPolicyArtifactLoader.js';
import { noteStyleOptionApplied, type StyleActionReceiptOption } from '../HorseStyleShadow.js';
import type { HorseDecision } from '../../types.js';
import type {
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
} from './protocol.js';
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
import {
  PHASE6C_FIXTURE_IDS as IDS,
  phase6cFixtureBody,
  phase6cFixtureRecord,
} from './replay/fixtures/index.js';

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

const allOn = (): StyleSwitchStates =>
  Object.fromEntries(STYLE_SWITCH_OPTIONS.map((o) => [o, 'on'])) as StyleSwitchStates;

function riverRequest(): FastHorseDecisionRequest {
  const base = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const request = {
    ...base,
    decisionTimeMs: DECISION_TIME_MS,
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

type Opts = Record<string, unknown>;
/** A scripted brain: what it answers with and without each option, and what it notes on the way. */
interface Script {
  applies: StyleActionReceiptOption[];
  /** the answer when every applied option is on, and the answer when `option` is off */
  on: HorseDecision;
  off: Partial<Record<StyleActionReceiptOption, HorseDecision>>;
  /** read-time receipts the brain fires on every call (twice, as a bettor read at two places would) */
  reads?: string[];
}

interface Run {
  fast: FastHorseDecisionResult;
  deep: HorseDecision;
  calls: Opts[];
  features: string[];
  fires: Record<string, number>;
}

async function run(script: Script): Promise<Run> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = riverRequest();
  const calls: Opts[] = [];
  const features: string[] = [];
  const messages: HorseDecisionWorkerResponse[] = [];
  const brain = (
    _p: unknown,
    _g: unknown,
    _s: unknown,
    _m: unknown,
    opts: Opts = {}
  ): HorseDecision => {
    calls.push(opts);
    fastRandom();
    fastRandom();
    for (const k of script.reads ?? []) {
      noteFire(k);
      noteFire(k);
    }
    let answer = script.on;
    for (const o of script.applies) {
      if (opts[o] === false) answer = script.off[o] ?? script.on;
      else noteStyleOptionApplied(o);
    }
    return { ...answer };
  };
  const deps: HorseDecisionWorkerDependencies = {
    ...qualifiedReplayAdmissions,
    journalEnabled: () => false,
    async startServices() {
      prepareTournamentFutureHandFacts();
      return readiness();
    },
    async stopServices() {},
    decide: brain as never,
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
    noteFeature: (k: string) => {
      features.push(k);
    },
    now: () => performance.now(),
    styleSwitch: new StyleSwitchHolder(styleSwitchSourceFromStates(allOn()), () => {}),
  };
  enableBrainTelemetry();
  drainFires();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(request);
  await runtime.drain();
  const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (!fast) throw new Error(`no FAST result: ${JSON.stringify(messages.at(-1))}`);
  const fastFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
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
    | { decision: HorseDecision }
    | undefined;
  if (!deep) throw new Error(`no DEEP result: ${JSON.stringify(messages.at(-1))}`);
  const deepFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  for (const [k, n] of Object.entries(deepFires)) fastFires[`deep:${k}`] = n;
  return { fast, deep: deep.decision, calls, features, fires: fastFires };
}

const CALL: HorseDecision = { action: 'call', amount: 40, thinkTime: 0 };
const FOLD: HorseDecision = { action: 'fold', thinkTime: 0 };
const RAISE: HorseDecision = { action: 'raise', amount: 120, thinkTime: 0 };
const changedKeys = (fs: string[]) => fs.filter((k) => k.endsWith('_changed_action_seen'));

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('a style action-change receipt names a changed action', () => {
  it('present and counted once when the action without the applied option differs', async () => {
    const r = await run({
      applies: ['styleBigBetHonesty'],
      on: FOLD,
      off: { styleBigBetHonesty: CALL },
    });
    expect(r.fast.decision.action).toBe('fold');
    expect(r.fast.decision.styleActionReceipt).toEqual({
      version: 1,
      option: 'styleBigBetHonesty',
      applied: ['styleBigBetHonesty'],
      changed: true,
      actual: { action: 'fold', amount: null },
      without: { action: 'call', amount: 40 },
    });
    expect(changedKeys(r.features)).toEqual(['style_big_bet_honesty_changed_action_seen']);
    // the FAST look asked the brain twice (committed, then without the option); the re-decision ran with the
    // option off, telemetry off, observation off and no shadow list
    expect(r.calls.length).toBe(3);
    expect(r.calls[1]).toMatchObject({
      styleBigBetHonesty: false,
      telemetry: false,
      observeMind: false,
      styleShadow: [],
    });
    expect(r.calls[2]).toMatchObject({ styleBigBetHonesty: true, telemetry: false });
  });

  it('an amount alone counts as a change', async () => {
    const r = await run({
      applies: ['styleValueExtraction'],
      on: RAISE,
      off: { styleValueExtraction: { ...RAISE, amount: 96 } },
    });
    expect(r.fast.decision.styleActionReceipt?.changed).toBe(true);
    expect(changedKeys(r.features)).toEqual(['style_value_extraction_changed_action_seen']);
  });

  it('present and not counted when the option applied and the action is the same', async () => {
    const r = await run({ applies: ['styleFoldBluff'], on: CALL, off: { styleFoldBluff: CALL } });
    expect(r.fast.decision.styleActionReceipt).toMatchObject({
      option: 'styleFoldBluff',
      changed: false,
      without: { action: 'call', amount: 40 },
    });
    expect(changedKeys(r.features)).toEqual([]);
  });

  it('absent when no option applied, and the brain is asked once by the FAST look', async () => {
    const r = await run({ applies: [], on: CALL, off: {} });
    expect(r.fast.decision.styleActionReceipt).toBeUndefined();
    expect(changedKeys(r.features)).toEqual([]);
    expect(r.calls.length).toBe(2); // FAST, DEEP
  });

  it('the committed decision, its RNG position after and the second look do not depend on the receipt', async () => {
    const withReceipt = await run({
      applies: ['styleRaiseRespect'],
      on: FOLD,
      off: { styleRaiseRespect: CALL },
    });
    const without = await run({ applies: [], on: FOLD, off: {} });
    expect(withReceipt.fast.decision.action).toBe(without.fast.decision.action);
    expect(withReceipt.fast.rngAfter).toBe(without.fast.rngAfter);
    expect(withReceipt.fast.rngBefore).toBe(without.fast.rngBefore);
    expect(withReceipt.deep.action).toBe(without.deep.action);
    expect(withReceipt.deep.styleActionReceipt).toBeUndefined();
    const { styleActionReceipt: _r, ...rest } = withReceipt.fast.decision;
    expect(rest).toEqual(without.fast.decision);
  });

  it('several applied options: one is re-decided, picked by the decision key, the same pick every time', async () => {
    const script: Script = {
      applies: ['styleBigBetHonesty', 'styleFoldBluff', 'styleRaiseRespect'],
      on: FOLD,
      off: { styleBigBetHonesty: CALL, styleFoldBluff: CALL, styleRaiseRespect: CALL },
    };
    const a = await run(script);
    const b = await run(script);
    expect(a.fast.decision.styleActionReceipt?.applied).toEqual([
      'styleBigBetHonesty',
      'styleRaiseRespect',
      'styleFoldBluff',
    ]);
    expect(a.fast.decision.styleActionReceipt).toEqual(b.fast.decision.styleActionReceipt);
    expect(changedKeys(a.features).length).toBe(1);
    expect(a.calls.length).toBe(3);
  });

  it('read-time receipts count once per FAST decision, never in the re-decision or the second look', async () => {
    const r = await run({
      applies: ['styleFoldBluff'],
      on: FOLD,
      off: { styleFoldBluff: CALL },
      reads: ['style_fold_bluff_seen', 'style_label_tight-passive_seen', 'v16_reads_cbet'],
    });
    expect(r.fires['style_fold_bluff_seen']).toBe(1);
    expect(r.fires['style_label_tight-passive_seen']).toBe(1);
    expect(r.fires['deep:style_fold_bluff_seen']).toBeUndefined();
    expect(r.fires['deep:style_label_tight-passive_seen']).toBeUndefined();
    // an ordinary receipt is untouched: counted at each call in the FAST look, and in the second look as before
    expect(r.fires['v16_reads_cbet']).toBe(2);
    expect(r.fires['deep:v16_reads_cbet']).toBe(2);
  });
});
