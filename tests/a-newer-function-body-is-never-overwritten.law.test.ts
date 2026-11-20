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
  redefinitionOrderProblems,
} from '../scripts/ci/check-new-migration-version-collisions.mjs';

const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'supabase/migrations');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const base = (except: string) =>
  files.filter((f) => f !== except).map((name) => ({ name, functions: definedFunctions(read(name)) }));

describe('a newer function body is never overwritten by an older version', () => {
  it('names created, replaced and anchored-edit functions', () => {
    const fns = definedFunctions(
      "CREATE OR REPLACE FUNCTION public.a_one(x int) ...\n" +
        "CREATE OR REPLACE FUNCTION smarter_private.b_two() ...\n" +
        "-- CREATE OR REPLACE FUNCTION public.commented_out()\n" +
        "EXECUTE replace(pg_get_functiondef('public.c_three(uuid)'::regprocedure), 'x', 'y');"
    );
    expect([...fns].sort()).toEqual(['public.a_one', 'public.c_three', 'smarter_private.b_two']);
  });

  it('would have refused 20261119180800, which overwrote the drill body of 20261119183127', () => {
    const f = '20261119180800_harden_rake_lock_timeout_cron_watch_and_drill.sql';
    const problems = redefinitionOrderProblems(f, read(f), base(f));
    expect(problems.join('\n')).toContain('public.fn_ca_alarm_drill');
    expect(problems.join('\n')).toContain('20261119183127_the_drill_skips_protected_clubs_proven_jobs_clear.sql');
  });

  it('lets a migration through when no newer file defines its functions', () => {
    const v = '99999999999999_x.sql';
    expect(redefinitionOrderProblems(v, 'CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill() ...', base(v))).toEqual([]);
  });

  it('the merge gate runs the check and fails on it', () => {
    const gate = readFileSync(join(ROOT, 'scripts/ci/check-new-migration-version-collisions.mjs'), 'utf8');
    expect(gate).toContain('redefinitionOrderProblems(file, readFileSync(path, \'utf8\'), baseFiles)');
    expect(gate).toContain('if (overwrites.length > 0) process.exit(1);');
  });

  it('the newest migration touching the drill keeps its run record', () => {
    const newest = files.filter((f) => definedFunctions(read(f)).has('public.fn_ca_alarm_drill')).pop()!;
    expect(read(newest)).toContain('INSERT INTO public.ca_detector_runs (detector, detail)');
  });
});
