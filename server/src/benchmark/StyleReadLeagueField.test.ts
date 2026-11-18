import { describe, expect, it } from 'vitest';
import { styleLeagueField, STYLE_LEAGUE_NAMES } from './StyleReadLeagueField.js';

/** A preflop first-action spot: the clocks count these. */
const spot = (n: number) =>
  ({
    variant: 'nlh',
    isPotLimit: false,
    stage: 'preflop',
    seatIdx: 0,
    numSeats: 6,
    dealerSeat: 1,
    bigBlind: 2,
    cards: [
      { rank: '7', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
    ],
    board: [],
    pot: 3,
    toCall: 2,
    currentBet: 2,
    myBet: 0,
    stack: 200,
    liveCount: 6,
    legalActions: ['fold', 'call', 'raise'],
    minRaiseTo: 4,
    maxRaiseTo: 200,
    history: [{ stage: 'preflop', userId: `x${n}`, action: 'big_blind', amount: 2 }],
    userId: 'me',
  }) as never;

describe('style league field', () => {
  it('names the six label-shaped opponents', () => {
    expect(STYLE_LEAGUE_NAMES).toEqual([
      'lp_loose_passive',
      'lp_wide_selective',
      'lp_maniac',
      'lp_time_shifter',
      'lp_tight_image',
      'lp_frequent_bluffer',
      'lp_tight',
      'lp_value_heavy_passive',
    ]);
  });
  it("each field instance starts its own hand clocks (a cell never inherits another cell's gear)", () => {
    const a = styleLeagueField();
    for (let i = 0; i < 400; i++) a.lp_time_shifter(spot(i), () => ({ action: 'fold' }));
    const b = styleLeagueField();
    const fresh = styleLeagueField();
    for (let i = 0; i < 5; i++)
      expect(b.lp_time_shifter(spot(i), () => ({ action: 'fold' }))).toEqual(
        fresh.lp_time_shifter(spot(i), () => ({ action: 'fold' }))
      );
  });
});
