/**
 * LAW: A SEAT MOVE CARRIES ITS PROMO POSITIONS (2026-11-21).
 *
 * Incidents bb04ee5f (ServerTableEngine.authoritative_hand_unreachable),
 * e542fbd7 (postHandTasks.hand_history_failed) and 887c0008
 * (ClubArenaEngineKillStorm). Every restricted promo position on the felt is
 * keyed to the table the chips sit on (kind 'table_stack', entity_id =
 * tables.id). fn_cash_seat_move_execute moved a player's stack to a feeder
 * and back without moving those positions, so on the feeder no loss was
 * charged to the promo, and back on the original table 7.20 of principal met
 * a 2.64 stack: fn_ca_promo_profit_capture_cash refused the hand
 * (original_winnings_sources_exceed_accepted_stack) and the table's engine
 * was rebuilt about twenty times a minute for six hours.
 *
 * What this pins:
 *   1. The root-fix migration is an ordinary single-transaction migration
 *      with a live proof, guarded by the exact preimage of
 *      fn_cash_seat_move_execute.
 *   2. fn_ca_promo_follow_seat_move moves all three position families
 *      (integrity, winnings, principal) from (table_stack, from) to
 *      (table_stack, to) with the platform's existing movers, after the
 *      cash-out's own locks, and refuses the move if anything is left behind.
 *   3. Both the mover and the swap partner call it, right after their Diamond
 *      custody follows the seat.
 *   4. Any LATER migration that redefines fn_cash_seat_move_execute keeps both
 *      calls, and no later migration redefines fn_ca_promo_follow_seat_move
 *      without all three movers and the left-behind refusal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { declaresMaintenanceWindow } from '../scripts/ci/maintenance-window-migrations.mjs';

const ROOT = resolve(__dirname, '..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');
const FIX = '20261121143259_a_seat_move_carries_its_promo_positions.sql';
const read = (f: string) => readFileSync(resolve(MIG_DIR, f), 'utf8');
const later = () =>
  readdirSync(MIG_DIR)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > FIX)
    .sort();

describe('a seat move carries its promo positions', () => {
  const sql = read(FIX);

  it('ships as one ordinary transaction with a live proof and an exact preimage', () => {
    const shape = migrationTransactionShape(FIX, sql);
    expect(shape.ok).toBe(true);
    expect(declaresMaintenanceWindow(sql)).toBe(false);
    expect(sql).toMatch(/^-- @live-proof: .*fn_ca_promo_follow_seat_move/m);
    expect(sql).toContain("IF md5(d)<>'5145b0cf788bd10d693df9e10f109e89'");
  });

  it('moves every position family with the existing movers and refuses a leftover', () => {
    const fn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_promo_follow_seat_move'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.fn_ca_promo_follow_seat_move')
    );
    expect(fn).toMatch(/SECURITY DEFINER/);
    const prelock = fn.indexOf('fn_ca_promo_profit_prelock_source');
    const integrity = fn.indexOf('fn_ca_promo_integrity_move');
    const winnings = fn.indexOf('fn_ca_promo_profit_move_grant');
    const principal = fn.indexOf('fn_ca_promo_move_selected_custody');
    // The cash-out's order: locks, integrity (with its overlap), winnings, principal.
    expect(prelock).toBeGreaterThan(0);
    expect(integrity).toBeGreaterThan(prelock);
    expect(winnings).toBeGreaterThan(integrity);
    expect(principal).toBeGreaterThan(winnings);
    // Each mover lands on the destination table, never NULL (a spend).
    expect(fn).toMatch(/fn_ca_promo_integrity_move\([^)]*'table_stack',p_from,'table_stack',p_to/);
    expect(fn).toMatch(
      /fn_ca_promo_profit_move_grant\([^)]*'table_stack',p_from,'table_stack',p_to/
    );
    expect(fn).toMatch(
      /fn_ca_promo_move_selected_custody\([^)]*'table_stack',p_from,'table_stack',p_to/
    );
    // A seat never arrives without its restrictions.
    expect(fn.match(/promo_position_left_behind_by_seat_move/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_promo_follow_seat_move\(uuid,uuid,uuid\) FROM PUBLIC,anon,authenticated,service_role/
    );
  });

  it('the mover and the swap partner both carry their positions', () => {
    expect(sql).toContain(
      'PERFORM public.fn_ca_promo_follow_seat_move(source_row.user_id,m.from_table_id,m.to_table_id);'
    );
    expect(sql).toContain(
      'PERFORM public.fn_ca_promo_follow_seat_move(partner_source.user_id,pm.from_table_id,pm.to_table_id);'
    );
  });

  it('no later migration drops the call or weakens the mover', () => {
    for (const f of later()) {
      const text = read(f);
      if (
        /fn_cash_seat_move_execute\(uuid\)/.test(text) &&
        /EXECUTE|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_seat_move_execute/i.test(
          text
        )
      ) {
        if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_seat_move_execute/i.test(text)) {
          expect(text, f).toContain('fn_ca_promo_follow_seat_move(source_row.user_id');
          expect(text, f).toContain('fn_ca_promo_follow_seat_move(partner_source.user_id');
        }
      }
      if (
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_promo_follow_seat_move/i.test(text)
      ) {
        expect(text, f).toContain('fn_ca_promo_integrity_move');
        expect(text, f).toContain('fn_ca_promo_profit_move_grant');
        expect(text, f).toContain('fn_ca_promo_move_selected_custody');
        expect(text, f).toContain('promo_position_left_behind_by_seat_move');
      }
    }
  });
});
