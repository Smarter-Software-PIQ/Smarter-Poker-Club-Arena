import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  declaredCutoverCadence,
  releaseFreezeAdmission,
  RELEASE_FREEZE_OVERRIDE_MIN_LENGTH,
} from '../scripts/ci/release-freeze-admission.mjs';
import {
  inReleaseSchemaFreeze,
  inThreeHourlyCutoverDeferral,
  THREE_HOURLY_START_HOURS,
} from '../scripts/ci/merged-migration-dispatch.mjs';

/*
 * A HAND INSTALL RESPECTS THE NIGHTLY RELEASE SCHEMA FREEZE (2026-11-24).
 * Hand dispatches at 2026-11-21 06:38Z and 2026-11-22 07:15Z installed inside
 * the 23:45-04:15 Chicago freeze, so each morning's routine 04:00 cutover kept
 * serving ("Backup copy lacks installed migration"). The applier now enforces
 * the freeze itself.
 *
 * EVERY THREE-HOURLY CYCLE HAS THE SAME HOLD (2026-11-26). The dispatcher
 * defers ordinary files through [cycle - 150m, cycle + 10m); a hand install
 * inside that span stales the copy the cycle's candidate certified on. The
 * applier now holds a hand install to the dispatcher's own open windows.
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
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-23T19:15:00Z') }).admit).toBe(true); // 13:15 Chicago
    expect(
      releaseFreezeAdmission({ nowMs: at('2026-11-24T05:44:59Z'), cadence: 'daily' }).admit
    ).toBe(true); // 23:44:59 CST, daily cadence
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
    for (const r of [run('2026-11-22T07:15:48Z', 'false'), run('2026-11-22T13:15:48Z', 'true')]) {
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

describe('a hand install respects every three-hourly cycle hold', () => {
  it('refuses inside [cycle - 150m, cycle + 10m) and names the cycle and when it clears', () => {
    // 11:40 Chicago: 50 minutes before the 13:00 cycle's 12:30 cutoff.
    const r = releaseFreezeAdmission({ nowMs: at('2026-11-26T17:40:00Z') });
    expect(r).toMatchObject({ admit: false, basis: 'inside_cycle_hold', cycle: '13:00' });
    expect(r.clearAt).toBe('2026-11-26T19:10:00.000Z');
    expect(r.reason).toMatch(/13:00 America\/Chicago engine cutover hold/);
    expect(r.reason).toMatch(/Nothing was sent/);
    // The first and last held minutes of that cycle.
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-26T16:30:00Z') }).admit).toBe(false);
    expect(releaseFreezeAdmission({ nowMs: at('2026-11-26T19:09:59Z') }).admit).toBe(false);
  });

  it('admits in exactly the windows the dispatcher sends in, every minute of two days', () => {
    // Winter and the spring-forward day: the applier and the dispatcher must
    // never disagree about a minute, or a held file could be sent by neither.
    for (const day of ['2026-11-26T06:00:00Z', '2027-03-14T06:00:00Z']) {
      let open = 0;
      for (let m = 0; m < 24 * 60; m++) {
        const nowMs = at(day) + m * 60_000;
        const hand = releaseFreezeAdmission({ nowMs, cadence: 'three-hourly' }).admit;
        // The two predicates the dispatcher's own planner defers on.
        const dispatcher = !(
          inReleaseSchemaFreeze(nowMs) || inThreeHourlyCutoverDeferral(nowMs, 'three-hourly')
        );
        expect(hand, new Date(nowMs).toISOString()).toBe(dispatcher);
        if (hand) open++;
      }
      // Six daytime post-seal windows of 20 minutes plus 04:15-04:30 (the 01:10
      // window lies inside the nightly freeze): 135 minutes in any 24 hours.
      expect(open, day).toBe(135);
    }
    expect(THREE_HOURLY_START_HOURS).toEqual([1, 4, 7, 10, 13, 16, 19, 22]);
  });

  it('keeps the dry run, the maintenance-window route and the written outage override', () => {
    const nowMs = at('2026-11-26T17:40:00Z');
    expect(releaseFreezeAdmission({ nowMs, dryRun: true }).basis).toBe('dry_run');
    expect(releaseFreezeAdmission({ nowMs, maintenanceWindow: true }).basis).toBe(
      'maintenance_window_route'
    );
    expect(releaseFreezeAdmission({ nowMs, override: 'urgent' })).toMatchObject({
      admit: false,
      basis: 'override_too_short',
    });
    const why = 'Cash tables cannot seat: seat guard raises (incident y)';
    expect(releaseFreezeAdmission({ nowMs, override: why })).toMatchObject({
      admit: true,
      basis: 'outage_override',
      override: why,
    });
  });

  it('only an explicit daily cadence lifts the hold; an unreadable policy does not', () => {
    const nowMs = at('2026-11-26T17:40:00Z');
    expect(releaseFreezeAdmission({ nowMs, cadence: 'daily' }).admit).toBe(true);
    const unknown = releaseFreezeAdmission({ nowMs, cadence: 'unknown' });
    expect(unknown.admit).toBe(false);
    expect(unknown.reason).toMatch(/cadence could not be read/);
    expect(declaredCutoverCadence()).toBe('three-hourly');
    expect(
      declaredCutoverCadence(() => {
        throw new Error('unreadable');
      })
    ).toBe('unknown');
    expect(declaredCutoverCadence(() => '{"frequency":"weekly"}')).toBe('unknown');
    expect(declaredCutoverCadence(() => '{"frequency":"daily"}')).toBe('daily');
  });

  it('the real applier refuses a hand install inside a cycle hold before any connection', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cycle-hold-'));
    mkdirSync(join(cwd, 'supabase/migrations'), { recursive: true });
    const file = '20991231000003_cycle_hold_fixture.sql';
    writeFileSync(
      join(cwd, 'supabase/migrations', file),
      'BEGIN;\nCREATE TABLE IF NOT EXISTS public.cycle_hold_fixture(id int);\nCOMMIT;\n'
    );
    const run = (iso: string, enforced: string) =>
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
    const held = run('2026-11-26T17:40:15Z', 'true');
    expect(held.status).toBe(1);
    expect(held.stderr).toMatch(/13:00 America\/Chicago engine cutover hold/);
    // The dispatcher's own proved send (not enforced) and an open window go on
    // to the next guard, the missing DATABASE_URL (UNKNOWN, 3).
    for (const r of [run('2026-11-26T17:40:15Z', 'false'), run('2026-11-26T19:15:15Z', 'true')]) {
      expect(r.status).toBe(3);
      expect(r.stderr).not.toMatch(/cutover hold/);
    }
  }, 60_000);
});
