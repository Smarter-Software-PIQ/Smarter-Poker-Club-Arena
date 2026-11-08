import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import {
  _clearGtoPostflopV31,
  gtoV31DemandCell,
  replaceGtoPostflopV31Evaluation,
  type GtoPostflopV31Row,
} from '../engine/GtoPostflopV31.js';
import type { V31DemandSpot } from '../engine/HorseV31CertifiedPolicy.js';
import {
  gtoV31EligibleCellFilter,
  proposeGtoV31CellPlan,
  recordGtoV31Demand,
  scoreGtoV31CellPlan,
  type GtoV31Demand,
} from './GtoV31DensityPreflight.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(value: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < value.length; i += 2) {
    out.push({ rank: value[i] as CardRank, suit: SUITS[value[i + 1]] });
  }
  return out;
}

const CHECKSUM = '7'.repeat(64);
/** A facing-bet turn cell (the replay-digest fixture's spot). */
const CELL: GtoPostflopV31Row = {
  dataset_id: '22222222-2222-4222-8222-222222222222',
  dataset_key: 'density-fixture',
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
  depth_bucket: 80,
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

function spot() {
  const hero = {
    seat: 1,
    user_id: 'hero',
    stack: 8_000,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: cards('3c4d'),
  };
  const villain = {
    ...hero,
    seat: 2,
    user_id: 'villain',
    stack: 7_940,
    bet: 60,
    totalInvested: 60,
    cards: [],
  };
  const gs = {
    players: [hero, villain],
    communityCards: cards('Qh9d7c2h'),
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

function decide(opts: Record<string, unknown>) {
  const { hero, gs } = spot();
  seedFastRandom(0xabc);
  return HorseLogic.decide(
    hero as never,
    gs as never,
    'balanced',
    {},
    {
      mind: false,
      telemetry: false,
      gtoV31DatasetChecksum: CHECKSUM,
      ...opts,
    }
  );
}

beforeEach(() => _clearGtoPostflopV31());

describe('R8 density pre-flight: the demand hook', () => {
  it('records the spot past an empty store and changes no decision', () => {
    const spots: V31DemandSpot[] = [];
    const without = decide({});
    const withHook = decide({ onV31Demand: (s: V31DemandSpot) => spots.push(s) });
    // Everything but wall-clock timing must match.
    const strip = (d: unknown) =>
      JSON.parse(
        JSON.stringify(d, (k, v) => (k === 'elapsedMs' || k === 'latencyMs' ? undefined : v))
      );
    expect(strip(withHook)).toEqual(strip(without));
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({
      street: 'turn',
      family: 'cash',
      tableSize: 2,
      potType: 'limped',
      heroPosition: 'BB',
      opponentPosition: 'SB',
      nodeRole: 'facing_bet',
      facingKind: 'bet',
      hit: false,
    });
  });

  it('keys the spot exactly as a sealed cell for it is keyed', () => {
    const empty: V31DemandSpot[] = [];
    decide({ onV31Demand: (s: V31DemandSpot) => empty.push(s) });
    replaceGtoPostflopV31Evaluation([CELL]);
    const loaded: V31DemandSpot[] = [];
    const answered = decide({ onV31Demand: (s: V31DemandSpot) => loaded.push(s) });
    expect(loaded[0].hit).toBe(true);
    expect(['fold', 'call', 'raise']).toContain(answered.action);
    const key = gtoV31DemandCell(empty[0])!;
    expect(key).toMatchObject({ depth: 80, texture: 'Brud' });
    expect(gtoV31DemandCell(loaded[0])!.key).toBe(key.key);
    // A board that does not fit the street can never be answered.
    expect(gtoV31DemandCell({ ...empty[0], board: cards('Qh9d7c') })).toBeNull();
  });
});

/** The fixture spot reached through a preflop line instead of a limped pot. */
function decidePreflop(
  preflop: Array<[number, 'call' | 'raise' | 'check', number]>,
  opts: Record<string, unknown>
) {
  const { hero, gs } = spot();
  gs.actionHistory = [
    ...preflop.map(([seat, action, amount], i) => ({
      stage: 'preflop',
      seat,
      userId: seat === 1 ? 'hero' : 'villain',
      action,
      amount,
      timestamp: -10 + i,
      ...(action === 'raise' ? { isFullRaise: true } : {}),
    })),
    ...gs.actionHistory,
  ];
  seedFastRandom(0xabc);
  return HorseLogic.decide(
    hero as never,
    gs as never,
    'balanced',
    {},
    {
      mind: false,
      telemetry: false,
      gtoV31DatasetChecksum: CHECKSUM,
      ...opts,
    }
  );
}

describe('V31 key: a limp-raised pot is not a single-raised pot', () => {
  const SRP_CELL: GtoPostflopV31Row = { ...CELL, pot_type: 'srp' };

  it('a raise-first-in single-raised pot is keyed srp and answered by the srp cell', () => {
    replaceGtoPostflopV31Evaluation([SRP_CELL]);
    const spots: V31DemandSpot[] = [];
    // Heads-up: the button (seat 2) opens, the big blind (hero) calls.
    decidePreflop(
      [
        [2, 'raise', 300],
        [1, 'call', 300],
      ],
      { onV31Demand: (s: V31DemandSpot) => spots.push(s) }
    );
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ potType: 'srp', hit: true });
  });

  it('a limped-then-raised pot never matches an srp cell', () => {
    replaceGtoPostflopV31Evaluation([SRP_CELL]);
    const spots: V31DemandSpot[] = [];
    // Heads-up: the button (seat 2) completes, the big blind (hero) raises, the button calls.
    decidePreflop(
      [
        [2, 'call', 100],
        [1, 'raise', 300],
        [2, 'call', 300],
      ],
      { onV31Demand: (s: V31DemandSpot) => spots.push(s) }
    );
    expect(spots).toHaveLength(1);
    expect(spots[0].potType).toBe('lrp');
    expect(spots[0].hit).toBe(false);
    // The density pre-flight keys it apart from the srp cell too.
    const asked = gtoV31DemandCell(spots[0])!;
    const srp = gtoV31DemandCell({ ...spots[0], potType: 'srp' })!;
    expect(asked.key).not.toBe(srp.key);
    expect(asked.key.split('|')[5]).toBe('lrp');
    expect(asked.key.split('|')).toHaveLength(13);
  });
});

describe('V31 key: a limp-re-raised pot is not a three-bet pot', () => {
  const THREE_BET_CELL: GtoPostflopV31Row = { ...CELL, pot_type: '3bet' };

  it('a raise-first-in three-bet pot is keyed 3bet and answered by the 3bet cell', () => {
    replaceGtoPostflopV31Evaluation([THREE_BET_CELL]);
    const spots: V31DemandSpot[] = [];
    // Heads-up: the button (seat 2) opens, the big blind (hero) three-bets, the button calls.
    decidePreflop(
      [
        [2, 'raise', 300],
        [1, 'raise', 900],
        [2, 'call', 900],
      ],
      { onV31Demand: (s: V31DemandSpot) => spots.push(s) }
    );
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ potType: '3bet', hit: true });
  });

  it('a limped, raised and re-raised pot never matches a 3bet cell', () => {
    replaceGtoPostflopV31Evaluation([THREE_BET_CELL]);
    const spots: V31DemandSpot[] = [];
    // Heads-up: the button completes, the big blind (hero) raises, the button
    // re-raises, the big blind calls.
    decidePreflop(
      [
        [2, 'call', 100],
        [1, 'raise', 300],
        [2, 'raise', 900],
        [1, 'call', 900],
      ],
      { onV31Demand: (s: V31DemandSpot) => spots.push(s) }
    );
    expect(spots).toHaveLength(1);
    expect(spots[0].potType).toBe('l3bet');
    expect(spots[0].hit).toBe(false);
    const asked = gtoV31DemandCell(spots[0])!;
    const threeBet = gtoV31DemandCell({ ...spots[0], potType: '3bet' })!;
    expect(asked.key).not.toBe(threeBet.key);
    expect(asked.key.split('|')[5]).toBe('l3bet');
    expect(asked.key.split('|')).toHaveLength(13);
  });
});

function demand(): GtoV31Demand {
  // Two tables: the contract plays max(10,000, ceil(50,000 / 2)) = 25,000 pairs each.
  return {
    family: 'cash',
    tables: ['cash_ev_2max_80bb', 'cash_ev_6max_80bb'],
    cells: {
      A: { potType: 'srp' } as never,
      B: { potType: 'srp' } as never,
      C: { potType: '3bet' } as never,
      D: { potType: 'srp' } as never,
    },
    unkeyable: 0,
    runs: [
      {
        run: 'paired_replay:t1',
        kind: 'paired_replay',
        table: 't1',
        memoryOff: false,
        probePairs: 1000,
        counts: { A: 10, B: 1 },
      },
      {
        run: 'paired_replay:t2',
        kind: 'paired_replay',
        table: 't2',
        memoryOff: false,
        probePairs: 1000,
        counts: { A: 2, C: 20, D: 1 },
      },
      {
        run: 'league:t1',
        kind: 'league',
        table: 't1',
        memoryOff: false,
        probePairs: 1000,
        counts: { A: 12, B: 1 },
      },
      {
        run: 'league:t1:memory_off',
        kind: 'league',
        table: 't1',
        memoryOff: true,
        probePairs: 1000,
        counts: { A: 11 },
      },
      {
        run: 'league:t2',
        kind: 'league',
        table: 't2',
        memoryOff: false,
        probePairs: 1000,
        counts: { A: 3, C: 18 },
      },
    ],
  };
}

describe('R8 density pre-flight: scoring and proposal', () => {
  it('scales demand to the contract pairs and applies the 300 floor per run', () => {
    const s = scoreGtoV31CellPlan(demand(), ['A', 'B']);
    expect(s.contractPairsPerTable).toBe(25_000);
    expect(s.runs.map((r) => r.expectedDecisions)).toEqual([275, 50, 325, 275, 75]);
    expect(s.runsUnderFloor).toBe(4);
    expect(s.minRunDecisions).toBe(50);
    expect(s.passes).toBe(false);
  });

  it('a cell must be reached in both kinds, with margin', () => {
    // D: 25 expected in paired replay, 0 in league.
    expect(scoreGtoV31CellPlan(demand(), ['A', 'D']).unreached).toEqual(['D']);
    expect(scoreGtoV31CellPlan(demand(), ['A']).unreached).toEqual([]);
  });

  it('proposes the densest in-scope cells and scores them honestly', () => {
    const p = proposeGtoV31CellPlan(demand(), { maxCells: 2, inScope: (c) => c.potType === 'srp' });
    // A (weakest kind 300) and B (25); C is out of scope; D is never reached in league.
    expect(p.keys).toEqual(['A', 'B']);
    expect(p.score.cells).toBe(2);
    // Floor first: A, then C covers the second table's deficit, then B; D never qualifies.
    const all = proposeGtoV31CellPlan(demand(), { maxCells: 10 });
    expect(all.keys).toEqual(['A', 'C', 'B']);
    expect(proposeGtoV31CellPlan(demand(), { maxCells: 0 }).keys).toEqual([]);
  });

  it('an eligible-cell file restricts the proposal to listed street/texture classes', () => {
    const d = demand();
    d.cells.A = { potType: 'srp', street: 'turn', texture: 'Brud' } as never;
    d.cells.B = { potType: 'srp', street: 'flop', texture: 'Brud' } as never;
    d.cells.D = { potType: 'srp', street: 'turn', texture: 'Mtud' } as never;
    const only = gtoV31EligibleCellFilter({
      format: 'r8_eligible_cells_v1',
      eligible: [{ street: 'turn', texture_class: 'Brud' }],
    });
    expect(proposeGtoV31CellPlan(d, { maxCells: 10, inScope: only }).keys).toEqual(['A']);
    expect(proposeGtoV31CellPlan(d, { maxCells: 10 }).keys).toContain('B');
    // without the filter the proposal is unchanged
    expect(proposeGtoV31CellPlan(d, { maxCells: 10 }).keys).toEqual(
      proposeGtoV31CellPlan(d, { maxCells: 10, inScope: () => true }).keys
    );
    for (const bad of [
      null,
      [],
      { eligible: [] },
      { eligible: [{ street: 'flop' }] },
      { eligible: [{ street: 'preflop', texture_class: 'Brud' }] },
      { eligible: [{ street: 'flop', texture_class: 'Xrud' }] },
      { eligible: [{ street: 'flop', texture_class: 'Brud', extra: 1 }] },
      {
        eligible: [
          { street: 'flop', texture_class: 'Brud' },
          { street: 'flop', texture_class: 'Brud' },
        ],
      },
    ])
      expect(() => gtoV31EligibleCellFilter(bad)).toThrow(/GTO_V31_ELIGIBLE_CELLS_/);
  });

  it('does not starve a sparse table for a dense one', () => {
    const run = (
      kind: 'paired_replay' | 'league',
      table: string,
      counts: Record<string, number>
    ) => ({
      run: `${kind}:${table}`,
      kind,
      table,
      memoryOff: false,
      probePairs: 1000,
      counts,
    });
    const d: GtoV31Demand = {
      family: 'cash',
      tables: ['t1', 't2'],
      cells: { E: {} as never, F: {} as never, G: {} as never },
      unkeyable: 0,
      runs: [
        run('paired_replay', 't1', { E: 20, F: 19 }),
        run('paired_replay', 't2', { G: 13 }),
        run('league', 't1', { E: 20, F: 19 }),
        run('league', 't2', { G: 13 }),
      ],
    };
    // Ranking by density alone would pick E and F and leave t2 with nothing.
    const p = proposeGtoV31CellPlan(d, { maxCells: 2 });
    expect(p.keys).toEqual(['E', 'G']);
    expect(p.score.passes).toBe(true);
  });
});

describe('R8 density pre-flight: a real probe', () => {
  it('records demand on a real certification table, every run, both kinds', async () => {
    const d = await recordGtoV31Demand({
      family: 'cash',
      tables: ['cash_ev_2max_80bb'],
      pairsPerTable: 40,
      runSeed: 7,
    });
    expect(d.runs.map((r) => r.run)).toEqual([
      'paired_replay:cash_ev_2max_80bb',
      'league:cash_ev_2max_80bb',
      'league:cash_ev_2max_80bb:memory_off',
    ]);
    const total = d.runs.reduce(
      (s, r) => s + Object.values(r.counts).reduce((a, b) => a + b, 0),
      0
    );
    expect(total).toBeGreaterThan(0);
    for (const c of Object.values(d.cells)) {
      expect(c).toMatchObject({ family: 'cash', tableSize: 2, depth: 80 });
    }
  }, 120_000);
});
