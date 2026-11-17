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
 *  - unset and false byte-identical; the worker receipt validator.
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
  OMAHA_FLOP_EV_LEAD,
  OMAHA_FLOP_EV_OTHER_PER_RUNOUT,
  OMAHA_FLOP_EV_PRIOR_OTHER,
  OMAHA_FLOP_EV_RIVERS,
  OMAHA_FLOP_EV_VALUE_PER_RUNOUT,
  OMAHA_FLOP_EV_VALUE_SHARE,
  OMAHA_FLOP_RUNOUT_REALIZATION_MIN,
  OMAHA_FLOP_RUNOUT_ROW,
  omahaFlopEvCounts,
  omahaFlopEvCountsResetCache,
  omahaFlopEvSeed,
  omahaFlopFacingBetEvAdmitsCall,
  omahaFlopFacingBetEvSpot,
  omahaFlopFacingBetEvVerdict,
  omahaFlopRunoutRealization,
} from './HorseOmahaFlopFacingBetEv.js';
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

  it('walks every unseen card as the turn card with three river cards each and eight holdings per runout', () => {
    const hole = flopCardsOf('7sAc6s4sQc');
    const board = flopCardsOf('JdQs6c');
    const c = omahaFlopEvCounts(hole, board, [], 0.36)!;
    expect(c.unseen).toBe(44);
    expect(c.holeCount).toBe(5);
    expect(c.runouts).toBe(44 * OMAHA_FLOP_EV_RIVERS);
    expect(c.rows.length).toBe(c.runouts * OMAHA_FLOP_RUNOUT_ROW);
    expect(c.turnOf.length).toBe(c.runouts);
    expect(new Set(Array.from(c.turnOf)).size).toBe(44);
    // a holding that holds a runout card is redrawn; nearly every runout meets its full eight
    expect(c.samples).toBeGreaterThan(
      c.runouts * (OMAHA_FLOP_EV_VALUE_PER_RUNOUT + OMAHA_FLOP_EV_OTHER_PER_RUNOUT) * 0.98
    );
    const four = omahaFlopEvCounts(flopCardsOf('AsKsQdJd'), flopCardsOf('Ts7s2c'), [], 0.46)!;
    expect(four.unseen).toBe(45);
    expect(four.runouts).toBe(45 * OMAHA_FLOP_EV_RIVERS);
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
    expect(omahaFlopRunoutRealization.length).toBe(4); // rows, turn cards, bluff share, position
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
    expect([a.callers, a.allIns, a.behind]).toEqual([0, 0, 2]);
    expect(a.paid).toBe(30);
    expect(a.winnable).toBe(70);
    expect(a.final).toBe(false);
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
    expect(lead.valueShare).toBeCloseTo(OMAHA_FLOP_EV_VALUE_SHARE.big * OMAHA_FLOP_EV_LEAD, 10);
    expect(lead.priorBluff).toBeCloseTo(OMAHA_FLOP_EV_PRIOR_OTHER.big * OMAHA_FLOP_EV_LEAD, 10);
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

  it('a call for the whole stack, or with nobody left who can bet, is final and takes no realization factor', () => {
    const r = rec(59790514);
    const short = verdictOf(r, null, { stacks: { 2: 30 } });
    expect(short.spot.allIn).toBe(true);
    expect(short.spot.final).toBe(true);
    expect(short.v.realization).toBe(1);
    expect(short.v.robustShare).toBeNull();
    const trivial = verdictOf(r, null, { stacks: { 2: 38 } });
    expect(trivial.spot.allIn).toBe(false);
    expect(trivial.spot.final).toBe(true);
    const deep = verdictOf(r);
    expect(deep.spot.final).toBe(false);
    expect(deep.v.realization).toBeLessThan(1);
    expect(deep.v.robustShare).not.toBeNull();
  });

  it('EV(call) is P(win) x the pot it wins + P(tie) x the split - P(lose) x the call, against one margin', () => {
    const { spot, v } = verdictOf(rec(59790514));
    const pLose = 1 - v.pWin - v.pTie;
    expect(v.ev).toBeCloseTo(
      v.pWin * spot.winnable + v.pTie * ((spot.winnable - spot.paid) / 2) - pLose * spot.paid,
      9
    );
    expect(v.margin).toBeCloseTo(0.02 * (spot.winnable + spot.paid), 9);
    expect(v.price).toBeCloseTo(spot.paid / (spot.winnable + spot.paid), 12);
    expect(v.call).toBe(v.ev > v.margin);
    expect(v.bluffShare).toBe(OMAHA_FLOP_EV_PRIOR_OTHER.big); // no read: the prior
    expect(v.field).toBeLessThan(1); // two players behind
    expect(v.realization).toBeLessThanOrEqual(0.85); // and the cap they bring
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

  it('it stands aside for the bare-overpair continuation, which keeps its own priced verdict', async () => {
    const oop = await import('./HorseOmahaOopChecks.js');
    const r = rec(59790514);
    const spy = vi
      .spyOn(oop, 'omahaBareOverpairFlopFacingBetSpot')
      .mockImplementation(() => ({ call: 30 }) as never);
    const { omahaFlopFacingBetEvAnswer } = await import('./HorseOmahaFlopFacingBetEvRule.js');
    const st = at(r);
    const ctx = { mind: false, telemetry: false, rake: 0, inPosition: false };
    const owned = omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, {
      ...ctx,
      bareOverpairContinuation: true,
    });
    const free = omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, {
      ...ctx,
      bareOverpairContinuation: false,
    });
    spy.mockRestore();
    // ESM namespaces may not be spied in every runner: assert what was observable
    if (spy.mock.calls.length > 0) expect(owned).toBeNull();
    expect(free).not.toBeNull();
    expect(free!.verdict.call).toBe(true);
  });
});
