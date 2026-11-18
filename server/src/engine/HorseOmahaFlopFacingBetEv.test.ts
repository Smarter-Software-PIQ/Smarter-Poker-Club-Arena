/**
 * OMAHA FACING A BET ON THE FLOP: ONE PRICED DECISION (option
 * omahaFlopFacingBetEv, default OFF; PLO Strategy lane 2026-11-17).
 *
 * The nodes are public records of PLO5 cash flop decisions facing one
 * player's bet or raise (HorseOmahaFlopFacingBetEv.test-support.ts; no
 * identities, no person's cards), taken from the decision audit of that
 * player's hands: flop folds the audit judged wrong, calls that lost, and a
 * call of a bet of a third of the pot.
 *
 *  - the sampled count: deterministic, its own random stream, close to an
 *    independent estimate, and the same runouts whatever the value share;
 *  - the realization factor read from the runouts;
 *  - the spot, the range by pot share (never by chips) and the verdict;
 *  - the recorded decisions through HorseLogic.decide, option on and off;
 *  - PRECEDENCE: which rule decides a flop spot with the option off and on
 *    (the paired-board fold, the 20 big blind mark, the bare-overpair
 *    continuation, a raise);
 *  - unset and false byte-identical; the worker receipt validator;
 *  - THE FIELD counted together on the same runouts (a caller, a player
 *    still to act with his call in the pot), the realization measured by
 *    hand class and position, the lead told from the stab, the ramp over
 *    what is left to bet, and the five flop folds of sets and nut straights
 *    the 48-hour audit named (RC-02a): four are called, the fifth is a
 *    priced thin spot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { fastRandom, scoreOmahaHiPartial, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { omahaFacingBetEvSpot, type OmahaFacingBetEvRead } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_FLOP_EV_BEHIND_CONTINUE,
  OMAHA_FLOP_EV_CALLER_SHARE,
  OMAHA_FLOP_EV_FIELD_MAX,
  OMAHA_FLOP_EV_LEAD,
  OMAHA_FLOP_EV_OTHER_PER_RUNOUT,
  OMAHA_FLOP_EV_POOL,
  OMAHA_FLOP_EV_PRIOR_OTHER,
  OMAHA_FLOP_EV_REALIZATION_CEILING,
  OMAHA_FLOP_EV_REALIZATION_FIT,
  OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS,
  OMAHA_FLOP_EV_RIVERS,
  OMAHA_FLOP_EV_STAB,
  OMAHA_FLOP_EV_VALUE_PER_RUNOUT,
  OMAHA_FLOP_EV_VALUE_SHARE,
  OMAHA_FLOP_RUNOUT_REALIZATION_MIN,
  OMAHA_FLOP_RUNOUT_ROW,
  omahaFlopEvBehindContinue,
  omahaFlopEvCounts,
  omahaFlopEvCountsResetCache,
  omahaFlopEvSeed,
  omahaFlopFacingBetEvAdmitsCall,
  omahaFlopFacingBetEvSpot,
  omahaFlopFacingBetEvVerdict,
  omahaFlopFittedRealization,
  omahaFlopHandClass,
  omahaFlopRunoutRealization,
  type OmahaFlopRealizationFit,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaFlopFacingBetEvAnswer } from './HorseOmahaFlopFacingBetEvRule.js';
import { omahaBareOverpairFlopFacingBetSpot } from './HorseOmahaOopChecks.js';
import {
  OMAHA_LIVE_OPTIONS_20261116,
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
  flopCardsOf,
  type FlopEdit,
  type RecordedFlopFacingBet,
} from './HorseOmahaFlopFacingBetEv.test-support.js';
import type { Card } from '../types.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6];
const ON: HorseDecideOpts = { omahaFlopFacingBetEv: true };
const PACKAGE = OMAHA_LIVE_OPTIONS_20261116 as HorseDecideOpts;
const VALUE_LEADER: OmahaFacingBetEvRead = {
  measured: true,
  betCheckedToRatio: 0.9,
  postflopManiac: false,
  valueLeader: true,
  sizeShown: null,
};
const MANIAC: OmahaFacingBetEvRead = {
  measured: true,
  betCheckedToRatio: 1.5,
  postflopManiac: true,
  valueLeader: false,
  sizeShown: null,
};

const rec = (n: number, seat?: number): RecordedFlopFacingBet =>
  RECORDED_FLOP_FACING_BETS.find((r) => r.n === n && (seat === undefined || r.seat === seat))!;
function at(r: RecordedFlopFacingBet, edit: FlopEdit = {}) {
  const { fx, node } = expandFlop(r, edit);
  return stateAt(fx, node);
}
const decisionBytes = (d: unknown): string => JSON.stringify(withoutMeasurements(d));

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  refusals: Array<string | null>;
}
function play(
  r: RecordedFlopFacingBet,
  opts: HorseDecideOpts,
  edit: FlopEdit = {},
  read: OmahaFacingBetEvRead | null | undefined = undefined
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], refusals: [] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    if (read !== undefined)
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => read);
    drainFires();
    seedFastRandom(seed);
    const st = at(r, edit);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    out.refusals.push(
      d.policyGraph === undefined
        ? null
        : (horseDecisionReceiptRefusal(structuredClone(d), edit.variant ?? 'plo5', {
            player: st.hero,
            gameState: st.gs,
          }) as string | null)
    );
    vi.restoreAllMocks();
  }
  return out;
}
const all = (o: Outcome, ...actions: string[]) => o.actions.every((a) => actions.includes(a));
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
function verdictOf(
  r: RecordedFlopFacingBet,
  read: OmahaFacingBetEvRead | null = null,
  edit: FlopEdit = {},
  inPosition = false
) {
  const st = at(r, edit);
  const spot = omahaFlopFacingBetEvSpot(st.hero, st.gs as never)!;
  return {
    spot,
    v: omahaFlopFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], read, {
      rake: 0,
      inPosition,
    })!,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  omahaFlopEvCountsResetCache();
});

// ───────────────────────────── the sampled count ─────────────────────────────

describe('the sampled count of the flop hand', () => {
  const RANKS = '23456789TJQKA'.split('');
  const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  const unseenOf = (hole: Card[], board: Card[]): Card[] => {
    const seen = new Set([...hole, ...board].map((c) => c.rank + c.suit));
    const out: Card[] = [];
    for (const s of SUITS)
      for (const k of RANKS) if (!seen.has(k + s)) out.push({ rank: k, suit: s } as Card);
    return out;
  };
  /** An independent estimate: its own generator, every holding and runout drawn afresh. */
  function independent(hole: Card[], board: Card[], share: number, samples: number) {
    const unseen = unseenOf(hole, board);
    let state = 0x2545f491;
    const rnd = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    const draw = (k: number): Card[] => {
      const d = [...unseen];
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(rnd() * (d.length - i));
        [d[i], d[j]] = [d[j], d[i]];
      }
      return d.slice(0, k);
    };
    // the value line: the flop strength at the `share` quantile of drawn holdings
    const strengths = Array.from({ length: 4000 }, () =>
      scoreOmahaHiPartial(draw(hole.length), board)
    ).sort((a, b) => b - a);
    const line = strengths[Math.floor(share * strengths.length)];
    const tally = { v: 0, vn: 0, o: 0, on: 0 };
    for (let i = 0; i < samples; i++) {
      const d = draw(hole.length + 2);
      const opp = d.slice(0, hole.length);
      const five = [...board, d[hole.length], d[hole.length + 1]];
      const h = scoreOmahaHiPartial(hole, five);
      const s = scoreOmahaHiPartial(opp, five);
      const res = h > s ? 1 : h === s ? 0.5 : 0;
      if (scoreOmahaHiPartial(opp, board) > line) {
        tally.v += res;
        tally.vn++;
      } else {
        tally.o += res;
        tally.on++;
      }
    }
    return { value: tally.v / tally.vn, other: tally.o / tally.on };
  }

  it('is close to an independent estimate against the value region and the other holdings (PLO4 and PLO5)', () => {
    const hands: Array<[string, string, number]> = [
      ['AsKsQdJd', 'Ts7s2c', 0.46], // nut flush draw, gutshot, overcards
      ['9h9d8c7c', '9s5d2h', 0.36], // top set, dry flop
      ['AhAc4d2h3h', 'KhKd6s', 0.46], // aces on a paired flop
      ['7sAc6s4sQc', 'JdQs6c', 0.36], // top and bottom pair
      ['KcQc5d4d2s', 'Jh8h3s', 0.56], // air
    ];
    for (const [h, b, share] of hands) {
      const hole = flopCardsOf(h);
      const board = flopCardsOf(b);
      const c = omahaFlopEvCounts(hole, board, [], share)!;
      const ind = independent(hole, board, share, 12000);
      expect(Math.abs(c.value.win + 0.5 * c.value.tie - ind.value), `${h} value`).toBeLessThan(
        0.06
      );
      expect(Math.abs(c.other.win + 0.5 * c.other.tie - ind.other), `${h} other`).toBeLessThan(
        0.07
      );
      expect(Math.abs(c.valueShare - share)).toBeLessThan(0.005);
    }
  });

  it('walks a balanced set of runouts: every unseen card is the turn card of the same number of them, with its holdings on each', () => {
    const hole = flopCardsOf('7sAc6s4sQc');
    const board = flopCardsOf('JdQs6c');
    const c = omahaFlopEvCounts(hole, board, [], 0.36)!;
    expect(c.unseen).toBe(44);
    expect(c.holeCount).toBe(5);
    expect(c.pool).toBe(OMAHA_FLOP_EV_POOL);
    expect(c.runouts).toBe(44 * OMAHA_FLOP_EV_RIVERS[0]);
    expect(c.rows.length).toBe(c.runouts * OMAHA_FLOP_RUNOUT_ROW);
    expect(c.turnOf.length).toBe(c.runouts);
    const perTurn = new Map<number, number>();
    for (const t of Array.from(c.turnOf)) perTurn.set(t, (perTurn.get(t) ?? 0) + 1);
    expect(perTurn.size).toBe(44);
    expect([...perTurn.values()].every((k) => k === OMAHA_FLOP_EV_RIVERS[0])).toBe(true);
    // a holding that holds a runout card is passed over for the next one: every runout meets its full count
    const per = OMAHA_FLOP_EV_VALUE_PER_RUNOUT + OMAHA_FLOP_EV_OTHER_PER_RUNOUT;
    expect(c.samples).toBe(c.runouts * per);
    for (let k = 0; k < c.runouts; k++) {
      expect(c.rows[k * OMAHA_FLOP_RUNOUT_ROW + 1]).toBe(OMAHA_FLOP_EV_VALUE_PER_RUNOUT);
      expect(c.rows[k * OMAHA_FLOP_RUNOUT_ROW + 3]).toBe(OMAHA_FLOP_EV_OTHER_PER_RUNOUT);
    }
    const four = omahaFlopEvCounts(flopCardsOf('AsKsQdJd'), flopCardsOf('Ts7s2c'), [], 0.46)!;
    expect(four.unseen).toBe(45);
    expect(four.runouts).toBe(45 * OMAHA_FLOP_EV_RIVERS[0]);
    // a larger field walks fewer runouts with the same holdings on each
    const field = omahaFlopEvCounts(hole, board, [], 0.36, {
      always: [0.55],
      behind: 1,
      behindShare: 0.55,
    })!;
    expect(field.runouts).toBe(44 * OMAHA_FLOP_EV_RIVERS[2]);
    // the bettor and two others on every holding (a holding with no clear partner is passed over: rare)
    expect(field.samples).toBeGreaterThan(field.runouts * per * 3 * 0.99);
    expect(field.samples).toBeLessThanOrEqual(field.runouts * per * 3);
  });

  it('the sampling error of the verdict is under its margin: other seeds of the same hands move EV by less than 2 percent of the pot', () => {
    // the decision never passes a salt; the measurement does, to draw the same hand again
    const spread: number[] = [];
    for (const r of RECORDED_FLOP_FACING_BETS) {
      const st = at(r);
      const spot = omahaFlopFacingBetEvSpot(st.hero, st.gs as never);
      if (!spot) continue;
      const evs: number[] = [];
      for (let salt = 0; salt < 6; salt++) {
        const v = omahaFlopFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null, {
          rake: 0,
          inPosition: false,
          salt,
        })!;
        evs.push(v.ev / (spot.winnable + spot.paid));
      }
      const mean = evs.reduce((x, y) => x + y, 0) / evs.length;
      spread.push(Math.sqrt(evs.reduce((x, y) => x + (y - mean) ** 2, 0) / (evs.length - 1)));
    }
    expect(spread.length).toBeGreaterThanOrEqual(20);
    spread.sort((x, y) => x - y);
    // the margin is 0.02 of the pot
    expect(spread[spread.length >> 1]).toBeLessThan(0.02);
    expect(spread.reduce((x, y) => x + y, 0) / spread.length).toBeLessThan(0.02);
  });

  it('is the same on every call, in any card order, and draws nothing from the brain random stream', () => {
    const hole = flopCardsOf('9h9d8c7c');
    const board = flopCardsOf('9s5d2h');
    seedFastRandom(4242);
    const expected = [fastRandom(), fastRandom(), fastRandom()];
    seedFastRandom(4242);
    const a = omahaFlopEvCounts(hole, board, [], 0.36)!;
    omahaFlopEvCountsResetCache();
    const b = omahaFlopEvCounts([...hole].reverse(), [board[2], board[0], board[1]], [], 0.36)!;
    expect([fastRandom(), fastRandom(), fastRandom()]).toEqual(expected);
    expect(b.seed).toBe(a.seed);
    expect(b.seed).toBe(omahaFlopEvSeed(hole, board, []));
    expect(b.value).toEqual(a.value);
    expect(b.other).toEqual(a.other);
    expect(Array.from(b.rows)).toEqual(Array.from(a.rows));
    // a hand asked again answers as a hand asked first (the memo), and a dead card changes the sample
    expect(omahaFlopEvCounts(hole, board, [], 0.36)).toBe(b);
    const dead = omahaFlopEvCounts(hole, board, flopCardsOf('Ac'), 0.36)!;
    expect(dead.unseen).toBe(a.unseen - 1);
    expect(dead.seed).not.toBe(a.seed);
  });

  it('walks the same runouts whatever the value share, and a narrower value region is a stronger one', () => {
    const hole = flopCardsOf('7sAc6s4sQc');
    const board = flopCardsOf('JdQs6c');
    const wide = omahaFlopEvCounts(hole, board, [], 0.56)!;
    const mid = omahaFlopEvCounts(hole, board, [], 0.36)!;
    const narrow = omahaFlopEvCounts(hole, board, [], 0.18)!;
    expect(Array.from(mid.turnOf)).toEqual(Array.from(wide.turnOf));
    expect(Array.from(narrow.turnOf)).toEqual(Array.from(wide.turnOf));
    expect(wide.value.win).toBeGreaterThan(mid.value.win);
    expect(mid.value.win).toBeGreaterThan(narrow.value.win);
    // the field read: the strongest quarter is harder to beat than the strongest half
    const quarter = mid.top(0.25);
    const half = mid.top(0.5);
    expect(quarter.win).toBeLessThan(half.win);
    expect(half.share).toBe(0.5);
  });

  it('refuses what is not a four or five card flop hand', () => {
    const board = flopCardsOf('JdQs6c');
    expect(omahaFlopEvCounts(flopCardsOf('7sAc6s'), board, [], 0.4)).toBeNull();
    expect(omahaFlopEvCounts(flopCardsOf('7sAc6s4sQc2d'), board, [], 0.4)).toBeNull();
    expect(
      omahaFlopEvCounts(flopCardsOf('7sAc6s4sQc'), flopCardsOf('JdQs6c2h'), [], 0.4)
    ).toBeNull();
    expect(omahaFlopEvCounts(flopCardsOf('7sAc6s4sJd'), board, [], 0.4)).toBeNull(); // a card twice
  });
});

// ───────────────────────────── realization ─────────────────────────────

describe('the realization factor is read from the runouts', () => {
  const rowsOf = (h: string, b: string, share: number) => {
    const c = omahaFlopEvCounts(flopCardsOf(h), flopCardsOf(b), [], share)!;
    return c;
  };

  it('a hand that is strong on the runouts it wins realizes nearly all; a bluff-catcher realizes much less', () => {
    const set = rowsOf('9h9d8c7c', '9s5d2h', 0.36);
    const nutDraw = rowsOf('AsKsQdJd', 'Ts7s2c', 0.46);
    const underpair = rowsOf('6h6dKc8c3s', 'QsJd9h', 0.46);
    const r = (c: typeof set, q = 0.32, ip = false) =>
      omahaFlopRunoutRealization(c.rows, c.turnOf, q, ip)!;
    expect(r(set).realization).toBeGreaterThan(0.9);
    expect(r(nutDraw).realization).toBeGreaterThan(0.75);
    expect(r(underpair).realization).toBeLessThan(r(nutDraw).realization - 0.1);
    expect(r(underpair).realization).toBeGreaterThanOrEqual(OMAHA_FLOP_RUNOUT_REALIZATION_MIN);
    expect(r(set).robustShare).toBeGreaterThan(r(underpair).robustShare);
  });

  it('position and a bettor who bluffs more raise it; nothing in it is a bet size', () => {
    const c = rowsOf('AhAc4d2h3h', 'KhKd6s', 0.46);
    const oop = omahaFlopRunoutRealization(c.rows, c.turnOf, 0.3, false)!.realization;
    const ip = omahaFlopRunoutRealization(c.rows, c.turnOf, 0.3, true)!.realization;
    const bluffy = omahaFlopRunoutRealization(c.rows, c.turnOf, 0.6, false)!.realization;
    expect(ip).toBeGreaterThan(oop);
    expect(bluffy).toBeGreaterThan(oop);
  });

  it('by hand: equity on runouts the hand calls down is kept, bluff-catcher equity only where a street is checked', () => {
    // two turn cards, one river each. Runout 1: beats all 5 value holdings and all 3 others.
    // Runout 2: beats no value holding and all 3 others.
    const rows = [5, 5, 3, 3, 0, 5, 3, 3];
    const turnOf = [0, 1];
    const q = 0.2;
    const r = omahaFlopRunoutRealization(rows, turnOf, q, true)!;
    // weights: value (1-q)/10 per win, other q/6 per win
    const eqVal = (0.8 / 10) * 5;
    const eqOth = (0.2 / 6) * 3;
    const total = eqVal + 2 * eqOth;
    // runout 1 realized in full; runout 2 only its other-holdings equity, when both streets are checked (0.6 x 0.6)
    const realized = eqVal + eqOth + eqOth * 0.6 * 0.6;
    expect(r.realization).toBeCloseTo(realized / total, 10);
    expect(r.robustShare).toBeCloseTo((eqVal + eqOth) / total, 10);
    expect(r.runouts).toBe(2);
    // out of position he checks less often
    const oop = omahaFlopRunoutRealization(rows, turnOf, q, false)!;
    expect(oop.realization).toBeCloseTo((eqVal + eqOth + eqOth * 0.45 * 0.45) / total, 10);
  });

  it('answers null when there is nothing to read', () => {
    expect(omahaFlopRunoutRealization(null, null, 0.3, true)).toBeNull();
    expect(omahaFlopRunoutRealization([1, 1, 1], [0], 0.3, true)).toBeNull();
    expect(omahaFlopRunoutRealization([0, 5, 0, 3], [0], 0.3, true)).toBeNull(); // no equity at all
    expect(omahaFlopRunoutRealization([1, 5, 1, 3], [0], Number.NaN, true)).toBeNull();
    expect(omahaFlopRunoutRealization([1, -5, 1, 3], [0], 0.3, true)).toBeNull();
  });
});

// ───────────────────────────── the spot and the verdict ─────────────────────────────

describe('the spot, the range and the price', () => {
  it('reads the bet as a share of the pot, the line and the field', () => {
    // 59790514: 30 into 40 by the preflop raiser, two players still to act behind the Horse
    const a = verdictOf(rec(59790514)).spot;
    expect(a.street).toBe('flop');
    expect(a.potFrac).toBeCloseTo(0.75, 6);
    expect(a.bucket).toBe('big');
    expect(a.isRaise).toBe(false);
    expect(a.lead).toBe(false);
    expect(a.stab).toBe(false);
    expect([a.callers, a.allIns, a.behind]).toEqual([0, 0, 2]);
    // each of the two players behind would add his own 30 to the pot this call can win
    expect(a.behindCall).toBe(30);
    expect(a.paid).toBe(30);
    expect(a.winnable).toBe(70);
    expect(a.final).toBe(false);
    expect(a.later).toBe(1); // far more than a pot behind
    expect(a.valueShare).toBe(OMAHA_FLOP_EV_VALUE_SHARE.big);
    expect(a.priorBluff).toBe(OMAHA_FLOP_EV_PRIOR_OTHER.big);
    // 59852600: the Horse faces a raise
    const raised = verdictOf(rec(59852600)).spot;
    expect(raised.isRaise).toBe(true);
    expect(raised.valueShare).toBe(OMAHA_FLOP_EV_VALUE_SHARE.raise);
    expect(raised.priorBluff).toBe(OMAHA_FLOP_EV_PRIOR_OTHER.raise);
    // 59831538: a pot-sized bet into the preflop raiser by a player who only called (a lead)
    const lead = verdictOf(rec(59831538)).spot;
    expect(lead.lead).toBe(true);
    expect(lead.stab).toBe(false);
    expect(lead.valueShare).toBeCloseTo(OMAHA_FLOP_EV_VALUE_SHARE.big * OMAHA_FLOP_EV_LEAD, 10);
    expect(lead.priorBluff).toBeCloseTo(OMAHA_FLOP_EV_PRIOR_OTHER.big * OMAHA_FLOP_EV_LEAD, 10);
  });

  it('a bet after the preflop raiser checked is a stab, not a lead: wider than a lead, narrower than a continuation bet', () => {
    // 59868806: seat 5 raised before the flop; the flop was checked to seat 1, who bet half the pot.
    const r = rec(59868806);
    const stab = verdictOf(r).spot;
    expect(stab.lead).toBe(false);
    expect(stab.stab).toBe(true);
    expect(OMAHA_FLOP_EV_STAB).toBeGreaterThan(OMAHA_FLOP_EV_LEAD);
    expect(OMAHA_FLOP_EV_STAB).toBeLessThan(1);
    expect(stab.valueShare).toBeCloseTo(OMAHA_FLOP_EV_VALUE_SHARE.mid * OMAHA_FLOP_EV_STAB, 10);
    expect(stab.priorBluff).toBeCloseTo(OMAHA_FLOP_EV_PRIOR_OTHER.mid * OMAHA_FLOP_EV_STAB, 10);
    // the same bet with the raiser's check taken out of the record is a lead into him
    const led = { ...r, a: r.a.replace(';5|f|check|0|h|0|0', '') };
    expect(led.a).not.toBe(r.a);
    const asLead = verdictOf(led).spot;
    expect(asLead.lead).toBe(true);
    expect(asLead.stab).toBe(false);
    expect(asLead.valueShare).toBeCloseTo(OMAHA_FLOP_EV_VALUE_SHARE.mid * OMAHA_FLOP_EV_LEAD, 10);
    // and what the raiser did AFTER the bet does not change the range the bet came from
    expect(r.a.includes('5|f|fold')).toBe(true);
  });

  it('covers PLO4 and PLO5 cash flops facing a bet and nothing else', () => {
    const r = rec(59790514);
    const spotOf = (edit: FlopEdit) => {
      const st = at(r, edit);
      return omahaFlopFacingBetEvSpot(st.hero, st.gs as never);
    };
    expect(spotOf({})).not.toBeNull();
    expect(spotOf({ variant: 'plo4', hole: '7sAc6sQc' })).not.toBeNull();
    expect(spotOf({ variant: 'plo6', hole: '7sAc6s4sQc2d' })).toBeNull();
    expect(spotOf({ mode: 'tournament' })).toBeNull();
    expect(spotOf({ bombPot: true })).toBeNull();
    expect(spotOf({ wagersCapped: true })).toBeNull();
    expect(spotOf({ variant: 'plo4' })).toBeNull(); // five cards in a four-card game
    // the turn and river rule never answers the flop, and the flop rule never a later street
    const st = at(r);
    expect(omahaFacingBetEvSpot(st.hero, st.gs as never)).toBeNull();
    const later = { ...st.gs, stage: 'turn', communityCards: flopCardsOf('JdQs6c2h') };
    expect(omahaFlopFacingBetEvSpot(st.hero, later as never)).toBeNull();
    // nothing to call
    expect(omahaFlopFacingBetEvSpot(st.hero, { ...st.gs, toCall: 0 } as never)).toBeNull();
  });

  it('a call for the whole stack is final and takes no realization factor; what is left to bet moves the factor in a straight line, with no step', () => {
    const r = rec(59790514); // 30 to call into 70: the pot after the call is 100
    const short = verdictOf(r, null, { stacks: { 2: 30 } });
    expect(short.spot.allIn).toBe(true);
    expect(short.spot.final).toBe(true);
    expect(short.spot.later).toBe(0);
    expect(short.v.realization).toBe(1);
    expect(short.v.robustShare).toBeNull();
    const deep = verdictOf(r);
    expect(deep.spot.final).toBe(false);
    expect(deep.spot.later).toBe(1);
    expect(deep.v.realization).not.toBe(1);
    expect(deep.v.robustShare).not.toBeNull();
    const full = deep.v.realization;
    // 8 behind after the call is 8 percent of a pot: 8 percent of the way from 1 to the full factor
    const left = (behind: number) => verdictOf(r, null, { stacks: { 2: 30 + behind } });
    for (const behind of [1, 8, 10, 11, 25, 50, 99]) {
      const x = left(behind);
      expect(x.spot.allIn).toBe(false);
      expect(x.spot.final).toBe(false);
      expect(x.spot.later).toBeCloseTo(behind / 100, 9);
      expect(x.v.realization).toBeCloseTo(1 + (full - 1) * (behind / 100), 9);
    }
    // no step at a tenth of the pot (the old rule: no factor at 10 behind, the whole factor at 11)
    expect(Math.abs(left(11).v.realization - left(10).v.realization)).toBeLessThan(0.01);
    // a pot or more behind: the whole factor
    expect(left(100).v.realization).toBe(full);
    expect(left(400).v.realization).toBe(full);
  });

  it('heads-up, EV(call) is P(win) x the pot it wins + P(tie) x the split - P(lose) x the call, against one margin', () => {
    const { spot, v } = verdictOf(rec(59811519));
    expect([spot.callers, spot.allIns, spot.behind]).toEqual([0, 0, 0]);
    const pLose = 1 - v.pWin - v.pTie;
    expect(v.ev).toBeCloseTo(
      v.pWin * spot.winnable + v.pTie * ((spot.winnable - spot.paid) / 2) - pLose * spot.paid,
      9
    );
    expect(v.margin).toBeCloseTo(0.02 * (spot.winnable + spot.paid), 9);
    expect(v.price).toBeCloseTo(spot.paid / (spot.winnable + spot.paid), 12);
    expect(v.call).toBe(v.ev > v.margin);
    expect(v.bluffShare).toBe(OMAHA_FLOP_EV_PRIOR_OTHER.mid); // no read: the prior
    expect(v.field).toBe(1);
    expect(v.continueShare).toBe(0);
  });

  it('a player still to act is priced both ways: he folds and the pot stays, or he continues with his call in the pot and his hand to beat', () => {
    const r = rec(59790514); // 30 into 40, two players behind
    const st = at(r);
    const { spot, v } = verdictOf(r);
    expect(spot.behind).toBe(2);
    const cont = omahaFlopEvBehindContinue(spot.potFrac);
    expect(v.continueShare).toBe(cont);
    // 0.75 of the pot sits between the measured points at 0.65 and 1
    expect(cont).toBeGreaterThan(OMAHA_FLOP_EV_BEHIND_CONTINUE[3][1]);
    expect(cont).toBeLessThan(OMAHA_FLOP_EV_BEHIND_CONTINUE[2][1]);
    const counts = omahaFlopEvCounts(st.hero.cards, st.gs.communityCards, [], spot.valueShare, {
      always: [],
      behind: 2,
      behindShare: OMAHA_FLOP_EV_CALLER_SHARE,
    })!;
    expect(counts.jointValue.length).toBe(3);
    const q = v.bluffShare;
    const weights = [(1 - cont) ** 2, 2 * cont * (1 - cont), cont ** 2];
    let ev = 0;
    for (let j = 0; j <= 2; j++) {
      const jv = counts.jointValue[j];
      const jo = counts.jointOther[j];
      const win = v.realization * (q * jo.win + (1 - q) * jv.win);
      const tie = v.realization * (q * jo.tie + (1 - q) * jv.tie);
      const tieShare = v.realization * (q * jo.tieShare + (1 - q) * jv.tieShare);
      const pot = spot.winnable + j * spot.behindCall; // each one who continues adds his 30
      ev +=
        weights[j] *
        (win * pot + tieShare * (pot + spot.paid) - tie * spot.paid - (1 - win - tie) * spot.paid);
    }
    expect(v.ev).toBeCloseTo(ev, 9);
    // nobody behind continuing is the bettor alone; every one who continues is one more hand to beat
    expect(counts.jointValue[0].win).toBe(counts.value.win);
    expect(counts.jointValue[1].win).toBeLessThan(counts.jointValue[0].win);
    expect(counts.jointValue[2].win).toBeLessThan(counts.jointValue[1].win);
    expect(v.field).toBeLessThan(1);
    // the old tax had no pot credit and capped the factor at 0.85: with the same two players
    // behind the call is worth more than a product of "must also beat him" shares
    const alone = q * counts.other.win + (1 - q) * counts.value.win;
    const taxed =
      alone * (1 - 0.25 * (1 - counts.top(0.25).win)) ** 2 * Math.min(v.realization, 0.85);
    expect(v.pWin).toBeGreaterThan(taxed);
    // there is no cap for a player behind
    expect(OMAHA_FLOP_EV_REALIZATION_CEILING).toBeGreaterThan(0.85);
  });

  it('the continue rate of a player behind follows the bet as a share of the pot (measured points, straight lines between)', () => {
    const pts = OMAHA_FLOP_EV_BEHIND_CONTINUE;
    expect(omahaFlopEvBehindContinue(0.05)).toBe(pts[0][1]);
    expect(omahaFlopEvBehindContinue(pts[1][0])).toBeCloseTo(pts[1][1], 12);
    expect(omahaFlopEvBehindContinue((pts[1][0] + pts[2][0]) / 2)).toBeCloseTo(
      (pts[1][1] + pts[2][1]) / 2,
      12
    );
    expect(omahaFlopEvBehindContinue(3)).toBe(pts[pts.length - 1][1]);
    for (let x = 0.05; x < 1.5; x += 0.05)
      expect(omahaFlopEvBehindContinue(x + 0.05)).toBeLessThanOrEqual(omahaFlopEvBehindContinue(x));
  });

  it('a caller is beaten TOGETHER with the bettor on the same runout, not as a second independent share', () => {
    // 59710501: bottom set on 7h 9h Jd, a caller already in. A set wins on the runouts where it is
    // strong against both, so the joint share is far above the product of the two separate shares
    // (the product is what folded this hand).
    const st = at(rec(59710501));
    const spot = omahaFlopFacingBetEvSpot(st.hero, st.gs as never)!;
    expect([spot.callers, spot.allIns, spot.behind]).toEqual([1, 0, 1]);
    const c = omahaFlopEvCounts(st.hero.cards, st.gs.communityCards, [], spot.valueShare, {
      always: [OMAHA_FLOP_EV_CALLER_SHARE],
      behind: 0,
      behindShare: 1,
    })!;
    const together = c.jointValue[0].win;
    const product = c.value.win * c.top(OMAHA_FLOP_EV_CALLER_SHARE).win;
    expect(together).toBeLessThan(c.value.win);
    expect(together).toBeGreaterThan(product + 0.05);
    // a field larger than the count draws for is not answered (the decision it was given stands)
    expect(
      omahaFlopEvCounts(st.hero.cards, st.gs.communityCards, [], spot.valueShare, {
        always: new Array(OMAHA_FLOP_EV_FIELD_MAX + 1).fill(0.5),
        behind: 0,
        behindShare: 1,
      })
    ).toBeNull();
  });

  it('the size of the bet in chips decides nothing: the same spot at a tenth and at ten times the stakes is the same verdict', () => {
    for (const r of [rec(59790514), rec(59811519), rec(59870825)]) {
      const base = verdictOf(r);
      for (const scale of [0.1, 10]) {
        const other = verdictOf(r, null, { scale });
        expect(other.spot.potFrac).toBeCloseTo(base.spot.potFrac, 9);
        expect(other.v.call).toBe(base.v.call);
        expect(other.v.pWin).toBe(base.v.pWin);
        expect(other.v.realization).toBe(base.v.realization);
        expect(other.v.ev / other.spot.paid).toBeCloseTo(base.v.ev / base.spot.paid, 9);
      }
    }
    // 59811519 is a 144-chip bet (72 big blinds) of half the pot: called on the hand and the price
    expect(verdictOf(rec(59811519)).v.call).toBe(true);
  });

  it('the hand decides at one size: at the same bet a strong hand calls and a weak one folds', () => {
    const r = rec(59790514); // 30 into 40 on Jd Qs 6c
    expect(verdictOf(r, null, { hole: 'QhQdAc4s7s' }).v.call).toBe(true); // top set
    expect(verdictOf(r, null, { hole: 'KhTh9d8d2c' }).v.call).toBe(true); // a wrap, no pair
    expect(verdictOf(r, null, { hole: '2h2d4c7s8s' }).v.call).toBe(false); // an underpair
    expect(verdictOf(r, null, { hole: 'Ah3d4c7s8h' }).v.call).toBe(false); // ace high
  });

  it('the measured read moves the answer: a value leader folds a hand an unknown bettor is called with', () => {
    const r = rec(59869211); // jacks on 8 4 4, a third of the pot
    const unknown = verdictOf(r, null);
    const leader = verdictOf(r, VALUE_LEADER);
    const maniac = verdictOf(r, MANIAC);
    expect(leader.v.bluffShare).toBeLessThan(unknown.v.bluffShare);
    expect(maniac.v.bluffShare).toBeGreaterThan(unknown.v.bluffShare);
    expect(leader.v.ev).toBeLessThan(unknown.v.ev);
    expect(maniac.v.ev).toBeGreaterThan(unknown.v.ev);
    expect(unknown.v.call).toBe(true);
  });

  it('the validator seam admits the call only in the spot and only for the exact chips', () => {
    const st = at(rec(59790514));
    expect(omahaFlopFacingBetEvAdmitsCall(st.hero, st.gs as never, 30)).toBe(true);
    expect(omahaFlopFacingBetEvAdmitsCall(st.hero, st.gs as never, 31)).toBe(false);
    expect(omahaFlopFacingBetEvAdmitsCall(st.hero, st.gs as never, null)).toBe(false);
    const tour = at(rec(59790514), { mode: 'tournament' });
    expect(omahaFlopFacingBetEvAdmitsCall(tour.hero, tour.gs as never, 30)).toBe(false);
  });
});

// ───────────────────────────── the recorded decisions ─────────────────────────────

describe('the recorded flop decisions', () => {
  const group = (g: RecordedFlopFacingBet['group']) =>
    RECORDED_FLOP_FACING_BETS.filter((r) => r.group === g);

  it('the nine folds the audit judged wrong: the production package folds them, with the option on they are called', () => {
    expect(group('wrongFold').length).toBe(9);
    for (const r of group('wrongFold')) {
      const off = play(r, PACKAGE);
      const on = play(r, { ...PACKAGE, ...ON });
      expect(all(off, 'fold'), `hand ${r.n} off`).toBe(true);
      expect(all(on, 'call'), `hand ${r.n} on`).toBe(true);
      expect(fired(on, 'omaha_flop_facing_bet_ev_call'), `hand ${r.n}`).toBe(SEEDS.length);
      expect(fired(on, 'omaha_flop_facing_bet_ev_changed'), `hand ${r.n}`).toBe(SEEDS.length);
      expect(fired(off, 'omaha_flop_facing_bet_ev_call')).toBe(0);
      expect(
        on.refusals.every((x) => x === null),
        `hand ${r.n} receipts`
      ).toBe(true);
    }
  });

  it('two folds the audit judged wrong stay folds: the verdict does not call every hand the audit would', () => {
    // 59833693: jacks on 6 K K, three quarters of the pot (the audit: he was bluffing; the count: 0.18 against
    // the value region). 59848622: aces and kings on 7 3 8 in a 500-chip pot, the EV short of the margin.
    for (const r of group('wrongFoldKept')) {
      const on = play(r, { ...PACKAGE, ...ON });
      expect(all(on, 'fold'), `hand ${r.n}`).toBe(true);
      expect(fired(on, 'omaha_flop_facing_bet_ev_fold'), `hand ${r.n}`).toBe(SEEDS.length);
      expect(verdictOf(r).v.call).toBe(false);
    }
  });

  it('three calls that lost are folded with the option on, and the change is counted', () => {
    for (const r of group('lostCall')) {
      const off = play(r, PACKAGE);
      const on = play(r, { ...PACKAGE, ...ON });
      expect(all(off, 'call'), `hand ${r.n} off`).toBe(true);
      expect(all(on, 'fold'), `hand ${r.n} on`).toBe(true);
      expect(fired(on, 'omaha_flop_facing_bet_ev_fold'), `hand ${r.n}`).toBe(SEEDS.length);
      expect(fired(on, 'omaha_flop_facing_bet_ev_changed'), `hand ${r.n}`).toBe(SEEDS.length);
      expect(
        on.refusals.every((x) => x === null),
        `hand ${r.n} receipts`
      ).toBe(true);
    }
  });

  it('a call of a third of the pot on a paired flop is kept: priced, not folded for its size or the board', () => {
    const [r] = group('smallBetCall');
    const { spot, v } = verdictOf(r);
    expect(spot.bucket).toBe('under40');
    expect(v.call).toBe(true);
    const on = play(r, { ...PACKAGE, ...ON });
    expect(all(on, 'call')).toBe(true);
    expect(fired(on, 'omaha_flop_facing_bet_ev_call')).toBe(SEEDS.length);
    expect(fired(on, 'omaha_flop_facing_bet_ev_changed')).toBe(0);
  });

  it('unset, false and a truthy non-boolean are byte-identical at every recorded node, with and without the package', () => {
    // The package holds horseActionTimeIsPublicOnly, whose think time is drawn from the timing stream
    // (horsePublicActionTime), not the seeded strategy stream: two identical decisions differ in thinkTime
    // alone. With the package the comparison is every byte but that number; without it, every byte.
    const timeless = (bytes: string[]): string[] =>
      bytes.map((b) => b.replace(/"thinkTime":[0-9.]+/g, '"thinkTime":0'));
    for (const r of RECORDED_FLOP_FACING_BETS)
      for (const [base, same] of [
        [{}, (b: string[]) => b],
        [PACKAGE, timeless],
      ] as const) {
        const unset = play(r, base);
        expect(same(play(r, { ...base, omahaFlopFacingBetEv: false }).bytes)).toEqual(
          same(unset.bytes)
        );
        expect(
          same(play(r, { ...base, omahaFlopFacingBetEv: 'yes' as unknown as boolean }).bytes)
        ).toEqual(same(unset.bytes));
        expect(
          same(play(r, { ...base, omahaFlopFacingBetEv: 1 as unknown as boolean }).bytes)
        ).toEqual(same(unset.bytes));
        for (const f of unset.fires.flat())
          expect(f.startsWith('omaha_flop_facing_bet_ev')).toBe(false);
      }
  });

  it('the decision is the same on every seed and every repeat: the sample is seeded by the cards', () => {
    for (const r of [rec(59790514), rec(59870825), rec(59869211)]) {
      const first = play(r, ON);
      const again = play(r, ON);
      expect(again.bytes).toEqual(first.bytes);
      expect(new Set(first.actions).size).toBe(1);
    }
  });

  it('the worker receipt validator admits every decision with the option on, through the policy graph', () => {
    let graphs = 0;
    for (const r of RECORDED_FLOP_FACING_BETS)
      for (const base of [{}, PACKAGE]) {
        const on = play(r, { ...base, ...ON });
        expect(
          on.refusals.every((x) => x === null),
          `hand ${r.n}`
        ).toBe(true);
        HorseMind.reset();
        seedFastRandom(3);
        const st = at(r);
        const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
          observeMind: false,
          ...base,
          ...ON,
        } as never);
        if (d.policyGraph !== undefined) graphs++;
      }
    // the decisions were signed by the graph: the validator had something to refuse
    expect(graphs).toBeGreaterThan(0);
  });
});

// ───────────────────────────── precedence ─────────────────────────────

describe('precedence on the flop: which rule decides, option off and on', () => {
  it('the paired-board fold: off, a call of a quarter of the stack below a full house folds whatever the hand; on, the verdict decides', () => {
    // 59840990 on Kh Kd 6s facing 32 into 63 with 120 behind (the call is over a quarter of the stack)
    const r = rec(59840990);
    const quarter: FlopEdit = { stacks: { 6: 120 } };
    for (const [hole, verdict] of [
      ['AhKc4d2h3h', 'call'], // trip kings, ace kicker
      ['AhAc4d2h3h', 'call'], // aces
      ['QhJc4d2h3h', 'fold'], // nothing
    ] as const) {
      const edit = { ...quarter, hole };
      for (const base of [{}, PACKAGE]) {
        const off = play(r, base, edit);
        const on = play(r, { ...base, ...ON }, edit);
        expect(all(off, 'fold'), `${hole} off`).toBe(true);
        expect(all(on, verdict), `${hole} on`).toBe(true);
        expect(verdictOf(r, null, edit).v.call).toBe(verdict === 'call');
        expect(fired(on, `omaha_flop_facing_bet_ev_${verdict}`), `${hole}`).toBe(SEEDS.length);
        expect(
          on.refusals.every((x) => x === null),
          `${hole} receipts`
        ).toBe(true);
      }
    }
    // off, the decider of the two made hands is the paired-board fold (its receipt); on, the same receipt
    // still records the legacy branch, and the verdict's change is counted beside it
    const trips = { ...quarter, hole: 'AhKc4d2h3h' };
    const off = play(r, {}, trips);
    const on = play(r, ON, trips);
    expect(fired(off, 'plo_paired_board_fold')).toBe(SEEDS.length);
    expect(fired(on, 'plo_paired_board_fold')).toBe(SEEDS.length);
    expect(fired(on, 'omaha_flop_facing_bet_ev_changed')).toBe(SEEDS.length);
    // the hand with nothing was folded by the brain itself, not by the paired-board rule
    const air = play(r, {}, { ...quarter, hole: 'QhJc4d2h3h' });
    expect(fired(air, 'plo_paired_board_fold')).toBe(0);
  });

  it('the paired-board fold keeps deciding where the verdict does not cover: a tournament, a bomb pot, PLO6', () => {
    const r = rec(59840990);
    const trips: FlopEdit = { stacks: { 6: 120 }, hole: 'AhKc4d2h3h' };
    for (const outside of [
      { bombPot: true },
      { variant: 'plo6', hole: 'AhKc4d2h3h9s' },
    ] as FlopEdit[]) {
      const edit = { ...trips, ...outside };
      const off = play(r, {}, edit);
      const on = play(r, ON, edit);
      expect(on.bytes).toEqual(off.bytes);
      expect(
        fired(on, 'omaha_flop_facing_bet_ev_call') + fired(on, 'omaha_flop_facing_bet_ev_fold')
      ).toBe(0);
    }
  });

  it('the 20 big blind mark: a bet over 20 big blinds is read as a big bet with the option off and on; on, the fold it led to is re-priced', () => {
    // 59811519: 144 chips (72 big blinds), half the pot, aces. The range read counts the mark both ways.
    const r = rec(59811519);
    const off = play(r, PACKAGE);
    const on = play(r, { ...PACKAGE, ...ON });
    expect(fired(off, 'range_read_big_bet_counted')).toBe(SEEDS.length);
    expect(fired(on, 'range_read_big_bet_counted')).toBe(SEEDS.length);
    expect(all(off, 'fold')).toBe(true);
    expect(all(on, 'call')).toBe(true);
    // the verdict does not read the mark: the same hand, pot share and stacks in big blinds at a tenth of
    // the chips (a 7.2 big blind bet at 2/4... the mark not reached) is the same call
    expect(verdictOf(r, null, { scale: 0.1 }).v.call).toBe(true);
    expect(verdictOf(r).spot.bucket).toBe('mid');
  });

  it('a raise the brain chose is left exactly as it is, and the option never makes a bet or a raise', () => {
    // kings full on K K 6: today's brain raises or calls; nothing changes with the option on
    const r = rec(59840990);
    const boat: FlopEdit = { stacks: { 6: 120 }, hole: 'AhKc6d2h3h' };
    const off = play(r, {}, boat);
    const on = play(r, ON, boat);
    expect(on.actions).toEqual(off.actions);
    expect(off.actions.some((a) => a === 'raise' || a === 'all_in')).toBe(true);
    off.actions.forEach((a, i) => {
      if (a === 'raise' || a === 'all_in') expect(on.bytes[i]).toBe(off.bytes[i]);
    });
    for (const rr of RECORDED_FLOP_FACING_BETS) {
      const a = play(rr, PACKAGE);
      const b = play(rr, { ...PACKAGE, ...ON });
      b.actions.forEach((x, i) => {
        if (x === 'raise' || x === 'bet' || x === 'all_in') expect(a.actions[i]).toBe(x);
      });
    }
  });

  it('it stands aside for the bare-overpair continuation, which keeps its own priced verdict', () => {
    // 59830767: the preflop raiser checked bare kings on 4d 2c 4s and faces a bet heads-up: a real
    // node of the continuation (no stand-in for its spot).
    const r = rec(59830767);
    const st = at(r);
    expect(omahaBareOverpairFlopFacingBetSpot(st.hero, st.gs as never)).not.toBeNull();
    expect(omahaFlopFacingBetEvSpot(st.hero, st.gs as never)).not.toBeNull();
    const ctx = { mind: false, telemetry: false, rake: 0, inPosition: false };
    expect(
      omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, {
        ...ctx,
        bareOverpairContinuation: true,
      })
    ).toBeNull();
    expect(
      omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, {
        ...ctx,
        bareOverpairContinuation: false,
      })
    ).not.toBeNull();
    // through HorseLogic.decide: with the continuation on, the flop verdict never answers there and
    // the decision is the continuation's own, byte for byte; with it off, the verdict answers
    const CONT: HorseDecideOpts = { omahaBareOverpairOopFlopCheck: true };
    const owned = play(r, { ...CONT, ...ON });
    const alone = play(r, CONT);
    expect(owned.bytes).toEqual(alone.bytes);
    expect(
      fired(owned, 'omaha_flop_facing_bet_ev_call') + fired(owned, 'omaha_flop_facing_bet_ev_fold')
    ).toBe(0);
    const free = play(r, ON);
    expect(
      fired(free, 'omaha_flop_facing_bet_ev_call') + fired(free, 'omaha_flop_facing_bet_ev_fold')
    ).toBe(SEEDS.length);
  });
});

// ───────────────────── realization measured by class and position ─────────────────────

describe('the realization factor is corrected by what flop calls returned in production, by hand class and position', () => {
  const FLAT = (ratio: number, n: number): OmahaFlopRealizationFit => ({
    made: { ip: { ratio, n }, oop: { ratio, n } },
    draw: { ip: { ratio, n }, oop: { ratio, n } },
    pair: { ip: { ratio, n }, oop: { ratio, n } },
  });

  it('names the class of a flop hand: two pair or better, a draw, one pair or less', () => {
    const k = (h: string, b: string) => omahaFlopHandClass(flopCardsOf(h), flopCardsOf(b));
    expect(k('3d2c7c7d6c', '7h9hJd')).toBe('made'); // bottom set
    expect(k('7sAc6s4sQc', 'JdQs6c')).toBe('made'); // two pair
    expect(k('3h7h6d4c2c', '5h4s8c')).toBe('made'); // the nut straight
    expect(k('AsKsQdJd', 'Ts7s2c')).toBe('draw'); // the nut flush draw
    expect(k('KhTh9d8d2c', 'JdQs6c')).toBe('draw'); // a wrap
    expect(k('2hAhAd4s8s', 'Jh5c4d')).toBe('pair'); // aces, no draw
    expect(k('Ah3d4c7s8h', 'JdQs6c')).toBe('pair'); // ace high
  });

  it('a cell with no calls leaves the model alone; with many it moves to its measurement; in between, continuously', () => {
    const model = 0.8;
    const at0 = omahaFlopFittedRealization(model, 'pair', true, 1, FLAT(0.5, 0));
    expect(at0.multiplier).toBe(1);
    expect(at0.realization).toBe(model);
    const K = OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS;
    const half = omahaFlopFittedRealization(model, 'pair', true, 1, FLAT(0.5, K));
    expect(half.weight).toBeCloseTo(0.5, 12);
    expect(half.multiplier).toBeCloseTo(0.75, 12);
    expect(half.realization).toBeCloseTo(0.6, 12);
    const many = omahaFlopFittedRealization(model, 'pair', true, 1, FLAT(0.5, K * 1000));
    expect(many.realization).toBeCloseTo(0.4, 2);
    let last = model;
    for (const n of [1, 5, 25, 100, 400, 1600, 6400]) {
      const x = omahaFlopFittedRealization(model, 'pair', true, 1, FLAT(0.5, n)).realization;
      expect(x).toBeLessThan(last);
      expect(last - x).toBeLessThan(0.2); // no jump at any sample size
      last = x;
    }
    // bounds: never under 0, never over the ceiling
    expect(omahaFlopFittedRealization(1, 'made', true, 1, FLAT(9, 1e9)).realization).toBe(
      OMAHA_FLOP_EV_REALIZATION_CEILING
    );
    expect(omahaFlopFittedRealization(0.5, 'draw', false, 1, FLAT(-9, 1e9)).realization).toBe(0);
    // nothing in it is a bet size or a stack share: its inputs are the model's factor, the class,
    // the position and the share of the later streets left to play
    expect(omahaFlopFittedRealization(model, 'pair', true, 0, FLAT(0.5, K)).realization).toBe(1);
  });

  it('the fitted cells are the measured ones, each with its sample, and the weak-pair cells sit under the made-hand cells', () => {
    const fit = OMAHA_FLOP_EV_REALIZATION_FIT;
    let calls = 0;
    for (const klass of ['made', 'draw', 'pair'] as const)
      for (const pos of ['ip', 'oop'] as const) {
        expect(fit[klass][pos].n).toBeGreaterThanOrEqual(100);
        expect(Number.isFinite(fit[klass][pos].ratio)).toBe(true);
        calls += fit[klass][pos].n;
      }
    expect(calls).toBe(4059); // every Horse flop call of the shared realization table (CONSTANTS file)
    const used = (klass: 'made' | 'draw' | 'pair', ip: boolean) =>
      omahaFlopFittedRealization(0.8, klass, ip, 1).realization;
    expect(used('pair', true)).toBeLessThan(used('made', true));
    expect(used('pair', false)).toBeLessThan(used('made', false));
    expect(used('pair', true)).toBeLessThan(0.8); // one pair in position returned less than the model said
  });

  it('the verdict applies it: the same hand and spot with a lower measured cell is worth less', () => {
    const r = rec(59811519); // aces, no draw, heads-up
    const st = at(r);
    const spot = omahaFlopFacingBetEvSpot(st.hero, st.gs as never)!;
    const withFit = (fit: OmahaFlopRealizationFit) =>
      omahaFlopFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null, {
        rake: 0,
        inPosition: true,
        fit,
      })!;
    const neutral = withFit(FLAT(1, 0));
    const low = withFit(FLAT(0.4, 5000));
    expect(neutral.klass).toBe('pair');
    expect(neutral.fitMultiplier).toBe(1);
    expect(neutral.realization).toBeCloseTo(1 + (neutral.modelRealization - 1) * spot.later, 12);
    expect(low.modelRealization).toBe(neutral.modelRealization);
    expect(low.fitMultiplier).toBeLessThan(0.45);
    expect(low.ev).toBeLessThan(neutral.ev);
  });
});

// ───────────────────── the five folds of sets and nut straights (RC-02a) ─────────────────────

describe('the five flop folds of sets and nut straights the 48-hour audit named (RC-02a): four are called, one is a priced thin spot', () => {
  const five = RECORDED_FLOP_FACING_BETS.filter((r) => r.group === 'rc02a');
  const IN_POSITION = new Set([59727433]);

  it('are the five hands, each with a caller in or players still to act', () => {
    expect(five.map((r) => r.n).sort()).toEqual([59710501, 59727433, 59756252, 59806482, 59842423]);
    for (const r of five) {
      const { spot } = verdictOf(r);
      expect(spot.callers + spot.behind, `hand ${r.n}`).toBeGreaterThanOrEqual(2);
    }
  });

  // 59710501 is the one of the five the verdict does not call. Bottom set of sevens on 7h 9h Jd,
  // out of position, 36 to call into 119 with a caller in and a player behind: counted together
  // with them its share of the pot is at the price (0.23; an independent count of the same ranges
  // gives 0.28), and two pair or better called out of position by Horses realized 0.81 of its
  // exact equity in production (the shared realization table; OMAHA_FLOP_EV_REALIZATION_FIT.made.oop).
  // It is a priced fold about a tenth of the pot under its margin: stated here, not forced to a call.
  const THIN = 59710501;

  it('the verdict calls the top set, the bottom set in position and both nut straights', () => {
    for (const r of five.filter((x) => x.n !== THIN)) {
      const { spot, v } = verdictOf(r, null, {}, IN_POSITION.has(r.n));
      expect(v.klass, `hand ${r.n}`).toBe('made');
      expect(v.call, `hand ${r.n}`).toBe(true);
      expect(v.ev, `hand ${r.n}`).toBeGreaterThan(2 * v.margin);
      expect(v.price, `hand ${r.n}`).toBeLessThan(0.35);
      expect(spot.final).toBe(false);
    }
    // top set of nines on 6c 9s 8c with two players behind: the hand the field tax folded
    const top = verdictOf(rec(59842423));
    expect(top.v.call).toBe(true);
    expect(top.v.potShare).toBeGreaterThan(top.v.price + 0.1);
  });

  it('the bottom set with a caller in and a player behind is priced, not folded by a rule: its share is at the price and its EV about a tenth of the pot under the margin', () => {
    const r = rec(THIN);
    const { spot, v } = verdictOf(r);
    expect([spot.callers, spot.behind]).toEqual([1, 1]);
    expect(v.klass).toBe('made');
    expect(Math.abs(v.potShare - v.price)).toBeLessThan(0.06);
    expect(v.call).toBe(false);
    const short = (v.ev - v.margin) / (spot.winnable + spot.paid);
    expect(short).toBeLessThan(0);
    expect(short).toBeGreaterThan(-0.15);
    // nothing but the price decides: the same hand and field at half the bet is a call
    const cheaper = {
      ...r,
      a: r.a.replace('3|f|bet|36|', '3|f|bet|18|').replace('5|f|call|36|', '5|f|call|18|'),
      pot: 83,
      bet: 18,
      cur: 18,
      min: 36,
      max: 119,
      seats: r.seats.map((s) =>
        s[2] === 36 ? [s[0], s[1] + 18, 18, s[3] - 18, s[4], s[5], s[6]] : s
      ),
    };
    const half = verdictOf(cheaper);
    expect(half.spot.paid).toBe(18);
    expect(half.spot.potFrac).toBeLessThan(spot.potFrac);
    expect(half.v.ev - half.v.margin).toBeGreaterThan(v.ev - v.margin);
    // and with nobody behind and position it is worth more than as recorded
    const noneBehind = {
      ...r,
      a: `${r.a};2|f|fold|0|h|0|0`,
      seats: r.seats.map((s) => (s[0] === 2 ? [...s.slice(0, 6), 1] : s)),
    };
    const better = verdictOf(noneBehind, null, {}, true);
    expect(better.spot.behind).toBe(0);
    expect(better.v.ev).toBeGreaterThan(v.ev);
  });

  it('through HorseLogic.decide with the production option list: no fold on any seed, the verdict answers and the receipt is admitted', () => {
    for (const r of five.filter((x) => x.n !== THIN)) {
      const on = play(r, { ...PACKAGE, ...ON });
      expect(
        on.actions.every((a) => a !== 'fold'),
        `hand ${r.n}: ${on.actions.join(',')}`
      ).toBe(true);
      expect(
        on.refusals.every((x) => x === null),
        `hand ${r.n} receipts`
      ).toBe(true);
      // every seed that ended in a call was answered by the verdict
      on.actions.forEach((a, i) => {
        if (a === 'call')
          expect(on.fires[i].includes('omaha_flop_facing_bet_ev_call'), `hand ${r.n}`).toBe(true);
      });
    }
    // the top set is not folded on any seed
    const top = play(rec(59842423), { ...PACKAGE, ...ON });
    expect(all(top, 'call', 'raise')).toBe(true);
    expect(fired(top, 'omaha_flop_facing_bet_ev_fold')).toBe(0);
  });

  it('a caller node, a PLO4 node and a whole-stack call go through HorseLogic.decide and the receipt validator', () => {
    // a caller already in: 59710501 (above) answered by the verdict on every seed
    const caller = play(rec(59710501), ON);
    expect(verdictOf(rec(59710501)).spot.callers).toBe(1);
    expect(
      fired(caller, 'omaha_flop_facing_bet_ev_call') +
        fired(caller, 'omaha_flop_facing_bet_ev_fold')
    ).toBe(SEEDS.length);
    expect(caller.refusals.every((x) => x === null)).toBe(true);
    // PLO4: the same recorded spot with four cards (top and bottom pair), option off and on
    const four: FlopEdit = { variant: 'plo4', hole: '7sAc6sQc' };
    const r = rec(59790514);
    const v4 = verdictOf(r, null, four).v;
    for (const base of [{}, PACKAGE]) {
      const off = play(r, base, four);
      const on = play(r, { ...base, ...ON }, four);
      expect(
        fired(off, 'omaha_flop_facing_bet_ev_call') + fired(off, 'omaha_flop_facing_bet_ev_fold')
      ).toBe(0);
      expect(fired(on, `omaha_flop_facing_bet_ev_${v4.call ? 'call' : 'fold'}`)).toBe(SEEDS.length);
      expect(
        on.actions.every((a) =>
          v4.call ? a !== 'fold' : a === 'fold' || a === 'raise' || a === 'all_in'
        )
      ).toBe(true);
      expect(on.refusals.every((x) => x === null)).toBe(true);
    }
    // the whole stack: the call is an all-in, admitted by the validator
    const shove: FlopEdit = { stacks: { 2: 30 } };
    expect(verdictOf(r, null, shove).spot.allIn).toBe(true);
    expect(verdictOf(r, null, shove).v.call).toBe(true);
    for (const base of [{}, PACKAGE]) {
      const on = play(r, { ...base, ...ON }, shove);
      expect(all(on, 'all_in'), on.actions.join(',')).toBe(true);
      expect(fired(on, 'omaha_flop_facing_bet_ev_call')).toBe(SEEDS.length);
      expect(on.refusals.every((x) => x === null)).toBe(true);
    }
  });
});
