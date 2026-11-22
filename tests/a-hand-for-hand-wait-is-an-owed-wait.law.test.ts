/**
 * A HAND-FOR-HAND WAIT IS AN OWED WAIT (incident 1e532243, 2026-11-19).
 *
 * fn_ca_hand_gap_watch paged "unintended delay between hands" (tournament
 * all_in_showdown, p95 8,998 ms after 34,387 ms) for one satellite on its
 * money bubble, where hand-for-hand holds every table until all tables finish
 * the hand. That wait is a rule of the game. The engine now records each
 * hand-for-hand interval and the grader leaves it out, as it already leaves out
 * a maintenance break and a tournament break. These laws pin:
 *
 *   1. arming the bubble barrier records its start and stopping it records its
 *      end, in TournamentManagerBase, and the write is never awaited;
 *   2. the newest definition of fn_ca_hand_gap_unintended_delay leaves out a
 *      pair overlapping a recorded interval of its own tournament, keeps the
 *      break exclusions, and the interval table is service_role only.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const base = readFileSync(join(ROOT, 'server/src/tournament/TournamentManagerBase.ts'), 'utf8');
const dir = join(ROOT, 'supabase/migrations');
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const newest = (needle: string) => {
  const f = migrations.filter((m) => readFileSync(join(dir, m), 'utf8').includes(needle)).pop();
  if (!f) throw new Error(`no migration carries ${needle}`);
  return readFileSync(join(dir, f), 'utf8');
};
const method = (src: string, sig: string) => {
  const i = src.indexOf(sig);
  expect(i, sig).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf('\n  }\n', i));
};

describe('a hand-for-hand wait is an owed wait', () => {
  it('arming the bubble barrier records its start', () => {
    expect(method(base, 'protected startHandForHandSync(): void {')).toMatch(
      /this\.recordHandForHand\(true\);/
    );
  });

  it('stopping the barrier records its end', () => {
    expect(method(base, 'protected stopHandForHandSync(): void {')).toMatch(
      /this\.recordHandForHand\(false\);/
    );
  });

  it('the record is fire-and-forget and names its failure', () => {
    const rec = method(base, 'private recordHandForHand(active: boolean): void {');
    expect(rec).toContain("supabase.rpc('fn_ca_note_hand_for_hand'");
    expect(rec).not.toMatch(/\bawait\b/);
    expect(rec).toContain("'Tournament.hand_for_hand_record_failed'");
  });

  it('the grader leaves out a pair overlapping a recorded interval of its own tournament', () => {
    const sql = newest('FROM ca_tournament_hand_for_hand h4h').replace(/\s+/g, ' ');
    expect(sql).toContain('FROM ca_tournament_hand_for_hand h4h');
    expect(sql).toContain(
      'WHERE h4h.tournament_id = p.tournament_id AND h4h.started_at < nx.started_at'
    );
    expect(sql).toContain("AND COALESCE(h4h.ended_at, ''infinity'') > p.ended_at)");
    // The break exclusions stay: the new clause is inserted before the tournament-break one.
    expect(sql).toContain("|| chr(10) || ' AND NOT EXISTS (SELECT 1 FROM tournaments t';");
    expect(sql).toContain(
      "pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone, integer)'::regprocedure)"
    );
  });

  it('the interval table and its writer are service_role only', () => {
    const sql = newest('CREATE TABLE IF NOT EXISTS public.ca_tournament_hand_for_hand');
    expect(sql).toContain(
      'ALTER TABLE public.ca_tournament_hand_for_hand ENABLE ROW LEVEL SECURITY;'
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.ca_tournament_hand_for_hand FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_note_hand_for_hand(uuid, boolean) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_note_hand_for_hand(uuid, boolean) TO service_role;'
    );
  });
});
