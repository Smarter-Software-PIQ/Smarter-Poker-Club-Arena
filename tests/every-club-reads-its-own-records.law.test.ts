/**
 * LAW - EVERY CLUB READS ITS OWN RECORDS, HORSES INCLUDED
 *
 * Owner rule 2026-11-15: each club shows only the hands played through that
 * club, and a player who plays in several clubs is never excluded or moved.
 * CLAUDE.md 10.5: a horse is never filtered out of a total. This supersedes
 * the statistics half of the 2026-11-02 club-split orders
 * (kings-club-stats-show-only-real-players, horses-fully-leave-old-clubs):
 * memberships still leave as those laws say; statistics stay with the club of
 * each record.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = '20261115145150_every_club_reads_its_own_records_horses_included.sql';
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', NAME), 'utf8');
const code = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

const VIEWS = [
  'ca_stats_club_data_fact_ct',
  'ca_stats_club_member_daily_stats',
  'ca_stats_club_player_daily',
  'ca_stats_club_tournament_player_daily',
  'ca_stats_member_record_daily_facts',
  'ca_stats_player_stats_lifetime',
  'ca_stats_player_stats_real',
  'ca_stats_player_stats_snapshots_lifetime',
  'ca_stats_player_stats_snapshots_real',
];

function body(head: string): string {
  const start = code.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const end = code.indexOf(';\n', start);
  return code.slice(start, end);
}

describe('every club reads its own records, horses included', () => {
  it('replaces every club-split statistics view with its base rows by their own club', () => {
    for (const v of VIEWS) {
      const b = body(`CREATE OR REPLACE VIEW public.${v} AS`);
      expect(b).not.toMatch(/ca_horse_club_assignments|is_horse|ca_horse_fleet_register|retired_at|UNION/i);
      expect(b).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(b).toMatch(/r\.club_id/);
    }
  });

  it('the Club Data fact window and the stats helpers neither move nor drop anyone', () => {
    const w = body('CREATE OR REPLACE FUNCTION public.fn_ca_club_data_fact_window');
    expect(w).toContain('r.club_id = ANY (p_clubs) AND r.stat_date BETWEEN p_from AND p_through');
    expect(w).not.toMatch(/horse|UNION/i);
    expect(body('CREATE OR REPLACE FUNCTION public.fn_ca_stats_home_club')).toContain('SELECT p_club_id');
    expect(body('CREATE OR REPLACE FUNCTION public.fn_ca_stats_counts_in_club')).toContain('SELECT true');
  });

  it('writes no row anywhere', () => {
    expect(code).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+public\./i);
  });
});
