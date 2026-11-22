import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertReadOnlySql,
  buildConfigAlarmsSql,
  buildDailyDecisionLatencySql,
  buildFlushReceiptLatencySql,
  buildResetTrapsSql,
  buildServingRegistrySql,
  evaluateCommitAncestry,
  evaluateConfigAlarms,
  evaluateLiveHealth,
  evaluateResetTraps,
  evaluateServingRegistry,
  formatAuditReportText,
  parseCliArgs,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
  runPostCutoverAudit,
  summarizeLatencyRows,
  validateCompareHours,
  validateHexSha,
} from '../../scripts/ops/post-cutover-audit-lib.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');

const HEALTHY_BODY = {
  releaseSha: 'c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa',
  liveness: 'ok',
  settlementStatus: 'ok',
  stalledTableCount: 0,
  maintenance: {
    phase: 'idle',
    resumeWaves: {
      total: 3,
      done: 3,
      startedAt: 1795309500132,
      finishedAt: 1795309503134,
      tables: 75,
      tablesResumed: 75,
    },
  },
};

describe('post-cutover-audit-lib', () => {
  describe('CLI argument parsing & input validation', () => {
    it('parses repeated --expect-sha, --compare-hours, --json, and --strict-latency', () => {
      const opts = parseCliArgs([
        '--expect-sha',
        '5b09ace7f7b',
        '--expect-sha=C2D6E45E3BCC',
        '--compare-hours',
        '2.5',
        '--json',
        '--strict-latency',
      ]);
      expect(opts.expectShas).toEqual(['5b09ace7f7b', 'c2d6e45e3bcc']);
      expect(opts.compareHours).toBe(2.5);
      expect(opts.json).toBe(true);
      expect(opts.strictLatency).toBe(true);
    });

    it('rejects invalid SHAs, invalid compare hours, and unknown flags', () => {
      expect(() => validateHexSha("abc'; DROP TABLE x;--")).toThrow(/Invalid sha/);
      expect(() => validateHexSha('123')).toThrow(/Invalid sha/);
      expect(() => validateCompareHours(0)).toThrow(/Invalid --compare-hours/);
      expect(() => validateCompareHours(500)).toThrow(/Invalid --compare-hours/);
      expect(() => parseCliArgs(['--unknown-flag'])).toThrow(/Unknown argument/);
    });
  });

  describe('SQL read-only safety & Supabase CLI parsing', () => {
    it('accepts all built audit queries as strictly read-only SELECT/WITH', () => {
      expect(assertReadOnlySql(buildServingRegistrySql())).toContain(
        'ca_horse_option_registry_serving'
      );
      expect(assertReadOnlySql(buildResetTrapsSql())).toContain(
        'fn_ca_horse_option_registry_refusal'
      );
      expect(assertReadOnlySql(buildConfigAlarmsSql(1))).toContain('option_switch_config_%');
      expect(assertReadOnlySql(buildFlushReceiptLatencySql('c2d6e45e3bcc', 1))).toContain(
        'horse_brain_flush_receipts'
      );
      expect(assertReadOnlySql(buildDailyDecisionLatencySql())).toContain('horse_decision_latency');
    });

    it('rejects mutating SQL, non-SELECT queries, and multi-statement SQL', () => {
      expect(() => assertReadOnlySql('DELETE FROM public.ca_horse_style_switch')).toThrow(
        /non-SELECT/
      );
      expect(() => assertReadOnlySql('SELECT 1; DROP TABLE foo')).toThrow(/multi-statement/);
      expect(() =>
        assertReadOnlySql(
          'WITH x AS (UPDATE public.ca_horse_style_switch SET state = $$off$$) SELECT * FROM x'
        )
      ).toThrow(/mutating SQL/);
    });

    it('parses Supabase CLI JSON output even when wrapped with CLI notices', () => {
      const wrapped =
        'Some notice\n[{"release_sha":"c2d6e45e3bcc"}]\nA new version of Supabase CLI is available';
      expect(parseSupabaseJsonOutput(wrapped)).toEqual([{ release_sha: 'c2d6e45e3bcc' }]);
      expect(() => parseSupabaseJsonOutput('')).toThrow(/empty output/);
    });

    it('auto-resolves linked Supabase workdir from git common dir when in a worktree', () => {
      const worktreeCwd = path.resolve(REPO_ROOT, 'fixtures', 'mock-worktree');
      const primaryCheckout = path.resolve(REPO_ROOT, 'fixtures', 'mock-primary-checkout');
      const resolved = resolveLinkedSupabaseWorkdir({
        cwd: worktreeCwd,
        gitCommonDirRunner: () => `${path.join(primaryCheckout, '.git')}\n`,
        pathExists: (p) => p === path.join(primaryCheckout, 'supabase', '.temp', 'project-ref'),
      });
      expect(resolved).toBe(primaryCheckout);
    });

    it('never reads .env or contains raw secret loaders in either script file', () => {
      const cliSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/post-cutover-audit.mjs'),
        'utf8'
      );
      const libSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/post-cutover-audit-lib.mjs'),
        'utf8'
      );
      for (const [name, src] of [
        ['post-cutover-audit.mjs', cliSource],
        ['post-cutover-audit-lib.mjs', libSource],
      ]) {
        expect(src, `${name} must not reference dotenv`).not.toMatch(/dotenv/i);
        expect(src, `${name} must not open .env files`).not.toMatch(/readFileSync\([^)]*\.env/);
        expect(src, `${name} must not reference SUPABASE_SERVICE_ROLE_KEY`).not.toMatch(
          /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL/
        );
      }
      expect(cliSource).toContain("'--linked'");
      expect(cliSource).toContain("'-o'");
      expect(cliSource).toContain("'json'");
      expect(cliSource).toContain("'--agent=no'");
    });
  });

  describe('individual check evaluators', () => {
    it('Check 1: live_health passes when healthy (with completed or null resumeWaves) and fails on regressions', () => {
      expect(evaluateLiveHealth(HEALTHY_BODY, 200).status).toBe('pass');
      expect(
        evaluateLiveHealth(
          { ...HEALTHY_BODY, maintenance: { phase: 'idle', resumeWaves: null } },
          200
        ).status
      ).toBe('pass');

      const bad = evaluateLiveHealth(
        {
          ...HEALTHY_BODY,
          liveness: 'degraded',
          settlementStatus: 'blocked',
          stalledTableCount: 2,
          maintenance: {
            phase: 'break',
            resumeWaves: { total: 3, done: 1, finishedAt: null, tables: 75, tablesResumed: 25 },
          },
        },
        503
      );
      expect(bad.status).toBe('fail');
      expect(bad.failures.length).toBeGreaterThanOrEqual(6);
    });

    it('Check 2: serving_registry_freshness enforces SHA match and <= 5m freshness', () => {
      const ok = evaluateServingRegistry(
        [
          {
            release_sha: HEALTHY_BODY.releaseSha,
            registry_digest: 'abc',
            seen_at: '2026-11-22T02:40:00Z',
            age_sec: 12.4,
          },
        ],
        HEALTHY_BODY.releaseSha,
        300
      );
      expect(ok.status).toBe('pass');

      const stale = evaluateServingRegistry(
        [{ release_sha: HEALTHY_BODY.releaseSha, seen_at: '2026-11-22T02:00:00Z', age_sec: 301 }],
        HEALTHY_BODY.releaseSha,
        300
      );
      expect(stale.status).toBe('fail');
      expect(stale.failures[0]).toMatch(/stale/i);

      const mismatch = evaluateServingRegistry(
        [{ release_sha: '1111111111111111111111111111111111111111', age_sec: 5 }],
        HEALTHY_BODY.releaseSha,
        300
      );
      expect(mismatch.status).toBe('fail');
      expect(mismatch.failures[0]).toMatch(/no row in ca_horse_option_registry_serving/);
    });

    it('Check 3: zero_reset_traps passes when all rows have NULL refusal and reports exact offending rows otherwise', () => {
      const clean = evaluateResetTraps([
        { option: 'v87HoldemOverhaul', state: 'on', refusal: null },
        { option: 'v86PloOverhaul', state: 'off', refusal: null },
      ]);
      expect(clean.status).toBe('pass');
      expect(clean.details.totalRows).toBe(2);
      expect(clean.details.offendingCount).toBe(0);

      const trapped = evaluateResetTraps([
        { option: 'v87HoldemOverhaul', state: 'on', refusal: null },
        {
          option: 'unregisteredOpt',
          state: 'on',
          refusal: 'option_not_registered_on_serving_release',
          updated_by: 'operator',
          updated_at: '2026-11-22T02:00:00Z',
        },
      ]);
      expect(trapped.status).toBe('fail');
      expect(trapped.details.offendingCount).toBe(1);
      expect(trapped.details.offendingRows[0]).toMatchObject({
        option: 'unregisteredOpt',
        state: 'on',
        refusal: 'option_not_registered_on_serving_release',
      });
    });

    it('Check 4: zero_config_alarms fails when any option_switch_config_% row has fires > 0', () => {
      expect(evaluateConfigAlarms([], 1).status).toBe('pass');
      const fired = evaluateConfigAlarms(
        [{ day: '2026-11-22', feature: 'option_switch_config_invalid', fires: 3 }],
        1
      );
      expect(fired.status).toBe('fail');
      expect(fired.details.alarmCount).toBe(1);
    });

    it('Check 5: commit_ancestry proves ancestry for all --expect-sha arguments', () => {
      expect(
        evaluateCommitAncestry([], HEALTHY_BODY.releaseSha, () => ({ ok: false })).status
      ).toBe('pass');
      const ok = evaluateCommitAncestry(['5b09ace7f7b'], HEALTHY_BODY.releaseSha, () => ({
        ok: true,
        reason: null,
      }));
      expect(ok.status).toBe('pass');
      const fail = evaluateCommitAncestry(['deadbeef123'], HEALTHY_BODY.releaseSha, () => ({
        ok: false,
        reason: 'not_ancestor',
      }));
      expect(fail.status).toBe('fail');
      expect(fail.failures[0]).toMatch(/NOT an ancestor/);
    });

    it('Check 6: latency_summary detects >1% >100ms starvation with topHotNode and returns unknown when empty', () => {
      const empty = summarizeLatencyRows([], { source: 'horse_decision_latency', compareHours: 1 });
      expect(empty.status).toBe('unknown');

      const warned = summarizeLatencyRows(
        [
          { scope: 'nlh', samples: 1000, avg_ms: 40, max_ms: 420, over100: 15 },
          {
            scope: 'phase15_node_tournament_utility',
            samples: 1000,
            avg_ms: 18,
            max_ms: 390,
            over100: 9,
          },
        ],
        { source: 'horse_brain_flush_receipts', compareHours: 1 }
      );
      expect(warned.status).toBe('warn');
      expect(warned.details.starvationAlert).toBe(true);
      expect(warned.details.topHotNode).toBe('phase15_node_tournament_utility');
      expect(warned.details.alertedScopes).toHaveLength(1);
    });
  });

  describe('end-to-end runPostCutoverAudit orchestration', () => {
    it('passes all 6 checks end-to-end and formats readable text output', async () => {
      const querySupabase = vi.fn(async (sql: string) => {
        if (sql.includes('ca_horse_option_registry_serving')) {
          return [
            { release_sha: HEALTHY_BODY.releaseSha, age_sec: 8.2, seen_at: '2026-11-22T02:40:00Z' },
          ];
        }
        if (sql.includes('ca_horse_style_switch')) {
          return [{ option: 'v87HoldemOverhaul', state: 'on', refusal: null }];
        }
        if (sql.includes('horse_brain_telemetry')) {
          return [];
        }
        if (sql.includes('horse_brain_flush_receipts')) {
          return [
            { scope: 'nlh', samples: 500, avg_ms: 12, max_ms: 85, over100: 0 },
            { scope: 'plo4', samples: 200, avg_ms: 18, max_ms: 92, over100: 0 },
          ];
        }
        return [];
      });

      const report = await runPostCutoverAudit(
        { expectShas: ['5b09ace7f7b'], compareHours: 1 },
        {
          now: () => Date.parse('2026-11-22T02:45:00Z'),
          fetchHealth: async () => ({ status: 200, body: HEALTHY_BODY }),
          querySupabase,
          isGitAncestor: () => ({ ok: true, reason: null }),
        }
      );

      expect(report.overallStatus).toBe('PASS');
      expect(report.passed).toBe(true);
      expect(report.checks.map((c) => `${c.name}:${c.status}`)).toEqual([
        'live_health:pass',
        'serving_registry_freshness:pass',
        'zero_reset_traps:pass',
        'zero_config_alarms:pass',
        'commit_ancestry:pass',
        'latency_summary:pass',
      ]);

      const text = formatAuditReportText(report);
      expect(text).toContain('OVERALL: PASS');
      expect(text).toContain('5b09ace7f7b -> ANCESTOR');
    });

    it('gracefully marks latency_summary as explicit unknown when latency tables/columns are missing', async () => {
      const querySupabase = vi.fn(async (sql: string) => {
        if (sql.includes('ca_horse_option_registry_serving')) {
          return [
            { release_sha: HEALTHY_BODY.releaseSha, age_sec: 10, seen_at: '2026-11-22T02:40:00Z' },
          ];
        }
        if (sql.includes('ca_horse_style_switch')) {
          return [{ option: 'v87HoldemOverhaul', state: 'on', refusal: null }];
        }
        if (sql.includes('horse_brain_telemetry')) {
          return [];
        }
        throw new Error('ERROR: 42P01: relation "public.horse_decision_latency" does not exist');
      });

      const report = await runPostCutoverAudit(
        { expectShas: [], compareHours: 1 },
        {
          fetchHealth: async () => ({ status: 200, body: HEALTHY_BODY }),
          querySupabase,
          isGitAncestor: () => ({ ok: true, reason: null }),
        }
      );

      expect(report.overallStatus).toBe('PASS');
      const latency = report.checks.find((c) => c.name === 'latency_summary');
      expect(latency?.status).toBe('unknown');
      expect(latency?.details?.reason).toBe('latency_table_or_column_missing');
      expect(latency?.details?.scopes).toEqual([]);
    });

    it('fails overall audit when reset traps exist even if all other checks pass', async () => {
      const querySupabase = vi.fn(async (sql: string) => {
        if (sql.includes('ca_horse_option_registry_serving')) {
          return [
            { release_sha: HEALTHY_BODY.releaseSha, age_sec: 10, seen_at: '2026-11-22T02:40:00Z' },
          ];
        }
        if (sql.includes('ca_horse_style_switch')) {
          return [{ option: 'staleFlag', state: 'on', refusal: 'unregistered_option' }];
        }
        return [];
      });

      const report = await runPostCutoverAudit(
        { expectShas: ['5b09ace7f7b'], compareHours: 1 },
        {
          fetchHealth: async () => ({ status: 200, body: HEALTHY_BODY }),
          querySupabase,
          isGitAncestor: () => ({ ok: true, reason: null }),
        }
      );

      expect(report.overallStatus).toBe('FAIL');
      expect(report.passed).toBe(false);
      const trapCheck = report.checks.find((c) => c.name === 'zero_reset_traps');
      expect(trapCheck?.status).toBe('fail');
      expect(trapCheck?.details?.offendingRows).toHaveLength(1);
    });
  });
});
