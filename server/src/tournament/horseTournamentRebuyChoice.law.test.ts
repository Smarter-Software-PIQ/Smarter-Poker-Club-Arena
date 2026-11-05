import { describe, expect, it } from 'vitest';
import {
  HORSE_TOURNAMENT_REBUY_SHARE,
  MIDWAY_FREE_BUY_HORSE_REBUY_SHARE,
  horseChoosesTournamentRebuy,
  horseTournamentRebuyShareFor,
} from './horseTournamentRebuyChoice.js';
import { MIDWAY_FREE_BUY_UNION_ID } from './midwayFreeBuyPolicy.js';

const midwayFreeBuy = {
  union_id: MIDWAY_FREE_BUY_UNION_ID,
  tournament_type: 'MTT',
  free_buy: true,
  buy_in_amount: 0,
  buy_in_fee: 0,
};

// Owner rule, 2026-10-29: eligible horses rebuy on 70 percent of MTT busts.
describe('horses choose a tournament rebuy on 70 percent of busts', () => {
  it('pins the owner share at exactly 70 percent', () => {
    expect(HORSE_TOURNAMENT_REBUY_SHARE).toBe(0.7);
  });

  it('keeps the same decision across repeated reads and rejects unknown busts', () => {
    for (const hand of [null, undefined, 0, -1, NaN, Infinity, 1.5]) {
      expect(horseChoosesTournamentRebuy('event', 'horse', hand)).toBe(false);
    }
    const first = horseChoosesTournamentRebuy('event', 'horse', 123);
    for (let i = 0; i < 10; i++) {
      expect(horseChoosesTournamentRebuy('event', 'horse', 123)).toBe(first);
    }
  });

  it('varies by horse, event and bust, with approximately 70 percent choosing yes', () => {
    for (const vary of ['horse', 'event', 'hand']) {
      let yes = 0;
      for (let i = 1; i <= 10_000; i++) {
        yes += Number(
          horseChoosesTournamentRebuy(
            vary === 'event' ? `event-${i}` : 'event',
            vary === 'horse' ? `horse-${i}` : 'horse',
            vary === 'hand' ? i : 123
          )
        );
      }
      expect(yes).toBeGreaterThan(6800);
      expect(yes).toBeLessThan(7200);
    }
  });
});

// Owner rule, 2026-11-04: Midway Union Free Buys only, horses rebuy on 90 percent of busts.
describe('Midway Free Buy horses rebuy on 90 percent of busts; everyone else keeps 70', () => {
  it('pins the Midway share at exactly 90 percent and resolves it from the row', () => {
    expect(MIDWAY_FREE_BUY_HORSE_REBUY_SHARE).toBe(0.9);
    expect(horseTournamentRebuyShareFor(midwayFreeBuy)).toBe(0.9);
    expect(
      horseTournamentRebuyShareFor({
        ...midwayFreeBuy,
        club_id: MIDWAY_FREE_BUY_UNION_ID,
        union_id: null,
      })
    ).toBe(0.9);
    expect(horseTournamentRebuyShareFor({ ...midwayFreeBuy, free_buy: false })).toBe(0.7);
    expect(horseTournamentRebuyShareFor({ ...midwayFreeBuy, union_id: 'another-union' })).toBe(0.7);
    expect(horseTournamentRebuyShareFor({ ...midwayFreeBuy, tournament_type: 'SNG' })).toBe(0.7);
    expect(horseTournamentRebuyShareFor(null)).toBe(0.7);
    expect(horseTournamentRebuyShareFor(undefined)).toBe(0.7);
  });

  it('draws approximately 90 percent yes at the Midway share, bound to the bust hand', () => {
    let yes = 0;
    for (let i = 1; i <= 10_000; i++) {
      yes += Number(horseChoosesTournamentRebuy('event', 'horse', i, 0.9));
    }
    expect(yes).toBeGreaterThan(8800);
    expect(yes).toBeLessThan(9200);
    const first = horseChoosesTournamentRebuy('event', 'horse', 77, 0.9);
    for (let i = 0; i < 10; i++) {
      expect(horseChoosesTournamentRebuy('event', 'horse', 77, 0.9)).toBe(first);
    }
    for (const hand of [null, undefined, 0, -1, NaN, 1.5]) {
      expect(horseChoosesTournamentRebuy('event', 'horse', hand, 0.9)).toBe(false);
    }
  });

  it('is the same draw at a higher threshold: a 70 percent yes is always a 90 percent yes', () => {
    for (let i = 1; i <= 2_000; i++) {
      if (horseChoosesTournamentRebuy('event', 'horse', i)) {
        expect(horseChoosesTournamentRebuy('event', 'horse', i, 0.9)).toBe(true);
      }
    }
  });
});
