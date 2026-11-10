-- Private PostgreSQL integration. The rounding and stopping-value oracle is
-- independent of the generator and covers every allowed stopping street.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
DO $probe$
DECLARE club uuid:='d1000000-0000-4000-8000-000000000003'; player uuid:='d1000000-0000-4000-8000-000000000005';
 stake numeric; minimum numeric; prizes numeric[]; prior_losses numeric; survival numeric; safe numeric;
 ticket uuid; seed text; quote jsonb; r jsonb; again jsonb; before_chips numeric; successes integer:=0; fails integer:=0; boost integer; a public.wheel_bonus_awards; spin jsonb; expected_floor numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'Private accounting fixture required'; END IF;
 FOREACH stake IN ARRAY ARRAY[0.01,0.25,1,25,26000,21474837.01] LOOP
  minimum:=ceil(stake*50)/100;
  prizes:=public.fn_choice_prizes_v8('crossing','road',stake,minimum);
  prior_losses:=0; survival:=1;
  FOR n IN 1..cardinality(prizes) LOOP
   safe:=CASE WHEN n=1 THEN 1 WHEN n<=4 THEN .875 ELSE .5 END;
   prior_losses:=prior_losses+survival*(1-safe)*greatest(minimum,ceil(prizes[n-1]*50)/100);
   survival:=survival*safe;
   IF abs((prior_losses+survival*prizes[n])/stake-1.05)>1e-12 OR prizes[n]>20*stake THEN
    RAISE EXCEPTION 'Unexpected return or exposure: stake %, street %',stake,n; END IF;
  END LOOP;
 END LOOP;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,exposure_allowance_chips)
 VALUES(club,'club','crossing',true,10000) ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) VALUES(club,'crossing') ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,exposure_allowance_chips=10000,min_seconds_between_rounds=0 WHERE host_id=club;
 FOR i IN 1..24 LOOP
  BEGIN
   ticket:=gen_random_uuid(); seed:=encode(extensions.digest('v8-donkey-'||i,'sha256'),'hex');
   INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash)
    VALUES(ticket,player,'crossing',seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SELECT chip_balance INTO STRICT before_chips FROM public.club_members WHERE club_id=club AND user_id=player;
   SET LOCAL ROLE authenticated;
   quote:=public.fn_choice_state(club,'crossing','road',2500);
   r:=public.fn_choice_start(club,'crossing','road',2500,ticket,'risk-proof',4);
   IF quote->>'payout_version' IS DISTINCT FROM '8' OR r->>'payout_version' IS DISTINCT FROM '8' THEN RAISE EXCEPTION 'Version mismatch: %',r; END IF;
   r:=public.fn_choice_act((r->>'id')::uuid,'pick',0,0);
   IF r->>'status' IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Street one must be safe'; END IF;
   FOR n IN 2..4 LOOP
    r:=public.fn_choice_act((r->>'id')::uuid,'pick',n-1,n-1);
    EXIT WHEN r->>'status'<>'open';
   END LOOP;
   again:=public.fn_choice_act((r->>'id')::uuid,'cashout',NULL,jsonb_array_length(r->'picked'));
   RESET ROLE;
   FOR n IN 2..4 LOOP
    safe:=get_byte(extensions.hmac('risk-proof:'||(r->>'nonce')||':street:'||n,seed,'sha256'),0);
    IF (r->'proof'->'coins'->>(n-1))::boolean IS DISTINCT FROM (safe<224) THEN
     RAISE EXCEPTION 'Wrong survival draw on street %',n; END IF;
   END LOOP;
   IF (r#>>'{proof,coins,0}')::boolean IS DISTINCT FROM true OR
    again->>'payout_chips' IS DISTINCT FROM r->>'payout_chips' OR
    (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player) IS DISTINCT FROM before_chips+(r->>'payout_chips')::numeric
    THEN RAISE EXCEPTION 'Donkey step, proof or payment mismatch: %',r; END IF;
   IF r->>'status'='cashed' THEN successes:=successes+1; ELSE fails:=fails+1; END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore fixture';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
 END LOOP;
 IF successes=0 OR fails=0 THEN RAISE EXCEPTION 'Fixture needs both road outcomes'; END IF;
 SELECT count(*) FILTER(WHERE coins[2] AND coins[3]),count(*) FILTER(WHERE coins[2] AND coins[3] AND coins[4]) INTO successes,fails
 FROM (SELECT public.fn_choice_road_coins_vn(8,md5(i::text),'fourth-street',i,4) coins FROM generate_series(1,4096) i) samples;
 IF abs(successes/4096.0-.765625)>.035 OR abs(fails/4096.0-.669921875)>.035 THEN
  RAISE EXCEPTION 'Sealed roads reaching streets 3 and 4: %, % / 4096',successes,fails; END IF;
 -- The original spin seals each standard or Super game cost. Its floor
 -- must survive quote, admission, cash-out, reread and the player's ledger.
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0 WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,100000 FROM unnest(ARRAY['plinko','crash','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,max_multiplier_cents=2000,min_seconds_between_rounds=0 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 FOREACH boost IN ARRAY ARRAY[1,2] LOOP
  FOR i IN 1..1000 LOOP
   BEGIN
    seed:=encode(extensions.digest('earned-road:'||boost||':'||i,'sha256'),'hex'); ticket:=gen_random_uuid();
    INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
     VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
    SET LOCAL ROLE authenticated; spin:=public.fn_wheel_spin_v2(club,ticket,'earned-crossing',101,'paid',NULL); RESET ROLE;
    IF spin->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Earned road fixture spin refused: %',spin; END IF;
    SELECT * INTO a FROM public.wheel_bonus_awards WHERE spin_id=(spin->>'spin_id')::uuid AND game='crossing' AND boost_multiplier=boost;
    IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='select another seed'; END IF;
    expected_floor:=ceil(a.base_diamonds::numeric*150/(spin->>'diamonds_per_chip')::integer)/100;
    SELECT chip_balance INTO STRICT before_chips FROM public.club_members WHERE club_id=club AND user_id=player;
    ticket:=gen_random_uuid();
    INSERT INTO public.diamond_game_commits(id,user_id,game,server_seed,server_seed_hash)
     VALUES(ticket,player,'crossing',seed,encode(extensions.digest(seed,'sha256'),'hex'));
    SET LOCAL ROLE authenticated;
    quote:=public.fn_wheel_bonus_state(club,'crossing',false,'road',a.id);
    r:=public.fn_wheel_bonus_start(a.id,ticket,'earned-road',false,'road',NULL,NULL,NULL,1);
    IF (quote#>>'{game_state,minimum_payout_chips}')::numeric IS DISTINCT FROM expected_floor OR
     (r->>'minimum_payout_chips')::numeric IS DISTINCT FROM expected_floor OR
     (r#>>'{prizes,0}')::numeric<=expected_floor THEN RAISE EXCEPTION 'Earned %x floor/ladder: % / %',boost,quote,r; END IF;
    r:=public.fn_choice_act((r->>'id')::uuid,'pick',0,0); again:=public.fn_choice_act((r->>'id')::uuid,'pick',0,0);
    RESET ROLE;
    IF r->>'status' IS DISTINCT FROM 'cashed' OR (r->>'payout_chips')::numeric<expected_floor OR
     again->>'payout_chips' IS DISTINCT FROM r->>'payout_chips' OR
     (SELECT chip_balance FROM public.club_members WHERE user_id=player AND club_id=club) IS DISTINCT FROM before_chips+(r->>'payout_chips')::numeric
     THEN RAISE EXCEPTION 'Earned %x settlement/replay: %',boost,r; END IF;
    RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore wallet';
   EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL; WHEN SQLSTATE 'P0099' THEN EXIT;
   END;
  END LOOP;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Missing %x crossing draw',boost; END IF;
 END LOOP;
END $probe$;
ROLLBACK;
