-- Real paid-spin owner and independent exact probability checks. Private fixture only.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"authenticated"}';
DO $test$
DECLARE
 player constant uuid:='d1000000-0000-4000-8000-000000000005';
 club constant uuid:='d1000000-0000-4000-8000-000000000003';
 previous integer; super_game text; w integer[]; up integer[]; total integer;
 i integer; ord integer; game_count integer:=0; adjacent integer:=0; gap integer:=0; max_gap integer:=0;
 was_game boolean:=false; is_game boolean; prior_ord integer; prior_game text; game text;
 ticket uuid; seed text; receipt jsonb; replay jsonb; quote jsonb; samples jsonb:='{}';
 legacy jsonb; refused jsonb; before_diamonds bigint; before_chips numeric; paid numeric; row_weights integer[]; prior_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'Private accounting fixture required'; END IF;
 -- Old tabs receive an actionable refusal before any new charge. Old paid
 -- receipts still replay unchanged through their original endpoint.
 SELECT diamonds INTO before_diamonds FROM public.profiles WHERE id=player;
 ticket:=gen_random_uuid();
 SET LOCAL ROLE authenticated;
 refused:=public.fn_wheel_spin_v2(club,ticket,'old-tab',100,'paid',NULL);
 RESET ROLE;
 IF refused->>'ok'<>'false' OR refused->>'error' NOT LIKE 'Refresh Diamond Spins%'
  OR (SELECT diamonds FROM public.profiles WHERE id=player)<>before_diamonds
  OR EXISTS(SELECT 1 FROM public.wheel_spins WHERE commit_id=ticket)
  OR has_function_privilege('authenticated','public.fn_wheel_spin_v5_core(uuid,uuid,text,bigint,text,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Old-client admission or private-core permission failed'; END IF;
 IF to_regclass('pg_temp.wheel_quarter_legacy_receipt') IS NOT NULL THEN
  SELECT saved.receipt INTO STRICT legacy FROM pg_temp.wheel_quarter_legacy_receipt saved;
  SET LOCAL ROLE authenticated;
  replay:=public.fn_wheel_spin_v2(club,(legacy#>>'{fairness,commit_id}')::uuid,'before-quarter',100,'paid',NULL);
  RESET ROLE;
  IF replay-'replayed' IS DISTINCT FROM legacy-'replayed' OR replay->>'replayed'<>'true'
   OR (SELECT diamonds FROM public.profiles WHERE id=player)<>before_diamonds THEN
   RAISE EXCEPTION 'Original sealed4 receipt changed or charged again'; END IF;
 END IF;
 -- Exhaust every predecessor, including each Super result. Exact conditional
 -- probability (ordinary + Upgrade times its eventual game chance), not an EV.
 FOR previous IN 0..12 LOOP
  FOREACH super_game IN ARRAY ARRAY[NULL,'plinko','crash','crossing','mines'] LOOP
   CONTINUE WHEN super_game IS NOT NULL AND previous<>12;
   w:=public.fn_wheel_v5_weights(NULLIF(previous,0)::smallint,super_game);
   up:=public.fn_wheel_v4_upgrade_weights(CASE WHEN previous IN(1,4,7,10) THEN
     CASE previous WHEN 1 THEN 'plinko' WHEN 4 THEN 'crash' WHEN 7 THEN 'crossing' ELSE 'mines' END
     ELSE super_game END);
   SELECT sum(x)::integer INTO total FROM unnest(w) x;
   IF total<>100000 OR w[1]+w[4]+w[7]+w[10]+w[12]::numeric*(up[1]+up[2]+up[3]+up[4])/100000<>25000
    OR (previous>0 AND w[previous]<>0) OR EXISTS(SELECT 1 FROM unnest(w) x WHERE x<0) THEN
    RAISE EXCEPTION 'Wrong conditional25%% for predecessor % / %: %',previous,super_game,w; END IF;
   IF w[12]<>(CASE WHEN previous=12 THEN 0 ELSE 1000 END) THEN RAISE EXCEPTION 'Upgrade chance changed'; END IF;
   RAISE NOTICE 'V5_WEIGHT %',jsonb_build_object('previous',previous,'super_game',super_game,'weights',w);
  END LOOP;
 END LOOP;
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0,max_spins_per_player_per_day=1,
  purchased_only=true,welcome_spin_enabled=false WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,1000000 FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,min_seconds_between_rounds=0,max_multiplier_cents=2000 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM public.add_diamonds_to_balance(player,1000000,'adjustment','Private quarter-games fixture','wheel-v5-fixture-float',NULL);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 quote:=public.fn_wheel_state_v2(club,100);
 IF quote->>'contract_version'<>'5' OR quote->>'model_version'<>'wheel-v5' OR quote->>'available'<>'true' THEN
  RAISE EXCEPTION 'Wrong v5 quote: %',quote; END IF;
 samples:=jsonb_set(samples,ARRAY['quote'],quote);
 SELECT count(*) INTO prior_count FROM public.wheel_spins WHERE user_id=player;
 FOR i IN 1..2000 LOOP
  seed:=encode(extensions.digest('wheel-quarter-real-draw:'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
  INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
   VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
  SELECT diamonds INTO before_diamonds FROM public.profiles WHERE id=player;
  SELECT chip_balance INTO before_chips FROM public.club_members WHERE user_id=player AND club_id=club;
  SET LOCAL ROLE authenticated;
  receipt:=public.fn_wheel_spin_v5(club,ticket,'quarter-games',100,'paid',NULL);
  replay:=public.fn_wheel_spin_v5(club,ticket,'quarter-games',100,'paid',NULL);
  RESET ROLE;
  IF receipt->>'ok'<>'true' OR receipt->>'contract_version'<>'5' OR receipt->>'segment_version'<>'5'
   OR receipt#>>'{fairness,domain}'<>'wheel-v5' OR receipt->>'payout_rules_version'<>'2'
   OR replay->>'replayed'<>'true' OR receipt-'replayed' IS DISTINCT FROM replay-'replayed'
   OR (SELECT diamonds FROM public.profiles WHERE id=player)<>before_diamonds-100
   OR (SELECT count(*) FROM public.wheel_spins WHERE commit_id=ticket)<>1 THEN
   RAISE EXCEPTION 'Draw/debit/replay % failed: %',i,receipt; END IF;
  ord:=(receipt#>>'{outcome,ord}')::integer;
  game:=coalesce(receipt#>>'{secondary,outcome,game}',receipt#>>'{outcome,game}');
  SELECT array_agg(value::integer ORDER BY n) INTO row_weights
   FROM jsonb_array_elements_text(receipt#>'{fairness,weights}') WITH ORDINALITY x(value,n);
  IF row_weights IS DISTINCT FROM public.fn_wheel_v5_weights((receipt#>>'{fairness,previous,ord}')::smallint,
   CASE WHEN receipt#>>'{fairness,previous,tier}'='super' THEN receipt#>>'{fairness,previous,game}' END)
   OR ord=prior_ord OR (game IS NOT NULL AND game=prior_game) THEN RAISE EXCEPTION 'Wrong draw law %',i; END IF;
  is_game:=game IN('plinko','crash','crossing','mines');
  IF coalesce(is_game,false) THEN
   game_count:=game_count+1;
   IF was_game THEN adjacent:=adjacent+1; END IF;
   max_gap:=greatest(max_gap,gap);gap:=0;
   IF (receipt->>'minimum_bonus_payout_chips')::numeric<1.5 THEN RAISE EXCEPTION 'Game floor changed'; END IF;
  ELSE gap:=gap+1; END IF;
  was_game:=coalesce(is_game,false);
  IF receipt#>>'{outcome,kind}'='chips' OR receipt#>>'{secondary,outcome,kind}'='chips' THEN
   paid:=coalesce((receipt#>>'{secondary,outcome,amount}')::numeric,(receipt#>>'{outcome,amount}')::numeric);
   IF paid<0.5 OR (SELECT chip_balance FROM public.club_members WHERE user_id=player AND club_id=club)<>before_chips+paid THEN
    RAISE EXCEPTION 'Chip prize was not paid in full: %',receipt; END IF;
  END IF;
  IF NOT samples?ord::text THEN samples:=jsonb_set(samples,ARRAY[ord::text],receipt); END IF;
  IF ord=12 THEN samples:=jsonb_set(samples,ARRAY['upgrade-'||(receipt#>>'{secondary,outcome,kind}')],receipt); END IF;
  prior_ord:=ord;prior_game:=game;
  -- Fixture-only cleanup: every spin retains its actual ledger and receipt.
  -- Remove unplayed entitlements solely to exercise the next paid draw.
  DELETE FROM public.wheel_bonus_awards WHERE user_id=player;
  DELETE FROM public.wheel_card_awards WHERE user_id=player;
  UPDATE public.diamond_game_pools SET reserved_chips=0,wheel_allocated_diamonds=0 WHERE host_id=club;
 END LOOP;
 IF game_count NOT BETWEEN 430 AND 570 OR adjacent<1 OR max_gap<6
  OR NOT samples?'upgrade-bonus' OR NOT samples?'upgrade-chips'
  OR (SELECT count(*) FROM public.wheel_spins WHERE user_id=player)<>prior_count+2000 THEN
  RAISE EXCEPTION 'Unexpected real distribution games %, adjacent %, gap %',game_count,adjacent,max_gap; END IF;
 RAISE NOTICE 'V5_RECEIPTS %',samples;
 RAISE NOTICE 'PASS wheel quarter games:2000 real draws,% games,% adjacent pairs,% longest gap; exact25%% every predecessor, upgrade branches, single debit/replay and full prizes',game_count,adjacent,max_gap;
END $test$;
ROLLBACK;
