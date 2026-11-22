/**
 * omahaStabDefenceIsPriced (default OFF; EMERG lane STAB-DEFENCE, 2026-11-20). Law:
 *  1. With no record the share is the population prior exactly; at the population's frequency too.
 *  2. The share rises with the bettor's public bet frequency and never passes 1 - value density
 *     (a player who bets every time bets every value hand: his range is every holding).
 *  3. A bettor below the population's frequency is priced under the prior (a rare bettor is value).
 *  4. The record is shrunk by n / (n + k): one observation barely moves the price.
 *  5. The river pool credit never exceeds the share and never falls under the prior.
 *  6. No cell outside PLO4 / PLO5 turn and river (PLO6 and the flop never read it).
 *  7. The module holds no opponent kind, no hand class and no card: counts and frequencies only (source law).
 *  8. The verdict's share is unchanged while no priced share is given (option off = the read as before).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  omahaStabDefencePriorOpps,
  OMAHA_STAB_DEFENCE_TABLE,
  omahaStabDefencePoolShare,
  omahaStabDefenceShare,
} from './HorseOmahaStabDefence.js';
import { omahaEvBluffShare, OMAHA_EV_UNKNOWN_READ } from './HorseOmahaFacingBetEv.js';

const POP = 0.39;
const rec = (rate: number, opps: number) => ({ bets: rate * opps, opps, popRate: POP });

describe('omahaStabDefenceIsPriced: the priced non-value share (HorseOmahaStabDefence)', () => {
  it('1. no record, an empty record and the population frequency give the prior exactly', () => {
    for (const cell of Object.keys(OMAHA_STAB_DEFENCE_TABLE)) {
      const [variant, street, players] = cell.split('|');
      const opp = players === 'hu' ? 1 : 3;
      for (const q0 of [0.13, 0.19, 0.22, 0.4]) {
        expect(omahaStabDefenceShare(q0, null, variant, street, opp)!.q).toBeCloseTo(q0, 10);
        expect(omahaStabDefenceShare(q0, rec(0.9, 0), variant, street, opp)!.q).toBeCloseTo(q0, 10);
        expect(omahaStabDefenceShare(q0, rec(POP, 500), variant, street, opp)!.q).toBeCloseTo(
          q0,
          10
        );
      }
    }
  });
  it('2. the share rises with his frequency and is capped by 1 - value density', () => {
    let last = -1;
    for (const rate of [0.39, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const s = omahaStabDefenceShare(0.19, rec(rate, 100000), 'plo5', 'river', 1)!;
      expect(s.q).toBeGreaterThanOrEqual(last);
      expect(s.q).toBeLessThanOrEqual(1 - s.density + 1e-9);
      last = s.q;
    }
    const all = omahaStabDefenceShare(0.19, rec(1, 100000), 'plo5', 'river', 1)!;
    expect(all.f).toBe(1);
    expect(all.q).toBeCloseTo(1 - all.density, 2);
  });
  it('3. a bettor under the population frequency is priced under the prior', () => {
    const s = omahaStabDefenceShare(0.22, rec(0.25, 100000), 'plo5', 'turn', 1)!;
    expect(s.q).toBeLessThan(0.22);
    expect(s.q).toBeGreaterThanOrEqual(0.02);
  });
  it('4. shrinkage n / (n + k): one bet barely moves the price, a long record moves it', () => {
    const one = omahaStabDefenceShare(0.19, rec(1, 1), 'plo5', 'river', 1)!;
    const many = omahaStabDefenceShare(0.19, rec(1, 400), 'plo5', 'river', 1)!;
    expect(one.weight).toBeCloseTo(1 / (1 + omahaStabDefencePriorOpps('river', 1)), 10);
    expect(one.q - 0.19).toBeLessThan(0.05);
    expect(many.q).toBeGreaterThan(0.45);
  });
  it('5. the river pool credit lies between the prior and the share', () => {
    for (const q of [0.1, 0.19, 0.3, 0.6, 0.9]) {
      const c = omahaStabDefencePoolShare(q, 0.19, 0.5, 0.2);
      if (q <= 0.19) expect(c).toBe(q);
      else {
        expect(c).toBeLessThanOrEqual(q);
        expect(c).toBeGreaterThanOrEqual(0.19);
      }
    }
  });
  it('6. no cell outside PLO4 / PLO5 turn and river', () => {
    expect(omahaStabDefenceShare(0.19, rec(1, 100), 'plo6', 'river', 1)).toBeNull();
    expect(omahaStabDefenceShare(0.19, rec(1, 100), 'plo5', 'flop', 1)).toBeNull();
    expect(omahaStabDefenceShare(0.19, rec(1, 100), 'nlh', 'river', 1)).toBeNull();
  });
  it('7. source law: counts and frequencies only', () => {
    const src = readFileSync(new URL('./HorseOmahaStabDefence.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of [
      'is_horse',
      'isHorse',
      'kind',
      'person',
      'username',
      'user_id',
      'Card',
      'Math.random',
    ])
      expect(code.includes(banned), banned).toBe(false);
  });
  it('8. the verdict share is the read as before while no priced share is given', () => {
    const read = { ...OMAHA_EV_UNKNOWN_READ, measured: true, betCheckedToRatio: 1.4 };
    const before = omahaEvBluffShare(0.19, read, 'river');
    expect(omahaEvBluffShare(0.19, { ...read, pricedShare: null }, 'river')).toBe(before);
    expect(omahaEvBluffShare(0.19, { ...read, pricedShare: undefined }, 'river')).toBe(before);
    expect(omahaEvBluffShare(0.19, { ...read, pricedShare: 0.5 }, 'river')).toBe(0.5);
  });
});
