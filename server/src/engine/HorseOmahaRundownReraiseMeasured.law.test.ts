/**
 * omahaRundownReraiseRangeIsMeasured and omahaRundownReraiseRangeTrial (each default OFF; EMERG lane
 * RUNDOWNS 2026-11-20).
 * Law: in PLO4/PLO5 cash, preflop, the rundown re-raise range is the measured one, cell by cell. The
 * measured set turns a re-raise into the call only in the cell where the call earned more REAL chips
 * (chips to and from persons) on fit and on held-out data, each by more than one standard error: the
 * squeeze from a blind out of position with a high rundown and a stack above 250 bb. The trial set
 * turns a call into the pot-size re-raise only in its cells (the 3-bet in position with a
 * double-suited no-gap rundown without a pair; the PLO5 4-bet in position as the opener with five
 * connected cards and nut potential; a tier A or B rundown in position with 250 bb or less). Both conversions survive the response validator; every other
 * decision is untouched; the structure of a rundown is the one the offline grader used; a decision
 * the three-way pricing judged stands; PLO6, tournaments and the options off are byte-identical.
 * Synthetic public states and seeded random cards only: no recorded hand, no player id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  OMAHA_RUNDOWN_RERAISE_CELLS,
  omahaRundownMeasuredAdmitsCall,
  omahaRundownMeasuredPasses,
  omahaRundownReraiseCell,
  omahaRundownReraiseMeasuredRule,
  omahaRundownReraiseSpot,
  omahaRundownReraiseTrialRule,
  omahaRundownStructure,
} from './HorseOmahaRundownReraiseMeasured.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]!]! }));
const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const MEASURED_ON: HorseDecideOpts = { omahaRundownReraiseRangeIsMeasured: true };
const TRIAL_ON: HorseDecideOpts = { omahaRundownReraiseRangeTrial: true };

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomHole(rnd: () => number, n: number, start: Card[] = []): Card[] {
  const taken = new Set(start.map((c) => c.rank + c.suit));
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))).filter(
    (c) => !taken.has(c.rank + c.suit)
  );
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return [...start, ...deck.slice(0, n - start.length)];
}

/**
 * The public spots. Six seats, blinds 1/2, dealer on 5: seat 1 small blind, seat 2 big blind, seat 6
 * out of the hand.
 *  open:      seat 3 opens to 7, everyone to the Horse folds (the Horse on 5 is in position, on 1 or 2 out)
 *  squeeze:   seat 3 opens to 7, seat 4 calls, everyone to the Horse folds
 *  threeBet:  the Horse opened to 7 and is 3-bet to 24 (the Horse on 5 by seat 1: in position; the
 *             Horse on 3 by seat 4: out of position)
 *  coldFour:  seat 3 opens to 7, seat 4 makes it 24, everyone to the Horse folds
 */
interface Shape {
  variant?: string;
  heroSeat?: number;
  line?: 'open' | 'squeeze' | 'threeBet' | 'coldFour';
  /** the Horse's chips at the start of the hand (default 400 = 200 big blinds) */
  stack?: number;
  lightning?: boolean;
  gameMode?: 'cash' | 'tournament';
}
const uid = (n: number) => `4400000${n}-0000-4000-8000-00000000000${n}`;
function stateOf(hole: Card[], shape: Shape = {}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroSeat = shape.heroSeat ?? 5;
  const line = shape.line ?? 'open';
  const bet = new Map<number, number>([
    [1, 1],
    [2, 2],
  ]);
  const folded = new Set<number>([6]);
  const hist: unknown[] = [];
  let ts = 1;
  const rec = (seat: number, action: string, amount: number, extra: object = {}) =>
    hist.push({
      stage: 'preflop',
      seat,
      userId: uid(seat),
      action,
      amount,
      timestamp: ts++,
      ...extra,
    });
  const fold = (seat: number) => {
    folded.add(seat);
    rec(seat, 'fold', 0);
  };
  const raise = (seat: number, to: number) => {
    rec(seat, 'raise', to, { isFullRaise: true });
    bet.set(seat, to);
  };
  let currentBet = 2;
  if (line === 'threeBet') {
    const threeBettor = heroSeat === 5 ? 1 : 4;
    for (const s of [3, 4]) if (s !== heroSeat && s < heroSeat) fold(s);
    raise(heroSeat, 7);
    raise(threeBettor, 24);
    currentBet = 24;
    for (const s of heroSeat === 5 ? [2] : [5, 1, 2]) fold(s);
  } else {
    raise(3, 7);
    currentBet = 7;
    if (line === 'squeeze') {
      rec(4, 'call', 7);
      bet.set(4, 7);
    } else if (line === 'coldFour') {
      raise(4, 24);
      currentBet = 24;
    }
    for (const s of line === 'open' ? [4, 5, 1, 2] : [5, 1, 2]) {
      if (s === heroSeat) break;
      fold(s);
    }
  }
  const start = shape.stack ?? 400;
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: (n === heroSeat ? start : 1200) - (bet.get(n) ?? 0),
        bet: bet.get(n) ?? 0,
        totalInvested: bet.get(n) ?? 0,
        cards: n === heroSeat ? hole : [],
        is_folded: folded.has(n),
        is_all_in: false,
        is_sitting_out: false,
        is_horse: n === heroSeat,
      }) as SeatPlayer
  );
  const hero = players.find((p) => p.seat === heroSeat)!;
  const pot = [...bet.values()].reduce((a, b) => a + b, 0);
  const toCall = currentBet - hero.bet;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    toCall,
    minRaise: 5,
    minRaiseTo: currentBet + 5,
    maxRaiseTo: Math.min(hero.stack + hero.bet, currentBet + pot + toCall),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: shape.variant ?? 'plo5',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 5,
    blindSeats: { smallBlind: 1, bigBlind: 2 },
    gameMode: shape.gameMode ?? 'cash',
    actionHistory: hist,
    ...(shape.lightning ? { publicMemoryDomain: { speed: 'lightning' } } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** The offline grader's classifier (emerg/rundowns/work/cls.py, sha256 d0a3ffca...) on 100 seeded hands. */
const PARITY: [string, string | null][] = [
  ['KsQhJdJs', 'paired B ss 1 0 1 0 none 0 0 1 C'],
  ['9sTh9dJd', 'paired H ss 1 0 1 0 none 0 0 1 C'],
  ['8hJdQhJh', null],
  ['6h6cJd8c', null],
  ['TcTdJsKd', 'paired B ss 1 0 1 0 none 0 0 1 C'],
  ['6h6d3c4c', 'paired L ss 0 0 1 0 none 0 0 0 C'],
  ['9hAcQhJc', 'gap2 H ds 1 1 0 0 none 1 0 1 B'],
  ['AsQdKcKd', 'paired B ss 0 0 1 1 none 0 0 1 C'],
  ['TsJsKsTc', 'paired B ss 1 0 1 0 none 0 0 1 C'],
  ['9hKsJhAh', 'gap2 H ss 1 1 0 0 none 1 0 1 C'],
  ['5hJh4dAs', null],
  ['4hAd7h6d', null],
  ['8c4s2h2d', null],
  ['9c6s2h6h', null],
  ['4cKd2s3h', null],
  ['9s7cJcTc', 'gap1_bot H ss 1 0 0 0 none 1 1 1 B'],
  ['Jh7h8s7c', null],
  ['7c2s5h4d', 'gap2 M rb 0 0 0 0 none 0 0 0 C'],
  ['KhQsAhJh', 'nogap B ss 1 1 0 0 none 2 1 1 B'],
  ['Ts8dTcKd', null],
  ['9h9cKh9d', null],
  ['ThKsQhTc', 'paired B ss 0 0 1 0 none 0 0 1 C'],
  ['6h7s5h4h', 'nogap M ss 0 0 0 0 none 0 1 0 C'],
  ['6h4c7s3h', 'gap1_mid M ss 0 0 0 0 none 0 1 0 C'],
  ['QsJhKhTs', 'nogap B ds 1 0 0 0 none 1 1 1 A'],
  ['8h4h3s5s', 'gap2 M ds 1 0 0 0 none 0 0 0 C'],
  ['QsTsQh9s', 'paired H ss 1 0 1 0 none 0 0 1 C'],
  ['9s8d7d6d', 'nogap M ss 0 0 0 0 none 0 1 0 C'],
  ['6c7c5d3d', 'gap1_bot M ds 1 0 0 0 none 0 1 0 B'],
  ['6s3d2h5s', 'gap1_mid L ss 1 0 0 0 none 0 1 0 C'],
  ['JdKcKhAs', 'paired B rb 0 0 1 1 none 0 0 1 C'],
  ['5h5d4s3d', 'paired L ss 1 0 1 0 none 0 0 0 C'],
  ['8cJhQc7s', 'gap2 H ss 1 0 0 0 none 0 0 1 C'],
  ['Qs9s9hJh', 'paired H ds 1 0 1 0 none 0 0 1 B'],
  ['8d6s5d9d', 'gap1_mid M ss 1 0 0 0 none 0 1 0 C'],
  ['Jc9hKdQh', 'gap1_bot H ss 0 0 0 0 none 1 1 1 B'],
  ['QhQc9hJd', 'paired H ss 1 0 1 0 none 0 0 1 C'],
  ['7d4s4c6s', 'paired M ss 0 0 1 0 none 0 0 0 C'],
  ['9dTs8d7d', 'nogap H ss 0 0 0 0 none 1 1 1 B'],
  ['3h6c5h4d', 'nogap L ss 0 0 0 0 none 0 1 0 C'],
  ['ThQc8cJd', 'gap1_bot H ss 1 0 0 0 none 1 1 1 B'],
  ['AcQdJhJs', 'paired B rb 0 0 1 0 none 0 0 1 C'],
  ['JsTdJh9h', 'paired H ss 1 0 1 0 none 0 0 1 C'],
  ['8h6h9h6c', 'paired M ss 1 0 1 0 none 0 0 0 C'],
  ['9d7sQd8s', 'gap2 H ds 1 0 0 0 none 0 0 1 B'],
  ['8c9h7s5c', 'gap1_bot M ss 0 0 0 0 none 0 1 0 C'],
  ['7c9h8s8d', 'paired M rb 0 0 1 0 none 0 0 0 C'],
  ['6h8h8c7c', 'paired M ds 1 0 1 0 none 0 0 0 C'],
  ['7h9s4h6d', 'gap2 M ss 0 0 0 0 none 0 0 0 C'],
  ['6d7s8h5h', 'nogap M ss 1 0 0 0 none 0 1 0 C'],
  ['4cQd5h7c4s', 'paired M ss 0 0 1 0 dangler 0 0 0 C'],
  ['Qh9dJc8hTh', 'nogap H ss 1 0 0 0 conn5 1 1 1 B'],
  ['6hAhJsAs2s', null],
  ['5s8d4h6h7d', 'nogap M ds 1 0 0 0 conn5 0 1 0 B'],
  ['Kc5d4d3d3c', 'paired L ds 1 0 1 0 dangler 0 0 0 C'],
  ['5c2s3dKhJh', null],
  ['9sTdAc6cKs', 'gap2 H ds 1 1 0 0 dangler 1 0 1 B'],
  ['8sTdJcTh9c', 'nogap H ss 1 0 1 0 pair5 1 1 1 B'],
  ['6s8c7c7d4d', 'paired M ds 1 0 1 0 dangler 0 0 0 C'],
  ['9s7h5c6sJh', 'gap1_top M ds 1 0 0 0 conn5 0 1 0 B'],
  ['8c9s6c2c9d', 'paired M ss 0 0 1 0 dangler 0 0 0 C'],
  ['8c8d7s9hJc', 'paired M ss 1 0 1 0 dangler 0 0 0 C'],
  ['4h3c5c4c8d', 'paired L ss 0 0 1 0 dangler 0 0 0 C'],
  ['8sQd6s4sQh', null],
  ['5s7d5c6h5d', null],
  ['7h7c4h2s3c', 'gap2 M ds 1 0 1 0 pair5 0 0 0 C'],
  ['QhKsAdKhKd', null],
  ['9h4dAdJh5s', null],
  ['3s4d7s2c6c', 'gap1_mid M ds 1 0 0 0 conn5 0 1 0 B'],
  ['8dTd7s5c7h', 'paired H ss 1 0 1 0 dangler 0 0 1 C'],
  ['8d6c5s8h2d', 'paired M ss 1 0 1 0 dangler 0 0 0 C'],
  ['4c5s5d7d6h', 'nogap M ss 1 0 1 0 pair5 0 1 0 C'],
  ['Th4d9h3s4h', null],
  ['4d5d8h3d8s', 'gap2 M ss 0 0 1 0 pair5 0 0 0 C'],
  ['5s5d7c3sKh', null],
  ['9sJc9h9cKs', null],
  ['Th9s2h5s7h', 'gap2 H ds 1 0 0 0 dangler 0 0 1 B'],
  ['AcTh8c7c4d', null],
  ['Ad9hJdKhQd', 'nogap B ds 1 1 0 0 conn5 2 1 1 A'],
  ['8d9c6c9d7h', 'nogap M ds 1 0 1 0 pair5 0 1 0 B'],
  ['JhTc9sQcJs', 'nogap H ds 1 0 1 0 pair5 1 1 1 A'],
  ['8c7c7h8h5c', 'paired M ds 1 0 1 0 pair5 0 0 0 C'],
  ['Qd9hQhTdJd', 'nogap H ds 1 0 1 0 pair5 1 1 1 A'],
  ['8d9c7sJhQc', 'gap1_mid H ss 1 0 0 0 conn5 1 1 1 B'],
  ['9hTsJdQc9d', 'nogap H ss 0 0 1 0 pair5 1 1 1 B'],
  ['6s9dTh5h7c', 'gap1_mid H ss 1 0 0 0 conn5 1 1 1 B'],
  ['9c4s5h8h7c', 'gap1_bot M ds 1 0 0 0 conn5 0 1 0 B'],
  ['8h9hJdQd7c', 'gap1_mid H ds 1 0 0 0 conn5 1 1 1 A'],
  ['4c3c3h8d5c', 'paired L ss 0 0 1 0 dangler 0 0 0 C'],
  ['Jh9c8cThTc', 'nogap H ds 1 0 1 0 pair5 1 1 1 A'],
  ['JcTh9hQc9s', 'nogap H ds 1 0 1 0 pair5 1 1 1 A'],
  ['9c7h6cTdTh', 'gap1_mid H ds 1 0 1 0 pair5 1 1 1 A'],
  ['8h7s9cJcTd', 'nogap H ss 1 0 0 0 conn5 1 1 1 B'],
  ['6s4d4c7c3c', 'gap1_mid M ss 1 0 1 0 pair5 0 1 0 C'],
  ['6h3h2s3d7s', 'gap2 M ds 1 0 1 0 pair5 0 0 0 C'],
  ['4s2d5c3h2c', 'nogap L ss 1 0 1 0 pair5 0 1 0 C'],
  ['7s7d8c5s6h', 'nogap M ss 0 0 1 0 pair5 0 1 0 C'],
  ['Jh8s9d8dJd', 'paired H ss 1 0 1 0 pair5 0 0 1 C'],
  ['6s8c5cKc5s', 'paired M ds 1 0 1 0 dangler 0 0 0 C'],
  ['KcKhJdJhTc', 'paired B ds 1 0 1 1 pair5 0 0 1 B'],
];

describe('the structure of a rundown is the one the grade used', () => {
  it('agrees with the offline classifier on every pinned hand', () => {
    for (const [spec, want] of PARITY) {
      const s = omahaRundownStructure(cards(spec));
      const got =
        s === null
          ? null
          : [
              s.connection,
              s.height,
              s.suits,
              +s.topSuited,
              +s.aceSuited,
              +s.pair,
              +s.kings,
              s.fifth,
              s.nutPotential,
              +s.tight,
              +s.high,
              s.tier,
            ].join(' ');
      expect([spec, got]).toEqual([spec, want]);
    }
  });
  it('a pair of aces, three of a rank, six cards and loose hands are not rundowns', () => {
    for (const spec of ['AsAhKdQc', 'JsJhJdTc', 'JsTs9h8h7c6c', 'KsQh7d2c', 'AsKh8d7c3s'])
      expect(omahaRundownStructure(cards(spec))).toBeNull();
    expect(omahaRundownStructure(cards('JsTs9h8h'))).toMatchObject({
      connection: 'nogap',
      height: 'H',
      suits: 'ds',
      fifth: 'none',
      tight: true,
      high: true,
    });
    expect(omahaRundownStructure(cards('KsQsJhTh9c'))).toMatchObject({
      connection: 'nogap',
      height: 'B',
      fifth: 'conn5',
      nutPotential: 1,
    });
  });
});

describe('the cells are the measured ones', () => {
  it('the measured set holds only cells both periods agree on beyond one standard error', () => {
    const measured = OMAHA_RUNDOWN_RERAISE_CELLS.filter((c) => c.set === 'measured');
    expect(measured.map((c) => c.id)).toEqual(['squeeze_out_of_position_high_rundown_above_250bb']);
    for (const c of measured) {
      expect(omahaRundownMeasuredPasses(c)).toBe(true);
      expect(c.becomes).toBe('call');
      expect(c.horse.fitBB + c.horse.fitSeBB).toBeLessThan(0);
      expect(c.horse.heldOutBB + c.horse.heldOutSeBB).toBeLessThan(0);
      expect(c.stackAboveBB).toBe(250);
    }
  });
  it('the trial set only ever re-raises a call, and no trial cell is called measured', () => {
    const trial = OMAHA_RUNDOWN_RERAISE_CELLS.filter((c) => c.set === 'trial');
    expect(trial.map((c) => c.id)).toEqual([
      'three_bet_in_position_no_gap_double_suited',
      'four_bet_in_position_five_connected',
      'squeeze_or_four_bet_in_position_tier_a_b_at_most_250bb',
      'three_bet_in_position_tier_a_b_at_most_250bb',
    ]);
    for (const c of trial) {
      expect(c.becomes).toBe('reraise');
      expect(c.spots.every((k) => k.endsWith('InPosition'))).toBe(true);
      // the cells chosen by the declared rule rest on persons' shown re-raises; the depth cells on the Horses' own record
      if (c.personsShown) {
        expect(c.personsShown.reraises).toBeGreaterThanOrEqual(10);
        expect(c.personsShown.reraiseBB - c.personsShown.reraiseSeBB).toBeGreaterThan(0);
      } else expect(c.stackAtMostBB).toBe(250);
    }
    // no cell of either set re-raises out of position
    for (const c of OMAHA_RUNDOWN_RERAISE_CELLS)
      if (c.becomes === 'reraise')
        expect(c.spots.some((k) => k.endsWith('OutOfPosition') || k === 'coldFourBet')).toBe(false);
  });
});

describe('the measured set: the squeeze from a blind with a high rundown above 250 bb', () => {
  const high = cards('JsTs9h8h2c');
  const r28 = { action: 'raise', amount: 28, thinkTime: 900 };
  it('a re-raise the node entered with becomes the call of exactly the chips to call', () => {
    for (const heroSeat of [1, 2]) {
      const { hero, gs } = stateOf(high, { line: 'squeeze', heroSeat, stack: 600 });
      const spot = omahaRundownReraiseSpot(hero, gs)!;
      expect(spot.kind).toBe('squeezeOutOfPosition');
      expect(spot.stackBB).toBe(300);
      expect(omahaRundownReraiseCell(spot, 'measured')!.id).toBe(
        'squeeze_out_of_position_high_rundown_above_250bb'
      );
      const want = { action: 'call', amount: gs.toCall, thinkTime: 900 };
      expect(omahaRundownReraiseMeasuredRule(r28, hero, gs, true, 'raise')).toEqual(want);
      expect(omahaRundownReraiseMeasuredRule(r28, hero, gs, true)).toEqual(want);
      expect(
        omahaRundownReraiseMeasuredRule(
          { action: 'all_in', thinkTime: 900 },
          hero,
          gs,
          true,
          'all_in'
        )
      ).toEqual(want);
      expect(omahaRundownMeasuredAdmitsCall(hero, gs, gs.toCall)).toBe(true);
      expect(omahaRundownMeasuredAdmitsCall(hero, gs, (gs.toCall as number) + 1)).toBe(false);
      expect(omahaRundownMeasuredAdmitsCall(hero, gs, null)).toBe(false);
    }
    const four = stateOf(cards('QsJsTh9h'), {
      variant: 'plo4',
      line: 'squeeze',
      heroSeat: 2,
      stack: 700,
      lightning: true,
    });
    expect(omahaRundownReraiseMeasuredRule(r28, four.hero, four.gs, true, 'raise').action).toBe(
      'call'
    );
  });
  it('250 bb or less, a rundown that is not high, in position, no caller, a 3-bet pot: the re-raise stands', () => {
    const keep = (hole: Card[], shape: Shape) => {
      const s = stateOf(hole, shape);
      expect(omahaRundownReraiseMeasuredRule(r28, s.hero, s.gs, true, 'raise')).toBe(r28);
      expect(omahaRundownMeasuredAdmitsCall(s.hero, s.gs, s.gs.toCall)).toBe(false);
    };
    keep(high, { line: 'squeeze', heroSeat: 1, stack: 500 });
    keep(high, { line: 'squeeze', heroSeat: 2, stack: 300 });
    keep(cards('8s7s6h5h2c'), { line: 'squeeze', heroSeat: 1, stack: 600 });
    keep(cards('6s5s4h3hKc'), { line: 'squeeze', heroSeat: 1, stack: 600 });
    keep(high, { line: 'squeeze', heroSeat: 5, stack: 600 });
    keep(high, { line: 'open', heroSeat: 1, stack: 600 });
    keep(high, { line: 'open', heroSeat: 5, stack: 600 });
    keep(high, { line: 'coldFour', heroSeat: 1, stack: 600 });
    keep(high, { line: 'threeBet', heroSeat: 3, stack: 600 });
    keep(cards('KsKh7d4c2s'), { line: 'squeeze', heroSeat: 1, stack: 600 });
    keep(cards('AsAhKdQc2s'), { line: 'squeeze', heroSeat: 1, stack: 600 });
    keep(cards('AsKs9h4h2c'), { line: 'squeeze', heroSeat: 1, stack: 600 });
  });
  it('only a re-raise the node entered with, only with a call legal, never a decision the three-way pricing judged', () => {
    const { hero, gs } = stateOf(high, { line: 'squeeze', heroSeat: 1, stack: 600 });
    for (const entered of ['call', 'fold', 'check'])
      expect(omahaRundownReraiseMeasuredRule(r28, hero, gs, true, entered)).toBe(r28);
    const call = { action: 'call', amount: 6 };
    expect(omahaRundownReraiseMeasuredRule(call, hero, gs, true, 'call')).toBe(call);
    const fold = { action: 'fold' };
    expect(omahaRundownReraiseMeasuredRule(fold, hero, gs, true, 'fold')).toBe(fold);
    const priced = { ...r28, omahaPreflopThreeWay: { verdict: 'raise' } };
    expect(omahaRundownReraiseMeasuredRule(priced, hero, gs, true, 'raise')).toBe(priced);
    expect(omahaRundownReraiseMeasuredRule(r28, hero, gs, false, 'raise')).toBe(r28);
    const noCall = stateOf(high, { line: 'squeeze', heroSeat: 1, stack: 600 });
    (noCall.gs as { legalActions: string[] }).legalActions = ['fold', 'raise', 'all_in'];
    expect(omahaRundownReraiseMeasuredRule(r28, noCall.hero, noCall.gs, true, 'raise')).toBe(r28);
    // the trial set never touches a re-raise, the measured set never makes one
    expect(omahaRundownReraiseTrialRule(r28, hero, gs, true)).toBe(r28);
    expect(omahaRundownReraiseTrialRule(call, hero, gs, true)).toBe(call);
  });
});

describe('the trial set', () => {
  const c7 = { action: 'call', amount: 7, thinkTime: 800 };
  const c24 = { action: 'call', amount: 24, thinkTime: 800 };
  it('the 3-bet in position facing an open nobody called: a double-suited no-gap rundown without a pair', () => {
    for (const [spec, variant] of [
      ['JsTs9h8h', 'plo4'],
      ['9s8s7h6h', 'plo4'],
      ['JsTs9h8h7c', 'plo5'],
      ['KsQsJhTh9c', 'plo5'],
    ] as const) {
      const { hero, gs } = stateOf(cards(spec), { variant, line: 'open', heroSeat: 5, stack: 700 });
      const spot = omahaRundownReraiseSpot(hero, gs)!;
      expect(spot.kind).toBe('threeBetInPosition');
      expect(omahaRundownReraiseCell(spot, 'trial')!.id).toBe(
        'three_bet_in_position_no_gap_double_suited'
      );
      expect(omahaRundownReraiseTrialRule(c7, hero, gs, true)).toEqual({
        action: 'raise',
        amount: gs.maxRaiseTo,
        thinkTime: 800,
      });
      // the measured set has no cell here
      expect(omahaRundownReraiseMeasuredRule(c7, hero, gs, true, 'call')).toBe(c7);
    }
    const keep = (spec: string, shape: Shape) => {
      const s = stateOf(cards(spec), {
        variant: spec.length === 8 ? 'plo4' : 'plo5',
        stack: 700,
        ...shape,
      });
      expect(omahaRundownReraiseTrialRule(c7, s.hero, s.gs, true)).toBe(c7);
    };
    keep('JsTs9h8h2c', { line: 'open', heroSeat: 5 }); // a dangler
    keep('JsTs9h8hJc', { line: 'open', heroSeat: 5 }); // a pair
    keep('JsTs9s8h', { line: 'open', heroSeat: 5 }); // single suited
    keep('JsTh9d8c', { line: 'open', heroSeat: 5 }); // rainbow
    keep('JsTs9h7h', { line: 'open', heroSeat: 5 }); // a gap
    keep('6s5s4h3h', { line: 'open', heroSeat: 5 }); // low
    keep('JsTs9h8h', { line: 'open', heroSeat: 1 }); // out of position
    keep('JsTs9h8h', { line: 'open', heroSeat: 2 });
    keep('JsTs9h8h', { line: 'squeeze', heroSeat: 5 }); // a caller
    keep('JsTs9h8h', { line: 'coldFour', heroSeat: 5 }); // a 3-bet pot
  });
  it('the PLO5 4-bet in position as the opener: five connected cards, no pair, nut potential', () => {
    for (const spec of ['KsQsJhTh9c', 'AsKsQhJh9c', 'QsJhTd9c8s', 'AsKhQdJcTs']) {
      const { hero, gs } = stateOf(cards(spec), { line: 'threeBet', heroSeat: 5, stack: 700 });
      const spot = omahaRundownReraiseSpot(hero, gs)!;
      expect([spec, spot.kind]).toEqual([spec, 'fourBetInPosition']);
      expect([spec, omahaRundownReraiseCell(spot, 'trial')?.id]).toEqual([
        spec,
        'four_bet_in_position_five_connected',
      ]);
      expect(omahaRundownReraiseTrialRule(c24, hero, gs, true)).toEqual({
        action: 'raise',
        amount: gs.maxRaiseTo,
        thinkTime: 800,
      });
    }
    const keep = (spec: string, shape: Shape) => {
      const s = stateOf(cards(spec), {
        variant: spec.length === 8 ? 'plo4' : 'plo5',
        stack: 700,
        ...shape,
      });
      expect([spec, omahaRundownReraiseTrialRule(c24, s.hero, s.gs, true)]).toEqual([spec, c24]);
    };
    keep('KsQsJhTh', { line: 'threeBet', heroSeat: 5 }); // PLO4
    keep('KsQsJhTh2c', { line: 'threeBet', heroSeat: 5 }); // a dangler
    keep('KsQsJhThKc', { line: 'threeBet', heroSeat: 5 }); // a pair
    keep('9s8s7h6h5c', { line: 'threeBet', heroSeat: 5 }); // no nut potential
    keep('KsQsJhTh9c', { line: 'threeBet', heroSeat: 3 }); // out of position
    keep('KsQsJhTh9c', { line: 'coldFour', heroSeat: 5 }); // cold
  });
  it('depth: in position with 250 bb or less a tier A or B rundown re-raises (3-bet, squeeze, 4-bet as the opener)', () => {
    const cases: [string, Shape, string][] = [
      [
        'JsTs9h8h2c',
        { line: 'squeeze', heroSeat: 5 },
        'squeeze_or_four_bet_in_position_tier_a_b_at_most_250bb',
      ],
      [
        'QsJsTh8h2c',
        { line: 'threeBet', heroSeat: 5 },
        'squeeze_or_four_bet_in_position_tier_a_b_at_most_250bb',
      ],
      ['KsQsJh9h', { line: 'open', heroSeat: 5 }, 'three_bet_in_position_tier_a_b_at_most_250bb'],
      ['JsTs9h8d', { line: 'open', heroSeat: 5 }, 'three_bet_in_position_tier_a_b_at_most_250bb'],
      [
        'QsQhJsTh',
        { line: 'squeeze', heroSeat: 5 },
        'squeeze_or_four_bet_in_position_tier_a_b_at_most_250bb',
      ],
      [
        '9s8s7h6d5h',
        { line: 'squeeze', heroSeat: 5, stack: 500 },
        'squeeze_or_four_bet_in_position_tier_a_b_at_most_250bb',
      ],
    ];
    for (const [spec, shape, id] of cases) {
      const variant = spec.length === 8 ? 'plo4' : 'plo5';
      const { hero, gs } = stateOf(cards(spec), { variant, ...shape });
      const spot = omahaRundownReraiseSpot(hero, gs)!;
      expect(spot.stackBB).toBeLessThanOrEqual(250);
      expect(['A', 'B']).toContain(spot.structure.tier);
      expect([spec, omahaRundownReraiseCell(spot, 'trial')?.id]).toEqual([spec, id]);
      const call = { action: 'call', amount: gs.toCall as number, thinkTime: 800 };
      expect(omahaRundownReraiseTrialRule(call, hero, gs, true)).toEqual({
        action: 'raise',
        amount: gs.maxRaiseTo,
        thinkTime: 800,
      });
      // one chip above 250 bb the depth cells are silent
      const deep = stateOf(cards(spec), { variant, ...shape, stack: 502 });
      const deepSpot = omahaRundownReraiseSpot(deep.hero, deep.gs)!;
      expect(omahaRundownReraiseCell(deepSpot, 'trial')?.id ?? '').not.toMatch(/at_most_250bb/);
    }
    const keep = (spec: string, shape: Shape) => {
      const s = stateOf(cards(spec), { variant: spec.length === 8 ? 'plo4' : 'plo5', ...shape });
      const call = { action: 'call', amount: s.gs.toCall as number };
      expect([spec, omahaRundownReraiseTrialRule(call, s.hero, s.gs, true)]).toEqual([spec, call]);
    };
    keep('9s8h7d6c2s', { line: 'squeeze', heroSeat: 5 }); // tier C: rainbow
    keep('6s5s4h3h', { line: 'squeeze', heroSeat: 5 }); // tier C: low
    keep('8s7s6h4d', { line: 'open', heroSeat: 5 }); // tier C: single suited, not high
    keep('JsTs9h8h2c', { line: 'squeeze', heroSeat: 1 }); // out of position
    keep('JsTs9h8h2c', { line: 'squeeze', heroSeat: 2 });
    keep('QsJsTh8h2c', { line: 'threeBet', heroSeat: 3 }); // the opener out of position
    keep('JsTs9h8h2c', { line: 'coldFour', heroSeat: 5 }); // cold
    keep('KsQsJh9h', { line: 'open', heroSeat: 1 }); // a blind against an open
  });
  it('the pot raise that is the whole stack is the all-in; off, a raise, a fold and a priced call stand', () => {
    const short = stateOf(cards('JsTs9h8h'), {
      variant: 'plo4',
      line: 'open',
      heroSeat: 5,
      stack: 20,
    });
    expect(
      omahaRundownReraiseTrialRule({ action: 'call', amount: 7 }, short.hero, short.gs, true)
    ).toEqual({
      action: 'all_in',
    });
    const { hero, gs } = stateOf(cards('JsTs9h8h'), { variant: 'plo4', line: 'open', heroSeat: 5 });
    expect(omahaRundownReraiseTrialRule(c7, hero, gs, false)).toBe(c7);
    const raise = { action: 'raise', amount: 21 };
    expect(omahaRundownReraiseTrialRule(raise, hero, gs, true)).toBe(raise);
    const fold = { action: 'fold' };
    expect(omahaRundownReraiseTrialRule(fold, hero, gs, true)).toBe(fold);
    const priced = { ...c7, omahaPreflopThreeWay: { verdict: 'call' } };
    expect(omahaRundownReraiseTrialRule(priced, hero, gs, true)).toBe(priced);
    const noRaise = stateOf(cards('JsTs9h8h'), { variant: 'plo4', line: 'open', heroSeat: 5 });
    (noRaise.gs as { legalActions: string[] }).legalActions = ['fold', 'call'];
    expect(omahaRundownReraiseTrialRule(c7, noRaise.hero, noRaise.gs, true)).toBe(c7);
  });
  it('PLO6, PLO8, hold-em, a tournament and heads-up are out of scope for both sets', () => {
    const not = (hole: Card[], shape: Shape) => {
      const s = stateOf(hole, shape);
      expect(omahaRundownReraiseSpot(s.hero, s.gs)).toBeNull();
      const r = { action: 'raise', amount: 28 };
      expect(omahaRundownReraiseMeasuredRule(r, s.hero, s.gs, true, 'raise')).toBe(r);
      expect(omahaRundownReraiseTrialRule(c7, s.hero, s.gs, true)).toBe(c7);
      expect(omahaRundownMeasuredAdmitsCall(s.hero, s.gs, s.gs.toCall)).toBe(false);
    };
    not(cards('JsTs9h8h7c6c'), { variant: 'plo6', line: 'squeeze', heroSeat: 1, stack: 600 });
    not(cards('JsTs9h8h7c6c'), { variant: 'plo6', line: 'open', heroSeat: 5 });
    not(cards('JsTs9h8h'), { variant: 'plo8', line: 'open', heroSeat: 5 });
    not(cards('JsTs'), { variant: 'nlh', line: 'open', heroSeat: 5 });
    not(cards('JsTs9h8h7c'), { gameMode: 'tournament', line: 'squeeze', heroSeat: 1, stack: 600 });
    not(cards('JsTs9h8h7c'), { gameMode: 'tournament', line: 'open', heroSeat: 5 });
  });
});

const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
function decide(hole: Card[], shape: Shape, opts: HorseDecideOpts, seed: number) {
  enableBrainTelemetry();
  HorseMind.reset();
  const { hero, gs } = stateOf(hole, shape);
  drainFires();
  seedFastRandom(seed);
  const d = structuredClone(
    HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts } as never)
  );
  return { hero, gs, d, next: fastRandom(), fires: drainFires().map((f) => f.feature) };
}
const SHAPES: Shape[] = [
  { line: 'open', heroSeat: 5 },
  { line: 'squeeze', heroSeat: 1, stack: 600 },
  { line: 'threeBet', heroSeat: 5 },
  { line: 'squeeze', heroSeat: 2, stack: 900 },
  { line: 'open', heroSeat: 5, stack: 700 },
  { line: 'open', heroSeat: 1, stack: 600 },
  { line: 'squeeze', heroSeat: 5 },
  { line: 'threeBet', heroSeat: 3 },
  { line: 'coldFour', heroSeat: 5 },
  { line: 'squeeze', heroSeat: 1, stack: 400 },
];
/** Seeded hands that are mostly rundowns: a connected start and random other cards. */
const STARTS = ['JsTs9h8h', 'KsQsJhTh', 'QsJsTh9h', 'Ts9s8h7h', 'KsQhJsTh', '9s8s7h6h', 'AsKsQhJh'];
function seededHole(rnd: () => number, n: number, k: number): Card[] {
  if (k % 6 === 5) return randomHole(rnd, n);
  const start = cards(STARTS[k % STARTS.length]!);
  if (n === 4) return start;
  if (k % 3 === 0) {
    // a fifth card inside the run
    const ranks = start.map((c) => RANKS.indexOf(c.rank));
    const lo = Math.min(...ranks);
    const hi = Math.max(...ranks);
    const r = lo >= 1 ? RANKS[lo - 1]! : RANKS[Math.min(12, hi + 1)]!;
    return [...start, { rank: r, suit: 'clubs' }];
  }
  return randomHole(rnd, n, start);
}

describe('in the decision (seeded census)', () => {
  it('measured: every re-raise in the measured cell becomes a call the validator admits; nothing else moves', () => {
    let called = 0;
    let kept = 0;
    for (const [variant, n] of [
      ['plo5', 5],
      ['plo4', 4],
    ] as const) {
      const rnd = mulberry32(20261124 + n);
      for (let k = 0; k < 220; k++) {
        const hole = seededHole(rnd, n, k);
        const shape: Shape = { ...SHAPES[k % SHAPES.length]!, variant, lightning: k % 4 === 3 };
        const off = decide(hole, shape, {}, 8100 + k);
        const on = decide(hole, shape, MEASURED_ON, 8100 + k);
        if (on.fires.includes('omaha_rundown_measured_call')) {
          called++;
          const spot = omahaRundownReraiseSpot(off.hero, off.gs)!;
          expect(omahaRundownReraiseCell(spot, 'measured')).not.toBeNull();
          expect(on.d.action).toBe('call');
          expect(on.d.amount).toBe(on.gs.toCall);
          expect(
            horseDecisionReceiptRefusal(structuredClone(on.d), variant, {
              player: on.hero,
              gameState: on.gs,
            })
          ).toBeNull();
        } else {
          kept++;
          expect(bytesOf(on.d)).toBe(bytesOf(off.d));
          expect(on.next).toBe(off.next);
        }
        // never a re-raise left standing in the measured cell
        const spot = omahaRundownReraiseSpot(on.hero, on.gs);
        if (spot && omahaRundownReraiseCell(spot, 'measured') && off.d.action !== 'fold')
          expect(['call', 'fold', 'check']).toContain(on.d.action);
      }
    }
    expect(called).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });
  it('trial: every call in a trial cell becomes a re-raise the validator admits; nothing else moves', () => {
    let raised = 0;
    let kept = 0;
    for (const [variant, n] of [
      ['plo5', 5],
      ['plo4', 4],
    ] as const) {
      const rnd = mulberry32(20261125 + n);
      for (let k = 0; k < 220; k++) {
        const hole = seededHole(rnd, n, k);
        const shape: Shape = { ...SHAPES[k % SHAPES.length]!, variant, lightning: k % 4 === 3 };
        const off = decide(hole, shape, {}, 8500 + k);
        const on = decide(hole, shape, TRIAL_ON, 8500 + k);
        const spot = omahaRundownReraiseSpot(off.hero, off.gs);
        const cell = spot ? omahaRundownReraiseCell(spot, 'trial') : null;
        if (
          off.d.action === 'call' &&
          cell !== null &&
          spot!.raiseTo !== null &&
          (off.d as { omahaPreflopThreeWay?: unknown }).omahaPreflopThreeWay == null
        ) {
          raised++;
          expect(['raise', 'all_in']).toContain(on.d.action);
          expect(on.fires).toContain('omaha_rundown_trial_reraise');
          expect(
            horseDecisionReceiptRefusal(structuredClone(on.d), variant, {
              player: on.hero,
              gameState: on.gs,
            })
          ).toBeNull();
        } else {
          kept++;
          expect(bytesOf(on.d)).toBe(bytesOf(off.d));
          expect(on.next).toBe(off.next);
          expect(on.fires).not.toContain('omaha_rundown_trial_reraise');
        }
      }
    }
    expect(raised).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });
  it('PLO6 is byte-identical with both options on (owner 2026-11-19 8:27 PM: PLO6 is not touched)', () => {
    const rnd = mulberry32(636);
    for (let k = 0; k < 80; k++) {
      const hole = randomHole(rnd, 6, cards(STARTS[k % STARTS.length]!));
      const shape: Shape = { ...SHAPES[k % SHAPES.length]!, variant: 'plo6' };
      const off = decide(hole, shape, {}, 9500 + k);
      const on = decide(hole, shape, { ...MEASURED_ON, ...TRIAL_ON }, 9500 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
      expect(on.fires).not.toContain('omaha_rundown_measured_call');
      expect(on.fires).not.toContain('omaha_rundown_trial_reraise');
    }
  });
  it('a tournament is byte-identical with both options on', () => {
    const rnd = mulberry32(737);
    for (let k = 0; k < 50; k++) {
      const hole = seededHole(rnd, 5, k);
      const shape: Shape = { ...SHAPES[k % SHAPES.length]!, gameMode: 'tournament' };
      const off = decide(hole, shape, {}, 9900 + k);
      const on = decide(hole, shape, { ...MEASURED_ON, ...TRIAL_ON }, 9900 + k);
      expect(bytesOf(on.d)).toBe(bytesOf(off.d));
      expect(on.next).toBe(off.next);
    }
  });
});
