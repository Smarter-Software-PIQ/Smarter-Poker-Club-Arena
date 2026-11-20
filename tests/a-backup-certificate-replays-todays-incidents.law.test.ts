/**
 * A BACKUP CERTIFICATE REPLAYS TODAY'S INCIDENTS (owner order 2026-11-19
 * 17:26 Chicago). Before the 03:30 selection can take a candidate, its Backup
 * certification proves the candidate does not bring back the incidents fixed
 * that day: eaafbbfb (a Spin offered a horse at its reservation budget),
 * 1e532243 (the hand-gap grader graded hand-for-hand), 076ff467 (the cutover
 * watch owed a build the freeze could not ship), 316ed735 (the alarm drill
 * stopped recording its run).
 *
 *   1. cmd_certify runs trial_regression_replay on the restored copy before
 *      the engine boots, and a failure (or a missing replay) withholds the
 *      certificate;
 *   2. the replay never commits: one transaction, rolled back, live-table
 *      triggers off, a statement budget;
 *   3. each check is armed by the migration that fixed its incident, so an
 *      unshipped fix never withholds a certificate and a shipped one cannot
 *      regress;
 *   4. the candidate's clock and picker are read from the candidate itself;
 *   5. the replay's native proof runs on every change to it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const engine = read('server/standby/standby-engine.sh');
const trials = read('server/standby/standby-trials.sh');
const workflow = read('.github/workflows/backup-regression-replay.yml');
const replaySql = trials.slice(
  trials.indexOf("<<'SQL_REGRESSION_REPLAY'"),
  trials.lastIndexOf('SQL_REGRESSION_REPLAY')
);

describe('the certificate is withheld when the replay fails', () => {
  const certify = engine.slice(engine.indexOf('cmd_certify() {'));
  it('runs on the restored copy before the engine boots', () => {
    const copy = certify.indexOf('assert_valid_copy || return 1');
    const replay = certify.indexOf(
      'trial_regression_replay "$sha" >&2 || record \'regression_replay_failed\''
    );
    const boot = certify.indexOf('cmd_run "$sha" ||');
    expect(copy).toBeGreaterThan(0);
    expect(replay).toBeGreaterThan(copy);
    expect(boot).toBeGreaterThan(replay);
  });
  it('a missing replay is a failure, never a skip', () => {
    expect(certify).toContain("record 'regression_replay_unavailable'");
  });
  it('the Backup host already installs standby-trials.sh with every certification', () => {
    const backup = read('.github/workflows/backup-engine.yml');
    expect(backup).toMatch(
      /server\/standby\/standby-trials\.sh > \/usr\/local\/share\/club-arena-standby\/standby-trials\.sh/
    );
  });
});

describe('the replay never commits', () => {
  it('one transaction, rolled back, triggers off, bounded', () => {
    expect(replaySql.indexOf('BEGIN;')).toBeGreaterThan(0);
    expect(replaySql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(replaySql).not.toMatch(/^\s*COMMIT\s*;/m);
    expect(replaySql).toContain('SET LOCAL session_replication_role = replica;');
    expect(replaySql).toContain("SET LOCAL statement_timeout = '30s';");
    expect(replaySql).toContain("SET LOCAL lock_timeout = '2s';");
  });
  it('its synthetic hands live in the year 2000, outside every real window', () => {
    for (const ts of replaySql.match(/'(\d{4})-\d\d-\d\d \d\d:\d\d:\d\d\+00'/g) ?? [])
      expect(ts.slice(1, 5)).toBe('2000');
  });
});

describe('each check is armed by the fix it guards', () => {
  const armed: Record<string, string> = {
    spin_reservation_budget: '20261119181143',
    cutover_owes_baseline: '20261119182637',
    drill_records_its_run: '20261119231718',
  };
  for (const [check, version] of Object.entries(armed)) {
    it(`${check} waits for ${version}, which is on main`, () => {
      expect(replaySql).toContain(
        `IF NOT pg_temp.replay_installed('${version}') THEN\n    INSERT INTO replay_verdict VALUES ('${check}', 'not_armed'`
      );
      expect(
        readdirSync(join(ROOT, 'supabase/migrations')).some((f: string) => f.startsWith(version))
      ).toBe(true);
    });
  }
  it('hand-for-hand is graded only once 20261119211558 is installed; breaks always', () => {
    expect(replaySql).toContain("pg_temp.replay_installed('20261119211558')");
    expect(replaySql).toContain('engine_maintenance_break_log');
    expect(replaySql).toContain('break_started_at, break_ends_at');
  });
  it('history is read only where the restored copy carries it (Backup 44673040919)', () => {
    expect(replaySql).toContain(
      "IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RETURN false; END IF;"
    );
    expect(replaySql).not.toMatch(
      /FROM supabase_migrations\.schema_migrations WHERE version = '\d/
    );
  });
  it('only pass and not_armed let a certificate through, and all four checks must answer', () => {
    expect(trials).toContain('if r["verdict"] not in ("pass", "not_armed")');
    expect(trials).toContain('len(rows) == 4');
  });
});

describe('the candidate is read from itself', () => {
  it('its freeze clock and SETTLE come from its own dispatcher and Backup reader', () => {
    expect(trials).toContain("show('scripts/ci/merged-migration-dispatch.mjs')");
    expect(trials).toContain("show('scripts/ci/backup-freeze-baseline.py')");
  });
  it('its free-horse picker must read the reservation budget', () => {
    const budget = read('server/src/services/horseReservationBudget.ts');
    const service = read('server/src/services/TournamentRecurringService.ts');
    expect(budget).toContain(
      "HORSE_RESERVATION_BUDGET_RPC = 'fn_horses_at_tournament_reservation_budget'"
    );
    expect(service).toContain('this.horseReservationBudget.atBudget()');
    expect(trials).toContain(
      "HORSE_RESERVATION_BUDGET_RPC = 'fn_horses_at_tournament_reservation_budget'"
    );
    expect(trials).toContain('this\\.horseReservationBudget\\.atBudget()');
  });
});

describe('its native proof runs on every change to it', () => {
  it('the workflow runs the proof against PostgreSQL 17 on its paths', () => {
    for (const p of [
      'server/standby/standby-trials.sh',
      'server/standby/standby-engine.sh',
      'scripts/ci/test-backup-regression-replay.py',
      'scripts/ci/fixtures/backup-regression-replay-production.json',
    ]) {
      expect(workflow).toContain(p);
    }
    expect(workflow).toContain('python3 -B scripts/ci/test-backup-regression-replay.py');
    expect(workflow).toContain('./.github/actions/install-postgres-17');
  });
});
