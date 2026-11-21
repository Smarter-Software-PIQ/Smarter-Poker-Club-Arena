/**
 * THE PAIRED LIGHTNING EVALUATION HARNESS: its pin and its runner (2026-11-14).
 *
 * 1. The pin (always runs, small): two arms that differ in nothing make the
 *    SAME decisions hand for hand on the real LightningHandHost, in hold'em
 *    and in Omaha, with a scripted opponent and without one. That is what
 *    makes a later difference between two arms a property of the candidate.
 *    It also pins that the candidate's options reach the subject seat's
 *    decide call, the report schema (v2), chip conservation, and the guards
 *    the report carries (G7 dry streaks, Q3, Q4, entry kinds, pooled G5 / P1).
 *    A positive control (an option known to change decisions) proves a real
 *    candidate moves the subject seat and only the subject seat.
 *    The declared smoke, full, selection and final configurations are pinned
 *    byte for byte; mixed stacks (an opt-in cell dimension) pair, stay in the
 *    declared range, reach the engine and are recorded per subject hand; the
 *    production decision deadline is counted (and, opt-in, applied).
 * 2. The runner (only when LIGHTNING_EVAL_CONFIG is set): plays the declared
 *    smoke or full configuration and writes the report and the per-hand
 *    paired side file. The merge (only when LIGHTNING_EVAL_MERGE is set) pools
 *    side files. See LIGHTNING-PAIRED-EVAL-README.md.
 *
 * Measurement plumbing: no database, no production caller.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { horseDecisionDeadlineMs } from '../engine/horseDecision/decisionDeadline.js';
import { horseSwitchArms } from '../benchmark/HorseSwitchArms.js';
import {
  LIGHTNING_EVAL_BB_PRICE_BUCKETS,
  LIGHTNING_EVAL_DEFINITIONS,
  LIGHTNING_EVAL_DEV_MIXED,
  LIGHTNING_EVAL_DEV_MIXED_SMOKE,
  LIGHTNING_EVAL_LATENCY_SCHEMA,
  LIGHTNING_EVAL_MIXED_STACKS,
  addLightningEvalLatency,
  emptyDeadlineCounts,
  lightningEvalCellKey,
  lightningEvalCompletedRuns,
  lightningEvalDeadlineMiss,
  lightningEvalEffectiveStackBB,
  lightningEvalHistogramPercentile,
  lightningEvalLatencyBin,
  lightningEvalLatencyBinUpperMs,
  lightningEvalLatencyMarkdown,
  lightningEvalMix,
  lightningEvalMixedStacksBB,
  lightningEvalPairRows,
  lightningEvalStacksBB,
  mergeLightningEvalLatency,
  pairLightningEvalArms,
  recordLightningEvalDeadline,
  type LightningEvalCell,
  type LightningEvalLatencyArmRow,
  type LightningEvalLatencyRow,
  LIGHTNING_EVAL_ENTRY_KINDS,
  LIGHTNING_EVAL_FIELDS,
  LIGHTNING_EVAL_FULL,
  LIGHTNING_EVAL_PAIRS_SCHEMA,
  LIGHTNING_EVAL_SCHEMA,
  LIGHTNING_EVAL_SEEDS,
  LIGHTNING_EVAL_SELECTION,
  LIGHTNING_EVAL_FINAL,
  LIGHTNING_EVAL_STAGE_HANDS_PER_CELL,
  LIGHTNING_EVAL_SMOKE,
  LIGHTNING_EVAL_SWITCH_SEED_RANGE,
  LightningEvalPoolLedger,
  lightningEvalFloorRules,
  lightningEvalSwitchCandidate,
  lightningEvalSwitchConfig,
  type LightningEvalSwitchCardRecord,
  classifyLightningEntry,
  createLightningDryStreakTracker,
  emptyPositionStats,
  lightningEvalConservationGap,
  lightningEvalDigest,
  lightningEvalDryStreak,
  lightningEvalIsPreflopRaise,
  lightningEvalMarkdown,
  lightningEvalMergeMarkdown,
  lightningEvalPosition,
  lightningEvalQ3,
  lightningEvalQ4,
  lightningEvalSeedClassOf,
  lightningEvalRunnerTimeoutMs,
  lightningEvalStackLabel,
  mergeLightningEvalPairs,
  openLightningEvalRunFiles,
  runLightningPairedEval,
  type LightningEvalArmPlayer,
  type LightningEvalArmSpec,
  type LightningEvalConfig,
  type LightningEvalPairRow,
} from './LightningPairedEval.test-support.js';
import {
  lightningEvalRegisteredMocks,
  openLightningEvalFixtureScope,
} from './LightningPairedEvalRelease.test-support.js';

/** The seeded deck: the engine's own Fisher-Yates on a fixed stream. */
const deck = { state: 1 };
/** fastRandom of the module graph the current arm plays on (see playArm). */
const armGraph: { fastRandom: () => number } = { fastRandom: () => 0 };

/**
 * One arm on a FRESH module graph. The equity caches are module state: a
 * warm cache changes how many random draws a decision consumes, so two arms
 * are comparable only when each starts cold.
 */
const playArm: LightningEvalArmPlayer = async (input) => {
  // D10: the mocks this arm's module factories and hands build leave the
  // process-wide registries with the arm, so its module graph can be collected.
  const fixtures = openLightningEvalFixtureScope();
  try {
    return await playArmOnFreshGraph(input);
  } finally {
    fixtures.release();
  }
};
const playArmOnFreshGraph: LightningEvalArmPlayer = async (input) => {
  vi.resetModules();
  vi.doMock('../services/supabase/client.js', () => ({
    supabase: {
      from: vi.fn(() => {
        throw Error('Unexpected database access in the Lightning paired evaluation');
      }),
      rpc: vi.fn(() => {
        throw Error('Unexpected database RPC in the Lightning paired evaluation');
      }),
    },
    maintenanceSupabase: {},
  }));
  vi.doMock('../services/errorReporter.js', () => ({
    // NOT a vi.fn (D10): a mock keeps every call's arguments, and the host
    // reports one Error per hand here ("Lightning original journal identity
    // unavailable", there is no database). Each Error's captured stack frames
    // hold the hand's host, so a recording mock kept every hand of the arm
    // alive: about 0.6 MB per hand, the whole heap inside one 2,200-hand cell.
    reportError: () => {},
    describeError: String,
  }));
  vi.doMock('../engine/CryptoRandom.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../engine/CryptoRandom.js')>();
    return {
      ...real,
      secureShuffle<T>(array: T[]): void {
        for (let i = array.length - 1; i > 0; i--) {
          deck.state ^= deck.state << 13;
          deck.state ^= deck.state >>> 17;
          deck.state ^= deck.state << 5;
          const j = (deck.state >>> 0) % (i + 1);
          [array[i], array[j]] = [array[j]!, array[i]!];
        }
      },
    };
  });
  const { playLightningEvalArm } = await import('./LightningPairedEvalArm.test-support.js');
  armGraph.fastRandom = (await import('../engine/HorseEval.js')).fastRandom;
  return playLightningEvalArm({
    ...input,
    setDeckState: (state) => {
      deck.state = state >>> 0 || 1;
    },
  });
};

/** The worker's resident set and heap, for the per-cell line (D10 is read from it). */
function lightningEvalProcessMemory(): string {
  const m = process.memoryUsage();
  const mb = (bytes: number) => Math.round(bytes / 1048576);
  return `rss ${mb(m.rss)} MB, heap used ${mb(m.heapUsed)} MB`;
}

/** A candidate that changes nothing the brain reads. */
const NULL_CANDIDATE: LightningEvalArmSpec = {
  name: 'null',
  // An option name no decision code reads: proves the candidate's options are
  // the ones handed to the subject seat without changing any decision.
  decideOpts: { lightningEvalNullProbe: true },
};

describe('the paired Lightning evaluation harness', () => {
  it('names positions from the Lightning seat map and keeps its seed classes apart', () => {
    expect([1, 2, 3, 4, 5, 6].map((s) => lightningEvalPosition(s, 6))).toEqual([
      'SB',
      'BB',
      'UTG',
      'HJ',
      'CO',
      'BTN',
    ]);
    expect([1, 2, 3, 4, 5].map((s) => lightningEvalPosition(s, 5))).toEqual([
      'SB',
      'BB',
      'HJ',
      'CO',
      'BTN',
    ]);
    expect([1, 2, 3, 4].map((s) => lightningEvalPosition(s, 4))).toEqual(['SB', 'BB', 'CO', 'BTN']);
    const all = [
      ...LIGHTNING_EVAL_SEEDS.development,
      ...LIGHTNING_EVAL_SEEDS.selection,
      ...LIGHTNING_EVAL_SEEDS.final,
    ];
    expect(new Set(all).size).toBe(all.length);
    for (const config of [
      LIGHTNING_EVAL_SMOKE,
      LIGHTNING_EVAL_FULL,
      LIGHTNING_EVAL_DEV_MIXED,
      LIGHTNING_EVAL_DEV_MIXED_SMOKE,
    ])
      for (const seed of config.seeds) expect(lightningEvalSeedClassOf(seed)).toBe('development');
    // The staged configurations deal only their own class, on the declared matrix.
    for (const config of [LIGHTNING_EVAL_SELECTION, LIGHTNING_EVAL_FINAL]) {
      for (const seed of config.seeds)
        expect(lightningEvalSeedClassOf(seed)).toBe(config.seedClass);
      expect(config.cells.length).toBe(LIGHTNING_EVAL_FULL.cells.length);
      expect(config.handsPerCell).toBe(LIGHTNING_EVAL_STAGE_HANDS_PER_CELL);
    }
    // The declared full matrix: every variant, table size, stack and field.
    expect(LIGHTNING_EVAL_FULL.cells.length).toBe(3 * 3 * 3 * (LIGHTNING_EVAL_FIELDS.length + 1));
    expect(new Set(LIGHTNING_EVAL_SMOKE.cells.map((c) => c.variant)).size).toBe(3);
    expect(new Set(LIGHTNING_EVAL_SMOKE.cells.map((c) => c.players)).size).toBe(3);
    expect(new Set(LIGHTNING_EVAL_SMOKE.cells.map((c) => c.stackBB)).size).toBe(3);
    expect(LIGHTNING_EVAL_SMOKE.cells.some((c) => c.counterExploit)).toBe(true);
  });

  it('refuses a seed outside the configuration class', async () => {
    await expect(
      runLightningPairedEval({
        config: { ...LIGHTNING_EVAL_SMOKE, seeds: [LIGHTNING_EVAL_SEEDS.final[0]!] },
        candidate: NULL_CANDIDATE,
        playArm: async () => {
          throw new Error('must not deal');
        },
      })
    ).rejects.toThrow(/is final, the configuration is development/);
  });

  it('refuses arms that dealt different stacks on the same hand (#11050 N2)', async () => {
    const config: LightningEvalConfig = {
      name: 'pairing-check',
      seedClass: 'development',
      seeds: [LIGHTNING_EVAL_SEEDS.development[0]!],
      handsPerCell: 2,
      cells: [{ variant: 'nlh', players: 4, stackBB: 100, stackMix: 'mixed', field: 'all_horse' }],
      baselineDecideOpts: {},
    };
    let armIdx = 0;
    await expect(
      runLightningPairedEval({
        config,
        candidate: NULL_CANDIDATE,
        playArm: async (input) => {
          const played = await playArm(input);
          if (armIdx++ === 1 && played.hands.length > 0) {
            const first = played.hands[0]!;
            played.hands[0] = {
              ...first,
              stacksBB: (first.stacksBB ?? [100, 100, 100, 100]).map((s, j) =>
                j === 0 ? s + 1 : s
              ),
            };
          }
          return played;
        },
      })
    ).rejects.toThrow(/pairing broken: hand 0 of cell 0 .* dealt different stacks/);
  });

  it('classifies every entry once, and an all-in is a raise only when it is a full raise (D5, D9)', () => {
    const a = (userId: string, action: string, isFullRaise?: boolean) => ({
      userId,
      action,
      ...(isFullRaise === undefined ? {} : { isFullRaise }),
    });
    const fold = (u: string) => a(u, 'fold');
    // Seat 2 is the big blind; any other seat is "not the big blind".
    expect(classifyLightningEntry([fold('u'), a('me', 'raise')], 'me', 4)).toBe('firstInRaise');
    expect(classifyLightningEntry([fold('u'), a('me', 'call')], 'me', 1)).toBe('firstInLimp');
    expect(classifyLightningEntry([a('u', 'call'), a('me', 'call')], 'me', 5)).toBe('overLimp');
    expect(classifyLightningEntry([a('u', 'call'), a('me', 'raise')], 'me', 5)).toBe('isoRaise');
    expect(classifyLightningEntry([a('u', 'raise'), a('me', 'call')], 'me', 5)).toBe('coldCall');
    expect(classifyLightningEntry([a('u', 'raise'), a('me', 'raise')], 'me', 5)).toBe(
      'threeBetPlus'
    );
    expect(classifyLightningEntry([a('u', 'raise'), a('me', 'call')], 'me', 2)).toBe(
      'bigBlindCall'
    );
    expect(classifyLightningEntry([a('u', 'raise'), a('me', 'raise')], 'me', 2)).toBe(
      'bigBlindRaise'
    );
    expect(classifyLightningEntry([a('u', 'call'), a('me', 'raise')], 'me', 2)).toBe(
      'bigBlindUnpricedRaise'
    );
    // The kind is set by the FIRST entering action: a big blind that checked
    // its option and later called a raise defended at a price.
    expect(
      classifyLightningEntry(
        [a('u', 'call'), a('me', 'check'), a('v', 'raise'), a('u', 'fold'), a('me', 'call')],
        'me',
        2
      )
    ).toBe('bigBlindCall');
    expect(
      classifyLightningEntry(
        [a('u', 'call'), a('me', 'call'), a('v', 'raise'), a('me', 'call')],
        'me',
        5
      )
    ).toBe('overLimp');
    // No entry: a fold, a big-blind check, a seat that never acted.
    expect(classifyLightningEntry([a('u', 'raise'), fold('me')], 'me', 5)).toBeNull();
    expect(classifyLightningEntry([a('u', 'call'), a('me', 'check')], 'me', 2)).toBeNull();
    expect(classifyLightningEntry([a('u', 'raise')], 'me', 2)).toBeNull();
    // D9: an all-in is a raise only when the engine says isFullRaise === true.
    expect(lightningEvalIsPreflopRaise(a('me', 'all_in', true))).toBe(true);
    expect(lightningEvalIsPreflopRaise(a('me', 'all_in', false))).toBe(false);
    expect(lightningEvalIsPreflopRaise(a('me', 'all_in'))).toBe(false);
    expect(lightningEvalIsPreflopRaise(a('me', 'raise'))).toBe(true);
    expect(lightningEvalIsPreflopRaise(a('me', 'call'))).toBe(false);
    // An all-in call of a raise is a cold call, not a 3-bet.
    expect(classifyLightningEntry([a('u', 'raise'), a('me', 'all_in')], 'me', 5)).toBe('coldCall');
    expect(classifyLightningEntry([a('u', 'raise'), a('me', 'all_in', true)], 'me', 5)).toBe(
      'threeBetPlus'
    );
  });

  it('reads the entry rate after five or more consecutive non-entries (G7)', () => {
    const t = createLightningDryStreakTracker();
    // e = entry, p = pass (non-entry), w = walk (no decision: left out).
    // Sequence: e p p p p p | p e | p p w p p p | e p
    // After the fifth pass the streak is dry: the hands that follow it are
    // "p" (non-entry) and then "e" (entry), which ends it. Then five passes
    // with a walk between them (the walk neither counts nor breaks the run),
    // and the next hand "e" follows a dry streak again; the last "p" does not.
    for (const x of 'epppppp' + 'e' + 'ppwppp' + 'ep') t.record('hero', x === 'e', x === 'w');
    // A second subject keeps its own sequence.
    for (const x of 'pppp') t.record('other', x === 'e', false);
    expect(t.counts).toEqual({
      opportunities: 15 + 4,
      entries: 3,
      handsAfterDryStreak: 3,
      entriesAfterDryStreak: 2,
      dryStreaks: 2,
    });
    const g7 = lightningEvalDryStreak(t.counts);
    expect(g7.entryRatePct).toBeCloseTo((3 / 19) * 100, 2);
    expect(g7.entryRateAfterDryStreakPct).toBeCloseTo((2 / 3) * 100, 2);
    expect(lightningEvalDryStreak().entryRateAfterDryStreakPct).toBeNull();
  });

  it('reports Q3 and Q4 directly from the entry counts (D5)', () => {
    const baseline = emptyPositionStats();
    baseline.hands = 100;
    baseline.vpip = 20;
    baseline.entryStrengthBins = [1, 3, 6, 10];
    baseline.entryStrengthSum = 14;
    baseline.entryKinds.firstInRaise = 10;
    baseline.entryKinds.coldCall = 10;
    const candidate = emptyPositionStats();
    candidate.hands = 100;
    candidate.vpip = 40;
    candidate.entryStrengthBins = [12, 8, 8, 12];
    candidate.entryStrengthSum = 20;
    candidate.entryKinds.firstInRaise = 15;
    candidate.entryKinds.bigBlindCall = 5;
    candidate.entryKinds.coldCall = 12;
    candidate.entryKinds.firstInLimp = 8;
    expect(lightningEvalQ3(baseline)).toMatchObject({
      entries: 20,
      bottomQuartileEntries: 1,
      bottomQuartileSharePct: 5,
      meanEntryPercentile: 0.7,
      bottomQuartileFlopSharePct: null,
    });
    expect(lightningEvalQ3(candidate).bottomQuartileSharePct).toBe(30);
    const q4 = lightningEvalQ4(baseline, candidate);
    // +20 points of VPIP: +5 first-in raises and +5 priced big-blind calls
    // are the intended sources (half); +2 cold calls and +8 limps are not.
    expect(q4.vpipGainPoints).toBe(20);
    expect(q4.intendedGainPoints).toBe(10);
    expect(q4.intendedSharePct).toBe(50);
    expect(q4.gainPointsByKind).toMatchObject({
      firstInRaise: 5,
      bigBlindCall: 5,
      coldCall: 2,
      firstInLimp: 8,
      threeBetPlus: 0,
    });
    // No gain: the share is undefined, not a division by zero.
    expect(lightningEvalQ4(baseline, baseline).intendedSharePct).toBeNull();
  });

  it('counts a hand whose chips do not add up (N2)', () => {
    // 30 contributed = 26.1 won + 2.9 rake + 1 jackpot fee.
    const results = [
      { won: 26.1, contributed: 14 },
      { won: 0, contributed: 14 },
      { won: 0, contributed: 2 },
    ];
    expect(Math.abs(lightningEvalConservationGap(results, 2.9, 1))).toBeLessThan(0.005);
    // Forgetting the fee, or a chip created at settlement, is a violation.
    expect(Math.abs(lightningEvalConservationGap(results, 2.9, 0))).toBeGreaterThan(0.005);
    expect(
      lightningEvalConservationGap([{ won: 27.1, contributed: 14 }, ...results.slice(1)], 2.9, 1)
    ).toBeCloseTo(1, 6);
  });

  it('pools paired hands across cells and seeds, and uses the larger standard error (D2, G5, P1)', () => {
    const rows: LightningEvalPairRow[] = [];
    const cell = (
      field: LightningEvalPairRow['field'],
      players: number,
      hands: number,
      counterExploit: boolean,
      diff: (h: number) => number,
      seed = 20261114
    ) => {
      for (let h = 0; h < hands; h++)
        rows.push({
          seed,
          variant: 'nlh',
          players,
          stackBB: 100,
          field,
          villains: field === 'all_horse' ? 0 : 1,
          counterExploit,
          h,
          b: -1,
          c: -1 + diff(h),
        });
    };
    // Primary: all_horse (6 players, 12 hands, +2 / 0 alternating) and unknown
    // on another seed (4 players, 8 hands, +1 every hand). Mean +1 bb a hand.
    cell('all_horse', 6, 12, false, (h) => (h % 2 === 0 ? 2 : 0));
    cell('unknown', 4, 8, false, () => 1, 20261115);
    // Counter-exploit: two orbits of four, +1 a hand then -1 a hand. Mean 0;
    // the hands are not independent, so the orbit-block error is the larger.
    cell('tag_regular', 4, 8, true, (h) => (h < 4 ? 1 : -1));
    const merged = mergeLightningEvalPairs(rows);
    expect(merged.hands).toBe(28);
    expect(merged.cells).toBe(3);
    expect(merged.seeds).toEqual([20261114, 20261115]);
    expect(merged.figures.map((f) => `${f.variant}|${f.group}`)).toEqual([
      'nlh|primary',
      'nlh|counter_exploit',
      'nlh|field:all_horse',
      'nlh|field:tag_regular',
      'nlh|field:unknown',
    ]);
    const primary = merged.figures[0]!;
    expect(primary).toMatchObject({ hands: 20, cells: 2, seeds: [20261114, 20261115] });
    expect(primary.diffBB100).toBe(100);
    expect(primary.baselineBB100).toBe(-100);
    expect(primary.candidateBB100).toBe(0);
    // sd of 12 values at +-1 around the mean and 8 at the mean, over sqrt(20).
    const se = (Math.sqrt(12 / 19) / Math.sqrt(20)) * 100;
    expect(primary.seBB100).toBeCloseTo(se, 2);
    expect(primary.blockSeBB100).toBe(0);
    expect(primary.seUsedBB100).toBeCloseTo(se, 2);
    expect(primary.z).toBeCloseTo(100 / se, 2);
    const counter = merged.figures[1]!;
    expect(counter.hands).toBe(8);
    expect(counter.diffBB100).toBe(0);
    expect(counter.seBB100).toBeCloseTo((Math.sqrt(8 / 7) / Math.sqrt(8)) * 100, 2);
    expect(counter.blockSeBB100).toBe(100);
    expect(counter.seUsedBB100).toBe(100);
    expect(counter.z).toBe(0);
    expect(lightningEvalMergeMarkdown(merged)).toContain('| nlh | primary | 20 | 2 |');
    // Two files that overlap must not count a hand twice.
    expect(() => mergeLightningEvalPairs([...rows, rows[0]!])).toThrow(/met twice/);
  });

  it('a null candidate makes zero divergent decisions, and the report has its schema', async () => {
    const config: LightningEvalConfig = {
      name: 'pin',
      seedClass: 'development',
      seeds: [LIGHTNING_EVAL_SEEDS.development[0]!],
      handsPerCell: 12,
      cells: [
        { variant: 'nlh', players: 6, stackBB: 100, field: 'all_horse' },
        { variant: 'plo4', players: 4, stackBB: 50, field: 'tag_regular', counterExploit: true },
      ],
      baselineDecideOpts: {},
    };
    const pairs: LightningEvalPairRow[] = [];
    const report = await runLightningPairedEval({
      config,
      candidate: NULL_CANDIDATE,
      playArm,
      onPairs: (rows) => void pairs.push(...rows),
    });

    // The per-hand paired rows: one per settled hand, equal in both arms.
    expect(pairs).toHaveLength(24);
    for (const row of pairs) expect(row.c).toBe(row.b);
    expect(pairs[0]).toMatchObject({
      seed: LIGHTNING_EVAL_SEEDS.development[0],
      variant: 'nlh',
      players: 6,
      stackBB: 100,
      field: 'all_horse',
      villains: 0,
      counterExploit: false,
      h: 0,
    });
    expect(pairs[23]).toMatchObject({ field: 'tag_regular', counterExploit: true, h: 11 });
    expect(mergeLightningEvalPairs(pairs).figures.every((f) => f.diffBB100 === 0)).toBe(true);

    // Pairing: identical decisions and identical accepted actions in every hand.
    expect(report.cells).toHaveLength(2);
    for (const cell of report.cells) {
      expect(cell.paired.divergentDecisions).toBe(0);
      expect(cell.paired.divergentHands).toBe(0);
      expect(cell.paired.divergentAcceptedHands).toBe(0);
      expect(cell.paired.diffBB100).toBe(0);
      expect(cell.paired.hands).toBe(12);
      expect(cell.candidate.total).toEqual(cell.baseline.total);
      // The contract: a big-blind ante (the button is the last seat), the
      // engine's own rake, legal decisions only, every hand settled.
      for (const arm of [cell.baseline, cell.candidate]) {
        expect(arm.counters.buttonMismatch).toBe(0);
        expect(arm.counters.illegalActions).toBe(0);
        expect(arm.counters.illegalAmounts).toBe(0);
        expect(arm.counters.subjectIllegalActions).toBe(0);
        expect(arm.counters.subjectIllegalAmounts).toBe(0);
        // Legality is counted on every Horse seat, not on the subject alone.
        expect(arm.counters.decisions).toBeGreaterThan(arm.counters.subjectDecisions);
        expect(arm.counters.decideThrows).toBe(0);
        expect(arm.counters.unsettledHands).toBe(0);
        expect(arm.counters.subjectDecisions).toBeGreaterThan(0);
        expect(arm.total.hands).toBe(12);
        // N2: sum(won) + rake + jackpot fee = sum(contributed), every hand.
        expect(arm.counters.conservationViolations).toBe(0);
        // D6: the jackpot fee is reported beside the rake; the per-seat rake
        // share is a share of the table rake.
        expect(arm.tableRakeBBPer100).toBeGreaterThan(0);
        expect(arm.tableJackpotFeeBBPer100).toBeGreaterThan(0);
        expect(arm.subjectRakeShareBBPer100).toBeGreaterThan(0);
        expect(arm.subjectRakeShareBBPer100).toBeLessThan(arm.tableRakeBBPer100);
        expect(arm.subjectJackpotFeeShareBBPer100).toBeLessThan(arm.tableJackpotFeeBBPer100);
        // D5: every entry has exactly one kind, in total and by position.
        for (const stats of [arm.total, ...Object.values(arm.byPosition)])
          expect(LIGHTNING_EVAL_ENTRY_KINDS.reduce((s, k) => s + stats.entryKinds[k], 0)).toBe(
            stats.vpip
          );
        expect(arm.q3.entries).toBe(arm.total.vpip);
        // G7: every dealt hand that is not a walk is one opportunity.
        expect(arm.dryStreak.opportunities).toBe(arm.total.hands - arm.total.walks);
        expect(arm.dryStreak.entries).toBe(arm.total.vpip);
        expect(arm.dryStreak.handsAfterDryStreak).toBeGreaterThanOrEqual(
          arm.dryStreak.entriesAfterDryStreak
        );
        // N1: what HorseLogic.decide really received, subject and not.
        expect(arm.counters.subjectDecideOptionKeys).toEqual(
          expect.arrayContaining(['decisionTimeMs', 'phase13EvidenceMode', 'telemetry'])
        );
        expect(arm.counters.nonSubjectDecideOptionKeys).not.toContain('lightningEvalNullProbe');
      }
      expect(cell.candidate.counters.subjectDecideOptionKeys).toContain('lightningEvalNullProbe');
      expect(cell.baseline.counters.subjectDecideOptionKeys).not.toContain(
        'lightningEvalNullProbe'
      );
      expect(cell.candidate.dryStreak).toEqual(cell.baseline.dryStreak);
      expect(cell.q4.vpipGainPoints).toBe(0);
      expect(cell.q4.intendedSharePct).toBeNull();
      expect(cell.paired.subjectDivergentDecisions).toBe(0);
      expect(cell.paired.firstDivergenceBySubject).toBeNull();
      expect(cell.paired.preSubjectNonSubjectCompared).toBeGreaterThan(0);
      expect(cell.paired.preSubjectNonSubjectDivergent).toBe(0);
      expect(cell.rakeConfig).toMatchObject({ noFlopNoDrop: true });
      expect(Number((cell.rakeConfig as { percent: number }).percent)).toBeGreaterThan(0);
      // The candidate's options are the ones its subject seat decided on.
      expect(cell.candidate.counters.armOptionKeysSeen).toEqual(['lightningEvalNullProbe']);
      expect(cell.baseline.counters.armOptionKeysSeen).toEqual([]);
      // The hero rotated through every position of the table.
      expect(Object.keys(cell.baseline.byPosition).length).toBe(cell.cell.players);
    }

    // Schema.
    expect(report.schema).toBe(LIGHTNING_EVAL_SCHEMA);
    expect(Object.keys(report).sort()).toEqual(
      [
        'baselineArm',
        'candidateArm',
        'cells',
        'config',
        'contract',
        'definitions',
        'digest',
        'handsPerCell',
        'pooled',
        'schema',
        'latency',
        'seedClass',
        'seeds',
        'totals',
      ].sort()
    );
    // A uniform report carries none of the mixed-stack keys (its digest is unchanged).
    expect(report.contract).not.toHaveProperty('mixedStacks');
    expect(report.definitions).toEqual(LIGHTNING_EVAL_DEFINITIONS);
    expect(report.cells.every((c) => !('stacks' in c))).toBe(true);
    expect(report).not.toHaveProperty('deadlineMode');
    // The production deadline: counted for every subject decision, never applied.
    expect(report.latency.schema).toBe(LIGHTNING_EVAL_LATENCY_SCHEMA);
    expect(report.latency.deadlineMode).toBe('measure');
    expect(report.latency.executionDeadlineMs).toBe(8000);
    expect(report.latency.figures.map((f) => f.variant)).toEqual(['nlh', 'plo4', 'all']);
    for (const cell of report.cells)
      for (const l of [cell.latencyMs.baseline, cell.latencyMs.candidate]) {
        expect(l.deadline.decisions).toBe(l.n);
        expect(l.deadline.appliedFallbacks).toBe(0);
        // The host passed the turn clock's deadline: 15 s less the 1,500 ms margin.
        expect(l.deadline.minCallerDeadlineMs).toBe(13500);
        expect(l.deadline.maxCallerDeadlineMs).toBe(13500);
      }
    const all = report.latency.figures.at(-1)!;
    expect(all.baseline.decisions).toBe(
      report.cells.reduce((s, c) => s + c.latencyMs.baseline.n, 0)
    );
    expect(report.schema).toBe('lightning-paired-eval/v2');
    expect(Object.keys(report.cells[0]!).sort()).toEqual(
      [
        'baseline',
        'candidate',
        'cell',
        'hands',
        'latencyMs',
        'paired',
        'q4',
        'rakeConfig',
        'seed',
      ].sort()
    );
    expect(Object.keys(report.cells[0]!.baseline).sort()).toEqual(
      [
        'arm',
        'byPosition',
        'counters',
        'dryStreak',
        'q3',
        'q3ByPosition',
        'scope',
        'subjectJackpotFeeShareBBPer100',
        'subjectRakeBBPer100',
        'subjectRakeShareBBPer100',
        'tableJackpotFeeBBPer100',
        'tableRakeBBPer100',
        'total',
      ].sort()
    );
    expect(Object.keys(report.totals).sort()).toEqual(
      [
        'conservationViolations',
        'decideThrows',
        'divergentDecisions',
        'hands',
        'illegalActions',
        'illegalAmounts',
        'policyFallbacks',
        'subjectIllegalActions',
        'subjectIllegalAmounts',
        'unsettledHands',
      ].sort()
    );
    expect(report.totals.conservationViolations).toBe(0);
    // Pooled over the report's cells: the cells' counts, added.
    expect(report.pooled.baseline.dryStreak.opportunities).toBe(
      report.cells.reduce((s, c) => s + c.baseline.dryStreak.opportunities, 0)
    );
    expect(report.pooled.candidate.q3.entries).toBe(
      report.cells.reduce((s, c) => s + c.candidate.total.vpip, 0)
    );
    expect(report.pooled.q4.vpipGainPoints).toBe(0);
    expect(report.candidateArm.subjectDecideOptionKeys).toContain('lightningEvalNullProbe');
    expect(report.candidateArm.baselineSubjectDecideOptionKeys).not.toContain(
      'lightningEvalNullProbe'
    );
    expect(Object.keys(report.cells[0]!.baseline.total).sort()).toEqual(
      [
        'bigBlindByPrice',
        'entryKinds',
        'entryStrengthBins',
        'entryStrengthSum',
        'fastFolds',
        'firstInFold',
        'firstInLimp',
        'firstInOpportunities',
        'firstInRaise',
        'flopStrengthBins',
        'flopStrengthSum',
        'hands',
        'netBB',
        'pfr',
        'sawFlop',
        'vpip',
        'walks',
      ].sort()
    );
    expect(Object.keys(report.cells[0]!.paired).sort()).toEqual(
      [
        'baselineBB100',
        'blockSeBB100',
        'candidateBB100',
        'diffBB100',
        'divergentAcceptedHands',
        'divergentDecisions',
        'divergentHands',
        'firstDivergenceBySubject',
        'firstDivergentHand',
        'hands',
        'preSubjectNonSubjectCompared',
        'preSubjectNonSubjectDivergent',
        'seBB100',
        'subjectDivergentDecisions',
      ].sort()
    );
    for (const key of Object.keys(report.cells[0]!.baseline.total.bigBlindByPrice))
      expect(LIGHTNING_EVAL_BB_PRICE_BUCKETS as readonly string[]).toContain(key);
    expect(report.totals.illegalActions).toBe(0);
    expect(report.totals.divergentDecisions).toBe(0);
    const { digest, ...body } = report;
    expect(digest).toBe(lightningEvalDigest(body));
    // The pin's digest, printed so a harness change can show it unchanged.
    console.log(`[lightning-eval-pin] digest ${digest}`);
    const markdown = lightningEvalMarkdown(report);
    expect(markdown).toContain('| cell | arm | hands |');
    expect(markdown).toContain('## Guards and quality: G7');
    expect(markdown).toContain('chip-conservation violations 0');
    expect(markdown).toContain('table jackpot fee');
    expect(markdown).toContain('reads accumulate per arm');
  }, 420_000);

  it('keeps the declared smoke, full, selection and final configurations byte for byte, and declares the mixed-stack development configurations', () => {
    const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    // Hashed before the mixed-stack and deadline change (base e04fd91baaa).
    expect({
      smoke: sha(LIGHTNING_EVAL_SMOKE),
      full: sha(LIGHTNING_EVAL_FULL),
      selection: sha(LIGHTNING_EVAL_SELECTION),
      final: sha(LIGHTNING_EVAL_FINAL),
      definitions: sha(LIGHTNING_EVAL_DEFINITIONS),
      seeds: sha(LIGHTNING_EVAL_SEEDS),
    }).toEqual({
      smoke: '1af7645f70191ec81bfb462262b865d8abb179619063aa6a6cb4d0b369dbc6cd',
      full: '96e13ec5713ecc099c10a12ed2a803158417d5997c132ce812d030e996d285ed',
      selection: '9b8b87bbd1c65f06aad174856adfb108ac81f1437e9acc6a5caa37e8a76b796f',
      final: 'a02455f35c810b3eb8f8976b09f2c28817b7e445f97ab745e1fe0557398e382d',
      definitions: 'ceeab559bd4b5399c343781e8b20a71ec71ca23f8655af06ba6709f009468fa2',
      seeds: 'deb5a1bd77a4503a66912a32a15352105f05aab56d1764c0eaa1d68d89009dc7',
    });
    for (const config of [
      LIGHTNING_EVAL_SMOKE,
      LIGHTNING_EVAL_FULL,
      LIGHTNING_EVAL_SELECTION,
      LIGHTNING_EVAL_FINAL,
    ])
      for (const cell of config.cells) expect(cell).not.toHaveProperty('stackMix');
    // The cell key is the arithmetic the arm has always used.
    const before = (seed: number, cell: LightningEvalCell) => {
      const n = cell.players;
      const villains = cell.field === 'all_horse' ? 0 : Math.min(cell.villains ?? 1, n - 1);
      return lightningEvalMix(
        seed,
        cell.variant.length * 131 + n * 17 + cell.stackBB,
        cell.field.length * 7919 + cell.field.charCodeAt(0) * 31 + villains
      );
    };
    for (const seed of LIGHTNING_EVAL_SEEDS.development)
      for (const cell of LIGHTNING_EVAL_FULL.cells) {
        expect(lightningEvalCellKey(seed, cell)).toBe(before(seed, cell));
        // A mixed cell deals the cards, seats and dice of its uniform twin.
        expect(lightningEvalCellKey(seed, { ...cell, stackMix: 'mixed' })).toBe(before(seed, cell));
      }
    // dev_mixed: the declared matrix with the stack dimension replaced by the mixed draw.
    expect(LIGHTNING_EVAL_DEV_MIXED.cells).toHaveLength(3 * 3 * (LIGHTNING_EVAL_FIELDS.length + 1));
    expect(LIGHTNING_EVAL_DEV_MIXED.cells.every((c) => c.stackMix === 'mixed')).toBe(true);
    expect(LIGHTNING_EVAL_DEV_MIXED.seedClass).toBe('development');
    expect(
      new Set(
        LIGHTNING_EVAL_DEV_MIXED.cells.map(
          (c) => `${c.variant}|${c.players}|${c.field}|${c.villains ?? 1}`
        )
      ).size
    ).toBe(LIGHTNING_EVAL_DEV_MIXED.cells.length);
    // dev_mixed_smoke: the six smoke cells, mixed; a few hundred hands on seed 20261114.
    expect(LIGHTNING_EVAL_DEV_MIXED_SMOKE.cells.map(({ stackMix: _m, ...c }) => c)).toEqual(
      LIGHTNING_EVAL_SMOKE.cells
    );
    expect(LIGHTNING_EVAL_DEV_MIXED_SMOKE.cells.every((c) => c.stackMix === 'mixed')).toBe(true);
    expect(LIGHTNING_EVAL_DEV_MIXED_SMOKE.seeds).toEqual([20261114]);
    expect(
      LIGHTNING_EVAL_DEV_MIXED_SMOKE.cells.length * LIGHTNING_EVAL_DEV_MIXED_SMOKE.handsPerCell
    ).toBeLessThan(500);
  });

  it('deals mixed stacks from the declared distribution, per hand and seat, and reads the effective stack', () => {
    expect(LIGHTNING_EVAL_MIXED_STACKS).toMatchObject({ minBB: 50, maxBB: 200 });
    const cell = LIGHTNING_EVAL_DEV_MIXED_SMOKE.cells[0]!;
    const key = lightningEvalCellKey(20261114, cell);
    const all: number[] = [];
    let unequalTables = 0;
    for (let h = 0; h < 2000; h++) {
      const stacks = lightningEvalMixedStacksBB(key, h, 6);
      // A function of (cell, hand) only: the two arms of a pair draw the same.
      expect(lightningEvalMixedStacksBB(key, h, 6)).toEqual(stacks);
      expect(lightningEvalStacksBB(cell, key, h)).toEqual(stacks);
      expect(stacks).toHaveLength(6);
      for (const x of stacks) {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(50);
        expect(x).toBeLessThanOrEqual(200);
      }
      if (new Set(stacks).size > 1) unequalTables++;
      all.push(...stacks);
    }
    expect(unequalTables).toBe(2000);
    expect(Math.min(...all)).toBe(50);
    expect(Math.max(...all)).toBe(200);
    // Uniform on 151 whole depths: mean 125, sd 43.6, 12,000 draws (se 0.4).
    const mean = all.reduce((s, x) => s + x, 0) / all.length;
    expect(mean).toBeGreaterThan(123);
    expect(mean).toBeLessThan(127);
    for (const [lo, hi] of [
      [50, 99],
      [100, 149],
      [150, 200],
    ] as const) {
      const share = all.filter((x) => x >= lo && x <= hi).length / all.length;
      expect(share).toBeGreaterThan(0.3);
      expect(share).toBeLessThan(0.37);
    }
    // Another cell (or seed) draws other stacks; a uniform cell is its depth everywhere.
    expect(lightningEvalMixedStacksBB(lightningEvalCellKey(20261115, cell), 0, 6)).not.toEqual(
      lightningEvalMixedStacksBB(key, 0, 6)
    );
    const uniform = LIGHTNING_EVAL_SMOKE.cells[2]!;
    expect(lightningEvalStacksBB(uniform, lightningEvalCellKey(20261114, uniform), 7)).toEqual(
      Array.from({ length: uniform.players }, () => uniform.stackBB)
    );
    // Effective stack: min(own, deepest other), before blinds and antes.
    expect(lightningEvalEffectiveStackBB([80, 150, 60, 200], 0)).toBe(80);
    expect(lightningEvalEffectiveStackBB([80, 150, 60, 200], 3)).toBe(150);
    expect(lightningEvalEffectiveStackBB([80, 150, 60, 200], 1)).toBe(150);
    expect(lightningEvalEffectiveStackBB([100, 100, 100], 2)).toBe(100);
  });

  it('counts decisions past the production deadline and pools them per variant for G4', () => {
    // The production numbers: the 15 s Lightning clock less the engine's margin.
    expect(horseDecisionDeadlineMs({ actionTimeSeconds: 15, elapsedMs: 0 })).toBe(13500);
    // The client's rule: the request's deadline, or its jobTimeoutMs when absent or invalid.
    expect(lightningEvalDeadlineMiss(100, 13500, 8000)).toEqual({
      callerDeadlineMs: 13500,
      overCaller: false,
      overExecution: false,
      over: false,
    });
    expect(lightningEvalDeadlineMiss(9000, 13500, 8000)).toEqual({
      callerDeadlineMs: 13500,
      overCaller: false,
      overExecution: true,
      over: true,
    });
    expect(lightningEvalDeadlineMiss(2500, 2000.7, 8000)).toEqual({
      callerDeadlineMs: 2000,
      overCaller: true,
      overExecution: false,
      over: true,
    });
    for (const bad of [undefined, null, -1, 0, Number.NaN, '13500'])
      expect(lightningEvalDeadlineMiss(5000, bad, 8000).callerDeadlineMs).toBe(8000);
    const counts = emptyDeadlineCounts(8000);
    for (const [ms, req] of [
      [9000, 13500],
      [100, 13500],
      [14000, 13500],
      [3000, 2500],
    ] as const)
      recordLightningEvalDeadline(counts, lightningEvalDeadlineMiss(ms, req, 8000));
    expect(counts).toEqual({
      decisions: 4,
      overCallerDeadline: 2,
      overExecutionDeadline: 2,
      overDeadline: 3,
      minCallerDeadlineMs: 2500,
      maxCallerDeadlineMs: 13500,
      executionDeadlineMs: 8000,
      appliedFallbacks: 0,
    });
    // The histogram: a bin's upper edge is never below the value, at most 1% above.
    for (const ms of [0.0004, 0.004, 0.37, 1, 12.5, 999, 13499]) {
      const up = lightningEvalLatencyBinUpperMs(lightningEvalLatencyBin(ms));
      expect(up).toBeGreaterThanOrEqual(Math.max(ms, 0.001) * (1 - 1e-9));
      expect(up / Math.max(ms, 0.001)).toBeLessThan(1.0101);
    }
    const sample = (scale: number) => {
      const histogram: Record<string, number> = {};
      for (let i = 1; i <= 100; i++) addLightningEvalLatency(histogram, i * scale);
      return histogram;
    };
    // p95 of 1..100 ms is the 96th value (the per-cell convention), at bin resolution.
    const p95 = lightningEvalHistogramPercentile(sample(1), 0.95)!;
    expect(p95).toBeGreaterThanOrEqual(96);
    expect(p95).toBeLessThan(96 * 1.0101);
    expect(lightningEvalHistogramPercentile({}, 0.5)).toBeNull();
    const arm = (scale: number, over: number): LightningEvalLatencyArmRow => ({
      histogram: sample(scale),
      maxMs: 100 * scale,
      deadline: {
        ...emptyDeadlineCounts(8000),
        decisions: 100,
        overExecutionDeadline: over,
        overDeadline: over,
        minCallerDeadlineMs: 13500,
        maxCallerDeadlineMs: 13500,
      },
    });
    const row = (
      variant: LightningEvalLatencyRow['variant'],
      seed: number,
      baseline: LightningEvalLatencyArmRow,
      candidate: LightningEvalLatencyArmRow
    ): LightningEvalLatencyRow => ({
      seed,
      variant,
      players: 6,
      stackBB: 100,
      field: 'all_horse',
      villains: 0,
      baseline,
      candidate,
    });
    // NLH: the candidate decides twice as slowly and misses three times as often;
    // PLO4 (two seeds): no difference.
    const rows = [
      row('nlh', 20261114, arm(1, 1), arm(2, 3)),
      row('plo4', 20261114, arm(1, 0), arm(1, 0)),
      row('plo4', 20261115, arm(1, 0), arm(1, 0)),
    ];
    const merged = mergeLightningEvalLatency(rows);
    expect(merged.executionDeadlineMs).toBe(8000);
    expect(merged.figures.map((f) => [f.variant, f.cells])).toEqual([
      ['nlh', 1],
      ['plo4', 2],
      ['all', 3],
    ]);
    const [nlh, plo4, pooled] = merged.figures;
    expect(nlh!.ratio.p95).toBeGreaterThan(1.97);
    expect(nlh!.ratio.p95).toBeLessThan(2.03);
    expect(nlh!.ratio.overDeadlineShare).toBe(3);
    expect(nlh!.baseline.overDeadlineSharePct).toBe(1);
    expect(nlh!.candidate.overDeadlineSharePct).toBe(3);
    expect(nlh!.candidate.maxMs).toBe(200);
    expect(nlh!.g4WithinTenPercent).toBe(false);
    expect(plo4!.ratio).toEqual({ p50: 1, p95: 1, p99: 1, overDeadlineShare: null });
    expect(plo4!.g4WithinTenPercent).toBe(true);
    expect(plo4!.seeds).toEqual([20261114, 20261115]);
    expect(pooled!.baseline.decisions).toBe(300);
    expect(pooled!.candidate.overDeadline).toBe(3);
    expect(lightningEvalLatencyMarkdown(merged)).toContain('| nlh | 1 | baseline | 100 |');
    // A cell met twice (overlapping files) is refused, as in the paired merge.
    expect(() => mergeLightningEvalLatency([...rows, rows[0]!])).toThrow(/met twice/);
  });

  it('mixed stacks: both arms deal the same stacks, the engine receives them, and every subject hand records its effective stack', async () => {
    const cell: LightningEvalCell = {
      variant: 'nlh',
      players: 6,
      stackBB: 100,
      field: 'all_horse',
      stackMix: 'mixed',
    };
    const common = { cell, hands: 12, seed: 20261114, baselineDecideOpts: {} };
    const a = await playArm({ ...common, arm: { name: 'baseline' } });
    const b = await playArm({ ...common, arm: NULL_CANDIDATE });
    const key = lightningEvalCellKey(20261114, cell);
    const slotOf = (seat: number) => (seat === 2 ? 0 : seat === 1 ? 1 : seat - 1);
    expect(a.hands).toHaveLength(12);
    for (const [i, hand] of a.hands.entries()) {
      // Dealt from the declared draw, identical in both arms.
      expect(hand.stacksBB).toEqual(lightningEvalMixedStacksBB(key, hand.h, 6));
      expect(b.hands[i]!.stacksBB).toEqual(hand.stacksBB);
      expect(hand.settled).toBe(true);
      // The engine settled every seat from the stack it was dealt.
      expect(hand.engineStackMismatches).toBe(0);
      expect(b.hands[i]!.engineStackMismatches).toBe(0);
      expect(hand.subjects).toHaveLength(1);
      for (const s of hand.subjects) {
        const slot = slotOf(s.seat);
        expect(s.stackBB).toBe(hand.stacksBB[slot]);
        expect(s.effectiveStackBB).toBe(lightningEvalEffectiveStackBB(hand.stacksBB, slot));
      }
    }
    expect(a.hands.every((h) => new Set(h.stacksBB).size > 1)).toBe(true);
    // The paired side file carries them.
    const rows = lightningEvalPairRows(cell, 20261114, a, b);
    expect(rows).toHaveLength(12);
    rows.forEach((row, i) =>
      expect(row).toMatchObject({
        stackMix: 'mixed',
        heroStackBB: a.hands[i]!.subjects[0]!.stackBB,
        effectiveStackBB: a.hands[i]!.subjects[0]!.effectiveStackBB,
      })
    );
    // Pairing holds on mixed stacks: a null candidate changes nothing.
    const paired = pairLightningEvalArms(6, a, b);
    expect(paired.divergentDecisions).toBe(0);
    expect(paired.divergentAcceptedHands).toBe(0);
    for (const arm of [a, b]) {
      expect(arm.counters.illegalActions).toBe(0);
      expect(arm.counters.illegalAmounts).toBe(0);
      expect(arm.counters.conservationViolations).toBe(0);
      expect(arm.counters.unsettledHands).toBe(0);
    }
    // The uniform twin deals the same cards with every seat at 100 bb: the
    // dimension is really used (other stacks, other play).
    const { stackMix: _mix, ...twin } = cell;
    const u = await playArm({ ...common, cell: twin, arm: { name: 'baseline' } });
    for (const hand of u.hands) {
      expect(hand.stacksBB).toEqual([100, 100, 100, 100, 100, 100]);
      expect(hand.engineStackMismatches).toBe(0);
    }
    expect(u.hands.some((h, i) => h.accepted.join(';') !== a.hands[i]!.accepted.join(';'))).toBe(
      true
    );
  }, 420_000);

  it('apply mode: a decision past the deadline gets the host its own liveness answer, check or fold (opt-in)', async () => {
    const cell: LightningEvalCell = {
      variant: 'nlh',
      players: 4,
      stackBB: 100,
      field: 'all_horse',
    };
    const common = {
      cell,
      hands: 6,
      seed: 20261114,
      baselineDecideOpts: {},
      arm: { name: 'baseline' },
    };
    const measured = await playArm(common);
    expect(measured.latencyMs.deadline).toMatchObject({
      decisions: measured.latencyMs.n,
      executionDeadlineMs: 8000,
      appliedFallbacks: 0,
    });
    // Every decision misses a 0 ms deadline: every Horse seat gets the host's answer.
    const applied = await playArm({ ...common, deadlineMode: 'apply', deadlineOverrideMs: 0 });
    expect(applied.latencyMs.deadline.decisions).toBeGreaterThan(0);
    expect(applied.latencyMs.deadline.overDeadline).toBe(applied.latencyMs.deadline.decisions);
    expect(applied.latencyMs.deadline.appliedFallbacks).toBe(applied.counters.decisions);
    expect(applied.total.vpip).toBe(0);
    for (const hand of applied.hands) {
      expect(hand.settled).toBe(true);
      for (const d of hand.decisions) expect(d).toMatch(/\|deadline_fallback\|$/);
      for (const a of hand.accepted) expect(a.split('|')[2]).toMatch(/^(fold|check)$/);
    }
    for (const arm of [measured, applied]) {
      expect(arm.counters.illegalActions).toBe(0);
      expect(arm.counters.conservationViolations).toBe(0);
      expect(arm.counters.unsettledHands).toBe(0);
    }
  }, 420_000);

  it('positive control: an option known to change decisions moves the subject, and only the subject starts it (N1)', async () => {
    const config: LightningEvalConfig = {
      name: 'positive-control',
      seedClass: 'development',
      seeds: [LIGHTNING_EVAL_SEEDS.development[0]!],
      handsPerCell: 24,
      // The smoke cell in which {"v8": false} is known to change the subject's
      // decisions (hand 12, development seed 20261114).
      cells: [
        {
          variant: 'plo5',
          players: 6,
          stackBB: 50,
          field: 'three_bet_heavy',
          villains: 2,
          counterExploit: true,
        },
      ],
      baselineDecideOpts: { ...LIGHTNING_EVAL_SMOKE.baselineDecideOpts },
    };
    const report = await runLightningPairedEval({
      config,
      candidate: { name: 'v8-off', decideOpts: { v8: false } },
      playArm,
    });
    const cell = report.cells[0]!;
    // The option reached HorseLogic.decide on the subject seat, and on no other.
    expect(cell.candidate.counters.subjectDecideOptionKeys).toContain('v8');
    expect(cell.candidate.counters.nonSubjectDecideOptionKeys).not.toContain('v8');
    expect(cell.baseline.counters.subjectDecideOptionKeys).not.toContain('v8');
    expect(report.candidateArm.subjectDecideOptionKeys).toContain('v8');
    // It changed what the subject decided.
    expect(cell.paired.divergentDecisions).toBeGreaterThan(0);
    expect(cell.paired.subjectDivergentDecisions).toBeGreaterThan(0);
    // Until the first divergent hand both arms hold the same reads: the first
    // decision that differs is the subject's own, and every other Horse's
    // decision made before the subject had decided anything is identical.
    expect(cell.paired.firstDivergentHand).not.toBeNull();
    expect(cell.paired.firstDivergenceBySubject).toBe(true);
    expect(cell.paired.preSubjectNonSubjectCompared).toBeGreaterThan(0);
    expect(cell.paired.preSubjectNonSubjectDivergent).toBe(0);
    for (const arm of [cell.baseline, cell.candidate]) {
      expect(arm.counters.illegalActions).toBe(0);
      expect(arm.counters.illegalAmounts).toBe(0);
      expect(arm.counters.conservationViolations).toBe(0);
      expect(arm.counters.unsettledHands).toBe(0);
    }
  }, 420_000);

  it('a subject that draws more random numbers does not re-roll any seat (D4)', async () => {
    const config: LightningEvalConfig = {
      name: 'draws',
      seedClass: 'development',
      seeds: [LIGHTNING_EVAL_SEEDS.development[0]!],
      handsPerCell: 12,
      cells: [{ variant: 'plo4', players: 6, stackBB: 100, field: 'all_horse' }],
      baselineDecideOpts: {},
    };
    let draws = 0;
    const report = await runLightningPairedEval({
      config,
      // Changes nothing the brain reads, but consumes three numbers of the
      // shared fast-random stream every time the subject is asked. Every Horse
      // decision draws from its own (hand, seat, decision index) stream, so
      // nobody's jitter moves: not the subject's, not a later seat's.
      candidate: {
        name: 'extra-draws',
        snapshotPatch: (snapshot) => {
          for (let i = 0; i < 3; i++) armGraph.fastRandom();
          draws += 3;
          return snapshot;
        },
      },
      playArm,
    });
    const cell = report.cells[0]!;
    expect(draws).toBeGreaterThan(0);
    expect(cell.paired.divergentDecisions).toBe(0);
    expect(cell.paired.divergentAcceptedHands).toBe(0);
    expect(cell.paired.diffBB100).toBe(0);
  }, 420_000);
});

/**
 * E1 (switch cards on the live base, their own seed class) and E2 (floored
 * pools: rules, one pool session per player, a ledger per arm), 2026-11-19.
 */
const SWITCH_BASE = {
  styleRaiseRespect: true,
  styleFoldBluff: true,
  omahaFacingBetEv: true,
  omahaSmallBetIsPriced: true,
  v8: true,
};
function switchConfigFor(
  flag: string,
  cells: LightningEvalCell[],
  hands: number,
  base: Record<string, unknown> = SWITCH_BASE
) {
  const arms = horseSwitchArms(base, flag);
  const record: LightningEvalSwitchCardRecord = {
    name: `unit_${flag}`,
    flag,
    candidateValue: arms.candidateValue,
    baseValue: arms.baseValue ?? null,
    ignored: arms.ignored,
    digest: arms.digest,
    scope: 'hero',
  };
  return {
    record,
    config: lightningEvalSwitchConfig({
      record,
      baseline: arms.b,
      seeds: [LIGHTNING_EVAL_SWITCH_SEED_RANGE.min + 1],
      handsPerCell: hands,
      cells,
    }),
  };
}

describe('Lightning harness E1 and E2', () => {
  it('E1: the switch seed class is its own, and a switch card refuses any other seed', () => {
    const { min, max } = LIGHTNING_EVAL_SWITCH_SEED_RANGE;
    expect(lightningEvalSeedClassOf(min)).toBe('switch');
    expect(lightningEvalSeedClassOf(max)).toBe('switch');
    expect(lightningEvalSeedClassOf(min - 1)).toBeNull();
    for (const cls of ['development', 'selection', 'final'] as const)
      for (const seed of LIGHTNING_EVAL_SEEDS[cls]) {
        expect(lightningEvalSeedClassOf(seed)).toBe(cls);
        expect(() =>
          lightningEvalSwitchConfig({
            record: switchConfigFor(
              'v8',
              [{ variant: 'nlh', players: 4, stackBB: 100, field: 'all_horse' }],
              1
            ).record,
            baseline: SWITCH_BASE,
            seeds: [seed],
            handsPerCell: 1,
            cells: [{ variant: 'nlh', players: 4, stackBB: 100, field: 'all_horse' }],
          })
        ).toThrow(/outside the switch seed range/);
      }
  });

  it('E1: both arms run on the live base, not the 2026-11-14 style options, and differ only in the flag', async () => {
    const { config, record } = switchConfigFor(
      'v8',
      [{ variant: 'plo5', players: 4, stackBB: 50, field: 'all_horse' }],
      6
    );
    expect(config.baselineDecideOpts).toEqual(
      Object.fromEntries(Object.entries(SWITCH_BASE).sort(([a], [b]) => a.localeCompare(b)))
    );
    const candidate = lightningEvalSwitchCandidate(record);
    expect(candidate.decideOpts).toEqual({ v8: false });
    const report = await runLightningPairedEval({ config, candidate, playArm });
    expect(report.seedClass).toBe('switch');
    expect(report.switchCard).toMatchObject({ flag: 'v8', candidateValue: false, baseValue: true });
    expect(report.definitions.switchCard).toBeDefined();
    expect(report.baselineArm.decideOpts).toEqual(config.baselineDecideOpts);
    const cell = report.cells[0]!;
    for (const arm of [cell.baseline, cell.candidate]) {
      for (const k of Object.keys(SWITCH_BASE)) {
        expect(arm.counters.subjectDecideOptionKeys).toContain(k);
        expect(arm.counters.nonSubjectDecideOptionKeys).toContain(k);
      }
      // The frozen 2026-11-14 style set is not slipped in.
      expect(arm.counters.subjectDecideOptionKeys).not.toContain('styleValueExtraction');
      expect(arm.counters.illegalActions + arm.counters.conservationViolations).toBe(0);
    }
  }, 420_000);

  it('E2: the pool ledger judges a window, a rolling window and grace as a floored game does', () => {
    const whole = new LightningEvalPoolLedger({
      vpipPct: 40,
      windowHands: 10,
      graceHands: 0,
      rolling: false,
    });
    for (let i = 0; i < 9; i++) whole.record('s', false);
    expect(whole.figure('s')).toEqual({ hands: 9, vpip: 0 });
    whole.record('s', false); // hand 10, 0 %: booted on the spot (grace 0), a new sitting
    let r = whole.report(new Set(['s']), (x) => x, 0).subjects[0]!;
    expect(r).toMatchObject({ hands: 10, warnings: 1, evictions: 1, sittings: 2 });
    expect(r.vpipAtPct['10']).toBe(0);
    expect(whole.figure('s')).toEqual({ hands: 0, vpip: null });

    // Whole sitting, grace 3: warned at hand 10 (30 %), recovered at hand 12 (5 of 12).
    const graced = new LightningEvalPoolLedger({
      vpipPct: 40,
      windowHands: 10,
      graceHands: 3,
      rolling: false,
    });
    for (let i = 0; i < 10; i++) graced.record('g', i < 3);
    graced.record('g', true);
    r = graced.report(new Set(['g']), (x) => x, 0).subjects[0]!;
    expect(r).toMatchObject({ warnings: 1, recoveries: 0, evictions: 0 });
    graced.record('g', true);
    r = graced.report(new Set(['g']), (x) => x, 0).subjects[0]!;
    expect(r).toMatchObject({ warnings: 1, recoveries: 1, evictions: 0, hands: 12, entered: 5 });
    // Grace runs out: warned at 10, booted when the grace hands are spent under the floor.
    const spent = new LightningEvalPoolLedger({
      vpipPct: 40,
      windowHands: 10,
      graceHands: 2,
      rolling: false,
    });
    for (let i = 0; i < 11; i++) spent.record('x', false);
    expect(spent.report(new Set(['x']), (x) => x, 0).subjects[0]!.evictions).toBe(0);
    spent.record('x', false);
    expect(spent.report(new Set(['x']), (x) => x, 0).subjects[0]!.evictions).toBe(1);
    // Rolling forgets: 10 entries then 7 folds is 59 % of the sitting but 30 % of the last 10.
    const rollingLedger = new LightningEvalPoolLedger({
      vpipPct: 40,
      windowHands: 10,
      graceHands: 0,
      rolling: true,
    });
    const wholeLedger = new LightningEvalPoolLedger({
      vpipPct: 40,
      windowHands: 10,
      graceHands: 0,
      rolling: false,
    });
    for (let i = 0; i < 17; i++) {
      rollingLedger.record('p', i < 10);
      wholeLedger.record('p', i < 10);
    }
    expect(rollingLedger.report(new Set(['p']), (x) => x, 0).subjects[0]!.evictions).toBe(1);
    expect(wholeLedger.report(new Set(['p']), (x) => x, 0).subjects[0]!.evictions).toBe(0);
    expect(lightningEvalFloorRules(undefined)).toEqual({});
    expect(
      lightningEvalFloorRules({ vpipPct: 40, windowHands: 10, graceHands: 0, rolling: false })
    ).toEqual({ nit_game: true, maintain_percent_min: 40, maintain_hands: 10 });
  });

  it('E2: a floored cell gives each player one pool session, each arm its own ledger, and a null candidate stays paired', async () => {
    const floor = {
      vpipPct: 40,
      windowHands: 10,
      graceHands: 0,
      rolling: false,
      feedSnapshot: true,
      restartEveryHands: 6,
    };
    const config: LightningEvalConfig = {
      name: 'floored-pin',
      seedClass: 'development',
      seeds: [LIGHTNING_EVAL_SEEDS.development[0]!],
      handsPerCell: 12,
      cells: [{ variant: 'plo5', players: 4, stackBB: 100, field: 'all_horse', floor }],
      baselineDecideOpts: {},
    };
    const fed: Array<{ floor: unknown; window: unknown; own: unknown }> = [];
    const report = await runLightningPairedEval({
      config,
      candidate: {
        ...NULL_CANDIDATE,
        snapshotPatch: (snap: any) => {
          fed.push({
            floor: snap.gameState.vpipFloor,
            window: snap.gameState.vpipWindowHands,
            own: snap.gameState.ownVpip,
          });
          return snap;
        },
      },
      playArm,
    });
    const cell = report.cells[0]!;
    expect(cell.paired.divergentDecisions).toBe(0);
    expect(cell.pool).toBeDefined();
    const { baseline, candidate } = cell.pool!;
    expect(baseline).not.toBe(candidate);
    expect(baseline).toEqual(candidate);
    // One pool session per player: the hero's single session saw every hand.
    expect(baseline.subjects).toHaveLength(1);
    expect(baseline.subjects[0]!.hands).toBe(12);
    expect(baseline.table.hands).toBe(12 * 4);
    expect(baseline.feedClears).toBe(1);
    expect(report.definitions.pool).toBeDefined();
    // The host handed the floor and the hero's own figure to its decisions.
    expect(fed.length).toBeGreaterThan(0);
    expect(fed.every((f) => f.floor === 40 && f.window === 10)).toBe(true);
    expect(fed.some((f) => (f.own as { hands: number }).hands > 0)).toBe(true);
    expect(
      fed.every(
        (f) => (f.own as { hands: number }).hands <= 6 // the feed ledger clears every 6 hands
      )
    ).toBe(true);
  }, 420_000);
});

/**
 * A PAIRED EVALUATION REPEATS ITSELF (law, 2026-11-19). Two runs of unmodified
 * origin/main on one small switch card differed by one hand in 800, and the
 * divergent-decision count of one cell read 22, 17 and 13 on three runs. The
 * cause was not load: the brain's think times (horseActionTimeIsPublicOnly)
 * and public bet sizes (omahaBetSizeByPublicState) come from two streams that
 * production seeds from the operating system at load, and each arm loads its
 * own module graph. Think times set the action timestamps, which the brain
 * reads, so the arms differed by more than the option under test. The arm
 * now pins both streams per decision (lightningEvalPinPublicStreams). These
 * laws hold it: an arm is a function of (seed, cell, hands, options) alone,
 * down to the length of every hand on the harness clock.
 */
describe('Lightning harness: an arm is a function of its seeds (law)', () => {
  /** Both public streams in use: every think time and every public bet size. */
  const PUBLIC_STREAMS_ON = {
    horseActionTimeIsPublicOnly: true,
    omahaBetSizeByPublicState: true,
  };
  const cell: LightningEvalCell = { variant: 'plo4', players: 5, stackBB: 100, field: 'unknown' };

  it('the same arm played twice on the same seeds is byte-identical, think times included', async () => {
    const input = {
      cell,
      hands: 40,
      seed: 41990911,
      baselineDecideOpts: PUBLIC_STREAMS_ON,
      arm: { name: 'baseline' },
    };
    const first = await playArm(input);
    const second = await playArm(input);
    expect(first.hands).toHaveLength(40);
    expect(first.counters.decisions).toBeGreaterThan(100);
    // The harness clock moved with the think times: the public timing is in play.
    expect(new Set(first.hands.map((h) => h.clockMs)).size).toBeGreaterThan(5);
    expect(JSON.stringify(second.hands)).toBe(JSON.stringify(first.hands));
    expect(second.total).toEqual(first.total);
    expect(second.counters).toEqual(first.counters);
    // Another seed is another set of draws: nothing is frozen.
    const other = await playArm({ ...input, seed: 41990912, hands: 12 });
    expect(other.hands.map((h) => h.clockMs)).not.toEqual(
      first.hands.slice(0, 12).map((h) => h.clockMs)
    );
  }, 600_000);

  it('a null candidate on the public streams: zero divergent decisions, and the same pairs and digest on a second run', async () => {
    const config: LightningEvalConfig = {
      name: 'repeat-pin',
      seedClass: 'development',
      seeds: [LIGHTNING_EVAL_SEEDS.development[0]!],
      handsPerCell: 30,
      cells: [cell, { variant: 'plo5', players: 6, stackBB: 100, field: 'all_horse' }],
      baselineDecideOpts: PUBLIC_STREAMS_ON,
    };
    const run = async () => {
      const pairs: LightningEvalPairRow[] = [];
      const report = await runLightningPairedEval({
        config,
        candidate: NULL_CANDIDATE,
        playArm,
        onPairs: (rows) => void pairs.push(...rows),
      });
      return { report, pairs };
    };
    const first = await run();
    const second = await run();
    expect(first.pairs).toHaveLength(60);
    for (const c of first.report.cells) {
      expect(c.paired.divergentDecisions).toBe(0);
      expect(c.paired.divergentHands).toBe(0);
      expect(c.paired.divergentAcceptedHands).toBe(0);
      expect(c.paired.diffBB100).toBe(0);
    }
    for (const row of first.pairs) expect(row.c).toBe(row.b);
    expect(JSON.stringify(second.pairs)).toBe(JSON.stringify(first.pairs));
    expect(second.report.digest).toBe(first.report.digest);
  }, 900_000);
});

/**
 * D10 and the files of a runner process (2026-11-19): an arm releases what it
 * built, a range in play is not a result, a crashed range stops the queue, and
 * the merge takes a whole (seed, cell) set or nothing.
 */
describe('Lightning harness: release, run files and the merge gate', () => {
  const SEEDS = [41990901, 41990902];
  const pairRow = (seed: number, h: number): LightningEvalPairRow => ({
    seed,
    variant: 'plo4',
    players: 5,
    stackBB: 100,
    field: 'all_horse',
    villains: 0,
    counterExploit: false,
    h,
    b: 0,
    c: 1,
  });
  const newDir = () => mkdtempSync(join(tmpdir(), 'lightning-eval-files-'));
  /** One range of a four-cell configuration, two paired rows per (seed, cell). */
  function playRange(
    dir: string,
    from: number,
    to: number,
    opts: {
      seeds?: number[];
      finish?: boolean;
      skip?: string;
      pid?: number;
      isAlive?: (pid: number) => boolean;
    } = {}
  ) {
    const seeds = opts.seeds ?? SEEDS;
    const stem = join(dir, `lightning-paired-eval-x-null-cells-${from}-${to}`);
    const header = { config: 'x', seedClass: 'switch', candidate: 'null', candidateDecideOpts: {} };
    const files = openLightningEvalRunFiles({
      stem,
      pairsHeader: { schema: LIGHTNING_EVAL_PAIRS_SCHEMA, ...header, cells: [from, to] },
      latencyHeader: { schema: LIGHTNING_EVAL_LATENCY_SCHEMA, ...header, cells: [from, to] },
      log: () => {},
      ...(opts.pid !== undefined ? { pid: opts.pid } : {}),
      ...(opts.isAlive ? { isAlive: opts.isAlive } : {}),
    });
    for (const seed of seeds)
      for (let cell = from; cell < to; cell++) {
        if (opts.skip === `${seed}/${cell}`) continue;
        files.appendPairs(seed, cell, [pairRow(seed, 0), pairRow(seed, 1)]);
        files.appendLatency({ seed } as never);
      }
    const finish = () =>
      files.complete({
        ...header,
        deadlineMode: 'measure',
        seeds,
        handsPerCell: 2,
        configCells: 4,
        cellRange: [from, to],
        reportDigest: 'digest',
      });
    return { stem, finish, completion: opts.finish === false ? null : finish() };
  }

  it('an arm leaves no mock registered: its hands and module graph can be collected (D10)', async () => {
    const cell: LightningEvalCell = { variant: 'plo4', players: 5, stackBB: 100, field: 'station' };
    const before = lightningEvalRegisteredMocks();
    const played = await playArm({
      cell,
      hands: 3,
      seed: 20261114,
      baselineDecideOpts: {},
      arm: { name: 'baseline' },
    });
    expect(played.hands).toHaveLength(3);
    // The host fixture builds about twenty vi.fn per hand; vitest keeps every
    // one for the life of the process unless the arm takes them out again.
    expect(lightningEvalRegisteredMocks()).toBe(before);
    // The arm's error reporter records nothing: a recording mock would hold
    // every hand through the stack frames of the Error the host reports.
    const { reportError } = await import('../services/errorReporter.js');
    expect(vi.isMockFunction(reportError)).toBe(false);
    // The scope itself: what is registered inside it leaves with release().
    const scope = openLightningEvalFixtureScope();
    vi.fn();
    vi.fn();
    expect(lightningEvalRegisteredMocks()).toBe(before + 4);
    expect(scope.release()).toBe(4);
    expect(lightningEvalRegisteredMocks()).toBe(before);
  });

  it('a range in play has only .partial side files; completing it names them and writes the marker', () => {
    const dir = newDir();
    const open = playRange(dir, 0, 4, { finish: false });
    expect(readdirSync(dir).sort()).toEqual(
      ['.latency.jsonl.partial', '.pairs.jsonl.partial', '.running.json'].map(
        (suffix) => `${basename(open.stem)}${suffix}`
      )
    );
    // Nothing a merge could read yet.
    expect(() => lightningEvalCompletedRuns(dir)).toThrow(/unfinished range/);
    const completion = open.finish();
    expect(readdirSync(dir).sort()).toEqual(
      ['.complete.json', '.latency.jsonl', '.pairs.jsonl'].map(
        (suffix) => `${basename(open.stem)}${suffix}`
      )
    );
    expect(completion.units).toHaveLength(8);
    expect(completion.files.pairs.lines).toBe(17);
    expect(completion.files.pairs.sha256).toBe(
      createHash('sha256')
        .update(readFileSync(`${open.stem}.pairs.jsonl`))
        .digest('hex')
    );
    expect(lightningEvalCompletedRuns(dir).pairsFiles).toEqual([
      `${basename(open.stem)}.pairs.jsonl`,
    ]);
  });

  it('a range that did not play every (seed, cell) cannot be completed', () => {
    const dir = newDir();
    const open = playRange(dir, 0, 2, { finish: false, skip: '41990902/1' });
    expect(() => open.finish()).toThrow(/incomplete, 1 of 4 .*41990902\/1/);
    // Nothing was renamed and no marker written: the merge refuses the directory.
    expect(existsSync(`${open.stem}.pairs.jsonl`)).toBe(false);
    expect(existsSync(`${open.stem}.complete.json`)).toBe(false);
    expect(() => lightningEvalCompletedRuns(dir)).toThrow(/unfinished range/);
  });

  it('a crashed range stops the next one; a range still running does not', () => {
    const dir = newDir();
    // A process that has really exited (the default liveness probe).
    const gone = spawnSync(process.execPath, ['-e', '']).pid!;
    playRange(dir, 0, 2, { finish: false, pid: gone });
    expect(() => playRange(dir, 2, 4)).toThrow(
      /STOP\. .*cells-0-2\.running\.json was left by process/
    );
    // Nothing of the refused range was written.
    expect(readdirSync(dir).filter((f) => f.includes('cells-2-4'))).toEqual([]);
    // The crashed range played again replaces its own unfinished rows.
    expect(playRange(dir, 0, 2).completion!.units).toHaveLength(4);
    expect(playRange(dir, 2, 4).completion!.units).toHaveLength(4);
    expect(lightningEvalCompletedRuns(dir).completions).toHaveLength(2);

    const shared = newDir();
    // Two runners sharing a queue: the other range's owner is alive.
    playRange(shared, 0, 2, { finish: false, pid: 111, isAlive: () => true });
    expect(playRange(shared, 2, 4, { isAlive: () => true }).completion).not.toBeNull();
  });

  it('refuses a stem another live process is writing, and a stem that already holds a result', () => {
    const dir = newDir();
    playRange(dir, 0, 2, { finish: false, pid: 111, isAlive: () => true });
    expect(() => playRange(dir, 0, 2, { pid: 222, isAlive: () => true })).toThrow(
      /process 111 is already playing/
    );
    const done = newDir();
    playRange(done, 0, 2);
    expect(() => playRange(done, 0, 2)).toThrow(/already holds a result/);
  });

  it('the merge gate takes the whole (seed, cell) set or nothing', () => {
    const whole = newDir();
    playRange(whole, 2, 4);
    playRange(whole, 0, 2);
    const runs = lightningEvalCompletedRuns(whole);
    expect(runs.pairsFiles.map((f) => f.match(/cells-\d-\d/)![0])).toEqual([
      'cells-0-2',
      'cells-2-4',
    ]);
    expect(runs.latencyFiles).toHaveLength(2);

    const hole = newDir();
    playRange(hole, 0, 2);
    expect(() => lightningEvalCompletedRuns(hole)).toThrow(
      /incomplete: cells 2 to 3 of 4 are missing/
    );

    const crashed = newDir();
    playRange(crashed, 0, 2);
    playRange(crashed, 2, 4, { finish: false });
    expect(() => lightningEvalCompletedRuns(crashed)).toThrow(/unfinished range .*cells-2-4/);

    // Side files with no marker: a run that never finished under the old names.
    const unmarked = newDir();
    playRange(unmarked, 0, 4);
    writeFileSync(join(unmarked, 'lightning-paired-eval-x-null-cells-9-10.pairs.jsonl'), '{}\n');
    expect(() => lightningEvalCompletedRuns(unmarked)).toThrow(
      /has no .*cells-9-10\.complete\.json/
    );

    // Rows written after completion (a stray runner), or a truncated file.
    const touched = newDir();
    const range = playRange(touched, 0, 4);
    appendFileSync(`${range.stem}.pairs.jsonl`, JSON.stringify(pairRow(SEEDS[0]!, 2)) + '\n');
    expect(() => lightningEvalCompletedRuns(touched)).toThrow(/is not the file the run completed/);

    const twice = newDir();
    playRange(twice, 0, 3);
    playRange(twice, 2, 4);
    expect(() => lightningEvalCompletedRuns(twice)).toThrow(
      /cell 2 was played by more than one range/
    );

    const mixed = newDir();
    playRange(mixed, 0, 2);
    playRange(mixed, 2, 4, { seeds: [SEEDS[0]!] });
    expect(() => lightningEvalCompletedRuns(mixed)).toThrow(/more than one run/);

    expect(() => lightningEvalCompletedRuns(newDir())).toThrow(/no completed range/);
  });
});

describe('the runner timeout (LIGHTNING_EVAL_TIMEOUT_MS)', () => {
  it('keeps two hours when unset or empty, takes 0 as no timeout and a whole number as given', () => {
    expect(lightningEvalRunnerTimeoutMs(undefined)).toBe(7_200_000);
    expect(lightningEvalRunnerTimeoutMs('')).toBe(7_200_000);
    expect(lightningEvalRunnerTimeoutMs(' ')).toBe(7_200_000);
    expect(lightningEvalRunnerTimeoutMs('0')).toBe(0);
    expect(lightningEvalRunnerTimeoutMs('21600000')).toBe(21_600_000);
    expect(lightningEvalRunnerTimeoutMs(' 60000 ')).toBe(60_000);
  });

  it('refuses anything that is not a whole number of milliseconds', () => {
    for (const bad of ['-1', '1.5', '2h', 'none', '1e9', '99999999999999999999']) {
      expect(() => lightningEvalRunnerTimeoutMs(bad)).toThrow(/LIGHTNING_EVAL_TIMEOUT_MS/);
    }
  });
});

/**
 * THE RUNNER. From server/:
 *   LIGHTNING_EVAL_CONFIG=smoke LIGHTNING_EVAL_OUT=<dir> \
 *     npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
 * Optional: LIGHTNING_EVAL_CELLS=from:to (half-open cell indices, to bound one
 * process), LIGHTNING_EVAL_CANDIDATE=<json of decide options> (default: null),
 * LIGHTNING_EVAL_TIMEOUT_MS=<ms> (default 7,200,000; 0 means none; the
 * per-test timeout below beats --testTimeout, so this is the one that counts).
 * Besides the report it writes <stem>.pairs.jsonl: a header line, then one
 * line per paired hand (the input of the merge below).
 */
const requested = process.env.LIGHTNING_EVAL_CONFIG;
const STAGED: Record<string, LightningEvalConfig> = {
  smoke: LIGHTNING_EVAL_SMOKE,
  full: LIGHTNING_EVAL_FULL,
  selection: LIGHTNING_EVAL_SELECTION,
  final: LIGHTNING_EVAL_FINAL,
  dev_mixed: LIGHTNING_EVAL_DEV_MIXED,
  dev_mixed_smoke: LIGHTNING_EVAL_DEV_MIXED_SMOKE,
};
/**
 * E1 SWITCH CARD: LIGHTNING_EVAL_CONFIG=switch LIGHTNING_EVAL_SWITCH=<card.json>.
 * card.json: { name, flag, candidateValue?, scope? ('hero' | 'all_horses'),
 * base (option -> boolean map, entries, an arms.json or live switch rows) or
 * basePath, seeds (from LIGHTNING_EVAL_SWITCH_SEED_RANGE), handsPerCell,
 * cells (LightningEvalCell[], floor allowed) }. LIGHTNING_EVAL_CANDIDATE is
 * refused with it: the candidate is the card's flag.
 */
function loadSwitchCard(): { config: LightningEvalConfig; candidate: LightningEvalArmSpec } {
  const path = process.env.LIGHTNING_EVAL_SWITCH;
  if (!path) throw new Error('LIGHTNING_EVAL_SWITCH (a card file) is required');
  if (process.env.LIGHTNING_EVAL_CANDIDATE)
    throw new Error('a switch card declares its candidate; LIGHTNING_EVAL_CANDIDATE is refused');
  const card = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
  const base =
    card.basePath !== undefined
      ? JSON.parse(readFileSync(String(card.basePath), 'utf8'))
      : card.base;
  const scope = card.scope ?? 'hero';
  if (scope !== 'hero' && scope !== 'all_horses')
    throw new Error('scope must be hero or all_horses');
  const arms = horseSwitchArms(base, String(card.flag), card.candidateValue);
  const record: LightningEvalSwitchCardRecord = {
    name: String(card.name),
    flag: arms.flag,
    candidateValue: arms.candidateValue,
    baseValue: arms.baseValue ?? null,
    ignored: arms.ignored,
    digest: arms.digest,
    scope,
  };
  return {
    config: lightningEvalSwitchConfig({
      record,
      baseline: arms.b,
      seeds: card.seeds,
      handsPerCell: card.handsPerCell,
      cells: card.cells,
    }),
    candidate: lightningEvalSwitchCandidate(record),
  };
}

describe.runIf(requested !== undefined && (requested in STAGED || requested === 'switch'))(
  'the paired Lightning evaluation runner',
  () => {
    it('runs the declared configuration and writes its report', async () => {
      const switchCard = requested === 'switch' ? loadSwitchCard() : null;
      const config = switchCard ? switchCard.config : STAGED[requested!]!;
      const outDir = process.env.LIGHTNING_EVAL_OUT;
      if (!outDir) throw new Error('LIGHTNING_EVAL_OUT (a directory) is required');
      const range = process.env.LIGHTNING_EVAL_CELLS?.split(':').map(Number);
      const candidateOpts =
        !switchCard && process.env.LIGHTNING_EVAL_CANDIDATE
          ? (JSON.parse(process.env.LIGHTNING_EVAL_CANDIDATE) as Record<string, unknown>)
          : null;
      const candidate: LightningEvalArmSpec = switchCard
        ? switchCard.candidate
        : candidateOpts
          ? {
              name: Object.keys(candidateOpts).sort().join('+') || 'empty',
              decideOpts: candidateOpts,
            }
          : NULL_CANDIDATE;
      // LIGHTNING_EVAL_DEADLINE=apply: answer a decision past the production
      // deadline as production does (machine dependent; default measure).
      const deadlineEnv = process.env.LIGHTNING_EVAL_DEADLINE ?? 'measure';
      if (deadlineEnv !== 'measure' && deadlineEnv !== 'apply')
        throw new Error(`LIGHTNING_EVAL_DEADLINE must be measure or apply, not ${deadlineEnv}`);
      const deadlineMode: 'measure' | 'apply' = deadlineEnv;
      const stem = `${outDir}/lightning-paired-eval-${config.name}-${candidate.name}${
        range ? `-cells-${range.join('-')}` : ''
      }${deadlineMode === 'apply' ? '-deadline-apply' : ''}`;
      const cellRange: [number, number] =
        range && range.length === 2 && range.every(Number.isInteger)
          ? [range[0]!, Math.min(range[1]!, config.cells.length)]
          : [0, config.cells.length];
      if (!(cellRange[0] >= 0 && cellRange[0] < cellRange[1]))
        throw new Error(
          `LIGHTNING_EVAL_CELLS ${cellRange.join(':')} holds no cell of the ${config.cells.length}`
        );
      // The side files carry .partial until the whole range is played and
      // checked; a range another process left unfinished stops this one here.
      const files = openLightningEvalRunFiles({
        stem,
        latencyHeader: {
          schema: LIGHTNING_EVAL_LATENCY_SCHEMA,
          config: config.name,
          seedClass: config.seedClass,
          candidate: candidate.name,
          candidateDecideOpts: candidate.decideOpts ?? {},
          cells: range ?? null,
          deadlineMode,
        },
        pairsHeader: {
          schema: LIGHTNING_EVAL_PAIRS_SCHEMA,
          config: config.name,
          seedClass: config.seedClass,
          candidate: candidate.name,
          candidateDecideOpts: candidate.decideOpts ?? {},
          cells: range ?? null,
        },
      });
      const report = await runLightningPairedEval({
        config,
        candidate,
        playArm,
        cellRange,
        onPairs: (rows, c, i) => files.appendPairs(c.seed, i, rows),
        onLatency: (row) => files.appendLatency(row),
        deadlineMode,
        onCell: (c, i) =>
          console.log(
            `[lightning-eval] cell ${i} seed ${c.seed} ${c.cell.variant} ${c.cell.players}p ${lightningEvalStackLabel(c.cell)} ${c.cell.field}: diff ${c.paired.diffBB100} bb/100 (se ${c.paired.seBB100}), divergent decisions ${c.paired.divergentDecisions}; process ${lightningEvalProcessMemory()}`
          ),
      });
      writeFileSync(`${stem}.json`, JSON.stringify(report, null, 1));
      writeFileSync(`${stem}.md`, lightningEvalMarkdown(report));
      console.log(
        `[lightning-eval] wrote ${stem}.json and .md (the side files keep .partial until the checks below pass), digest ${report.digest}; illegal actions ${report.totals.illegalActions}, illegal amounts ${report.totals.illegalAmounts}, chip-conservation violations ${report.totals.conservationViolations}, unsettled hands ${report.totals.unsettledHands}`
      );
      console.log(
        `[lightning-eval] deadline and G4\n${lightningEvalLatencyMarkdown(report.latency)}`
      );
      expect(report.totals.illegalActions).toBe(0);
      expect(report.totals.illegalAmounts).toBe(0);
      // N2: a hand whose chips do not add up fails the run.
      expect(report.totals.conservationViolations).toBe(0);
      // A mixed cell's stacks reached the engine, seat for seat.
      for (const c of report.cells)
        if (c.cell.stackMix === 'mixed') expect(c.stacks?.engineStackMismatches).toBe(0);
      if (candidate === NULL_CANDIDATE && deadlineMode === 'measure')
        expect(report.totals.divergentDecisions).toBe(0);
      // Played and checked: only now do the side files get the names the
      // merge reads, with the marker that says what they must hold.
      const completion = files.complete({
        config: config.name,
        seedClass: config.seedClass,
        candidate: candidate.name,
        candidateDecideOpts: candidate.decideOpts ?? {},
        deadlineMode,
        seeds: [...config.seeds],
        handsPerCell: config.handsPerCell,
        configCells: config.cells.length,
        cellRange,
        reportDigest: report.digest,
      });
      console.log(
        `[lightning-eval] COMPLETE cells ${cellRange.join(':')} of ${config.cells.length}, ${completion.units.length} (seed, cell) units, ${completion.files.pairs.lines - 1} paired rows: ${stem}.pairs.jsonl, .latency.jsonl and .complete.json`
      );
    }, lightningEvalRunnerTimeoutMs(process.env.LIGHTNING_EVAL_TIMEOUT_MS));
  }
);

/**
 * THE MERGE. From server/:
 *   LIGHTNING_EVAL_MERGE=<dir> npx vitest run src/lightning/LightningPairedEval.test.ts -t "merges"
 * Pools every *.pairs.jsonl of <dir> (cells, seeds, cell-range files of ONE
 * candidate) and prints, per variant x {primary fields, counter-exploitation
 * cells, each field}: pooled hands, diff bb/100, both standard errors, the one
 * used (the larger) and z. Writes lightning-paired-eval-merged.json and .md
 * into <dir>.
 */
const mergeDir = process.env.LIGHTNING_EVAL_MERGE;
describe.runIf(Boolean(mergeDir))('the paired Lightning evaluation merge', () => {
  it('merges the paired side files of a directory and prints the pooled figures', () => {
    const dir = mergeDir!;
    // Completed ranges only, and only the whole (seed, cell) set.
    const runs = lightningEvalCompletedRuns(dir);
    const files = runs.pairsFiles;
    const rows: LightningEvalPairRow[] = [];
    const candidates = new Set<string>();
    const classes = new Set<string>();
    for (const file of files) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
      const header = JSON.parse(lines[0]!) as Record<string, unknown>;
      if (header.schema !== LIGHTNING_EVAL_PAIRS_SCHEMA)
        throw new Error(
          `${file}: schema ${String(header.schema)}, expected ${LIGHTNING_EVAL_PAIRS_SCHEMA}`
        );
      candidates.add(`${String(header.candidate)} ${JSON.stringify(header.candidateDecideOpts)}`);
      classes.add(String(header.seedClass));
      for (const line of lines.slice(1)) rows.push(JSON.parse(line) as LightningEvalPairRow);
    }
    // One candidate, one seed class: pooling two candidates is not a figure.
    if (candidates.size !== 1)
      throw new Error(`more than one candidate in ${dir}: ${[...candidates].join(' | ')}`);
    if (classes.size !== 1) throw new Error(`more than one seed class in ${dir}`);
    const merged = mergeLightningEvalPairs(rows);
    // The latency side files (G4), when the runs wrote them: the same candidate.
    const latencyFiles = runs.latencyFiles;
    const latencyRows: LightningEvalLatencyRow[] = [];
    const modes = new Set<string>();
    for (const file of latencyFiles) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
      const header = JSON.parse(lines[0]!) as Record<string, unknown>;
      if (header.schema !== LIGHTNING_EVAL_LATENCY_SCHEMA)
        throw new Error(
          `${file}: schema ${String(header.schema)}, expected ${LIGHTNING_EVAL_LATENCY_SCHEMA}`
        );
      const name = `${String(header.candidate)} ${JSON.stringify(header.candidateDecideOpts)}`;
      if (!candidates.has(name))
        throw new Error(`${file}: candidate ${name} is not the paired files' candidate`);
      modes.add(String(header.deadlineMode));
      for (const line of lines.slice(1))
        latencyRows.push(JSON.parse(line) as LightningEvalLatencyRow);
    }
    if (modes.size > 1) throw new Error(`more than one deadline mode in ${dir}`);
    const latency = latencyFiles.length
      ? mergeLightningEvalLatency(latencyRows, modes.has('apply') ? 'apply' : 'measure')
      : null;
    const body = {
      ...merged,
      candidate: [...candidates][0],
      seedClass: [...classes][0],
      files,
      latency,
      latencyFiles,
    };
    const markdown =
      lightningEvalMergeMarkdown(merged) +
      (latency
        ? `\n## Decision deadline and G4 (pooled)\n\n${lightningEvalLatencyMarkdown(latency)}`
        : '') +
      `\nCandidate ${body.candidate}; ${body.seedClass} seeds; files: ${files.join(', ')}${
        latencyFiles.length ? `; latency files: ${latencyFiles.join(', ')}` : ''
      }.\n`;
    writeFileSync(join(dir, 'lightning-paired-eval-merged.json'), JSON.stringify(body, null, 1));
    writeFileSync(join(dir, 'lightning-paired-eval-merged.md'), markdown);
    console.log(`[lightning-eval-merge]\n${markdown}`);
    expect(merged.hands).toBe(rows.length);
    expect(merged.figures.length).toBeGreaterThan(0);
  });
});
