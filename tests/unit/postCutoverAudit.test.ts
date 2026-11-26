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
  evaluateExploitReport,
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
  evaluateSwitchRecords,
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

    it('parses Supabase CLI JSON output even when wrapped with CLI notices or {rows}/{data} envelopes', () => {
      const wrapped =
        'Some notice\n[{"release_sha":"c2d6e45e3bcc"}]\nA new version of Supabase CLI is available';
      expect(parseSupabaseJsonOutput(wrapped)).toEqual([{ release_sha: 'c2d6e45e3bcc' }]);
      expect(parseSupabaseJsonOutput('{"rows":[{"release_sha":"c2d6e45e3bcc"}]}')).toEqual([
        { release_sha: 'c2d6e45e3bcc' },
      ]);
      expect(parseSupabaseJsonOutput('{"data":[{"id":1}]}')).toEqual([{ id: 1 }]);
      expect(parseSupabaseJsonOutput('Notice\n{"rows":[{"ok":true}]}\nUpdate available')).toEqual([
        { ok: true },
      ]);
      expect(() => parseSupabaseJsonOutput('')).toThrow(/empty output/);
    });

    it('runs git merge-base with cwd: REPO_ROOT instead of process.cwd()', () => {
      const cliSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/post-cutover-audit.mjs'),
        'utf8'
      );
      expect(cliSource).toContain('cwd: REPO_ROOT');
      expect(cliSource).not.toContain('cwd: process.cwd()');
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

    it('Check 1b: live_health fails on liveHorseDecision.phase !== ready or recoverableRequestErrors > 0 (with lastRecoverableRequestError), warns on expiredJobs, and fails on horseDecisionLatency.starvationAlert under --strict-latency', async () => {
      // Non-ready phase fails live_health
      const notReady = evaluateLiveHealth(
        {
          ...HEALTHY_BODY,
          liveHorseDecision: { phase: 'booting', recoverableRequestErrors: 0, expiredJobs: 0 },
        },
        200
      );
      expect(notReady.status).toBe('fail');
      expect(notReady.failures[0]).toMatch(/liveHorseDecision\.phase=booting/);

      // recoverableRequestErrors > 0 MUST FAIL live_health and include lastRecoverableRequestError
      const refusalStorm = evaluateLiveHealth(
        {
          ...HEALTHY_BODY,
          liveHorseDecision: {
            phase: 'ready',
            recoverableRequestErrors: 8,
            lastRecoverableRequestError: 'reference_owner refusal: limp outside reference return',
            expiredJobs: 0,
          },
        },
        200
      );
      expect(refusalStorm.status).toBe('fail');
      expect(refusalStorm.failures[0]).toMatch(/liveHorseDecision\.recoverableRequestErrors=8/);
      expect(refusalStorm.failures[0]).toMatch(/reference_owner refusal/);

      // expiredJobs > 0 emits a warning without false-failing when phase=ready and recoverableRequestErrors=0
      const expiredWarn = evaluateLiveHealth(
        {
          ...HEALTHY_BODY,
          liveHorseDecision: { phase: 'ready', recoverableRequestErrors: 0, expiredJobs: 3 },
        },
        200
      );
      expect(expiredWarn.status).toBe('pass');
      expect(expiredWarn.warnings).toContain('liveHorseDecision.expiredJobs=3');

      // horseDecisionLatency.starvationAlert warns normally, FAILS under --strict-latency
      const starvedBody = {
        ...HEALTHY_BODY,
        liveHorseDecision: { phase: 'ready', recoverableRequestErrors: 0, expiredJobs: 0 },
        horseDecisionLatency: {
          totalDecisions: 1000,
          over100msCount: 25,
          over100msPct: 2.5,
          maxMs: 410,
          topHotNode: 'phase15_node_tournament_utility',
          starvationAlert: true,
        },
      };
      const nonStrict = evaluateLiveHealth(starvedBody, 200, { strictLatency: false });
      expect(nonStrict.status).toBe('pass');
      expect(nonStrict.warnings.some((w) => w.includes('starvationAlert=true'))).toBe(true);

      const strict = evaluateLiveHealth(starvedBody, 200, { strictLatency: true });
      expect(strict.status).toBe('fail');
      expect(strict.failures.some((f) => f.includes('starvationAlert=true'))).toBe(true);

      // End-to-end runPostCutoverAudit NEVER reports OVERALL: PASS on recoverableRequestErrors or --strict-latency starvationAlert
      const cleanDb = vi.fn(async (sql: string) => {
        if (sql.includes('ca_horse_option_registry_serving')) {
          return [
            { release_sha: HEALTHY_BODY.releaseSha, age_sec: 5, seen_at: '2026-11-22T02:40:00Z' },
          ];
        }
        if (sql.includes('ca_horse_style_switch')) {
          return [{ option: 'v87HoldemOverhaul', state: 'on', refusal: null }];
        }
        return [];
      });

      const stormReport = await runPostCutoverAudit(
        { compareHours: 1 },
        {
          fetchHealth: async () => ({
            status: 200,
            body: {
              ...HEALTHY_BODY,
              liveHorseDecision: {
                phase: 'ready',
                recoverableRequestErrors: 4,
                lastRecoverableRequestError: 'reference_owner: unexpected branch',
                expiredJobs: 0,
              },
            },
          }),
          querySupabase: cleanDb,
          isGitAncestor: () => ({ ok: true, reason: null }),
        }
      );
      expect(stormReport.overallStatus).toBe('FAIL');
      expect(stormReport.passed).toBe(false);
      expect(formatAuditReportText(stormReport)).toContain('reference_owner: unexpected branch');

      const strictReport = await runPostCutoverAudit(
        { compareHours: 1, strictLatency: true },
        {
          fetchHealth: async () => ({ status: 200, body: starvedBody }),
          querySupabase: cleanDb,
          isGitAncestor: () => ({ ok: true, reason: null }),
        }
      );
      expect(strictReport.overallStatus).toBe('FAIL');
      expect(strictReport.passed).toBe(false);
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
  describe('optional Horse exploit report step (--exploit-split-at)', () => {
    const cleanDb = vi.fn(async (sql: string) => {
      if (sql.includes('ca_horse_option_registry_serving')) {
        return [
          { release_sha: HEALTHY_BODY.releaseSha, age_sec: 8, seen_at: '2026-11-24T06:59:00Z' },
        ];
      }
      if (sql.includes('horse_brain_flush_receipts')) {
        return [{ scope: 'nlh', samples: 500, avg_ms: 12, max_ms: 85, over100: 0 }];
      }
      return [];
    });
    const baseDeps = {
      now: () => Date.parse('2026-11-24T07:00:00Z'),
      fetchHealth: async () => ({ status: 200, body: HEALTHY_BODY }),
      querySupabase: cleanDb,
      isGitAncestor: () => ({ ok: true, reason: null }),
    };

    it('parses --exploit-split-at and --strict-exploit and refuses an instant without a zone', () => {
      const o = parseCliArgs(['--exploit-split-at', '2026-11-24T04:00:00Z', '--strict-exploit']);
      expect(o.exploitSplitAt).toBe('2026-11-24T04:00:00Z');
      expect(o.strictExploit).toBe(true);
      expect(parseCliArgs([]).exploitSplitAt).toBeNull();
      expect(() => parseCliArgs(['--exploit-split-at', '2026-11-24T04:00:00'])).toThrow(/zone/);
    });

    it('is not run, and adds no check, without --exploit-split-at', async () => {
      const runExploitReport = vi.fn();
      const report = await runPostCutoverAudit(
        { compareHours: 1 },
        { ...baseDeps, runExploitReport }
      );
      expect(runExploitReport).not.toHaveBeenCalled();
      expect(report.checks.map((c) => c.name)).not.toContain('horse_exploit_report');
    });

    it('runs the report from 24 h before the split to now; a finding warns and does not fail the audit', async () => {
      const runExploitReport = vi.fn(async () => ({
        exitCode: 1,
        gateLine: 'GATE 1: 1 cell(s) became or grew EXPLOITABLE after a split (...)',
        findings: ['NLH cash, heads-up, river, facing a bet: Horses fold 84.4%'],
      }));
      const report = await runPostCutoverAudit(
        { compareHours: 1, exploitSplitAt: '2026-11-24T04:00:00Z' },
        { ...baseDeps, runExploitReport }
      );
      expect(runExploitReport).toHaveBeenCalledWith({
        splitAt: '2026-11-24T04:00:00.000Z',
        since: '2026-11-23T04:00:00.000Z',
        until: '2026-11-24T07:00:00.000Z',
      });
      const check = report.checks.find((c) => c.name === 'horse_exploit_report');
      expect(check?.status).toBe('warn');
      expect(report.overallStatus).toBe('PASS');
      const text = formatAuditReportText(report);
      expect(text).toContain('[WARN   ] horse_exploit_report');
      expect(text).toContain('rollback trigger');
    });

    it('with --strict-exploit a finding or a failed read fails the audit; too few hands never does', async () => {
      const finding = await runPostCutoverAudit(
        { compareHours: 1, exploitSplitAt: '2026-11-24T04:00:00Z', strictExploit: true },
        { ...baseDeps, runExploitReport: async () => ({ exitCode: 1, gateLine: 'GATE 1' }) }
      );
      expect(finding.overallStatus).toBe('FAIL');
      expect(evaluateExploitReport({ exitCode: 70 }, { strict: true }).status).toBe('fail');
      expect(evaluateExploitReport({ exitCode: 70 }, { strict: false }).status).toBe('unknown');
      expect(evaluateExploitReport({ exitCode: 2 }, { strict: true }).status).toBe('unknown');
      expect(evaluateExploitReport({ exitCode: 0 }, { strict: true }).status).toBe('pass');
      const future = await runPostCutoverAudit(
        { compareHours: 1, exploitSplitAt: '2026-11-24T08:00:00Z', strictExploit: true },
        { ...baseDeps, runExploitReport: vi.fn() }
      );
      expect(future.checks.find((c) => c.name === 'horse_exploit_report')?.status).toBe('fail');
    });
  });
});

// 2026-11-26: a switch written through a private wrapper opens no records PR, so the committed snapshot went
// stale three times in two days and was only noticed by a hand-run dry run. The audit that already reads the
// switch table after every cutover now says so.
describe('switch_records: the committed snapshot against the live switch rows', () => {
  const LIVE = [
    {
      option: 'v87HoldemOverhaul',
      state: 'on',
      updated_at: '2026-11-20T06:01:05Z',
      audit_id: 155,
      audit_max: 200,
    },
    {
      option: 'omahaOopReraiseRangeHoldsVsReraise',
      state: 'off',
      updated_at: '2026-11-26T03:06:44Z',
      audit_id: 200,
      audit_max: 200,
    },
  ];
  const committed = (rows: typeof LIVE, auditMax = 200) =>
    JSON.stringify({
      schema: 'horse-option-switch-state/v1',
      asOfUtc: '2026-11-26T08:05:41.000Z',
      auditMax,
      rows: Object.fromEntries(
        rows.map((r) => [
          r.option,
          { state: r.state, auditId: r.audit_id, changedAt: new Date(r.updated_at).toISOString() },
        ])
      ),
    });

  it('passes when the rows and the audit max agree, whatever time each was read', () => {
    const check = evaluateSwitchRecords({ committedText: committed(LIVE), liveRows: LIVE });
    expect(check.status).toBe('pass');
    expect(check.details.differing).toEqual([]);
  });

  it('warns, names each differing row and the command, and fails only when strict', () => {
    const live = [
      LIVE[0],
      { ...LIVE[1], state: 'shadow', audit_id: 201, audit_max: 201 },
      {
        option: 'cashDefenceTrimColdCalls',
        state: 'on',
        updated_at: '2026-11-26T17:10:00Z',
        audit_id: 199,
        audit_max: 201,
      },
    ];
    const check = evaluateSwitchRecords({ committedText: committed(LIVE), liveRows: live });
    expect(check.status).toBe('warn');
    expect(check.failures).toEqual([]);
    expect(check.details.differing).toEqual([
      { option: 'cashDefenceTrimColdCalls', committed: 'default', live: 'on' },
      { option: 'omahaOopReraiseRangeHoldsVsReraise', committed: 'off', live: 'shadow' },
    ]);
    expect(check.warnings[0]).toContain('audit max 200, production 201');
    expect(check.warnings[0]).toContain('omahaOopReraiseRangeHoldsVsReraise in shadow');
    expect(check.warnings[0]).toContain('horse-option-switch.mjs records');
    const strict = evaluateSwitchRecords({
      committedText: committed(LIVE),
      liveRows: live,
      strict: true,
    });
    expect(strict.status).toBe('fail');
    expect(strict.failures).toHaveLength(1);
  });

  it('a cleared row and an unreadable file are reported, never guessed', () => {
    const cleared = evaluateSwitchRecords({
      committedText: committed(LIVE),
      liveRows: [{ ...LIVE[0], audit_max: 201 }],
    });
    expect(cleared.details.differing).toEqual([
      { option: 'omahaOopReraiseRangeHoldsVsReraise', committed: 'off', live: 'default' },
    ]);
    for (const text of ['', '{', '{"schema":"x"}']) {
      expect(evaluateSwitchRecords({ committedText: text, liveRows: LIVE }).status).toBe('unknown');
    }
  });

  it('runs inside the audit only when the caller can read the committed file, and never fails it by default', async () => {
    const deps = {
      now: () => Date.parse('2026-11-26T17:00:00Z'),
      fetchHealth: async () => ({ status: 200, body: HEALTHY_BODY }),
      isGitAncestor: () => ({ ok: true, reason: null }),
      querySupabase: vi.fn(async (sql: string) => {
        if (sql.includes('ca_horse_option_registry_serving'))
          return [
            { release_sha: HEALTHY_BODY.releaseSha, age_sec: 8.2, seen_at: '2026-11-26T16:59:50Z' },
          ];
        if (sql.includes('audit_max')) return [{ ...LIVE[0], audit_max: 201 }];
        if (sql.includes('ca_horse_style_switch'))
          return [{ option: 'v87HoldemOverhaul', state: 'on', refusal: null }];
        return [];
      }),
    };
    const without = await runPostCutoverAudit({ compareHours: 1 }, deps);
    expect(without.checks.map((c: { name: string }) => c.name)).not.toContain('switch_records');

    const withRecords = await runPostCutoverAudit(
      { compareHours: 1 },
      { ...deps, readCommittedSwitchState: () => committed(LIVE) }
    );
    const rec = withRecords.checks.find((c: { name: string }) => c.name === 'switch_records');
    expect(rec.status).toBe('warn');
    expect(withRecords.passed).toBe(true);
    expect(formatAuditReportText(withRecords)).toContain('switch_records');

    const strict = await runPostCutoverAudit(
      { compareHours: 1, strictRecords: true },
      { ...deps, readCommittedSwitchState: () => committed(LIVE) }
    );
    expect(strict.passed).toBe(false);

    const unreadable = await runPostCutoverAudit(
      { compareHours: 1 },
      {
        ...deps,
        readCommittedSwitchState: () => {
          throw new Error('ENOENT');
        },
      }
    );
    expect(
      unreadable.checks.find((c: { name: string }) => c.name === 'switch_records').status
    ).toBe('unknown');
    expect(unreadable.passed).toBe(true);
  });
});
