/**
 * ===========================================================================
 *  LAW: A NEW MIGRATION'S NAME IS NOT ANOTHER FILE'S NAME
 * ===========================================================================
 *
 * WHY THIS EXISTS (2026-11-19, operational_alert_events 445897)
 *
 * The production applier answers ALREADY-APPLIED when schema_migrations holds
 * the file's version OR its name (or the name cut at 55). #11433 added
 * 20261119180000_chicago_cash_windows_add_partial_days_instead_of_subtracting
 * and #11428 added 20261119183700 under the same name with a different body.
 * 180000 installed; the 183700 run logged "ALREADY-APPLIED ... recorded as
 * version=20261119180000", reported success and changed nothing, and
 * migration-install-watch paged MergedMigrationNotInstalled an hour later.
 *
 * check-new-migration-version-collisions.mjs now refuses a NEW executable
 * migration whose name (or the applier's 55-character prefix) is already
 * carried by another executable file. A verified recording and an inert
 * tombstone are exempt, as for the version rule.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPLIER_NAME_PREFIX,
  migrationName,
  nameOwners,
  namesCollide,
} from '../scripts/ci/check-new-migration-version-collisions.mjs';

const ROOT = join(__dirname, '..');
const GATE = join(ROOT, 'scripts/ci/check-new-migration-version-collisions.mjs');
const SLUG = 'chicago_cash_windows_add_partial_days_instead_of_subtracting';

function repoWith(existing: Record<string, string>, added: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'mig-name-'));
  const git = (...a: string[]) =>
    execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'law@example.invalid');
  git('config', 'user.name', 'law');
  mkdirSync(join(dir, 'supabase/migrations'), { recursive: true });
  for (const [f, sql] of Object.entries(existing))
    writeFileSync(join(dir, 'supabase/migrations', f), sql);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  for (const [f, sql] of Object.entries(added))
    writeFileSync(join(dir, 'supabase/migrations', f), sql);
  try {
    const out = execFileSync('node', [GATE, 'main'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status as number, out: `${e.stdout}${e.stderr}` };
  }
}

describe("a new migration's name is not another file's name", () => {
  it('reads the name the applier keys on', () => {
    expect(migrationName(`supabase/migrations/20261119183700_${SLUG}.sql`)).toBe(SLUG);
    expect(APPLIER_NAME_PREFIX).toBe(55);
  });

  it('collides on the exact name and on the applier 55-character prefix', () => {
    expect(namesCollide(`20261119180000_${SLUG}.sql`, `20261119183700_${SLUG}.sql`)).toBe(true);
    const long = 'a'.repeat(58);
    expect(namesCollide(`20261119000000_${long}.sql`, `20261119000001_${'a'.repeat(55)}.sql`)).toBe(
      true
    );
    expect(
      namesCollide('20261119000000_the_rail_asks_once.sql', '20261119000001_the_rail.sql')
    ).toBe(false);
  });

  it('names the executable owner and ignores an inert tombstone', () => {
    const others = [
      `20261119180000_${SLUG}.sql`,
      `20261119183700_${SLUG}.sql`,
      '20261101000000_x.sql',
    ];
    expect(nameOwners(`supabase/migrations/20261119183700_${SLUG}.sql`, others)).toEqual([
      `20261119180000_${SLUG}.sql`,
    ]);
    expect(
      nameOwners(`supabase/migrations/20261119183700_${SLUG}.sql`, others, (f) =>
        f.startsWith('20261119180000')
      )
    ).toEqual([]);
  });

  it('the gate refuses the 2026-11-19 pair (fails on the pre-fix gate)', () => {
    const r = repoWith(
      { [`20261119180000_${SLUG}.sql`]: 'BEGIN; SELECT 1; COMMIT;\n' },
      { [`20261119183700_${SLUG}.sql`]: 'BEGIN; SELECT 2; COMMIT;\n' }
    );
    expect(r.out).toMatch(/shares its name with another migration/);
    expect(r.code).toBe(1);
  });

  it('the gate passes a distinct name and a pair whose base twin is inert', () => {
    expect(
      repoWith(
        { [`20261119180000_${SLUG}.sql`]: 'BEGIN; SELECT 1; COMMIT;\n' },
        { '20261119183700_chicago_cash_windows_feeder_moves_add_partial_days.sql': 'SELECT 2;\n' }
      ).code
    ).toBe(0);
    expect(
      repoWith(
        { [`20261119180000_${SLUG}.sql`]: '-- retired; never applied\n' },
        { [`20261119183700_${SLUG}.sql`]: 'BEGIN; SELECT 2; COMMIT;\n' }
      ).code
    ).toBe(0);
  });
});
