/**
 * LAW: THE NLH CASH RIVER BLUFF IS PRICED ON PEOPLE'S RIVER FOLD BY SIZE (holdemRiverBluffIsPricedOnPeople; default
 * OFF, read `=== true`; PLO-OWNER + Hold'em owner lead-8 2026-11-27;
 * docs/horse-option-authority.d/holdemRiverBluffIsPricedOnPeople.md).
 *
 *  1. THE FOLD: equilibrium is the anchor (multiplier 1). People's measured fold to a heads-up river first bet, by the
 *     bettor's line and the bet's size, moves it (answers by PEOPLE only: the table and its fit never count a Horse's
 *     answer), each cell shrunk by 19.9 pseudo-answers. His own lifetime river record of THIS bet's size moves it
 *     again and dominates as it grows; his record of the other size is not read.
 *  2. REAL AUDITED NODES (the deciding Horse's own cards only): off the brain checks; on it bets at one size on every
 *     seed with its receipt where the audit found a missed river bluff against a person; a truthy non-boolean is off;
 *     a tournament copy is never touched; a calling station's own river record turns the same bet back into a check
 *     and an over-folder's keeps it; a bet that neither blockers nor the range advantage support stays a check; a
 *     river check the audit judged correct stays a check.
 *  3. COST: an applicable decision with the option on costs a bounded multiple of the same decision off
 *     (src/testing/relativeCost.ts; theServerSuiteAssertsNoTightWallClockBound forbids a millisecond limit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tables from './HorseHoldemPeopleRiverFoldTables.json' with { type: 'json' };
import {
  HOLDEM_PEOPLE_RIVER_FOLD_PRIOR_OPPS,
  holdemPeopleRiverFold,
  holdemPeopleRiverFoldMultiplier,
  holdemPeopleRiverFoldSe,
  holdemPeopleRiverLineOf,
  holdemPeopleRiverRecordEqFold,
  holdemPeopleRiverSizeCell,
  holdemRiverFoldMultiplierOnPeople,
} from './HorseHoldemPeopleRiverFold.js';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const OPTION = 'holdemRiverBluffIsPricedOnPeople';
const RATIO_DECISION = 16;
interface FixNode {
  hand: ExtractedHand;
  ord: number;
  street: string;
  option: string;
  expect: string;
}
const FIX = JSON.parse(
  readFileSync(
    new URL('./HorseHoldemRiverBluffIsPricedOnPeople.fixture.json', import.meta.url),
    'utf8'
  )
) as { nodes: FixNode[]; productionOpts: Record<string, unknown> };
const PROD = FIX.productionOpts;
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7, 42];
const BET = 'holdem_river_people_bluff_bet';
const bets = FIX.nodes.filter((n) => n.expect === BET);
const stays = FIX.nodes.filter((n) => n.expect !== BET);
const stateOf = (n: FixNode) =>
  stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction);
const T = tables as unknown as {
  note: string;
  cells: Record<string, { n: number; fold: number; raise: number; eq: number }>;
};

describe('the people river fold: the table and the math', () => {
  it('the table holds people-only river cells and the fit never counts a Horse answer', () => {
    expect(T.note).toMatch(/People-only answers \(responder not a Horse\)/);
    const keys = Object.keys(T.cells);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const [key, c] of Object.entries(T.cells)) {
      expect(key).toMatch(/^river\|(all|agg|vsAgg|chk)\|(a<40|b40-70|c70-110|d>110|sm|bg)$/);
      expect(c.n).toBeGreaterThan(0);
      expect(c.fold).toBeLessThanOrEqual(c.n);
      expect(c.eq).toBeGreaterThan(0);
      expect(c.eq).toBeLessThan(c.n);
    }
    const fit = readFileSync(
      new URL('../../../scripts/ops/holdem-people-river-fold-fit.mjs', import.meta.url),
      'utf8'
    );
    // an answer by a Horse is dropped before any cell or any prior-strength count
    expect(fit).toMatch(/if \(!a \|\| a\.horse\) continue;/);
    expect(fit.indexOf('if (!a || a.horse) continue;')).toBeLessThan(fit.indexOf('note(`'));
    // the pull selects public actions only: no hole card, showdown or summary column
    expect(
      fit.slice(fit.indexOf('export function pullSql'), fit.indexOf('riverAnswerOf'))
    ).not.toMatch(/hole_cards|showdown|summary|winners/);
  });

  it('equilibrium is the anchor; people move it, each cell shrunk toward its parent', () => {
    expect(holdemPeopleRiverFoldMultiplier(null, 0)).toEqual({ m: 1, n: 0 });
    for (const ratio of [0.33, 0.5, 0.75, 1, 1.5]) {
      const size = holdemPeopleRiverSizeCell(ratio);
      const cell = T.cells[`river|all|${size}`];
      const raw = cell.fold / cell.eq;
      const { m, n } = holdemPeopleRiverFoldMultiplier(null, ratio);
      expect(n).toBe(cell.n);
      // between the anchor and people's raw multiplier, never past either
      expect(m).toBeGreaterThanOrEqual(Math.min(1, raw) - 1e-12);
      expect(m).toBeLessThanOrEqual(Math.max(1, raw) + 1e-12);
      // a line cell is read between its size cell and its own raw multiplier
      for (const line of ['agg', 'vsAgg', 'chk'] as const) {
        const lc = T.cells[`river|${line}|${size}`];
        const lm = holdemPeopleRiverFoldMultiplier(line, ratio).m;
        if (!lc) expect(lm).toBeCloseTo(m, 12);
        else {
          const lraw = lc.fold / lc.eq;
          expect(lm).toBeGreaterThanOrEqual(Math.min(m, lraw) - 1e-12);
          expect(lm).toBeLessThanOrEqual(Math.max(m, lraw) + 1e-12);
        }
      }
    }
    // people fold a half-pot river bet more often than equilibrium (the leak the audits priced)
    expect(holdemPeopleRiverFoldMultiplier(null, 0.5).m).toBeGreaterThan(1.2);
    // a one-answer line cell barely moves its size cell
    const thin = T.cells['river|vsAgg|a<40'];
    if (thin && thin.n <= 2)
      expect(
        Math.abs(
          holdemPeopleRiverFoldMultiplier('vsAgg', 0.3).m -
            holdemPeopleRiverFoldMultiplier(null, 0.3).m
        )
      ).toBeLessThan(0.2);
  });

  it('his own record of this size moves it and dominates as it grows; the other size is not read', () => {
    const mP = holdemPeopleRiverFoldMultiplier('chk', 0.5).m;
    expect(holdemRiverFoldMultiplierOnPeople(null, 0.5, mP)).toEqual({ m: mP, n: 0 });
    expect(holdemRiverFoldMultiplierOnPeople({ folds: 0, opps: 0 }, 0.5, mP)).toEqual({
      m: mP,
      n: 0,
    });
    const g = holdemPeopleRiverRecordEqFold(false);
    const k = HOLDEM_PEOPLE_RIVER_FOLD_PRIOR_OPPS;
    // the formula: (F + k g m_people) / (E + k g), E = answers x the cell's mean equilibrium fold
    expect(holdemRiverFoldMultiplierOnPeople({ folds: 3, opps: 20 }, 0.5, mP).m).toBeCloseTo(
      (3 + k * g * mP) / (20 * g + k * g),
      12
    );
    const station20 = holdemRiverFoldMultiplierOnPeople({ folds: 0, opps: 20 }, 0.5, mP).m;
    const station200 = holdemRiverFoldMultiplierOnPeople({ folds: 0, opps: 200 }, 0.5, mP).m;
    expect(station20).toBeLessThan(mP * 0.6);
    expect(station200).toBeLessThan(0.2);
    const folder = holdemRiverFoldMultiplierOnPeople({ folds: 180, opps: 200 }, 0.5, mP).m;
    expect(folder).toBeGreaterThan(2);
    // a big bet reads the big cell's equilibrium fold, a small bet the small cell's
    expect(holdemPeopleRiverRecordEqFold(true)).toBeGreaterThan(
      holdemPeopleRiverRecordEqFold(false)
    );
    expect(holdemRiverFoldMultiplierOnPeople({ folds: 10, opps: 20 }, 1, 1).m).toBeLessThan(
      holdemRiverFoldMultiplierOnPeople({ folds: 10, opps: 20 }, 0.5, 1).m
    );
    // the fold itself is never certain either way, and its error shrinks with the answers behind it
    expect(holdemPeopleRiverFold(folder, 50, 100)).toBe(0.95);
    expect(holdemPeopleRiverFold(0, 50, 100)).toBe(0.01);
    expect(holdemPeopleRiverFold(1, 50, 100)).toBeCloseTo(50 / 150, 12);
    expect(holdemPeopleRiverFoldSe(0.5, 400)).toBeLessThan(holdemPeopleRiverFoldSe(0.5, 0));
  });

  it("the line is the Horse's own public turn action", () => {
    const h = (rows: Array<[number, string, string]>) =>
      rows.map(([seat, stage, action]) => ({ seat, stage, action }));
    expect(holdemPeopleRiverLineOf(undefined, 1)).toBe('chk');
    expect(
      holdemPeopleRiverLineOf(
        h([
          [1, 'turn', 'check'],
          [2, 'turn', 'check'],
        ]),
        1
      )
    ).toBe('chk');
    expect(
      holdemPeopleRiverLineOf(
        h([
          [1, 'turn', 'bet'],
          [2, 'turn', 'call'],
        ]),
        1
      )
    ).toBe('agg');
    expect(
      holdemPeopleRiverLineOf(
        h([
          [1, 'turn', 'bet'],
          [2, 'turn', 'raise'],
        ]),
        1
      )
    ).toBe('vsAgg');
    expect(
      holdemPeopleRiverLineOf(
        h([
          [1, 'flop', 'bet'],
          [2, 'turn', 'check'],
        ]),
        1
      )
    ).toBe('chk');
  });
});

describe('the river bluff is priced on people: real audited nodes', () => {
  it('the fixture holds missed river bluffs against people, a no-edge check and a correct check', () => {
    expect(bets.length).toBeGreaterThanOrEqual(4);
    expect(new Set(stays.map((n) => n.expect))).toEqual(
      new Set(['holdem_river_people_bluff_no_edge', 'holdem_river_people_bluff_below_check'])
    );
    // only the deciding Horse's own cards are in a fixture hand
    for (const n of FIX.nodes)
      expect(
        Object.keys((n.hand as unknown as { horseHoleCards: object }).horseHoleCards)
      ).toHaveLength(1);
  });

  for (const n of bets) {
    it(`${n.hand.handId}: off checks, on bets one size with its receipt`, () => {
      const rng = saveFastRandom();
      try {
        const st = stateOf(n);
        const off = replayAt(st, prof, SEEDS, PROD);
        expect(off.kinds).toEqual({ check: SEEDS.length });
        for (const v of [false, 1, 'true'])
          expect(replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: v }).kinds).toEqual(off.kinds);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(on.kinds).toEqual({ raise: SEEDS.length });
        expect(on.receipts[BET]).toBe(SEEDS.length);
        expect(new Set(on.sizesBb).size).toBe(1);
        // tournaments are out of scope
        const t = stateOf(n);
        (t.gs as unknown as { gameMode: string }).gameMode = 'tournament';
        const tOn = replayAt(t, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(tOn.receipts[BET] ?? 0).toBe(0);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }

  it("his own river record decides: a station's turns the bet back into a check, an over-folder's keeps it", () => {
    const rng = saveFastRandom();
    let record: { folds: number; opps: number } | null = null;
    const asked: string[] = [];
    HorseMind.setOmahaLifetimeStreetRecordProvider({
      unopenedWagerRecord: () => null,
      stabSizeRecord: () => null,
      firstWagerFoldRecord: (_u, game, street, players, size) => {
        asked.push(`${game}|${street}|${players}|${size}`);
        return record;
      },
    });
    try {
      for (const n of bets) {
        const st = stateOf(n);
        const opts = { ...PROD, [OPTION]: true, mind: true, observeMind: false };
        // (with the mind on, the brain's own baseline bluff may bet a seed before the option is asked)
        record = null;
        const unread = replayAt(st, prof, SEEDS, opts);
        expect(unread.receipts[BET] ?? 0, 'no record').toBeGreaterThanOrEqual(1);
        expect(unread.kinds, 'no record').toEqual({ raise: SEEDS.length });
        record = { folds: 0, opps: 60 };
        const station = replayAt(st, prof, SEEDS, opts);
        expect(station.receipts[BET] ?? 0, 'station').toBe(0);
        expect(station.receipts.holdem_river_people_bluff_below_check, 'station').toBe(
          unread.receipts[BET]
        );
        record = { folds: 54, opps: 60 };
        const folder = replayAt(st, prof, SEEDS, opts);
        expect(folder.receipts[BET], 'over-folder').toBe(unread.receipts[BET]);
        expect(folder.kinds, 'over-folder').toEqual({ raise: SEEDS.length });
      }
      // the record asked for is the NLH heads-up river record, by size
      expect(new Set(asked)).toEqual(new Set(['nlh|river|hu|small', 'nlh|river|hu|big']));
    } finally {
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      restoreFastRandom(rng);
    }
  });

  for (const n of stays) {
    it(`${n.hand.handId}: the check stands (${n.expect})`, () => {
      const rng = saveFastRandom();
      try {
        const st = stateOf(n);
        const off = replayAt(st, prof, SEEDS, PROD);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(on.kinds).toEqual(off.kinds);
        expect(on.kinds).toEqual({ check: SEEDS.length });
        expect(on.receipts[n.expect]).toBe(SEEDS.length);
        expect(on.receipts[BET] ?? 0).toBe(0);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }
});

describe('LAW: the people-priced river bluff is cheap where it applies', () => {
  it('an applicable decision with the option on costs a bounded multiple of the same decision off', () => {
    const spots = FIX.nodes.map((n) => stateOf(n));
    const costSeeds = [1, 7];
    const cost = measureRelativeCost(
      () => {
        for (const st of spots) replayAt(st, prof, costSeeds, { ...PROD, [OPTION]: true });
      },
      () => {
        for (const st of spots) replayAt(st, prof, costSeeds, PROD);
      },
      { warmupRounds: 1, rounds: 5 }
    );
    const n = spots.length * costSeeds.length;
    console.info(
      `[holdem river bluff on people] on ${(cost.subjectMs / n).toFixed(2)} ms, off ${(cost.referenceMs / n).toFixed(2)} ms ` +
        `per decision over ${n} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
