/**
 * SWITCH REACH WORKER COUNTERS ARE TELEMETRY ONLY (2026-11-18, Horse Switch lane).
 *
 *  - holdem_option_decision_cash / _tournament: one count per FAST decision whose fire scope holds any holdem_*
 *    receipt, by the request's format; none when no holdem_* receipt fired.
 *  - <style option>_receipt_picked_seen: one count per R1 action-change re-decision that answered, so
 *    <option>_changed_action_seen / <option>_receipt_picked_seen is a rate; none when no option applied.
 *  - 2026-11-19: holdem_option_decision_lightning (the Lightning share, parallel to _cash) and the receipts by format
 *    fmt_<c|t|l>_<key>_seen (receiptBasesByFormat): every holdem_* key in every format, every key in Lightning.
 * Driven through the production HorseDecisionWorkerRuntime with a scripted brain (the harness of
 * aStyleActionReceiptNamesAChangedAction.test.ts), and the committed decision is the brain's answer either way.
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
import {
  noteStyleOptionApplied,
  styleReceiptFormat,
  type StyleActionReceiptOption,
} from '../HorseStyleShadow.js';
import type { HorseDecision } from '../../types.js';
import type {
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
} from './protocol.js';
import { buildHorseDecisionKey } from './protocol.js';
import {
  HorseDecisionWorkerRuntime,
  receiptBasesByFormat,
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
  messages: HorseDecisionWorkerResponse[];
}

async function run(
  script: Script,
  shape: (r: FastHorseDecisionRequest) => FastHorseDecisionRequest = (r) => r,
  throwsOn: (feature: string) => boolean = () => false
): Promise<Run> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const request = shape(riverRequest());
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
      if (throwsOn(k)) throw new Error(`sink refused ${k}`);
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
  return { fast, deep: deep.decision, calls, features, fires: fastFires, messages };
}

const CALL: HorseDecision = { action: 'call', amount: 40, thinkTime: 0 };
const FOLD: HorseDecision = { action: 'fold', thinkTime: 0 };
const holdemSplit = (fs: string[]) => fs.filter((k) => k.startsWith('holdem_option_decision_'));
const picked = (fs: string[]) => fs.filter((k) => k.endsWith('_receipt_picked_seen'));

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('holdem_option_decision_cash / _tournament', () => {
  it('a cash decision with a holdem_* receipt in its scope is counted once, as cash', async () => {
    const r = await run({
      applies: [],
      on: CALL,
      off: {},
      reads: ['holdem_persona_open_shift_seen'],
    });
    expect(r.fast.decision.action).toBe('call');
    expect(holdemSplit(r.features)).toEqual(['holdem_option_decision_cash']);
  });
  // The tournament arm is the same line with gameMode 'tournament'; the replay fixture here is a cash hand and the
  // worker refuses it relabelled as a tournament (settlement chip rules), so that arm is pinned by reading only.
  it('no holdem_* receipt in the scope: nothing counted', async () => {
    const r = await run({ applies: [], on: CALL, off: {}, reads: ['style_fold_bluff_seen'] });
    expect(holdemSplit(r.features)).toEqual([]);
  });
});

describe('<style option>_receipt_picked_seen', () => {
  it('counted once per re-decision that answered, changed or not; the decision is the brain answer', async () => {
    const changed = await run({
      applies: ['styleBigBetHonesty'],
      on: FOLD,
      off: { styleBigBetHonesty: CALL },
    });
    expect(changed.fast.decision.action).toBe('fold');
    expect(picked(changed.features)).toEqual(['style_big_bet_honesty_receipt_picked_seen']);
    expect(changed.features).toContain('style_big_bet_honesty_changed_action_seen');
    const same = await run({
      applies: ['styleBigBetHonesty'],
      on: FOLD,
      off: { styleBigBetHonesty: FOLD },
    });
    expect(same.fast.decision.action).toBe('fold');
    expect(picked(same.features)).toEqual(['style_big_bet_honesty_receipt_picked_seen']);
    expect(same.features).not.toContain('style_big_bet_honesty_changed_action_seen');
  });
  it('no option applied: no re-decision and nothing counted', async () => {
    const r = await run({ applies: [], on: CALL, off: {} });
    expect(picked(r.features)).toEqual([]);
  });
});

describe('receipts by format (2026-11-19): fmt_<c|t|l>_<key>_seen and holdem_option_decision_lightning', () => {
  const fired = new Set([
    'holdem_persona_open_shift_seen',
    'holdem_call_down_needs_style_evidence',
    'style_fold_bluff_seen',
    'decide_lightning',
    'fmt_l_already_seen',
  ]);
  it('cash and tournament: only the holdem_* keys, a trailing _seen not doubled', () => {
    const want = ['holdem_call_down_needs_style_evidence', 'holdem_persona_open_shift'];
    expect(receiptBasesByFormat(fired, 'cash').sort()).toEqual(want);
    expect(receiptBasesByFormat(fired, 'tournament').sort()).toEqual(want);
  });
  it('Lightning: every key, never an fmt_ key again', () => {
    expect(receiptBasesByFormat(fired, 'lightning').sort()).toEqual([
      'decide_lightning',
      'holdem_call_down_needs_style_evidence',
      'holdem_persona_open_shift',
      'style_fold_bluff',
    ]);
    expect(receiptBasesByFormat(new Set(), 'lightning')).toEqual([]);
  });
  const byFormat = (fs: string[]) => fs.filter((k) => k.startsWith('fmt_'));
  it('a cash decision: one fmt_c_ count per holdem_* key that fired (fired twice, counted once), no Lightning share', async () => {
    const r = await run({
      applies: [],
      on: CALL,
      off: {},
      reads: ['holdem_persona_open_shift_seen', 'style_fold_bluff_seen'],
    });
    expect(r.fast.decision.action).toBe('call');
    expect(byFormat(r.features)).toEqual(['fmt_c_holdem_persona_open_shift_seen']);
    expect(holdemSplit(r.features)).toEqual(['holdem_option_decision_cash']);
    expect(r.fires['holdem_persona_open_shift_seen']).toBe(2);
  });
  it('the counters are telemetry only: the same decision, the same brain calls and the same keys fired with or without a holdem_* key', async () => {
    const withKey = await run({
      applies: ['styleBigBetHonesty'],
      on: FOLD,
      off: { styleBigBetHonesty: CALL },
      reads: ['holdem_persona_open_shift_seen'],
    });
    const without = await run({
      applies: ['styleBigBetHonesty'],
      on: FOLD,
      off: { styleBigBetHonesty: CALL },
      reads: ['other_persona_open_shift_seen'],
    });
    expect(withKey.fast.decision).toEqual(without.fast.decision);
    expect(withKey.deep).toEqual(without.deep);
    expect(withKey.calls).toEqual(without.calls);
    expect(byFormat(without.features)).toEqual([]);
    expect(byFormat(withKey.features)).toEqual(['fmt_c_holdem_persona_open_shift_seen']);
  });
  it('a Lightning decision: every key of its scope under l, and the Lightning share beside the cash one', async () => {
    const lightning = (r: FastHorseDecisionRequest): FastHorseDecisionRequest => {
      const shaped = {
        ...r,
        gameState: {
          ...r.gameState,
          publicMemoryDomain: { ...(r.gameState.publicMemoryDomain ?? {}), speed: 'lightning' },
        },
      } as unknown as FastHorseDecisionRequest;
      return { ...shaped, decisionKey: buildHorseDecisionKey(shaped) };
    };
    const r = await run(
      {
        applies: [],
        on: CALL,
        off: {},
        reads: ['holdem_persona_open_shift_seen', 'style_fold_bluff_seen'],
      },
      lightning
    );
    expect(r.fast.decision.action).toBe('call');
    expect(holdemSplit(r.features).sort()).toEqual([
      'holdem_option_decision_cash',
      'holdem_option_decision_lightning',
    ]);
    expect(byFormat(r.features)).toContain('fmt_l_holdem_persona_open_shift_seen');
    expect(byFormat(r.features)).toContain('fmt_l_style_fold_bluff_seen');
    expect(byFormat(r.features).some((k) => k.startsWith('fmt_c_'))).toBe(false);
  });
  it('one format decides every series: a game state carrying only the tournament object is a tournament', () => {
    // The worker derives holdem_option_decision_* and fmt_* from this one call (workerRuntime
    // executeFastWithUpgradeEvidence), so no decision is cash in one series and a tournament in another.
    expect(styleReceiptFormat({ tournament: { id: 'fixture' } })).toBe('tournament');
    expect(styleReceiptFormat({ gameMode: 'tournament' })).toBe('tournament');
    expect(
      styleReceiptFormat({ gameMode: 'cash', publicMemoryDomain: { speed: 'lightning' } })
    ).toBe('lightning');
    expect(styleReceiptFormat({ gameMode: 'cash' })).toBe('cash');
  });
  it('a counter sink that throws after the answer is contained: the request keeps its FAST answer and no ERROR is sent', async () => {
    const reads = ['holdem_persona_open_shift_seen'];
    const clean = await run({ applies: [], on: CALL, off: {}, reads });
    const broken = await run(
      { applies: [], on: CALL, off: {}, reads },
      undefined,
      (k) => k.startsWith('fmt_') || k.startsWith('holdem_option_decision_')
    );
    expect(broken.fast.decision).toEqual(clean.fast.decision);
    expect(broken.deep).toEqual(clean.deep);
    expect(broken.messages.some((m) => m.type === 'ERROR')).toBe(false);
    expect(broken.features).toContain('receipt_format_split_failed_seen');
    expect(byFormat(broken.features)).toEqual([]);
  });
});
