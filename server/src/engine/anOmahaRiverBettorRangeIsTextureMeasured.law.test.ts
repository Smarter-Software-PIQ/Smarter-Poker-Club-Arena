/**
 * LAW (PLO-OWNER lead-8 2026-11-27, lane payoff; owner order "the stats need to be used against human players, not
 * horses"): omahaRiverBettorRangeIsTextureMeasured prices a heads-up PLO4/PLO5 cash river bettor (a bet of 0.4 pot
 * or more, or a raise) on PEOPLE's measured weights on five absolute hand classes of the board, by texture.
 *
 *  1. The population is people only: the generated data says so, and the fit and its export keep the filters (the
 *     bettor is a person, his cards were shown with mucked = false, no Horse bet, no HUD population row).
 *  2. The texture reads WHEN the flush came: by the turn or on the river; a paired board is its own texture.
 *  3. Blockers are counted by the same formula: on a three-flush board the same straight wins a larger share when
 *     the Horse holds the highest card of the suit than when it does not, and nothing else differs.
 *  4. Every answer is a price: the same hand against the same bettor is a call at a small price and a fold at a
 *     large one; no hand class is folded or called whatever the price.
 *  5. The weights are a distribution; an unmeasured cell is people pooled over textures behind the balanced share;
 *     his own record moves the classes under the key category.
 *  6. A bet under 0.4 pot, a six-card hand and a board that is not a river are never priced by it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import {
  OMAHA_EV_UNKNOWN_READ,
  omahaFacingBetEvVerdict,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_RIVER_TEXTURE_ANCHOR_BETS,
  omahaRiverTextureClasses,
  omahaRiverTextureOf,
} from './HorseOmahaRiverTextureClasses.js';
import { OMAHA_RIVER_TEXTURE_CLASSES_DATA } from './HorseOmahaRiverTextureClasses.data.js';

const SUIT: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const cards = (text: string): Card[] =>
  text.split(' ').map((t) => ({ rank: t[0], suit: SUIT[t[1]] }) as Card);

function spotOf(potFrac: number, isRaise = false): OmahaFacingBetEvSpot {
  const pot = 100;
  const bet = potFrac * pot;
  return {
    street: 'river',
    bettorSeat: 1,
    potFrac,
    bucket: potFrac < 0.4 ? 'under40' : potFrac < 0.7 ? 'mid' : potFrac <= 1.1 ? 'big' : 'over',
    isRaise,
    aggressorStreets: 1,
    callerStreets: 0,
    callers: 0,
    allIns: 0,
    behind: 0,
    callerSeats: [],
    paid: bet,
    winnable: pot + bet,
    allIn: false,
    final: true,
    valueShare: 0.2,
    priorBluff: 0.19,
  };
}

function verdict(hole: string, board: string, potFrac: number, isRaise = false) {
  const h = cards(hole);
  const b = cards(board);
  const classes = omahaRiverTextureClasses({
    board: b,
    holeCount: h.length,
    potFrac,
    isRaise,
    balanced: potFrac / (1 + 2 * potFrac),
    recordRatio: 1,
  });
  if (!classes) return null;
  return omahaFacingBetEvVerdict(spotOf(potFrac, isRaise), h, b, [], {
    ...OMAHA_EV_UNKNOWN_READ,
    textureClasses: classes,
  });
}

describe('LAW: the river bettor by board texture is people-measured and counts blockers', () => {
  it('1. the population is people only, and the fit keeps the filters', () => {
    expect(OMAHA_RIVER_TEXTURE_CLASSES_DATA.source).toBe('people-only');
    expect(OMAHA_RIVER_TEXTURE_CLASSES_DATA.filters.hudPopulationRows).toBe('not read');
    const fit = readFileSync(
      join(__dirname, '../../scripts/omaha-river-texture-classes-fit.ts'),
      'utf8'
    );
    expect(fit).toContain('person.get(seat) === true');
    expect(fit).toContain("origin !== 'horse_policy'");
    expect(fit).toContain('live === 2');
    expect(fit).not.toContain('ca_horse_hud');
    const sql = readFileSync(
      join(__dirname, '../../scripts/omaha-river-texture-classes-export.sql'),
      'utf8'
    );
    expect(sql).toContain("coalesce((s->>'mucked')::boolean, true) = false");
    expect(sql).toContain('h.has_human');
    expect(OMAHA_RIVER_TEXTURE_CLASSES_DATA.bets).toBeGreaterThanOrEqual(400);
  });

  it('2. the texture reads when the flush came, and a paired board is its own texture', () => {
    expect(omahaRiverTextureOf(cards('Ks 9s 4s 2d 7h'))).toBe('flushEarly');
    expect(omahaRiverTextureOf(cards('Ks 9s 2d 4s 7h'))).toBe('flushEarly');
    expect(omahaRiverTextureOf(cards('Ks 9s 2d 7h 4s'))).toBe('flushRiver');
    expect(omahaRiverTextureOf(cards('Ks 9s 2d 7h 7s'))).toBe('flushPaired');
    expect(omahaRiverTextureOf(cards('Ks 9c 2d 7h 7s'))).toBe('paired');
    expect(omahaRiverTextureOf(cards('Ks 9c 2d 7h 5s'))).toBe('plain');
    expect(omahaRiverTextureOf(cards('Ks 9c 2d 7h'))).toBeNull();
  });

  it('3. the nut-flush card in the hand removes the nut flush from his range: the same straight wins more', () => {
    // board 9s 8s 2d 7h 4s (the flush came on the river); both hands hold J T for the nut straight
    const without = verdict('Jd Tc 3h 3c', '9s 8s 2d 7h 4s', 0.75)!;
    const withBlocker = verdict('Jd Tc As 3c', '9s 8s 2d 7h 4s', 0.75)!;
    expect(withBlocker.pWin).toBeGreaterThan(without.pWin + 0.08);
    // five cards, the same
    const without5 = verdict('Jd Tc 3h 3c 5d', '9s 8s 2d 7h 4s', 0.75)!;
    const with5 = verdict('Jd Tc As 3c 5d', '9s 8s 2d 7h 4s', 0.75)!;
    expect(with5.pWin).toBeGreaterThan(without5.pWin + 0.08);
  });

  it('4. every answer is a price: the same hand calls a small price and folds a large one', () => {
    const hole = 'Jd Tc 3h 3c';
    const board = '9s 8s 7h 2d 4s';
    const h = cards(hole);
    const b = cards(board);
    const classes = omahaRiverTextureClasses({
      board: b,
      holeCount: 4,
      potFrac: 1,
      isRaise: false,
      balanced: 1 / 3,
      recordRatio: 1,
    })!;
    const read = { ...OMAHA_EV_UNKNOWN_READ, textureClasses: classes };
    const cheap = omahaFacingBetEvVerdict(
      { ...spotOf(1), paid: 10, winnable: 400 },
      h,
      b,
      [],
      read
    )!;
    const dear = omahaFacingBetEvVerdict(
      { ...spotOf(1), paid: 400, winnable: 410 },
      h,
      b,
      [],
      read
    )!;
    expect(cheap.pWin).toBeCloseTo(dear.pWin, 10);
    expect(cheap.call).toBe(true);
    expect(dear.call).toBe(false);
  });

  it('5. the weights are a distribution, thin cells lean on pooled people, his record moves the weakest class', () => {
    const b = cards('Ks 9s 2d 7h 4s');
    const base = omahaRiverTextureClasses({
      board: b,
      holeCount: 5,
      potFrac: 0.9,
      isRaise: false,
      balanced: 0.32,
      recordRatio: 1,
    })!;
    expect(base.weights.length).toBe(5);
    expect(base.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10);
    expect(base.boardShare.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10);
    for (const w of base.weights) expect(w).toBeGreaterThanOrEqual(0);
    // a raise cell of five shown raises is mostly the pooled raise cell
    const raise = omahaRiverTextureClasses({
      board: b,
      holeCount: 5,
      potFrac: 0.9,
      isRaise: true,
      balanced: 0.32,
      recordRatio: 1,
    })!;
    const cell = OMAHA_RIVER_TEXTURE_CLASSES_DATA.cells.flushRiver.raise;
    const pooled = OMAHA_RIVER_TEXTURE_CLASSES_DATA.pooled.raise;
    expect(cell.n).toBeLessThan(OMAHA_RIVER_TEXTURE_ANCHOR_BETS);
    expect(Math.abs(raise.weights[0] - pooled.w[0])).toBeLessThan(
      Math.abs(cell.w[0] - pooled.w[0]) + 0.1
    );
    // his record: a bettor shown weak more often than people gets more weight under the key category, a bettor
    // shown value gets less; the classes keep their split on each side
    const under = (x: { weights: number[] }): number => x.weights[2] + x.weights[3] + x.weights[4];
    const loose = omahaRiverTextureClasses({
      board: b,
      holeCount: 5,
      potFrac: 0.9,
      isRaise: false,
      balanced: 0.32,
      recordRatio: 1.5,
    })!;
    const tight = omahaRiverTextureClasses({
      board: b,
      holeCount: 5,
      potFrac: 0.9,
      isRaise: false,
      balanced: 0.32,
      recordRatio: 0.25,
    })!;
    expect(under(loose)).toBeGreaterThan(under(base));
    expect(under(loose)).toBeLessThanOrEqual(0.65 + 1e-9);
    expect(under(tight)).toBeCloseTo(under(base) * 0.25, 10);
    for (const x of [loose, tight]) {
      expect(x.weights.reduce((p, q) => p + q, 0)).toBeCloseTo(1, 10);
      expect(x.weights[0] / x.weights[1]).toBeCloseTo(base.weights[0] / base.weights[1], 10);
      expect(x.weights[2] / x.weights[4]).toBeCloseTo(base.weights[2] / base.weights[4], 10);
    }
  });

  it('6. a small bet, a six-card hand and a board that is not a river are not priced', () => {
    const b = cards('Ks 9s 2d 7h 4s');
    const input = { board: b, holeCount: 5, isRaise: false, balanced: 0.3, recordRatio: 1 };
    expect(omahaRiverTextureClasses({ ...input, potFrac: 0.39 })).toBeNull();
    expect(omahaRiverTextureClasses({ ...input, potFrac: 0.4 })).not.toBeNull();
    expect(omahaRiverTextureClasses({ ...input, potFrac: 0.2, isRaise: true })).not.toBeNull();
    expect(omahaRiverTextureClasses({ ...input, holeCount: 6, potFrac: 0.8 })).toBeNull();
    expect(omahaRiverTextureClasses({ ...input, board: b.slice(0, 4), potFrac: 0.8 })).toBeNull();
  });
});
