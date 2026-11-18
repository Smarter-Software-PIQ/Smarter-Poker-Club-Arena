/**
 * PLO6: a multiway bet with a weak made hand and no draw becomes a check
 * (HorsePlo6MultiwayWeakBet.ts, option plo6NoMultiwayBetWithWeakMadeHand).
 * These cases call the module directly; the option through HorseLogic.decide
 * is HorsePlo6MultiwayWeakBetWiring.test.ts. Every hand and board here is
 * invented.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  PLO6_MULTIWAY_WEAK_BET_RECEIPT,
  plo6MultiwayWeakBetSpot,
  plo6NoMultiwayBetWithWeakMadeHand,
  plo6QualifyingDraw,
  plo6WeakMadeHand,
} from './HorsePlo6MultiwayWeakBet.js';
import { omahaDrawQuality } from './HorseEval.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';

/**
 * An invented game name that the variant table reads as six-card pot-limit
 * Omaha high, exactly as it reads 'plo6'. No such name exists (six hole cards
 * imply 'plo6' today), so the rule's own name check can only be tested alone
 * this way: with it removed, a hand under this name would pass every other
 * gate of the spot. Every real name is answered by the real table.
 */
const SIX_CARD_OMAHA_UNDER_ANOTHER_NAME = 'six_card_omaha_test_name';
vi.mock('./HorseEval.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./HorseEval.js')>();
  return {
    ...actual,
    variantInfo: (name: string) =>
      actual.variantInfo(name === 'six_card_omaha_test_name' ? 'plo6' : name),
  };
});

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]] }));

function seat(n: number, extra: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    seat: n,
    user_id: `p${n}`,
    username: `p${n}`,
    stack: 200,
    bet: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    ...extra,
  } as SeatPlayer;
}

/** A dry flop: no pair, three suits, no three ranks inside five. */
const FLOP = 'Ks9d4c';
/** A pocket pair of sevens under the king, nothing else. */
const UNDERPAIR = '7h7cQd6s3h2c';
/** Nines and fours: the two lowest ranks of the flop. */
const BOTTOM_TWO = '9h4dQc7s3h2c';

interface Over {
  board?: string;
  stage?: string;
  variant?: string;
  /** seats 4 and 5 are the opponents; fold seat 5 for heads-up */
  headsUp?: boolean;
  gs?: Record<string, unknown>;
}

/** Hero seat 3 first to act on the flop, a 24-chip pot, seats 4 and 5 behind. */
function spot(hole: string, o: Over = {}) {
  const hero = seat(3, { cards: cards(hole) });
  const players = [
    seat(1, { is_folded: true }),
    hero,
    seat(4),
    seat(5, { is_folded: o.headsUp === true }),
  ];
  const gs = {
    stateSchemaVersion: 1,
    players,
    communityCards: cards(o.board ?? FLOP),
    pot: 24,
    currentBet: 0,
    toCall: 0,
    legalActions: ['check', 'bet', 'all_in'],
    stage: o.stage ?? 'flop',
    gameVariant: o.variant ?? 'plo6',
    gameMode: 'cash',
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 1,
    actionHistory: [],
    ...o.gs,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

const bet = (): HorseDecision => ({ action: 'bet', amount: 16, thinkTime: 1200 });

function run(hole: string, o: Over = {}, decision: HorseDecision = bet()) {
  const { hero, gs } = spot(hole, o);
  return { decision, out: plo6NoMultiwayBetWithWeakMadeHand(decision, hero, gs), hero, gs };
}

function expectKept(hole: string, o: Over = {}, decision: HorseDecision = bet()) {
  const r = run(hole, o, decision);
  expect(r.out.changed).toBeNull();
  // Not converted: the very same object comes back.
  expect(r.out.decision).toBe(r.decision);
  expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)).toBeNull();
}

describe('the bet becomes a check in the spot', () => {
  it('a pocket pair under the top card, three-way on the flop', () => {
    const r = run(UNDERPAIR);
    expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)).toEqual({
      street: 'flop',
      hand: 'underpair',
      liveOpponents: 2,
    });
    expect(r.out.changed).toBe('bet_checked');
    expect(r.out.decision.action).toBe('check');
    expect('amount' in r.out.decision).toBe(false);
    // Everything else on the decision is carried over, and the input is not mutated.
    expect(r.out.decision.thinkTime).toBe(1200);
    expect(r.decision).toEqual({ action: 'bet', amount: 16, thinkTime: 1200 });
  });

  it('bottom two pair', () => {
    const r = run(BOTTOM_TWO);
    expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)?.hand).toBe('bottom_two_pair');
    expect(r.out.changed).toBe('bet_checked');
    expect(r.out.decision.action).toBe('check');
  });

  it('a pair with a board card below the top card', () => {
    const r = run('9hQc7s6d3h2c');
    expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)?.hand).toBe('low_pair');
    expect(r.out.changed).toBe('bet_checked');
  });

  it("the board's own pair with a pocket pair under the top card", () => {
    const r = run(UNDERPAIR, { board: 'KsKd4c' });
    expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)?.hand).toBe('underpair_on_paired_board');
    expect(r.out.changed).toBe('bet_checked');
  });

  it("the board's own pair with a pair of the low board card", () => {
    const r = run('4hQc7s6d3h2c', { board: 'KsKd4c' });
    expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)?.hand).toBe('low_pair_on_paired_board');
    expect(r.out.changed).toBe('bet_checked');
  });

  it('on the turn', () => {
    const r = run(UNDERPAIR, { board: 'Ks9d4cJh', stage: 'turn' });
    expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)).toEqual({
      street: 'turn',
      hand: 'underpair',
      liveOpponents: 2,
    });
    expect(r.out.changed).toBe('bet_checked');
  });

  it('in a tournament (a check adds no chips)', () => {
    const r = run(UNDERPAIR, {
      gs: { gameMode: 'tournament', tournament: { playersLeft: 40 }, bigBlind: 200 },
    });
    expect(r.out.changed).toBe('bet_checked');
  });

  it('an opening wager under another name (all in with nothing to call)', () => {
    const r = run(UNDERPAIR, {}, { action: 'all_in', amount: 200, thinkTime: 900 });
    expect(r.out.changed).toBe('bet_checked');
    expect(r.out.decision.action).toBe('check');
  });

  it('with a flush draw that is not to the nuts and no straight draw', () => {
    const hole = '7h7cQs6s3h2c';
    expect(plo6QualifyingDraw(cards(hole), cards('Ks9s4c'))).toBe(false);
    expect(run(hole, { board: 'Ks9s4c' }).out.changed).toBe('bet_checked');
  });

  it('with a gutshot that is not to the nuts and no flush draw', () => {
    // Fours under the nine; six-five needs a seven, and jack-ten beats it.
    const hole = '4h4c6d5sKhQd';
    const draw = omahaDrawQuality(cards(hole), cards('9s8d3c'));
    expect(draw).toMatchObject({
      straightOuts: 4,
      nutStraightOuts: 0,
      nutFlushDraw: false,
      dominatedFlushDraw: false,
    });
    expect(plo6WeakMadeHand(cards(hole), cards('9s8d3c'))).toBe('underpair');
    expect(plo6QualifyingDraw(cards(hole), cards('9s8d3c'))).toBe(false);
    expect(run(hole, { board: '9s8d3c' }).out.changed).toBe('bet_checked');
  });

  it('with a flush draw that is not to the nuts and under four straight outs', () => {
    const hole = '7h7cQs6s3h2c';
    const draw = omahaDrawQuality(cards(hole), cards('Ks9s4c'));
    expect(draw.dominatedFlushDraw).toBe(true);
    expect(draw.nutFlushDraw).toBe(false);
    expect(draw.straightOuts).toBeLessThan(4);
    expect(plo6QualifyingDraw(cards(hole), cards('Ks9s4c'))).toBe(false);
  });

  it('bottom two pair on the flop is the same class after a turn card that does not pair it', () => {
    const flop = run(BOTTOM_TWO);
    expect(plo6MultiwayWeakBetSpot(flop.hero, flop.gs)?.hand).toBe('bottom_two_pair');
    expect(flop.out.changed).toBe('bet_checked');
    const turn = run(BOTTOM_TWO, { board: 'Ks9d4cJd', stage: 'turn' });
    expect(plo6MultiwayWeakBetSpot(turn.hero, turn.gs)).toEqual({
      street: 'turn',
      hand: 'bottom_two_pair',
      liveOpponents: 2,
    });
    expect(turn.out.changed).toBe('bet_checked');
  });

  it('counts an all-in opponent as live', () => {
    const { hero, gs } = spot(UNDERPAIR);
    gs.players[2].is_all_in = true;
    expect(plo6MultiwayWeakBetSpot(hero, gs)?.liveOpponents).toBe(2);
  });
});

describe('the decision stands, as the same object', () => {
  it('heads-up', () => {
    expectKept(UNDERPAIR, { headsUp: true });
    expectKept(BOTTOM_TWO, { headsUp: true });
  });

  it('an opponent sitting out is not a live opponent', () => {
    const { hero, gs } = spot(UNDERPAIR);
    gs.players[3].is_sitting_out = true;
    const d = bet();
    expect(plo6NoMultiwayBetWithWeakMadeHand(d, hero, gs).decision).toBe(d);
  });

  it('PLO5 and PLO4, by name and by hand size', () => {
    expectKept(UNDERPAIR, { variant: 'plo5' });
    expectKept(UNDERPAIR, { variant: 'plo4' });
    expectKept('7h7cQd6s3h', { variant: 'plo5' });
    expectKept('7h7cQd6s', { variant: 'plo4' });
    // Six-card Omaha with the wrong number of cards is not judged either.
    expectKept('7h7cQd6s3h', { variant: 'plo6' });
  });

  it('six-card Omaha under any name but plo6 (the name check alone)', () => {
    // The mocked table reads this name as it reads plo6, so only the rule's
    // own name check can refuse it.
    const { hero, gs } = spot(UNDERPAIR, { variant: SIX_CARD_OMAHA_UNDER_ANOTHER_NAME });
    expect(plo6WeakMadeHand(hero.cards, gs.communityCards)).toBe('underpair');
    expect(plo6QualifyingDraw(hero.cards, gs.communityCards)).toBe(false);
    expectKept(UNDERPAIR, { variant: SIX_CARD_OMAHA_UNDER_ANOTHER_NAME });
    expectKept(BOTTOM_TWO, { variant: SIX_CARD_OMAHA_UNDER_ANOTHER_NAME });
    // The control: the very same node under the name plo6 is the spot.
    expect(run(UNDERPAIR, { variant: 'plo6' }).out.changed).toBe('bet_checked');
    expect(run(UNDERPAIR, { variant: 'PLO6' }).out.changed).toBe('bet_checked');
  });

  it('hi-lo', () => {
    expectKept(UNDERPAIR, { gs: { variantRules: { splitLow8OrBetter: true } } });
    expectKept(UNDERPAIR, { variant: 'plo8' });
  });

  it('a bomb pot', () => {
    expectKept(UNDERPAIR, { gs: { bombPot: true } });
  });

  it('more than one board', () => {
    expectKept(UNDERPAIR, { gs: { boardCount: 2 } });
    expectKept(UNDERPAIR, { gs: { communityCards2: cards('Ah8d5c') } });
    expectKept(UNDERPAIR, { gs: { communityCards3: cards('Ah8d5c') } });
  });

  it('all-in-or-fold', () => {
    expectKept(UNDERPAIR, { gs: { allInOrFold: true } });
  });

  it('fixed limit', () => {
    expectKept(UNDERPAIR, { gs: { bettingStructure: 'fixed_limit' } });
  });

  it('the nut flush draw', () => {
    const hole = '7h7cAs6s3h2c';
    expect(plo6WeakMadeHand(cards(hole), cards('Ks9s4c'))).toBe('underpair');
    expect(plo6QualifyingDraw(cards(hole), cards('Ks9s4c'))).toBe(true);
    expectKept(hole, { board: 'Ks9s4c' });
  });

  it('a combo draw: a flush draw that is not to the nuts with an open-ended straight draw', () => {
    // Sevens under the ten, eight-seven open-ended on ten-nine, king-high spades.
    const hole = '7h7c8dKs2s4d';
    const board = 'Ts9s3c';
    const draw = omahaDrawQuality(cards(hole), cards(board));
    // The two spade straight cards make a flush, so they are not straight outs.
    expect(draw).toMatchObject({ straightOuts: 6, nutFlushDraw: false, dominatedFlushDraw: true });
    expect(draw.nutStraightOuts).toBeLessThan(4);
    expect(plo6WeakMadeHand(cards(hole), cards(board))).toBe('underpair');
    expect(plo6QualifyingDraw(cards(hole), cards(board))).toBe(true);
    expectKept(hole, { board });
    // The same flush draw with three straight outs instead is not a combo draw.
    const thin = '7h7cQdKs2s4d';
    expect(omahaDrawQuality(cards(thin), cards(board))).toMatchObject({
      straightOuts: 3,
      dominatedFlushDraw: true,
    });
    expect(plo6QualifyingDraw(cards(thin), cards(board))).toBe(false);
  });

  it('a wrap', () => {
    const hole = '5h5cJdTs7h6c';
    expect(plo6WeakMadeHand(cards(hole), cards('9s8d2c'))).toBe('underpair');
    expect(plo6QualifyingDraw(cards(hole), cards('9s8d2c'))).toBe(true);
    expectKept(hole, { board: '9s8d2c' });
  });

  it('four outs to the nut straight', () => {
    const hole = '7h7cQdJs3h2c';
    expect(plo6WeakMadeHand(cards(hole), cards(FLOP))).toBe('underpair');
    expect(plo6QualifyingDraw(cards(hole), cards(FLOP))).toBe(true);
    expectKept(hole);
  });

  it('a nut-class hand', () => {
    // The nut straight on an unpaired board with no possible flush.
    const s = spot('QhJc7d6s3h2c', { board: 'KsTd9c' });
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
    expectKept('QhJc7d6s3h2c', { board: 'KsTd9c' });
  });

  it('top set', () => {
    const s = spot('KhKdQc7s3h2c');
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
    expectKept('KhKdQc7s3h2c');
  });

  it('a hand above the weak class: top pair, top two, top and bottom, a set', () => {
    expectKept('KhQc7s6d3h2c');
    expectKept('Kh9hQc7s3h2c');
    expectKept('Kh4dQc7s3h2c');
    // Top and any other pair is never caught on the turn either.
    for (const hole of ['Kh9hQc7s3h2c', 'Kh4dQc7s3h2c', 'KhJcQc7s3h2c']) {
      expect(plo6WeakMadeHand(cards(hole), cards('Ks9d4cJd'))).toBeNull();
      expectKept(hole, { board: 'Ks9d4cJd', stage: 'turn' });
    }
    expectKept('4h4dQc7s3h2c');
    expectKept('KhQc7s6d3h2c', { board: 'KsKd4c' });
  });

  it('no pair of its own', () => {
    expectKept('AhQc7s6d3h2c');
    expectKept('AhQc7s6d3h2c', { board: 'KsKd4c' });
  });

  it('facing a bet', () => {
    const facing = {
      toCall: 12,
      currentBet: 12,
      pot: 36,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
    };
    expectKept(UNDERPAIR, { gs: facing }, { action: 'raise', amount: 48, thinkTime: 0 });
    expectKept(UNDERPAIR, { gs: facing }, { action: 'call', amount: 12, thinkTime: 0 });
    // toCall absent: read from the standing bet.
    expectKept(
      UNDERPAIR,
      { gs: { toCall: undefined, currentBet: 12 } },
      { action: 'raise', amount: 48, thinkTime: 0 }
    );
  });

  it('a check is not legal', () => {
    expectKept(UNDERPAIR, { gs: { legalActions: ['bet', 'all_in'] } });
  });

  it('the decision is already a check, or a fold', () => {
    const { hero, gs } = spot(UNDERPAIR);
    expect(plo6MultiwayWeakBetSpot(hero, gs)).not.toBeNull();
    for (const action of ['check', 'fold', 'call'] as const) {
      const d: HorseDecision = { action, thinkTime: 0 };
      const out = plo6NoMultiwayBetWithWeakMadeHand(d, hero, gs);
      expect(out.changed).toBeNull();
      expect(out.decision).toBe(d);
    }
  });

  it('the river and preflop', () => {
    expectKept(UNDERPAIR, { board: 'Ks9d4cJh8s', stage: 'river' });
    expectKept(UNDERPAIR, { board: '', stage: 'preflop' });
  });

  it('a board that does not match the street', () => {
    expectKept(UNDERPAIR, { board: 'Ks9d4cJh', stage: 'flop' });
  });
});

describe('the overpair (a pocket pair above an unpaired board)', () => {
  /** A dry queen-high flop: three suits, no three ranks inside five. */
  const Q_FLOP = 'Qs8d3c';
  /** Aces over it, no flush draw, no straight out. */
  const ACES = 'AhAc9d6s4h2c';
  /** Kings over it, no flush draw, no straight out. */
  const KINGS = 'KhKc9d6s4h2c';

  it('with no draw, three-way: the bet becomes a check on the flop and the turn', () => {
    for (const hole of [ACES, KINGS]) {
      expect(plo6QualifyingDraw(cards(hole), cards(Q_FLOP))).toBe(false);
      const r = run(hole, { board: Q_FLOP });
      expect(plo6MultiwayWeakBetSpot(r.hero, r.gs)).toEqual({
        street: 'flop',
        hand: 'overpair',
        liveOpponents: 2,
      });
      expect(r.out.changed).toBe('bet_checked');
      expect(r.out.decision.action).toBe('check');
    }
    const turn = run(ACES, { board: 'Qs8d3cJh', stage: 'turn' });
    expect(plo6MultiwayWeakBetSpot(turn.hero, turn.gs)?.hand).toBe('overpair');
    expect(turn.out.changed).toBe('bet_checked');
    // A pair of tens over a nine-high board is the same class as aces.
    const tens = run('ThTc7d5s3h2c', { board: '9s6d2h' });
    expect(plo6WeakMadeHand(tens.hero.cards, tens.gs.communityCards)).toBe('overpair');
  });

  it('with a flush draw that is not to the nuts and no straight draw: still a check', () => {
    const hole = 'AhAcKs6s4h2c';
    const board = 'Qs8s3c';
    expect(omahaDrawQuality(cards(hole), cards(board))).toMatchObject({
      nutFlushDraw: false,
      dominatedFlushDraw: true,
    });
    expect(plo6QualifyingDraw(cards(hole), cards(board))).toBe(false);
    expect(run(hole, { board }).out.changed).toBe('bet_checked');
  });

  it('heads-up the bet is kept', () => {
    expect(plo6WeakMadeHand(cards(ACES), cards(Q_FLOP))).toBe('overpair');
    expectKept(ACES, { board: Q_FLOP, headsUp: true });
  });

  it('the nut flush draw keeps the bet', () => {
    const hole = 'AsAc9d6s4h2c';
    const board = 'Qs8s3c';
    expect(plo6WeakMadeHand(cards(hole), cards(board))).toBe('overpair');
    expect(omahaDrawQuality(cards(hole), cards(board)).nutFlushDraw).toBe(true);
    expectKept(hole, { board });
  });

  it('eight or more straight outs keep the bet', () => {
    // Kings over queen-jack with ten-nine: an ace-less open-ended draw.
    const hole = 'KhKcTd9s4h2c';
    const board = 'QsJd3c';
    expect(plo6WeakMadeHand(cards(hole), cards(board))).toBe('overpair');
    expect(omahaDrawQuality(cards(hole), cards(board)).straightOuts).toBeGreaterThanOrEqual(8);
    expectKept(hole, { board });
  });

  it('four outs to the nut straight keep the bet', () => {
    // Aces over king-queen with a jack: any ten makes the nut straight.
    const hole = 'AhAcJd6s4h2c';
    const board = 'KsQd3c';
    const draw = omahaDrawQuality(cards(hole), cards(board));
    expect(draw.straightOuts).toBeLessThan(8);
    expect(draw.nutStraightOuts).toBeGreaterThanOrEqual(4);
    expect(plo6WeakMadeHand(cards(hole), cards(board))).toBe('overpair');
    expectKept(hole, { board });
  });

  it('a combo draw (a flush draw of any rank with four or more straight outs) keeps the bet', () => {
    // Queens over ten-nine, king-high spades, and two gutshots (a jack or a
    // seven) whose spade cards make the flush and are not counted.
    const hole = 'QhQc8d6dKs2s';
    const board = 'Ts9s3c';
    const draw = omahaDrawQuality(cards(hole), cards(board));
    expect(draw).toMatchObject({ nutFlushDraw: false, dominatedFlushDraw: true });
    expect(draw.straightOuts).toBeGreaterThanOrEqual(4);
    expect(draw.straightOuts).toBeLessThan(8);
    expect(draw.nutStraightOuts).toBeLessThan(4);
    expect(plo6WeakMadeHand(cards(hole), cards(board))).toBe('overpair');
    expectKept(hole, { board });
  });

  it('on a paired board the pocket pair above it is not in the class', () => {
    expect(plo6WeakMadeHand(cards(ACES), cards('QsQd3c'))).toBeNull();
    expectKept(ACES, { board: 'QsQd3c' });
    expect(plo6WeakMadeHand(cards(ACES), cards('Qs8d3c3h'))).toBeNull();
    expectKept(ACES, { board: 'Qs8d3c3h', stage: 'turn' });
  });

  it('a set, top pair and top two pair are untouched beside it', () => {
    // A set of aces is not one pair.
    expect(plo6WeakMadeHand(cards(ACES), cards('As8d3c'))).toBeNull();
    expectKept(ACES, { board: 'As8d3c' });
    // Top pair with an ace kicker.
    expect(plo6WeakMadeHand(cards('AhQc9d6s4h2c'), cards(Q_FLOP))).toBeNull();
    expectKept('AhQc9d6s4h2c', { board: Q_FLOP });
    // Top two pair.
    expect(plo6WeakMadeHand(cards('Qh8c9d6s4h2c'), cards(Q_FLOP))).toBeNull();
    expectKept('Qh8c9d6s4h2c', { board: Q_FLOP });
    // Exactly two hole cards play: aces with a queen beside them is top pair
    // or a pair of aces, and the aces are the best hand.
    expect(plo6WeakMadeHand(cards('AhAcQd6s4h2c'), cards(Q_FLOP))).toBe('overpair');
  });

  it('facing a bet, on the river and in PLO5 nothing changes', () => {
    expectKept(ACES, { board: Q_FLOP, gs: { toCall: 8, currentBet: 8 } });
    expectKept(ACES, { board: 'Qs8d3cJh7s', stage: 'river' });
    expectKept('AhAc9d6s4h', { board: Q_FLOP, variant: 'plo5' });
  });
});

describe('the hand classes', () => {
  const cls = (hole: string, board: string) => plo6WeakMadeHand(cards(hole), cards(board));

  it('reads the best two hole cards, not the first pair it finds', () => {
    // A pocket pair under the board and a king: top pair plays.
    expect(cls('7h7cKhQd3h2c', FLOP)).toBeNull();
    // Two pocket pairs under the top card: still one pair, an underpair.
    expect(cls('7h7c6d6sQh2c', FLOP)).toBe('underpair');
    // A pocket pair between the board cards is an underpair to the top card.
    expect(cls('JhJcQd6s3h2c', FLOP)).toBe('underpair');
  });

  it('on the turn any two pair without the top card is the weak two pair', () => {
    expect(cls('4h2dQc7s6h5c', 'Ks9d4c2s')).toBe('bottom_two_pair');
    // The flop's bottom two (nines and fours) after a deuce: still weak.
    expect(cls('9h4dQc7s6h5c', 'Ks9d4c')).toBe('bottom_two_pair');
    expect(cls('9h4dQc7s6h5c', 'Ks9d4c2s')).toBe('bottom_two_pair');
    expect(cls('9h2dQc7s6h5c', 'Ks9d4c2s')).toBe('bottom_two_pair');
    // Three hole cards pair the board: the best two pair decides.
    expect(cls('9h4d2dQc7s6h', 'Ks9d4c2s')).toBe('bottom_two_pair');
    expect(cls('Kh4d2dQc7s6h', 'Ks9d4c2s')).toBeNull();
    // With the top card it is not weak, whatever the other pair.
    expect(cls('Kh9hQc7s6h5c', 'Ks9d4c2s')).toBeNull();
    expect(cls('Kh2dQc7s6h5c', 'Ks9d4c2s')).toBeNull();
  });

  it('on the flop the weak two pair stays the two lowest ranks', () => {
    expect(cls('9h4dQc7s3h2c', FLOP)).toBe('bottom_two_pair');
    expect(cls('Kh9hQc7s3h2c', FLOP)).toBeNull();
    expect(cls('Kh4dQc7s3h2c', FLOP)).toBeNull();
  });

  it('two hole cards that pair two board cards above the board pair are a real two pair', () => {
    expect(cls('Kh9hQc7s6h5c', 'Ks9d4c4s')).toBeNull();
    // With the board pair on top, the same shape is the board pair plus a low pair.
    expect(cls('9h4hQc7s6h5c', 'KsKd9c4s')).toBe('low_pair_on_paired_board');
  });

  it('is not asked off a flop or turn board, or with other than six cards', () => {
    expect(cls(UNDERPAIR, 'Ks9d4cJh8s')).toBeNull();
    expect(cls('7h7cQd6s3h', FLOP)).toBeNull();
  });
});

describe('the contract', () => {
  it('names the receipt', () => {
    expect(PLO6_MULTIWAY_WEAK_BET_RECEIPT).toBe('plo6_multiway_weak_made_hand_bet_checked');
  });

  it('answers the same on every call (no random draw, no state)', () => {
    const a = run(UNDERPAIR).out;
    const b = run(UNDERPAIR).out;
    expect(a).toEqual(b);
  });

  it('a broken node keeps the decision', () => {
    const { hero, gs } = spot(UNDERPAIR);
    (gs as unknown as { players: unknown }).players = null;
    const d = bet();
    expect(plo6NoMultiwayBetWithWeakMadeHand(d, hero, gs).decision).toBe(d);
  });
});

describe('Lightning PLO6 cash is a PLO6 cash table for this rule', () => {
  // A Lightning table is flagged by its public memory domain's speed
  // (HorseLightningParticipation.ts reads the same field). The Lightning
  // participation rules are preflop and Hold'em / PLO4 / PLO5 only; no
  // Lightning rule owns a PLO6 flop or turn bet, so the rule is not excluded
  // there and must read the spot exactly as at a regular table.
  const LIGHTNING = { publicMemoryDomain: { speed: 'lightning' } };
  const REGULAR = { publicMemoryDomain: { speed: 'regular' } };
  const TURN = 'Ks9d4c2h';
  const rows: Array<[string, string, Over]> = [
    ['underpair on the flop', UNDERPAIR, {}],
    ['bottom two on the flop', BOTTOM_TWO, {}],
    ['underpair on the turn', UNDERPAIR, { board: TURN, stage: 'turn' }],
    ['heads-up (outside the spot)', UNDERPAIR, { headsUp: true }],
    ['top set (outside the spot)', 'KhKcQd6s3h2c', {}],
  ];
  it.each(rows)('%s: same spot, same result', (_name, hole, o) => {
    const plain = run(hole, o);
    const regular = run(hole, { ...o, gs: REGULAR });
    const lightning = run(hole, { ...o, gs: LIGHTNING });
    const spotOf = (r: typeof plain) => plo6MultiwayWeakBetSpot(r.hero, r.gs);
    expect(spotOf(lightning)).toEqual(spotOf(plain));
    expect(spotOf(regular)).toEqual(spotOf(plain));
    expect(lightning.out.changed).toBe(plain.out.changed);
    expect(lightning.out.decision.action).toBe(plain.out.decision.action);
    expect(lightning.out.decision.amount).toBe(plain.out.decision.amount);
  });
  it('the rule and the six-card port modules read no table-speed field', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of [
      'HorsePlo6MultiwayWeakBet.ts',
      'HorsePlo6PricingPort.ts',
      'HorseOmahaFacingBetEv.ts',
      'HorseOmahaRiverMediumBetCalls.ts',
      'HorseOmahaOopReraisedPot.ts',
      'HorseOmahaReraisedPot.ts',
      'HorseOmahaUnderpair.ts',
      'HorseOmahaOopChecks.ts',
      'HorseOmahaStrongHandValue.ts',
      'HorsePloPairedBoardFold.ts',
      'HorseOmahaStrategyGame.ts',
    ]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/publicMemoryDomain|lightning/i);
    }
  });
});
