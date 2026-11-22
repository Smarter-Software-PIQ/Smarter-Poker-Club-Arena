/**
 * GUARANTEE HOUSE SUPPLEMENTS START FROM ADJUSTMENTS (2026-11-22).
 *
 * ca-free-buy-funding-watch-15m timed out 12 times in 24 h (55-60 s per run)
 * because public.ca_manual_adjustments had no index on tournament_id and
 * fn_ca_guarantee_funding called fn_ca_guarantee_house_supplements twice per
 * tournament (856 calls x 53.4 ms scanning chip_ledger = ~45.7 s).
 *
 * The newest definitions must:
 *   1. Keep the partial CONCURRENTLY index on ca_manual_adjustments(tournament_id)
 *      for settled player_wallet rows (built before BEGIN; with zero write lock).
 *   2. Anchor fn_ca_guarantee_house_supplements(uuid) on ca_manual_adjustments
 *      via WITH adj AS MATERIALIZED so the 0-row common case never scans chip_ledger.
 *   3. Evaluate fn_ca_guarantee_house_supplements(p_tournament_id) at most once
 *      inside fn_ca_guarantee_funding(uuid).
 *   4. Restrict EXECUTE on both SECURITY DEFINER functions to service_role.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const FIX = '20261122183647_index_guarantee_house_supplements_and_single_eval.sql';

function latestDefining(pattern: RegExp): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort();
  let found: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (pattern.test(sql)) found = { file, sql };
  }
  if (!found) throw new Error(`No migration matches ${pattern}`);
  return found;
}

function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
  expect(start, `missing ${signature}`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = tail.indexOf('$function$;');
  expect(end, `missing end of ${signature}`).toBeGreaterThan(0);
  return tail.slice(0, end + '$function$;'.length);
}

describe('guarantee house supplements start from adjustments and evaluate once', () => {
  it('builds the settled player_wallet tournament_id index CONCURRENTLY before BEGIN', () => {
    const sql = readFileSync(resolve(MIGRATIONS, FIX), 'utf8');
    const idxPos = sql.indexOf(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ca_manual_adjustments_settled_player_wallet_tournament'
    );
    const beginPos = sql.search(/^BEGIN;$/m);
    expect(idxPos).toBeGreaterThan(0);
    expect(beginPos).toBeGreaterThan(idxPos);
    expect(sql).toContain('ON public.ca_manual_adjustments (tournament_id)');
    expect(sql).toContain(
      "WHERE status = 'settled' AND target_kind = 'player_wallet' AND tournament_id IS NOT NULL"
    );
  });

  it('anchors the newest fn_ca_guarantee_house_supplements(uuid) on a materialized adjustments CTE', () => {
    const latest = latestDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_guarantee_house_supplements\s*\(\s*p_tournament_id\s+uuid\s*\)/i
    );
    expect(latest.file >= FIX).toBe(true);
    const fn = functionBody(
      latest.sql,
      'public.fn_ca_guarantee_house_supplements(p_tournament_id uuid)'
    );
    expect(fn).toContain('WITH adj AS MATERIALIZED');
    expect(fn).toContain('FROM public.ca_manual_adjustments a');
    expect(latest.sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(latest.sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) TO service_role;'
    );
  });

  it('evaluates fn_ca_guarantee_house_supplements(p_tournament_id) once inside the newest fn_ca_guarantee_funding(uuid)', () => {
    const latest = latestDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_guarantee_funding\s*\(\s*p_tournament_id\s+uuid\s*\)/i
    );
    expect(latest.file >= FIX).toBe(true);
    const fn = functionBody(latest.sql, 'public.fn_ca_guarantee_funding(p_tournament_id uuid)');
    const calls = fn.match(/fn_ca_guarantee_house_supplements\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(fn).toContain("'house_supplement_paid', v.house_supplement_paid");
    expect(latest.sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(latest.sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding(uuid) TO service_role;'
    );
  });
});
