/**
 * A NEWER FUNCTION BODY IS NEVER OVERWRITTEN BY AN OLDER VERSION (incident
 * 316ed735, 2026-11-19).
 *
 * Migrations install in merge order, not version order. 20261119180800 was
 * lower-versioned than 20261119183127 but merged after it, redefined
 * public.fn_ca_alarm_drill from an older body, and production silently lost
 * the drill's run record, so the cron watch kept re-raising a fixed failure.
 * These laws pin:
 *
 *   1. the merge gate refuses a NEW migration that defines or rewrites a
 *      function a higher-versioned base migration already defines, and would
 *      have refused 20261119180800;
 *   2. a migration defining only functions no newer file defines passes;
 *   3. the gate is wired into main() and fails the run;
 *   4. the drill records its completed run in the newest migration that
 *      touches it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  definedFunctions,
  definedObjects,
  missingPreimagePinProblems,
  redefinitionOrderProblems,
} from '../scripts/ci/check-new-migration-version-collisions.mjs';
import { replacesMd5Pins, stalePinGuardSQL } from '../scripts/ci/migration-stale-pins.mjs';
import {
  extractLatestFunctionBody,
  normalizeSqlBody,
  sqlBodyMd5,
} from '../scripts/ci/verify-alarm-drill-and-cron-watch.mjs';

const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'supabase/migrations');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const allParsed = files.map((name) => {
  const sql = read(name);
  return { name, sql, functions: definedFunctions(sql) };
});
const base = (except: string) => allParsed.filter((f) => f.name !== except);

describe('a newer function body is never overwritten by an older version', () => {
  it('names created, replaced and anchored-edit functions while ignoring comments', () => {
    const fns = definedFunctions(
      'CREATE OR REPLACE FUNCTION public.a_one(x int) ...\n' +
        'CREATE FUNCTION smarter_private.b_two() ...\n' +
        '-- CREATE OR REPLACE FUNCTION public.commented_out()\n' +
        '/* CREATE OR REPLACE FUNCTION public.block_commented_out() */\n' +
        "EXECUTE replace(pg_get_functiondef('public.c_three(uuid)'::regprocedure), 'x', 'y');"
    );
    expect([...fns].sort()).toEqual(['public.a_one', 'public.c_three', 'smarter_private.b_two']);
  });

  it('would have refused 20261119180800, which overwrote both the drill and cron watch of 20261119183127', () => {
    const f = '20261119180800_harden_rake_lock_timeout_cron_watch_and_drill.sql';
    const baseAt183127 = base(f).filter((b) => b.name.split('_', 1)[0] <= '20261119183127');
    const problems = redefinitionOrderProblems(f, read(f), baseAt183127);
    expect(problems.join('\n')).toContain('public.fn_ca_alarm_drill');
    expect(problems.join('\n')).toContain('public.fn_ca_cron_failure_watch');
    expect(problems.join('\n')).toContain(
      '20261119183127_the_drill_skips_protected_clubs_proven_jobs_clear.sql'
    );
  });

  it('lets a migration through when no newer file defines its functions', () => {
    const v = '99999999999999_x.sql';
    expect(
      redefinitionOrderProblems(
        v,
        'CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill() ...',
        base(v)
      )
    ).toEqual([]);
  });

  it('the merge gate runs the check and fails on it', () => {
    const gate = readFileSync(
      join(ROOT, 'scripts/ci/check-new-migration-version-collisions.mjs'),
      'utf8'
    );
    expect(gate).toContain('redefinitionOrderProblems(file, sql, baseFiles)');
    expect(gate).toContain('missingPreimagePinProblems(sql, baseFiles)');
    expect(gate).toContain('if (overwrites.length > 0) process.exit(1);');
  });

  it('the newest migration touching the drill keeps its run record and generic delete-trigger exclusion', () => {
    const newest = allParsed.filter((f) => f.functions.has('public.fn_ca_alarm_drill')).pop()!;
    const sql = newest.sql;
    expect(sql).toContain('INSERT INTO public.ca_detector_runs (detector, detail)');
    expect(sql).toContain('pg_catalog.pg_trigger');
    expect(sql).toContain('pg_catalog.pg_get_functiondef(t.tgfoid)');
  });

  it('the newest migration touching the cron watch keeps both proven-job clearing and immediate weekly priority', () => {
    const newest = allParsed
      .filter((f) => f.functions.has('public.fn_ca_cron_failure_watch'))
      .pop()!;
    const sql = newest.sql;
    expect(sql).toContain('SELECT 1 FROM public.ca_detector_runs pr');
    expect(sql).toContain("COALESCE((pr.detail->>'pass')::boolean, true)");
    expect(sql).toContain('day.runs_7d = 1');
    expect(sql).toContain(
      'ORDER BY ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed) DESC'
    );
  });

  it('refuses lower-versioned overwrites of views, triggers, and cron.schedule jobs', () => {
    const newerBase = [
      {
        name: '20261120220000_newer.sql',
        functions: new Set<string>(),
        objects: definedObjects(
          'CREATE OR REPLACE VIEW public.v_example AS SELECT 1;\n' +
            'CREATE TRIGGER trg_guard BEFORE DELETE ON public.club_members FOR EACH ROW EXECUTE FUNCTION public.f();\n' +
            "SELECT cron.schedule('ca-example-job', '0 * * * *', $$SELECT 1$$);"
        ),
      },
    ];
    const olderSql =
      'CREATE OR REPLACE VIEW public.v_example AS SELECT 2;\n' +
      'CREATE TRIGGER trg_guard BEFORE DELETE ON public.club_members FOR EACH ROW EXECUTE FUNCTION public.g();\n' +
      "SELECT cron.schedule('ca-example-job', '0 * * * *', $$SELECT 2$$);";
    const problems = redefinitionOrderProblems('20261120210000_older.sql', olderSql, newerBase);
    expect(problems.join('\n')).toContain('view:public.v_example');
    expect(problems.join('\n')).toContain('trigger:public.club_members.trg_guard');
    expect(problems.join('\n')).toContain('cron:ca-example-job');
  });

  it('parses -- @replaces-md5 preimage pins and wires them into stalePinGuardSQL', () => {
    const src =
      '-- @replaces-md5: public.fn_ca_cron_failure_watch()=0123456789abcdef0123456789abcdef\n' +
      'BEGIN;\nSELECT 1;\nCOMMIT;\n';
    expect(replacesMd5Pins(src)).toEqual([
      { signature: 'public.fn_ca_cron_failure_watch()', md5: '0123456789abcdef0123456789abcdef' },
    ]);
    const guarded = stalePinGuardSQL('20261120222900_example.sql', src, src);
    expect(guarded).toContain('$ca_replaces_md5_check$');
    expect(guarded).toContain('migration_preimage_mismatch');
  });

  it('extracts and normalizes watched guard bodies', () => {
    const latestWatch = extractLatestFunctionBody(DIR, 'public.fn_ca_cron_failure_watch');
    expect(latestWatch?.file).toBe(
      '20261122145848_cutover_readiness_classification_resolution_and_cron_recover.sql'
    );
    expect(normalizeSqlBody('/* c */ SELECT 1 -- x\n  + 2')).toBe('SELECT 1 + 2');
    expect(sqlBodyMd5('/* c */ SELECT 1 -- x\n  + 2')).toHaveLength(32);
  });

  it('requires -- @replaces-md5 when replacing a watched guard function', () => {
    const unpinned =
      'CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;';
    expect(missingPreimagePinProblems(unpinned, base('99999999999999_x.sql')).join('\n')).toContain(
      'replaces watched guard public.fn_ca_cron_failure_watch without -- @replaces-md5'
    );
    const pinned =
      '-- @replaces-md5: public.fn_ca_cron_failure_watch()=0123456789abcdef0123456789abcdef\n' +
      unpinned;
    expect(missingPreimagePinProblems(pinned, base('99999999999999_x.sql'))).toEqual([]);
  });

  it('wires live watched-guard body drift detection into check-cron-health.mjs and fn_ca_cron_health', () => {
    const cronHealthScript = readFileSync(join(ROOT, 'scripts/ci/check-cron-health.mjs'), 'utf8');
    expect(cronHealthScript).toContain('fn_ca_watched_guard_hashes');
    expect(cronHealthScript).toContain('if (guardDrifts.length > 0) process.exit(1);');
    const latestHealth = extractLatestFunctionBody(DIR, 'public.fn_ca_cron_health');
    expect(latestHealth?.file).toBe(
      '20261121153438_cron_health_proven_jobs_and_watched_guard_hashes.sql'
    );
    expect(latestHealth?.body).toContain('public.ca_detector_runs pr');
    expect(latestHealth?.body).toContain("coalesce((pr.detail->>'pass')::boolean, true)");
  });
});
