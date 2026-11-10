\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"authenticated"}';
DO $$
DECLARE player constant uuid:='d1000000-0000-4000-8000-000000000005';
 club constant uuid:='d1000000-0000-4000-8000-000000000003'; seed text; ticket uuid; a public.wheel_bonus_awards;
 first_id uuid:=gen_random_uuid(); last_id uuid:=gen_random_uuid(); spin jsonb; stage jsonb; replay jsonb; final jsonb; start_chips numeric; reserve_before numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN RAISE EXCEPTION 'Private fixture only'; END IF;
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0,welcome_spin_enabled=false WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,1 FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,min_seconds_between_rounds=0,max_multiplier_cents=2000 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 FOR i IN 1..500 LOOP
  BEGIN
   seed:=encode(extensions.digest('drop-one:'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash) VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SET LOCAL ROLE authenticated;
   spin:=public.fn_wheel_spin_v2(club,ticket,'earned-plinko',25,'paid',NULL);
   RESET ROLE;
   SELECT * INTO a FROM wheel_bonus_awards WHERE spin_id=(spin->>'spin_id')::uuid;
   IF a.game='plinko' THEN EXIT; END IF;
   RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='another fixture roll';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; END;
 END LOOP;
 IF a.game IS DISTINCT FROM 'plinko' THEN RAISE EXCEPTION 'No target award: %',spin; END IF;
 ticket:=gen_random_uuid();
 INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash) VALUES(ticket,player,'plinko',seed,encode(extensions.digest(seed,'sha256'),'hex'));
 SELECT chip_balance INTO STRICT start_chips FROM club_members WHERE club_id=club AND user_id=player;
 SELECT reserved_chips-a.reserved_chips INTO STRICT reserve_before FROM public.diamond_game_pools WHERE host_id=a.host_id AND game='plinko';
 SET LOCAL ROLE authenticated;
 stage:=public.fn_wheel_plinko_begin(a.id,ticket,'drop-one',false,1,7,first_id,false);
 replay:=public.fn_wheel_plinko_begin(a.id,ticket,'drop-one',false,1,7,first_id,false);
 IF stage<>replay OR stage ? 'server_seed' OR stage->>'complete' IS DISTINCT FROM 'false' OR jsonb_array_length(stage->'drops')<>1 OR stage->>'released_count'<>'1' THEN RAISE EXCEPTION 'Unsafe partial or replay: %',stage; END IF;
 IF stage->>'guarantee_top_up_chips' IS DISTINCT FROM '0' OR (stage->>'wheel_minimum_payout_chips')::numeric IS DISTINCT FROM ceil(a.base_diamonds*150::numeric/(stage->>'wheel_diamonds_per_chip')::numeric)/100 THEN RAISE EXCEPTION 'Wheel cost missing or altered'; END IF;
 IF (public.fn_wheel_bonus_state(club,'plinko',false,NULL,a.id)::text LIKE '%'||seed||'%') OR (public.fn_diamond_bonus_latest(club,'plinko')#>'{result,drops}') IS DISTINCT FROM stage->'drops' THEN RAISE EXCEPTION 'Another recovery API leaked the seal or returned stale drops'; END IF;
 IF public.fn_wheel_plinko_progress(NULL,club)-'operation_chips' IS DISTINCT FROM stage-'operation_chips' THEN RAISE EXCEPTION 'Cross-tab progress failed'; END IF;
 IF public.fn_wheel_plinko_release(a.id,first_id,true)->>'ok'<>'false' THEN RAISE EXCEPTION 'Mismatched release key accepted'; END IF;
 RESET ROLE;
 IF (SELECT reserved_chips FROM public.diamond_game_pools WHERE host_id=a.host_id AND game='plinko') IS DISTINCT FROM
 reserve_before+(SELECT (sealed_result->>'payout_chips')::numeric-released_chips FROM public.wheel_plinko_sessions WHERE award_id=a.id) THEN RAISE EXCEPTION 'Unreleased prize missing from game liabilities'; END IF;
 IF (SELECT chip_balance FROM club_members WHERE club_id=club AND user_id=player)<>start_chips+(stage->>'released_chips')::numeric THEN RAISE EXCEPTION 'Single drop ledger failed'; END IF;
 SET LOCAL ROLE authenticated;
 final:=public.fn_wheel_plinko_release(a.id,last_id,true);
 replay:=public.fn_wheel_plinko_release(a.id,last_id,true);
 RESET ROLE;
 IF (final->>'payout_chips')::numeric < (final->>'wheel_minimum_payout_chips')::numeric OR
 (final->>'guarantee_top_up_chips')::numeric IS DISTINCT FROM (final->>'payout_chips')::numeric-(SELECT sum((d->>'payout_chips')::numeric) FROM jsonb_array_elements(final->'drops') d) THEN RAISE EXCEPTION 'Final shortfall or misstated top-up'; END IF;
 IF final<>replay OR final->>'complete' IS DISTINCT FROM 'true' OR final->>'server_seed' IS DISTINCT FROM seed
 OR (final->>'released_count')::integer<>a.base_diamonds OR (final->>'released_chips')::numeric<>(final->>'payout_chips')::numeric
 OR (SELECT chip_balance FROM club_members WHERE club_id=club AND user_id=player)<>start_chips+(final->>'released_chips')::numeric
 OR (SELECT reserved_chips FROM public.diamond_game_pools WHERE host_id=a.host_id AND game='plinko') IS DISTINCT FROM reserve_before
 OR (SELECT count(*) FROM wheel_plinko_releases WHERE award_id=a.id)<>2 THEN RAISE EXCEPTION 'Final payout failed: %',final; END IF;
END $$;
DO $$
DECLARE space constant bigint:=281474976710656; reach bigint; pair integer[];
BEGIN
 FOREACH pair SLICE 1 IN ARRAY ARRAY[[300,85],[500,65],[1000,35],[1500,15]] LOOP
  reach:=floor(pair[2]::numeric*space/100);
  IF public.fn_crash_point_cents_v6(reach-1,1,.5)<pair[1] OR public.fn_crash_point_cents_v6(reach,1,.5)>=pair[1] THEN
   RAISE EXCEPTION 'Published reach boundary changed at %',pair;
  END IF;
 END LOOP;
 IF public.fn_crash_point_cents_v5(space-1,1,.5)<>125 OR public.fn_crash_point_cents_v6(space-1,1,.5)<>250 OR public.fn_crash_point_cents_v6(0,1,.5)<>2000 THEN RAISE EXCEPTION 'Sealed range changed'; END IF;
END $$;
DO $$
DECLARE player constant uuid:='d1000000-0000-4000-8000-000000000005';
 club constant uuid:='d1000000-0000-4000-8000-000000000003'; seed text; ticket uuid; a public.wheel_bonus_awards;
 spin jsonb; stage jsonb; settled jsonb; r public.crash_rounds; before_chips numeric; earned numeric; boost integer;
BEGIN
 FOREACH boost IN ARRAY ARRAY[1,2] LOOP
  BEGIN
   FOR i IN 1..1500 LOOP
    BEGIN
     seed:=encode(extensions.digest('flight:'||boost||':'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
     INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash) VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
     SET LOCAL ROLE authenticated;
     spin:=public.fn_wheel_spin_v2(club,ticket,'flight-prize',25,'paid',NULL);
     RESET ROLE;
     SELECT * INTO a FROM wheel_bonus_awards WHERE spin_id=(spin->>'spin_id')::uuid;
     IF a.game='crash' AND a.boost_multiplier=boost THEN EXIT; END IF;
     RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='next flight draw';
    EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; END;
   END LOOP;
   IF a.game IS DISTINCT FROM 'crash' OR a.boost_multiplier<>boost THEN RAISE EXCEPTION 'Expected earned Crash %',boost; END IF;
   ticket:=gen_random_uuid();
   INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash) VALUES(ticket,player,'crash',seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SELECT chip_balance INTO STRICT before_chips FROM club_members WHERE club_id=club AND user_id=player;
   SET LOCAL ROLE authenticated; stage:=public.fn_wheel_bonus_start(a.id,ticket,'flight',false,NULL,NULL,NULL,CASE WHEN boost=1 THEN 126 ELSE NULL END,NULL); RESET ROLE;
   SELECT * INTO STRICT r FROM crash_rounds WHERE commit_id=ticket;
   IF stage->>'payout_version' IS DISTINCT FROM '6' OR stage->>'crash_floor_cents'<>'250' OR r.crash_cents NOT BETWEEN 250 AND 2000 OR r.growth_k>.05 OR stage#>'{fairness,server_seed}' IS NOT NULL THEN RAISE EXCEPTION 'New public flight terms invalid: %',stage; END IF;
   PERFORM set_config('app.ledger_maintenance','private flight test',true);
   UPDATE crash_rounds SET started_at=clock_timestamp()-interval '10 minutes' WHERE id=r.id;
   PERFORM set_config('app.ledger_maintenance','',true);
   SET LOCAL ROLE authenticated; settled:=public.fn_crash_settle(r.id,false); RESET ROLE;
   earned:=ceil(a.base_diamonds*150::numeric/(settled->>'wheel_diamonds_per_chip')::numeric)/100;
   IF (settled#>>'{outcome,payout_chips}')::numeric<earned OR (settled->>'wheel_minimum_payout_chips')::numeric IS DISTINCT FROM earned
    OR (boost=1 AND settled->>'status' IS DISTINCT FROM 'cashed') OR (boost=2 AND settled->>'status' IS DISTINCT FROM 'crashed')
    OR (SELECT chip_balance FROM club_members WHERE club_id=club AND user_id=player) IS DISTINCT FROM before_chips+(settled#>>'{outcome,payout_chips}')::numeric
    THEN RAISE EXCEPTION 'Actual flight guarantee/terminal funding failed: %',settled; END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='reset funded draw';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
 END LOOP;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
