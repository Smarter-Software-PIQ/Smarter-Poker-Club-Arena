-- @live-proof: (SELECT to_regprocedure('public.fn_cashier_roster_sort_keys(uuid)') IS NOT NULL AND has_function_privilege('authenticated','public.fn_cashier_roster_sort_keys(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_cashier_roster_sort_keys(uuid)','EXECUTE'))
-- 20261113173905_cashier_roster_sort_keys.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan, 2026-11-13):
--
-- "FOR THE CASHIER, PLAYERS DISPLAYED SHOULD BE DEFAULTED BY LAST TRANSACTION,
-- AND NEXT TO 140 RESULTS, SHOULD BE TO SORT BUTTONS. SORT UP OR DOWN BY AGENT
-- WALLET BALANCE AND PLAYER WALLET BALANCE."
--
-- The cashier roster (fn_club_cashier_members_page_v3) carries the player
-- wallet but not the agent wallet, and nothing about when a member last
-- transacted. The agent wallet was only ever read for the 25 rows on screen
-- (fn_cashier_recipient_wallet_balances), so a sort by it could only order the
-- rows already visible, and "Most Recent" was a per-device list of who this
-- browser had last sent to, not the club's ledger.
--
-- fn_cashier_roster_sort_keys returns, for EVERY member the viewer may see
-- (the same fn_club_cashier_members_v2 scope the roster uses, so it cannot
-- show a viewer anyone the roster does not), three keys:
--   player_wallet       club_members.chip_balance (null for an admin, who holds
--                       none - identical to fn_cashier_recipient_wallet_balances)
--   agent_wallet        agents.agent_wallet_balance for the roles that hold one
--   last_transaction_at the newest cashier ledger row in this club where the
--                       member is sender or receiver: the same transfer and
--                       cash-out types the Transaction History tab lists
--                       (fn_cashier_history_feed), so "last transaction" means
--                       the row the operator would see at the top of history.
--
-- Read path only: one STABLE function, no table, no index, no lock beyond
-- AccessShare. Each member costs two LIMIT 1 probes on the existing
-- chip_transactions_club_{from,to}_created_idx indexes (measured on Kings Club,
-- 787 club_members rows: about 1 s cold, fast warm). Horses are listed and
-- sorted exactly like humans (CLAUDE.md 10.5); no horse flag is returned.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cashier_roster_sort_keys(p_club_id uuid)
RETURNS TABLE(user_id uuid, player_wallet numeric, agent_wallet numeric, last_transaction_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (
    SELECT m.user_id, m.role, m.chip_balance
      FROM public.fn_club_cashier_members_v2(p_club_id) m
     WHERE auth.uid() IS NOT NULL
  )
  SELECT s.user_id,
         CASE WHEN s.role <> 'admin' THEN coalesce(s.chip_balance, 0) END,
         CASE WHEN s.role IN ('owner','co_owner','admin','super_agent','agent','sub_agent')
              THEN coalesce(a.agent_wallet_balance, 0) END,
         greatest(f.at, t.at)
    FROM scope s
    LEFT JOIN public.agents a ON a.club_id = p_club_id AND a.user_id = s.user_id
    LEFT JOIN LATERAL (
      SELECT ct.created_at AS at
        FROM public.chip_transactions ct
       WHERE ct.club_id = p_club_id AND ct.from_user_id = s.user_id
         AND ct.transaction_type = ANY ('{agent_wallet_send,agent_wallet_claim_back,agent_wallet_self_stake,club_bank_send,horse_treasury_funding,club_bank_claim,club_bank_reversal,admin_removal,mint,treasury_mint,treasury_burn,treasury_debit,treasury_credit,peer_transfer,promo_wallet_send,club_promo_send,promo_disbursement,club_opening_grant,rakeback,commission_claim,overlay_funding,overlay_rebank,union_transfer,union_transfer_reversal,union_promo_send,union_promo_to_club,union_promo_clawback,union_clawback,leave_club_chip_return,default_mint_correction,promo_closed_on_union_join,tournament_ticket_issue,tournament_ticket_cancel,transfer,cashout_request_escrow,cashout_approved,cashout_denied,cashout_cancelled,cashout_expired_refund}'::text[])
       ORDER BY ct.created_at DESC
       LIMIT 1
    ) f ON true
    LEFT JOIN LATERAL (
      SELECT ct.created_at AS at
        FROM public.chip_transactions ct
       WHERE ct.club_id = p_club_id AND ct.to_user_id = s.user_id
         AND ct.transaction_type = ANY ('{agent_wallet_send,agent_wallet_claim_back,agent_wallet_self_stake,club_bank_send,horse_treasury_funding,club_bank_claim,club_bank_reversal,admin_removal,mint,treasury_mint,treasury_burn,treasury_debit,treasury_credit,peer_transfer,promo_wallet_send,club_promo_send,promo_disbursement,club_opening_grant,rakeback,commission_claim,overlay_funding,overlay_rebank,union_transfer,union_transfer_reversal,union_promo_send,union_promo_to_club,union_promo_clawback,union_clawback,leave_club_chip_return,default_mint_correction,promo_closed_on_union_join,tournament_ticket_issue,tournament_ticket_cancel,transfer,cashout_request_escrow,cashout_approved,cashout_denied,cashout_cancelled,cashout_expired_refund}'::text[])
       ORDER BY ct.created_at DESC
       LIMIT 1
    ) t ON true
$function$;

REVOKE ALL ON FUNCTION public.fn_cashier_roster_sort_keys(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cashier_roster_sort_keys(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_cashier_roster_sort_keys(uuid) IS
  'Cashier roster sort keys (Dan 2026-11-13): player wallet, agent wallet and last cashier transaction for every member in the viewer''s fn_club_cashier_members_v2 scope.';

COMMIT;
