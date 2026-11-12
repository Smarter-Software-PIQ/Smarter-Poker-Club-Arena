import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HORSE_UNION_CASH_PLAN as plan,
  horseUnionCashTableAllowed,
  horseCashPlanPrimaryTables,
  horseCashPlanSecondTables,
  type CashPlanTable,
  playingHumansAtCashTable,
  scheduledHorseCashGames,
  humanDepartureDwellMinutes,
  resetHumanPresenceMemoryForTest,
} from './HorseUnionCashPlan.js';
import { secondTablePicked, thirdTablePicked } from './HorseBehavior.js';

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

describe('the union cash floor follows the November 11 relaunch (zero game-count restrictions)', () => {
  it('schedules every plan game at every hour of every day, with the target tripled', () => {
    expect(plan.games).toHaveLength(21);
    expect(plan.games.every((game) => game.window === 'always')).toBe(true);
    expect(plan.weeklyRakeTarget).toBe(600000);
    for (let hour = 0; hour < 168; hour++) {
      const now = at('2026-11-09T00:00:00-06:00') + hour * 3600000 + 30 * 60000;
      const scheduled = scheduledHorseCashGames(now);
      expect(scheduled.size).toBe(21);
      const variants = plan.games
        .filter((game) => scheduled.has(game.id))
        .map((game) => game.variant);
      expect(variants).toContain('nlh');
      expect(variants.some((variant) => variant.startsWith('plo'))).toBe(true);
      // Lightning is never on this clock (Dan 2026-11-05: "LIGHTNING MUST
      // ALWAYS BE ON"); see LightningGamesAlwaysRun.law.test.ts.
      expect(plan.games.some((game) => game.name.startsWith('Lightning'))).toBe(false);
    }
  });
  it('runs all six 1/2 games full time, Horse-only play included (Dan 2026-11-11; PLO5 1/2 is the one Madness game, one game per stake)', () => {
    const oneTwo = plan.games.filter((game) => game.smallBlind === 1 && game.bigBlind === 2);
    expect(oneTwo.map((game) => game.variant).sort()).toEqual([
      'flh',
      'flo8',
      'nlh',
      'plo4',
      'plo5',
      'plo6',
    ]);
    for (const hour of ['2026-11-12T05:00:00-06:00', '2026-11-12T12:00:00-06:00', '2026-11-13T02:30:00-06:00'])
      for (const game of oneTwo)
        expect(
          allowed({ ...high, cluster_id: game.id, game_variant: game.variant }, 0, at(hour))
        ).toBe(true);
  });
  it('uses Chicago DST rules rather than a fixed UTC offset', () => {
    for (const date of [
      '2027-03-15T13:00:00Z',
      '2026-11-09T13:00:00Z',
      '2027-11-07T01:30:00-05:00',
      '2027-11-07T01:30:00-06:00',
    ])
      expect(scheduledHorseCashGames(at(date)).size).toBe(21);
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
    const tablePolicy = fleet.indexOf('const tableWithheld =');
    expect(tablePolicy).toBeGreaterThan(0);
    expect(fleet.indexOf('!horseUnionCashTableAllowed(')).toBeLessThan(tablePolicy);
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
  // A time the game is picked for two tables, and one it is not (2026-11-07).
  const game = String(low.cluster_id);
  const hours = Array.from({ length: 96 }, (_, i) => now + i * 3_600_000);
  const picked = hours.find(
    (t) =>
      secondTablePicked(game, t, Number(low.big_blind), String(low.game_variant)) &&
      !thirdTablePicked(game, t, Number(low.big_blind), String(low.game_variant))
  ) as number;
  const unpicked = hours.find(
    (t) => !secondTablePicked(game, t, Number(low.big_blind), String(low.game_variant))
  ) as number;
  it('a two-table selection admits only one secondary table', () => {
    const primary = horseCashPlanPrimaryTables([main1, feeder, feeder2]);
    const second = horseCashPlanSecondTables([main1, feeder, feeder2], primary, () => true, picked);
    expect([...second]).toEqual(['f1']);
    expect(horseUnionCashTableAllowed(feeder, 0, now, primary, null, null, second)).toBe(true);
    expect(horseUnionCashTableAllowed(feeder2, 0, now, primary, null, null, second)).toBe(false);
  });
  it('a three-table selection admits Main 2 and its feeder, never a fourth table', () => {
    const third = hours.find((t) =>
      thirdTablePicked(game, t, Number(low.big_blind), String(low.game_variant))
    )!;
    expect(third).toBeTypeOf('number');
    const main2 = { ...main1, id: 'm2', main_index: 2 };
    const all = [feeder2, main2, main1, feeder];
    const primary = horseCashPlanPrimaryTables(all);
    expect([...horseCashPlanSecondTables(all, primary, () => true, third)]).toEqual(['m2', 'f1']);
    expect([
      ...horseCashPlanSecondTables(all, primary, () => true, third, new Set([game])),
    ]).toEqual(['m2']);
    expect([...horseCashPlanSecondTables(all, primary, () => true, third, null)]).toEqual(['m2']);
    expect(horseCashPlanSecondTables(all, primary, () => false, third).size).toBe(0);
  });
  it('a game no longer picked for two tables lets its second table drain', () => {
    const primary = horseCashPlanPrimaryTables([main1, feeder]);
    expect(horseCashPlanSecondTables([main1, feeder], primary, () => true, unpicked).size).toBe(0);
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

describe('a game does not break right away after a human leaves (Dan 2026-11-11)', () => {
  beforeEach(() => resetHumanPresenceMemoryForTest());
  // A higher-stakes union table outside the plan: only the human exception
  // admits horses, so its dwell is observable.
  const offPlan = {
    ...high,
    id: 'dwell-table',
    cluster_id: 'unlisted-two-five',
    game_variant: 'flh',
    small_blind: 2,
    big_blind: 5,
  };
  it('keeps the human exception for the table own 20-30 minute dwell after the last human leaves', () => {
    const dwell = humanDepartureDwellMinutes(String(offPlan.id));
    const t0 = at('2026-11-12T20:00:00-06:00');
    expect(allowed(offPlan, 0, t0)).toBe(false); // no human was ever seen
    expect(allowed(offPlan, 1, t0)).toBe(true); // a person is playing
    expect(allowed(offPlan, 0, t0 + 60000)).toBe(true); // one minute after they left
    expect(allowed(offPlan, 0, t0 + dwell * 60000 - 1000)).toBe(true); // inside the dwell
    expect(allowed(offPlan, 0, t0 + dwell * 60000)).toBe(false); // the dwell has run out
  });
  it('every table dwell lands inside the owner 20-30 minute window, deterministically', () => {
    for (let i = 0; i < 64; i++) {
      const minutes = humanDepartureDwellMinutes(`table-${i}`);
      expect(minutes).toBeGreaterThanOrEqual(20);
      expect(minutes).toBeLessThanOrEqual(30);
      expect(humanDepartureDwellMinutes(`table-${i}`)).toBe(minutes);
    }
  });
});
