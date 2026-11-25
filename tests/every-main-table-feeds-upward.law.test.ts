/**
 * LAW: EVERY MAIN TABLE FEEDS UPWARD FROM HIGHER MAINS AND FEEDERS, AND NO
 * DOOR MAY BYPASS THE LADDER (2026-11-23 / 2026-11-24).
 *
 * Dan, 2026-11-23: "GAMES ALL FEED UPWARDS. TABLE 1 MAIN GAME ALWAYS FULL,
 * TABLE 2 2ND GAME, ALWAYS FULL, THEN SO ON AND SO ON. TABLE 4 FEEDS 3,2,1 IN
 * THAT ORDER." / "THIS NEEDS TO BE LIKE THIS FOR EVERY FEEDER GAME ON THE
 * PLATFORM. MAKE THIS CORRECTION GLOBALLY FOR ALL FEEDER GAMES"
 *
 * Three doors enforce this invariant globally across 6-max and 9-max:
 *   1. fn_cash_cluster_tick_uncapped (20261124003437): Step 2 draws upward from
 *      higher-numbered Mains (c.role = 'main' AND c.main_index > t.main_index),
 *      the Feeder and any breaking table - never downward from a lower Main.
 *   2. fn_cash_main_chair_is_the_lists (20261124051600): reserves open chairs
 *      on every Main for the must-move list while any live/opening feeder
 *      exists across ALL feeder games (6-max and full-ring alike).
 *   3. fn_cash_seat_change_plan (20261124051600): forbids open-chair seat
 *      changes upward into any Main from a Feeder or higher-numbered Main,
 *      while preserving downward/lateral moves and two-way swaps.
 *
 * Native PostgreSQL behaviour across all three doors is proved by
 * scripts/dev/prove-every-main-table-feeds-upward.sh (executed below whenever
 * a non-root local initdb binary is available).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIG_CASCADE =
  '20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql';
const MIG_HARDEN = '20261124051600_harden_must_move_upward_ladder_all_doors.sql';
const cascadeSql = readFileSync(resolve(DIR, MIG_CASCADE), 'utf8');
const hardenSql = readFileSync(resolve(DIR, MIG_HARDEN), 'utf8');

function findPgBin(): string | null {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return null;
  for (const dir of [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/lib/postgresql/15/bin',
  ]) {
    if (existsSync(resolve(dir, 'initdb')) && existsSync(resolve(dir, 'pg_ctl'))) {
      return dir;
    }
  }
  return null;
}

describe('every main table feeds upward from higher mains and feeders', () => {
  it('widens Step 2 of fn_cash_cluster_tick_uncapped to draw from higher-numbered Mains', () => {
    expect(cascadeSql).toContain(
      "v_oid     oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;"
    );
    expect(cascadeSql).toContain(
      "$o$         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))\n         AND c.id <> t.id$o$"
    );
    expect(cascadeSql).toContain(
      "AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id) OR (c.role = 'main' AND c.main_index > t.main_index))"
    );
    expect(cascadeSql).toContain('Step 2 source-table anchor was expected exactly once');
    expect(cascadeSql).toContain('replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before');
    expect(cascadeSql).toContain('proacl IS DISTINCT FROM v_catalog.proacl');
  });

  it('hardens fn_cash_main_chair_is_the_lists for all feeder games and blocks upward Main open-chair seat changes', () => {
    expect(hardenSql).toContain(
      "v_oid     oid := 'public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure;"
    );
    expect(hardenSql).toContain('ALL FEEDER GAMES');
    expect(hardenSql).toContain('handedness anchor was expected exactly once');
    expect(hardenSql).toContain(
      "v_oid     oid := 'public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure;"
    );
    expect(hardenSql).toContain('NEVER SEAT-CHANGE UPWARD INTO A MAIN');
    expect(hardenSql).toContain(
      "AND (src.role = 'feeder' OR (src.role = 'main' AND src.main_index > c.main_index))"
    );
    expect(hardenSql).toContain('proacl IS DISTINCT FROM v_catalog.proacl');
  });

  it('both migrations are bounded single transactions with @live-proof and @probe-for, never resurrecting the retired original tick', async () => {
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    )) as { missingProbes: (src: string) => string[] };

    for (const [name, sql] of [
      [MIG_CASCADE, cascadeSql],
      [MIG_HARDEN, hardenSql],
    ] as const) {
      expect(sql.match(/^BEGIN;$/gm), name).toHaveLength(1);
      expect(sql.match(/^COMMIT;$/gm), name).toHaveLength(1);
      expect(sql, name).toContain("SET LOCAL lock_timeout = '3s';");
      expect(sql, name).not.toMatch(/@install-window/);
      expect(sql, name).toContain('-- @live-proof:');
      expect(sql, name).not.toMatch(/'public\.fn_cash_cluster_tick(\(|')/i);
      expect(mod.missingProbes(sql), name).toEqual([]);
    }
    expect(cascadeSql).toContain('-- @probe-for: public.fn_cash_cluster_tick_uncapped\n');
    expect(hardenSql).toContain('-- @probe-for: public.fn_cash_main_chair_is_the_lists\n');
    expect(hardenSql).toContain('-- @probe-for: public.fn_cash_seat_change_plan\n');
  });

  it('no later migration regresses any of the three upward-ladder doors', () => {
    const normalize = (s: string) => s.replace(/\s+/g, ' ');
    const laterAfterCascade = readdirSync(DIR).filter(
      (f) => /^\d{14}_.*\.sql$/.test(f) && f > MIG_CASCADE
    );
    for (const file of laterAfterCascade) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      const flat = normalize(source);
      if (
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_cluster_tick_uncapped\s*\(/i.test(
          source
        )
      ) {
        expect(
          flat,
          `${file} redefines fn_cash_cluster_tick_uncapped without upward cross-Main cascade (c.main_index > t.main_index)`
        ).toContain('c.main_index > t.main_index');
      }
      if (/fn_cash_cluster_tick_uncapped/.test(source)) {
        expect(flat, `${file} re-restricts cross-Main feeding solely to Main 1`).not.toMatch(
          /AND \(c\.role = 'feeder' OR c\.breaking OR \(t\.main_index = 1 AND c\.id <> t\.id\)\) AND c\.id <> t\.id/
        );
      }
    }

    const laterAfterHarden = readdirSync(DIR).filter(
      (f) => /^\d{14}_.*\.sql$/.test(f) && f > MIG_HARDEN
    );
    for (const file of laterAfterHarden) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      const flat = normalize(source);
      if (
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_main_chair_is_the_lists\s*\(/i.test(
          source
        )
      ) {
        expect(
          flat,
          `${file} re-introduces a handedness exemption into fn_cash_main_chair_is_the_lists`
        ).not.toMatch(/handedness/i);
      }
      if (
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_seat_change_plan\s*\(/i.test(
          source
        )
      ) {
        expect(
          flat,
          `${file} drops the upward-Main open-chair guard from fn_cash_seat_change_plan`
        ).toContain('src.main_index > c.main_index');
      }
    }
  });

  it('the native proof script exercises all three hardened doors in real PostgreSQL', () => {
    const proofPath = resolve(ROOT, 'scripts/dev/prove-every-main-table-feeds-upward.sh');
    const proof = readFileSync(proofPath, 'utf8');
    expect(proof).toContain('[[ "$before_moves" == "0" ]]');
    expect(proof).toContain('[[ "$after_summary" == "4|4|0" ]]');
    expect(proof).toContain('no_downward_pull=ok');
    expect(proof).toContain('six_max_cascade=ok');
    expect(proof).toContain('six_max_main_chair_reserved=ok');
    expect(proof).toContain('seat_change_upward_blocked=ok');
    expect(proof).toContain('migration_applied_and_proved=ok');

    const pgBin = findPgBin();
    if (pgBin) {
      const out = execFileSync('bash', [proofPath], {
        cwd: ROOT,
        env: { ...process.env, PG_BIN: pgBin },
        encoding: 'utf8',
      });
      expect(out).toContain('migration_applied_and_proved=ok');
      expect(out).toContain('no_downward_pull=ok');
      expect(out).toContain('six_max_cascade=ok');
      expect(out).toContain('six_max_main_chair_reserved=ok');
      expect(out).toContain('seat_change_upward_blocked=ok');
      expect(out).toContain('PROOF OK');
    }
  }, 30_000);
});
