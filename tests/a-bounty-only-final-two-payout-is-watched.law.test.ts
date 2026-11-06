import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule 2026-11-05 (Dan): a bounty only PKO ends with two players and
// both keep the bounty on their own head. Executed on PostgreSQL in
// scripts/ci/test-bounty-only-final-two-watch.py; this pins the shape.
const MIG = 'supabase/migrations/20261106032337_bounty_only_final_two_payout_is_watched.sql';
const sql = readFileSync(MIG, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');
const fnStart = code.indexOf('CREATE FUNCTION public.fn_ca_bounty_only_final_two_watch');
const fn = code.slice(fnStart, code.indexOf('$function$;', fnStart));

describe('a bounty only final two payout is watched', () => {
  it('names every breach the close can suffer', () => {
    for (const breach of [
      'closed_without_final_two',
      'runner_up_not_paid_own_head',
      'not_completed_after_close',
      'winner_not_paid_own_head',
      'pool_not_closed_exactly',
      'runner_up_knocked_out_after_close',
    ])
      expect(fn).toContain(`'${breach}'`);
  });

  it('raises one critical alert per tournament and breach while one is open', () => {
    expect(fn).toContain("'critical', 'fn_ca_bounty_only_final_two_watch'");
    expect(fn).toMatch(/a\.resolved IS NOT TRUE/);
    expect(fn).toMatch(/a\.context->>'tournament_id' = r\.id::text/);
    expect(fn).toMatch(/a\.context->>'breach' = r\.breach/);
  });

  it('moves no chips', () => {
    expect(fn).not.toMatch(
      /fn_settle_tournament_obligation|chip_balance|INSERT INTO public\.(chip_ledger|wallet_transactions|tournament_obligations)|UPDATE public\.(tournaments|tournament_players|club_members)/
    );
  });

  it('reviews the close as a global lane authority, md5-guarded both ways', () => {
    expect(code).toContain("'9cd12c0b962d33af3c1193b890b8f898'");
    expect(code).toContain("'a0a71944de239c5d5ef93460f0835ce0'");
    expect(code).toMatch(
      /'fn_sweep_unsettled_tournament_rake',\s+'fn_ca_bounty_only_pko_final_two'\];/
    );
  });

  it('runs every five minutes for the service role only', () => {
    expect(code).toContain("cron.schedule('ca-bounty-only-final-two-watch-5m'");
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_bounty_only_final_two_watch\(timestamptz\) FROM PUBLIC, anon, authenticated;/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_bounty_only_final_two_watch\(timestamptz\) TO service_role;/
    );
  });
});
