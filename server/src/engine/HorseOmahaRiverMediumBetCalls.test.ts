/**
 * AN OMAHA RIVER FOLD OF TWO PAIR OR BETTER TO A BET OF 40 TO 70 PERCENT OF
 * THE POT BECOMES A CALL WHEN THE PRICE IS MET (option
 * omahaRiverMediumBetStrongHandCalls, default OFF).
 *
 * The nodes are the public records of eleven PLO5 1/2 cash river folds of
 * two pair or better to one player's bet of about half the pot (2026-11-15),
 * with a one-pair fold and a fold to an 85 percent bet as controls
 * (HorseOmahaRiverMediumBetCalls.test-support.ts; no identities, no person's
 * cards). Five of the eleven folded the best hand.
 *
 * The recorded folds were made with the opponent memory on, so the decision
 * tests run with it on and no row for the bettor (an unknown player): that is
 * where today's brain folds them. The variations change one thing at a time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { scoreOmahaHiPartial, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { omahaFacingBetEvSpot } from './HorseOmahaFacingBetEv.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR,
  omahaRiverHoldsShare,
  omahaRiverMediumBetCall,
  omahaRiverMediumBetSpot,
} from './HorseOmahaRiverMediumBetCalls.js';
import {
  RECORDED_RIVER_FOLDS,
  cardsOf,
  expand,
  type RecordedRiverFold,
} from './HorseOmahaRiverMediumBetCalls.test-support.js';
import type { Card } from '../types.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const ON: HorseDecideOpts = { omahaRiverMediumBetStrongHandCalls: true };
const CALL = 'omaha_river_medium_bet_strong_hand_call';

const rec = (n: number): RecordedRiverFold => RECORDED_RIVER_FOLDS.find((r) => r.n === n)!;
function at(r: RecordedRiverFold, change?: (r: RecordedRiverFold) => void) {
  const copy = JSON.parse(JSON.stringify(r)) as RecordedRiverFold;
  change?.(copy);
  const { fx, node } = expand(copy);
  return stateAt(fx, node);
}

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
}
const decisionBytes = (d: unknown): string => JSON.stringify(withoutMeasurements(d));

function play(
  r: RecordedRiverFold,
  opts: HorseDecideOpts,
  change?: (r: RecordedRiverFold) => void,
  reads?: (userId: string) => OmahaReadConditional | null
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(seed);
    const st = at(r, change);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const folds = (o: Outcome) => o.actions.filter((a) => a === 'fold').length;
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
/** A call, or the all-in a call for the whole stack is recorded as. */
const continues = (o: Outcome) => o.actions.filter((a) => a === 'call' || a === 'all_in').length;

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const BEST = [59402247, 59407493, 59446815, 59458558, 59480782];

describe('the share of the bettor’s holdings the hand holds up against', () => {
  const RANKS = '23456789TJQKA'.split('');
  const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  /** Every holding walked one by one: the definition, not the counting trick. */
  function brute(hole: Card[], board: Card[]): number {
    const seen = new Set([...hole, ...board].map((c) => c.rank + c.suit));
    const unseen: Card[] = [];
    for (const s of SUITS)
      for (const k of RANKS) if (!seen.has(k + s)) unseen.push({ rank: k, suit: s } as Card);
    const hero = scoreOmahaHiPartial(hole, board);
    const m = unseen.length;
    const beats = new Uint8Array(m * m);
    for (let i = 0; i < m; i++)
      for (let j = i + 1; j < m; j++)
        if (scoreOmahaHiPartial([unseen[i], unseen[j]], board) > hero) beats[i * m + j] = 1;
    let ok = 0;
    let all = 0;
    const pick: number[] = [];
    const walk = (start: number) => {
      if (pick.length === hole.length) {
        all++;
        for (let a = 0; a < pick.length; a++)
          for (let b = a + 1; b < pick.length; b++) if (beats[pick[a] * m + pick[b]]) return;
        ok++;
        return;
      }
      for (let i = start; i < m; i++) {
        pick.push(i);
        walk(i + 1);
        pick.pop();
      }
    };
    walk(0);
    return ok / all;
  }

  it('is exact: PLO4 and PLO5 hands agree with walking every holding', () => {
    // PLO4: a set on a three-flush board.
    const hole4 = cardsOf('9c9sJsAc');
    const board4 = cardsOf('Kh9h2sJh3c');
    expect(omahaRiverHoldsShare(hole4, board4)).toBeCloseTo(brute(hole4, board4), 12);
    // PLO5: the recorded trips on a paired board.
    const r = rec(59458558);
    const hole5 = cardsOf(r.hole);
    const board5 = cardsOf(r.boards[0]);
    expect(omahaRiverHoldsShare(hole5, board5)).toBeCloseTo(brute(hole5, board5), 12);
  });

  it('the nuts hold against everything; a hand, board or deck that is not a river hand is null', () => {
    // A royal flush with two hole cards: nothing beats it.
    expect(omahaRiverHoldsShare(cardsOf('AhKh2c3d'), cardsOf('QhJhTh4s5c'))).toBe(1);
    expect(omahaRiverHoldsShare(cardsOf('AhKh2c3d'), cardsOf('QhJhTh4s'))).toBeNull();
    expect(omahaRiverHoldsShare(cardsOf('AhKh'), cardsOf('QhJhTh4s5c'))).toBeNull();
    expect(omahaRiverHoldsShare(cardsOf('AhKh2c3d'), cardsOf('AhJhTh4s5c'))).toBeNull();
  });

  it('the recorded hands: the five best-hand folds hold up 45 to 80 percent, one pair 7 percent', () => {
    const holds = (n: number) =>
      omahaRiverHoldsShare(cardsOf(rec(n).hole), cardsOf(rec(n).boards[0]))!;
    for (const n of BEST) {
      expect(holds(n)).toBeGreaterThan(0.44);
      expect(holds(n)).toBeLessThan(0.82);
    }
    expect(holds(59477667)).toBeLessThan(0.1);
  });
});

describe('the spot', () => {
  it('each recorded fold of two pair or better (not two pair on a paired board) is in it, with its price', () => {
    const inSpot = RECORDED_RIVER_FOLDS.filter((r) => {
      const st = at(r);
      return omahaRiverMediumBetSpot(st.hero, st.gs) !== null;
    }).map((r) => r.n);
    expect(inSpot).toEqual([
      59402247, 59407493, 59437205, 59446815, 59455656, 59458558, 59467641, 59480782, 59484612,
    ]);
    for (const n of inSpot) {
      const st = at(rec(n));
      const s = omahaRiverMediumBetSpot(st.hero, st.gs)!;
      expect(s.potFrac).toBeGreaterThanOrEqual(0.4);
      expect(s.potFrac).toBeLessThanOrEqual(0.7);
      // a bet of 40 to 70 percent of the pot asks for 22 to 29 percent
      expect(s.price).toBeGreaterThan(0.2);
      expect(s.price).toBeLessThan(0.3);
      expect(s.priced).toBe(s.holds >= OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR * s.price);
    }
    // The weak two pair (13 percent of two-card holdings beat it) does not meet the price.
    const weak = at(rec(59467641));
    expect(omahaRiverMediumBetSpot(weak.hero, weak.gs)!.priced).toBe(false);
  });

  it('out of it: one pair, two pair on a paired board, a bet above 70 or under 40 percent', () => {
    for (const n of [59477667, 59399392, 59438949, 59422360]) {
      const st = at(rec(n));
      expect(omahaRiverMediumBetSpot(st.hero, st.gs)).toBeNull();
    }
    // The same set facing 75 percent of the pot, and facing 30 percent.
    const r = rec(59407493);
    const sized = (bet: number) =>
      at(r, (x) => {
        x.a = x.a.replace('6|r|bet|211|p|1|0', `6|r|bet|${bet}|p|1|0`);
        x.pot = x.pot - x.bet + bet;
        x.seats.find((s) => s[0] === 6)![2] = bet;
        x.bet = bet;
        x.min = bet * 2;
      });
    const pot = r.pot - r.bet;
    expect(
      omahaRiverMediumBetSpot(sized(Math.round(pot * 0.75)).hero, sized(Math.round(pot * 0.75)).gs)
    ).toBeNull();
    expect(
      omahaRiverMediumBetSpot(sized(Math.round(pot * 0.3)).hero, sized(Math.round(pot * 0.3)).gs)
    ).toBeNull();
    expect(
      omahaRiverMediumBetSpot(sized(Math.round(pot * 0.7)).hero, sized(Math.round(pot * 0.7)).gs)
    ).not.toBeNull();
    expect(
      omahaRiverMediumBetSpot(
        sized(Math.round(pot * 0.4) + 1).hero,
        sized(Math.round(pot * 0.4) + 1).gs
      )
    ).not.toBeNull();
  });

  it('out of it: a player still to act behind, a raise, the Horse’s own chips in, another game, a tournament, two boards', () => {
    const r = rec(59467641);
    // Seat 3 has not folded: the Horse in seat 5 is not closing the action.
    const open = at(r, (x) => {
      x.a = x.a.replace('3|r|fold|0|h|0|0;', '');
      x.ord -= 1;
      x.seats.find((s) => s[0] === 3)![6] = 0;
    });
    expect(omahaRiverMediumBetSpot(open.hero, open.gs)).toBeNull();

    const base = rec(59407493);
    const st = at(base);
    expect(omahaRiverMediumBetSpot(st.hero, st.gs)).not.toBeNull();
    const variant = (v: string, hole?: string) => {
      const s = at(base, (x) => {
        if (hole) x.hole = hole;
      });
      (s.gs as { gameVariant: string }).gameVariant = v;
      return omahaRiverMediumBetSpot(s.hero, s.gs);
    };
    expect(variant('plo6', '8h9c9sJsAc2d')).toBeNull();
    expect(variant('plo8')).toBeNull();
    expect(variant('nlh')).toBeNull();
    const tour = at(base);
    (tour.gs as { gameMode: string }).gameMode = 'tournament';
    expect(omahaRiverMediumBetSpot(tour.hero, tour.gs)).toBeNull();
    const two = at(base);
    (two.gs as { communityCards2: Card[] }).communityCards2 = cardsOf('8cQc8dTcJd');
    expect(omahaRiverMediumBetSpot(two.hero, two.gs)).toBeNull();
    // The Horse bet the river itself and was raised.
    const raised = at(base);
    raised.hero.bet = 40;
    expect(omahaRiverMediumBetSpot(raised.hero, raised.gs)).toBeNull();
    const reraise = at(base);
    reraise.gs.actionHistory!.find((a) => a.stage === 'river' && a.action === 'bet')!.action =
      'raise';
    expect(omahaRiverMediumBetSpot(reraise.hero, reraise.gs)).toBeNull();
  });

  it('the rule changes a fold only: off, a call, a raise and a guarded fold are returned as given', () => {
    const st = at(rec(59407493));
    const fold = { action: 'fold' as const, thinkTime: 0 };
    expect(omahaRiverMediumBetCall(fold, st.hero, st.gs, false).decision).toBe(fold);
    for (const d of [
      { action: 'call' as const, amount: 211, thinkTime: 0 },
      { action: 'raise' as const, amount: 600, thinkTime: 0 },
      {
        action: 'fold' as const,
        thinkTime: 0,
        continuationGuard: 'omaha_cold_flush_pressure' as const,
      },
    ]) {
      const r = omahaRiverMediumBetCall(d, st.hero, st.gs, true);
      expect(r.decision).toBe(d);
      expect(r.changed).toBeNull();
    }
    const called = omahaRiverMediumBetCall(fold, st.hero, st.gs, true);
    expect(called.changed).toBe('called');
    expect({ action: called.decision.action, amount: called.decision.amount }).toEqual({
      action: 'call',
      amount: 211,
    });
    // A call for the whole stack is the all-in.
    const short = at(rec(59480782));
    const jam = omahaRiverMediumBetCall(fold, short.hero, short.gs, true);
    expect(jam.decision.action).toBe('all_in');
    expect(jam.decision.amount).toBeUndefined();
  });
});

describe('omahaRiverMediumBetStrongHandCalls in the decision', () => {
  it('off: unset, false and a truthy non-boolean decide byte-identically at every recorded node', () => {
    for (const r of RECORDED_RIVER_FOLDS) {
      const unset = play(r, {});
      for (const opts of [
        { omahaRiverMediumBetStrongHandCalls: false },
        { omahaRiverMediumBetStrongHandCalls: 1 as unknown as boolean },
      ])
        expect(play(r, opts).bytes).toEqual(unset.bytes);
      // and with the opponent memory off
      expect(play(r, { mind: false, omahaRiverMediumBetStrongHandCalls: false }).bytes).toEqual(
        play(r, { mind: false }).bytes
      );
    }
  });

  for (const n of BEST) {
    it(`hand ${n} (${rec(n).held}), the best hand: today folds; with the option on it calls`, () => {
      const r = rec(n);
      const off = play(r, {});
      // the recorded fold is today's fold
      expect(folds(off)).toBeGreaterThan(0);
      const on = play(r, ON);
      expect(folds(on)).toBe(0);
      expect(continues(on)).toBe(SEEDS.length);
      // the receipt marks exactly the folds that became calls
      expect(fired(on, CALL)).toBe(folds(off));
      // a seed that already called is untouched
      off.actions.forEach((a, i) => {
        if (a !== 'fold') expect(on.bytes[i]).toEqual(off.bytes[i]);
      });
    });
  }

  it('the other recorded folds: priced two pair calls, the weak two pair and two pair on a paired board still fold', () => {
    for (const n of [59437205, 59455656, 59484612]) {
      const on = play(rec(n), ON);
      expect(folds(on)).toBe(0);
    }
    const weak = play(rec(59467641), ON);
    expect(weak.bytes).toEqual(play(rec(59467641), {}).bytes);
    expect(folds(weak)).toBe(SEEDS.length);
    expect(fired(weak, `${CALL}_unpriced`)).toBe(SEEDS.length);
    for (const n of [59399392, 59438949]) {
      const on = play(rec(n), ON);
      expect(on.bytes).toEqual(play(rec(n), {}).bytes);
      expect(folds(on)).toBe(SEEDS.length);
    }
  });

  it('one pair still folds, and a bet above 70 percent of the pot still folds', () => {
    for (const n of [59477667, 59422360]) {
      const off = play(rec(n), {});
      const on = play(rec(n), ON);
      expect(folds(off)).toBe(SEEDS.length);
      expect(on.bytes).toEqual(off.bytes);
      expect(fired(on, CALL)).toBe(0);
    }
    // The best-hand set, the same line, the river bet 75 percent of the pot: as today.
    const r = rec(59407493);
    const big = (x: RecordedRiverFold) => {
      const bet = Math.round((r.pot - r.bet) * 0.75);
      x.a = x.a.replace('6|r|bet|211|p|1|0', `6|r|bet|${bet}|p|1|0`);
      x.pot = x.pot - x.bet + bet;
      x.seats.find((s) => s[0] === 6)![2] = bet;
      x.bet = bet;
      x.min = bet * 2;
    };
    const off = play(r, {}, big);
    const on = play(r, ON, big);
    expect(on.bytes).toEqual(off.bytes);
    expect(fired(on, CALL)).toBe(0);
  });

  it('against a measured value leader the call is withheld; against any other read it is made', () => {
    const leader = {
      measured: true,
      tightReRaiser: false,
      valueLeader: true,
    } as OmahaReadConditional;
    const other = {
      measured: true,
      tightReRaiser: false,
      valueLeader: false,
    } as OmahaReadConditional;
    for (const n of [59407493, 59458558]) {
      const off = play(rec(n), {});
      const vs = play(rec(n), ON, undefined, () => leader);
      expect(vs.bytes).toEqual(off.bytes);
      expect(fired(vs, `${CALL}_withheld`)).toBe(folds(off));
      expect(fired(vs, CALL)).toBe(0);
      const made = play(rec(n), ON, undefined, () => other);
      expect(folds(made)).toBe(0);
      const unknown = play(rec(n), ON, undefined, () => null);
      expect(folds(unknown)).toBe(0);
    }
  });

  it('with the opponent memory off the paired-board fold of trips and of a flush is reopened too', () => {
    for (const n of [59458558, 59480782]) {
      const off = play(rec(n), { mind: false });
      expect(folds(off)).toBe(SEEDS.length);
      expect(fired(off, 'plo_paired_board_fold')).toBe(SEEDS.length);
      const on = play(rec(n), { mind: false, ...ON });
      expect(folds(on)).toBe(0);
      expect(fired(on, CALL)).toBe(SEEDS.length);
    }
    // 85 percent of the pot on a paired board: the paired-board fold stands.
    const big = play(rec(59422360), { mind: false, ...ON });
    expect(folds(big)).toBe(SEEDS.length);
  });

  it('the call is admitted by the worker receipt validator with the request that produces it, and refused against another', () => {
    let checked = 0;
    // A hand that is one pair or less on each of the three boards.
    const weaker: Record<number, string> = {
      59407493: 'As7d6c5s4d',
      59446815: 'KsQhJs9h8s',
      59458558: 'AsKdQcJsTd',
    };
    for (const n of [59407493, 59446815, 59458558]) {
      const r = rec(n);
      HorseMind.reset();
      seedFastRandom(1);
      const st = at(r);
      const d = structuredClone(
        HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
          observeMind: false,
          ...ON,
        } as never)
      );
      expect(d.action).toBe('call');
      const node = d.policyGraph?.transitions.find((t) => t.node === 'wager_rules');
      if (node?.before?.action !== 'fold') continue;
      checked++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
      // Against a request in which the Horse holds one pair or less it is refused.
      const pair = at(r, (x) => {
        x.hole = weaker[n];
      });
      expect(omahaRiverMediumBetSpot(pair.hero, pair.gs)).toBeNull();
      // In the integrated 2026-11-15 head the facing-bet EV admission
      // (omahaFacingBetEv) admits a fold -> call of the exact chips in its
      // spot whatever the hand (its verdict reads the opponent memory, which
      // the request does not carry); the refusal is asserted only outside it.
      if (omahaFacingBetEvSpot(pair.hero, pair.gs) === null)
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
            player: pair.hero,
            gameState: pair.gs,
          })
        ).toBe('policy_graph');
    }
    expect(checked).toBeGreaterThan(0);
  });
});
