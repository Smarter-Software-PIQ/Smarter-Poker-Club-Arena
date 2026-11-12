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
const REDEFINES =
  /(CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.(fn_cash_cluster_tick|fn_cash_clusters_tick_all)\s*\(|pg_get_functiondef\('public\.(fn_cash_cluster_tick|fn_cash_clusters_tick_all))/i;

describe('a later tick fix reaches the tick this engine calls', () => {
  it('every migration after 20261112154904 that redefines a tick also redefines its _uncapped twin', () => {
    const later = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > SINCE)
      .filter((f) => REDEFINES.test(readFileSync(new URL(f, DIR), 'utf8')));
    for (const f of later)
      expect(
        readFileSync(new URL(f, DIR), 'utf8'),
        `${f} must also redefine the _uncapped twin`
      ).toMatch(/p_uncapped\s+boolean/);
  });
  it('the engine names both doors for the release gate, and the gate reads them', async () => {
    const controller = readFileSync(new URL('./ClusterController.ts', import.meta.url), 'utf8');
    const { doorsIn } = await import('../../../scripts/ci/check-engine-doors-exist.mjs');
    const doors = doorsIn(controller);
    expect(doors.has('fn_cash_cluster_tick_uncapped')).toBe(true);
    expect(doors.has('fn_cash_clusters_tick_all_uncapped')).toBe(true);
  });
});
