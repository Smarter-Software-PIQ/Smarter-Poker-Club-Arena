/**
 * LAW: A FIXED-LIMIT CALL IS NOT A COMMITMENT (2026-11-14, Fixed-Limit lane;
 * HorseDecideOpts.fixedLimitCallIsNotACommitment, default OFF).
 *
 * The commitment test (HorseLogic committedLegacy and the V66/V86/V87
 * recomputation) reads a stack-to-pot ratio under 1.2, or 30 percent of the
 * stack already in, as "the money is in" and prices the call in the committed
 * branch: pot odds plus 0.02 plus the V20 multiway bar commit20 (up to 0.12)
 * plus the raised-class shades. A fixed-limit call risks one fixed bet
 * whatever the stack, and a multiway fixed-limit pot outgrows a short stack
 * by the river, so a one-bet river call at a price of 0.05 to 0.08 was asked
 * for 0.15 to 0.19 (measured flo8 six seats: 256 of 257 river folds took this
 * branch, mean commit20 0.092, required 0.173 against a price of 0.050).
 *
 * Law, with the option on: a fixed-limit call has no stack-commitment or
 * stack-to-pot term. It is priced on its incremental cost and the remaining
 * action of the street (HorseFixedLimitCallPrice.ts): a closing call (nobody
 * left to act behind, or the street capped) at the bare call plus rake; a
 * call with a player left to act and the cap not reached above the bare
 * call, by the expected further wagers. Facing one fixed river bet, a Horse
 * continues or folds exactly as it does with a deep stack. With the option
 * off (main) the short stack folds hands the deep stack calls.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { decideSpot, fixedLimitRiverFacingOneBet } from './FixedLimitRiverCallSpot.test-support.js';
import {
  FIXED_LIMIT_RAISE_BEHIND_RATE,
  fixedLimitCallRequiredEquity,
  fixedLimitRemainingAction,
} from './HorseFixedLimitCallPrice.js';
import { menuOf } from './HuVariantSpot.test-support.js';

const ON = { fixedLimitCallIsNotACommitment: true } as const;
const continues = (a: string) => a !== 'fold';

afterEach(() => HorseMind.reset());

/** For each seed: [short-stack action, deep-stack action, price]. */
function sweep(variant: 'flh' | 'flo8', seats: number, opts: object, seeds = 40) {
  const out: Array<{ seed: number; short: string; deep: string; price: number }> = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const short = fixedLimitRiverFacingOneBet({ variant, seats, stack: 40, seed });
    const deep = fixedLimitRiverFacingOneBet({ variant, seats, stack: 1000, seed });
    if (!short || !deep) continue;
    const s = decideSpot(short, 500 + seed, opts);
    const d = decideSpot(deep, 500 + seed, opts);
    // The short stack still covers the bet: this is a one-bet call, not a stack-off.
    expect(s.menu.toCall).toBeLessThan(s.hero.stack);
    out.push({
      seed,
      short: s.d.action,
      deep: d.d.action,
      price: s.menu.toCall / (s.gs.pot + s.menu.toCall),
    });
  }
  return out;
}

describe('a fixed-limit call is not a commitment', () => {
  it('prices a closing call at the bare call plus rake, and a call with action behind above it', () => {
    const base = { pot: 44, toCall: 4, unit: 4, stackAfterCall: 30, deduction: 0.05 };
    const bare = 4 / (48 * 0.95);
    // Closing: nobody behind, or the street capped, or nothing left behind the call.
    for (const closing of [
      { playersBehind: 0, wagersLeft: 3 },
      { playersBehind: 3, wagersLeft: 0 },
      { playersBehind: 2, wagersLeft: 2, stackAfterCall: 0 },
    ]) {
      const p = fixedLimitCallRequiredEquity({ ...base, ...closing });
      expect(p.closing).toBe(true);
      expect(p.required).toBeCloseTo(bare, 12);
      expect(p.bare).toBeCloseTo(bare, 12);
    }
    // Rake-free closing call: exactly pot odds.
    expect(
      fixedLimitCallRequiredEquity({ ...base, deduction: 0, playersBehind: 0, wagersLeft: 3 })
        .required
    ).toBeCloseTo(4 / 48, 12);
    // With action behind: above the bare call, more with more players and more wagers left.
    const one = fixedLimitCallRequiredEquity({ ...base, playersBehind: 1, wagersLeft: 3 });
    const three = fixedLimitCallRequiredEquity({ ...base, playersBehind: 3, wagersLeft: 3 });
    const threeOneLeft = fixedLimitCallRequiredEquity({ ...base, playersBehind: 3, wagersLeft: 1 });
    expect(one.closing).toBe(false);
    expect(one.required).toBeGreaterThan(bare);
    expect(three.required).toBeGreaterThan(one.required);
    expect(three.required).toBeGreaterThan(threeOneLeft.required);
    expect(threeOneLeft.required).toBeGreaterThan(bare);
    // The formula, stated: e = unit x (p + p^2 + p^3), p = 1 - (1 - rate)^players.
    const p = 1 - Math.pow(1 - FIXED_LIMIT_RAISE_BEHIND_RATE, 3);
    const e = 4 * (p + p * p + p * p * p);
    expect(three.expectedExtra).toBeCloseTo(e, 12);
    expect(three.required).toBeCloseTo((4 + e) / ((48 + 2 * e) * 0.95), 12);
    // No stack-to-pot term: a deeper stack prices the same call the same.
    expect(
      fixedLimitCallRequiredEquity({
        ...base,
        stackAfterCall: 5000,
        playersBehind: 3,
        wagersLeft: 3,
      }).required
    ).toBeCloseTo(three.required, 12);
  });

  it('reads the players left to act and the wagers left from the real table', () => {
    // flo8 four seats: seat 2 bets the river; seat 3 is first to face it with
    // seats 4 and 1 still to act, and seat 1 is the closing caller.
    const t = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 4, stack: 1000, seed: 3 })!;
    const remaining = () => {
      const st = t.controller.getState();
      const actor = t.controller.getCurrentPlayer()!;
      return {
        seat: actor.seat,
        ...fixedLimitRemainingAction({
          players: st.players,
          heroSeat: actor.seat,
          currentBet: st.currentBet,
          stage: st.stage,
          actionHistory: st.actionHistory,
          wagersCapped: menuOf(t).wagersCapped,
        }),
      };
    };
    expect(remaining()).toEqual({ seat: 3, playersBehind: 2, wagersLeft: 3 });
    expect(t.controller.performAction(3, 'call', undefined, 'player')).toBe(true);
    expect(remaining()).toEqual({ seat: 4, playersBehind: 1, wagersLeft: 3 });
    expect(t.controller.performAction(4, 'call', undefined, 'player')).toBe(true);
    expect(remaining()).toEqual({ seat: 1, playersBehind: 0, wagersLeft: 3 });
    // Capped: seat 1 raises, seat 2 re-raises, seat 3 caps; seat 4 then faces
    // a capped street (no wager left) with seats 1 and 2 still owing chips.
    for (const seat of [1, 2, 3])
      expect(
        t.controller.performAction(seat, 'raise', menuOf(t).minRaiseTo ?? undefined, 'player')
      ).toBe(true);
    expect(remaining()).toEqual({ seat: 4, playersBehind: 2, wagersLeft: 0 });
  });

  it('a call with a player left to act is priced above the bare call; the closing call is not', () => {
    enableBrainTelemetry();
    const priced = (hero: number | undefined) => {
      const t = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 4, stack: 1000, seed: 3 })!;
      if (hero === 1) {
        expect(t.controller.performAction(3, 'call', undefined, 'player')).toBe(true);
        expect(t.controller.performAction(4, 'call', undefined, 'player')).toBe(true);
      }
      return withDecisionFireScope(() => decideSpot(t, 501, { ...ON, telemetry: true })).fired;
    };
    expect(priced(undefined).has('fixed_limit_call_priced_remaining_action_seen')).toBe(true);
    expect(priced(1).has('fixed_limit_call_priced_remaining_action_seen')).toBe(false);
  }, 120_000);

  for (const [variant, seats] of [
    ['flo8', 6],
    ['flo8', 4],
    ['flh', 4],
  ] as const) {
    it(`${variant} ${seats} seats: a one-bet river call is judged at its price whatever the stack`, () => {
      const rows = sweep(variant, seats, ON);
      expect(rows.length).toBeGreaterThanOrEqual(30);
      for (const r of rows) {
        expect(r.price).toBeLessThan(0.12);
        expect(continues(r.short), `seed ${r.seed}: short ${r.short}, deep ${r.deep}`).toBe(
          continues(r.deep)
        );
      }
    }, 120_000);

    it(`${variant} ${seats} seats, option off (main): the short stack folds calls the deep stack makes`, () => {
      const rows = sweep(variant, seats, {});
      const shortFoldsDeepCalls = rows.filter((r) => !continues(r.short) && continues(r.deep));
      expect(shortFoldsDeepCalls.length).toBeGreaterThan(0);
      // And never the other way round: the surcharge only ever adds to the bar.
      expect(rows.filter((r) => continues(r.short) && !continues(r.deep))).toEqual([]);
    }, 120_000);
  }

  it('says when it priced a call the commitment test would have surcharged', () => {
    enableBrainTelemetry();
    let fired = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const t = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 6, stack: 40, seed });
      if (!t) continue;
      const on = withDecisionFireScope(() => decideSpot(t, 500 + seed, { ...ON, telemetry: true }));
      if (on.fired.has('fixed_limit_call_not_a_commitment_seen')) fired++;
      const t2 = fixedLimitRiverFacingOneBet({ variant: 'flo8', seats: 6, stack: 40, seed })!;
      const off = withDecisionFireScope(() => decideSpot(t2, 500 + seed, { telemetry: true }));
      expect(off.fired.has('fixed_limit_call_not_a_commitment_seen')).toBe(false);
    }
    expect(fired).toBeGreaterThan(0);
  }, 120_000);
});
