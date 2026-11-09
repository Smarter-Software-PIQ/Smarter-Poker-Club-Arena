/**
 * A BACKUP COPY IS CERTIFIED BY WHAT IT HOLDS (owner order 2026-11-08).
 *
 * "Compare the migrations actually present in the restored Backup database
 * against those required by the exact release candidate and installed in
 * production. Commit times and copy timestamps are diagnostic evidence.
 * Certification must depend on verified database contents."
 *
 * Backup 42519319251 restored at 20:38:05Z; 20261108193515 (merged 20:36:58Z)
 * installed at 20:38:11Z, six seconds later. Both the refresh-due decision and
 * the selector compared the commit time with the restore time and would have
 * accepted the copy. Run 42521781581 exported while 20261108210509 installed.
 *
 * Behaviour is proved in tests/operations/backup-installed-migrations.test.py
 * (exact case, matching, extra, different digest, installed during export,
 * refresh-due, cutover) and scripts/ci/test-installed-migration-listing-postgres.py
 * (real PostgreSQL, run by a-backup-copy-is-certified-by-what-it-holds.yml). This file pins the wiring, so no route can drift back to
 * a clock.
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const backup = parse(read('.github/workflows/backup-engine.yml'));
const stage = parse(read('.github/workflows/stage-engine-release.yml'));
const SELECTOR = read('scripts/ci/select-daily-engine.py');
const TRANSACTION = read('server/scripts/engine-release-transaction.sh');
const STANDBY = read('server/standby/standby-engine.sh');
const HELPER = resolve(root, 'server/scripts/engine-release-installed-migrations.py');
const HELPER_SOURCE = read('server/scripts/engine-release-installed-migrations.py');
const step = (job: any, pred: (s: any) => boolean) => job.steps.find(pred);

describe('a Backup copy is certified by the migrations it holds', () => {
  it('runs the behavioural regressions in a required suite', () => {
    const run = spawnSync(
      'python3',
      ['-B', 'tests/operations/backup-installed-migrations.test.py'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 120000,
      }
    );
    expect(run.status, run.stderr).toBe(0);
    const proof = parse(read('.github/workflows/a-backup-copy-is-certified-by-what-it-holds.yml'));
    expect(proof.on.pull_request.paths).toContain(
      'server/scripts/engine-release-installed-migrations.py'
    );
    expect(proof.jobs['installed-migration-listing'].steps.at(-1).run).toContain(
      'python3 -B scripts/ci/test-installed-migration-listing-postgres.py'
    );
  }, 120000);

  it('the selector no longer decides on commit time against restore time', () => {
    const fn = SELECTOR.slice(
      SELECTOR.indexOf('def current_schema('),
      SELECTOR.indexOf('def statuses(')
    );
    expect(fn).not.toMatch(/int\(newest\)\s*<=\s*epoch/);
    expect(fn).toContain("module.judge(evidence['schemaEvidence'], db, production, required)");
    expect(fn).toContain('diagnosis only');
    expect(SELECTOR).toContain("EVIDENCE_FILE = 'schema-evidence.json'");
    expect(SELECTOR).toContain('fresh, why, diagnostics = current_schema(');
    expect(HELPER_SOURCE).toContain('lacks the exact candidate migration(s)');
    const checkout = step(stage.jobs.selection, (s) => s.uses?.startsWith('actions/checkout@'));
    const directories = checkout.with['sparse-checkout'].trim().split(/\s+/);
    for (const dependency of [
      'scripts/ci/select-daily-engine.py',
      'server/scripts/engine-release-installed-migrations.py',
      'server/standby/schema-evidence.py',
    ]) {
      expect(
        directories.some((dir: string) => dependency.startsWith(dir + '/')),
        dependency
      ).toBe(true);
    }
    const freeze = step(stage.jobs.selection, (s) => s.id === 'freeze');
    expect(freeze.env.DATABASE_URL).toBe('${{ secrets.DATABASE_URL }}');
  });

  it('the refresh-due decision compares contents, and an unreadable answer is due', () => {
    const due = step(backup.jobs.refresh, (s) => s.id === 'due');
    expect(due.run).toContain('engine-release-installed-migrations.py refresh-due');
    expect(due.run).toContain('--copy-evidence copy-evidence.json --copy-evidence-sha');
    expect(due.run).toContain('[ "$contents_due" = true ] && due=true');
    expect(due.run).toContain("|| verdict='due=true'");
    expect(due.run).not.toMatch(/\[ "\$newest" -gt "\$restored" \]/);
    expect(due.run).toContain('diagnostic only');
    expect(due.env.DATABASE_URL).toBe('${{ secrets.DATABASE_URL }}');
  });

  it("the contents are the export's own bound schema evidence, not a parallel capture", () => {
    const exp = step(backup.jobs.refresh, (s) => /^Export the production structure/.test(s.name));
    expect(exp.run).toContain('schema-evidence.py capture --output');
    expect(exp.run).toContain('schema-evidence.py compare');
    expect(exp.run).toContain('schema.dump schema-evidence.json seed');
    expect(HELPER_SOURCE).toContain("parents[2] / 'server/standby/schema-evidence.py'");
    expect(STANDBY).toContain("data['schemaEvidenceSha256']");
  });

  it('certification publishes success only with a bound installed set named in it', () => {
    const certify = backup.jobs.certify;
    const run = step(certify, (s) => s.id === 'certify');
    expect(run.run).toContain('engine-release-installed-migrations.py certified-digest');
    expect(run.run).toContain('--evidence schema-evidence.json --certificate certificate.json');
    const publish = step(certify, (s) => /Publish the verdict/.test(s.name));
    expect(publish.env.INSTALLED).toBe('${{ steps.certify.outputs.installed }}');
    expect(publish.run).toContain('[[ "$INSTALLED" =~ ^[0-9a-f]{64}$ ]]');
    expect(publish.run).toContain('installed migrations $INSTALLED');
  });

  it('the cutover re-reads production after the window doors and before the engine lock', () => {
    const loopStart = TRANSACTION.indexOf('window_doors_ready || WINDOW_DOORS_RC=$?');
    const check = TRANSACTION.indexOf(
      '\n  [ -z "${INSTALLED_MIGRATIONS:-}" ] || installed_migrations_unchanged\n',
      loopStart
    );
    // Assigned unconditionally before the loop, so the read always runs on a host.
    const assigned = TRANSACTION.indexOf(
      '\nINSTALLED_MIGRATIONS="$CONTROL_DIR/engine-release-installed-migrations.py"\n'
    );
    expect(assigned).toBeGreaterThan(0);
    expect(assigned).toBeLessThan(loopStart);
    const lock = TRANSACTION.indexOf("acquire_engine_lock 'maintenance cutover'", loopStart);
    const prepare = TRANSACTION.indexOf('"$RELEASE_SEAL" prepare', loopStart);
    expect(loopStart).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(loopStart);
    expect(lock).toBeGreaterThan(check);
    expect(prepare).toBeGreaterThan(lock);
    expect(TRANSACTION).toContain('"$INSTALLED_MIGRATIONS" certified --sha "$SHA"');
    const installer = read('server/scripts/install-engine-supervisor.sh');
    expect(installer).toMatch(/\n {2}engine-release-installed-migrations\.py\n/);
  });

  /** The transaction's own check, run with the real helper and fixtures. */
  function gate(production: string, certified: string) {
    const dir = mkdtempSync(join(tmpdir(), 'installed-gate-'));
    try {
      writeFileSync(join(dir, 'production.txt'), production);
      const start = TRANSACTION.indexOf('installed_migrations_unchanged() {');
      const end = TRANSACTION.indexOf('\n}\n', start) + 3;
      const script = [
        'set -Eeuo pipefail',
        'die() { echo "[engine-release-transaction] FATAL: $*" >&2; exit 1; }',
        TRANSACTION.slice(start, end),
        'installed_migrations_unchanged; echo PROCEEDS',
      ].join('\n');
      return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          INSTALLED_MIGRATIONS: HELPER,
          ENV_FILE: '/nonexistent',
          REPO_DIR: root,
          SHA: '20c0ab1c93178c102a5b7353905fa1bee7b5ccb9',
          CERTIFIED_INSTALLED_MIGRATIONS: certified,
          ENGINE_INSTALLED_MIGRATIONS_PRODUCTION_FIXTURE: join(dir, 'production.txt'),
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // The release host reads [[version, name], ...]; the certificate names the
  // sha256 of that set's canonical JSON (engine-release-installed-migrations.py).
  const rows: [string, string][] = [
    ['20261108193515', 'a_full_ring_feeder_starts_with_the_last_two_to_sit'],
  ];
  const canonical = (r: [string, string][]) => JSON.stringify(r);
  const certifiedListing = JSON.stringify(rows);
  const certifiedDigest = createHash('sha256').update(canonical(rows)).digest('hex');

  it('the cutover proceeds when production is unchanged since certification', () => {
    const res = gate(certifiedListing, certifiedDigest);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain(
      'READY - production still holds the certified installed migration set'
    );
    expect(res.stdout).toContain('PROCEEDS');
  });

  it('the cutover refuses, and keeps serving, when production installed a migration after certification', () => {
    const later = JSON.stringify([
      ...rows,
      ['20261108210509', 'weekly_rounds_respect_maintenance_admission'],
    ]);
    const res = gate(later, certifiedDigest);
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain('PROCEEDS');
    expect(res.stderr).toContain(
      'FATAL: INSTALLED MIGRATIONS CHANGED AFTER CERTIFICATION: REFUSED'
    );
    expect(res.stderr).toContain('the current engine keeps running');
  });

  it('an unreadable production set refuses the cutover as UNKNOWN, never as unchanged', () => {
    const res = gate('unreadable', certifiedDigest);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('INSTALLED MIGRATIONS UNKNOWN (status 3)');
  });
});
