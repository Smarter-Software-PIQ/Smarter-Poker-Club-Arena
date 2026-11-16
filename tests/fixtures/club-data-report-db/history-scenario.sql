-- A later buy-in at the same table must not change the historical club.
-- Also prove the dated seat fallback and preserve the per-hand witness.
-- Owner rule 2026-11-15 (20261116021751): P joined SHARK (S) first and plays
-- through JAQK (J). Dealt in with a contribution of 0 there is no witness, and
-- once the seat row is gone no receipt or seat either; the hand still counts
-- for the club the seat played through (its exit record, else P's own earlier
-- attribution in the same sitting), else the table's club - never SHARK.
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
  H4P uuid := gen_random_uuid(); n bigint;
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
  -- Zero contributions with no witness, no receipt and no seat left. X pays
  -- the rake through a third club K, so every hand P adds is visible.
  INSERT INTO tables(id,club_id,union_id,name) VALUES(T3,U,U,'Seat exit'),(T4,U,U,'Same sitting'),(T5,U,U,'No evidence');
  INSERT INTO rake_records(id,table_id,club_id,is_tournament,rake_amount,player_contributions,created_at)
    VALUES(H3,T3,U,false,4,jsonb_build_object(P::text,0,X::text,4),at_hand),
          (H4,T4,U,false,4,jsonb_build_object(P::text,0,X::text,4),at_hand),
          (H5,T5,U,false,4,jsonb_build_object(P::text,0,X::text,4),at_hand);
  INSERT INTO rake_attributions(rake_record_id,player_id,club_id) VALUES(H3,X,K),(H4,X,K),(H5,X,K);
  -- T3: the seat P held during the hand was left later, through JAQK.
  INSERT INTO ca_seat_stack_exits(table_id,user_id,club_id,stack,exit_kind,occurred_at)
    VALUES(T3,P,J,50,'left',at_hand+interval '20 minutes');
  -- T4: P paid into an earlier hand of the same sitting, attributed to JAQK.
  INSERT INTO rake_attributions(rake_record_id,player_id,club_id,table_id,created_at)
    VALUES(H4P,P,J,T4,at_hand-interval '5 minutes');
  -- T5: P's only earlier attribution there is from an older sitting through
  -- SHARK that ended (logged exit) before this hand: not this seat's club.
  INSERT INTO rake_attributions(rake_record_id,player_id,club_id,table_id,created_at)
    VALUES(gen_random_uuid(),P,S,T5,at_hand-interval '3 hours');
  INSERT INTO ca_seat_stack_exits(table_id,user_id,club_id,stack,exit_kind,occurred_at)
    VALUES(T5,P,S,30,'left',at_hand-interval '2 hours');
  SELECT count(*) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H3,H4,H5]) WHERE club_id=S;
  IF n<>0 THEN failures:=array_append(failures,'a zero contribution counted the hand for the first-joined club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H3]) WHERE club_id=J;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'the vacated seat did not keep the hand in its club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H4]) WHERE club_id=J;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'the same sitting did not keep the hand in its club'); END IF;
  SELECT sum(hands) INTO n FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H5]) WHERE club_id=U;
  IF n IS DISTINCT FROM 1::bigint THEN failures:=array_append(failures,'a hand with no club evidence left the table club'); END IF;
  SELECT sum(rake) INTO v FROM fn_ca_club_rake_daily_compute(at_hand,at_hand,ARRAY[H3,H4,H5]) WHERE club_id=K;
  IF v IS DISTINCT FROM 12::numeric THEN failures:=array_append(failures,'zero-contribution rows moved rake'); END IF;
  IF cardinality(failures)>0 THEN RAISE EXCEPTION 'history regression: %',array_to_string(failures,', '); END IF;
  RAISE NOTICE 'HISTORY SCENARIO PASSED';
END $$;
