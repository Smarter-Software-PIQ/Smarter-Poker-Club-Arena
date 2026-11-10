-- Only new Crash rounds and new Plinko batches take these terms. Existing receipts
-- retain the sealed point, clock, board and per-drop outcomes.
-- @live-proof: public.fn_crash_point_cents_v6(281474976710655,1,.5)=250 AND public.fn_crash_point_cents_v6(0,1,.5)=2000 AND public.fn_plinko_table_for_floor(1,.5)=7
-- @live-proof: EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.crash_rounds'::regclass AND conname='crash_flight_v6_terms' AND convalidated)
-- @live-proof: (SELECT spec_rtp BETWEEN 1 AND 1.10 FROM public.fn_plinko_table_audit(7))
BEGIN;
SET LOCAL lock_timeout='3s';

ALTER TABLE public.crash_rounds ADD CONSTRAINT crash_flight_v6_terms
 CHECK (payout_version IS DISTINCT FROM 6 OR (crash_cents BETWEEN 250 AND 2000 AND cap_cents=2000 AND growth_k<=.05));
CREATE FUNCTION public.fn_crash_point_cents_v6(p_roll numeric,p_bet numeric,p_minimum numeric)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 WITH ticket AS (
  SELECT div((281474976710655-p_roll)*10000,281474976710656)::integer AS n
 )
 SELECT CASE WHEN n<1500 THEN 250+n*50/1500
             WHEN n<3500 THEN 300+(n-1500)*200/2000
             WHEN n<6500 THEN 500+(n-3500)*500/3000
             WHEN n<8500 THEN 1000+(n-6500)*500/2000
             ELSE 1500+(n-8500)*501/1500 END FROM ticket
 WHERE p_roll BETWEEN 0 AND 281474976710655 AND p_roll=trunc(p_roll) AND p_bet>0 AND p_minimum>=0
$$;
REVOKE ALL ON FUNCTION public.fn_crash_point_cents_v6(numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crash_point_cents_v6(numeric,numeric,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_crash_config_limits()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.game='crash' THEN
  NEW.max_multiplier_cents:=2000;
  NEW.growth_k:=least(NEW.growth_k,0.05);
 END IF;
 RETURN NEW;
END $$;
UPDATE public.diamond_game_configs c SET growth_k=.05,updated_at=now()
WHERE game='crash' AND growth_k>.05 AND NOT EXISTS(
 SELECT 1 FROM public.clubs cl WHERE cl.id=c.host_id AND cl.lifecycle_status='retired');

-- Board 7 returns at least the nominal stake on every slot. At the supported
-- cent-denominated drop sizes stochastic rounding therefore cannot make the batch
-- guarantee lift the expectation above the table's own gross return.
INSERT INTO public.plinko_tables(version,name,multipliers_cents,max_multiplier_cents,note)
VALUES (7,'Diamond',ARRAY[2000,500,200,140,125,110,105,102,100,102,105,110,125,140,200,500,2000],
2000,'All 17 slots pay. The middle pays 1x and the edges pay 20x.');
UPDATE public.plinko_tables t SET spec_rtp=a.spec_rtp,sd_chips=a.sd_chips,
 hit_rate=a.hit_rate,activated_at=now() FROM public.fn_plinko_table_audit(7) a
WHERE t.version=7 AND a.spec_rtp BETWEEN 1 AND 1.10 AND a.slots=17;
UPDATE public.plinko_tables SET activated_at=NULL WHERE version IN (4,6);

DO $patch$
DECLARE item record; f regprocedure; old_sql text; changes integer;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('fn_crash_start','IF (public.fn_wheel_starting_award()).id IS NOT NULL AND v_cap < 2000 THEN','IF v_cap < 2000 THEN'),
 ('fn_crash_start','public.fn_crash_point_cents_v5(v_roll','public.fn_crash_point_cents_v6(v_roll'),
 ('fn_crash_start','adm.o_rate), 5)','adm.o_rate), 6)'),
 ('fn_crash_round_result','WHEN r.payout_version>=5 THEN public.fn_crash_return_ppm_v5','WHEN r.payout_version>=6 THEN NULL WHEN r.payout_version>=5 THEN public.fn_crash_return_ppm_v5'),
 ('fn_wheel_bonus_state',$q$WHEN p_game IN('mines','crash') THEN 5$q$,$q$WHEN p_game='crash' THEN 6 WHEN p_game='mines' THEN 5$q$),
 ('fn_wheel_bonus_state','public.fn_crash_return_ppm_v5(total::numeric/rate,v_floor)','NULL::integer'),
 ('fn_crash_round_result','CASE WHEN r.payout_version>=5 THEN 125','CASE WHEN r.payout_version>=6 THEN 250 WHEN r.payout_version>=5 THEN 125'),
 ('fn_wheel_bonus_state',$q$WHEN p_game='crash' THEN 125 ELSE 110 END$q$,$q$WHEN p_game='crash' THEN 250 ELSE 110 END$q$),
 ('fn_diamond_game_state',$q$WHEN p_game = 'crash' THEN 5 END$q$,$q$WHEN p_game = 'crash' THEN 6 END$q$),
 ('fn_diamond_game_set_config','a.spec_rtp = 0.800000','a.spec_rtp BETWEEN 1 AND 1.10'),
 ('fn_plinko_activate_table','IF a.spec_rtp <> 0.800000 THEN','IF p_version < 7 OR a.spec_rtp NOT BETWEEN 1 AND 1.10 THEN'),
 ('fn_plinko_activate_table','Return To Player Must Be Exactly 80 Percent, Not %s','New Plinko Tables Must Return Between 100 And 110 Percent (received %s)')
 ) v(name,needle,replacement) LOOP
  changes:=0;
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=item.name LOOP
   old_sql:=pg_get_functiondef(f);
   IF strpos(old_sql,item.needle)>0 THEN
    EXECUTE replace(old_sql,item.needle,item.replacement); changes:=changes+1;
   END IF;
  END LOOP;
  IF changes<>1 THEN RAISE EXCEPTION 'Expected one % source for %, found %',item.name,item.needle,changes; END IF;
 END LOOP;
 IF public.fn_plinko_table_for_floor(1,.5) IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'Board 7 failed its activation audit'; END IF;
END $patch$;
COMMIT;
