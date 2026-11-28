/**
 * LAW: THE NLH CASH TURN BLUFF IS PRICED ON PEOPLE'S TURN FOLD BY LINE AND SIZE (holdemTurnBluffIsPricedOnPeople;
 * default OFF, read `=== true`; PLO-OWNER lead-9 lane nlzb 2026-11-27;
 * docs/horse-option-authority.d/holdemTurnBluffIsPricedOnPeople.md).
 *
 *  1. THE FOLD: equilibrium is the anchor (multiplier 1). People's measured fold to a heads-up turn first bet, by the
 *     bettor's line and the bet's size, moves it (answers by PEOPLE only: the table and its fit never count a Horse's
 *     answer), each cell shrunk by 44.4 pseudo-answers. His own lifetime turn record of THIS bet's size SCALES
 *     people's cell (it is by size and cannot see the line) and dominates as it grows; the other size is not read. What people's cells say: a barrel
 *     is at or below equilibrium, a small bet after a checked flop is far above it.
 *  2. REAL AUDITED NODES (the deciding Horse's own cards only): THE OPTION ACTS ONLY AFTER A CHECKED-THROUGH FLOP.
 *     There, off the brain checks and on it bets at one size on every seed with its receipt where the audit found a
 *     missed turn bluff against a person; after a flop wager (a barrel, a lead into the flop bettor) nothing is read
 *     and the brain's own answer stands; a truthy non-boolean is off; a tournament copy is never touched; the river
 *     and the flop of the same hand are never touched; a calling station's own turn record turns the same bet back into a check and an over-folder's keeps
 *     it; a bet that neither blockers nor the range advantage support stays a check; a turn check the audit judged
 *     correct stays a check.
 *  3. THE RECORD'S ROUTE: the provider the decision worker installs serves his NLH heads-up turn cells by size from
 *     the installed NLH packet; no packet, another game's packet or another player is no record.
 *  4. COST: an applicable decision with the option on costs a bounded multiple of the same decision off
 *     (src/testing/relativeCost.ts; theServerSuiteAssertsNoTightWallClockBound forbids a millisecond limit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tables from './HorseHoldemPeopleTurnFoldTables.json' with { type: 'json' };
import {
  HOLDEM_PEOPLE_TURN_FOLD_PRIOR_OPPS,
  holdemPeopleTurnFold,
  holdemPeopleTurnFoldMultiplier,
  holdemPeopleTurnFoldSe,
  holdemPeopleTurnLineOf,
  holdemPeopleTurnRecordCellMultiplier,
  holdemPeopleTurnRecordEqFold,
  holdemPeopleTurnSizeCell,
  holdemTurnFoldMultiplierOnPeople,
} from './HorseHoldemPeopleTurnFold.js';
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
import { buildHudPacket, clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';
import { emptyHudProfile } from './opponentHud/OpponentHudProfile.js';
import { omahaLifetimeStreetRecordHudProvider } from './opponentHud/OmahaTurn4bHudProviders.js';

const OPTION = 'holdemTurnBluffIsPricedOnPeople';
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
    new URL('./HorseHoldemTurnBluffIsPricedOnPeople.fixture.json', import.meta.url),
    'utf8'
  )
) as { nodes: FixNode[]; productionOpts: Record<string, unknown> };
const PROD = FIX.productionOpts;
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7, 42];
const BET = 'holdem_turn_people_bluff_bet';
const bets = FIX.nodes.filter((n) => n.expect === BET);
/** nodes after a flop wager (a barrel, a lead into the flop bettor): out of the option's line, nothing is read */
const outOfLine = FIX.nodes.filter((n) => n.expect === 'none');
const stays = FIX.nodes.filter((n) => n.expect !== BET && n.expect !== 'none');
const stateOf = (n: FixNode) =>
  stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction);
const T = tables as unknown as {
  note: string;
  cells: Record<string, { n: number; fold: number; raise: number; eq: number }>;
};

describe('the people turn fold: the table and the math', () => {
  it('the table holds people-only turn cells and the fit never counts a Horse answer', () => {
    expect(T.note).toMatch(/People-only answers \(responder not a Horse\)/);
    const keys = Object.keys(T.cells);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const [key, c] of Object.entries(T.cells)) {
      expect(key).toMatch(/^turn\|(all|agg|vsAgg|chk)\|(a<40|b40-70|c70-110|d>110|all|sm|bg)$/);
      expect(c.n).toBeGreaterThan(0);
      expect(c.fold).toBeLessThanOrEqual(c.n);
      expect(c.eq).toBeGreaterThan(0);
      expect(c.eq).toBeLessThan(c.n);
    }
    const fit = readFileSync(
      new URL('../../../scripts/ops/holdem-people-turn-fold-fit.mjs', import.meta.url),
      'utf8'
    );
    // an answer by a Horse is dropped before any cell or any prior-strength count
    expect(fit).toMatch(/if \(!a \|\| a\.horse\) continue;/);
    expect(fit.indexOf('if (!a || a.horse) continue;')).toBeLessThan(fit.indexOf('note(`'));
    // the pull it reads selects public actions only: no hole card, showdown or summary column
    const pull = readFileSync(
      new URL('../../../scripts/ops/holdem-people-river-fold-fit.mjs', import.meta.url),
      'utf8'
    );
    expect(
      pull.slice(pull.indexOf('export function pullSql'), pull.indexOf('riverAnswerOf'))
    ).not.toMatch(/hole_cards|showdown|summary|winners/);
  });

  it('equilibrium is the anchor; people move it, each cell shrunk toward its parent', () => {
    expect(holdemPeopleTurnFoldMultiplier(null, 0)).toEqual({ m: 1, n: 0 });
    for (const ratio of [0.33, 0.5, 0.75, 1, 1.5]) {
      const size = holdemPeopleTurnSizeCell(ratio);
      const cell = T.cells[`turn|all|${size}`];
      const raw = cell.fold / cell.eq;
      const { m, n } = holdemPeopleTurnFoldMultiplier(null, ratio);
      expect(n).toBe(cell.n);
      // between the anchor and people's raw multiplier, never past either
      expect(m).toBeGreaterThanOrEqual(Math.min(1, raw) - 1e-12);
      expect(m).toBeLessThanOrEqual(Math.max(1, raw) + 1e-12);
      // a line cell is read between its size cell and its own raw multiplier
      for (const line of ['agg', 'vsAgg', 'chk'] as const) {
        const lc = T.cells[`turn|${line}|${size}`];
        const lr = holdemPeopleTurnFoldMultiplier(line, ratio);
        if (!lc) expect(lr.m).toBeCloseTo(m, 12);
        else {
          const lraw = lc.fold / lc.eq;
          expect(lr.n).toBe(lc.n);
          expect(lr.m).toBeGreaterThanOrEqual(Math.min(m, lraw) - 1e-12);
          expect(lr.m).toBeLessThanOrEqual(Math.max(m, lraw) + 1e-12);
        }
      }
    }
    // what people's cells say: a barrel of two thirds pot or more is folded to LESS than equilibrium, a small bet
    // after a checked flop far more (the turn leak is the small stab, not the barrel)
    expect(holdemPeopleTurnFoldMultiplier('agg', 0.75).m).toBeLessThan(1);
    expect(holdemPeopleTurnFoldMultiplier('chk', 0.33).m).toBeGreaterThan(1.2);
    expect(holdemPeopleTurnFoldMultiplier('chk', 0.33).m).toBeGreaterThan(
      holdemPeopleTurnFoldMultiplier('chk', 0.5).m
    );
    // a lead into the flop bettor is folded to less than equilibrium
    expect(holdemPeopleTurnFoldMultiplier('vsAgg', 0.5).m).toBeLessThan(1);
  });

  it('his own record of this size moves it and dominates as it grows; an unsized record reads every bet', () => {
    const mP = holdemPeopleTurnFoldMultiplier('chk', 0.33).m;
    expect(holdemTurnFoldMultiplierOnPeople(null, 0.33, mP)).toEqual({ m: mP, n: 0 });
    expect(holdemTurnFoldMultiplierOnPeople({ folds: 0, opps: 0 }, 0.33, mP)).toEqual({
      m: mP,
      n: 0,
    });
    const k = HOLDEM_PEOPLE_TURN_FOLD_PRIOR_OPPS;
    const gSm = holdemPeopleTurnRecordEqFold(false);
    const gBg = holdemPeopleTurnRecordEqFold(true);
    const gAll = holdemPeopleTurnRecordEqFold(null);
    expect(gBg).toBeGreaterThan(gAll);
    expect(gAll).toBeGreaterThan(gSm);
    // the formula: m = m_people x rho, rho = [(F + k g M) / (n g + k g)] / M, M people's multiplier of the record's
    // own cell over every line (his record is by size and cannot see the line: it scales people's cell)
    const MSm = holdemPeopleTurnRecordCellMultiplier(false);
    const MBg = holdemPeopleTurnRecordCellMultiplier(true);
    const MAll = holdemPeopleTurnRecordCellMultiplier(null);
    expect(holdemTurnFoldMultiplierOnPeople({ folds: 3, opps: 20 }, 0.33, mP).m).toBeCloseTo(
      (mP * ((3 + k * gSm * MSm) / (20 * gSm + k * gSm))) / MSm,
      12
    );
    expect(holdemTurnFoldMultiplierOnPeople({ folds: 3, opps: 20 }, 1, mP).m).toBeCloseTo(
      (mP * ((3 + k * gBg * MBg) / (20 * gBg + k * gBg))) / MBg,
      12
    );
    expect(holdemTurnFoldMultiplierOnPeople({ folds: 3, opps: 20 }, 0.33, mP, true).m).toBeCloseTo(
      (mP * ((3 + k * gAll * MAll) / (20 * gAll + k * gAll))) / MAll,
      12
    );
    // a player who folds small turn bets exactly as people do overall keeps people's line cell whole, however long
    // his record: the line split is people's, his record cannot see it
    const asPeople = holdemTurnFoldMultiplierOnPeople(
      { folds: 400 * gSm * MSm, opps: 400 },
      0.33,
      mP
    ).m;
    expect(asPeople).toBeCloseTo(mP, 9);
    expect(asPeople).toBeGreaterThan(holdemPeopleTurnFoldMultiplier('agg', 0.33).m);
    // a calling station's record takes the small stab below break-even (m below 1), an over-folder's keeps it
    const station40 = holdemTurnFoldMultiplierOnPeople({ folds: 0, opps: 40 }, 0.33, mP).m;
    const station400 = holdemTurnFoldMultiplierOnPeople({ folds: 0, opps: 400 }, 0.33, mP).m;
    expect(station40).toBeLessThan(1);
    expect(station400).toBeLessThan(0.2);
    expect(holdemPeopleTurnFold(station40, 33, 100)).toBeLessThan(33 / 133);
    const folder = holdemTurnFoldMultiplierOnPeople({ folds: 360, opps: 400 }, 0.33, mP).m;
    expect(folder).toBeGreaterThan(2);
    // the fold itself is never certain either way, and its error shrinks with the answers behind it
    expect(holdemPeopleTurnFold(folder, 100, 100)).toBe(0.95);
    expect(holdemPeopleTurnFold(0, 50, 100)).toBe(0.01);
    expect(holdemPeopleTurnFold(1, 50, 100)).toBeCloseTo(50 / 150, 12);
    expect(holdemPeopleTurnFoldSe(0.5, 400)).toBeLessThan(holdemPeopleTurnFoldSe(0.5, 0));
  });

  it("the line is the Horse's own public flop action", () => {
    const h = (rows: Array<[number, string, string]>) =>
      rows.map(([seat, stage, action]) => ({ seat, stage, action }));
    expect(holdemPeopleTurnLineOf(undefined, 1)).toBe('chk');
    expect(
      holdemPeopleTurnLineOf(
        h([
          [1, 'flop', 'check'],
          [2, 'flop', 'check'],
        ]),
        1
      )
    ).toBe('chk');
    expect(
      holdemPeopleTurnLineOf(
        h([
          [1, 'flop', 'bet'],
          [2, 'flop', 'call'],
        ]),
        1
      )
    ).toBe('agg');
    expect(
      holdemPeopleTurnLineOf(
        h([
          [1, 'flop', 'bet'],
          [2, 'flop', 'raise'],
          [1, 'flop', 'call'],
        ]),
        1
      )
    ).toBe('vsAgg');
    expect(
      holdemPeopleTurnLineOf(
        h([
          [1, 'preflop', 'raise'],
          [2, 'flop', 'check'],
          [1, 'turn', 'bet'],
        ]),
        1
      )
    ).toBe('chk');
  });
});

describe('the turn bluff is priced on people: real audited nodes', () => {
  it('the fixture holds missed turn bets against people, a no-edge check and correct checks', () => {
    expect(bets.length).toBeGreaterThanOrEqual(2);
    expect(outOfLine.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stays.map((n) => n.expect))).toEqual(
      new Set(['holdem_turn_people_bluff_no_edge', 'holdem_turn_people_bluff_below_check'])
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

  it('only the turn is touched: every other Horse decision of the fixture hands is the same on and off', () => {
    const rng = saveFastRandom();
    try {
      for (const n of FIX.nodes) {
        const mine = n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction;
        for (const a of n.hand.actions) {
          if (a.seat !== mine.seat || a.stage === 'turn' || a.ord === n.ord) continue;
          if (!['check', 'bet', 'call', 'fold', 'raise'].includes(String(a.action))) continue;
          let st;
          try {
            st = stateAt(n.hand, a as ComplaintAction);
          } catch {
            continue;
          }
          const off = replayAt(st, prof, [1, 7], PROD);
          const on = replayAt(st, prof, [1, 7], { ...PROD, [OPTION]: true });
          expect(on.kinds, `${n.hand.handId} ${String(a.stage)} ${a.ord}`).toEqual(off.kinds);
          expect(on.sizesBb).toEqual(off.sizesBb);
          for (const k of Object.keys(on.receipts))
            expect(k.startsWith('holdem_turn_people_bluff')).toBe(false);
        }
      }
    } finally {
      restoreFastRandom(rng);
    }
  });

  it("his own turn record decides: a station's turns the bet back into a check, an over-folder's keeps it", () => {
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
    let keptAll = 0;
    try {
      for (const n of bets) {
        const st = stateOf(n);
        const opts = { ...PROD, [OPTION]: true, mind: true, observeMind: false };
        // (with the mind on, the brain's own baseline bluff may bet a seed before the option is asked)
        record = null;
        const unread = replayAt(st, prof, SEEDS, opts);
        expect(unread.receipts[BET] ?? 0, 'no record').toBeGreaterThanOrEqual(1);
        expect(unread.kinds, 'no record').toEqual({ raise: SEEDS.length });
        record = { folds: 0, opps: 120 };
        const station = replayAt(st, prof, SEEDS, opts);
        expect(station.receipts[BET] ?? 0, 'station').toBe(0);
        expect(station.receipts.holdem_turn_people_bluff_below_check, 'station').toBe(
          unread.receipts[BET]
        );
        // an over-folder's record never prices the bet below the check: the bet stands, unless at his higher fold
        // the Horse's cards no longer block his calling part and its range is not the stronger one (no edge)
        record = { folds: 108, opps: 120 };
        const folder = replayAt(st, prof, SEEDS, opts);
        const kept = folder.receipts[BET] ?? 0;
        expect(folder.receipts.holdem_turn_people_bluff_below_check ?? 0, 'over-folder').toBe(0);
        expect(kept + (folder.receipts.holdem_turn_people_bluff_no_edge ?? 0), 'over-folder').toBe(
          unread.receipts[BET]
        );
        if (kept === unread.receipts[BET]) keptAll++;
      }
      // the over-folder's record keeps the bet on at least one node outright
      expect(keptAll).toBeGreaterThanOrEqual(1);
      // the record asked for is the NLH heads-up turn record, by size
      expect(new Set(asked)).toEqual(new Set(['nlh|turn|hu|small', 'nlh|turn|hu|big']));
    } finally {
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      restoreFastRandom(rng);
    }
  });

  for (const n of outOfLine) {
    it(`${n.hand.handId}: after a flop wager the option stands aside (no receipt, the brain's own answer)`, () => {
      const rng = saveFastRandom();
      try {
        const st = stateOf(n);
        const off = replayAt(st, prof, SEEDS, PROD);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [OPTION]: true });
        expect(on.kinds).toEqual(off.kinds);
        expect(on.sizesBb).toEqual(off.sizesBb);
        for (const k of Object.keys(on.receipts))
          expect(k.startsWith('holdem_turn_people_bluff')).toBe(false);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }

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

describe('his lifetime turn record reaches the decision through the installed NLH packet', () => {
  it('the worker provider serves the NLH heads-up turn cells by size; no packet or another family is no record', () => {
    const OPP = '50000000-0000-4000-8000-0000000000e2';
    const AT = Date.UTC(2099, 0, 1, 0, 0, 30);
    const packet = (family: 'nlh' | 'plo5') => {
      const profile = emptyHudProfile(OPP, family);
      profile.hands = 400;
      profile.recAt = AT;
      profile.life['t.fb.sm.hu'] = [60, 42];
      profile.life['t.fb.bg.hu'] = [50, 35];
      // a multiway cell and a river cell are never read for it
      profile.life['t.fb.sm.mw'] = [90, 9];
      profile.life['r.fb.sm.hu'] = [80, 8];
      return buildHudPacket(family, [profile], {}, AT, 'turn');
    };
    const none = { foldSmall: null, foldBig: null };
    try {
      // no provider installed: no record
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
      installDecisionHud(packet('nlh'));
      expect(HorseMind.holdemTurnFirstWagerFoldRecordOf(OPP)).toEqual(none);
      // the provider the decision worker installs (installOmahaTurn4bHudProviders)
      HorseMind.setOmahaLifetimeStreetRecordProvider(omahaLifetimeStreetRecordHudProvider);
      expect(HorseMind.holdemTurnFirstWagerFoldRecordOf(OPP)).toEqual({
        foldSmall: { folds: 42, opps: 60 },
        foldBig: { folds: 35, opps: 50 },
      });
      expect(HorseMind.holdemTurnFirstWagerFoldRecordOf('somebody-else')).toEqual(none);
      // a packet of another game is not his NLH record; no packet is no record
      installDecisionHud(packet('plo5'));
      expect(HorseMind.holdemTurnFirstWagerFoldRecordOf(OPP)).toEqual(none);
      clearDecisionHud();
      expect(HorseMind.holdemTurnFirstWagerFoldRecordOf(OPP)).toEqual(none);
    } finally {
      clearDecisionHud();
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    }
  });
});

describe('LAW: the people-priced turn bluff is cheap where it applies', () => {
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
      `[holdem turn bluff on people] on ${(cost.subjectMs / n).toFixed(2)} ms, off ${(cost.referenceMs / n).toFixed(2)} ms ` +
        `per decision over ${n} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
