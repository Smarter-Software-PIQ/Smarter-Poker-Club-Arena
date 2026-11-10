-- Entries debit once through the existing wheel bonus path. Sealed future paths
-- and seeds stay private. Each release posts the requested chips atomically.
-- @live-proof: NOT has_table_privilege('authenticated','public.wheel_plinko_sessions','SELECT') AND has_function_privilege('authenticated','public.fn_wheel_plinko_release(uuid,uuid,boolean)','EXECUTE')
BEGIN;
CREATE TABLE public.wheel_plinko_sessions (
 award_id uuid PRIMARY KEY REFERENCES public.wheel_bonus_awards(id), user_id uuid NOT NULL,
 club_id uuid NOT NULL, commit_id uuid NOT NULL UNIQUE, sealed_result jsonb,
 released_count integer NOT NULL DEFAULT 0 CHECK(released_count BETWEEN 0 AND 100),
 released_chips numeric NOT NULL DEFAULT 0 CHECK(released_chips>=0),
 complete boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX wheel_plinko_one_open_per_club ON public.wheel_plinko_sessions(user_id,club_id) WHERE NOT complete;
CREATE TABLE public.wheel_plinko_releases (
 award_id uuid NOT NULL REFERENCES public.wheel_plinko_sessions(award_id),
 request_id uuid NOT NULL, drop_all boolean NOT NULL, receipt jsonb NOT NULL,
 PRIMARY KEY(award_id,request_id)
);
ALTER TABLE public.wheel_plinko_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_plinko_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wheel_plinko_sessions,public.wheel_plinko_releases FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_wheel_plinko_progress(p_award_id uuid DEFAULT NULL,p_club_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.wheel_plinko_sessions; result jsonb; top_up numeric:=0;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Sign In To Play'); END IF;
 SELECT * INTO s FROM public.wheel_plinko_sessions WHERE user_id=auth.uid()
 AND (p_award_id IS NULL OR award_id=p_award_id) AND (p_club_id IS NULL OR club_id=p_club_id)
 AND (p_award_id IS NOT NULL OR (p_club_id IS NOT NULL AND NOT complete));
 IF s.sealed_result IS NULL THEN RETURN jsonb_build_object('ok',true,'active',false); END IF;
 IF s.complete THEN
  result:=s.sealed_result;
  SELECT (result->>'payout_chips')::numeric-sum((d->>'payout_chips')::numeric) INTO top_up FROM jsonb_array_elements(result->'drops') d;
 ELSE result:=(s.sealed_result-ARRAY['server_seed','payout_chips','drops'])
  ||jsonb_build_object('payout_chips',s.released_chips,'drops',
   COALESCE((SELECT jsonb_agg(d.value ORDER BY d.n) FROM jsonb_array_elements(s.sealed_result->'drops') WITH ORDINALITY d(value,n)
   WHERE d.n<=s.released_count),'[]'::jsonb)); END IF;
 RETURN result||public.fn_wheel_award_receipt(s.commit_id)||jsonb_build_object('active',NOT s.complete,'complete',s.complete,
  'guarantee_top_up_chips',top_up,'released_count',s.released_count,'total_count',jsonb_array_length(s.sealed_result->'drops'),'released_chips',s.released_chips);
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_plinko_progress(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_plinko_progress(uuid,uuid) TO authenticated,service_role;

-- The internal writer is shared with historical clients, which still settle
-- their entire batch immediately. Only an in-flight matching begin RPC creates
-- a session row. Both paths seal and debit using exactly the same primitives.
DO $$
DECLARE body text; f regprocedure; item record;
BEGIN
 f:='public.fn_plinko_bonus_run(uuid,uuid,text,bigint,bigint,integer)'::regprocedure;
 body:=pg_get_functiondef(f);
 FOR item IN SELECT * FROM (VALUES
 ('DECLARE adm record;', 'DECLARE staged boolean; adm record;'),
 (' IF paid>0 THEN',$patch$ SELECT EXISTS(SELECT 1 FROM public.wheel_plinko_sessions s WHERE s.commit_id=p_commit AND s.user_id=auth.uid() AND s.sealed_result IS NULL) INTO staged;
 IF paid>0 AND NOT staged THEN$patch$),
 ('chips_paid=chips_paid+paid','chips_paid=chips_paid+CASE WHEN staged THEN 0 ELSE paid END,
   reserved_chips=reserved_chips+CASE WHEN staged THEN paid ELSE 0 END'),
 (' RETURN result;', $patch$ IF staged THEN
  UPDATE public.wheel_plinko_sessions SET sealed_result=result WHERE commit_id=p_commit;
  RETURN public.fn_wheel_plinko_progress((SELECT award_id FROM public.wheel_plinko_sessions WHERE commit_id=p_commit),p_club);
 END IF;
 RETURN result;$patch$)
 ) v(needle,replacement) LOOP
  IF strpos(body,item.needle)=0 THEN RAISE EXCEPTION 'Plinko settlement source changed: %',item.needle; END IF;
  body:=replace(body,item.needle,item.replacement);
 END LOOP;
 EXECUTE body;
 body:=pg_get_functiondef('public.fn_wheel_bonus_current_result(public.wheel_bonus_awards)'::regprocedure);
 IF strpos(body,' ELSE RETURN a.result;')=0 THEN RAISE EXCEPTION 'Current bonus reader changed'; END IF;
 EXECUTE replace(body,' ELSE RETURN a.result;', $patch$ ELSIF a.game='plinko' AND EXISTS(SELECT 1 FROM public.wheel_plinko_sessions s WHERE s.award_id=a.id AND s.user_id=auth.uid())
 THEN RETURN public.fn_wheel_plinko_progress(a.id,a.club_id);
 ELSE RETURN a.result;$patch$);
 body:=pg_get_functiondef('public.fn_diamond_bonus_latest(uuid,text)'::regprocedure);
 IF strpos(body,'v_latest_result:=r.result;')=0 THEN RAISE EXCEPTION 'Latest bonus reader changed'; END IF;
 EXECUTE replace(body,'v_latest_result:=r.result;',$patch$v_latest_result:=r.result;
 IF p_game='plinko' AND EXISTS(SELECT 1 FROM public.wheel_plinko_sessions s WHERE s.award_id=r.wheel_award_id AND s.user_id=auth.uid()) THEN
  v_latest_result:=public.fn_wheel_plinko_progress(r.wheel_award_id,p_club_id);
 END IF;$patch$);
END $$;

CREATE FUNCTION public.fn_wheel_plinko_release(p_award_id uuid,p_request_id uuid,p_all boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.wheel_plinko_sessions; prior public.wheel_plinko_releases; a public.wheel_bonus_awards;
 target integer; total integer; amount numeric; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_request_id IS NULL OR p_all IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Choose A Drop'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,94615));
 SELECT * INTO s FROM public.wheel_plinko_sessions WHERE award_id=p_award_id AND user_id=auth.uid() FOR UPDATE;
 IF s.sealed_result IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Start This Plinko Award First'); END IF;
 SELECT * INTO prior FROM public.wheel_plinko_releases WHERE award_id=p_award_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.drop_all<>p_all THEN RETURN jsonb_build_object('ok',false,'error','This Request Selected Different Drops'); END IF;
  RETURN prior.receipt;
 END IF;
 IF s.complete THEN RETURN public.fn_wheel_plinko_progress(p_award_id,s.club_id)||jsonb_build_object('operation_chips',0); END IF;
 IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('ok',false,'error','The Platform Is In Its Maintenance Break'); END IF;
 SELECT * INTO STRICT a FROM public.wheel_bonus_awards WHERE id=p_award_id;
 total:=jsonb_array_length(s.sealed_result->'drops');
 target:=CASE WHEN p_all THEN total ELSE s.released_count+1 END;
 -- The final release also posts any batch-wide guarantee uplift exactly once.
 IF target=total THEN amount:=(s.sealed_result->>'payout_chips')::numeric-s.released_chips;
 ELSE SELECT (s.sealed_result->'drops'->s.released_count->>'payout_chips')::numeric INTO amount; END IF;
 IF amount>0 THEN
  -- Games admit and settle with the pool locked before any paying wallet.
  PERFORM 1 FROM public.diamond_game_pools WHERE host_id=a.host_id AND game='plinko' FOR UPDATE;
  PERFORM public.fn_diamond_game_pay_chips('plinko_prize',a.host_id,a.host_kind,s.club_id,s.user_id,amount,
    'plinko-drop:'||p_award_id||':'||target,'Diamond Spins Plinko Drop',jsonb_build_object('bonus_id',s.sealed_result->>'id','from_drop',s.released_count+1,'to_drop',target));
  UPDATE public.diamond_game_pools SET chips_paid=chips_paid+amount,reserved_chips=reserved_chips-amount,updated_at=now() WHERE host_id=a.host_id AND game='plinko';
 END IF;
 UPDATE public.wheel_plinko_sessions SET released_count=target,released_chips=released_chips+amount,complete=(target=total) WHERE award_id=p_award_id;
 result:=public.fn_wheel_plinko_progress(p_award_id,s.club_id)||jsonb_build_object('operation_chips',amount);
 INSERT INTO public.wheel_plinko_releases VALUES(p_award_id,p_request_id,p_all,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_plinko_release(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_plinko_release(uuid,uuid,boolean) TO authenticated,service_role;

CREATE FUNCTION public.fn_wheel_plinko_begin(p_award_id uuid,p_commit_id uuid,p_client_seed text,p_double boolean,p_denom bigint,p_table_version integer,p_request_id uuid,p_all boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.wheel_bonus_awards; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_request_id IS NULL OR p_all IS NULL OR p_commit_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Choose A Drop'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,94615));
 SELECT * INTO a FROM public.wheel_bonus_awards WHERE id=p_award_id AND user_id=auth.uid() AND game='plinko' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This Plinko Award Does Not Belong To You'); END IF;
 IF a.status='pending' THEN
  IF EXISTS(SELECT 1 FROM public.wheel_plinko_sessions WHERE user_id=a.user_id AND club_id=a.club_id AND NOT complete) THEN
   RETURN jsonb_build_object('ok',false,'error','Finish Your Current Plinko Run First'); END IF;
  INSERT INTO public.wheel_plinko_sessions(award_id,user_id,club_id,commit_id) VALUES(a.id,a.user_id,a.club_id,p_commit_id);
 ELSIF NOT EXISTS(SELECT 1 FROM public.wheel_plinko_sessions WHERE award_id=a.id AND commit_id=p_commit_id) THEN
  RETURN jsonb_build_object('ok',false,'error','This Award Was Already Played'); END IF;
 result:=public.fn_wheel_bonus_start(a.id,p_commit_id,p_client_seed,p_double,NULL,p_denom,p_table_version,NULL,NULL);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN
  IF a.status='pending' THEN DELETE FROM public.wheel_plinko_sessions WHERE award_id=a.id; END IF;
  RETURN result;
 END IF;
 RETURN public.fn_wheel_plinko_release(a.id,p_request_id,p_all);
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_plinko_begin(uuid,uuid,text,boolean,bigint,integer,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_plinko_begin(uuid,uuid,text,boolean,bigint,integer,uuid,boolean) TO authenticated,service_role;
COMMIT;
