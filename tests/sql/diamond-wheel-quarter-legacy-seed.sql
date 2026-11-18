-- Retain an actual contract4 paid receipt across the following v5 installation.
\set ON_ERROR_STOP on
CREATE TEMP TABLE wheel_quarter_legacy_receipt(receipt jsonb);
DO $$
DECLARE player uuid:='d1000000-0000-4000-8000-000000000005'; club uuid:='d1000000-0000-4000-8000-000000000003';
 seed text; ticket uuid; receipt jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN RAISE EXCEPTION 'Private fixture required'; END IF;
 PERFORM set_config('test.user',player::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0 WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,1000000 FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,min_seconds_between_rounds=0,max_multiplier_cents=2000 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 FOR i IN 1..100 LOOP
  BEGIN
   seed:=encode(extensions.digest('before-quarter:'||i,'sha256'),'hex');ticket:=gen_random_uuid();
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash) VALUES(ticket,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SET LOCAL ROLE authenticated;
   receipt:=public.fn_wheel_spin_v2(club,ticket,'before-quarter',100,'paid',NULL);
   RESET ROLE;
   IF receipt->>'ok'<>'true' OR receipt->>'contract_version'<>'4' THEN RAISE EXCEPTION 'Original4 draw failed: %',receipt; END IF;
   IF receipt#>>'{outcome,kind}'='chips' THEN EXIT; END IF;
   RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='choose a sealed non-game predecessor';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
  END;
 END LOOP;
 INSERT INTO wheel_quarter_legacy_receipt VALUES(receipt);
END $$;
