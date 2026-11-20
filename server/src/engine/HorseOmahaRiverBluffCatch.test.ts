/**
 * omahaRiverBluffCatchIsPriced (WooWoo RIVER-FACING, default OFF).
 * The recorded spot is the anonymised shape of an audited heads-up river fold
 * (the Horse's own cards, the board and the public numbers only; no ids, no
 * other player's cards).
 */
import { describe, expect, it } from 'vitest';
import { omahaFacingBetEvVerdict, type OmahaFacingBetEvSpot } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_RIVER_BETTOR_ROWS,
  OMAHA_RIVER_U_EDGES,
  omahaRiverBettorBins,
  omahaRiverBluffCatchMixUnit,
  omahaRiverBluffCatchVerdict,
  omahaRiverParseRows,
  omahaRiverPool,
} from './HorseOmahaRiverBluffCatch.js';
import { cardsOf } from './HorseOmahaFacingBetEv.test-support.js';

// Recorded heads-up river spot (journal replay, PLO5, first bet of half the pot).
const RECORDED: OmahaFacingBetEvSpot = {
  street: 'river',
  bettorSeat: 1,
  potFrac: 0.5,
  bucket: 'mid',
  isRaise: false,
  aggressorStreets: 0,
  callerStreets: 1,
  callers: 0,
  allIns: 0,
  behind: 0,
  callerSeats: [],
  paid: 59,
  winnable: 177,
  allIn: false,
  final: true,
  valueShare: 0.08,
  priorBluff: 0.08,
};
const HOLE = cardsOf('8d4c5sJd9d');
const BOARD = cardsOf('5c8sJc5dQc');
const READ = {
  measured: true,
  betCheckedToRatio: 1.2495,
  postflopManiac: false,
  valueLeader: false,
  sizeShown: null,
};
const CTX = {
  rake: 0,
  riskPremium: 0,
  realization: 0.85,
  plo6RiverNuts: true,
  plo6RiverUnpaired: true,
};

describe('omahaRiverBluffCatchIsPriced', () => {
  it('the measured table is the 269 first-bet rows, every row in a bin', () => {
    const rows = omahaRiverParseRows(OMAHA_RIVER_BETTOR_ROWS);
    expect(rows).toHaveLength(269);
    expect(rows.every((r) => r.bin >= 0 && r.bin < OMAHA_RIVER_U_EDGES.length - 1)).toBe(true);
  });

  it('the bin masses are a distribution read continuously at the pot share', () => {
    for (const pf of [0.2, 0.33, 0.5, 0.75, 1, 1.5]) {
      const b = omahaRiverBettorBins(pf);
      expect(b.pi.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
      expect(b.nEff).toBeGreaterThan(0);
    }
    const a = omahaRiverBettorBins(0.5).pi;
    const c = omahaRiverBettorBins(0.52).pi;
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - c[i])).toBeLessThan(0.02);
  });

  it('recorded spot: the serving verdict folds; the option prices it as a bluff-catch and calls', () => {
    const off = omahaFacingBetEvVerdict(RECORDED, HOLE, BOARD, [], READ, CTX);
    expect(off?.call).toBe(false);
    const on = omahaFacingBetEvVerdict(RECORDED, HOLE, BOARD, [], READ, {
      ...CTX,
      riverBluffCatch: { mixUnit: 0.5 },
    });
    expect(on?.riverBluffCatch).toBeDefined();
    expect(on?.realization).toBe(1);
    expect(on?.call).toBe(true);
    expect(on!.ev).toBeGreaterThan(on!.margin);
  });

  it('option absent: the verdict is identical key for key; out of scope it never acts', () => {
    const base = omahaFacingBetEvVerdict(RECORDED, HOLE, BOARD, [], READ, CTX);
    expect(omahaFacingBetEvVerdict(RECORDED, HOLE, BOARD, [], READ, { ...CTX })).toEqual(base);
    const on = { ...CTX, riverBluffCatch: { mixUnit: 0.5 } };
    for (const over of [
      { isRaise: true },
      { callers: 1, callerSeats: [3] },
      { behind: 1 },
      { allIns: 1 },
    ]) {
      const s = { ...RECORDED, ...over } as OmahaFacingBetEvSpot;
      expect(omahaFacingBetEvVerdict(s, HOLE, BOARD, [], READ, on)).toEqual(
        omahaFacingBetEvVerdict(s, HOLE, BOARD, [], READ, CTX)
      );
    }
    const turn = { ...RECORDED, street: 'turn' as const, final: false };
    const tb = BOARD.slice(0, 4);
    expect(omahaFacingBetEvVerdict(turn, HOLE, tb, [], READ, on)).toEqual(
      omahaFacingBetEvVerdict(turn, HOLE, tb, [], READ, CTX)
    );
  });

  it('blockers: removing the Horse cards from the pool moves weight between bins (p_b differs from r_b)', () => {
    const pool = omahaRiverPool(HOLE, BOARD)!;
    expect(pool.p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(pool.r.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(pool.p.some((x, b) => Math.abs(x - pool.r[b]) > 0.005)).toBe(true);
  });

  it('a bettor measured to bluff more raises the equity; one who bluffs less lowers it', () => {
    const at = (k: number) =>
      omahaRiverBluffCatchVerdict(HOLE, BOARD, [], {
        potFrac: 0.5,
        paid: 59,
        winnable: 177,
        rake: 0,
        margin: 4.7,
        readFactor: k,
        mixUnit: 0.5,
      })!.equity;
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(at(0.5));
  });

  it('a close call is mixed on the public draw; a clear one is not', () => {
    const v = omahaRiverBluffCatchVerdict(HOLE, BOARD, [], {
      potFrac: 0.5,
      paid: 59,
      winnable: 177,
      rake: 0,
      margin: 0,
      readFactor: 1,
      mixUnit: 0.5,
    })!;
    const atMargin = omahaRiverBluffCatchVerdict(HOLE, BOARD, [], {
      potFrac: 0.5,
      paid: 59,
      winnable: 177,
      rake: 0,
      margin: v.ev,
      readFactor: 1,
      mixUnit: 0.5,
    })!;
    expect(atMargin.mixed).toBe(true);
    expect(atMargin.pCall).toBeCloseTo(0.5, 6);
    expect(
      omahaRiverBluffCatchVerdict(HOLE, BOARD, [], {
        potFrac: 0.5,
        paid: 59,
        winnable: 177,
        rake: 0,
        margin: v.ev,
        readFactor: 1,
        mixUnit: 0.9,
      })!.call
    ).toBe(false);
    const far = omahaRiverBluffCatchVerdict(HOLE, BOARD, [], {
      potFrac: 0.5,
      paid: 59,
      winnable: 177,
      rake: 0,
      margin: v.ev + 10 * v.se,
      readFactor: 1,
      mixUnit: 0,
    })!;
    expect(far.mixed).toBe(false);
    expect(far.call).toBe(false);
  });

  it('the mixing draw reads only the public key', () => {
    expect(omahaRiverBluffCatchMixUnit('river|x|1')).toBe(omahaRiverBluffCatchMixUnit('river|x|1'));
    const u = omahaRiverBluffCatchMixUnit('river|x|2');
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });
});
