-- Creating an ordinary event and sealing its days in a second transaction
-- admits registration between the two writes; the existing seal then refuses
-- players_registered. Create and seal through their unchanged authorities in
-- one transaction, binding the exact plan into the original request receipt.
-- A refused seal rolls back creation, receipt and commerce basis together.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_create_tournament(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM 'd3585069bf906c99bdb3ae795ac4304d'
     OR md5(pg_get_functiondef('public.fn_operator_seal_stage_plan(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM '8ec06ec0a3cce9fcf2d15b2e78aaeaf4'
     OR md5(pg_get_functiondef('public.fn_seal_tournament_stage_plan(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM 'c2b49a7ab4fd7f796edec122bfccd7d2' THEN
    RAISE EXCEPTION 'staged_tournament_create_authority_changed';
  END IF;
  PERFORM 'public.fn_create_tournament_request(uuid,jsonb,uuid,uuid)'::regprocedure;
END $pre$;

CREATE FUNCTION public.fn_create_staged_tournament_request(
  p_club_id uuid, p_config jsonb, p_request_id uuid, p_actor_id uuid, p_plan jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE
  v_uid uuid:=auth.uid();
  v_existed boolean;
  v_created jsonb;
  v_sealed jsonb;
  v_id uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL OR p_actor_id IS DISTINCT FROM v_uid
     OR NOT COALESCE(public.fn_caller_session_is_live(),false) THEN
    RETURN jsonb_build_object('success',false,'error','not_authenticated');
  END IF;
  IF p_club_id IS NULL OR NOT COALESCE(public.fn_can_create_games(p_club_id,v_uid),false) THEN
    RETURN jsonb_build_object('success',false,'error','not_authorised');
  END IF;
  IF p_request_id IS NULL OR p_config IS NULL OR jsonb_typeof(p_config)<>'object'
     OR p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' OR p_config ? 'stagePlan' THEN
    RETURN jsonb_build_object('success',false,'error','staged_tournament_request_invalid');
  END IF;
  -- Same lock as the original request adapter. A refusal is known not_created
  -- only when no accepted request existed before this nested transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('tournament-create-request:'||p_request_id::text,0));
  SELECT EXISTS(SELECT 1 FROM smarter_private.tournament_create_receipts
    WHERE request_id=p_request_id) INTO v_existed;
  BEGIN
    v_created:=public.fn_create_tournament_request(p_club_id,
      p_config||jsonb_build_object('stagePlan',p_plan),p_request_id,p_actor_id);
    IF v_created->'success' IS DISTINCT FROM 'true'::jsonb THEN RETURN v_created; END IF;
    v_id:=(v_created->>'tournament_id')::uuid;
    v_sealed:=public.fn_operator_seal_stage_plan(v_id,p_plan);
    IF v_sealed->'ok'='false'::jsonb AND jsonb_typeof(v_sealed->'reason')='string' THEN
      RAISE EXCEPTION USING ERRCODE='PST01', MESSAGE=v_sealed->>'reason';
    END IF;
    IF v_sealed->'ok' IS DISTINCT FROM 'true'::jsonb
       OR v_sealed->>'tournament_id' IS DISTINCT FROM v_id::text
       OR v_sealed->>'plan_hash' IS DISTINCT FROM md5(p_plan::text)
       OR (v_sealed->>'stage_count')::integer IS DISTINCT FROM jsonb_array_length(p_plan->'stages') THEN
      RAISE EXCEPTION 'staged_tournament_receipt_unconfirmed';
    END IF;
    RETURN v_created||jsonb_build_object('stage_plan',v_sealed);
  EXCEPTION WHEN SQLSTATE 'PST01' THEN
    GET STACKED DIAGNOSTICS v_reason=MESSAGE_TEXT;
    IF v_existed THEN
      RAISE EXCEPTION 'staged_tournament_existing_request_unsealed: %',v_reason USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('success',false,'error','staged_tournament_plan_refused',
      'reason',v_reason,'request_state','not_created','request_id',p_request_id,
      'user_id',v_uid,'club_id',p_club_id);
  END;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_create_staged_tournament_request(uuid,jsonb,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_create_staged_tournament_request(uuid,jsonb,uuid,uuid,jsonb) TO authenticated,service_role;
COMMIT;
