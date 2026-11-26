/**
 * LAW (PLO-OWNER lead-7 2026-11-26; owner orders: "the stats need to be used against human players, not horses";
 * late-street bluffs are "MATH DEPENDANT, AND BLOCKER DEPENDANT, OR HAVE THE RANGE ADVANTAGE"):
 * omahaTurnBluffIsPricedOnBlockers, omahaTurnBluffIsPricedOnRangeAdvantage and omahaRiverBluffIsPricedOnRangeAdvantage
 * (each default OFF), and the people fold behind omahaRiverBluffIsPricedOnBlockers.
 *
 *  1. The fold population is people only: the table says so, and its fit drops every answer by a Horse.
 *  2. People's multiplier is the cell shrunk to equilibrium by the street's k, the line cell to the size cell; a game
 *     outside PLO4 / PLO5 reads equilibrium.
 *  3. The turn price never bets a pure bluff: a hand with no equity when called is never the best bet, however much
 *     he folds; a hand with real equity and fold equity is.
 *  4. On real audited river nodes, with all three options on, every change is a check into a bet (never a raise, never
 *     a fold), and with them off nothing changes.
 *  5. Identity never enters the modules: no person / Horse flag, no name, no account read.
 *  6. (review t3) The turn price reads the Horse's equity against HIS measured range on the board: against a range
 *     all in the strongest bin the equity when called and EV(check) are lower than against a range all in the
 *     weakest bin (before, both read the sampler's uniform holdings and were identical).
 *  7. (review t4) His range (hisCell) is fit from PEOPLE's shown hands only; the Horse's own range (heroCell) is a
 *     separate family of the Horses' own shown hands, and the engine reads each from its own family.
 *  8. (review t5) The people fold fit files each answer under the bettor's line exactly as the engine reads it (the
 *     LAST wager of the street before), and drops answers whose recorded origin is the Horse policy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tables from './HorseOmahaPeopleFoldTables.json' with { type: 'json' };
import { omahaPeopleFoldMultiplier, omahaPeopleRiverCurve } from './HorseOmahaPeopleFold.js';
import { OMAHA_RIVER_FIRST_TO_ACT_RESPONSE } from './HorseOmahaRiverFirstToActBet.js';
import { OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS } from './HorseOmahaStrongHandCheck.js';
import {
  omahaTurnBluffPrice,
  omahaTurnBluffSample,
  type OmahaTurnBluffEquity,
} from './HorseOmahaOpeningBluff.js';
import rangeTables from './HorseOmahaOpeningBluffRangeTables.json' with { type: 'json' };
import { omahaPeopleFoldLineOf } from './HorseOmahaPeopleFold.js';
import type { Card } from '../types.js';
import { OMAHA_RIVER_OPENING_BIN_EDGES } from './HorseOmahaRiverOpeningBet.js';
import {
  RIVER_OPENING_FIXTURE,
  riverOpeningDecide,
} from './HorseOmahaRiverOpeningBet.test-support.js';

const T = tables as unknown as {
  note: string;
  cells: Record<string, { n: number; fold: number; raise: number; eq: number }>;
};
const kind = (a: string) => (a === 'all_in' ? 'bet' : a);

describe('LAW: the PLO opening bluffs are priced on people, and only a check becomes a bet', () => {
  it('the fold population is people only', () => {
    expect(T.note).toContain('People-only answers (responder not a Horse)');
    const fit = readFileSync(
      join(__dirname, '../../../scripts/ops/omaha-people-fold-fit.mjs'),
      'utf8'
    );
    expect(fit).toContain('Horse answers never');
    expect(fit).toMatch(/HORSE\.has\(/);
    expect(Object.keys(T.cells).length).toBeGreaterThan(20);
  });

  it("people's multiplier is the cell shrunk to equilibrium, the line cell to the size cell", () => {
    const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS.river;
    const all = T.cells['plo4|river|all|c70-110'];
    expect(all.n).toBeGreaterThan(30);
    const g = all.eq / all.n;
    const mSize = (all.fold + k * g) / (all.eq + k * g);
    expect(omahaPeopleFoldMultiplier('plo4', 'river', null, 0.9).m).toBeCloseTo(mSize, 10);
    const line = T.cells['plo4|river|agg|c70-110'];
    const gl = line.eq / line.n;
    expect(omahaPeopleFoldMultiplier('plo4', 'river', 'agg', 0.9).m).toBeCloseTo(
      (line.fold + k * gl * mSize) / (line.eq + k * gl),
      10
    );
    expect(omahaPeopleFoldMultiplier('plo6', 'river', 'agg', 0.9)).toEqual({ m: 1, n: 0 });
    expect(omahaPeopleFoldMultiplier('nlh', 'turn', null, 0.9)).toEqual({ m: 1, n: 0 });
  });

  it("omahaRiverBetFoldIsPeopleMeasured: the river bet rules' curve is re-measured on people, his record shrinks to it", () => {
    const pop = OMAHA_RIVER_FIRST_TO_ACT_RESPONSE.plo5;
    const ppl = omahaPeopleRiverCurve('plo5', 'agg', pop);
    expect(ppl.length).toBe(pop.length);
    for (let i = 0; i < pop.length; i++) {
      const s = pop[i].share;
      const m = omahaPeopleFoldMultiplier('plo5', 'river', 'agg', s);
      expect(ppl[i].share).toBe(s);
      expect(1 - ppl[i].cont).toBeCloseTo(Math.max(0.01, Math.min(0.97, (m.m * s) / (1 + s))), 10);
      expect(ppl[i].raise).toBeLessThanOrEqual(ppl[i].cont);
      expect(ppl[i].n).toBe(m.n);
    }
    // outside PLO4 / PLO5 there is no people cell: the curve is unchanged
    expect(omahaPeopleRiverCurve('plo6', 'agg', pop)).toEqual(pop.map((p) => ({ ...p })));
    const src = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(src).toContain(
      'const riverPeopleCurve = opts.omahaRiverBetFoldIsPeopleMeasured === true;'
    );
    expect(src).toMatch(/omahaRiverBetFoldRecordCurve\(\s*variant,\s*base,/);
  });

  it('the turn price never bets a pure bluff; a semi-bluff with fold equity is bet', () => {
    const NB = OMAHA_RIVER_OPENING_BIN_EDGES.length - 1;
    const bins = { mass0: new Array(NB).fill(1), mass: new Array(NB).fill(1) } as never;
    const hist = new Array(NB).fill(1);
    // the Horse's share by his strength bin (strongest first): lower against his strong holdings
    const eqOf = (e: number): OmahaTurnBluffEquity => ({
      all: e,
      bins: {
        got: new Array(NB).fill(500),
        won: Array.from(
          { length: NB },
          (_, b) => 500 * Math.min(1, e * (0.6 + (0.8 * b) / (NB - 1)))
        ),
      },
      samples: 500 * NB,
    });
    const base = {
      hist,
      bins,
      pot: 100,
      amounts: [75, 100],
      rake: 0,
      realization: 0.85,
      raiseBack: 0.03,
      record: null,
      position: 'oop' as const,
      variant: 'plo5',
      line: 'agg' as const,
    };
    const pure = omahaTurnBluffPrice({ ...base, equity: eqOf(0) });
    expect(pure).not.toBeNull();
    expect(pure!.best).toBeNull();
    for (const r of pure!.rows) expect(r.semi).toBe(false);
    const weak = omahaTurnBluffPrice({ ...base, equity: eqOf(0.05) });
    expect(weak!.best).toBeNull();
    const semi = omahaTurnBluffPrice({ ...base, equity: eqOf(0.38) });
    expect(semi).not.toBeNull();
    // a semi-bluff's equity pays back at least half of what a call of the bet needs
    for (const r of semi!.rows)
      if (r.semi)
        expect(0.85 * r.eqCall * (100 + 2 * r.amount)).toBeGreaterThanOrEqual(
          0.5 * r.amount - 1e-6
        );
    for (const v of [0.2, 0.3, 0.38, 0.45, 0.6]) {
      const x = omahaTurnBluffPrice({ ...base, equity: eqOf(v) })!;
      if (x.best) {
        expect(x.best.semi).toBe(true);
        expect(x.best.ev - x.evCheck).toBeGreaterThan(x.best.margin);
      }
    }
  });

  it("review t3: the turn equity is read against HIS range on the board, not the sampler's random holdings", () => {
    const SUIT = { h: 'hearts', s: 'spades', d: 'diamonds', c: 'clubs' } as const;
    const c = (x: string) => ({ rank: x[0], suit: SUIT[x[1] as keyof typeof SUIT] }) as Card;
    const hole = ['Ah', 'Qh', 'Jc', 'Tc'].map(c); // nut flush draw + wrap
    const board = ['9h', '8d', '2h', 'Ks'].map(c);
    const x = omahaTurnBluffSample(hole, board, [])!;
    expect(x).not.toBeNull();
    const NB = OMAHA_RIVER_OPENING_BIN_EDGES.length - 1;
    expect(x.equity.bins.got.length).toBe(NB);
    expect(x.equity.bins.got.reduce((a, b) => a + b, 0)).toBe(x.equity.samples);
    const run = (hist: number[]) =>
      omahaTurnBluffPrice({
        hist,
        bins: x.bins,
        pot: 100,
        amounts: [80],
        rake: 0.05,
        realization: 0.85,
        raiseBack: 0.05,
        record: null,
        position: 'ip',
        equity: x.equity,
        variant: 'plo4',
        line: 'chk',
      })!;
    const strong = run([1, 0, 0, 0, 0, 0, 0, 0]);
    const weak = run([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(strong.rows[0].eqCall).toBeLessThan(weak.rows[0].eqCall - 0.05);
    expect(strong.evCheck).toBeLessThan(weak.evCheck);
    expect(strong.eqAll).toBeLessThan(weak.eqAll - 0.05);
  });

  it("review t4: his range is people-only; the Horse's own range is its own family", () => {
    const R = rangeTables as unknown as {
      note: string;
      cells: Record<string, { hist: number[]; shown: number }>;
      heroCells: Record<string, { hist: number[]; shown: number }>;
    };
    expect(R.note).toContain('cells: PEOPLE only');
    expect(Object.keys(R.cells).length).toBeGreaterThan(20);
    expect(Object.keys(R.heroCells).length).toBeGreaterThan(20);
    const fit = readFileSync(
      join(__dirname, '../../../scripts/ops/omaha-opening-bluff-range-fit.mjs'),
      'utf8'
    );
    expect(fit).toMatch(/HORSE\.has\(u\) \? families\.horse : families\.people/);
    expect(fit).toContain("arg('horses')");
    const src = readFileSync(join(__dirname, 'HorseOmahaOpeningBluff.ts'), 'utf8');
    expect(src).toContain('const his = T.cells[spot.hisCell];');
    expect(src).toContain('const mine = T.heroCells[spot.heroCell];');
    expect(src).not.toMatch(/T\.cells\[spot\.heroCell\]|T\.cells\[heroCell\]/);
  });

  it('review t5: the fold fit files the line the engine reads (the last wager), and drops Horse-policy answers', async () => {
    const mod = (await import(
      join(__dirname, '../../../scripts/ops/omaha-people-fold-fit.mjs')
    )) as { lineOf: (d: unknown[], prev: string, u: number) => string };
    const cases: { seat: number; stage: string; action: string }[][] = [
      // flop: 1 bets, 2 raises, 1 calls: the river/turn bettor 1 faced the aggressor
      [
        { seat: 1, stage: 'flop', action: 'bet' },
        { seat: 2, stage: 'flop', action: 'raise' },
        { seat: 1, stage: 'flop', action: 'call' },
      ],
      [
        { seat: 1, stage: 'flop', action: 'bet' },
        { seat: 2, stage: 'flop', action: 'call' },
      ],
      [
        { seat: 1, stage: 'flop', action: 'check' },
        { seat: 2, stage: 'flop', action: 'check' },
      ],
      [
        { seat: 2, stage: 'flop', action: 'bet' },
        { seat: 1, stage: 'flop', action: 'all_in' },
      ],
    ];
    for (const h of cases)
      for (const seat of [1, 2]) {
        const d = h.map((a) => ({ u: a.seat, street: a.stage, act: a.action }));
        expect(mod.lineOf(d, 'flop', seat)).toBe(omahaPeopleFoldLineOf(h, 'turn', seat));
      }
    expect(
      mod.lineOf(
        cases[0].map((a) => ({ u: a.seat, street: a.stage, act: a.action })),
        'flop',
        1
      )
    ).toBe('vsAgg');
    const fit = readFileSync(
      join(__dirname, '../../../scripts/ops/omaha-people-fold-fit.mjs'),
      'utf8'
    );
    expect(fit).toContain("r.origin === 'horse_policy'");
    expect(T.note).toContain('People-only answers (responder not a Horse)');
  });

  it('on real audited river nodes every change is a check into a bet; off changes nothing', () => {
    const ALL = {
      omahaTurnBluffIsPricedOnBlockers: true,
      omahaTurnBluffIsPricedOnRangeAdvantage: true,
      omahaRiverBluffIsPricedOnRangeAdvantage: true,
    };
    let bets = 0;
    for (const n of RIVER_OPENING_FIXTURE.nodes) {
      expect(kind(riverOpeningDecide(n, {}).action), n.hand).toBe('check');
      const a = kind(riverOpeningDecide(n, ALL).action);
      expect(['check', 'bet'], n.hand).toContain(a);
      if (a === 'bet') bets++;
    }
    expect(bets).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('identity never enters the modules', () => {
    for (const f of ['HorseOmahaOpeningBluff.ts', 'HorseOmahaPeopleFold.ts']) {
      const code = readFileSync(join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const banned of [
        'is_horse',
        'isHorse',
        'humanUserIds',
        'username',
        'omahaOpponentKindOf',
      ])
        expect(code.includes(banned), `${f} ${banned}`).toBe(false);
    }
  });
});
