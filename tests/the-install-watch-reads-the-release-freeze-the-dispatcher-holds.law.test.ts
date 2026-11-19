/**
 * THE INSTALL WATCH READS THE RELEASE FREEZE THE DISPATCHER HOLDS (2026-11-19).
 *
 * #11319 made Dispatch Merged Migrations hold every ordinary migration merged
 * between 23:45 and 04:15 America/Chicago until 04:15
 * (RELEASE_SCHEMA_FREEZE_CHICAGO), so the 00:07 Backup copy still equals
 * production at the 03:30 certification. The merged-migration install watch
 * did not know: on its first night it paged the owner nine times, critical,
 * "Dispatch Apply Merged Migration" for files held on purpose (alerts
 * 445153-445214). Following that page stales the night's engine certificate.
 *
 * 20261119090911 starts the watch's hour at the freeze end. This law keeps the
 * two clocks equal: the SQL bounds in the newest migration that defines
 * smarter_private.fn_ca_release_schema_freeze_end must be the dispatcher's
 * constant, the watch must call the hold helper, and the native proof must run
 * on every change to either side.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const FIX = '20261119090911_the_install_watch_starts_its_hour_when_the_release_freeze_en.sql';

let freeze: { from: [number, number]; until: [number, number] };
let inReleaseSchemaFreeze: (ms: number) => boolean;

beforeAll(async () => {
  const mod = await import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/merged-migration-dispatch.mjs')).href);
  freeze = mod.RELEASE_SCHEMA_FREEZE_CHICAGO;
  inReleaseSchemaFreeze = mod.inReleaseSchemaFreeze;
});

const hhmm = ([h, m]: [number, number]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function newestDefinition(): { file: string; sql: string } {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /FUNCTION\s+smarter_private\.fn_ca_release_schema_freeze_end\s*\(/i.test(readFileSync(resolve(DIR, f), 'utf8')));
  const file = files[files.length - 1];
  return { file, sql: readFileSync(resolve(DIR, file), 'utf8') };
}

describe('the install watch and the dispatcher read one release freeze', () => {
  it('the SQL freeze bounds are the dispatcher constant, on Chicago wall time', () => {
    const { file, sql } = newestDefinition();
    expect(file >= FIX, file).toBe(true);
    const body = sql.slice(sql.search(/FUNCTION\s+smarter_private\.fn_ca_release_schema_freeze_end\s*\(/i));
    const fn = body.slice(0, body.indexOf('$function$;', body.indexOf('$function$') + 10));
    expect(fn).toContain(`>= time '${hhmm(freeze.from)}'`);
    expect(fn).toContain(`<  time '${hhmm(freeze.until)}'`);
    expect(fn).toContain(`+ time '${hhmm(freeze.until)}') AT TIME ZONE 'America/Chicago'`);
    expect(fn).toContain(`AT TIME ZONE 'America/Chicago' AS l`);
  });

  it('the instants the migration asserts are the instants the dispatcher holds', () => {
    const sql = readFileSync(resolve(DIR, FIX), 'utf8');
    const asserted = [...sql.matchAll(/fn_ca_release_schema_freeze_end\('([0-9-]+ [0-9:]+)\+00'\) (IS NOT NULL|IS DISTINCT FROM)/g)];
    expect(asserted.length).toBeGreaterThanOrEqual(6);
    for (const [, at, op] of asserted) {
      const ms = Date.parse(at.replace(' ', 'T') + 'Z');
      expect(inReleaseSchemaFreeze(ms), at).toBe(op === 'IS DISTINCT FROM');
    }
  });

  it('the watch starts a frozen file\'s hour at the freeze end, and only through the hold helper', () => {
    const sql = readFileSync(resolve(DIR, FIX), 'utf8');
    expect(sql).toContain("THE RELEASE FREEZE HOLDS THE HOUR (20261119090911)");
    expect(sql).toMatch(/p_at < COALESCE\(smarter_private\.fn_ca_install_watch_freeze_hold_end\(v_row\.merged_at\), '-infinity'::timestamptz\) \+ interval '60 minutes'/);
    expect(sql).toContain("md5(v_def) <> '3ebd1409de27bdefc7aaa6a850f953af'");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it('the native proof runs whenever either clock or the watch changes', () => {
    const wf = readFileSync(resolve(ROOT, '.github/workflows/a-merged-migration-left-uninstalled-is-paged.yml'), 'utf8');
    expect(wf).toContain(`supabase/migrations/${FIX}`);
    expect(wf).toContain('scripts/ci/merged-migration-dispatch.mjs');
    expect(wf).toContain('python3 -B scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py');
    const proof = readFileSync(resolve(ROOT, 'scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py'), 'utf8');
    expect(proof).toContain('the release freeze must hold the hour page');
  });
});
