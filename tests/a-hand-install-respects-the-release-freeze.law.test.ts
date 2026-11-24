import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  releaseFreezeAdmission,
  RELEASE_FREEZE_OVERRIDE_MIN_LENGTH,
} from '../scripts/ci/release-freeze-admission.mjs';

/*
 * A HAND INSTALL RESPECTS THE NIGHTLY RELEASE SCHEMA FREEZE (2026-11-24).
 * Hand dispatches at 2026-11-21 06:38Z and 2026-11-22 07:15Z installed inside
 * the 23:45-04:15 Chicago freeze, so each morning's routine 04:00 cutover kept
 * serving ("Backup copy lacks installed migration"). The applier now enforces
 * the freeze itself.
 */
const ROOT = join(__dirname, '..');
const at = (iso: string) => Date.parse(iso);

describe('a hand install respects the nightly release schema freeze', () => {
  it('refuses the two incident installs, which carried no justification', () => {
    for (const iso of ['2026-11-21T06:38:03Z', '2026-11-22T07:15:48Z']) {
      const r = releaseFreezeAdmission({ nowMs: at(iso) });
      expect(r.admit, iso).toBe(false);
      expect(r.reason).toMatch(/Nothing was sent/);
    }
  });

  it('admits outside the freeze, a dry run, and the maintenance window route', () => {
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-23T18:23:51Z') }).admit).toBe(true); // 12:23 Chicago
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-24T05:44:59Z') }).admit).toBe(true); // 23:44:59 CST
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-24T10:15:00Z') }).admit).toBe(true); // 04:15 CST
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-24T05:45:00Z') }).admit).toBe(false); // 23:45 CST
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-24T07:00:00Z'), dryRun: true }).admit).toBe(
      true
    );
    expect(
      releaseFreezeAdmission({ nowMs: at('2026-11-24T10:00:30Z'), maintenanceWindow: true }).admit
    ).toBe(true);
  });

  it('admits an outage only with a written justification, and keeps it', () => {
    const short = releaseFreezeAdmission({ nowMs: at('2026-11-24T07:00:00Z'), override: 'urgent' });
    expect(short.admit).toBe(false);
    const why = 'Nightly 20K winner unpaid: settlement guard times out (incident x)';
    expect(why.length).toBeGreaterThanOrEqual(RELEASE_FREEZE_OVERRIDE_MIN_LENGTH);
    const ok = releaseFreezeAdmission({ nowMs: at('2026-11-24T07:00:00Z'), override: why });
    expect(ok).toMatchObject({ admit: true, basis: 'outage_override', override: why });
  });

  it('is wired into the applier, the older-first installer and the workflow', () => {
    const applier = readFileSync(join(ROOT, 'scripts/ci/apply-recorded-migration.mjs'), 'utf8');
    expect(applier).toMatch(/releaseFreezeAdmission\(/);
    expect(applier).toMatch(/--release-freeze-override/);
    const older = readFileSync(join(ROOT, 'scripts/ci/install-older-merged-first.mjs'), 'utf8');
    expect(older).toMatch(/--release-freeze-override/);
    const wf = readFileSync(join(ROOT, '.github/workflows/apply-merged-migration.yml'), 'utf8');
    expect(wf).toMatch(/release_freeze_override:/);
    expect(wf).toMatch(
      /RELEASE_FREEZE_ENFORCED: \$\{\{ \(github\.event_name == 'repository_dispatch' && \(endsWith\(github\.actor, '\[bot\]'\) \|\| endsWith\(github\.triggering_actor, '\[bot\]'\)\)\) && 'false' \|\| 'true' \}\}/
    );
    expect(applier).toMatch(/process\.env\.RELEASE_FREEZE_ENFORCED === 'true'/);
    expect(wf).toMatch(/RELEASE_FREEZE_OVERRIDE: \$\{\{ inputs\.release_freeze_override \}\}/);
    expect(
      (wf.match(/--release-freeze-override "\$RELEASE_FREEZE_OVERRIDE"/g) || []).length
    ).toBeGreaterThanOrEqual(2);
  });

  it('the real applier refuses inside the freeze before it opens any connection', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'release-freeze-'));
    mkdirSync(join(cwd, 'supabase/migrations'), { recursive: true });
    const file = '20991231000002_c1_freeze_fixture.sql';
    writeFileSync(
      join(cwd, 'supabase/migrations', file),
      'BEGIN;\nCREATE TABLE IF NOT EXISTS public.c1_freeze_fixture(id int);\nCOMMIT;\n'
    );
    const run = (iso: string, enforced: string, extra: string[] = []) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          join(ROOT, 'scripts/ci/fixtures/maintenance-window-migrations/shift-clock.mjs'),
          join(ROOT, 'scripts/ci/apply-recorded-migration.mjs'),
          '--ssl-root-cert',
          'system',
          '--migration',
          file,
          ...extra,
        ],
        {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            FAKE_NOW_MS: String(at(iso)),
            RELEASE_FREEZE_ENFORCED: enforced,
            DATABASE_URL: '',
          },
        }
      );
    const inside = run('2026-11-22T07:15:48Z', 'true');
    expect(inside.status).toBe(1);
    expect(inside.stderr).toMatch(/inside the nightly release schema freeze/);
    // Not enforced (a throwaway-database proof) or outside the freeze: it goes
    // on to its next guard, the missing DATABASE_URL (UNKNOWN, 3).
    for (const r of [run('2026-11-22T07:15:48Z', 'false'), run('2026-11-22T12:15:48Z', 'true')]) {
      expect(r.status).toBe(3);
      expect(r.stderr).not.toMatch(/release schema freeze/);
    }
    const outage = run('2026-11-22T07:15:48Z', 'true', [
      '--release-freeze-override',
      'Nightly 20K winner unpaid: settlement guard times out',
    ]);
    expect(outage.status).toBe(3);
    expect(outage.stdout).toMatch(
      /release schema freeze OVERRIDDEN for an outage: Nightly 20K winner unpaid/
    );
  }, 60_000);
});
