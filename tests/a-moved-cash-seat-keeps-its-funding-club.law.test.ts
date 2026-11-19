/**
 * LAW: A MOVED CASH SEAT KEEPS ITS FUNDING CLUB (2026-11-19).
 *
 * Incident: Butter (fa407ee1-5473-42ec-a9ac-a1eee50983fe) bought into
 * `PLO6 0.50/1 Classic Feeder` funded by Kings Club (a41434bb-...) and was
 * must-moved by `fn_cash_seat_move_execute` onto `PLO6 0.50/1 Classic Main 4`
 * (a union table under fade0000-...). Because a seat move does not debit
 * `chip_ledger`, `cash_participant_funding_receipts` has no `buyin` row on
 * Main 4 — the immutable custody record lives in `cash_seat_move_receipts`.
 *
 * `fn_member_record_fact_club(ca_hand_facts)` previously checked only
 * `cash_participant_funding_receipts`, missing moved seats and falling back
 * to post-commit `rake_attributions` (which lagged insert time) and then
 * `f.club_id` (the union table club) for all 40 un-raked hands.
 *
 * What this pins:
 *   1. The migration passes `splitConcurrentPreamble` and
 *      `migrationTransactionShape`, and is an ordinary (non-window) migration.
 *   2. The latest definition of `public.fn_member_record_fact_club` across
 *      `supabase/migrations/` resolves BOTH `cash_participant_funding_receipts`
 *      AND `cash_seat_move_receipts`, preserves `SECURITY DEFINER`,
 *      `SET search_path = public, pg_temp`, and revokes execute from
 *      `PUBLIC, anon, authenticated, service_role`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { declaresMaintenanceWindow } from '../scripts/ci/maintenance-window-migrations.mjs';

const ROOT = resolve(__dirname, '..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');
const MIG_FILE = '20261119180417_fn_member_record_fact_club_resolves_must_move_receipts.sql';

describe('a moved cash seat keeps its funding club in member record attribution', () => {
  it('ships as an ordinary migration with a concurrent index preamble and one transaction', () => {
    const sql = readFileSync(resolve(MIG_DIR, MIG_FILE), 'utf8');
    const split = splitConcurrentPreamble(sql);
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error(split.reason);
    expect(split.indexes).toHaveLength(1);
    expect(split.indexes[0]).toMatchObject({
      schema: 'public',
      table: 'cash_seat_move_receipts',
      name: 'cash_seat_move_receipts_dest_player_at_idx',
    });
    const shape = migrationTransactionShape(MIG_FILE, split.body);
    expect(shape.ok).toBe(true);
    expect(declaresMaintenanceWindow(sql)).toBe(false);
    expect(sql).toContain('-- @live-proof:');
  });

  it('the latest definition of fn_member_record_fact_club resolves both buy-in and move receipts', () => {
    const files = readdirSync(MIG_DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f >= MIG_FILE)
      .sort();
    const defining = files.filter((f) => {
      const text = readFileSync(resolve(MIG_DIR, f), 'utf8');
      return /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_member_record_fact_club\s*\(/i.test(
        text
      );
    });
    expect(defining.length).toBeGreaterThan(0);
    const latestFile = defining.at(-1)!;
    expect(latestFile >= MIG_FILE).toBe(true);

    const latestSql = readFileSync(resolve(MIG_DIR, latestFile), 'utf8');
    const fnMatch = latestSql.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_member_record_fact_club\s*\([\s\S]*?\$\$[\s\S]*?\$\$;/i
    );
    expect(
      fnMatch,
      `could not extract fn_member_record_fact_club from ${latestFile}`
    ).not.toBeNull();
    const fnBody = fnMatch![0];

    expect(fnBody).toMatch(/public\.cash_participant_funding_receipts/i);
    expect(fnBody).toMatch(/public\.cash_seat_move_receipts/i);
    expect(fnBody).toMatch(/to_table_id\s*=\s*f\.table_id/i);
    expect(fnBody).toMatch(/player_id\s*=\s*f\.user_id/i);
    expect(fnBody).toMatch(/created_at\s*<=\s*f\.played_at/i);
    expect(fnBody).toMatch(/SECURITY\s+DEFINER/i);
    expect(fnBody).toMatch(/SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
    expect(latestSql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_member_record_fact_club\(public\.ca_hand_facts\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i
    );
  });
});
