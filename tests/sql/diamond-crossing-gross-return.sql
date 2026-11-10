-- Private PostgreSQL integration. The rounding and stopping-value oracle is
-- independent of the generator and covers every allowed stopping street.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
DO $probe$
DECLARE club uuid:='d1000000-0000-4000-8000-000000000003'; player uuid:='d1000000-0000-4000-8000-000000000005';
 stake numeric; minimum numeric; prizes numeric[]; prior_losses numeric; survival numeric; safe numeric;
 ticket uuid; seed text; quote jsonb; r jsonb; again jsonb; before_chips numeric; successes integer:=0; fails integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'Private accounting fixture required'; END IF;
 FOREACH stake IN ARRAY ARRAY[0.01,0.25,1,25,26000,21474837.01] LOOP
  minimum:=ceil(stake*50)/100;
  prizes:=public.fn_choice_prizes_v8('crossing','road',stake,minimum);
  prior_losses:=0; survival:=1;
  FOR n IN 1..cardinality(prizes) LOOP
   safe:=CASE n WHEN 1 THEN 1 WHEN 2 THEN .75 ELSE .5 END;
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
   r:=public.fn_choice_start(club,'crossing','road',2500,ticket,'risk-proof',2);
   IF quote->>'payout_version' IS DISTINCT FROM '8' OR r->>'payout_version' IS DISTINCT FROM '8' THEN RAISE EXCEPTION 'Version mismatch: %',r; END IF;
   r:=public.fn_choice_act((r->>'id')::uuid,'pick',0,0);
   IF r->>'status' IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Street one must be safe'; END IF;
   r:=public.fn_choice_act((r->>'id')::uuid,'pick',1,1);
   again:=public.fn_choice_act((r->>'id')::uuid,'pick',1,1);
   RESET ROLE;
   safe:=get_byte(extensions.hmac('risk-proof:'||(r->>'nonce')||':street:2',seed,'sha256'),0);
   IF (r#>>'{proof,coins,1}')::boolean IS DISTINCT FROM (safe<192) OR
    (r#>>'{proof,coins,0}')::boolean IS DISTINCT FROM true OR (r->>'status'='lost') IS DISTINCT FROM (safe>=192)
    OR again->>'payout_chips' IS DISTINCT FROM r->>'payout_chips'
    OR (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player) IS DISTINCT FROM before_chips+(r->>'payout_chips')::numeric
    THEN RAISE EXCEPTION 'Donkey step, proof or payment mismatch: %',r; END IF;
   IF safe<192 THEN successes:=successes+1; ELSE fails:=fails+1; END IF;
   RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore fixture';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
 END LOOP;
 IF successes=0 OR fails=0 THEN RAISE EXCEPTION 'Fixture needs both street two outcomes'; END IF;
END $probe$;
ROLLBACK;
