/**
 * LAW - AN ALERT RECOVERS ON RECENT EVIDENCE (2026-11-19)
 *
 * Two alerts that look back over days kept paging for hours or days after
 * their fix was live:
 *   - fn_ca_cron_failure_watch's majority rule (24 h lookback) kept drift
 *     incident c44da3ce open for sp-daily-metrics-snapshot, which failed
 *     06:15-11:15 UTC and succeeded every run from 11:45.
 *   - StatsAllInEquityCoverageLow read only the 7-day coverage (96.9%) while
 *     the equity writer had been fixed at 10:00 UTC (last 6 h: 99.2%).
 * 20261119173000 lets the cron watch treat a job whose newest runs are a
 * clean streak (>= 3, and longer than any clean stretch it had between
 * failures that day) as recovered. 20261119173100 measures equity coverage
 * over the last 24 hours on every witness audit run and publishes it; the
 * engine alert and the Prometheus rule stand down only when that figure is
 * back over 99% on at least 50 seats. Both still fire on a real ongoing
 * problem: an intermittent or still-failing job, a still-low or thin day.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrationNames, migrationText } from './helpers/migrationCorpus';

const ROOT = join(__dirname, '..');
const one = (suffix: string): string => {
  const name = migrationNames()
    .filter((n) => n.endsWith(suffix))
    .at(-1);
  if (!name) throw new Error(`missing migration *${suffix}`);
  return migrationText(name);
};
const CRON = one('_a_recovered_job_stops_paging_on_its_old_failures.sql');
const EV = one('_equity_coverage_recovers_on_the_last_day.sql');
const RULES = readFileSync(join(ROOT, 'infra/monitoring/engine-freeze-rules.yml'), 'utf8');
const MONITOR = readFileSync(join(ROOT, 'server/src/observability/StatsHealthMonitor.ts'), 'utf8');

describe('the cron failure watch lets a recovered job go', () => {
  const NEW = CRON.slice(CRON.indexOf('$n1$'), CRON.lastIndexOf('$n2$'));

  it('is a pinned pre/postimage rewrite with a probe', () => {
    expect(CRON).toContain(
      "'public.fn_ca_cron_failure_watch()',\n  '527df2af34fa21e074e6a27a46e08cbd', 'a12fa874f03893621417846c56500c99'"
    );
    expect(CRON).toContain('already the postimage, nothing to do');
    expect(CRON.indexOf('-- @probe-for: public.fn_ca_cron_failure_watch')).toBeGreaterThan(
      CRON.indexOf('SELECT pg_temp.cfw_subst(')
    );
  });

  it('recovered means a newest clean streak of three, longer than any clean stretch between failures', () => {
    expect(NEW).toMatch(/t\.status = 'succeeded' AND t\.first_rank = 1 AND t\.len >= 3/);
    expect(NEW).toMatch(/t\.len > COALESCE\(\(SELECT max\(p\.day_len\)/);
    expect(NEW).toMatch(/q\.status = 'failed'\s+AND q\.first_rank > p\.first_rank/);
  });

  it('only the majority rule is relaxed; the three-in-a-row rule is untouched', () => {
    expect(NEW).toMatch(
      /OR \(day\.fails >= 5 AND day\.fails > day\.successes\s+AND NOT EXISTS \(SELECT 1 FROM recovered rc WHERE rc\.jobid = day\.jobid\)\)/
    );
    expect(CRON).not.toMatch(/failed_in_a_row = 3[^\n]*recovered/);
  });
});

describe('equity coverage stands down on the last 24 hours', () => {
  it('the audit records a 24 h pair on every run and ca_stats_health publishes it', () => {
    expect(EV).toMatch(/ADD COLUMN IF NOT EXISTS allin_showdown_24h integer/);
    expect(EV).toMatch(/ADD COLUMN IF NOT EXISTS allin_showdown_without_equity_24h integer/);
    expect(EV).toContain("AND f.played_at >= now() - interval '24 hours'");
    expect(EV).toContain("'evCoverage24h', (SELECT jsonb_build_object(");
    expect(EV).toContain('-- @probe-for: public.ca_stats_witness_audit');
    // The 24 h read sits outside the hourly 7-day gate.
    const gateEnd = EV.indexOf('$n2$  END IF;');
    expect(EV.indexOf('INTO v_allin_sd_24h, v_allin_sd_no_eq_24h')).toBeGreaterThan(gateEnd);
  });

  it('the rule and the engine keep the 7-day bar and floor and stand down only on a recovered day', () => {
    const i = RULES.indexOf('- alert: StatsAllInEquityCoverageLow');
    const rule = RULES.slice(i, RULES.indexOf('- alert: StatsHealthReadStale'));
    expect(rule).toMatch(
      /poker_stats_ev_coverage_7d < 0\.99\s+and poker_stats_allin_showdowns_7d >= 50\s+unless \(poker_stats_ev_coverage_24h >= 0\.99\s+and poker_stats_allin_showdowns_24h >= 50\)/
    );
    expect(MONITOR).toMatch(
      /recent\.allInShowdowns >= STATS_EV_COVERAGE_MIN_SAMPLE &&\s+recent\.ratio >= STATS_EV_COVERAGE_MIN_RATIO/
    );
    expect(readFileSync(join(ROOT, 'scripts/ci/test-slo-stall-duration.sh'), 'utf8')).toContain(
      'stats-equity-coverage-recovers.test.yml'
    );
  });
});
