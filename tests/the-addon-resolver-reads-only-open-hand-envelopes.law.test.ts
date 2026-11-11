/**
 * The add-on resolver reads only open hand envelopes (2026-11-11).
 *
 * fn_ca_resolve_unbound_pending_addons excluded add-ons frozen in an accepted
 * hand's envelope with a NOT EXISTS restricted only by table_id, so it
 * detoasted the payload of every commit the table ever had. On a table with
 * 160,470 commits each call exceeded the 8 s statement timeout and the engine
 * killed the table in a loop. Because post_commit_completed_at is written only
 * by the processor that resolves every frozen id in the same transaction, an
 * unresolved add-on can be frozen only in an open envelope; the newest
 * definition must say so, which lets the partial pending-commit index answer
 * it. Behaviour and old/new equivalence are proved natively by
 * scripts/ci/test-addon-resolver-bound.py.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

const DEFINES =
  /create\s+or\s+replace\s+function\s+public\.fn_ca_resolve_unbound_pending_addons\s*\(/i;

function newestBody(): string {
  const last = migrationCorpus()
    .filter(({ sql }) => DEFINES.test(sql))
    .pop();
  expect(last).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(DEFINES);
  const open = sql.indexOf('$function$', start);
  return sql.slice(start, sql.indexOf('$function$', open + 1));
}

describe('the add-on resolver reads only open hand envelopes', () => {
  it('bounds the frozen-envelope check to commits whose post-commit is still open', () => {
    expect(newestBody()).toContain(
      'WHERE c.table_id = p_table_id\n            AND c.post_commit_payload IS NOT NULL\n            AND c.post_commit_completed_at IS NULL\n'
    );
  });

  it('keeps the eligible rows, their order and the per-table mutex', () => {
    const body = newestBody();
    expect(body).toContain('AND a.resolved_at IS NULL');
    expect(body).toContain('ORDER BY a.created_at, a.id');
    expect(body).toContain("hashtextextended('hand-post-commit:' || p_table_id::text, 0)");
    expect(body).toContain('FROM public.resolve_pending_addon(v_addon.id, p_max_buy_in)');
  });
});
