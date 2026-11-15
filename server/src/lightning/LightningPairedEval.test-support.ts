/**
 * LIGHTNING PAIRED EVALUATION: CONFIGURATION, PAIRING AND REPORT (2026-11-14).
 *
 * The pure half of the paired Lightning harness: what a cell and an arm are,
 * the declared smoke and full configurations, the paired statistics and the
 * report schema. No vitest import, no engine import: the arm that plays hands
 * is LightningPairedEvalArm.test-support.ts, loaded by the caller on a fresh
 * module graph per arm (LightningPairedEval.test.ts shows how).
 *
 * See LIGHTNING-PAIRED-EVAL-README.md beside this file.
 */
import { createHash } from 'node:crypto';

export const LIGHTNING_EVAL_SCHEMA = 'lightning-paired-eval/v1';
/** The 1/2 stake: the one stake where NLH, PLO4 and PLO5 all deal Lightning. */
export const LIGHTNING_EVAL_SMALL_BLIND = 1;
export const LIGHTNING_EVAL_BIG_BLIND = 2;

export const LIGHTNING_EVAL_VARIANTS = ['nlh', 'plo4', 'plo5'] as const;
export type LightningEvalVariant = (typeof LIGHTNING_EVAL_VARIANTS)[number];
export const LIGHTNING_EVAL_PLAYERS = [4, 5, 6] as const;
export const LIGHTNING_EVAL_STACKS_BB = [50, 100, 200] as const;

/**
 * Opponent fields. `all_horse`: every other seat is a baseline Horse. Every
 * other field seats `villains` scripted opponents (default 1) and baseline
 * Horses in the remaining seats. The scripted definitions are the maintained
 * ones (LightningPairedEvalArm.test-support.ts fieldPolicy):
 *   station         ExploiterLeague calling_station
 *   nit             StyleReadLeagueField lp_tight (tight-passive folder)
 *   tight_value     StyleReadLeagueField lp_value_heavy_passive
 *   tag_regular     ExploiterLeague reg_tag (tight-aggressive regular)
 *   maniac          ExploiterLeague maniac (sustained: never changes gear)
 *   gear_changer    StyleReadLeagueField lp_time_shifter
 *   unknown         a baseline Horse sat as a person nobody has met before
 *   three_bet_heavy ExploiterLeague light_3bet (punishes wide entry)
 */
export const LIGHTNING_EVAL_FIELDS = [
  'all_horse',
  'station',
  'nit',
  'tight_value',
  'tag_regular',
  'maniac',
  'gear_changer',
  'unknown',
  'three_bet_heavy',
] as const;
export type LightningEvalField = (typeof LIGHTNING_EVAL_FIELDS)[number];

export interface LightningEvalCell {
  variant: LightningEvalVariant;
  players: 4 | 5 | 6;
  stackBB: 50 | 100 | 200;
  field: LightningEvalField;
  /** Scripted opponents seated (ignored for all_horse). Default 1. */
  villains?: number;
  /** A counter-exploitation cell: the field punishes over-entry. */
  counterExploit?: boolean;
}

export interface LightningEvalArmSpec {
  name: string;
  /** Spread over the baseline decide options for the subject seats. */
  decideOpts?: Record<string, unknown>;
  /**
   * Until a host producer exists: a patch applied to the snapshot the host
   * built (buildLightningHorseSnapshot) before HorseLogic.decide reads it.
   * Must return a snapshot; must not mutate its argument.
   */
  snapshotPatch?: (snapshot: any) => any;
  /** `hero` (default): one rotating Horse seat. `all_horses`: every Horse. */
  scope?: 'hero' | 'all_horses';
}

export interface LightningEvalConfig {
  name: string;
  /** development | selection | final: see the protocol's contamination rule. */
  seedClass: 'development' | 'selection' | 'final';
  seeds: readonly number[];
  handsPerCell: number;
  cells: readonly LightningEvalCell[];
  /** Decide options both arms run on (the served configuration under test). */
  baselineDecideOpts: Record<string, unknown>;
}

/**
 * The seven Hold'em style options read ON from production
 * ca_horse_style_switch on 2026-11-14T23:38Z (Lightning ledger 07). Declared
 * here so the baseline arm is the served configuration, not the source
 * default. Re-read the switch table before any selection or final run.
 */
export const LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114: Readonly<Record<string, true>> =
  Object.freeze({
    styleRaiseRespect: true,
    styleBigBetHonesty: true,
    styleValueBettorNotManiac: true,
    styleFoldRatePreRepair: true,
    styleValueExtraction: true,
    styleFoldBluff: true,
    styleTightReRaiserRespect: true,
  });

/** A few hundred hands: every variant, table size and stack depth once. */
export const LIGHTNING_EVAL_SMOKE: LightningEvalConfig = Object.freeze({
  name: 'smoke',
  seedClass: 'development',
  seeds: [20261114],
  handsPerCell: 24,
  cells: [
    { variant: 'nlh', players: 6, stackBB: 100, field: 'all_horse' },
    { variant: 'nlh', players: 5, stackBB: 50, field: 'tag_regular', counterExploit: true },
    { variant: 'plo4', players: 6, stackBB: 200, field: 'station' },
    { variant: 'plo4', players: 4, stackBB: 100, field: 'unknown' },
    { variant: 'plo5', players: 5, stackBB: 100, field: 'maniac' },
    {
      variant: 'plo5',
      players: 6,
      stackBB: 50,
      field: 'three_bet_heavy',
      villains: 2,
      counterExploit: true,
    },
  ],
  baselineDecideOpts: LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114,
} satisfies LightningEvalConfig);

function fullCells(): LightningEvalCell[] {
  const cells: LightningEvalCell[] = [];
  for (const variant of LIGHTNING_EVAL_VARIANTS)
    for (const players of LIGHTNING_EVAL_PLAYERS)
      for (const stackBB of LIGHTNING_EVAL_STACKS_BB) {
        for (const field of LIGHTNING_EVAL_FIELDS)
          cells.push({
            variant,
            players,
            stackBB,
            field,
            ...(field === 'tag_regular' || field === 'three_bet_heavy'
              ? { counterExploit: true }
              : {}),
          });
        // The hard counter-exploitation cell: two 3-bettors behind every entry.
        cells.push({
          variant,
          players,
          stackBB,
          field: 'three_bet_heavy',
          villains: 2,
          counterExploit: true,
        });
      }
  return cells;
}

/**
 * The declared full configuration (270 cells x 1,000 hands x 2 arms per
 * seed). Development seeds only: the selection and final seed sets are
 * declared in the protocol and are never dealt by a development run.
 */
export const LIGHTNING_EVAL_FULL: LightningEvalConfig = Object.freeze({
  name: 'full',
  seedClass: 'development',
  seeds: [20261114, 20261115, 20261116],
  handsPerCell: 1000,
  cells: fullCells(),
  baselineDecideOpts: LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114,
} satisfies LightningEvalConfig);

/** Seed sets by class. A run refuses a seed outside its declared class. */
export const LIGHTNING_EVAL_SEEDS = Object.freeze({
  development: Object.freeze([20261114, 20261115, 20261116, 20261117, 20261118]),
  selection: Object.freeze([31470001, 31470002, 31470003, 31470004, 31470005]),
  final: Object.freeze([58210001, 58210002, 58210003, 58210004, 58210005]),
});

export function lightningEvalSeedClassOf(
  seed: number
): 'development' | 'selection' | 'final' | null {
  for (const cls of ['development', 'selection', 'final'] as const)
    if ((LIGHTNING_EVAL_SEEDS[cls] as readonly number[]).includes(seed)) return cls;
  return null;
}

/** A 32-bit mix of three integers; never 0 (an xorshift state). */
export function lightningEvalMix(a: number, b: number, c: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  for (const x of [b, c]) {
    h = Math.imul(h ^ (x >>> 0), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0 || 1;
}

/**
 * Seat 1 is the small blind, seat 2 the big blind, the button is the last
 * seat (the Lightning barrier's seat map). The seats between are named from
 * the button backwards.
 */
export function lightningEvalPosition(seat: number, players: number): string {
  if (seat === 1) return 'SB';
  if (seat === 2) return 'BB';
  const fromButton = players - seat;
  return (['BTN', 'CO', 'HJ', 'UTG'] as const)[fromButton] ?? 'UTG';
}

/** Price the big blind is laid: to call / (pot + to call). */
export const LIGHTNING_EVAL_BB_PRICE_BUCKETS = [
  'price<=0.22',
  '0.22<price<=0.27',
  '0.27<price<=0.33',
  'price>0.33',
] as const;
export function bbPriceBucket(price: number): string {
  if (price <= 0.22) return LIGHTNING_EVAL_BB_PRICE_BUCKETS[0];
  if (price <= 0.27) return LIGHTNING_EVAL_BB_PRICE_BUCKETS[1];
  if (price <= 0.33) return LIGHTNING_EVAL_BB_PRICE_BUCKETS[2];
  return LIGHTNING_EVAL_BB_PRICE_BUCKETS[3];
}

/** Quartile of the brain's own preflop percentile (0 = weakest quarter). */
export function strengthBin(strength: number): number {
  return Math.max(0, Math.min(3, Math.floor(strength * 4)));
}

export interface LightningEvalPositionStats {
  /** Hands dealt to a subject seat in this position. */
  hands: number;
  /** Big blind never asked anything (everyone folded): no decision existed. */
  walks: number;
  /** Hands with a voluntary preflop call, bet, raise or all-in. */
  vpip: number;
  pfr: number;
  /** Folds released through the Lightning Fold door (settle foldType fast). */
  fastFolds: number;
  firstInOpportunities: number;
  firstInRaise: number;
  firstInLimp: number;
  firstInFold: number;
  sawFlop: number;
  netBB: number;
  entryStrengthSum: number;
  entryStrengthBins: number[];
  flopStrengthSum: number;
  flopStrengthBins: number[];
  bigBlindByPrice: Record<
    string,
    { n: number; fold: number; call: number; raise: number; early: number }
  >;
}

export function emptyPositionStats(): LightningEvalPositionStats {
  return {
    hands: 0,
    walks: 0,
    vpip: 0,
    pfr: 0,
    fastFolds: 0,
    firstInOpportunities: 0,
    firstInRaise: 0,
    firstInLimp: 0,
    firstInFold: 0,
    sawFlop: 0,
    netBB: 0,
    entryStrengthSum: 0,
    entryStrengthBins: [0, 0, 0, 0],
    flopStrengthSum: 0,
    flopStrengthBins: [0, 0, 0, 0],
    bigBlindByPrice: {},
  };
}

export interface LightningEvalSubjectHand {
  id: string;
  seat: number;
  position: string;
  netBB: number;
  vpip: boolean;
  pfr: boolean;
  walk: boolean;
  firstIn: 'raise' | 'limp' | 'fold' | null;
  sawFlop: boolean;
  fastFold: boolean;
  strength: number;
  bbPrice: number | null;
  bbAnswer: string | null;
  bbAnswerEarly: boolean | null;
}

export interface LightningEvalHandRecord {
  h: number;
  settled: boolean;
  rakeBB: number;
  subjects: LightningEvalSubjectHand[];
  /** Every Horse decision of the hand, in order (early looks included). */
  decisions: string[];
  /** Every accepted voluntary action of the hand, in order. */
  accepted: string[];
}

export interface LightningEvalArmResult {
  arm: string;
  scope: 'hero' | 'all_horses';
  hands: LightningEvalHandRecord[];
  total: LightningEvalPositionStats;
  byPosition: Record<string, LightningEvalPositionStats>;
  rakeConfig: unknown;
  tableRakeBBPer100: number;
  subjectRakeBBPer100: number;
  counters: {
    decisions: number;
    subjectDecisions: number;
    illegalActions: number;
    illegalAmounts: number;
    policyFallbacks: number;
    decideThrows: number;
    villainRejected: number;
    unsettledHands: number;
    buttonMismatch: number;
    armOptionKeysSeen: string[];
  };
  /** Wall-clock: NOT part of the deterministic digest. */
  latencyMs: { n: number; p50: number; p95: number; p99: number; max: number };
}

export interface LightningEvalPaired {
  /** Hands both arms settled with the subject seat present. */
  hands: number;
  /** candidate minus baseline, subject seats, bb per 100 hands. */
  diffBB100: number;
  /** Standard error of diffBB100 from the per-hand paired differences. */
  seBB100: number;
  /** The same from orbit blocks (one block = `players` consecutive hands). */
  blockSeBB100: number;
  baselineBB100: number;
  candidateBB100: number;
  /** Hands whose Horse decision sequence differs between the arms. */
  divergentHands: number;
  /** Decisions that differ, counted position by position within each hand. */
  divergentDecisions: number;
  /** Hands whose accepted action sequence differs. */
  divergentAcceptedHands: number;
  firstDivergentHand: number | null;
}

export interface LightningEvalArmSummary {
  arm: string;
  scope: 'hero' | 'all_horses';
  total: LightningEvalPositionStats;
  byPosition: Record<string, LightningEvalPositionStats>;
  tableRakeBBPer100: number;
  subjectRakeBBPer100: number;
  counters: LightningEvalArmResult['counters'];
}

export interface LightningEvalCellReport {
  cell: LightningEvalCell;
  seed: number;
  hands: number;
  rakeConfig: unknown;
  baseline: LightningEvalArmSummary;
  candidate: LightningEvalArmSummary;
  paired: LightningEvalPaired;
  /** Wall-clock, excluded from the digest. */
  latencyMs: {
    baseline: LightningEvalArmResult['latencyMs'];
    candidate: LightningEvalArmResult['latencyMs'];
  };
}

export interface LightningEvalReport {
  schema: typeof LIGHTNING_EVAL_SCHEMA;
  config: string;
  seedClass: LightningEvalConfig['seedClass'];
  seeds: number[];
  handsPerCell: number;
  contract: {
    smallBlind: number;
    bigBlind: number;
    bigBlindAnteBB: number;
    variants: string[];
    players: number[];
    stacksBB: number[];
    rake: string;
    newTableEveryHand: true;
  };
  definitions: Record<string, string>;
  baselineArm: { name: string; decideOpts: Record<string, unknown> };
  candidateArm: { name: string; decideOptKeys: string[]; snapshotPatch: boolean; scope: string };
  cells: LightningEvalCellReport[];
  totals: {
    hands: number;
    illegalActions: number;
    illegalAmounts: number;
    policyFallbacks: number;
    decideThrows: number;
    unsettledHands: number;
    divergentDecisions: number;
  };
  /** sha256 over everything above (latency excluded): equal runs, equal digest. */
  digest: string;
}

export const LIGHTNING_EVAL_DEFINITIONS: Readonly<Record<string, string>> = Object.freeze({
  subject:
    'The seat(s) playing the arm options: one rotating Horse (scope hero) or every Horse (scope all_horses). All counts below are over subject seats.',
  hands: 'Hands dealt to a subject seat and settled. One dealt hand is one VPIP opportunity.',
  walk: 'The subject was the big blind and every other seat folded before it was asked anything. Counted in hands; reported apart so VPIP can be read both ways: vpip/hands (the ca_hand_facts style, walks in the denominator) and vpip/(hands-walks) (decision opportunities).',
  vpip: 'A voluntary preflop call, bet, raise or all-in. Posting a blind or the ante and checking the big blind are not entries.',
  fastFold:
    'A fold released through the Lightning Fold door (settlement foldType fast). It is a deliberate fold: it stays in the denominator as an opportunity not taken.',
  firstIn:
    'The subject (not the big blind) acted with every earlier voluntary preflop action a fold: raise (bet, raise or all-in), limp (call) or fold.',
  bigBlindByPrice:
    'The subject big blind first priced preflop decision (to call > 0), by to-call/(pot+to-call) as its snapshot showed it; `early` counts answers given at an early look, before the action reached it (the price can still change behind it).',
  rangeQuality:
    'entryStrength*/flopStrength*: the brain own preflop percentile (LightningHorseEarlyFold.horsePreflopStrength) of hands that entered voluntarily and of hands that saw a flop, as a sum (divide by vpip / sawFlop for the mean) and as quartile counts [0-25,25-50,50-75,75-100].',
  paired:
    'diffBB100 is candidate minus baseline over the same hand indices (same cards, seats, opponents and per-hand random streams); seBB100 is the standard error of the per-hand paired differences, blockSeBB100 the same over orbit blocks.',
  rake: 'tableRakeBBPer100 is all rake taken per 100 hands of the cell; subjectRakeBBPer100 is the rake taken from pots the subject won, in proportion to its share of the winnings, per 100 subject hands.',
  illegal:
    'illegalActions: a subject decision whose action is not in its legal menu. illegalAmounts: a bet or raise outside [minRaiseTo, maxRaiseTo]. Both must be 0.',
  fallback:
    'policyFallbacks: subject decisions the brain flagged policyFallback. decideThrows: HorseLogic.decide threw (the host then plays its liveness answer). No deadline is enforced offline; latency percentiles are wall-clock on the measuring machine.',
});

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

export function pairLightningEvalArms(
  players: number,
  a: LightningEvalArmResult,
  b: LightningEvalArmResult
): LightningEvalPaired {
  const diffs: number[] = [];
  let netA = 0;
  let netB = 0;
  let divergentHands = 0;
  let divergentDecisions = 0;
  let divergentAcceptedHands = 0;
  let firstDivergentHand: number | null = null;
  const count = Math.min(a.hands.length, b.hands.length);
  for (let i = 0; i < count; i++) {
    const ha = a.hands[i]!;
    const hb = b.hands[i]!;
    const len = Math.max(ha.decisions.length, hb.decisions.length);
    let d = 0;
    for (let k = 0; k < len; k++) if (ha.decisions[k] !== hb.decisions[k]) d++;
    if (d > 0) {
      divergentHands++;
      divergentDecisions += d;
      if (firstDivergentHand === null) firstDivergentHand = ha.h;
    }
    if (ha.accepted.join(';') !== hb.accepted.join(';')) divergentAcceptedHands++;
    if (!ha.settled || !hb.settled) continue;
    const sa = ha.subjects.reduce((s, x) => s + x.netBB, 0);
    const sb = hb.subjects.reduce((s, x) => s + x.netBB, 0);
    netA += sa;
    netB += sb;
    diffs.push(sb - sa);
  }
  const nH = diffs.length;
  const mean = nH ? diffs.reduce((s, x) => s + x, 0) / nH : 0;
  const blocks: number[] = [];
  for (let i = 0; i + players <= nH; i += players)
    blocks.push(diffs.slice(i, i + players).reduce((s, x) => s + x, 0) / players);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    hands: nH,
    diffBB100: r(mean * 100),
    seBB100: r(nH > 1 ? (sd(diffs) / Math.sqrt(nH)) * 100 : 0),
    blockSeBB100: r(blocks.length > 1 ? (sd(blocks) / Math.sqrt(blocks.length)) * 100 : 0),
    baselineBB100: r(nH ? (netA / nH) * 100 : 0),
    candidateBB100: r(nH ? (netB / nH) * 100 : 0),
    divergentHands,
    divergentDecisions,
    divergentAcceptedHands,
    firstDivergentHand,
  };
}

function summarize(a: LightningEvalArmResult): LightningEvalArmSummary {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const round = (s: LightningEvalPositionStats): LightningEvalPositionStats => ({
    ...s,
    netBB: r(s.netBB),
    entryStrengthSum: r(s.entryStrengthSum),
    flopStrengthSum: r(s.flopStrengthSum),
  });
  return {
    arm: a.arm,
    scope: a.scope,
    total: round(a.total),
    byPosition: Object.fromEntries(
      Object.keys(a.byPosition)
        .sort()
        .map((k) => [k, round(a.byPosition[k]!)])
    ),
    tableRakeBBPer100: r(a.tableRakeBBPer100),
    subjectRakeBBPer100: r(a.subjectRakeBBPer100),
    counters: a.counters,
  };
}

export type LightningEvalArmPlayer = (input: {
  cell: LightningEvalCell;
  arm: LightningEvalArmSpec;
  hands: number;
  seed: number;
  baselineDecideOpts: Record<string, unknown>;
}) => Promise<LightningEvalArmResult>;

/**
 * Run a configuration: for every seed and cell, the baseline arm and the
 * candidate arm on the same deals. `playArm` must play on a fresh module
 * graph each call (the caller owns module loading and the seeded deck).
 */
export async function runLightningPairedEval(input: {
  config: LightningEvalConfig;
  candidate: LightningEvalArmSpec;
  playArm: LightningEvalArmPlayer;
  /** Half-open cell index range, to bound one process's memory. */
  cellRange?: readonly [number, number];
  onCell?: (report: LightningEvalCellReport, index: number) => void;
}): Promise<LightningEvalReport> {
  const { config, candidate } = input;
  for (const seed of config.seeds) {
    const cls = lightningEvalSeedClassOf(seed);
    if (cls !== config.seedClass)
      throw new Error(
        `seed ${seed} is ${cls ?? 'undeclared'}, the configuration is ${config.seedClass}`
      );
  }
  const baseline: LightningEvalArmSpec = { name: 'baseline', scope: candidate.scope ?? 'hero' };
  const [from, to] = input.cellRange ?? [0, config.cells.length];
  const cells: LightningEvalCellReport[] = [];
  for (const seed of config.seeds)
    for (let i = from; i < Math.min(to, config.cells.length); i++) {
      const cell = config.cells[i]!;
      const common = {
        cell,
        hands: config.handsPerCell,
        seed,
        baselineDecideOpts: { ...config.baselineDecideOpts },
      };
      const a = await input.playArm({ ...common, arm: baseline });
      const b = await input.playArm({ ...common, arm: candidate });
      const report: LightningEvalCellReport = {
        cell,
        seed,
        hands: config.handsPerCell,
        rakeConfig: a.rakeConfig,
        baseline: summarize(a),
        candidate: summarize(b),
        paired: pairLightningEvalArms(cell.players, a, b),
        latencyMs: { baseline: a.latencyMs, candidate: b.latencyMs },
      };
      cells.push(report);
      input.onCell?.(report, i);
    }
  const sum = (f: (c: LightningEvalCellReport) => number) => cells.reduce((s, c) => s + f(c), 0);
  const body: Omit<LightningEvalReport, 'digest'> = {
    schema: LIGHTNING_EVAL_SCHEMA,
    config: config.name,
    seedClass: config.seedClass,
    seeds: [...config.seeds],
    handsPerCell: config.handsPerCell,
    contract: {
      smallBlind: LIGHTNING_EVAL_SMALL_BLIND,
      bigBlind: LIGHTNING_EVAL_BIG_BLIND,
      bigBlindAnteBB: 1,
      variants: [...new Set(cells.map((c) => c.cell.variant))].sort(),
      players: [...new Set(cells.map((c) => c.cell.players))].sort(),
      stacksBB: [...new Set(cells.map((c) => c.cell.stackBB))].sort((x, y) => x - y),
      rake: 'engine-computed for the stake (rake_percent and rake_cap_bb unset); the snapshot rakeConfig of each cell is recorded in cells[].rakeConfig',
      newTableEveryHand: true as const,
    },
    definitions: { ...LIGHTNING_EVAL_DEFINITIONS },
    baselineArm: { name: 'baseline', decideOpts: { ...config.baselineDecideOpts } },
    candidateArm: {
      name: candidate.name,
      decideOptKeys: Object.keys(candidate.decideOpts ?? {}).sort(),
      snapshotPatch: typeof candidate.snapshotPatch === 'function',
      scope: candidate.scope ?? 'hero',
    },
    cells,
    totals: {
      hands: sum((c) => c.paired.hands),
      illegalActions: sum(
        (c) => c.baseline.counters.illegalActions + c.candidate.counters.illegalActions
      ),
      illegalAmounts: sum(
        (c) => c.baseline.counters.illegalAmounts + c.candidate.counters.illegalAmounts
      ),
      policyFallbacks: sum(
        (c) => c.baseline.counters.policyFallbacks + c.candidate.counters.policyFallbacks
      ),
      decideThrows: sum(
        (c) => c.baseline.counters.decideThrows + c.candidate.counters.decideThrows
      ),
      unsettledHands: sum(
        (c) => c.baseline.counters.unsettledHands + c.candidate.counters.unsettledHands
      ),
      divergentDecisions: sum((c) => c.paired.divergentDecisions),
    },
  };
  return { ...body, digest: lightningEvalDigest(body) };
}

/** sha256 of the report without its wall-clock latency and without `digest`. */
export function lightningEvalDigest(report: Omit<LightningEvalReport, 'digest'>): string {
  const stable = {
    ...report,
    cells: report.cells.map(({ latencyMs: _latency, ...rest }) => rest),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

const pct = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(1) : '-');

/** A short markdown summary: participation with its quality, per cell and arm. */
export function lightningEvalMarkdown(report: LightningEvalReport): string {
  const out: string[] = [];
  out.push(`# Lightning paired evaluation: ${report.config} (${report.seedClass} seeds)`);
  out.push('');
  out.push(
    `Schema ${report.schema}. Seeds ${report.seeds.join(', ')}; ${report.handsPerCell} hands per cell and arm. Digest ${report.digest}.`
  );
  out.push(
    `Candidate arm "${report.candidateArm.name}" (options: ${
      report.candidateArm.decideOptKeys.join(', ') || 'none'
    }; snapshot patch: ${report.candidateArm.snapshotPatch}; scope ${report.candidateArm.scope}).`
  );
  out.push(
    `Totals: ${report.totals.hands} paired hands; illegal actions ${report.totals.illegalActions}, illegal amounts ${report.totals.illegalAmounts}, policy fallbacks ${report.totals.policyFallbacks}, decide exceptions ${report.totals.decideThrows}, unsettled hands ${report.totals.unsettledHands}, divergent decisions ${report.totals.divergentDecisions}.`
  );
  out.push('');
  out.push(
    '| cell | arm | hands | walks | VPIP % (all / excl. walks) | PFR % | first-in R/L/F | saw flop % | entry strength mean | flop strength mean | bb/100 | table rake bb/100 |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of report.cells) {
    const name = `${c.cell.variant} ${c.cell.players}p ${c.cell.stackBB}bb ${c.cell.field}${
      (c.cell.villains ?? 1) > 1 ? ' x' + c.cell.villains : ''
    }${c.cell.counterExploit ? ' [counter]' : ''}`;
    for (const [label, arm, bb100] of [
      ['baseline', c.baseline, c.paired.baselineBB100],
      ['candidate', c.candidate, c.paired.candidateBB100],
    ] as const) {
      const t = arm.total;
      out.push(
        `| ${name} | ${label} | ${t.hands} | ${t.walks} | ${pct(t.vpip, t.hands)} / ${pct(
          t.vpip,
          t.hands - t.walks
        )} | ${pct(t.pfr, t.hands)} | ${t.firstInRaise}/${t.firstInLimp}/${t.firstInFold} | ${pct(
          t.sawFlop,
          t.hands
        )} | ${t.vpip ? (t.entryStrengthSum / t.vpip).toFixed(3) : '-'} | ${
          t.sawFlop ? (t.flopStrengthSum / t.sawFlop).toFixed(3) : '-'
        } | ${bb100.toFixed(1)} | ${arm.tableRakeBBPer100.toFixed(1)} |`
      );
    }
    out.push(
      `| ${name} | paired | ${c.paired.hands} | | | | | | | | diff ${c.paired.diffBB100.toFixed(
        1
      )} (se ${c.paired.seBB100.toFixed(1)}, block se ${c.paired.blockSeBB100.toFixed(
        1
      )}) | divergent decisions ${c.paired.divergentDecisions} |`
    );
  }
  out.push('');
  out.push('## By position (candidate arm; VPIP % of hands, first-in raise/limp/fold)');
  out.push('');
  out.push('| cell | UTG | HJ | CO | BTN | SB | BB | BB by price (n: fold/call/raise, early) |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const c of report.cells) {
    const cellName = `${c.cell.variant} ${c.cell.players}p ${c.cell.stackBB}bb ${c.cell.field}`;
    const cols = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map((p) => {
      const s = c.candidate.byPosition[p];
      return s
        ? `${pct(s.vpip, s.hands)} (n ${s.hands}; ${s.firstInRaise}/${s.firstInLimp}/${s.firstInFold})`
        : '-';
    });
    const bbStats = c.candidate.byPosition.BB?.bigBlindByPrice ?? {};
    const price = Object.keys(bbStats)
      .sort()
      .map((k) => {
        const v = bbStats[k]!;
        return `${k} ${v.n}: ${v.fold}/${v.call}/${v.raise}, early ${v.early}`;
      })
      .join('; ');
    out.push(`| ${cellName} | ${cols.join(' | ')} | ${price || '-'} |`);
  }
  out.push('');
  out.push('## Decision latency (wall-clock on the measuring machine, ms; not in the digest)');
  out.push('');
  out.push('| cell | arm | n | p50 | p95 | p99 | max |');
  out.push('|---|---|---|---|---|---|---|');
  for (const c of report.cells)
    for (const [label, l] of [
      ['baseline', c.latencyMs.baseline],
      ['candidate', c.latencyMs.candidate],
    ] as const)
      out.push(
        `| ${c.cell.variant} ${c.cell.players}p ${c.cell.stackBB}bb ${c.cell.field} | ${label} | ${l.n} | ${l.p50.toFixed(
          1
        )} | ${l.p95.toFixed(1)} | ${l.p99.toFixed(1)} | ${l.max.toFixed(1)} |`
      );
  out.push('');
  return out.join('\n');
}
