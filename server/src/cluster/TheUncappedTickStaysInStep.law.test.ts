/**
 * THE UNCAPPED TICK STAYS IN STEP WITH THE ORIGINAL (2026-11-12).
 *
 * Migration 20261112154904 added fn_cash_cluster_tick_uncapped and
 * fn_cash_clusters_tick_all_uncapped: copies of the originals with no table
 * count, called only by this engine (ClusterController.uncappedTick).
 * A later fix that redefines only an ORIGINAL would silently not reach the
 * engine. So every later migration that redefines either tick must redefine
 * its _uncapped twin in the same file (or retire the pair on purpose and
 * change this law).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../../../supabase/migrations/', import.meta.url);
const SINCE = '20261112154904';
const PAIRS = [
  ['fn_cash_cluster_tick', 'fn_cash_cluster_tick_uncapped'],
  ['fn_cash_clusters_tick_all', 'fn_cash_clusters_tick_all_uncapped'],
] as const;

/** Does this SQL redefine `name` itself (not a longer name sharing its prefix)? */
function redefines(sql: string, name: string): boolean {
  return (
    new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'i').test(
      sql
    ) || new RegExp(`pg_get_functiondef\\('public\\.${name}\\(`, 'i').test(sql)
  );
}

/** The originals this SQL redefines without also redefining their twin. */
function driftIn(sql: string): string[] {
  return PAIRS.filter(([orig, twin]) => redefines(sql, orig) && !redefines(sql, twin)).map(
    ([orig]) => orig
  );
}

describe('a later tick fix reaches the tick this engine calls', () => {
  it('the rule tells a drifting migration from a correct one', () => {
    expect(
      driftIn('CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid) AS $$ $$;')
    ).toEqual(['fn_cash_cluster_tick']);
    expect(
      driftIn(
        'CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid) AS $$ $$;\n' +
          'CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick_uncapped(p_game_id uuid) AS $$ $$;'
      )
    ).toEqual([]);
    expect(
      driftIn("SELECT pg_get_functiondef('public.fn_cash_clusters_tick_all(jsonb)'::regprocedure);")
    ).toEqual(['fn_cash_clusters_tick_all']);
    // A twin alone is not the original being redefined.
    expect(
      driftIn(
        'CREATE FUNCTION public.fn_cash_clusters_tick_all_uncapped(p_eligible jsonb) AS $$ $$;'
      )
    ).toEqual([]);
  });

  it('every migration after 20261112154904 that redefines a tick also redefines its _uncapped twin', () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > SINCE)
      .flatMap((f) => driftIn(readFileSync(new URL(f, DIR), 'utf8')).map((o) => `${f}: ${o}`));
    expect(offenders).toEqual([]);
  });
  it('the engine names both doors for the release gate, and the gate reads them', async () => {
    const controller = readFileSync(new URL('./ClusterController.ts', import.meta.url), 'utf8');
    const { doorsIn } = await import('../../../scripts/ci/check-engine-doors-exist.mjs');
    const doors = doorsIn(controller);
    expect(doors.has('fn_cash_cluster_tick_uncapped')).toBe(true);
    expect(doors.has('fn_cash_clusters_tick_all_uncapped')).toBe(true);
  });
});
