/**
 * AT 3 AM THE DATABASE SAYS WHETHER THE 4 AM ENGINE CUTOVER WILL SHIP
 * (owner order 2026-11-19 17:26 Chicago; incident 076ff467: EngineCutoverMissed
 * fired 2026-11-16..19 and was heard only at 04:30, after the window closed).
 *
 * fn_ca_cutover_readiness_watch (migration 20261119234116) judges at 03:00
 * Chicago what the 03:30 selector will judge. These laws keep its clock and
 * its thresholds the release lane's own, so the two can never drift apart:
 *
 *   1. the freeze start, the SETTLE and the certificate context are the ones
 *      the dispatcher and scripts/ci/backup-freeze-baseline.py use, and the
 *      baseline cutoff equals the 04:30 cutover watch's owed-build cutoff;
 *   2. it runs from pg_cron at 03:00 Chicago in CST and in CDT, and stops
 *      before the selector's 03:30 cutoff;
 *   3. the Spin envelope is SPIN_LADDER at its maximum;
 *   4. its page is its own kind, never 'releases', so neither holds the other;
 *   5. its native proof runs on every change to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPIN_LADDER } from '../server/src/config/seatFirstLadder';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const migration = read('supabase/migrations/20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship.sql');
const dispatcher = read('scripts/ci/merged-migration-dispatch.mjs');
const reader = read('scripts/ci/backup-freeze-baseline.py');
const selector = read('scripts/ci/select-daily-engine.py');
const watch = read('supabase/migrations/20261119182637_the_cutover_watch_owes_the_build_the_freeze_can_ship.sql');
const workflow = read('.github/workflows/the-three-am-cutover-readiness-check.yml');
const body = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_cutover_readiness_watch'));

const num = (re: RegExp, text: string) => {
  const m = re.exec(text);
  if (!m) throw new Error(`not found: ${re}`);
  return m.slice(1).map(Number);
};
const minutesOf = (re: RegExp, text: string) => num(re, text)[0];

describe('the 03:00 check reads the release lane\'s own clock', () => {
  const [fh, fm] = num(/RELEASE_SCHEMA_FREEZE_CHICAGO\s*=\s*\{\s*from:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/, dispatcher);
  // The freeze start as minutes from the cutover date's midnight (23:45 -> -15).
  const freezeFromMidnight = fh * 60 + fm >= 12 * 60 ? fh * 60 + fm - 24 * 60 : fh * 60 + fm;
  const settle = minutesOf(/SETTLE\s*=\s*timedelta\(minutes=(\d+)\)/, reader);

  it('the freeze start is the dispatcher\'s', () => {
    expect(minutesOf(/c_freeze_offset constant interval := interval '(-?\d+) minutes'/, body)).toBe(freezeFromMidnight);
  });

  it('the baseline is merged SETTLE before it, exactly as the Backup reader and the 04:30 watch owe it', () => {
    expect(minutesOf(/c_settle constant interval := interval '(\d+) minutes'/, body)).toBe(settle);
    const owed = minutesOf(/v_day::timestamp \+ interval ''(-?\d+) minutes''/, watch);
    expect(owed).toBe(freezeFromMidnight - settle);
  });

  it('the certificate context is the one the Backup writes and the selector reads', () => {
    const context = /CONTEXT = '([^']+)'/.exec(reader)![1];
    expect(selector).toContain(`s['context'] == '${context}'`);
    expect(body).toContain(`c_context constant text := '${context}';`);
    expect(body).toMatch(/s->>'state' = 'success'\s+AND \(s->>'created_at'\)::timestamptz >= v_freeze/);
  });

  it('it judges from 03:00 and stops before the selector\'s cutoff', () => {
    const [sh, sm] = num(/def cutoff\(day\):\s*\n\s*return [\s\S]*?time\((\d+),\s*(\d+)\)/, selector);
    const stop = /v_local::time >= time '(\d\d):(\d\d)'/.exec(body)!;
    expect(Number(stop[1]) * 60 + Number(stop[2])).toBe(sh * 60 + sm);
    expect(body).toContain("v_local::time < time '03:00'");
  });
});

describe('pg_cron fires it at 03:00 Chicago whatever the season', () => {
  const m = /cron\.schedule\('ca-cutover-readiness-watch-3am', '([^']+)'/.exec(migration);
  it('is registered by the migration and named by its live proof', () => {
    expect(m).toBeTruthy();
    expect(migration).toMatch(/@live-proof: .*jobname = 'ca-cutover-readiness-watch-3am' AND schedule = '0,15,25 8,9 \* \* \*'/);
  });
  it('covers 03:00, 03:15 and 03:25 in CST (UTC-6) and in CDT (UTC-5)', () => {
    const [minutes, hours] = m![1].split(' ');
    const ms = minutes.split(',').map(Number);
    const hs = hours.split(',').map(Number);
    for (const offset of [6, 5]) {
      expect(hs).toContain(3 + offset);
      for (const want of [0, 15, 25]) expect(ms).toContain(want);
    }
  });
  it('outside the window it returns before any outside read', () => {
    const early = body.indexOf("RETURN jsonb_build_object('ok', true, 'state', 'outside'");
    expect(early).toBeGreaterThan(0);
    expect(body.indexOf('ca_cutover_http_json')).toBeGreaterThan(early);
  });
});

describe('what it judges', () => {
  it('the Spin envelope is every SPIN_LADDER rung at its maximum', () => {
    const envelope = Math.round(SPIN_LADDER.reduce((t, r) => t + r.maxMs, 0) / 1000);
    expect(minutesOf(/c_envelope constant integer := (\d+);/, body)).toBe(envelope);
  });
  it('a stuck tournament is the critical scan\'s own predicate and setting', () => {
    expect(body).toContain("public.fn_sp_setting('stuck_tournament_hours', 12)");
    expect(body).toContain("t.status = 'RUNNING' AND t.started_at < p_at - make_interval(hours => v_hours)");
  });
  it('a merged migration is uninstalled exactly as the install watch keeps it', () => {
    expect(body).toMatch(/w\.window_install IS NOT TRUE AND w\.retired_at IS NULL AND w\.superseded_by IS NULL/);
    expect(body).toContain('public.fn_ca_installed_migration_listing()');
    expect(body).toContain('w.version <> ALL (v_installed)');
  });
  it('could-not-tell is its own verdict and pages nothing', () => {
    expect(body).toMatch(/WHEN jsonb_array_length\(v_unknowns\) > 0 THEN 'unknown'/);
    const page = body.indexOf("IF v_verdict = 'not_ready' THEN");
    expect(page).toBeGreaterThan(0);
    const end = body.indexOf("ELSIF v_verdict IN ('ready', 'not_owed') THEN", page);
    expect(end).toBeGreaterThan(page);
    expect(body.slice(page, end)).not.toContain("'unknown'");
  });
});

describe('its page reaches the owner on its own clock', () => {
  it('maps to the cutover_readiness kind, never releases', () => {
    expect(migration).toContain("p_source = ''cutover-readiness-watch'' AND p_alertname = ''CutoverReadinessAtRisk'' AND p_severity = ''critical'' THEN ''cutover_readiness''");
    expect(migration).toContain("WHEN ''cutover_readiness'' THEN ''4 AM Engine Update At Risk''");
    expect(body).toContain("public.fn_record_operational_alert('cutover-readiness-watch', v_key, 'CutoverReadinessAtRisk',");
    expect(body).toContain("'firing', 'critical'");
  });
  it('the digest carries the verdict', () => {
    expect(migration).toContain("''readiness'', (SELECT jsonb_build_object(''verdict'', r.verdict");
  });
});

describe('its native proof runs on every change to it', () => {
  it('the workflow runs the proof against PostgreSQL 17 on its paths', () => {
    expect(workflow).toContain('supabase/migrations/20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship.sql');
    expect(workflow).toContain('python3 -B scripts/ci/test-the-three-am-cutover-readiness-check.py');
    expect(workflow).toContain('./.github/actions/install-postgres-17');
  });
});
