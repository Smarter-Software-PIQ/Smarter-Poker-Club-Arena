-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_tournament_abort_equal_share_receipt(uuid,uuid)'::regprocedure))='dfef0d748953de0a146504529cc5daa2' AND has_function_privilege('service_role','public.fn_ca_tournament_abort_equal_share_receipt(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_tournament_abort_equal_share_receipt(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_tournament_abort_equal_share_receipt(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.fn_ca_tournament_cancellation_receipt(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','smarter_private.tournament_equal_share_receipt(uuid,uuid)','EXECUTE'))
-- Canonical equal-share readback is operation-bound and service-only.
-- The existing cancellation reader and private economic validator stay private.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preimage$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_tournament_cancellation_receipt(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'b6dad088592fcbbf313ddab376478532'
 OR md5(pg_get_functiondef('smarter_private.tournament_equal_share_receipt(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '574b3f32a9dbc54f989618901bf868f6'
 OR has_function_privilege('service_role','public.fn_ca_tournament_cancellation_receipt(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.fn_ca_tournament_cancellation_receipt(uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.fn_ca_tournament_cancellation_receipt(uuid,uuid)','EXECUTE')
 OR has_function_privilege('service_role','smarter_private.tournament_equal_share_receipt(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','smarter_private.tournament_equal_share_receipt(uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','smarter_private.tournament_equal_share_receipt(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'equal_share_readback_private_authority_changed' USING ERRCODE='55000';END IF;
END $preimage$;
CREATE FUNCTION public.fn_ca_tournament_abort_equal_share_receipt(p_operation_id uuid,p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,smarter_private AS $function$
DECLARE target smarter_private.tournament_abort_targets; canonical jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO target FROM smarter_private.tournament_abort_targets
 WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_abort_target_not_owned' USING ERRCODE='55000';END IF;
 IF target.state IS DISTINCT FROM 'settled' THEN RAISE EXCEPTION 'equal_share_readback_target_not_settled' USING ERRCODE='55000';END IF;
 canonical:=public.fn_ca_tournament_cancellation_receipt(p_tournament_id,NULL);
 IF canonical IS DISTINCT FROM target.receipt
 OR canonical->'receipt_version' IS DISTINCT FROM '4'::jsonb
 OR canonical->>'mode' IS DISTINCT FROM 'started_operator_equal_share'
 OR canonical->>'operation_id' IS DISTINCT FROM p_operation_id::text
 OR canonical->>'tournament_id' IS DISTINCT FROM p_tournament_id::text
 OR canonical->'ok' IS DISTINCT FROM 'true'::jsonb
 OR canonical->'success' IS DISTINCT FROM 'true'::jsonb
 OR canonical->'fully_settled' IS DISTINCT FROM 'true'::jsonb
 OR canonical->>'status' IS DISTINCT FROM 'CANCELLED'
 THEN RAISE EXCEPTION 'equal_share_readback_canonical_receipt_changed' USING ERRCODE='55000';END IF;
 RETURN canonical;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_abort_equal_share_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_abort_equal_share_receipt(uuid,uuid) TO service_role;
COMMIT;
