-- Exact upstream function definitions omitted from the narrow accounting fixture.
SELECT to_regprocedure('public.fn_plinko_activate_table(integer)') IS NULL AS needs_reader \gset
\if :needs_reader
CREATE OR REPLACE FUNCTION public.fn_plinko_activate_table(p_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.fn_ca_caller_is_management() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only Platform Management Activates A Plinko Table');
  END IF;
  SELECT x.* INTO a FROM public.fn_plinko_table_audit(p_version) x;
  IF a.spec_rtp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That Table Does Not Exist');
  END IF;
  IF a.spec_rtp <> 0.800000 THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Return To Player Must Be Exactly 80 Percent, Not %s', a.spec_rtp), 'audit', to_jsonb(a));
  END IF;
  UPDATE public.plinko_tables
     SET spec_rtp = a.spec_rtp, sd_chips = a.sd_chips, hit_rate = a.hit_rate,
         max_multiplier_cents = a.max_multiplier_cents, activated_at = COALESCE(activated_at, now())
   WHERE version = p_version;
  RETURN jsonb_build_object('ok', true, 'version', p_version, 'audit', to_jsonb(a));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_plinko_activate_table(integer) TO authenticated, service_role;
\endif
SELECT to_regprocedure('public.fn_diamond_bonus_latest(uuid,text)') IS NULL AS needs_reader \gset
\if :needs_reader
CREATE FUNCTION public.fn_diamond_bonus_latest(p_club_id uuid,p_game text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE h uuid; k text; r public.diamond_bonus_entries; v_latest_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Sign In To Play'); END IF;
 SELECT host_id,host_kind INTO h,k FROM public.fn_wheel_host(p_club_id);
 SELECT * INTO r FROM public.diamond_bonus_entries WHERE user_id=auth.uid() AND club_id=p_club_id AND host_id=h AND game=p_game
  AND result IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1;
 v_latest_result:=r.result;
 IF r.id IS NOT NULL AND p_game='crash' THEN
  SELECT public.fn_crash_round_result(c)||jsonb_build_object('bonus',r.result->'bonus') INTO v_latest_result
   FROM public.crash_rounds c WHERE c.commit_id=r.commit_id AND c.user_id=auth.uid() AND c.club_id=p_club_id;
 ELSIF r.id IS NOT NULL AND p_game IN ('crossing','mines') THEN
  SELECT public.fn_choice_result(c)||jsonb_build_object('bonus',r.result->'bonus') INTO v_latest_result FROM public.diamond_choice_rounds c WHERE c.commit_id=r.commit_id AND c.user_id=auth.uid() AND c.club_id=p_club_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'result',v_latest_result);
END $$;
REVOKE ALL ON FUNCTION public.fn_diamond_bonus_latest(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_diamond_bonus_latest(uuid,text) TO authenticated,service_role;
\endif
