/**
 * Determinism law (lane CORE-POOLED-5): the same state and the same seed give the same answer whatever the
 * clock does. The core's equity sampler is bounded by OMAHA_MATH_CORE_WORK_BUDGET and by fixed draw counts
 * only; no sampler reads the wall clock, so a loaded machine cannot change a decision (before this law a
 * stalled clock cut the draws short and a borderline call/fold could flip between two runs of one state).
 */
import { describe, expect, it } from 'vitest';
import { parseCardString } from './OmahaMathCoreEval.js';
import { equityVsPools, seededRng } from './OmahaMathCoreEquity.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';

const POS = ['SB', 'BB', 'UTG', 'HJ', 'CO'];
function spot(hole: string, board: string, opps: number, toCall: number, pot: number): CoreState {
  const street = board.length === 6 ? 'flop' : board.length === 8 ? 'turn' : 'river';
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    chipUnit: 0.01,
    mode: 'table',
    street,
    pot,
    toCall,
    heroBet: 0,
    heroStack: 1000,
    currentBet: toCall,
    minRaiseTo: toCall > 0 ? toCall * 2 : 2,
    maxRaiseTo: toCall > 0 ? toCall + pot + toCall : pot,
    bigBlind: 2,
    legal: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    heroSeat: 6,
    heroPosition: 'BTN',
    ip: true,
    opponents: Array.from({ length: opps }, (_, i) => ({
      seat: i + 1,
      user: `u${i + 1}`,
      person: i % 2 === 0,
      stack: 1000,
      bet: i === 0 ? toCall : 0,
      folded: false,
      allIn: false,
      streetAction: toCall > 0 && i === 0 ? 'wager' : 'check',
      calledPrevStreet: false,
      prevAggressor: false,
      position: POS[i],
      preflopLevel: 'call',
    })),
    aggressorSeat: toCall > 0 ? 1 : null,
    line: toCall > 0 ? 'stab' : null,
    band: toCall > 0 ? 'pot' : null,
    wagerFrac: toCall > 0 ? toCall / (pot - toCall) : 0,
    heroWagerLine: toCall > 0 ? 'raise' : 'stab',
    preflopRaises: 0,
    rake: { percent: 5, cap: 6, noFlopNoDrop: true },
    seed: `${hole}|${board}|${pot}|${toCall}|${opps}`,
    hole: parseCardString(hole),
    board: parseCardString(board),
  } as unknown as CoreState;
}

/** Clocks: frozen (the exact replay), a clock that jumps `step` ms on every read (a stalled, loaded host), the real one. */
const frozen = () => 0;
const jumping = (step: number) => {
  let t = 0;
  return () => (t += step);
};
const timeless = (k: string, v: unknown) =>
  /(^ms$|Ms$|^elapsed|^latency)/.test(k) ? undefined : v;
const answer = (s: CoreState, now: () => number) =>
  JSON.stringify(decideOmahaMathCore(s, { now }).receipt, timeless);

const HANDS: [string, string][] = [
  ['AhKhQdJdTc', '9h8h2c'],
  ['9h8h7c6dKd', '9c6h2h'],
  ['AsAd7h6h2c', 'Kh7d2s'],
  ['JsTs9d8d3c', 'QhJd4s'],
  ['AhKhQdJd', '9h8h2c'],
  ['9h8h7cKd', '9c6h2hTd'],
];

describe('the core answers the same whatever the clock does', () => {
  for (const [hole, board] of HANDS)
    for (const opps of [1, 2, 3, 5])
      for (const toCall of [0, 60]) {
        it(`${hole} on ${board}, ${opps} live, to call ${toCall}`, () => {
          const s = () => spot(hole, board, opps, toCall, toCall > 0 ? 160 : 100);
          const base = answer(s(), frozen);
          expect(answer(s(), frozen)).toBe(base);
          expect(answer(s(), jumping(37))).toBe(base);
          expect(answer(s(), jumping(1000))).toBe(base);
          expect(answer(s(), () => performance.now())).toBe(base);
        });
      }

  it('the equity sampler takes the same draws under any clock', () => {
    const state = spot('AhKhQdJdTc', '9h8h2c', 5, 0, 100);
    const size = 300;
    const hc = 5;
    const cards = new Int8Array(size * hc);
    const rng = seededRng('pool');
    const dead = new Set([...state.hole, ...state.board]);
    for (let i = 0; i < size; i++) {
      const used = new Set<number>();
      for (let k = 0; k < hc; k++) {
        let c: number;
        do c = Math.floor(rng() * 52);
        while (dead.has(c) || used.has(c));
        used.add(c);
        cards[i * hc + k] = c;
      }
    }
    const pool = { holeCount: hc, size, cards } as unknown as Parameters<typeof equityVsPools>[2];
    const idx = Array.from({ length: size }, (_, i) => i);
    const range = { label: 'all', parts: [{ idx, weight: 1 }] } as unknown as Parameters<
      typeof equityVsPools
    >[3][number];
    const run = (now: () => number) =>
      equityVsPools(state.hole, state.board, pool, [range, range], seededRng('x'), {
        targetSe: 0.01,
        minSamples: 400,
        maxSamples: 4000,
        now,
      });
    const a = run(frozen);
    const b = run(jumping(1000));
    expect(a.samples).toBeGreaterThanOrEqual(400);
    expect([b.equity, b.se, b.samples]).toEqual([a.equity, a.se, a.samples]);
  });
});
