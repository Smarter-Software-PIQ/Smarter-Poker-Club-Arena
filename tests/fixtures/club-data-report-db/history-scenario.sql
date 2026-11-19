-- A later buy-in at the same table must not change the historical club.
-- Also prove the dated seat fallback and preserve the per-hand witness.
-- Owner rule 2026-11-15 (20261116021751): P joined SHARK (S) first and plays
-- through JAQK (J). Dealt in with a contribution of 0 there is no witness on
-- the hand. The hand still counts for the club of the OCCUPANCY it was dealt
-- from - named by the hand's own commit record (seat_joined_at) - read from
-- that occupancy's receipt, seat row or P's witness on a neighbouring hand of
-- the same occupancy; else the table's club. Never SHARK by membership, never
-- a different sitting: a re-sit through another club with no exit row in
-- between, an exit row of a later occupancy, a receipt of an older occupancy,
-- or a club changed in the middle of a sitting.
-- One union cash hand: P dealt in from the occupancy that sat down at p_sj,
-- contributing 0 (p_club 0) or 2 with a witness through p_club; X pays 4
-- through K. The commit record names every player's occupancy.
CREATE OR REPLACE FUNCTION pg_temp.hist_hand(p_id uuid, p_table uuid, p_table_club uuid, p_at timestamptz,
    p_player uuid, p_club uuid, p_sj timestamptz, p_payer uuid, p_payer_club uuid) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_hand uuid := gen_random_uuid(); v_contrib numeric := CASE WHEN p_club IS NULL THEN 0 ELSE 2 END;
BEGIN
  INSERT INTO rake_records(id,hand_id,table_id,club_id,is_tournament,rake_amount,player_contributions,created_at)
    VALUES(p_id,v_hand,p_table,p_table_club,false,4,jsonb_build_object(p_player::text,v_contrib,p_payer::text,4),p_at);
  INSERT INTO hand_atomic_commits(table_id,hand_id,stack_result)
    VALUES(p_table,v_hand,jsonb_build_object('request',jsonb_build_object('stacks',jsonb_build_array(
      jsonb_build_object('user_id',p_player,'seat_id',gen_random_uuid(),'seat_joined_at',p_sj),
      jsonb_build_object('user_id',p_payer,'seat_id',gen_random_uuid(),'seat_joined_at',p_at-interval '3 hours')))));
  INSERT INTO rake_attributions(rake_record_id,hand_id,player_id,club_id,table_id,created_at)
    VALUES(p_id,v_hand,p_payer,p_payer_club,p_table,p_at);
  IF p_club IS NOT NULL THEN
    INSERT INTO rake_attributions(rake_record_id,hand_id,player_id,club_id,table_id,created_at)
      VALUES(p_id,v_hand,p_player,p_club,p_table,p_at);
  END IF;
END $f$;
DO $$
DECLARE
  J constant uuid := 'a0000000-0000-0000-0000-000000000001';
  S constant uuid := 'a4143400-0000-0000-0000-000000000001';
  U constant uuid := 'fade0000-0000-0000-0000-000000000001';
  P constant uuid := '00000000-0000-0000-0000-0000000000b1';
  T uuid := gen_random_uuid(); T2 uuid := gen_random_uuid();
  H uuid := gen_random_uuid(); H2 uuid := gen_random_uuid();
  X constant uuid := '00000000-0000-0000-0000-0000000000e9';
  K constant uuid := 'a0000000-0000-0000-0000-0000000000e9';
  T3 uuid := gen_random_uuid(); T4 uuid := gen_random_uuid(); T5 uuid := gen_random_uuid();
  H3 uuid := gen_random_uuid(); H4 uuid := gen_random_uuid(); H5 uuid := gen_random_uuid();
  H4B uuid := gen_random_uuid(); H6 uuid := gen_random_uuid(); H7 uuid := gen_random_uuid();
  T4B uuid := gen_random_uuid(); T6 uuid := gen_random_uuid(); T7 uuid := gen_random_uuid(); n bigint; txt text;
  at_hand timestamptz := now() - interval '36 hours';
  failures text[] := '{}'; v numeric;
BEGIN
  INSERT INTO tables(id,club_id,union_id,name) VALUES(T,S,U,'Historical receipt'),(T2,S,U,'Historical seat');
  INSERT INTO cash_participant_funding_receipts(operation_kind,table_id,account_entity_id,funding_club_id,seat_joined_at)
    VALUES('buyin',T,P,J,at_hand-interval '1 hour'),('buyin',T,P,S,at_hand+interval '1 hour');
  INSERT INTO table_seats(table_id,user_id,club_id,stack,left_at,joined_at)
    VALUES(T2,P,J,0,at_hand+interval '30 minutes',at_hand-interval '1 hour'),
          (T2,P,S,100,NULL,at_hand+interval '1 hour');
  INSERT INTO rake_records(id,table_id,club_id,is_tournament,rake_amount,player_contributions,created_at)
    VALUES(H,T,U,false,10,jsonb_build_object(P::text,1.5),at_hand),
          (H2,T2,U,false,7,jsonb_build_object(P::text,2.5,'malformed','ignored'),at_hand);
  SELECT sum(rake) INTO v FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H]) WHERE club_id=J;
  IF v IS DISTINCT FROM 10::numeric THEN failures:=array_append(failures,'later receipt moved historical rake'); END IF;
  SELECT sum(rake) INTO v FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H2]) WHERE club_id=J;
  IF v IS DISTINCT FROM 7::numeric THEN failures:=array_append(failures,'later seat moved historical rake'); END IF;
  SELECT sum(rake) INTO v FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H,H2]);
  IF v IS DISTINCT FROM 17::numeric THEN failures:=array_append(failures,'rake conservation failed'); END IF;
  INSERT INTO rake_attributions(rake_record_id,player_id,club_id) VALUES(H,P,S);
  SELECT sum(rake) INTO v FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H]) WHERE club_id=S;
  IF v IS DISTINCT FROM 10::numeric THEN failures:=array_append(failures,'witness lost precedence'); END IF;
  -- Zero contributions with no witness on the hand. X pays the rake through
  -- a third club K, so every hand P adds is visible. Each hand's commit
  -- record names P's occupancy by its seat_joined_at.
  INSERT INTO tables(id,club_id,union_id,name) VALUES(T3,U,U,'Same sitting, later hand'),(T4,U,U,'Re-sit through another club'),(T4B,U,U,'Re-sit, later hand'),
    (T5,U,U,'Exit of a later occupancy'),(T6,U,U,'Club changed mid-sitting'),(T7,U,U,'Receipt of an older occupancy');
  -- T3: P (sat at at_hand-10m through JAQK) pays into a later hand of the same sitting.
  PERFORM pg_temp.hist_hand(H3,T3,U,at_hand,P,NULL::uuid,at_hand-interval '10 minutes',X,K);
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T3,U,at_hand+interval '5 minutes',P,J,at_hand-interval '10 minutes',X,K);
  -- T4: P sat through SHARK at at_hand-2h and paid in (witness SHARK), busted
  -- (no exit row: a seat left with 0 chips logs none), re-sat through JAQK at
  -- at_hand-30m and is dealt H4 with 0. Nothing of the JAQK sitting is witnessed.
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T4,U,at_hand-interval '90 minutes',P,S,at_hand-interval '2 hours',X,K);
  PERFORM pg_temp.hist_hand(H4,T4,U,at_hand,P,NULL::uuid,at_hand-interval '30 minutes',X,K);
  -- T4b: the same re-sit, and this time the JAQK sitting pays a later hand.
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T4B,U,at_hand-interval '90 minutes',P,S,at_hand-interval '2 hours',X,K);
  PERFORM pg_temp.hist_hand(H4B,T4B,U,at_hand,P,NULL::uuid,at_hand-interval '30 minutes',X,K);
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T4B,U,at_hand+interval '3 minutes',P,J,at_hand-interval '30 minutes',X,K);
  -- T5: P's JAQK sitting (at_hand-10m) ends in a bust-out with no exit row;
  -- P re-sits through SHARK at at_hand+20m and leaves with chips: the only
  -- exit row, at_hand+40m, belongs to the later SHARK occupancy.
  PERFORM pg_temp.hist_hand(H5,T5,U,at_hand,P,NULL::uuid,at_hand-interval '10 minutes',X,K);
  INSERT INTO ca_seat_stack_exits(table_id,user_id,club_id,stack,exit_kind,occurred_at)
    VALUES(T5,P,S,50,'left',at_hand+interval '40 minutes');
  -- T6: one sitting (at_hand-1h) witnessed JAQK before H6 and SHARK after it.
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T6,U,at_hand-interval '5 minutes',P,J,at_hand-interval '1 hour',X,K);
  PERFORM pg_temp.hist_hand(H6,T6,U,at_hand,P,NULL::uuid,at_hand-interval '1 hour',X,K);
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T6,U,at_hand+interval '5 minutes',P,S,at_hand-interval '1 hour',X,K);
  -- T7: an older SHARK occupancy left a buy-in receipt; H7's JAQK occupancy
  -- (at_hand-20m) has none, and pays a later hand.
  INSERT INTO cash_participant_funding_receipts(operation_kind,table_id,account_entity_id,funding_club_id,seat_joined_at)
    VALUES('buyin',T7,P,S,at_hand-interval '6 hours');
  PERFORM pg_temp.hist_hand(H7,T7,U,at_hand,P,NULL::uuid,at_hand-interval '20 minutes',X,K);
  PERFORM pg_temp.hist_hand(gen_random_uuid(),T7,U,at_hand+interval '2 minutes',P,J,at_hand-interval '20 minutes',X,K);

  SELECT count(*) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H3,H4,H4B,H5,H6,H7]) WHERE club_id=S;
  IF n<>0 THEN failures:=array_append(failures,'a zero contribution counted the hand for another sitting''s club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H3]) WHERE club_id=J;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'the same sitting did not keep the hand in its club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H4]) WHERE club_id=U;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'a re-sit through another club took the earlier sitting''s club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H4B]) WHERE club_id=J;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'a re-sit did not keep the hand in its own sitting''s club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H5]) WHERE club_id=U;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'an exit row of a later occupancy placed the hand'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H6]) WHERE club_id=U;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'a club changed mid-sitting was guessed'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H7]) WHERE club_id=J;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'a receipt of an older occupancy placed the hand'); END IF;
  SELECT sum(rake) INTO v FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H3,H4,H4B,H5,H6,H7]) WHERE club_id=K;
  IF v IS DISTINCT FROM 24::numeric THEN failures:=array_append(failures,'zero-contribution rows moved rake: '||coalesce(v::text,'none')); END IF;
  -- Per-rule counts: read-only, and they add up to the stored calculation.
  IF to_regprocedure('public.fn_ca_club_rake_daily_rule_counts(timestamptz,timestamptz)') IS NULL THEN
    failures:=array_append(failures,'no per-rule counts');
  ELSE
    SELECT string_agg(r, ',' ORDER BY r) INTO txt FROM (
      SELECT p.rule || ':' || p.club_id::text AS r FROM fn_ca_club_rake_daily_parts(at_hand,at_hand,ARRAY[H,H2,H3,H4,H5,H6,H7]) p
       WHERE p.hands > 0 AND p.club_id IS DISTINCT FROM K) z;
    IF txt IS DISTINCT FROM concat_ws(',', 'same_sitting:'||J, 'same_sitting:'||J, 'seat_unbound:'||J, 'table_club:'||U, 'table_club:'||U, 'table_club:'||U, 'witness:'||S) THEN
      failures:=array_append(failures,'per-rule parts: '||coalesce(txt,'none'));
    END IF;
    SELECT count(*) INTO n FROM (
      SELECT c.club_id, c.stat_date, c.hands FROM fn_ca_club_rake_daily_compute(date_trunc('day',at_hand),date_trunc('day',at_hand)+interval '1 day',NULL) c
      EXCEPT
      SELECT r.club_id, r.stat_date, sum(r.hands)::bigint FROM fn_ca_club_rake_daily_rule_counts(date_trunc('day',at_hand),date_trunc('day',at_hand)+interval '1 day') r
       GROUP BY r.club_id, r.stat_date) d;
    IF n<>0 THEN failures:=array_append(failures,'per-rule counts do not add up to the calculation'); END IF;
  END IF;
  IF cardinality(failures)>0 THEN RAISE EXCEPTION 'history regression: %',array_to_string(failures,', '); END IF;
  RAISE NOTICE 'HISTORY SCENARIO PASSED';
END $$;
