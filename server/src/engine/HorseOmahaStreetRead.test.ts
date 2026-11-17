/**
 * The postflop read by street and flop texture (HorseOmahaStreetRead.ts): the reducer counts what it
 * says it counts, an unknown cell answers null, and a player who bets most unpaired flops and little
 * afterwards is not one label on every street.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import type { ExploitHandAction } from './HorseOpponentExploit.js';
import {
  emptyStreetRead,
  flopTextureOf,
  streetLabel,
  streetReadDecayAndAdd,
  streetReadHandIncrements,
  streetReadRate,
  validStreetRead,
  STREET_READ_MIN_OPPORTUNITIES,
} from './HorseOmahaStreetRead.js';

const c = (rank: string, suit: string) => ({ rank, suit }) as unknown as Card;
const act = (userId: string, stage: string, action: string): ExploitHandAction => ({
  userId,
  stage,
  action,
  origin: 'player',
  isFullRaise: true,
});
const RAINBOW = [c('K', 'spades'), c('8', 'hearts'), c('3', 'clubs')];
const PAIRED = [c('8', 'spades'), c('8', 'hearts'), c('Q', 'clubs')];

describe('flopTextureOf', () => {
  it('classes the flop by pairing first, then suits', () => {
    expect(flopTextureOf(PAIRED)).toBe('paired');
    expect(flopTextureOf(RAINBOW)).toBe('rainbow');
    expect(flopTextureOf([c('K', 'spades'), c('8', 'spades'), c('3', 'clubs')])).toBe('twoTone');
    expect(flopTextureOf([c('K', 'spades'), c('8', 'spades'), c('3', 'spades')])).toBe('monotone');
    expect(flopTextureOf([c('8', 'spades'), c('8', 'hearts'), c('8', 'spades')])).toBe('paired');
  });
  it('is null without three known flop cards', () => {
    expect(flopTextureOf(null)).toBeNull();
    expect(flopTextureOf([c('K', 'spades')])).toBeNull();
  });
  it('reads only the first three cards', () => {
    expect(flopTextureOf([...RAINBOW, c('K', 'hearts')])).toBe('rainbow');
  });
});

describe('streetReadHandIncrements', () => {
  it('counts a continuation bet for the last preflop raiser on that texture only', () => {
    const inc = streetReadHandIncrements(
      [
        act('h', 'preflop', 'raise'),
        act('w', 'preflop', 'raise'),
        act('h', 'preflop', 'call'),
        act('h', 'flop', 'check'),
        act('w', 'flop', 'bet'),
        act('h', 'flop', 'fold'),
      ],
      RAINBOW
    );
    const w = inc.get('w')!;
    expect(w.cbet.rainbow).toEqual({ hit: 1, opp: 1 });
    expect(w.flopBet.rainbow).toEqual({ hit: 1, opp: 1 });
    expect(w.cbet.paired).toEqual({ hit: 0, opp: 0 });
    expect(w.bet.flop).toEqual({ hit: 1, opp: 1 });
    const h = inc.get('h')!;
    // h checked with no bet out: a bet opportunity not taken, and not a continuation-bet opportunity.
    expect(h.bet.flop).toEqual({ hit: 0, opp: 1 });
    expect(h.cbet.rainbow).toEqual({ hit: 0, opp: 0 });
    expect(h.foldToBet.flop).toEqual({ hit: 1, opp: 1 });
  });
  it('separates folding to a raise from folding to a bet', () => {
    const inc = streetReadHandIncrements(
      [
        act('w', 'preflop', 'raise'),
        act('h', 'preflop', 'call'),
        act('w', 'flop', 'bet'),
        act('h', 'flop', 'raise'),
        act('w', 'flop', 'fold'),
      ],
      PAIRED
    );
    const w = inc.get('w')!;
    expect(w.foldToRaise.flop).toEqual({ hit: 1, opp: 1 });
    expect(w.foldToBet.flop).toEqual({ hit: 0, opp: 0 });
    expect(w.cbet.paired).toEqual({ hit: 1, opp: 1 });
    expect(inc.get('h')!.foldToBet.flop).toEqual({ hit: 0, opp: 1 });
  });
  it('keeps streets apart and gives one opportunity per cell per hand', () => {
    const inc = streetReadHandIncrements(
      [
        act('w', 'preflop', 'raise'),
        act('h', 'preflop', 'call'),
        act('w', 'flop', 'bet'),
        act('h', 'flop', 'call'),
        act('w', 'turn', 'check'),
        act('h', 'turn', 'bet'),
        act('w', 'turn', 'raise'),
        act('h', 'turn', 'raise'),
        act('w', 'turn', 'call'),
        act('w', 'river', 'check'),
        act('h', 'river', 'check'),
      ],
      RAINBOW
    );
    const w = inc.get('w')!;
    expect(w.bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(w.bet.turn).toEqual({ hit: 0, opp: 1 });
    expect(w.bet.river).toEqual({ hit: 0, opp: 1 });
    expect(w.foldToBet.turn).toEqual({ hit: 0, opp: 1 });
    expect(w.foldToRaise.turn).toEqual({ hit: 0, opp: 1 });
    const h = inc.get('h')!;
    expect(h.bet.turn).toEqual({ hit: 1, opp: 1 });
    expect(h.foldToRaise.turn).toEqual({ hit: 0, opp: 1 });
  });
  it('ignores forced and unattributed actions, as the pooled counters do', () => {
    const inc = streetReadHandIncrements(
      [
        { userId: 'w', stage: 'flop', action: 'fold', origin: 'forced' },
        { userId: 'w', stage: 'flop', action: 'fold' },
        { stage: 'flop', action: 'bet', origin: 'player' },
      ],
      RAINBOW
    );
    expect(inc.size).toBe(0);
  });
  it('without a flop keeps the street cells and leaves the texture cells empty', () => {
    const inc = streetReadHandIncrements([act('w', 'flop', 'bet')], null);
    const w = inc.get('w')!;
    expect(w.bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(w.flopBet.rainbow.opp + w.flopBet.paired.opp).toBe(0);
  });
});

describe('rates and labels', () => {
  const grow = (flopBets: number, flopOpp: number, turnBets: number, turnOpp: number) => {
    const row = emptyStreetRead();
    row.flopBet.rainbow = { hit: flopBets, opp: flopOpp };
    row.bet.flop = { hit: flopBets, opp: flopOpp };
    row.bet.turn = { hit: turnBets, opp: turnOpp };
    return row;
  };
  const means = { bet: 0.35, foldToBet: 0.45 };
  it('an unknown cell answers null', () => {
    expect(streetReadRate({ hit: 3, opp: STREET_READ_MIN_OPPORTUNITIES - 1 }, 0.3)).toBeNull();
    expect(streetLabel(emptyStreetRead(), 'flop', 'rainbow', means)).toBeNull();
    expect(streetLabel(null, 'turn', null, means)).toBeNull();
  });
  it('a wide flop bettor who slows down is two different reads, not one', () => {
    const row = grow(30, 40, 4, 40);
    const flop = streetLabel(row, 'flop', 'rainbow', means)!;
    const turn = streetLabel(row, 'turn', null, means)!;
    expect(flop.valueLeader).toBe(false);
    expect(flop.betRatio).toBeGreaterThan(1.5);
    expect(turn.valueLeader).toBe(true);
    expect(turn.betRatio).toBeLessThan(0.6);
    // the texture he has not been seen on stays unknown
    expect(streetLabel(row, 'flop', 'paired', means)).toBeNull();
  });
  it('shrinks toward the prior with few opportunities', () => {
    const r = streetReadRate({ hit: 8, opp: 8 }, 0.35)!;
    expect(r.rate).toBeCloseTo((8 + 6 * 0.35) / 14, 10);
  });
  it('a cell ages only on a hand that gave it an opportunity', () => {
    const row = emptyStreetRead();
    row.bet.flop = { hit: 5, opp: 10 };
    row.bet.turn = { hit: 2, opp: 10 };
    const inc = emptyStreetRead();
    inc.bet.flop = { hit: 1, opp: 1 };
    streetReadDecayAndAdd(row, inc);
    expect(row.bet.turn).toEqual({ hit: 2, opp: 10 });
    expect(row.bet.flop.opp).toBeLessThan(11);
    expect(row.bet.flop.opp).toBeGreaterThan(10);
    expect(validStreetRead(row)).toBe(true);
  });
  it('refuses a malformed stored row', () => {
    const bad = emptyStreetRead();
    bad.bet.flop = { hit: 3, opp: 1 };
    expect(validStreetRead(bad)).toBe(false);
    expect(validStreetRead({})).toBe(false);
    expect(streetLabel(bad, 'flop', null, means)).toBeNull();
  });
});
