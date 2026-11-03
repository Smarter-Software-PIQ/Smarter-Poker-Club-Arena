-- @live-proof: md5(pg_get_functiondef('public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)'::regprocedure))='3ae177af2d3560af6e0cc83073b1165c' AND md5(pg_get_functiondef('smarter_private.assert_tournament_abort_not_recovered(uuid,uuid)'::regprocedure))='b3661e1f8385ebdcc8e73f938fc9f1c8' AND NOT has_function_privilege('authenticated','public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)','EXECUTE')
-- Latest owner direction in chat01a1a01a: remove all old incomplete events and
-- settle old liabilities before relaunch. Supersedes the earlier four-human
-- preservation direction, not custody, refunds, earned awards or physical drain.
-- No event, ledger, wallet or receipt is changed by installing this policy.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)'::regprocedure)) IS DISTINCT FROM '946d84d5c7aed5682857461aeed97fa4' THEN RAISE EXCEPTION 'old_closeout_owner_changed:withdraw'; END IF;
 IF md5(pg_get_functiondef('smarter_private.assert_tournament_abort_not_recovered(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '1baa1d929351bbab05294dae85f208fa' THEN RAISE EXCEPTION 'old_closeout_owner_changed:guard'; END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_withdraw_tournament_abort_for_original_recovery(p_operation_id uuid, p_tournament_id uuid, p_recovery_id uuid, p_instance_id text, p_lease_generation uuid, p_release_sha text, p_freeze_started timestamp with time zone, p_ownership_token uuid, p_custody_md5 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets; prior smarter_private.tournament_abort_recoveries;
BEGIN
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'original_recovery_read_committed_required' USING ERRCODE='55000';END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (session_user='postgres' AND auth.role() IS NULL AND coalesce(current_setting('role',true),'none') IN('none','postgres')) THEN
  RAISE EXCEPTION 'original_recovery_service_or_genuine_management_required' USING ERRCODE='42501';END IF;
 IF p_operation_id IS DISTINCT FROM 'd44c4440-2911-430c-8ee7-376611ef3f38'::uuid
 OR p_tournament_id IS NULL OR p_tournament_id<>ALL(ARRAY['095d7449-3282-46c5-8a39-768fe14dce5a','0cb8e80f-4031-4b72-bbd6-f076605f1575','0ef3dbfb-c092-4008-b7bd-bde65a474e83','135b187e-c096-483a-b347-10be69df956b','19cf1192-d926-4042-a13c-67eca5ebf9a3','2305ddd2-58af-43fb-9089-567108e4ca77','46ba2e7c-c9f8-42b6-b416-d7342a676531','64599cc4-03bb-4f1d-8df7-ef610abe10af','6c6724e5-1ee4-40c0-ad21-44e9f9b6d800','7932d2bb-7cfb-4b0e-ae99-75fcbae82d52','7ab02286-fa29-44a2-a64f-0cb3d60ca572','8229a0af-3c5a-4672-b9df-3d8523613086','85bec2f4-0aa8-42b8-8799-d9d3acff2275','8855c50e-c4ed-4235-91c1-323627023b15','c685ebb7-954d-4a38-a26d-9c23c23600a4','d110fd05-846e-46c1-adca-a2e515e95144','dbaca4cd-8959-427d-8b91-2d97310e6fd6','deaa61a7-0553-4c81-a178-e9ba822a1ba2','debf5e04-6f4d-4858-88a0-84b6fe1ba598','fdfcadfd-4044-4696-874d-5ec50cf93a48','2781bcd7-cc8a-4713-ab3e-0d0a81fdf110','6379b29e-1307-4e8b-91e7-e9a0975cd64d','7986217a-0a67-4585-bd43-254356a9cb54']::uuid[])
 OR p_recovery_id IS NULL OR p_instance_id IS NULL OR p_lease_generation IS NULL
 OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
 OR p_freeze_started IS NULL OR p_ownership_token IS NULL OR p_custody_md5 IS NULL
 OR p_custody_md5 !~ '^[0-9a-f]{32}$' THEN
  RAISE EXCEPTION 'original_recovery_exact_owner_cohort_required' USING ERRCODE='22023';END IF;
 -- Same original cancellation lane, not an unrelated/global transaction owner.
 -- This serializes withdrawal with all original ACK/refund/settlement routes.
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'original_recovery_platform_frozen' USING ERRCODE='55000';END IF;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR a.operation_id IS DISTINCT FROM p_operation_id THEN RAISE EXCEPTION 'original_recovery_original_operation_missing' USING ERRCODE='55000';END IF;
 SELECT * INTO prior FROM smarter_private.tournament_abort_recoveries WHERE tournament_id=p_tournament_id;
 IF FOUND THEN
  IF prior.operation_id IS DISTINCT FROM p_operation_id OR prior.recovery_id IS DISTINCT FROM p_recovery_id
  OR prior.instance_id IS DISTINCT FROM p_instance_id OR prior.lease_generation IS DISTINCT FROM p_lease_generation
  OR prior.release_sha IS DISTINCT FROM p_release_sha OR prior.freeze_started_at IS DISTINCT FROM p_freeze_started
  OR prior.ownership_token IS DISTINCT FROM p_ownership_token OR md5(prior.original_custody::text) IS DISTINCT FROM p_custody_md5 THEN
   RAISE EXCEPTION 'original_recovery_identity_reused' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('ok',true,'state','recovery','already_recorded',true,'recovery_id',prior.recovery_id,'tournament_id',p_tournament_id);
 END IF;
 -- November 3 owner instruction: close all old events before relaunch.
 -- Preserve already-recorded disposition replays above, but do not resume
 -- these original twenty or three human events under the superseded plan.
 RAISE EXCEPTION 'original_recovery_superseded_by_old_event_closeout' USING ERRCODE='55000';
END $function$
;
CREATE OR REPLACE FUNCTION smarter_private.assert_tournament_abort_not_recovered(p_operation_id uuid, p_tournament_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
BEGIN
 -- An older repeatable-read snapshot cannot safely observe a new append-only disposition.
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'operator_abort_read_committed_required' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_recoveries WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id) THEN
  RAISE EXCEPTION 'operator_abort_withdrawn_for_original_recovery' USING ERRCODE='55000';
 END IF;
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION smarter_private.assert_tournament_abort_not_recovered(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
