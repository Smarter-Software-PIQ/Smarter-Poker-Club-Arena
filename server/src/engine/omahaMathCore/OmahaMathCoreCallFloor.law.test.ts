/**
 * Lane CORE-POOLED-2 laws (Nov 20; owner: "EVERYTHING DEPENDS ON THE MATH", "FIND THE LEAKS AND FIX IT").
 * Held-out hands 60252841 / 60256424: a multiway PLO5 flop call with equity 0.349 against a price of 0.27 was
 * priced -3.41 bb by the multi-street value plan ("call > check (0.95 check-fold | check > check down)") and
 * folded while the hero held the current nuts. Constructed spots only: no recorded hole cards.
 */
import { describe, expect, it } from 'vitest';
import { CALL_SHOWDOWN_FLOOR, planValue, type ValueSpot } from './OmahaMathCoreValue.js';
import { CURRENT_NUTS_CALL_FLOOR, holdsCurrentNuts } from './OmahaMathCoreNutsFloor.js';
import { parseCardString } from './OmahaMathCoreEval.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';

const net = (p: number) => p - Math.min(0.05 * p, 5);
/** the class of the bug: a multiway field that leads the next street 95% of the time, the field's
 * equity curve steep in the bettor's share (the whole field conditioned on his top share) */
const mwSpot = (eqAll: number, over: Partial<ValueSpot> = {}): ValueSpot => ({
  variant: 'plo5',
  street: 'flop',
  pot: 30,
  toCall: 8,
  heroStack: 400,
  oppStack: 400,
  nOpp: 4,
  ip: true,
  checkCloses: false,
  rakeNet: net,
  response: () => ({ fold: 0.1, raise: 0.15, callers: 3, n: 200, source: 'constructed' }),
  wagerWhenChecked: () => ({ p: 0.95, frac: 1, valueShare: 0.5, n: 300, source: 'constructed' }),
  equityAtShare: (s) => eqAll * Math.pow(Math.max(0.005, Math.min(1, s)), 2.5),
  equitySe: 0.01,
  seed: 'call-floor',
  ...over,
});
const callOf = (r: ReturnType<typeof planValue>) => r!.candidates.find((c) => c.kind === 'call')!;

describe('value plan: a call that beats its price is never priced below the fold by the plan alone', () => {
  it('the floor is on', () => {
    expect(CALL_SHOWDOWN_FLOOR).toBe(true);
    expect(CURRENT_NUTS_CALL_FLOOR).toBe(true);
  });
  it('equity 0.35 against a price of 0.21: the call is priced at its showdown EV, not the plan check-fold loss', () => {
    const s = mwSpot(0.35);
    const immediate = 0.35 * net(s.pot + s.toCall) - s.toCall;
    expect(immediate).toBeGreaterThan(0);
    const r = planValue(s)!;
    const call = callOf(r);
    expect(call.plan).toMatch(/showdown floor \(plan .* priced -/); // the plan alone priced it below the fold
    expect(call.ev).toBeCloseTo(immediate, 1); // candidate EVs are rounded to cents
    expect(r.choice.kind).not.toBe('fold');
  });
  it('turn: the same class keeps the call', () => {
    const r = planValue(mwSpot(0.4, { street: 'turn', toCall: 10, pot: 40 }))!;
    expect(callOf(r).ev).toBeGreaterThan(0);
    expect(r.choice.kind).not.toBe('fold');
  });
  it('control: equity below the price is not floored (the fold stays available)', () => {
    const s = mwSpot(0.12);
    expect(0.12 * net(s.pot + s.toCall) - s.toCall).toBeLessThan(0);
    const call = callOf(planValue(s));
    expect(call.plan).not.toMatch(/showdown floor/);
    expect(call.ev).toBeLessThan(0);
  });
  it('a positive plan price is the plan price (the floor only lifts a call the plan would fold)', () => {
    const s = mwSpot(0.6, { wagerWhenChecked: () => null });
    const call = callOf(planValue(s));
    expect(call.plan).not.toMatch(/showdown floor/);
    expect(call.ev).toBeGreaterThan(0);
  });
});

describe('current nuts: exact, every unseen two cards', () => {
  const nuts = (h: string, b: string) => holdsCurrentNuts(parseCardString(h), parseCardString(b));
  it('the royal flush on a three-suited flop is the nuts', () => {
    expect(nuts('JsTs2c3d', 'AsKsQs')).toBe(true);
    expect(nuts('JsTs2c3d4h', 'AsKsQs')).toBe(true);
  });
  it('top set on a monotone straight board is not', () => {
    expect(nuts('AhAd2c3d', 'AsKsQs')).toBe(false);
  });
  it('the nut straight on a rainbow unpaired turn is the nuts; a non-straight is not', () => {
    expect(nuts('9h8c2d3s', 'Ts7d6c2h')).toBe(true); // T-9-8-7-6: no two cards make a higher straight
    expect(nuts('9h8c3d4s', 'Js7d6c2h')).toBe(false); // no straight: sets and two pairs beat it
    expect(nuts('Th9c3d4s', 'Js8d7c2h')).toBe(true); // J-T-9-8-7 is the best straight; no flush, no pair
  });
  it('a paired board: the best full house or quads is required', () => {
    expect(nuts('KhKd2c3d', 'KsKc7h')).toBe(true); // quads
    expect(nuts('7d7c2c3d', 'KsKc7h')).toBe(false); // sevens full loses to kings full and quads
  });
});

function spot(hole: string, board: string, nOpp: number): CoreState {
  const toCall = 40;
  const pot = 160;
  const opps = Array.from({ length: nOpp }, (_, i) => ({
    seat: i + 1,
    user: `u${i + 1}`,
    person: i % 2 === 0,
    stack: 1000,
    bet: i === 0 ? toCall : 0,
    folded: false,
    allIn: false,
    streetAction: i === 0 ? 'wager' : 'none',
    calledPrevStreet: true,
    prevAggressor: i === 0,
    position: 'BB',
    preflopLevel: 'call',
  }));
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    chipUnit: 0.01,
    mode: 'table',
    street: board.length === 6 ? 'flop' : 'turn',
    pot,
    toCall,
    heroBet: 0,
    heroStack: 1000,
    currentBet: toCall,
    minRaiseTo: toCall * 2,
    maxRaiseTo: toCall + pot + toCall,
    bigBlind: 2,
    legal: ['fold', 'call', 'raise', 'all_in'],
    heroSeat: 6,
    heroPosition: 'CO',
    ip: false,
    opponents: opps,
    aggressorSeat: 1,
    line: 'cbet',
    band: 'half',
    wagerFrac: toCall / (pot - toCall),
    heroWagerLine: 'raise',
    preflopRaises: 1,
    rake: { percent: 5, cap: 6, noFlopNoDrop: true },
    seed: `${hole}|${board}|${nOpp}`,
    hole: parseCardString(hole),
    board: parseCardString(board),
  } as unknown as CoreState;
}
const now = () => performance.now();

describe('core: the current nuts facing a flop/turn wager are never folded', () => {
  for (const [hole, board, n] of [
    ['JsTs2c3d4h', 'AsKsQs', 4],
    ['Th9c3d4s5h', 'Js8d7c', 3],
    ['Th9c3d4s', 'Js8d7c2h', 2],
  ] as const) {
    it(`${hole.length / 2} cards, ${board.length / 2}-card board, ${n} opponents: no fold candidate, receipt names the floor`, () => {
      const { receipt } = decideOmahaMathCore(spot(hole, board, n), { now });
      expect(receipt.evs.some((e) => e.action === 'fold')).toBe(false);
      expect(receipt.nutFloor).toMatch(/current nuts/);
      expect(receipt.choice.action).not.toBe('fold');
    });
  }
  it('control: a hand that is not the nuts keeps the fold as a priced candidate', () => {
    const { receipt } = decideOmahaMathCore(spot('AhAd2c3d4h', 'AsKsQs', 4), { now });
    expect(receipt.evs.some((e) => e.action === 'fold')).toBe(true);
    expect(receipt.nutFloor ?? null).toBeNull();
  });
});
