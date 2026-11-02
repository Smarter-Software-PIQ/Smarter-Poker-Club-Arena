/**
 * LAW - KINGS CLUB STATS SHOW ONLY REAL PLAYERS
 *
 * Owner order 2026-11-02 13:26 CT: "MAKE SURE YOU REMOVE ALL THE LIFE TIME
 * HORSE STATS FROM THE KINGS CLUB, TO THE AGENTS NEW CLUB AS WELL, I WANT TO
 * SEE NOTHING BUT REAL PLAYER NUMBERS FROM KINGS CLUB ONLY".
 *
 * Kings Club has no horses after the club split. Its player statistics read
 * through attribution views: a Kings row of an assigned horse is read as the
 * horse's assigned club, any other Kings horse row is not read as Kings, and
 * every other row is unchanged. Settled rollups, source facts and ledgers are
 * never rewritten, and no other club drops a horse (CLAUDE.md 10.5).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = '20261102205742_kings_club_stats_show_only_real_players.sql';
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', NAME), 'utf8');
const KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';

const VIEWS = [
  'ca_stats_club_member_daily_stats',
  'ca_stats_club_player_daily',
  'ca_stats_member_record_daily_facts',
  'ca_stats_club_data_fact_ct',
  'ca_stats_club_tournament_player_daily',
  'ca_stats_player_stats_lifetime',
  'ca_stats_player_stats_snapshots_lifetime',
];

function viewBody(name: string): string {
  const start = sql.indexOf(`CREATE VIEW public.${name} AS`);
  const end = sql.indexOf(';', start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe('Kings Club stats show only real players', () => {
  it('moves an assigned horse to its new club and drops every other Kings horse row', () => {
    for (const v of VIEWS) {
      const body = viewBody(v);
      expect(body).toContain(`r.club_id <> '${KINGS}'::uuid`);
      expect(body).toContain('p.is_horse IS TRUE');
      expect(body).toContain('JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id');
      expect(body).toContain(`WHERE r.club_id = '${KINGS}'::uuid`);
      expect(body).toMatch(/SELECT (g\.user_id, )?a\.club_id|SELECT r\.user_id, a\.club_id/);
    }
  });

  it('only Kings is special: no other club id is filtered', () => {
    const filtered = sql.match(/r\.club_id <> '([0-9a-f-]{36})'/g) ?? [];
    expect(filtered.length).toBeGreaterThan(0);
    expect(new Set(filtered)).toEqual(new Set([`r.club_id <> '${KINGS}'`]));
  });

  it('never rewrites a rollup, fact or ledger row', () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+public\./i);
  });

  it('patches every club player-statistics reader and member count', () => {
    for (const fn of [
      'ca_club_top_players',
      'ca_club_player_page_core_20261006',
      'ca_club_player_breakdown',
      'ca_club_player_export_start',
      'ca_club_roster_rows',
      'ca_club_members(',
      'ca_club_members_cash_window',
      'ca_member_record_daily_facts(',
      'ca_club_data_screen',
      'ca_club_game_page_core_20261006',
      'fn_ca_club_game_recent_rows',
      'fn_ca_club_games_searched',
      'fn_ca_club_games_unsearched',
      'fn_ca_club_game_rows(',
      'fn_ca_club_game_rows_filtered',
      'fn_club_leaderboard_period_v2',
      'fn_club_leaderboard_by_dates',
      'fn_batch_club_member_counts',
      'fn_batch_club_realtime_member_counts',
      'fn_club_member_count(',
      'fn_get_club_member_count',
      'fn_club_member_counts',
    ]) {
      expect(sql).toContain(`['public.${fn}`);
    }
    // Each edit refuses to apply to a body it no longer recognises.
    expect(sql).toContain('no longer contains');
    expect(sql).toContain('a reader still reads the raw rollup');
  });

  it('attributes leaderboard play by assigned club and keeps the views private', () => {
    expect(sql).toContain('fn_ca_stats_home_club(a.user_id, a.club_id)=p_club_id');
    expect(sql).toMatch(/REVOKE ALL ON public\.ca_stats_club_member_daily_stats[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_ca_stats_counts_in_club[\s\S]*FROM PUBLIC, anon, authenticated;/);
  });
});
