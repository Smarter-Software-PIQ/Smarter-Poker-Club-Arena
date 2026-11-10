-- @live-proof: to_regprocedure('public.fn_choice_road_coin_v8(text,text,bigint,integer)') IS NOT NULL AND position('fn_choice_prizes_v8' IN pg_get_functiondef((SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_choice_start'))) > 0
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE FUNCTION public.fn_choice_road_coin_v8(p_server_seed text,p_client_seed text,p_nonce bigint,p_street integer)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=public,extensions AS $$
 SELECT p_street=1 OR get_byte(extensions.hmac(p_client_seed||':'||p_nonce||':street:'||p_street,p_server_seed,'sha256'),0)
   < CASE WHEN p_street BETWEEN 2 AND 4 THEN 224 ELSE 128 END
$$;
CREATE FUNCTION public.fn_choice_prizes_v8(p_game text,p_mode text,p_bet numeric,p_floor numeric)
RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE prizes numeric[]:='{}'; units constant numeric:=6860; amount numeric; loss numeric;
BEGIN
 IF p_game<>'crossing' THEN RETURN public.fn_choice_prizes_v7(p_game,p_mode,p_bet,p_floor); END IF;
 IF p_mode IS DISTINCT FROM 'road' OR p_bet IS NULL OR p_bet<=0 OR p_floor IS NULL OR p_floor<0 THEN
  RAISE EXCEPTION 'Invalid Road Settings'; END IF;
 -- On an earned road, street one pays the guaranteed amount plus 5% of
 -- the game cost. Standalone play retains the 105% gross first street.
 amount:=greatest(p_bet*1.05,p_floor+p_bet*.05)*100*units;
 -- Integer units per cent are 20*7^3, enough for all three early crossings. Starting at 1.05 times the stake,
 -- each street satisfies p * next + (1 - p) * loss = current.
 WHILE amount<=2000*units*p_bet AND cardinality(prizes)<20 LOOP
  prizes:=array_append(prizes,amount/(100*units));
  loss:=greatest(ceil(amount/(2*units)),p_floor*100)*units;
  amount:=CASE WHEN cardinality(prizes)<=3 THEN (8*amount-loss)/7 ELSE 2*amount-loss END;
 END LOOP;
 RETURN prizes;
END $$;
REVOKE ALL ON FUNCTION public.fn_choice_road_coin_v8(text,text,bigint,integer),public.fn_choice_prizes_v8(text,text,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_choice_road_coin_v8(text,text,bigint,integer),public.fn_choice_prizes_v8(text,text,numeric,numeric) TO service_role;

-- Preserve already-open rounds and their proof. Locate the exact single RPC
-- by name so an installment on either side of the wheel bigint cutover works.
DO $rewrite$
DECLARE f record; target oid; definition text;
BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('fn_choice_start','fn_choice_prizes_v7(p_game,p_mode,adm.o_bet_chips,v_floor)',
   $s$fn_choice_prizes_v8(p_game,p_mode,adm.o_bet_chips,CASE WHEN p_game='crossing' THEN greatest(v_floor,public.fn_wheel_earned_prize_floor(p_commit_id)) ELSE v_floor END)$s$),
  ('fn_choice_start',$s$p_game='crossing' THEN 7 ELSE 5$s$,$s$p_game='crossing' THEN 8 ELSE 5$s$),
  ('fn_choice_act','ELSIF r.payout_version=7 THEN safe:=','ELSIF r.payout_version=8 THEN safe:=public.fn_choice_road_coin_v8(r.server_seed,r.client_seed,r.nonce,n+1); ELSIF r.payout_version=7 THEN safe:='),
  ('fn_choice_act','IN (5,6,7)','IN (5,6,7,8)'),
  ('fn_choice_result','IN (6,7)','IN (6,7,8)'),
  ('fn_choice_state','fn_choice_prizes_v7(p_game,','fn_choice_prizes_v8(p_game,'),
  ('fn_choice_state',$s$p_game='crossing' THEN 7 ELSE 5$s$,$s$p_game='crossing' THEN 8 ELSE 5$s$),
  ('fn_wheel_bonus_state','prizes:=public.fn_choice_prizes_v7(p_game,',
   $s$IF p_game='crossing' AND v_award->>'wheel_minimum_payout_chips' IS NOT NULL THEN
    v_floor:=greatest(v_floor,(v_award->>'wheel_minimum_payout_chips')::numeric);
   END IF;
   prizes:=public.fn_choice_prizes_v8(p_game,$s$),
  ('fn_choice_result',$s$'minimum_payout_chips',r.minimum_payout_chips,$s$,
   $s$'minimum_payout_chips',CASE WHEN r.game='crossing' AND r.payout_version=8 THEN greatest(r.minimum_payout_chips,public.fn_wheel_earned_prize_floor(r.commit_id)) ELSE r.minimum_payout_chips END,$s$),
  ('fn_wheel_bonus_state',$s$p_game='crossing' THEN 7 WHEN$s$,$s$p_game='crossing' THEN 8 WHEN$s$),
  ('fn_diamond_bonus_replay','IN (6,7)','IN (6,7,8)'),
  ('fn_choice_road_coins_vn','CASE WHEN p_version=7','CASE WHEN p_version=8 THEN public.fn_choice_road_coin_v8(p_server_seed,p_client_seed,p_nonce,k) WHEN p_version=7')
 ) changes(name,old_text,new_text)
 LOOP
  SELECT oid INTO STRICT target FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=f.name;
  definition:=pg_get_functiondef(target);
  IF position(f.old_text IN definition)=0 THEN RAISE EXCEPTION 'Donkey source changed at %: %',f.name,f.old_text; END IF;
  EXECUTE replace(definition,f.old_text,f.new_text);
 END LOOP;
END $rewrite$;
COMMIT;
