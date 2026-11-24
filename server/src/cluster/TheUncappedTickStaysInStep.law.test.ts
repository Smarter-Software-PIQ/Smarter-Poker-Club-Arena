/**
 * THE UNCAPPED TICK IS THE SOLE CLUSTER TICK (2026-11-12; originals retired
 * 2026-11-23).
 *
 * Migration 20261112154904 added fn_cash_cluster_tick_uncapped and
 * fn_cash_clusters_tick_all_uncapped while leaving the old capped originals in
 * place for rolling engine upgrades. Keeping two near-identical tick copies
 * became a drift trap (PR #11790's first draft edited only the dead original),
 * and fn_lightning_rollout_readiness(uuid) still audited the dead
 * fn_cash_clusters_tick_all(jsonb) instead of the live uncapped pass.
 *
 * Migration 20261123083628 repoints fn_lightning_rollout_readiness(uuid) to
 * fn_cash_clusters_tick_all_uncapped(jsonb) and drops both capped originals.
 * This law pins:
 *   1. Historical period (20261112154904 < file < 20261123083628): every edit
 *      to an original also edited its _uncapped twin.
 *   2. Retirement migration (20261123083628): repoints readiness before
 *      dropping both originals, carries @live-proof and @probe-for.
 *   3. Permanent post-retirement invariant (file > 20261123083628): no later
 *      migration may re-create or patch the retired originals.
 *   4. Engine contract: ClusterController opens only the two _uncapped doors
 *      with no fallback to the retired originals, and the release door gate
 *      reads both uncapped doors and neither original.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const DIR = resolve(ROOT, 'supabase/migrations');
const SINCE = '20261112154904';
const RETIRED = '20261123083628';
const RETIRE_FILE =
  '20261123083628_the_original_cluster_tick_retires_and_readiness_reads_the_un.sql';
const PAIRS = [
  ['fn_cash_cluster_tick', 'fn_cash_cluster_tick_uncapped'],
  ['fn_cash_clusters_tick_all', 'fn_cash_clusters_tick_all_uncapped'],
] as const;

/** Does this SQL redefine `name` itself (not a longer name sharing its prefix)? */
function redefines(sql: string, name: string): boolean {
  return (
    new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'i').test(
      sql
    ) || new RegExp(`'public\\.${name}(\\(|')`, 'i').test(sql)
  );
}

/** The originals this SQL redefines without also redefining their twin. */
function driftIn(sql: string): string[] {
  return PAIRS.filter(([orig, twin]) => redefines(sql, orig) && !redefines(sql, twin)).map(
    ([orig]) => orig
  );
}

/** Any retired original this SQL attempts to re-create or patch. */
function resurrectsIn(sql: string): string[] {
  return PAIRS.filter(([orig]) => redefines(sql, orig)).map(([orig]) => orig);
}

describe('the uncapped tick is the sole cluster tick', () => {
  it('the rule tells a drifting or resurrecting migration from a clean one', () => {
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
    expect(driftIn("SELECT pg_get_functiondef('public.fn_cash_cluster_tick'::regproc);")).toEqual([
      'fn_cash_cluster_tick',
    ]);
    expect(
      driftIn(
        'CREATE FUNCTION public.fn_cash_clusters_tick_all_uncapped(p_eligible jsonb) AS $$ $$;'
      )
    ).toEqual([]);
    expect(
      resurrectsIn(
        'CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid) AS $$ $$;'
      )
    ).toEqual(['fn_cash_cluster_tick']);
    expect(
      resurrectsIn(
        'CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick_uncapped(p_game_id uuid) AS $$ $$;'
      )
    ).toEqual([]);
  });

  it('every migration between 20261112154904 and retirement kept both copies in step', () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > SINCE && f.slice(0, 14) < RETIRED)
      .flatMap((f) => driftIn(readFileSync(resolve(DIR, f), 'utf8')).map((o) => `${f}: ${o}`));
    expect(offenders).toEqual([]);
  });

  it('the retirement migration repoints readiness before dropping both capped originals', async () => {
    const sql = readFileSync(resolve(DIR, RETIRE_FILE), 'utf8');
    const repointPos = sql.indexOf(
      "'public.fn_cash_clusters_tick_all_uncapped(jsonb)'::regprocedure"
    );
    const dropAllPos = sql.indexOf(
      'DROP FUNCTION IF EXISTS public.fn_cash_clusters_tick_all(jsonb);'
    );
    const dropOnePos = sql.indexOf(
      'DROP FUNCTION IF EXISTS public.fn_cash_cluster_tick(uuid, integer);'
    );
    expect(repointPos).toBeGreaterThan(0);
    expect(dropAllPos).toBeGreaterThan(repointPos);
    expect(dropOnePos).toBeGreaterThan(repointPos);
    expect(sql).toContain('-- @probe-for: public.fn_lightning_rollout_readiness');
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    )) as { missingProbes: (sql: string) => string[] };
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no migration after retirement resurrects either capped original', () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > RETIRED)
      .flatMap((f) => resurrectsIn(readFileSync(resolve(DIR, f), 'utf8')).map((o) => `${f}: ${o}`));
    expect(offenders).toEqual([]);
  });

  it('the engine opens only the two uncapped doors with no fallback to the retired originals', async () => {
    const controller = readFileSync(resolve(HERE, 'ClusterController.ts'), 'utf8');
    expect(controller).not.toContain('PGRST202');
    expect(controller).not.toMatch(/'fn_cash_cluster_tick'/);
    expect(controller).not.toMatch(/'fn_cash_clusters_tick_all'/);
    const { doorsIn } = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/check-engine-doors-exist.mjs'))
        .href
    )) as { doorsIn: (src: string) => Set<string> };
    const doors = doorsIn(controller);
    expect(doors.has('fn_cash_cluster_tick_uncapped')).toBe(true);
    expect(doors.has('fn_cash_clusters_tick_all_uncapped')).toBe(true);
    expect(doors.has('fn_cash_cluster_tick')).toBe(false);
    expect(doors.has('fn_cash_clusters_tick_all')).toBe(false);
  });
});
