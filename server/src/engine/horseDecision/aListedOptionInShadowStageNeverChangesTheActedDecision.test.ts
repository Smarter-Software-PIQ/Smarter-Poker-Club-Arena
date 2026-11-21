/**
 * A LISTED OPTION IN SHADOW STAGE NEVER CHANGES THE ACTED DECISION (2026-11-20, PLO-OWNER lane SHADOW,
 * HorseOptionShadowStage).
 *
 * The shadow stage fits the option shadow (HorseOptionShadow, Horse Switch lane) to the dark PLO4/PLO5 cash options.
 * Held here, through the production HorseDecisionWorkerRuntime (the harness of
 * anOptionInShadowNeverChangesTheActedDecision.test.ts):
 *  - the table: PLO4/PLO5 only, the opponent lifetime HUD not listed, every listed name the registry holds takes shadow;
 *  - scope: a staged option is re-decided in PLO4/PLO5 cash and never in PLO6, hold'em or a tournament, where it
 *    spends nothing and counts nothing;
 *  - the 50 ms acted-time budget for a staged option, the 15 ms budget unchanged for any other;
 *  - the Horse-only cap, the latency breaker (it trips, it stays tripped), the companions;
 *  - with the production brain over every recorded FAST decision: a staged option in shadow (companion included)
 *    leaves the acted decision, its RNG positions and its plan effects those of no row at all;
 *  - an option that is not staged behaves exactly as before with the stage table present;
 *  - the cost of a staged re-decision, measured.
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


import { optionShadowPersonPresence } from '../HorseOptionShadow.js';
import {
  OPTION_SHADOW_STAGE,
  OPTION_SHADOW_STAGE_HARD_MS,
  OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE,
  OPTION_SHADOW_STAGE_SLOW_MS,
  OPTION_SHADOW_STAGE_SLOW_STRIKES,
  OPTION_SHADOW_STAGE_WINDOW,
  optionShadowStageCompanions,
  OptionShadowStageGuard,
  optionShadowStageInScope,
  type OptionShadowStageTable,
} from '../HorseOptionShadowStage.js';
import { OPTION_SWITCH_REGISTRY } from '../HorseOptionSwitch.js';

/** A registered, release-default-off Omaha option on this tree, staged by the test's own table. */
const STAGED = 'omahaTurnRiverRaiseIsPriced';
const NOT_STAGED = 'streetIQ';
const TABLE: OptionShadowStageTable = { [STAGED]: { games: [4, 5] } };
const TABLE_WITH_CORE: OptionShadowStageTable = {
  [STAGED]: { games: [4, 5], companions: ['omahaMathCore'] },
};
const stage = (table: OptionShadowStageTable = TABLE) => ({ optionShadowStage: table });

const plo4Snapshot = () =>
  phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashPlo4Preflop)
  ).snapshot;
const tournamentSnapshot = () =>
  phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.tournamentFlop)
  ).snapshot;
type Seat = { user_id?: string; is_horse?: boolean };
/** The PLO4 cash snapshot with every other seat a Horse, or with every other seat a person. */
function plo4With(kind: 'horses' | 'person', variant?: string): FastHorseDecisionRequest {
  const s = JSON.parse(JSON.stringify(plo4Snapshot())) as FastHorseDecisionRequest;
  const gs = s.gameState as unknown as { players: Seat[]; gameVariant?: string };
  for (const p of gs.players) if (p.user_id !== s.player.user_id) p.is_horse = kind === 'horses';
  if (variant) gs.gameVariant = variant;
  return s;
}
const presence = (s: FastHorseDecisionRequest) =>
  optionShadowPersonPresence(s.gameState as never, s.player.user_id);

describe('the stage table', () => {
  it('lists PLO4/PLO5 only, never the opponent lifetime HUD, and its names take shadow where registered', () => {
    const names = Object.keys(OPTION_SHADOW_STAGE);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('omahaOpponentLifetimeHud');
    const registered = new Map(OPTION_SWITCH_REGISTRY.map((e) => [e.name, e]));
    for (const name of names) {
      const entry = OPTION_SHADOW_STAGE[name]!;
      expect(name.startsWith('omaha'), name).toBe(true);
      expect(/plo6|plo8|tournament/i.test(name), name).toBe(false);
      for (const g of entry.games) expect([4, 5], name).toContain(g);
      for (const c of entry.companions ?? []) expect(c.startsWith('omaha'), c).toBe(true);
      // a listed name is inert until the registry holds it; once it does, it must take on_shadow or shadow
      const reg = registered.get(name);
      if (reg) expect(reg.states.includes('on_shadow'), name).toBe(true);
    }
  });
  it('the fixture option the tests stage is registered and takes shadow', () => {
    expect(OPTION_SWITCH_SHADOW_NAMES).toContain(STAGED);
    expect(OPTION_SWITCH_SHADOW_NAMES).toContain(NOT_STAGED);
  });
});

describe('scope: a staged option is re-decided in PLO4/PLO5 cash only', () => {
  it('no staged option among the options: the same array comes back and the decision is not read', () => {
    const options = [NOT_STAGED, 'handReading'];
    expect(optionShadowStageInScope(options, null, null, TABLE)).toBe(options);
  });
  it('PLO4 cash keeps it; PLO6, hold-em cash and a tournament drop it; other options stay in order', () => {
    const plo4 = plo4With('person');
    const options = [NOT_STAGED, STAGED];
    expect(optionShadowStageInScope(options, plo4.player, plo4.gameState, TABLE)).toEqual(options);
    const plo6 = plo4With('person', 'plo6');
    expect(optionShadowStageInScope(options, plo6.player, plo6.gameState, TABLE)).toEqual([
      NOT_STAGED,
    ]);
    const nlh = riverSnapshot();
    expect(optionShadowStageInScope(options, nlh.player, nlh.gameState, TABLE)).toEqual([
      NOT_STAGED,
    ]);
    const mtt = tournamentSnapshot();
    expect(optionShadowStageInScope(options, mtt.player, mtt.gameState, TABLE)).toEqual([
      NOT_STAGED,
    ]);
  });
  it('the listed games and streets are held', () => {
    const plo4 = plo4With('person');
    const street = String((plo4.gameState as unknown as { stage: string }).stage).toLowerCase();
    const only5: OptionShadowStageTable = { [STAGED]: { games: [5] } };
    expect(optionShadowStageInScope([STAGED], plo4.player, plo4.gameState, only5)).toEqual([]);
    const other: OptionShadowStageTable = {
      [STAGED]: { games: [4], streets: [street === 'river' ? 'flop' : 'river'] },
    };
    expect(optionShadowStageInScope([STAGED], plo4.player, plo4.gameState, other)).toEqual([]);
    const same: OptionShadowStageTable = { [STAGED]: { games: [4], streets: [street] } };
    expect(optionShadowStageInScope([STAGED], plo4.player, plo4.gameState, same)).toEqual([STAGED]);
  });
  // PLO6 is held by the scope test above: the worker refuses a PLO4 state relabelled PLO6, and the journal sample
  // carries no PLO6 decision.
  it('hold-em cash and a tournament: no re-decision, no receipt, nothing counted (scripted brain)', async () => {
    for (const snapshot of [riverSnapshot(), tournamentSnapshot()]) {
      const r = await run(
        [fastRequest(snapshot)],
        scripted(STAGED, true, CALL, RAISE),
        { [STAGED]: 'shadow' },
        stage()
      );
      expect(r.calls).toHaveLength(1);
      expect(r.fasts[0]!.decision.optionShadowReceipt).toBeUndefined();
      expect(shadowKeys(r.features)).toEqual([]);
      expect(r.latency.filter(([s]) => s.startsWith('option_shadow'))).toEqual([]);
    }
  });
});

describe('a staged option in PLO4 cash (scripted brain)', () => {
  it('is re-decided once, flipped to true, and the acted decision is that of no row', async () => {
    const request = fastRequest(plo4With('person'));
    const brain = scripted(STAGED, true, CALL, RAISE);
    const plain = await run([request], brain, null, stage());
    const shadow = await run([request], brain, { [STAGED]: 'shadow' }, stage());
    expect(shadow.calls).toHaveLength(2);
    expect(shadow.calls[0]![STAGED]).toBeUndefined();
    expect(shadow.calls[1]![STAGED]).toBe(true);
    expect(comparable(shadow.fasts[0]!)).toBe(comparable(plain.fasts[0]!));
    const receipt = shadow.fasts[0]!.decision.optionShadowReceipt!;
    expect(receipt.option).toBe(STAGED);
    expect(receipt.changed).toBe(true);
    expect(receipt.actual.action).toBe('call');
    expect(receipt.would).toEqual({ action: 'raise', amount: 120 });
    expect(receipt.personDealt).toBe(true);
    expect(shadow.features).toContain(`option_shadow_${STAGED}_changed_seen`);
    expect(shadow.latency.filter(([s]) => s === 'option_shadow_stage_redecide')).toHaveLength(1);
    expect(shadow.latency.filter(([s]) => s === 'option_shadow_redecide')).toHaveLength(1);
  });

  it('companions: the re-decision alone carries the companion true; an on_shadow flip to false carries none', async () => {
    const request = fastRequest(plo4With('person'));
    const r = await run(
      [request],
      scripted(STAGED, true, CALL, RAISE),
      { [STAGED]: 'shadow' },
      stage(TABLE_WITH_CORE)
    );
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]!.omahaMathCore).toBeUndefined();
    expect(r.calls[1]!.omahaMathCore).toBe(true);
    expect(optionShadowStageCompanions(STAGED, true, {}, TABLE_WITH_CORE)).toEqual({
      omahaMathCore: true,
    });
    expect(
      optionShadowStageCompanions(STAGED, true, { omahaMathCore: true }, TABLE_WITH_CORE)
    ).toEqual({});
    expect(optionShadowStageCompanions(STAGED, false, {}, TABLE_WITH_CORE)).toEqual({});
    expect(optionShadowStageCompanions(NOT_STAGED, true, {}, TABLE_WITH_CORE)).toEqual({});
  });

  it('the acted-time budget is 50 ms for a staged option and stays 15 ms for any other', async () => {
    const spending = (ms: number, option: string, flipped: boolean): Decide => {
      let first = true;
      return (p, g, s, m, o) => {
        if (first) clock.t += ms;
        first = false;
        return scripted(option, flipped, CALL, RAISE)(p, g, s, m, o);
      };
    };
    const clock = { t: 0 };
    const at = (ms: number, option: string, flipped: boolean) =>
      run(
        [fastRequest(plo4With('person'))],
        spending(ms, option, flipped),
        { [option]: 'shadow' },
        { ...stage(), now: () => clock.t }
      );
    const staged30 = await at(30, STAGED, true);
    expect(staged30.calls).toHaveLength(2);
    expect(staged30.fasts[0]!.decision.optionShadowReceipt).toBeDefined();
    const staged60 = await at(60, STAGED, true);
    expect(staged60.calls).toHaveLength(1);
    expect(staged60.features).toContain('option_shadow_skipped_budget_seen');
    const other30 = await at(30, NOT_STAGED, false);
    expect(other30.calls).toHaveLength(1);
    expect(other30.features).toContain('option_shadow_skipped_budget_seen');
  });

  it('a hand with no person dealt in is capped per minute; a hand with a person is not', async () => {
    const horses = plo4With('horses');
    const person = plo4With('person');
    expect(presence(horses).personDealt).toBe(false);
    expect(presence(person).personDealt).toBe(true);
    const n = OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE + 2;
    const brain = scripted(STAGED, true, CALL, RAISE);
    const many = (s: FastHorseDecisionRequest) =>
      Array.from({ length: n }, (_, i) => fastRequest(s, i + 1));
    const h = await run(many(horses), brain, { [STAGED]: 'shadow' }, stage());
    expect(h.fasts.filter((f) => f.decision.optionShadowReceipt).length).toBe(
      OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE
    );
    expect(
      h.features.filter((k) => k === 'option_shadow_skipped_stage_horse_only_seen')
    ).toHaveLength(2);
    const p = await run(many(person), brain, { [STAGED]: 'shadow' }, stage());
    expect(p.fasts.filter((f) => f.decision.optionShadowReceipt).length).toBe(n);
    expect(shadowKeys(p.features).filter((k) => k.includes('_stage_'))).toEqual([]);
    // the acted decisions of the two runs are the same decisions: the cap orders a measurement only
    const none = await run(many(horses), brain, null, stage());
    expect(h.fasts.map(comparable)).toEqual(none.fasts.map(comparable));
  });

  it('the latency breaker: one re-decision over the hard limit stops the option in this worker, and it stays stopped', async () => {
    const burn: Decide = (p, g, s, m, o = {}) => {
      if (o[STAGED] === true) {
        const until = performance.now() + OPTION_SHADOW_STAGE_HARD_MS + 15;
        while (performance.now() < until) {
          /* a slow re-decision */
        }
      }
      return scripted(STAGED, true, CALL, RAISE)(p, g, s, m, o);
    };
    const s = plo4With('person');
    const requests = [1, 2, 3, 4].map((i) => fastRequest(s, i));
    const r = await run(requests, burn, { [STAGED]: 'shadow' }, stage());
    // the first is re-decided (slow) and trips; the next three run no re-decision
    expect(r.calls).toHaveLength(5);
    expect(r.features.filter((k) => k === 'option_shadow_stage_self_disabled_seen')).toHaveLength(1);
    expect(
      r.features.filter((k) => k === 'option_shadow_skipped_stage_disabled_seen')
    ).toHaveLength(3);
    expect(r.fasts.slice(1).every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
    const none = await run(requests, burn, null, stage());
    expect(r.fasts.map(comparable)).toEqual(none.fasts.map(comparable));
  });
});

describe('the latency breaker and the Horse-only cap (the guard alone)', () => {
  it('trips on one over the hard limit', () => {
    const g = new OptionShadowStageGuard();
    expect(g.note('a', OPTION_SHADOW_STAGE_HARD_MS)).toBe(false);
    expect(g.disabled('a')).toBe(false);
    expect(g.note('a', OPTION_SHADOW_STAGE_HARD_MS + 0.1)).toBe(true);
    expect(g.disabled('a')).toBe(true);
    expect(g.note('a', 1)).toBe(false);
    expect(g.disabled('a')).toBe(true);
    expect(g.disabled('b')).toBe(false);
  });
  it('trips on the slow strikes inside the window, not on slow ones further apart, and on a time that is not a number', () => {
    const g = new OptionShadowStageGuard();
    const slow = OPTION_SHADOW_STAGE_SLOW_MS + 1;
    for (let i = 0; i < OPTION_SHADOW_STAGE_SLOW_STRIKES - 1; i++)
      expect(g.note('a', slow)).toBe(false);
    for (let i = 0; i < OPTION_SHADOW_STAGE_WINDOW; i++) expect(g.note('a', 1)).toBe(false);
    for (let i = 0; i < OPTION_SHADOW_STAGE_SLOW_STRIKES - 1; i++)
      expect(g.note('a', slow)).toBe(false);
    expect(g.note('a', slow)).toBe(true);
    expect(g.disabled('a')).toBe(true);
    expect(new OptionShadowStageGuard().note('n', Number.NaN)).toBe(true);
  });
  it('the Horse-only cap is per clock minute', () => {
    const g = new OptionShadowStageGuard();
    for (let i = 0; i < OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE; i++)
      expect(g.admitHorseOnly(1_000)).toBe(true);
    expect(g.admitHorseOnly(59_999)).toBe(false);
    expect(g.admitHorseOnly(60_000)).toBe(true);
    expect(g.admitHorseOnly(Number.NaN)).toBe(false);
  });
});

describe('the production brain over every recorded FAST decision: the stage never changes the acted decision', () => {
  const fixtures = recordedFast();
  const decide = HorseLogic.decide.bind(HorseLogic) as unknown as Decide;
  const requests = () => fixtures.map((f, i) => fastRequest(f.snapshot, i + 1));
  const sameAsNoRow = (a: string[], b: string[]) => {
    for (let i = 0; i < b.length; i++) {
      let at = 0;
      while (at < b[i]!.length && a[i]![at] === b[i]![at]) at++;
      expect(a[i]!.slice(Math.max(0, at - 80), at + 80), `${fixtures[i]!.id}`).toBe(
        b[i]!.slice(Math.max(0, at - 80), at + 80)
      );
    }
    expect(a).toEqual(b);
  };

  for (const [label, table] of [
    ['staged', TABLE],
    ['staged with the math core as its companion', TABLE_WITH_CORE],
  ] as const)
    it(`${label}: every acted decision, RNG position and effect is that of no row`, async () => {
      const plain = await run(requests(), decide, null, stage(table));
      const shadow = await run(requests(), decide, { [STAGED]: 'shadow' }, stage(table));
      sameAsNoRow(shadow.fasts.map(comparable), plain.fasts.map(comparable));
      // only PLO4/PLO5 cash decisions carry a receipt
      shadow.fasts.forEach((f, i) => {
        const r = f.decision.optionShadowReceipt;
        if (!r) return;
        expect(r.option).toBe(STAGED);
        expect(['plo4', 'plo5'], fixtures[i]!.id).toContain(r.variant.toLowerCase());
        expect(r.format).toBe('cash');
      });
      expect(shadow.fasts.some((f) => f.decision.optionShadowReceipt)).toBe(true);
      expect(plain.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
    });

  it('an option that is not staged: receipts, counters and decisions are those of the run without a stage table', async () => {
    const withStage = await run(requests(), decide, { [NOT_STAGED]: 'shadow' }, stage());
    const without = await run(requests(), decide, { [NOT_STAGED]: 'shadow' }, {
      optionShadowStage: {},
    });
    expect(withStage.fasts.map(comparable)).toEqual(without.fasts.map(comparable));
    expect(withStage.fasts.map((f) => f.decision.optionShadowReceipt)).toEqual(
      without.fasts.map((f) => f.decision.optionShadowReceipt)
    );
    expect(shadowKeys(withStage.features)).toEqual(shadowKeys(without.features));
    expect(shadowKeys(withStage.features).some((k) => k.includes('_stage_'))).toBe(false);
    expect(withStage.latency.some(([s]) => s === 'option_shadow_stage_redecide')).toBe(false);
  });

  it('the cost of one staged re-decision, measured (PLO4 cash fixture, with and without the core companion)', async () => {
    const s = plo4With('person');
    const many = Array.from({ length: 12 }, (_, i) => fastRequest(s, i + 1));
    for (const [label, table] of [
      ['option alone', TABLE],
      ['with omahaMathCore', TABLE_WITH_CORE],
    ] as const) {
      const r = await run(many, decide, { [STAGED]: 'shadow' }, stage(table));
      const costs = r.latency
        .filter(([k]) => k === 'option_shadow_stage_redecide')
        .map(([, ms]) => ms)
        .sort((a, b) => a - b);
      expect(costs.length).toBeGreaterThan(0);
      console.log(
        `shadow stage re-decision cost (${label}) over ${costs.length}: p50 ${costs[Math.floor(costs.length / 2)]!.toFixed(2)} ms, max ${costs[costs.length - 1]!.toFixed(2)} ms`
      );
    }
  });
});
