/**
 * A BUSTED PLAYER'S STALE TABLE IS NOT BREAK CUSTODY (2026-11-25)
 *
 * A rebuy of a player who busted on a table that was then broken was refused
 * with F06_SOURCE_EXCLUDED for the whole break (2,584 refusals in 24 hours)
 * and lost its decision window: the roster row still named the table the
 * player left, and f06_source_guard read that stale pointer as source custody.
 * Migration 20261125020712 adds one clause to the guard's bound test. The
 * behaviour is proven on native PostgreSQL by
 * scripts/ci/test-a-busted-players-stale-table-is-not-break-custody.py; this
 * pins the shape of the change so a later edit cannot silently widen it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const sql = readFileSync(
  join(
    root,
    'supabase',
    'migrations',
    '20261125020712_a_busted_players_stale_table_is_not_break_custody.sql'
  ),
  'utf8'
);
const code = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const clause = sql.slice(sql.indexOf('$new$'), sql.lastIndexOf('$new$'));

describe("a busted player's stale table is not break custody", () => {
  it('is one transaction with bounded locks and a live proof', () => {
    expect(code.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(code.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(code).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).toMatch(
      /^-- @live-proof: .*4acd120a2a9bcf4535bdd189ef3ae2f9.*A BUSTED PLAYER''S STALE TABLE IS NOT BREAK CUSTODY/m
    );
  });

  it('patches only the pinned live guard, once, onto its reviewed post-image', () => {
    expect(code).toContain("'smarter_private.f06_source_guard()'::regprocedure");
    expect(code).toContain("md5(v_def) <> '0b9d60df00b7fb673767534b59bacf51'");
    expect(code).toContain("md5(v_def) <> '4acd120a2a9bcf4535bdd189ef3ae2f9'");
    expect(code).toMatch(/IF v_n <> 1 THEN/);
    expect(code).toContain('p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config');
    expect(code).not.toMatch(/DROP\s+(FUNCTION|TRIGGER)/i);
  });

  it('exempts only a same-user roster UPDATE whose source holds nothing of that player', () => {
    expect(clause).toContain("AND NOT (TG_TABLE_NAME='tournament_players' AND TG_OP='UPDATE'");
    expect(clause).toContain("o.source_table_id=src AND oldj->>'user_id'=newj->>'user_id'");
    expect(clause).toContain(
      'NOT EXISTS(SELECT 1 FROM public.table_seats s WHERE s.table_id=src AND s.user_id=u AND s.left_at IS NULL)'
    );
    expect(clause).toContain(
      'NOT EXISTS(SELECT 1 FROM smarter_private.f06_members m WHERE m.break_id=o.break_id AND m.user_id=u)'
    );
    expect(clause).toContain(
      'NOT EXISTS(SELECT 1 FROM smarter_private.f06_attempts a WHERE a.break_id=o.break_id AND a.user_id=u)'
    );
    expect(clause).toContain(
      "NOT COALESCE(o.manifest @> jsonb_build_array(jsonb_build_object('user_id',u)),false)"
    );
  });

  it('revives on the source only inside that same player rebuy lane', () => {
    expect(clause).toContain(
      'AND (dst IS DISTINCT FROM src OR smarter_private.tournament_rebuy_lane_held(t,u))'
    );
    expect(clause).not.toContain('tournament_rebuy_lane_held(t,NULL)');
  });

  it('keeps a breaking destination bound: the exemption names the source only', () => {
    expect(clause).not.toMatch(/o\.source_table_id\s*=\s*dst/);
    expect(clause).toContain('o.source_table_id IN(src,dst)');
  });

  it('is proven on native PostgreSQL in a pull request workflow', () => {
    const workflow = readFileSync(
      join(root, '.github', 'workflows', 'f06-stale-roster.yml'),
      'utf8'
    );
    expect(workflow).toContain(
      'scripts/ci/test-a-busted-players-stale-table-is-not-break-custody.py'
    );
    expect(workflow).toContain('PG_BIN: /usr/lib/postgresql/17/bin');
  });
});
