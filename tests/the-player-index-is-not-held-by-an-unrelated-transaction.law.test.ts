/**
 * The player index is not held by an unrelated transaction (2026-11-27).
 *
 * 20261111131639 bounded ca_refresh_hand_player_index's forward loop by the
 * oldest open transaction of ANY client backend, so one long transaction that
 * could not write a hand (an analytics query, an idle pooler session) froze
 * the index for as long as it stayed open. ClubArenaStatsIndexLag then fired
 * outside every maintenance break (2026-11-27 11:25 and 11:56 UTC; the 11:15
 * and 11:45 refreshes held the lock and took 0 hands). The newest definition
 * must count only transactions that hold a write lock on public.hand_history,
 * keep the five-minute floor, and still never count its own backend.
 * Behaviour is proved natively by scripts/ci/test-idx-refresh-unrelated-xact.py.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

const DEFINES = /create\s+or\s+replace\s+function\s+public\.ca_refresh_hand_player_index\s*\(/i;

function boundLine(): string {
  const last = migrationCorpus()
    .filter(({ sql }) => DEFINES.test(sql))
    .pop();
  expect(last).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(DEFINES);
  const open = sql.indexOf('$function$', start);
  const body = sql.slice(start, sql.indexOf('$function$', open + 1));
  const line = body.split('\n').find((l) => l.includes('v_bound timestamptz :='));
  expect(line).toBeDefined();
  return line!;
}

describe('the player index is not held by an unrelated transaction', () => {
  it('counts only transactions holding a write lock on hand_history', () => {
    const line = boundLine();
    expect(line).toContain("least(now() - interval '5 minutes'");
    expect(line).toContain('JOIN pg_catalog.pg_locks l ON l.pid = a.pid');
    expect(line).toContain("l.relation = 'public.hand_history'::regclass");
    expect(line).toContain("l.mode IN ('RowExclusiveLock'");
    expect(line).toContain('a.pid <> pg_backend_pid()');
  });

  it('never bounds by every client backend again', () => {
    const line = boundLine();
    expect(line).not.toContain("a.backend_type = 'client backend'");
    expect(line).toContain("l.locktype = 'relation'");
  });
});
