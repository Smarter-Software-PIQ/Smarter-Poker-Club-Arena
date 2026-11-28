/**
 * A WINDOW MIGRATION INSTALLS AGAINST PRODUCTION'S SCHEMA BEFORE IT MERGES
 * (owner instruction, 11:04 Chicago 2026-11-17). On 2026-11-17 all seven
 * queued "-- @install-window: daily-maintenance" files were refused at 04:00,
 * the first with "function public.fn_ca_promo_integrity_immutable() does not
 * exist" (Stage 44034697186): nothing had installed them against production's
 * schema before. The pull-request gate rehearses the whole queue; the native
 * half (scripts/ci/test-window-queue-rehearsal.sh) proves a missing
 * dependency fails it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  pendingFloor,
  planRehearsal,
  rehearsalSQL,
  rehearsalSchemaOnlyExemptReason,
} from '../scripts/ci/window-queue-rehearsal.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const W = (body: string) => `-- @install-window: daily-maintenance\nBEGIN;\n${body}\nCOMMIT;\n`;
const ORD = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';

describe('the window queue is rehearsed in the installer order before merge', () => {
  it('queues every uninstalled window file after the uninstalled ordinary ones, never an installed or superseded file', () => {
    const files = [
      { name: '20261116214149_returned_promo.sql', sql: W('SELECT 1;') },
      { name: '20261116151020_signup_promo.sql', sql: ORD },
      { name: '20261116154719_promo_tickets.sql', sql: W('SELECT 2;') },
      { name: '20261101000000_old_window.sql', sql: W('SELECT 3;') },
      {
        name: '20261102000000_replaced.sql',
        sql: '-- SUPERSEDED BY 20261116154719\n' + W('SELECT 4;'),
      },
    ];
    const plan = planRehearsal(
      files,
      new Set(['20261101000000']),
      new Set(['20261116214149_returned_promo.sql'])
    );
    expect(plan.ordinary).toEqual(['20261116151020_signup_promo.sql']);
    expect(plan.window).toEqual([
      '20261116154719_promo_tickets.sql',
      '20261116214149_returned_promo.sql',
    ]);
    expect(plan.changedWindow).toEqual(['20261116214149_returned_promo.sql']);
    expect(plan.superseded).toEqual([
      { name: '20261102000000_replaced.sql', by: '20261116154719' },
    ]);
  });

  it('pending or history is decided from evidence, not from a version string alone', () => {
    const ORD2 = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
    const now = Date.UTC(2026, 10, 18, 16, 0, 0);
    const installed = new Set(['20261118092009']);
    const files = [
      { name: '20260124120000_ancient_never_recorded.sql', sql: ORD2 },
      { name: '20260301000000_recorded_by_name.sql', sql: ORD2 },
      { name: '20260402000000_merged_late_with_an_old_stamp.sql', sql: ORD2 },
      { name: '20261117100000_recent.sql', sql: ORD2 },
    ];
    const plan = planRehearsal(files, installed, new Set(), {
      now,
      recordedNames: new Set(['recorded_by_name']),
      recentlyAdded: new Set(['20260402000000_merged_late_with_an_old_stamp.sql']),
      aliasedFiles: new Set(),
    });
    // 1,003 such ancient files were replayed over production's schema on 2026-11-18.
    expect(plan.ordinary).toEqual([
      '20260402000000_merged_late_with_an_old_stamp.sql',
      '20261117100000_recent.sql',
    ]);
    // No git evidence: the time bound alone still keeps the recent file.
    expect(planRehearsal(files, installed, new Set(), { now }).ordinary).toEqual([
      '20261117100000_recent.sql',
    ]);
  });

  it('one future-stamped installed version cannot turn pending files into history', () => {
    const ORD2 = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
    const now = Date.UTC(2026, 10, 18, 16, 0, 0);
    const future = new Set(['20991231235959', '20261118092009']);
    expect(pendingFloor(future, now)).toBe('20261116160000');
    expect(pendingFloor(new Set(['20261118092009']), now)).toBe('20261116092009');
    expect(
      planRehearsal([{ name: '20261118100000_pending.sql', sql: ORD2 }], future, new Set(), { now })
        .ordinary
    ).toEqual(['20261118100000_pending.sql']);
  });

  it('a statically invalid window file is named, and charged to the pull request that changes it', () => {
    const bad = { name: '20261117000000_two_tx.sql', sql: W('SELECT 1;\nCOMMIT;\nBEGIN;') };
    const plan = planRehearsal([bad], new Set(), new Set([bad.name]));
    expect(plan.window).toEqual([]);
    expect(plan.invalid).toHaveLength(1);
    expect(plan.invalid[0]).toMatchObject({ name: bad.name, changed: true });
  });

  it("carries the installer's override reason and bounds inside the file's own transaction", () => {
    const sql = rehearsalSQL('20261117000000_a.sql', W('SELECT 1;'));
    expect(sql.indexOf('BEGIN;')).toBeLessThan(
      sql.indexOf('SET LOCAL ca.break_window_migration_override')
    );
    expect(sql).toContain("SET LOCAL lock_timeout = '1000ms'");
    expect(sql).toContain("SET LOCAL statement_timeout = '5000ms'");
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('runs on every same-repository pull request, with production credentials only in the default-branch capture job', () => {
    const wf = parse(
      read('.github/workflows/window-migrations-install-before-merge.yml')
    ) as Record<string, any>;
    expect(Object.keys(wf.on)).toEqual(['pull_request_target']);
    expect(wf.on.schedule).toBeUndefined();
    const { scope, capture, rehearse } = wf.jobs;
    expect(scope.if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
    expect(capture.environment).toBe('ci-main');
    const checkout = capture.steps.find((s: any) =>
      String(s.uses ?? '').startsWith('actions/checkout')
    );
    expect(checkout.with.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(JSON.stringify(capture)).not.toContain('head.sha');
    // The job that executes the branch's SQL has no environment and no secret.
    expect(rehearse.environment).toBeUndefined();
    expect(JSON.stringify(rehearse)).not.toContain('secrets.');
    expect(rehearse.permissions).toEqual({ contents: 'read' });
    expect(rehearse.name).toBe("Window migrations install against production's schema");
    // An unreadable capture is UNKNOWN, never a pass.
    expect(JSON.stringify(rehearse)).toContain("needs.capture.result != 'success'");
  });

  it('the native regression runs where the window route is already qualified', () => {
    const wf = read('.github/workflows/maintenance-window-migrations.yml');
    expect(wf).toContain('bash scripts/ci/test-window-queue-rehearsal.sh');
    expect(wf).toContain("'scripts/ci/fixtures/window-queue-rehearsal/**'");
    const native = read('scripts/ci/test-window-queue-rehearsal.sh');
    expect(native).toContain('20991231100003_window_rehearsal_needs_a_missing_function.sql');
    expect(native).toContain(
      'a pull request adding a window file that calls a function production lacks fails'
    );
    expect(native).toContain('20991231100005_ordinary_rehearsal_broken_probe.sql');
    expect(native).toContain('a pull request adding a broken ordinary migration fails');
  });

  it('refuses a broken ordinary migration added or modified by the pull request unless explicitly schema-only exempt (incident 37a45c05 / PR #12325)', () => {
    const sh = read('scripts/ci/rehearse-window-queue.sh');
    expect(sh).toContain('REFUSED** ordinary');
    expect(sh).toContain('schema-only-exempt');
    expect(
      rehearsalSchemaOnlyExemptReason(
        '-- @rehearsal-schema-only-exempt: requires live production rows absent from empty schema dump\nBEGIN; SELECT 1; COMMIT;'
      )
    ).toBe('requires live production rows absent from empty schema dump');
    expect(
      rehearsalSchemaOnlyExemptReason('-- @rehearsal-schema-only-exempt: too short\nBEGIN; COMMIT;')
    ).toBeNull();
    expect(rehearsalSchemaOnlyExemptReason('BEGIN; SELECT 1; COMMIT;')).toBeNull();
  });
});
