/**
 * LAW: RETENTION PASSES AN OPERATOR-ARCHIVED TABLE (Dan 2026-11-07).
 *
 * sp_prune_hand_history (cron 117, every 10 s) failed on every run from 19:56
 * UTC on 2026-11-07: 896 runs, each ~4 s of work rolled back, with
 * TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR. smarter_private.
 * tournament_abort_archived_write_guard refuses every write to hand_history,
 * hand_atomic_commits and hand_submissions of a table holding a
 * tournament_abort_hand_dispositions row, and one such hand sat among the
 * doomed of the cursor's page. The page rolled back, the cursor never moved,
 * and 938,846 hands sat past the eight-day boundary while the job burned a
 * backend every ten seconds. Measured page profile (rolled back on
 * production): selection 1.8 s of which 820 ms was the restoration-case
 * anti-join unpacking every case's source_refs once per hand.
 *
 * Migration 20261107224000 excludes a hand of an archived table from the
 * candidates (retained as the operator's record) and reads the citations once
 * per page. This pins both in the installing migration and in whichever
 * migration later redefines the pruner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');
const INSTALLS = '20261107224000_retention_passes_an_operator_archived_table.sql';
const files = fs
  .readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const codeOnly = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const DEFINES = /create\s+or\s+replace\s+function\s+public\.sp_prune_hand_history\s*\(/i;

/** The pruner body (CREATE ... $function$;) of the newest migration that defines it. */
function livePruner(): { file: string; body: string } {
  const file = files.filter((f) => DEFINES.test(read(f))).pop() as string;
  const sql = read(file);
  const start = sql.search(DEFINES);
  return { file, body: codeOnly(sql.slice(start, sql.indexOf('$function$;', start))) };
}

const candidates = (body: string) =>
  body.slice(body.indexOf('candidates AS ('), body.indexOf('classified AS ('));

describe('retention passes an operator-archived table', () => {
  it('the installing migration exists and is the pruner it pins', () => {
    expect(files).toContain(INSTALLS);
    expect(DEFINES.test(read(INSTALLS))).toBe(true);
  });

  it('a hand of an archived table is not a candidate, so its page never rolls back', () => {
    const { file, body } = livePruner();
    expect(candidates(body), file).toMatch(
      /AND NOT EXISTS \(SELECT 1 FROM smarter_private\.tournament_abort_hand_dispositions ad\s+WHERE ad\.table_id=hh\.table_id\)/
    );
  });

  it('the restoration-case citations are read once per page, not once per hand', () => {
    const { file, body } = livePruner();
    expect(body, file).toMatch(/\), cited AS MATERIALIZED \(\s*SELECT DISTINCT sr->>'id' AS id/);
    expect(candidates(body), file).toContain(
      'AND NOT EXISTS (SELECT 1 FROM cited WHERE cited.id=hh.id::text)'
    );
    expect(candidates(body), file).not.toContain('jsonb_array_elements(rc.source_refs)');
  });

  it('the install proves only these bytes changed and the job is the same job', () => {
    const sql = read(INSTALLS);
    expect(sql).toContain("md5(pg_get_functiondef(p.oid))='1b2f59cf765985058a8b146f9ed986d1'");
    expect(sql).toContain("md5(pg_get_functiondef(p.oid))='637890ae88e74d2cc436f2ca602843f3'");
    expect(sql).toContain("IF md5(d) IS DISTINCT FROM '1b2f59cf765985058a8b146f9ed986d1'");
    expect(sql).toContain("md5(command)='fc97e3391af1e3a6e27d5662c6bfb954'");
    expect(sql).not.toMatch(/cron\.(alter_job|schedule|unschedule)/);
  });
});
