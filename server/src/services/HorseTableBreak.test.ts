/**
 * VISIBLE TABLE BREAKING (owner 2026-11-07). A game no longer picked for a
 * second table used to have every horse at that table stood up in one rotator
 * pass. The cluster tick now breaks it (20261107195847) and its horses wait to
 * be moved like people. HIT AND RUN (owner rule): this adds no voluntary leave;
 * a break move is forced (the stack goes with the player), and the only exit a
 * horse still has from that table is the rotator's engine.leaveTable door,
 * which applies the same hit-and-run rule as a person's POST /leave.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  horseCashPlanPrimaryTables,
  horseCashPlanSecondTables,
  horseCashPlanTablesAwaitingBreak,
} from './HorseUnionCashPlan.js';
import { hitRunHandsRemaining, isLeaveLocked } from '../engine/ChipContinuity.js';

const NOW = Date.parse('2026-11-07T20:00:00Z');
const main1 = {
  id: 'a-main1',
  cluster_id: 'g1',
  role: 'main',
  main_index: 1,
  lifecycle: 'live',
  game_variant: 'nlh',
  small_blind: 0.25,
  big_blind: 0.5,
};
const second = { ...main1, id: 'b-feeder', role: 'feeder', main_index: null };
const breaking = { ...second, id: 'c-breaking', lifecycle: 'breaking' };
const primary = horseCashPlanPrimaryTables([main1, second, breaking]);
const noLightning = new Set<string>();

describe('a table the tick breaks is not walked out of', () => {
  it('an unpicked or breaking second table keeps its horses while their Main 1 is allowed', () => {
    const held = horseCashPlanTablesAwaitingBreak(
      [main1, second, breaking],
      primary,
      () => true,
      noLightning,
      NOW
    );
    expect([...held].sort()).toEqual(['b-feeder', 'c-breaking']);
    // Never the Main 1 itself, never when its game is outside the plan,
    // never a Lightning game, never on an unread Lightning list.
    expect(held.has('a-main1')).toBe(false);
    expect(
      horseCashPlanTablesAwaitingBreak([main1, second], primary, () => false, noLightning, NOW).size
    ).toBe(0);
    expect(
      horseCashPlanTablesAwaitingBreak([main1, second], primary, () => true, new Set(['g1']), NOW)
        .size
    ).toBe(0);
    expect(
      horseCashPlanTablesAwaitingBreak([main1, second], primary, () => true, null, NOW).size
    ).toBe(0);
  });

  it('a breaking table is never a "second table" horses may newly sit at', () => {
    expect(horseCashPlanSecondTables([main1, breaking], primary, () => true, NOW).size).toBe(0);
  });

  it('the rotator exempts those tables from the cash-plan stand-up, and nothing else', () => {
    const src = readFileSync(join(__dirname, 'HorseSessionRotator.ts'), 'utf8');
    expect(src).toContain('const cashPlanAwaitingBreak = horseCashPlanTablesAwaitingBreak(');
    expect(src).toMatch(
      /const outsideCashPlan =\s*lightningGameIds !== null &&\s*!cashPlanAwaitingBreak\.has\(tableId\) &&\s*!horseUnionCashTableAllowed\(/
    );
    // benched / off-roster / switched-off game / forbidden stakes still apply.
    expect(src).toContain(
      'if (!benched && !offPlo && !offGame && !restrictedCashGame && !outsideCashPlan && !offDuty)'
    );
  });

  it('HIT AND RUN: the horse keeps only the one voluntary door, and that door holds a horse in profit', () => {
    const src = readFileSync(join(__dirname, 'HorseSessionRotator.ts'), 'utf8');
    const pass = src.slice(
      src.indexOf('const cashPlanAwaitingBreak = horseCashPlanTablesAwaitingBreak('),
      src.indexOf('[SessionRotator] ${rosterLeaves} horse(s) leaving cash seats')
    );
    // The pass leaves only through engine.leaveTable (judged by the hit-and-run
    // rule, horse and human alike: ChipContinuityLeave.behaviour.test.ts), and
    // never cashes out or writes a seat move of its own.
    expect(pass).toContain('await engine.leaveTable(uid)');
    expect(pass).not.toMatch(/atomicCashout|cash_seat_moves|markSeatAsLeft|forced:\s*true/);
    // A horse up 80 over its baseline with 7 of 10 hands still owed is held.
    const row = { baseline: 100, hands_required: 10, hands_played: 3, hit_run_completed: false };
    expect(hitRunHandsRemaining(row, 180)).toBe(7);
    expect(isLeaveLocked(row, 180)).toBe(true);
  });

  it('the break itself is a forced table move through cash_seat_moves, never a leave', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'supabase',
        'migrations',
        '20261107195847_a_new_table_fills_from_its_list_one_name_at_a_time_and_an_un.sql'
      ),
      'utf8'
    );
    expect(sql).toContain('AN UNPICKED SECOND TABLE IS BROKEN, NOT DRAINED');
    expect(sql).not.toMatch(/atomic_cashout|fn_ca_cash_cashout|left_at\s*=\s*now\(\)/i);
  });
});
