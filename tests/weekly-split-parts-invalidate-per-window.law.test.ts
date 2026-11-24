/**
 * LAW: WEEKLY SPLIT PARTS INVALIDATE PER WINDOW (2026-11-23, incident 6377941a).
 *
 * When a closed-week cash or tournament source arrives after 08:00Z,
 * weekly_refresh_changed_payout_windows and fn_rakeback_recompute_split must
 * invalidate only the affected 2h counts / 6h tq split parts (plus aggregate
 * players/check/write), preserving unchanged windows of the 7-day week.
 * Structural expiry (oldest < v_to, oldest < clock_timestamp() - 12h, or
 * mismatched period_end) continues to clear the full club-week.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20261123163000_weekly_split_parts_per_window_invalidation.sql'
);
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

describe('weekly split parts invalidate per window (incident 6377941a)', () => {
  it('wraps DDL in one transaction with lock/statement timeouts and a live proof', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toContain("SET LOCAL lock_timeout = '5s';");
    expect(SQL).toContain("SET LOCAL statement_timeout = '10s';");
    expect(SQL).toMatch(/^-- @live-proof: /m);
  });

  it('replaces whole-week late-source wipes with per-window deletion in both owners without shadowing PL/pgSQL variable w', () => {
    expect(SQL).toContain('PER-WINDOW SPLIT-PART INVALIDATION (20261123)');
    expect(SQL).toContain('JOIN counts_wins cwin ON');
    expect(SQL).toContain('JOIN tq_wins twin ON');
    expect(SQL).not.toMatch(/JOIN\s+(counts_wins|tq_wins)\s+w\b/);
    expect(SQL).toContain("AND sp.kind IN ('players', 'check', 'write')");
    expect(SQL).toContain("AND sp.kind IN ('players','check','write')");
  });

  it('restates least-privilege grants naming PUBLIC and anon on both functions', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_refresh_changed_payout_windows(text, uuid, timestamptz, timestamptz)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_rakeback_recompute_split(uuid, date, date) FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_rakeback_recompute_split(uuid, date, date) TO service_role;'
    );
  });
});
