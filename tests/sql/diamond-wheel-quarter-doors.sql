-- Same authenticated transaction for horses; free spins keep sealed v4.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
DO $$
DECLARE player uuid:='d1000000-0000-4000-8000-000000000005'; club uuid:='d1000000-0000-4000-8000-000000000003';
 ticket uuid; result jsonb; before_balance bigint; before_claims text; mode text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN RAISE EXCEPTION 'Private fixture required'; END IF;
 IF to_regprocedure('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Old integer wheel overload remains'; END IF;
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0,welcome_spin_enabled=true,welcome_budget_chips=1000000 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
 SELECT club,'club',g,true,0,1000000 FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,min_seconds_between_rounds=0,max_multiplier_cents=2000 WHERE host_id=club;
 FOREACH mode IN ARRAY ARRAY['welcome','horse'] LOOP
  BEGIN
   ticket:=gen_random_uuid();
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash) VALUES(ticket,player,'free-and-horse',encode(extensions.digest('free-and-horse','sha256'),'hex'));
   SELECT diamonds INTO before_balance FROM public.profiles WHERE id=player;
   IF mode='welcome' THEN
    PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
    SET LOCAL ROLE authenticated;
    result:=public.fn_wheel_spin_v2(club,ticket,'free',100,'welcome',NULL);
    RESET ROLE;
    IF result->>'ok'<>'true' OR result->>'contract_version'<>'4' OR result#>>'{fairness,domain}'<>'wheel-v4'
     OR result->>'player_cost_diamonds'<>'0' OR (SELECT diamonds FROM public.profiles WHERE id=player)<>before_balance THEN
     RAISE EXCEPTION 'Free v4 changed or charged: %',result; END IF;
   ELSE
    UPDATE public.profiles SET is_horse=true WHERE id=player;
    PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
    before_claims:=current_setting('request.jwt.claims');
    SET LOCAL ROLE service_role;
    result:=public.fn_horse_diamond_spins(player,'wheel_spin',jsonb_build_object('club_id',club,'commit_id',ticket,'client_seed','horse','entry_diamonds',100,'mode','paid'));
    RESET ROLE;
    IF result->>'ok'<>'true' OR result->>'contract_version'<>'5' OR result#>>'{fairness,domain}'<>'wheel-v5'
     OR (SELECT diamonds FROM public.profiles WHERE id=player)<>before_balance-100
     OR current_setting('request.jwt.claims')<>before_claims THEN RAISE EXCEPTION 'Horse v5 differs or claims leaked: %',result; END IF;
   END IF;
   RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='restore each independent door';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
  END;
 END LOOP;
 RAISE NOTICE 'PASS: free v4 no debit, horse v5 same paid model and debit, service claims restored';
END $$;
ROLLBACK;
