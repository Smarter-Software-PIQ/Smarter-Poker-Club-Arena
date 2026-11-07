/**
 * V31 R8 DENSITY PRE-FLIGHT (2026-11-07).
 *
 * Contract v3 certifies a playbook on tables derived from its own cells and
 * requires every run (each table, and each league table's memory-off twin)
 * to execute at least GTO_V31_V3_MIN_TABLE_DECISIONS playbook decisions, and
 * every sealed cell to be executed in both kinds. R7's real cells reached
 * about 36 decisions per table at 2,000 pairs (about 180 at 10,000): a
 * playbook built like R7 would fail that floor only after a full capture.
 *
 * This measures DEMAND before any solver time is spent. Every certification
 * table of the planned scope is played with no playbook loaded and the
 * offline hook (opts.onV31Demand) records the exact cell key of every spot
 * the certified consult is asked about. Any planned cell list is then scored
 * offline against that demand, scaled to the contract's pairs per table; and
 * the densest list within a scope is proposed.
 *
 * Caveat, stated in every report: with no playbook loaded the candidate arm
 * plays the heuristics, so later streets of a hand can differ from the hands
 * a real playbook steers. Demand is an estimate of where certified decisions
 * occur, not a certification.
 */

import type { V31DemandSpot } from '../engine/HorseV31CertifiedPolicy.js';
import { gtoV31DemandCell } from '../engine/GtoPostflopV31.js';
import { runMatchup, type LeagueMatchup } from './HorseLeague.js';
import {
  buildGtoV31EvaluationScenariosV3,
  gtoV31V3PairsPerTable,
  GTO_V31_V3_MIN_TABLE_DECISIONS,
} from './GtoV31EvaluationContractV3.js';
import type { GtoV31EvaluationFamily, GtoV31EvaluationKind } from './GtoV31CandidateEvaluation.js';

/** A checksum no dataset has: the candidate arm consults an empty playbook. */
export const GTO_V31_DEMAND_PROBE_CHECKSUM = '0'.repeat(63) + '1';
const KINDS: readonly GtoV31EvaluationKind[] = ['paired_replay', 'league'];

export interface GtoV31DemandCellContext {
  street: string;
  family: string;
  objective: string;
  utilityContext: string;
  tableSize: number;
  potType: string;
  heroPosition: string;
  opponentPosition: string;
  depth: number;
  texture: string;
  nodeRole: string;
  facingKind: string;
  facingSizeBucket: string;
}

/** One certification run: a table of one kind (league tables also have a memory-off twin). */
export interface GtoV31DemandRun {
  run: string;
  kind: GtoV31EvaluationKind;
  table: string;
  memoryOff: boolean;
  probePairs: number;
  /** Contract pairs this table plays when certified with `tableCount` tables in its family. */
  counts: Record<string, number>;
}

export interface GtoV31Demand {
  family: GtoV31EvaluationFamily;
  tables: string[];
  runs: GtoV31DemandRun[];
  cells: Record<string, GtoV31DemandCellContext>;
  /** Spots the consult was asked about that no cell could ever answer (bad board / no texture). */
  unkeyable: number;
}

function contextOf(spot: V31DemandSpot, depth: number, texture: string): GtoV31DemandCellContext {
  return {
    street: spot.street,
    family: spot.family,
    objective: spot.objective,
    utilityContext: spot.utilityContext,
    tableSize: spot.tableSize,
    potType: spot.potType,
    heroPosition: spot.heroPosition,
    opponentPosition: spot.opponentPosition,
    depth,
    texture,
    nodeRole: spot.nodeRole,
    facingKind: spot.facingKind,
    facingSizeBucket: spot.facingSizeBucket,
  };
}

/** Tap the arm that plays the probe checksum; leave the baseline arm untouched. */
function tapped(m: LeagueMatchup, hook: (spot: V31DemandSpot) => void): LeagueMatchup {
  const tap = (arm: LeagueMatchup['a']) =>
    arm.gtoV31DatasetChecksum === GTO_V31_DEMAND_PROBE_CHECKSUM
      ? { ...arm, onV31Demand: hook }
      : arm;
  return { ...m, a: tap(m.a), b: tap(m.b) };
}

export async function recordGtoV31Demand(args: {
  family: GtoV31EvaluationFamily;
  tables: readonly string[];
  pairsPerTable: number;
  runSeed: number;
  shouldContinue?: () => boolean;
}): Promise<GtoV31Demand> {
  if (!Number.isSafeInteger(args.pairsPerTable) || args.pairsPerTable < 1) {
    throw new Error('demand probe needs a positive pair count');
  }
  const cells: Record<string, GtoV31DemandCellContext> = {};
  const runs: GtoV31DemandRun[] = [];
  let unkeyable = 0;
  for (const kind of KINDS) {
    const scenarios = buildGtoV31EvaluationScenariosV3(
      args.family,
      kind,
      GTO_V31_DEMAND_PROBE_CHECKSUM,
      args.tables
    );
    for (let index = 0; index < scenarios.length; index++) {
      const s = scenarios[index];
      // The certification seed scheme (runGtoV31EvaluationFamilyV3).
      const seed = (args.runSeed ^ ((index + 1) * 0x9e3779b9)) >>> 0;
      const plays: Array<{ matchup: LeagueMatchup; memoryOff: boolean }> = [
        { matchup: s.matchup, memoryOff: false },
        ...(s.memoryOff ? [{ matchup: s.memoryOff, memoryOff: true }] : []),
      ];
      for (const play of plays) {
        const counts: Record<string, number> = {};
        const hook = (spot: V31DemandSpot) => {
          const cell = gtoV31DemandCell(spot);
          if (!cell) {
            unkeyable++;
            return;
          }
          counts[cell.key] = (counts[cell.key] ?? 0) + 1;
          cells[cell.key] ??= contextOf(spot, cell.depth, cell.texture);
        };
        await runMatchup(tapped(play.matchup, hook), args.pairsPerTable, seed, args.shouldContinue);
        runs.push({
          run: `${kind}:${s.key}${play.memoryOff ? ':memory_off' : ''}`,
          kind,
          table: s.key,
          memoryOff: play.memoryOff,
          probePairs: args.pairsPerTable,
          counts,
        });
      }
    }
  }
  return { family: args.family, tables: [...args.tables], runs, cells, unkeyable };
}

export interface GtoV31PlanScore {
  cells: number;
  contractPairsPerTable: number;
  runs: Array<{ run: string; expectedDecisions: number; meetsFloor: boolean }>;
  minRunDecisions: number;
  runsUnderFloor: number;
  /** Planned cells not expected to be executed at least `minReach` times in each kind. */
  unreached: string[];
  passes: boolean;
}

/**
 * Score a planned cell list against recorded demand, scaled to the pairs each
 * table plays under the contract when the family has `demand.tables.length`
 * tables. `minReach` is the expected executions a cell needs in each kind to
 * count as reached (certification requires at least one; the margin absorbs
 * sampling noise).
 */
export function scoreGtoV31CellPlan(
  demand: GtoV31Demand,
  plannedKeys: readonly string[],
  minReach = 5
): GtoV31PlanScore {
  const planned = new Set(plannedKeys);
  const contractPairs = gtoV31V3PairsPerTable(demand.tables.length);
  const runs = demand.runs.map((r) => {
    const scale = contractPairs / r.probePairs;
    let n = 0;
    for (const k of planned) n += r.counts[k] ?? 0;
    const expectedDecisions = n * scale;
    return {
      run: r.run,
      expectedDecisions,
      meetsFloor: expectedDecisions >= GTO_V31_V3_MIN_TABLE_DECISIONS,
    };
  });
  const reachIn = (key: string, kind: GtoV31EvaluationKind) =>
    demand.runs
      .filter((r) => r.kind === kind && !r.memoryOff)
      .reduce((sum, r) => sum + (r.counts[key] ?? 0) * (contractPairs / r.probePairs), 0);
  const unreached = [...planned]
    .filter((k) => KINDS.some((kind) => reachIn(k, kind) < minReach))
    .sort();
  const minRunDecisions = runs.length ? Math.min(...runs.map((r) => r.expectedDecisions)) : 0;
  const runsUnderFloor = runs.filter((r) => !r.meetsFloor).length;
  return {
    cells: planned.size,
    contractPairsPerTable: contractPairs,
    runs,
    minRunDecisions,
    runsUnderFloor,
    unreached,
    passes: planned.size > 0 && runsUnderFloor === 0 && unreached.length === 0,
  };
}

/**
 * A cell list within a scope that fills every run's decision target first
 * (the floor plus a sampling margin).
 * Only cells reached in both kinds are eligible. Cells are chosen greedily by
 * how much of the remaining per-run deficit (floor minus expected decisions)
 * they cover, so a sparse table is not starved by a dense one; once every run
 * meets the floor (or no eligible cell helps), the remaining budget goes to
 * the densest cells by their weakest kind. The score assumes the plan's tables
 * are the probed tables (pairs per table follow their count).
 */
/**
 * An eligible-cell file restricts which cells a proposal may pick (R8: only
 * the street/texture classes whose board space can supply the per-context
 * recipe of 57 training boards and 8 holdout candidates). The file lists
 * `eligible: [{street, texture_class}]`; a cell is eligible when its street
 * and texture are listed. Anything malformed is refused, never ignored.
 */
export function gtoV31EligibleCellFilter(
  file: unknown
): (cell: GtoV31DemandCellContext) => boolean {
  const fail = (why: string): never => {
    throw new Error('GTO_V31_ELIGIBLE_CELLS_' + why);
  };
  if (!file || typeof file !== 'object' || Array.isArray(file)) fail('FILE');
  const eligible = (file as { eligible?: unknown }).eligible;
  if (!Array.isArray(eligible) || eligible.length === 0) fail('LIST');
  const allowed = new Set<string>();
  for (const entry of eligible as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('ENTRY');
    const e = entry as Record<string, unknown>;
    const keys = Object.keys(e).sort().join(',');
    if (
      keys !== 'street,texture_class' ||
      !['flop', 'turn', 'river'].includes(e.street as string) ||
      typeof e.texture_class !== 'string' ||
      !/^[ABML][mtr][pu][cd]$/.test(e.texture_class)
    )
      fail('ENTRY');
    const key = `${e.street}|${e.texture_class}`;
    if (allowed.has(key)) fail('DUPLICATE');
    allowed.add(key);
  }
  return (cell) => allowed.has(`${cell.street}|${cell.texture}`);
}

export function proposeGtoV31CellPlan(
  demand: GtoV31Demand,
  options: {
    maxCells: number;
    inScope?: (cell: GtoV31DemandCellContext) => boolean;
    minReach?: number;
    /** Expected decisions per run to aim for; the default leaves 50% over the floor for sampling noise. */
    targetDecisions?: number;
  }
): { keys: string[]; score: GtoV31PlanScore } {
  const minReach = options.minReach ?? 5;
  const target = Math.max(
    GTO_V31_V3_MIN_TABLE_DECISIONS,
    options.targetDecisions ?? GTO_V31_V3_MIN_TABLE_DECISIONS * 1.5
  );
  const budget = Math.max(0, Math.floor(options.maxCells));
  const contractPairs = gtoV31V3PairsPerTable(demand.tables.length);
  const scaled = (r: GtoV31DemandRun, key: string) =>
    (r.counts[key] ?? 0) * (contractPairs / r.probePairs);
  const reach = (key: string) =>
    Math.min(
      ...KINDS.map((kind) =>
        demand.runs
          .filter((r) => r.kind === kind && !r.memoryOff)
          .reduce((s, r) => s + scaled(r, key), 0)
      )
    );
  const pool = Object.keys(demand.cells)
    .filter((k) => !options.inScope || options.inScope(demand.cells[k]))
    .map((k) => ({ k, reach: reach(k) }))
    .filter((c) => c.reach >= minReach)
    .sort((a, b) => b.reach - a.reach || (a.k < b.k ? -1 : 1));
  const deficit = demand.runs.map(() => target);
  const keys: string[] = [];
  const taken = new Set<string>();
  while (keys.length < budget && deficit.some((d) => d > 0)) {
    let best: { k: string; gain: number } | null = null;
    for (const c of pool) {
      if (taken.has(c.k)) continue;
      let gain = 0;
      demand.runs.forEach((r, i) => (gain += Math.min(scaled(r, c.k), deficit[i])));
      if (gain > 0 && (!best || gain > best.gain)) best = { k: c.k, gain };
    }
    if (!best) break;
    keys.push(best.k);
    taken.add(best.k);
    demand.runs.forEach((r, i) => (deficit[i] = Math.max(0, deficit[i] - scaled(r, best!.k))));
  }
  for (const c of pool) {
    if (keys.length >= budget) break;
    if (!taken.has(c.k)) keys.push(c.k);
  }
  return { keys, score: scoreGtoV31CellPlan(demand, keys, minReach) };
}
