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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * v2 (2026-11-15): the guards are reported (G7 dry-streak entry rate, Q3, Q4,
 * entry kinds), chip conservation and the jackpot fee are counted, illegal
 * answers are counted for every Horse seat, the options decide really received
 * are recorded, and the per-hand paired rows go to a side file that
 * mergeLightningEvalPairs pools (G5 / P1).
 */
export const LIGHTNING_EVAL_SCHEMA = 'lightning-paired-eval/v2';
export const LIGHTNING_EVAL_PAIRS_SCHEMA = 'lightning-paired-eval-pairs/v2';
export const LIGHTNING_EVAL_MERGE_SCHEMA = 'lightning-paired-eval-merge/v2';
/**
 * The runner test's own timeout (2026-11-21). A timeout passed to `it` beats
 * vitest's `--testTimeout`, so `--testTimeout=0` never lifted the fixed two
 * hours, and a declared 90-cell run in one process died at about 60 cells.
 * `LIGHTNING_EVAL_TIMEOUT_MS` sets it: unset or empty keeps the two hours, `0`
 * means no timeout (vitest skips the race for a value of 0 or less), any other
 * whole number of milliseconds is used as given. Anything else is refused,
 * so a typo never silently runs under the default.
 */
export const LIGHTNING_EVAL_RUNNER_DEFAULT_TIMEOUT_MS = 7_200_000;
export function lightningEvalRunnerTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return LIGHTNING_EVAL_RUNNER_DEFAULT_TIMEOUT_MS;
  const text = raw.trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(
      `LIGHTNING_EVAL_TIMEOUT_MS must be a whole number of milliseconds (0 for no timeout), got ${JSON.stringify(raw)}`
    );
  }
  return Number(text);
}
/** The 1/2 stake: the one stake where NLH, PLO4 and PLO5 all deal Lightning. */
export const LIGHTNING_EVAL_SMALL_BLIND = 1;
export const LIGHTNING_EVAL_BIG_BLIND = 2;

export const LIGHTNING_EVAL_VARIANTS = ['nlh', 'plo4', 'plo5'] as const;
export type LightningEvalVariant = (typeof LIGHTNING_EVAL_VARIANTS)[number];
export const LIGHTNING_EVAL_PLAYERS = [4, 5, 6] as const;
export const LIGHTNING_EVAL_STACKS_BB = [50, 100, 200] as const;

/**
 * MIXED STACKS AT ONE TABLE (2026-11-15). A cell's `stackMix`:
 *   uniform  (the default; absent means uniform) every seat starts at the
 *            cell's stackBB. Every cell of the smoke, full, selection and
 *            final configurations is uniform and plays exactly as before.
 *   mixed    every seat draws its own starting stack, hand by hand, from
 *            LIGHTNING_EVAL_MIXED_STACKS. The draw is a function of (seed,
 *            cell, hand, table slot) alone, so both arms of a pair deal the
 *            same stacks. It has its own stream (5): the cards, the host's
 *            tempo, the seat draw and every seat's dice are those of the
 *            cell's uniform twin (same variant, players, nominal stackBB,
 *            field and villains); only the stacks differ.
 */
export type LightningEvalStackMix = 'uniform' | 'mixed';

/**
 * The declared distribution of a mixed cell's starting stacks: whole big
 * blinds, uniform on [50, 200], the Lightning buy-in range (the host's
 * maximum buy-in reads 200 bb when the rules carry none, LightningHandHost
 * max_buy_in). A neutral development prior, NOT fitted to production: no
 * production stack census was read. Mean 125 bb; every whole depth equally
 * likely. Replace it with a measured distribution, in a new declared
 * configuration, before a selection or final run deals mixed cells.
 */
export const LIGHTNING_EVAL_MIXED_STACKS = Object.freeze({
  distribution: 'uniform on whole big blinds' as const,
  minBB: 50,
  maxBB: 200,
  /** The per-hand stream the draw uses (1 to 4: deck, Horse jitter, host tempo, seat draw). */
  stream: 5,
});

/** Effective-stack bands of a mixed cell's summary (subject hands). */
export const LIGHTNING_EVAL_EFFECTIVE_STACK_BANDS = ['50-99bb', '100-149bb', '150-200bb'] as const;

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
  /**
   * Absent or `uniform`: every seat at stackBB. `mixed`: every seat draws
   * from LIGHTNING_EVAL_MIXED_STACKS each hand; stackBB is then the cell's
   * nominal depth only (it names the uniform twin whose deals it shares).
   */
  stackMix?: LightningEvalStackMix;
  /**
   * E2 (2026-11-19): a floored pool. Absent: no VPIP rule, every cell as
   * before. Present: the rules carry nit_game / maintain_percent_min /
   * maintain_hands for BOTH arms, every player keeps one pool session for the
   * whole cell, and each arm keeps its own pool ledger (LightningEvalPoolLedger).
   * Not part of the cell key: a floored cell deals the cards, seats and dice of
   * its unfloored twin.
   */
  floor?: LightningEvalFloor;
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
  /**
   * development | selection | final: see the protocol's contamination rule.
   * switch (E1, 2026-11-19): a leave-one-out switch card on production's live
   * base; its seeds come from LIGHTNING_EVAL_SWITCH_SEED_RANGE only.
   */
  seedClass: 'development' | 'selection' | 'final' | 'switch';
  seeds: readonly number[];
  handsPerCell: number;
  cells: readonly LightningEvalCell[];
  /** Decide options both arms run on (the served configuration under test). */
  baselineDecideOpts: Record<string, unknown>;
  /** E1 switch cards only: what the card declared (recorded in the report). */
  switchCard?: LightningEvalSwitchCardRecord;
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

/**
 * Hands per cell and seed for the selection and final stages (protocol draft
 * 2, section 7). From the development run of the participation candidate
 * (seed 20261114, 1,000 hands per cell): the pooled primary standard error
 * over four primary cells (4,000 paired hands) was 2.2 (NLH), 9.3 (PLO4) and
 * 10.6 (PLO5) bb/100. The worst variant needs 4,000 x (10.6 / 1.5)^2 = about
 * 200,000 primary paired hands for a pooled standard error of 1.5 bb/100;
 * the declared matrix has 18 primary cells per variant and five seeds, so
 * 200,000 / (18 x 5) = 2,220, rounded to 2,200.
 */
export const LIGHTNING_EVAL_STAGE_HANDS_PER_CELL = 2200;

/** The selection stage: the declared matrix on the selection seeds only. */
export const LIGHTNING_EVAL_SELECTION: LightningEvalConfig = Object.freeze({
  name: 'selection',
  seedClass: 'selection',
  seeds: LIGHTNING_EVAL_SEEDS.selection,
  handsPerCell: LIGHTNING_EVAL_STAGE_HANDS_PER_CELL,
  cells: fullCells(),
  baselineDecideOpts: LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114,
} satisfies LightningEvalConfig);

/** The final stage: dealt once, by the one chosen frozen candidate. */
export const LIGHTNING_EVAL_FINAL: LightningEvalConfig = Object.freeze({
  name: 'final',
  seedClass: 'final',
  seeds: LIGHTNING_EVAL_SEEDS.final,
  handsPerCell: LIGHTNING_EVAL_STAGE_HANDS_PER_CELL,
  cells: fullCells(),
  baselineDecideOpts: LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114,
} satisfies LightningEvalConfig);

function devMixedCells(): LightningEvalCell[] {
  const cells: LightningEvalCell[] = [];
  for (const variant of LIGHTNING_EVAL_VARIANTS)
    for (const players of LIGHTNING_EVAL_PLAYERS) {
      for (const field of LIGHTNING_EVAL_FIELDS)
        cells.push({
          variant,
          players,
          stackBB: 100,
          field,
          ...(field === 'tag_regular' || field === 'three_bet_heavy'
            ? { counterExploit: true }
            : {}),
          stackMix: 'mixed',
        });
      cells.push({
        variant,
        players,
        stackBB: 100,
        field: 'three_bet_heavy',
        villains: 2,
        counterExploit: true,
        stackMix: 'mixed',
      });
    }
  return cells;
}

/**
 * DEVELOPMENT ONLY: the declared matrix with mixed stacks at every table
 * (3 variants x 3 table sizes x 10 fields = 90 cells x 1,000 hands x 2 arms
 * per seed). The full matrix's stack dimension is replaced by the mixed draw;
 * each cell shares the deals of its uniform 100 bb twin. Never a selection or
 * final configuration: its stack distribution is a declared prior.
 */
export const LIGHTNING_EVAL_DEV_MIXED: LightningEvalConfig = Object.freeze({
  name: 'dev_mixed',
  seedClass: 'development',
  seeds: [20261114, 20261115, 20261116],
  handsPerCell: 1000,
  cells: devMixedCells(),
  baselineDecideOpts: LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114,
} satisfies LightningEvalConfig);

/**
 * A few hundred mixed-stack hands: the six smoke cells with mixed stacks
 * (each shares the deals of its smoke cell), development seed 20261114.
 */
export const LIGHTNING_EVAL_DEV_MIXED_SMOKE: LightningEvalConfig = Object.freeze({
  name: 'dev_mixed_smoke',
  seedClass: 'development',
  seeds: [20261114],
  handsPerCell: 40,
  cells: LIGHTNING_EVAL_SMOKE.cells.map((cell) => ({ ...cell, stackMix: 'mixed' as const })),
  baselineDecideOpts: LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114,
} satisfies LightningEvalConfig);

export function lightningEvalSeedClassOf(
  seed: number
): 'development' | 'selection' | 'final' | 'switch' | null {
  for (const cls of ['development', 'selection', 'final'] as const)
    if ((LIGHTNING_EVAL_SEEDS[cls] as readonly number[]).includes(seed)) return cls;
  if (
    Number.isSafeInteger(seed) &&
    seed >= LIGHTNING_EVAL_SWITCH_SEED_RANGE.min &&
    seed <= LIGHTNING_EVAL_SWITCH_SEED_RANGE.max
  )
    return 'switch';
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
 * The key of a cell's random streams: the seed and the cell's definition
 * (variant, players, nominal stackBB, field, seated villains); the arithmetic
 * the arm has always used. `stackMix` is deliberately not part of it: a mixed
 * cell deals the cards, seats and dice of its uniform twin.
 */
export function lightningEvalCellKey(seed: number, cell: LightningEvalCell): number {
  const n = cell.players;
  const villains = cell.field === 'all_horse' ? 0 : Math.min(cell.villains ?? 1, n - 1);
  return lightningEvalMix(
    seed,
    cell.variant.length * 131 + n * 17 + cell.stackBB,
    cell.field.length * 7919 + cell.field.charCodeAt(0) * 31 + villains
  );
}

function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/** A mixed cell's starting stacks for hand `h`, one per table slot, in big blinds. */
export function lightningEvalMixedStacksBB(cellKey: number, h: number, players: number): number[] {
  const { minBB, maxBB, stream } = LIGHTNING_EVAL_MIXED_STACKS;
  const next = xorshift32(lightningEvalMix(cellKey, h, stream));
  return Array.from({ length: players }, () => minBB + Math.floor(next() * (maxBB - minBB + 1)));
}

/** The starting stacks of hand `h` of a cell, one per table slot, in big blinds. */
export function lightningEvalStacksBB(
  cell: LightningEvalCell,
  cellKey: number,
  h: number
): number[] {
  return cell.stackMix === 'mixed'
    ? lightningEvalMixedStacksBB(cellKey, h, cell.players)
    : Array.from({ length: cell.players }, () => cell.stackBB);
}

/**
 * A seat's effective stack: the smaller of its own starting stack and the
 * deepest other starting stack at the table (the most it can win from, or
 * lose to, any one opponent), before blinds and antes are posted.
 */
export function lightningEvalEffectiveStackBB(stacksBB: readonly number[], slot: number): number {
  let deepestOther = 0;
  for (let i = 0; i < stacksBB.length; i++)
    if (i !== slot && stacksBB[i]! > deepestOther) deepestOther = stacksBB[i]!;
  return Math.min(stacksBB[slot] ?? 0, deepestOther);
}

export function lightningEvalEffectiveStackBand(
  effectiveBB: number
): (typeof LIGHTNING_EVAL_EFFECTIVE_STACK_BANDS)[number] {
  return effectiveBB < 100 ? '50-99bb' : effectiveBB < 150 ? '100-149bb' : '150-200bb';
}

/** `100bb` for a uniform cell, `mixed:100bb` for a mixed cell (its nominal twin). */
export function lightningEvalStackLabel(cell: LightningEvalCell): string {
  return cell.stackMix === 'mixed' ? `mixed:${cell.stackBB}bb` : `${cell.stackBB}bb`;
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

/**
 * What a subject's entry was, by its FIRST voluntary preflop call, bet, raise
 * or all-in among the accepted actions (so an early look never decides it):
 *   firstInRaise / firstInLimp   nobody had called or raised (not the big blind)
 *   overLimp / isoRaise          somebody had limped, nobody had raised
 *   coldCall / threeBetPlus      somebody had raised
 *   bigBlindCall / bigBlindRaise the big blind, facing a price (priced defence)
 *   bigBlindUnpricedRaise        the big blind raising its free option
 * The first seven are the protocol's classes; the two extra ones (isoRaise,
 * bigBlindUnpricedRaise) exist so that every entry has exactly one class.
 */
export const LIGHTNING_EVAL_ENTRY_KINDS = [
  'firstInRaise',
  'firstInLimp',
  'coldCall',
  'overLimp',
  'threeBetPlus',
  'bigBlindCall',
  'bigBlindRaise',
  'isoRaise',
  'bigBlindUnpricedRaise',
] as const;
export type LightningEvalEntryKind = (typeof LIGHTNING_EVAL_ENTRY_KINDS)[number];
/** Q4: the intended sources of a participation gain. */
export const LIGHTNING_EVAL_INTENDED_ENTRY_KINDS: readonly LightningEvalEntryKind[] = [
  'firstInRaise',
  'bigBlindCall',
  'bigBlindRaise',
];

export function emptyEntryKinds(): Record<LightningEvalEntryKind, number> {
  return Object.fromEntries(LIGHTNING_EVAL_ENTRY_KINDS.map((k) => [k, 0])) as Record<
    LightningEvalEntryKind,
    number
  >;
}

export interface LightningEvalPreflopAction {
  userId: string;
  action: string;
  isFullRaise?: boolean;
}

/**
 * A preflop raise for PFR and for "somebody had raised": a bet, a raise, or an
 * all-in the engine marked a full raise. An all-in whose isFullRaise is not
 * exactly true is a call for more (D9).
 */
export function lightningEvalIsPreflopRaise(a: LightningEvalPreflopAction): boolean {
  return (
    a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true)
  );
}

const ENTERING_ACTIONS = new Set(['call', 'bet', 'raise', 'all_in']);

/** `pre`: the accepted voluntary preflop actions of the hand, in order. */
export function classifyLightningEntry(
  pre: readonly LightningEvalPreflopAction[],
  userId: string,
  seat: number
): LightningEvalEntryKind | null {
  const idx = pre.findIndex((a) => a.userId === userId && ENTERING_ACTIONS.has(a.action));
  if (idx < 0) return null;
  const raising = lightningEvalIsPreflopRaise(pre[idx]!);
  const before = pre.slice(0, idx).filter((a) => a.userId !== userId);
  const raisedBefore = before.some(lightningEvalIsPreflopRaise);
  if (seat === 2) {
    const priced = raisedBefore || before.some((a) => a.action === 'all_in');
    return raising ? (priced ? 'bigBlindRaise' : 'bigBlindUnpricedRaise') : 'bigBlindCall';
  }
  if (raisedBefore) return raising ? 'threeBetPlus' : 'coldCall';
  const calledBefore = before.some((a) => a.action === 'call' || a.action === 'all_in');
  if (calledBefore) return raising ? 'isoRaise' : 'overLimp';
  return raising ? 'firstInRaise' : 'firstInLimp';
}

/**
 * G7. Per subject id, in the order the hands were dealt: a hand "follows a dry
 * streak" when the subject's previous `LIGHTNING_EVAL_DRY_STREAK` (5) or more
 * decision hands were all non-entries. Walks are no decision: they are left
 * out of the sequence (neither an opportunity nor a break in the streak).
 */
export const LIGHTNING_EVAL_DRY_STREAK = 5;
export interface LightningEvalDryStreakCounts {
  /** Hands with a decision (walks excluded). */
  opportunities: number;
  entries: number;
  /** Opportunities that follow >= 5 consecutive non-entries. */
  handsAfterDryStreak: number;
  entriesAfterDryStreak: number;
  /** Runs of non-entries that reached 5 (how often the guard could be read). */
  dryStreaks: number;
}
export interface LightningEvalDryStreak extends LightningEvalDryStreakCounts {
  /** entries / opportunities, percent (null when no opportunity). */
  entryRatePct: number | null;
  /** entriesAfterDryStreak / handsAfterDryStreak, percent (null when none). */
  entryRateAfterDryStreakPct: number | null;
}
export function emptyDryStreakCounts(): LightningEvalDryStreakCounts {
  return {
    opportunities: 0,
    entries: 0,
    handsAfterDryStreak: 0,
    entriesAfterDryStreak: 0,
    dryStreaks: 0,
  };
}
export function createLightningDryStreakTracker(): {
  record(id: string, entered: boolean, walk: boolean): void;
  counts: LightningEvalDryStreakCounts;
} {
  const run = new Map<string, number>();
  const counts = emptyDryStreakCounts();
  return {
    counts,
    record(id, entered, walk) {
      if (walk) return;
      const dry = run.get(id) ?? 0;
      counts.opportunities++;
      if (entered) counts.entries++;
      if (dry >= LIGHTNING_EVAL_DRY_STREAK) {
        counts.handsAfterDryStreak++;
        if (entered) counts.entriesAfterDryStreak++;
      }
      const next = entered ? 0 : dry + 1;
      if (next === LIGHTNING_EVAL_DRY_STREAK) counts.dryStreaks++;
      run.set(id, next);
    },
  };
}
const ratePct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100000) / 1000 : null;
export function lightningEvalDryStreak(
  ...parts: LightningEvalDryStreakCounts[]
): LightningEvalDryStreak {
  const c = emptyDryStreakCounts();
  for (const p of parts)
    for (const k of Object.keys(c) as Array<keyof LightningEvalDryStreakCounts>) c[k] += p[k];
  return {
    ...c,
    entryRatePct: ratePct(c.entries, c.opportunities),
    entryRateAfterDryStreakPct: ratePct(c.entriesAfterDryStreak, c.handsAfterDryStreak),
  };
}

/**
 * N2. Chips in = chips out: sum(won) + rake + jackpot fee - sum(contributed),
 * in chips. A settled hand whose absolute gap exceeds half a cent is a
 * conservation violation.
 */
export function lightningEvalConservationGap(
  results: ReadonlyArray<{ won?: number; contributed?: number }>,
  rake: number,
  jackpotFee: number
): number {
  let won = 0;
  let contributed = 0;
  for (const r of results) {
    won += Number(r.won) || 0;
    contributed += Number(r.contributed) || 0;
  }
  return won + (Number(rake) || 0) + (Number(jackpotFee) || 0) - contributed;
}
export const LIGHTNING_EVAL_CONSERVATION_TOLERANCE = 0.005;

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
  /** Entries by kind (LIGHTNING_EVAL_ENTRY_KINDS); they sum to `vpip`. */
  entryKinds: Record<LightningEvalEntryKind, number>;
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
    entryKinds: emptyEntryKinds(),
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
  entryKind: LightningEvalEntryKind | null;
  sawFlop: boolean;
  fastFold: boolean;
  strength: number;
  bbPrice: number | null;
  bbAnswer: string | null;
  bbAnswerEarly: boolean | null;
  /** The subject's starting stack, bb (before blinds and antes). */
  stackBB: number;
  /** Its effective stack: min(own, deepest other seat), bb (lightningEvalEffectiveStackBB). */
  effectiveStackBB: number;
}

export interface LightningEvalHandRecord {
  h: number;
  settled: boolean;
  rakeBB: number;
  jackpotFeeBB: number;
  subjects: LightningEvalSubjectHand[];
  /**
   * Every Horse decision of the hand, in order (early looks included):
   * `id|S or H|stage|e or t|action|amount`, S = a subject seat.
   */
  decisions: string[];
  /** Every accepted voluntary action of the hand, in order. */
  accepted: string[];
  /** The starting stack of every table slot, bb, as dealt (both arms deal the same). */
  stacksBB: number[];
  /**
   * Seats whose start as the engine settled it (stackAfter - won +
   * contributed) is not the dealt stack. Must be 0: the stacks reached the engine.
   */
  engineStackMismatches: number;
  /**
   * The hand's length on the harness clock, ms: every think time and every
   * fold reaction of the hand, in 400 ms steps. A function of the pinned
   * streams alone, so two runs of one arm agree on it. Not in the report.
   */
  clockMs: number;
}

/**
 * THE PRODUCTION DECISION DEADLINE (2026-11-15). A Lightning Horse decision
 * is a FAST job on the live decision lane (LightningHorse.decideLightningHorse):
 *   caller deadline     horseDecisionDeadlineMs (decisionDeadline.ts): what is
 *                       left of the turn clock less 1,500 ms, within [2,000,
 *                       30,000] ms, queue plus compute, from enqueue. The host
 *                       passes it with every request: 13,500 ms on the 15 s
 *                       Lightning clock when the job is enqueued as the turn
 *                       (or the early look) starts. Absent or invalid, the
 *                       client applies its jobTimeoutMs (client.ts enqueue).
 *   execution deadline  the client's jobTimeoutMs, 8,000 ms (its default; the
 *                       production lane passes none): compute alone, from
 *                       dispatch. A job past it fails its worker shard.
 * On either, decideLightningHorse resolves to the liveness answer: check, or
 * fold facing a bet (workerFallback, think time 0).
 * The harness calls HorseLogic.decide in process: no queue, no worker thread,
 * no IPC, no main-loop contention, the equity governor at full scale, on the
 * measuring machine. Its wall-clock is compute only, so a decision misses
 * when that compute alone exceeds the smaller of the two deadlines: a lower
 * bound on what production would miss, not an estimate of it.
 */
export interface LightningEvalDeadlineCounts {
  /** Subject decisions measured (= latencyMs.n). */
  decisions: number;
  overCallerDeadline: number;
  overExecutionDeadline: number;
  /** Over either deadline: the answers production replaces with the liveness answer. */
  overDeadline: number;
  /** The caller deadlines the host passed for subject decisions, ms. */
  minCallerDeadlineMs: number | null;
  maxCallerDeadlineMs: number | null;
  /** The worker client's execution deadline, read from the client, ms. */
  executionDeadlineMs: number;
  /**
   * Apply mode only (0 otherwise): Horse decisions, ANY Horse seat, that
   * missed and were answered by the host's own liveness path instead.
   */
  appliedFallbacks: number;
}

export function emptyDeadlineCounts(executionDeadlineMs: number): LightningEvalDeadlineCounts {
  return {
    decisions: 0,
    overCallerDeadline: 0,
    overExecutionDeadline: 0,
    overDeadline: 0,
    minCallerDeadlineMs: null,
    maxCallerDeadlineMs: null,
    executionDeadlineMs,
    appliedFallbacks: 0,
  };
}

export interface LightningEvalDeadlineMiss {
  /** The caller deadline the client would arm (the request's, or jobTimeoutMs). */
  callerDeadlineMs: number;
  overCaller: boolean;
  overExecution: boolean;
  over: boolean;
}

/** One decision's compute time against the two deadlines, as the client arms them. */
export function lightningEvalDeadlineMiss(
  computeMs: number,
  requestDeadlineMs: unknown,
  executionDeadlineMs: number
): LightningEvalDeadlineMiss {
  const callerDeadlineMs =
    typeof requestDeadlineMs === 'number' &&
    Number.isFinite(requestDeadlineMs) &&
    requestDeadlineMs > 0
      ? Math.floor(requestDeadlineMs)
      : executionDeadlineMs;
  const overCaller = computeMs > callerDeadlineMs;
  const overExecution = computeMs > executionDeadlineMs;
  return { callerDeadlineMs, overCaller, overExecution, over: overCaller || overExecution };
}

export function recordLightningEvalDeadline(
  counts: LightningEvalDeadlineCounts,
  miss: LightningEvalDeadlineMiss
): void {
  counts.decisions++;
  if (miss.overCaller) counts.overCallerDeadline++;
  if (miss.overExecution) counts.overExecutionDeadline++;
  if (miss.over) counts.overDeadline++;
  counts.minCallerDeadlineMs =
    counts.minCallerDeadlineMs === null
      ? miss.callerDeadlineMs
      : Math.min(counts.minCallerDeadlineMs, miss.callerDeadlineMs);
  counts.maxCallerDeadlineMs =
    counts.maxCallerDeadlineMs === null
      ? miss.callerDeadlineMs
      : Math.max(counts.maxCallerDeadlineMs, miss.callerDeadlineMs);
}

/**
 * Latency histogram: bin k holds decisions of (0.001 x 1.01^(k-1), 0.001 x
 * 1.01^k] ms (bin 0: at most 0.001 ms). A pooled percentile is the upper edge
 * of the bin it falls in: never below the exact value, at most 1% above it,
 * the same on both arms. Sparse: bin -> count.
 */
export const LIGHTNING_EVAL_LATENCY_BIN_FLOOR_MS = 0.001;
export const LIGHTNING_EVAL_LATENCY_BIN_RATIO = 1.01;
export function lightningEvalLatencyBin(ms: number): number {
  if (!(ms > LIGHTNING_EVAL_LATENCY_BIN_FLOOR_MS)) return 0;
  return Math.ceil(
    Math.log(ms / LIGHTNING_EVAL_LATENCY_BIN_FLOOR_MS) /
      Math.log(LIGHTNING_EVAL_LATENCY_BIN_RATIO) -
      1e-9
  );
}
export function lightningEvalLatencyBinUpperMs(bin: number): number {
  return LIGHTNING_EVAL_LATENCY_BIN_FLOOR_MS * LIGHTNING_EVAL_LATENCY_BIN_RATIO ** bin;
}
export function addLightningEvalLatency(histogram: Record<string, number>, ms: number): void {
  const k = String(lightningEvalLatencyBin(ms));
  histogram[k] = (histogram[k] ?? 0) + 1;
}
/** The q-quantile (the convention of the per-cell figures: element floor(q x n)), ms. */
export function lightningEvalHistogramPercentile(
  histogram: Readonly<Record<string, number>>,
  q: number
): number | null {
  const bins = Object.keys(histogram)
    .map(Number)
    .sort((x, y) => x - y);
  const n = bins.reduce((s, k) => s + (histogram[String(k)] ?? 0), 0);
  if (n === 0) return null;
  const target = Math.min(n - 1, Math.floor(q * n));
  let seen = 0;
  for (const k of bins) {
    seen += histogram[String(k)] ?? 0;
    if (seen > target) return Math.round(lightningEvalLatencyBinUpperMs(k) * 1000) / 1000;
  }
  return null;
}

export interface LightningEvalArmResult {
  arm: string;
  scope: 'hero' | 'all_horses';
  hands: LightningEvalHandRecord[];
  total: LightningEvalPositionStats;
  byPosition: Record<string, LightningEvalPositionStats>;
  rakeConfig: unknown;
  tableRakeBBPer100: number;
  tableJackpotFeeBBPer100: number;
  subjectRakeBBPer100: number;
  subjectRakeShareBBPer100: number;
  subjectJackpotFeeShareBBPer100: number;
  dryStreak: LightningEvalDryStreakCounts;
  counters: {
    decisions: number;
    subjectDecisions: number;
    /** Every Horse seat (subject and not). */
    illegalActions: number;
    illegalAmounts: number;
    /** The subject seats' part of the two counts above. */
    subjectIllegalActions: number;
    subjectIllegalAmounts: number;
    conservationViolations: number;
    policyFallbacks: number;
    decideThrows: number;
    villainRejected: number;
    unsettledHands: number;
    buttonMismatch: number;
    /** The arm specification's option keys. */
    armOptionKeysSeen: string[];
    /** Keys of the options object HorseLogic.decide was really called with. */
    subjectDecideOptionKeys: string[];
    nonSubjectDecideOptionKeys: string[];
  };
  /** E2: a floored cell only, this arm's own pool ledger. */
  pool?: LightningEvalPoolArmReport;
  /** Wall-clock: NOT part of the deterministic digest. */
  latencyMs: {
    n: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    /** The subject decisions against the production deadline (wall-clock). */
    deadline: LightningEvalDeadlineCounts;
  };
  /** Subject decide wall-clock, binned (lightningEvalLatencyBin); for pooling. */
  latencyHistogram: Record<string, number>;
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
  /** Divergent decisions made by a subject seat (in either arm). */
  subjectDivergentDecisions: number;
  /**
   * Positive control. In the first divergent hand both arms hold the same
   * reads, so the first differing decision must be a subject seat's.
   * null = no divergent hand.
   */
  firstDivergenceBySubject: boolean | null;
  /**
   * Up to and including the first divergent hand: non-subject Horse decisions
   * made before the subject's first decision of the hand, and how many of
   * them differ between the arms (must be 0).
   */
  preSubjectNonSubjectCompared: number;
  preSubjectNonSubjectDivergent: number;
}

/** Q3 of one arm: the quality of the range that enters and that sees a flop. */
export interface LightningEvalQ3 {
  /** Entering hands with a known preflop percentile. */
  entries: number;
  bottomQuartileEntries: number;
  bottomQuartileSharePct: number | null;
  meanEntryPercentile: number | null;
  sawFlop: number;
  bottomQuartileFlop: number;
  bottomQuartileFlopSharePct: number | null;
  meanFlopPercentile: number | null;
}

/** Q4: where the candidate-minus-baseline VPIP gain comes from. */
export interface LightningEvalQ4 {
  baselineHands: number;
  candidateHands: number;
  /** Percentage points of VPIP (entries / hands dealt), candidate - baseline. */
  vpipGainPoints: number;
  /** The same for first-in raises + priced big-blind calls and raises. */
  intendedGainPoints: number;
  /** intendedGainPoints / vpipGainPoints, percent; null when VPIP did not rise. */
  intendedSharePct: number | null;
  gainPointsByKind: Record<LightningEvalEntryKind, number>;
}

type QualityStats = Pick<
  LightningEvalPositionStats,
  | 'hands'
  | 'vpip'
  | 'sawFlop'
  | 'entryStrengthSum'
  | 'entryStrengthBins'
  | 'flopStrengthSum'
  | 'flopStrengthBins'
  | 'entryKinds'
>;

export function lightningEvalQ3(s: QualityStats): LightningEvalQ3 {
  const entries = s.entryStrengthBins.reduce((a, b) => a + b, 0);
  const flops = s.flopStrengthBins.reduce((a, b) => a + b, 0);
  const mean = (sum: number, n: number) => (n > 0 ? Math.round((sum / n) * 10000) / 10000 : null);
  return {
    entries,
    bottomQuartileEntries: s.entryStrengthBins[0] ?? 0,
    bottomQuartileSharePct: ratePct(s.entryStrengthBins[0] ?? 0, entries),
    meanEntryPercentile: mean(s.entryStrengthSum, entries),
    sawFlop: flops,
    bottomQuartileFlop: s.flopStrengthBins[0] ?? 0,
    bottomQuartileFlopSharePct: ratePct(s.flopStrengthBins[0] ?? 0, flops),
    meanFlopPercentile: mean(s.flopStrengthSum, flops),
  };
}

export function lightningEvalQ4(baseline: QualityStats, candidate: QualityStats): LightningEvalQ4 {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const points = (b: number, c: number) =>
    (candidate.hands > 0 ? (c / candidate.hands) * 100 : 0) -
    (baseline.hands > 0 ? (b / baseline.hands) * 100 : 0);
  const byKind = emptyEntryKinds();
  let intended = 0;
  for (const k of LIGHTNING_EVAL_ENTRY_KINDS) {
    const g = points(baseline.entryKinds[k] ?? 0, candidate.entryKinds[k] ?? 0);
    byKind[k] = r(g);
    if (LIGHTNING_EVAL_INTENDED_ENTRY_KINDS.includes(k)) intended += g;
  }
  const gain = points(baseline.vpip, candidate.vpip);
  return {
    baselineHands: baseline.hands,
    candidateHands: candidate.hands,
    vpipGainPoints: r(gain),
    intendedGainPoints: r(intended),
    intendedSharePct: gain > 1e-9 ? r((intended / gain) * 100) : null,
    gainPointsByKind: byKind,
  };
}

function addQuality(into: QualityStats, s: QualityStats): void {
  into.hands += s.hands;
  into.vpip += s.vpip;
  into.sawFlop += s.sawFlop;
  into.entryStrengthSum += s.entryStrengthSum;
  into.flopStrengthSum += s.flopStrengthSum;
  for (let i = 0; i < 4; i++) {
    into.entryStrengthBins[i]! += s.entryStrengthBins[i] ?? 0;
    into.flopStrengthBins[i]! += s.flopStrengthBins[i] ?? 0;
  }
  for (const k of LIGHTNING_EVAL_ENTRY_KINDS) into.entryKinds[k] += s.entryKinds[k] ?? 0;
}

export interface LightningEvalArmSummary {
  arm: string;
  scope: 'hero' | 'all_horses';
  total: LightningEvalPositionStats;
  byPosition: Record<string, LightningEvalPositionStats>;
  tableRakeBBPer100: number;
  tableJackpotFeeBBPer100: number;
  subjectRakeBBPer100: number;
  subjectRakeShareBBPer100: number;
  subjectJackpotFeeShareBBPer100: number;
  /** G7. */
  dryStreak: LightningEvalDryStreak;
  /** Q3, over all positions and per position. */
  q3: LightningEvalQ3;
  q3ByPosition: Record<string, LightningEvalQ3>;
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
  /** Q4, over all positions. */
  q4: LightningEvalQ4;
  /** A mixed cell only: the stacks it dealt (absent on a uniform cell). */
  stacks?: LightningEvalStacksSummary;
  /** E2: a floored cell only, each arm's pool ledger. */
  pool?: { baseline: LightningEvalPoolArmReport; candidate: LightningEvalPoolArmReport };
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
  /** E1 switch cards only. */
  switchCard?: LightningEvalSwitchCardRecord;
  /** Present only when the run applied the production deadline (machine dependent). */
  deadlineMode?: 'apply';
  contract: {
    smallBlind: number;
    bigBlind: number;
    bigBlindAnteBB: number;
    variants: string[];
    players: number[];
    /** The uniform cells' depths. */
    stacksBB: number[];
    /** Present only when a cell deals mixed stacks: the declared distribution. */
    mixedStacks?: typeof LIGHTNING_EVAL_MIXED_STACKS;
    rake: string;
    newTableEveryHand: true;
  };
  definitions: Record<string, string>;
  baselineArm: { name: string; decideOpts: Record<string, unknown> };
  candidateArm: {
    name: string;
    decideOptKeys: string[];
    snapshotPatch: boolean;
    scope: string;
    /** Union over cells of the option keys decide received for subject seats. */
    subjectDecideOptionKeys: string[];
    /** The same for the baseline arm's subject seats. */
    baselineSubjectDecideOptionKeys: string[];
  };
  cells: LightningEvalCellReport[];
  /** Counts summed over the cells of THIS report (G7, Q3, Q4). */
  pooled: {
    baseline: { dryStreak: LightningEvalDryStreak; q3: LightningEvalQ3 };
    candidate: { dryStreak: LightningEvalDryStreak; q3: LightningEvalQ3 };
    q4: LightningEvalQ4;
  };
  totals: {
    hands: number;
    /** Every Horse seat, both arms. */
    illegalActions: number;
    illegalAmounts: number;
    subjectIllegalActions: number;
    subjectIllegalAmounts: number;
    conservationViolations: number;
    policyFallbacks: number;
    decideThrows: number;
    unsettledHands: number;
    divergentDecisions: number;
  };
  /**
   * Subject decide wall-clock and the production deadline, pooled per variant
   * and over all variants (G4). Machine dependent: excluded from the digest.
   */
  latency: LightningEvalLatencyReport;
  /** sha256 over everything above (latency excluded): equal runs, equal digest. */
  digest: string;
}

/** The definition a report carries only when one of its cells deals mixed stacks. */
export const LIGHTNING_EVAL_STACK_MIX_DEFINITION =
  'stackMix mixed: every seat of the cell draws its own starting stack each hand from contract.mixedStacks (whole big blinds, uniform on [50, 200]; a declared development prior, not fitted to production), from its own stream: identical in both arms, and the cards, seats and dice are those of the uniform twin named by stackBB. cells[].stacks: the seats dealt, the subjects effective stacks (min of own and deepest other starting stack, before blinds and antes) and engineStackMismatches (seats whose settled start differs from the dealt stack; must be 0). The paired side file carries heroStackBB and effectiveStackBB per hand.';

/** E2: the definition a report carries only when one of its cells is floored. */
export const LIGHTNING_EVAL_POOL_DEFINITION =
  'cell.floor: the table rules carry nit_game, maintain_percent_min (vpipPct) and maintain_hands (windowHands) in BOTH arms; every player keeps one pool session for the whole cell (not one per formation slot); each arm keeps its own pool ledger. cells[].pool.{baseline,candidate}: per subject pool session hands, entries, cumulative VPIP after 10/30/100 hands and at the end, hands judged under the floor (rolling: the last windowHands hands; else the whole sitting), warnings, recoveries and evictions (graceHands dealt hands to recover; 0 boots on the spot; a booted session starts a new sitting), and the table totals over every player. A model of the game rule for measurement, not fn_nit_check. feedSnapshot hands every Horse the floor and its own judged figure (gs.vpipFloor, vpipWindowHands, ownVpip) from a feed ledger cleared every restartEveryHands hands; without it the Horse snapshot is production Lightning snapshot, which carries no floor.';
/** E1: the definition a report carries only for a switch card. */
export const LIGHTNING_EVAL_SWITCH_DEFINITION =
  'switchCard: a leave-one-out card on production live switch set. baselineArm.decideOpts is that set (validated: registered switches only, booleans, no off-only option on), both arms run on it; the candidate arm sets only switchCard.flag to switchCard.candidateValue. Seeds come from the switch seed class (LIGHTNING_EVAL_SWITCH_SEED_RANGE), never from the development, selection or final sets.';

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
    'diffBB100 is candidate minus baseline over the same hand indices (same cards, seats, opponent definitions and per-hand, per-seat random streams); seBB100 is the standard error of the per-hand paired differences, blockSeBB100 the same over orbit blocks. Each arm is its own playthrough: the Horses reads (HorseMind, winner reads) accumulate per arm, so after the first divergent hand the two arms opponents hold different reads. That is part of the treatment, not a pairing fault.',
  pfr: 'A preflop bet or raise, or an all-in the engine marked a full raise (isFullRaise exactly true). Any other all-in is a call for more.',
  entryKinds:
    'Every entry has one kind, set by the subject first voluntary preflop call, bet, raise or all-in among the ACCEPTED actions: firstInRaise, firstInLimp (nobody had called or raised; not the big blind), overLimp, isoRaise (a limper, no raise), coldCall, threeBetPlus (a raise before), bigBlindCall, bigBlindRaise (the big blind facing a price), bigBlindUnpricedRaise (the big blind raising its free option). They sum to vpip.',
  q3: 'Q3: bottomQuartileSharePct is the share of entering hands whose own-brain preflop percentile is below 0.25 (entryStrengthBins[0] over all four bins); meanEntryPercentile their mean; the Flop fields are the same over hands that saw a flop.',
  q4: 'Q4: vpipGainPoints is candidate VPIP minus baseline VPIP in percentage points of hands dealt (walks in the denominator); intendedGainPoints is the same difference for firstInRaise + bigBlindCall + bigBlindRaise; intendedSharePct is their ratio (null when VPIP did not rise); gainPointsByKind splits the gain by entry kind.',
  dryStreak:
    'G7: per subject id and arm, in dealing order with walks left out: opportunities and entries (entryRatePct is the overall entry rate, walks excluded); handsAfterDryStreak are the opportunities that follow 5 or more consecutive non-entries, entriesAfterDryStreak the entries among them (entryRateAfterDryStreakPct); dryStreaks counts the runs that reached 5. A range policy shows the two rates equal within sampling error; a deficit policy shows a rebound, or too few dry streaks to read (compare dryStreaks between arms).',
  rake: 'tableRakeBBPer100 is all rake taken per 100 hands of the cell and tableJackpotFeeBBPer100 the bad-beat-jackpot fee taken beside it (settlement field bbj; not part of rake). subjectRakeBBPer100 is the rake of pots the subject WON, in proportion to its share of the winnings, per 100 subject hands. subjectRakeShareBBPer100 is the per-seat figure: each hand rake times the subject share of all chips contributed to that hand, per 100 subject hands; subjectJackpotFeeShareBBPer100 the same for the fee.',
  conservation:
    'conservationViolations: settled hands where sum(won) + rake + jackpot fee differs from sum(contributed) by more than half a cent. Must be 0; the runner fails otherwise.',
  illegal:
    'illegalActions: a Horse decision (any Horse seat) whose action is not in its legal menu. illegalAmounts: a bet or raise outside [minRaiseTo, maxRaiseTo]. subjectIllegalActions / subjectIllegalAmounts are the subject seats part. All must be 0.',
  control:
    'subjectDecideOptionKeys / nonSubjectDecideOptionKeys: keys of the options object HorseLogic.decide was really called with. subjectDivergentDecisions, firstDivergenceBySubject, preSubjectNonSubjectCompared / preSubjectNonSubjectDivergent: the positive control (a real candidate must move the subject, and only the subject can start the first divergence).',
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
  let subjectDivergentDecisions = 0;
  let firstDivergenceBySubject: boolean | null = null;
  let preSubjectNonSubjectCompared = 0;
  let preSubjectNonSubjectDivergent = 0;
  const bySubject = (e: string | undefined) => e !== undefined && e.split('|')[1] === 'S';
  const firstSubject = (xs: string[]) => {
    const k = xs.findIndex(bySubject);
    return k < 0 ? xs.length : k;
  };
  const count = Math.min(a.hands.length, b.hands.length);
  for (let i = 0; i < count; i++) {
    const ha = a.hands[i]!;
    const hb = b.hands[i]!;
    const len = Math.max(ha.decisions.length, hb.decisions.length);
    let d = 0;
    let firstK = -1;
    for (let k = 0; k < len; k++)
      if (ha.decisions[k] !== hb.decisions[k]) {
        d++;
        if (firstK < 0) firstK = k;
        if (bySubject(ha.decisions[k]) || bySubject(hb.decisions[k])) subjectDivergentDecisions++;
      }
    if (firstDivergentHand === null) {
      // Both arms still hold the same reads: what the other Horses decide
      // before the subject has decided anything in this hand must be equal.
      const cut = Math.min(firstSubject(ha.decisions), firstSubject(hb.decisions));
      for (let k = 0; k < cut; k++) {
        preSubjectNonSubjectCompared++;
        if (ha.decisions[k] !== hb.decisions[k]) preSubjectNonSubjectDivergent++;
      }
    }
    if (d > 0) {
      divergentHands++;
      divergentDecisions += d;
      if (firstDivergentHand === null) {
        firstDivergentHand = ha.h;
        firstDivergenceBySubject =
          bySubject(ha.decisions[firstK]) || bySubject(hb.decisions[firstK]);
      }
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
    subjectDivergentDecisions,
    firstDivergenceBySubject,
    preSubjectNonSubjectCompared,
    preSubjectNonSubjectDivergent,
  };
}

/** One paired hand of one cell and seed: the side-file row (D2, G5, P1). */
export interface LightningEvalPairRow {
  seed: number;
  variant: LightningEvalVariant;
  players: number;
  stackBB: number;
  field: LightningEvalField;
  villains: number;
  counterExploit: boolean;
  /** Hand index within the cell. */
  h: number;
  /** Subject net of the hand in big blinds: baseline, candidate. */
  b: number;
  c: number;
  /**
   * Mixed cells only (absent on a uniform cell): the subject's starting stack
   * and effective stack, bb (null unless the hand has exactly one subject).
   */
  stackMix?: 'mixed';
  heroStackBB?: number | null;
  effectiveStackBB?: number | null;
}

/** The rows pairLightningEvalArms takes its difference from (both arms settled). */
export function lightningEvalPairRows(
  cell: LightningEvalCell,
  seed: number,
  a: LightningEvalArmResult,
  b: LightningEvalArmResult
): LightningEvalPairRow[] {
  const rows: LightningEvalPairRow[] = [];
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const count = Math.min(a.hands.length, b.hands.length);
  for (let i = 0; i < count; i++) {
    const ha = a.hands[i]!;
    const hb = b.hands[i]!;
    if (!ha.settled || !hb.settled) continue;
    const one = ha.subjects.length === 1 ? ha.subjects[0]! : null;
    rows.push({
      seed,
      variant: cell.variant,
      players: cell.players,
      stackBB: cell.stackBB,
      field: cell.field,
      villains: cell.field === 'all_horse' ? 0 : (cell.villains ?? 1),
      counterExploit: cell.counterExploit === true,
      h: ha.h,
      b: r(ha.subjects.reduce((s, x) => s + x.netBB, 0)),
      c: r(hb.subjects.reduce((s, x) => s + x.netBB, 0)),
      ...(cell.stackMix === 'mixed'
        ? {
            stackMix: 'mixed' as const,
            heroStackBB: one ? one.stackBB : null,
            effectiveStackBB: one ? one.effectiveStackBB : null,
          }
        : {}),
    });
  }
  return rows;
}

export interface LightningEvalPooledFigure {
  variant: string;
  /** primary (all_horse + unknown), counter_exploit, or field:<name>[ x2]. */
  group: string;
  /** The pooled hands, cells (seed x cell) and seeds behind the figure. */
  hands: number;
  cells: number;
  seeds: number[];
  baselineBB100: number;
  candidateBB100: number;
  diffBB100: number;
  /** Per-hand paired standard error. */
  seBB100: number;
  /** Orbit-block standard error (blocks of `players` consecutive hands of a cell). */
  blockSeBB100: number;
  /** The larger of the two: the one the protocol uses. */
  seUsedBB100: number;
  /** diffBB100 / seUsedBB100; null when the standard error is 0. */
  z: number | null;
}

export interface LightningEvalMerge {
  schema: typeof LIGHTNING_EVAL_MERGE_SCHEMA;
  hands: number;
  cells: number;
  seeds: number[];
  figures: LightningEvalPooledFigure[];
}

const pairCellKey = (r: {
  seed: number;
  variant: string;
  players: number;
  stackBB: number;
  field: string;
  villains: number;
  stackMix?: 'mixed';
}) =>
  `${r.seed}|${r.variant}|${r.players}|${r.stackBB}|${r.field}|${r.villains}${
    r.stackMix === 'mixed' ? '|mixed' : ''
  }`;
/** A mixed cell's groups are kept apart from the uniform ones. */
const MIXED_GROUP = ' (mixed stacks)';

/**
 * Pool paired hands across cells, seeds and cell-range files: per variant, for
 * the primary fields (all_horse + unknown), the counter-exploitation cells,
 * and every field by itself. Hands are pooled one for one (equal hands per
 * cell = equal cell weights). A (seed, cell, hand) met twice is refused: two
 * files that overlap must not count a hand twice.
 */
export function mergeLightningEvalPairs(rows: readonly LightningEvalPairRow[]): LightningEvalMerge {
  const seen = new Set<string>();
  const groups = new Map<string, Map<string, LightningEvalPairRow[]>>();
  for (const row of rows) {
    const cellKey = pairCellKey(row);
    const handKey = `${cellKey}|${row.h}`;
    if (seen.has(handKey)) throw new Error(`paired hand met twice: ${handKey}`);
    seen.add(handKey);
    const names = [`field:${row.field}${row.villains > 1 ? ` x${row.villains}` : ''}`];
    if (row.field === 'all_horse' || row.field === 'unknown') names.push('primary');
    if (row.counterExploit) names.push('counter_exploit');
    for (const name of names.map((x) => (row.stackMix === 'mixed' ? x + MIXED_GROUP : x))) {
      const g = `${row.variant}|${name}`;
      let cells = groups.get(g);
      if (!cells) groups.set(g, (cells = new Map()));
      let list = cells.get(cellKey);
      if (!list) cells.set(cellKey, (list = []));
      list.push(row);
    }
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const order = (name: string) => {
    const mixed = name.endsWith(MIXED_GROUP);
    const base = mixed ? name.slice(0, -MIXED_GROUP.length) : name;
    return (mixed ? 3 : 0) + (base === 'primary' ? 0 : base === 'counter_exploit' ? 1 : 2);
  };
  const figures: LightningEvalPooledFigure[] = [];
  for (const g of [...groups.keys()].sort((x, y) => {
    const [vx, nx] = x.split('|') as [string, string];
    const [vy, ny] = y.split('|') as [string, string];
    return vx.localeCompare(vy) || order(nx) - order(ny) || nx.localeCompare(ny);
  })) {
    const cells = groups.get(g)!;
    const [variant, group] = g.split('|') as [string, string];
    const diffs: number[] = [];
    const blocks: Array<{ sum: number; n: number }> = [];
    const seeds = new Set<number>();
    let sumB = 0;
    let sumC = 0;
    for (const list of cells.values()) {
      list.sort((x, y) => x.h - y.h);
      const size = list[0]!.players;
      seeds.add(list[0]!.seed);
      for (let i = 0; i < list.length; i += size) {
        const block = list.slice(i, i + size);
        blocks.push({ sum: block.reduce((s, x) => s + (x.c - x.b), 0), n: block.length });
      }
      for (const x of list) {
        diffs.push(x.c - x.b);
        sumB += x.b;
        sumC += x.c;
      }
    }
    const n = diffs.length;
    const mean = n ? diffs.reduce((s, x) => s + x, 0) / n : 0;
    const se = n > 1 ? sd(diffs) / Math.sqrt(n) : 0;
    // Blocks of unequal size: the ratio estimator's standard error of the mean.
    const B = blocks.length;
    const blockSe =
      B > 1
        ? Math.sqrt((B / (B - 1)) * blocks.reduce((s, x) => s + (x.sum - x.n * mean) ** 2, 0)) / n
        : 0;
    const used = Math.max(se, blockSe);
    figures.push({
      variant,
      group,
      hands: n,
      cells: cells.size,
      seeds: [...seeds].sort((x, y) => x - y),
      baselineBB100: r(n ? (sumB / n) * 100 : 0),
      candidateBB100: r(n ? (sumC / n) * 100 : 0),
      diffBB100: r(mean * 100),
      seBB100: r(se * 100),
      blockSeBB100: r(blockSe * 100),
      seUsedBB100: r(used * 100),
      z: used > 0 ? r(mean / used) : null,
    });
  }
  return {
    schema: LIGHTNING_EVAL_MERGE_SCHEMA,
    hands: seen.size,
    cells: new Set(rows.map(pairCellKey)).size,
    seeds: [...new Set(rows.map((x) => x.seed))].sort((x, y) => x - y),
    figures,
  };
}

export function lightningEvalMergeMarkdown(merge: LightningEvalMerge): string {
  const out: string[] = [];
  out.push('# Lightning paired evaluation: pooled paired differences');
  out.push('');
  out.push(
    `Schema ${merge.schema}. ${merge.hands} paired hands in ${merge.cells} cells (seed x cell), seeds ${merge.seeds.join(', ')}. diff = candidate minus baseline, bb/100; se used = the larger of the per-hand and the orbit-block standard error; z = diff / se used.`
  );
  out.push('');
  out.push(
    '| variant | group | pooled hands | cells | seeds | baseline bb/100 | candidate bb/100 | diff bb/100 | se per hand | se orbit block | se used | z |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const f of merge.figures)
    out.push(
      `| ${f.variant} | ${f.group} | ${f.hands} | ${f.cells} | ${f.seeds.join(', ')} | ${f.baselineBB100.toFixed(1)} | ${f.candidateBB100.toFixed(1)} | ${f.diffBB100.toFixed(1)} | ${f.seBB100.toFixed(1)} | ${f.blockSeBB100.toFixed(1)} | ${f.seUsedBB100.toFixed(1)} | ${f.z === null ? '-' : f.z.toFixed(2)} |`
    );
  out.push('');
  return out.join('\n');
}

/** The stacks a mixed cell dealt (only a mixed cell's report carries it; in the digest). */
export interface LightningEvalStacksSummary {
  mix: 'mixed';
  distribution: typeof LIGHTNING_EVAL_MIXED_STACKS;
  /** Seats dealt, every hand of the baseline arm (the candidate arm dealt the same). */
  seats: number;
  seatMeanBB: number;
  seatMinBB: number;
  seatMaxBB: number;
  /** Subject hands of the baseline arm (the candidate's are the same hands and stacks). */
  subjectHands: number;
  effectiveMeanBB: number | null;
  effectiveMinBB: number | null;
  effectiveMaxBB: number | null;
  effectiveBands: Record<string, number>;
  /** Both arms: seats whose settled start is not the dealt stack. Must be 0. */
  engineStackMismatches: number;
}

export function lightningEvalStacksSummary(
  a: LightningEvalArmResult,
  b: LightningEvalArmResult
): LightningEvalStacksSummary {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const seats = a.hands.flatMap((h) => h.stacksBB ?? []);
  const eff = a.hands.flatMap((h) => h.subjects.map((s) => s.effectiveStackBB));
  const bands = Object.fromEntries(
    LIGHTNING_EVAL_EFFECTIVE_STACK_BANDS.map((k) => [k, 0])
  ) as Record<string, number>;
  for (const e of eff) bands[lightningEvalEffectiveStackBand(e)]!++;
  const mean = (xs: number[]) => (xs.length ? r(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return {
    mix: 'mixed',
    distribution: { ...LIGHTNING_EVAL_MIXED_STACKS },
    seats: seats.length,
    seatMeanBB: mean(seats) ?? 0,
    seatMinBB: seats.length ? Math.min(...seats) : 0,
    seatMaxBB: seats.length ? Math.max(...seats) : 0,
    subjectHands: eff.length,
    effectiveMeanBB: mean(eff),
    effectiveMinBB: eff.length ? Math.min(...eff) : null,
    effectiveMaxBB: eff.length ? Math.max(...eff) : null,
    effectiveBands: bands,
    engineStackMismatches: [...a.hands, ...b.hands].reduce(
      (s, h) => s + (h.engineStackMismatches ?? 0),
      0
    ),
  };
}

/** One cell's subject decide wall-clock, both arms: the latency side-file row. */
export interface LightningEvalLatencyArmRow {
  histogram: Record<string, number>;
  maxMs: number;
  deadline: LightningEvalDeadlineCounts;
}
export interface LightningEvalLatencyRow {
  seed: number;
  variant: LightningEvalVariant;
  players: number;
  stackBB: number;
  field: LightningEvalField;
  villains: number;
  stackMix?: 'mixed';
  baseline: LightningEvalLatencyArmRow;
  candidate: LightningEvalLatencyArmRow;
}
export const LIGHTNING_EVAL_LATENCY_SCHEMA = 'lightning-paired-eval-latency/v1';
/** G4: candidate p95 and p99 not worse than baseline by more than 10%. */
export const LIGHTNING_EVAL_G4_MAX_RATIO = 1.1;

export function lightningEvalLatencyRow(
  cell: LightningEvalCell,
  seed: number,
  a: LightningEvalArmResult,
  b: LightningEvalArmResult
): LightningEvalLatencyRow {
  const arm = (x: LightningEvalArmResult): LightningEvalLatencyArmRow => ({
    histogram: { ...x.latencyHistogram },
    maxMs: Math.round(x.latencyMs.max * 1000) / 1000,
    deadline: { ...x.latencyMs.deadline },
  });
  return {
    seed,
    variant: cell.variant,
    players: cell.players,
    stackBB: cell.stackBB,
    field: cell.field,
    villains: cell.field === 'all_horse' ? 0 : (cell.villains ?? 1),
    ...(cell.stackMix === 'mixed' ? { stackMix: 'mixed' as const } : {}),
    baseline: arm(a),
    candidate: arm(b),
  };
}

/** One arm's subject decisions pooled over cells (and seeds, and files). */
export interface LightningEvalLatencyPool {
  decisions: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Exact (the largest of the cells' exact maxima). */
  maxMs: number | null;
  overCallerDeadline: number;
  overExecutionDeadline: number;
  overDeadline: number;
  overDeadlineSharePct: number | null;
  minCallerDeadlineMs: number | null;
  maxCallerDeadlineMs: number | null;
  appliedFallbacks: number;
}
export interface LightningEvalLatencyFigure {
  /** nlh, plo4, plo5, or `all` (every variant pooled). */
  variant: string;
  cells: number;
  seeds: number[];
  baseline: LightningEvalLatencyPool;
  candidate: LightningEvalLatencyPool;
  /** Candidate / baseline; null when the baseline figure is 0 or missing. */
  ratio: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
    overDeadlineShare: number | null;
  };
  /** G4's arithmetic: both the p95 and the p99 ratio at most 1.10; null when either is null. */
  g4WithinTenPercent: boolean | null;
}
export interface LightningEvalLatencyReport {
  schema: typeof LIGHTNING_EVAL_LATENCY_SCHEMA;
  definition: string;
  deadlineMode: 'measure' | 'apply';
  /** The worker client's execution deadline the cells ran against, ms. */
  executionDeadlineMs: number | null;
  figures: LightningEvalLatencyFigure[];
}

export const LIGHTNING_EVAL_LATENCY_DEFINITION =
  'Subject HorseLogic.decide wall-clock, in process on the measuring machine (compute only: no queue, worker thread, IPC or main-loop contention; equity governor at full scale). A decision misses when its compute exceeds the caller deadline the host passed (horseDecisionDeadlineMs: the turn clock less 1,500 ms within [2,000, 30,000] ms, queue plus compute) or the worker client execution deadline (jobTimeoutMs, compute after dispatch); production answers a miss with check, or fold facing a bet. Misses here are a lower bound on production misses. Pooled percentiles are histogram upper edges (bins 1% wide: never below the exact value, at most 1% above); max is exact. ratio = candidate / baseline (null when the baseline is 0). g4WithinTenPercent: p95 and p99 ratios both at most 1.10 (protocol G4, judged on the pooled figure, same machine and run). Excluded from the digest.';

function poolLatency(arms: readonly LightningEvalLatencyArmRow[]): LightningEvalLatencyPool {
  const histogram: Record<string, number> = {};
  let maxMs: number | null = null;
  const d = emptyDeadlineCounts(0);
  let minCaller: number | null = null;
  let maxCaller: number | null = null;
  for (const a of arms) {
    for (const [k, v] of Object.entries(a.histogram)) histogram[k] = (histogram[k] ?? 0) + v;
    if (a.deadline.decisions > 0) maxMs = maxMs === null ? a.maxMs : Math.max(maxMs, a.maxMs);
    d.decisions += a.deadline.decisions;
    d.overCallerDeadline += a.deadline.overCallerDeadline;
    d.overExecutionDeadline += a.deadline.overExecutionDeadline;
    d.overDeadline += a.deadline.overDeadline;
    d.appliedFallbacks += a.deadline.appliedFallbacks;
    if (a.deadline.minCallerDeadlineMs !== null)
      minCaller =
        minCaller === null
          ? a.deadline.minCallerDeadlineMs
          : Math.min(minCaller, a.deadline.minCallerDeadlineMs);
    if (a.deadline.maxCallerDeadlineMs !== null)
      maxCaller =
        maxCaller === null
          ? a.deadline.maxCallerDeadlineMs
          : Math.max(maxCaller, a.deadline.maxCallerDeadlineMs);
  }
  return {
    decisions: d.decisions,
    p50Ms: lightningEvalHistogramPercentile(histogram, 0.5),
    p95Ms: lightningEvalHistogramPercentile(histogram, 0.95),
    p99Ms: lightningEvalHistogramPercentile(histogram, 0.99),
    maxMs,
    overCallerDeadline: d.overCallerDeadline,
    overExecutionDeadline: d.overExecutionDeadline,
    overDeadline: d.overDeadline,
    overDeadlineSharePct: ratePct(d.overDeadline, d.decisions),
    minCallerDeadlineMs: minCaller,
    maxCallerDeadlineMs: maxCaller,
    appliedFallbacks: d.appliedFallbacks,
  };
}

/**
 * Pool the latency rows (cells, seeds, cell-range files of ONE candidate)
 * per variant and over all variants: the G4 figure. A cell met twice is
 * refused, as in the paired merge.
 */
export function mergeLightningEvalLatency(
  rows: readonly LightningEvalLatencyRow[],
  deadlineMode: 'measure' | 'apply' = 'measure'
): LightningEvalLatencyReport {
  const seen = new Set<string>();
  const exec = new Set<number>();
  for (const row of rows) {
    const key = pairCellKey(row);
    if (seen.has(key)) throw new Error(`latency cell met twice: ${key}`);
    seen.add(key);
    for (const arm of [row.baseline, row.candidate])
      if (arm.deadline.decisions > 0) exec.add(arm.deadline.executionDeadlineMs);
  }
  if (exec.size > 1)
    throw new Error(
      `latency rows ran against different execution deadlines: ${[...exec].join(', ')}`
    );
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const ratio = (c: number | null, b: number | null) =>
    c === null || b === null || !(b > 0) ? null : r(c / b);
  const figure = (variant: string, list: readonly LightningEvalLatencyRow[]) => {
    const baseline = poolLatency(list.map((x) => x.baseline));
    const candidate = poolLatency(list.map((x) => x.candidate));
    const p95 = ratio(candidate.p95Ms, baseline.p95Ms);
    const p99 = ratio(candidate.p99Ms, baseline.p99Ms);
    return {
      variant,
      cells: list.length,
      seeds: [...new Set(list.map((x) => x.seed))].sort((x, y) => x - y),
      baseline,
      candidate,
      ratio: {
        p50: ratio(candidate.p50Ms, baseline.p50Ms),
        p95,
        p99,
        overDeadlineShare: ratio(candidate.overDeadlineSharePct, baseline.overDeadlineSharePct),
      },
      g4WithinTenPercent:
        p95 === null || p99 === null
          ? null
          : p95 <= LIGHTNING_EVAL_G4_MAX_RATIO + 1e-9 && p99 <= LIGHTNING_EVAL_G4_MAX_RATIO + 1e-9,
    };
  };
  const variants = [...new Set(rows.map((x) => x.variant))].sort();
  return {
    schema: LIGHTNING_EVAL_LATENCY_SCHEMA,
    definition: LIGHTNING_EVAL_LATENCY_DEFINITION,
    deadlineMode,
    executionDeadlineMs: exec.size ? [...exec][0]! : null,
    figures: [
      ...variants.map((v) =>
        figure(
          v,
          rows.filter((x) => x.variant === v)
        )
      ),
      ...(rows.length ? [figure('all', rows)] : []),
    ],
  };
}

export function lightningEvalLatencyMarkdown(latency: LightningEvalLatencyReport): string {
  const out: string[] = [];
  const num = (x: number | null, digits = 1) => (x === null ? '-' : x.toFixed(digits));
  out.push(
    `Subject decide wall-clock pooled per variant (deadline mode ${latency.deadlineMode}; execution deadline ${
      latency.executionDeadlineMs ?? '-'
    } ms). Compute only, in process: misses are a lower bound on production. Percentiles are 1%-wide histogram upper edges; ratio = candidate / baseline; G4 holds when the p95 and p99 ratios are both at most 1.10. Not in the digest.`
  );
  out.push('');
  out.push(
    '| variant | cells | arm | decisions | p50 ms | p95 ms | p99 ms | max ms | over caller deadline | over execution deadline | over deadline (share %) | caller deadline ms (min-max) | applied fallbacks |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const f of latency.figures)
    for (const [label, p] of [
      ['baseline', f.baseline],
      ['candidate', f.candidate],
    ] as const)
      out.push(
        `| ${f.variant} | ${f.cells} | ${label} | ${p.decisions} | ${num(p.p50Ms, 2)} | ${num(
          p.p95Ms,
          2
        )} | ${num(p.p99Ms, 2)} | ${num(p.maxMs, 2)} | ${p.overCallerDeadline} | ${
          p.overExecutionDeadline
        } | ${p.overDeadline} (${num(p.overDeadlineSharePct, 3)}) | ${p.minCallerDeadlineMs ?? '-'}-${
          p.maxCallerDeadlineMs ?? '-'
        } | ${p.appliedFallbacks} |`
      );
  out.push('');
  out.push(
    '| variant | ratio p50 | ratio p95 | ratio p99 | ratio over-deadline share | G4 (p95 and p99 within 10%) |'
  );
  out.push('|---|---|---|---|---|---|');
  for (const f of latency.figures)
    out.push(
      `| ${f.variant} | ${num(f.ratio.p50, 3)} | ${num(f.ratio.p95, 3)} | ${num(f.ratio.p99, 3)} | ${num(
        f.ratio.overDeadlineShare,
        3
      )} | ${f.g4WithinTenPercent === null ? '-' : f.g4WithinTenPercent ? 'holds' : 'FAILS'} |`
    );
  out.push('');
  return out.join('\n');
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
    tableJackpotFeeBBPer100: r(a.tableJackpotFeeBBPer100),
    subjectRakeBBPer100: r(a.subjectRakeBBPer100),
    subjectRakeShareBBPer100: r(a.subjectRakeShareBBPer100),
    subjectJackpotFeeShareBBPer100: r(a.subjectJackpotFeeShareBBPer100),
    dryStreak: lightningEvalDryStreak(a.dryStreak),
    q3: lightningEvalQ3(a.total),
    q3ByPosition: Object.fromEntries(
      Object.keys(a.byPosition)
        .sort()
        .map((k) => [k, lightningEvalQ3(a.byPosition[k]!)])
    ),
    counters: a.counters,
  };
}

export type LightningEvalArmPlayer = (input: {
  cell: LightningEvalCell;
  arm: LightningEvalArmSpec;
  hands: number;
  seed: number;
  baselineDecideOpts: Record<string, unknown>;
  /**
   * `measure` (default): the production deadline is counted, never applied.
   * `apply`: a Horse decision (any Horse seat) whose compute exceeds it is
   * answered by the host's own liveness path (check, or fold facing a bet),
   * as production answers it. Wall-clock dependent: not reproducible.
   */
  deadlineMode?: 'measure' | 'apply';
  /** Tests and sensitivity reads only: replaces the caller deadline the host passed, ms. */
  deadlineOverrideMs?: number;
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
  /** Half-open cell index range, to share a configuration between processes. */
  cellRange?: readonly [number, number];
  onCell?: (report: LightningEvalCellReport, index: number) => void;
  /** The per-hand paired rows of each cell (the side file; not in the report). */
  onPairs?: (rows: LightningEvalPairRow[], report: LightningEvalCellReport, index: number) => void;
  /** Each cell's latency row (the latency side file, pooled by the merge for G4). */
  onLatency?: (
    row: LightningEvalLatencyRow,
    report: LightningEvalCellReport,
    index: number
  ) => void;
  /** See LightningEvalArmPlayer. Default `measure`. */
  deadlineMode?: 'measure' | 'apply';
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
  const latencyRows: LightningEvalLatencyRow[] = [];
  const apply = input.deadlineMode === 'apply';
  for (const seed of config.seeds)
    for (let i = from; i < Math.min(to, config.cells.length); i++) {
      const cell = config.cells[i]!;
      const common = {
        cell,
        hands: config.handsPerCell,
        seed,
        baselineDecideOpts: { ...config.baselineDecideOpts },
        ...(apply ? { deadlineMode: 'apply' as const } : {}),
      };
      const a = await input.playArm({ ...common, arm: baseline });
      const b = await input.playArm({ ...common, arm: candidate });
      // Pairing: both arms dealt the same stacks, hand for hand.
      for (let k = 0; k < Math.min(a.hands.length, b.hands.length); k++)
        if ((a.hands[k]!.stacksBB ?? []).join(',') !== (b.hands[k]!.stacksBB ?? []).join(','))
          throw new Error(
            `pairing broken: hand ${a.hands[k]!.h} of cell ${i} (seed ${seed}) dealt different stacks in the two arms`
          );
      const report: LightningEvalCellReport = {
        cell,
        seed,
        hands: config.handsPerCell,
        rakeConfig: a.rakeConfig,
        baseline: summarize(a),
        candidate: summarize(b),
        paired: pairLightningEvalArms(cell.players, a, b),
        q4: lightningEvalQ4(a.total, b.total),
        ...(cell.stackMix === 'mixed' ? { stacks: lightningEvalStacksSummary(a, b) } : {}),
        ...(cell.floor && a.pool && b.pool
          ? { pool: { baseline: a.pool, candidate: b.pool } }
          : {}),
        latencyMs: { baseline: a.latencyMs, candidate: b.latencyMs },
      };
      cells.push(report);
      const latencyRow = lightningEvalLatencyRow(cell, seed, a, b);
      latencyRows.push(latencyRow);
      input.onPairs?.(lightningEvalPairRows(cell, seed, a, b), report, i);
      input.onLatency?.(latencyRow, report, i);
      input.onCell?.(report, i);
    }
  const mixed = cells.some((c) => c.cell.stackMix === 'mixed');
  const pooledQuality = (arm: 'baseline' | 'candidate') => {
    const q = emptyPositionStats();
    for (const c of cells) addQuality(q, c[arm].total);
    return q;
  };
  const pooledBaseline = pooledQuality('baseline');
  const pooledCandidate = pooledQuality('candidate');
  const keysSeen = (arm: 'baseline' | 'candidate') =>
    [...new Set(cells.flatMap((c) => c[arm].counters.subjectDecideOptionKeys))].sort();
  const sum = (f: (c: LightningEvalCellReport) => number) => cells.reduce((s, c) => s + f(c), 0);
  const body: Omit<LightningEvalReport, 'digest'> = {
    schema: LIGHTNING_EVAL_SCHEMA,
    config: config.name,
    seedClass: config.seedClass,
    seeds: [...config.seeds],
    handsPerCell: config.handsPerCell,
    ...(config.switchCard ? { switchCard: config.switchCard } : {}),
    ...(apply ? { deadlineMode: 'apply' as const } : {}),
    contract: {
      smallBlind: LIGHTNING_EVAL_SMALL_BLIND,
      bigBlind: LIGHTNING_EVAL_BIG_BLIND,
      bigBlindAnteBB: 1,
      variants: [...new Set(cells.map((c) => c.cell.variant))].sort(),
      players: [...new Set(cells.map((c) => c.cell.players))].sort(),
      stacksBB: [
        ...new Set(cells.filter((c) => c.cell.stackMix !== 'mixed').map((c) => c.cell.stackBB)),
      ].sort((x, y) => x - y),
      ...(mixed ? { mixedStacks: { ...LIGHTNING_EVAL_MIXED_STACKS } } : {}),
      rake: 'engine-computed for the stake (rake_percent and rake_cap_bb unset); the snapshot rakeConfig of each cell is recorded in cells[].rakeConfig. The engine also takes its bad-beat-jackpot fee (settlement field bbj), reported beside the rake as tableJackpotFeeBBPer100',
      newTableEveryHand: true as const,
    },
    definitions: {
      ...LIGHTNING_EVAL_DEFINITIONS,
      ...(mixed ? { stackMix: LIGHTNING_EVAL_STACK_MIX_DEFINITION } : {}),
      ...(cells.some((c) => c.cell.floor) ? { pool: LIGHTNING_EVAL_POOL_DEFINITION } : {}),
      ...(config.switchCard ? { switchCard: LIGHTNING_EVAL_SWITCH_DEFINITION } : {}),
    },
    baselineArm: { name: 'baseline', decideOpts: { ...config.baselineDecideOpts } },
    candidateArm: {
      name: candidate.name,
      decideOptKeys: Object.keys(candidate.decideOpts ?? {}).sort(),
      snapshotPatch: typeof candidate.snapshotPatch === 'function',
      scope: candidate.scope ?? 'hero',
      subjectDecideOptionKeys: keysSeen('candidate'),
      baselineSubjectDecideOptionKeys: keysSeen('baseline'),
    },
    cells,
    pooled: {
      baseline: {
        dryStreak: lightningEvalDryStreak(...cells.map((c) => c.baseline.dryStreak)),
        q3: lightningEvalQ3(pooledBaseline),
      },
      candidate: {
        dryStreak: lightningEvalDryStreak(...cells.map((c) => c.candidate.dryStreak)),
        q3: lightningEvalQ3(pooledCandidate),
      },
      q4: lightningEvalQ4(pooledBaseline, pooledCandidate),
    },
    totals: {
      hands: sum((c) => c.paired.hands),
      illegalActions: sum(
        (c) => c.baseline.counters.illegalActions + c.candidate.counters.illegalActions
      ),
      illegalAmounts: sum(
        (c) => c.baseline.counters.illegalAmounts + c.candidate.counters.illegalAmounts
      ),
      subjectIllegalActions: sum(
        (c) =>
          c.baseline.counters.subjectIllegalActions + c.candidate.counters.subjectIllegalActions
      ),
      subjectIllegalAmounts: sum(
        (c) =>
          c.baseline.counters.subjectIllegalAmounts + c.candidate.counters.subjectIllegalAmounts
      ),
      conservationViolations: sum(
        (c) =>
          c.baseline.counters.conservationViolations + c.candidate.counters.conservationViolations
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
    latency: mergeLightningEvalLatency(latencyRows, apply ? 'apply' : 'measure'),
  };
  return { ...body, digest: lightningEvalDigest(body) };
}

/**
 * sha256 of the report without its wall-clock parts (cells[].latencyMs and
 * the pooled `latency`) and without `digest`.
 */
export function lightningEvalDigest(report: Omit<LightningEvalReport, 'digest'>): string {
  const { latency: _pooledLatency, ...rest } = report;
  const stable = {
    ...rest,
    cells: rest.cells.map(({ latencyMs: _latency, ...cell }) => cell),
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
    }; snapshot patch: ${report.candidateArm.snapshotPatch}; scope ${report.candidateArm.scope}). Option keys HorseLogic.decide received for subject seats: candidate arm ${
      report.candidateArm.subjectDecideOptionKeys.join(', ') || 'none'
    }; baseline arm ${report.candidateArm.baselineSubjectDecideOptionKeys.join(', ') || 'none'}.`
  );
  out.push(
    `Totals: ${report.totals.hands} paired hands; illegal actions ${report.totals.illegalActions}, illegal amounts ${report.totals.illegalAmounts} (all Horse seats; subject seats ${report.totals.subjectIllegalActions} / ${report.totals.subjectIllegalAmounts}), chip-conservation violations ${report.totals.conservationViolations}, policy fallbacks ${report.totals.policyFallbacks}, decide exceptions ${report.totals.decideThrows}, unsettled hands ${report.totals.unsettledHands}, divergent decisions ${report.totals.divergentDecisions}.`
  );
  out.push('');
  out.push(
    '| cell | arm | hands | walks | VPIP % (all / excl. walks) | PFR % | first-in R/L/F | saw flop % | entry strength mean | flop strength mean | bb/100 | table rake bb/100 |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of report.cells) {
    const name = `${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field}${
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
  out.push(
    'Each arm is its own playthrough: the Horses reads accumulate per arm, so after the first divergent hand the opponents of the two arms hold different reads (part of the treatment). Fidelity against production is judged per table size, never a 6-player cell against the pooled production figure.'
  );
  out.push('');
  out.push('## Guards and quality: G7 (entry rate after a dry streak), Q3, Q4');
  out.push('');
  out.push(
    'G7: entry rate over decision hands (walks excluded) against the entry rate in hands that follow 5 or more consecutive non-entries. Q3: share of entering hands in the bottom quartile of the brain own preflop percentile. Q4: share of the VPIP gain (candidate minus baseline) that comes from first-in raises plus priced big-blind defence.'
  );
  out.push('');
  out.push(
    '| cell | arm | G7 overall entry % (entries / opportunities) | G7 after >=5 non-entries % (entries / hands; dry streaks) | Q3 bottom-quartile share of entries % (n) | Q3 mean entry percentile | Q3 bottom-quartile share of flops % (n) | Q4 VPIP gain points | Q4 intended share % | entry kinds FIR/FIL/CC/OL/3B+/BBc/BBr/iso/BBur |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  const num = (x: number | null, digits = 1) => (x === null ? '-' : x.toFixed(digits));
  const qualityRow = (
    name: string,
    label: string,
    g7: LightningEvalDryStreak,
    q3: LightningEvalQ3,
    q4: LightningEvalQ4 | null,
    kinds: Record<LightningEvalEntryKind, number> | null
  ) =>
    `| ${name} | ${label} | ${num(g7.entryRatePct)} (${g7.entries} / ${g7.opportunities}) | ${num(
      g7.entryRateAfterDryStreakPct
    )} (${g7.entriesAfterDryStreak} / ${g7.handsAfterDryStreak}; ${g7.dryStreaks}) | ${num(
      q3.bottomQuartileSharePct
    )} (${q3.entries}) | ${num(q3.meanEntryPercentile, 3)} | ${num(q3.bottomQuartileFlopSharePct)} (${
      q3.sawFlop
    }) | ${q4 ? q4.vpipGainPoints.toFixed(1) : ''} | ${q4 ? num(q4.intendedSharePct) : ''} | ${
      kinds ? LIGHTNING_EVAL_ENTRY_KINDS.map((k) => kinds[k]).join('/') : ''
    } |`;
  for (const c of report.cells) {
    const name = `${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field}${
      (c.cell.villains ?? 1) > 1 ? ' x' + c.cell.villains : ''
    }`;
    out.push(
      qualityRow(
        name,
        'baseline',
        c.baseline.dryStreak,
        c.baseline.q3,
        null,
        c.baseline.total.entryKinds
      )
    );
    out.push(
      qualityRow(
        name,
        'candidate',
        c.candidate.dryStreak,
        c.candidate.q3,
        c.q4,
        c.candidate.total.entryKinds
      )
    );
  }
  out.push(
    qualityRow(
      'POOLED (this report)',
      'baseline',
      report.pooled.baseline.dryStreak,
      report.pooled.baseline.q3,
      null,
      null
    )
  );
  out.push(
    qualityRow(
      'POOLED (this report)',
      'candidate',
      report.pooled.candidate.dryStreak,
      report.pooled.candidate.q3,
      report.pooled.q4,
      null
    )
  );
  out.push('');
  out.push('## Drop: rake and jackpot fee (bb per 100 hands)');
  out.push('');
  out.push(
    '| cell | arm | table rake | table jackpot fee | subject rake, pots won | subject rake, contributed share | subject jackpot fee, contributed share | conservation violations |'
  );
  out.push('|---|---|---|---|---|---|---|---|');
  for (const c of report.cells)
    for (const [label, arm] of [
      ['baseline', c.baseline],
      ['candidate', c.candidate],
    ] as const)
      out.push(
        `| ${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field} | ${label} | ${arm.tableRakeBBPer100.toFixed(
          1
        )} | ${arm.tableJackpotFeeBBPer100.toFixed(1)} | ${arm.subjectRakeBBPer100.toFixed(
          1
        )} | ${arm.subjectRakeShareBBPer100.toFixed(1)} | ${arm.subjectJackpotFeeShareBBPer100.toFixed(
          1
        )} | ${arm.counters.conservationViolations} |`
      );
  out.push('');
  out.push('## By position (candidate arm; VPIP % of hands, first-in raise/limp/fold)');
  out.push('');
  out.push('| cell | UTG | HJ | CO | BTN | SB | BB | BB by price (n: fold/call/raise, early) |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const c of report.cells) {
    const cellName = `${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field}`;
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
  const mixedCells = report.cells.filter((c) => c.stacks);
  if (mixedCells.length) {
    out.push('## Mixed stacks (every seat drawn per hand; bb)');
    out.push('');
    out.push(
      '| cell | seats | seat mean (min-max) | subject hands | subject effective stack mean (min-max) | effective bands 50-99 / 100-149 / 150-200 | engine stack mismatches |'
    );
    out.push('|---|---|---|---|---|---|---|');
    for (const c of mixedCells) {
      const st = c.stacks!;
      out.push(
        `| ${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field} | ${st.seats} | ${st.seatMeanBB.toFixed(
          1
        )} (${st.seatMinBB}-${st.seatMaxBB}) | ${st.subjectHands} | ${
          st.effectiveMeanBB === null ? '-' : st.effectiveMeanBB.toFixed(1)
        } (${st.effectiveMinBB ?? '-'}-${st.effectiveMaxBB ?? '-'}) | ${LIGHTNING_EVAL_EFFECTIVE_STACK_BANDS.map(
          (k) => st.effectiveBands[k] ?? 0
        ).join(' / ')} | ${st.engineStackMismatches} |`
      );
    }
    out.push('');
  }
  out.push('## Decision deadline and G4 (pooled; wall-clock, not in the digest)');
  out.push('');
  out.push(lightningEvalLatencyMarkdown(report.latency));
  out.push('## Decision latency (wall-clock on the measuring machine, ms; not in the digest)');
  out.push('');
  out.push('| cell | arm | n | p50 | p95 | p99 | max | over deadline (caller / execution) |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const c of report.cells)
    for (const [label, l] of [
      ['baseline', c.latencyMs.baseline],
      ['candidate', c.latencyMs.candidate],
    ] as const)
      out.push(
        `| ${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field} | ${label} | ${l.n} | ${l.p50.toFixed(
          1
        )} | ${l.p95.toFixed(1)} | ${l.p99.toFixed(1)} | ${l.max.toFixed(1)} | ${
          l.deadline
            ? `${l.deadline.overDeadline} (${l.deadline.overCallerDeadline} / ${l.deadline.overExecutionDeadline})`
            : '-'
        } |`
      );
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// E1 (2026-11-19): switch cards on production's live base, their own seed class.
// ---------------------------------------------------------------------------

/**
 * The seeds a switch card may deal: 41,900,000 to 41,999,999 (0 hits in the
 * Lightning helper's seed scan of 2026-11-18, swarm/lightning seedscan.txt; the
 * lead re-scans before declaring). Disjoint from the development, selection
 * and final sets, which a switch card can never deal.
 */
export const LIGHTNING_EVAL_SWITCH_SEED_RANGE = Object.freeze({ min: 41_900_000, max: 41_999_999 });

/** What a switch card declared, as its report records it. */
export interface LightningEvalSwitchCardRecord {
  name: string;
  flag: string;
  candidateValue: boolean;
  /** The flag in the base (null: no row, release default). */
  baseValue: boolean | null;
  /** Plumbing keys dropped from the base input (telemetry, mind, observeMind). */
  ignored: readonly string[];
  /** sha256 of the canonical {flag, candidateValue, a, b} (HorseSwitchArms). */
  digest: string;
  scope: 'hero' | 'all_horses';
}

/**
 * A switch card's configuration. `baseline` is production's live switch set,
 * already validated (HorseSwitchArms.horseSwitchArms); both arms run on it,
 * and the candidate arm differs only in `flag` (lightningEvalSwitchCandidate).
 * Replaces the frozen seven style options of 2026-11-14 for this card only;
 * every declared configuration above is unchanged.
 */
export function lightningEvalSwitchConfig(input: {
  record: LightningEvalSwitchCardRecord;
  baseline: Readonly<Record<string, boolean>>;
  seeds: readonly number[];
  handsPerCell: number;
  cells: readonly LightningEvalCell[];
}): LightningEvalConfig {
  if (!input.seeds.length) throw new Error('switch card: no seed');
  for (const seed of input.seeds)
    if (lightningEvalSeedClassOf(seed) !== 'switch')
      throw new Error(
        `switch card: seed ${seed} is outside the switch seed range ${LIGHTNING_EVAL_SWITCH_SEED_RANGE.min}-${LIGHTNING_EVAL_SWITCH_SEED_RANGE.max}`
      );
  if (new Set(input.seeds).size !== input.seeds.length)
    throw new Error('switch card: repeated seed');
  if (!Number.isSafeInteger(input.handsPerCell) || input.handsPerCell < 1)
    throw new Error('switch card: handsPerCell must be a positive integer');
  if (!input.cells.length) throw new Error('switch card: no cell');
  for (const cell of input.cells) {
    if (!(LIGHTNING_EVAL_VARIANTS as readonly string[]).includes(cell.variant))
      throw new Error(`switch card: variant ${cell.variant}`);
    if (!(LIGHTNING_EVAL_PLAYERS as readonly number[]).includes(cell.players))
      throw new Error(`switch card: players ${cell.players}`);
    if (!(LIGHTNING_EVAL_STACKS_BB as readonly number[]).includes(cell.stackBB))
      throw new Error(`switch card: stackBB ${cell.stackBB}`);
    if (!(LIGHTNING_EVAL_FIELDS as readonly string[]).includes(cell.field))
      throw new Error(`switch card: field ${cell.field}`);
    if (cell.floor) lightningEvalFloorValid(cell.floor);
  }
  const { flag } = input.record;
  if (input.record.baseValue !== null && input.baseline[flag] !== input.record.baseValue)
    throw new Error('switch card: the recorded base value is not the baseline value');
  return {
    name: `switch_${input.record.name}`,
    seedClass: 'switch',
    seeds: [...input.seeds],
    handsPerCell: input.handsPerCell,
    cells: input.cells.map((c) => ({ ...c })),
    baselineDecideOpts: { ...input.baseline },
    switchCard: { ...input.record, ignored: [...input.record.ignored] },
  };
}

/** The candidate arm of a switch card: the baseline with `flag` at `value`. */
export function lightningEvalSwitchCandidate(
  record: Pick<LightningEvalSwitchCardRecord, 'flag' | 'candidateValue' | 'scope'>
): LightningEvalArmSpec {
  return {
    name: `${record.flag}=${record.candidateValue ? 'on' : 'off'}`,
    decideOpts: { [record.flag]: record.candidateValue },
    scope: record.scope,
  };
}

// ---------------------------------------------------------------------------
// E2 (2026-11-19): floored pools, one pool session per player, a ledger per arm.
// ---------------------------------------------------------------------------

/** A floored pool's rules, as the game carries them (tables / fn_nit_status). */
export interface LightningEvalFloor {
  /** maintain_percent_min: the VPIP floor, percent (> 0). */
  vpipPct: number;
  /** maintain_hands: hands before the rule may judge (>= 1). */
  windowHands: number;
  /** Dealt hands a warned seat gets to recover in; 0 = booted on the spot (Action / Madness). */
  graceHands: number;
  /** true: the judged figure is the last windowHands hands (Classic); false: the whole sitting. */
  rolling: boolean;
  /**
   * Decision side. false (default): the Horse snapshot is left as production's
   * Lightning host builds it (it carries no floor). true: every Horse decision
   * is handed the table's floor and its own figure from this arm's feed ledger
   * (gs.vpipFloor, gs.vpipWindowHands, gs.ownVpip), as a physical table hands
   * them (ServerTableEngineBase.horseVpipDecisionInputs). Same in both arms.
   */
  feedSnapshot?: boolean;
  /**
   * With feedSnapshot: the feed ledger is cleared every N hands (an in-memory
   * ledger lost at the hourly engine restart). The judge ledger never clears.
   */
  restartEveryHands?: number;
}

export function lightningEvalFloorValid(f: LightningEvalFloor): LightningEvalFloor {
  if (!(Number.isFinite(f.vpipPct) && f.vpipPct > 0 && f.vpipPct <= 100))
    throw new Error('floor: vpipPct must be in (0, 100]');
  if (!Number.isSafeInteger(f.windowHands) || f.windowHands < 1)
    throw new Error('floor: windowHands must be a positive integer');
  if (!Number.isSafeInteger(f.graceHands) || f.graceHands < 0)
    throw new Error('floor: graceHands must be a non-negative integer');
  if (typeof f.rolling !== 'boolean') throw new Error('floor: rolling must be a boolean');
  if (
    f.restartEveryHands !== undefined &&
    (!Number.isSafeInteger(f.restartEveryHands) || f.restartEveryHands < 1)
  )
    throw new Error('floor: restartEveryHands must be a positive integer');
  return f;
}

/** The rules a floored cell adds to the host's table rules (both arms). */
export function lightningEvalFloorRules(
  f: LightningEvalFloor | undefined
): Record<string, unknown> {
  return f
    ? { nit_game: true, maintain_percent_min: f.vpipPct, maintain_hands: f.windowHands }
    : {};
}

/** VPIP milestones reported per pool session. */
export const LIGHTNING_EVAL_POOL_MILESTONES = [10, 30, 100] as const;

export interface LightningEvalPoolSessionReport {
  /** The pool session's player, last six characters (as the hand records). */
  id: string;
  subject: boolean;
  hands: number;
  entered: number;
  /** Cumulative VPIP of the session after 10 / 30 / 100 hands, percent (null: not reached). */
  vpipAtPct: Record<string, number | null>;
  vpipEndPct: number | null;
  /** Hands after which the judged figure was under the floor. */
  handsJudgedBelow: number;
  warnings: number;
  recoveries: number;
  /** Seats the judge would have booted (the session then starts a new sitting). */
  evictions: number;
  sittings: number;
}

export interface LightningEvalPoolArmReport {
  floor: LightningEvalFloor;
  /** Pool sessions seen (one per player). */
  sessions: number;
  subjects: LightningEvalPoolSessionReport[];
  table: { hands: number; warnings: number; evictions: number; handsJudgedBelow: number };
  /** Times the feed ledger was cleared (restartEveryHands). */
  feedClears: number;
}

interface PoolSession {
  hist: boolean[];
  warned: boolean;
  graceLeft: number;
  total: number;
  entered: number;
  at: Record<string, number | null>;
  below: number;
  warnings: number;
  recoveries: number;
  evictions: number;
  sittings: number;
}

/**
 * One arm's pool ledger: per pool session, the dealt hands (walks included, as
 * ca_hand_facts counts them) and voluntary entries, the figure the rule judges
 * (rolling window or whole sitting), and the warn / grace / boot verdicts a
 * floored game would reach. A booted session starts a new sitting (its judged
 * history is emptied); the totals and milestones run on. This models the
 * game's rule for measurement; it is not fn_nit_check.
 */
export class LightningEvalPoolLedger {
  private readonly sessions = new Map<string, PoolSession>();
  constructor(readonly floor: LightningEvalFloor) {
    lightningEvalFloorValid(floor);
  }
  private session(id: string): PoolSession {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        hist: [],
        warned: false,
        graceLeft: 0,
        total: 0,
        entered: 0,
        at: Object.fromEntries(LIGHTNING_EVAL_POOL_MILESTONES.map((m) => [String(m), null])),
        below: 0,
        warnings: 0,
        recoveries: 0,
        evictions: 0,
        sittings: 1,
      };
      this.sessions.set(id, s);
    }
    return s;
  }
  /** The judged figure the session would read now (null VPIP before any hand). */
  figure(id: string): { hands: number; vpip: number | null } {
    const s = this.sessions.get(id);
    if (!s || !s.hist.length) return { hands: 0, vpip: null };
    const judged = this.floor.rolling ? s.hist.slice(-this.floor.windowHands) : s.hist;
    return {
      hands: s.hist.length,
      vpip: (judged.filter(Boolean).length / judged.length) * 100,
    };
  }
  record(id: string, entered: boolean): void {
    const s = this.session(id);
    s.hist.push(entered);
    if (this.floor.rolling && s.hist.length > this.floor.windowHands * 4)
      s.hist.splice(0, s.hist.length - this.floor.windowHands);
    s.total++;
    if (entered) s.entered++;
    for (const m of LIGHTNING_EVAL_POOL_MILESTONES)
      if (s.total === m) s.at[String(m)] = (s.entered / s.total) * 100;
    if (s.hist.length < this.floor.windowHands && !s.warned) return;
    const below = (this.figure(id).vpip ?? 0) < this.floor.vpipPct;
    if (below) s.below++;
    const evict = () => {
      s.evictions++;
      s.sittings++;
      s.hist = [];
      s.warned = false;
      s.graceLeft = 0;
    };
    if (s.warned) {
      if (!below) {
        s.warned = false;
        s.recoveries++;
      } else if (--s.graceLeft <= 0) evict();
      return;
    }
    if (!below) return;
    s.warnings++;
    if (this.floor.graceHands === 0) evict();
    else {
      s.warned = true;
      s.graceLeft = this.floor.graceHands;
    }
  }
  clear(): void {
    this.sessions.clear();
  }
  report(subjectIds: ReadonlySet<string>, idOf: (session: string) => string, feedClears: number) {
    const rows: LightningEvalPoolSessionReport[] = [];
    const table = { hands: 0, warnings: 0, evictions: 0, handsJudgedBelow: 0 };
    for (const [session, s] of [...this.sessions].sort(([a], [b]) => a.localeCompare(b))) {
      table.hands += s.total;
      table.warnings += s.warnings;
      table.evictions += s.evictions;
      table.handsJudgedBelow += s.below;
      const player = idOf(session);
      if (!subjectIds.has(player)) continue;
      rows.push({
        id: player.slice(-6),
        subject: true,
        hands: s.total,
        entered: s.entered,
        vpipAtPct: { ...s.at },
        vpipEndPct: s.total ? (s.entered / s.total) * 100 : null,
        handsJudgedBelow: s.below,
        warnings: s.warnings,
        recoveries: s.recoveries,
        evictions: s.evictions,
        sittings: s.sittings,
      });
    }
    const out: LightningEvalPoolArmReport = {
      floor: { ...this.floor },
      sessions: this.sessions.size,
      subjects: rows,
      table,
      feedClears,
    };
    return out;
  }
}

// ── The files one runner process owns, and what the merge accepts (2026-11-19) ──

/**
 * A runner process that died (out of memory, a kill, a failed check) used to
 * leave `<stem>.pairs.jsonl` holding the cells it had finished: a file the
 * merge could not tell from a result. Now the side files carry `.partial`
 * until the whole cell range has been played and checked, a `.running.json`
 * names the process that owns them, and `<stem>.complete.json` (written last)
 * records what the range must contain. The merge pools completed ranges only,
 * and only when together they are the whole (seed, cell) set.
 */
export const LIGHTNING_EVAL_COMPLETE_SCHEMA = 'lightning-paired-eval-complete/v1';

export interface LightningEvalCompletedFile {
  name: string;
  sha256: string;
  /** Lines, the header included. */
  lines: number;
}

export interface LightningEvalCompletion {
  schema: typeof LIGHTNING_EVAL_COMPLETE_SCHEMA;
  config: string;
  seedClass: string;
  candidate: string;
  candidateDecideOpts: Record<string, unknown>;
  deadlineMode: 'measure' | 'apply';
  seeds: number[];
  handsPerCell: number;
  /** The cells of the whole configuration. */
  configCells: number;
  /** The half-open cell range this process played. */
  cellRange: [number, number];
  /** Every (seed, cell) unit played, in order, with the paired rows it wrote. */
  units: Array<{ seed: number; cell: number; pairs: number }>;
  reportDigest: string;
  files: { pairs: LightningEvalCompletedFile; latency: LightningEvalCompletedFile };
}

export interface LightningEvalRunFiles {
  /** Where the rows go until `complete` (the `.partial` names). */
  pairsFile: string;
  latencyFile: string;
  appendPairs: (seed: number, cell: number, rows: readonly LightningEvalPairRow[]) => void;
  appendLatency: (row: LightningEvalLatencyRow) => void;
  /** The range is played and checked: give the side files their names and write the marker. */
  complete: (
    played: Omit<LightningEvalCompletion, 'schema' | 'units' | 'files'>
  ) => LightningEvalCompletion;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and is someone else's.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function completedFile(path: string): LightningEvalCompletedFile {
  const bytes = readFileSync(path);
  return {
    name: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    lines: bytes.toString('utf8').split('\n').filter(Boolean).length,
  };
}

/**
 * Claims `<stem>` for this process and opens its side files under `.partial`.
 * Refuses, before anything is written: a stem another live process is writing,
 * a stem that already holds a result, and a directory in which ANOTHER range
 * was left unfinished by a process that is gone. The last is what stops a
 * queue: after a crash the next slice fails at once instead of playing on
 * beside a hole.
 */
export function openLightningEvalRunFiles(input: {
  stem: string;
  pairsHeader: Record<string, unknown>;
  latencyHeader: Record<string, unknown>;
  /** Tests only. */
  pid?: number;
  isAlive?: (pid: number) => boolean;
  log?: (message: string) => void;
}): LightningEvalRunFiles {
  const { stem } = input;
  const dir = dirname(stem);
  const pid = input.pid ?? process.pid;
  const isAlive = input.isAlive ?? processIsAlive;
  const log = input.log ?? ((message: string) => console.warn(message));
  mkdirSync(dir, { recursive: true });
  const runningFile = `${stem}.running.json`;
  const completeFile = `${stem}.complete.json`;
  const pairsFinal = `${stem}.pairs.jsonl`;
  const latencyFinal = `${stem}.latency.jsonl`;
  const pairsFile = `${pairsFinal}.partial`;
  const latencyFile = `${latencyFinal}.partial`;
  for (const done of [completeFile, pairsFinal, latencyFinal])
    if (existsSync(done))
      throw new Error(
        `Lightning paired evaluation: ${done} already holds a result. Move it away before playing this range again.`
      );
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.running.json')) continue;
    const path = join(dir, name);
    let owner: number;
    try {
      owner = Number((JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }).pid);
    } catch {
      owner = Number.NaN;
    }
    const alive = Number.isInteger(owner) && owner !== pid && isAlive(owner);
    if (path === runningFile) {
      if (alive)
        throw new Error(
          `Lightning paired evaluation: process ${owner} is already playing ${stem}. Two processes on one range would write into each other's rows.`
        );
      log(
        `[lightning-eval] ${stem}: replacing the unfinished rows of a run that is gone (process ${owner})`
      );
      for (const stale of [runningFile, pairsFile, latencyFile]) rmSync(stale, { force: true });
    } else if (!alive)
      throw new Error(
        `Lightning paired evaluation: STOP. ${name} was left by process ${owner}, which is gone: that range crashed or failed and its rows are incomplete. Play it again (it replaces its own .partial files) or delete its .running.json and .partial files; no further range starts in ${dir} until then.`
      );
  }
  try {
    writeFileSync(runningFile, JSON.stringify({ pid, stem: basename(stem) }) + '\n', {
      flag: 'wx',
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(`Lightning paired evaluation: another process just claimed ${stem}.`);
    throw err;
  }
  writeFileSync(latencyFile, JSON.stringify(input.latencyHeader) + '\n');
  writeFileSync(pairsFile, JSON.stringify(input.pairsHeader) + '\n');
  const units: LightningEvalCompletion['units'] = [];
  return {
    pairsFile,
    latencyFile,
    appendPairs(seed, cell, rows) {
      units.push({ seed, cell, pairs: rows.length });
      if (rows.length)
        appendFileSync(pairsFile, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    },
    appendLatency(row) {
      appendFileSync(latencyFile, JSON.stringify(row) + '\n');
    },
    complete(played) {
      // Checked before any rename: a range that is not whole keeps .partial.
      lightningEvalCheckCompletion(
        { schema: LIGHTNING_EVAL_COMPLETE_SCHEMA, ...played, units },
        basename(stem)
      );
      renameSync(pairsFile, pairsFinal);
      renameSync(latencyFile, latencyFinal);
      const completion: LightningEvalCompletion = {
        schema: LIGHTNING_EVAL_COMPLETE_SCHEMA,
        ...played,
        units,
        files: { pairs: completedFile(pairsFinal), latency: completedFile(latencyFinal) },
      };
      writeFileSync(`${completeFile}.tmp`, JSON.stringify(completion, null, 1) + '\n');
      renameSync(`${completeFile}.tmp`, completeFile);
      rmSync(runningFile, { force: true });
      return completion;
    },
  };
}

/** A marker names every (seed, cell) of its range, once, in the order played. */
function lightningEvalCheckCompletion(
  c: Omit<LightningEvalCompletion, 'files'>,
  name: string
): void {
  if (c.schema !== LIGHTNING_EVAL_COMPLETE_SCHEMA)
    throw new Error(
      `${name}: schema ${String(c.schema)}, expected ${LIGHTNING_EVAL_COMPLETE_SCHEMA}`
    );
  const [from, to] = c.cellRange;
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < to))
    throw new Error(`${name}: cell range ${from}:${to} holds no cell`);
  if (to > c.configCells)
    throw new Error(`${name}: cell range ${from}:${to} is outside the ${c.configCells} cells`);
  const expected: string[] = [];
  for (const seed of c.seeds)
    for (let cell = from; cell < to; cell++) expected.push(`${seed}/${cell}`);
  const played = c.units.map((u) => `${u.seed}/${u.cell}`);
  const missing = expected.filter((unit) => !played.includes(unit));
  if (missing.length)
    throw new Error(
      `${name}: incomplete, ${missing.length} of ${expected.length} (seed/cell) units were not played: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`
    );
  if (played.join(' ') !== expected.join(' '))
    throw new Error(`${name}: its (seed/cell) units are not the declared range, once each`);
}

/**
 * The completed ranges of a directory, or an error naming what is missing.
 * Refused: an unfinished range (`.partial`, `.running.json`), side files with
 * no marker (a run that never finished, or one older than the marker), side
 * files whose bytes are not the ones the marker recorded, ranges of different
 * runs, a cell played twice, and any (seed, cell) of the configuration that no
 * range holds.
 */
export function lightningEvalCompletedRuns(dir: string): {
  completions: LightningEvalCompletion[];
  pairsFiles: string[];
  latencyFiles: string[];
} {
  const names = readdirSync(dir).sort();
  const unfinished = names.filter((n) => n.endsWith('.partial') || n.endsWith('.running.json'));
  if (unfinished.length)
    throw new Error(
      `${dir} holds an unfinished range (still running, crashed or failed): ${unfinished.join(', ')}. Nothing is merged until every range is complete.`
    );
  const markers = names.filter((n) => n.endsWith('.complete.json'));
  const stems = new Set(markers.map((n) => n.slice(0, -'.complete.json'.length)));
  for (const n of names) {
    const side = ['.pairs.jsonl', '.latency.jsonl'].find((suffix) => n.endsWith(suffix));
    if (side && !stems.has(n.slice(0, -side.length)))
      throw new Error(
        `${dir}/${n} has no ${n.slice(0, -side.length)}.complete.json: the run that wrote it did not finish (or predates the completion marker), so its rows are not a result.`
      );
  }
  if (!markers.length) throw new Error(`no completed range (*.complete.json) in ${dir}`);
  const completions = markers.map((name) => {
    const c = JSON.parse(readFileSync(join(dir, name), 'utf8')) as LightningEvalCompletion;
    lightningEvalCheckCompletion(c, name);
    for (const file of [c.files.pairs, c.files.latency]) {
      if (!names.includes(file.name)) throw new Error(`${name}: ${file.name} is missing`);
      const now = completedFile(join(dir, file.name));
      if (now.sha256 !== file.sha256 || now.lines !== file.lines)
        throw new Error(
          `${name}: ${file.name} is not the file the run completed (${now.lines} lines, ${file.lines} recorded): it was truncated or written to afterwards.`
        );
    }
    const rows = c.units.reduce((n, u) => n + u.pairs, 0);
    if (c.files.pairs.lines !== rows + 1)
      throw new Error(
        `${name}: ${c.files.pairs.name} has ${c.files.pairs.lines - 1} rows, its units wrote ${rows}`
      );
    return c;
  });
  const run = (c: LightningEvalCompletion) =>
    JSON.stringify([
      c.config,
      c.seedClass,
      c.candidate,
      c.candidateDecideOpts,
      c.deadlineMode,
      c.seeds,
      c.handsPerCell,
      c.configCells,
    ]);
  const first = completions[0]!;
  for (const c of completions)
    if (run(c) !== run(first))
      throw new Error(
        `${dir} holds ranges of more than one run (configuration, candidate, deadline mode, seeds, hands per cell or cell count differ): ${first.files.pairs.name} and ${c.files.pairs.name}`
      );
  const ordered = [...completions].sort((a, b) => a.cellRange[0] - b.cellRange[0]);
  const absent: string[] = [];
  let next = 0;
  for (const c of ordered) {
    const [from, to] = c.cellRange;
    if (from < next)
      throw new Error(
        `${dir}: cell ${from} was played by more than one range (${c.files.pairs.name})`
      );
    if (from > next) absent.push(from - next === 1 ? `${next}` : `${next} to ${from - 1}`);
    next = to;
  }
  if (next < first.configCells)
    absent.push(first.configCells - next === 1 ? `${next}` : `${next} to ${first.configCells - 1}`);
  if (absent.length)
    throw new Error(
      `${dir} is incomplete: cells ${absent.join(', ')} of ${first.configCells} are missing for seeds ${first.seeds.join(', ')}. The merge needs every (seed, cell) of the configuration.`
    );
  return {
    completions: ordered,
    // By name, the order the merge has always read them in.
    pairsFiles: ordered.map((c) => c.files.pairs.name).sort(),
    latencyFiles: ordered.map((c) => c.files.latency.name).sort(),
  };
}
