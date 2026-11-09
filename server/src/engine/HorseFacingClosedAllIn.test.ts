/**
 * The closed all-in exception (facingClosedAllIn, 2026-11-08) applies only
 * when a call closes the betting. Any opponent who can still put chips in
 * keeps the 3-bet and 4-bet stack caps exactly as they were.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { facingClosedAllInRaise } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { complaintPathHits, type ComplaintFixture } from './HorseComplaintReplay.js';
import QQ from './horseComplaints/qq-opener-folds-to-an-all-in-3-bet.fixture.json';

const seat = (s: number, folded = false, allIn = false) => ({
  seat: s,
  is_folded: folded,
  is_all_in: allIn,
});

describe('facingClosedAllInRaise: public seat flags only', () => {
  it('heads-up opener facing an all-in 3-bet: the call closes the betting', () => {
    expect(facingClosedAllInRaise([seat(1), seat(2, false, true)], 1, 2, 2, 50)).toBe(true);
  });

  it('multiway with every other opponent folded or all in: closed', () => {
    const folded = [seat(1), seat(2, false, true), seat(3, true)];
    expect(facingClosedAllInRaise(folded, 1, 2, 2, 50)).toBe(true);
    const shorterAllIn = [seat(1), seat(2, false, true), seat(3, false, true)];
    expect(facingClosedAllInRaise(shorterAllIn, 1, 2, 2, 50)).toBe(true);
  });

  it('multiway where another player can still bet: never closed', () => {
    // A cold caller of the jam with chips behind.
    expect(facingClosedAllInRaise([seat(1), seat(2, false, true), seat(3)], 1, 2, 2, 50)).toBe(
      undefined
    );
    // A blind still to act behind the hero.
    expect(
      facingClosedAllInRaise([seat(1), seat(2, false, true), seat(3, true), seat(4)], 1, 2, 2, 50)
    ).toBe(undefined);
  });

  it('a raise that is not all in, a first raise, or nothing to call: never closed', () => {
    expect(facingClosedAllInRaise([seat(1), seat(2)], 1, 2, 2, 50)).toBe(undefined);
    expect(facingClosedAllInRaise([seat(1), seat(2, false, true)], 1, 2, 1, 50)).toBe(undefined);
    expect(facingClosedAllInRaise([seat(1), seat(2, false, true)], 1, 2, 2, 0)).toBe(undefined);
    expect(facingClosedAllInRaise([seat(1), seat(2, false, true)], 1, -1, 2, 50)).toBe(undefined);
  });
});

describe('the real QQ hand, re-played with a live cold caller behind', () => {
  afterEach(() => HorseMind.reset());

  /**
   * Hand 7ee5da8f as recorded, except the small blind (seat 6, 4,119 total)
   * calls the 3,315 jam instead of folding and keeps 804 behind. The opener's
   * call no longer closes the betting, so the exception must not apply.
   */
  function withLiveColdCaller(): ComplaintFixture {
    const fx = JSON.parse(JSON.stringify(QQ)) as ComplaintFixture & {
      actions: Array<{ ord: number; action: string; amount: number; publicNode?: any }>;
    };
    const sbCall = fx.actions.find((a) => a.ord === 9)!;
    expect([sbCall.action, sbCall.publicNode?.toCall]).toEqual(['fold', 3240]);
    sbCall.action = 'call';
    sbCall.amount = 3240;
    for (const a of fx.actions.filter((x) => x.ord === 10 || x.ord === 11)) {
      const n = a.publicNode as { pot: number; seats: number[][] };
      n.pot = Math.round((n.pot + 3240) * 100) / 100;
      const s6 = n.seats.find((s) => s[0] === 6)!;
      s6[1] = 804;
      s6[2] = 3315;
      s6[3] = 3315;
      s6[6] = 0;
    }
    return fx;
  }

  it('closed (as recorded): the exception lets the strength bar call', () => {
    expect(complaintPathHits(QQ as unknown as ComplaintFixture)).toEqual([]);
  });

  it('open (a live caller with chips behind): the cap applies, identical to the flag off', () => {
    const fx = withLiveColdCaller();
    const on = complaintPathHits(fx);
    const off = complaintPathHits(fx, { facingClosedAllIn: false });
    expect(on.length).toBeGreaterThan(0);
    expect(on).toEqual(off);
  });
});
