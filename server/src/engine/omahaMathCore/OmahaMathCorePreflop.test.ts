/**
 * Lane PREFLOP-EV law tests (synthetic cards only; no real hand's cards).
 * Card index = rank * 4 + suit, rank 0 = '2' .. 12 = 'A', suit c d h s.
 */
import { selectionScore } from './OmahaMathCoreWire.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decideOmahaMathCore, type CoreOpponent, type CoreState } from './OmahaMathCore.js';
import { buildPool, seededRng } from './OmahaMathCoreEquity.js';
import {
  PF_REAL,
  PF_TABLES,
  bandOf,
  preflopFold,
  preflopOpponentModel,
  preflopRealization,
  preflopStrength,
} from './OmahaMathCorePreflop.js';

const R = '23456789TJQKA';
const S = 'cdhs';
const c = (t: string) => R.indexOf(t[0]) * 4 + S.indexOf(t[1]);
const H = (s: string) => s.match(/../g)!.map(c);
const clock = { now: () => performance.now() };

function opp(p: Partial<CoreOpponent> & { seat: number }): CoreOpponent {
  return {
    stack: 200,
    bet: 0,
    folded: false,
    allIn: false,
    streetAction: 'none',
    calledPrevStreet: false,
    prevAggressor: false,
    position: null,
    preflopLevel: 'none',
    ...p,
  };
}
function state(p: Partial<CoreState>): CoreState {
  return {
    variant: 'plo5',
    chipUnit: 0.01,
    mode: 'table',
    street: 'preflop',
    hole: H('AsAhKsQhJd'),
    board: [],
    pot: 3,
    toCall: 1,
    heroBet: 1,
    heroStack: 199,
    currentBet: 2,
    minRaiseTo: 4,
    maxRaiseTo: 7,
    bigBlind: 2,
    legal: ['fold', 'call', 'raise', 'all_in'],
    heroSeat: 1,
    heroPosition: 'BTN',
    ip: true,
    opponents: [],
    aggressorSeat: null,
    line: null,
    band: null,
    wagerFrac: 0,
    heroWagerLine: 'raise',
    preflopRaises: 0,
    rake: { percent: 5, cap: 3, noFlopNoDrop: true },
    seed: 'pf-law',
    ...p,
  };
}

describe('PREFLOP-EV provenance (lead rule: public information only)', () => {
  it('frequency table is built from public actions only and says so', () => {
    const pv = JSON.stringify(PF_TABLES.provenance);
    expect(pv).toMatch(/public preflop actions only/);
    expect(pv).toMatch(/NO hole cards/);
    expect(Object.keys(PF_TABLES)).not.toContain('ranges'); // no card-composition ranges shipped
  });
  it('realization table reads no opponent hole card and says so', () => {
    expect(JSON.stringify(PF_REAL.provenance)).toMatch(/No opponent hole cards are read/);
    for (const v of Object.values(PF_REAL.shrunk)) expect(v.r).toBeGreaterThan(0);
  });
  it('no categorical hand gates in the component source', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./OmahaMathCorePreflop.ts', import.meta.url)),
      'utf8'
    );
    expect(src).not.toMatch(
      /premium|rundown|double.?suited|AAxx|handClass|percentile gate|persona/i
    );
  });
});

describe('PREFLOP-EV opponent model', () => {
  const pool = buildPool(H('AsAhKsQhJd'), [], 5, 400, 10, seededRng('pool'));
  it('fold rate is size-aware and names its cell and n', () => {
    const o = opp({ seat: 2, position: 'BB', preflopLevel: 'none' });
    const s = state({ opponents: [o] });
    const pot = preflopFold(s, o, 'open', 7);
    expect(pot.source).toMatch(/facing_open\|.*\(n=\d+\)/);
    expect(pot.source).toMatch(/\|pot\||\|all\|/);
    const allin = preflopFold(s, o, 'open', 200);
    expect(allin.source).toMatch(/\|allin\||\|all\|/);
    expect(pot.p).toBeGreaterThanOrEqual(0);
    expect(pot.p).toBeLessThanOrEqual(1);
  });
  it('every opponent gets the same pooled cell: the fold source carries no person/Horse or user key', () => {
    const a = opp({ seat: 2, position: 'BB' });
    const b = opp({ seat: 3, position: 'BB' });
    const x = preflopFold(state({ opponents: [a] }), a, 'open', 7);
    const y = preflopFold(state({ opponents: [b] }), b, 'open', 7);
    expect(x).toEqual(y);
    expect(x.source).not.toMatch(/person|horse|vs_/);
    expect(Object.keys(PF_TABLES)).not.toContain('persons');
  });
  it('bands chain public frequencies: open < limp band; 3-bet inside the top of facing-open; BB check = below raise share', () => {
    const s = state({ preflopRaises: 1 });
    const opener = bandOf(s, opp({ seat: 2, position: 'CO', preflopLevel: 'open' }));
    const limper = bandOf(
      state({ preflopRaises: 0 }),
      opp({ seat: 3, position: 'CO', preflopLevel: 'call' })
    );
    const three = bandOf(
      state({ preflopRaises: 2 }),
      opp({ seat: 4, position: 'BTN', preflopLevel: '3bet' })
    );
    const four = bandOf(
      state({ preflopRaises: 3 }),
      opp({ seat: 4, position: 'CO', preflopLevel: '4bet' })
    );
    expect(opener.lo).toBe(0);
    expect(limper.lo).toBeGreaterThan(0);
    expect(limper.hi).toBeGreaterThan(limper.lo);
    expect(three.hi).toBeLessThan(1);
    expect(four.hi).toBeLessThan(opener.hi);
    for (const b of [opener, limper, three, four]) expect(b.source).toMatch(/n=\d+/);
  });
  it('explicit public action line is used when present', () => {
    const s = state({ preflopRaises: 1 }) as CoreState & { preflopActions: unknown[] };
    s.preflopActions = [
      { seat: 3, action: 'call', level: 0, limpers: 0, position: 'UTG' },
      { seat: 3, action: 'call', level: 1, limpers: 1, position: 'UTG' },
    ];
    const b = bandOf(s, opp({ seat: 3, position: 'UTG', preflopLevel: 'call' }));
    expect(b.source.split(' > ').length).toBe(2);
  });
  it('PLO4 and PLO5 work; PLO6 is out of scope (owner 8:26 PM) and gets no measured cell; never throws on odd input', () => {
    for (const [v, hole] of [
      ['plo4', 'AsAhKsQh'],
      ['plo5', 'AsAhKsQhJd'],
    ] as const) {
      const pl = buildPool(H(hole), [], hole.length / 2, 200, 4, seededRng(v));
      const m = preflopOpponentModel(
        state({
          variant: v,
          hole: H(hole),
          opponents: [
            opp({ seat: 2, position: 'BB' }),
            opp({ seat: 3, position: null, preflopLevel: '5bet+' }),
          ],
        }),
        pl
      );
      expect(m.rangeOf.size).toBe(2);
      expect(Number.isFinite(m.realization.value)).toBe(true);
    }
    const p6 = buildPool(H('AsAhKsQhJdTd'), [], 6, 100, 2, seededRng('p6'));
    const m6 = preflopOpponentModel(
      state({
        variant: 'plo6' as never, // CoreState is plo4 | plo5 only (PLO6 out of scope); the model must still refuse it
        hole: H('AsAhKsQhJdTd'),
        opponents: [opp({ seat: 2, position: 'BB' })],
      }),
      p6
    );
    expect(m6.realization.source).toMatch(/PLO4 \+ PLO5 only/);
    const weird = state({
      opponents: [opp({ seat: 9, position: null, preflopLevel: 'open', stack: -5 })],
      pot: 0,
      heroStack: 0,
    });
    expect(() => preflopOpponentModel(weird, pool)).not.toThrow();
  });
  it('realization: all-in is 1; otherwise a measured cell by mode/IP/players/SPR', () => {
    const s = state({ opponents: [opp({ seat: 2, position: 'BB' })] });
    expect(preflopRealization(s, 10, 0, 2, true).value).toBe(1);
    const r = preflopRealization(s, 10, 190, 2, false);
    expect(r.source).toMatch(/table\|ip\|2\|spr10\+/);
  });
});

describe('PREFLOP-EV behaviour through the core (one path for table and Lightning)', () => {
  // hero 3-bet, villain (person, CO opener) 4-bet pot; hero to act
  const facing4bet = (
    hole: string,
    mode: 'table' | 'lightning',
    heroStack: number,
    oppStack: number
  ) =>
    state({
      mode,
      hole: H(hole),
      heroPosition: 'BTN',
      ip: true,
      preflopRaises: 3,
      opponents: [
        opp({
          seat: 2,
          position: 'CO',
          preflopLevel: '4bet',
          bet: 66,
          stack: oppStack,
          streetAction: 'wager',
        }),
      ],
      aggressorSeat: 2,
      pot: 3 + 66 + 22,
      heroBet: 22,
      toCall: 44,
      currentBet: 66,
      heroStack,
      minRaiseTo: 110,
      maxRaiseTo: Math.min(22 + heroStack, 66 + (3 + 66 + 22) + 44),
    });
  it('aces short-stacked facing a raise with only a short all-in legal get the stack in', () => {
    // all-in is less than a full raise: no raise range, all-in legal
    const s = state({
      hole: H('AsAhKsQhJd'),
      preflopRaises: 3,
      heroPosition: 'BTN',
      opponents: [
        opp({
          seat: 2,
          position: 'CO',
          preflopLevel: '4bet',
          bet: 66,
          stack: 300,
          streetAction: 'wager',
        }),
      ],
      aggressorSeat: 2,
      pot: 91,
      heroBet: 22,
      toCall: 44,
      currentBet: 66,
      heroStack: 60,
      minRaiseTo: null,
      maxRaiseTo: null,
      legal: ['fold', 'call', 'all_in'],
    });
    const { receipt } = decideOmahaMathCore(s, clock);
    expect(receipt.choice.action).toBe('all_in');
    expect(receipt.evs.find((e) => e.action === 'all_in')!.ev).toBeGreaterThan(0);
  });
  it('aces deep facing a 4-bet do not fold and price the all-in', () => {
    const { receipt } = decideOmahaMathCore(facing4bet('AsAhKsQhJd', 'table', 400, 400), clock);
    expect(receipt.choice.action).not.toBe('fold');
    expect(receipt.evs.some((e) => e.action === 'all_in' || e.action === 'raise')).toBe(true);
  });
  // CORE-4 (2026-11-20, owner 12:01 AM: the math decides, no standing strategy order protects a rule): the old law
  // "AKQQ rainbow calls a 4-bet" is REMOVED. Real cards contradict it: AcKdQhQs7c's all-in equity vs persons' REAL
  // PLO5 4-bet holdings is 0.542 +- 0.009 (n 95; CORE-3), and PREFLOP-AUDIT's 5-week realised grade of the class
  // (re-raise minus call facing a 3-bet+) is -6.4 +- 12.0 bb: INSUFFICIENT either way. What remains is the law that
  // holds for every holding: the choice is the core's max of its selection score (EV minus one SE), never a class.
  it('facing a 4-bet the choice is the max-EV action for every holding (no hand-class rule); aces never fold', () => {
    const akqq = decideOmahaMathCore(facing4bet('AcKdQhQs7c', 'table', 400, 400), clock).receipt;
    const aces = decideOmahaMathCore(facing4bet('AsAhKsQhJd', 'table', 400, 400), clock).receipt;
    const run = decideOmahaMathCore(facing4bet('JhTh9s8s7d', 'table', 400, 400), clock).receipt;
    for (const r of [akqq, aces, run]) {
      const best = Math.max(...r.evs.map((e) => selectionScore(e)));
      const chosen = r.evs.find(
        (e) => e.action === r.choice.action && (e.amount ?? null) === (r.choice.amount ?? null)
      )!;
      expect(selectionScore(chosen)).toBeCloseTo(best, 6);
    }
    expect(aces.choice.action).not.toBe('fold');
  });
  it('strength order is the two-card equity model, not a hand-class chart: aces > AKQQ rainbow > rags', () => {
    const a = preflopStrength('plo5', H('AsAhKsQhJd'))!;
    const k = preflopStrength('plo5', H('AcKdQhQs7c'))!;
    const z = preflopStrength('plo5', H('9c8d4h3s2c'))!;
    expect(a).toBeGreaterThan(k);
    expect(k).toBeGreaterThan(z);
    expect(preflopStrength('plo6', H('AsAhKsQhJdTd'))).toBeNull();
  });
  it('table and Lightning run the same path; only measured cells differ', () => {
    const t = decideOmahaMathCore(facing4bet('AsAhKsQhJd', 'table', 400, 400), clock).receipt;
    const l = decideOmahaMathCore(facing4bet('AsAhKsQhJd', 'lightning', 400, 400), clock).receipt;
    expect(t.version).toBe(l.version);
    expect(t.evs.map((e) => e.action)).toEqual(l.evs.map((e) => e.action));
    expect(l.realization.source).toMatch(/lightning|none applied/);
  });
  it('a deep own stack prices effective depth against the opponent it plays (v21Deep HorsePreflop.ts:4027 not reproduced)', () => {
    const r = decideOmahaMathCore(facing4bet('AsAhKsQhJd', 'table', 5000, 150), clock).receipt;
    const ai = r.evs.find((e) => e.action === 'all_in' || e.action === 'raise');
    expect(ai).toBeTruthy();
    // the call line's SPR uses the 150 behind the opponent, not the hero's 5000
    expect(r.realization.source).toMatch(/spr=(\d+(\.\d+)?)/);
    const spr = Number(r.realization.source.match(/spr=(\d+(\.\d+)?)/)![1]);
    expect(spr).toBeLessThan(5);
  });
  it('unopened decision prices fold, limp and raises with size-aware fold credit (no fold for free)', () => {
    const s = state({
      hole: H('9c8d4h3s2c'),
      heroPosition: 'UTG',
      ip: false,
      mode: 'lightning',
      pot: 3,
      toCall: 2,
      heroBet: 0,
      heroStack: 200,
      currentBet: 2,
      minRaiseTo: 4,
      maxRaiseTo: 7,
      opponents: [
        opp({ seat: 2, position: 'SB', bet: 1, stack: 199 }),
        opp({ seat: 3, position: 'BB', bet: 2, stack: 198 }),
        opp({ seat: 4, position: 'BTN' }),
      ],
    });
    const { receipt } = decideOmahaMathCore(s, clock);
    expect(receipt.evs.map((e) => e.action)).toEqual(
      expect.arrayContaining(['fold', 'call', 'raise'])
    );
    const raise = receipt.evs.find((e) => e.action === 'raise')!;
    expect(raise.foldSource).toMatch(/fold .* reraise/);
    expect(receipt.choice.action).toBe('fold');
  });
  it('a limp / SB complete prices the raise behind (iso) one step deep, from public frequencies', () => {
    const s = state({
      hole: H('Kc9d6h4s2c'),
      heroPosition: 'SB',
      ip: false,
      pot: 3,
      toCall: 1,
      heroBet: 1,
      heroStack: 199,
      currentBet: 2,
      minRaiseTo: 4,
      maxRaiseTo: 6,
      opponents: [opp({ seat: 3, position: 'BB', bet: 2, stack: 198 })],
    });
    const { receipt } = decideOmahaMathCore(s, clock);
    const call = receipt.evs.find((e) => e.action === 'call')!;
    expect(call.foldSource).toMatch(/raise behind by s3/);
    expect(call.foldSource).toMatch(/n=\d+/);
  });
});
