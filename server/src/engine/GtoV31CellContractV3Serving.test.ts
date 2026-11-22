// FLOP-5 D6: the dormant cell contract v3 consult in HorseV31CertifiedPolicy.
// OFF unless the live switch passes gtoV31CellContractV3Serving true (registered,
// off-only under the owner's R7/R8 hold). Proves: the decision reads only that
// option (the old environment variable is ignored); with it off every decision
// (and the RNG it consumes) is what it was, for a v2 store, a v3 store and an
// empty store; with it on a v2 store still decides exactly as before and a v3
// store answers through the v3 key (line class, 200 bb), never through a v2
// key; with v3 serving the decision and demand records carry the v3 cell's
// facing, size and line (N2) and a v2 store's records are unchanged; the
// registry carries the option off-only; the loader follows the worker's
// switch reading and is told of a change once.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { HorseLogic } from './HorseLogic.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import {
  _clearGtoPostflopV31,
  gtoV31StoreCellContract,
  replaceGtoPostflopV31Evaluation,
  type GtoPostflopV31Row,
} from './GtoPostflopV31.js';
import { classifyGtoDecisionContextV3 } from './GtoDecisionContext.js';
import {
  GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION,
  _resetGtoV31CellContractV3ServingSwitchForTest,
  _setGtoV31CellContractV3ServingForTest,
  gtoV31CellContractV3ServingLoaderOn,
  gtoV31CellContractV3ServingOn,
  noteGtoV31CellContractV3ServingSwitch,
  onGtoV31CellContractV3ServingChange,
} from './GtoV31CellContractV3Serving.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_REGISTRY,
  optionSwitchDecisionOpts,
  optionSwitchRefusal,
} from './HorseOptionSwitch.js';
import { V31_REPLAY_OPTS } from './HorseV31CertifiedPolicy.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';

/** The environment variable that carried the switch before it was registered: nothing reads it now. */
const RETIRED_ENV = 'GTO_V31_CELL_CONTRACT_V3_SERVING';
const ON = { [GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION]: true } as const;

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (v: string): Card[] =>
  (v.match(/../g) ?? []).map((c) => ({ rank: c[0] as CardRank, suit: SUITS[c[1]] }));
const CHECKSUM = '7'.repeat(64);
const BOARD = cards('Qh9d7c2h');
const STACK = 20_000; // 200 bb at a 100-chip big blind

/** Heads-up limped pot, turn: hero (BB, seat 1) checked, villain bets 60 into 100. */
function spot() {
  const hero = {
    seat: 1,
    user_id: 'hero',
    stack: STACK,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: cards('3c4d'),
  };
  const villain = {
    seat: 2,
    user_id: 'villain',
    stack: STACK - 60,
    bet: 60,
    totalInvested: 60,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: [] as Card[],
  };
  const gs = {
    players: [hero, villain],
    communityCards: BOARD,
    pot: 160,
    currentBet: 60,
    minRaise: 60,
    stage: 'turn',
    gameVariant: 'nlh',
    gameMode: 'cash',
    format: 'cash',
    bigBlind: 100,
    smallBlind: 50,
    dealerSeat: 2,
    actionHistory: [
      { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 0 },
      { stage: 'flop', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 1 },
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 2 },
      { stage: 'turn', seat: 2, userId: 'villain', action: 'bet', amount: 60, timestamp: 3 },
    ],
  };
  return { hero, gs };
}
const LINE = (() => {
  const { hero, gs } = spot();
  const v3 = classifyGtoDecisionContextV3({
    street: 'turn',
    hero,
    opponents: [gs.players[1]],
    actionHistory: gs.actionHistory as never,
    currentBet: gs.currentBet,
    pot: gs.pot,
    effectiveRootChips: STACK,
  });
  if (!v3) throw new Error('fixture spot does not classify under v3');
  return v3;
})();

const V2_CELL: GtoPostflopV31Row = {
  dataset_id: '22222222-2222-4222-8222-222222222222',
  dataset_key: 'd6-fixture',
  dataset_checksum: CHECKSUM,
  solver_version: 'PioSOLVER-3.0',
  solver_binary_checksum: 'b'.repeat(64),
  pipeline_commit: 'c'.repeat(40),
  pipeline_bundle_checksum: 'b'.repeat(64),
  manifest_version: '5',
  manifest_checksum: 'd'.repeat(64),
  source_artifact_checksum: 'e'.repeat(64),
  source_combo_order_checksum: 'f'.repeat(64),
  range_bundle_checksum: '1'.repeat(64),
  icm_model_checksum: '5'.repeat(64),
  input_bundle_checksum: '6'.repeat(64),
  cell_key_checksum: '3'.repeat(64),
  cell_payload_checksum: '4'.repeat(64),
  lineage_checksum: '2'.repeat(64),
  quality_status: 'validated',
  dataset_state: 'evaluating',
  dataset_cells: 1,
  source_rows: 20,
  train_source_rows: 18,
  holdout_source_rows: 2,
  invalid_rows: 0,
  audited_at: '2026-09-08T12:00:00.000Z',
  street: 'turn',
  game_family: 'cash',
  objective: 'cash_ev',
  utility_context: 'cash_ev',
  table_size: 2,
  pot_type: 'limped',
  hero_position: 'BB',
  opponent_position: 'SB',
  depth_bucket: 150,
  texture_class: 'Brud',
  node_role: 'facing_bet',
  facing_kind: 'bet',
  facing_size_bucket: 'mid',
  hand_matrix: { '43o:11': { f: 0.2, c: 0.5, b75: 0.3 } },
  action_specs: {
    f: { family: 'fold', size_unit: 'none', size_value: null, all_in: false },
    c: { family: 'call', size_unit: 'none', size_value: null, all_in: false },
    b75: { family: 'raise', size_unit: 'pot_after_call_fraction', size_value: 0.75, all_in: false },
  },
  policy_ev_matrix: { '43o:11': 0 },
  action_ev_matrix: { '43o:11': { f: 0, c: 0, b75: 0 } },
};
/** The same spot as a v3 cell: its own public line, the 200 bb bucket, a different mix. */
const V3_CELL: GtoPostflopV31Row = {
  ...structuredClone(V2_CELL),
  cell_contract_version: 'v3',
  line_class: LINE.lineClass,
  depth_bucket: 200,
  node_role: LINE.nodeRole as GtoPostflopV31Row['node_role'],
  facing_kind: LINE.facingKind,
  facing_size_bucket: LINE.facingSizeBucket,
  hand_matrix: { '43o:11': { f: 0, c: 0, b75: 1 } },
};

interface Run {
  decisions: HorseDecision[];
  rng: number[];
  v31: Array<{ cell: string; depthBucket: number }>;
  states: Array<Record<string, unknown>>;
}
function play(n: number, extra: Record<string, unknown> = {}): Run {
  return withFrozenDecisionClock(() => {
    const out: Run = { decisions: [], rng: [], v31: [], states: [] };
    for (let i = 0; i < n; i++) {
      const { hero, gs } = spot();
      seedFastRandom(0x2000 + i * 104729);
      out.decisions.push(
        HorseLogic.decide(hero as never, gs as never, 'balanced', {}, {
          mind: false,
          telemetry: false,
          gtoV31DatasetChecksum: CHECKSUM,
          onGtoV31Decision: (d: { cell: string; decisionState: { depthBucket: number } }) => {
            out.v31.push({ cell: d.cell, depthBucket: d.decisionState.depthBucket });
            out.states.push(d.decisionState as never);
          },
          ...extra,
        } as never)
      );
      out.rng.push(saveFastRandom());
    }
    return out;
  });
}
/** The demand records of n consults (the offline probe hook; the probe consults even an empty store). */
function demand(n: number, extra: Record<string, unknown> = {}): Array<Record<string, unknown>> {
  return withFrozenDecisionClock(() => {
    const spots: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
      const { hero, gs } = spot();
      seedFastRandom(0x3000 + i * 7919);
      HorseLogic.decide(hero as never, gs as never, 'balanced', {}, {
        mind: false,
        telemetry: false,
        gtoV31DatasetChecksum: CHECKSUM,
        onV31Demand: (s: Record<string, unknown>) => spots.push(s),
        ...extra,
      } as never);
    }
    return spots;
  });
}
// Wall-clock fields (think time, latency) are not decisions; everything else is compared.
const CLOCK = new Set(['thinkTime', 'latencyMs', 'elapsedMs']);
const withoutClock = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutClock)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([k]) => !CLOCK.has(k))
            .map(([k, v]) => [k, withoutClock(v)])
        )
      : value;
const strip = (r: Run) => ({
  decisions: withoutClock(r.decisions),
  rng: r.rng,
  v31: r.v31,
  states: withoutClock(r.states),
});

const ENV_BEFORE = process.env[RETIRED_ENV];
beforeEach(() => {
  _clearGtoPostflopV31();
  _setGtoV31CellContractV3ServingForTest(null);
  _resetGtoV31CellContractV3ServingSwitchForTest();
  delete process.env[RETIRED_ENV];
});
afterEach(() => {
  _clearGtoPostflopV31();
  _setGtoV31CellContractV3ServingForTest(null);
  _resetGtoV31CellContractV3ServingSwitchForTest();
  if (ENV_BEFORE === undefined) delete process.env[RETIRED_ENV];
  else process.env[RETIRED_ENV] = ENV_BEFORE;
});

describe('V31 cell contract v3 serving switch', () => {
  it('is OFF unless the decision was passed the option true; the retired environment variable is ignored', () => {
    expect(gtoV31CellContractV3ServingOn()).toBe(false);
    expect(gtoV31CellContractV3ServingOn(undefined)).toBe(false);
    expect(gtoV31CellContractV3ServingOn(false)).toBe(false);
    expect(gtoV31CellContractV3ServingOn(true)).toBe(true);
    process.env[RETIRED_ENV] = 'on';
    expect(gtoV31CellContractV3ServingOn()).toBe(false);
    expect(gtoV31CellContractV3ServingLoaderOn()).toBe(false);
  });

  it('is a registered option of the live switch, off-only under the R7/R8 hold, and in the replay state', () => {
    const entry = OPTION_SWITCH_REGISTRY.find(
      (e) => e.name === GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION
    );
    expect(entry?.states).toEqual(['off']);
    expect(entry?.releaseDefault).toBe('off');
    expect(entry?.offOnly?.status).toBe('hold');
    expect(entry?.offOnly?.source).toMatch(/R7\/R8/);
    expect(OPTION_SWITCH_NAMES).toContain(GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION);
    expect(OPTION_SWITCH_OFF_ONLY_NAMES).toContain(GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION);
    expect(optionSwitchRefusal(GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION)).toBeNull();
    // the hold still refuses every other V31 name, existing or future
    for (const name of ['v31GtoSuitAware', 'v31Anything', 'gtoV31Other', 'solverRound7'])
      expect(optionSwitchRefusal(name), name).toEqual(expect.any(String));
    // off-only: an on row never passes true; an off row passes false; no row passes nothing
    expect(optionSwitchDecisionOpts({ [GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION]: 'on' })).toEqual(
      {}
    );
    expect(optionSwitchDecisionOpts({ [GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION]: 'off' })).toEqual({
      [GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION]: false,
    });
    expect(optionSwitchDecisionOpts({})).toEqual({});
    expect(V31_REPLAY_OPTS).toContain(GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION);
    const ledger = HORSE_DATA_LEDGER.filter(
      (e) => e.key === GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION
    );
    expect(ledger.map((e) => e.kind)).toEqual(['flag']);
  });

  it('the loader follows the switch value the worker reports, and is told of a change once', () => {
    let reloads = 0;
    onGtoV31CellContractV3ServingChange(() => reloads++);
    expect(gtoV31CellContractV3ServingLoaderOn()).toBe(false);
    noteGtoV31CellContractV3ServingSwitch(undefined);
    noteGtoV31CellContractV3ServingSwitch(false);
    expect(reloads).toBe(0);
    noteGtoV31CellContractV3ServingSwitch(true);
    noteGtoV31CellContractV3ServingSwitch(true);
    expect(gtoV31CellContractV3ServingLoaderOn()).toBe(true);
    expect(reloads).toBe(1);
    noteGtoV31CellContractV3ServingSwitch(undefined);
    expect(gtoV31CellContractV3ServingLoaderOn()).toBe(false);
    expect(reloads).toBe(2);
    onGtoV31CellContractV3ServingChange(null);
    noteGtoV31CellContractV3ServingSwitch(true);
    expect(reloads).toBe(2);
  });

  it('names the cell contract of the store a lookup reads', () => {
    expect(gtoV31StoreCellContract(CHECKSUM)).toBeNull();
    replaceGtoPostflopV31Evaluation([structuredClone(V2_CELL)]);
    expect(gtoV31StoreCellContract(CHECKSUM)).toBe('v2');
    expect(gtoV31StoreCellContract()).toBeNull(); // the live store is still empty
    _clearGtoPostflopV31();
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    expect(gtoV31StoreCellContract(CHECKSUM)).toBe('v3');
  });
});

describe('V31 certified consult with the switch OFF (default): unchanged', () => {
  it('a v3 store decides exactly as an empty store does (it never answers a v2 consult)', () => {
    const empty = play(60);
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    const v3Off = play(60);
    expect(strip(v3Off)).toEqual(strip(empty));
    expect(v3Off.v31).toEqual([]);
  });

  it('a v2 store decides identically with the switch off and on, and is served by the v2 key', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V2_CELL)]);
    const off = play(80);
    const on = play(80, ON);
    expect(strip(on)).toEqual(strip(off));
    expect(off.v31).toHaveLength(80);
    expect(off.v31.every((d) => d.depthBucket === 150 && !d.cell.includes('|v3|'))).toBe(true);
    // The mix is really mixed, so equality above includes the RNG positions.
    expect(new Set(off.decisions.map((d) => d.action)).size).toBeGreaterThanOrEqual(2);
  });
});

describe('V31 certified consult with the switch ON and a v3 store', () => {
  it('answers through the v3 key: the line class and the 200 bb bucket', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    const on = play(20, ON);
    expect(on.v31).toHaveLength(20);
    for (const d of on.v31) {
      expect(d.depthBucket).toBe(200);
      expect(d.cell.endsWith(`|v3|${LINE.lineClass}`)).toBe(true);
    }
    // The v3 cell's mix (always the 0.75 raise) is what was played.
    expect(on.decisions.every((d) => d.action === 'raise')).toBe(true);
  });

  it('never substitutes another line: a v3 cell for a different line misses and falls through', () => {
    const other = { ...structuredClone(V3_CELL), line_class: 'x.x/x.b-big' };
    replaceGtoPostflopV31Evaluation([other]);
    const off = play(30);
    const on = play(30, ON);
    expect(on.v31).toEqual([]);
    expect(strip(on)).toEqual(strip(off));
  });

  it('the option passed false, or the retired environment variable, serves nothing from a v3 store', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    expect(play(5, ON).v31).toHaveLength(5);
    expect(play(5, { [GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION]: false }).v31).toHaveLength(0);
    process.env[RETIRED_ENV] = 'on';
    expect(play(5).v31).toHaveLength(0);
  });
});

describe('records under v3 serving (N2): the v3 cell, never the v2 classifier', () => {
  it('the decision record carries the v3 cell contract, line, facing and size', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    const on = play(10, ON);
    expect(on.states).toHaveLength(10);
    for (const state of on.states) {
      expect(state.cellContract).toBe('v3');
      expect(state.lineClass).toBe(LINE.lineClass);
      expect(state.nodeRole).toBe(LINE.nodeRole);
      expect(state.facingKind).toBe(LINE.facingKind);
      expect(state.facingSizeBucket).toBe(LINE.facingSizeBucket);
    }
  });

  it('a v2 store records exactly as before, with the switch off or on (no v3 keys)', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V2_CELL)]);
    const off = play(20);
    const on = play(20, ON);
    expect(on.states).toEqual(off.states);
    for (const state of off.states) {
      expect(Object.hasOwn(state, 'cellContract')).toBe(false);
      expect(Object.hasOwn(state, 'lineClass')).toBe(false);
    }
  });

  it('the demand record names the v3 cell when v3 serves, and is unchanged otherwise', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    const v3 = demand(5, ON);
    expect(v3).toHaveLength(5);
    for (const spot of v3) {
      expect(spot.cellContract).toBe('v3');
      expect(spot.lineClass).toBe(LINE.lineClass);
      expect(spot.nodeRole).toBe(LINE.nodeRole);
      expect(spot.facingKind).toBe(LINE.facingKind);
      expect(spot.facingSizeBucket).toBe(LINE.facingSizeBucket);
      expect(spot.hit).toBe(true);
    }
    _clearGtoPostflopV31();
    replaceGtoPostflopV31Evaluation([structuredClone(V2_CELL)]);
    const v2Off = demand(5);
    const v2On = demand(5, ON);
    expect(withoutClock(v2On)).toEqual(withoutClock(v2Off));
    for (const spot of v2Off) {
      expect(Object.hasOwn(spot, 'cellContract')).toBe(false);
      expect(Object.hasOwn(spot, 'lineClass')).toBe(false);
    }
  });
});
