import { describe, expect, it } from 'vitest';
import {
  HORSE_UNION_CASH_PLAN as plan,
  horseCashPlanPrimaryTables,
  horseUnionCashTableAllowed,
  type CashPlanTable,
} from './HorseUnionCashPlan.js';

/**
 * LIGHTNING GAMES ALWAYS RUN (Dan 2026-11-05): "lightning tables must always
 * run, they are feeder games until enough players are playing, then they turn
 * to lightning games ONLY WHEN THERE IS ENOUGH PLAYERS. there should never be
 * a on off timer for these games! ever!!"
 */
const LIGHTNING_GAME = '705270cd-03c2-40d9-8749-038f741a295c'; // PLO4 0.25/0.50 Lightning Games
const lightningGames = new Set([LIGHTNING_GAME]);
const base: CashPlanTable = {
  union_id: plan.unionId,
  cluster_id: LIGHTNING_GAME,
  game_variant: 'plo4',
  small_blind: 0.25,
  big_blind: 0.5,
  lifecycle: 'live',
};
const main1 = { ...base, id: 'lightning-main-1', role: 'main', main_index: 1 };
const main2 = { ...base, id: 'lightning-main-2', role: 'main', main_index: 2 };
const feeder = { ...base, id: 'lightning-feeder', role: 'feeder', main_index: null };
const primary = horseCashPlanPrimaryTables([main1, main2, feeder]);

describe('Lightning games are never switched off by a clock', () => {
  it('allows every Lightning Main and Feeder at every hour of a whole week, with no humans', () => {
    for (let hourOfWeek = 0; hourOfWeek < 7 * 24; hourOfWeek++) {
      const now = Date.UTC(2026, 10, 9, 6) + hourOfWeek * 3_600_000 + 17 * 60_000;
      for (const table of [main1, main2, feeder])
        expect(horseUnionCashTableAllowed(table, 0, now, primary, lightningGames)).toBe(true);
    }
  });

  it('still keeps forbidden variants and the stake ceiling, which are not timers', () => {
    const now = Date.UTC(2026, 10, 9, 15);
    expect(
      horseUnionCashTableAllowed(
        { ...feeder, game_variant: 'plo8' },
        0,
        now,
        primary,
        lightningGames
      )
    ).toBe(false);
    expect(
      horseUnionCashTableAllowed(
        { ...main1, small_blind: 5, big_blind: 10 },
        0,
        now,
        primary,
        lightningGames
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
    const feederOfClassic = { ...classic, id: 'classic-feeder', role: 'feeder', main_index: null };
    const now = Date.UTC(2026, 10, 9, 15);
    const p = horseCashPlanPrimaryTables([classic]);
    expect(horseUnionCashTableAllowed(classic, 0, now, p, lightningGames)).toBe(
      horseUnionCashTableAllowed(classic, 0, now, p)
    );
    expect(horseUnionCashTableAllowed(feederOfClassic, 0, now, p, lightningGames)).toBe(false);
  });

  it('an unread Lightning list changes nothing (fails to the previous rule)', () => {
    const now = Date.UTC(2026, 10, 9, 15);
    expect(horseUnionCashTableAllowed(feeder, 0, now, primary, null)).toBe(
      horseUnionCashTableAllowed(feeder, 0, now, primary)
    );
  });
});
