import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261121172609_hot_tables_autovacuum_and_fillfactor_tuning.sql'
);

describe('hot-table autovacuum and fillfactor tuning', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('tunes autovacuum and autoanalyze on all 5 high-churn tables with bounded lock_timeout', () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '2s'");
    for (const tbl of [
      'public.tables',
      'public.table_seats',
      'public.chip_ledger',
      'public.hand_state_snapshots',
      'public.ca_hand_gap_watch_history',
    ]) {
      expect(sql).toContain(tbl);
    }
    expect(sql).toContain('autovacuum_vacuum_scale_factor = 0.02');
    expect(sql).toContain('autovacuum_analyze_scale_factor = 0.01');
    expect(sql).toContain('fillfactor = 80');
  });
});
