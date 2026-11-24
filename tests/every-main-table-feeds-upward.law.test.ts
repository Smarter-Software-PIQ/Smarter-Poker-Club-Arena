/**
 * LAW: EVERY MAIN TABLE FEEDS UPWARD FROM HIGHER MAINS AND FEEDERS (2026-11-23).
 *
 * Dan, 2026-11-23: "GAMES ALL FEED UPWARDS. TABLE 1 MAIN GAME ALWAYS FULL,
 * TABLE 2 2ND GAME, ALWAYS FULL, THEN SO ON AND SO ON. TABLE 4 FEEDS 3,2,1 IN
 * THAT ORDER." / "THIS NEEDS TO BE LIKE THIS FOR EVERY FEEDER GAME ON THE
 * PLATFORM. MAKE THIS CORRECTION GLOBALLY FOR ALL FEEDER GAMES"
 *
 * Step 2 (MUST-MOVE) of public.fn_cash_cluster_tick_uncapped(uuid,integer)
 * previously only allowed Main 1 (t.main_index = 1) to draw from other Main
 * tables, restricting Main 2..N to the Feeder and breaking tables. When Main 1
 * drained Main 2 and a 9-max Feeder sat below the 7-player gate (e.g. 6/9),
 * Main 2 sat short-handed (5/9) while Main 3 stayed full (9/9).
 *
 * Migration 20261124003437 widens Step 2's source-table filter so every Main N
 * draws from higher-numbered Mains (c.role = 'main' AND c.main_index > t.main_index),
 * the Feeder and any breaking table — never downward from a lower Main.
 * Native behaviour is proved by scripts/dev/prove-every-main-table-feeds-upward.sh.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');

describe('every main table feeds upward from higher mains and feeders', () => {
  it('widens Step 2 of fn_cash_cluster_tick_uncapped to draw from higher-numbered Mains', () => {
    expect(sql).toContain(
      "v_oid     oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;"
    );
    expect(sql).toContain(
      "$o$         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))\n         AND c.id <> t.id$o$"
    );
    expect(sql).toContain(
      "AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id) OR (c.role = 'main' AND c.main_index > t.main_index))"
    );
    expect(sql).toContain('Step 2 source-table anchor was expected exactly once');
    expect(sql).toContain('replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before');
    expect(sql).toContain('proacl IS DISTINCT FROM v_catalog.proacl');
  });

  it('is one bounded transaction with @live-proof and @probe-for, never touching the retired original tick', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql).toContain('-- @probe-for: public.fn_cash_cluster_tick_uncapped\n');
    expect(sql).toContain(
      "-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE"
    );
    expect(sql).not.toMatch(/'public\.fn_cash_cluster_tick(\(|')/i);
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    )) as { missingProbes: (src: string) => string[] };
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration re-restricts cross-Main must-move solely to Main 1', () => {
    const OLD_MAIN1_ONLY =
      /AND \(c\.role = 'feeder' OR c\.breaking OR \(t\.main_index = 1 AND c\.id <> t\.id\)\)\s*\n\s*AND c\.id <> t\.id/;
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (!/fn_cash_cluster_tick_uncapped/.test(source)) continue;
      expect(source, `${file} re-restricts cross-Main feeding solely to Main 1`).not.toMatch(
        OLD_MAIN1_ONLY
      );
    }
  });

  it('the native proof script covers the 9-max screenshot repro, upward cascade, no downward pull, and 6-max', () => {
    const proof = readFileSync(
      resolve(ROOT, 'scripts/dev/prove-every-main-table-feeds-upward.sh'),
      'utf8'
    );
    expect(proof).toContain('[[ "$before_moves" == "0" ]]');
    expect(proof).toContain('[[ "$after_summary" == "4|4|0" ]]');
    expect(proof).toContain('no_downward_pull=ok');
    expect(proof).toContain('six_max_cascade=ok');
    expect(proof).toContain('migration_applied_and_proved=ok');
  });
});
