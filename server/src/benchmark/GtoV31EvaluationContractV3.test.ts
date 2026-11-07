/**
 * V31 evaluation contract v3: the tables come from the playbook's own cells.
 * PostgreSQL derives the same list (fn_gto_v31_v3_tables); the native proof
 * scripts/ci/test-v31-evaluation-contract-v3.py pins the SQL side against the
 * same fixture (CASH_CELLS below).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GTO_V31_V3_MIN_TABLE_DECISIONS,
  buildGtoV31EvaluationScenariosV3,
  gtoV31V3Context,
  gtoV31V3PairsPerTable,
  gtoV31V3Refusal,
  gtoV31V3Tables,
  parseGtoV31V3Table,
  type GtoV31V3CellContext,
  type GtoV31V3Component,
} from './GtoV31EvaluationContractV3.js';
import { playHand, runMatchup } from './HorseLeague.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';
import { HorseMind } from '../engine/HorseMind.js';

const CHECKSUM = 'ab'.repeat(32);
let n = 0;
const cell = (
  family: GtoV31V3CellContext['game_family'],
  utility: string,
  size: number,
  depth: number,
  role = 'cbet'
): GtoV31V3CellContext => ({
  cell_key_checksum: (++n).toString(16).padStart(64, '0'),
  game_family: family,
  utility_context: utility,
  table_size: size,
  depth_bucket: depth,
  node_role: role,
});

/** The fixture the PostgreSQL proof uses (scripts/ci/test-v31-evaluation-contract-v3.py). */
const CASH_CELLS = [
  cell('cash', 'cash_ev', 2, 80),
  cell('cash', 'cash_ev', 2, 80, 'facing_bet'),
  cell('cash', 'cash_ev', 6, 100),
  cell('cash', 'cash_ev', 6, 80, 'facing_bet'),
  cell('cash', 'cash_ev', 10, 100),
];

describe('contract v3 table derivation', () => {
  it('one table per (utility, size, depth) in byte order, plus the human six-max table', () => {
    expect(gtoV31V3Tables('cash', CASH_CELLS)).toEqual([
      'cash_ev_10max_100bb',
      'cash_ev_2max_80bb',
      'cash_ev_6max_100bb',
      'cash_ev_6max_80bb',
      'human_cash_ev_6max_100bb',
    ]);
  });

  it("R7's cells: the four cash contexts it sealed, where v2 tested one", () => {
    const r7 = [
      ...Array.from({ length: 9 }, () => cell('cash', 'cash_ev', 10, 80)),
      ...Array.from({ length: 8 }, () => cell('cash', 'cash_ev', 2, 10)),
      cell('cash', 'cash_ev', 2, 80),
      ...Array.from({ length: 9 }, () => cell('cash', 'cash_ev', 9, 40)),
    ];
    expect(gtoV31V3Tables('cash', r7)).toEqual([
      'cash_ev_10max_80bb',
      'cash_ev_2max_10bb',
      'cash_ev_2max_80bb',
      'cash_ev_9max_40bb',
    ]);
  });

  it('a family without cells has nothing to certify', () => {
    expect(gtoV31V3Tables('spin', CASH_CELLS)).toEqual([]);
    expect(gtoV31V3Tables('tourney_icm', CASH_CELLS)).toEqual([]);
  });

  it('tournament utilities name their own tables; no human table outside cash', () => {
    expect(
      gtoV31V3Tables('tourney_icm', [
        cell('tourney_icm', 'bubble', 6, 40),
        cell('tourney_icm', 'satellite', 6, 150),
        cell('tourney_icm', 'bubble', 5, 20),
      ])
    ).toEqual(['bubble_5max_20bb', 'bubble_6max_40bb', 'satellite_6max_150bb']);
  });

  it('refuses a utility the family cannot carry and impossible geometry', () => {
    expect(() => gtoV31V3Tables('cash', [cell('cash', 'bubble', 6, 40)])).toThrow(
      'v31_v3_unknown_utility'
    );
    expect(() => gtoV31V3Tables('cash', [cell('cash', 'cash_ev', 11, 40)])).toThrow(
      'v31_v3_cell_geometry_invalid'
    );
    expect(() => gtoV31V3Tables('cash', [cell('cash', 'cash_ev', 6, 0)])).toThrow(
      'v31_v3_cell_geometry_invalid'
    );
  });

  it('parses its own names and refuses anything else', () => {
    expect(parseGtoV31V3Table('cash', 'human_cash_ev_6max_100bb')).toEqual({
      key: 'human_cash_ev_6max_100bb',
      human: true,
      utility: 'cash_ev',
      seats: 6,
      depthBB: 100,
    });
    expect(parseGtoV31V3Table('tourney_icm', 'final_table_7max_40bb').utility).toBe('final_table');
    expect(() => parseGtoV31V3Table('cash', 'human_cash_ev_2max_80bb')).toThrow();
    expect(() => parseGtoV31V3Table('spin', 'cash_ev_2max_80bb')).toThrow();
    expect(() => parseGtoV31V3Table('cash', 'cash_ev_2max')).toThrow();
  });

  it('pairs: never under 10,000 a table, at least 50,000 a family', () => {
    expect(gtoV31V3PairsPerTable(1)).toBe(50_000);
    expect(gtoV31V3PairsPerTable(3)).toBe(16_667);
    expect(gtoV31V3PairsPerTable(5)).toBe(10_000);
    expect(gtoV31V3PairsPerTable(8)).toBe(10_000);
    expect(() => gtoV31V3PairsPerTable(0)).toThrow();
  });
});

describe('contract v3 table contexts', () => {
  it('reproduces the v2 shapes at the v2 geometry', () => {
    const spin = gtoV31V3Context('spin', parseGtoV31V3Table('spin', 'chip_ev_3max_20bb'));
    expect(spin.tournament?.stacks).toEqual([44, 40, 36]);
    const ladder = gtoV31V3Context('spin', parseGtoV31V3Table('spin', 'spin_ladder_3max_20bb'));
    expect(ladder.tournament?.stacks).toEqual([46, 40, 34]);
    expect(ladder.tournament?.payoutPct).toEqual([0.8, 0.2]);
    const icm = gtoV31V3Context(
      'tourney_icm',
      parseGtoV31V3Table('tourney_icm', 'ladder_6max_40bb')
    );
    expect(icm.tournament?.stacks?.[0]).toBe(160);
    expect(icm.tournament?.stacks?.[5]).toBe(32);
    expect(icm.tournament?.playersLeft).toBe(18);
    const sat = gtoV31V3Context(
      'tourney_icm',
      parseGtoV31V3Table('tourney_icm', 'satellite_6max_40bb')
    );
    expect(sat.tournament?.playersLeft).toBe(12);
    expect(sat.tournament?.satelliteSeats).toBe(6);
    const bubble = gtoV31V3Context(
      'tourney_icm',
      parseGtoV31V3Table('tourney_icm', 'bubble_6max_40bb')
    );
    expect(bubble.tournament?.playersLeft).toBe(7);
    expect(bubble.tournament?.payoutPct?.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(gtoV31V3Context('cash', parseGtoV31V3Table('cash', 'cash_ev_2max_80bb'))).toEqual({
      gameMode: 'cash',
      format: 'cash',
      ante: 0,
    });
  });
});

describe('contract v3 scenarios', () => {
  it('league tables carry a learning-off twin of the same deal; replays do not', () => {
    const tables = gtoV31V3Tables('cash', CASH_CELLS);
    const league = buildGtoV31EvaluationScenariosV3('cash', 'league', CHECKSUM, tables);
    expect(league.map((s) => s.key)).toEqual(tables);
    for (const s of league) {
      expect(s.pairs).toBe(10_000);
      expect(s.matchup.moodClock).toBe('deal_seed');
      expect(s.memoryOff).toEqual({
        ...s.matchup,
        name: `${s.matchup.name}_memory_off`,
        memoryLearning: 'off',
      });
      expect(s.matchup.a).toEqual({ gtoV31DatasetChecksum: CHECKSUM });
      expect(s.matchup.b).toEqual({});
    }
    const human = league.find((s) => s.table.human)!;
    expect(human.matchup.opponentPopulation).toBe(HUMAN_CALIBRATED_POPULATION_ID);
    expect(human.matchup.hybridBaseline).toBeUndefined();
    expect(human.matchup.seats).toBe(6);
    expect(league.filter((s) => !s.table.human).every((s) => s.matchup.hybridBaseline)).toBe(true);
    const replay = buildGtoV31EvaluationScenariosV3('cash', 'paired_replay', CHECKSUM, tables);
    expect(replay.every((s) => s.memoryOff === null)).toBe(true);
    expect(replay[0].matchup.a).toEqual({
      gtoV31DatasetChecksum: CHECKSUM,
      mind: false,
      telemetry: false,
    });
  });

  it('refuses an empty or duplicated table list and a missing checksum', () => {
    expect(() => buildGtoV31EvaluationScenariosV3('cash', 'league', CHECKSUM, [])).toThrow();
    expect(() =>
      buildGtoV31EvaluationScenariosV3('cash', 'league', CHECKSUM, [
        'cash_ev_2max_80bb',
        'cash_ev_2max_80bb',
      ])
    ).toThrow();
    expect(() =>
      buildGtoV31EvaluationScenariosV3('cash', 'league', '0'.repeat(64), ['cash_ev_2max_80bb'])
    ).toThrow();
  });
});

describe('contract v3 local refusal mirrors the database floors', () => {
  const tables = ['cash_ev_2max_80bb', 'cash_ev_6max_100bb'];
  const run = (hits: number, cells: string[]) => ({
    hands: 50_000,
    bb100: 0,
    stderr: 1,
    durationMs: 1,
    illegalActions: 0,
    truncatedStreets: 0,
    candidatePolicyHits: hits,
    candidateExecutionMismatches: 0,
    candidateCells: cells,
  });
  const comp = (
    scenario: string,
    hits: number,
    cells: string[],
    off?: number
  ): GtoV31V3Component => ({
    scenario,
    ...run(hits, cells),
    candidateNodeRoles: ['cbet'],
    ...(off !== undefined ? { memoryOff: run(off, cells) } : {}),
  });

  it('accepts complete evidence and names each violation', () => {
    const ok = [comp(tables[0], 400, ['a'], 350), comp(tables[1], 300, ['b'], 300)];
    expect(gtoV31V3Refusal('league', tables, 25_000, ok, ['a', 'b'])).toBeNull();
    expect(
      gtoV31V3Refusal(
        'league',
        tables,
        25_000,
        [ok[0], comp(tables[1], 299, ['b'], 300)],
        ['a', 'b']
      )
    ).toMatch(`floor is ${GTO_V31_V3_MIN_TABLE_DECISIONS}`);
    expect(
      gtoV31V3Refusal(
        'league',
        tables,
        25_000,
        [ok[0], comp(tables[1], 300, ['b'], 12)],
        ['a', 'b']
      )
    ).toMatch('memory-off run');
    expect(
      gtoV31V3Refusal('league', tables, 25_000, [ok[0], comp(tables[1], 300, ['b'])], ['a', 'b'])
    ).toMatch('no memory-off run');
    expect(gtoV31V3Refusal('paired_replay', tables, 25_000, ok, ['a', 'b'])).toMatch(
      'carries no memory-off run'
    );
    expect(gtoV31V3Refusal('league', tables, 25_000, ok, ['a', 'b', 'c'])).toMatch(
      '1 sealed cells were never executed'
    );
    expect(gtoV31V3Refusal('league', tables, 24_999, ok, ['a', 'b'])).toMatch('expected 49998');
    expect(gtoV31V3Refusal('league', [...tables].reverse(), 25_000, ok, ['a', 'b'])).toMatch(
      'expected table'
    );
  });
});

describe('LeagueMatchup.memoryLearning off', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a settled hand teaches the sandbox nothing', () => {
    const on = HorseMind.createSandbox();
    const off = HorseMind.createSandbox();
    for (let h = 0; h < 30; h++) {
      const seed = 9000 + h * 104729;
      playHand(seed, (h % 6) + 1, () => ({}), undefined, on);
      playHand(
        seed,
        (h % 6) + 1,
        () => ({ observeMind: false }),
        undefined,
        off,
        'nlh',
        6,
        100,
        undefined,
        undefined,
        undefined,
        undefined,
        false
      );
    }
    expect(on.stats.size).toBeGreaterThan(0);
    expect(off.stats.size).toBe(0);
  });

  it('runMatchup observes nothing with learning off and learns with it on', async () => {
    const observe = vi.spyOn(HorseMind, 'observe');
    const settle = vi.spyOn(HorseMind, 'observeHandComplete');
    const card = { name: 'v3_memory_probe', seats: 6, a: {}, b: {} };
    await runMatchup({ ...card, memoryLearning: 'off' }, 12, 7);
    expect(observe).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    await runMatchup(card, 12, 7);
    expect(observe).toHaveBeenCalled();
    expect(settle).toHaveBeenCalled();
  });
});
