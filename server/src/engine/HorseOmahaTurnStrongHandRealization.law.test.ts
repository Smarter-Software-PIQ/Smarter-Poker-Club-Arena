/**
 * omahaTurnStrongHandRealizationIsMeasured (default OFF; EMERG lane OPEN-ITEMS
 * 2026-11-19). Law: inside omahaFacingBetIsPricedByEquity, a Lightning
 * heads-up turn fold of a strong made hand (at most 10% of two-card holdings
 * beat it) is priced with the realization measured for those calls; tables,
 * multiway pots, the flop, the river and PLO6 are priced exactly as before;
 * without the parent option it does nothing; the validator admits its call.
 * Constructed cards only. The folds it answers were measured on hands
 * 60167023, 60018500, 60061639, 60005764 (ids only).
 */
import { describe, expect, it } from 'vitest';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  OMAHA_FACING_EQUITY_MARGIN,
  OMAHA_FACING_EQUITY_REALIZATION,
  OMAHA_FACING_EQUITY_STRONG_BEATEN_MAX,
  OMAHA_FACING_EQUITY_STRONG_TURN_PROVENANCE,
  OMAHA_FACING_EQUITY_STRONG_TURN_REALIZATION_LIGHTNING,
  omahaFacingBeatenShare,
  omahaFacingBetIsPricedByEquityRule,
  omahaFacingEquityAdmitsCall,
  omahaFacingEquitySpot,
  omahaFacingEquityVerdict,
  omahaFacingStrongTurnCell,
  type OmahaFacingEquitySpot,
} from './HorseOmahaFacingBetEquity.js';
import type { Card, SeatPlayer } from '../types.js';

const c = (t: string): Card =>
  ({
    rank: t[0],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[t[1]]!,
  }) as Card;
const cards = (s: string): Card[] => s.match(/../g)!.map(c);

// Top two pair on a connected turn: 8 of 903 two-card holdings beat it.
const HOLE5 = cards('KsQd5c4h2c');
const TURN = cards('KhQs8d7c');
const spot = (over: Partial<OmahaFacingEquitySpot> = {}): OmahaFacingEquitySpot => ({
  street: 'turn',
  paid: 60,
  price: 60 / 180,
  opponents: 1,
  bettorSeat: 2,
  lightning: true,
  ...over,
});

/** A heads-up turn: a person bets the pot into the Horse. */
function state(variant: 'plo4' | 'plo5' | 'plo6', hole: Card[], speed: 'lightning' | 'table') {
  const hero = {
    seat: 1,
    user_id: 'horse',
    is_horse: true,
    stack: 400,
    bet: 0,
    cards: hole,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const person = {
    seat: 2,
    user_id: 'person',
    is_horse: false,
    stack: 340,
    bet: 60,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const gs = {
    gameVariant: variant,
    gameMode: 'cash',
    stage: 'turn',
    communityCards: TURN,
    pot: 120,
    currentBet: 60,
    toCall: 60,
    bigBlind: 2,
    players: [hero, person],
    legalActions: ['fold', 'call', 'raise'],
    publicMemoryDomain: { speed },
    actionHistory: [{ stage: 'turn', seat: 2, action: 'bet', amount: 60 }],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('omahaTurnStrongHandRealizationIsMeasured: the strength of the hand', () => {
  it('counts the two-card holdings that beat the hand on the board as it stands', () => {
    expect(omahaFacingBeatenShare(cards('AsKsQhJh2c'), cards('TsJsQs2d'))).toBe(0);
    const twoPair = omahaFacingBeatenShare(HOLE5, TURN)!;
    expect(twoPair).toBeGreaterThan(0);
    expect(twoPair).toBeLessThanOrEqual(OMAHA_FACING_EQUITY_STRONG_BEATEN_MAX);
    // one bare pair of kings: every set, two pair and better kicker beats it
    expect(omahaFacingBeatenShare(cards('Ks9d5c4h2c'), cards('KhQsJd7c'))!).toBeGreaterThan(
      OMAHA_FACING_EQUITY_STRONG_BEATEN_MAX
    );
    expect(omahaFacingBeatenShare(cards('KsKsQd5c4h'), TURN)).toBeNull();
    expect(omahaFacingBeatenShare(HOLE5, cards('KhQs'))).toBeNull();
  });

  it('the constants state a public measurement', () => {
    expect(OMAHA_FACING_EQUITY_STRONG_TURN_PROVENANCE.realization).toMatch(/^public: /);
    expect(OMAHA_FACING_EQUITY_STRONG_TURN_PROVENANCE.hiddenCards).toMatch(/no constant/);
    expect(OMAHA_FACING_EQUITY_STRONG_TURN_REALIZATION_LIGHTNING).toBeLessThanOrEqual(1);
    expect(OMAHA_FACING_EQUITY_STRONG_TURN_REALIZATION_LIGHTNING).toBeGreaterThan(
      OMAHA_FACING_EQUITY_REALIZATION.turn
    );
  });
});

describe('omahaTurnStrongHandRealizationIsMeasured: the one measured cell', () => {
  it('Lightning, heads-up, turn, strong made hand: the fold the flat figure keeps becomes the call', () => {
    const flat = omahaFacingEquityVerdict(spot(), HOLE5, TURN)!;
    const strong = omahaFacingEquityVerdict(spot(), HOLE5, TURN, true)!;
    expect(flat.call).toBe(false);
    expect(flat.strongTurn).toBeUndefined();
    expect(strong.strongTurn).toBe(true);
    expect(strong.raw).toBe(flat.raw);
    expect(strong.calibrated).toBe(flat.calibrated);
    expect(strong.realized).toBe(
      strong.calibrated * OMAHA_FACING_EQUITY_STRONG_TURN_REALIZATION_LIGHTNING
    );
    expect(strong.margin).toBe(OMAHA_FACING_EQUITY_MARGIN.turn);
    expect(strong.call).toBe(true);
  });

  it('a table, a multiway pot, the flop, the river and a weak hand are priced exactly as before', () => {
    const same = (s: OmahaFacingEquitySpot, hole: Card[], board: Card[]) =>
      expect(omahaFacingEquityVerdict(s, hole, board, true)).toEqual(
        omahaFacingEquityVerdict(s, hole, board)
      );
    same(spot({ lightning: false }), HOLE5, TURN);
    same(spot({ opponents: 2 }), HOLE5, TURN);
    same(spot({ street: 'flop' }), HOLE5, cards('KhQs8d'));
    same(spot({ street: 'river' }), HOLE5, cards('KhQs8d7c2h'));
    same(spot(), cards('Ks9d5c4h2c'), cards('KhQsJd7c'));
    expect(omahaFacingStrongTurnCell(spot({ lightning: false }), HOLE5, TURN)).toBe(false);
    expect(omahaFacingStrongTurnCell(spot(), HOLE5, TURN)).toBe(true);
  });

  it('PLO6 is untouched: six hole cards are never in the cell', () => {
    const six = cards('KsQd5c4h2c3d');
    expect(omahaFacingStrongTurnCell(spot(), six, TURN)).toBe(false);
    const { hero, gs } = state('plo6', six, 'lightning');
    expect(omahaFacingEquitySpot(hero, gs)).toBeNull();
    const fold = { action: 'fold' as string, amount: null as number | null };
    expect(
      omahaFacingBetIsPricedByEquityRule(fold, hero, gs, true, (d) => d, undefined, true)
    ).toBe(fold);
  });
});

describe('omahaTurnStrongHandRealizationIsMeasured: the rule and its admission', () => {
  const fold = { action: 'fold' as string, amount: null as number | null };
  it('acts only with omahaFacingBetIsPricedByEquity on, only in Lightning, and only on a fold', () => {
    const { hero, gs } = state('plo5', HOLE5, 'lightning');
    const s = omahaFacingEquitySpot(hero, gs)!;
    expect(s).not.toBeNull();
    expect(s.lightning).toBe(true);
    expect(s.opponents).toBe(1);
    let noted = 0;
    const on = omahaFacingBetIsPricedByEquityRule(
      fold,
      hero,
      gs,
      true,
      (d) => d,
      (v) => {
        if (v.strongTurn) noted++;
      },
      true
    );
    expect(on).toEqual({ action: 'call', amount: 60 });
    expect(noted).toBe(1);
    // parent on, this option off: the flat figure keeps the fold
    expect(omahaFacingBetIsPricedByEquityRule(fold, hero, gs, true, (d) => d)).toBe(fold);
    // parent off: nothing, whatever this option says
    expect(
      omahaFacingBetIsPricedByEquityRule(fold, hero, gs, false, (d) => d, undefined, true)
    ).toBe(fold);
    // never a non-fold
    const call = { action: 'call' as string, amount: 60 as number | null };
    expect(
      omahaFacingBetIsPricedByEquityRule(call, hero, gs, true, (d) => d, undefined, true)
    ).toBe(call);
    // a table: the same cards keep the fold
    const table = state('plo5', HOLE5, 'table');
    expect(
      omahaFacingBetIsPricedByEquityRule(
        fold,
        table.hero,
        table.gs,
        true,
        (d) => d,
        undefined,
        true
      )
    ).toBe(fold);
  });

  it('the validator admits exactly that call (the switch delivers the option in the worker)', () => {
    const { hero, gs } = state('plo5', HOLE5, 'lightning');
    expect(omahaFacingEquityAdmitsCall(hero, gs, 60)).toBe(true);
    expect(omahaFacingEquityAdmitsCall(hero, gs, 61)).toBe(false);
    const table = state('plo5', HOLE5, 'table');
    expect(omahaFacingEquityAdmitsCall(table.hero, table.gs, 60)).toBe(false);
  });
});
