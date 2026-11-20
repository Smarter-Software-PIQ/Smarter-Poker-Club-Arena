/**
 * LAW: no new migration acquires an unannotated FOR UPDATE or FOR SHARE lock on public.tournaments.
 * ═══════════════════════════════════════════════════════════════════════════
 * Hand commits lock public.tournaments FOR KEY SHARE and shared-lane writers
 * (rebuys, add-ons, moves, breaks, busts, sweeps) lock public.tournaments
 * FOR NO KEY UPDATE. Reintroducing FOR UPDATE or FOR SHARE on public.tournaments
 * silently re-serializes multi-table tournament hands and causes 40P01 lock-upgrade
 * deadlocks. Any genuine lifecycle transition that requires an exclusive lock
 * must carry `-- @lifecycle-exclusive-lock: <reason>`.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  HOT_ROW_LOCK_CHECKED_FROM,
  checkMigrationsDir,
  findTournamentHotRowLockViolations,
  isHotRowLockChecked,
} from '../scripts/ci/check-migration-hot-row-locks.mjs';

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

describe('no new hot-row lock upgrades on public.tournaments', () => {
  it('allows clean FOR KEY SHARE and FOR NO KEY UPDATE on public.tournaments', () => {
    const sql = `
      CREATE OR REPLACE FUNCTION public.fn_example_hand_and_rebuy(p_tid uuid)
      RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        PERFORM 1 FROM public.tournaments t WHERE t.id = p_tid FOR KEY SHARE;
        PERFORM 1 FROM public.tournaments t WHERE t.id = p_tid FOR NO KEY UPDATE;
        PERFORM 1 FROM tournaments WHERE id = p_tid FOR KEY SHARE;
      END;
      $fn$;
    `;
    expect(findTournamentHotRowLockViolations(sql, '20261120120000_clean.sql')).toEqual([]);
  });

  it('rejects unannotated FOR UPDATE and FOR SHARE on public.tournaments with filename, line, and snippet', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION public.fn_bad(p_tid uuid) RETURNS void LANGUAGE plpgsql AS $fn$',
      'BEGIN',
      '  PERFORM 1 FROM public.tournaments t WHERE t.id = p_tid FOR UPDATE;',
      '  SELECT * FROM tournaments WHERE id = p_tid FOR SHARE;',
      'END;',
      '$fn$;',
    ].join('\n');

    const violations = findTournamentHotRowLockViolations(
      sql,
      'supabase/migrations/20261120120000_bad.sql'
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      file: 'supabase/migrations/20261120120000_bad.sql',
      line: 3,
      lockMode: 'FOR UPDATE',
      snippet: 'PERFORM 1 FROM public.tournaments t WHERE t.id = p_tid FOR UPDATE;',
    });
    expect(violations[1]).toEqual({
      file: 'supabase/migrations/20261120120000_bad.sql',
      line: 4,
      lockMode: 'FOR SHARE',
      snippet: 'SELECT * FROM tournaments WHERE id = p_tid FOR SHARE;',
    });
  });

  it('allows FOR UPDATE / FOR SHARE when annotated with -- @lifecycle-exclusive-lock: <reason>', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION public.fn_terminal_settle(p_tid uuid) RETURNS void LANGUAGE plpgsql AS $fn$',
      'BEGIN',
      '  -- @lifecycle-exclusive-lock: terminal settlement',
      '  PERFORM 1 FROM public.tournaments t WHERE t.id = p_tid FOR UPDATE;',
      '  PERFORM 1 FROM public.tournaments WHERE id = p_tid FOR UPDATE; -- @lifecycle-exclusive-lock: cancellation close',
      'END;',
      '$fn$;',
    ].join('\n');

    expect(findTournamentHotRowLockViolations(sql, '20261120120000_annotated.sql')).toEqual([]);
  });

  it('rejects -- @lifecycle-exclusive-lock: with no reason', () => {
    const sql = [
      '-- @lifecycle-exclusive-lock:   ',
      'SELECT * FROM public.tournaments WHERE id = p_tid FOR UPDATE;',
    ].join('\n');

    const violations = findTournamentHotRowLockViolations(sql, '20261120120000_empty_reason.sql');
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  it('ignores FOR UPDATE OF another joined alias and ignores comments/strings', () => {
    const sql = `
      -- SELECT * FROM public.tournaments FOR UPDATE;
      SELECT tb.id
        FROM public.tables tb
        JOIN public.tournaments t ON t.id = tb.tournament_id
       WHERE tb.id = p_table_id
       FOR UPDATE OF tb;
      CREATE POLICY tournaments_update ON public.tournaments FOR UPDATE USING (true);
    `;
    expect(findTournamentHotRowLockViolations(sql, '20261120120000_other_alias.sql')).toEqual([]);
  });

  it('only enforces migrations with timestamp >= 20261120000000', () => {
    expect(HOT_ROW_LOCK_CHECKED_FROM).toBe('20261120000000');
    expect(isHotRowLockChecked('20261119235959_historical.sql')).toBe(false);
    expect(isHotRowLockChecked('20261120000000_new.sql')).toBe(true);
    expect(isHotRowLockChecked('supabase/migrations/20261120181452_example.sql')).toBe(true);
  });

  it('all existing migrations >= 20261120000000 on origin/main pass', () => {
    const { checkedCount, violations } = checkMigrationsDir(MIGRATIONS_DIR);
    expect(checkedCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
