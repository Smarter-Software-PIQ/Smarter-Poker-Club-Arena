/**
 * LAW: A WAKE ACKNOWLEDGEMENT NEVER HOLDS A WAKE WHILE IT WAITS (2026-11-22).
 *
 * The engine's acknowledgement of a tournament manager's wakes
 * (fn_ack_tournament_manager_wakes) and a bounty rebuy deadlocked twice on
 * 2026-11-22. The ack locks its exact wake ids in id order. A bounty rebuy
 * upserts two pending wake rows in one transaction in code order
 * (bounty_settled, then rebuy), whatever their ids, so it held the higher id
 * and wanted the lower one that the ack held. Migration 20261123025756 orders
 * them with one per-tournament key: every writer of a wake row
 * (fn_emit_tournament_manager_wake, fn_retire_manager_wakes_after_terminal_status)
 * takes it shared before it writes, and an ack of two or more wakes takes it
 * exclusively before it locks any. Proved natively by
 * scripts/dev/prove-a-wake-ack-never-holds-a-wake-while-it-waits.sh, which
 * replays the logged interleaving on production's own text.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123025756_a_wake_ack_never_holds_a_wake_while_it_waits.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const KEY = "hashtextextended('ca:tournament-manager-wakes:v1:'||";
const stripComments = (text: string) => text.replace(/--[^\n]*/g, '');

/** The replacement text ($r$ ... $r$) of the edit block for one function. */
function replacement(signature: string): string {
  const block = sql.indexOf(
    `v_def text := pg_get_functiondef('public.${signature}'::regprocedure);`
  );
  expect(block, `${signature} has an edit block`).toBeGreaterThan(-1);
  const start = sql.indexOf('$r$', block);
  return stripComments(sql.slice(start + 3, sql.indexOf('$r$', start + 3)));
}

describe('every wake writer and the acknowledgement take one tournament key first', () => {
  it('an emitter takes the key shared, after its terminal refusal and before its upsert', () => {
    const body = replacement('fn_emit_tournament_manager_wake(uuid,text)');
    const key = body.indexOf(`pg_advisory_xact_lock_shared(\n    ${KEY}p_tournament_id::text,0));`);
    expect(key).toBeGreaterThan(-1);
    expect(body.indexOf('INSERT INTO public.tournament_manager_wakes')).toBeGreaterThan(key);
    // Inserted just before the upsert, so the terminal RETURN NULL above it
    // still writes nothing and takes nothing.
    expect(sql).toContain(
      '$o$  INSERT INTO public.tournament_manager_wakes AS pending(tournament_id,reason,generation)$o$'
    );
    expect(sql).toContain("<= position('RETURN NULL' IN pg_get_functiondef(");
  });

  it('the terminal retirement takes the same key shared before its update', () => {
    const body = replacement('fn_retire_manager_wakes_after_terminal_status()');
    const key = body.indexOf(`pg_advisory_xact_lock_shared(\n      ${KEY}NEW.id::text,0));`);
    expect(key).toBeGreaterThan(-1);
    expect(body.indexOf('UPDATE public.tournament_manager_wakes')).toBeGreaterThan(key);
  });

  it('an acknowledgement of two or more wakes takes it exclusively before any row lock', () => {
    const body = replacement('fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])');
    const guard = body.indexOf('IF cardinality(v_ids)>1 THEN');
    const key = body.indexOf(
      `PERFORM pg_advisory_xact_lock(\n      ${KEY}p_tournament_id::text,0));`
    );
    const rows = body.indexOf('ORDER BY w.id\n   FOR UPDATE;');
    expect(guard).toBeGreaterThan(-1);
    expect(key).toBeGreaterThan(guard);
    expect(rows).toBeGreaterThan(key);
    expect(body).not.toContain('pg_advisory_xact_lock_shared');
  });

  it('anchors each edit exactly once and refuses a second application', () => {
    for (const fn of [
      'fn_emit_tournament_manager_wake',
      'fn_ack_tournament_manager_wakes',
      'fn_retire_manager_wakes_after_terminal_status',
    ]) {
      expect(sql).toContain(
        `RAISE EXCEPTION '${fn} already takes the wake key: re-read before editing';`
      );
      expect(sql).toMatch(
        new RegExp(`RAISE EXCEPTION '${fn} [a-z ]+ anchor was expected exactly once';`)
      );
    }
    expect(sql.match(/EXECUTE replace\(v_def,v_old,v_new\);/g)).toHaveLength(3);
  });

  it('nothing in the change reads is_horse', () => {
    expect(stripComments(sql)).not.toMatch(/is_horse/);
  });

  it('is one bounded transaction with a probe or a reasoned exemption for each function', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql.match(/^-- @live-proof: \(SELECT /gm)).toHaveLength(3);
    expect(sql).toContain('-- @probe-for: public.fn_emit_tournament_manager_wake\n');
    expect(sql).toContain('-- @probe-for: public.fn_ack_tournament_manager_wakes\n');
    expect(sql).toMatch(
      /^-- @probe-exempt: public\.fn_retire_manager_wakes_after_terminal_status is an AFTER UPDATE OF status trigger/m
    );
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration writes a wake row, or redefines a writer, without the key', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    const writes = /(INSERT INTO|UPDATE|DELETE FROM)\s+public\.tournament_manager_wakes\b/;
    for (const file of later) {
      const code = stripComments(readFileSync(resolve(DIR, file), 'utf8'));
      const heads = [...code.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_]+\.[a-z_]+)\s*\(/gi)];
      heads.forEach((head, i) => {
        const body = code.slice(head.index, heads[i + 1]?.index ?? code.length);
        if (!writes.test(body)) return;
        const mode = /fn_ack_tournament_manager_wakes$/i.test(head[1])
          ? /pg_advisory_xact_lock\(\s*hashtextextended\('ca:tournament-manager-wakes:v1:'/
          : /pg_advisory_xact_lock_shared\(\s*hashtextextended\('ca:tournament-manager-wakes:v1:'/;
        expect(
          body,
          `${file}: ${head[1]} writes a wake row without the tournament wake key`
        ).toMatch(mode);
      });
      if (code.includes('pg_get_functiondef') && /tournament_manager_wake/.test(code)) {
        expect(code, `${file} rewrites a wake writer and strips its key`).not.toMatch(
          /replace\([^;]*'ca:tournament-manager-wakes:v1:/
        );
      }
    }
  });

  it('the native proof replays the logged deadlock and its fix on production text', () => {
    const proof = readFileSync(
      resolve(ROOT, 'scripts/dev/prove-a-wake-ack-never-holds-a-wake-while-it-waits.sh'),
      'utf8'
    );
    expect(proof).toContain(`"\${PSQL[@]}" -f "$MIGRATION"`);
    expect(proof).toContain('grep -q \'DEADLOCK\' <<<"$b1"');
    expect(proof).toContain("grep -q 'rebuy: committed rebuy | ack: committed 0 |");
    expect(proof).toContain('grep -q \'first: committed first | second: committed\' <<<"$a2"');
    for (const fx of [
      'fn_emit_tournament_manager_wake',
      'fn_ack_tournament_manager_wakes',
      'fn_retire_manager_wakes_after_terminal_status',
    ]) {
      expect(
        existsSync(
          resolve(
            ROOT,
            `scripts/dev/fixtures/a-wake-ack-never-holds-a-wake-while-it-waits/${fx}.preimage.sql`
          )
        )
      ).toBe(true);
    }
  });
});
