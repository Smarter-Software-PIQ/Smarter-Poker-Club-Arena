/**
 * Lane CORE-LEAD4 / B1 repair (PLO-OWNER lead-4, Nov 21 2026): calling a wager (root `call` or
 * `check-call` inside `checkEv`) faces an aggressor, not an ordinary flop caller. The measured
 * turn/river `'barrel'` fold cells do not measure how an aggressor or check-raiser responds to a
 * caller's later-street donk or float bluff. Both continuations therefore carry `capped: true`,
 * matching the raised branch (`isRaise`), so a weak call cannot turn negative immediate EV into a
 * huge positive EV from phantom turn/river bluff fold equity (and a monster hand does not flat
 * instead of raising because `call` received later-street fold credit that `raise` did not).
 *
 * Constructed spots only: no recorded hole cards. PLO6 and core-off paths are untouched.
 */
import { describe, expect, it } from 'vitest';
import { planValue, type ValueSpot } from './OmahaMathCoreValue.js';

const net = (p: number) => p - Math.min(0.05 * p, 5);

const facingSpot = (eqVal: number, over: Partial<ValueSpot> = {}): ValueSpot => ({
  variant: 'plo5',
  street: 'flop',
  pot: 213,
  toCall: 94,
  heroStack: 600,
  oppStack: 600,
  nOpp: 1,
  ip: true,
  checkCloses: false,
  rakeNet: net,
  // generic turn/river barrel fold rate ~55%, thin raise rate
  response: (_f, _a, off) =>
    off === 0
      ? { fold: 0.2, raise: 0.1, callers: 1, n: 200, source: 'constructed flop' }
      : { fold: 0.55, raise: 0.08, callers: 1, n: 400, source: 'constructed barrel' },
  wagerWhenChecked: () => ({ p: 0.48, frac: 0.7, valueShare: 0.7, n: 400, source: 'constructed' }),
  equityAtShare: () => eqVal,
  equitySe: 0.01,
  seed: 'call-capped-b1',
  ...over,
});

const callOf = (r: ReturnType<typeof planValue>) => r!.candidates.find((c) => c.kind === 'call')!;

describe('omahaMathCore value: call and check-call carry capped: true (no phantom later-street barrel fold credit)', () => {
  it('IP flop call with 11% equity facing 30.6% price folds instead of fabricating +EV from turn/river bluffs', () => {
    const s = facingSpot(0.11, { ip: true });
    expect(0.11 * net(s.pot + s.toCall) - s.toCall).toBeLessThan(0);
    const r = planValue(s)!;
    const call = callOf(r);
    expect(call.ev).toBeLessThan(0);
    expect(r.choice.kind).toBe('fold');
  });

  it('OOP flop call with 14% equity facing 28% price folds instead of taking phantom turn/river barrel fold credit', () => {
    const s = facingSpot(0.14, { ip: false, pot: 90, toCall: 35 });
    expect(0.14 * net(s.pot + s.toCall) - s.toCall).toBeLessThan(0);
    const r = planValue(s)!;
    const call = callOf(r);
    expect(call.ev).toBeLessThan(0);
    expect(r.choice.kind).toBe('fold');
  });

  it('OOP flop check facing a bet does not price check-call as +EV via phantom turn/river barrel bluffs', () => {
    const r = planValue(
      facingSpot(0.12, {
        toCall: 0,
        pot: 100,
        ip: false,
        checkCloses: false,
        wagerWhenChecked: () => ({
          p: 0.7,
          frac: 0.75,
          valueShare: 0.8,
          n: 400,
          source: 'constructed bettor',
        }),
      })
    )!;
    const chk = r.candidates.find((c) => c.kind === 'check')!;
    expect(chk.plan).toContain('check-fold');
    expect(chk.plan).not.toContain('check-call');
  });

  it('PLO4 receives the same capped call protection', () => {
    const r = planValue(facingSpot(0.11, { variant: 'plo4', ip: true }))!;
    expect(callOf(r).ev).toBeLessThan(0);
    expect(r.choice.kind).toBe('fold');
  });

  it('a strong equity call still calls cleanly (positive EV preserved)', () => {
    const r = planValue(facingSpot(0.55, { pot: 90, toCall: 30, ip: true }))!;
    expect(callOf(r).ev).toBeGreaterThan(0);
    expect(r.choice.kind).not.toBe('fold');
  });

  it('PLO6 remains untouched (planValue returns null)', () => {
    expect(planValue(facingSpot(0.11, { variant: 'plo6' }))).toBeNull();
  });
});
