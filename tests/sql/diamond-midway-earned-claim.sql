-- This transaction uses the synthetic Midway created by the source-split probe.
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"authenticated"}';
DO $test$
DECLARE
 host constant uuid:='fade0000-0000-0000-0000-000000000001'; club constant uuid:='d1000000-0000-4000-8000-000000000059';
 player constant uuid:='d1000000-0000-4000-8000-000000000005'; owner_id constant uuid:='d1000000-0000-4000-8000-000000000002';
 route text; target text; ticket uuid; seed text; spin jsonb; a public.wheel_bonus_awards; stage jsonb; answer jsonb;
 round_id uuid; r public.crash_rounds; original_request uuid; second_request uuid; due public.wheel_midway_prize_claims; original_cap numeric;
BEGIN
 INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance) VALUES(club,player,'player','active',0);
 INSERT INTO public.wheel_configs(host_id,host_kind,enabled,segment_version,purchased_only,welcome_spin_enabled,min_seconds_between_spins)
 VALUES(host,'union',true,4,false,false,0);
 INSERT INTO public.wheel_pools(host_id,diamond_float,diamond_seed) VALUES(host,2500,2500);
 INSERT INTO public.diamond_spins_owner_consents(host_id,owner_id,host_kind,terms_version,terms_text)
 VALUES(host,owner_id,'union','diamond-spins-2026-09-14-v1','Isolated Midway claim proof');
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips,max_multiplier_cents)
 SELECT host,'union',g,true,0,1,2000 FROM unnest(ARRAY['crash','plinko','mines','crossing']) g;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT host,g FROM unnest(ARRAY['crash','plinko','mines','crossing']) g;
 UPDATE public.diamond_wheel_release SET enabled=true;
 SELECT per_operation_cap_chips INTO original_cap FROM public.ca_mint_policy WHERE id=1;
 FOREACH route IN ARRAY ARRAY['crash','plinko','legacy_plinko','mines','crossing'] LOOP
  target:=CASE WHEN route='legacy_plinko' THEN 'plinko' ELSE route END;
  BEGIN
   FOR i IN 1..1000 LOOP
    BEGIN
     seed:=encode(extensions.digest('midway-claim:'||target||':'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
     INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash) VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
     spin:=public.fn_wheel_spin_v2(club,ticket,'midway-claim',100,'paid',NULL);
     IF spin->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Cannot draw fixture: %',spin; END IF;
     SELECT * INTO a FROM public.wheel_bonus_awards WHERE spin_id=(spin->>'spin_id')::uuid;
     IF a.game=target THEN EXIT; END IF;
     RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='next sealed draw';
    EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; END;
   END LOOP;
   IF a.game IS DISTINCT FROM target THEN RAISE EXCEPTION 'Missing earned game %',target; END IF;
   ticket:=gen_random_uuid(); original_request:=gen_random_uuid(); second_request:=gen_random_uuid();
   INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash)
    VALUES(ticket,player,target,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   UPDATE public.ca_mint_policy SET per_operation_cap_chips=0.01 WHERE id=1;
   IF route='legacy_plinko' THEN
     answer:=public.fn_wheel_bonus_start(a.id,ticket,'held-plinko',false,NULL,1,7,NULL,NULL);
   ELSIF target='plinko' THEN
     answer:=public.fn_wheel_plinko_begin(a.id,ticket,'held-plinko',false,1,7,original_request,true);
   ELSE
     stage:=public.fn_wheel_bonus_start(a.id,ticket,'held-round',false,CASE target WHEN 'mines' THEN '6' WHEN 'crossing' THEN 'road' END,NULL,NULL,NULL,CASE WHEN target IN ('mines','crossing') THEN 2 END);
     IF stage->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Could not start %: %',target,stage; END IF;
     IF target='crash' THEN
       SELECT * INTO STRICT r FROM public.crash_rounds WHERE commit_id=ticket; round_id:=r.id;
       PERFORM set_config('app.ledger_maintenance','private held flight',true);
       UPDATE public.crash_rounds SET started_at=clock_timestamp()-interval '10 seconds' WHERE id=round_id;
       PERFORM set_config('app.ledger_maintenance','',true);
       answer:=public.fn_crash_cashout(round_id,130);
     ELSE
       SELECT id INTO STRICT round_id FROM public.diamond_choice_rounds WHERE commit_id=ticket;
       answer:=public.fn_choice_act(round_id,'pick',0,0);
       answer:=public.fn_choice_act(round_id,'cashout',NULL,1);
     END IF;
   END IF;
   IF answer->>'pending_prize' IS DISTINCT FROM 'true' OR answer->>'paid' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Unfunded % was not reserved: %',target,answer; END IF;
   SELECT * INTO STRICT due FROM public.wheel_midway_prize_claims WHERE player_id=player AND paid_at IS NULL;
   IF due.amount IS DISTINCT FROM (answer->>'prize_chips')::numeric OR
    (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player)<>0 THEN RAISE EXCEPTION 'Unpaid % reported a credit',target; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.fn_wheel_pending_chip_prizes(club)) c
      WHERE c->>'key'=due.prize_key AND (c->>'chips')::numeric=due.amount)
      OR public.fn_wheel_claim_chip_prize(gen_random_uuid(),due.prize_key)->>'paid'='true' THEN
    RAISE EXCEPTION 'Unpaid % prize was not visible to its player or escaped club isolation',target; END IF;
   UPDATE public.ca_mint_policy SET per_operation_cap_chips=original_cap WHERE id=1;
   IF target='crash' THEN
     PERFORM set_config('app.ledger_maintenance','private delayed retry',true);
     UPDATE public.crash_rounds SET started_at=clock_timestamp()-interval '15 minutes' WHERE id=round_id;
     PERFORM set_config('app.ledger_maintenance','',true);
     IF public.fn_wheel_claim_chip_prize(club,due.prize_key)->>'paid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Cannot claim the original Crash flight'; END IF;
     answer:=public.fn_crash_settle(round_id,false);
     IF answer#>>'{outcome,cashout_cents}' IS DISTINCT FROM '130' THEN RAISE EXCEPTION 'Delayed retry replaced captured cashout: %',answer; END IF;
   ELSIF route='legacy_plinko' THEN
     IF public.fn_wheel_claim_chip_prize(club,due.prize_key)->>'paid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Legacy Plinko claim did not pay'; END IF;
     answer:=public.fn_wheel_bonus_start(a.id,ticket,'held-plinko',false,NULL,1,7,NULL,NULL);
     IF answer->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Legacy Plinko retry did not settle'; END IF;
   ELSIF target='plinko' THEN
     answer:=public.fn_wheel_plinko_release(a.id,second_request,true);
     IF answer<>public.fn_wheel_plinko_release(a.id,original_request,true) THEN RAISE EXCEPTION 'Original held Plinko request did not replay'; END IF;
   ELSE
     IF public.fn_wheel_claim_chip_prize(club,due.prize_key)->>'paid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Choice claim did not pay'; END IF;
     answer:=public.fn_choice_act(round_id,'pick',1,1);
     IF answer->>'status' IS DISTINCT FROM 'cashed' THEN RAISE EXCEPTION 'Retry changed the earned cashout: %',answer; END IF;
   END IF;
   IF answer->>'ok' IS DISTINCT FROM 'true' OR (SELECT paid_at FROM public.wheel_midway_prize_claims WHERE prize_key=due.prize_key) IS NULL
     OR (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player) IS DISTINCT FROM due.amount
     OR (SELECT sum(amount) FROM public.chip_transactions WHERE metadata->>'funding_key'=due.prize_key) IS DISTINCT FROM due.amount
    THEN RAISE EXCEPTION 'Held % claim did not reconcile: %, %',target,due,answer; END IF;
   IF public.fn_wheel_claim_chip_prize(club,due.prize_key)->>'paid' IS DISTINCT FROM 'true'
      OR public.fn_wheel_pending_chip_prizes(club)<>'[]'::jsonb OR
      (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player)<>due.amount THEN
     RAISE EXCEPTION 'Claim screen replay changed a paid %',target; END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore fixture';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
 END LOOP;
 UPDATE public.ca_mint_policy SET per_operation_cap_chips=.01 WHERE id=1;
 FOR i IN 1..1000 LOOP
  BEGIN
   ticket:=gen_random_uuid(); seed:=encode(extensions.digest('midway-wheel-claim:'||i,'sha256'),'hex');
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash) VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   spin:=public.fn_wheel_spin_v2(club,ticket,'saved-chip-prize',100,'paid',NULL);
   IF spin->>'chip_prize_reserved'='true' THEN EXIT; END IF;
   RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='next sealed draw';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; END;
 END LOOP;
 SELECT * INTO STRICT due FROM public.wheel_midway_prize_claims WHERE player_id=player AND paid_at IS NULL;
 IF due.amount IS DISTINCT FROM (spin->>'prize_chips')::numeric OR (SELECT chips_paid FROM public.wheel_pools WHERE host_id=host)<>0 OR
   (public.fn_wheel_state_v2(club,100)#>>'{pending_chip_prizes,0,key}') IS DISTINCT FROM due.prize_key OR
   public.fn_wheel_spin_v2(club,ticket,'saved-chip-prize',100,'paid',NULL)->>'spin_id' IS DISTINCT FROM spin->>'spin_id' OR
   public.fn_wheel_claim_chip_prize(club,due.prize_key)->>'paid' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Immediate prize did not retain the sealed wheel spin and unpaid balance: %',spin; END IF;
 PERFORM set_config('test.user',owner_id::text,true);
 IF public.fn_wheel_pending_chip_prizes(club)<>'[]'::jsonb OR public.fn_wheel_claim_chip_prize(club,due.prize_key)->>'ok'<>'false' THEN
  RAISE EXCEPTION 'Another player could access the reserved prize'; END IF;
 PERFORM set_config('test.user',player::text,true);
 UPDATE public.ca_mint_policy SET per_operation_cap_chips=original_cap WHERE id=1;
 FOR attempt IN 1..2 LOOP
  answer:=public.fn_wheel_claim_chip_prize(club,due.prize_key);
  IF answer->>'paid' IS DISTINCT FROM 'true' OR (answer->>'chips')::numeric<>due.amount
     OR (SELECT chips_paid FROM public.wheel_pools WHERE host_id=host)<>due.amount
     OR (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player)<>due.amount THEN
   RAISE EXCEPTION 'Immediate wheel claim did not settle exactly once: %',answer; END IF;
 END LOOP;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
