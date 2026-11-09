/**
 * The closed all-in exception (facingClosedAllIn, 2026-11-08) applies only
 * when a call closes the betting. Any opponent who can still put chips in
 * keeps the 3-bet and 4-bet stack caps exactly as they were.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { facingClosedAllInRaise } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  complaintPathHits,
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { CLOSED_ALL_IN_MAX_EFFECTIVE_BB } from './HorsePreflop.js';
import QQ from './horseComplaints/qq-opener-folds-to-an-all-in-3-bet.fixture.json';
import TT from './horseComplaints/tt-heads-up-opener-folds-to-an-all-in-3-bet.fixture.json';

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

describe('the closed all-in exception stops at CLOSED_ALL_IN_MAX_EFFECTIVE_BB', () => {
  afterEach(() => HorseMind.reset());

  /** The real heads-up TT hand (a 13bb jam over a 2.2bb open), rescaled so
   * the jam and the opener's stack are both `depthBB` deep. */
  function ttAt(depthBB: number, mode: 'cash' | 'tournament') {
    const fx = JSON.parse(JSON.stringify(TT)) as ComplaintFixture & {
      fmt: string;
      actions: Array<{ ord: number; amount: number; publicNode?: any }>;
    };
    const bb = 50,
      D = depthBB * bb;
    fx.fmt = mode === 'cash' ? 'cash' : 'tour';
    const jam = fx.actions.find((a) => a.ord === 4)!;
    jam.amount = D;
    for (const a of fx.actions) {
      if (!a.publicNode) continue;
      a.publicNode.mode = mode;
      if (mode === 'cash') delete a.publicNode.tournamentStage;
    }
    const node = fx.actions.find((a) => a.ord === 5)!;
    const n = node.publicNode as unknown as Record<string, unknown>;
    n.seats = [
      [1, 0, D, D, 0, 0, 2],
      [2, D - 109, 109, 109, 0, 0, 0],
    ];
    n.pot = D + 109;
    n.currentBet = D;
    n.toCall = D - 109;
    n.minRaiseTo = D;
    n.maxRaiseTo = D;
    n.legalActions = ['fold', 'call', 'all_in'];
    return { fx, node };
  }
  const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31];

  it('the bound is 40bb effective', () => {
    expect(CLOSED_ALL_IN_MAX_EFFECTIVE_BB).toBe(40);
  });

  // Before the depth bound, the independent review measured the live cash
  // hybrid calling this TT 20/20 at 100bb with the exception and 0/20 without.
  it('at 100bb the caps veto the call exactly as with the exception off', () => {
    for (const mode of ['cash', 'tournament'] as const) {
      const { fx, node } = ttAt(100, mode);
      const st = stateAt(fx, node as never);
      for (const p of replayProfiles(mode)) {
        const on = replayAt(st, p, SEEDS, {}).kinds;
        const off = replayAt(st, p, SEEDS, { facingClosedAllIn: false }).kinds;
        expect(on, `${mode} ${p.name}`).toEqual(off);
      }
    }
  });

  it('at 30bb (inside the bound) the exception changes the decision', () => {
    const { fx, node } = ttAt(30, 'tournament');
    const st = stateAt(fx, node as never);
    const differs = replayProfiles('tournament').some((p) => {
      const on = replayAt(st, p, SEEDS, {}).kinds;
      const off = replayAt(st, p, SEEDS, { facingClosedAllIn: false }).kinds;
      return JSON.stringify(on) !== JSON.stringify(off);
    });
    expect(differs).toBe(true);
  });
});
