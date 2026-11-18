import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HORSE_UNION_CASH_PLAN as plan,
  LIGHTNING_HORSE_SEEDED,
  horseCashPlanPrimaryTables,
  horseUnionCashTableAllowed,
  lightningGamesWithPlayingHumans,
  type CashPlanTable,
} from './HorseUnionCashPlan.js';

/**
 * LIGHTNING (Dan 2026-11-05, 12:33): "lightning tables must always run, they
 * are feeder games until enough players are playing ... there should never be
 * a on off timer for these games! ever!!"
 *
 * Dan 2026-11-05, 14:32: "THERE IS NO CAP OR CLOCK THAT SHOULD BE WATCHING
 * THIS, JUST HAVE AND LAUNCH FEWER LIGHTNING GAMES, TO OFF SET THE TOTAL RAKE
 * COLLECTED... LIKE NO LIGHTNING GAMES GET STARTED BY HORSES IN A FEW GAMES
 * STAKES, UNLESS HUMANS SIT DOWN, IF A HUMAN SITS DOWN, THEN MORE HORSES CAN
 * SIT AS WELL... FIGURE OUT THE RIGHT ALGO TO INSURE THAT THE GAMES STILL RUN,
 * BUT NOT ALL THE TIME, AND WE STAY UNDER THE 200K MARK."
 *
 * Dan 2026-11-13 11:43, superseding that rule for these stakes: "THE 1/2
 * PLAYERS NEED TO BE SPLIT UP AMONGST ALL OF THE GAMES, INCLUDING THE
 * LIGHTNING GAMES. AND INCLUDING LIGHTNING .50/1.00 FOR BOTH PLO AND HOLDEM."
 * Horses now start the .25/.50, .50/1 (NLH, PLO4) and 1/2 (NLH, PLO4, PLO5)
 * Lightning games; every other Lightning game is still started by a person.
 */
const SEEDED = '705270cd-03c2-40d9-8749-038f741a295c'; // PLO4 0.25/0.50 Lightning Games
const PLO4_ONE_TWO = 'c79d8ec2-2281-411d-b4e1-42b5610849e2'; // PLO4 1/2 Lightning Games, now seeded
const STARTED_BY_PEOPLE = 'ccf9a4f4-9f61-47bd-8bb4-8730b17608bd'; // PLO6 .50/1 Lightning Games
const lightningGames = new Set([SEEDED, PLO4_ONE_TWO, STARTED_BY_PEOPLE]);
const tablesOf = (game: string, variant: string, sb: number, bb: number) => {
  const base: CashPlanTable = {
    union_id: plan.unionId,
    cluster_id: game,
    game_variant: variant,
    small_blind: sb,
    big_blind: bb,
    lifecycle: 'live',
  };
  return [
    { ...base, id: game + '-main-1', role: 'main', main_index: 1 },
    { ...base, id: game + '-main-2', role: 'main', main_index: 2 },
    { ...base, id: game + '-feeder', role: 'feeder', main_index: null },
  ];
};
const seeded = tablesOf(SEEDED, 'plo4', 0.25, 0.5);
const byPeople = tablesOf(STARTED_BY_PEOPLE, 'plo6', 0.5, 1);
const ploOneTwo = tablesOf(PLO4_ONE_TWO, 'plo4', 1, 2);
const primary = horseCashPlanPrimaryTables([...seeded, ...byPeople, ...ploOneTwo]);
const everyHour = (fn: (now: number) => void) => {
  for (let hourOfWeek = 0; hourOfWeek < 7 * 24; hourOfWeek++)
    fn(Date.UTC(2026, 10, 9, 6) + hourOfWeek * 3_600_000 + 17 * 60_000);
};

describe('Lightning: no cap and no clock; horses start only a few games, people start the rest', () => {
  it('names exactly the horse-started Lightning games in the plan', () => {
    expect([...LIGHTNING_HORSE_SEEDED].sort()).toEqual(
      [
        '705270cd-03c2-40d9-8749-038f741a295c', // PLO4 .25/.50
        'b3c63129-9377-4c61-9f62-089893a20c66', // NLH .25/.50
        '57ca90e4-815e-4081-a5d2-1f10522d95c7', // NLH .50/1
        'f26f6efa-2470-49e7-8e96-6128f4d0cdb5', // PLO4 .50/1
        '563279fc-c09a-48a6-b487-c4f34f289095', // NLH 1/2
        'c79d8ec2-2281-411d-b4e1-42b5610849e2', // PLO4 1/2
        'f67a1436-e842-4b49-8644-3e184bd77ba6', // PLO5 1/2
      ].sort()
    );
  });

  it('horses run a horse-started game on every table at every hour, with nobody else there', () => {
    everyHour((now) => {
      for (const table of seeded)
        expect(horseUnionCashTableAllowed(table, 0, now, primary, lightningGames, new Set())).toBe(
          true
        );
    });
  });

  it('horses never start any other Lightning game on their own, at any hour', () => {
    everyHour((now) => {
      for (const table of byPeople)
        expect(horseUnionCashTableAllowed(table, 0, now, primary, lightningGames, new Set())).toBe(
          false
        );
    });
  });

  it('a person sitting down at ANY table of that game lets horses sit at all of its tables, at any hour', () => {
    const seats = new Map([[byPeople[2].id, [{ user_id: 'person', is_sitting_out: false }]]]);
    const started = lightningGamesWithPlayingHumans(
      byPeople,
      seats,
      new Set(['horse']),
      lightningGames
    );
    expect([...started!]).toEqual([STARTED_BY_PEOPLE]);
    everyHour((now) => {
      for (const table of byPeople)
        expect(horseUnionCashTableAllowed(table, 0, now, primary, lightningGames, started)).toBe(
          true
        );
    });
  });

  it('horses seed 1/2 PLO Lightning with nobody there, demand or not, at every hour', () => {
    const windDown = {
      game_id: PLO4_ONE_TWO,
      event_id: '00000000-0000-4000-8000-000000000001',
      continues: false,
      wind_down: true,
    } as const;
    everyHour((now) => {
      for (const table of ploOneTwo) {
        expect(horseUnionCashTableAllowed(table, 0, now, primary, lightningGames, new Set())).toBe(
          true
        );
        expect(
          horseUnionCashTableAllowed(
            table,
            0,
            now,
            primary,
            lightningGames,
            new Set(),
            null,
            false,
            windDown
          )
        ).toBe(true);
      }
    });
  });

  it('1/2 PLO continuation never admits horses to a person-started game', () => {
    const demand = {
      game_id: PLO4_ONE_TWO,
      event_id: '00000000-0000-4000-8000-000000000001',
      continues: true,
      wind_down: false,
    } as const;
    const now = Date.UTC(2026, 10, 10);
    for (const table of byPeople) {
      expect(
        horseUnionCashTableAllowed(table, 0, now, primary, lightningGames, new Set(), null, true)
      ).toBe(false);
      expect(
        horseUnionCashTableAllowed(
          table,
          0,
          now,
          primary,
          lightningGames,
          new Set(),
          null,
          false,
          demand
        )
      ).toBe(false);
    }
  });

  it('a horse, a sitting-out person or a departing person does not start a game', () => {
    const seats = new Map([
      [
        byPeople[0].id,
        [
          { user_id: 'horse' },
          { user_id: 'away', is_sitting_out: true },
          { user_id: 'going', leave_pending: true },
        ],
      ],
    ]);
    expect([
      ...lightningGamesWithPlayingHumans(byPeople, seats, new Set(['horse']), lightningGames)!,
    ]).toEqual([]);
  });

  it('an unread Lightning list or person read seats no horse in a person-started game', () => {
    const now = Date.UTC(2026, 10, 9, 15);
    expect(lightningGamesWithPlayingHumans(byPeople, new Map(), new Set(), null)).toBeNull();
    expect(horseUnionCashTableAllowed(byPeople[0], 0, now, primary, lightningGames, null)).toBe(
      false
    );
  });

  it('still keeps forbidden variants and the stake ceiling, which are not timers', () => {
    const now = Date.UTC(2026, 10, 9, 15);
    expect(
      horseUnionCashTableAllowed(
        { ...seeded[2], game_variant: 'plo8' },
        0,
        now,
        primary,
        lightningGames,
        new Set()
      )
    ).toBe(false);
    expect(
      horseUnionCashTableAllowed(
        { ...seeded[0], small_blind: 5, big_blind: 10 },
        0,
        now,
        primary,
        lightningGames,
        new Set()
      )
    ).toBe(false);
  });

  it('leaves the Classic schedule exactly as before', () => {
    const classic: CashPlanTable = {
      id: 'classic',
      union_id: plan.unionId,
      cluster_id: plan.games[0].id,
      role: 'main',
      main_index: 1,
      game_variant: 'nlh',
      small_blind: 0.1,
      big_blind: 0.25,
    };
    const now = Date.UTC(2026, 10, 9, 15);
    const p = horseCashPlanPrimaryTables([classic]);
    expect(horseUnionCashTableAllowed(classic, 0, now, p, lightningGames, new Set())).toBe(
      horseUnionCashTableAllowed(classic, 0, now, p)
    );
  });

  it('seating, existing offers and the walk-out pass all use the same person read', () => {
    const fleet = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
    const rotator = readFileSync(new URL('./HorseSessionRotator.ts', import.meta.url), 'utf8');
    // The fifth reader was the PLO activity-hour widening, removed when the
    // work schedule became a gate (owner 2026-11-12, HorseWorkSchedule).
    expect(fleet.split('cashPlanLightningHumanGames,').length - 1).toBe(4);
    expect(fleet.split("supabase.rpc('fn_plo_lightning_post_human_demand')").length - 1).toBe(2);
    expect(fleet.split('lightningGamesWithPlayingHumans(').length - 1).toBe(2);
    expect(rotator).toContain('lightningGamesWithPlayingHumans(');
    expect(rotator).toMatch(/lightningHumanGames,\n\s+cashPlanSecondTables,\n\s+true\n\s+\);/);
  });
});
