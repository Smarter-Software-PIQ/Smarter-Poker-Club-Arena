/**
 * XR-BLUFF constructed spots (owner 8:27 PM Chicago, Nov 19): check-raise for
 * value and as a bluff, in and out of position, PLO4/PLO5. No real hole cards:
 * every hand here is constructed. The decision is lane VALUE's planValue (the one
 * check node / raise formula) with this lane's bluffCtx (blockers);
 * the field ranges and the hero's equity against the strongest share of them are
 * computed exactly (2 hole + 3 board) on shared seeded completions.
 */
import { describe, expect, it } from 'vitest';

import { categoryOf, omahaBest, parseCardString } from './OmahaMathCoreEval.js';
import { blockerShiftOf, xrBluffCtx } from './OmahaMathCoreBluff.js';
import {
  equityCurveFromHoldings,
  planValue,
  type ValueReceipt,
  type ValueResponse,
  type ValueSpot,
} from './OmahaMathCoreValue.js';

function rngOf(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Field holdings matching `keep`, ordered strongest first, and the hero's exact equity against each. */
function field(
  heroText: string,
  boardText: string,
  keep: (category: number, hold: number[], board: number[]) => boolean,
  seed: number,
  size = 260,
  runs = 40
): { curve: (share: number) => number; eqAll: number } {
  const hero = parseCardString(heroText);
  const board = parseCardString(boardText);
  const hc = hero.length;
  const rng = rngOf(seed);
  const used = new Set<number>([...hero, ...board]);
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const holds: number[][] = [];
  let guard = 0;
  while (holds.length < size && guard++ < size * 400) {
    const d = deck.slice();
    const h: number[] = [];
    for (let k = 0; k < hc; k++) {
      const j = k + Math.floor(rng() * (d.length - k));
      [d[k], d[j]] = [d[j], d[k]];
      h.push(d[k]);
    }
    const cat = categoryOf(omahaBest(h, hc, board, board.length));
    if (keep(cat, h, board)) holds.push(h);
  }
  const n = holds.length;
  const strength = new Float64Array(n);
  const win = new Float64Array(n);
  const cnt = new Float64Array(n);
  const missing = 5 - board.length;
  const nr = missing === 0 ? 1 : runs;
  for (let r = 0; r < nr; r++) {
    const full = board.slice();
    const taken = new Set<number>([...hero, ...board]);
    while (full.length < 5) {
      const c = deck[Math.floor(rng() * deck.length)];
      if (!taken.has(c)) {
        taken.add(c);
        full.push(c);
      }
    }
    const hs = omahaBest(hero, hc, full, 5);
    const sc: number[] = [];
    const ok: number[] = [];
    for (let i = 0; i < n; i++) {
      if (holds[i].some((c) => full.slice(board.length).includes(c))) continue;
      const s = omahaBest(holds[i], hc, full, 5);
      sc[i] = s;
      ok.push(i);
      win[i] += hs > s ? 1 : hs === s ? 0.5 : 0;
      cnt[i] += 1;
    }
    const sorted = ok.slice().sort((a, b) => sc[a] - sc[b]);
    sorted.forEach((i, k) => (strength[i] += k / Math.max(1, sorted.length - 1)));
  }
  const equity = new Float64Array(n);
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    equity[i] = cnt[i] > 0 ? win[i] / cnt[i] : 0;
    weight[i] = cnt[i] > 0 ? 1 : 0;
    strength[i] = cnt[i] > 0 ? strength[i] / cnt[i] : 0;
  }
  const order = Int32Array.from(
    Array.from({ length: n }, (_, i) => i)
      .filter((i) => weight[i] > 0)
      .sort((a, b) => strength[b] - strength[a])
  );
  const curve = equityCurveFromHoldings(order, weight, equity);
  return { curve, eqAll: curve(1) };
}

const noRake = (p: number) => p;

function cell(fold: number, raise: number, source: string): ValueResponse {
  // COREWIRE: a measured cell carries its count (lead: raises need n >= 30 for fold credit; these spots state measured cells)
  return { fold, raise, callers: 1, n: 100, source };
}

function spot(
  over: Partial<ValueSpot> &
    Pick<ValueSpot, 'variant' | 'street' | 'pot' | 'toCall' | 'equityAtShare'>
): ValueSpot {
  return {
    heroStack: 300,
    oppStack: 300,
    nOpp: 1,
    ip: false,
    checkCloses: false,
    rakeNet: noRake,
    response: () => cell(0.4, 0.06, 'constructed'),
    wagerWhenChecked: () => ({ p: 0.5, frac: 0.66, source: 'constructed' }),
    equitySe: 0.01,
    seed: 'xr-test',
    ...over,
  };
}

/** The core's call EV (no later street), the baseline every raise must beat. */
const callEv = (eq: number, pot: number, toCall: number) => eq * (pot + toCall) - toCall;
const bestWager = (r: ValueReceipt) =>
  r.candidates.filter((c) => c.kind === 'wager').reduce((a, b) => (b.ev > a.ev ? b : a));
const checkCand = (r: ValueReceipt) => r.candidates.find((c) => c.kind === 'check')!;
/** lane VALUE's multi-street call candidate when present (proposed in XR-BLUFF.md), else the core's call EV. */
const callBaseline = (r: ValueReceipt, eq: number, pot: number, toCall: number) => {
  const c = r.candidates.find((x) => (x as { kind: string }).kind === 'call');
  return c ? Math.max(c.ev, callEv(eq, pot, toCall)) : callEv(eq, pot, toCall);
};

describe('XR-BLUFF: check-raise and bluff spots priced by the one EV node', () => {
  it('OOP flop check-raise semi-bluff: nut wrap + nut flush draw vs a c-bet from a one-pair-heavy range', () => {
    // hero checked; the c-bettor's range: one pair (most) and two pair; he bet 15 into 20
    const f = field('AhKhQc9d', 'JhTh3c', (cat) => cat === 1 || cat === 2, 11);
    const pot = 35;
    const toCall = 15;
    const r = planValue(
      spot({
        variant: 'plo4',
        street: 'flop',
        pot,
        toCall,
        equityAtShare: f.curve,
        response: (_fr, allIn, off, line) =>
          off === 0
            ? cell(allIn ? 0.5 : 0.45, 0.06, `fold to ${line}`)
            : cell(0.42, 0.05, 'later street'),
      })
    )!;
    const raise = bestWager(r);
    expect(f.eqAll).toBeGreaterThan(0.45); // a combo draw has real equity when called
    expect(raise.ev).toBeGreaterThan(callBaseline(r, f.eqAll, pot, toCall));
    expect(raise.ev).toBeGreaterThan(0);
  });

  it('OOP value check-raise: top set on a two-tone connected flop vs a frequent stabber', () => {
    // the stabber bets 80% of his checked-to range; he folds 55% to a lead but only 30% once he has bet
    const f = field('JcJd9c4s2d', 'JsTs8h', () => true, 12);
    const r = planValue(
      spot({
        variant: 'plo5',
        street: 'flop',
        pot: 20,
        toCall: 0,
        equityAtShare: f.curve,
        wagerWhenChecked: (off) => ({ p: off === 0 ? 0.8 : 0.5, frac: 0.6, source: 'stabber' }),
        response: (_fr, _a, off, line) =>
          line === 'check_raise'
            ? cell(0.3, 0.1, 'fold to check-raise')
            : cell(off === 0 ? 0.55 : 0.45, 0.06, 'fold to lead'),
      })
    )!;
    const c = checkCand(r);
    expect(r.choice.kind).toBe('check');
    expect(c.plan).toMatch(/check-raise/);
    expect(c.ev).toBeGreaterThan(bestWager(r).ev);
  });

  describe('IP raise semi-bluff: pair + open-ended straight draw + flush draw vs a donk lead', () => {
    const f = field('9h8h7cTd', 'Th6h2c', (cat) => cat >= 1, 13);
    const pot = 30;
    const toCall = 10;
    const ipSpot = (foldToRaise: number) =>
      planValue(
        spot({
          variant: 'plo4',
          street: 'flop',
          pot,
          toCall,
          ip: true,
          equityAtShare: f.curve,
          response: (_fr, _a, off) =>
            off === 0 ? cell(foldToRaise, 0.07, 'fold to raise vs donk') : cell(0.4, 0.05, 'later'),
        })
      )!;
    it('prices the raise beside the call symmetrically: both later-street continuations carry capped: true (no unmeasured barrel fold credit), so the >50%-equity semi-bluff raise beats the call', () => {
      // CORE-LEAD4 B1 (superseding COREWIRE-2 asymmetry): neither a called raise nor a called wager has a
      // measured later-street barrel fold cell against the aggressor, so both carry capped: true on later streets;
      // the call no longer steals phantom turn/river barrel fold credit over the semi-bluff raise.
      const r = ipSpot(0.3);
      expect(f.eqAll).toBeGreaterThan(0.5);
      const w = bestWager(r);
      expect(Number.isFinite(w.ev)).toBe(true);
      expect(r.choice.kind).toBe('wager');
      expect(w.ev).toBeGreaterThan(callBaseline(r, f.eqAll, pot, toCall));
    });
  });

  describe('river check-raise bluff with the nut-flush blocker', () => {
    const hero = 'AhQcJd6s3c';
    const board = 'Kh8h4h9c2s';
    const f = field(hero, board, () => true, 14);
    const blockers = blockerShiftOf({
      variant: 'plo5',
      hero: parseCardString(hero),
      board: parseCardString(board),
      best: omahaBest,
      rng: rngOf(99),
    })!;
    const riverSpot = (foldToCheckRaise: number, ctx?: ValueSpot['bluffCtx']) =>
      planValue(
        spot({
          variant: 'plo5',
          street: 'river',
          pot: 40,
          toCall: 0,
          equityAtShare: f.curve,
          wagerWhenChecked: () => ({
            p: 0.5,
            frac: 0.5,
            valueShare: 0.5,
            source: 'bets half his range, half value',
          }),
          response: (_fr, _a, _o, line) =>
            line === 'check_raise'
              ? cell(foldToCheckRaise, 0.03, 'measured fold to river check-raise')
              : cell(0.4, 0.05, 'lead'),
          bluffCtx: ctx,
        })
      )!;

    it('the hero holds no made hand worth a showdown and blocks the nut flush', () => {
      expect(f.eqAll).toBeLessThan(0.35);
      // the strongest continues shrink with the ace of hearts; without a heart the field holds more flushes
      expect(blockers.at.c10).toBeLessThan(0);
      const noHeart = blockerShiftOf({
        variant: 'plo5',
        hero: parseCardString('QcJd6s3c2d'),
        board: parseCardString(board),
        best: omahaBest,
        rng: rngOf(99),
      })!;
      expect(noHeart.at.c10).toBeGreaterThan(blockers.at.c10);
      expect(noHeart.at.c30).toBeGreaterThan(blockers.at.c30);
    });

    it('check-raises as a bluff when the measured fold-to-raise pays', () => {
      const r = riverSpot(0.7, { blockerShift: blockers.shift });
      expect(checkCand(r).plan).toMatch(/check-raise/);
    });

    it('does not when the measured fold-to-raise does not pay', () => {
      const r = riverSpot(0.2, { blockerShift: blockers.shift });
      expect(checkCand(r).plan).not.toMatch(/check-raise/);
    });
  });

  it('no bluff against a measured calling station', () => {
    const f = field('QcJd6s3c2d', 'Kh8h4h9c2s'.replace('2s', '5s'), () => true, 15);
    const r = planValue(
      spot({
        variant: 'plo5',
        street: 'river',
        pot: 40,
        toCall: 0,
        equityAtShare: f.curve,
        wagerWhenChecked: () => ({ p: 0.4, frac: 0.5, source: 'station' }),
        response: () => cell(0.05, 0.02, 'calling station'),
      })
    )!;
    expect(r.choice.kind).toBe('check');
    expect(checkCand(r).plan).not.toMatch(/check-raise/);
  });

  it('PLO6 invariance: nothing in this programme prices a PLO6 spot', () => {
    const r = planValue(
      spot({ variant: 'plo6', street: 'flop', pot: 20, toCall: 0, equityAtShare: () => 0.5 })
    );
    expect(r).toBeNull();
    expect(
      xrBluffCtx({
        variant: 'plo6',
        holeCount: 6,
        blockers: null,
      })
    ).toBeNull();
    expect(
      blockerShiftOf({
        variant: 'plo6',
        hero: parseCardString('AhKhQhJhTh9h'),
        board: parseCardString('2c3d4s'),
        best: omahaBest,
        rng: rngOf(1),
      })
    ).toBeNull();
  });
});
