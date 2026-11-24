/**
 * LAW: EVERY MAIN TABLE FEEDS UPWARD FROM HIGHER MAINS AND FEEDERS, AND NO
 * DOOR MAY BYPASS THE LADDER (2026-11-23 / 2026-11-24).
 *
 * Dan, 2026-11-23: "GAMES ALL FEED UPWARDS. TABLE 1 MAIN GAME ALWAYS FULL,
 * TABLE 2 2ND GAME, ALWAYS FULL, THEN SO ON AND SO ON. TABLE 4 FEEDS 3,2,1 IN
 * THAT ORDER." / "THIS NEEDS TO BE LIKE THIS FOR EVERY FEEDER GAME ON THE
 * PLATFORM. MAKE THIS CORRECTION GLOBALLY FOR ALL FEEDER GAMES"
 *
 * Three migrations enforce this invariant globally across 6-max and 9-max:
 *   1. 20261124003437: Step 2 of fn_cash_cluster_tick_uncapped draws upward
 *      from higher-numbered Mains (c.role = 'main' AND c.main_index > t.main_index),
 *      the Feeder and any breaking table - never downward from a lower Main.
 *   2. 20261124051600: fn_cash_main_chair_is_the_lists drops the full-ring-only
 *      handedness exemption so 6-max and 9-max alike reserve open Main chairs;
 *      fn_cash_seat_change_plan forbids upward open-chair seat changes into any Main.
 *   3. 20261124075000:
 *      - Fix 1 (fn_cash_main_chair_is_the_lists): reserves open Main chairs only
 *        when a higher live Main exists, a live feeder exists, or an opening
 *        feeder already has seated players or pending inbound moves (closing
 *        0-seat opening-feeder starvation, 1-player stranding, and closed-feeder gaps).
 *      - Fix 2 (fn_cash_cluster_tick_uncapped Step 5 BREAK): fills breaking tables
 *        upward (Main 1 -> Main 2 -> Main 3 -> Feeder, fullest tie-break).
 *      - Fix 3 (fn_cash_cluster_tick_uncapped Step 2 MUST-MOVE): replaces SQL
 *        LIMIT GREATEST(v_n, 0) with explicit v_planned_for_t counter incremented
 *        after the per-row 9-max Feeder gate recheck so skipped Feeder rows never
 *        truncate eligible higher-Main candidates.
 *      - Fix 4 (fn_cash_seat_change_plan): makes the upward-Main open-chair guard
 *        fail-closed (EXISTS src with src.main_index < c.main_index and non-NULL
 *        indices) so missing source rows or NULL main_index never fail open.
 *
 * Native PostgreSQL behaviour across all three migrations is proved by
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
const MIG_HARDEN2 = '20261124075000_harden_must_move_opening_feeder_break_and_gate.sql';
const cascadeSql = readFileSync(resolve(DIR, MIG_CASCADE), 'utf8');
const hardenSql = readFileSync(resolve(DIR, MIG_HARDEN), 'utf8');
const harden2Sql = readFileSync(resolve(DIR, MIG_HARDEN2), 'utf8');

function findPgBin(): string | null {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return null;
  const candidates = [
    ...(process.env.PG_BIN ? [process.env.PG_BIN] : []),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/opt/postgresql@16/bin',
    '/opt/homebrew/opt/postgresql@15/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/lib/postgresql/15/bin',
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'initdb')) && existsSync(resolve(dir, 'pg_ctl'))) {
      return dir;
    }
  }
  return null;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ');
const stripLineComments = (s: string) => s.replace(/--[^\n]*/g, '');
const stripReadOnlyChecks = (s: string) =>
  stripLineComments(s)
    .replace(/position\s*\([^;]*?\bIN\b[^)]*\)/gi, '')
    .replace(/\bLIKE\s+'[^']*'/gi, '');

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function redefinesCreateOrReplace(source: string, fnName: string): boolean {
  return new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fnName}\\s*\\(`,
    'i'
  ).test(source);
}

function editsByAnchoredDef(source: string, fnName: string): boolean {
  const code = stripLineComments(source);
  if (!/\bEXECUTE\b/i.test(code)) return false;
  return new RegExp(
    `(?:pg_get_functiondef\\s*\\([^)]*${fnName}|'public\\.${fnName}(?:\\(|'))`,
    'i'
  ).test(code);
}

/**
 * Inspects a single migration file (assumed later than MIG_HARDEN2) for
 * regressions across all three upward-ladder functions, catching BOTH full
 * CREATE OR REPLACE redefinitions AND anchored pg_get_functiondef edits.
 */
function findLadderRegressions(file: string, source: string): string[] {
  const problems: string[] = [];
  const flat = normalize(source);
  const flatEditable = normalize(stripReadOnlyChecks(source));

  // 1. fn_cash_cluster_tick_uncapped
  if (redefinesCreateOrReplace(source, 'fn_cash_cluster_tick_uncapped')) {
    if (!flat.includes('c.main_index > t.main_index')) {
      problems.push(
        `${file} redefines fn_cash_cluster_tick_uncapped without upward cross-Main cascade (c.main_index > t.main_index)`
      );
    }
    if (
      !flat.includes(
        "ORDER BY (c.role = 'feeder') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;"
      )
    ) {
      problems.push(
        `${file} redefines fn_cash_cluster_tick_uncapped without upward Step 5 BREAK destination order`
      );
    }
    if (!flat.includes('v_planned_for_t') || flat.includes('LIMIT GREATEST(v_n, 0)')) {
      problems.push(
        `${file} redefines fn_cash_cluster_tick_uncapped without Step 2 v_planned_for_t counter or reintroduces LIMIT GREATEST(v_n, 0)`
      );
    }
  } else if (editsByAnchoredDef(source, 'fn_cash_cluster_tick_uncapped')) {
    if (
      /AND \(c\.role = 'feeder' OR c\.breaking OR \(t\.main_index = 1 AND c\.id <> t\.id\)\) AND c\.id <> t\.id/.test(
        flatEditable
      )
    ) {
      problems.push(
        `${file} anchored-edits fn_cash_cluster_tick_uncapped to re-restrict cross-Main feeding solely to Main 1`
      );
    }
    if (flatEditable.includes('ORDER BY c.seated ASC, c.main_index ASC NULLS LAST LIMIT 1;')) {
      problems.push(
        `${file} anchored-edits fn_cash_cluster_tick_uncapped to restore c.seated ASC Step 5 BREAK ordering`
      );
    }
    if (flatEditable.includes('LIMIT GREATEST(v_n, 0)')) {
      problems.push(
        `${file} anchored-edits fn_cash_cluster_tick_uncapped to restore SQL LIMIT GREATEST(v_n, 0)`
      );
    }
    for (const invariant of [
      'c.main_index > t.main_index',
      "ORDER BY (c.role = 'feeder') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;",
      'EXIT WHEN v_planned_for_t >= GREATEST(v_n, 0);',
    ]) {
      if (countOccurrences(flatEditable, invariant) === 1) {
        problems.push(
          `${file} anchored-edits fn_cash_cluster_tick_uncapped and drops "${invariant}" without preserving it`
        );
      }
    }
  }

  // 2. fn_cash_main_chair_is_the_lists
  if (redefinesCreateOrReplace(source, 'fn_cash_main_chair_is_the_lists')) {
    if (/handedness/i.test(flat)) {
      problems.push(
        `${file} re-introduces a handedness exemption into fn_cash_main_chair_is_the_lists`
      );
    }
    if (!flat.includes('hm.main_index > mt.main_index')) {
      problems.push(
        `${file} redefines fn_cash_main_chair_is_the_lists without higher live Main reservation (hm.main_index > mt.main_index)`
      );
    }
    if (
      !flat.includes('ts.table_id = ft.id AND ts.left_at IS NULL') ||
      !flat.includes("m.to_table_id = ft.id AND m.state = 'pending'")
    ) {
      problems.push(
        `${file} redefines fn_cash_main_chair_is_the_lists without populated/pending opening-feeder guard`
      );
    }
  } else if (editsByAnchoredDef(source, 'fn_cash_main_chair_is_the_lists')) {
    if (/handedness/i.test(flatEditable)) {
      problems.push(
        `${file} anchored-edits fn_cash_main_chair_is_the_lists to re-introduce handedness exemption`
      );
    }
    if (/ft\.lifecycle\s+IN\s*\(\s*'live'\s*,\s*'opening'\s*\)/i.test(flatEditable)) {
      problems.push(
        `${file} anchored-edits fn_cash_main_chair_is_the_lists to restore unguarded opening-feeder reservation`
      );
    }
    for (const invariant of [
      'hm.main_index > mt.main_index',
      "m.to_table_id = ft.id AND m.state = 'pending'",
    ]) {
      if (countOccurrences(flatEditable, invariant) === 1) {
        problems.push(
          `${file} anchored-edits fn_cash_main_chair_is_the_lists and drops "${invariant}" without preserving it`
        );
      }
    }
  }

  // 3. fn_cash_seat_change_plan
  if (redefinesCreateOrReplace(source, 'fn_cash_seat_change_plan')) {
    if (
      !flat.includes('src.main_index < c.main_index') ||
      !flat.includes('src.main_index IS NOT NULL') ||
      !flat.includes('c.main_index IS NOT NULL')
    ) {
      problems.push(
        `${file} redefines fn_cash_seat_change_plan without fail-closed upward-Main guard (src.main_index < c.main_index)`
      );
    }
    if (flat.includes('src.main_index > c.main_index')) {
      problems.push(
        `${file} redefines fn_cash_seat_change_plan with fail-open src.main_index > c.main_index guard`
      );
    }
  } else if (editsByAnchoredDef(source, 'fn_cash_seat_change_plan')) {
    if (flatEditable.includes('src.main_index > c.main_index')) {
      problems.push(
        `${file} anchored-edits fn_cash_seat_change_plan to restore fail-open src.main_index > c.main_index`
      );
    }
    for (const invariant of [
      'src.main_index < c.main_index',
      'src.main_index IS NOT NULL',
      'c.main_index IS NOT NULL',
    ]) {
      if (countOccurrences(flatEditable, invariant) === 1) {
        problems.push(
          `${file} anchored-edits fn_cash_seat_change_plan and drops "${invariant}" without preserving it`
        );
      }
    }
  }

  return problems;
}

describe('every main table feeds upward from higher mains and feeders', () => {
  it('widens Step 2 of fn_cash_cluster_tick_uncapped to draw from higher-numbered Mains (20261124003437)', () => {
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

  it('hardens fn_cash_main_chair_is_the_lists for all feeder games and blocks upward Main open-chair seat changes (20261124051600)', () => {
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

  it('pins all four permanent SQL hardening fixes in 20261124075000', () => {
    // Fix 1: fn_cash_main_chair_is_the_lists higher live Main or live/populated/pending opening feeder
    expect(harden2Sql).toContain(
      "v_oid     oid := 'public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure;"
    );
    expect(harden2Sql).toContain('HIGHER LIVE MAIN OR POPULATED/LIVE FEEDER');
    expect(harden2Sql).toContain('hm.main_index > mt.main_index');
    expect(harden2Sql).toContain('ts.table_id = ft.id AND ts.left_at IS NULL');
    expect(harden2Sql).toContain("m.to_table_id = ft.id AND m.state = 'pending'");

    // Fix 2 & Fix 3: fn_cash_cluster_tick_uncapped Step 5 BREAK order + Step 2 v_planned_for_t counter
    expect(harden2Sql).toContain(
      "v_oid       oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;"
    );
    expect(harden2Sql).toContain('BREAK FILLS UPWARD');
    expect(harden2Sql).toContain(
      "ORDER BY (c.role = 'feeder') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;"
    );
    expect(harden2Sql).toContain('v_planned_for_t integer := 0;');
    expect(harden2Sql).toContain('v_planned_for_t := 0;');
    expect(harden2Sql).toContain('EXIT WHEN v_planned_for_t >= GREATEST(v_n, 0);');
    expect(harden2Sql).toContain('v_planned_for_t := v_planned_for_t + 1;');

    // Fix 4: fn_cash_seat_change_plan fail-closed upward-Main guard
    expect(harden2Sql).toContain(
      "v_oid     oid := 'public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure;"
    );
    expect(harden2Sql).toContain('FAIL-CLOSED UPWARD-MAIN GUARD');
    expect(harden2Sql).toContain('src.main_index IS NOT NULL');
    expect(harden2Sql).toContain('c.main_index IS NOT NULL');
    expect(harden2Sql).toContain('src.main_index < c.main_index');

    // Authority, reversibility, zero is_horse, and $verify_*$ before @probe-for
    expect(harden2Sql).toContain('proacl IS DISTINCT FROM v_catalog.proacl');
    expect(harden2Sql).toContain('proowner IS DISTINCT FROM v_catalog.proowner');
    expect(harden2Sql).not.toMatch(/is_horse/i);
    expect(harden2Sql.indexOf('DO $verify_main_chair$')).toBeLessThan(
      harden2Sql.indexOf('-- @probe-for: public.fn_cash_main_chair_is_the_lists')
    );
    expect(harden2Sql.indexOf('DO $verify_tick$')).toBeLessThan(
      harden2Sql.indexOf('-- @probe-for: public.fn_cash_cluster_tick_uncapped')
    );
    expect(harden2Sql.indexOf('DO $verify_seat_change$')).toBeLessThan(
      harden2Sql.indexOf('-- @probe-for: public.fn_cash_seat_change_plan')
    );
  });

  it('all three migrations are bounded single transactions with @live-proof and @probe-for, never resurrecting the retired original tick', async () => {
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    )) as { missingProbes: (src: string) => string[] };

    for (const [name, sql] of [
      [MIG_CASCADE, cascadeSql],
      [MIG_HARDEN, hardenSql],
      [MIG_HARDEN2, harden2Sql],
    ] as const) {
      expect(sql.match(/^BEGIN;$/gm), name).toHaveLength(1);
      expect(sql.match(/^COMMIT;$/gm), name).toHaveLength(1);
      expect(sql, name).toContain("SET LOCAL lock_timeout = '3s';");
      expect(sql, name).toContain("SET LOCAL statement_timeout = '30s';");
      expect(sql, name).not.toMatch(/@install-window/);
      expect(sql, name).toContain('-- @live-proof:');
      expect(sql, name).not.toMatch(/'public\.fn_cash_cluster_tick(\(|')/i);
      expect(mod.missingProbes(sql), name).toEqual([]);
    }
    expect(cascadeSql).toContain('-- @probe-for: public.fn_cash_cluster_tick_uncapped\n');
    expect(hardenSql).toContain('-- @probe-for: public.fn_cash_main_chair_is_the_lists\n');
    expect(hardenSql).toContain('-- @probe-for: public.fn_cash_seat_change_plan\n');
    expect(harden2Sql).toContain('-- @probe-for: public.fn_cash_main_chair_is_the_lists\n');
    expect(harden2Sql).toContain('-- @probe-for: public.fn_cash_cluster_tick_uncapped\n');
    expect(harden2Sql).toContain('-- @probe-for: public.fn_cash_seat_change_plan\n');
  });

  it('regression detector catches both CREATE OR REPLACE and anchored pg_get_functiondef regressions', () => {
    // Anchored edit restoring handedness on fn_cash_main_chair_is_the_lists
    expect(
      findLadderRegressions(
        'fake_handedness.sql',
        `DO $$ DECLARE s text := pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure);
         BEGIN s := replace(s, 'AND cg.must_move', 'AND coalesce(cg.handedness, 9) >= 7 AND cg.must_move'); EXECUTE s; END $$;`
      ).length
    ).toBeGreaterThan(0);

    // Anchored edit deleting fail-closed guard on fn_cash_seat_change_plan
    expect(
      findLadderRegressions(
        'fake_sc_drop.sql',
        `DO $$ DECLARE s text := pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure);
         BEGIN s := replace(s, 'AND src.main_index < c.main_index', ''); EXECUTE s; END $$;`
      ).length
    ).toBeGreaterThan(0);

    // Anchored edit restoring Step 5 BREAK c.seated ASC on fn_cash_cluster_tick_uncapped
    expect(
      findLadderRegressions(
        'fake_break_revert.sql',
        `DO $$ DECLARE s text := pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure);
         BEGIN s := replace(s, 'ORDER BY (c.role = ''feeder'') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;', 'ORDER BY c.seated ASC, c.main_index ASC NULLS LAST LIMIT 1;'); EXECUTE s; END $$;`
      ).length
    ).toBeGreaterThan(0);

    // Legitimate unrelated anchored edit on fn_cash_cluster_tick_uncapped passes cleanly
    expect(
      findLadderRegressions(
        'legit_unrelated.sql',
        `DO $$ DECLARE s text := pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure);
         BEGIN s := replace(s, 'v_buyers >= 2', 'v_buyers >= 3'); EXECUTE s; END $$;`
      )
    ).toEqual([]);
  });

  it('no later migration regresses any of the three upward-ladder functions (CREATE OR REPLACE or anchored edit)', () => {
    const laterAfterHarden2 = readdirSync(DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIG_HARDEN2)
      .sort();

    const problems = laterAfterHarden2.flatMap((file) =>
      findLadderRegressions(file, readFileSync(resolve(DIR, file), 'utf8'))
    );
    expect(problems).toEqual([]);
  });

  it('the native proof script exercises all three migrations and all hardened doors in real PostgreSQL', () => {
    const proofPath = resolve(ROOT, 'scripts/dev/prove-every-main-table-feeds-upward.sh');
    const proof = readFileSync(proofPath, 'utf8');
    expect(proof).toContain('[[ "$before_moves" == "0" ]]');
    expect(proof).toContain('[[ "$after_summary" == "4|4|0" ]]');
    expect(proof).toContain('five_table_cascade=ok');
    expect(proof).toContain('no_downward_pull=ok');
    expect(proof).toContain('six_max_cascade=ok');
    expect(proof).toContain('six_max_main_chair_reserved=ok');
    expect(proof).toContain('seat_change_upward_blocked=ok');
    expect(proof).toContain('migration_applied_and_proved=ok');
    expect(proof).toContain('migration_20261124075000_applied_and_proved=ok');
    expect(proof).toContain('opening_feeder_and_higher_main_reserved=ok');
    expect(proof).toContain('step5_break_fills_upward=ok');
    expect(proof).toContain('step2_gated_feeder_no_truncation=ok');
    expect(proof).toContain('seat_change_fail_closed=ok');
    expect(proof).toContain('resolved_at_backoff=ok');

    const pgBin = findPgBin();
    if (pgBin) {
      const out = execFileSync('bash', [proofPath], {
        cwd: ROOT,
        env: { ...process.env, PG_BIN: pgBin },
        encoding: 'utf8',
      });
      expect(out).toContain('migration_applied_and_proved=ok');
      expect(out).toContain('five_table_cascade=ok');
      expect(out).toContain('no_downward_pull=ok');
      expect(out).toContain('six_max_cascade=ok');
      expect(out).toContain('six_max_main_chair_reserved=ok');
      expect(out).toContain('seat_change_upward_blocked=ok');
      expect(out).toContain('migration_20261124075000_applied_and_proved=ok');
      expect(out).toContain('opening_feeder_and_higher_main_reserved=ok');
      expect(out).toContain('step5_break_fills_upward=ok');
      expect(out).toContain('step2_gated_feeder_no_truncation=ok');
      expect(out).toContain('seat_change_fail_closed=ok');
      expect(out).toContain('resolved_at_backoff=ok');
      expect(out).toContain('PROOF OK');
    }
  }, 30_000);
});
