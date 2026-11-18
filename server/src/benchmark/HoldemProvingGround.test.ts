/** Offline benchmark: no database, network, live wallets or production telemetry flush.
 * Full fixed 52,000 hands: HOLD_EM_PROVING_OUTPUT=/absolute/new/archive/path
 *   npx vitest run src/benchmark/HoldemProvingGround.test.ts
 * Ordinary CI runs the same matrix with two paired deals per cell.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
vi.mock('../services/supabase/client.js', () => ({
  supabase: new Proxy(
    {},
    {
      get() {
        throw new Error('Database access in offline proving ground');
      },
    }
  ),
}));
import { HorseMind } from '../engine/HorseMind.js';
import {
  LAG80_OPPONENT_ID,
  dealShuffledDeck,
  mulberry32,
  runPairedArmHand,
  runProvingGroundCells,
  type ProvingGroundCellSpec,
} from './HoldemProvingGroundHarness.js';

const specs: Array<
  [string, number, number, number, number, number, Partial<ProvingGroundCellSpec>?]
> = [
  ['cash_9max_100bb_1_2', 9, 100, 1, 2, 2000],
  ['cash_9max_250bb_2_5', 9, 250, 2, 5, 2000],
  ['cash_6max_100bb_025_050', 6, 100, 0.25, 0.5, 1500],
  ['cash_6max_200bb_2_5', 6, 200, 2, 5, 1500],
  ['cash_6max_100bb_5_10', 6, 100, 5, 10, 1000],
  ['cash_diamond_50_100', 6, 100, 50, 100, 1000, { isDiamondCash: true }],
  ['cash_diamond_500_1000', 6, 100, 500, 1000, 1000, { isDiamondCash: true }],
  ['cash_45bb_law', 6, 45, 1, 2, 1000],
  ['cash_50bb_boundary', 6, 50, 1, 2, 1000],
  ['cash_51bb_ramp', 6, 51, 1, 2, 1000],
  ['cash_straddle_100bb_1_2_4', 6, 100, 1, 2, 1000, { straddleAmount: 4 }],
  ['cash_straddle_150bb_1_2_6', 6, 150, 1, 2, 1000, { straddleAmount: 6 }],
  ['cash_hu_100bb', 2, 100, 2, 5, 1000],
  ['cash_lag80_200bb', 6, 200, 2, 5, 2000, { matchup: 'v87_on_off_vs_lag80' }],
  [
    'mtt_early_100bb',
    6,
    100,
    50,
    100,
    1500,
    { mode: 'tournament', tournamentStage: 'early', anteBB: 1 },
  ],
  [
    'mtt_middle_40bb',
    6,
    40,
    50,
    100,
    1500,
    { mode: 'tournament', tournamentStage: 'middle', anteBB: 1 },
  ],
  [
    'mtt_bubble_20bb',
    6,
    20,
    100,
    200,
    1000,
    { mode: 'tournament', tournamentStage: 'bubble', anteBB: 1 },
  ],
  [
    'mtt_bubble_30bb',
    6,
    30,
    100,
    200,
    1000,
    { mode: 'tournament', tournamentStage: 'bubble', anteBB: 1 },
  ],
  [
    'mtt_final_15bb',
    6,
    15,
    100,
    200,
    1000,
    { mode: 'tournament', tournamentStage: 'itm', anteBB: 1 },
  ],
  [
    'mtt_final_25bb',
    6,
    25,
    100,
    200,
    1000,
    { mode: 'tournament', tournamentStage: 'itm', anteBB: 1 },
  ],
  [
    'mtt_pko_20bb',
    6,
    20,
    100,
    200,
    1000,
    { mode: 'tournament', tournamentStage: 'bubble', anteBB: 1, bountyFactor: 0.35 },
  ],
];
const fullCells: ProvingGroundCellSpec[] = specs.map(
  ([id, seats, stackBB, sb, bb, pairedDeals, extra], i) => ({
    id,
    seats,
    stackBB,
    sb,
    bb,
    pairedDeals,
    mode: 'cash',
    matchup: 'v87_on_vs_off',
    seed: 20261111 + i * 1009,
    ...extra,
  })
);

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network access in offline proving ground');
  });
});
describe('Holdem paired proving ground', () => {
  it('isolates public memory across arms and preserves the ambient bank', () => {
    HorseMind.reset();
    const cell = { ...fullCells[0]!, pairedDeals: 2, matchup: 'v87_vs_v87_null' as const };
    const deck = dealShuffledDeck(mulberry32(179));
    const publicLag = {
      seat: 1,
      user_id: LAG80_OPPONENT_ID,
      username: 'Opponent',
      stack: 100,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const ambientBefore = HorseMind.snapshotDecisionReads([publicLag], null);
    const first = runPairedArmHand(cell, deck, 1, false, 93);
    runPairedArmHand({ ...cell, matchup: 'v87_on_off_vs_lag80' }, deck, 1, false, 94);
    const second = runPairedArmHand(cell, deck, 1, false, 93);
    expect(second).toEqual(first);
    expect(HorseMind.snapshotDecisionReads([publicLag], null)).toEqual(ambientBefore);
    expect(() => runPairedArmHand(cell, Array(52).fill(deck[0]), 1, false, 93)).toThrow();
  });
  it('completes the fixed matrix with conserved chips and legal accepted actions', () => {
    const output = process.env.HOLD_EM_PROVING_OUTPUT;
    const cells = output ? fullCells : fullCells.map((c) => ({ ...c, pairedDeals: 2 }));
    expect(fullCells.reduce((n, c) => n + c.pairedDeals, 0)).toBe(26000);
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const inputs = {
      schemaVersion: 1,
      startedAt,
      cells,
      comparator:
        'Same current source with v87HoldemOverhaul toggled; not an immutable historical V86 build',
      limitations: [
        'Offline HandController and HorseLogic, no runtime worker or loaded solver corpus',
        'Static tournament contexts and chip EV; not full tournament ROI or payout equity',
        'Synthetic LAG policy probabilities are conditional; not observed global VPIP/PFR',
        'Fresh memory per arm; synthetic public LAG history only in LAG cells',
        '95% normal intervals over paired deal clusters; no guarantee of positive results or p < .01',
        'Feature fire counts are isolated diagnostic counts, not fleet activation evidence',
      ],
    };
    if (output) {
      if (!isAbsolute(output)) throw new Error('Use an absolute task-owned archive path');
      mkdirSync(output, { recursive: false });
      const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const sourceFiles = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      const hashes = Object.fromEntries(
        sourceFiles.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])
      );
      for (const p of [
        'src/benchmark/HoldemProvingGroundHarness.ts',
        'src/benchmark/HoldemProvingGround.test.ts',
      ])
        hashes[p] = createHash('sha256').update(readFileSync(p)).digest('hex');
      writeFileSync(
        join(output, 'inputs.json'),
        JSON.stringify(
          { ...inputs, revision, node: process.version, sourceHashes: hashes },
          null,
          2
        )
      );
    }
    const summary = runProvingGroundCells(cells, {
      collectTelemetry: true,
      onPair: output
        ? (cell, deal, armA, armB) => {
            appendFileSync(
              join(output, 'pairs.jsonl'),
              JSON.stringify({ cellId: cell.id, deal, armA, armB }) + '\n'
            );
            if (deal + 1 === cell.pairedDeals)
              console.log(`Completed ${cell.id}: ${(deal + 1) * 2} hands`);
          }
        : undefined,
    });
    if (output)
      writeFileSync(
        join(output, 'summary.json'),
        JSON.stringify(
          {
            ...inputs,
            finishedAt: new Date().toISOString(),
            elapsedMs: performance.now() - start,
            ...summary,
          },
          null,
          2
        )
      );
    expect(summary.totalCompletedHands).toBe(output ? 52000 : fullCells.length * 4);
    expect(summary.chipConservationVerified).toBe(true);
    expect(summary.totalIllegalActions).toBe(0);
    expect(summary.cells.every((c) => Number.isFinite(c.bbPer100))).toBe(true);
  }, 1200000);
});
