/**
 * LAW: multiway continuation pricing scales remaining opponents (`effOpp`) to callers / 1 raiser,
 * never keeping all pre-bet opponents after folds (lane core-repair / PLO-OWNER lead-4).
 *
 * Root cause diagnosed on d9d319d2 multiway bet->check (45/49 in 5-way nOpp=4 pots):
 *   1) `equityAtShare(share)` raised `curve(share)` to the full pre-bet `mwPower k` (~4) even after
 *      only `callers` (~1.4) opponents called a flop bet or `1` opponent raised.
 *   2) `wagerWhenChecked(off > 0)` looped over all `nOpp` original flop opponents (`p = 1-(1-b)^4 = 0.95`)
 *      instead of the `effOpp` callers remaining on the turn/river.
 *
 * Fix: track `effOpp` in `Node` (`spot.nOpp` at root -> `min(n.effOpp, callers)` on called wager -> `1` on raise);
 * scale `kEff = 1 + (k - 1) * clamp01((effOpp - 1) / (nOpp - 1))` and turn/river `pNone^(effOpp / who.length)`.
 * HU (`nOpp === 1`) and root `check` (`effOpp === nOpp`) are 100% bit-identical.
 */
import { describe, expect, it } from 'vitest';
import { planValue, type ValueSpot } from './OmahaMathCoreValue.js';
import { mwEffectivePower, mwScaledWagerRate } from './OmahaMathCoreWire.js';

function makeMultiwaySpot(overrides: Partial<ValueSpot> = {}): ValueSpot {
  const nOpp = overrides.nOpp ?? 4;
  // Realistic 5-way strong hand: HU equity 0.72 vs full range, 0.58 vs top 40%; k = 3.5 -> 0.72^3.5 = 0.316 vs all 4
  const kFull = nOpp <= 1 ? 1 : 3.5;
  const curve = (s: number) => 0.42 + 0.3 * Math.max(0.005, Math.min(1, s));
  return {
    variant: 'plo5',
    street: 'flop',
    pot: 12,
    toCall: 0,
    heroStack: 200,
    oppStack: 200,
    nOpp,
    ip: false,
    checkCloses: false,
    rakeNet: (p) => p,
    response: (_frac, _allIn, off, line) => ({
      fold: off === 0 ? 0.08 : 0.25,
      raise: line === 'bet' ? 0.13 : 0.05,
      callers: off === 0 ? 1.4 : 1.15,
      n: 400,
      source: 'constructed-5way',
    }),
    wagerWhenChecked: (off, effOpp) => {
      // Single-opponent bet rate b = 0.53 -> 4 opponents = 1 - 0.47^4 = 0.951, 1.4 opponents = 1 - 0.47^1.4 = 0.653
      const pNone4 = Math.pow(1 - 0.53, nOpp);
      const pNone =
        off > 0 && effOpp !== undefined
          ? Math.pow(pNone4, Math.min(1, Math.max(1, effOpp) / nOpp))
          : pNone4;
      return { p: 1 - pNone, frac: 0.65, valueShare: 0.6, n: 400, source: 'constructed-5way' };
    },
    equityAtShare: (share, effOpp = nOpp) => {
      const kEff =
        nOpp <= 1 ? 1 : 1 + (kFull - 1) * Math.max(0, Math.min(1, (effOpp - 1) / (nOpp - 1)));
      return Math.pow(curve(share), kEff);
    },
    equitySe: 0.01,
    seed: 'eff-opp-law-5way',
    ...overrides,
  };
}

describe('LAW: multiway effOpp scales remaining opponents to callers / 1 raiser (HU bit-identical)', () => {
  it('HU (nOpp = 1): planValue is bit-identical regardless of effOpp callbacks', () => {
    const curve = (s: number) => 0.3 + 0.35 * Math.max(0.005, Math.min(1, s));
    const seenEffEq: Array<number | undefined> = [];
    const seenEffWager: Array<number | undefined> = [];
    const base: ValueSpot = {
      variant: 'plo5',
      street: 'flop',
      pot: 20,
      toCall: 0,
      heroStack: 180,
      oppStack: 180,
      nOpp: 1,
      ip: false,
      checkCloses: false,
      rakeNet: (p) => p,
      response: () => ({ fold: 0.32, raise: 0.12, callers: 1, n: 300, source: 'hu' }),
      wagerWhenChecked: () => ({ p: 0.48, frac: 0.66, valueShare: 0.65, n: 300, source: 'hu' }),
      equityAtShare: (s) => curve(s),
      equitySe: 0.01,
      seed: 'eff-opp-hu-id',
    };
    const withTrack: ValueSpot = {
      ...base,
      equityAtShare: (s, effOpp) => {
        seenEffEq.push(effOpp);
        return curve(s);
      },
      wagerWhenChecked: (off, effOpp) => {
        seenEffWager.push(effOpp);
        return base.wagerWhenChecked(off);
      },
    };
    const r0 = planValue(base)!;
    const r1 = planValue(withTrack)!;
    expect(r1.candidates.map((c) => [c.kind, c.adds, c.ev, c.se, c.plan])).toEqual(
      r0.candidates.map((c) => [c.kind, c.adds, c.ev, c.se, c.plan])
    );
    expect(seenEffEq.every((e) => e === 1)).toBe(true);
    expect(seenEffWager.every((e) => e === 1)).toBe(true);
  });

  it('5-way called bet passes callers (1.4), not all 4 pre-bet opponents, into equityAtShare and turn wagerWhenChecked', () => {
    const eqOppCalls: number[] = [];
    const turnWagerOppCalls: number[] = [];
    const spot = makeMultiwaySpot();
    const origEq = spot.equityAtShare;
    const origW = spot.wagerWhenChecked;
    spot.equityAtShare = (s, effOpp) => {
      if (effOpp !== undefined) eqOppCalls.push(effOpp);
      return origEq(s, effOpp);
    };
    spot.wagerWhenChecked = (off, effOpp) => {
      if (off > 0 && effOpp !== undefined) turnWagerOppCalls.push(effOpp);
      return origW(off, effOpp);
    };

    const res = planValue(spot)!;
    // Must pass effOpp = 1 (raise branch) and effOpp = 1.4 (flop callers) into equityAtShare
    expect(eqOppCalls.some((e) => Math.abs(e - 1) < 1e-6)).toBe(true);
    expect(eqOppCalls.some((e) => Math.abs(e - 1.4) < 1e-6)).toBe(true);
    // Must pass effOpp = 1.4 into turn wagerWhenChecked after flop bet is called
    expect(turnWagerOppCalls.some((e) => Math.abs(e - 1.4) < 1e-6)).toBe(true);

    // Compare against legacy (ignoring effOpp, always pricing all 4 pre-bet opponents)
    const legacySpot = makeMultiwaySpot({
      equityAtShare: (s) => origEq(s, 4),
      wagerWhenChecked: (off) => origW(off, 4),
    });
    const resLegacy = planValue(legacySpot)!;
    const bestBet = res.candidates
      .filter((c) => c.kind === 'wager')
      .reduce((a, b) => (b.ev > a.ev ? b : a));
    const bestBetLegacy = resLegacy.candidates
      .filter((c) => c.kind === 'wager')
      .reduce((a, b) => (b.ev > a.ev ? b : a));
    expect(bestBet.ev).toBeGreaterThan(bestBetLegacy.ev + 5);
    expect(bestBet.ev).toBeGreaterThan(0);

    // In position (check closes flop), effOpp makes value-betting strictly beat checking back
    const ipRes = planValue(makeMultiwaySpot({ ip: true, checkCloses: true }))!;
    const ipChk = ipRes.candidates.find((c) => c.kind === 'check')!;
    const ipBet = ipRes.candidates
      .filter((c) => c.kind === 'wager')
      .reduce((a, b) => (b.ev > a.ev ? b : a));
    expect(ipBet.ev).toBeGreaterThan(ipChk.ev);
  });

  it('mwEffectivePower satisfies exact boundaries (effOpp=1 -> 1, effOpp=nOpp -> kFull) and monotonicity', () => {
    expect(mwEffectivePower(3.4, 4, 1)).toBeCloseTo(1, 9);
    expect(mwEffectivePower(3.4, 4, 4)).toBeCloseTo(3.4, 9);
    expect(mwEffectivePower(3.4, 1, 1)).toBeCloseTo(1, 9);
    const p14 = mwEffectivePower(3.4, 4, 1.4);
    const p25 = mwEffectivePower(3.4, 4, 2.5);
    expect(p14).toBeGreaterThan(1);
    expect(p14).toBeLessThan(p25);
    expect(p25).toBeLessThan(3.4);
  });

  it('mwScaledWagerRate scales turn/river any-opponent bet rate from nOpp down to effOpp (HU and root unchanged)', () => {
    const pNone4 = Math.pow(1 - 0.53, 4); // 4 opponents -> 95.1%
    expect(mwScaledWagerRate(pNone4, 4, 4)).toBeCloseTo(1 - pNone4, 9);
    expect(mwScaledWagerRate(pNone4, 4, 1)).toBeCloseTo(0.53, 9);
    const p14 = mwScaledWagerRate(pNone4, 4, 1.4);
    expect(p14).toBeCloseTo(1 - Math.pow(1 - 0.53, 1.4), 9);
    expect(p14).toBeLessThan(0.7);
    expect(mwScaledWagerRate(1 - 0.45, 1, 1)).toBeCloseTo(0.45, 9);
  });
});
