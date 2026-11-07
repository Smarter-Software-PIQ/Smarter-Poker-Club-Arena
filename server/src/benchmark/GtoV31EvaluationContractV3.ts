/**
 * V31 EVALUATION CONTRACT V3 (2026-11-06).
 *
 * Contract v2 tested every playbook on one fixed table per utility context:
 * heads-up 80bb cash, three-handed 20bb spins, six-handed 40bb tournaments.
 * R7 (dataset 187815b1) sealed 107 cells; its cash cells sat at ten-handed
 * 80bb (9), heads-up 10bb (8), nine-handed 40bb (9) and heads-up 80bb (1),
 * so the cash certification reached exactly one cell, and across all four
 * families 98 of the 107 cells were never played by any test. The verdict
 * also came from a single learning-on league run, and R7's league/cash loss
 * existed only with horse memory learning on (an exploit-read defect, V83).
 *
 * v3 derives the test tables from the playbook's own cells:
 *
 *   - one table per distinct (utility context, table size, depth) the
 *     family's cells use, named `${utility}_${size}max_${depth}bb`, sorted
 *     byte-wise; cash adds one human-calibrated six-max table
 *     (`human_cash_ev_6max_${depth}bb`, the deepest six-max cash depth) when
 *     the dataset has six-max cash cells (the field deals six-max only);
 *   - every table plays max(10,000, ceil(50,000 / tables)) duplicate pairs,
 *     so the family keeps its 100,000 hands and adding tables never thins one;
 *   - every table must execute at least 300 playbook decisions;
 *   - every league table also runs with memory learning off (same seed, same
 *     deals); the verdict still comes from the learning-on run;
 *   - every component lists the cell_key_checksum of each sealed cell it
 *     executed, and every sealed cell must be executed by at least one table
 *     of each kind.
 *
 * PostgreSQL derives the same table list from gto_v31_runtime_cells
 * (fn_gto_v31_v3_tables) and refuses a receipt whose tables, floors, cells or
 * memory-off runs differ. Datasets registered before v3 installed keep the v2
 * contract and their receipts.
 */

import {
  runMatchup,
  type LeagueBenchmarkComponent,
  type LeagueGameContext,
  type LeagueMatchup,
  type LeagueResult,
} from './HorseLeague.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';
import type {
  GtoV31EvaluationFamily,
  GtoV31EvaluationKind,
  GtoV31EvaluationScenario,
} from './GtoV31CandidateEvaluation.js';

export const GTO_V31_EVALUATION_CONTRACT_V3 = 'gto_v31_candidate.v3' as const;
export const GTO_V31_V3_MIN_TABLE_PAIRS = 10_000;
export const GTO_V31_V3_FAMILY_PAIRS = 50_000;
export const GTO_V31_V3_MIN_TABLE_DECISIONS = 300;
export const GTO_V31_V3_HUMAN_PREFIX = 'human_';
/** The human-calibrated field deals six-max only (HorseLeague humanFieldTwin). */
export const GTO_V31_V3_HUMAN_SEATS = 6;

const HEX64 = /^[0-9a-f]{64}$/;
const TABLE = /^(human_)?([a-z_]+)_([0-9]{1,2})max_([0-9]{1,3})bb$/;

/** The fields of a sealed runtime cell the table list depends on. */
export interface GtoV31V3CellContext {
  cell_key_checksum: string;
  game_family: GtoV31EvaluationFamily;
  utility_context: string;
  table_size: number;
  depth_bucket: number;
  node_role: string;
}

export interface GtoV31V3Table {
  key: string;
  human: boolean;
  utility: string;
  seats: number;
  depthBB: number;
}

/** Utility contexts each family may carry; anything else refuses. */
const FAMILY_UTILITIES: Record<GtoV31EvaluationFamily, readonly string[]> = {
  cash: ['cash_ev'],
  spin: ['chip_ev', 'spin_ladder'],
  tourney_ev: ['chip_ev'],
  tourney_icm: ['satellite', 'bubble', 'final_table', 'in_money', 'ladder'],
};

export function gtoV31V3TableKey(utility: string, seats: number, depthBB: number): string {
  return `${utility}_${seats}max_${depthBB}bb`;
}

/** Byte-wise ordering: PostgreSQL sorts the same list with COLLATE "C". */
function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The exact table list for one family, derived from the dataset's cells.
 * An empty list means the dataset has no cells in that family and the family
 * has nothing to certify.
 */
export function gtoV31V3Tables(
  family: GtoV31EvaluationFamily,
  cells: readonly GtoV31V3CellContext[]
): string[] {
  const keys = new Set<string>();
  let humanDepth: number | null = null;
  for (const cell of cells) {
    if (cell.game_family !== family) continue;
    if (!FAMILY_UTILITIES[family].includes(cell.utility_context)) {
      throw new Error(`v31_v3_unknown_utility:${family}:${cell.utility_context}`);
    }
    if (
      !Number.isSafeInteger(cell.table_size) ||
      cell.table_size < 2 ||
      cell.table_size > 10 ||
      !Number.isSafeInteger(cell.depth_bucket) ||
      cell.depth_bucket < 1 ||
      cell.depth_bucket > 999
    ) {
      throw new Error(`v31_v3_cell_geometry_invalid:${cell.cell_key_checksum}`);
    }
    keys.add(gtoV31V3TableKey(cell.utility_context, cell.table_size, cell.depth_bucket));
    if (family === 'cash' && cell.table_size === GTO_V31_V3_HUMAN_SEATS) {
      humanDepth = Math.max(humanDepth ?? 0, cell.depth_bucket);
    }
  }
  const tables = [...keys].sort(byteOrder);
  if (humanDepth !== null) {
    tables.push(
      `${GTO_V31_V3_HUMAN_PREFIX}${gtoV31V3TableKey('cash_ev', GTO_V31_V3_HUMAN_SEATS, humanDepth)}`
    );
  }
  return tables;
}

export function parseGtoV31V3Table(family: GtoV31EvaluationFamily, key: string): GtoV31V3Table {
  const m = TABLE.exec(key);
  if (!m) throw new Error(`v31_v3_table_invalid:${key}`);
  const human = m[1] !== undefined;
  const utility = m[2];
  const seats = Number(m[3]);
  const depthBB = Number(m[4]);
  if (
    !FAMILY_UTILITIES[family].includes(utility) ||
    seats < 2 ||
    seats > 10 ||
    depthBB < 1 ||
    (human && (family !== 'cash' || seats !== GTO_V31_V3_HUMAN_SEATS))
  ) {
    throw new Error(`v31_v3_table_invalid:${family}:${key}`);
  }
  return { key, human, utility, seats, depthBB };
}

/** Duplicate pairs per table: never under 10,000, the family at least 50,000. */
export function gtoV31V3PairsPerTable(tables: number): number {
  if (!Number.isSafeInteger(tables) || tables < 1) throw new Error('v31_v3_no_tables');
  return Math.max(GTO_V31_V3_MIN_TABLE_PAIRS, Math.ceil(GTO_V31_V3_FAMILY_PAIRS / tables));
}

/** ICM input stacks in chips (1 big blind = 2 chips), from 2.0x to 0.4x the
 *  table's depth: the shape the v2 six-handed ladders used, at any size. */
function ladderStacks(seats: number, depthBB: number): number[] {
  const avg = 2 * depthBB;
  return Array.from({ length: seats }, (_, i) =>
    Math.max(2, Math.round(avg * (2.0 - (1.6 * i) / Math.max(1, seats - 1))))
  );
}

/** Spin ICM stacks: a narrow spread around the depth (v2: 46/40/34 at 20bb). */
function spinStacks(seats: number, depthBB: number, spread: number): number[] {
  const avg = 2 * depthBB;
  return Array.from({ length: seats }, (_, i) =>
    Math.max(2, Math.round(avg * (1 + spread - (2 * spread * i) / Math.max(1, seats - 1))))
  );
}

const PAYOUT_LADDER = [0.34, 0.23, 0.16, 0.11, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02];

/** The first `paid` places of the reference ladder, normalized to 1. */
function payouts(paid: number): number[] {
  const head = PAYOUT_LADDER.slice(0, Math.max(1, Math.min(paid, PAYOUT_LADDER.length)));
  const total = head.reduce((s, x) => s + x, 0);
  return head.map((x) => x / total);
}

const tournament = (
  t: NonNullable<LeagueGameContext['tournament']>,
  format: 'mtt' | 'spin'
): LeagueGameContext => ({ gameMode: 'tournament', format, ante: 0, tournament: t });

/** The game context of one derived table (cash, Spin or tournament utility). */
export function gtoV31V3Context(
  family: GtoV31EvaluationFamily,
  table: GtoV31V3Table
): LeagueGameContext {
  const n = table.seats;
  const d = table.depthBB;
  if (family === 'cash') return { gameMode: 'cash', format: 'cash', ante: 0 };
  if (family === 'spin') {
    return table.utility === 'chip_ev'
      ? tournament(
          {
            playersLeft: n,
            spotsPaid: 1,
            avgStackChips: 2 * d,
            stacks: spinStacks(n, d, 0.1),
            payoutPct: [1],
          },
          'spin'
        )
      : tournament(
          {
            playersLeft: n,
            spotsPaid: 2,
            avgStackChips: 2 * d,
            stacks: spinStacks(n, d, 0.15),
            payoutPct: [0.8, 0.2],
          },
          'spin'
        );
  }
  if (family === 'tourney_ev') {
    return tournament({ playersLeft: 72, spotsPaid: 12, avgStackChips: 2 * d }, 'mtt');
  }
  const base = { avgStackChips: 2 * d, stacks: ladderStacks(n, d) };
  switch (table.utility) {
    case 'satellite':
      // Twice the seats left for `n` seats: with fewer, three busts lock every
      // seat and a locked seat folds every pot (v2's satellite note).
      return tournament(
        {
          ...base,
          playersLeft: 2 * n,
          spotsPaid: n,
          satellite: true,
          satelliteSeats: n,
          payoutPct: Array.from({ length: n }, () => 1 / n),
        },
        'mtt'
      );
    case 'bubble':
      return tournament(
        { ...base, playersLeft: n + 1, spotsPaid: n, nearBubble: true, payoutPct: payouts(n) },
        'mtt'
      );
    case 'final_table':
      return tournament(
        {
          ...base,
          playersLeft: n,
          spotsPaid: Math.max(1, n - 2),
          finalTable: true,
          payoutPct: payouts(Math.max(1, n - 2)),
        },
        'mtt'
      );
    case 'in_money':
      return tournament(
        {
          ...base,
          playersLeft: Math.max(2, n - 1),
          spotsPaid: n,
          inMoney: true,
          payoutPct: payouts(n),
        },
        'mtt'
      );
    case 'ladder':
      return tournament(
        { ...base, playersLeft: 3 * n, spotsPaid: n, payoutPct: payouts(n) },
        'mtt'
      );
    default:
      throw new Error(`v31_v3_table_invalid:${family}:${table.key}`);
  }
}

function arms(datasetChecksum: string, kind: GtoV31EvaluationKind) {
  if (!HEX64.test(datasetChecksum) || datasetChecksum === '0'.repeat(64)) {
    throw new Error('a sealed V31 dataset checksum is required');
  }
  return kind === 'paired_replay'
    ? {
        a: { gtoV31DatasetChecksum: datasetChecksum, mind: false, telemetry: false },
        b: { mind: false, telemetry: false },
      }
    : { a: { gtoV31DatasetChecksum: datasetChecksum }, b: {} };
}

/** One v3 table: the learning-on matchup and, for a league, its learning-off twin. */
export interface GtoV31V3Scenario extends GtoV31EvaluationScenario {
  table: GtoV31V3Table;
  memoryOff: LeagueMatchup | null;
}

export function buildGtoV31EvaluationScenariosV3(
  family: GtoV31EvaluationFamily,
  kind: GtoV31EvaluationKind,
  datasetChecksum: string,
  tables: readonly string[]
): GtoV31V3Scenario[] {
  if (tables.length === 0) throw new Error(`v31_v3_no_tables:${family}`);
  if (new Set(tables).size !== tables.length) throw new Error(`v31_v3_duplicate_table:${family}`);
  const pairs = gtoV31V3PairsPerTable(tables.length);
  const prefix = `gto_v31_v3_${kind}_${family}`;
  return tables.map((key) => {
    const table = parseGtoV31V3Table(family, key);
    const matchup: LeagueMatchup = {
      name: `${prefix}_${key}`,
      seats: table.seats,
      stackBB: table.depthBB,
      context: gtoV31V3Context(family, table),
      moodClock: 'deal_seed',
      ...arms(datasetChecksum, kind),
      // Production horses play the Hybrid style (#9595); the human field
      // seats calibrated humans instead, and refuses a Hybrid baseline.
      ...(table.human
        ? { opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID }
        : { hybridBaseline: true }),
    };
    return {
      key,
      family,
      pairs,
      matchup,
      table,
      memoryOff:
        kind === 'league'
          ? { ...matchup, name: `${matchup.name}_memory_off`, memoryLearning: 'off' }
          : null,
    };
  });
}

/** The learning-off twin's evidence, stored inside its league component. */
export interface GtoV31V3MemoryOff {
  hands: number;
  bb100: number;
  stderr: number;
  durationMs: number;
  illegalActions: number;
  truncatedStreets: number;
  candidatePolicyHits: number;
  candidateExecutionMismatches: number;
  candidateCells: string[];
}

export interface GtoV31V3Component extends LeagueBenchmarkComponent {
  candidateCells: string[];
  memoryOff?: GtoV31V3MemoryOff;
}

/** A human-field result's bb100 is already the hero's A-over-B edge. */
function v3Component(
  key: string,
  result: LeagueResult,
  memoryOff: LeagueResult | null
): GtoV31V3Component {
  const component: GtoV31V3Component = {
    scenario: key,
    hands: result.hands,
    bb100: result.bb100,
    stderr: result.stderr,
    durationMs: result.durationMs,
    illegalActions: result.illegalActions,
    truncatedStreets: result.truncatedStreets,
    candidatePolicyHits: result.candidatePolicyHits,
    candidateExecutionMismatches: result.candidateExecutionMismatches,
    candidateNodeRoles: [...result.candidateNodeRoles],
    candidateCells: [...(result.candidateCells ?? [])],
  };
  if (memoryOff) {
    component.memoryOff = {
      hands: memoryOff.hands,
      bb100: memoryOff.bb100,
      stderr: memoryOff.stderr,
      durationMs: memoryOff.durationMs,
      illegalActions: memoryOff.illegalActions,
      truncatedStreets: memoryOff.truncatedStreets,
      candidatePolicyHits: memoryOff.candidatePolicyHits,
      candidateExecutionMismatches: memoryOff.candidateExecutionMismatches,
      candidateCells: [...(memoryOff.candidateCells ?? [])],
    };
  }
  return component;
}

/**
 * Why a v3 family result may not be recorded, or null. The database
 * enforces the same rules; refusing here spares an insert that cannot count.
 */
export function gtoV31V3Refusal(
  kind: GtoV31EvaluationKind,
  tables: readonly string[],
  pairs: number,
  components: readonly GtoV31V3Component[],
  sealedCells: readonly string[]
): string | null {
  if (components.length !== tables.length) return 'table count differs';
  const reached = new Set<string>();
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    const runs: Array<{
      run: string;
      r: Omit<GtoV31V3MemoryOff, 'bb100' | 'stderr' | 'durationMs'>;
    }> = [{ run: c.scenario, r: c }];
    if (kind === 'league') {
      if (!c.memoryOff) return `${c.scenario}: league table has no memory-off run`;
      runs.push({ run: `${c.scenario} memory-off run`, r: c.memoryOff });
    } else if (c.memoryOff) {
      return `${c.scenario}: a paired replay carries no memory-off run`;
    }
    if (c.scenario !== tables[i]) return `${c.scenario}: expected table ${tables[i]}`;
    for (const { run, r } of runs) {
      if (r.hands !== 2 * pairs) return `${run}: ${r.hands} hands, expected ${2 * pairs}`;
      if (r.illegalActions !== 0 || r.truncatedStreets !== 0) return `${run}: illegal play`;
      if (r.candidateExecutionMismatches !== 0) return `${run}: execution mismatches`;
      if (r.candidatePolicyHits < GTO_V31_V3_MIN_TABLE_DECISIONS) {
        return `${run}: ${r.candidatePolicyHits} playbook decisions, the floor is ${GTO_V31_V3_MIN_TABLE_DECISIONS}`;
      }
    }
    for (const cell of c.candidateCells) reached.add(cell);
  }
  const missing = sealedCells.filter((cell) => !reached.has(cell));
  return missing.length > 0 ? `${missing.length} sealed cells were never executed` : null;
}

export async function runGtoV31EvaluationFamilyV3(args: {
  family: GtoV31EvaluationFamily;
  kind: GtoV31EvaluationKind;
  datasetChecksum: string;
  tables: readonly string[];
  runSeed: number;
  shouldContinue?: () => boolean;
}): Promise<{ result: LeagueResult; components: GtoV31V3Component[]; pairs: number }> {
  const scenarios = buildGtoV31EvaluationScenariosV3(
    args.family,
    args.kind,
    args.datasetChecksum,
    args.tables
  );
  const components: GtoV31V3Component[] = [];
  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    const seed = (args.runSeed ^ ((index + 1) * 0x9e3779b9)) >>> 0;
    const main = await runMatchup(scenario.matchup, scenario.pairs, seed, args.shouldContinue);
    // Same seed: the learning-off twin replays exactly the same deals.
    const off = scenario.memoryOff
      ? await runMatchup(scenario.memoryOff, scenario.pairs, seed, args.shouldContinue)
      : null;
    components.push(v3Component(scenario.key, main, off));
  }
  const hands = components.reduce((s, c) => s + c.hands, 0);
  if (hands <= 0) throw new Error('V31 evaluation has no completed hands');
  const bb100 = components.reduce((s, c) => s + c.bb100 * c.hands, 0) / hands;
  const stderr = Math.sqrt(components.reduce((s, c) => s + (c.stderr * c.hands) ** 2, 0)) / hands;
  const result: LeagueResult = {
    matchup: `gto_v31_v3_${args.kind}_${args.family}_${args.datasetChecksum}`,
    hands,
    bb100,
    stderr,
    // The family totals are the learning-on runs, exactly as v2 sums its
    // components; each learning-off twin is evidence inside its component.
    durationMs: components.reduce((s, c) => s + c.durationMs, 0),
    illegalActions: components.reduce((s, c) => s + c.illegalActions, 0),
    truncatedStreets: components.reduce((s, c) => s + c.truncatedStreets, 0),
    candidatePolicyHits: components.reduce((s, c) => s + c.candidatePolicyHits, 0),
    candidateExecutionMismatches: components.reduce(
      (s, c) => s + c.candidateExecutionMismatches,
      0
    ),
    candidateNodeRoles: [...new Set(components.flatMap((c) => c.candidateNodeRoles))].sort(),
    candidateCells: [...new Set(components.flatMap((c) => c.candidateCells))].sort(byteOrder),
    benchmarkComponents: components.map((c) => ({ ...c })),
  };
  return { result, components, pairs: scenarios[0].pairs };
}
