/**
 * The VPIP sample reads only the sitting (2026-11-11).
 *
 * fn_nit_sample and fn_nit_hands_since run on a generic plan (SQL functions
 * with SET search_path are never inlined). `(p_since IS NULL OR played_at >=
 * p_since)` cannot be an index condition there, so a horse's whole hand
 * history was walked at every hand boundary of a nit_game table: both engine
 * reads hit the 8 s statement timeout and cash hands started ~16.9 s late.
 * The newest definition of each must bound played_at with COALESCE so the
 * generic plan uses (user_id, played_at). Behaviour is proved natively by
 * scripts/ci/test-vpip-sample-sargable.py.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

function newestBody(name: string): string {
  const defines = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const last = migrationCorpus()
    .filter(({ sql }) => defines.test(sql))
    .pop();
  expect(last).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(defines);
  const open = sql.indexOf('$function$', start);
  return sql.slice(start, sql.indexOf('$function$', open + 1));
}

describe('the VPIP sample reads only the sitting', () => {
  it('fn_nit_sample bounds played_at as an index condition', () => {
    const body = newestBody('fn_nit_sample');
    expect(body).toContain("f.played_at >= COALESCE(p_since, '-infinity'::timestamptz)");
    expect(body).not.toMatch(/p_since\s+IS\s+NULL\s+OR/i);
  });

  it('fn_nit_hands_since bounds played_at as an index condition', () => {
    const body = newestBody('fn_nit_hands_since');
    expect(body).toContain("f.played_at > COALESCE(p_since, '-infinity'::timestamptz)");
    expect(body).not.toMatch(/p_since\s+IS\s+NULL\s+OR/i);
  });
});
