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

// 20261107134243 replaces the function in place (the Midnight Free Buy
// c1b3fa5a root cause): a provisional place 2 left by an earlier bust moves
// aside before the runner-up is stamped. The replacement must keep every
// property pinned above AND carry the relocation.
const MIG2 =
  'supabase/migrations/20261107134243_a_provisional_place_two_moves_aside_for_the_final_two_close.sql';
const code2 = readFileSync(MIG2, 'utf8').replace(/--[^\n]*/g, ' ');
const fn2Start = code2.indexOf(
  'CREATE OR REPLACE FUNCTION public.fn_ca_bounty_only_pko_final_two'
);
const fn2 = code2.slice(fn2Start, code2.indexOf('$function$;', fn2Start));

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

  it('a provisional place 2 moves aside before the runner-up is stamped (2026-11-07)', () => {
    // The replacement keeps the single payer, the refusal reasons, the order
    // and the stamp the original pinned.
    expect(fn2).toContain('public.fn_settle_tournament_obligation(');
    expect(fn2).toContain("'bounty_residual', NULL, v_second.user_id");
    expect(fn2).toContain("'fn_ca_bounty_only_pko_final_two'");
    expect(fn2).not.toMatch(
      /chip_balance|chip_ledger|wallet_transactions|INSERT INTO public\.tournament_payouts/
    );
    expect(fn2).toContain('SELECT * INTO v_done FROM public.ca_bounty_only_final_two');
    for (const reason of [
      'not_a_bounty_only_pko',
      'not_running_with_a_final_field',
      'busts_not_settled',
      'field_is_not_two',
      'a_live_stack_is_empty',
      'heads_do_not_match_the_open_pool',
    ])
      expect(fn2).toContain(`'${reason}'`);
    expect(fn2).toContain('IF NOT public.fn_caller_is_engine() THEN');
    expect(fn2).toContain("status = 'eliminated',");
    expect(fn2).toContain('position = 2,');
    // And it relocates a provisional holder of place 2 to the lowest FREE
    // place at 3 or above, before the stamp, never deleting or paying them.
    expect(fn2).toContain('AND tp.position = 2');
    expect(fn2).toContain('AND tp.id <> v_second.id');
    expect(fn2).toMatch(/generate_series\(3,/);
    expect(fn2).toContain("'no_free_provisional_place'");
    expect(fn2).toContain("'relocated_provisional_place_2', v_holder.user_id");
    // The relocation precedes the runner-up stamp.
    expect(fn2.indexOf('AND tp.id <> v_second.id')).toBeLessThan(fn2.indexOf('position = 2,'));
    // The replacement keeps execution engine-and-service_role only.
    expect(code2).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_bounty_only_pko_final_two\(uuid\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.fn_ca_bounty_only_pko_final_two\(uuid\) TO service_role;/
    );
  });

  it('the hand edge that may have left two holds the deal before the sweep can park (2026-11-07)', () => {
    // Midday Free Buy b3ae52ef, 2026-11-06: the deal already in flight when
    // the field reached two busted the runner-up before the close could claim
    // the field. The manager parks the one remaining table synchronously at
    // the zero-stack hand edge, with the close's own bounded budget - never
    // untilResumed, so the engine's safety net can always lift it.
    const base = readFileSync('server/src/tournament/TournamentManagerBase.ts', 'utf8');
    const hold = base.indexOf('isBountyOnlyPkoRow(this.tournamentCache)');
    expect(hold).toBeGreaterThan(0);
    const slice = base.slice(hold, hold + 400);
    expect(slice).toContain('this.tableEngines.size === 1');
    expect(slice).toContain('Number(player.stack) > 0).length <= 2');
    expect(slice).toContain(
      'engine.pauseAfterHand(BOUNTY_ONLY_FINAL_TWO_PARK_MS, { beforeNextHand: true })'
    );
    expect(slice).not.toContain('untilResumed');
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
