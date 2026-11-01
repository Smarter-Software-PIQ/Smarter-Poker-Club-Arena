/**
 * V75 THE SQUEEZED OPENER (2026-11-01): the width arithmetic and the
 * end-to-end direction. docs/changelog reference:
 * docs/changelog/2026-11-01-horse-nlh-vs-3bet-defence.md (V73, extended).
 */
import { describe, expect, it } from 'vitest';
import {
  V75_LIVE_CALLER_FACTOR,
  V75_MAX_LIVE_CALLERS,
  continueShare,
  type Vs3BetSpot,
} from './HorseGtoVs3BetRanges.js';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import {
  holeFor,
  openFreq,
  squeezeStateFor,
  stateFor,
  type Vs3Ctx,
} from './HorseVs3BetDefence.test-support.js';

const BASE: Vs3BetSpot = {
  openerBehind: 3, // the cutoff, six-handed
  ip: false,
  ante: false,
  dealt: 6,
  threeBetX: 4,
  potBeforeBB: 6.5, // 2.5 open + 2.5 call + 1.5 blinds
  reRaiseRiskBB: 9,
  effectiveBB: 100,
  deepDiscipline: true,
};

describe('the V75 width arithmetic', () => {
  it('each live caller behind narrows the share by the realisation factor, capped at two', () => {
    const s0 = continueShare({ ...BASE, liveCallersBehind: 0 });
    const s1 = continueShare({ ...BASE, liveCallersBehind: 1 });
    const s2 = continueShare({ ...BASE, liveCallersBehind: 2 });
    const s3 = continueShare({ ...BASE, liveCallersBehind: 3 });
    expect(s1).toBeCloseTo(s0 * V75_LIVE_CALLER_FACTOR, 6);
    expect(s2).toBeCloseTo(s0 * Math.pow(V75_LIVE_CALLER_FACTOR, V75_MAX_LIVE_CALLERS), 6);
    expect(s3).toBeCloseTo(s2, 9);
    expect(s0).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThan(s2);
  });

  it('undefined is the pure V73 node: no factor applied', () => {
    const plain = continueShare(BASE);
    const zero = continueShare({ ...BASE, liveCallersBehind: 0 });
    expect(plain).toBeCloseTo(zero, 9);
  });

  it("the caller's dead money widens the width through the price (MDF), independently", () => {
    // Same 3-bet risk into a pot without, then with, the caller's 2.5bb.
    const headsUpPot = continueShare({ ...BASE, potBeforeBB: 4, liveCallersBehind: 0 });
    const deadMoneyPot = continueShare({ ...BASE, potBeforeBB: 6.5, liveCallersBehind: 0 });
    expect(deadMoneyPot).toBeGreaterThan(headsUpPot);
  });
});

describe('the squeezed opener end to end (HorseLogic.decide)', () => {
  const CASH6: Vs3Ctx = {
    seats: 6,
    stackBB: 100,
    mode: 'cash',
    ante: false,
    openBB: 2.5,
    threeBetX: 4,
  };

  type Mix = { fold: number; call: number; four: number };

  /** The cutoff's answer to a button-call big-blind squeeze, weighted by its own opens. */
  function squeezeMix(opts: Record<string, unknown>, seeds = 4): Mix {
    const open = openFreq(CASH6, 4, seeds);
    let fold = 0;
    let call = 0;
    let four = 0;
    for (const h of HAND_CLASSES) {
      const w = (open.get(h.cls) ?? 0) * h.combos;
      if (w <= 0) continue;
      for (let s = 0; s < seeds; s++) {
        const { hero, gs } = squeezeStateFor(CASH6, 4, [5], 2, holeFor(h.cls, s));
        seedFastRandom((s + 1) * 7919 + 4 * 104729 + 2 * 7 + h.cls.charCodeAt(0));
        const d = HorseLogic.decide(
          hero,
          gs,
          'balanced',
          {} as never,
          {
            mind: false,
            telemetry: false,
            ...opts,
          } as never
        );
        if (d.action === 'call') call += w / seeds;
        else if (d.action === 'raise' || d.action === 'all_in' || d.action === 'bet')
          four += w / seeds;
        else fold += w / seeds;
      }
    }
    const tot = Math.max(1e-9, fold + call + four);
    return { fold: (100 * fold) / tot, call: (100 * call) / tot, four: (100 * four) / tot };
  }

  it('the squeezed cutoff folds less of its open than the legacy fixed bar', () => {
    const on = squeezeMix({});
    const off = squeezeMix({ v75SqueezeDefence: false });
    expect(on.fold).toBeLessThan(off.fold - 3);
    expect(on.call).toBeGreaterThan(off.call);
  });

  it('the realisation factor holds the squeeze width near the heads-up node', () => {
    // Same seat, same 3-bet multiple. Without the V75 factor the caller's
    // dead money alone would widen the continue share ~17% over the heads-up
    // node (MDF 0.419 vs 0.308 at elasticity 0.5); with it, the two nodes
    // land within a few percent of each other (the V18 anti-squeeze exploit
    // discount nudges the squeeze arm slightly looser on top). Pinned as a
    // band: no ballooning with the dead money, no collapse either.
    const seeds = 4;
    const open = openFreq(CASH6, 4, seeds);
    let sqContinue = 0;
    let huContinue = 0;
    let weight = 0;
    for (const h of HAND_CLASSES) {
      const w = (open.get(h.cls) ?? 0) * h.combos;
      if (w <= 0) continue;
      weight += w;
      for (let s = 0; s < seeds; s++) {
        const sq = squeezeStateFor(CASH6, 4, [5], 2, holeFor(h.cls, s));
        seedFastRandom((s + 1) * 6007 + h.cls.charCodeAt(1));
        const dSq = HorseLogic.decide(
          sq.hero,
          sq.gs,
          'balanced',
          {} as never,
          {
            mind: false,
            telemetry: false,
          } as never
        );
        const hu = stateFor(CASH6, 4, 2, holeFor(h.cls, s));
        seedFastRandom((s + 1) * 6007 + h.cls.charCodeAt(1));
        const dHu = HorseLogic.decide(
          hu.hero,
          hu.gs,
          'balanced',
          {} as never,
          {
            mind: false,
            telemetry: false,
          } as never
        );
        if (dSq.action !== 'fold') sqContinue += w / seeds;
        if (dHu.action !== 'fold') huContinue += w / seeds;
      }
    }
    expect(weight).toBeGreaterThan(0);
    expect(sqContinue).toBeLessThanOrEqual(huContinue * 1.05);
    expect(sqContinue).toBeGreaterThanOrEqual(huContinue * 0.75);
  });
});
