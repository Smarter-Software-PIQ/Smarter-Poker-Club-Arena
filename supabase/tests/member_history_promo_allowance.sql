-- Isolated chip-wallet-choice fixture: owner reads the selected agent's book.
-- Same recipient across agents and destinations, strict 168-hour boundary,
-- later receipts, independent clubs, non-agent sends, and page-size isolation.
BEGIN;
DO $test$
DECLARE
  club uuid := '00000000-0000-0000-0000-000000000001';
  owner_id uuid := '00000000-0000-0000-0000-000000000002';
  agent uuid := '00000000-0000-0000-0000-000000000003';
  other_agent uuid := '00000000-0000-0000-0000-000000000004';
  recipient uuid := '00000000-0000-0000-0000-000000000005';
  stamp timestamptz := '2026-11-14T18:26:00Z';
  picked uuid := '20000000-0000-0000-0000-000000000001';
  used numeric;
BEGIN
  INSERT INTO chip_transactions(id,club_id,from_user_id,to_user_id,created_at,amount,transaction_type,metadata)
  SELECT id, c, sender, player, at_time, amt, kind,
         jsonb_build_object('actor_role',role,'destination',dest)
    FROM (VALUES
      (picked,club,agent,recipient,stamp,20,'promo_wallet_send','super_agent','player_wallet'),
      (gen_random_uuid(),club,other_agent,recipient,stamp-interval '167 hours',30,'promo_wallet_send','agent','promo_wallet'),
      (gen_random_uuid(),club,other_agent,recipient,stamp-interval '168 hours',10,'promo_wallet_send','sub_agent','player_wallet'),
      (gen_random_uuid(),club,other_agent,recipient,stamp+interval '1 second',10,'promo_wallet_send','sub_agent','player_wallet'),
      ('30000000-0000-0000-0000-000000000001'::uuid,club,other_agent,recipient,stamp,10,'promo_wallet_send','agent','player_wallet'),
      (gen_random_uuid(),gen_random_uuid(),agent,recipient,stamp,10,'promo_wallet_send','agent','player_wallet'),
      (gen_random_uuid(),club,agent,other_agent,stamp-interval '1 hour',10,'promo_wallet_send','agent','player_wallet'),
      (gen_random_uuid(),club,owner_id,recipient,stamp-interval '1 hour',10,'promo_wallet_send','owner','player_wallet'),
      (gen_random_uuid(),club,agent,recipient,stamp-interval '1 hour',10,'peer_transfer','agent','player_wallet')
    ) receipt(id,c,sender,player,at_time,amt,kind,role,dest);
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SELECT (metadata->>'promo_used_after_send')::numeric INTO STRICT used
    FROM fn_cashier_history_feed(club,'club',p_person=>agent,p_limit=>1) WHERE id=picked;
  IF used IS DISTINCT FROM 50 THEN RAISE EXCEPTION 'Wrong historical total: %',used; END IF;
  IF EXISTS (SELECT FROM fn_cashier_history_feed(club,'club',p_person=>agent)
             WHERE transaction_type='peer_transfer' AND metadata ? 'promo_used_after_send') THEN
    RAISE EXCEPTION 'Player wallet transfer labelled as promo';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',recipient::text,true);
  IF EXISTS (SELECT FROM fn_cashier_history_feed(club,'club',p_person=>agent)) THEN
    RAISE EXCEPTION 'Member could read another agent history';
  END IF;
END
$test$;
ROLLBACK;
