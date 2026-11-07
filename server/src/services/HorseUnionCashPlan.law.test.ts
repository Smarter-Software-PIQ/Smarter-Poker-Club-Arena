import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HORSE_UNION_CASH_PLAN as plan,
  horseUnionCashTableAllowed,
  horseCashPlanPrimaryTables,
  horseCashPlanSecondTables,
  type CashPlanTable,
  playingHumansAtCashTable,
  scheduledHorseCashGames,
} from './HorseUnionCashPlan.js';

const at = (s: string) => Date.parse(s);
const allowed = (table: CashPlanTable, humans: number, now: number) =>
  horseUnionCashTableAllowed(table, humans, now, horseCashPlanPrimaryTables([table]));
const low = {
  id: 'table',
  union_id: plan.unionId,
  cluster_id: plan.games[0].id,
  role: 'main',
  main_index: 1,
  game_variant: 'nlh',
  small_blind: 0.1,
  big_blind: 0.25,
};
const high = {
  ...low,
  cluster_id: 'bc1a347f-2b85-49df-b3b3-40a498a6e51b',
  small_blind: 1,
  big_blind: 2,
};

describe('the union cash schedule follows the November 4 owner scope', () => {
  it('runs three lower-stakes Classic tables without humans throughout 4-8am, every day (Lightning is separate and always on)', () => {
    for (let day = 9; day <= 15; day++)
      for (let hour = 4; hour < 8; hour++) {
        const now = Date.UTC(2026, 10, day, hour + 6, 30);
        expect(scheduledHorseCashGames(now).size).toBe(3);
        expect(allowed(low, 0, now)).toBe(true);
        expect(allowed(high, 0, now)).toBe(false);
        expect(allowed(high, 1, now)).toBe(true);
      }
  });
  it.each([
    ['2026-11-04T07:59:59-06:00', 3],
    ['2026-11-04T08:00:00-06:00', 9],
    ['2026-11-04T12:00:00-06:00', 13],
    ['2026-11-04T17:59:59-06:00', 13],
    ['2026-11-04T18:00:00-06:00', 16],
    ['2026-11-04T22:59:59-06:00', 16],
    ['2026-11-04T23:00:00-06:00', 13],
    ['2026-11-05T00:00:00-06:00', 5],
    ['2026-11-05T03:59:59-06:00', 5],
    ['2026-11-05T04:00:00-06:00', 3],
    ['2026-11-05T08:59:59-06:00', 9],
    ['2026-11-05T09:00:00-06:00', 11],
    ['2026-11-06T17:00:00-06:00', 16],
    ['2026-11-06T19:00:00-06:00', 16],
    ['2026-11-06T21:00:00-06:00', 16],
    ['2026-11-06T23:59:59-06:00', 16],
    ['2026-11-07T00:00:00-06:00', 5],
  ])('has %s bounded to %i scheduled games', (date, count) => {
    expect(scheduledHorseCashGames(at(date)).size).toBe(count);
  });
  it('budgets 1727 scheduled Classic and Madness table-hours in an ordinary week, with no hour above 16', () => {
    let tableHours = 0;
    for (let hour = 0; hour < 168; hour++) {
      const scheduled = scheduledHorseCashGames(at('2026-11-09T00:00:00-06:00') + hour * 3600000);
      const count = scheduled.size;
      const variants = plan.games
        .filter((game) => scheduled.has(game.id))
        .map((game) => game.variant);
      expect(variants).toContain('nlh');
      expect(variants.some((variant) => variant.startsWith('plo'))).toBe(true);
      // Lightning is never on this clock (Dan 2026-11-05: "LIGHTNING MUST
      // ALWAYS BE ON"); see LightningGamesAlwaysRun.law.test.ts.
      expect(plan.games.some((game) => game.name.startsWith('Lightning'))).toBe(false);
      expect(count).toBeLessThanOrEqual(16);
      tableHours += count;
    }
    expect(tableHours).toBe(1727);
  });
  it('uses Chicago DST rules rather than a fixed UTC offset', () => {
    expect(scheduledHorseCashGames(at('2027-03-15T13:00:00Z')).size).toBe(9);
    expect(scheduledHorseCashGames(at('2026-11-09T13:00:00Z')).size).toBe(3);
    for (const date of ['2027-11-07T01:30:00-05:00', '2027-11-07T01:30:00-06:00'])
      expect(scheduledHorseCashGames(at(date)).size).toBe(5);
  });
  it('allows Classic NLH 1/2 Horse-only play 9 AM to 4 AM and human-supported play 4-9 AM', () => {
    expect(allowed(high, 0, at('2026-11-04T18:00:00-06:00'))).toBe(true);
    expect(allowed(high, 0, at('2026-11-04T23:00:00-06:00'))).toBe(true);
    expect(allowed(high, 0, at('2026-11-05T03:30:00-06:00'))).toBe(true);
    expect(allowed(high, 0, at('2026-11-05T04:00:00-06:00'))).toBe(false);
    expect(allowed(high, 0, at('2026-11-04T05:00:00-06:00'))).toBe(false);
    expect(allowed(high, 1, at('2026-11-04T05:00:00-06:00'))).toBe(true);
  });
  it('keeps a Classic 1/2 No Limit and a Classic 1/2 PLO game running every hour except 4-9 AM (Dan 2026-11-05)', () => {
    const classicOneTwo = (now: number, pick: (v: string) => boolean) =>
      plan.games.some(
        (game) =>
          game.name.startsWith('Classic') &&
          game.smallBlind === 1 &&
          game.bigBlind === 2 &&
          pick(game.variant) &&
          scheduledHorseCashGames(now).has(game.id)
      );
    for (let hour = 0; hour < 168; hour++) {
      const now = at('2026-11-09T00:00:00-06:00') + hour * 3600000 + 30 * 60000;
      const local = hour % 24;
      const offPeak = local >= 4 && local < 9;
      expect(classicOneTwo(now, (v) => v === 'nlh')).toBe(!offPeak);
      expect(classicOneTwo(now, (v) => v.startsWith('plo'))).toBe(!offPeak);
    }
  });
  it('does not turn lower-stakes games into human-only games', () => {
    const now = at('2026-11-04T05:00:00-06:00');
    expect(allowed(low, 0, now)).toBe(true);
    // Unscheduled low stakes stay unscheduled, even with a human present.
    expect(allowed({ ...low, cluster_id: 'unlisted' }, 1, now)).toBe(false);
  });
  it('does not seed extra mains, feeders, or unnamed games outside the table budget', () => {
    const now = at('2026-11-04T18:00:00-06:00');
    for (const table of [
      { ...low, main_index: 2 },
      { ...low, role: 'feeder' },
      { ...low, main_index: null },
      { ...low, cluster_id: null },
      { ...low, small_blind: 0.25, big_blind: 0.5 },
    ])
      expect(allowed(table, 0, now)).toBe(false);
    expect(allowed({ ...high, main_index: 2 }, 1, now)).toBe(true);
  });
  it('selects one stable Main 1 even if duplicate numbering drifts in the database', () => {
    const first = { ...low, id: 'a' },
      second = { ...low, id: 'b' };
    const selected = horseCashPlanPrimaryTables([second, first]);
    expect([...selected]).toEqual(['a']);
    expect(horseUnionCashTableAllowed(first, 0, at('2026-11-04T05:00:00-06:00'), selected)).toBe(
      true
    );
    expect(horseUnionCashTableAllowed(second, 0, at('2026-11-04T05:00:00-06:00'), selected)).toBe(
      false
    );
  });
  it('never extends the human exception to forbidden variants or stakes', () => {
    const now = at('2026-11-04T05:00:00-06:00');
    for (const game_variant of ['pineapple', 'short_deck', 'plo8'])
      expect(allowed({ ...high, game_variant }, 1, now)).toBe(false);
    expect(allowed({ ...high, game_variant: 'plo5', small_blind: 2, big_blind: 5 }, 1, now)).toBe(
      false
    );
    expect(allowed({ ...high, game_variant: 'flh', small_blind: 5, big_blind: 10 }, 1, now)).toBe(
      true
    );
  });
  it('preserves non-union games, tournaments, Spins and pre-policy behavior', () => {
    const now = at('2026-11-04T05:00:00-06:00');
    expect(allowed({ ...high, union_id: 'other' }, 0, now)).toBe(true);
    expect(allowed({ ...high, tournament_id: 'event' }, 0, now)).toBe(true);
    expect(allowed({ ...high, is_spins: true }, 0, now)).toBe(true);
    expect(allowed(high, 0, at('2026-11-03T05:00:00-06:00'))).toBe(true);
  });
  it('requires a playing human at this table, never a Horse or a sitting-out/departing chair', () => {
    expect(
      playingHumansAtCashTable(
        [
          { user_id: 'horse' },
          { user_id: 'sitting', is_sitting_out: true },
          { user_id: 'leaving', leave_pending: true },
          { user_id: '' },
        ],
        new Set(['horse'])
      )
    ).toBe(0);
    expect(
      playingHumansAtCashTable([{ user_id: 'playing', is_sitting_out: false }], new Set())
    ).toBe(1);
  });
  it('uses the same decision before seating and for safe existing-seat departures', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    const rotator = readFileSync(new URL('./HorseSessionRotator.ts', import.meta.url), 'utf8');
    expect(fleet).toContain('playingHumansAtCashTable(tableOccupiedSeats, horseIdSet)');
    expect(fleet).toContain('stack, club_id, joined_at, is_sitting_out, leave_pending');
    expect(fleet).toContain('club_id, union_id, is_spins, arena:clubs');
    expect(rotator).toContain('game_variant, tournament_id, is_spins, status');
    expect(fleet).toContain('!horseUnionCashTableAllowed(');
    expect(fleet.indexOf('!horseUnionCashTableAllowed(')).toBeLessThan(
      fleet.indexOf('const tableWithheld = withheldReason')
    );
    expect(rotator).toContain('playingHumansAtCashTable(tableSeats, horseIds)');
    expect(rotator).toContain('!restrictedCashGame && !outsideCashPlan) continue;');
    expect(rotator).toContain('await engine.leaveTable(uid)');
  });
});

describe('a game may run a second table (Dan 2026-11-06)', () => {
  const now = at('2026-11-04T05:00:00-06:00');
  const main1 = { ...low, id: 'm1', lifecycle: 'live' };
  const feeder = { ...low, id: 'f1', role: 'feeder', main_index: null, lifecycle: 'opening' };
  const feeder2 = { ...low, id: 'f2', role: 'feeder', main_index: null, lifecycle: 'opening' };
  it('one second table per game follows its Main 1, never more', () => {
    const primary = horseCashPlanPrimaryTables([main1, feeder, feeder2]);
    const second = horseCashPlanSecondTables([main1, feeder, feeder2], primary, () => true);
    expect([...second]).toEqual(['f1']);
    expect(horseUnionCashTableAllowed(feeder, 0, now, primary, null, null, second)).toBe(true);
    expect(horseUnionCashTableAllowed(feeder2, 0, now, primary, null, null, second)).toBe(false);
  });
  it('a Main 1 horses may not sit at gives its second table nothing', () => {
    const primary = horseCashPlanPrimaryTables([main1, feeder]);
    const second = horseCashPlanSecondTables([main1, feeder], primary, () => false);
    expect(second.size).toBe(0);
    expect(horseUnionCashTableAllowed(feeder, 0, now, primary, null, null, second)).toBe(false);
  });
  it('forbidden variants stay forbidden on a second table', () => {
    const bad = { ...feeder, game_variant: 'short_deck' };
    const primary = horseCashPlanPrimaryTables([main1, bad]);
    const second = horseCashPlanSecondTables([main1, bad], primary, () => true);
    expect(horseUnionCashTableAllowed(bad, 0, now, primary, null, null, second)).toBe(false);
  });
});
