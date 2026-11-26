/**
 * LAW - THE BBJ DRIFT ALARM READS ITS WINDOW ONCE
 *
 * FeeReconciler.auditBBJDrift calls bbj_drift_since(now() - 1 day) every hour
 * as the service role, whose statements stop at 8 s. Cold it took 10.7 s and
 * was cancelled, so the alarm that compares booked BBJ with banked BBJ did not
 * run. Two access-path costs: the window was fetched from the 6 GB
 * rake_records heap, and the inlined CTE probed bbj_contributions twice per
 * hand. Migration 20261126203947 adds a covering partial index for the window
 * and materializes both CTEs, with an identical answer.
 *
 * This law reads the newest migration that defines the function and keeps it
 * in that shape and with the same meaning, and keeps the index declared.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const strip = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const DEFINES = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.bbj_drift_since\s*\(/i;
const FIX = '20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql';

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const definers = files.filter((f) =>
  DEFINES.test(strip(readFileSync(join(MIGRATIONS, f), 'utf8')))
);
const NEWEST = definers[definers.length - 1];
const newestSql = strip(readFileSync(join(MIGRATIONS, NEWEST), 'utf8'));

// The function runs from CREATE ... FUNCTION to the end of its $function$ body.
const start = newestSql.search(DEFINES);
const bodyStart = newestSql.indexOf('$function$', start);
const fn = newestSql.slice(start, newestSql.indexOf('$function$', bodyStart + 10) + 10);
const body = fn.slice(fn.indexOf('$function$') + 10);

describe('LAW: the BBJ drift alarm reads its window once', () => {
  it('the newest definition is the one-read form or a later one', () => {
    expect(NEWEST >= FIX).toBe(true);
  });

  it('keeps the signature, the six columns and the invoker shape', () => {
    expect(fn).toMatch(/bbj_drift_since\s*\(\s*p_since\s+timestamp with time zone\s*\)/i);
    expect(fn).toMatch(
      /RETURNS TABLE\s*\(\s*booked numeric,\s*received numeric,\s*booked_rows bigint,\s*received_rows bigint,\s*unlinkable_rows bigint,\s*unlinkable_chips numeric\s*\)/i
    );
    expect(fn).toMatch(/LANGUAGE sql/i);
    expect(fn).toMatch(/\bSTABLE\b/i);
    expect(fn).not.toMatch(/SECURITY DEFINER/i);
    expect(fn).toMatch(/SET search_path TO 'public'/i);
  });

  it('every CTE is materialized, so no per-hand probe is inlined twice', () => {
    const ctes = [...body.matchAll(/\b([a-z_]+)\s+AS\s+(MATERIALIZED\s+)?\(/gi)].filter(
      (m) => !/^(select|from|where|and|or|coalesce|sum|count)$/i.test(m[1])
    );
    expect(ctes.length).toBeGreaterThan(0);
    for (const m of ctes) expect(m[2], `CTE ${m[1]} must be MATERIALIZED`).toBeTruthy();
  });

  it('reads rake_records once and keeps the meaning of each figure', () => {
    expect(body.match(/\brake_records\b/gi)?.length).toBe(1);
    expect(body).toMatch(/created_at\s*>=\s*p_since/i);
    expect(body).toMatch(/bbj_contribution\s*>\s*0/i);
    // Settle grace strictly greater than fn_bbj_repair_unbanked's 5 minutes.
    expect(body).toMatch(/created_at\s*<\s*now\(\)\s*-\s*interval\s*'6 minutes'/i);
    // Join by hand, never by a second time window.
    expect(body).toMatch(
      /\(\s*SELECT\s+sum\(\s*b\.amount\s*\)\s+FROM\s+bbj_contributions\s+b\s+WHERE\s+b\.hand_id\s*=\s*r\.hand_id\s*\)/i
    );
    // The unlinkable population is still reported.
    expect(body).toMatch(/hand_id\s+IS\s+NULL/i);
  });

  it('the covering window index stays declared', () => {
    const declared = files.some((f) =>
      /CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+idx_rake_records_bbj_window_cover\s+ON\s+public\.rake_records\s+USING\s+btree\s*\(\s*created_at\s*\)\s+INCLUDE\s*\(\s*hand_id\s*,\s*bbj_contribution\s*\)\s+WHERE\s*\(\s*bbj_contribution\s*>\s*\(0\)::numeric\s*\)/i.test(
        strip(readFileSync(join(MIGRATIONS, f), 'utf8'))
      )
    );
    expect(declared).toBe(true);
    const dropped = files.some((f) =>
      /DROP\s+INDEX[^;]*idx_rake_records_bbj_window_cover/i.test(
        strip(readFileSync(join(MIGRATIONS, f), 'utf8'))
      )
    );
    expect(dropped).toBe(false);
  });
});
