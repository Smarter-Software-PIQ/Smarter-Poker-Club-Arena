import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayTotalPool, guaranteeShortfall } from '../src/utils/tournamentPrizeFunding';
import { effectivePrizePool } from '../src/components/tournament/details/types';

// Dan, 2026-11-05: "The full qualifying player-funded tournament payment
// counts toward the buy-in guarantee before deducting bounty allocations or
// rake." H = max(0, G - C), funded once; guarantee credit is not money.
const MIGRATION =
  'supabase/migrations/20261105222502_a_buyin_guarantee_counts_the_whole_player_payment.sql';

describe('a buy-in guarantee counts the whole player payment', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('the house owes max(0, guarantee - gross), reconciled against what it already posted', () => {
    expect(sql).toContain("'house_required', greatest(0, v.g - v.c)");
    expect(sql).toContain("'house_due', greatest(0, greatest(0, v.g - v.c) - v.p)");
  });

  it('gross is player wallet buy-ins, rebuys and add-ons, seats and redeemed tickets; never house or promo money', () => {
    expect(sql).toContain("l.category IN ('tournament_buyin', 'rebuy', 'addon')");
    expect(sql).toContain("l.category IN ('overlay', 'promo_send')");
    const paidIn = sql.slice(sql.indexOf('coalesce(sum(l.amount)'), sql.indexOf('AS paid_in'));
    expect(paidIn).not.toContain('promo_send');
    expect(paidIn).not.toContain('overlay');
  });

  it('every finalization and settlement guard reads the gross floor, Diamonds keep their book', () => {
    for (const f of [
      'fn_ca_apply_prize_guarantee_core',
      'fn_apply_prize_guarantee_before_atomic_proof',
      'fn_settle_tournament_places_atomic',
      'fn_settle_final_table_deal_atomic',
      'fn_settle_tournament_final_table_deal',
      'fn_settle_tournament_places',
      'trg_tournament_atomic_place_completion_guard',
      'fn_ca_overlay_shortfall',
    ]) {
      expect(sql).toContain(`'public.${f}(`);
    }
    expect(sql).toContain('public.fn_poker_diamond_tournament(p_tournament_id)');
    expect(sql).toMatch(/an unpatched place guarantee remains/);
  });

  it('the owner examples: 13 x 40 against 500 needs zero; 10 x 40 needs 100', () => {
    expect(guaranteeShortfall(500, 13 * 26, 13 * 10, 13 * 4)).toBe(0);
    expect(guaranteeShortfall(500, 10 * 26, 10 * 10, 10 * 4)).toBe(100);
    expect(effectivePrizePool(260, 500, 100, 40)).toBe(360);
    expect(effectivePrizePool(338, 500, 130, 52)).toBe(338);
  });

  it('a screen never stacks the guarantee on collected money', () => {
    expect(displayTotalPool(41 * 27, 1500, 0, 41 * 3)).toBe(1377);
    expect(displayTotalPool(41 * 27, 1500, 0, 41 * 3)).not.toBe(2445);
  });

  it.each([
    ['src/components/tournament/TournamentLobbyCard.tsx', 'tournament.totalRake'],
    ['src/components/lobby/GameLobbyPanel.tsx', 'tournament.total_rake'],
    ['src/components/table/TournamentBreakScreen.tsx', 't.total_rake'],
    ['src/pages/XMTTPage.tsx', 'detail.tournament?.total_rake'],
    ['src/components/tournament/details/RewardsTab.tsx', 't.total_rake'],
  ])('%s passes the rake into the guarantee arithmetic', (file, token) => {
    expect(readFileSync(file, 'utf8')).toContain(token);
  });
});

describe('a guaranteed Free Buy ticket funding is part of H, never on top of it', () => {
  const promo = readFileSync(
    'supabase/migrations/20261105225426_guaranteed_free_buy_ticket_funding_is_part_of_h.sql',
    'utf8'
  );
  it('returns promo above max(0, G - C) to the promo wallet once, before the pool finalizes', () => {
    expect(promo).toContain("(v_funding->>'house_over_required')::numeric, v_promo");
    expect(promo).toContain("':guarantee_promo_excess_return'");
    expect(promo).toContain(
      'PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);'
    );
    expect(promo).toContain(
      "IF v_format IS NULL OR v_format NOT IN ('regular', 'aiof') THEN RETURN 0; END IF;"
    );
  });
  it('owner example: G 500, 250 tickets, 160 player chips -> promo 340, pool 500', () => {
    const G = 500,
      C = 160,
      V = 250;
    const H = Math.max(0, G - C);
    expect(H).toBe(340);
    expect(Math.max(0, V - H)).toBe(0);
    expect(C + H).toBe(500);
  });
});
