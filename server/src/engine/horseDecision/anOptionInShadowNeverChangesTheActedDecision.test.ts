/**
 * AN OPTION IN SHADOW NEVER CHANGES THE ACTED DECISION (2026-11-18, Horse Switch lane, HorseOptionShadow).
 *
 * A non-style option switched to `shadow` passes nothing to the brain, so the acted decision is the release
 * default's; the worker re-decides the committed decision once with the option flipped (the style action-receipt
 * mechanism) and records HorseDecision.optionShadowReceipt plus option_shadow_<option>_<changed|same>[_person]_seen.
 * Driven through the production HorseDecisionWorkerRuntime:
 *  - with a scripted brain, every input fixed: the receipt and its counters, the person split, the rotation, the
 *    per-minute budget and the 15 ms budget;
 *  - with the production brain over every recorded FAST decision of the phase 6C journal sample: the acted decision,
 *    its RNG positions and its plan effects in shadow are those of no row at all, for options on by default and off
 *    by default; and off / on rows run no re-decision and carry no receipt (byte-identical to before);
 *  - the per-decision cost of one shadow re-decision, measured.
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
  OPTION_SWITCH_SHADOW_NAMES,
  optionSwitchShadowFlip,
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

// streetIQ is on by default (the flip passes false); omahaTurnRiverRaiseIsPriced is off by default (the flip passes true).
const ON_BY_DEFAULT = 'streetIQ';
const OFF_BY_DEFAULT = 'omahaTurnRiverRaiseIsPriced';

/** Classified release default ON on 2026-11-19 from their reads (they had been 'code', refused shadow). */
const DEFAULT_ON_20261119 = [
  'v9',
  'v10',
  'v86PloOverhaul',
  'omahaEvFoldModel',
  'facingClosedAllIn',
] as const;

describe('2026-11-19: a default-on option in shadow re-decides with false and acts with the source default', () => {
  it('the five options classified ON from their reads take shadow and flip to false', () => {
    for (const option of DEFAULT_ON_20261119) {
      expect(OPTION_SWITCH_SHADOW_NAMES, option).toContain(option);
      expect(optionSwitchShadowFlip(option, {}), option).toBe(false);
      // an explicit value carried by the decision options is what is flipped
      expect(optionSwitchShadowFlip(option, { [option]: false }), option).toBe(true);
    }
  });
  for (const option of DEFAULT_ON_20261119)
    it(`${option}: the acted decision carries no value for it, the one re-decision carries false`, async () => {
      const r = await run([fastRequest(riverSnapshot())], scripted(option, false, FOLD, CALL), {
        [option]: 'shadow',
      } as OptionSwitchStates);
      expect(r.fasts[0]!.decision.action).toBe('fold');
      expect(r.calls).toHaveLength(2);
      expect(Object.hasOwn(r.calls[0]!, option)).toBe(false);
      expect(r.calls[1]).toMatchObject({ [option]: false, telemetry: false, observeMind: false });
      expect(r.fasts[0]!.decision.optionShadowReceipt).toMatchObject({
        option,
        flippedTo: false,
        changed: true,
      });
    });
});

describe('the registry offers shadow to the options it can re-decide', () => {
  it('the two options of these tests take shadow', () => {
    expect(OPTION_SWITCH_SHADOW_NAMES).toContain(ON_BY_DEFAULT);
    expect(OPTION_SWITCH_SHADOW_NAMES).toContain(OFF_BY_DEFAULT);
  });
});

describe('a scripted brain: the receipt, its counters and its budgets', () => {
  it('shadow passes nothing to the acted decision, re-decides once flipped, and receipts a change', async () => {
    const r = await run(
      [fastRequest(riverSnapshot())],
      scripted(ON_BY_DEFAULT, false, FOLD, CALL),
      { [ON_BY_DEFAULT]: 'shadow' }
    );
    const fast = r.fasts[0]!;
    expect(fast.decision.action).toBe('fold');
    // the acted call carried no value for the option; the one re-decision carried the flipped value, counters off
    expect(r.calls).toHaveLength(2);
    expect(Object.hasOwn(r.calls[0]!, ON_BY_DEFAULT)).toBe(false);
    expect(r.calls[1]).toMatchObject({
      [ON_BY_DEFAULT]: false,
      telemetry: false,
      observeMind: false,
      styleShadow: [],
    });
    expect(fast.decision.optionShadowReceipt).toMatchObject({
      version: 1,
      option: ON_BY_DEFAULT,
      flippedTo: false,
      changed: true,
      actual: { action: 'fold', amount: null },
      would: { action: 'call', amount: 40 },
      street: 'river',
      format: 'cash',
    });
    expect(shadowKeys(r.features).filter((k) => !k.includes('_person_'))).toEqual([
      `option_shadow_${ON_BY_DEFAULT}_changed_seen`,
    ]);
    expect(r.latency.filter(([s]) => s === 'option_shadow_redecide')).toHaveLength(1);
  });

  it('an option off by default is flipped on; the same action is counted as same', async () => {
    const r = await run(
      [fastRequest(riverSnapshot())],
      scripted(OFF_BY_DEFAULT, true, CALL, CALL),
      { [OFF_BY_DEFAULT]: 'shadow' }
    );
    expect(r.calls[1]).toMatchObject({ [OFF_BY_DEFAULT]: true });
    expect(r.fasts[0]!.decision.optionShadowReceipt).toMatchObject({
      flippedTo: true,
      changed: false,
    });
    expect(shadowKeys(r.features).filter((k) => !k.includes('_person_'))).toEqual([
      `option_shadow_${OFF_BY_DEFAULT}_same_seen`,
    ]);
  });

  it('an amount alone is a change', async () => {
    const r = await run(
      [fastRequest(riverSnapshot())],
      scripted(OFF_BY_DEFAULT, true, RAISE, { ...RAISE, amount: 96 }),
      { [OFF_BY_DEFAULT]: 'shadow' }
    );
    expect(r.fasts[0]!.decision.optionShadowReceipt?.changed).toBe(true);
  });

  it('the person split: _person_ fires exactly when a seat that is not a Horse was dealt in', async () => {
    const base = riverSnapshot();
    const hero = base.player.user_id;
    const withPerson = {
      ...base,
      gameState: {
        ...base.gameState,
        players: base.gameState.players.map((p) =>
          p.user_id === hero ? p : { ...p, is_horse: false, is_sitting_out: false }
        ),
      },
    } as FastHorseDecisionRequest;
    const allHorses = {
      ...base,
      gameState: {
        ...base.gameState,
        players: base.gameState.players.map((p) => ({ ...p, is_horse: true })),
      },
    } as FastHorseDecisionRequest;
    const decide = scripted(ON_BY_DEFAULT, false, FOLD, CALL);
    const states = { [ON_BY_DEFAULT]: 'shadow' } as const;
    const person = await run([fastRequest(withPerson)], decide, states);
    const horses = await run([fastRequest(allHorses)], decide, states);
    expect(person.fasts[0]!.decision.optionShadowReceipt?.personDealt).toBe(true);
    expect(shadowKeys(person.features)).toEqual([
      `option_shadow_${ON_BY_DEFAULT}_changed_seen`,
      `option_shadow_${ON_BY_DEFAULT}_changed_person_seen`,
    ]);
    expect(horses.fasts[0]!.decision.optionShadowReceipt).toMatchObject({
      personDealt: false,
      personLive: false,
    });
    expect(shadowKeys(horses.features)).toEqual([`option_shadow_${ON_BY_DEFAULT}_changed_seen`]);
  });

  it('two options in shadow: one is re-decided, picked by the decision key, the other counted as rotated out', async () => {
    const states = { [ON_BY_DEFAULT]: 'shadow', [OFF_BY_DEFAULT]: 'shadow' } as const;
    const decide = scripted(ON_BY_DEFAULT, false, FOLD, CALL);
    const a = await run([fastRequest(riverSnapshot())], decide, states);
    const b = await run([fastRequest(riverSnapshot())], decide, states);
    expect(a.calls).toHaveLength(2);
    expect(a.features).toContain('option_shadow_rotated_out_seen');
    expect(a.fasts[0]!.decision.optionShadowReceipt?.option).toBe(
      b.fasts[0]!.decision.optionShadowReceipt?.option
    );
  });

  it('the per-minute budget: past it the re-decision is skipped and counted, and 0 stops every one', async () => {
    const decide = scripted(ON_BY_DEFAULT, false, FOLD, CALL);
    const states = { [ON_BY_DEFAULT]: 'shadow' } as const;
    const requests = [1, 2, 3].map((id) => fastRequest(riverSnapshot(), id));
    const one = await run(requests, decide, states, { optionShadowPerMinute: 1, now: () => 5_000 });
    expect(one.fasts.map((f) => f.decision.optionShadowReceipt === undefined)).toEqual([
      false,
      true,
      true,
    ]);
    expect(one.features.filter((k) => k === 'option_shadow_skipped_rate_seen')).toHaveLength(2);
    expect(one.calls).toHaveLength(4);
    const none = await run(requests, decide, states, { optionShadowPerMinute: 0 });
    expect(none.calls).toHaveLength(3);
    expect(none.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
  });

  it('the 15 ms budget: a decision that already spent it is not re-decided', async () => {
    let t = 0;
    const slow: Decide = (p, g, s, m, o) => {
      t += 50;
      return scripted(ON_BY_DEFAULT, false, FOLD, CALL)(p, g, s, m, o);
    };
    const r = await run(
      [fastRequest(riverSnapshot())],
      slow,
      { [ON_BY_DEFAULT]: 'shadow' },
      {
        now: () => t,
      }
    );
    expect(r.calls).toHaveLength(1);
    expect(r.features).toContain('option_shadow_skipped_budget_seen');
    expect(r.fasts[0]!.decision.optionShadowReceipt).toBeUndefined();
  });

  it('off, on and no row run no re-decision, carry no receipt and count nothing of the shadow', async () => {
    for (const states of [null, { [ON_BY_DEFAULT]: 'off' }, { [ON_BY_DEFAULT]: 'on' }] as const) {
      const r = await run(
        [fastRequest(riverSnapshot())],
        scripted(ON_BY_DEFAULT, false, FOLD, CALL),
        states as OptionSwitchStates | null
      );
      expect(r.calls, JSON.stringify(states)).toHaveLength(1);
      expect(r.fasts[0]!.decision.optionShadowReceipt).toBeUndefined();
      expect(shadowKeys(r.features)).toEqual([]);
    }
  });
});

describe('the production brain over every recorded FAST decision: shadow never changes the acted decision', () => {
  const fixtures = recordedFast();
  it('the journal sample carries recorded FAST decisions', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
  });
  const decide = HorseLogic.decide.bind(HorseLogic) as unknown as Decide;

  for (const option of [
    ON_BY_DEFAULT,
    OFF_BY_DEFAULT,
    'handReading',
    'v12River',
    // 2026-11-19: classified release default ON from their reads (DEFAULT-ON-AUDIT), so they take shadow
    ...DEFAULT_ON_20261119,
  ])
    it(`${option} in shadow: every acted decision, RNG position and effect is that of no row`, async () => {
      const requests = fixtures.map((f, i) => fastRequest(f.snapshot, i + 1));
      const plain = await run(requests, decide, null);
      const shadow = await run(requests, decide, { [option]: 'shadow' } as OptionSwitchStates);
      const a = shadow.fasts.map(comparable);
      const b = plain.fasts.map(comparable);
      for (let i = 0; i < b.length; i++) {
        // name the first byte that differs, so a failure says where
        let at = 0;
        while (at < b[i]!.length && a[i]![at] === b[i]![at]) at++;
        expect(a[i]!.slice(Math.max(0, at - 80), at + 80), `${fixtures[i]!.id}`).toBe(
          b[i]!.slice(Math.max(0, at - 80), at + 80)
        );
      }
      expect(a).toEqual(b);
      // every decision that was re-decided carries its receipt, and every receipt counted once
      const receipts = shadow.fasts.map((f) => f.decision.optionShadowReceipt).filter(Boolean);
      expect(receipts.length).toBeGreaterThan(0);
      const outcomes = shadow.features.filter(
        (k) => /^option_shadow_.*_(changed|same)_seen$/.test(k) && !k.includes('_person_')
      );
      expect(outcomes).toHaveLength(receipts.filter((r) => r!.would !== null).length);
      for (const r of receipts) expect(r!.option).toBe(option);
      expect(plain.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
    });

  it('off and on rows: no re-decision and no receipt, the FAST result as it travels is the explicit value run', async () => {
    const requests = fixtures.map((f, i) => fastRequest(f.snapshot, i + 1));
    for (const value of ['off', 'on'] as const) {
      const row = await run(requests, decide, { [ON_BY_DEFAULT]: value } as OptionSwitchStates);
      expect(row.calls).toHaveLength(requests.length);
      expect(row.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
      expect(shadowKeys(row.features)).toEqual([]);
    }
  });

  it('the per-decision cost of one shadow re-decision, measured', async () => {
    const requests = fixtures.map((f, i) => fastRequest(f.snapshot, i + 1));
    const rounds = 3;
    const costs: number[] = [];
    for (let k = 0; k < rounds; k++) {
      const shadow = await run(requests, decide, {
        [ON_BY_DEFAULT]: 'shadow',
      } as OptionSwitchStates);
      costs.push(
        ...shadow.latency.filter(([s]) => s === 'option_shadow_redecide').map(([, ms]) => ms)
      );
    }
    costs.sort((a, b) => a - b);
    const p50 = costs[Math.floor(costs.length / 2)]!;
    const max = costs[costs.length - 1]!;
    console.log(
      `option shadow re-decision cost over ${costs.length} re-decisions: p50 ${p50.toFixed(2)} ms, max ${max.toFixed(2)} ms`
    );
    expect(costs.length).toBeGreaterThan(0);
    // inside the 2,000 ms minimum decision deadline by far; the per-minute budget bounds how often it is paid
    expect(max).toBeLessThan(2_000);
  });
});

/**
 * PEOPLE FIRST (2026-11-21, Horse SWITCH lane). The per-minute budget never refuses a decision with a person dealt in;
 * the Horse-only decisions of that minute are dropped instead. The latency guards (work queued, the 15 ms acted
 * budget) still hold for a person decision. Every skip counts its person-present subset.
 */
describe('people first: the per-minute budget never drops a decision with a person dealt in', () => {
  const withPeople = (snapshot: FastHorseDecisionRequest): FastHorseDecisionRequest => {
    const hero = snapshot.player.user_id;
    return {
      ...snapshot,
      gameState: {
        ...snapshot.gameState,
        players: snapshot.gameState.players.map((p) =>
          p.user_id === hero ? p : { ...p, is_horse: false, is_sitting_out: false }
        ),
      },
    } as FastHorseDecisionRequest;
  };
  const horsesOnly = (snapshot: FastHorseDecisionRequest): FastHorseDecisionRequest =>
    ({
      ...snapshot,
      gameState: {
        ...snapshot.gameState,
        players: snapshot.gameState.players.map((p) => ({ ...p, is_horse: true })),
      },
    }) as FastHorseDecisionRequest;
  const decide = scripted(ON_BY_DEFAULT, false, FOLD, CALL);
  const states = { [ON_BY_DEFAULT]: 'shadow' } as const;
  const count = (fs: string[], k: string) => fs.filter((x) => x === k).length;

  it('a saturated budget: every person decision is re-decided, the Horse-only ones over it are dropped', async () => {
    const kinds = ['h', 'p', 'h', 'p', 'p', 'h'] as const;
    const requests = kinds.map((k, i) =>
      fastRequest(k === 'p' ? withPeople(riverSnapshot()) : horsesOnly(riverSnapshot()), i + 1)
    );
    const r = await run(requests, decide, states, { optionShadowPerMinute: 1, now: () => 5_000 });
    // the first Horse-only decision took the minute's one slot; every person decision still got its re-decision
    expect(r.fasts.map((f) => f.decision.optionShadowReceipt !== undefined)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(r.fasts.map((f) => f.decision.optionShadowReceipt?.personDealt ?? null)).toEqual([
      false,
      true,
      null,
      true,
      true,
      null,
    ]);
    expect(r.calls).toHaveLength(kinds.length + 4);
    expect(count(r.features, 'option_shadow_skipped_rate_seen')).toBe(2);
    expect(count(r.features, 'option_shadow_skipped_rate_person_seen')).toBe(0);
    expect(count(r.features, 'option_shadow_rate_person_over_seen')).toBe(3);
    // the outcome counters split by person, changed as well as same
    expect(count(r.features, `option_shadow_${ON_BY_DEFAULT}_changed_seen`)).toBe(4);
    expect(count(r.features, `option_shadow_${ON_BY_DEFAULT}_changed_person_seen`)).toBe(3);
    // the acted decisions are those of no row
    const plain = await run(requests, decide, null, { optionShadowPerMinute: 1, now: () => 5_000 });
    expect(r.fasts.map(comparable)).toEqual(plain.fasts.map(comparable));
  });

  it('person decisions first: they take the slots, and the Horse-only decisions of that minute are the ones dropped', async () => {
    const requests = [
      withPeople(riverSnapshot()),
      withPeople(riverSnapshot()),
      horsesOnly(riverSnapshot()),
      horsesOnly(riverSnapshot()),
    ].map((s, i) => fastRequest(s, i + 1));
    const r = await run(requests, decide, states, { optionShadowPerMinute: 2, now: () => 5_000 });
    expect(r.fasts.map((f) => f.decision.optionShadowReceipt !== undefined)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(count(r.features, 'option_shadow_skipped_rate_seen')).toBe(2);
    expect(count(r.features, 'option_shadow_skipped_rate_person_seen')).toBe(0);
    expect(count(r.features, 'option_shadow_rate_person_over_seen')).toBe(0);
  });

  it('a person-present, same-action re-decision counts same and same_person, never changed', async () => {
    const r = await run(
      [fastRequest(withPeople(riverSnapshot()))],
      scripted(OFF_BY_DEFAULT, true, CALL, CALL),
      { [OFF_BY_DEFAULT]: 'shadow' },
      { optionShadowPerMinute: 1 }
    );
    expect(shadowKeys(r.features)).toEqual([
      `option_shadow_${OFF_BY_DEFAULT}_same_seen`,
      `option_shadow_${OFF_BY_DEFAULT}_same_person_seen`,
    ]);
  });

  it('0 still stops every re-decision, a person decision too, and the skip is counted with its person subset', async () => {
    const requests = [withPeople(riverSnapshot()), horsesOnly(riverSnapshot())].map((s, i) =>
      fastRequest(s, i + 1)
    );
    const r = await run(requests, decide, states, { optionShadowPerMinute: 0 });
    expect(r.calls).toHaveLength(2);
    expect(r.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
    expect(count(r.features, 'option_shadow_skipped_rate_seen')).toBe(2);
    expect(count(r.features, 'option_shadow_skipped_rate_person_seen')).toBe(1);
  });

  it('the 15 ms acted budget still holds for a person decision, and the skip carries its person subset', async () => {
    let t = 0;
    const slow: Decide = (p, g, s, m, o) => {
      t += 50;
      return decide(p, g, s, m, o);
    };
    const person = await run([fastRequest(withPeople(riverSnapshot()))], slow, states, {
      now: () => t,
    });
    expect(person.calls).toHaveLength(1);
    expect(person.fasts[0]!.decision.optionShadowReceipt).toBeUndefined();
    expect(shadowKeys(person.features)).toEqual([
      'option_shadow_skipped_budget_seen',
      'option_shadow_skipped_budget_person_seen',
    ]);
    const horses = await run([fastRequest(horsesOnly(riverSnapshot()))], slow, states, {
      now: () => t,
    });
    expect(shadowKeys(horses.features)).toEqual(['option_shadow_skipped_budget_seen']);
  });

  it('work queued behind a person decision still skips its re-decision (backlog), counted with its person subset', async () => {
    HorseMind.reset();
    restoreFastRandom(SEED);
    const features: string[] = [];
    const calls: Opts[] = [];
    const messages: HorseDecisionWorkerResponse[] = [];
    const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
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
      noteDecision: () => {},
      noteFeature: (k: string) => {
        features.push(k);
      },
      now: () => 1_000,
      optionSwitch: new OptionSwitchHolder(optionSwitchSourceFromStates(states), () => {}),
      optionShadowPerMinute: 1000,
    });
    await runtime.start();
    // two decisions received before either runs: the first has work queued behind it
    runtime.receive(fastRequest(withPeople(riverSnapshot()), 1));
    runtime.receive(fastRequest(withPeople(riverSnapshot()), 2));
    await runtime.drain();
    const fasts = messages.filter((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
    expect(fasts).toHaveLength(2);
    expect(fasts[0]!.decision.optionShadowReceipt).toBeUndefined();
    expect(count(features, 'option_shadow_skipped_backlog_seen')).toBe(1);
    expect(count(features, 'option_shadow_skipped_backlog_person_seen')).toBe(1);
    expect(fasts[1]!.decision.optionShadowReceipt?.personDealt).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('the production brain with a person dealt in and the budget spent: every acted decision is that of no row', async () => {
    const decideProd = HorseLogic.decide.bind(HorseLogic) as unknown as Decide;
    const requests = recordedFast().map((f, i) => fastRequest(withPeople(f.snapshot), i + 1));
    const plain = await run(requests, decideProd, null, { optionShadowPerMinute: 1 });
    const shadow = await run(requests, decideProd, states, { optionShadowPerMinute: 1 });
    expect(shadow.fasts.map(comparable)).toEqual(plain.fasts.map(comparable));
    const receipts = shadow.fasts.map((f) => f.decision.optionShadowReceipt).filter(Boolean);
    // one slot in the minute, yet every person decision that passed the latency guards was re-decided
    const guarded = shadow.features.filter(
      (k) =>
        k === 'option_shadow_skipped_backlog_seen' ||
        k === 'option_shadow_skipped_budget_seen' ||
        k === 'option_shadow_skipped_scale_seen'
    ).length;
    expect(receipts.length).toBe(requests.length - guarded);
    expect(receipts.length).toBeGreaterThan(1);
    expect(receipts.every((x) => x!.personDealt)).toBe(true);
    expect(count(shadow.features, 'option_shadow_skipped_rate_seen')).toBe(0);
  });
});
