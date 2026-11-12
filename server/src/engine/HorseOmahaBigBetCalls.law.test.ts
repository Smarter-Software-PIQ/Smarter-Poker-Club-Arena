/**
 * V81 OMAHA BIG-BET CALL DISCIPLINE (2026-11-02, Phase 4). See
 * HorseOmahaBigBetCalls.ts for the two-day decision-EV evidence.
 *
 *  1. Exact classification at the decision and exactly the admitted cells.
 *  2. End to end: facing a pot-sized PLO4/PLO5 river bet with a non-nut
 *     straight or a dominated flush, the horse never calls; the off arm is
 *     today's answer; the receipt fires; the fold is a valid signed receipt.
 *  3. Outside the cells the answer is exactly today: a nut straight, a
 *     0.6-pot wager, a heads-up table, tournament two pair, PLO6.
 *  4. Label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  callLargeRiverBoatWager,
  omahaCallClass,
  V81_MIN_CALL_PRICE,
  v81Cell,
  v81StreetWager,
  type V81Input,
} from './HorseOmahaBigBetCalls.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-000000000081';

/** Ring table (a third seat folded preflop); checked to the river; villain bets `bet` into 36. */
function river(
  variant: string,
  hole: string,
  board: string,
  bet: number,
  o: {
    flip?: boolean;
    seats?: 2 | 3;
    mode?: 'cash' | 'tournament';
    heroStack?: number;
    bigBlind?: number;
    /** Chips the folded third seat left in the pot before the river. */
    dead?: number;
  } = {}
) {
  const heroStack = o.heroStack ?? 300;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: heroStack,
      bet: 0,
      totalInvested: 18,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: Math.max(0, 300 - bet),
      bet,
      totalInvested: 18 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: o.flip === true,
    } as SeatPlayer,
  ];
  if ((o.seats ?? 3) === 3)
    players.push({
      seat: 3,
      user_id: 'folder',
      username: 'f',
      stack: 300,
      bet: 0,
      totalInvested: o.dead ?? 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  const history = [
    ...((o.seats ?? 3) === 3
      ? [{ stage: 'preflop', seat: 3, userId: 'folder', action: 'fold', amount: 0, timestamp: 0 }]
      : []),
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 6, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0, timestamp: 7 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: bet, timestamp: 9 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 36 + (o.dead ?? 0) + bet,
      currentBet: bet,
      toCall: bet,
      minRaiseTo: 2 * bet,
      maxRaiseTo: heroStack,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: o.mode ?? 'cash',
      bigBlind: o.bigBlind ?? 2,
      dealerSeat: 1,
      actionHistory: history,
    },
  };
}

function decideMany(s: ReturnType<typeof river>, opts: Record<string, unknown> = {}, seeds = 30) {
  const acts: string[] = [];
  let fires = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 81);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never) as { action: string; amount?: number };
    fires += drainFires().find((r) => r.feature === 'v81_omaha_big_bet_call_fold')?.fires ?? 0;
    acts.push(`${d.action}|${d.amount ?? ''}`);
  }
  return { acts, fires };
}
const calls = (acts: string[]) => acts.filter((a) => a.startsWith('call')).length;
const OFF = { v81OmahaBigBetCalls: false };

// PLO4. Board 9h 8c 7d 2s 3c: no flush possible, unpaired; J-T is the nut straight.
const DRY = '9h8c7d2s3c';
const NONNUT_STRAIGHT = '6s5hKdKc'; // 9-high straight
const NUT_STRAIGHT = 'JsTh4d4c'; // J-high straight, the nuts
// Board Kh 9h 4h 7c 2d: hearts flush possible; Jh 8h is the third-nut flush (Qh 8h would be second).
const FLUSHY = 'Kh9h4h7c2d';
const DOM_FLUSH = 'Jh8hTsTd'; // J-high flush: A and Q live above it, so 3rd nut or worse

describe('V81 Omaha big-bet call discipline', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('classifies at the decision and admits exactly the measured cells', () => {
    expect(omahaCallClass(cards(NONNUT_STRAIGHT), cards(DRY))).toBe('straight_nonnut');
    expect(omahaCallClass(cards(NUT_STRAIGHT), cards(DRY))).toBe('straight_nut');
    expect(omahaCallClass(cards(DOM_FLUSH), cards(FLUSHY))).toBe('flush_dominated');
    expect(omahaCallClass(cards('Ah5h6s6d'), cards(FLUSHY))).toBe('flush_nut');
    expect(omahaCallClass(cards('Qh8hTsTd'), cards(FLUSHY))).toBe('flush_second');
    expect(omahaCallClass(cards('Js8sKs7d'), cards('Ks9h4h7c2d'))).toBe('two_pair');
    const base: V81Input = {
      variant: 'plo4',
      street: 'river',
      hole: cards(NONNUT_STRAIGHT),
      board: cards(DRY),
      potFrac: 1,
      effectiveBB: 150,
      tournament: false,
      headsUpTable: false,
      bountyEvent: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      heroHasStreetChips: false,
      bettorOverBluffs: false,
      callPrice: 1 / 3,
    };
    const at = (hole: string, board: string, o: Partial<V81Input> = {}) =>
      v81Cell({ ...base, hole: cards(hole), board: cards(board), ...o });
    // River cells, every one.
    expect(at(NONNUT_STRAIGHT, DRY)).toBe('straight_nonnut');
    expect(at('6s5hKdKc', '9h8h7d2h3c')).toBe('straight_flushboard'); // three hearts
    expect(at('6s5hKdKc', '9h8c7d2s2c')).toBe('straight_paired');
    expect(at(DOM_FLUSH, FLUSHY)).toBe('flush_dominated');
    expect(at('Ah5h6s6d', 'Kh9h4h7c7d')).toBe('flush_nut_paired');
    expect(at('Qh8hTsTd', 'Kh9h4h7c7d')).toBe('flush_second_paired');
    expect(at('Js8sKs7d', 'Ks9h4h7c2d')).toBe('two_pair');
    expect(at('Js8sKs7d', 'Ks9h4h7c2d', { tournament: true })).toBe('two_pair'); // all formats
    // Unpaired second-nut flush: PLO5 only.
    expect(at('Qh8hTsTd', FLUSHY)).toBeNull();
    expect(at('Qh8hTsTd2c', FLUSHY, { variant: 'plo5' })).toBe('flush_second');
    // Never admitted: nut straight, unpaired nut flush.
    expect(at(NUT_STRAIGHT, DRY)).toBeNull();
    expect(at('Ah5h6s6d', FLUSHY)).toBeNull();
    // Turn cells.
    const turn = { street: 'turn' };
    expect(at(DOM_FLUSH, 'Kh9h4h7c', turn)).toBe('flush_dominated');
    expect(at(DOM_FLUSH, 'Kh9h4h7c', { ...turn, tournament: true })).toBeNull(); // cash only
    expect(at('6s5hKdKc', '9h8c7d7s', turn)).toBe('straight_paired');
    expect(at('6s5hKdKc', '9h8h7h7s', turn)).toBe('straight_flushboard_paired');
    expect(at(NONNUT_STRAIGHT, '9h8c7d2s', turn)).toBeNull(); // straddled on the turn
    expect(at('6s5hKdKc', '9h8h7d2h', turn)).toBeNull(); // turn flush-board straight: straddled
    expect(at('Js8sKs7d', 'Ks9h4h7c', turn)).toBeNull(); // turn two pair: straddled
    // Every exclusion.
    expect(at(NONNUT_STRAIGHT, DRY, { variant: 'plo5' })).toBeNull(); // PLO5 needs five cards
    expect(at('6s5hKdKc2h', DRY, { variant: 'plo5' })).toBe('straight_nonnut');
    expect(at(NONNUT_STRAIGHT, DRY, { potFrac: 0.89 })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { effectiveBB: 20 })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { headsUpTable: true })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { bountyEvent: true })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { heroHasStreetChips: true })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { bettorOverBluffs: true })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { hiLo: true })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { multiBoard: true })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { bombPot: true })).toBeNull();
    // The price floor: the cells were measured on calls a stack could pay in full.
    expect(V81_MIN_CALL_PRICE).toBe(0.13);
    expect(at(NONNUT_STRAIGHT, DRY, { callPrice: V81_MIN_CALL_PRICE })).toBe('straight_nonnut');
    expect(at(NONNUT_STRAIGHT, DRY, { callPrice: 0.129 })).toBeNull();
    expect(at(NONNUT_STRAIGHT, DRY, { callPrice: NaN })).toBeNull();
    expect(at('6s5hKdKc2h3d', DRY, { variant: 'plo6' })).toBeNull();
  });

  it('measures the wager exactly as the evidence did: last bettor, chips added, pot before it', () => {
    const bets = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [+k, v]));
    const h = (...a: Array<[number, string, number]>) =>
      a.map(([seat, action, amount]) => ({ stage: 'river', seat, action, amount }));
    // Heads-up: a pot-sized bet into 100.
    expect(v81StreetWager(h([2, 'bet', 100]), 'river', bets({ 2: 100 }), 200)).toEqual({
      bettorSeat: 2,
      wager: 100,
      potBefore: 100,
    });
    // A caller before the horse does not shrink the bet: still 100 into 100.
    expect(
      v81StreetWager(h([2, 'bet', 100], [3, 'call', 100]), 'river', bets({ 2: 100, 3: 100 }), 300)
    ).toEqual({ bettorSeat: 2, wager: 100, potBefore: 100 });
    // Bet 50, raise to 100, re-raise to 200 by the first bettor (pot 100 before
    // the street): the re-raise added 150 into 250 = 0.6, not 1.0.
    const rr = v81StreetWager(
      h([2, 'bet', 50], [3, 'raise', 100], [2, 'raise', 200]),
      'river',
      bets({ 2: 200, 3: 100 }),
      400
    )!;
    expect(rr.bettorSeat).toBe(2);
    expect(rr.wager / rr.potBefore).toBeCloseTo(0.6, 6);
    // An all-in CALL is not the bettor.
    expect(
      v81StreetWager(h([2, 'bet', 100], [3, 'all_in', 100]), 'river', bets({ 2: 100, 3: 100 }), 300)
        ?.bettorSeat
    ).toBe(2);
    // Earlier streets are ignored.
    expect(
      v81StreetWager(
        [{ stage: 'turn', seat: 2, action: 'bet', amount: 40 }, ...h([2, 'bet', 100])],
        'river',
        bets({ 2: 100 }),
        280
      )
    ).toEqual({ bettorSeat: 2, wager: 100, potBefore: 180 });
    // Any doubt is no fold: no bet, history that does not match the table,
    // a pot that cannot hold the bet, no history at all.
    expect(v81StreetWager(h([2, 'check', 0]), 'river', bets({}), 100)).toBeNull();
    expect(v81StreetWager(h([2, 'bet', 100]), 'river', bets({ 2: 60 }), 200)).toBeNull();
    expect(v81StreetWager(h([2, 'bet', 100]), 'river', bets({ 2: 100 }), 100)).toBeNull();
    expect(v81StreetWager(h([2, 'bet', 100]), 'river', bets({ 2: 100 }), 0)).toBeNull();
    expect(v81StreetWager(undefined, 'river', bets({ 2: 100 }), 200)).toBeNull();
  });

  it('facing a pot-sized river bet, a non-nut straight and a dominated flush never call; off is today', () => {
    let offCalls = 0;
    for (const [hole, board] of [
      [NONNUT_STRAIGHT, DRY],
      [DOM_FLUSH, FLUSHY],
    ]) {
      const s = river('plo4', hole, board, 36);
      const on = decideMany(s);
      const off = decideMany(s, OFF);
      expect(calls(on.acts), hole).toBe(0);
      expect(off.fires, hole).toBe(0);
      offCalls += calls(off.acts);
      if (calls(off.acts) > 0) expect(on.fires, hole).toBeGreaterThan(0);
      // Every answer that was not a call is unchanged.
      on.acts.forEach((a, k) => {
        if (!off.acts[k].startsWith('call')) expect(a).toBe(off.acts[k]);
      });
    }
    // The fixture is not vacuous: today's brain calls these spots.
    expect(offCalls).toBeGreaterThan(0);
  });

  it('a stack too short to pay the wager keeps its priced-in call (HVH2D-PLO-005)', () => {
    // Hand 58724590 in shape: a third seat left 120 in the pot, the villain pots the river
    // for 156 and the horse has 44 (22bb) behind: it pays 44 into 356, a price of 0.11.
    const short = river('plo4', NONNUT_STRAIGHT, DRY, 156, { heroStack: 44, dead: 120 });
    const on = decideMany(short);
    const off = decideMany(short, OFF);
    expect(on.fires).toBe(0);
    expect(on.acts).toEqual(off.acts);
    expect(on.acts.filter((a) => a.startsWith('fold')).length).toBe(0);
    // The same pot and wager with a stack that pays 0.2 of the final pot is still the
    // measured cell: the floor moves nothing above it.
    const deeper = river('plo4', NONNUT_STRAIGHT, DRY, 156, { heroStack: 80, dead: 120 });
    const folded = decideMany(deeper);
    expect(folded.fires).toBeGreaterThan(0);
    expect(folded.acts.filter((a) => a.startsWith('call') || a.startsWith('all_in')).length).toBe(
      0
    );
    expect(
      calls(decideMany(deeper, OFF).acts) +
        decideMany(deeper, OFF).acts.filter((a) => a.startsWith('all_in')).length
    ).toBeGreaterThan(0);
  });

  it('the fold is a valid signed policy receipt', () => {
    const s = river('plo4', NONNUT_STRAIGHT, DRY, 36);
    for (let seed = 1; seed <= 10; seed++) {
      seedFastRandom(seed);
      HorseMind.reset();
      const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, { mind: false } as never);
      expect(d.action).not.toBe('call');
      expect(
        horseDecisionReceiptIsValid(d, 'plo4', { player: s.hero, gameState: s.gs as never })
      ).toBe(true);
    }
  });

  it('outside the cells the answer is exactly today, and today calls there', () => {
    const cases: Array<[string, ReturnType<typeof river>]> = [
      ['nut straight', river('plo4', NUT_STRAIGHT, DRY, 36)],
      ['0.6-pot wager', river('plo4', NONNUT_STRAIGHT, DRY, 22)],
      ['heads-up table', river('plo4', NONNUT_STRAIGHT, DRY, 36, { seats: 2 })],
      ['PLO6', river('plo6', '6s5hKdKc2h3d', DRY, 36)],
      ['20bb effective', river('plo4', NONNUT_STRAIGHT, DRY, 36, { heroStack: 40 })],
      ['unpaired nut flush', river('plo4', 'Ah5h6s6d', FLUSHY, 36)],
    ];
    let todayCalls = 0;
    for (const [label, s] of cases) {
      const on = decideMany(s, {}, 15);
      const off = decideMany(s, OFF, 15);
      expect(on.acts, label).toEqual(off.acts);
      expect(on.fires, label).toBe(0);
      todayCalls += calls(off.acts);
    }
    // Not vacuous: today's brain does call in these spots, and V81 leaves it.
    expect(todayCalls).toBeGreaterThan(0);
  });

  it('a call that is an all-in for the whole stack folds the same way', () => {
    // 36 to call with exactly 36 behind (36bb at a 1-chip big blind): the
    // only "call" is all in.
    const s = river('plo4', NONNUT_STRAIGHT, DRY, 36, { heroStack: 36, bigBlind: 1 });
    const off = decideMany(s, OFF);
    const on = decideMany(s);
    const putIn = (acts: string[]) =>
      acts.filter((a) => a.startsWith('call') || a.startsWith('all_in')).length;
    expect(putIn(off.acts)).toBeGreaterThan(0); // today calls it off
    expect(putIn(on.acts)).toBe(0);
  });

  it('one policy: label flips never change the answer', () => {
    for (const [hole, board] of [
      [NONNUT_STRAIGHT, DRY],
      [NUT_STRAIGHT, DRY],
    ]) {
      expect(decideMany(river('plo4', hole, board, 36, { flip: true }), {}, 15).acts).toEqual(
        decideMany(river('plo4', hole, board, 36), {}, 15).acts
      );
    }
  });
});

describe('closing a checked cash PLO6 river with a non-bottom boat', () => {
  function checked(hole = '9d4hJd9cJh7h', board = '9hAdAs6d2c', size = 11) {
    const { hero, gs } = river('plo6', hole, board, size);
    return {
      hero,
      gs: {
        ...gs,
        stateSchemaVersion: 1,
        boardCount: 1,
        wagersCapped: false,
        currentPlayerSeat: hero.seat,
        pot: 22 + size,
      } as unknown as Parameters<typeof callLargeRiverBoatWager>[2],
    };
  }
  const fold = { action: 'fold', thinkTime: 0 } as const;

  it('recovers the fold at half pot, preserving the voluntary call and raise', () => {
    const { hero, gs } = checked();
    expect(callLargeRiverBoatWager(fold, hero, gs)).toMatchObject({ action: 'call', amount: 11 });
    for (const action of ['call', 'raise'] as const) {
      const prior = { action, amount: action === 'call' ? 11 : 50, thinkTime: 0 };
      expect(callLargeRiverBoatWager(prior, hero, gs)).toBe(prior);
    }
  });

  it('keeps folds outside the hand, price and closing-action boundaries', () => {
    const { hero, gs } = checked();
    const noPriorCheck = gs.actionHistory!.filter(
      (a) => a.stage !== 'river' || a.action !== 'check'
    );
    for (const other of [
      { ...gs, gameMode: 'tournament' as const },
      { ...gs, gameVariant: 'plo5' as const },
      { ...gs, boardCount: 2 },
      { ...gs, actionHistory: noPriorCheck },
      { ...gs, currentPlayerSeat: 2 },
      { ...gs, legalActions: ['fold' as const] },
      { ...gs, players: gs.players.map((p) => ({ ...p, is_folded: false })) },
      { ...gs, wagersCapped: true },
      checked(undefined, undefined, 10.99).gs,
    ])
      expect(callLargeRiverBoatWager(fold, hero, other)).toBe(fold);
    expect(callLargeRiverBoatWager(fold, { ...hero, stack: 11 }, gs)).toBe(fold);
    for (const [hole, board] of [
      ['2d2h4d4c7h8c', '9hAdAs6d2c'], // bottom full
      ['AcAh4d4c7h8c', '9hAdAs6d2c'], // unbeatable quads
      ['9d4hJd9cJh7h', 'AhAdAs6d2c'], // board trips
    ]) {
      const spot = checked(hole, board);
      expect(callLargeRiverBoatWager(fold, spot.hero, spot.gs)).toBe(fold);
    }
  });
});
