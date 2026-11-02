/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CROSS-VERSION BOOTSTRAP COMPATIBILITY LAW (Phase 2 of 5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Prevents cross-version schedule, certificate, and timer-drift refusals when
 * transitioning between engine releases with different maintenance schedules
 * or timer implementations:
 *
 *  1. Daily `04:00` America/Chicago predecessor (`eed06fe5`) -> `phase1-hourly`
 *     candidate (`cmd_bind_routine_window`, `hold_lightning_when_counting_down`,
 *     `maintenance_certificate`, `legacy_checkpoint_countdown`).
 *  2. Early predecessor timer wakeup (`-1ms` `setTimeout` drift on `eed06fe5`)
 *     -> `maintenance-promise-floor/v1` database witness (`cb733d7201725719813ffd1b1e099b1b`
 *     MD5 of `fn_thaw_platform` from `20261102121000`) + `PHASE1_OBSERVED_WINDOW_END`
 *     preserving the full `120,000ms` notice and `285,000ms` raw proof/rollback reserve.
 *  3. `phase1-hourly` predecessor -> `daily-restoration` candidate when
 *     `server/src/maintenance/maintenanceSchedulePolicy.json` transitions
 *     `phase1Status` to `'complete'` or `'off'`.
 *  4. Candidate runtime timer deadline-floor protection (`scheduleAtExactEpochMs`
 *     wired across all 4 `MaintenanceBreak` wall-clock epoch boundaries).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, '..');
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), 'utf8');

const SEAL_PY = read('server/scripts/engine-release-seal.py');
const TRANSACTION_SH = read('server/scripts/engine-release-transaction.sh');
const DB_PROOF_PY = read('server/scripts/engine-release-database-proof.py');
const PROMISE_SQL = read(
  'supabase/migrations/20261102121000_maintenance_thaw_honors_the_original_announced_release_bound.sql'
);
const SCHEDULE_POLICY = JSON.parse(read('server/src/maintenance/maintenanceSchedulePolicy.json'));
const MAINTENANCE_BREAK_TS = read('server/src/maintenance/MaintenanceBreak.ts');
const DEADLINE_FLOOR_TS = read('server/src/maintenance/deadlineFloorTimer.ts');

describe('cross-version bootstrap compatibility contract (Phase 2)', () => {
  it('pins the three-way schedule compatibility in engine-release-seal.py and engine-release-transaction.sh', () => {
    // 1. Daily predecessor bootstrap schedule qualification
    expect(SEAL_PY).toContain('def daily_bootstrap_schedule(');
    expect(SEAL_PY).toContain(
      "expected={'timeZone':'America/Chicago','startHour':4,'startMinute':0,\n              'durationMs':300000,'hourlyCashFreeze':False}"
    );
    expect(SEAL_PY).toContain(
      "if not hourly and not daily_bootstrap_schedule(args.repo,state['desired']['sha'],s,w['startsAt']):"
    );

    // 2. Transaction shell admits hourly, qualified legacy daily, or Deployment Recovery
    expect(TRANSACTION_SH).toContain('legacy_daily=');
    expect(TRANSACTION_SH).toContain(
      '(hourly or legacy_daily or m.get("reason")=="Deployment Recovery")'
    );

    // 3. Daily restoration transition when phase1Status becomes complete or off
    expect(SEAL_PY).toContain('def cmd_restoration_needed(');
    expect(SEAL_PY).toContain("c.get('kind') not in ('hourly-reset', 'daily-restoration')");
    expect(SCHEDULE_POLICY.schema).toBe('engine-maintenance-schedule/v1');
    expect(['active', 'complete', 'off']).toContain(SCHEDULE_POLICY.phase1Status);
  });

  it('pins the 20261102121000 promised-release floor migration and database witness contract', () => {
    expect(PROMISE_SQL).toContain(
      "-- @live-proof: md5(pg_get_functiondef('public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'::regprocedure)) = 'cb733d7201725719813ffd1b1e099b1b'"
    );
    expect(PROMISE_SQL).toContain(
      "v_due_at := GREATEST(\n    v_break.break_ends_at,\n    v_break.announced_at + INTERVAL '7 minutes'\n  );"
    );
    expect(PROMISE_SQL).toContain('CREATE FUNCTION public.fn_engine_maintenance_promise_proof()');
    expect(PROMISE_SQL).toContain("'schema','maintenance-promise-floor/v1'");

    // Seal & DB proof scripts enforce the exact cb733d7201725719813ffd1b1e099b1b MD5 and -1ms raw bound
    expect(SEAL_PY).toContain('def qualified_early_promise(');
    expect(SEAL_PY).toContain("proof['schema']=='maintenance-promise-floor/v1'");
    expect(SEAL_PY).toContain("proof['thawDefinitionMd5']=='cb733d7201725719813ffd1b1e099b1b'");
    expect(SEAL_PY).toContain("stamp(row['break_started_at'])==w['startsAt']-1");
    expect(SEAL_PY).toContain("stamp(row['break_ends_at'])==w['endsAt']-1");
    expect(DB_PROOF_PY).toContain('fn_engine_maintenance_promise_proof');
    expect(DB_PROOF_PY).toContain('cb733d7201725719813ffd1b1e099b1b');

    // Transaction shell preserves the raw 285,000ms proof/rollback reserve via PHASE1_OBSERVED_WINDOW_END
    expect(TRANSACTION_SH).toContain('PHASE1_OBSERVED_WINDOW_END');
    expect(TRANSACTION_SH).toContain(
      'm.get("breakEndsAt")==int(os.environ.get("PHASE1_OBSERVED_WINDOW_END",str(end)))'
    );
  });

  it('wires scheduleAtExactEpochMs across all four MaintenanceBreak wall-clock epoch timers', () => {
    expect(DEADLINE_FLOOR_TS).toContain('export function scheduleAtExactEpochMs');
    expect(DEADLINE_FLOOR_TS).toContain('const remaining = targetEpochMs - now();');
    expect(DEADLINE_FLOOR_TS).toContain('if (remaining > 0) {');

    expect(MAINTENANCE_BREAK_TS).toContain('export function scheduleAtExactEpochMs');
    expect(MAINTENANCE_BREAK_TS).toContain('const remaining = targetEpochMs - now();');
    const callSites = MAINTENANCE_BREAK_TS.match(/scheduleAtExactEpochMs\(/g) ?? [];
    expect(callSites.length).toBe(4);
    expect(MAINTENANCE_BREAK_TS).toContain('this.announceTimer = handle;');
    expect(MAINTENANCE_BREAK_TS).toContain('this.countdownTimer = handle;');
    expect(MAINTENANCE_BREAK_TS).toContain('this.endTimer = handle;');
    expect(MAINTENANCE_BREAK_TS).toContain('this.secondBreakTimer = handle;');
  });

  it('executes the Python cross-version bootstrap compatibility test cases in isolated state', () => {
    const cases = [
      'HourlyCycle.test_daily_predecessor_binds_only_its_source_and_chicago_cycle',
      'HourlyCycle.test_daily_predecessor_certificate_and_lightning_predicates',
      'HourlyCycle.test_old_early_timer_requires_installed_promise_and_exact_raw_custody',
      'HourlyCycle.test_actual_countdown_consumers_keep_raw_budget_and_full_notice',
      'HourlyCycle.test_verified_completion_restores_daily_once',
      'HourlyCycle.test_explicit_off_restores_daily_once',
      'HourlyCycle.test_promise_reader_uses_one_bounded_get_and_requires_installed_contract',
    ];
    const res = spawnSync(
      'python3',
      ['-B', resolve(ROOT, 'tests/operations/engine-hourly-maintenance.py'), ...cases],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 45_000,
      }
    );
    expect(res.error).toBeUndefined();
    expect(res.status, res.stderr || res.stdout).toBe(0);
    expect(res.stderr).toContain(`Ran ${cases.length} tests`);
    expect(res.stderr).toContain('OK');
    // 4. Single-pass cohort pre-image validator unit suite (tests/operations/verify-cohort-preimage.test.py)
    const preimageRes = spawnSync(
      'python3',
      ['-B', resolve(ROOT, 'tests/operations/verify-cohort-preimage.test.py')],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 15_000,
      }
    );
    expect(preimageRes.error).toBeUndefined();
    expect(preimageRes.status, preimageRes.stderr || preimageRes.stdout).toBe(0);
    expect(preimageRes.stderr).toContain('Ran 5 tests');
    expect(preimageRes.stderr).toContain('OK');
  });

  it('verifies the promise migration SHA-256 matches the immutable historical record', () => {
    const sha256 = createHash('sha256')
      .update(
        readFileSync(
          resolve(
            ROOT,
            'supabase/migrations/20261102121000_maintenance_thaw_honors_the_original_announced_release_bound.sql'
          )
        )
      )
      .digest('hex');
    expect(sha256).toBe('e1da86a40d5c331e85d844baa1c8f0e8a5900ec4e67d57451b31fe69eb6afeb2');
  });
});
