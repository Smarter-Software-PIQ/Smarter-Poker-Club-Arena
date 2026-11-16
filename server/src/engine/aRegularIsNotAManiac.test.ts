/**
 * A REGULAR IS NOT A MANIAC (2026-11-15, Hold'em Strategy lane, opponent classifier C3; option holdemManiacSampleGate,
 * read === true, default OFF).
 *
 * The preflop maniac width (maniacRaiseWidth, the key of every maniac response) had no sample floor: an unknown
 * player who raised 4 (full), 5 (short) or 6 (heads-up) hands in a row read as a maniac; and short-handed and
 * heads-up a regular's first-in raising alone (mostly button and small-blind opens) could carry it. With the option
 * on: at least 15 decayed hands, the opener route needs PFR credibly above the size's regular line (Horse PFR P99 +
 * 0.10), the re-raise route at least 8 decayed 3-bet opportunities. Declared before measurement:
 * docs/changelog/2026-11-15-a-regular-is-not-a-maniac.md. Synthetic counters only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MANIAC_SAMPLE_GATE,
  maniacRaiseWidth,
  opponentExploitRead,
  withManiacSampleGate,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { HorseMind } from './HorseMind.js';
import {
  MANIAC_READ_GRID_BASE_PIN,
  maniacReadGridPin,
  raiser,
} from './maniacReadGrid.test-support.js';
import {
  decide,
  install,
  preflopOpen,
  VILLAIN,
} from './HorseOpponentStyle.contexts.test-support.js';

type Size = 'full' | 'short' | 'hu';
const scopeOf = (size: Size) => `holdem:${size}` as never;
const width = (c: ExploitCounters, size: Size, gated: boolean): number | null => {
  const read = opponentExploitRead(c, scopeOf(size), 'nlh');
  return maniacRaiseWidth(gated ? withManiacSampleGate(read, c, scopeOf(size), 'nlh') : read);
};
/** decayed hands after k consecutive counted hands (30-hand half-life) */
const decayed = (k: number): number => {
  let s = 0;
  for (let i = 0; i < k; i++) s = s * Math.pow(0.5, 1 / 30) + 1;
  return s;
};

describe('M2: an unknown player who raises a handful of hands in a row is not a maniac', () => {
  for (const [size, k] of [
    ['full', 4],
    ['short', 5],
    ['hu', 6],
  ] as const)
    it(`${size}: ${k} straight raises read as a maniac today, not with the gate`, () => {
      const c = raiser({ hands: decayed(k), pfr: 1, rfi: 1 });
      expect(width(c, size, false)).not.toBeNull();
      expect(width(c, size, true)).toBeNull();
    });
});

describe('M1: realistic aggressive regulars are not maniacs at any sample', () => {
  const regs: Array<[Size, number, number]> = [
    ['full', 0.3, 0.45],
    ['short', 0.45, 0.8],
    ['short', 0.4, 0.85],
    ['hu', 0.55, 0.85],
    ['hu', 0.5, 0.9],
  ];
  for (const [size, pfr, rfi] of regs)
    it(`${size}: PFR ${pfr}, first-in raises ${rfi}`, () => {
      for (const hands of [15.56, 30, 43.78])
        expect(width(raiser({ hands, pfr, rfi }), size, true), `${hands}`).toBeNull();
    });
  it('measured today: the heads-up and short-handed first-in route alone calls such a regular a maniac', () => {
    expect(width(raiser({ hands: 43.78, pfr: 0.5, rfi: 0.9 }), 'hu', false)).not.toBeNull();
    expect(width(raiser({ hands: 43.78, pfr: 0.4, rfi: 0.85 }), 'short', false)).not.toBeNull();
  });
});

describe('M3: true maniacs still are, once 15 decayed hands are in', () => {
  for (const size of ['full', 'short', 'hu'] as const) {
    it(`${size}: a jammer or potter (raises every hand) from about hand 19`, () => {
      expect(width(raiser({ hands: decayed(19), pfr: 1, rfi: 1 }), size, true)).not.toBeNull();
      expect(width(raiser({ hands: decayed(18), pfr: 1, rfi: 1 }), size, true)).toBeNull();
    });
  }
  for (const [size, pfr] of [
    ['full', 0.6],
    ['short', 0.7],
    ['hu', 0.8],
  ] as const)
    it(`${size}: PFR ${pfr} sustained (saturated window)`, () => {
      expect(
        width(raiser({ hands: 43.78, pfr, rfi: Math.min(1, pfr + 0.1) }), size, true)
      ).not.toBeNull();
    });
  // The re-raise route needs recent 3-bet evidence of its own: with calm recent opening and no fast 3-bet
  // opportunities the base read switches it off (preflopCalm), so the fixture carries them.
  const threeBettor = (hands: number, opp: number, tb: number) => {
    const c = raiser({ hands, pfr: 0.15, rfi: 0.2, threeBetOpp: opp, threeBet: tb });
    c.fThreeBetOpp = opp;
    c.fThreeBet = tb;
    return c;
  };
  it('the re-raise route: a 40 percent 3-bettor on 10 decayed opportunities and 20 hands still is', () => {
    expect(width(threeBettor(20, 10, 4), 'full', false)).not.toBeNull();
    expect(width(threeBettor(20, 10, 4), 'full', true)).not.toBeNull();
  });
  it('the re-raise route: the same 3-bettor on 12 decayed hands is under the sample floor', () => {
    expect(width(threeBettor(12, 10, 4), 'full', false)).not.toBeNull();
    expect(width(threeBettor(12, 10, 4), 'full', true)).toBeNull();
  });
  it('the declared constants', () => {
    expect(MANIAC_SAMPLE_GATE).toEqual({
      minHands: 15,
      minThreeBetOpps: 8,
      regularLineAboveP99: 0.1,
      credibility: 0.9,
    });
  });
});

describe('M4: option off, every read is what it was', () => {
  it('a grid of 1,536 reads pins the hash captured on the base commit', () => {
    expect(maniacReadGridPin()).toBe(MANIAC_READ_GRID_BASE_PIN);
  });
});

describe('through HorseMind and a decision', () => {
  afterEach(() => {
    HorseMind.reset();
    HorseMind.setDecisionScope(null);
  });
  const fresh = () =>
    install(
      {
        stats: { hands: 6, aggr: 6, passive: 0 },
        counters: raiser({ hands: decayed(5), pfr: 1, rfi: 1 }),
      },
      'cash'
    );
  it('opponentRead carries the gate only with the option on', () => {
    fresh();
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({});
    const off = HorseMind.opponentRead(VILLAIN);
    expect(off?.maniacGate).toBeUndefined();
    expect(maniacRaiseWidth(off)).not.toBeNull();
    HorseMind.setDecisionReadOptions({ holdemManiacSampleGate: true });
    const on = HorseMind.opponentRead(VILLAIN);
    expect(on?.maniacGate?.hands).toBeCloseTo(decayed(5), 6);
    expect(maniacRaiseWidth(on)).toBeNull();
  });
  it('a preflop decision facing his open: the gate withholds the maniac read only with the option on', () => {
    const spot = preflopOpen('cash');
    fresh();
    const off = decide(spot, {});
    fresh();
    const on = decide(spot, { holdemManiacSampleGate: true });
    expect(off.fires.maniac_sample_gate_withheld_seen ?? 0).toBe(0);
    expect(on.fires.maniac_sample_gate_withheld_seen ?? 0).toBeGreaterThan(0);
    fresh();
    expect(decide(spot, {}).digest).toBe(off.digest);
  });
});
