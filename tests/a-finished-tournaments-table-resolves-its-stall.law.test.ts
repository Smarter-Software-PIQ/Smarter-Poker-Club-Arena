import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A FINISHED TOURNAMENT'S TABLE RESOLVES ITS STALL (2026-11-17). The stall
 * watch resolved an episode only after two new hands; a table whose tournament
 * finished never deals again, so 61 TableStoppedDealing episodes (oldest
 * 2026-11-01) stayed firing and seven controller incidents could never clear.
 * This law fails the build if the original migration loses its guard or if any
 * later definition/patch of the ingest stops resolving finished tournaments.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261117225349_finished_tournament_table_resolves_its_stall.sql';
const FN = 'fn_ca_table_stall_watch_ingest';

describe("a finished tournament's table resolves its stall", () => {
  it('the installed finished-tournament resolution is preserved by every later ingest migration', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const rootIndex = files.indexOf(ROOT);
    expect(rootIndex).toBeGreaterThanOrEqual(0);

    const rootSql = readFileSync(join(DIR, ROOT), 'utf8');
    expect(rootSql).toContain('tournament finished; it will not deal again');
    expect(rootSql).toMatch(/t\.status IN \(''COMPLETED'', ''CANCELLED''\)/);
    expect(rootSql).toMatch(/anchor found % times/);
    expect(rootSql).toMatch(/^-- @live-proof: /m);

    const laterTouchingIngest = files.slice(rootIndex + 1).filter((f) => {
      const sql = readFileSync(join(DIR, f), 'utf8');
      return (
        sql.includes(FN) &&
        (/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql) || sql.includes('pg_get_functiondef'))
      );
    });

    for (const f of laterTouchingIngest) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      expect(sql, `${f} must declare @live-proof`).toMatch(/^-- @live-proof: /m);
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?fn_ca_table_stall_watch_ingest\b/i.test(
          sql
        )
      ) {
        expect(sql, `${f} redefines ${FN} without finished-tournament resolution`).toContain(
          'tournament finished; it will not deal again'
        );
        expect(sql, `${f} redefines ${FN} without COMPLETED/CANCELLED check`).toMatch(
          /t\.status IN \(''COMPLETED'', ''CANCELLED''\)|t\.status IN \('COMPLETED', 'CANCELLED'\)/
        );
      } else {
        // Surgical pg_get_functiondef patch: must verify exact anchor count and
        // confirm the finished-tournament resolution survives the rewrite.
        expect(sql, `${f} must assert exact anchor count`).toMatch(/anchor found % times/);
        expect(sql, `${f} must verify finished-tournament resolution survives`).toContain(
          'tournament finished; it will not deal again'
        );
      }
    }
  });
});
