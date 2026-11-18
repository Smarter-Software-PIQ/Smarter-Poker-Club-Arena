import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A FINISHED TOURNAMENT'S TABLE RESOLVES ITS STALL (2026-11-17). The stall
 * watch resolved an episode only after two new hands; a table whose tournament
 * finished never deals again, so 61 TableStoppedDealing episodes (oldest
 * 2026-11-01) stayed firing and seven controller incidents could never clear.
 * This law fails the build if the newest definition of the ingest stops
 * resolving finished tournaments' episodes.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FN = 'fn_ca_table_stall_watch_ingest';

describe("a finished tournament's table resolves its stall", () => {
  it('the newest definition of the ingest resolves finished tournaments', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const defining = files.filter((f) => {
      const sql = readFileSync(join(DIR, f), 'utf8');
      return (
        sql.includes(FN) &&
        (/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql) || sql.includes('pg_get_functiondef'))
      );
    });
    const newest = defining[defining.length - 1];
    const sql = readFileSync(join(DIR, newest), 'utf8');
    expect(sql).toContain('tournament finished; it will not deal again');
    expect(sql).toMatch(/t\.status IN \(''COMPLETED'', ''CANCELLED''\)/);
    expect(sql).toMatch(/anchor found % times/);
    expect(sql).toMatch(/^-- @live-proof: /m);
  });
});
