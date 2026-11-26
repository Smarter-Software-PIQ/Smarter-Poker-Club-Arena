import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';

/**
 * MONITOR AND REPORT READS ARE BOUNDED BY THEIR INDEXES (2026-11-26).
 *
 * Production cancelled these reads at the 8 s statement budget in the 24 h to
 * 2026-11-26 21:45Z: fn_union_treasury_selftest via fn_settler_lag_check (39),
 * GET game_management_events (13), fn_bbj_analytics (14),
 * ca_public_arena_record_separated (6) and fn_tournament_money_conservation
 * (5). Each one walked rows an index or an existing rollup already summarises.
 * This law pins the bounded shape so a later rewrite cannot quietly bring the
 * walk back.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const READS = read(
  'supabase/migrations/20261126220936_monitor_and_report_reads_are_bounded_by_their_indexes.sql'
);
const INDEXES = read(
  'supabase/migrations/20261126220941_conservation_scan_reads_tournaments_and_rake_by_index.sql'
);
const HOOK = read('src/hooks/useGameManagementRealtime.ts');

function fn(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}
const code = (s: string) => s.replace(/--[^\n]*/g, '');

describe('monitor and report reads are bounded by their indexes', () => {
  it('is one transaction, with a live proof and a probe for every changed definer function', () => {
    expect(READS.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(READS.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(READS).toMatch(/SET LOCAL lock_timeout = '1s';/);
    for (const name of [
      'fn_settler_lag_check',
      'fn_bbj_analytics',
      'ca_public_arena_record_separated',
      'fn_game_management_feed',
    ]) {
      expect(READS).toContain(`-- @probe-for: public.${name}\n`);
    }
    expect(READS.match(/^-- @live-proof: .+$/gm)?.length).toBe(4);
  });

  it('reads the closed union week from the settler cursor up, by the cash index', () => {
    const body = code(fn(READS, 'fn_settler_lag_check'));
    const week = body.slice(body.indexOf('SELECT count(*) INTO v_unaccrued'));
    expect(week).toContain('rr.created_at >= GREATEST(v_week_from, v_cursor)');
    expect(week).toContain('rr.created_at <  v_week_to');
    // The partial index rake_records_cash_positive_created is spelled
    // `is_tournament IS NOT TRUE`; NOT COALESCE(...) cannot prove it.
    expect(week).toContain('rr.is_tournament IS NOT TRUE');
    expect(week).not.toMatch(/COALESCE\(rr\.is_tournament/);
    expect(week).not.toMatch(/rr\.created_at >= v_week_from\b/);
    expect(READS).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_settler_lag_check\(\) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public\.fn_settler_lag_check\(\) TO service_role;/
    );
  });

  it('sums BBJ contributions from the hourly rollup, never the whole reporting view', () => {
    const body = code(fn(READS, 'fn_bbj_analytics'));
    expect(body).toContain('PERFORM 1 FROM public.fn_bbj_pool_facts(p_pool_id);');
    expect(body).toContain('public.bbj_pool_contribution_hours h');
    expect(body).not.toContain('ca_launch_bbj_reporting_contributions');
    // The launch-reset start bounds the raw edge and tail reads, as the view did.
    expect(body.match(/c\.created_at >= v_start/g)?.length).toBe(4);
    expect(body).toContain("date_trunc('hour', now() - interval '15 minutes', 'UTC')");
    // The admin gate still runs before anything is read.
    expect(body.indexOf('Not authorized')).toBeLessThan(body.indexOf('fn_bbj_pool_facts'));
  });

  it('counts the arena record from the daily rollup, never hand by hand', () => {
    const body = code(fn(READS, 'ca_public_arena_record_separated'));
    expect(body).toContain('FROM public.club_member_daily_facts d');
    expect(body).not.toMatch(/FROM public\.ca_hand_facts/);
    expect(body).toContain("d.is_mtt=(p_game_mode='tournament')");
    expect(body).toContain('HAVING sum(d.hands)>0');
    // The contract the client validates is unchanged.
    expect(body).toContain(
      "'coverage',jsonb_build_object('source','ca_hand_facts','unclassified_history_included',false)"
    );
  });

  it('authorizes the management feed once and reads only by an index', () => {
    const body = code(fn(READS, 'fn_game_management_feed'));
    expect(body.match(/fn_can_create_games\(/g)).toHaveLength(1);
    expect(body.match(/fn_is_union_operator\(/g)).toHaveLength(1);
    expect(body).toContain('WHERE e.recipient_id = v_uid');
    expect(body.match(/ORDER BY e\.sequence DESC\s+LIMIT v_limit/g)).toHaveLength(2);
    expect(body).toContain('LEAST(GREATEST(COALESCE(p_limit, 128), 1), 128)');
    expect(READS).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_game_management_feed\(text, uuid, integer\) FROM PUBLIC, anon;/
    );
    // The board reads the function, never the table through RLS.
    expect(code(HOOK)).toContain(".rpc('fn_game_management_feed'");
    expect(code(HOOK)).not.toMatch(/\.from\(\s*'game_management_events'/);
  });

  it('builds the conservation indexes concurrently with the predicates the function itself uses', () => {
    const split = splitConcurrentPreamble(INDEXES);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.indexes.map((i) => `${i.table}.${i.name}`)).toEqual([
      'tournaments.idx_tournaments_conservation_ended_at',
      'rake_records.idx_rake_records_tournament_rake_cover',
    ]);
    expect(INDEXES).toMatch(/\(ended_at\)\s+WHERE status IN \('COMPLETED', 'CANCELLED'\);/);
    expect(INDEXES).toMatch(
      /\(tournament_id\) INCLUDE \(rake_amount\)\s+WHERE is_tournament AND rake_amount <> 0 AND tournament_id IS NOT NULL;/
    );
    expect(split.body).toContain(
      "RAISE EXCEPTION 'CONSERVATION_TOURNAMENT_WINDOW_INDEX_NOT_QUALIFIED'"
    );
    expect(split.body).toContain("RAISE EXCEPTION 'CONSERVATION_RAKE_COVER_INDEX_NOT_QUALIFIED'");
    expect(INDEXES.match(/^-- @live-proof: .+$/gm)?.length).toBe(2);
  });
});
