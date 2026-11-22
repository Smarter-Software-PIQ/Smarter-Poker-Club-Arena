/**
 * Unit tests for server/src/engine/holdemEmpiricalPriors.ts.
 *
 * Verifies:
 *   1. Exact arithmetic consistency of every measured NLH pool prior table (hits / n = rate).
 *   2. Empirical-Bayes shrinkage properties (100% pool prior fallback at n = 0 or missing HUD,
 *      smooth monotonic convergence with increasing sample size, zero sample cliffs, NaN safety).
 *   3. OpponentHudStore (`HudPacketOpponent`) stat-key priority (`eff` -> `lc`, context -> street ->
 *      `ExploitCounters` -> `pool_prior`).
 *   4. River fold-to-raise estimator vs river first-bet proxy and corrected villain raise call-price math.
 *   5. River bluff-share proportional scaling and upper cap (0.95).
 */
import { describe, expect, it } from 'vitest';
import {
  HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO,
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT,
  HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT,
  HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP,
  HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE,
  HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
  HOLDEM_PRIOR_STRENGTH,
  HOLDEM_RAISE_PRIOR_MODEL_PARAMS,
  HOLDEM_RAISE_RANGE_TRUNCATION_SHARPNESS,
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
} from './holdemEmpiricalPriors.js';

describe('holdemEmpiricalPriors — measured table integrity', () => {
  it('every empirical rate cell matches hits / n exactly and lies in (0, 1)', () => {
    for (const pos of ['ip', 'oop'] as const) {
      for (const sz of ['small', 'medium', 'large'] as const) {
        const flop = HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos][sz];
        expect(flop.rate).toBeCloseTo(flop.hits / flop.n, 12);
        expect(flop.n).toBeGreaterThan(400);
        expect(flop.rate).toBeGreaterThan(0.2);
        expect(flop.rate).toBeLessThan(0.8);

        const turn = HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos][sz];
        expect(turn.rate).toBeCloseTo(turn.hits / turn.n, 12);
        expect(turn.n).toBeGreaterThan(700);
      }
      // Fold rate increases strictly with bet size on both flop and turn.
      expect(HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos].medium.rate).toBeGreaterThan(
        HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos].small.rate
      );
      expect(HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos].large.rate).toBeGreaterThan(
        HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos].medium.rate
      );
      expect(HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos].medium.rate).toBeGreaterThan(
        HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos].small.rate
      );
      expect(HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos].large.rate).toBeGreaterThan(
        HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos].medium.rate
      );
    }

    // IP bets get strictly higher fold rates than OOP bets at every flop size.
    for (const sz of ['small', 'medium', 'large'] as const) {
      expect(HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.ip[sz].rate).toBeGreaterThan(
        HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.oop[sz].rate
      );
    }

    // River first-bet fold increases strictly with bet size.
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.le_33.rate).toBeLessThan(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate
    );
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate).toBeLessThan(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate
    );
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate).toBeLessThan(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.gt_100.rate
    );

    // River raise responses sum to 1 and all-in jams fold substantially less than non-all-in raises.
    for (const kind of ['non_allin_raise', 'all_in_raise'] as const) {
      const cell = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE[kind];
      expect(cell.folds + cell.calls + cell.reraises).toBe(cell.n);
      expect(cell.foldRate + cell.callRate + cell.reraiseRate).toBeCloseTo(1, 12);
    }
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate).toBeLessThan(0.35);
    expect(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate).toBeLessThan(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise.foldRate
    );

    // River bluff share table: overbets are heavily value-weighted (< 10% bluffs).
    for (const row of HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE) {
      expect(row.bluffShare).toBeCloseTo(row.bluffs / row.n, 12);
      expect(row.weakOrMuckShare).toBeCloseTo(row.weakOrMuck / row.n, 12);
      expect(row.bluffShare).toBeLessThanOrEqual(row.weakOrMuckShare);
    }
    expect(holdemRiverBluffShareCell(1.5).bluffShare).toBeLessThan(0.08);
    expect(holdemRiverBluffShareCell(0.5).bluffShare).toBeLessThan(0.15);

    // Street-specific betWhenCheckedTo: turn is meaningfully higher than flop and river.
    expect(HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.turn.rate).toBeGreaterThan(
      HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.flop.rate
    );
    expect(HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.flop.rate).toBeGreaterThan(
      HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.river.rate
    );
  });

  it('band classifiers and texture/SPR multipliers behave as measured', () => {
    expect(holdemBetSizeBand(0.33)).toBe('small');
    expect(holdemBetSizeBand(0.4)).toBe('small');
    expect(holdemBetSizeBand(0.55)).toBe('medium');
    expect(holdemBetSizeBand(0.7)).toBe('medium');
    expect(holdemBetSizeBand(0.85)).toBe('large');
    expect(holdemSprBand(2.1)).toBe('low');
    expect(holdemSprBand(5.0)).toBe('mid');
    expect(holdemSprBand(11.0)).toBe('deep');

    expect(HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT.paired.mult).toBeGreaterThan(1);
    expect(HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT.mono.mult).toBeLessThan(0.85);
    expect(HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT.low.mult).toBeLessThan(0.8);

    const pairedIp = holdemEmpiricalFlopCbetFoldPrior({
      bettorInPosition: true,
      potFraction: 0.33,
      texture: 'paired',
      spr: 8,
    });
    const monoIp = holdemEmpiricalFlopCbetFoldPrior({
      bettorInPosition: true,
      potFraction: 0.33,
      texture: 'mono',
      spr: 8,
    });
    const lowSprIp = holdemEmpiricalFlopCbetFoldPrior({
      bettorInPosition: true,
      potFraction: 0.33,
      texture: 'unpaired_nonmono',
      spr: 2,
    });
    expect(pairedIp).toBeGreaterThan(0.4);
    expect(monoIp).toBeLessThan(0.31);
    expect(lowSprIp).toBeLessThan(0.3);
  });
});

describe('empiricalBayesShrink and OpponentHudStore integration', () => {
  it('falls back 100% to pool prior when n = 0 or non-finite, and shrinks smoothly without cliffs', () => {
    const empty = empiricalBayesShrink(0, 0, 0.38, 16);
    expect(empty.mean).toBe(0.38);
    expect(empty.weight).toBe(0);
    expect(empty.effectiveN).toBe(0);
    expect(empty.source).toBe('pool_prior');

    const bad = empiricalBayesShrink(Number.NaN, -5, 0.38, 16);
    expect(bad.mean).toBe(0.38);
    expect(bad.source).toBe('pool_prior');

    // Monotonic convergence toward 0.80 as n grows from 1 -> 16 -> 160.
    const n1 = empiricalBayesShrink(0.8, 1, 0.38, 16);
    const n16 = empiricalBayesShrink(12.8, 16, 0.38, 16);
    const n160 = empiricalBayesShrink(128, 160, 0.38, 16);
    expect(n1.mean).toBeGreaterThan(0.38);
    expect(n1.mean).toBeLessThan(n16.mean);
    expect(n16.mean).toBeCloseTo((0.8 + 0.38) / 2, 10);
    expect(n16.weight).toBeCloseTo(0.5, 10);
    expect(n160.mean).toBeGreaterThan(0.75);
    expect(n160.mean).toBeLessThan(0.8);
  });

  it('reads OpponentHudPacket eff first, falls back to lc, and ignores malformed/zero entries', () => {
    expect(readHudOpponentStat(null, 'f.fb.sm.hu')).toBeNull();
    expect(readHudOpponentStat({ eff: { 'f.fb.sm.hu': [0, 0] } }, 'f.fb.sm.hu')).toBeNull();
    expect(
      readHudOpponentStat(
        { eff: { 'f.fb.sm.hu': [20, 12] }, lc: { 'f.fb.sm.hu': [50, 25] } },
        'f.fb.sm.hu'
      )
    ).toEqual({ opportunities: 20, hits: 12 });
    expect(readHudOpponentStat({ eff: {}, lc: { 'f.fb.sm.hu': [50, 25] } }, 'f.fb.sm.hu')).toEqual({
      opportunities: 50,
      hits: 25,
    });
  });

  it('estimateHoldemFlopCbetFold follows HUD context -> HUD street -> ExploitCounters -> pool prior', () => {
    const ctx = { bettorInPosition: true, potFraction: 0.33, texture: 'unpaired_nonmono' as const };
    const pool = estimateHoldemFlopCbetFold(ctx, null, null);
    expect(pool.source).toBe('pool_prior');
    expect(pool.weight).toBe(0);
    expect(pool.mean).toBeCloseTo(HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.ip.small.rate, 10);

    // ExploitCounters fallback when HUD is unavailable (current state before NLH HUD backfill).
    const exp = estimateHoldemFlopCbetFold(ctx, null, { foldToBet: 18, foldToBetOpp: 24 });
    expect(exp.source).toBe('exploit_counters');
    expect(exp.priorStrength).toBe(HOLDEM_PRIOR_STRENGTH.exploitCountersFallback);
    expect(exp.mean).toBeGreaterThan(pool.mean);

    // HUD street overrides ExploitCounters.
    const hudStreet = estimateHoldemFlopCbetFold(
      ctx,
      { eff: { 'f.fBet': [32, 8] } },
      { foldToBet: 18, foldToBetOpp: 24 }
    );
    expect(hudStreet.source).toBe('hud_street');
    expect(hudStreet.mean).toBeLessThan(pool.mean);

    // HUD context (`f.fb.sm.hu`) overrides HUD street (`f.fBet`).
    const hudCtx = estimateHoldemFlopCbetFold(
      ctx,
      { eff: { 'f.fb.sm.hu': [32, 24], 'f.fBet': [32, 8] } },
      { foldToBet: 18, foldToBetOpp: 24 }
    );
    expect(hudCtx.source).toBe('hud_context');
    expect(hudCtx.mean).toBeGreaterThan(0.6);
  });

  it('estimateHoldemTurnBetFold and estimateHoldemBetWhenCheckedTo shrink smoothly', () => {
    const turnPool = estimateHoldemTurnBetFold({ bettorInPosition: true, potFraction: 0.67 });
    expect(turnPool.source).toBe('pool_prior');
    expect(turnPool.mean).toBeCloseTo(HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET.ip.medium.rate, 10);

    const turnHud = estimateHoldemTurnBetFold(
      { bettorInPosition: true, potFraction: 0.67 },
      { eff: { 't.fb.sm.hu': [28, 21] } }
    );
    expect(turnHud.source).toBe('hud_context');
    expect(turnHud.mean).toBeGreaterThan(0.6);

    const ckTurnPool = estimateHoldemBetWhenCheckedTo('turn');
    expect(ckTurnPool.source).toBe('pool_prior');
    expect(ckTurnPool.mean).toBeCloseTo(HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.turn.rate, 10);
    const ckTurnHud = estimateHoldemBetWhenCheckedTo('turn', { eff: { 't.betCk': [40, 32] } });
    expect(ckTurnHud.source).toBe('hud_street');
    expect(ckTurnHud.mean).toBeGreaterThan(0.65);
  });

  it('estimateHoldemRiverFoldToRaise uses true raise prior, bounded price scaling, and r.fRaise', () => {
    const jamPool = estimateHoldemRiverFoldToRaise({ raiseKind: 'all_in_raise' });
    expect(jamPool.source).toBe('pool_prior');
    expect(jamPool.mean).toBeCloseTo(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate,
      10
    );

    // Price scaling stays bounded (never extrapolates to absurd 85% folds on a committed jam).
    const bigJam = estimateHoldemRiverFoldToRaise({
      raiseKind: 'all_in_raise',
      villainCallPrice: 0.45,
    });
    expect(bigJam.mean).toBeGreaterThan(jamPool.mean);
    expect(bigJam.mean).toBeLessThanOrEqual(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate * 1.5 + 1e-9
    );

    // Sticky opponent in HUD (`r.fRaise`: 2 folds in 24 raises) pulls fold estimate sharply down.
    const sticky = estimateHoldemRiverFoldToRaise(
      { raiseKind: 'non_allin_raise' },
      { eff: { 'r.fRaise': [24, 2] } }
    );
    expect(sticky.source).toBe('hud_context');
    expect(sticky.mean).toBeLessThan(0.26);

    // Fallback to `r.fBet` uses doubled prior strength (attenuated).
    const betFallback = estimateHoldemRiverFoldToRaise(
      { raiseKind: 'non_allin_raise' },
      { eff: { 'r.fBet': [24, 2] } }
    );
    expect(betFallback.source).toBe('hud_street');
    expect(betFallback.priorStrength).toBe(HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 2);
    expect(betFallback.mean).toBeGreaterThan(sticky.mean);
  });

  it('estimateHoldemRiverBluffShare scales measured bluff share by HUD/styleSizeShown and caps at 0.95', () => {
    const overbetPool = estimateHoldemRiverBluffShare(1.5);
    expect(overbetPool.source).toBe('pool_prior');
    expect(overbetPool.mean).toBeCloseTo(holdemRiverBluffShareCell(1.5).bluffShare, 10);

    // HUD `vs.r.lead.bg` = 0 strong in 20 large river bets -> weak share = 1.0 -> higher bluff share, capped <= 0.95.
    const maniac = estimateHoldemRiverBluffShare(0.85, { eff: { 'vs.r.lead.bg': [20, 0] } });
    expect(maniac.source).toBe('hud_context');
    expect(maniac.mean).toBeGreaterThan(holdemRiverBluffShareCell(0.85).bluffShare);
    expect(maniac.mean).toBeLessThanOrEqual(HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP);

    // Nit showing 19/20 strong hands on river bets -> bluff share shrinks sharply below pool.
    const nit = estimateHoldemRiverBluffShare(0.85, { eff: { 'vs.r.lead.bg': [20, 19] } });
    expect(nit.mean).toBeLessThan(holdemRiverBluffShareCell(0.85).bluffShare * 0.5);

    // Fallback to HorseMind styleSizeShown when HUD is absent.
    const mindFallback = estimateHoldemRiverBluffShare(0.5, null, { shown: 16, strong: 16 });
    expect(mindFallback.source).toBe('exploit_counters');
    expect(mindFallback.mean).toBeLessThan(holdemRiverBluffShareCell(0.5).bluffShare);
  });

  it('holdemVillainRaiseCallPrice computes villain true pot odds rather than hero total wager', () => {
    // Pot before hero acts = 30 (includes villain's 10 bet: villainIn = 10, heroIn = 0).
    // Hero raises to 30 (heroAdd = 30, villainCall = 20 into potAfterRaise = 60).
    // True villain call price = 20 / (60 + 20) = 0.25 (NOT heroAdd / (pot + heroAdd) = 30 / 60 = 0.50!).
    expect(holdemVillainRaiseCallPrice(30, 30, 0, 10, 100, 100)).toBeCloseTo(0.25, 10);

    // Committed river jam (v51): pot = 60 (villainIn = 20), hero jams 35 (heroAdd = 35, villainCall = 15).
    // True villain call price = 15 / (95 + 15) = 15 / 110 = 0.1364.
    expect(holdemVillainRaiseCallPrice(60, 35, 0, 20, 35, 100)).toBeCloseTo(15 / 110, 10);

    // Villain short stack caps both villainCall and hero's matched wager (uncalled excess excluded).
    // pot = 60 (40 dead + 20 villain), hero jams 100, villain has 10 behind -> matchedHeroAdd = 30,
    // contested pot after hero raise = 90, villain calls 10 to win 100 -> 10 / 100 = 0.10.
    expect(holdemVillainRaiseCallPrice(60, 100, 0, 20, 100, 10)).toBeCloseTo(10 / 100, 10);

    // Exact uncalled-excess symmetry:
    // Short villain: pot=100, heroIn=0, villainIn=50, heroStack=1000, villainStack=10, heroRaiseTo=500
    // -> villainCall=10, matchedHeroAdd=60, potAfterHeroRaise=160 -> 10 / 170.
    expect(holdemVillainRaiseCallPrice(100, 500, 0, 50, 1000, 10)).toBeCloseTo(10 / 170, 10);

    // Short hero: pot=100, heroIn=0, villainIn=50, heroStack=60, villainStack=1000, heroRaiseTo=500
    // -> actualRaiseTo=60, villainCall=10, matchedHeroAdd=60, potAfterHeroRaise=160 -> 10 / 170.
    expect(holdemVillainRaiseCallPrice(100, 500, 0, 50, 60, 1000)).toBeCloseTo(10 / 170, 10);

    // Hero stack cannot even cover villain's existing bet -> villain faces no incremental call (0).
    expect(holdemVillainRaiseCallPrice(100, 500, 0, 50, 40, 1000)).toBe(0);
  });
});

describe('holdemEmpiricalPriors — Wave 5.4 street fold-to-raise priors', () => {
  it('reproduces exact street anchors at reference geometry and exact river all-in anchor', () => {
    for (const street of ['flop', 'turn', 'river'] as const) {
      const base = estimateHoldemFoldToRaisePrior({ street });
      const atRef = estimateHoldemFoldToRaisePrior({
        street,
        raiseToBetRatio: HOLDEM_RAISE_PRIOR_MODEL_PARAMS.referenceRaiseToBet,
        raiseToPotRatio: HOLDEM_RAISE_PRIOR_MODEL_PARAMS.referenceRaiseToPot,
        spr: HOLDEM_RAISE_PRIOR_MODEL_PARAMS.referenceSpr,
        commitmentFactor: 0,
        opponentsInPot: 1,
      });
      expect(base.source).toBe('pool_prior');
      expect(base.weight).toBe(0);
      expect(base.effectiveN).toBe(0);
      expect(base.mean).toBeCloseTo(HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE[street].baseFoldRate, 12);
      expect(atRef.mean).toBeCloseTo(base.mean, 12);
      expect(base.multiwayRetention).toBe(1);
    }

    // River non-all-in and all-in anchors match HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE exactly.
    expect(estimateHoldemFoldToRaisePrior({ street: 'river' }).mean).toBeCloseTo(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise.foldRate,
      12
    );
    expect(
      estimateHoldemFoldToRaisePrior({ street: 'river', isAllInRaise: true }).mean
    ).toBeCloseTo(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate, 12);

    // River at low committed SPR = 0.5 lands near measured all-in jam fold rate (~0.30).
    const committedRiver = estimateHoldemFoldToRaisePrior({ street: 'river', spr: 0.5 });
    expect(committedRiver.mean).toBeGreaterThan(0.25);
    expect(committedRiver.mean).toBeLessThan(0.35);
  });

  it('shrinks smoothly with opponentSample, HUD f/t/r.fRaise, and attenuated HUD f/t/r.fBet fallback', () => {
    const base = estimateHoldemFoldToRaisePrior({
      street: 'turn',
      raiseToBetRatio: 3,
      spr: 5,
    });

    // Direct Beta-Binomial shrinkage with explicit k override: (folds + k * prior) / (n + k).
    const shrunk = estimateHoldemFoldToRaisePrior({
      street: 'turn',
      raiseToBetRatio: 3,
      spr: 5,
      opponentSample: { folds: 2, opportunities: 20 },
      priorStrength: 10,
    });
    expect(shrunk.source).toBe('opponent_sample');
    expect(shrunk.priorStrength).toBe(10);
    expect(shrunk.weight).toBeCloseTo(20 / 30, 12);
    expect(shrunk.mean).toBeCloseTo((2 + 10 * base.prior) / 30, 12);

    // HUD exact street fRaise key beats fBet fallback.
    const hudRaise = estimateHoldemFoldToRaisePrior({
      street: 'flop',
      hudOpp: { eff: { 'f.fRaise': [28, 4], 'f.fBet': [50, 45] } },
    });
    expect(hudRaise.source).toBe('hud_context');
    expect(hudRaise.priorStrength).toBe(HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.flop.priorStrength);
    expect(hudRaise.mean).toBeCloseTo(
      (4 + 14 * HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.flop.baseFoldRate) / (28 + 14),
      12
    );

    // HUD first-bet fallback doubles k (attenuated toward raise prior).
    const hudBetFallback = estimateHoldemFoldToRaisePrior({
      street: 'flop',
      hudOpp: { eff: { 'f.fBet': [28, 4] } },
    });
    expect(hudBetFallback.source).toBe('hud_street');
    expect(hudBetFallback.priorStrength).toBe(
      HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.flop.priorStrength * 2
    );
    expect(hudBetFallback.mean).toBeGreaterThan(hudRaise.mean);

    // Multiway shrinkage applies retention cleanly after shrinking the bettor's own fold rate.
    const mwShrunk = estimateHoldemFoldToRaisePrior({
      street: 'turn',
      opponentsInPot: 3,
      opponentSample: { folds: 15, opportunities: 20 },
      priorStrength: 10,
    });
    expect(mwShrunk.multiwayRetention).toBeCloseTo(
      Math.pow(HOLDEM_RAISE_PRIOR_MODEL_PARAMS.extraOpponentFoldRetention, 2),
      12
    );
    expect(mwShrunk.mean).toBeCloseTo(mwShrunk.bettorMean * mwShrunk.multiwayRetention, 12);
    expect(mwShrunk.prior).toBeCloseTo(mwShrunk.bettorPrior * mwShrunk.multiwayRetention, 12);
  });

  it('handles NaN, negative, and zero-opportunity edge inputs safely', () => {
    const safe = estimateHoldemFoldToRaisePrior({
      street: 'flop',
      raiseToBetRatio: Number.NaN,
      raiseToPotRatio: -5,
      spr: Number.NaN,
      commitmentFactor: Number.NaN,
      opponentsInPot: 0,
      opponentSample: { folds: 5, opportunities: 0 },
      priorStrength: -3,
    });
    expect(Number.isFinite(safe.mean)).toBe(true);
    expect(safe.mean).toBeGreaterThan(0);
    expect(safe.mean).toBeLessThan(1);
    expect(safe.source).toBe('pool_prior');
    expect(safe.multiwayRetention).toBe(1);
    expect(safe.priorStrength).toBe(HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.flop.priorStrength);
  });
});

describe('holdemEmpiricalPriors — Wave 5.4 raise-continuing range equity conditioning', () => {
  it('matches exact analytical formulas in smooth and sharp modes across streets', () => {
    // Default smooth canonical Bayes kernel: e^(1 / (1 - f)).
    expect(conditionEquityAgainstRaiseCallRange(0.5, 0.5)).toBeCloseTo(0.25, 12);
    expect(conditionEquityAgainstRaiseCallRange(0.35, 0.4)).toBeCloseTo(
      Math.pow(0.35, 1 / 0.6),
      12
    );

    // Street-specific sharpness: flop (0.65) > turn (0.85) > river (1.0) retained equity.
    const eqFlop = conditionEquityAgainstRaiseCallRange(0.4, 0.45, { street: 'flop' });
    const eqTurn = conditionEquityAgainstRaiseCallRange(0.4, 0.45, { street: 'turn' });
    const eqRiver = conditionEquityAgainstRaiseCallRange(0.4, 0.45, { street: 'river' });
    expect(eqFlop).toBeCloseTo(
      Math.pow(0.4, 1 + HOLDEM_RAISE_RANGE_TRUNCATION_SHARPNESS.flop * (0.45 / 0.55)),
      12
    );
    expect(eqFlop).toBeGreaterThan(eqTurn);
    expect(eqTurn).toBeGreaterThan(eqRiver);

    // Sharp mode: exact max(0, (e - f) / (1 - f)).
    expect(conditionEquityAgainstRaiseCallRange(0.7, 0.4, { mode: 'sharp' })).toBeCloseTo(0.5, 12);
    expect(conditionEquityAgainstRaiseCallRange(0.3, 0.4, { mode: 'sharp' })).toBe(0);
  });
});

describe('holdemEmpiricalPriors — Wave 5.4 reusable raise EV pricer', () => {
  it('integrates fold prior estimation, conditioned equity, short-stack return, and 3-bet response', () => {
    const res = priceHoldemRaiseEv({
      pot: 100,
      toCall: 30,
      heroAdded: 90,
      rawEquity: 0.42,
      priorParams: {
        street: 'turn',
        raiseToBetRatio: 3,
        raiseToPotRatio: 0.9,
        spr: 4,
        opponentsInPot: 1,
      },
    });
    expect(res.foldPriorEstimate).not.toBeNull();
    expect(res.foldToRaiseProb).toBeCloseTo(res.foldPriorEstimate!.mean, 12);
    expect(res.villainCall).toBe(60);
    expect(res.effectiveHeroAdded).toBe(90);
    expect(res.finalPot).toBe(250);
    expect(res.eqWhenCalled).toBeLessThan(0.42);
    expect(res.evCall).toBeCloseTo(0.42 * 130 - 30, 12);
    expect(res.evRaise).toBeCloseTo(
      res.foldToRaiseProb * 100 + (1 - res.foldToRaiseProb) * (res.eqWhenCalled * 250 - 90),
      12
    );

    // Villain short-stack caps villainCall and returns uncalled chips to hero.
    const shortVillain = priceHoldemRaiseEv({
      pot: 100,
      toCall: 30,
      heroAdded: 120,
      villainCall: 40,
      rawEquity: 0.5,
      foldToRaiseProb: 0.25,
    });
    expect(shortVillain.villainCall).toBe(40);
    expect(shortVillain.effectiveHeroAdded).toBe(70);
    expect(shortVillain.finalPot).toBe(210);

    // Villain 3-bet / jam response reduces EV for medium-equity hands vs pure call response.
    const without3Bet = priceHoldemRaiseEv({
      pot: 100,
      toCall: 30,
      heroAdded: 90,
      rawEquity: 0.55,
      foldToRaiseProb: 0.35,
    });
    const with3Bet = priceHoldemRaiseEv({
      pot: 100,
      toCall: 30,
      heroAdded: 90,
      rawEquity: 0.55,
      foldToRaiseProb: 0.35,
      reraiseResponse: { reraiseProb: 0.12, reraiseToCall: 150 },
    });
    expect(with3Bet.foldToRaiseProb + with3Bet.callProb + with3Bet.reraiseProb).toBeCloseTo(1, 12);
    expect(with3Bet.eqVsReraise).not.toBeNull();
    expect(with3Bet.eqVsReraise!).toBeLessThan(with3Bet.eqWhenCalled);
    expect(with3Bet.evRaise).toBeLessThan(without3Bet.evRaise);
  });
});
