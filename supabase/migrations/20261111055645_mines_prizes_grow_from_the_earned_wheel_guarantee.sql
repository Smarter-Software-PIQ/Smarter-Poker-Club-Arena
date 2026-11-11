-- Mines earned guarantees must not flatten the first five safe prizes.
-- Contract 9 starts at the sealed wheel guarantee plus 5% of the game stake.
-- Every later choice preserves that value under the actual remaining mine odds,
-- including the existing guaranteed/half-last-prize loss protection. Historical
-- rounds keep their original ladder, proof and payout; no balances are rewritten.
-- @live-proof: to_regprocedure('public.fn_choice_prizes_v9(text,text,numeric,numeric,numeric)') IS NOT NULL AND position('fn_choice_prizes_v9' IN pg_get_functiondef((SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_choice_start'))) > 0
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
CREATE FUNCTION public.fn_choice_prizes_v9(p_game text,p_mode text,p_bet numeric,p_floor numeric,p_wheel_floor numeric)
RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE prizes numeric[]; n integer; m integer; loss numeric; previous numeric;
BEGIN
 IF p_game<>'mines' OR COALESCE(p_wheel_floor,0)=0 THEN
  RETURN public.fn_choice_prizes_v8(p_game,p_mode,p_bet,p_floor);
 END IF;
 IF p_mode IS DISTINCT FROM '6' OR p_bet IS NULL OR p_bet<=0 OR p_floor IS NULL OR p_floor<0
  OR p_wheel_floor IS NULL OR p_wheel_floor<0 THEN RAISE EXCEPTION 'Invalid Mines Prize'; END IF;
 -- Admission stores numeric cents while quotes carry division scale. Remove
 -- trailing zero scale so identical inputs produce byte-identical ladders.
 p_bet:=trim_scale(p_bet); p_floor:=trim_scale(p_floor); p_wheel_floor:=trim_scale(p_wheel_floor);
 m:=p_mode::integer;
 prizes:=ARRAY[p_wheel_floor+p_bet*.05];
 FOR n IN 1..24-m LOOP
  previous:=prizes[n];
  loss:=public.fn_choice_loss_floor_v5(prizes,n,greatest(p_floor,p_wheel_floor));
  prizes:=array_append(prizes,(previous*(25-n)-loss*m)/(25-n-m));
 END LOOP;
 RETURN prizes;
END $$;
REVOKE ALL ON FUNCTION public.fn_choice_prizes_v9(text,text,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_choice_prizes_v9(text,text,numeric,numeric,numeric) TO service_role;
DO $rewrite$
DECLARE f record; target oid; definition text;
BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('fn_choice_start',
   $o$fn_choice_prizes_v8(p_game,p_mode,adm.o_bet_chips,CASE WHEN p_game='crossing' THEN greatest(v_floor,public.fn_wheel_earned_prize_floor(p_commit_id)) ELSE v_floor END)$o$,
   $n$fn_choice_prizes_v9(p_game,p_mode,adm.o_bet_chips,CASE WHEN p_game='crossing' THEN greatest(v_floor,public.fn_wheel_earned_prize_floor(p_commit_id)) ELSE v_floor END,public.fn_wheel_earned_prize_floor(p_commit_id))$n$),
  ('fn_choice_start',$o$CASE WHEN p_game='crossing' THEN 8 ELSE 5 END$o$,
   $n$CASE WHEN p_game='crossing' THEN 8 WHEN public.fn_wheel_earned_prize_floor(p_commit_id)>0 THEN 9 ELSE 5 END$n$),
  ('fn_choice_act','IN (5,6,7,8)','IN (5,6,7,8,9)'),
  ('fn_wheel_bonus_state',$o$WHEN p_game='mines' THEN 5$o$,
   $n$WHEN p_game='mines' AND COALESCE((v_award->>'wheel_minimum_payout_chips')::numeric,0)>0 THEN 9 WHEN p_game='mines' THEN 5$n$),
  ('fn_wheel_bonus_state',
   $o$fn_choice_prizes_v8(p_game,public.fn_choice_mode(p_game),total::numeric/rate,v_floor)$o$,
   $n$fn_choice_prizes_v9(p_game,public.fn_choice_mode(p_game),total::numeric/rate,v_floor,COALESCE((v_award->>'wheel_minimum_payout_chips')::numeric,0))$n$)
 ) changes(name,old_text,new_text)
 LOOP
  SELECT oid INTO STRICT target FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=f.name;
  definition:=pg_get_functiondef(target);
  IF position(f.old_text IN definition)=0 THEN RAISE EXCEPTION 'Mines source changed at %: %',f.name,f.old_text; END IF;
  EXECUTE replace(definition,f.old_text,f.new_text);
 END LOOP;
END $rewrite$;
COMMIT;
