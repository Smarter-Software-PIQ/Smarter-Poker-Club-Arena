/**
 * LAW: no new pg_cron job runs an unbatched raw DELETE FROM statement.
 * ═══════════════════════════════════════════════════════════════════════════
 * Raw `DELETE FROM` commands scheduled via `cron.schedule(...)` or
 * `cron.alter_job(...)` hold long locks and generate massive WAL spikes once
 * retention tables reach millions of rows. New migrations (>= 20261120000000)
 * must call a bounded batch pruner function or supply BOTH an explicit `LIMIT`
 * clause and a `-- @bounded-cron-delete: <reason>` comment.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  CRON_DELETE_CHECKED_FROM,
  checkMigrationsDir,
  findUnboundedCronDeleteViolations,
  isCronDeleteChecked,
} from '../scripts/ci/check-cron-deletes-are-bounded.mjs';

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

describe('no unbatched DELETEs in pg_cron jobs', () => {
  it('rejects raw DELETE FROM inside cron.schedule and cron.alter_job', () => {
    const sql = [
      'DO $cron$',
      'BEGIN',
      "  PERFORM cron.schedule('x', '0 5 * * *', $$DELETE FROM t WHERE ts < now() - interval '14 days'$$);",
      "  PERFORM cron.alter_job(42, command => 'DELETE FROM logs WHERE created_at < now() - interval ''30 days''');",
      'END $cron$;',
    ].join('\n');

    const violations = findUnboundedCronDeleteViolations(
      sql,
      'supabase/migrations/20261120120000_raw_cron_delete.sql'
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({
      file: 'supabase/migrations/20261120120000_raw_cron_delete.sql',
      line: 3,
      callName: 'cron.schedule',
    });
    expect(violations[1]).toMatchObject({
      file: 'supabase/migrations/20261120120000_raw_cron_delete.sql',
      line: 4,
      callName: 'cron.alter_job',
    });
  });

  it('allows cron.schedule calling a bounded pruner function', () => {
    const sql = `
      DO $cron$
      BEGIN
        PERFORM cron.schedule('x', '0 5 * * *', $$SELECT smarter_private.fn_prune_x()$$);
        PERFORM cron.schedule(
          'horse-dealt-hole-cards-prune',
          '3,13,23,33,43,53 * * * *',
          $job$SET statement_timeout = '30s'; SELECT smarter_private.prune_example_audit_rows(20000);$job$
        );
      END $cron$;
    `;
    expect(findUnboundedCronDeleteViolations(sql, '20261120120000_pruner_fn.sql')).toEqual([]);
  });

  it('allows raw DELETE FROM only when BOTH LIMIT and -- @bounded-cron-delete: <reason> are present', () => {
    const validSql = [
      '-- @bounded-cron-delete: bounded to 5000 rows per run via ctid CTE',
      "SELECT cron.schedule('bounded-prune', '0 5 * * *', $$",
      "  WITH doomed AS (SELECT ctid FROM t WHERE ts < now() - interval '14 days' LIMIT 5000)",
      '  DELETE FROM t USING doomed WHERE t.ctid = doomed.ctid;',
      '$$);',
    ].join('\n');
    expect(findUnboundedCronDeleteViolations(validSql, '20261120120000_bounded.sql')).toEqual([]);

    const limitOnlySql =
      "SELECT cron.schedule('limit-only', '0 5 * * *', $$WITH d AS (SELECT ctid FROM t LIMIT 5000) DELETE FROM t USING d WHERE t.ctid = d.ctid$$);";
    expect(
      findUnboundedCronDeleteViolations(limitOnlySql, '20261120120000_limit_only.sql')
    ).toHaveLength(1);

    const commentOnlySql = [
      '-- @bounded-cron-delete: missing limit',
      "SELECT cron.schedule('comment-only', '0 5 * * *', $$DELETE FROM t WHERE ts < now() - interval '14 days'$$);",
    ].join('\n');
    expect(
      findUnboundedCronDeleteViolations(commentOnlySql, '20261120120000_comment_only.sql')
    ).toHaveLength(1);
  });

  it('only enforces migrations with timestamp >= 20261120000000', () => {
    expect(CRON_DELETE_CHECKED_FROM).toBe('20261120000000');
    expect(isCronDeleteChecked('20261119235959_historical.sql')).toBe(false);
    expect(isCronDeleteChecked('20261120000000_new.sql')).toBe(true);
  });

  it('all existing migrations >= 20261120000000 on origin/main pass', () => {
    const { checkedCount, violations } = checkMigrationsDir(MIGRATIONS_DIR);
    expect(checkedCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
