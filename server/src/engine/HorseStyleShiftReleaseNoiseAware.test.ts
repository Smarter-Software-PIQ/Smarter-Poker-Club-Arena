// STYLE SHIFT RELEASE IS NOISE-AWARE (2026-11-21, option styleShiftReleaseIsNoiseAware, default OFF): off is the
// 2026-11-06 rule byte for byte; on, a stable player with mixed frequencies keeps his rare samples and a real style
// change still releases. docs/horse-option-authority.d/styleShiftReleaseIsNoiseAware.md.
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPLOIT_COUNTER_FIELDS,
  EXPLOIT_DECAY,
  EXPLOIT_FAST_DECAY,
  STYLE_SHIFT_NOISE_K,
  decayAndAddOpportunityScoped,
  freshExploitCounters,
  setStyleShiftReleaseNoiseAware,
  styleShiftBeyondNoise,
  styleShiftMoved,
  styleShiftReleaseNoiseAwareOn,
  styleShiftReleased,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { HorseMind } from './HorseMind.js';
import { playManiacPressure } from './HorseManiacPressure.test-support.js';

afterEach(() => setStyleShiftReleaseNoiseAware(false));

const inc = (over: Partial<ExploitCounters>): ExploitCounters => ({
  ...freshExploitCounters(),
  ...over,
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The 2026-11-06 rule as it shipped (migration 20261107022913 is its SQL twin), copied verbatim as the reference.
const GATES: Partial<Record<keyof ExploitCounters, keyof ExploitCounters>> = {
  rfiOpp: 'rfiOpp', rfi: 'rfiOpp', fRfiOpp: 'fRfiOpp', fRfi: 'fRfiOpp',
  threeBetOpp: 'threeBetOpp', threeBet: 'threeBetOpp', fThreeBetOpp: 'fThreeBetOpp', fThreeBet: 'fThreeBetOpp',
  foldTo3BetOpp: 'foldTo3BetOpp', foldTo3Bet: 'foldTo3BetOpp',
  betCheckedToOpp: 'betCheckedToOpp', betCheckedTo: 'betCheckedToOpp',
  fBetCheckedToOpp: 'fBetCheckedToOpp', fBetCheckedTo: 'fBetCheckedToOpp',
  foldToBetOpp: 'foldToBetOpp', foldToBet: 'foldToBetOpp', fFoldToBetOpp: 'fFoldToBetOpp', fFoldToBet: 'fFoldToBetOpp',
  riverCallOpp: 'riverCallOpp', riverCall: 'riverCallOpp', fRiverCallOpp: 'fRiverCallOpp', fRiverCall: 'fRiverCallOpp',
}; // prettier-ignore
const FAST = new Set(['fHands', 'fPfr', 'fRfiOpp', 'fRfi', 'fThreeBetOpp', 'fThreeBet', 'fBetCheckedToOpp',
  'fBetCheckedTo', 'fFoldToBetOpp', 'fFoldToBet', 'fRiverCallOpp', 'fRiverCall']); // prettier-ignore
function referenceReleased(row: ExploitCounters): boolean {
  const fh = row.fHands ?? 0;
  const h = row.hands ?? 0;
  if (fh < 3 || h <= 0) return false;
  if (Math.abs((row.fPfr ?? 0) / fh - (row.pfr ?? 0) / h) >= 0.2) return true;
  for (const [num, opp, fNum, fOpp] of [
    ['rfi', 'rfiOpp', 'fRfi', 'fRfiOpp'],
    ['threeBet', 'threeBetOpp', 'fThreeBet', 'fThreeBetOpp'],
    ['betCheckedTo', 'betCheckedToOpp', 'fBetCheckedTo', 'fBetCheckedToOpp'],
    ['foldToBet', 'foldToBetOpp', 'fFoldToBet', 'fFoldToBetOpp'],
    ['riverCall', 'riverCallOpp', 'fRiverCall', 'fRiverCallOpp'],
  ] as const) {
    const fo = row[fOpp] ?? 0;
    const lo = row[opp] ?? 0;
    if (fo < 3 || lo <= 0) continue;
    if (Math.abs((row[fNum] ?? 0) / fo - (row[num] ?? 0) / lo) >= 0.2) return true;
  }
  return false;
}
function referenceDecay(row: ExploitCounters, increments: ExploitCounters): void {
  const released = referenceReleased(row);
  for (const f of EXPLOIT_COUNTER_FIELDS) {
    const g = GATES[f];
    const had = g ? (increments[g] ?? 0) > 0 : true;
    const factor = FAST.has(f)
      ? EXPLOIT_FAST_DECAY
      : !g || had
        ? released && g
          ? EXPLOIT_FAST_DECAY
          : EXPLOIT_DECAY
        : released
          ? EXPLOIT_FAST_DECAY
          : 1;
    row[f] = (row[f] ?? 0) * factor + (increments[f] ?? 0);
  }
}

function randomRow(r: () => number): ExploitCounters {
  const row = freshExploitCounters();
  for (const f of EXPLOIT_COUNTER_FIELDS) row[f] = r() < 0.1 ? 0 : r() * (FAST.has(f) ? 12 : 45);
  return row;
}
function randomHand(r: () => number): ExploitCounters {
  const h = inc({ hands: 1, fHands: 1 });
  for (const [
    num,
    opp,
  ] of [
    ['rfi', 'rfiOpp'], ['threeBet', 'threeBetOpp'], ['foldTo3Bet', 'foldTo3BetOpp'],
    ['betCheckedTo', 'betCheckedToOpp'], ['foldToBet', 'foldToBetOpp'], ['riverCall', 'riverCallOpp'],
  ] as const) // prettier-ignore
    if (r() < 0.3) {
      h[opp] = 1;
      if (r() < 0.5) h[num] = 1;
      if (opp !== 'foldTo3BetOpp') {
        h[`f${opp[0]!.toUpperCase()}${opp.slice(1)}` as keyof ExploitCounters] = 1;
        if (h[num]) h[`f${num[0]!.toUpperCase()}${num.slice(1)}` as keyof ExploitCounters] = 1;
      }
    }
  if (r() < 0.3) h.pfr = h.fPfr = h.vpip = 1;
  return h;
}

/** A stationary player (fixed probabilities), as docs/horse-league-fixed-limit.md simulates him. */
function stationary(
  rr: number,
  q: number,
  p: number,
  noiseAware: boolean,
  seeds = 6
): { released: number; foldOpps: number; atLeast15: number } {
  let rel = 0;
  let opp = 0;
  let ge = 0;
  let n = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = rng(seed);
    const row = freshExploitCounters();
    for (let h = 0; h < 4000; h++) {
      const x = inc({ hands: 1, fHands: 1 });
      if (r() < 0.6) {
        x.rfiOpp = x.fRfiOpp = 1;
        if (r() < rr) x.rfi = x.fRfi = x.pfr = x.fPfr = 1;
      }
      if (r() < q) {
        x.foldToBetOpp = x.fFoldToBetOpp = 1;
        if (r() < p) x.foldToBet = x.fFoldToBet = 1;
      }
      const released = styleShiftReleased(row, noiseAware);
      decayAndAddOpportunityScoped(row, x, noiseAware);
      if (h >= 1000) {
        n++;
        if (released) rel++;
        opp += row.foldToBetOpp;
        if (row.foldToBetOpp >= 15) ge++;
      }
    }
  }
  return { released: rel / n, foldOpps: opp / n, atLeast15: ge / n };
}

describe('the noise-aware style-shift release (option off)', () => {
  it('is the source default', () => {
    expect(styleShiftReleaseNoiseAwareOn()).toBe(false);
  });

  it('is the 2026-11-06 rule byte for byte on 20,000 random updates', () => {
    const r = rng(20261121);
    for (let i = 0; i < 20_000; i++) {
      const row = randomRow(r);
      const hand = randomHand(r);
      const want = { ...row };
      referenceDecay(want, hand);
      expect(styleShiftReleased(row)).toBe(referenceReleased(row));
      const got = { ...row };
      decayAndAddOpportunityScoped(got, hand);
      for (const f of EXPLOIT_COUNTER_FIELDS) expect(Object.is(got[f], want[f]), f).toBe(true);
    }
  });
});

describe('the noise-aware style-shift release (option on)', () => {
  it('needs a gap beyond the fast window noise, never less than the 2026-11-06 gap', () => {
    expect(STYLE_SHIFT_NOISE_K).toBe(1.5);
    // 26% long rate on 12 fast samples: the bound is 1.5 x sqrt(0.26 x 0.74 / 12) = 0.19, so 0.2 rules
    expect(styleShiftBeyondNoise(0.47 * 12, 12, 26, 100)).toBe(true);
    expect(styleShiftBeyondNoise(0.45 * 12, 12, 26, 100)).toBe(false);
    // 50% long rate on 4 fast samples: the bound is 1.5 x sqrt(0.25 / 4) = 0.375
    expect(styleShiftBeyondNoise(0.75 * 4, 4, 50, 100)).toBe(false);
    expect(styleShiftBeyondNoise(0.9 * 4, 4, 50, 100)).toBe(true);
    // a thin fast window never releases
    expect(styleShiftBeyondNoise(0, 2.9, 30, 30)).toBe(false);
  });

  it('ages only the statistic that moved', () => {
    // rfi moved (long 20%, fast 90% on 10), pfr did not (long 20%, fast 25%): fold-to-bet keeps its weight
    const row = inc({
      hands: 40, pfr: 8, fHands: 12, fPfr: 3,
      rfiOpp: 30, rfi: 6, fRfiOpp: 10, fRfi: 9,
      foldToBetOpp: 20, foldToBet: 18, fFoldToBetOpp: 1, fFoldToBet: 1,
    }); // prettier-ignore
    expect(styleShiftMoved(row)).toEqual(['rfi']);
    expect(styleShiftReleased(row, false)).toBe(true);
    const fold = inc({ hands: 1, fHands: 1 });
    const on = { ...row };
    decayAndAddOpportunityScoped(on, fold, true);
    expect(on.foldToBetOpp).toBe(20);
    expect(on.foldToBet).toBe(18);
    expect(on.rfiOpp).toBeCloseTo(30 * EXPLOIT_FAST_DECAY, 12);
    expect(on.rfi).toBeCloseTo(6 * EXPLOIT_FAST_DECAY, 12);
    const off = { ...row };
    decayAndAddOpportunityScoped(off, fold, false);
    expect(off.foldToBetOpp).toBeCloseTo(20 * EXPLOIT_FAST_DECAY, 12);
  });

  it('a moved preflop raise rate still ages every gated statistic (the maniac who calms down)', () => {
    const row = inc({ hands: 30, pfr: 30, fHands: 12, fPfr: 1, riverCallOpp: 5, riverCall: 5 });
    expect(styleShiftMoved(row)).toEqual(['pfr']);
    decayAndAddOpportunityScoped(row, inc({ hands: 1, fHands: 1 }), true);
    expect(row.riverCallOpp).toBeCloseTo(5 * EXPLOIT_FAST_DECAY, 12);
    expect(row.riverCall).toBeCloseTo(5 * EXPLOIT_FAST_DECAY, 12);
  });

  it('a stable 26% first-in raiser keeps his fold-to-bet sample (measured: about 33 against 13.5 off)', () => {
    const off = stationary(0.26, 0.03, 1, false);
    const on = stationary(0.26, 0.03, 1, true);
    expect(off.foldOpps).toBeLessThan(16);
    expect(off.atLeast15).toBeLessThan(0.5);
    expect(on.foldOpps).toBeGreaterThan(30);
    expect(on.atLeast15).toBeGreaterThan(0.99);
    expect(on.released).toBeLessThan(0.01);
    expect(off.released).toBeGreaterThan(0.015);
  });

  it('a stable 50% raiser too (measured: off 7.7 decayed fold opportunities)', () => {
    expect(stationary(0.5, 0.03, 1, false).foldOpps).toBeLessThan(10);
    expect(stationary(0.5, 0.03, 1, true).foldOpps).toBeGreaterThan(30);
  });
});

describe('the process switch', () => {
  it('follows the registry state the decision worker passes, and no key is off', () => {
    HorseMind.applyStyleShiftReleaseIsNoiseAwareOption({ styleShiftReleaseIsNoiseAware: true });
    expect(HorseMind.styleShiftReleaseIsNoiseAwareOn()).toBe(true);
    expect(styleShiftReleaseNoiseAwareOn()).toBe(true);
    HorseMind.applyStyleShiftReleaseIsNoiseAwareOption({});
    expect(HorseMind.styleShiftReleaseIsNoiseAwareOn()).toBe(false);
    HorseMind.applyStyleShiftReleaseIsNoiseAwareOption({ styleShiftReleaseIsNoiseAware: true });
    HorseMind.applyStyleShiftReleaseIsNoiseAwareOption({ styleShiftReleaseIsNoiseAware: false });
    expect(styleShiftReleaseNoiseAwareOn()).toBe(false);
  });
});

const firstFrom = (a: boolean[], from: number, v: boolean) => {
  for (let i = from; i < a.length; i++) if (a[i] === v) return i - from;
  return Infinity;
};

describe('a real style change is still read in the same hands (HorseManiacPressure pins, option on)', () => {
  // Measured 2026-11-21 on these streams, option off / on: NLH calm 21 / 21, nit to maniac 11 / 11; PLO4 calm
  // 17 / 17, nit to maniac 13 / 12. The pins are the law's (25; 12 hold'em, 14 PLO4), held with the option on.
  for (const v of ['nlh', 'plo4']) {
    it(`${v}: a maniac who calms down, and a nit who turns maniac`, () => {
      setStyleShiftReleaseNoiseAware(true);
      const calm = playManiacPressure(v, 'cash', 'potter', 100, 11, 15, {
        switchAt: 60,
        then: 'nit',
        pairedBoardFold: false,
        semiBluffNeedsDraw: false,
        currentNutsRaise: false,
        riverBluffBaseline: false,
      });
      expect(firstFrom(calm.maniacReadByHand, 0, true)).toBeLessThanOrEqual(8);
      expect(firstFrom(calm.maniacReadByHand, 60, false)).toBe(v === 'nlh' ? 21 : 17);
      const turn = playManiacPressure(v, 'cash', 'nit', 90, 11, 15, {
        switchAt: 60,
        then: 'potter',
        pairedBoardFold: false,
        semiBluffNeedsDraw: false,
        currentNutsRaise: false,
        riverBluffBaseline: false,
        omahaEvFoldModel: false,
      });
      expect(turn.maniacReadByHand.slice(0, 60).some(Boolean)).toBe(false);
      expect(firstFrom(turn.maniacReadByHand, 60, true)).toBe(v === 'nlh' ? 11 : 12);
    }, 120_000);
  }
});
