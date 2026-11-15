/**
 * OMAHA BIG-DRAW AGGRESSION (2026-11-15; option omahaBigDrawAggression,
 * default OFF): the draw classes and their exclusions, the expected-value
 * verdict, and the option in the decision.
 *
 *  - the classes: the nut flush draw with a wrap, a straight draw or a pair,
 *    a 13+ out wrap with nine nut outs, a pair or a flush draw with nine nut
 *    straight outs; a bare gutshot, a flush draw below the nuts, a low flush
 *    draw on a paired board, a bare nut flush draw and a made hand are none;
 *  - the verdict: the wager only when its expected value is the higher one;
 *    a measured station without the equity, three or more opponents, and two
 *    opponents without the nut end keep the passive line;
 *  - owner 2026-11-15 12:30: no draw raise and no new draw lead out of
 *    position; in position a raise only with a combo draw, never a bare flush
 *    draw; omahaNoDrawRaiseOutOfPosition applies the same bar to the brain's
 *    existing draw raises; a made hand with a draw is untouched;
 *  - the option: unset and false decide byte-identically; on, three recorded
 *    passive decisions of the 2026-11-15 sweep, the Horse placed in position, bet
 *    or raise the pot (as recorded, out of position, they stay); a recorded
 *    three-way wrap short of the nut end and a made top set are unchanged; the
 *    rule draws nothing from the brain's random stream; the changed decision
 *    is admitted by the worker receipt validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET,
  omahaBigDraw,
  omahaBigDrawVerdict,
  omahaDrawRaiseBar,
  omahaDrawRaiseBarOf,
  omahaHeroInPosition,
  type OmahaBigDrawInput,
} from './HorseOmahaBigDrawAggression.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import TOP_PAIR_NFD from './HorseOmahaBigDrawAggression.plo4-top-pair-nut-flush-draw-checks-the-flop.fixture.json';
import FD_NUT_WRAP from './HorseOmahaBigDrawAggression.plo4-flush-draw-nut-wrap-checks-and-calls-the-flop.fixture.json';
import NUT_WRAP from './HorseOmahaBigDrawAggression.plo5-thirteen-out-nut-wrap-checks-and-calls-the-flop.fixture.json';
import THREE_WAY from './HorseOmahaBigDrawAggression.plo5-wrap-short-of-the-nut-end-checks-three-way.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]!]! }));

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

// ─── the classes ────────────────────────────────────────────────────────────

describe('omahaBigDraw: the classes, outs counted with the two-card rule', () => {
  it('the nut flush draw with a wrap', () => {
    const d = omahaBigDraw(cards('AhJh9s7c'), cards('Th8h2c'));
    expect(d?.cls).toBe('nfd_wrap');
    expect(d!.nutFlushOuts).toBeGreaterThanOrEqual(7);
    expect(d!.straightOuts).toBeGreaterThanOrEqual(9);
  });
  it('the nut flush draw with top pair', () => {
    expect(omahaBigDraw(cards('AhKd7h3c'), cards('Kh8h2c'))?.cls).toBe('nfd_pair');
  });
  it('a thirteen-out wrap to the nuts on a rainbow flop', () => {
    const d = omahaBigDraw(cards('QsJdTc2h'), cards('9h8d3s'));
    expect(d?.cls).toBe('nut_wrap');
    expect(d!.straightOuts).toBeGreaterThanOrEqual(13);
    expect(d!.nutStraightOuts).toBeGreaterThanOrEqual(9);
    expect(d!.nutEnd).toBe(true);
  });
  it('none: a bare gutshot, a bare open-ender, a bare nut flush draw', () => {
    expect(omahaBigDraw(cards('KsQd4c2h'), cards('Jh9d3s'))).toBeNull();
    expect(omahaBigDraw(cards('JsTd4c2h'), cards('9h8d3s'))).toBeNull();
    expect(omahaBigDraw(cards('Ah6h4c2d'), cards('Kh9h3s'))).toBeNull();
  });
  it('none: a flush draw below the nuts, with or without a pair', () => {
    expect(omahaBigDraw(cards('9h6h4c2d'), cards('Kh8h3s'))).toBeNull();
    expect(omahaBigDraw(cards('Kd9h6h2d'), cards('Kh8h3s'))).toBeNull();
  });
  it('none: any draw on a paired board, the nut flush draw with a wrap included', () => {
    expect(omahaBigDraw(cards('7h6h4c2d'), cards('KhKd8h'))).toBeNull();
    expect(omahaBigDraw(cards('AhJh9s7c'), cards('Th8hTc'))).toBeNull();
  });
  it('none: a made hand (a set, a straight), whatever it draws to', () => {
    expect(omahaBigDraw(cards('AhKdKc3h'), cards('Kh8h2c'))).toBeNull();
    expect(omahaBigDraw(cards('AhJh9s7c'), cards('Th8h6c'))).toBeNull();
  });
  it('none on the river and before the flop', () => {
    expect(omahaBigDraw(cards('AhJh9s7c'), cards('Th8h2c3d4s'))).toBeNull();
    expect(omahaBigDraw(cards('AhJh9s7c'), [])).toBeNull();
  });
});

// ─── the verdict ────────────────────────────────────────────────────────────

const spot = (over: Partial<OmahaBigDrawInput> = {}): OmahaBigDrawInput => ({
  variant: 'plo4',
  street: 'flop',
  hole: cards('AhJh9s7c'),
  board: cards('Th8h2c'),
  action: 'check',
  pot: 20,
  toCall: 0,
  stack: 200,
  heroBet: 0,
  currentBet: 0,
  minRaiseTo: 2,
  maxRaiseTo: 20,
  legalActions: ['fold', 'check', 'bet', 'all_in'],
  opponents: [{ stack: 200, bet: 0, allIn: false, foldToBet: null }],
  inPosition: true,
  hiLo: false,
  multiBoard: false,
  bombPot: false,
  tournament: false,
  allInOrFold: false,
  wagersCapped: false,
  ...over,
});
const facing = (over: Partial<OmahaBigDrawInput> = {}): OmahaBigDrawInput =>
  spot({
    action: 'call',
    pot: 30,
    toCall: 10,
    currentBet: 10,
    minRaiseTo: 20,
    maxRaiseTo: 50,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    opponents: [{ stack: 190, bet: 10, allIn: false, foldToBet: null }],
    ...over,
  });

describe('omahaBigDrawVerdict: the wager only when its expected value is the higher one', () => {
  it('checked to, an unknown opponent: the pot is bet', () => {
    const v = omahaBigDrawVerdict(spot())!;
    expect(v.wager).toEqual({ action: 'bet', amount: 20 });
    expect(v.foldEquity).toBeCloseTo(OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET, 6);
    expect(v.evAggressive).toBeGreaterThan(v.evPassive);
  });
  it('facing a bet: the pot is raised', () => {
    const v = omahaBigDrawVerdict(facing())!;
    expect(v.wager).toEqual({ action: 'raise', amount: 50 });
  });
  it('a pot wager that leaves a later street all in anyway is the stack', () => {
    const v = omahaBigDrawVerdict(
      spot({ stack: 45, opponents: [{ stack: 45, bet: 0, allIn: false, foldToBet: null }] })
    )!;
    expect(v.wager).toEqual({ action: 'all_in' });
  });
  it('a measured station and equity under the price of getting it in: passive', () => {
    // The pair with the nut flush draw on the turn: 7 nut outs, one card to come.
    const base = {
      street: 'turn',
      hole: cards('AhKd7h3c'),
      board: cards('Kh8h2c5d'),
    } as const;
    const station = omahaBigDrawVerdict(
      spot({ ...base, opponents: [{ stack: 200, bet: 0, allIn: false, foldToBet: 0.05 }] })
    )!;
    expect(station.wager).toBeNull();
    expect(station.withheld).toBe('passive_ev');
    // The same hand against a player who folds: the wager.
    const folder = omahaBigDrawVerdict(
      spot({ ...base, opponents: [{ stack: 200, bet: 0, allIn: false, foldToBet: 0.9 }] })
    )!;
    expect(folder.wager?.action).toBe('bet');
  });
  it('three or more opponents: passive', () => {
    const opp = { stack: 200, bet: 0, allIn: false, foldToBet: 0.6 };
    const v = omahaBigDrawVerdict(spot({ opponents: [opp, opp, opp] }))!;
    expect(v.wager).toBeNull();
    expect(v.withheld).toBe('multiway');
  });
  it('two opponents: only the nut end of the draw wagers', () => {
    const opp = { stack: 200, bet: 0, allIn: false, foldToBet: 0.6 };
    // 13 nut outs of 13: the nut end.
    const nutEnd = omahaBigDrawVerdict(
      spot({ hole: cards('QsJdTc2h'), board: cards('9h8d3s'), opponents: [opp, opp] })
    )!;
    expect(nutEnd.draw.nutEnd).toBe(true);
    expect(nutEnd.withheld).not.toBe('not_nut_end');
    // A 17-out wrap with six outs below the nuts (11 of 17) is not the nut end.
    const dirty = omahaBigDrawVerdict(
      spot({ hole: cards('JsTd7c2h'), board: cards('9h8d3s'), opponents: [opp, opp] })
    )!;
    expect(dirty.draw.cls).toBe('nut_wrap');
    expect(dirty.draw.nutEnd).toBe(false);
    expect(dirty.wager).toBeNull();
    expect(dirty.withheld).toBe('not_nut_end');
    // Heads-up the same wrap is priced.
    expect(
      omahaBigDrawVerdict(spot({ hole: cards('JsTd7c2h'), board: cards('9h8d3s') }))!.withheld
    ).not.toBe('not_nut_end');
  });
  it('a raise of its own bet, an all-in opponent, the river, hi-lo and tournaments are outside', () => {
    expect(omahaBigDrawVerdict(facing({ heroBet: 4 }))?.withheld).toBe('reraise');
    expect(
      omahaBigDrawVerdict(
        facing({ opponents: [{ stack: 0, bet: 10, allIn: true, foldToBet: null }] })
      )
    ).toBeNull();
    expect(omahaBigDrawVerdict(spot({ street: 'river' }))).toBeNull();
    expect(omahaBigDrawVerdict(spot({ hiLo: true }))).toBeNull();
    expect(omahaBigDrawVerdict(spot({ tournament: true }))).toBeNull();
    expect(omahaBigDrawVerdict(spot({ variant: 'plo6' }))).toBeNull();
    expect(omahaBigDrawVerdict(spot({ action: 'bet' }))).toBeNull();
    expect(omahaBigDrawVerdict(spot({ action: 'fold' }))).toBeNull();
  });
  it('owner 2026-11-15 12:30: out of position no raise and no new lead; in position a raise only with a combo draw', () => {
    expect(omahaBigDrawVerdict(facing({ inPosition: false }))!.withheld).toBe('out_of_position');
    expect(omahaBigDrawVerdict(spot({ inPosition: false }))!.withheld).toBe('out_of_position');
    // a 13-out nut wrap with no pair and no flush draw is not a combo draw
    const wrap = { hole: cards('QsJdTc2h'), board: cards('9h8d3s') };
    expect(omahaBigDrawVerdict(facing(wrap))!.withheld).toBe('not_combo');
    expect(omahaBigDrawVerdict(spot(wrap))!.withheld).not.toBe('not_combo');
  });
  it('a weak or non-nut draw never becomes a wager', () => {
    for (const [hole, board] of [
      ['KsQd4c2h', 'Jh9d3s'],
      ['9h6h4c2d', 'Kh8h3s'],
      ['7h6h4c2d', 'KhKd8h'],
      ['Ah6h4c2d', 'Kh9h3s'],
    ] as const)
      expect(omahaBigDrawVerdict(spot({ hole: cards(hole), board: cards(board) }))).toBeNull();
  });
});

// ─── the bar on a draw raise (owner 2026-11-15 12:30) ───────────────────────

describe('omahaDrawRaiseBar: no draw raise out of position, no bare flush draw raise in position', () => {
  const bar = (hole: string, board: string, inPosition: boolean, over = {}) =>
    omahaDrawRaiseBar({
      variant: 'plo4',
      street: board.length === 6 ? 'flop' : 'turn',
      hole: cards(hole),
      board: cards(board),
      inPosition,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
      ...over,
    });
  it('out of position every draw is barred: combo, wrap, bare flush draw, pair with a draw', () => {
    for (const [hole, board] of [
      ['AhJh9s7c', 'Th8h2c'],
      ['QsJdTc2h', '9h8d3s'],
      ['Ah6h4c2d', 'Kh9h3s'],
      ['9h6h4c2d', 'Kh8h3s'],
      ['AhKd7h3c', 'Kh8h2c'],
    ] as const)
      expect(bar(hole, board, false)).toBe('out_of_position');
  });
  it('in position only a combo draw may raise; a bare flush draw and a bare wrap may not', () => {
    expect(bar('AhJh9s7c', 'Th8h2c', true)).toBeNull();
    expect(bar('AhKd7h3c', 'Kh8h2c', true)).toBeNull();
    // the audit's literal reading of the 12:30 ruling: a bare wrap is not a combo draw
    expect(bar('QsJdTc2h', '9h8d3s', true)).toBe('bare_straight_draw');
    expect(bar('Ah6h4c2d', 'Kh9h3s', true)).toBe('bare_flush_draw');
    expect(bar('9h6h4c2d', 'Kh8h3s', true)).toBe('bare_flush_draw');
  });
  it('a made hand with a draw is not a draw: two pair, a set, a straight are never barred', () => {
    expect(bar('AhKd8c3h', 'Kh8h2c', false)).toBeNull();
    expect(bar('AhKdKc3h', 'Kh8h2c', false)).toBeNull();
    expect(bar('AhJh9s7c', 'Th8h6c', false)).toBeNull();
  });
  it('no draw, the river, hi-lo, PLO6 and tournaments are outside', () => {
    expect(bar('KsQd4c2h', 'Jh9d3s', false)).toBeNull();
    expect(bar('AhJh9s7c', 'Th8h2c', false, { street: 'river' })).toBeNull();
    expect(bar('AhJh9s7c', 'Th8h2c', false, { hiLo: true })).toBeNull();
    expect(bar('AhJh9s7c', 'Th8h2c', false, { variant: 'plo6' })).toBeNull();
    expect(bar('AhJh9s7c', 'Th8h2c', false, { tournament: true })).toBeNull();
  });
  it('position: the live seat nearest before the button acts last', () => {
    expect(omahaHeroInPosition(3, 3, [1, 5])).toBe(true);
    expect(omahaHeroInPosition(1, 3, [3])).toBe(false);
    expect(omahaHeroInPosition(2, 3, [4, 6])).toBe(true);
    expect(omahaHeroInPosition(4, 3, [2])).toBe(false);
    expect(omahaHeroInPosition(4, undefined, [2])).toBe(false);
  });
});

// ─── the option in the decision: recorded hands of the 2026-11-15 sweep ─────

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 10 }, (_, i) => 5100 + i);
const ON: HorseDecideOpts = { omahaBigDrawAggression: true };
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
type Seat = 'ip' | 'oop';
/** The recorded node; `seat` moves the button so the Horse is in or out of position. */
const node = (fx: unknown, ord: number, hole?: Card[], seat?: Seat) => {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
  const st = stateAt(f, f.actions.find((a) => a.ord === ord)!);
  if (hole) st.hero.cards = hole;
  if (seat) {
    const opp = st.gs.players.find(
      (p) => p.seat !== st.hero.seat && !p.is_folded && !p.is_sitting_out
    )!;
    (st.gs as { dealerSeat?: number }).dealerSeat = seat === 'ip' ? st.hero.seat : opp.seat;
  }
  return st;
};
interface Outcome {
  bytes: string[];
  actions: string[];
  amounts: Array<number | undefined>;
  fires: string[][];
  next: number[];
  refusals: Array<string | null>;
  pot: number;
  max: number;
}
function play(
  fx: unknown,
  ord: number,
  opts: HorseDecideOpts,
  reads?: (userId: string) => OmahaReadConditional | null,
  hole?: Card[],
  seat?: Seat,
  seeds: number[] = SEEDS
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = {
    bytes: [],
    actions: [],
    amounts: [],
    fires: [],
    next: [],
    refusals: [],
    pot: 0,
    max: 0,
  };
  for (const s of seeds) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = node(fx, ord, hole, seat);
    out.pot = st.gs.pot;
    out.max = st.gs.maxRaiseTo as number;
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.amounts.push(d.amount);
    out.fires.push(drainFires().map((f) => f.feature));
    out.refusals.push(
      horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant), {
        player: st.hero,
        gameState: st.gs,
      })
    );
    vi.restoreAllMocks();
  }
  return out;
}
const bigDrawFires = (o: Outcome) =>
  o.fires.map((f) => f.filter((x) => x.startsWith('omaha_big_draw_aggression')));

/** [fixture, the recorded passive decision, what it was, what the option makes of it] */
const RECORDED: Array<[string, unknown, number, 'check' | 'call', 'bet' | 'raise']> = [
  ['PLO4 flush draw with a nut wrap, checked the flop', FD_NUT_WRAP, 8, 'check', 'bet'],
  ['PLO4 flush draw with a nut wrap, called the flop bet', FD_NUT_WRAP, 10, 'call', 'raise'],
  ['PLO5 thirteen-out nut wrap, checked the flop', NUT_WRAP, 10, 'check', 'bet'],
];

describe.each(RECORDED)(
  'recorded passive hand, the Horse in position: %s',
  (_name, fx, ord, recorded, wager) => {
    it('the recorded decision was the passive one', () => {
      const f = fx as ComplaintFixture;
      expect(f.actions.find((a) => a.ord === ord)!.action).toBe(recorded);
    });

    it("unset and false decide byte-identically, and today's brain takes the passive line", () => {
      const off = play(fx, ord, {});
      const no = play(fx, ord, {
        omahaBigDrawAggression: false,
        omahaNoDrawRaiseOutOfPosition: false,
      });
      expect(no.bytes).toEqual(off.bytes);
      expect(off.actions).toContain(recorded);
      expect(bigDrawFires(off).flat()).toEqual([]);
      // as recorded the Horse was out of position: the option adds nothing there
      if (!omahaDrawRaiseBarOf(node(fx, ord).hero, node(fx, ord).gs)) return;
      const on = play(fx, ord, ON);
      expect(on.actions).toEqual(off.actions);
      expect(on.amounts).toEqual(off.amounts);
    });

    it('on: every passive answer becomes the pot-sized wager, with its receipt', () => {
      const off = play(fx, ord, {}, undefined, undefined, 'ip');
      const on = play(fx, ord, ON, undefined, undefined, 'ip');
      for (let k = 0; k < SEEDS.length; k++) {
        if (off.actions[k] !== 'check' && off.actions[k] !== 'call') {
          // an answer that was already a wager is not touched
          expect(on.bytes[k]).toEqual(off.bytes[k]);
          continue;
        }
        expect(on.actions[k]).toBe(wager);
        expect(on.amounts[k]).toBe(on.max);
        expect(bigDrawFires(on)[k]).toEqual([`omaha_big_draw_aggression_${wager}`]);
        expect(on.refusals[k]).toBeNull();
      }
      expect(on.actions.filter((a) => a === wager).length).toBe(SEEDS.length);
      // the rule draws nothing from the brain's random stream
      expect(on.next).toEqual(off.next);
    });

    it('on, with the mind off: the population prior prices the same wager', () => {
      const on = play(fx, ord, { ...ON, mind: false }, undefined, undefined, 'ip');
      expect(on.actions).toContain(wager);
    });
  }
);

describe('the option keeps the passive line where the expected value says so', () => {
  it('recorded top pair with the nut flush draw: the check is worth more, in and out of position', () => {
    for (const seat of ['ip', 'oop'] as const) {
      const off = play(TOP_PAIR_NFD, 9, {}, undefined, undefined, seat);
      const on = play(TOP_PAIR_NFD, 9, ON, undefined, undefined, seat);
      expect(on.actions).toEqual(off.actions);
      expect(on.amounts).toEqual(off.amounts);
      // out of position the brain checks and the rule examines it; in position the brain bets itself
      if (seat === 'oop')
        expect(bigDrawFires(on).flat()).toContain('omaha_big_draw_aggression_withheld');
    }
  });

  it('a recorded three-way wrap short of the nut end stays passive', () => {
    const off = play(THREE_WAY, 11, {});
    const on = play(THREE_WAY, 11, ON);
    expect(off.actions).toContain('check');
    expect(on.actions).toEqual(off.actions);
    expect(on.amounts).toEqual(off.amounts);
    expect(new Set(bigDrawFires(on).flat())).toEqual(
      new Set(['omaha_big_draw_aggression_withheld'])
    );
  });

  it('a made top set in the same spot is decided exactly as today', () => {
    const st = node(NUT_WRAP, 10);
    const board = st.gs.communityCards;
    const top = [...board].sort(
      (a, b) => '23456789TJQKA'.indexOf(b.rank) - '23456789TJQKA'.indexOf(a.rank)
    )[0]!;
    const free = (['clubs', 'diamonds', 'hearts', 'spades'] as CardSuit[]).filter(
      (s) => s !== top.suit
    );
    const low = (['2', '3', '4'] as CardRank[])
      .filter((r) => !board.some((c) => c.rank === r))
      .slice(0, 3);
    const set: Card[] = [
      { rank: top.rank, suit: free[0]! },
      { rank: top.rank, suit: free[1]! },
      ...low.map((rank, k) => ({ rank, suit: free[k % free.length]! })),
    ].slice(0, st.hero.cards.length);
    expect(set.length).toBe(st.hero.cards.length);
    expect(omahaBigDraw(set, board)).toBeNull();
    const off = play(NUT_WRAP, 10, {}, undefined, set);
    const on = play(NUT_WRAP, 10, ON, undefined, set);
    expect(on.bytes).toEqual(off.bytes);
    expect(bigDrawFires(on).flat()).toEqual([]);
  });
});

// ─── by class: the owner ruling of 2026-11-15 12:30, both options on ────────

describe('draw raises by class and position (both options on, many seeds)', () => {
  const BOTH: HorseDecideOpts = {
    omahaBigDrawAggression: true,
    omahaNoDrawRaiseOutOfPosition: true,
  };
  const MANY = Array.from({ length: 40 }, (_, i) => 7000 + i);
  const raises = (o: Outcome) => o.actions.filter((a) => a === 'raise' || a === 'all_in').length;
  const noDrawFires = (o: Outcome) =>
    o.fires.flat().filter((x) => x.startsWith('omaha_no_draw_raise'));
  /** [name, fixture, the node facing a bet] : a flush draw with a nut wrap, and a 13-out nut wrap */
  const FACING: Array<[string, unknown, number]> = [
    ['PLO4 flush draw with a nut wrap and a pair (combo draw)', FD_NUT_WRAP, 10],
    ['PLO5 thirteen-out nut wrap', NUT_WRAP, 12],
  ];

  it.each(FACING)('out of position facing a bet never raises: %s', (_n, fx, ord) => {
    const on = play(fx, ord, BOTH, undefined, undefined, 'oop', MANY);
    expect(raises(on)).toBe(0);
    expect(on.refusals.every((r) => r === null)).toBe(true);
    // each option alone does not raise out of position either
    expect(raises(play(fx, ord, ON, undefined, undefined, 'oop', MANY))).toBeLessThanOrEqual(
      raises(play(fx, ord, {}, undefined, undefined, 'oop', MANY))
    );
    expect(
      raises(
        play(fx, ord, { omahaNoDrawRaiseOutOfPosition: true }, undefined, undefined, 'oop', MANY)
      )
    ).toBe(0);
  });

  it("out of position the brain's existing draw raise is converted, with its receipt", () => {
    const off = play(NUT_WRAP, 12, {}, undefined, undefined, 'oop', MANY);
    const on = play(
      NUT_WRAP,
      12,
      { omahaNoDrawRaiseOutOfPosition: true },
      undefined,
      undefined,
      'oop',
      MANY
    );
    expect(raises(off)).toBeGreaterThan(0);
    expect(raises(on)).toBe(0);
    expect(noDrawFires(on).length).toBeGreaterThanOrEqual(raises(off));
    for (let k = 0; k < MANY.length; k++)
      if (off.actions[k] !== 'raise' && off.actions[k] !== 'all_in')
        expect(on.actions[k]).toBe(off.actions[k]);
  });

  it('in position a combo draw can raise', () => {
    const on = play(FD_NUT_WRAP, 10, BOTH, undefined, undefined, 'ip', MANY);
    const off = play(FD_NUT_WRAP, 10, {}, undefined, undefined, 'ip', MANY);
    expect(raises(on)).toBeGreaterThan(raises(off));
    expect(bigDrawFires(on).flat()).toContain('omaha_big_draw_aggression_raise');
    expect(noDrawFires(on)).toEqual([]);
    expect(on.refusals.every((r) => r === null)).toBe(true);
  });

  it('in position a bare nut flush draw never raises', () => {
    const st = node(FD_NUT_WRAP, 10);
    const board = st.gs.communityCards;
    const R = '23456789TJQKA'.split('') as CardRank[];
    const suits = ['clubs', 'diamonds', 'hearts', 'spades'] as CardSuit[];
    const fd = suits.find((s) => board.filter((c) => c.suit === s).length === 2)!;
    const others = suits.filter((s) => s !== fd);
    const free = (rank: CardRank, suit: CardSuit) =>
      !board.some((c) => c.rank === rank && c.suit === suit);
    const top = [...R].reverse().find((r) => free(r, fd))!;
    let bare: Card[] | null = null;
    for (const low of R)
      for (const j1 of R)
        for (const j2 of R) {
          if (bare || low === top || !free(low, fd) || j1 === j2) continue;
          const hole: Card[] = [
            { rank: top, suit: fd },
            { rank: low, suit: fd },
            { rank: j1, suit: others[0]! },
            { rank: j2, suit: others[1]! },
          ];
          if (!free(j1, others[0]!) || !free(j2, others[1]!)) continue;
          const b = omahaDrawRaiseBar({
            variant: 'plo4',
            street: 'flop',
            hole,
            board,
            inPosition: true,
            hiLo: false,
            multiBoard: false,
            bombPot: false,
            tournament: false,
            allInOrFold: false,
          });
          if (b === 'bare_flush_draw' && omahaBigDraw(hole, board) === null) bare = hole;
        }
    expect(bare).not.toBeNull();
    const on = play(FD_NUT_WRAP, 10, BOTH, undefined, bare!, 'ip', MANY);
    expect(raises(on)).toBe(0);
    expect(on.refusals.every((r) => r === null)).toBe(true);
  });

  it('a made top set raises exactly as today, in and out of position', () => {
    const st = node(NUT_WRAP, 12);
    const board = st.gs.communityCards;
    const top = [...board].sort(
      (a, b) => '23456789TJQKA'.indexOf(b.rank) - '23456789TJQKA'.indexOf(a.rank)
    )[0]!;
    const free = (['clubs', 'diamonds', 'hearts', 'spades'] as CardSuit[]).filter(
      (s) => s !== top.suit
    );
    const low = (['2', '3', '4'] as CardRank[]).filter((r) => !board.some((c) => c.rank === r));
    const set: Card[] = [
      { rank: top.rank, suit: free[0]! },
      { rank: top.rank, suit: free[1]! },
      ...low.map((rank, k) => ({ rank, suit: free[k % free.length]! })),
    ].slice(0, st.hero.cards.length);
    for (const seat of ['ip', 'oop'] as const) {
      const off = play(NUT_WRAP, 12, {}, undefined, set, seat);
      const on = play(NUT_WRAP, 12, BOTH, undefined, set, seat);
      expect(on.bytes).toEqual(off.bytes);
    }
  });
});

describe('in the league', () => {
  it('off by default: unset and false play the same poker', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `bigdraw_off_${variant}`,
          variant,
          pairs: 40,
          productionStyles: true,
          a: {},
          b: { omahaBigDrawAggression: false, omahaNoDrawRaiseOutOfPosition: false },
        },
        40,
        4610001
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 300_000);

  it('on, with the memory learning: no illegal action and no fallback', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `bigdraw_on_${variant}`,
          variant,
          pairs: 40,
          productionStyles: true,
          a: { omahaBigDrawAggression: true, omahaNoDrawRaiseOutOfPosition: true },
          b: {},
        },
        40,
        4620001
      );
      expect(r.illegalActions).toBe(0);
      expect(r.brainExceptionFallbacks ?? 0).toBe(0);
    }
  }, 300_000);
});
