-- The member book filters its authorized sender and recipient index scans before
-- either scan applies a cursor-page limit. Older cashier clients retain their
-- existing kinds, invoice search and bounded club-wide directory search.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure) LIKE '%member_held_cashout%' AND to_regprocedure('public.fn_cashier_history_funding_wallet(text,jsonb)') IS NOT NULL)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- Source of the displayed walletRoute. Legacy claims and reversals stored the
-- wallet being reclaimed in destination. A peer transfer without a recorded
-- route has no known source. Unknown routes stay visible under All Wallets.
CREATE FUNCTION public.fn_cashier_history_funding_wallet(p_type text, p_metadata jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog AS $wallet$
  WITH claim AS (
    SELECT lower(CASE p_type
      WHEN 'club_bank_reversal' THEN coalesce(p_metadata->>'destination', p_metadata->>'source')
      WHEN 'agent_wallet_claim_back' THEN coalesce(p_metadata->>'source', p_metadata->>'destination')
      ELSE p_metadata->>'source' END) AS wallet
  )
  SELECT CASE
    WHEN p_type IN ('agent_wallet_send', 'agent_wallet_self_stake') THEN 'agent_wallet'
    WHEN p_type IN ('club_bank_send', 'horse_treasury_funding') THEN 'club_bank'
    WHEN p_type = 'cashout_request_escrow' THEN 'player_wallet'
    WHEN p_type IN ('cashout_approved','cashout_denied','cashout_cancelled','cashout_expired_refund') THEN 'held_cashout'
    WHEN p_type = 'peer_transfer' AND p_metadata->>'source' = 'player_wallet'
         AND nullif(p_metadata->>'destination','') IS NOT NULL THEN 'player_wallet'
    WHEN p_type = 'promo_wallet_send' THEN 'promo_wallet'
    WHEN p_type = 'club_promo_send' THEN 'club_promo_wallet'
    WHEN p_type IN ('agent_wallet_claim_back','admin_removal','club_bank_claim','club_bank_reversal') THEN
      CASE WHEN wallet IN ('player_wallet','agent_wallet','promo_wallet','club_bank','club_promo_wallet') THEN wallet
           WHEN p_type IN ('club_bank_claim','club_bank_reversal') THEN 'agent_wallet'
           ELSE 'player_wallet' END
  END FROM claim
$wallet$;
REVOKE ALL ON FUNCTION public.fn_cashier_history_funding_wallet(text,jsonb) FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure);
  old_kinds constant text := $sql$IF v_kind NOT IN ('all', 'cashout', 'transfer', 'game') THEN$sql$;
  new_kinds constant text := $sql$IF v_kind NOT IN ('all', 'cashout', 'transfer', 'game',
      'member_all', 'member_player_wallet', 'member_agent_wallet', 'member_promo_wallet',
      'member_club_bank', 'member_club_promo_wallet', 'member_held_cashout')
      OR (left(v_kind, 7) = 'member_' AND p_person IS NULL) THEN$sql$;
  old_search constant text := '  IF v_search IS NOT NULL THEN';
  new_search constant text := $sql$
  IF left(v_kind, 7) = 'member_' THEN
    IF v_kind <> 'member_all' THEN
      v_filter := v_filter || ' AND public.fn_cashier_history_funding_wallet(ct.transaction_type, ct.metadata) = $13';
    END IF;
    IF v_search IS NOT NULL THEN
      -- Only the opposite, visible party of this receipt can match. Looking up
      -- that profile also finds former members and has no directory result cap.
      v_filter := v_filter || $query$ AND EXISTS (
        SELECT 1 FROM public.profiles cp
        WHERE cp.id = CASE WHEN ct.from_user_id = $11 THEN ct.to_user_id
                           WHEN ct.transaction_type = 'horse_treasury_funding'
                             OR (ct.transaction_type = 'club_bank_send'
                               AND $2 IS DISTINCT FROM ct.from_user_id AND $2 IS DISTINCT FROM ct.to_user_id)
                           THEN NULL ELSE ct.from_user_id END
          AND strpos(lower(public.fn_arena_name(cp.alias, cp.username, cp.display_name,
                         cp.first_name, cp.last_name, cp.full_name)), lower($12)) > 0
      )$query$;
    END IF;
  ELSIF v_search IS NOT NULL THEN$sql$;
  old_args constant text := 'v_limit, v_ids, v_match, p_person;';
BEGIN
  IF md5(definition) <> '5fb4cd6ebe8ed1005a38db1de36efab0' THEN
    RAISE EXCEPTION 'Cashier history feed changed before member filter installation';
  END IF;
  IF strpos(definition,old_kinds) = 0 OR strpos(definition,old_search) = 0 OR strpos(definition,old_args) = 0 THEN
    RAISE EXCEPTION 'Member filter anchors missing';
  END IF;
  definition := replace(definition,old_kinds,new_kinds);
  definition := replace(definition,old_search,new_search);
  EXECUTE replace(definition,old_args,'v_limit, v_ids, v_match, p_person, v_search, substr(v_kind,8);');
END
$migration$;
COMMIT;
