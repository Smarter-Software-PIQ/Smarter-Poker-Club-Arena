/**
 * LAW: EVERY UNPINNED REPORTING FUNCTION RESOLVES MOVED CASH SEATS (2026-11-19).
 *
 * When a player buys into a cash Feeder table under their funding club and is
 * moved via must-move / break / balance / swap (`fn_cash_seat_move_execute`) to
 * a destination Main table, no new chip-ledger buy-in occurs, so
 * `cash_participant_funding_receipts` has no `buyin` row on the destination
 * `table_id`. Instead, `fn_cash_seat_move_execute` writes an immutable receipt
 * to `public.cash_seat_move_receipts` preserving the funding `club_id`.
 *
 * Stage 2 (`20261119180417_fn_member_record_fact_club_resolves_must_move_receipts.sql`)
 * fixed `fn_member_record_fact_club` and added `cash_seat_move_receipts_dest_player_at_idx`.
 * Stage 3 (`20261119184500_reporting_functions_resolve_must_move_receipts.sql`)
 * updates all 22 remaining unpinned reporting functions and adds
 * `cash_seat_move_receipts_player_dest_at_idx(player_id, to_table_id, created_at DESC, move_id DESC)`
 * for single-player stats RPCs.
 *
 * What this pins:
 *   1. The Stage 3 migration passes `splitConcurrentPreamble` and
 *      `migrationTransactionShape`, is an ordinary (non-window) migration, and
 *      declares `-- @live-proof:` assertions.
 *   2. The latest definition across `supabase/migrations/` of every one of the
 *      22 reporting functions resolves BOTH `cash_participant_funding_receipts`
 *      AND `cash_seat_move_receipts`, preserves `SECURITY DEFINER`, and keeps
 *      exact ACLs (no `anon` grant; private/service-only helpers never granted
 *      to `authenticated`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { declaresMaintenanceWindow } from '../scripts/ci/maintenance-window-migrations.mjs';

const ROOT = resolve(__dirname, '..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');
const MIG_FILE = '20261119184500_reporting_functions_resolve_must_move_receipts.sql';

const REPORTING_FUNCTIONS = [
  // Group A: 17 Player Stats RPCs
  'ca_player_class_hands_by_club',
  'ca_player_ev_curve_by_club',
  'ca_player_hand_grid_by_club',
  'ca_player_hands_separated_by_club',
  'ca_player_hands_v2_by_club',
  'ca_player_nemesis_by_club',
  'ca_player_rake_stats_by_club',
  'ca_player_rake_stats_calendar_by_club',
  'ca_player_stats_club_comparison',
  'ca_player_stats_club_comparison_separated',
  'ca_player_stats_hand_evidence',
  'ca_player_stats_hand_evidence_base',
  'ca_player_stats_overview_separated_by_club',
  'ca_player_stats_overview_v2_by_club',
  'ca_player_stats_pulse_by_club',
  'ca_player_stats_shared_overview_v1',
  'ca_player_stats_shared_separated',
  // Group B: 4 Club Data / rollup functions
  'fn_ca_club_data_ct_seed',
  'fn_ca_club_data_fact_seed',
  'fn_ca_club_rake_daily_compute',
  'fn_ca_reporting_rollups_from_facts',
  // Group C: 1 Roster cash window
  'ca_club_members_cash_window',
] as const;

const POSTGRES_ONLY = new Set(['ca_club_members_cash_window', 'fn_ca_club_data_ct_seed']);
const SERVICE_ONLY = new Set([
  'ca_player_stats_hand_evidence_base',
  'fn_ca_club_data_fact_seed',
  'fn_ca_club_rake_daily_compute',
  'fn_ca_reporting_rollups_from_facts',
]);

describe('all 22 unpinned reporting functions resolve moved cash seats via cash_seat_move_receipts', () => {
  it('ships as an ordinary migration with a concurrent player-index preamble and one transaction', () => {
    const sql = readFileSync(resolve(MIG_DIR, MIG_FILE), 'utf8');
    const split = splitConcurrentPreamble(sql);
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error(split.reason);
    expect(split.indexes).toHaveLength(1);
    expect(split.indexes[0]).toMatchObject({
      schema: 'public',
      table: 'cash_seat_move_receipts',
      name: 'cash_seat_move_receipts_player_dest_at_idx',
    });
    const shape = migrationTransactionShape(MIG_FILE, sql);
    expect(shape.ok).toBe(true);
    expect(declaresMaintenanceWindow(sql)).toBe(false);
    expect(sql).toContain('-- @live-proof:');
  });

  it('the latest definition of every one of the 22 reporting functions resolves both buy-in and move receipts', () => {
    const files = readdirSync(MIG_DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f >= MIG_FILE)
      .sort();

    const fileContents = files.map((f) => ({
      name: f,
      sql: readFileSync(resolve(MIG_DIR, f), 'utf8'),
    }));

    for (const fnName of REPORTING_FUNCTIONS) {
      const defRe = new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fnName}\\s*\\([\\s\\S]*?\\$(?:function)?\\$[\\s\\S]*?\\$(?:function)?\\$;`,
        'i'
      );
      let latestFile = '';
      let latestBody = '';
      let latestFullSql = '';
      for (const entry of fileContents) {
        const m = entry.sql.match(defRe);
        if (m) {
          latestFile = entry.name;
          latestBody = m[0];
          latestFullSql = entry.sql;
        }
      }

      expect(latestFile, `${fnName} must be defined in ${MIG_FILE} or later`).not.toBe('');
      expect(
        latestBody,
        `${fnName} in ${latestFile} must query cash_participant_funding_receipts`
      ).toMatch(/public\.cash_participant_funding_receipts/i);
      expect(
        latestBody,
        `${fnName} in ${latestFile} must also resolve cash_seat_move_receipts`
      ).toMatch(/public\.cash_seat_move_receipts/i);
      expect(latestBody, `${fnName} in ${latestFile} must preserve SECURITY DEFINER`).toMatch(
        /SECURITY\s+DEFINER/i
      );

      if (POSTGRES_ONLY.has(fnName)) {
        expect(latestFullSql, `${fnName} must remain postgres-only`).toMatch(
          new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fnName}\\([^)]*\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
            'i'
          )
        );
      } else if (SERVICE_ONLY.has(fnName)) {
        expect(latestFullSql, `${fnName} must remain service_role-only`).toMatch(
          new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fnName}\\([^)]*\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
            'i'
          )
        );
      } else {
        expect(latestFullSql, `${fnName} must revoke PUBLIC and anon`).toMatch(
          new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fnName}\\([^)]*\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon`,
            'i'
          )
        );
      }
    }
  });
});
