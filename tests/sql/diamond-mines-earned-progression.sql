-- Synthetic private PostgreSQL only. Quote -> admission -> four picks -> booking.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
DO $probe$
DECLARE club uuid:='d1000000-0000-4000-8000-000000000003'; player uuid:='d1000000-0000-4000-8000-000000000005';
 stake numeric; floor numeric; prizes numeric[]; expected numeric; prior numeric; loss numeric;
 ticket uuid; seed text; spin jsonb; a public.wheel_bonus_awards; quote jsonb; r jsonb; duplicate jsonb;
 round_id uuid; cell integer; chips_before numeric; paid numeric; boost integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'Private accounting fixture required'; END IF;
 FOREACH stake IN ARRAY ARRAY[.25,1,25,26000] LOOP
  floor:=ceil(stake*150)/100;
  prizes:=public.fn_choice_prizes_v9('mines','6',stake,ceil(stake*50)/100,floor);
  IF prizes[1]<>floor+stake*.05 THEN RAISE EXCEPTION 'First prize did not clear wheel guarantee'; END IF;
  FOR n IN 2..cardinality(prizes) LOOP
   prior:=prizes[n-1]; loss:=greatest(floor,ceil(prior*50)/100);
   expected:=((25-(n-1)-6)*prizes[n]+6*loss)/(25-(n-1));
   IF prizes[n]<=prior OR abs(expected-prior)>1e-12*greatest(1,stake) THEN
    RAISE EXCEPTION 'Flat prize or changed stopping value at pick %',n; END IF;
  END LOOP;
  IF public.fn_choice_prizes_v9('mines','6',stake,ceil(stake*50)/100,0)
     IS DISTINCT FROM public.fn_choice_prizes_v5('mines','6',stake,ceil(stake*50)/100) THEN
   RAISE EXCEPTION 'Standalone Mines changed'; END IF;
 END LOOP;
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0 WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,100000 FROM unnest(ARRAY['plinko','crash','mines','crossing']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','mines','crossing']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,max_multiplier_cents=2000,min_seconds_between_rounds=0 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 FOREACH boost IN ARRAY ARRAY[1,2] LOOP
  FOR i IN 1..1000 LOOP
   BEGIN
    seed:=encode(extensions.digest('earned-mines-v9:'||boost||':'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
    INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
     VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
    SET LOCAL ROLE authenticated; spin:=public.fn_wheel_spin_v5(club,ticket,'earned-mines',2500,'paid',NULL); RESET ROLE;
    IF spin->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Spin fixture refused: %',spin; END IF;
    SELECT * INTO a FROM public.wheel_bonus_awards WHERE spin_id=(spin->>'spin_id')::uuid AND game='mines' AND boost_multiplier=boost;
    IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='next seed'; END IF;
    ticket:=gen_random_uuid();
    INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash)
     VALUES(ticket,player,'mines',seed,encode(extensions.digest(seed,'sha256'),'hex'));
    SELECT chip_balance INTO STRICT chips_before FROM public.club_members WHERE club_id=club AND user_id=player;
    SET LOCAL ROLE authenticated;
    quote:=public.fn_wheel_bonus_state(club,'mines',false,'6',a.id);
    r:=public.fn_wheel_bonus_start(a.id,ticket,'earned-mines',false,'6',NULL,NULL,NULL,5);
    IF r->>'payout_version' IS DISTINCT FROM '9' OR quote#>>'{game_state,payout_version}' IS DISTINCT FROM '9' THEN
     RAISE EXCEPTION 'Quote/start version mismatch: % / %',quote,r; END IF;
    round_id:=(r->>'id')::uuid;
    FOR n IN 0..3 LOOP
     IF n=0 THEN cell:=24;
     ELSE
      RESET ROLE;
      SELECT c INTO cell FROM public.diamond_choice_rounds d CROSS JOIN generate_series(0,24) c
       WHERE d.id=round_id AND NOT(c=ANY(d.mine_cells)) AND NOT(c=ANY(d.picked)) LIMIT 1;
      SET LOCAL ROLE authenticated;
     END IF;
     prior:=CASE WHEN n=0 THEN (r->>'wheel_minimum_payout_chips')::numeric ELSE (r->'prizes'->>(n-1))::numeric END;
     IF r->'prizes'->n IS DISTINCT FROM quote#>ARRAY['game_state','prizes',n::text] THEN RAISE EXCEPTION 'Quote/start rung % differs: round %, quote %',n,r,quote; END IF;
     r:=public.fn_choice_act(round_id,'pick',cell,n);
     duplicate:=public.fn_choice_act(round_id,'pick',cell,n);
     IF jsonb_array_length(r->'picked')<>n+1 OR duplicate<>r OR (r->'prizes'->>n)::numeric<=prior THEN
      RAISE EXCEPTION 'A safe tile did not advance exactly once: %',r; END IF;
    END LOOP;
    IF boost=1 THEN
     r:=public.fn_choice_act(round_id,'cashout',NULL,4);
     IF r->>'status' IS DISTINCT FROM 'cashed' OR (r->>'payout_chips')::numeric<(r->'prizes'->>3)::numeric-.01 THEN
      RAISE EXCEPTION 'Four-tile prize did not book'; END IF;
    ELSE
     RESET ROLE;
     SELECT mine_cells[1] INTO cell FROM public.diamond_choice_rounds WHERE id=round_id;
     SET LOCAL ROLE authenticated;
     r:=public.fn_choice_act(round_id,'pick',cell,4);
     IF r->>'status' IS DISTINCT FROM 'lost' OR (r->>'payout_chips')::numeric < (r->>'wheel_minimum_payout_chips')::numeric THEN
      RAISE EXCEPTION 'A mine lost the sealed guarantee'; END IF;
    END IF;
    paid:=(r->>'payout_chips')::numeric;
    duplicate:=public.fn_choice_act(round_id,'cashout',NULL,jsonb_array_length(r->'picked'));
    RESET ROLE;
    IF duplicate<>r OR (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player)<>chips_before+paid
     OR (SELECT sum(amount) FROM public.chip_transactions WHERE metadata->>'round_id'=round_id::text AND to_user_id=player AND transaction_type='mines_prize') IS DISTINCT FROM paid
     OR (SELECT count(*) FROM public.chip_transactions WHERE metadata->>'round_id'=round_id::text AND to_user_id=player AND transaction_type='mines_prize')<>1 THEN
     RAISE EXCEPTION 'A booked Mines prize must have one matching wallet credit and transaction'; END IF;
    RAISE NOTICE 'MINES_V9_RECEIPT %',r;
    RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore fixture';
   EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; WHEN SQLSTATE 'P0099' THEN EXIT;
   END;
  END LOOP;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Missing Mines boost %',boost; END IF;
 END LOOP;
 RAISE NOTICE 'PASS earned Mines: strictly increasing safe prizes, exact stopping value, quote/admission agreement, four single picks, duplicate protection and one ledgered payout';
END $probe$;
ROLLBACK;
