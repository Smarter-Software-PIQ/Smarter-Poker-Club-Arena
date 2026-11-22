import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HEALTH_URL,
  assertReadOnlySql,
  assertSafeOptionName,
  buildOptionStateAndAuditSql,
  buildShadowReadReport,
  buildShadowWindowBatchSql,
  classifySafetyFeature,
  computeWilson95,
  evaluateLiveHealth,
  formatElapsedLabel,
  formatInboxReceipt,
  formatShadowReportText,
  parseCliArgs,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
  resolveShadowWindow,
  summarizeLatencyRows,
  validateHealthUrl,
  validateIsoTimestamp,
} from '../../scripts/ops/shadow-read-report-lib.mjs';
import { runCli } from '../../scripts/ops/shadow-read-report.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');

const HEALTHY_ENGINE = {
  releaseSha: 'b31db252025bf65d1b07de7e356d2f56dd2c1daf',
  liveness: 'ok',
  settlementStatus: 'ok',
  stalledTableCount: 0,
  activeTables: 92,
  maintenance: { phase: 'idle' },
};

function makeHealthySnapshot(
  option = 'holdemPersonaPostflop',
  overrides: Record<string, unknown> = {}
) {
  return {
    receiptSummary: {
      receipt_count: 160,
      active_workers: 8,
      first_collected_at: '2026-11-22T15:01:00.000Z',
      last_collected_at: '2026-11-22T15:20:00.000Z',
    },
    receiptFires: [
      { feature: `option_switch_${option}_shadow_seen`, fires: 8, distinct_workers: 8 },
      { feature: `option_shadow_${option}_same_seen`, fires: 950, distinct_workers: 8 },
      { feature: `option_shadow_${option}_changed_seen`, fires: 50, distinct_workers: 6 },
      { feature: `option_shadow_${option}_same_person_seen`, fires: 36, distinct_workers: 4 },
      { feature: `option_shadow_${option}_changed_person_seen`, fires: 4, distinct_workers: 3 },
      { feature: 'option_shadow_skipped_backlog_seen', fires: 120, distinct_workers: 8 },
      { feature: 'option_shadow_skipped_budget_seen', fires: 450, distinct_workers: 8 },
      { feature: 'option_shadow_skipped_rate_seen', fires: 800, distinct_workers: 8 },
      { feature: 'option_shadow_rate_person_over_seen', fires: 5, distinct_workers: 2 },
    ],
    telemetryPickup: [
      {
        day: '2026-11-22',
        feature: `option_switch_${option}_shadow_seen`,
        fires: 8,
        updated_at: '2026-11-22T15:02:00.000Z',
      },
    ],
    telemetryShadow: [
      {
        day: '2026-11-22',
        feature: `option_shadow_${option}_same_seen`,
        fires: 950,
        updated_at: '2026-11-22T15:20:00.000Z',
      },
      {
        day: '2026-11-22',
        feature: `option_shadow_${option}_changed_seen`,
        fires: 50,
        updated_at: '2026-11-22T15:20:00.000Z',
      },
      {
        day: '2026-11-22',
        feature: `option_shadow_${option}_same_person_seen`,
        fires: 36,
        updated_at: '2026-11-22T15:20:00.000Z',
      },
      {
        day: '2026-11-22',
        feature: `option_shadow_${option}_changed_person_seen`,
        fires: 4,
        updated_at: '2026-11-22T15:20:00.000Z',
      },
    ],
    telemetryFallbackSafetyAndSkips: [],
    errorLog: { count: 0, recent: [] },
    latency: [
      { scope: 'nlh', samples: 12000, avg_ms: 18.4, max_ms: 210.5, over100: 42 },
      { scope: 'style_read', samples: 4100, avg_ms: 0.21, max_ms: 4.1, over100: 0 },
      { scope: 'option_shadow_redecide', samples: 1000, avg_ms: 2.95, max_ms: 28.4, over100: 0 },
      {
        scope: 'phase15_node_tournament_utility',
        samples: 15000,
        avg_ms: 16.2,
        max_ms: 240.0,
        over100: 320,
      },
    ],
    ...overrides,
  };
}

describe('shadow-read-report-lib', () => {
  describe('CLI argument parsing & input validation', () => {
    it('parses positional option and optional flags cleanly', () => {
      const defaults = parseCliArgs(['holdemPersonaPostflop']);
      expect(defaults).toEqual({
        option: 'holdemPersonaPostflop',
        since: null,
        until: null,
        healthUrl: DEFAULT_HEALTH_URL,
        supabaseWorkdir: null,
        skipHealth: false,
        json: false,
        help: false,
      });

      const custom = parseCliArgs([
        'holdemManiacSampleGate',
        '--since',
        '2026-11-22T14:00:00Z',
        '--until=2026-11-22T15:00:00Z',
        '--health-url=https://engine.smarter.poker/health',
        '--supabase-workdir',
        'fixtures/linked',
        '--skip-health',
        '--json',
      ]);
      expect(custom.option).toBe('holdemManiacSampleGate');
      expect(custom.since).toBe('2026-11-22T14:00:00.000Z');
      expect(custom.until).toBe('2026-11-22T15:00:00.000Z');
      expect(custom.supabaseWorkdir).toBe('fixtures/linked');
      expect(custom.skipHealth).toBe(true);
      expect(custom.json).toBe(true);
    });

    it('allows --help without positional option', () => {
      expect(parseCliArgs(['--help']).help).toBe(true);
      expect(parseCliArgs(['-h']).help).toBe(true);
    });

    it('rejects missing option, SQL injection attempts, bad timestamps, bad URLs, and reversed windows', () => {
      expect(() => parseCliArgs([])).toThrow(/Missing required <option>/);
      expect(() => assertSafeOptionName("foo'; DROP TABLE x;--")).toThrow(/Invalid option name/);
      expect(() => assertSafeOptionName('bad_option_underscore')).toThrow(/Invalid option name/);
      expect(() => validateIsoTimestamp('2026-11-22')).toThrow(/Invalid --since/);
      expect(() => validateIsoTimestamp("2026-11-22T15:00:00Z'; DROP TABLE x")).toThrow(
        /Invalid --since/
      );
      expect(() => validateHealthUrl('file:///etc/passwd')).toThrow(/protocol must be http/);
      expect(() =>
        parseCliArgs([
          'holdemGearShiftReach',
          '--since=2026-11-22T15:00:00Z',
          '--until=2026-11-22T14:00:00Z',
        ])
      ).toThrow(/earlier than --since/);
      expect(() => parseCliArgs(['holdemGearShiftReach', '--bogus'])).toThrow(/Unknown argument/);
      expect(() => parseCliArgs(['optOne', 'optTwo'])).toThrow(/Unexpected extra positional/);
    });
  });

  describe('SQL read-only safety, workdir resolution, and source security', () => {
    it('builds strictly read-only SQL queries containing expected tables and escaped patterns', () => {
      const metaSql = buildOptionStateAndAuditSql('holdemCallDownExcludesCurrentHand');
      expect(assertReadOnlySql(metaSql)).toContain('public.ca_horse_style_switch');
      expect(metaSql).toContain('public.ca_horse_style_switch_audit');
      expect(metaSql).toContain("'holdemCallDownExcludesCurrentHand'");

      const batchSql = buildShadowWindowBatchSql({
        option: 'holdemCallDownExcludesCurrentHand',
        since: '2026-11-22T14:00:00Z',
        until: '2026-11-22T15:00:00Z',
      });
      expect(assertReadOnlySql(batchSql)).toContain('public.horse_brain_flush_receipts');
      expect(batchSql).toContain('public.horse_brain_telemetry');
      expect(batchSql).toContain('public.horse_error_log');
      expect(batchSql).toContain('option\\_switch\\_holdemCallDownExcludesCurrentHand\\_%\\_seen');
      expect(batchSql).toContain('option_shadow_holdemCallDownExcludesCurrentHand_same_seen');
    });

    it('rejects mutating SQL, non-SELECT statements, and multi-statement strings', () => {
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

    it('parses Supabase CLI JSON output even when wrapped with upgrade notices', () => {
      const wrapped =
        'Notice line\n[{"snapshot":{"receiptSummary":{"receipt_count":5}}}]\nA new version of Supabase CLI is available';
      expect(parseSupabaseJsonOutput(wrapped)).toEqual([
        { snapshot: { receiptSummary: { receipt_count: 5 } } },
      ]);
      expect(parseSupabaseJsonOutput('{"rows":[{"ok":true}]}')).toEqual([{ ok: true }]);
      expect(() => parseSupabaseJsonOutput('')).toThrow(/empty output/);
    });

    it('auto-resolves linked Supabase workdir via git common dir when running from a worktree', () => {
      const worktreeCwd = path.resolve(REPO_ROOT, 'fixtures', 'mock-worktree');
      const primaryCheckout = path.resolve(REPO_ROOT, 'fixtures', 'mock-primary-checkout');
      const resolved = resolveLinkedSupabaseWorkdir({
        cwd: worktreeCwd,
        gitCommonDirRunner: () => `${path.join(primaryCheckout, '.git')}\n`,
        pathExists: (p) => p === path.join(primaryCheckout, 'supabase', '.temp', 'project-ref'),
      });
      expect(resolved).toBe(primaryCheckout);
    });

    it('never reads .env or secrets and never calls process.exit() directly', () => {
      const cliSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/shadow-read-report.mjs'),
        'utf8'
      );
      const libSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/shadow-read-report-lib.mjs'),
        'utf8'
      );
      for (const src of [cliSource, libSource]) {
        expect(src).not.toMatch(/\bdotenv\b/i);
        expect(src).not.toMatch(/['"`]\.env\b/);
        expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|PGPASSWORD/);
        expect(src).not.toMatch(/process\.exit\s*\(/);
      }
      expect(cliSource).toContain('process.exitCode =');
    });
  });

  describe('window resolution', () => {
    it('auto-detects since from latest shadow/on_shadow audit transition for active runs', () => {
      const nowMs = Date.parse('2026-11-22T15:20:00Z');
      const win = resolveShadowWindow({
        switchRow: {
          option: 'holdemPersonaPostflop',
          state: 'on_shadow',
          updated_at: '2026-11-22T15:00:00Z',
        },
        auditRows: [
          { id: 10, old_state: 'on', new_state: 'on_shadow', changed_at: '2026-11-22T15:00:00Z' },
          { id: 9, old_state: 'off', new_state: 'on', changed_at: '2026-11-20T12:00:00Z' },
        ],
        nowMs,
      });
      expect(win.since).toBe('2026-11-22T15:00:00.000Z');
      expect(win.until).toBe('2026-11-22T15:20:00.000Z');
      expect(win.sinceSource).toBe('audit_shadow_transition');
      expect(win.untilSource).toBe('now');
      expect(win.elapsedMinutes).toBe(20);
      expect(win.elapsedLabel).toBe('+20m');
      expect(win.shadowRunCompleted).toBe(false);
    });

    it('auto-bounds completed shadow runs to shadow exit + 90s flush grace when --since/--until omitted', () => {
      const nowMs = Date.parse('2026-11-22T15:20:00Z');
      const win = resolveShadowWindow({
        switchRow: {
          option: 'styleTightPlayerExploit',
          state: 'on',
          updated_at: '2026-11-21T23:07:09Z',
        },
        auditRows: [
          { id: 173, old_state: 'on_shadow', new_state: 'on', changed_at: '2026-11-21T23:07:09Z' },
          { id: 172, old_state: 'on', new_state: 'on_shadow', changed_at: '2026-11-21T20:08:58Z' },
        ],
        nowMs,
      });
      expect(win.since).toBe('2026-11-21T20:08:58.000Z');
      expect(win.until).toBe('2026-11-21T23:08:39.000Z');
      expect(win.sinceSource).toBe('audit_shadow_transition');
      expect(win.untilSource).toBe('audit_shadow_exit_plus_flush_grace');
      expect(win.shadowRunCompleted).toBe(true);
      expect(win.shadowExitedAt).toBe('2026-11-21T23:07:09.000Z');
    });

    it('honors explicit --since and falls back to 60m for unlisted options', () => {
      const nowMs = Date.parse('2026-11-22T16:00:00Z');
      const explicit = resolveShadowWindow({
        switchRow: {
          option: 'holdemGearShiftReach',
          state: 'on',
          updated_at: '2026-11-21T10:00:00Z',
        },
        auditRows: [
          { id: 2, old_state: 'shadow', new_state: 'on', changed_at: '2026-11-21T10:00:00Z' },
          { id: 1, old_state: 'off', new_state: 'shadow', changed_at: '2026-11-21T09:00:00Z' },
        ],
        explicitSince: '2026-11-22T15:00:00Z',
        nowMs,
      });
      expect(explicit.since).toBe('2026-11-22T15:00:00.000Z');
      expect(explicit.until).toBe('2026-11-22T16:00:00.000Z');
      expect(explicit.sinceSource).toBe('cli_arg');
      expect(explicit.untilSource).toBe('now');
      expect(explicit.elapsedLabel).toBe('+60m');

      const fallback = resolveShadowWindow({ switchRow: null, auditRows: [], nowMs });
      expect(fallback.sinceSource).toBe('fallback_60m');
      expect(fallback.elapsedMinutes).toBe(60);
      expect(formatElapsedLabel(0.5)).toBe('+30s');
    });
  });

  describe('Wilson 95% confidence interval math', () => {
    it('computes exact Wilson 95% bounds for zero, interior, and full rates', () => {
      expect(computeWilson95(0, 0)).toEqual({
        rate: null,
        ratePct: null,
        ci95Low: null,
        ci95High: null,
        ci95LowPct: null,
        ci95HighPct: null,
      });

      const zeroLarge = computeWilson95(0, 16568);
      expect(zeroLarge.ratePct).toBe(0);
      expect(zeroLarge.ci95LowPct).toBe(0);
      expect(zeroLarge.ci95HighPct).toBe(0.02);

      const zeroPerson = computeWilson95(0, 217);
      expect(zeroPerson.ratePct).toBe(0);
      expect(zeroPerson.ci95LowPct).toBe(0);
      expect(zeroPerson.ci95HighPct).toBe(1.74);

      const half = computeWilson95(50, 100);
      expect(half.ratePct).toBe(50);
      expect(half.ci95LowPct).toBe(40.38);
      expect(half.ci95HighPct).toBe(59.62);

      const full = computeWilson95(100, 100);
      expect(full.ratePct).toBe(100);
      expect(full.ci95LowPct).toBe(96.3);
      expect(full.ci95HighPct).toBe(100);
    });
  });

  describe('safety feature classification, health, and latency summarization', () => {
    it('classifies real safety features accurately without false positives on benign counters', () => {
      expect(classifySafetyFeature('option_switch_config_invalid_seen')).toBe('configError');
      expect(classifySafetyFeature('option_switch_config_stale_seen')).toBe('configError');
      expect(classifySafetyFeature('option_switch_config_unreadable_seen')).toBe('configError');
      expect(classifySafetyFeature('option_shadow_stage_self_disabled_seen')).toBe('breaker');
      expect(classifySafetyFeature('option_shadow_redecide_failed_seen')).toBe('breaker');
      expect(classifySafetyFeature('style_shadow_redecide_failed_seen')).toBe('breaker');
      expect(classifySafetyFeature('circuit_breaker_tripped_seen')).toBe('breaker');
      expect(classifySafetyFeature('raise_ladder_alarm_seen')).toBe('alarm');
      expect(classifySafetyFeature('promoted_shove_illegal')).toBe('illegal');
      expect(classifySafetyFeature('omaha_public_bet_size_illegal_kept')).toBe('illegal');
      expect(classifySafetyFeature('phase15_brain_exception')).toBe('exception');
      expect(classifySafetyFeature('brain_exception')).toBe('exception');

      // Non-alerting counters must return null.
      expect(classifySafetyFeature('small_pot_near_nut_value_flat_exception')).toBeNull();
      expect(classifySafetyFeature('option_shadow_skipped_rate_seen')).toBeNull();
      expect(classifySafetyFeature('phase8_reason_disabled_eligible_but_silent')).toBeNull();
    });

    it('evaluates live /health payloads and detects stalled tables or liveness failures', () => {
      const ok = evaluateLiveHealth(HEALTHY_ENGINE, 200);
      expect(ok.status).toBe('ok');
      expect(ok.releaseSha).toBe(HEALTHY_ENGINE.releaseSha);
      expect(ok.activeTables).toBe(92);
      expect(ok.stalledTableCount).toBe(0);
      expect(ok.issues).toEqual([]);

      const bad = evaluateLiveHealth(
        { ...HEALTHY_ENGINE, stalledTableCount: 2, liveness: 'degraded' },
        200
      );
      expect(bad.status).toBe('degraded');
      expect(bad.issues).toEqual(['liveness=degraded', 'stalledTableCount=2']);
    });

    it('summarizes latency rows and flags starvation only on non-phase15_node scopes with >=100 samples', () => {
      expect(summarizeLatencyRows([]).status).toBe('unknown');

      const healthy = summarizeLatencyRows([
        { scope: 'nlh', samples: 10000, avg_ms: 19.2, max_ms: 250.1, over100: 50 },
        { scope: 'style_read', samples: 3000, avg_ms: 0.2, max_ms: 4.0, over100: 0 },
        { scope: 'option_shadow_redecide', samples: 900, avg_ms: 3.1, max_ms: 39.2, over100: 0 },
        {
          scope: 'phase15_node_tournament_utility',
          samples: 10000,
          avg_ms: 17.5,
          max_ms: 300,
          over100: 500,
        },
      ]);
      expect(healthy.status).toBe('pass');
      expect(healthy.starvationAlert).toBe(false);
      expect(healthy.topHotNode).toBe('phase15_node_tournament_utility');
      expect(healthy.highlights.nlh?.avgMs).toBe(19.2);
      expect(healthy.highlights.styleRead?.avgMs).toBe(0.2);
      expect(healthy.highlights.shadow?.avgMs).toBe(3.1);

      const starved = summarizeLatencyRows([
        { scope: 'nlh', samples: 200, avg_ms: 45.0, max_ms: 310.0, over100: 5 },
      ]);
      expect(starved.status).toBe('warn');
      expect(starved.starvationAlert).toBe(true);
      expect(starved.alertedScopes).toHaveLength(1);
      expect(starved.alertedScopes[0]?.scope).toBe('nlh');

      const tooFewSamples = summarizeLatencyRows([
        { scope: 'nlh', samples: 50, avg_ms: 45.0, max_ms: 310.0, over100: 5 },
      ]);
      expect(tooFewSamples.starvationAlert).toBe(false);
    });
  });

  describe('buildShadowReadReport deterministic verdicts & formatting', () => {
    const activeSwitch = {
      option: 'holdemPersonaPostflop',
      state: 'shadow',
      updated_by: 'Horse SWITCH lane',
      updated_at: '2026-11-22T15:00:00Z',
      note: 'shadow run',
    };
    const activeAudit = [
      { id: 200, old_state: 'off', new_state: 'shadow', changed_at: '2026-11-22T15:00:00Z' },
    ];
    const activeWindow = resolveShadowWindow({
      switchRow: activeSwitch,
      auditRows: activeAudit,
      nowMs: Date.parse('2026-11-22T15:20:00Z'),
    });

    it('produces HEALTHY_ACTIVE with exact Wilson CIs, people-first share, and crisp inbox receipt', () => {
      const report = buildShadowReadReport({
        option: 'holdemPersonaPostflop',
        switchRow: activeSwitch,
        auditRows: activeAudit,
        windowMeta: activeWindow,
        dbSnapshot: makeHealthySnapshot('holdemPersonaPostflop'),
        health: evaluateLiveHealth(HEALTHY_ENGINE, 200),
        measuredAt: '2026-11-22T15:20:00.000Z',
      });

      expect(report.verdict).toBe('HEALTHY_ACTIVE');
      expect(report.rollbackReasons).toEqual([]);
      expect(report.pickup.count).toBe(8);
      expect(report.pickup.distinctWorkers).toBe(8);
      expect(report.shadow.overall.total).toBe(1000);
      expect(report.shadow.overall.changeRatePct).toBe(5);
      expect(report.shadow.person.total).toBe(40);
      expect(report.shadow.person.changeRatePct).toBe(10);
      expect(report.shadow.peopleFirstSharePct).toBe(4);
      expect(report.skips.backlog).toBe(120);
      expect(report.skips.budget).toBe(450);
      expect(report.skips.rate).toBe(800);
      expect(report.skips.stageSelfDisabled).toBe(0);
      expect(report.skips.redecideFailed).toBe(0);
      expect(report.safety.totalAlerts).toBe(0);

      expect(report.inboxReceipt).toContain(
        'SHADOW-READ holdemPersonaPostflop [shadow | +20m | HEALTHY_ACTIVE]'
      );
      expect(report.inboxReceipt).toContain('redec=1,000 chg=50(5.00%');
      expect(report.inboxReceipt).toContain('person=40(4.00% share)');
      expect(formatInboxReceipt(report)).toBe(report.inboxReceipt);

      const text = formatShadowReportText(report);
      expect(text).toContain('Verdict: HEALTHY_ACTIVE');
      expect(text).toContain('Inbox receipt:');
    });

    it('produces HEALTHY_IDLE when active shadow has zero re-decisions yet or switch is not in shadow', () => {
      const zeroSamples = buildShadowReadReport({
        option: 'holdemPersonaPostflop',
        switchRow: activeSwitch,
        auditRows: activeAudit,
        windowMeta: activeWindow,
        dbSnapshot: makeHealthySnapshot('holdemPersonaPostflop', {
          receiptFires: [
            {
              feature: 'option_switch_holdemPersonaPostflop_shadow_seen',
              fires: 8,
              distinct_workers: 8,
            },
          ],
          telemetryShadow: [],
        }),
        health: evaluateLiveHealth(HEALTHY_ENGINE, 200),
      });
      expect(zeroSamples.verdict).toBe('HEALTHY_IDLE');
      expect(zeroSamples.verdictReason).toBe('active_shadow_zero_redecisions_yet');

      const completed = buildShadowReadReport({
        option: 'holdemPersonaPostflop',
        switchRow: { ...activeSwitch, state: 'on' },
        auditRows: [
          { id: 201, old_state: 'shadow', new_state: 'on', changed_at: '2026-11-22T15:19:00Z' },
          ...activeAudit,
        ],
        windowMeta: resolveShadowWindow({
          switchRow: { ...activeSwitch, state: 'on' },
          auditRows: [
            { id: 201, old_state: 'shadow', new_state: 'on', changed_at: '2026-11-22T15:19:00Z' },
            ...activeAudit,
          ],
          nowMs: Date.parse('2026-11-22T15:25:00Z'),
        }),
        dbSnapshot: makeHealthySnapshot('holdemPersonaPostflop'),
        health: evaluateLiveHealth(HEALTHY_ENGINE, 200),
      });
      expect(completed.verdict).toBe('HEALTHY_IDLE');
      expect(completed.verdictReason).toBe('shadow_run_completed_now_on');
    });

    it('triggers ROLLBACK_TRIGGERED for every safety, breaker, latency starvation, and health failure trigger', () => {
      const cases: Array<{
        name: string;
        snapOverride?: Record<string, unknown>;
        health?: unknown;
        expected: string;
      }> = [
        {
          name: 'horse_error_log',
          snapOverride: { errorLog: { count: 2, recent: [{ id: '1', error_type: 'runtime' }] } },
          expected: 'horse_error_log=2',
        },
        {
          name: 'stage_self_disabled_breaker',
          snapOverride: {
            receiptFires: [
              ...makeHealthySnapshot().receiptFires,
              { feature: 'option_shadow_stage_self_disabled_seen', fires: 1, distinct_workers: 1 },
            ],
          },
          expected: 'breaker=1',
        },
        {
          name: 'redecide_failed_breaker',
          snapOverride: {
            receiptFires: [
              ...makeHealthySnapshot().receiptFires,
              { feature: 'option_shadow_redecide_failed_seen', fires: 3, distinct_workers: 2 },
            ],
          },
          expected: 'breaker=3',
        },
        {
          name: 'config_error',
          snapOverride: {
            receiptFires: [
              ...makeHealthySnapshot().receiptFires,
              { feature: 'option_switch_config_stale_seen', fires: 1, distinct_workers: 1 },
            ],
          },
          expected: 'config_error=1',
        },
        {
          name: 'alarm',
          snapOverride: {
            receiptFires: [
              ...makeHealthySnapshot().receiptFires,
              { feature: 'raise_ladder_alarm_seen', fires: 1, distinct_workers: 1 },
            ],
          },
          expected: 'alarm=1',
        },
        {
          name: 'illegal',
          snapOverride: {
            receiptFires: [
              ...makeHealthySnapshot().receiptFires,
              { feature: 'promoted_shove_illegal', fires: 1, distinct_workers: 1 },
            ],
          },
          expected: 'illegal=1',
        },
        {
          name: 'exception',
          snapOverride: {
            receiptFires: [
              ...makeHealthySnapshot().receiptFires,
              { feature: 'phase15_brain_exception', fires: 1, distinct_workers: 1 },
            ],
          },
          expected: 'exception=1',
        },
        {
          name: 'latency_starvation',
          snapOverride: {
            latency: [{ scope: 'nlh', samples: 500, avg_ms: 42, max_ms: 410, over100: 12 }],
          },
          expected: 'latency_starvation=nlh:2.4%',
        },
        {
          name: 'health_stalled',
          health: evaluateLiveHealth({ ...HEALTHY_ENGINE, stalledTableCount: 1 }, 200),
          expected: 'health:stalledTableCount=1',
        },
      ];

      for (const tc of cases) {
        const report = buildShadowReadReport({
          option: 'holdemPersonaPostflop',
          switchRow: activeSwitch,
          auditRows: activeAudit,
          windowMeta: activeWindow,
          dbSnapshot: makeHealthySnapshot('holdemPersonaPostflop', tc.snapOverride ?? {}),
          health: tc.health ?? evaluateLiveHealth(HEALTHY_ENGINE, 200),
        });
        expect(report.verdict, `case ${tc.name}`).toBe('ROLLBACK_TRIGGERED');
        expect(report.rollbackReasons.join(';'), `case ${tc.name}`).toContain(tc.expected);
        expect(report.inboxReceipt, `case ${tc.name}`).toContain('triggers=[');
      }
    });

    it('falls back gracefully to horse_brain_telemetry when flush receipts are absent and warns on unreachable health', () => {
      const report = buildShadowReadReport({
        option: 'holdemPersonaPostflop',
        switchRow: activeSwitch,
        auditRows: activeAudit,
        windowMeta: activeWindow,
        dbSnapshot: makeHealthySnapshot('holdemPersonaPostflop', {
          receiptSummary: { receipt_count: 0, active_workers: 0 },
          receiptFires: [],
          telemetryFallbackSafetyAndSkips: [
            { day: '2026-11-22', feature: 'option_shadow_skipped_backlog_seen', fires: 11 },
          ],
        }),
        health: { status: 'unreachable', error: 'timeout', issues: [] },
      });
      expect(report.shadow.source).toBe('horse_brain_telemetry_fallback');
      expect(report.shadow.overall.total).toBe(1000);
      expect(report.skips.backlog).toBe(11);
      expect(report.verdict).toBe('HEALTHY_ACTIVE');
      expect(report.warnings.some((w) => w.includes('unreachable'))).toBe(true);
    });
  });

  describe('end-to-end runCli orchestration', () => {
    it('handles --help, invalid args, active JSON report, rollback exit code 1, and --skip-health', async () => {
      const out: string[] = [];
      const err: string[] = [];

      const helpRes = await runCli(['--help'], {
        stdout: (m: string) => out.push(m),
        stderr: (m: string) => err.push(m),
      });
      expect(helpRes.exitCode).toBe(0);
      expect(out[0]).toContain('Usage: node scripts/ops/shadow-read-report.mjs');

      const badRes = await runCli([], {
        stdout: (m: string) => out.push(m),
        stderr: (m: string) => err.push(m),
      });
      expect(badRes.exitCode).toBe(2);
      expect(err[0]).toContain('Missing required <option>');

      const queryMock = vi
        .fn()
        .mockResolvedValueOnce([
          {
            meta: {
              switchRow: {
                option: 'holdemGearShiftReach',
                state: 'shadow',
                updated_by: 'Horse SWITCH lane',
                updated_at: '2026-11-22T15:00:00Z',
                note: 'test',
              },
              auditRows: [
                {
                  id: 300,
                  option: 'holdemGearShiftReach',
                  old_state: 'off',
                  new_state: 'shadow',
                  changed_by: 'Horse SWITCH lane',
                  changed_at: '2026-11-22T15:00:00Z',
                  note: 'test',
                },
              ],
            },
          },
        ])
        .mockResolvedValueOnce([{ snapshot: makeHealthySnapshot('holdemGearShiftReach') }]);
      const healthMock = vi.fn().mockResolvedValue({ status: 200, body: HEALTHY_ENGINE });

      const jsonLines: string[] = [];
      const okRes = await runCli(['holdemGearShiftReach', '--json'], {
        querySupabase: queryMock,
        fetchHealth: healthMock,
        now: () => Date.parse('2026-11-22T15:20:00Z'),
        stdout: (m: string) => jsonLines.push(m),
        stderr: (m: string) => err.push(m),
      });
      expect(okRes.exitCode).toBe(0);
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(healthMock).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(jsonLines.join('\n'));
      expect(parsed.verdict).toBe('HEALTHY_ACTIVE');
      expect(parsed.option).toBe('holdemGearShiftReach');

      // Rollback case returns exitCode 1 and --skip-health avoids fetchHealth call.
      const rollbackQuery = vi
        .fn()
        .mockResolvedValueOnce([
          {
            meta: {
              switchRow: {
                option: 'holdemGearShiftReach',
                state: 'shadow',
                updated_at: '2026-11-22T15:00:00Z',
              },
              auditRows: [
                {
                  id: 300,
                  old_state: 'off',
                  new_state: 'shadow',
                  changed_at: '2026-11-22T15:00:00Z',
                },
              ],
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            snapshot: makeHealthySnapshot('holdemGearShiftReach', {
              errorLog: { count: 1, recent: [{ id: 'e1', error_type: 'fatal' }] },
            }),
          },
        ]);
      const skippedHealthMock = vi.fn();
      const rbLines: string[] = [];
      const rbRes = await runCli(['holdemGearShiftReach', '--skip-health'], {
        querySupabase: rollbackQuery,
        fetchHealth: skippedHealthMock,
        now: () => Date.parse('2026-11-22T15:20:00Z'),
        stdout: (m: string) => rbLines.push(m),
        stderr: (m: string) => err.push(m),
      });
      expect(rbRes.exitCode).toBe(1);
      expect(skippedHealthMock).not.toHaveBeenCalled();
      expect(rbLines.join('\n')).toContain('Verdict: ROLLBACK_TRIGGERED');
    });
  });
});
