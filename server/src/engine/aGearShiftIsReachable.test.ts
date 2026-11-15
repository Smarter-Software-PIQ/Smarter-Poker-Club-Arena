/**
 * A GEAR SHIFT IS REACHABLE (2026-11-15, Hold'em Strategy lane, opponent classifier C5; option holdemGearShiftReach,
 * read === true, default OFF). Audit I: the gear-shift branch of opponentExploitRead judged the 8-hand window at 0.95
 * and was never tried once the long mean crossed the envelope edge (there the 0.97 fast-engage line applied alone).
 * With the option on a confirmed regime break (styleShiftReleased) is judged at the ordinary credibility on the
 * aggressive statistics, high side only. Declared before measurement:
 * docs/changelog/2026-11-15-a-gear-shift-is-reachable.md. Synthetic counters only.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPLOIT_CREDIBILITY,
  GEAR_SHIFT_REACH,
  freshExploitCounters,
  maniacRaiseWidth,
  opponentExploitRead,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { MANIAC_READ_GRID_BASE_PIN, maniacReadGridPin } from './maniacReadGrid.test-support.js';

type Size = 'full' | 'short' | 'hu';
const FAST = 12.05;
/** A player with `hands` decayed hands whose last ~12 hands hold k raises after a calmer history at r0. */
function shifter(r0: number, hands: number, k: number): ExploitCounters {
  const c = freshExploitCounters();
  c.fHands = FAST;
  c.fPfr = k;
  c.fRfiOpp = FAST * 0.6;
  c.fRfi = Math.min(c.fRfiOpp, k * 0.6);
  c.hands = hands;
  c.pfr = (hands - FAST) * r0 + k * 0.7;
  c.vpip = c.pfr + 2;
  c.rfiOpp = hands * 0.6;
  c.rfi = c.pfr * 0.6;
  return c;
}
const read = (c: ExploitCounters, size: Size, on: boolean, variant = 'nlh') =>
  opponentExploitRead(
    c,
    `holdem:${size}` as never,
    variant,
    [],
    on ? { gearShift: true } : undefined
  );
const pfrOn = (c: ExploitCounters, size: Size, on: boolean) =>
  read(c, size, on)?.stats.pfr.engaged === 'high';

describe('the reach uses no new threshold', () => {
  it('is the ordinary read credibility', () => {
    expect(GEAR_SHIFT_REACH.credibility).toBe(EXPLOIT_CREDIBILITY);
  });
});

describe('G1: a tight full-ring player who starts attacking is read one raise earlier', () => {
  for (const [r0, hands] of [
    [0.08, 20],
    [0.08, 40],
    [0.12, 20],
    [0.12, 40],
    [0.18, 20],
    [0.18, 40],
  ] as const)
    it(`history ${r0} on ${hands} hands: 6 raises in the last 12 engage with the option, not without`, () => {
      const c = shifter(r0, hands, 6);
      expect(pfrOn(c, 'full', false)).toBe(false);
      expect(pfrOn(c, 'full', true)).toBe(true);
      expect(maniacRaiseWidth(read(c, 'full', false))).toBeNull();
      expect(maniacRaiseWidth(read(c, 'full', true))).not.toBeNull();
    });
  it('the long mean past the edge but short of the 0.97 fast line: 7 raises engage with the option', () => {
    const c = shifter(0.12, 20, 7);
    expect(pfrOn(c, 'full', false)).toBe(false);
    expect(pfrOn(c, 'full', true)).toBe(true);
  });
});

describe('G2: what it does not reach', () => {
  it('5 raises in the last 12 engage neither way (full ring)', () => {
    for (const r0 of [0.08, 0.12, 0.18, 0.25])
      for (const hands of [20, 40]) expect(pfrOn(shifter(r0, hands, 5), 'full', true)).toBe(false);
  });
  it('no regime break, no reach: a steady player at the same recent rate is not engaged by the option', () => {
    const c = freshExploitCounters();
    c.fHands = FAST;
    c.fPfr = 3;
    c.hands = 40;
    c.pfr = 40 * (3 / FAST);
    c.vpip = c.pfr + 2;
    expect(read(c, 'full', true)).toEqual(read(c, 'full', false));
  });
  it('short-handed and heads-up lines are unchanged at every recent raise count (measured)', () => {
    for (const size of ['short', 'hu'] as const)
      for (const r0 of [0.08, 0.12, 0.18, 0.25])
        for (const hands of [20, 40])
          for (let k = 3; k <= 12; k++) {
            const c = shifter(r0, hands, k);
            expect(pfrOn(c, size, true), `${size} ${r0} ${hands} ${k}`).toBe(pfrOn(c, size, false));
          }
  });
});

describe('G3: a read the stricter lines already make is the same read', () => {
  it('8 or more raises in the last 12: identical with and without the option', () => {
    for (let k = 8; k <= 12; k++) {
      const c = shifter(0.12, 40, k);
      expect(read(c, 'full', true)).toEqual(read(c, 'full', false));
    }
  });
});

describe('G4: option off, every read is what it was', () => {
  it('the maniac read grid keeps its base pin', () => {
    expect(maniacReadGridPin()).toBe(MANIAC_READ_GRID_BASE_PIN);
  });
  it('an absent and an explicit-false reach give the same read', () => {
    const c = shifter(0.12, 40, 6);
    expect(opponentExploitRead(c, 'holdem:full' as never, 'nlh', [], { gearShift: false })).toEqual(
      opponentExploitRead(c, 'holdem:full' as never, 'nlh')
    );
  });
});
