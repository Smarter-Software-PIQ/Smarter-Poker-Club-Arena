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
 *
 * Scope (2026-11-16, the Fixed-Limit lane owner's ruling; HorseLogic
 * fixedLimitCallIsNotACommitmentInScope): the option acts only on fixed-limit
 * HOLD'EM at a CASH table. Hi-lo showed no value (flo8 six seats against the
 * maniac -7.09 +/- 4.28 and +1.07 +/- 3.46 big bets per 100, agent evidence
 * fixed-limit-01Gw7aDr AB-EVALUATION-2.md 3.7 and 3.15) and no fixed-limit
 * tournament case was evaluated, so with the option on a flo8 decision (cash
 * or tournament) and a flh tournament decision equal the option off and no
 * F2 receipt fires; at flh cash it still changes the decisions it changed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { decideSpot, fixedLimitRiverFacingOneBet } from './FixedLimitRiverCallSpot.test-support.js';
import {
  FIXED_LIMIT_RAISE_BEHIND_RATES,
  fixedLimitCallRequiredEquity,
  fixedLimitRaiseBehindRate,
  fixedLimitRemainingAction,
} from './HorseFixedLimitCallPrice.js';
import { menuOf, type Fmt } from './HuVariantSpot.test-support.js';

const ON = { fixedLimitCallIsNotACommitment: true } as const;
const continues = (a: string) => a !== 'fold';
const F2_RECEIPTS = [
  'fixed_limit_call_priced_remaining_action_seen',
  'fixed_limit_call_not_a_commitment_seen',
] as const;

/** Option on vs off on the same spot and seed: action and amount, and the F2 receipts of the on arm. */
function onVsOff(o: {
  variant: 'flh' | 'flo8';
  seats: number;
  stack: number;
  fmt: Fmt;
  seed: number;
}) {
  const spot = () => fixedLimitRiverFacingOneBet(o);
  const a = spot();
  const b = spot();
  if (!a || !b) return null;
  const on = withDecisionFireScope(() => decideSpot(a, 500 + o.seed, { ...ON, telemetry: true }));
  const off = withDecisionFireScope(() => decideSpot(b, 500 + o.seed, { telemetry: true }));
  return {
    seed: o.seed,
    on: `${on.value.d.action}:${on.value.d.amount ?? ''}`,
    off: `${off.value.d.action}:${off.value.d.amount ?? ''}`,
    receipts: F2_RECEIPTS.filter((f) => on.fired.has(f) || off.fired.has(f)),
  };
}

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
    const base = {
      pot: 44,
      toCall: 4,
      unit: 4,
      stackAfterCall: 30,
      deduction: 0.05,
      raiseBehindRate: fixedLimitRaiseBehindRate({ hiLo: false, stage: 'river' }),
    };
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
    const p = 1 - Math.pow(1 - base.raiseBehindRate, 3);
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

  it('prices the raise behind at the MEASURED rate (census D, 95% upper bounds), not the old 0.12 assumption', () => {
    // Source: agent evidence fixed-limit-01Gw7aDr/AF-raise-behind-census-D.json (Horse-only flh/flo8
    // cash, 64,660 hands, 2026-11-13T08:13Z to 2026-11-14T21:27Z): each street's Clopper-Pearson
    // two-sided 95% upper bound of the raised share after a call, rounded up.
    expect(FIXED_LIMIT_RAISE_BEHIND_RATES).toEqual({
      holdem: { flop: 0.014, turn: 0.033, river: 0.042, other: 0.021 },
      hiLo: { flop: 0.008, turn: 0.019, river: 0.027, other: 0.014 },
    });
    for (const hiLo of [false, true]) {
      const row = hiLo
        ? FIXED_LIMIT_RAISE_BEHIND_RATES.hiLo
        : FIXED_LIMIT_RAISE_BEHIND_RATES.holdem;
      expect(fixedLimitRaiseBehindRate({ hiLo, stage: 'flop' })).toBe(row.flop);
      expect(fixedLimitRaiseBehindRate({ hiLo, stage: 'turn' })).toBe(row.turn);
      expect(fixedLimitRaiseBehindRate({ hiLo, stage: 'river' })).toBe(row.river);
      expect(fixedLimitRaiseBehindRate({ hiLo, stage: 'preflop' })).toBe(row.other);
      // Every measured bound is far under the old assumption.
      for (const v of Object.values(row)) expect(v).toBeLessThan(0.05);
    }
    // The shade is small now: three players behind, three wagers left, a 44-chip pot, a 4-chip call.
    const priced = (rate: number) =>
      fixedLimitCallRequiredEquity({
        pot: 44,
        toCall: 4,
        unit: 4,
        stackAfterCall: 30,
        deduction: 0.05,
        playersBehind: 3,
        wagersLeft: 3,
        raiseBehindRate: rate,
      });
    const measured = priced(fixedLimitRaiseBehindRate({ hiLo: false, stage: 'river' }));
    const assumed = priced(0.12);
    expect(measured.required - measured.bare).toBeLessThan((assumed.required - assumed.bare) / 2.5);
    expect(measured.required).toBeGreaterThan(measured.bare);
    // A rate of 0 is the bare price (no shade), whatever the players behind.
    expect(priced(0).required).toBeCloseTo(priced(0).bare, 12);
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
      const t = fixedLimitRiverFacingOneBet({ variant: 'flh', seats: 4, stack: 1000, seed: 3 })!;
      if (hero === 1) {
        expect(t.controller.performAction(3, 'call', undefined, 'player')).toBe(true);
        expect(t.controller.performAction(4, 'call', undefined, 'player')).toBe(true);
      }
      return withDecisionFireScope(() => decideSpot(t, 501, { ...ON, telemetry: true })).fired;
    };
    expect(priced(undefined).has('fixed_limit_call_priced_remaining_action_seen')).toBe(true);
    expect(priced(1).has('fixed_limit_call_priced_remaining_action_seen')).toBe(false);
  }, 120_000);

  for (const [variant, seats] of [['flh', 4]] as const) {
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
      const t = fixedLimitRiverFacingOneBet({ variant: 'flh', seats: 6, stack: 40, seed });
      if (!t) continue;
      const on = withDecisionFireScope(() => decideSpot(t, 500 + seed, { ...ON, telemetry: true }));
      if (on.fired.has('fixed_limit_call_not_a_commitment_seen')) fired++;
      const t2 = fixedLimitRiverFacingOneBet({ variant: 'flh', seats: 6, stack: 40, seed })!;
      const off = withDecisionFireScope(() => decideSpot(t2, 500 + seed, { telemetry: true }));
      expect(off.fired.has('fixed_limit_call_not_a_commitment_seen')).toBe(false);
    }
    expect(fired).toBeGreaterThan(0);
  }, 120_000);

  // SCOPE (2026-11-16): fixed-limit hold'em cash only.
  for (const [variant, fmt] of [
    ['flo8', 'cash'],
    ['flo8', 'tournament'],
    ['flh', 'tournament'],
  ] as const) {
    it(`scope: ${variant} ${fmt}, with the option on every decision equals the option off and no F2 receipt fires`, () => {
      enableBrainTelemetry();
      let decided = 0;
      const changed: string[] = [];
      const receipts: string[] = [];
      for (const seats of [4, 6])
        for (const stack of [40, 1000])
          for (let seed = 1; seed <= 20; seed++) {
            const r = onVsOff({ variant, seats, stack, fmt, seed });
            if (!r) continue;
            decided++;
            const at = `${seats} seats, stack ${stack}, seed ${seed}`;
            if (r.on !== r.off) changed.push(`${at}: ${r.off} > ${r.on}`);
            if (r.receipts.length > 0) receipts.push(`${at}: ${r.receipts.join(', ')}`);
          }
      expect(decided).toBeGreaterThanOrEqual(60);
      expect(changed).toEqual([]);
      expect(receipts).toEqual([]);
    }, 240_000);
  }

  it('scope: at flh cash the option still changes decisions, with its receipts', () => {
    enableBrainTelemetry();
    const changed: string[] = [];
    let fired = 0;
    for (const seats of [4, 6])
      for (let seed = 1; seed <= 20; seed++) {
        const r = onVsOff({ variant: 'flh', seats, stack: 40, fmt: 'cash', seed });
        if (!r) continue;
        if (r.receipts.length > 0) fired++;
        if (r.on !== r.off) changed.push(`${seats} seats seed ${seed}: ${r.off} > ${r.on}`);
      }
    expect(fired).toBeGreaterThan(0);
    // Measured 2026-11-16 at the scope head: 4 seats seeds 4, 6 and 18, 6 seats seeds 8, 16 and 19.
    expect(changed.length, changed.join('; ')).toBeGreaterThan(0);
    // Every change is a short-stack continue the commitment surcharge had refused (fold or a stack-off shove becomes the one-bet call).
    for (const c of changed) expect(c).toMatch(/: (fold|all_in):\d* > call:\d+$/);
  }, 240_000);
});
