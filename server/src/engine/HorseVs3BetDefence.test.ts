/**
 * V73 THE OPENER FACING A 3-BET (2026-11-01). Every frequency is measured end
 * to end through HorseLogic.decide (every graph owner after the preflop
 * reference included, Dan's dominated-offsuit fold among them), weighted by
 * the opener's own measured open range, with the dealt census set as the live
 * engine sets it. See docs/changelog/2026-11-01-horse-nlh-vs-3bet-defence.md.
 */
import { describe, expect, it } from 'vitest';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  V73_EQUITY_MULTIPLIER,
  VS3_CONTINUE_CHARTS,
  referenceMdf,
  vs3BetMdf,
  continueShare,
  continueWidth,
  openWidth,
  styledOpenWidth,
  vs3BetContinueOrder,
  type Vs3BetSpot,
} from './HorseGtoVs3BetRanges.js';
import { vs3, type Vs3Ctx } from './HorseVs3BetDefence.test-support.js';

const CASH6: Vs3Ctx = {
  seats: 6,
  stackBB: 100,
  mode: 'cash',
  ante: false,
  openBB: 2.5,
  threeBetX: 4,
};
const CASH6_IP3X: Vs3Ctx = { ...CASH6, threeBetX: 3 };
const MTT9: Vs3Ctx = {
  seats: 9,
  stackBB: 50,
  mode: 'tournament',
  ante: true,
  openBB: 2.2,
  threeBetX: 4,
};
const OFF = { v73Vs3BetDefence: false };

// 6-max seats: UTG 3, HJ 4, CO 5, BTN 6, SB 1, BB 2.
describe('V73 reference base (module)', () => {
  const spot = (over: Partial<Vs3BetSpot>): Vs3BetSpot => ({
    openerBehind: 2,
    ip: true,
    ante: false,
    dealt: 6,
    threeBetX: 4,
    // A 2.5bb open, blinds 1.5bb, a big-blind 3-bet to 10bb (9bb new).
    potBeforeBB: 4,
    reRaiseRiskBB: 9,
    effectiveBB: 100,
    deepDiscipline: true,
    ...over,
  });

  it('every continue order is a permutation of the 169 classes', () => {
    for (let k = 1; k <= 8; k++) expect(new Set(vs3BetContinueOrder(k)).size).toBe(169);
  });

  it('the charts hold pairs, suited hands and AKo / AQo only (the rest fold by Dan rule 1)', () => {
    for (const chart of [VS3_CONTINUE_CHARTS.late, VS3_CONTINUE_CHARTS.early]) {
      for (const cls of Object.keys(chart)) {
        const offsuit = cls.length === 3 && cls[2] === 'o';
        if (offsuit) expect(['AKo', 'AQo']).toContain(cls);
      }
    }
  });

  it('the price is the minimum defence frequency of this 3-bet into this pot', () => {
    expect(vs3BetMdf(4, 9)).toBeCloseTo(4 / 13, 9);
    expect(referenceMdf(2, true)).toBeCloseTo(4 / 13, 9);
    expect(referenceMdf(3, false)).toBeCloseTo(4 / 11.5, 9);
    expect(referenceMdf(1, false)).toBeCloseTo(4 / 12, 9);
    // At the reference geometry the share is MDF x the seat multiplier.
    expect(continueShare(spot({}))).toBeCloseTo(100 * (4 / 13) * V73_EQUITY_MULTIPLIER.ip[2], 9);
  });

  it('the multiplier rises as the opener moves earlier, and sits higher in position', () => {
    for (const side of ['ip', 'oop'] as const) {
      const t = V73_EQUITY_MULTIPLIER[side];
      const ks = Object.keys(t)
        .map(Number)
        .sort((a, b) => a - b);
      for (let i = 1; i < ks.length; i++) expect(t[ks[i]]).toBeGreaterThan(t[ks[i - 1]]);
    }
    for (let k = 3; k <= 8; k++)
      expect(V73_EQUITY_MULTIPLIER.ip[k]).toBeGreaterThan(V73_EQUITY_MULTIPLIER.oop[k]);
  });

  it('a bigger 3-bet is continued narrower, a smaller one wider, an ante wider', () => {
    const base = continueShare(spot({}));
    // To 12.5bb (11.5 new) and to 7.5bb (6.5 new) against the same 2.5bb open.
    expect(continueShare(spot({ reRaiseRiskBB: 11.5, threeBetX: 5 }))).toBeLessThan(base - 3);
    expect(continueShare(spot({ reRaiseRiskBB: 6.5, threeBetX: 3 }))).toBeGreaterThan(base + 3);
    // A 1bb ante is dead money the 3-bet also attacks.
    expect(continueShare(spot({ potBeforeBB: 5, ante: true }))).toBeGreaterThan(base);
  });

  it('the V21 deep scale narrows the width by at most 5%, and only with the discipline on', () => {
    const base = continueShare(spot({}));
    const deep = continueShare(spot({ effectiveBB: 300 }));
    expect(deep).toBeLessThan(base);
    expect(deep).toBeGreaterThanOrEqual(base * 0.95 - 1e-9);
    expect(continueShare(spot({ effectiveBB: 300, deepDiscipline: false }))).toBeCloseTo(base, 9);
  });

  it('the width is a share of the open the style actually makes', () => {
    expect(styledOpenWidth(2, false, 6, 1)).toBe(openWidth(2, false, 6));
    expect(styledOpenWidth(2, false, 6, 1.12)).toBeLessThan(openWidth(2, false, 6));
    expect(styledOpenWidth(2, false, 6, 0.9)).toBeGreaterThan(openWidth(2, false, 6));
    expect(continueWidth(spot({ tightness: 1.12 }))).toBeLessThan(continueWidth(spot({})));
  });

  it('the button continue width holds suited connectors and small pairs; the UTG width does not', () => {
    const combos = Object.fromEntries(HAND_CLASSES.map((h) => [h.cls, h.combos]));
    const shareAt = (k: number, cls: string) => {
      let cum = 0;
      for (const c of vs3BetContinueOrder(k)) {
        if (c === cls) return (100 * cum) / 1326;
        cum += combos[c];
      }
      return 100;
    };
    const btn = continueWidth(spot({}));
    const utg = continueWidth(spot({ openerBehind: 5 }));
    for (const cls of ['76s', '65s', '22', 'K9s', 'A2s']) expect(shareAt(2, cls)).toBeLessThan(btn);
    for (const cls of ['76s', '65s', 'K9s']) expect(shareAt(5, cls)).toBeGreaterThan(utg);
  });
});

describe('V73 end to end (cash 6-max 100bb, 2.5x open, 3-bet 4x from the big blind)', () => {
  const on = {
    btn: vs3(CASH6, 6, 2),
    co: vs3(CASH6, 5, 2),
    utg: vs3(CASH6, 3, 2),
  };
  const off = {
    btn: vs3(CASH6, 6, 2, OFF),
    co: vs3(CASH6, 5, 2, OFF),
  };

  it('the legacy fixed bar overfolds the wide opens (the measured defect)', () => {
    expect(off.btn.fold).toBeGreaterThan(68);
    expect(off.co.fold).toBeGreaterThan(54);
  });

  it('the opener folds a sound share: the wider the open, the more it folds', () => {
    expect(on.btn.fold).toBeGreaterThan(48);
    expect(on.btn.fold).toBeLessThan(60);
    expect(on.co.fold).toBeGreaterThan(42);
    expect(on.co.fold).toBeLessThan(55);
    expect(on.utg.fold).toBeGreaterThan(32);
    expect(on.utg.fold).toBeLessThan(47);
    expect(on.btn.fold).toBeGreaterThan(on.utg.fold + 6);
    expect(on.btn.fold).toBeLessThan(off.btn.fold - 12);
    expect(on.co.fold).toBeLessThan(off.co.fold - 6);
  });

  it('the 4-bet range is unchanged (value 4-bets and bluffs read the legacy bars)', () => {
    expect(on.btn.fourBet).toBeCloseTo(off.btn.fourBet, 6);
    expect(on.co.fourBet).toBeCloseTo(off.co.fourBet, 6);
  });

  it('the button continues the suited hands and pairs the legacy bar folded', () => {
    for (const cls of ['76s', '65s', '98s', 'T9s', 'J9s', 'K9s', '33', '22']) {
      expect(off.btn.byClass.get(cls)!).toBeLessThan(0.5);
      expect(on.btn.byClass.get(cls)!).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("dominated offsuit hands still fold to the big 3-bet (Dan's 2026-10-25 rule)", () => {
    for (const cls of ['KQo', 'AJo', 'KJo', 'QJo', 'ATo', 'JTo']) {
      expect(on.btn.byClass.get(cls) ?? 0).toBe(0);
      expect(on.co.byClass.get(cls) ?? 0).toBe(0);
    }
  });

  it('who the players are never changes the answer', () => {
    const flipped = vs3(CASH6, 6, 2, {}, 6, 'balanced', true);
    expect(flipped.fold).toBeCloseTo(on.btn.fold, 6);
    expect(flipped.call).toBeCloseTo(on.btn.call, 6);
  });
});

describe('V73 out of position, styles and the ante tournament', () => {
  it('the cutoff out of position to a 3x button 3-bet folds in the band', () => {
    const co = vs3(CASH6_IP3X, 5, 6);
    expect(co.fold).toBeGreaterThan(40);
    expect(co.fold).toBeLessThan(56);
  });

  it('every style folds a similar share of its own open on the button', () => {
    for (const style of ['tag', 'lag', 'grinder'] as const) {
      const m = vs3(CASH6, 6, 2, {}, 4, style);
      expect(m.fold).toBeGreaterThan(46);
      expect(m.fold).toBeLessThan(62);
    }
  });

  it('MTT 9-max 50bb with a big blind ante: the button folds far less than before', () => {
    const btnOn = vs3(MTT9, 9, 2, {}, 4);
    const btnOff = vs3(MTT9, 9, 2, OFF, 4);
    expect(btnOff.fold).toBeGreaterThan(72);
    expect(btnOn.fold).toBeGreaterThan(45);
    expect(btnOn.fold).toBeLessThan(62);
  });
});
