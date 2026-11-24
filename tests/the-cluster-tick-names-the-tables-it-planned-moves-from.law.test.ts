/**
 * LAW: THE CLUSTER TICK NAMES THE TABLES IT PLANNED MOVES FROM (2026-11-24,
 * incident 1e532243).
 *
 * The must-move tick reported only `{ moves_planned: n }`, so the engine
 * raised the plan signal for the whole game, and the DESTINATION Main (whose
 * own vacancy woke the tick) went round its dealing loop once more after the
 * full rest: about 840 ms of unintended delay, dealing a roster identical to
 * the one it threw away (41 of 61 slow cash transitions in 14 h on production;
 * the delay that refused Backup certification of 19203b9a1f0b).
 *
 * Migration 20261124172239 makes the `moves_planned` action carry
 * `source_table_ids`: a JSON array of uuid strings, one per planned must-move,
 * equal to the inserted rows' from_table_id. The engine reads it under exactly
 * that key on the same action object (tickPlannedSourceTableIds, PR #11926)
 * and signals only those tables.
 *
 * This law pins:
 *   1. the migration is one anchored edit with exact-once anchors, a refusal
 *      of an already-edited body, a byte-for-byte replace-back identity and a
 *      field-by-field authority check, @live-proof and @probe-for;
 *   2. the production pre-image it was authored against (fixture md5 equals
 *      md5(pg_get_functiondef) read from production on 2026-11-24) holds each
 *      anchor exactly once, in the order the array relies on;
 *   3. the emitted shape is the one the engine parses;
 *   4. natively in PostgreSQL (when a local initdb exists): applied to the
 *      exact production pre-image the body changes by those lines only, and
 *      in the behaviour model the key is missing before (the defect) and equal
 *      to the inserted rows after;
 *   5. no later migration that touches the tick drops the key.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIG = '20261124172239_the_cluster_tick_names_the_tables_it_planned_moves_from.sql';
const sql = readFileSync(resolve(DIR, MIG), 'utf8');
const PRE_PATH = resolve(
  ROOT,
  'scripts/ci/fixtures/cluster-tick-source-table-ids/production-preimage.sql'
);
const pre = readFileSync(PRE_PATH, 'utf8');
const PROOF = resolve(ROOT, 'scripts/dev/prove-the-cluster-tick-names-its-plan-sources.sh');

const OLD_DECL = '  v_moves integer := 0;\n';
const OLD_MOVE =
  "      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');\n      v_moves := v_moves + 1;\n";
const OLD_EMIT =
  "IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves); END IF;";
const NEW_EMIT =
  "IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves, 'source_table_ids', to_jsonb(v_move_sources)); END IF;";

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function findPgBin(): string | null {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return null;
  for (const dir of [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/lib/postgresql/15/bin',
  ]) {
    if (existsSync(resolve(dir, 'initdb')) && existsSync(resolve(dir, 'pg_ctl'))) return dir;
  }
  return null;
}

describe('the cluster tick names the tables it planned moves from', () => {
  it('is one anchored edit of the sole cluster tick, guarded on every side', () => {
    expect(sql).toContain(
      "v_oid     oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;"
    );
    expect(sql).toContain(`$o1$${OLD_DECL}$o1$`);
    expect(sql).toContain(`$o2$${OLD_MOVE}$o2$`);
    expect(sql).toContain(`$o3$${OLD_EMIT}$o3$`);
    expect(sql).toContain('      v_move_sources := v_move_sources || r.table_id;\n$r2$');
    expect(sql).toContain("  v_move_sources uuid[] := '{}'::uuid[];\n$r1$");
    expect(sql).toContain(`$r3$${NEW_EMIT}$r3$`);
    expect(sql).toContain('already names its plan sources: re-read before editing');
    expect(sql).toContain('declaration anchor was expected exactly once');
    expect(sql).toContain('must_move increment anchor was expected exactly once');
    expect(sql).toContain('moves_planned emission anchor was expected exactly once');
    expect(sql).toContain(
      'replace(replace(replace(pg_get_functiondef(v_oid), v_new_emit, v_old_emit), v_new_move, v_old_move), v_new_decl, v_old_decl) <> v_before'
    );
    for (const field of [
      'proowner',
      'proacl',
      'proconfig',
      'prosecdef',
      'provolatile',
      'proargtypes',
      'prorettype',
      'proargdefaults',
    ]) {
      expect(sql).toContain(`${field} IS DISTINCT FROM v_catalog.${field}`);
    }
    // No other source line of the tick is written by this file.
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_cluster_tick/i);
    expect(sql).not.toMatch(/'public\.fn_cash_cluster_tick(\(|')/i);
  });

  it('is a bounded single transaction with @live-proof and @probe-for', async () => {
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    )) as { missingProbes: (src: string) => string[] };
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql).toMatch(/^-- @live-proof: .*source_table_ids/m);
    expect(sql).toContain('-- @probe-for: public.fn_cash_cluster_tick_uncapped\n');
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('was authored against the production body, which holds each anchor once and in order', () => {
    expect(createHash('md5').update(pre).digest('hex')).toBe('ff71ce506a92527349e8a6dfeae25c71');
    expect(count(pre, OLD_DECL)).toBe(1);
    expect(count(pre, OLD_MOVE)).toBe(1);
    expect(count(pre, OLD_EMIT)).toBe(1);
    expect(pre.indexOf(OLD_MOVE)).toBeLessThan(pre.indexOf(OLD_EMIT));
    expect(pre).not.toContain('source_table_ids');
    expect(pre).not.toContain('v_move_sources');
    // Every other increment of v_moves comes after the sole emission (balance,
    // break): the tick never reported those, and this file does not start to.
    const incs = [...pre.matchAll(/v_moves := v_moves \+ 1;/g)].map((m) => m.index ?? -1);
    expect(incs).toHaveLength(3);
    expect(incs.filter((i) => i > pre.indexOf(OLD_EMIT))).toHaveLength(2);
  });

  it('emits the key the engine reads: an array of uuid strings on the moves_planned action', () => {
    // tickPlannedSourceTableIds (PR #11926) reads action.source_table_ids on
    // the same object as moves_planned and requires a non-empty string array.
    expect(NEW_EMIT).toContain("jsonb_build_object('moves_planned', v_moves, 'source_table_ids',");
    expect(NEW_EMIT).toContain('to_jsonb(v_move_sources)');
    expect(sql).toContain("v_move_sources uuid[] := '{}'::uuid[];");
  });

  it('proves natively: only these lines change, and the key equals the inserted rows', () => {
    const proof = readFileSync(PROOF, 'utf8');
    expect(proof).toContain(MIG);
    expect(proof).toContain('[[ "$before" == "source_table_ids_missing" ]]');
    expect(proof).toContain('[[ "$after" == "ok:3" ]]');
    expect(proof).toContain('[[ "$removed" == "1" && "$added" == "3" ]]');
    const pgBin = findPgBin();
    if (pgBin) {
      const out = execFileSync('bash', [PROOF], {
        cwd: ROOT,
        env: { ...process.env, PG_BIN: pgBin },
        encoding: 'utf8',
      });
      expect(out).toContain('exact_production_preimage_only_this_change=ok');
      expect(out).toContain('contract_before=source_table_ids_missing');
      expect(out).toContain('contract_after=ok:3');
      expect(out).toContain('source_table_ids_match_inserted_rows=ok');
      expect(out).toContain('PROOF OK');
    }
  }, 60_000);

  it('no later migration that touches the tick drops the key', () => {
    for (const file of readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIG)) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_cash_cluster_tick_uncapped\s*\(/i.test(
          source
        )
      ) {
        expect(source, `${file} redefines the tick without source_table_ids`).toContain(
          "'source_table_ids'"
        );
      }
      expect(source, `${file} edits the plan-source report away`).not.toContain(`$r3$${OLD_EMIT}`);
    }
  });
});
