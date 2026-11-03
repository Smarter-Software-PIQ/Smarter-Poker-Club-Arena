-- Owner November 3: requested stakes are BLINDS, FLH/FLO8 only.
-- Fixed-limit has a minimum buy-in and no maximum. Preserve every other rule.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $patch$
DECLARE sig text; src text; needle text; replacement text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.fn_cash_apply_ruleset(uuid)',
    'public.fn_cash_cluster_open_table(uuid,text,integer,text,uuid)'] LOOP
    src := pg_get_functiondef(sig::regprocedure);
    needle := $n$v_max_bb := coalesce((s->>'max_buyin_bb')::integer, 200);$n$;
    replacement := $r$v_max_bb := CASE WHEN g.variant IN ('flh','flo8') THEN NULL ELSE coalesce((s->>'max_buyin_bb')::integer, 200) END;$r$;
    IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Fixed-limit projection preimage changed: %',sig; END IF;
    EXECUTE replace(src,needle,replacement);
  END LOOP;
  src := pg_get_functiondef('public.fn_cash_template_defaults(text,text)'::regprocedure);
  needle := $n$'max_buyin_bb',200$n$;
  IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Fixed-limit template preimage changed'; END IF;
  EXECUTE replace(src,needle,$r$'max_buyin_bb',CASE WHEN v IN ('flh','flo8') THEN NULL ELSE 200 END$r$);
  src := pg_get_functiondef('public.fn_cash_game_floor_from_template()'::regprocedure);
  needle := $n$  RETURN NEW;$n$;
  -- Replace the final return only, preserving the early NULL snapshot return.
  needle := $n$  RETURN NEW;
END;$n$;
  IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Fixed-limit floor preimage changed'; END IF;
  EXECUTE replace(src,needle,$r$  IF NEW.variant IN ('flh','flo8') THEN
    NEW.ruleset_snapshot := NEW.ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL);
  END IF;
  RETURN NEW;
END;$r$);
END
$patch$;
DO $guard_preimage$
BEGIN
 IF md5(pg_get_functiondef('public.fn_cash_game_max_stake_guard()'::regprocedure))<>'b02ce4fda596606aa3f94ff2b46e3980' THEN
  RAISE EXCEPTION 'Cash stake guard changed; inspect before installation';
 END IF;
END
$guard_preimage$;
CREATE OR REPLACE FUNCTION public.fn_horse_cash_game_allowed(
 p_variant text,p_sb numeric,p_bb numeric,p_tournament_id uuid,p_at timestamptz DEFAULT now()
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp
AS $function$
 SELECT CASE
 WHEN p_tournament_id IS NOT NULL OR p_at<'2026-11-02 00:00:00 America/Chicago'::timestamptz THEN true
 WHEN lower(btrim(coalesce(p_variant,''))) LIKE '%pineapple%'
   OR lower(btrim(coalesce(p_variant,''))) IN ('short_deck','shortdeck','6+','plo8') THEN false
 WHEN lower(btrim(coalesce(p_variant,''))) IN ('flh','flo8') THEN coalesce(p_bb>0 AND p_bb<=10 AND p_sb>=0 AND p_sb<=5,false)
 WHEN lower(btrim(coalesce(p_variant,''))) IN ('nlh','plo','plo4','plo5','plo6') THEN coalesce(p_bb>0 AND p_bb<=2 AND p_sb>=0 AND p_sb<=1,false)
 ELSE coalesce(p_bb>0 AND p_bb<=1 AND p_sb>=0 AND p_sb<=0.5,false) END;
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) TO service_role;
DO $stake_guard$
DECLARE src text := pg_get_functiondef('public.fn_cash_game_max_stake_guard()'::regprocedure);
BEGIN
 EXECUTE replace(src,'begin', $inject$begin
  IF coalesce(NEW.enabled,false) AND NEW.variant IN ('flh','flo8') THEN
    IF NEW.sb<=5 AND NEW.bb<=10 THEN RETURN NEW; END IF;
    RAISE EXCEPTION USING errcode='22023',message='Fixed Limit Games Are Capped At 5/10 Blinds';
  END IF;
$inject$);
END
$stake_guard$;
-- Update configuration through its original projection; no financial rows change.
UPDATE public.cash_games SET ruleset_snapshot=ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL),updated_at=now()
WHERE variant IN ('flh','flo8') AND enabled AND ruleset_snapshot->>'max_buyin_bb' IS NOT NULL;
SELECT public.fn_cash_apply_ruleset(id) FROM public.cash_games WHERE enabled AND variant IN ('flh','flo8');
UPDATE public.tables SET max_buy_in=NULL WHERE tournament_id IS NULL AND game_variant IN ('flh','flo8')
AND max_buy_in IS NOT NULL AND lifecycle<>'closed' AND NOT coalesce(is_deleted,false);
-- Ensure new Classic games only for hosts already operating fixed limit.
-- This opens a new table through the maintained owner; closed historical tables stay closed.
DO $catalogue$
DECLARE host record; stake record;
BEGIN
 FOR host IN SELECT DISTINCT club_id,variant FROM public.cash_games
   WHERE enabled AND closed_at IS NULL AND variant IN ('flh','flo8') LOOP
   FOR stake IN SELECT * FROM (VALUES (1::numeric,2::numeric),(2::numeric,5::numeric),(5::numeric,10::numeric)) s(sb,bb) LOOP
     PERFORM public.fn_cash_game_ensure(host.club_id,host.variant,stake.sb,stake.bb,'classic',NULL);
   END LOOP;
 END LOOP;
END
$catalogue$;
COMMIT;
