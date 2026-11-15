/**
 * THE PAIRED LIGHTNING EVALUATION HARNESS: its pin and its runner (2026-11-14).
 *
 * 1. The pin (always runs, small): two arms that differ in nothing make the
 *    SAME decisions hand for hand on the real LightningHandHost, in hold'em
 *    and in Omaha, with a scripted opponent and without one. That is what
 *    makes a later difference between two arms a property of the candidate.
 *    It also pins that the candidate's options reach the subject seat's
 *    decide call, and the report schema.
 * 2. The runner (only when LIGHTNING_EVAL_CONFIG is set): plays the declared
 *    smoke or full configuration and writes the report. See
 *    LIGHTNING-PAIRED-EVAL-README.md.
 *
 * Measurement plumbing: no database, no production caller.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  LIGHTNING_EVAL_BB_PRICE_BUCKETS,
  LIGHTNING_EVAL_FIELDS,
  LIGHTNING_EVAL_FULL,
  LIGHTNING_EVAL_SCHEMA,
  LIGHTNING_EVAL_SEEDS,
  LIGHTNING_EVAL_SMOKE,
  lightningEvalDigest,
  lightningEvalMarkdown,
  lightningEvalPosition,
  lightningEvalSeedClassOf,
  runLightningPairedEval,
  type LightningEvalArmPlayer,
  type LightningEvalArmSpec,
  type LightningEvalConfig,
} from './LightningPairedEval.test-support.js';

/** The seeded deck: the engine's own Fisher-Yates on a fixed stream. */
const deck = { state: 1 };

/**
 * One arm on a FRESH module graph. The equity caches are module state: a
 * warm cache changes how many random draws a decision consumes, so two arms
 * are comparable only when each starts cold.
 */
const playArm: LightningEvalArmPlayer = async (input) => {
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
    reportError: vi.fn(),
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
  return playLightningEvalArm({
    ...input,
    setDeckState: (state) => {
      deck.state = state >>> 0 || 1;
    },
  });
};

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
    for (const config of [LIGHTNING_EVAL_SMOKE, LIGHTNING_EVAL_FULL])
      for (const seed of config.seeds) expect(lightningEvalSeedClassOf(seed)).toBe('development');
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
    const report = await runLightningPairedEval({ config, candidate: NULL_CANDIDATE, playArm });

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
        expect(arm.counters.decideThrows).toBe(0);
        expect(arm.counters.unsettledHands).toBe(0);
        expect(arm.counters.subjectDecisions).toBeGreaterThan(0);
        expect(arm.total.hands).toBe(12);
      }
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
        'schema',
        'seedClass',
        'seeds',
        'totals',
      ].sort()
    );
    expect(Object.keys(report.cells[0]!).sort()).toEqual(
      ['baseline', 'candidate', 'cell', 'hands', 'latencyMs', 'paired', 'rakeConfig', 'seed'].sort()
    );
    expect(Object.keys(report.cells[0]!.baseline.total).sort()).toEqual(
      [
        'bigBlindByPrice',
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
        'firstDivergentHand',
        'hands',
        'seBB100',
      ].sort()
    );
    for (const key of Object.keys(report.cells[0]!.baseline.total.bigBlindByPrice))
      expect(LIGHTNING_EVAL_BB_PRICE_BUCKETS as readonly string[]).toContain(key);
    expect(report.totals.illegalActions).toBe(0);
    expect(report.totals.divergentDecisions).toBe(0);
    const { digest, ...body } = report;
    expect(digest).toBe(lightningEvalDigest(body));
    expect(lightningEvalMarkdown(report)).toContain('| cell | arm | hands |');
  }, 420_000);
});

/**
 * THE RUNNER. From server/:
 *   LIGHTNING_EVAL_CONFIG=smoke LIGHTNING_EVAL_OUT=<dir> \
 *     npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
 * Optional: LIGHTNING_EVAL_CELLS=from:to (half-open cell indices, to bound one
 * process), LIGHTNING_EVAL_CANDIDATE=<json of decide options> (default: null).
 */
const requested = process.env.LIGHTNING_EVAL_CONFIG;
describe.runIf(requested === 'smoke' || requested === 'full')(
  'the paired Lightning evaluation runner',
  () => {
    it('runs the declared configuration and writes its report', async () => {
      const config = requested === 'full' ? LIGHTNING_EVAL_FULL : LIGHTNING_EVAL_SMOKE;
      const outDir = process.env.LIGHTNING_EVAL_OUT;
      if (!outDir) throw new Error('LIGHTNING_EVAL_OUT (a directory) is required');
      const range = process.env.LIGHTNING_EVAL_CELLS?.split(':').map(Number);
      const candidateOpts = process.env.LIGHTNING_EVAL_CANDIDATE
        ? (JSON.parse(process.env.LIGHTNING_EVAL_CANDIDATE) as Record<string, unknown>)
        : null;
      const candidate: LightningEvalArmSpec = candidateOpts
        ? {
            name: Object.keys(candidateOpts).sort().join('+') || 'empty',
            decideOpts: candidateOpts,
          }
        : NULL_CANDIDATE;
      const report = await runLightningPairedEval({
        config,
        candidate,
        playArm,
        ...(range && range.length === 2 && range.every(Number.isInteger)
          ? { cellRange: [range[0]!, range[1]!] as const }
          : {}),
        onCell: (c, i) =>
          console.log(
            `[lightning-eval] cell ${i} ${c.cell.variant} ${c.cell.players}p ${c.cell.stackBB}bb ${c.cell.field}: diff ${c.paired.diffBB100} bb/100 (se ${c.paired.seBB100}), divergent decisions ${c.paired.divergentDecisions}`
          ),
      });
      const stem = `${outDir}/lightning-paired-eval-${config.name}-${candidate.name}${
        range ? `-cells-${range.join('-')}` : ''
      }`;
      mkdirSync(dirname(stem), { recursive: true });
      writeFileSync(`${stem}.json`, JSON.stringify(report, null, 1));
      writeFileSync(`${stem}.md`, lightningEvalMarkdown(report));
      console.log(`[lightning-eval] wrote ${stem}.json and .md, digest ${report.digest}`);
      expect(report.totals.illegalActions).toBe(0);
      expect(report.totals.illegalAmounts).toBe(0);
      if (candidate === NULL_CANDIDATE) expect(report.totals.divergentDecisions).toBe(0);
    }, 7_200_000);
  }
);
