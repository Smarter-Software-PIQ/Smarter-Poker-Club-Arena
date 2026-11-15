// FLOP-5 D6: the dormant cell contract v3 consult in HorseV31CertifiedPolicy.
// Default OFF. Proves: the switch reads only GTO_V31_CELL_CONTRACT_V3_SERVING=on;
// with it off every decision (and the RNG it consumes) is what it was, for a v2
// store, a v3 store and an empty store; with it on a v2 store still decides
// exactly as before and a v3 store answers through the v3 key (line class,
// 200 bb), never through a v2 key.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  GTO_V31_CELL_CONTRACT_V3_SERVING_ENV,
  _setGtoV31CellContractV3ServingForTest,
  gtoV31CellContractV3ServingOn,
} from './GtoV31CellContractV3Serving.js';

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
}
function play(n: number): Run {
  const out: Run = { decisions: [], rng: [], v31: [] };
  for (let i = 0; i < n; i++) {
    const { hero, gs } = spot();
    seedFastRandom(0x2000 + i * 104729);
    out.decisions.push(
      HorseLogic.decide(hero as never, gs as never, 'balanced', {}, {
        mind: false,
        telemetry: false,
        gtoV31DatasetChecksum: CHECKSUM,
        onGtoV31Decision: (d: { cell: string; decisionState: { depthBucket: number } }) =>
          out.v31.push({ cell: d.cell, depthBucket: d.decisionState.depthBucket }),
      } as never)
    );
    out.rng.push(saveFastRandom());
  }
  return out;
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
const strip = (r: Run) => ({ decisions: withoutClock(r.decisions), rng: r.rng, v31: r.v31 });

const ENV_BEFORE = process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV];
beforeEach(() => {
  _clearGtoPostflopV31();
  _setGtoV31CellContractV3ServingForTest(null);
  delete process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV];
});
afterEach(() => {
  _clearGtoPostflopV31();
  _setGtoV31CellContractV3ServingForTest(null);
  if (ENV_BEFORE === undefined) delete process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV];
  else process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV] = ENV_BEFORE;
});

describe('V31 cell contract v3 serving switch', () => {
  it('is OFF unless the environment says exactly "on"', () => {
    expect(gtoV31CellContractV3ServingOn()).toBe(false);
    for (const value of ['', '1', 'true', 'ON', 'On', ' on', 'on ', 'yes', 'v3']) {
      process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV] = value;
      expect(gtoV31CellContractV3ServingOn(), value).toBe(false);
    }
    process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV] = 'on';
    expect(gtoV31CellContractV3ServingOn()).toBe(true);
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
    _setGtoV31CellContractV3ServingForTest(true);
    const on = play(80);
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
    _setGtoV31CellContractV3ServingForTest(true);
    const on = play(20);
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
    _setGtoV31CellContractV3ServingForTest(true);
    const on = play(30);
    expect(on.v31).toEqual([]);
    expect(strip(on)).toEqual(strip(off));
  });

  it('a v3 store and the switch read from the environment work the same way', () => {
    replaceGtoPostflopV31Evaluation([structuredClone(V3_CELL)]);
    process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV] = 'on';
    expect(play(5).v31).toHaveLength(5);
    process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV] = 'off';
    expect(play(5).v31).toHaveLength(0);
  });
});
