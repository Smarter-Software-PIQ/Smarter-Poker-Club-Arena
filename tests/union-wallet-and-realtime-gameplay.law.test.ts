import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function readRepoFile(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('Union Wallet Resolution & Real-Time Gameplay Hardening Guard', () => {
  describe('1. Union Cash Wallet & Spendable Balance (20261101220415)', () => {
    const sql = readRepoFile(
      'supabase/migrations/20261101220415_fix_union_cash_wallet_and_spendable_balance.sql'
    );

    it('preserves same-table seat wallet continuity when already seated with sufficient balance', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_ca_cash_paying_club');
      expect(sql).toContain('WHERE ts.user_id = p_user_id');
      expect(sql).toContain('AND ts.table_id = p_table_id');
      expect(sql).toContain('AND ts.left_at IS NULL');
      expect(sql).toContain(
        'RETURN public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, p_amount);'
      );
    });

    it('locks down fn_ca_cash_paying_club and fn_seat_club_for_user_membership_unchecked from PUBLIC, anon, authenticated', () => {
      expect(sql).toContain(
        'REVOKE ALL ON FUNCTION public.fn_ca_cash_paying_club(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;'
      );
      expect(sql).toContain(
        'REVOKE ALL ON FUNCTION public.fn_seat_club_for_user_membership_unchecked(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;'
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.fn_seat_club_for_user_membership_unchecked(uuid, uuid, uuid) TO service_role;'
      );
    });
  });

  describe('2. Tournament & Table Spendable Balance Resolution (20261101222103)', () => {
    const sql = readRepoFile(
      'supabase/migrations/20261101222103_fix_tournament_and_table_spendable_balance.sql'
    );

    it('prioritizes tournament_players.club_id on tournament tables in fn_seat_club_for_user_membership_unchecked', () => {
      expect(sql).toContain(
        'CREATE OR REPLACE FUNCTION public.fn_seat_club_for_user_membership_unchecked'
      );
      expect(sql).toContain('IF v_table_tournament_id IS NOT NULL THEN');
      expect(sql).toContain('FROM public.tournament_players tp');
      expect(sql).toContain('WHERE tp.tournament_id = v_table_tournament_id');
    });

    it('stamps COALESCE(v_tp_club, v_club) in fn_seat_late_registrant_before_maintenance_gate', () => {
      expect(sql).toContain(
        'CREATE OR REPLACE FUNCTION public.fn_seat_late_registrant_before_maintenance_gate'
      );
      expect(sql).toContain('COALESCE(v_tp_club, v_club)');
    });

    it('resolves tournament tables and union club fallbacks in fn_player_spendable_balance', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_player_spendable_balance');
      expect(sql).toContain('SELECT t.tournament_id INTO v_table_tournament_id');
      expect(sql).toContain('ELSIF v_table_tournament_id IS NOT NULL THEN');
      expect(sql).toContain('public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, v_need)');
      expect(sql).toContain('public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, 0.01)');
    });
  });

  describe('3. Free-Buy & Rebuy/Add-On Union Entry Paying Club Selection (20261102001500)', () => {
    const sql = readRepoFile(
      'supabase/migrations/20261102001500_fix_freebuy_and_rebuy_union_entry_paying_club.sql'
    );

    it('computes v_full_need across entry charge + rebuy_cost + addon_cost in fn_ca_entry_paying_club', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_ca_entry_paying_club');
      expect(sql).toContain(
        'v_full_need := GREATEST(v_charge + v_rebuy_need + v_addon_need, v_charge, 0.01);'
      );
      expect(sql).toContain(
        'v_paying := public.fn_ca_union_wallet_that_can_pay(p_user_id, v_t.union_id, v_full_need);'
      );
      // Free-Buy / freeroll fallback when v_charge = 0
      expect(sql).toContain('GREATEST(v_rebuy_need, v_addon_need, 0.01)');
    });

    it('prefers funded union member wallets for real players in fn_tournament_club_for_user and fn_player_home_club', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_tournament_club_for_user');
      expect(sql).toContain('ORDER BY (COALESCE(m.chip_balance, 0) > 0) DESC,');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_player_home_club');
      expect(sql).toContain('ORDER BY (COALESCE(cm.chip_balance, 0) > 0) DESC,');
    });

    it('enforces exact REVOKE/GRANT privileges on fn_ca_entry_paying_club, fn_tournament_club_for_user, and fn_player_home_club', () => {
      expect(sql).toContain(
        'REVOKE ALL ON FUNCTION public.fn_ca_entry_paying_club(uuid, uuid) FROM PUBLIC, anon, authenticated;'
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.fn_ca_entry_paying_club(uuid, uuid) TO service_role;'
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.fn_tournament_club_for_user(uuid, uuid, uuid) TO authenticated, service_role;'
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.fn_player_home_club(uuid, uuid) TO authenticated, service_role;'
      );
    });
  });

  describe('4. Live Gameplay Real-Time Responsiveness Invariants (Client & Engine)', () => {
    const tablePage = readRepoFile('src/pages/TablePage.tsx');
    const handEvents = readRepoFile('server/src/engine/ServerTableEngineHandEvents.ts');
    const dealing = readRepoFile('server/src/engine/ServerTableEngineDealing.ts');

    it('wires instant optimistic hero action ("Snap Act") across fold, check, call, raise, and allin in TablePage.tsx', () => {
      expect(tablePage).toContain('const applyOptimisticHeroAction = useCallback(');
      expect(tablePage).toContain("const revert = applyOptimisticHeroAction('fold');");
      expect(tablePage).toContain("const revert = applyOptimisticHeroAction('check');");
      expect(tablePage).toContain("const revert = applyOptimisticHeroAction('call', callAmt);");
      expect(tablePage).toContain("const revert = applyOptimisticHeroAction('raise', clamped);");
      expect(tablePage).toContain(
        "const revert = applyOptimisticHeroAction('allin', heroAllInTo);"
      );
    });

    it('buffers early hole_cards frames in earlyHeroCardsRef and flushes them immediately on HAND_STARTED', () => {
      expect(tablePage).toContain('earlyHeroCardsRef.current = {');
      expect(tablePage).toContain('const early = earlyHeroCardsRef.current;');
      expect(tablePage).toContain('handleHoleCardPayload({ new: early.row });');
    });

    it('emits hand_started frame on HAND_START before CARDS_DEALT persists hole cards', () => {
      const handStartIdx = handEvents.indexOf("case 'HAND_START':");
      const handStartedEmitIdx = handEvents.indexOf('handStartedFrame({', handStartIdx);
      const cardsDealtIdx = handEvents.indexOf("case 'CARDS_DEALT':");
      expect(handStartIdx).toBeGreaterThan(-1);
      expect(handStartedEmitIdx).toBeGreaterThan(handStartIdx);
      expect(cardsDealtIdx).toBeGreaterThan(handStartedEmitIdx);
    });

    it('arms NEXT_HAND_REST_MS before next-hand preparation so DB settlement/roster reads overlap with the rest window', () => {
      expect(dealing).toContain('this.armNextHandRest(');
      expect(dealing).toContain(
        'Math.max(HAND_COMPLETION.NEXT_HAND_REST_MS, boardClearMs(wentToShowdown))'
      );
      expect(dealing).toContain('await this.awaitNextHandRest();');
    });
  });
});
