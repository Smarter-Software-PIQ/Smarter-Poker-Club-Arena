/**
 * TWO STATEMENT TIMEOUTS, TWO ROOT CAUSES (2026-11-25)
 *
 * 1. Engine spawn claims for certification fixture clubs queued behind the
 *    fixture's own 60-75 s retirement and were cancelled at 8 s (34 in 18
 *    hours). Migration 20261125022315 stands such a claim down at once.
 * 2. The club Tournament leaderboard aggregated a club's whole history per
 *    load (Midway Union: 2.6 million entries) and was cancelled 30 times.
 *    Migration 20261125022320 folds finished history every 30 minutes and
 *    reads only the unfolded tail live.
 *
 * Behaviour is proven on native PostgreSQL by
 * scripts/ci/test-slow-reads-stand-down-and-leaderboard-fold.py; this pins the
 * shape so a later edit cannot silently widen either rule.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', 'supabase', 'migrations');
const read = (name: string) => readFileSync(join(dir, name), 'utf8');
const strip = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

const spawn = read('20261125022315_a_certification_spawn_stands_down_while_its_club_is_retired.sql');
const board = read('20261125022320_the_club_tournament_leaderboard_reads_a_folded_total.sql');
const spawnCode = strip(spawn);
const boardCode = strip(board);

describe('a certification spawn stands down while its club is retired', () => {
  it('is one pinned transaction with bounded locks and a live proof', () => {
    expect(spawnCode.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(spawnCode.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(spawnCode).toContain("SET LOCAL lock_timeout='3s';");
    expect(spawnCode).toContain("<> 'f03e8db6f3de841921c04e459254efc2'");
    expect(spawn).toMatch(/^-- @live-proof: .*CERT_FIXTURE_BEING_RETIRED/m);
  });

  it('only reads certification clubs and never waits', () => {
    expect(spawnCode).toContain('public.fn_ca_reserved_certification_identity(c.owner_id)');
    expect(spawnCode).toContain('FOR KEY SHARE OF c SKIP LOCKED');
    expect(spawnCode).not.toMatch(/FOR (UPDATE|NO KEY UPDATE|SHARE)\b(?! OF c SKIP LOCKED)/);
  });

  it("answers with the spawner's stand-down code and keeps the old refusal", () => {
    expect(spawnCode).toMatch(/'CERT_FIXTURE_BEING_RETIRED:[\s\S]*?USING ERRCODE = '23505'/);
    expect(spawnCode).toMatch(/'CERT_FIXTURE_PAST_ITS_RUN:[\s\S]*?USING ERRCODE = '23505'/);
    expect(spawnCode.indexOf('CERT_FIXTURE_PAST_ITS_RUN')).toBeLessThan(
      spawnCode.indexOf('CERT_FIXTURE_BEING_RETIRED')
    );
  });
});

describe('the club tournament leaderboard reads a folded total', () => {
  it('builds its index without blocking writes, then one pinned transaction', () => {
    expect(boardCode.trimStart()).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS tournaments_leaderboard_club_unfolded/);
    expect(boardCode.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(boardCode.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(boardCode).toContain("<> '627eccb4daed89a26feeda113eab0118'");
    expect(board).toMatch(/^-- @live-proof: .*club-tournament-leaderboard-fold/m);
  });

  it('folds and reads on the same boundary expression', () => {
    const key = "(CASE WHEN t.is_private IS TRUE THEN NULL::timestamptz ELSE t.ended_at END)";
    expect(boardCode).toContain(`${key} < v_before`);
    expect(boardCode).toContain(`${key} IS NULL`);
    expect(boardCode).toContain(`${key} >= (SELECT b.folded_before FROM boundary b)`);
    expect(boardCode).toContain(
      'ON public.tournaments (club_id, (CASE WHEN is_private IS TRUE THEN NULL::timestamptz ELSE ended_at END))'
    );
  });

  it('keeps the reader under the caller row security and the totals private', () => {
    expect(boardCode).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_club_tournament_stats[\s\S]*?LANGUAGE sql\s+STABLE\s+SET search_path/
    );
    expect(boardCode).toContain(
      'REVOKE ALL ON smarter_private.club_tournament_leaderboard_totals FROM PUBLIC, anon, authenticated;'
    );
    expect(boardCode).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.refresh_club_tournament_leaderboard_totals() FROM PUBLIC, anon, authenticated;'
    );
  });

  it('writes only the rows whose figures changed, one fold at a time', () => {
    expect(boardCode).toContain("pg_try_advisory_xact_lock(hashtextextended('club-tournament-leaderboard-fold', 0))");
    expect(boardCode).toMatch(/IS DISTINCT FROM\s+\(EXCLUDED\.tournaments_played/);
    expect(boardCode).toMatch(
      /cron\.schedule\('club-tournament-leaderboard-fold', '7,37 \* \* \* \*',\s+\$job\$SET statement_timeout = '120s'; SELECT smarter_private\.refresh_club_tournament_leaderboard_totals\(\);\$job\$\)/
    );
  });
});
