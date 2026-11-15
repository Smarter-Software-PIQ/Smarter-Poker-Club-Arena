-- Runs in the isolated cashier wallet qualification, with the installed
-- preimage, its migrations and the same authorized feed as the member record.
BEGIN;
DO $test$
DECLARE
  club uuid := gen_random_uuid();
  manager uuid := gen_random_uuid();
  agent uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  player uuid := gen_random_uuid();
  stamp timestamptz := '2026-11-14 18:26Z';
  first_id uuid := '50000000-0000-0000-0000-000000000001';
  second_id uuid := '50000000-0000-0000-0000-000000000002';
  found uuid[];
BEGIN
  INSERT INTO clubs(id,owner_id) VALUES (club,manager);
  INSERT INTO club_members(club_id,user_id,role,status,agent_id) VALUES
    (club,manager,'owner','active',NULL), (club,agent,'agent','active',manager),
    (club,player,'player','active',agent), (club,other,'agent','active',manager);
  INSERT INTO profiles(id,alias) VALUES (player,'Slice_of%Life'), (agent,'The Agent'), (other,'Hidden Sender');
  INSERT INTO chip_transactions(id,club_id,from_user_id,to_user_id,created_at,transaction_type,amount,metadata)
  SELECT gen_random_uuid(),club,agent,other,stamp+interval '1 hour'*n,'agent_wallet_send',1,'{}'
    FROM generate_series(1,30) n;
  INSERT INTO chip_transactions(id,club_id,from_user_id,to_user_id,created_at,transaction_type,amount,metadata) VALUES
    (first_id,club,agent,player,stamp,'promo_wallet_send',20,'{"actor_role":"agent"}'),
    (second_id,club,player,agent,stamp,'promo_wallet_send',30,'{"actor_role":"agent"}'),
    (gen_random_uuid(),club,agent,player,stamp,'peer_transfer',50,'{"source":"player_wallet","destination":"player_wallet"}'),
    (gen_random_uuid(),club,other,agent,stamp,'club_bank_send',10,'{}'),
    (gen_random_uuid(),gen_random_uuid(),agent,player,stamp,'promo_wallet_send',10,'{}');
  PERFORM set_config('request.jwt.claim.sub',manager::text,true);
  SELECT array_agg(id ORDER BY created_at DESC,id DESC) INTO found FROM fn_cashier_history_feed(
    club,'club','member_promo_wallet',p_person=>agent,p_search=>'sLiCe_of%',p_limit=>1);
  IF found IS DISTINCT FROM ARRAY[second_id] THEN RAISE EXCEPTION 'Wrong first filtered page: %',found; END IF;
  SELECT array_agg(id) INTO found FROM fn_cashier_history_feed(club,'club','member_promo_wallet',
    p_person=>agent,p_search=>'SLICE',p_before_at=>stamp,p_before_id=>second_id,p_limit=>1);
  IF found IS DISTINCT FROM ARRAY[first_id] THEN RAISE EXCEPTION 'Filtered cursor lost tied receipt: %',found; END IF;
  IF (SELECT count(*) FROM fn_cashier_history_feed(club,'club','member_player_wallet',p_person=>agent,p_search=>'%')) <> 1
    OR (SELECT count(*) FROM fn_cashier_history_feed(club,'club','member_all',p_person=>agent,p_search=>'_')) <> 3
    OR (SELECT count(*) FROM fn_cashier_history_feed(club,'club','member_agent_wallet',p_person=>agent)) <> 30 THEN
    RAISE EXCEPTION 'Literal search, source-only filtering, or older history failed';
  END IF;
  IF EXISTS (SELECT FROM fn_cashier_history_feed(club,'club','member_club_bank',p_person=>agent,p_search=>'hidden'))
    OR EXISTS (SELECT FROM fn_cashier_history_feed(club,'club','member_all',p_person=>agent,p_search=>'the agent')) THEN
    RAISE EXCEPTION 'Search matched a redacted operator or the selected member on a non-self transfer';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',player::text,true);
  IF EXISTS (SELECT FROM fn_cashier_history_feed(club,'club','member_all',p_person=>agent,p_search=>'Slice')) THEN
    RAISE EXCEPTION 'Unauthorized viewer could read member history';
  END IF;
  BEGIN
    PERFORM 1 FROM fn_cashier_history_feed(club,'club','member_promo_wallet');
    RAISE EXCEPTION 'Member filter accepted without a selected member';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('agent_wallet_claim_back','{"source":"promo_wallet","destination":"agent_wallet"}'::jsonb,'promo_wallet'),
      ('agent_wallet_claim_back','{"destination":"agent_wallet"}','agent_wallet'),
      ('club_bank_reversal','{"source":"club_bank","destination":"player_wallet"}','player_wallet'),
      ('club_promo_send','{"destination":"player_wallet"}','club_promo_wallet'),
      ('club_promo_send','{"destination":"tournament_ticket"}','club_promo_wallet'),
      ('cashout_approved','{}','held_cashout'),
      ('horse_treasury_funding','{}','club_bank'),
      ('peer_transfer','{}',NULL)
    ) r(kind,metadata,wallet) WHERE fn_cashier_history_funding_wallet(kind,metadata) IS DISTINCT FROM wallet
  ) THEN RAISE EXCEPTION 'Source-wallet classification mismatch'; END IF;
END
$test$;
ROLLBACK;
