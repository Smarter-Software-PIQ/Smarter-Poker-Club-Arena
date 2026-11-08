import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule 2026-11-05 (Dan): a bounty only PKO is over with two players
// left, and both keep the bounty on their own head. Executed on PostgreSQL in
// scripts/ci/test-bounty-only-pko-final-two.py and on the engine decision in
// server/src/tournament/BountyOnlyFinalTwo.test.ts; this pins the shape.
const MIG = 'supabase/migrations/20261106010426_bounty_only_pko_ends_with_two_players.sql';
const sql = readFileSync(MIG, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');
const fnStart = code.indexOf('CREATE FUNCTION public.fn_ca_bounty_only_pko_final_two');
const fn = code.slice(fnStart, code.indexOf('$function$;', fnStart));
const flat = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ');

// 20261108193616 replaces the function in place (Midnight Free Buy 7f473b6a,
// Midday Free Buy 72e9b116): a provisional place 2 an earlier bust still holds
// moves aside before the runner-up is stamped, instead of being answered
// finishing_place_two_is_held, which no retry could clear. The replacement
// must keep every property pinned on the original AND carry the relocation.
const MOVE =
  'supabase/migrations/20261108193616_a_provisional_place_two_moves_aside_for_the_final_two_close.sql';
const moveCode = readFileSync(MOVE, 'utf8').replace(/--[^\n]*/g, ' ');
const moveStart = moveCode.indexOf(
  'CREATE OR REPLACE FUNCTION public.fn_ca_bounty_only_pko_final_two'
);
const moveFn = moveCode.slice(moveStart, moveCode.indexOf('$function$;', moveStart));

describe('a bounty only PKO ends with two players', () => {
  it('pays the second player his own head through the single payer, once', () => {
    expect(fn).toContain('public.fn_settle_tournament_obligation(');
    expect(fn).toContain("'bounty_residual', NULL, v_second.user_id");
    expect(fn).toContain("'fn_ca_bounty_only_pko_final_two'");
    expect(fn).not.toMatch(
      /chip_balance|chip_ledger|wallet_transactions|INSERT INTO public\.tournament_payouts/
    );
    expect(fn).toContain('SELECT * INTO v_done FROM public.ca_bounty_only_final_two');
    expect(code).toMatch(
      /INSERT INTO public\.ca_settle_sources\(source, note\)\s+VALUES \('fn_ca_bounty_only_pko_final_two'/
    );
  });

  it('closes only a settled field of two whose heads are the whole open pool', () => {
    for (const reason of [
      'not_a_bounty_only_pko',
      'not_running_with_a_final_field',
      'busts_not_settled',
      'field_is_not_two',
      'a_live_stack_is_empty',
      'heads_do_not_match_the_open_pool',
    ])
      expect(fn).toContain(`'${reason}'`);
    expect(fn).toMatch(
      /ORDER BY COALESCE\(tp\.chips, 0\) DESC, COALESCE\(tp\.current_bounty, 0\) DESC,\s+tp\.registered_at ASC NULLS LAST, tp\.user_id ASC/
    );
    expect(fn).toContain("status = 'eliminated',");
    expect(fn).toContain('position = 2,');
  });

  it('only the engine may close it and only service_role may execute it', () => {
    expect(fn).toContain('IF NOT public.fn_caller_is_engine() THEN');
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_bounty_only_pko_final_two\(uuid\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.fn_ca_bounty_only_pko_final_two\(uuid\) TO service_role;/
    );
    expect(code).toMatch(
      /REVOKE ALL ON public\.ca_bounty_only_final_two FROM PUBLIC, anon, authenticated, service_role;/
    );
  });

  it('a provisional place 2 moves aside before the runner-up is stamped (2026-11-08)', () => {
    expect(moveStart).toBeGreaterThan(0);
    expect(moveFn).toContain('public.fn_settle_tournament_obligation(');
    expect(moveFn).toContain("'bounty_residual', NULL, v_second.user_id");
    expect(moveFn).toContain("'fn_ca_bounty_only_pko_final_two'");
    expect(moveFn).not.toMatch(
      /chip_balance|chip_ledger|wallet_transactions|INSERT INTO public\.tournament_payouts/
    );
    expect(moveFn).toContain('SELECT * INTO v_done FROM public.ca_bounty_only_final_two');
    for (const reason of [
      'not_a_bounty_only_pko',
      'not_running_with_a_final_field',
      'busts_not_settled',
      'field_is_not_two',
      'a_live_stack_is_empty',
      'heads_do_not_match_the_open_pool',
    ])
      expect(moveFn).toContain(`'${reason}'`);
    expect(moveFn).toContain('IF NOT public.fn_caller_is_engine() THEN');
    expect(moveFn).toContain("status = 'eliminated',");
    expect(moveFn).toContain('position = 2,');
    // The holder moves to the lowest FREE place at 3 or above, before the payer
    // and the stamp, and is never paid, deleted or refused.
    expect(moveFn).toContain('AND tp.position = 2');
    expect(moveFn).toContain('AND tp.user_id <> v_second.user_id');
    expect(moveFn).toMatch(/generate_series\(3,/);
    expect(moveFn).toContain("'no_free_provisional_place'");
    expect(moveFn).toContain("'relocated_provisional_place_2', v_holder_user");
    expect(moveFn).not.toContain("'finishing_place_two_is_held'");
    expect(moveFn.indexOf('SET position = v_free_place')).toBeLessThan(
      moveFn.indexOf('public.fn_settle_tournament_obligation(')
    );
    expect(moveFn.indexOf('public.fn_settle_tournament_obligation(')).toBeLessThan(
      moveFn.indexOf('position = 2,')
    );
    expect(moveCode).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_bounty_only_pko_final_two\(uuid\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.fn_ca_bounty_only_pko_final_two\(uuid\) TO service_role;/
    );
  });

  it('the engine asks for the close before it reads a single winner', () => {
    const manager = readFileSync('server/src/tournament/TournamentManagerEliminations.ts', 'utf8');
    const close = manager.indexOf('closeBountyOnlyPkoAtTwo({');
    expect(close).toBeGreaterThan(0);
    expect(manager.indexOf("this.noteEliminationSweepStep('finishTournament');")).toBeGreaterThan(
      close
    );
  });

  it('the Rewards tab and the lobby state the rule', () => {
    const rule =
      'The Event Ends With Two Players Left, And Both Keep The Bounty On Their Own Head.';
    expect(flat('src/components/tournament/details/RewardsTab.tsx')).toContain(rule);
    expect(flat('src/components/lobby/GameLobbyPanel.tsx')).toContain(rule);
    expect(flat('src/components/tournament/details/RewardsTab.tsx')).not.toContain(
      'Last Player Standing'
    );
    expect(flat('src/components/lobby/GameLobbyPanel.tsx')).not.toContain('Last Player Standing');
  });
});
