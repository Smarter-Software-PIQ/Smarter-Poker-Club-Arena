/**
 * LAW: a hand-patched cashout writer is seen within the hour (2026-11-26).
 *
 * The four cashout functions were installed from
 * supabase/accounting/weekly-v3/components/20260914164700_... and, by a
 * recorded decision (weekly-v3/README.md), have no mirror in
 * supabase/migrations. Their repo-side proof is
 * scripts/verification-harness/cashier-release-contract.sql, which pins each
 * body by md5 with the cashier grants, policies, triggers and indexes.
 *
 * It used to run only after a client publish, so a body changed straight in
 * production stayed unseen until the next release. The hourly Schema
 * Integrity Audit now runs it and raises an issue when it fails. This law
 * pins that job, that it stays read-only, and that it alarms.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('a hand-patched cashout writer is seen within the hour', () => {
  const wf = read('.github/workflows/schema-manifest-refresh.yml');
  const start = wf.indexOf('  cashier-writers-unchanged:');
  const end = wf.indexOf('\n  definer-exposure:');
  const job = wf.slice(start, end);

  it('the integrity audit still runs every hour', () => {
    expect(wf).toContain("- cron: '40 * * * *'");
  });

  it('the cashier contract job exists, carries no schedule filter and runs the certifier', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(job).not.toContain("github.event.schedule != '40 * * * *'");
    expect(job).toContain('node scripts/verification-harness/certify-cashier-contract.mjs');
    expect(job).toContain('SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}');
    expect(job).not.toMatch(/continue-on-error/);
  });

  it('a failure opens or comments on one issue and a clean run closes it', () => {
    expect(job).toContain("if: failure() && steps.contract.outcome == 'failure'");
    expect(job).toContain('gh issue create');
    expect(job).toContain('gh issue close');
  });

  it('the contract it runs stays read-only and pins all four writers', () => {
    const sql = read('scripts/verification-harness/cashier-release-contract.sql');
    expect(sql).toContain('SET TRANSACTION READ ONLY;');
    expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    for (const fn of [
      'fn_cashout_request_v2',
      'fn_cashout_approve_v2',
      'fn_cashout_release_v2',
      'fn_cashout_operation_receipt_v2',
    ]) {
      expect(sql).toContain(fn);
    }
  });
});
