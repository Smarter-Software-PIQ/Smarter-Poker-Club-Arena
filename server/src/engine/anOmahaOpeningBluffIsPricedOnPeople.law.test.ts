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
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tables from './HorseOmahaPeopleFoldTables.json' with { type: 'json' };
import { omahaPeopleFoldMultiplier } from './HorseOmahaPeopleFold.js';
import { OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS } from './HorseOmahaStrongHandCheck.js';
import { omahaTurnBluffPrice, type OmahaTurnBluffEquity } from './HorseOmahaOpeningBluff.js';
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

  it('the turn price never bets a pure bluff; a semi-bluff with fold equity is bet', () => {
    const NB = OMAHA_RIVER_OPENING_BIN_EDGES.length - 1;
    const bins = { mass0: new Array(NB).fill(1), mass: new Array(NB).fill(1) } as never;
    const hist = new Array(NB).fill(1);
    const eqOf = (e: number): OmahaTurnBluffEquity => ({
      all: e,
      tiers: [
        { share: 0.3, eq: e * 0.6 },
        { share: 0.4, eq: e },
        { share: 0.3, eq: Math.min(1, e * 1.4) },
      ],
      samples: 4000,
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
