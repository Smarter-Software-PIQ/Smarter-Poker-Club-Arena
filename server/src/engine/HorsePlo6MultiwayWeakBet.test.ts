/**
 * PLO6: a multiway bet with a weak made hand and no draw becomes a check
 * (HorsePlo6MultiwayWeakBet.ts, option plo6NoMultiwayBetWithWeakMadeHand; the
 * module is not wired into HorseLogic at this commit, so these cases call it
 * directly). Every hand and board here is invented.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  PLO6_MULTIWAY_WEAK_BET_RECEIPT,
  plo6MultiwayWeakBetSpot,
  plo6NoMultiwayBetWithWeakMadeHand,
  plo6QualifyingDraw,
  plo6WeakMadeHand,
} from './HorsePlo6MultiwayWeakBet.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';

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

  it('a hand above the weak class: top pair, an overpair, top two, top and bottom, a set', () => {
    expectKept('KhQc7s6d3h2c');
    expectKept('AhAcQd6s3h2c');
    expectKept('Kh9hQc7s3h2c');
    expectKept('Kh4dQc7s3h2c');
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

  it('bottom two on the turn is the two lowest of four ranks', () => {
    expect(cls('4h2dQc7s6h5c', 'Ks9d4c2s')).toBe('bottom_two_pair');
    expect(cls('9h4dQc7s6h5c', 'Ks9d4c2s')).toBeNull();
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
