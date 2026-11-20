/**
 * omahaMathCore multiway terms (lane HVH-MULTI). Constructed spots only; no hole cards.
 * The correlation cells are from the 48h audit (public actions only).
 */
import { describe, expect, it } from 'vitest';
import {
  MULTIWAY_FOLD_CORRELATION,
  callEvWithPlayersBehind,
  continuationOutcomes,
  foldCorrelation,
  layeredShowdownValue,
  sidePotLayers,
  wagerEvMultiway,
  type Responder,
} from './MultiwayTerms.js';

const R = (seat: number, fold: number, raise = 0, callChips = 100): Responder => ({
  seat,
  fold,
  raise,
  callChips,
  source: 'constructed',
});
const potNet = (f: number) => f;

describe('continuationOutcomes', () => {
  it('sums to one with the raised branch, every responder count 1..4', () => {
    for (let n = 1; n <= 4; n++) {
      const o = continuationOutcomes(
        Array.from({ length: n }, (_, i) => R(i + 1, 0.3 + 0.1 * i, 0.05 * i))
      )!;
      expect(o.outcomes.reduce((s, x) => s + x.p, 0) + o.pRaise).toBeCloseTo(1, 12);
      expect(o.outcomes).toHaveLength(1 << n);
    }
  });
  it('heads-up has no correlation term (equals the core HU product)', () => {
    const o = continuationOutcomes([R(1, 0.55)])!;
    expect(o.pAllFold).toBeCloseTo(0.55, 12);
    expect(o.correlation).toBe(1);
  });
  it('a wager into two responders (whoever made it): all-fold = product x shrunk pooled ratio (0.913, n=295)', () => {
    const o = continuationOutcomes([R(1, 0.8), R(2, 0.8)])!;
    const shrunk = (295 * 0.913 + 50) / (295 + 50);
    expect(o.pAllFoldIndependent).toBeCloseTo(0.64, 12);
    expect(o.pAllFold).toBeCloseTo(0.64 * shrunk, 12);
    expect(o.source).toContain('n=295');
  });
  it('all-fold never exceeds the no-raise mass', () => {
    const o = continuationOutcomes([R(1, 0.95, 0.05), R(2, 0.95, 0.05)])!;
    expect(o.pAllFold).toBeLessThanOrEqual(1 - o.pRaise + 1e-12);
  });
  it('returns null on non-finite input (core keeps its own term)', () => {
    expect(continuationOutcomes([R(1, Number.NaN)])).toBeNull();
  });
});

describe('wagerEvMultiway', () => {
  it('heads-up reproduces the core formula exactly', () => {
    const r = wagerEvMultiway({
      pot: 100,
      adds: 75,
      responders: [R(1, 0.4, 0, 75)],
      equityVs: () => 0.35,
      potNet,
      realization: 0.9,
    })!;
    expect(r.ev).toBeCloseTo(0.4 * 100 + 0.6 * (0.9 * 0.35 * 250 - 75), 9);
  });
  it('the measured (pooled) correlation lowers the all-fold share and the EV of a multiway air pot bet', () => {
    const base = {
      pot: 100,
      adds: 100,
      responders: [R(1, 0.7), R(2, 0.7)],
      equityVs: (c: number[]) => (c.length === 1 ? 0.05 : 0.03),
      potNet,
      realization: 1,
    };
    const o = continuationOutcomes(base.responders)!;
    expect(o.pAllFold).toBeLessThan(o.pAllFoldIndependent);
    const measured = wagerEvMultiway(base)!;
    const allFoldAtProduct = 0.49 * 100;
    expect(measured.ev).toBeLessThan(allFoldAtProduct);
  });
  it('isolation: equity is taken against exactly the set that continues', () => {
    const seen: string[] = [];
    wagerEvMultiway({
      pot: 60,
      adds: 60,
      responders: [R(1, 0.5), R(2, 0.5), R(3, 0.5)],
      equityVs: (c) => (seen.push(c.join(',')), 0.4),
      potNet,
      realization: 1,
    });
    expect(new Set(seen)).toEqual(new Set(['1', '2', '3', '1,2', '1,3', '2,3', '1,2,3']));
  });
  it('a re-raise share lowers the EV of a wager by the folded chips (default lower bound)', () => {
    const a = wagerEvMultiway({
      pot: 100,
      adds: 100,
      responders: [R(1, 0.5, 0), R(2, 0.5, 0)],
      equityVs: () => 0.5,
      potNet,
      realization: 1,
    })!;
    const b = wagerEvMultiway({
      pot: 100,
      adds: 100,
      responders: [R(1, 0.5, 0.1), R(2, 0.5, 0.1)],
      equityVs: () => 0.5,
      potNet,
      realization: 1,
    })!;
    expect(b.ev).toBeLessThan(a.ev);
    expect(b.pRaise).toBeCloseTo(1 - 0.9 * 0.9, 12);
  });
});

describe('callEvWithPlayersBehind', () => {
  it('a measured squeeze share (31%) turns a marginal call into a fold', () => {
    const spot = {
      pot: 150,
      toCall: 50,
      front: [1],
      equityVs: (s: number[]) => (s.length === 1 ? 0.3 : 0.22),
      potNet,
      realization: 1,
    };
    const noSqueeze = callEvWithPlayersBehind({ ...spot, behind: [R(3, 0.6, 0, 50)] })!;
    const squeeze = callEvWithPlayersBehind({ ...spot, behind: [R(3, 0.6, 0.31, 50)] })!;
    expect(noSqueeze.ev).toBeGreaterThan(0);
    expect(squeeze.ev).toBeLessThan(0);
  });
  it('nobody behind: plain pot odds', () => {
    const r = callEvWithPlayersBehind({
      pot: 150,
      toCall: 50,
      front: [1],
      behind: [],
      equityVs: () => 0.3,
      potNet,
      realization: 1,
    })!;
    expect(r.ev).toBeCloseTo(0.3 * 200 - 50, 9);
  });
});

describe('side pots', () => {
  it('cuts layers by contribution; folded chips stay in the layers they reached', () => {
    const L = sidePotLayers([
      { seat: 1, total: 50, live: true },
      { seat: 2, total: 200, live: true },
      { seat: 3, total: 200, live: true },
      { seat: 4, total: 10, live: false },
    ]);
    expect(L).toEqual([
      { amount: 160, eligible: [1, 2, 3] },
      { amount: 300, eligible: [2, 3] },
    ]);
  });
  it('the short stack wins only the main pot: each layer priced vs its own eligible set', () => {
    const L = sidePotLayers([
      { seat: 1, total: 50, live: true },
      { seat: 2, total: 200, live: true },
      { seat: 3, total: 200, live: true },
    ]);
    const short = layeredShowdownValue(1, L, () => 0.5, potNet)!;
    expect(short.value).toBeCloseTo(0.5 * 150, 9);
    const deep = layeredShowdownValue(2, L, (o) => (o.length === 2 ? 0.25 : 0.6), potNet)!;
    expect(deep.value).toBeCloseTo(0.25 * 150 + 0.6 * 300, 9);
  });
  it('an uncalled top layer is returned to its owner without rake', () => {
    const L = sidePotLayers([
      { seat: 1, total: 100, live: true },
      { seat: 2, total: 300, live: true },
    ]);
    const v = layeredShowdownValue(
      2,
      L,
      () => 0.5,
      (f) => f * 0.95
    )!;
    expect(v.value).toBeCloseTo(0.5 * 200 * 0.95 + 200, 9);
  });
});

describe('law: shipped tables are public', () => {
  it('the correlation table carries public_actions provenance and every cell names its n', () => {
    expect(MULTIWAY_FOLD_CORRELATION.provenance).toBe('public_actions');
    for (const c of Object.values(MULTIWAY_FOLD_CORRELATION.cells)) expect(c.n).toBeGreaterThan(0);
    expect(foldCorrelation(1).ratio).toBe(1);
  });
});
