-- Only the isolated accounting fixture provides these user/club records.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"authenticated"}';
DO $probe$
DECLARE
 player constant uuid := 'd1000000-0000-4000-8000-000000000005';
 club constant uuid := 'd1000000-0000-4000-8000-000000000003';
 stake integer; ticket uuid; seed text; spin_result jsonb; replay jsonb; quote jsonb; balance integer;
 boost integer; attempt integer; spin_index integer; verified integer; game text; a public.wheel_bonus_awards; started jsonb; settled jsonb; before_chips numeric; payout numeric; round_id uuid; award_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'Private accounting fixture required';
 END IF;
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0,max_spins_per_player_per_day=1,
  purchased_only=true,welcome_spin_enabled=false WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,1 FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game)
 SELECT club,g FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,min_seconds_between_rounds=0,max_multiplier_cents=2000 WHERE host_id=club;
 UPDATE public.wheel_pools SET diamond_float=0 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 SELECT diamonds INTO STRICT balance FROM public.profiles WHERE id=player;
 IF balance<=2500 THEN RAISE EXCEPTION 'Expected large opening test wallet'; END IF;
 SET LOCAL ROLE authenticated;
 spin_result:=public.fn_wheel_run_begin(club,5);
 IF spin_result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Old client could open a new run'; END IF;
 spin_result:=public.fn_wheel_batch_prepare(gen_random_uuid(),club,5,100);
 IF spin_result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Old client could prepare a batch'; END IF;
 quote:=public.fn_wheel_state_v2(club,balance);
 IF quote->>'payout_rules_version' IS DISTINCT FROM '2' OR quote->>'available' IS DISTINCT FROM 'true' OR (quote->>'max_entry')::bigint IS DISTINCT FROM balance THEN
  RAISE EXCEPTION 'Full balance unavailable: %',quote->>'reason';
 END IF;
 RESET ROLE;
 FOREACH stake IN ARRAY ARRAY[balance+1,1,balance] LOOP
  BEGIN
   seed:=encode(extensions.digest('wheel:single-entry:'||stake,'sha256'),'hex'); ticket:=gen_random_uuid();
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
    VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SET LOCAL ROLE authenticated;
   spin_result:=public.fn_wheel_spin_v2(club,ticket,'entry-test',stake,'paid',NULL);
   replay:=public.fn_wheel_spin_v2(club,ticket,'entry-test',stake,'paid',NULL);
   RESET ROLE;
   IF stake>balance THEN
    IF spin_result->>'ok' IS DISTINCT FROM 'false' OR EXISTS(SELECT 1 FROM public.wheel_spins WHERE commit_id=ticket)
     OR (SELECT diamonds FROM public.profiles WHERE id=player)<>balance THEN RAISE EXCEPTION 'Unfunded player charged'; END IF;
   ELSE
    IF spin_result->>'ok' IS DISTINCT FROM 'true' OR replay->>'replayed' IS DISTINCT FROM 'true'
     OR (SELECT diamonds FROM public.profiles WHERE id=player)<>balance-stake THEN
     RAISE EXCEPTION 'Single wallet debit/replay failed for %: %',stake,spin_result;
    END IF;
   END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='isolate case';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
 END LOOP;
 FOR boost IN 1..2 LOOP
 FOR game IN SELECT unnest(ARRAY['plinko','crash','crossing','mines']) LOOP
  BEGIN
   FOR i IN 1..5000 LOOP
    BEGIN
     seed:=encode(extensions.digest('wheel:single-bonus:'||game||':'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
     INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
      VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
     SET LOCAL ROLE authenticated;
     spin_result:=public.fn_wheel_spin_v2(club,ticket,'earned-bonus',balance,'paid',NULL);
     RESET ROLE;
     IF spin_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Full balance refused: %',spin_result; END IF;
     SELECT * INTO a FROM public.wheel_bonus_awards WHERE spin_id=(spin_result->>'spin_id')::uuid;
     IF a.game=game AND a.boost_multiplier=boost THEN EXIT; END IF;
     RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='try next deterministic seed';
    EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
    END;
   END LOOP;
   IF spin_result->>'payout_rules_version' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Missing wheel payout version'; END IF;
   IF a.game IS DISTINCT FROM game OR a.boost_multiplier IS DISTINCT FROM boost THEN RAISE EXCEPTION 'No target bonus generated: %',game; END IF;
   ticket:=gen_random_uuid();
   INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash)
    VALUES(ticket,player,game,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SELECT chip_balance INTO STRICT before_chips FROM public.club_members WHERE club_id=club AND user_id=player;
   SET LOCAL ROLE authenticated;
   started:=public.fn_wheel_bonus_start(a.id,ticket,'redeem-large',false,
    CASE game WHEN 'crossing' THEN 'road' WHEN 'mines' THEN '6' END,
    CASE WHEN game='plinko' THEN a.base_diamonds END,NULL,NULL,
    CASE WHEN game IN ('crossing','mines') THEN 1 END);
   RESET ROLE;
   IF started->>'ok' IS DISTINCT FROM 'true' OR (started->>'bet_diamonds')::bigint<>a.base_diamonds OR
    (SELECT diamonds FROM public.profiles WHERE id=player)<>0 THEN RAISE EXCEPTION 'Earned % failed at full balance: %',game,started; END IF;
   IF game='crash' THEN
    SELECT id INTO STRICT round_id FROM public.crash_rounds WHERE commit_id=ticket;
    PERFORM set_config('app.ledger_maintenance','private fixture elapsed crash clock',true);
    UPDATE public.crash_rounds SET started_at=clock_timestamp()-interval '10 minutes' WHERE id=round_id;
    PERFORM set_config('app.ledger_maintenance','',true);
    SET LOCAL ROLE authenticated; settled:=public.fn_crash_settle(round_id,false); RESET ROLE;
   ELSIF game IN ('crossing','mines') THEN
    SET LOCAL ROLE authenticated; settled:=public.fn_choice_act((started->>'id')::uuid,'pick',0,0); RESET ROLE;
   ELSE settled:=started;
   END IF;
   payout:=COALESCE(settled#>>'{outcome,payout_chips}',settled->>'payout_chips')::numeric;
   IF payout IS NULL OR payout<ceil(a.base_diamonds::numeric*1.5)/100 OR
    (spin_result->>'minimum_bonus_payout_chips')::numeric IS DISTINCT FROM ceil(a.base_diamonds::numeric*1.5)/100 OR
    (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player) IS DISTINCT FROM before_chips+payout
    THEN RAISE EXCEPTION 'Earned % payout/ledger below promised minimum: %',game,settled; END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='isolate case';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
 END LOOP;
 END LOOP;
 -- Pick a real sealed card from a paid odd entry and retry the same claim.
 FOR attempt IN 1..500 LOOP
  BEGIN
   seed:=encode(extensions.digest('card-floor:'||attempt,'sha256'),'hex'); ticket:=gen_random_uuid();
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
    VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SET LOCAL ROLE authenticated; spin_result:=public.fn_wheel_spin_v2(club,ticket,'card-proof',25,'paid',NULL); RESET ROLE;
   SELECT id INTO award_id FROM public.wheel_card_awards WHERE spin_id=(spin_result->>'spin_id')::uuid;
   IF award_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='draw another seed'; END IF;
   SET LOCAL ROLE authenticated;
   settled:=public.fn_wheel_diamond_cards_pick(award_id,1::smallint);
   replay:=public.fn_wheel_diamond_cards_pick(award_id,1::smallint);
   RESET ROLE;
   IF (SELECT diamonds FROM public.profiles WHERE id=player)<balance-25+13 OR
    settled->>'payout_rules_version' IS DISTINCT FROM '2' OR replay->>'payout_rules_version' IS DISTINCT FROM '2'
    THEN RAISE EXCEPTION 'Card rules/credit missing on pick or retry: % / %',settled,replay; END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore full wallet';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; WHEN SQLSTATE 'P0099' THEN EXIT;
  END;
 END LOOP;
 IF award_id IS NULL THEN RAISE EXCEPTION 'No card draw in fixture'; END IF;
 -- The same committed seed draws the same card at a stake above signed int32.
 BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM public.add_diamonds_to_balance(player,2147483701::bigint-balance,'transfer','Wide wallet fixture','test:wide-wallet','d1000000-0000-4000-8000-000000000002');
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  SET LOCAL ROLE authenticated; quote:=public.fn_wheel_state_v2(club,2147483701::bigint); RESET ROLE;
  IF (quote->>'max_entry')::bigint IS DISTINCT FROM 2147483701::bigint THEN RAISE EXCEPTION 'Wide wallet quote: %',quote; END IF;
  INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
   VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
  SET LOCAL ROLE authenticated;
  spin_result:=public.fn_wheel_spin_v2(club,ticket,'card-proof',2147483701::bigint,'paid',NULL);
  RESET ROLE;
  IF spin_result->>'ok' IS DISTINCT FROM 'true' OR (SELECT diamonds FROM public.profiles WHERE id=player) IS DISTINCT FROM 0 THEN
   RAISE EXCEPTION 'Wide stake did not debit exact full wallet: %',spin_result; END IF;
  RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore wallet';
 EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
 END;
 -- Exercise the historical 200-spin boundary on real immutable receipts.
 -- A chip draw leaves no unplayed prize. Other draws roll back in the fixture.
 FOR spin_index IN 1..201 LOOP
  verified:=0;
  FOR attempt IN 1..100 LOOP
   BEGIN
    seed:=encode(extensions.digest('uncapped-count:'||spin_index||':'||attempt,'sha256'),'hex');
    ticket:=gen_random_uuid();
    INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
      VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
    SET LOCAL ROLE authenticated;
    spin_result:=public.fn_wheel_spin_v2(club,ticket,'count-proof',1,'paid',NULL);
    RESET ROLE;
    IF spin_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Spin % refused: %',spin_index,spin_result; END IF;
    IF spin_result#>>'{outcome,kind}'='chips' THEN verified:=1; EXIT; END IF;
    RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='select a draw with no pending prize';
   EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
   END;
  END LOOP;
  IF verified<>1 THEN RAISE EXCEPTION 'No chip draw in test seed sequence'; END IF;
 END LOOP;
 IF (SELECT diamonds FROM public.profiles WHERE id=player) IS DISTINCT FROM balance-201 THEN
  RAISE EXCEPTION '201 single spins did not charge 201 diamonds';
 END IF;
END $probe$;
ROLLBACK;
