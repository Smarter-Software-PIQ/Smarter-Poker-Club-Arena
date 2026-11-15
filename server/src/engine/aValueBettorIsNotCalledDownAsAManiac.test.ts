/**
 * LATER LAYERS KEEP THE STYLE READ, rule 4 (2026-11-15).
 *
 * styleValueBettorNotManiac kept a value bettor's call-down neutral in the
 * legacy aggression read and fired its receipt, but the newer exploit read
 * then replaced callDownMod with its own maniac widening whenever his
 * bet-when-checked-to engaged high, so the receipt fired and nothing changed
 * (reproduction claim 4 on a796551420a5). The postflop maniac call-down
 * (HorseLogic maniacCallDown) also read him as a postflop maniac and turned
 * folds into calls. Now, with the option on, a value bettor gets no maniac
 * widening from either read and no maniac call-down; the receipt fires once
 * per read where that effect applies. Option off: byte-identical to the
 * commit before.
 *
 * Spot: cash heads-up, Kh9d3s7c; the villain pot-bets the turn (36 into 36).
 * Villain: tight value bettor (vpip .13, pfr .08), lifetime aggression 3.75,
 * big bets shown 8 of which 7 strong, bet-when-checked-to X of 40.
 */
import { describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { isValueBettor } from './HorseOpponentStyle.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { install, turnPotBet, VILLAIN } from './HorseOpponentStyle.contexts.test-support.js';
import {
  decide,
  largeBucket,
  pinAll,
  seeds,
  supply,
  tally,
  valueBettor,
} from './laterLayersKeepTheStyleRead.test-support.js';

const ON = { styleValueBettorNotManiac: true };
const bettor = (bct: number, ftb?: number) => {
  const v = valueBettor(bct);
  if (ftb !== undefined) v.counters!.foldToBet = ftb;
  install(v, 'cash');
  supply(120);
  largeBucket(9);
};
const turn = (bct: number, hand: string, opts: Record<string, unknown>, ftb?: number, n = 60) =>
  seeds(n).map((s) => {
    bettor(bct, ftb);
    return decide(turnPotBet('cash', hand), opts, s);
  });
// Captured on a668406c (before the change).
const BASE: Record<string, string> = {
  'bct=24 Ks5d': '99b4e3062b97ce5ec56b7166',
  'bct=32 Ks5d': 'ba66b6ff93c28b442a7b87bc',
  'bct=20 Ks5d': '182f8a74e608b965bb2db531',
  'bct=20 Ks5d on': '874e0f12feacafc4c3260a64',
  'bct=24 Jd9c': '26dd97668de88378f8e72de2',
  'ftb=8 bct=24 Jd9c': '037b0af15bdd259f0e27d363',
  'ftb=8 bct=32 Jd9c': 'd820142b02f23e767778344b',
  'ftb=8 bct=24 Qd8c': 'b023cff23e9c6b3d82cb49d1',
};

describe('a value bettor is not called down as a maniac', () => {
  it('the read: callDownMod is not widened with the option on, and the receipt fires once per read', () => {
    for (const [bct, off] of [
      [24, 1.363],
      [32, 1.5],
    ] as const) {
      bettor(bct);
      HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
      expect(isValueBettor(HorseMind.styleRead(VILLAIN))).toBe(true);
      expect(HorseMind.opponentRead(VILLAIN)?.stats.betCheckedTo.engaged).toBe('high');
      enableBrainTelemetry();
      drainFires();
      const offMod = HorseMind.exploit(VILLAIN, true, {}).callDownMod;
      const offFires = drainFires().filter(
        (f) => f.feature === 'style_value_bettor_not_maniac_seen'
      );
      const onMod = HorseMind.exploit(VILLAIN, true, { styleValueBettor: true }).callDownMod;
      const onFires = drainFires().filter(
        (f) => f.feature === 'style_value_bettor_not_maniac_seen'
      );
      HorseMind.setDecisionScope(null);
      expect(offMod).toBeCloseTo(off, 3); // before and after: the maniac widening
      expect(offFires).toEqual([]);
      expect(onMod).toBeLessThanOrEqual(1); // before: equal to the option-off figure
      expect(onFires.reduce((a, f) => a + f.fires, 0)).toBe(1);
    }
  });

  it('option off: byte-identical to the commit before', () => {
    expect(pinAll(turn(24, 'Ks5d', {}))).toBe(BASE['bct=24 Ks5d']);
    expect(pinAll(turn(32, 'Ks5d', {}))).toBe(BASE['bct=32 Ks5d']);
    expect(pinAll(turn(20, 'Ks5d', {}))).toBe(BASE['bct=20 Ks5d']);
    expect(pinAll(turn(24, 'Jd9c', {}))).toBe(BASE['bct=24 Jd9c']);
    expect(pinAll(turn(24, 'Jd9c', {}, 8, 40))).toBe(BASE['ftb=8 bct=24 Jd9c']);
    expect(pinAll(turn(32, 'Jd9c', {}, 8, 40))).toBe(BASE['ftb=8 bct=32 Jd9c']);
  });

  it('top pair weak kicker facing his pot bet: the call that rode on the maniac widening becomes the fold', () => {
    // Before: bct 24, call 51 / raise 9 with the option on, identical to off.
    const ds = turn(24, 'Ks5d', ON);
    expect(ds.filter((d) => d.decision.action === 'call').length).toBe(0);
    expect(ds.every((d) => d.fires.style_value_bettor_not_maniac_seen >= 1)).toBe(true);
    // Where the newer read never engaged, the option already worked: unchanged.
    expect(pinAll(turn(20, 'Ks5d', ON))).toBe(BASE['bct=20 Ks5d on']);
  });

  it("the postflop maniac call-down no longer calls a value bettor's bet", () => {
    // Before: with the option on, maniac_call_down turned 27 (bct 24) and 30
    // (bct 32) folds of 40 into calls.
    for (const bct of [24, 32]) {
      const ds = turn(bct, 'Jd9c', ON, 8, 40);
      expect(ds.some((d) => d.fires.maniac_call_down)).toBe(false);
      expect(ds.filter((d) => d.decision.action === 'call').length).toBe(0);
    }
    // A hand the call-down never bought is still the same fold.
    expect(tally(turn(24, 'Qd8c', ON, 8, 40))).toEqual({ fold: 40 });
    expect(pinAll(turn(24, 'Qd8c', {}, 8, 40))).toBe(BASE['ftb=8 bct=24 Qd8c']);
  });
});
