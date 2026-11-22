/**
 * AN OPTION IN ON_SHADOW ACTS EXACTLY AS ON (2026-11-19, Horse Switch lane, HorseOptionSwitch / HorseOptionShadow).
 *
 * `shadow` passes nothing to the acted decision, so for a rule that is OFF in source and ON in production only by an
 * 'on' row (DEFAULT-ON-AUDIT F1: every categorical PLO rule) a shadow row would switch the rule off on live tables.
 * `on_shadow` passes `<option>: true` to the acted decision exactly as 'on' and re-decides once with false, counted
 * option_shadow_<option>_<changed|same>_seen like shadow. Driven through the production HorseDecisionWorkerRuntime
 * (the harness of anOptionInShadowNeverChangesTheActedDecision.test.ts):
 *  - with a scripted brain: the acted call carries true, the one re-decision false, the receipt and its counter;
 *  - with the production brain over every recorded FAST decision of the phase 6C journal sample, for three
 *    categorical PLO rules: the FAST result as it travels (decision, RNG positions, effects, governor scale) of an
 *    on_shadow row is byte-identical to that of an 'on' row, and every re-decision passed false.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { equityGovernor } from '../EquityLoadGovernor.js';
import { fastRandom, restoreFastRandom, saveFastRandom } from '../HorseEval.js';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import { liveHorsePhase8Safety } from '../HorsePhase8Safety.js';
import { prepareTournamentFutureHandFacts } from '../HorseTournamentFutureHand.js';
import { solverPolicyArtifactStatus } from '../../gto/SolverPolicyArtifactLoader.js';
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
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_SHADOW_NAMES,
  optionSwitchDecisionOpts,
  optionSwitchShadowFlip,
  optionSwitchShadowOptions,
  optionSwitchStatesFrom,
  optionSwitchStatesOf,
  OptionSwitchHolder,
  optionSwitchSourceFromStates,
  type OptionSwitchStates,
} from '../HorseOptionSwitch.js';
import { currentReplaySolverStores } from './replay/references.js';
import { stableReceipt } from './replay/HorseDecisionReplay.js';
import { qualifiedReplayAdmissions } from './replay/qualifiedAuthority.js';
import {
  PHASE6C_FIXTURE_IDS as IDS,
  loadPhase6cFixtureRecords,
  phase6cFixtureBody,
  phase6cFixtureRecord,
} from './replay/fixtures/index.js';

const SEED = 20261118;
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

function fastRequest(snapshot: FastHorseDecisionRequest, requestId = 1): FastHorseDecisionRequest {
  const request = {
    ...snapshot,
    requestId,
    decisionTimeMs: DECISION_TIME_MS,
  } as unknown as FastHorseDecisionRequest;
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}
const riverSnapshot = () =>
  phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(phase6cFixtureRecord(IDS.cashNlhRiver))
    .snapshot;

/** Every recorded FAST decision of the journal sample. */
const recordedFast = (): Array<{ id: string; snapshot: FastHorseDecisionRequest }> =>
  loadPhase6cFixtureRecords()
    .filter((r) => r.kind === 'decision')
    .map((r) => ({
      id: String((r as { recordId?: string }).recordId ?? r.turnKey).slice(0, 12),
      snapshot: phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(r).snapshot,
    }))
    .filter((x) => x.snapshot?.type === 'DECIDE_FAST');

type Opts = Record<string, unknown>;
type Decide = (p: unknown, g: unknown, s: unknown, m: unknown, o?: Opts) => HorseDecision;

interface Run {
  fasts: FastHorseDecisionResult[];
  calls: Opts[];
  features: string[];
  latency: Array<[string, number]>;
}

async function run(
  requests: FastHorseDecisionRequest[],
  decide: Decide,
  states: OptionSwitchStates | null,
  extra: Partial<HorseDecisionWorkerDependencies> = {}
): Promise<Run> {
  HorseMind.reset();
  restoreFastRandom(SEED);
  const calls: Opts[] = [];
  const features: string[] = [];
  const latency: Array<[string, number]> = [];
  const messages: HorseDecisionWorkerResponse[] = [];
  const deps: HorseDecisionWorkerDependencies = {
    ...qualifiedReplayAdmissions,
    journalEnabled: () => false,
    async startServices() {
      prepareTournamentFutureHandFacts();
      return readiness();
    },
    async stopServices() {},
    decide: ((...args: Parameters<Decide>) => {
      calls.push({ ...(args[4] ?? {}) });
      return decide(...args);
    }) as never,
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
    noteDecision: (scope: string, ms: number) => {
      latency.push([scope, ms]);
    },
    noteFeature: (k: string) => {
      features.push(k);
    },
    // a fixed worker clock: the 15 ms and per-minute budgets are tested on purpose below, never by machine load (the
    // re-decision's own cost is timed on performance.now inside the worker)
    now: () => 1_000,
    optionSwitch: new OptionSwitchHolder(optionSwitchSourceFromStates(states), () => {}),
    optionShadowPerMinute: 1000,
    ...extra,
  };
  enableBrainTelemetry();
  drainFires();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  for (const request of requests) {
    runtime.receive(request);
    await runtime.drain();
  }
  const fasts = messages.filter((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (fasts.length !== requests.length)
    throw new Error(`expected ${requests.length} FAST results: ${JSON.stringify(messages.at(-1))}`);
  drainFires();
  return { fasts, calls, features, latency };
}

const CALL: HorseDecision = { action: 'call', amount: 40, thinkTime: 0 };
const FOLD: HorseDecision = { action: 'fold', thinkTime: 0 };
const RAISE: HorseDecision = { action: 'raise', amount: 120, thinkTime: 0 };
/** Answers `on` unless the decision options carry `option: flippedValue`. */
const scripted =
  (option: string, flippedValue: boolean, acted: HorseDecision, flipped: HorseDecision): Decide =>
  (_p, _g, _s, _m, o = {}) => {
    fastRandom();
    fastRandom();
    return { ...(o[option] === flippedValue ? flipped : acted) };
  };
const shadowKeys = (fs: string[]) => fs.filter((k) => k.startsWith('option_shadow_'));
/** A FAST result as it travels, without the worker's per-process authority epochs (a random UUID per worker). */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const comparable = (fast: FastHorseDecisionResult) => {
  const { optionShadowReceipt: _r, ...decision } = fast.decision;
  // the exact-replay comparison form: timings (latencyMs, policyMs, ...) dropped, everything else kept
  return JSON.stringify({
    decision: stableReceipt(decision),
    rngBefore: fast.rngBefore,
    rngAfter: fast.rngAfter,
    effects: fast.effects,
    governorScale: fast.governorScale,
    planIssueDisposition: fast.planIssueDisposition,
  }).replace(UUID, '<epoch>');
};

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

/** Categorical PLO rules: OFF in source (every read `=== true`), ON in production by an 'on' row; 'code' release default. */
const PLO_RULES = [
  'omahaBareOverpairOopFlopCheck',
  'omahaPressureNeedsPostflopAggression',
  'omahaUnderpairNoMultiwayFlopContinue',
] as const;

describe('the registry offers on_shadow to the ON-by-row PLO rules, and never shadow', () => {
  it('each takes off, on_shadow and on; on_shadow passes true exactly as on; its re-decision passes false', () => {
    for (const option of PLO_RULES) {
      expect(OPTION_SWITCH_ON_SHADOW_NAMES, option).toContain(option);
      // shadow would act with the rule OFF on live tables: it is still refused for them
      expect(OPTION_SWITCH_SHADOW_NAMES, option).not.toContain(option);
      expect(optionSwitchStatesOf(option), option).toEqual(['off', 'on_shadow', 'on']);
      expect(optionSwitchStatesFrom({ [option]: 'shadow' }), option).toBeNull();
      expect(optionSwitchStatesFrom({ [option]: 'on_shadow' }), option).toEqual({
        [option]: 'on_shadow',
      });
      expect(optionSwitchDecisionOpts({ [option]: 'on_shadow' }), option).toEqual(
        optionSwitchDecisionOpts({ [option]: 'on' })
      );
      expect(optionSwitchDecisionOpts({ [option]: 'on_shadow' }), option).toEqual({
        [option]: true,
      });
      expect(optionSwitchShadowOptions({ [option]: 'on_shadow' }), option).toEqual([option]);
      expect(optionSwitchShadowOptions({ [option]: 'on' }), option).toEqual([]);
      expect(optionSwitchShadowFlip(option, { [option]: true }, 'on_shadow'), option).toBe(false);
      // without the state (shadow's rule) a 'code' option has no flip: nothing is guessed
      expect(optionSwitchShadowFlip(option, {}), option).toBeNull();
    }
  });
});

describe('a scripted brain: on_shadow acts with true and re-decides once with false', () => {
  for (const option of PLO_RULES)
    it(`${option}: the acted call carries true, the one re-decision false, and the receipt counts it`, async () => {
      // answers fold when the rule is on, call when the re-decision turns it off
      const r = await run([fastRequest(riverSnapshot())], scripted(option, false, FOLD, CALL), {
        [option]: 'on_shadow',
      } as OptionSwitchStates);
      expect(r.fasts[0]!.decision.action).toBe('fold');
      expect(r.calls).toHaveLength(2);
      expect(r.calls[0]![option]).toBe(true);
      expect(r.calls[1]).toMatchObject({
        [option]: false,
        telemetry: false,
        observeMind: false,
        styleShadow: [],
      });
      expect(r.fasts[0]!.decision.optionShadowReceipt).toMatchObject({
        version: 1,
        option,
        flippedTo: false,
        changed: true,
      });
      expect(shadowKeys(r.features)).toContain(`option_shadow_${option}_changed_seen`);
      // an 'on' row: the same acted call, no re-decision, nothing of the shadow counted
      const on = await run([fastRequest(riverSnapshot())], scripted(option, false, FOLD, CALL), {
        [option]: 'on',
      } as OptionSwitchStates);
      expect(on.calls).toEqual([r.calls[0]]);
      expect(comparable(on.fasts[0]!)).toBe(comparable(r.fasts[0]!));
      expect(shadowKeys(on.features)).toEqual([]);
    });
});

describe('the production brain over every recorded FAST decision: on_shadow is byte-identical to on', () => {
  const fixtures = recordedFast();
  it('the journal sample carries recorded FAST decisions', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
  });
  const decide = HorseLogic.decide.bind(HorseLogic) as unknown as Decide;

  for (const option of PLO_RULES)
    it(`${option} in on_shadow: every acted decision, RNG position and effect is that of an on row; every re-decision passed false`, async () => {
      const requests = fixtures.map((f, i) => fastRequest(f.snapshot, i + 1));
      const on = await run(requests, decide, { [option]: 'on' } as OptionSwitchStates);
      const onShadow = await run(requests, decide, { [option]: 'on_shadow' } as OptionSwitchStates);
      const a = onShadow.fasts.map(comparable);
      const b = on.fasts.map(comparable);
      for (let i = 0; i < b.length; i++) {
        let at = 0;
        while (at < b[i]!.length && a[i]![at] === b[i]![at]) at++;
        expect(a[i]!.slice(Math.max(0, at - 80), at + 80), `${fixtures[i]!.id}`).toBe(
          b[i]!.slice(Math.max(0, at - 80), at + 80)
        );
      }
      expect(a).toEqual(b);
      // the acted calls are the on row's calls (true), the re-decisions (telemetry off) passed false
      const acted = onShadow.calls.filter((c) => c.telemetry !== false);
      const redecided = onShadow.calls.filter((c) => c.telemetry === false);
      expect(JSON.stringify(acted)).toBe(JSON.stringify(on.calls));
      expect(on.calls.every((c) => c[option] === true)).toBe(true);
      expect(redecided.length).toBeGreaterThan(0);
      expect(redecided.every((c) => c[option] === false)).toBe(true);
      const receipts = onShadow.fasts.map((f) => f.decision.optionShadowReceipt).filter(Boolean);
      expect(receipts).toHaveLength(redecided.length);
      for (const r of receipts) expect(r).toMatchObject({ option, flippedTo: false });
      const outcomes = onShadow.features.filter(
        (k) => /^option_shadow_.*_(changed|same)_seen$/.test(k) && !k.includes('_person_')
      );
      expect(outcomes).toHaveLength(receipts.filter((r) => r!.would !== null).length);
      for (const k of outcomes) expect(k.startsWith(`option_shadow_${option}_`), k).toBe(true);
      // the on row ran no re-decision and counted nothing of the shadow
      expect(on.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
      expect(shadowKeys(on.features)).toEqual([]);
    });
});
