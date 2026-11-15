/**
 * OMAHA FACING A BET: ONE EXPECTED-VALUE DECISION (option omahaFacingBetEv,
 * default OFF; owner 2026-11-15 11:39).
 *
 * The nodes are public records of PLO4 / PLO5 cash decisions facing a turn or
 * river bet (HorseOmahaFacingBetEv.test-support.ts; no identities, no person's
 * cards): eleven river folds of two pair or better to one player's half-pot
 * bets and two controls, hands 59521326 and 59517323, three multiway river
 * calls without the nuts and three turn folds to half the pot or less.
 *
 * The decision tests run with the opponent memory on. "Unknown" is no read of
 * the bettor (the population prior); the two measured reads are a bettor whose
 * bets of this size were shown down behind 7 times in 16 (the recorded
 * bettor's 40 to 70 percent river bets) and one ahead 19 times in 24 (his 70
 * percent and larger river bets).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { scoreOmahaHiPartial, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  OMAHA_EV_PRIOR_BLUFF,
  OMAHA_FACING_BET_EV_MARGIN,
  PairSet,
  countHoldingsWithout,
  omahaBetSizeBucket,
  omahaEvBluffShare,
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
  type OmahaFacingBetEvRead,
} from './HorseOmahaFacingBetEv.js';
import {
  RECORDED_FACING_BETS,
  cardsOf,
  expand,
  type RecordedFacingBet,
} from './HorseOmahaFacingBetEv.test-support.js';
import type { Card } from '../types.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6];
const ON: HorseDecideOpts = { omahaFacingBetEv: true };
const BLUFF_HEAVY: OmahaFacingBetEvRead = {
  measured: true,
  betCheckedToRatio: 1.2,
  postflopManiac: false,
  sizeShown: { shown: 16, best: 9 },
};
const VALUE_HEAVY: OmahaFacingBetEvRead = {
  measured: true,
  betCheckedToRatio: 0.8,
  postflopManiac: false,
  sizeShown: { shown: 24, best: 19 },
};

const rec = (n: number, seat?: number): RecordedFacingBet =>
  RECORDED_FACING_BETS.find((r) => r.n === n && (seat === undefined || r.seat === seat))!;
function at(r: RecordedFacingBet, change?: (r: RecordedFacingBet) => void) {
  const copy = JSON.parse(JSON.stringify(r)) as RecordedFacingBet;
  change?.(copy);
  const { fx, node } = expand(copy);
  return stateAt(fx, node);
}
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
}
function play(
  r: RecordedFacingBet,
  opts: HorseDecideOpts,
  read: OmahaFacingBetEvRead | null | undefined = undefined,
  change?: (r: RecordedFacingBet) => void,
  prepare?: () => void
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    prepare?.();
    if (read !== undefined)
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => read);
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
const all = (o: Outcome, ...actions: string[]) => o.actions.every((a) => actions.includes(a));
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
function verdictOf(r: RecordedFacingBet, read: OmahaFacingBetEvRead | null) {
  const st = at(r);
  const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
  return {
    spot,
    v: omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], read, {
      rake: 0,
      realization: 0.85,
    })!,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the exact count of opponent holdings', () => {
  const RANKS = '23456789TJQKA'.split('');
  const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  const unseenOf = (hole: Card[], board: Card[]): Card[] => {
    const seen = new Set([...hole, ...board].map((c) => c.rank + c.suit));
    const out: Card[] = [];
    for (const s of SUITS)
      for (const k of RANKS) if (!seen.has(k + s)) out.push({ rank: k, suit: s } as Card);
    return out;
  };

  it('agrees with listing every PLO4 holding one by one: all holdings, the value region, the weakest half', () => {
    const hole = cardsOf('2hAd8cAh');
    const board = cardsOf('6d9sTh6h3c');
    const un = unseenOf(hole, board);
    const hero = scoreOmahaHiPartial(hole, board);
    const scores: number[] = [];
    const m = un.length;
    for (let a = 0; a < m; a++)
      for (let b = a + 1; b < m; b++)
        for (let c = b + 1; c < m; c++)
          for (let d = c + 1; d < m; d++)
            scores.push(scoreOmahaHiPartial([un[a], un[b], un[c], un[d]], board));
    const counted = omahaEvHandCounts(hole, board, [], 0.3)!;
    expect(counted.holdings).toBe(scores.length);
    expect(counted.all.win).toBeCloseTo(scores.filter((s) => s < hero).length / scores.length, 12);
    expect(counted.all.tie).toBeCloseTo(
      scores.filter((s) => s === hero).length / scores.length,
      12
    );
    // The strongest share: the module's region is "best pair above a threshold";
    // its exact size picks the same holdings from the sorted list.
    const desc = [...scores].sort((x, y) => y - x);
    const top = (share: number) => {
      const got = counted.top(share);
      const k = Math.round(got.share * desc.length);
      const region = desc.slice(0, k);
      // a threshold never splits equal scores
      expect(k === desc.length || desc[k] < desc[k - 1]).toBe(true);
      return {
        got,
        win: region.filter((x) => x < hero).length / k,
        tie: region.filter((x) => x === hero).length / k,
        size: got.share,
      };
    };
    for (const share of [0.25, 0.35, 0.5]) {
      const t = top(share);
      expect(Math.abs(t.size - share)).toBeLessThan(0.08);
      expect(t.got.win).toBeCloseTo(t.win, 9);
      expect(t.got.tie).toBeCloseTo(t.tie, 9);
    }
  });

  it('counts holdings without a barred pair exactly, with and without a removed card', () => {
    const m = 12;
    const bar = new PairSet(m);
    bar.add(0, 1);
    bar.add(2, 7);
    bar.add(3, 11);
    const brute = (n: number, skip: number): number => {
      let total = 0;
      const pick: number[] = [];
      const walk = (start: number) => {
        if (pick.length === n) {
          const has = (a: number, b: number) => pick.includes(a) && pick.includes(b);
          if (!has(0, 1) && !has(2, 7) && !has(3, 11)) total++;
          return;
        }
        for (let i = start; i < m; i++) {
          if (i === skip) continue;
          pick.push(i);
          walk(i + 1);
          pick.pop();
        }
      };
      walk(0);
      return total;
    };
    for (const n of [4, 5])
      for (const skip of [-1, 0, 7])
        expect(countHoldingsWithout(m, n, bar, skip)).toBe(brute(n, skip));
  });

  it('the turn count agrees with dealing every river card and listing every PLO4 holding', () => {
    const hole = cardsOf('2hAd8cAh');
    const board = cardsOf('6d9sTh6h');
    const un = unseenOf(hole, board);
    const m = un.length;
    let win = 0;
    let tie = 0;
    let n = 0;
    // every 3rd river card keeps the listing affordable; the module is asked for the same cards
    const counted = omahaEvHandCounts(hole, board, [], 0.4)!;
    for (let k = 0; k < m; k++) {
      const five = [...board, un[k]];
      const hero = scoreOmahaHiPartial(hole, five);
      const rest = un.filter((_, i) => i !== k);
      const r = rest.length;
      if (k % 9 !== 0) continue;
      let w = 0;
      let t = 0;
      let c = 0;
      for (let a = 0; a < r; a++)
        for (let b = a + 1; b < r; b++)
          for (let x = b + 1; x < r; x++)
            for (let d = x + 1; d < r; d++) {
              const s = scoreOmahaHiPartial([rest[a], rest[b], rest[x], rest[d]], five);
              c++;
              if (s < hero) w++;
              else if (s === hero) t++;
            }
      // the same river card alone, through the module's river path
      const one = omahaEvHandCounts(hole, five, [], 0.4)!;
      expect(one.all.win).toBeCloseTo(w / c, 12);
      expect(one.all.tie).toBeCloseTo(t / c, 12);
      win += w;
      tie += t;
      n += c;
    }
    expect(n).toBeGreaterThan(0);
    // and the turn path is the average of the river path over every river card
    let sumWin = 0;
    let sumTie = 0;
    for (let k = 0; k < m; k++) {
      const one = omahaEvHandCounts(hole, [...board, un[k]], [], 0.4)!;
      sumWin += one.all.win;
      sumTie += one.all.tie;
    }
    expect(counted.all.win).toBeCloseTo(sumWin / m, 10);
    expect(counted.all.tie).toBeCloseTo(sumTie / m, 10);
    expect(counted.value.win).toBeLessThan(counted.all.win);
    expect(counted.other.win).toBeGreaterThan(counted.all.win);
  }, 120000);

  it('draws no random number and is the same on every call', () => {
    const spy = vi.spyOn(Math, 'random');
    seedFastRandom(7);
    const a = omahaEvHandCounts(cardsOf('6sKhAs3hQs'), cardsOf('2d4h5s4dAh'), [], 0.3)!;
    const b = omahaEvHandCounts(cardsOf('6sKhAs3hQs'), cardsOf('2d4h5s4dAh'), [], 0.3)!;
    expect([a.all, a.value, a.other, a.valueShare]).toEqual([
      b.all,
      b.value,
      b.other,
      b.valueShare,
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(a.unseen).toBe(42);
    expect(a.holdings).toBe(850668);
  });
});

describe('the range and the price', () => {
  it('size buckets are shares of the pot, and the prior bluff share is the measured population figure', () => {
    expect(omahaBetSizeBucket(0.39)).toBe('under40');
    expect(omahaBetSizeBucket(0.4)).toBe('mid');
    expect(omahaBetSizeBucket(0.69)).toBe('mid');
    expect(omahaBetSizeBucket(0.7)).toBe('big');
    expect(omahaBetSizeBucket(1.2)).toBe('over');
    expect(OMAHA_EV_PRIOR_BLUFF.river.mid).toBe(0.15);
    expect(OMAHA_FACING_BET_EV_MARGIN).toBe(0.02);
  });

  it('the measured read moves the bluff share; an unmeasured or absent read leaves the prior', () => {
    expect(omahaEvBluffShare(0.15, null)).toBe(0.15);
    expect(
      omahaEvBluffShare(0.15, {
        measured: false,
        betCheckedToRatio: 3,
        postflopManiac: true,
        sizeShown: null,
      })
    ).toBe(0.15);
    // bets when checked to 1.4 times as often as the average Horse
    expect(
      omahaEvBluffShare(0.15, {
        measured: true,
        betCheckedToRatio: 1.4,
        postflopManiac: false,
        sizeShown: null,
      })
    ).toBeCloseTo(0.21, 10);
    // shown down behind 7 times in 16 at this size: (0.15 x 8 + 7) / 24
    expect(
      omahaEvBluffShare(0.15, {
        measured: false,
        betCheckedToRatio: null,
        postflopManiac: false,
        sizeShown: { shown: 16, best: 9 },
      })
    ).toBeCloseTo(8.2 / 24, 10);
    // under four shown hands the tallies do not move it
    expect(
      omahaEvBluffShare(0.15, {
        measured: false,
        betCheckedToRatio: null,
        postflopManiac: false,
        sizeShown: { shown: 3, best: 0 },
      })
    ).toBe(0.15);
  });

  it('the spot reads the bet as a share of the pot, the line and the field', () => {
    const a = verdictOf(rec(59458558), null).spot;
    expect(a.street).toBe('river');
    expect(a.bucket).toBe('mid');
    expect(a.isRaise).toBe(false);
    expect(a.aggressorStreets).toBe(2);
    expect([a.callers, a.allIns, a.behind]).toEqual([0, 0, 0]);
    // heads-up, a shove the Horse cannot cover is a bet of what the Horse can call
    const b = verdictOf(rec(59521326), null).spot;
    expect(b.allIn).toBe(true);
    expect(b.paid).toBe(524.02);
    expect(b.winnable).toBeCloseTo(1939.02, 6);
    expect(b.potFrac).toBeCloseTo(524.02 / 1415, 6);
    expect(b.bucket).toBe('under40');
    // a shove over the Horse's own river bet is a raise
    expect(verdictOf(rec(59517323), null).spot.isRaise).toBe(true);
    // the field: an earlier all-in; a player still to act; a caller of the bet
    expect(verdictOf(rec(59446997), null).spot.allIns).toBe(1);
    expect(verdictOf(rec(59484381, 4), null).spot.behind).toBe(1);
    expect(verdictOf(rec(59484381, 5), null).spot.callers).toBe(1);
    expect(verdictOf(rec(58662831), null).spot.behind).toBe(1);
    // a turn call with chips behind is not final; a turn call for the stack is
    expect(verdictOf(rec(58477898), null).spot.final).toBe(false);
    expect(verdictOf(rec(58492067), null).spot.final).toBe(true);
    // the league's state carries no toCall and no legal-action menu: the same spot
    const league = at(rec(59458558));
    delete (league.gs as { toCall?: number }).toCall;
    delete (league.gs as { legalActions?: string[] }).legalActions;
    expect(omahaFacingBetEvSpot(league.hero, league.gs as never)).toEqual(a);
    // outside the spot
    const flop = at(rec(59458558), (x) => {
      x.variant = 'plo4';
    });
    expect(omahaFacingBetEvSpot(flop.hero, flop.gs as never)).toBeNull();
  });

  it('EV(call) is P(win) x the pot it wins + P(tie) x the split - P(lose) x the call, against one margin', () => {
    const { spot, v } = verdictOf(rec(59480782), null);
    const pLose = 1 - v.pWin - v.pTie;
    expect(v.ev).toBeCloseTo(
      v.pWin * spot.winnable + (v.pTie * (spot.winnable - spot.paid)) / 2 - pLose * spot.paid,
      8
    );
    expect(v.margin).toBeCloseTo(0.02 * (spot.winnable + spot.paid), 8);
    expect(v.call).toBe(v.ev > v.margin);
    expect(v.realization).toBe(1);
    expect(verdictOf(rec(58477898), null).v.realization).toBe(0.85);
  });
});

/** hand, seat, [unknown, bluff-heavy size read, value-heavy size read] verdicts (true = call) */
const TABLE: Array<[number, number | undefined, boolean, boolean, boolean]> = [
  // the eleven river folds to a 40 to 70 percent pot bet
  [59402247, undefined, false, true, false], // two pair, best hand
  [59407493, undefined, false, true, false], // set on a three-flush board, best hand
  [59446815, undefined, false, true, false], // set on a four-straight board, best hand
  [59458558, undefined, false, true, true], // trips on a paired board, best hand
  [59480782, undefined, true, true, true], // flush on a paired board, best hand
  [59437205, undefined, false, true, false], // two pair, beaten
  [59455656, undefined, false, true, false], // two pair, beaten
  [59484612, undefined, false, true, false], // top two on a three-flush board, beaten
  [59467641, undefined, false, false, false], // weak two pair, beaten
  [59438949, undefined, false, false, false], // two pair on a paired board, beaten
  [59399392, undefined, false, false, false], // pocket pair and the board's pair, beaten
  // controls
  [59477667, undefined, false, false, false], // one pair
  [59422360, undefined, false, true, false], // trips on a double-paired board, 85 percent of the pot
  // hands 59521326 and 59517323
  [59521326, undefined, true, true, true], // nut straight, the turn paired the board, the last 524 into 1,415
  [59517323, undefined, false, true, true], // aces up, its block bet shoved over (a raise)
  // multiway river calls without the nuts
  [59446997, undefined, true, true, true], // second-nut flush, 19 percent price
  [59484381, 4, false, true, true], // low flush, a player still to act
  [59484381, 5, true, true, true], // queen-high flush, 14 percent price, behind a caller
  [58662831, undefined, true, true, true], // middle set, 4.5 percent price
  // turn folds to half the pot or less
  [58477898, undefined, true, true, true],
  [58492067, undefined, true, true, false],
  [59285353, undefined, true, true, true],
];

describe('the recorded decisions', () => {
  it('the verdict table: unknown bettor, a measured bluff-heavy size, a measured value-heavy size', () => {
    for (const [n, seat, unknown, bluffy, value] of TABLE) {
      const r = rec(n, seat);
      expect([n, seat, 'unknown', verdictOf(r, null).v.call]).toEqual([
        n,
        seat,
        'unknown',
        unknown,
      ]);
      expect([n, seat, 'bluffy', verdictOf(r, BLUFF_HEAVY).v.call]).toEqual([
        n,
        seat,
        'bluffy',
        bluffy,
      ]);
      expect([n, seat, 'value', verdictOf(r, VALUE_HEAVY).v.call]).toEqual([
        n,
        seat,
        'value',
        value,
      ]);
    }
    expect(TABLE.length).toBe(RECORDED_FACING_BETS.length);
  }, 240000);

  it('the decision is the verdict on every seed, with its receipts', () => {
    for (const [n, seat, unknown, bluffy] of TABLE) {
      const r = rec(n, seat);
      for (const [read, call] of [
        [null, unknown],
        [BLUFF_HEAVY, bluffy],
      ] as Array<[OmahaFacingBetEvRead | null, boolean]>) {
        const on = play(r, ON, read);
        expect([n, seat, all(on, ...(call ? ['call', 'all_in'] : ['fold']))]).toEqual([
          n,
          seat,
          true,
        ]);
        expect(fired(on, call ? 'omaha_facing_bet_ev_call' : 'omaha_facing_bet_ev_fold')).toBe(
          SEEDS.length
        );
        expect(fired(on, call ? 'omaha_facing_bet_ev_fold' : 'omaha_facing_bet_ev_call')).toBe(0);
      }
    }
  }, 600000);

  it('hand 59521326: the paired-board fold no longer vetoes the nut straight; the change is counted', () => {
    const r = rec(59521326);
    const off = play(r, {});
    expect(all(off, 'fold')).toBe(true);
    expect(fired(off, 'plo_paired_board_fold')).toBe(SEEDS.length);
    const on = play(r, ON, null);
    expect(all(on, 'all_in')).toBe(true);
    expect(fired(on, 'omaha_facing_bet_ev_changed')).toBe(SEEDS.length);
    // the legacy rule is still named beside it
    expect(fired(on, 'plo_paired_board_fold')).toBe(SEEDS.length);
  });

  it('a clear fold: one pair facing a pot-sized river bet from a measured value-heavy bettor', () => {
    const r = rec(59477667);
    const pot = (x: RecordedFacingBet) => {
      const bet = x.pot - x.bet; // the pot before the bet
      x.a = x.a.replace('1|r|bet|212|p|1|0', `1|r|bet|${bet}|p|1|0`);
      x.pot = x.pot - x.bet + bet;
      x.seats.find((s) => s[0] === 1)![2] = bet;
      x.seats.find((s) => s[0] === 3)![1] = 2000; // deep enough to face the whole bet
      x.bet = bet;
    };
    const st = at(r, pot);
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    expect(spot.potFrac).toBeCloseTo(1, 6);
    const v = omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], VALUE_HEAVY)!;
    expect(v.call).toBe(false);
    expect(v.ev).toBeLessThan(-0.25 * spot.paid);
    const on = play(r, ON, VALUE_HEAVY, pot);
    expect(all(on, 'fold')).toBe(true);
  });

  it('a clear call: a set facing half the pot from a bettor measured bluff-heavy at that size', () => {
    const { spot, v } = verdictOf(rec(59407493), BLUFF_HEAVY);
    expect(spot.bucket).toBe('mid');
    expect(v.call).toBe(true);
    expect(v.ev).toBeGreaterThan(3 * v.margin);
    expect(all(play(rec(59407493), ON, BLUFF_HEAVY), 'call')).toBe(true);
  });

  it('the option never makes a bet or a raise, and a raise the brain chose is left exactly as it is', () => {
    for (const [n, seat] of TABLE) {
      const on = play(rec(n, seat), ON, BLUFF_HEAVY);
      expect(on.actions.filter((a) => a === 'raise' || a === 'bet').length).toBe(0);
    }
    // The same node with the nut straight in the Horse's hand: today's brain raises the short
    // all-in bet with a person still to act; the option leaves that decision byte for byte.
    const nuts = (x: RecordedFacingBet) => {
      x.hole = '5c6cQh2c7c';
    };
    const off = play(rec(58662831), {}, undefined, nuts);
    const on = play(rec(58662831), ON, null, nuts);
    expect(off.actions.filter((a) => a === 'raise' || a === 'all_in').length).toBeGreaterThan(0);
    off.actions.forEach((a, i) => {
      if (a === 'raise' || a === 'all_in') expect(on.bytes[i]).toBe(off.bytes[i]);
    });
  }, 600000);

  it('unset, false and a truthy non-boolean are byte-identical to today at every node', () => {
    for (const r of RECORDED_FACING_BETS) {
      const base = play(r, {});
      expect(play(r, { omahaFacingBetEv: false }).bytes).toEqual(base.bytes);
      expect(play(r, { omahaFacingBetEv: 'true' as never }).bytes).toEqual(base.bytes);
      expect(play(r, { omahaFacingBetEv: 1 as never }).bytes).toEqual(base.bytes);
      expect(
        fired(base, 'omaha_facing_bet_ev_call') + fired(base, 'omaha_facing_bet_ev_fold')
      ).toBe(0);
    }
  }, 600000);

  it('the worker receipt validator admits the fold that became a call, with the request only', () => {
    let checked = 0;
    for (const n of [59407493, 58477898]) {
      const r = rec(n);
      HorseMind.reset();
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => BLUFF_HEAVY);
      seedFastRandom(3);
      const st = at(r);
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        ...ON,
      } as never);
      vi.restoreAllMocks();
      expect(d.action).toBe('call');
      if (d.policyGraph === undefined) continue;
      checked++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), r.variant ?? 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// ───────────── the optional shown-down read on the existing size buckets ─────────────

describe('the size read comes from the existing river size-bucket tallies, when they carry `best`', () => {
  const BEST_FOLDS = [59402247, 59407493, 59446815];
  const bettorOf = (r: RecordedFacingBet) => `p${r.pl.split(' ').find((x) => x[1] === 'P')![0]}`;
  /** The existing import writer of the existing structure; `best` is the optional field. */
  const give = (who: string, buckets: Record<string, object>) =>
    HorseMind.importSizeBuckets(
      (['hu', 'short', 'full'] as const).map((size) => ({
        user_id: who,
        variant: 'plo5',
        mode: 'cash' as const,
        size,
        buckets: buckets as never,
      }))
    );

  it('absent today: the tallies as the learner writes them give no size read', () => {
    HorseMind.reset();
    give('p1', { medium: { bets: 30, shown: 16, strong: 14 } });
    HorseMind.setDecisionScope('omaha:full' as never, 'plo5');
    expect(HorseMind.omahaFacingBetEvReadOf('p1', 'river', 0.55)!.sizeShown).toBeNull();
    const r = rec(59407493);
    expect(
      play(r, ON, undefined, undefined, () =>
        give(bettorOf(r), { medium: { bets: 30, shown: 16, strong: 14 } })
      ).bytes
    ).toEqual(play(r, ON).bytes);
  });

  it('present: read for a river bet of that bucket only, never for a raise or the turn', () => {
    HorseMind.reset();
    give('p1', { medium: { bets: 30, shown: 16, strong: 14, best: 7, second: 2 } });
    HorseMind.setDecisionScope('omaha:full' as never, 'plo5');
    expect(HorseMind.omahaFacingBetEvReadOf('p1', 'river', 0.55)!.sizeShown).toEqual({
      shown: 16,
      best: 7,
      second: 2,
    });
    expect(HorseMind.omahaFacingBetEvReadOf('p1', 'river', 0.8)!.sizeShown).toBeNull();
    expect(HorseMind.omahaFacingBetEvReadOf('p1', 'river', 0.55, true)!.sizeShown).toBeNull();
    expect(HorseMind.omahaFacingBetEvReadOf('p1', 'turn', 0.55)!.sizeShown).toBeNull();
    // a strong hand that lost counts half: (0.15 x 8 + 16 - 7 - 1) / 24
    expect(
      omahaEvBluffShare(0.15, HorseMind.omahaFacingBetEvReadOf('p1', 'river', 0.55))
    ).toBeCloseTo(9.2 / 24, 10);
  });

  it('through HorseMind, not a mock: river bets of that size behind 9 times in 16 turn the three best-hand folds into calls', () => {
    for (const n of BEST_FOLDS) {
      const r = rec(n);
      expect(all(play(r, ON), 'fold')).toBe(true);
      // the recorded bets are 50 to 58 percent of the pot: the existing "medium" bucket (0.5 to 0.66)
      const on = play(r, ON, undefined, undefined, () =>
        give(bettorOf(r), { medium: { bets: 30, shown: 16, strong: 14, best: 7 } })
      );
      expect([n, on.actions]).toEqual([n, SEEDS.map(() => 'call')]);
      // option off: the same tallies change nothing
      expect(
        play(r, {}, undefined, undefined, () =>
          give(bettorOf(r), { medium: { bets: 30, shown: 16, strong: 14, best: 7 } })
        ).bytes
      ).toEqual(play(r, {}).bytes);
    }
  }, 600000);

  it('through HorseMind: bets of two thirds of the pot and over always the best hand keep those folds', () => {
    for (const n of BEST_FOLDS) {
      const r = rec(n);
      const on = play(r, ON, undefined, undefined, () =>
        give(bettorOf(r), {
          large: { bets: 30, shown: 16, strong: 16, best: 16 },
          medium: { bets: 30, shown: 16, strong: 16, best: 16 },
        })
      );
      expect([n, all(on, 'fold')]).toEqual([n, true]);
    }
  }, 600000);

  it('a caller is modelled on the population share; the context takes no per-caller read (audit item 8)', () => {
    const r = rec(59484381, 5);
    const st = at(r);
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    expect(spot.callerSeats).toEqual([4]);
    const run = (ctx: Record<string, unknown>) =>
      omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null, ctx as never)!
        .field;
    const base = run({});
    expect(base).toBeLessThan(1);
    // the removed input is not read: an object that still carries it changes nothing
    expect(run({ callerShown: [{ shown: 16, best: 2 }] })).toBe(base);
    expect(run({ callerShown: [{ shown: 16, best: 16 }] })).toBe(base);
  });
});
