import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rules: a tournament must never freeze, and a bounty only PKO ends with
// two players. A close that never had a field of two, or that was refused so
// the event played on heads up, is the rule working and is not a critical
// alert. Executed on PostgreSQL in
// scripts/ci/test-bounty-only-final-two-watch-real-misses.py; this pins the shape.
// Its native proof runs from scripts/ci/test-bounty-only-final-two-watch.py.
const MIG =
  'supabase/migrations/20261106105853_bounty_only_final_two_watch_alerts_only_real_misses.sql';
const sql = readFileSync(MIG, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');
const fnStart = code.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_bounty_only_final_two_watch');
const fn = code.slice(fnStart, code.indexOf('$function$;', fnStart));

describe('the final two watch alerts only a real miss', () => {
  it('is one transaction guarded on the live preimage', () => {
    expect(code.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(code.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(code).toContain("'d5d3d03c25baa6b97533ee1699827ec2'");
    expect(code).toContain('FINAL_TWO_WATCH_PREIMAGE_CHANGED');
    expect(code).toContain('FINAL_TWO_WATCH_POSTIMAGE_CHANGED');
  });

  it('raises closed_without_final_two only when the field sat at two and nothing refused', () => {
    expect(fn).toMatch(
      /WHERE NOT closed AND entrants >= 3 AND refusal IS NULL\s+AND \(second_bust_hand IS NULL OR third_bust_hand IS NULL\s+OR second_bust_hand <> third_bust_hand\)/
    );
    expect(fn).toContain('FROM public.ca_bounty_only_final_two_refusals f');
    expect(fn).toContain("AND c.state = 'eliminated'");
  });

  it('keeps every other breach kind', () => {
    for (const breach of [
      'runner_up_not_paid_own_head',
      'not_completed_after_close',
      'winner_not_paid_own_head',
      'pool_not_closed_exactly',
      'runner_up_knocked_out_after_close',
    ])
      expect(fn).toContain(`'${breach}'`);
  });

  it('the refusals table is the service role only, and the watch keeps its authority', () => {
    expect(code).toMatch(
      /REVOKE ALL ON public\.ca_bounty_only_final_two_refusals FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(code).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON public\.ca_bounty_only_final_two_refusals TO service_role;/
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_bounty_only_final_two_watch\(timestamptz\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('the engine records the refusal where the watch reads it', () => {
    const manager = readFileSync('server/src/tournament/TournamentManagerEliminations.ts', 'utf8');
    expect(manager).toMatch(/\.from\('ca_bounty_only_final_two_refusals'\)\s*\.upsert\(/);
  });
});
