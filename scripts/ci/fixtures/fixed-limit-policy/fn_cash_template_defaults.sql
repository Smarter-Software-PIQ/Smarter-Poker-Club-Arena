CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults(p_template text, p_variant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t text:=lower(coalesce(p_template,'classic')); v text:=lower(coalesce(p_variant,'nlh')); family text; seats int;
BEGIN
 IF t IN ('action','madness','lightning') THEN t:='madness'; END IF;
 IF t NOT IN ('classic','madness') THEN RAISE EXCEPTION 'TEMPLATE_UNKNOWN: %',p_template; END IF;
 IF t='madness' AND v IN ('pineapple','pineapple_holdem') THEN
  RAISE EXCEPTION 'LIGHTNING_VARIANT_NOT_SUPPORTED: Pineapple Uses Classic Games';
 END IF;
 family:=CASE WHEN v IN ('plo4','plo5','plo6','plo8','flo8') THEN 'plo' WHEN v='short_deck' THEN 'shortdeck' WHEN v='pineapple' THEN 'pineapple' ELSE 'holdem' END;
 seats:=CASE WHEN t='classic' AND family='holdem' THEN 9 ELSE 6 END;
 RETURN jsonb_build_object('template',t,'variant',v,'family',family,'seats',seats,
  'seats_locked',t='madness' OR family='plo',
  'seat_choices',CASE WHEN t='madness' OR family='plo' THEN '[6]'::jsonb WHEN family='holdem' THEN '[9,6]'::jsonb ELSE '[2,3,4,5,6,7,8]'::jsonb END,
  'min_buyin_bb',CASE WHEN t='classic' THEN 40 ELSE 100 END,'max_buyin_bb',200,
  'regular_ante',CASE WHEN t='classic' AND v NOT IN ('plo5','plo6') THEN 'none' ELSE 'bb' END,
  'vpip_floor',CASE WHEN t='classic' AND v IN ('plo5','plo6') THEN 50 WHEN t='classic' THEN 0 ELSE 40 END,'vpip_window',10,
  'bombs',jsonb_build_object('enabled',t<>'classic','trigger',CASE WHEN t='classic' THEN NULL WHEN v IN ('plo4','plo5','plo6','plo8') THEN 'timed_12m' ELSE 'timed_10m' END,'ante_bb',CASE WHEN t='classic' THEN NULL ELSE 3 END,'boards',CASE WHEN t='classic' THEN NULL ELSE 2 END),
  'straddle',false,'stay_clock_min',10,'rejoin_window_min',120,'run_it_n_times','opt_in','rake','existing');
END $function$
