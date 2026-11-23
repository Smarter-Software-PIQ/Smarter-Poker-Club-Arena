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
 *  - TIMING (VERIFIER V52): nothing of a staged re-decision runs before the answer is sent; up to the answer the
 *    worker does exactly what it does with no row, whether or not a person was dealt in; a request queued behind the
 *    decision drops the re-decision; the receipt rides in the next decision record (no new journal record kind);
 *  - the cost of a staged re-decision and the time from request to response with and without staging, measured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOmahaMathCoreCaches,
  warmOmahaMathCore,
} from '../omahaMathCore/OmahaMathCoreWarmUp.js';
import { OMAHA_MATH_CORE_ALL_STREETS } from '../omahaMathCore/OmahaMathCoreRule.js';
import { dealToFlop } from '../HorseStyleVariantModeMatrix.test-support.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
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
  /** The staged receipts as made (the test seam), by request. */
  staged: Array<{ requestId: number; receipt: OptionShadowReceipt }>;
  /** The decision records as journaled (the payload handed to the journal), in order. */
  journaled: Array<{ requestId: number; payload: Record<string, unknown> }>;
  /** What happened in order: decide, send:<type>, feature:<key>, latency:<scope>, journal:option_shadow. */
  events: string[];
  /** Milliseconds from receive() to the FAST_RESULT leaving, per request. */
  responseMs: number[];
  fasts: FastHorseDecisionResult[];
  calls: Opts[];
  features: string[];
  latency: Array<[string, number]>;
}

/** On: every request is posted before the worker runs any (work is queued behind each decision). */
const burst = { on: false };

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
  const staged: Run['staged'] = [];
  const journaled: Run['journaled'] = [];
  const events: string[] = [];
  const responseMs: number[] = [];
  let receivedAt = 0;
  const deps: HorseDecisionWorkerDependencies = {
    ...qualifiedReplayAdmissions,
    journalEnabled: () => true,
    journalDecision: ((req: { requestId: number }, payload: Record<string, unknown>) => {
      journaled.push({ requestId: req.requestId, payload });
    }) as never,
    onStagedOptionShadowReceipt: ((req: { requestId: number }, receipt: unknown) => {
      events.push('journal:option_shadow');
      staged.push({ requestId: req.requestId, receipt: receipt as OptionShadowReceipt });
    }) as never,
    async startServices() {
      prepareTournamentFutureHandFacts();
      return readiness();
    },
    async stopServices() {},
    decide: ((...args: Parameters<Decide>) => {
      calls.push({ ...(args[4] ?? {}) });
      events.push('decide');
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
      events.push(`latency:${scope}`);
    },
    noteFeature: (k: string) => {
      features.push(k);
      events.push(`feature:${k}`);
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
  const runtime = new HorseDecisionWorkerRuntime((m) => {
    if (m.type === 'FAST_RESULT') responseMs.push(performance.now() - receivedAt);
    events.push(`send:${m.type}`);
    messages.push(m);
  }, deps);
  await runtime.start();
  events.length = 0;
  for (const request of requests) {
    receivedAt = performance.now();
    runtime.receive(request);
    if (!burst.on) await runtime.drain();
  }
  await runtime.drain();
  const fasts = messages.filter((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  if (fasts.length !== requests.length)
    throw new Error(`expected ${requests.length} FAST results: ${JSON.stringify(messages.at(-1))}`);
  drainFires();
  return { fasts, calls, features, latency, staged, journaled, events, responseMs };
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

import { optionShadowPersonPresence, type OptionShadowReceipt } from '../HorseOptionShadow.js';
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
import { seedFastRandom } from '../HorseEval.js';
import {
  LIVE,
  LIVE_OPTIONS,
  recordedState,
  type RecordedDecision,
} from '../HorseOmahaPricedRules.test-support.js';
import RECORDED_PLO5 from '../HorseOmahaPricedRules.fixture.json';
import {
  correctiveFixture,
  HAND_KEY,
} from '../../services/horseCorrectiveReview/fixture.test-support.js';
import { validateHorseJournalRecord } from '../../services/horseDecisionJournal/record.js';
import { reconcileHorseJournalHand } from '../../services/horseDecisionJournal/review.js';

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
    // the answered decision carries no receipt: it rides in the next journaled decision record
    expect(shadow.fasts[0]!.decision.optionShadowReceipt).toBeUndefined();
    expect(shadow.staged).toHaveLength(1);
    expect(shadow.staged[0]!.requestId).toBe(request.requestId);
    const receipt = shadow.staged[0]!.receipt;
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
    expect(staged30.staged).toHaveLength(1);
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
    expect(h.staged).toHaveLength(OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE);
    expect(
      h.features.filter((k) => k === 'option_shadow_skipped_stage_horse_only_seen')
    ).toHaveLength(2);
    const p = await run(many(person), brain, { [STAGED]: 'shadow' }, stage());
    expect(p.staged).toHaveLength(n);
    expect(shadowKeys(p.features).filter((k) => k.includes('_stage_'))).toEqual([]);
    // the acted decisions of the two runs are the same decisions: the cap orders a measurement only
    const none = await run(many(horses), brain, null, stage());
    expect(h.fasts.map(comparable)).toEqual(none.fasts.map(comparable));
  });

  it('people first (2026-11-21): with the per-minute budget spent, a staged pick with a person is still re-decided; a Horse-only one is not', async () => {
    const brain = scripted(STAGED, true, CALL, RAISE);
    const person = [1, 2, 3].map((i) => fastRequest(plo4With('person'), i));
    const p = await run(
      person,
      brain,
      { [STAGED]: 'shadow' },
      {
        ...stage(),
        optionShadowPerMinute: 1,
      }
    );
    expect(p.staged).toHaveLength(3);
    expect(p.features.filter((k) => k === 'option_shadow_rate_person_over_seen')).toHaveLength(2);
    expect(p.features.filter((k) => k.startsWith('option_shadow_skipped_rate'))).toEqual([]);
    const horses = [1, 2, 3].map((i) => fastRequest(plo4With('horses'), i));
    const h = await run(
      horses,
      brain,
      { [STAGED]: 'shadow' },
      { ...stage(), optionShadowPerMinute: 1 }
    );
    expect(h.staged).toHaveLength(1);
    // the second takes the Horse-only cap's second slot and meets the spent budget; the third meets the cap
    expect(h.features.filter((k) => k === 'option_shadow_skipped_rate_seen')).toHaveLength(1);
    expect(
      h.features.filter((k) => k === 'option_shadow_skipped_stage_horse_only_seen')
    ).toHaveLength(1);
    expect(h.features.filter((k) => k === 'option_shadow_skipped_rate_person_seen')).toHaveLength(
      0
    );
    // a measurement only: the acted decisions are those of no row
    const none = await run(person, brain, null, stage());
    expect(p.fasts.map(comparable)).toEqual(none.fasts.map(comparable));
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
    expect(r.features.filter((k) => k === 'option_shadow_stage_self_disabled_seen')).toHaveLength(
      1
    );
    expect(
      r.features.filter((k) => k === 'option_shadow_skipped_stage_disabled_seen')
    ).toHaveLength(3);
    expect(r.staged.map((x) => x.requestId)).toEqual([1]);
    const none = await run(requests, burn, null, stage());
    expect(r.fasts.map(comparable)).toEqual(none.fasts.map(comparable));
  });
});

describe('timing: a staged re-decision runs only after the answer has been sent', () => {
  /** Everything up to and including the answer. */
  const untilAnswer = (events: string[]) => events.slice(0, events.indexOf('send:FAST_RESULT') + 1);
  const brain = scripted(STAGED, true, CALL, RAISE);

  it('up to the answer, a staged option in shadow does exactly what no row does; the re-decision comes after', async () => {
    for (const kind of ['person', 'horses'] as const) {
      const request = fastRequest(plo4With(kind));
      const plain = await run([request], brain, null, stage());
      const shadow = await run([request], brain, { [STAGED]: 'shadow' }, stage());
      expect(untilAnswer(shadow.events), kind).toEqual(untilAnswer(plain.events));
      expect(untilAnswer(shadow.events).filter((e) => e === 'decide')).toHaveLength(1);
      const after = shadow.events.slice(shadow.events.indexOf('send:FAST_RESULT') + 1);
      expect(
        after.filter((e) => e === 'decide'),
        kind
      ).toHaveLength(1);
      expect(after, kind).toContain('journal:option_shadow');
      expect(shadow.fasts[0]!.computeMs).toBe(plain.fasts[0]!.computeMs);
    }
  });

  it('what happens before the answer does not depend on whether a person was dealt in', async () => {
    const person = await run(
      [fastRequest(plo4With('person'))],
      brain,
      { [STAGED]: 'shadow' },
      stage()
    );
    const horses = await run(
      [fastRequest(plo4With('horses'))],
      brain,
      { [STAGED]: 'shadow' },
      stage()
    );
    expect(untilAnswer(person.events)).toEqual(untilAnswer(horses.events));
  });

  it('a slow re-decision is not in the response time (it burns 120 ms after the answer)', async () => {
    const burn: Decide = (p, g, s, m, o = {}) => {
      if (o[STAGED] === true) {
        const until = performance.now() + 120;
        while (performance.now() < until) {
          /* a slow re-decision */
        }
      }
      return brain(p, g, s, m, o);
    };
    const r = await run([fastRequest(plo4With('person'))], burn, { [STAGED]: 'shadow' }, stage());
    expect(r.staged).toHaveLength(1);
    expect(r.latency.find(([s]) => s === 'option_shadow_stage_redecide')![1]).toBeGreaterThan(110);
    // the answer left before the burn started: the order is the law, the time is printed
    const answer = r.events.indexOf('send:FAST_RESULT');
    expect(r.events.lastIndexOf('decide')).toBeGreaterThan(answer);
    console.log(
      `response ${r.responseMs[0]!.toFixed(2)} ms with a 120 ms staged re-decision behind it`
    );
  });

  it('work queued behind the decision: the staged re-decision is dropped, never run in front of it', async () => {
    const s = plo4With('person');
    const requests = [1, 2, 3].map((i) => fastRequest(s, i));
    burst.on = true;
    try {
      const r = await run(requests, brain, { [STAGED]: 'shadow' }, stage());
      // the first two had a request waiting when they ended: dropped; only the last, on an idle worker, re-decides
      expect(r.calls).toHaveLength(4);
      expect(r.staged.map((x) => x.requestId)).toEqual([3]);
      expect(r.features.filter((k) => k === 'option_shadow_skipped_backlog_seen')).toHaveLength(2);
      const lastAnswer = r.events.lastIndexOf('send:FAST_RESULT');
      expect(r.events.lastIndexOf('decide')).toBeGreaterThan(lastAnswer);
      expect(r.events.slice(0, lastAnswer).filter((e) => e === 'decide')).toHaveLength(3);
    } finally {
      burst.on = false;
    }
  });

  it('the time from request to response, measured with and without staging (production brain, same fixtures)', async () => {
    const decide = HorseLogic.decide.bind(HorseLogic) as unknown as Decide;
    const plo4 = Array.from({ length: 10 }, (_, i) => fastRequest(plo4With('person'), i + 1));
    const all = recordedFast().map((f, i) => fastRequest(f.snapshot, i + 1));
    const pct = (xs: number[], q: number) =>
      [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;
    for (const [label, requests] of [
      ['PLO4 cash fixture x10', plo4],
      ['every recorded FAST decision', all],
    ] as const) {
      const plain: number[] = [];
      const shadow: number[] = [];
      // interleaved rounds, so machine load falls on both alike
      for (let k = 0; k < 6; k++) {
        plain.push(...(await run(requests, decide, null, stage(TABLE_WITH_CORE))).responseMs);
        shadow.push(
          ...(await run(requests, decide, { [STAGED]: 'shadow' }, stage(TABLE_WITH_CORE)))
            .responseMs
        );
      }
      console.log(
        `request->response (${label}, n ${plain.length} each): no row p50 ${pct(plain, 0.5).toFixed(2)} p90 ${pct(plain, 0.9).toFixed(2)} max ${pct(plain, 1).toFixed(2)} ms; staged shadow + core companion p50 ${pct(shadow, 0.5).toFixed(2)} p90 ${pct(shadow, 0.9).toFixed(2)} max ${pct(shadow, 1).toFixed(2)} ms`
      );
      // the order laws above are the proof; this holds the measured medians together with room for machine load
      expect(pct(shadow, 0.5)).toBeLessThan(pct(plain, 0.5) * 1.5 + 5);
    }
  });
});

describe('the journal: a staged receipt rides in the next decision record, never in a record kind of its own', () => {
  const brain = scripted(STAGED, true, CALL, RAISE);
  it('the decision record of the NEXT decision carries it, naming the decision it re-decided', async () => {
    const s = plo4With('person');
    const requests = [1, 2, 3].map((i) => fastRequest(s, i));
    const r = await run(requests, brain, { [STAGED]: 'shadow' }, stage());
    expect(r.staged).toHaveLength(3);
    expect(r.journaled.map((j) => j.requestId)).toEqual([1, 2, 3]);
    // its own record never carries it (written before the answer); the next record carries exactly that one
    expect(r.journaled[0]!.payload.stagedOptionShadowReceipts).toBeUndefined();
    for (const i of [1, 2]) {
      const carried = r.journaled[i]!.payload.stagedOptionShadowReceipts as Array<{
        decisionKey: string;
        requestId: number;
        decisionTimeMs: number;
        receipt: OptionShadowReceipt;
      }>;
      expect(carried).toHaveLength(1);
      expect(carried[0]!.requestId).toBe(requests[i - 1]!.requestId);
      expect(carried[0]!.decisionKey).toBe(requests[i - 1]!.decisionKey);
      expect(carried[0]!.decisionTimeMs).toBe(requests[i - 1]!.decisionTimeMs);
      expect(carried[0]!.receipt).toEqual(r.staged[i - 1]!.receipt);
      // nothing but the receipt's own fields: no card, no seat, no identity
      expect(Object.keys(carried[0]!.receipt).sort()).toEqual(
        [
          'actual',
          'changed',
          'flippedTo',
          'format',
          'option',
          'personDealt',
          'personLive',
          'street',
          'variant',
          'version',
          'would',
        ].sort()
      );
    }
  });
  it('with no row, and for an option that is not staged, no decision record carries the field', async () => {
    const s = plo4With('person');
    const requests = [1, 2].map((i) => fastRequest(s, i));
    for (const states of [null, { [NOT_STAGED]: 'shadow' }] as const) {
      const r = await run(requests, scripted(NOT_STAGED, false, CALL, RAISE), states, stage());
      expect(r.journaled).toHaveLength(2);
      for (const j of r.journaled) expect('stagedOptionShadowReceipts' in j.payload).toBe(false);
    }
  });
  it('the journal record kinds are those of every earlier release (no kind was added)', () => {
    // the validator's list and the type are the pre-train ones: a record of any kind this tree writes passes the
    // validator of an older engine, and no segment can hold a kind an older engine refuses
    const f = correctiveFixture();
    for (const kind of [
      'request_lifecycle',
      'decision',
      'execution',
      'accepted_hand',
      'discard_decision',
      'discard_execution',
      'plan_receipt',
    ] as const)
      expect(() => validateHorseJournalRecord(f.make(kind, 1, { any: 1 })), kind).not.toThrow();
    expect(() =>
      validateHorseJournalRecord({ ...f.make('decision', 1, {}), kind: 'option_shadow_receipt' })
    ).toThrow('Invalid Horse journal record');
  });
  it('a decision record carrying staged receipts passes the journal validator and the hand review unchanged', () => {
    const f = correctiveFixture();
    const carried = [
      {
        decisionKey: 'another-decision',
        requestId: 7,
        decisionTimeMs: 1,
        receipt: {
          version: 1,
          option: 'omahaFourBetFoldPricedCall',
          flippedTo: true,
          changed: true,
          actual: { action: 'fold', amount: null },
          would: { action: 'call', amount: 40 },
          street: 'preflop',
          variant: 'plo5',
          format: 'cash',
          personDealt: true,
          personLive: true,
        },
      },
    ];
    const hand = (extra: Record<string, unknown>) => [
      f.make('decision', 1, { ...f.capture, ...extra }),
      f.make('execution', 2, f.witness),
      f.make('accepted_hand', 3, f.hand),
    ];
    const plain = reconcileHorseJournalHand(hand({}), HAND_KEY);
    const withCarried = hand({ stagedOptionShadowReceipts: carried });
    for (const record of withCarried)
      expect(() => validateHorseJournalRecord(record)).not.toThrow();
    const reviewed = reconcileHorseJournalHand(withCarried, HAND_KEY);
    const { manifest: _m1, ...concluded } = reviewed;
    const { manifest: _m0, ...expected } = plain;
    expect(concluded).toEqual(expected);
    expect(reviewed.gaps).toEqual(plain.gaps);
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
      for (const { requestId, receipt: r } of shadow.staged) {
        expect(r.option).toBe(STAGED);
        expect(['plo4', 'plo5'], fixtures[requestId - 1]!.id).toContain(r.variant.toLowerCase());
        expect(r.format).toBe('cash');
      }
      expect(shadow.staged.length).toBeGreaterThan(0);
      expect(shadow.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
      expect(plain.fasts.every((f) => f.decision.optionShadowReceipt === undefined)).toBe(true);
    });

  it('an option that is not staged: receipts, counters and decisions are those of the run without a stage table', async () => {
    const withStage = await run(requests(), decide, { [NOT_STAGED]: 'shadow' }, stage());
    const without = await run(
      requests(),
      decide,
      { [NOT_STAGED]: 'shadow' },
      {
        optionShadowStage: {},
      }
    );
    expect(withStage.fasts.map(comparable)).toEqual(without.fasts.map(comparable));
    expect(withStage.fasts.map((f) => f.decision.optionShadowReceipt)).toEqual(
      without.fasts.map((f) => f.decision.optionShadowReceipt)
    );
    expect(shadowKeys(withStage.features)).toEqual(shadowKeys(without.features));
    expect(shadowKeys(withStage.features).some((k) => k.includes('_stage_'))).toBe(false);
    expect(withStage.latency.some(([s]) => s === 'option_shadow_stage_redecide')).toBe(false);
    expect(withStage.staged).toEqual([]);
    expect(withStage.fasts.some((f) => f.decision.optionShadowReceipt)).toBe(true);
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

describe('the cost of one re-decision on PLO5 postflop spots, measured (HorseLogic.decide on the recorded PLO5 decisions)', () => {
  // A staged re-decision is one more decide of the same request with the option (and its companions) on. Timed here
  // on the recorded PLO5 flop, turn and river decisions of HorseOmahaPricedRules.fixture.json: as live (the cost
  // of re-deciding for an ordinary staged option) and with the math core owning the street (the core companion).
  const RECORDS = RECORDED_PLO5 as unknown as RecordedDecision[];
  const CORE = {
    omahaMathCore: true,
    omahaMathCorePlo5Flop: true,
    omahaMathCorePlo5Turn: true,
    omahaMathCorePlo5River: true,
  };
  it('per street, as live and with the math core', () => {
    const pct = (xs: number[], q: number) =>
      [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;
    let timed = 0;
    for (const street of ['flop', 'turn', 'river']) {
      const spots = RECORDS.filter(
        (r) => String(r.variant).toLowerCase() === 'plo5' && r.street === street
      );
      if (spots.length === 0) continue;
      for (const [label, extra] of [
        ['as live', {}],
        ['with the math core', CORE],
      ] as const) {
        const ms: number[] = [];
        for (const r of spots) {
          HorseMind.reset();
          const st = recordedState(r) as unknown as { hero: never; gs: never };
          seedFastRandom(1);
          const t0 = performance.now();
          HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
            telemetry: false,
            observeMind: false,
            decisionTimeMs: 1794938400000,
            ...LIVE_OPTIONS,
            ...extra,
          } as never);
          ms.push(performance.now() - t0);
        }
        timed += ms.length;
        const over50 = ms.filter((x) => x > OPTION_SHADOW_STAGE_SLOW_MS).length;
        const over150 = ms.filter((x) => x > OPTION_SHADOW_STAGE_HARD_MS).length;
        console.log(
          `PLO5 ${street} re-decision cost (${label}) over ${ms.length}: p50 ${pct(ms, 0.5).toFixed(2)} ms, p90 ${pct(ms, 0.9).toFixed(2)} ms, max ${pct(ms, 1).toFixed(2)} ms; over 50 ms ${over50}, over 150 ms ${over150}`
        );
      }
    }
    expect(timed).toBeGreaterThan(0);
  });
});

describe('the worker-start math core warm-up (2026-11-21, lane CORE-POOLED-3)', () => {
  const fixtures = recordedFast();
  const decide = HorseLogic.decide.bind(HorseLogic) as unknown as Decide;
  // the recorded FAST sample plus controller-dealt PLO4 and PLO5 cash flop decisions (the sample holds no PLO4/PLO5
  // postflop decision); built inside the test, after the worker harness is set up
  const omahaFlops = () => {
    const out: FastHorseDecisionRequest[] = [];
    const tpl = plo4Snapshot() as unknown as Record<string, unknown>;
    for (const variant of ['plo4', 'plo5'] as const)
      for (let cell = 0; cell < 6; cell++) {
        const { spot, config } = dealToFlop(variant, 'cash', cell);
        out.push({
          ...tpl,
          fence: `${config.tableId}:${config.handNumber}:${spot.hero.seat}:${cell}:1`,
          player: spot.hero,
          gameState: spot.state,
          handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
        } as unknown as FastHorseDecisionRequest);
      }
    return out;
  };
  const requests = (flops: FastHorseDecisionRequest[]) =>
    [...fixtures.map((f) => f.snapshot), ...flops].map((s, i) => fastRequest(s, i + 1));
  // the core on every PLO4/PLO5 street, so every Omaha cash decision of the sample is the core's
  const CORE = Object.fromEntries(
    ['omahaMathCore', ...Object.keys(OMAHA_MATH_CORE_ALL_STREETS)].map((n) => [n, 'on'])
  ) as unknown as OptionSwitchStates;
  afterEach(() => {
    vi.restoreAllMocks();
    clearOmahaMathCoreCaches();
  });

  it('prices its own spot and clears every core cache it filled', () => {
    expect(warmOmahaMathCore().ok).toBe(true);
  });

  it('acted decisions, journal records and the worker event order are those of no warm-up; it runs once, before READY and before any decision', async () => {
    // a clock that does not move: the core's work budget then bounds the work alone, so two runs are comparable
    vi.spyOn(performance, 'now').mockReturnValue(0);
    clearOmahaMathCoreCaches();
    const flops = omahaFlops();
    const cold = await run(requests(flops), decide, CORE);
    clearOmahaMathCoreCaches();
    const order: string[] = [];
    let warmOk: boolean | null = null;
    const warm = await run(
      requests(flops),
      ((...a: Parameters<Decide>) => {
        order.push('decide');
        return decide(...a);
      }) as Decide,
      CORE,
      {
        warmUp: () => {
          order.push('warm');
          warmOk = warmOmahaMathCore(() => 0).ok;
        },
      }
    );
    expect(warmOk).toBe(true);
    expect(order.filter((x) => x === 'warm')).toEqual(['warm']);
    expect(order[0]).toBe('warm');
    // the core decided in this sample (otherwise the comparison would prove nothing)
    expect(cold.fasts.filter((f) => f.decision.omahaMathCore).length).toBeGreaterThan(0);
    expect(warm.fasts.map(comparable)).toEqual(cold.fasts.map(comparable));
    expect(warm.events).toEqual(cold.events);
    expect(warm.journaled.map((j) => j.requestId)).toEqual(cold.journaled.map((j) => j.requestId));
    expect(warm.calls).toEqual(cold.calls);
  });
});

describe('deferred staged shadow re-enters the acted decision observer sandbox (zero false-positive drift)', () => {
  it('matches the acted decision when ambient HorseMind differs from the observer read view and stages Turn 4B options by street', async () => {
    const { spot, config } = dealToFlop('plo5', 'cash', 1);
    const tpl = riverSnapshot();
    const opp = spot.state.players.find((p) => p.seat !== spot.hero.seat)!;
    const req = fastRequest(
      {
        ...tpl,
        fence: `${config.tableId}:${config.handNumber}:${spot.hero.seat}:1:1`,
        player: spot.hero,
        gameState: spot.state,
        handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
      } as unknown as FastHorseDecisionRequest,
      1
    );
    // Pollute ambient HorseMind outside observerReads: without runReadOnly, deferred shadow would
    // read this ambient record (hands > 0) while the acted decision read the clean observer sandbox.
    const noOpReadingMind: Decide = (_p, g) => {
      const gs = g as { players?: Array<{ user_id: string }> };
      const villain = (gs.players ?? []).find((p) => p.user_id === opp.user_id);
      const stats = villain ? HorseMind.getStats(villain.user_id) : undefined;
      return (stats?.hands ?? 0) > 0 ? CALL : FOLD;
    };
    const r = await run(
      [req],
      noOpReadingMind,
      { omahaCbetRaiseIsPriced: 'shadow' } as unknown as OptionSwitchStates,
      {
        async startServices() {
          prepareTournamentFutureHandFacts();
          HorseMind.observe(
            [
              {
                stage: 'preflop',
                seat: opp.seat,
                userId: opp.user_id,
                action: 'raise',
                amount: 6,
                timestamp: DECISION_TIME_MS - 10_000,
              },
              {
                stage: 'flop',
                seat: opp.seat,
                userId: opp.user_id,
                action: 'bet',
                amount: 12,
                timestamp: DECISION_TIME_MS - 5_000,
              },
            ],
            spot.state.players,
            undefined,
            undefined,
            2,
            'pot_limit'
          );
          expect(HorseMind.getStats(opp.user_id)?.hands ?? 0).toBeGreaterThan(0);
          return readiness();
        },
      }
    );
    expect(r.staged.length).toBe(1);
    expect(r.staged[0]!.receipt.option).toBe('omahaCbetRaiseIsPriced');
    expect(r.staged[0]!.receipt.changed).toBe(false);
    expect(r.staged[0]!.receipt.actual).toEqual(r.staged[0]!.receipt.would);

    // Also prove omahaStabDefenceIsPriced skips flop (turn/river only, P1-3)
    const rFlopStab = await run([req], noOpReadingMind, {
      omahaStabDefenceIsPriced: 'shadow',
    } as unknown as OptionSwitchStates);
    expect(rFlopStab.staged.length).toBe(0);
  });
});
