/**
 * LAW: HOLD'EM EMPIRICAL RAISE PRIORS, RANGE-CONDITIONED EQUITY, AND RAISE EV PRICING
 * (Wave 5.4, Horse Switch lane — 100% additive; zero default-ON behavior change).
 *
 * Registry: docs/laws.d/server-src-engine-HoldemEmpiricalRaisePriors.md
 *
 * Enforces five permanent invariants on `server/src/engine/holdemEmpiricalPriors.ts`:
 *   (a) All pre-existing exports (constants & functions from PR #11724) remain 100% unchanged
 *       and `HorseLogic.ts` carries zero default-ON wiring to this module.
 *   (b) `estimateHoldemFoldToRaisePrior` is strictly monotonic in bet/raise size
 *       (`raiseToBetRatio`, `raiseToPotRatio`), street (`flop < turn < river`), stack depth
 *       (`spr`), commitment (`commitmentFactor`), and multiway count (`opponentsInPot`).
 *   (c) `conditionEquityAgainstRaiseCallRange` obeys exact boundary identities (`f = 0 => e`,
 *       `e = 0 => 0`, `e = 1 => 1`), strict interior contraction (`< e` for all `f, e in (0,1)`),
 *       monotone decrease in `f`, monotone increase in `e`, and `[0, 1]` bounds.
 *   (d) `priceHoldemRaiseEv` obeys exact algebraic EV identities across fold, call, raise,
 *       rake, short-stack cap, nuts/air limits, and optional villain 3-bet / jam responses.
 *   (e) Zero hole-card or player-identity leakage (public state & public action counts only).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO,
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT,
  HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT,
  HOLDEM_EMPIRICAL_PRIORS_PROVENANCE,
  HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP,
  HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE,
  HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
  HOLDEM_PRIOR_STRENGTH,
  conditionEquityAgainstRaiseCallRange,
  empiricalBayesShrink,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemFoldToRaisePrior,
  estimateHoldemRiverBluffShare,
  estimateHoldemRiverFoldToRaise,
  estimateHoldemTurnBetFold,
  holdemBetSizeBand,
  holdemEmpiricalFlopCbetFoldPrior,
  holdemRiverBluffShareCell,
  holdemSprBand,
  holdemVillainRaiseCallPrice,
  priceHoldemRaiseEv,
  readHudOpponentStat,
  type HoldemEmpiricalStreet,
  type HoldemFoldToRaisePriorParams,
  type HoldemRaiseEvParams,
} from './holdemEmpiricalPriors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIORS_SOURCE = readFileSync(resolve(HERE, 'holdemEmpiricalPriors.ts'), 'utf8');
const HORSE_LOGIC_SOURCE = readFileSync(resolve(HERE, 'HorseLogic.ts'), 'utf8');

describe('LAW (a): existing holdemEmpiricalPriors exports are 100% unchanged and zero default-ON wiring', () => {
  it('pins all pre-existing exported constants and function outputs verbatim', () => {
    expect(HOLDEM_EMPIRICAL_PRIORS_PROVENANCE.measuredDate).toBe('2026-11-21');
    expect(HOLDEM_PRIOR_STRENGTH).toEqual({
      flopCbetFold: 16,
      turnBetFold: 14,
      riverFoldToRaise: 12,
      riverBluffShare: 8,
      betWhenCheckedTo: 16,
      exploitCountersFallback: 6,
    });
    expect(HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP).toBe(0.95);
    expect(HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.ip.small.rate).toBeCloseTo(1467 / 3869, 12);
    expect(HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET.oop.large.rate).toBeCloseTo(458 / 888, 12);
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate).toBeCloseTo(3286 / 4517, 12);
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise.foldRate).toBeCloseTo(
      266 / 495,
      12
    );
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate).toBeCloseTo(88 / 294, 12);
    expect(HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE).toHaveLength(4);
    expect(HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.turn.rate).toBeCloseTo(3196 / 8206, 12);
    expect(HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT.mono.mult).toBeCloseTo(16 / 47 / (469 / 1074), 12);
    expect(HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT.low.mult).toBeCloseTo(22 / 83 / (247 / 670), 12);

    expect(holdemBetSizeBand(0.33)).toBe('small');
    expect(holdemSprBand(5)).toBe('mid');
    expect(holdemRiverBluffShareCell(0.5).band).toBe('34_67');
    expect(empiricalBayesShrink(5, 10, 0.4, 10).mean).toBeCloseTo(0.45, 12);
    expect(readHudOpponentStat({ eff: { 'r.fRaise': [10, 4] } }, 'r.fRaise')).toEqual({
      opportunities: 10,
      hits: 4,
    });
    expect(holdemVillainRaiseCallPrice(30, 30, 0, 10, 100, 100)).toBeCloseTo(0.25, 12);
    expect(
      holdemEmpiricalFlopCbetFoldPrior({
        bettorInPosition: true,
        potFraction: 0.33,
        texture: 'unpaired_nonmono',
      })
    ).toBeCloseTo(1467 / 3869, 12);
    expect(
      estimateHoldemFlopCbetFold({ bettorInPosition: true, potFraction: 0.5 }).mean
    ).toBeCloseTo(1567 / 3091, 12);
    expect(
      estimateHoldemTurnBetFold({ bettorInPosition: true, potFraction: 0.5 }).mean
    ).toBeCloseTo(792 / 1695, 12);
    expect(estimateHoldemRiverFoldToRaise({ raiseKind: 'non_allin_raise' }).mean).toBeCloseTo(
      266 / 495,
      12
    );
    expect(estimateHoldemRiverBluffShare(0.85).mean).toBeCloseTo(102 / 435, 12);
    expect(estimateHoldemBetWhenCheckedTo('river').mean).toBeCloseTo(1619 / 5180, 12);
  });

  it('keeps HorseLogic.ts completely decoupled (zero live decision changes)', () => {
    expect(HORSE_LOGIC_SOURCE).not.toContain('holdemEmpiricalPriors');
  });
});

describe('LAW (b): estimateHoldemFoldToRaisePrior strict monotonicity across all strategic axes', () => {
  const STREETS: readonly HoldemEmpiricalStreet[] = ['flop', 'turn', 'river'];

  it('is strictly increasing in raiseToBetRatio and raiseToPotRatio on every street', () => {
    const betRatios = [1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 10.0];
    const potRatios = [0.25, 0.5, 0.75, 1.0, 1.5, 2.5, 4.0];

    for (const street of STREETS) {
      for (let i = 1; i < betRatios.length; i++) {
        const lo = estimateHoldemFoldToRaisePrior({ street, raiseToBetRatio: betRatios[i - 1] });
        const hi = estimateHoldemFoldToRaisePrior({ street, raiseToBetRatio: betRatios[i] });
        expect(hi.mean).toBeGreaterThan(lo.mean);
        expect(hi.prior).toBeGreaterThan(lo.prior);
      }
      for (let i = 1; i < potRatios.length; i++) {
        const lo = estimateHoldemFoldToRaisePrior({ street, raiseToPotRatio: potRatios[i - 1] });
        const hi = estimateHoldemFoldToRaisePrior({ street, raiseToPotRatio: potRatios[i] });
        expect(hi.mean).toBeGreaterThan(lo.mean);
        expect(hi.prior).toBeGreaterThan(lo.prior);
      }
    }
  });

  it('is strictly increasing by street (flop < turn < river) across sizing, SPR, and multiway regimes', () => {
    const regimes: readonly Omit<HoldemFoldToRaisePriorParams, 'street'>[] = [
      {},
      { raiseToBetRatio: 2.2, raiseToPotRatio: 0.4, spr: 2, opponentsInPot: 1 },
      { raiseToBetRatio: 3.5, raiseToPotRatio: 1.0, spr: 8, opponentsInPot: 2 },
      { raiseToBetRatio: 4.5, spr: 0.8, commitmentFactor: 0.6, opponentsInPot: 3 },
      { isAllInRaise: true, opponentsInPot: 1 },
    ];
    expect(HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.flop.baseFoldRate).toBeLessThan(
      HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.turn.baseFoldRate
    );
    expect(HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.turn.baseFoldRate).toBeLessThan(
      HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.river.baseFoldRate
    );
    for (const regime of regimes) {
      const f = estimateHoldemFoldToRaisePrior({ street: 'flop', ...regime }).mean;
      const t = estimateHoldemFoldToRaisePrior({ street: 'turn', ...regime }).mean;
      const r = estimateHoldemFoldToRaisePrior({ street: 'river', ...regime }).mean;
      expect(f).toBeLessThan(t);
      expect(t).toBeLessThan(r);
    }
  });

  it('is strictly increasing in SPR and strictly decreasing in commitmentFactor on every street', () => {
    const sprs = [0.1, 0.5, 1.0, 2.0, 4.0, 6.0, 10.0, 20.0];
    const commitments = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];

    for (const street of STREETS) {
      for (let i = 1; i < sprs.length; i++) {
        const lo = estimateHoldemFoldToRaisePrior({ street, spr: sprs[i - 1] });
        const hi = estimateHoldemFoldToRaisePrior({ street, spr: sprs[i] });
        expect(hi.mean).toBeGreaterThan(lo.mean);
      }
      for (let i = 1; i < commitments.length; i++) {
        const loCommit = estimateHoldemFoldToRaisePrior({
          street,
          commitmentFactor: commitments[i - 1],
        });
        const hiCommit = estimateHoldemFoldToRaisePrior({
          street,
          commitmentFactor: commitments[i],
        });
        expect(hiCommit.mean).toBeLessThan(loCommit.mean);
      }
    }
  });

  it('is strictly decreasing in multiway opponentsInPot (1 > 2 > 3 > 4 > 5 > 6) on every street', () => {
    const counts = [1, 2, 3, 4, 5, 6];
    for (const street of STREETS) {
      for (let i = 1; i < counts.length; i++) {
        const fewer = estimateHoldemFoldToRaisePrior({ street, opponentsInPot: counts[i - 1] });
        const more = estimateHoldemFoldToRaisePrior({ street, opponentsInPot: counts[i] });
        expect(more.mean).toBeLessThan(fewer.mean);
        expect(more.bettorMean).toBeLessThan(fewer.bettorMean);
        expect(more.multiwayRetention).toBeLessThan(fewer.multiwayRetention);
      }
    }
  });
});

describe('LAW (c): conditionEquityAgainstRaiseCallRange boundary, interior, and monotonicity invariants', () => {
  const EQUITIES = [0, 0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1];
  const FOLDS = [0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.8, 0.95, 1];

  it('is exact at every boundary point (f=0 => rawEquity, rawEquity=0 => 0, rawEquity=1 => 1)', () => {
    for (const mode of ['smooth', 'sharp'] as const) {
      for (const street of [undefined, 'flop', 'turn', 'river'] as const) {
        const opts = street ? { mode, street } : { mode };
        for (const e of EQUITIES) {
          expect(conditionEquityAgainstRaiseCallRange(e, 0, opts)).toBeCloseTo(e, 12);
        }
        for (const f of FOLDS) {
          expect(conditionEquityAgainstRaiseCallRange(0, f, opts)).toBe(0);
          expect(conditionEquityAgainstRaiseCallRange(1, f, opts)).toBe(1);
        }
        for (const e of EQUITIES) {
          if (e < 1) {
            expect(conditionEquityAgainstRaiseCallRange(e, 1, opts)).toBe(0);
          }
        }
      }
    }
  });

  it('strictly contracts interior equities (< rawEquity) and is bounded in [0, 1]', () => {
    const interiorE = [0.05, 0.2, 0.35, 0.5, 0.7, 0.9, 0.98];
    const interiorF = [0.05, 0.2, 0.4, 0.6, 0.8];

    for (const mode of ['smooth', 'sharp'] as const) {
      for (const street of [undefined, 'flop', 'turn', 'river'] as const) {
        const opts = street ? { mode, street } : { mode };
        for (const e of interiorE) {
          for (const f of interiorF) {
            const c = conditionEquityAgainstRaiseCallRange(e, f, opts);
            expect(Number.isFinite(c)).toBe(true);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
            expect(c).toBeLessThan(e);
          }
        }
      }
    }
  });

  it('is monotonically decreasing in foldToRaiseProb and strictly increasing in rawEquity', () => {
    const interiorE = [0.1, 0.3, 0.5, 0.7, 0.9];
    const folds = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85];

    for (const e of interiorE) {
      for (let i = 1; i < folds.length; i++) {
        // Smooth mode is strictly decreasing in f for every interior e.
        expect(conditionEquityAgainstRaiseCallRange(e, folds[i])).toBeLessThan(
          conditionEquityAgainstRaiseCallRange(e, folds[i - 1])
        );
        // Sharp mode is monotonically non-increasing in f.
        expect(
          conditionEquityAgainstRaiseCallRange(e, folds[i], { mode: 'sharp' })
        ).toBeLessThanOrEqual(
          conditionEquityAgainstRaiseCallRange(e, folds[i - 1], { mode: 'sharp' })
        );
      }
    }

    for (const f of [0, 0.2, 0.45, 0.7]) {
      for (let i = 1; i < EQUITIES.length; i++) {
        expect(conditionEquityAgainstRaiseCallRange(EQUITIES[i], f)).toBeGreaterThan(
          conditionEquityAgainstRaiseCallRange(EQUITIES[i - 1], f)
        );
      }
    }

    // Non-finite inputs never produce NaN or escape [0, 1].
    expect(conditionEquityAgainstRaiseCallRange(Number.NaN, 0.4)).toBe(0);
    expect(conditionEquityAgainstRaiseCallRange(0.5, Number.NaN)).toBe(0.5);
    expect(conditionEquityAgainstRaiseCallRange(1.5, 0.5)).toBe(1);
    expect(conditionEquityAgainstRaiseCallRange(-0.2, 0.5)).toBe(0);
  });
});

describe('LAW (d): priceHoldemRaiseEv exact algebraic EV identities', () => {
  it('satisfies exact base EV identities across boundary and interior spots', () => {
    // 1. f = 1 (villain always folds): EV(raise) === pot * (1 - rake).
    const alwaysFolds = priceHoldemRaiseEv({
      pot: 120,
      toCall: 40,
      heroAdded: 120,
      rawEquity: 0.15,
      foldToRaiseProb: 1,
      rakeFraction: 0.05,
    });
    expect(alwaysFolds.evFold).toBe(0);
    expect(alwaysFolds.evRaise).toBeCloseTo(120 * 0.95, 12);
    expect(alwaysFolds.bestAction).toBe('raise');

    // 2. f = 0 & heroAdded === toCall (raise degenerates to call): EV(raise) === EV(call).
    const degenerateCall = priceHoldemRaiseEv({
      pot: 100,
      toCall: 35,
      heroAdded: 35,
      rawEquity: 0.48,
      foldToRaiseProb: 0,
      rakeFraction: 0.04,
    });
    expect(degenerateCall.villainCall).toBe(0);
    expect(degenerateCall.finalPot).toBe(135);
    expect(degenerateCall.eqWhenCalled).toBeCloseTo(0.48, 12);
    expect(degenerateCall.evRaise).toBeCloseTo(degenerateCall.evCall, 12);

    // 3. rawEquity = 1 (effective nuts, rake = 0): EV(raise) === pot + (1 - f) * villainCall.
    const nuts = priceHoldemRaiseEv({
      pot: 80,
      toCall: 25,
      heroAdded: 95,
      rawEquity: 1,
      foldToRaiseProb: 0.4,
    });
    expect(nuts.villainCall).toBe(70);
    expect(nuts.eqWhenCalled).toBe(1);
    expect(nuts.evCall).toBeCloseTo(80, 12);
    expect(nuts.evRaise).toBeCloseTo(80 + 0.6 * 70, 12);
    expect(nuts.raiseEdgeOverBestPassive).toBeCloseTo(0.6 * 70, 12);
    expect(nuts.bestAction).toBe('raise');

    // 4. rawEquity = 0 (pure air bluff, rake = 0): exact break-even at f* = heroAdded / (pot + heroAdded).
    const pot = 100;
    const heroAdded = 150;
    const fBreakEven = heroAdded / (pot + heroAdded); // 0.60
    const airAtBreakEven = priceHoldemRaiseEv({
      pot,
      toCall: 40,
      heroAdded,
      rawEquity: 0,
      foldToRaiseProb: fBreakEven,
    });
    expect(airAtBreakEven.eqWhenCalled).toBe(0);
    expect(airAtBreakEven.evRaise).toBeCloseTo(0, 12);
    expect(
      priceHoldemRaiseEv({
        pot,
        toCall: 40,
        heroAdded,
        rawEquity: 0,
        foldToRaiseProb: fBreakEven + 0.05,
      }).evRaise
    ).toBeGreaterThan(0);
    expect(
      priceHoldemRaiseEv({
        pot,
        toCall: 40,
        heroAdded,
        rawEquity: 0,
        foldToRaiseProb: fBreakEven - 0.05,
      }).evRaise
    ).toBeLessThan(0);
  });

  it('satisfies exact 3-way algebraic EV identity with villain 3-bet / jam response', () => {
    const pot = 100;
    const toCall = 30;
    const heroAdded = 90;
    const f = 0.35;
    const r3 = 0.1;
    const c = 1 - f - r3;
    const reraiseToCall = 120;

    // Effective nuts calls the 3-bet and wins even more chips than vs pure call.
    const nutsPure = priceHoldemRaiseEv({
      pot,
      toCall,
      heroAdded,
      rawEquity: 1,
      foldToRaiseProb: f,
    });
    const nuts3Bet = priceHoldemRaiseEv({
      pot,
      toCall,
      heroAdded,
      rawEquity: 1,
      foldToRaiseProb: f,
      reraiseResponse: { reraiseProb: r3, reraiseToCall },
    });
    expect(nuts3Bet.callProb).toBeCloseTo(c, 12);
    expect(nuts3Bet.eqVsReraise).toBe(1);
    const expectedNuts3BetBranch = pot + 60 + reraiseToCall;
    expect(nuts3Bet.evOnReraise).toBeCloseTo(expectedNuts3BetBranch, 12);
    expect(nuts3Bet.evRaise).toBeCloseTo(
      f * pot + c * (pot + 60) + r3 * expectedNuts3BetBranch,
      12
    );
    expect(nuts3Bet.evRaise).toBeGreaterThan(nutsPure.evRaise);

    // Medium hand forced to fold to 3-bet loses -effectiveHeroAdded in the r3 branch.
    const med = priceHoldemRaiseEv({
      pot,
      toCall,
      heroAdded,
      rawEquity: 0.45,
      foldToRaiseProb: f,
      reraiseResponse: { reraiseProb: r3, assumeFoldToReraise: true },
    });
    expect(med.evOnReraise).toBe(-heroAdded);
    expect(med.evRaise).toBeCloseTo(
      f * pot + c * (med.eqWhenCalled * 250 - heroAdded) + r3 * -heroAdded,
      12
    );
  });

  it('fixes the v78 committing semi-bluff raise calibration gap (unconditioned over-raises become -EV)', () => {
    // Representative v78 committing turn semi-bluff spot: pot = 100 (includes villain's 40 bet),
    // low SPR = 1.2 (villain pot-committed), hero contemplates committing raise adding 110 with 30% raw equity.
    const pot = 100;
    const toCall = 40;
    const heroAdded = 110;
    const rawEquity = 0.3;

    // Old naive model: high first-bet fold proxy (0.55) + unconditioned rawEquity (0.30) -> falsely +EV!
    const naiveUnconditionedEv =
      0.55 * pot + 0.45 * (rawEquity * (pot + 2 * heroAdded - toCall) - heroAdded);
    expect(naiveUnconditionedEv).toBeGreaterThan(0);

    // Wave 5.4 empirical committed turn fold-to-raise prior + conditioned continuing-range equity -> negative EV!
    const calibrated = priceHoldemRaiseEv({
      pot,
      toCall,
      heroAdded,
      rawEquity,
      priorParams: {
        street: 'turn',
        raiseToBetRatio: heroAdded / toCall,
        raiseToPotRatio: heroAdded / pot,
        spr: 1.2,
        commitmentFactor: 0.55,
        opponentsInPot: 1,
      },
      reraiseResponse: { reraiseProb: 0.08, assumeFoldToReraise: true },
    });
    expect(calibrated.foldToRaiseProb).toBeLessThan(0.35);
    expect(calibrated.eqWhenCalled).toBeLessThan(rawEquity);
    expect(calibrated.evRaise).toBeLessThan(0);
    expect(calibrated.bestAction).not.toBe('raise');
  });
});

describe('LAW (e): zero hole-card or player-identity leakage', () => {
  it('ignores any adversarial hole-card or identity properties injected at runtime', () => {
    const cleanPriorParams: HoldemFoldToRaisePriorParams = {
      street: 'turn',
      raiseToBetRatio: 3.2,
      raiseToPotRatio: 0.85,
      opponentsInPot: 2,
      spr: 4.5,
      commitmentFactor: 0.25,
      opponentSample: { folds: 6, opportunities: 15 },
    };
    const taintedPriorA = {
      ...cleanPriorParams,
      holeCards: ['As', 'Ah'],
      villainCards: ['2c', '7d'],
      userId: 'horse-001',
      isHorse: true,
      isHuman: false,
      seatId: 1,
    } as HoldemFoldToRaisePriorParams;
    const taintedPriorB = {
      ...cleanPriorParams,
      holeCards: ['7c', '2d'],
      villainCards: ['Ks', 'Kh'],
      userId: 'human-999',
      isHorse: false,
      isHuman: true,
      seatId: 6,
    } as HoldemFoldToRaisePriorParams;

    expect(estimateHoldemFoldToRaisePrior(taintedPriorA)).toEqual(
      estimateHoldemFoldToRaisePrior(cleanPriorParams)
    );
    expect(estimateHoldemFoldToRaisePrior(taintedPriorB)).toEqual(
      estimateHoldemFoldToRaisePrior(cleanPriorParams)
    );

    const cleanEvParams: HoldemRaiseEvParams = {
      pot: 120,
      toCall: 40,
      heroAdded: 120,
      rawEquity: 0.45,
      priorParams: cleanPriorParams,
      reraiseResponse: { reraiseProb: 0.08, reraiseToCall: 100 },
    };
    const taintedEv = {
      ...cleanEvParams,
      holeCards: ['Ac', 'Kc'],
      villainHoleCards: ['Qs', 'Qh'],
      userId: 'human-secret',
      isHorse: false,
    } as HoldemRaiseEvParams;

    expect(priceHoldemRaiseEv(taintedEv)).toEqual(priceHoldemRaiseEv(cleanEvParams));
  });

  it('source code carries zero imports of opponentHud, HorseLogic, or Card and never touches hole cards or identities', () => {
    expect(PRIORS_SOURCE).not.toMatch(/from\s+['"][^'"]*opponentHud/);
    expect(PRIORS_SOURCE).not.toMatch(/from\s+['"][^'"]*HorseLogic/);
    expect(PRIORS_SOURCE).not.toMatch(
      /\bholeCards\b|\bvillainCards\b|\buserId\b|\bisHorse\b|\bisHuman\b/
    );
  });
});
