import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';

/**
 * CRON WATCHERS MATERIALIZE THEIR READS AND PRUNE WITHOUT DEADLOCK (2026-11-27).
 *
 * Root-cause & sibling hardening after drift incident f8222046-da2b-4f24-a5a7-22a68fe8c783:
 *  - ca-horse-exposure-watch-hourly: partial covering index for has_human PLO4/5 cash hands
 *    + align statement_timeout='150s' with its cron budget.
 *  - ca-free-buy-funding-watch-15m: MATERIALIZE gtd & fb CTEs, bound start_time with GREATEST,
 *    and align statement_timeout='60s' with its cron budget.
 *  - ca-guarantee-funding-variance-15m: MATERIALIZE cov CTE, bound start_time with GREATEST,
 *    and set lock_timeout='2s' / statement_timeout='60s'.
 *  - ca-diamond-prune-history-daily: deterministic PK-ordered batched DELETE with
 *    FOR UPDATE SKIP LOCKED so concurrent challenge updates never deadlock.
 *
 * Every law below MUST pass on the new migration AND fail on the exact live preimage
 * captured from production on 2026-11-27.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const FILE =
  'supabase/migrations/20261127172908_cron_watchers_materialize_and_prune_without_deadlock.sql';
const SQL = read(FILE);
const FIX = 'scripts/ci/fixtures/cron-watchers-hardening';

const LIVE_MD5: Record<string, string> = {
  fn_ca_free_buy_funding_watch: '81d72e4361a751945dc9087fff71a929',
  fn_ca_guarantee_funding_variance_scan: 'a6b8f0d440d2651c42630c4c9d8d40cd',
  fn_ca_diamond_prune_history: 'a4f628c380968183c041058bfa15135f',
};
const live = (name: string) => read(`${FIX}/${name}.live-20261127.sql`);

function fn(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$', sql.indexOf('AS $function$', start) + 13);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const code = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => code(s).replace(/\s+/g, ' ');

const LAWS: Record<string, (def: string) => boolean> = {
  fn_ca_free_buy_funding_watch: (def) => {
    const s = squash(def);
    return (
      /SET statement_timeout TO '60s'/.test(def) &&
      s.includes('WITH gtd AS MATERIALIZED (') &&
      s.includes('fb AS MATERIALIZED (') &&
      s.includes('t.start_time >= GREATEST(c_gross_since, v_window)') &&
      s.includes('t.start_time >= GREATEST(c_tickets_live, v_window)')
    );
  },
  fn_ca_guarantee_funding_variance_scan: (def) => {
    const s = squash(def);
    return (
      /SET lock_timeout TO '2s'/.test(def) &&
      /SET statement_timeout TO '60s'/.test(def) &&
      s.includes('WITH cov AS MATERIALIZED (') &&
      s.includes("t.start_time >= GREATEST(v_since, now() - interval '14 days')")
    );
  },
  fn_ca_diamond_prune_history: (def) => {
    const s = squash(def);
    const matches = s.match(/ORDER BY id LIMIT c_batch_size FOR UPDATE SKIP LOCKED/g) || [];
    return (
      /SET lock_timeout TO '2s'/.test(def) &&
      /SET statement_timeout TO '120s'/.test(def) &&
      matches.length === 3 &&
      !/DELETE FROM public\.user_daily_challenges WHERE /.test(s) &&
      !/DELETE FROM public\.ca_diamond_incidents WHERE /.test(s)
    );
  },
};

describe('cron watchers materialize their reads and prune without deadlock', () => {
  it('concurrent preamble builds the PLO4/5 human cash covering index outside the transaction', () => {
    const split = splitConcurrentPreamble(SQL);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.indexes.length).toBe(1);
    expect(split.indexes[0].name).toBe('idx_hand_history_human_plo45_cash_created');
    expect(split.indexes[0].statement).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hand_history_human_plo45_cash_created'
    );
    expect(split.body).toContain('CRON_WATCH_INDEX_NOT_QUALIFIED');
    expect(split.body).toContain(
      "ALTER FUNCTION public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)\n  SET statement_timeout = '150s';"
    );
  });

  for (const [name, expectedMd5] of Object.entries(LIVE_MD5)) {
    it(`${name}: fixture md5 matches production preimage, fails old law, and passes new migration`, () => {
      const oldDef = live(name);
      const actualMd5 = createHash('md5').update(oldDef, 'utf8').digest('hex');
      expect(actualMd5).toBe(expectedMd5);
      expect(SQL).toContain(`=${expectedMd5}`);

      expect(LAWS[name](oldDef), `old live ${name} must fail the hardened law`).toBe(false);
      expect(LAWS[name](fn(SQL, name)), `new migration ${name} must pass the hardened law`).toBe(
        true
      );
    });
  }

  it('restates strict service_role-only grants for every replaced function', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_free_buy_funding_watch() FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_funding_watch() TO service_role;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone) FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone) TO service_role;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_diamond_prune_history(integer, integer, integer) FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_diamond_prune_history(integer, integer, integer) TO service_role;'
    );
  });
});
