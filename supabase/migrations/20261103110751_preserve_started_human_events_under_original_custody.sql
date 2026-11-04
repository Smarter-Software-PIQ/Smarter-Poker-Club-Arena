-- @live-proof: md5(pg_get_functiondef('public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)'::regprocedure))='946d84d5c7aed5682857461aeed97fa4' AND md5(pg_get_functiondef('smarter_private.assert_tournament_abort_not_recovered(uuid,uuid)'::regprocedure))='1baa1d929351bbab05294dae85f208fa' AND NOT has_function_privilege('authenticated','public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)','EXECUTE') AND has_function_privilege('service_role','public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)','EXECUTE') AND md5(pg_get_functiondef('public.fn_ca_request_tournament_abort(uuid,uuid[],text)'::regprocedure))='3025d9faf65e9b2336dcf9b794f6c17f'
-- Later owner direction preserves these three already-started human events.
-- Old stop membership is immutable; no hand, money, roster or receipt is rewritten.
-- Only the existing custody-proven withdrawal can enable successor hands.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text)'::regprocedure)) IS DISTINCT FROM '8cea7abe692c880017a4263db3a39f23' THEN RAISE EXCEPTION 'human_preservation_owner_changed:withdraw'; END IF;
 IF md5(pg_get_functiondef('smarter_private.assert_tournament_abort_not_recovered(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'b3661e1f8385ebdcc8e73f938fc9f1c8' THEN RAISE EXCEPTION 'human_preservation_owner_changed:guard'; END IF;
 IF md5(pg_get_functiondef('public.fn_ca_request_tournament_abort(uuid,uuid[],text)'::regprocedure)) IS DISTINCT FROM 'b901916e3c9c0ca23540ab66a146880d' THEN RAISE EXCEPTION 'human_preservation_owner_changed:request'; END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_withdraw_tournament_abort_for_original_recovery(p_operation_id uuid, p_tournament_id uuid, p_recovery_id uuid, p_instance_id text, p_lease_generation uuid, p_release_sha text, p_freeze_started timestamp with time zone, p_ownership_token uuid, p_custody_md5 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets; prior smarter_private.tournament_abort_recoveries;
 custody jsonb; t public.tournaments; lease public.engine_tournament_leases; thaw public.engine_maintenance_thaws;
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
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF t.started_at IS NULL OR upper(t.status) NOT IN('RUNNING','BREAK','LATE_REG')
 OR a.state NOT IN('stop_requested','quiesced') OR a.settled_at IS NOT NULL OR a.receipt IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.tournament_cancellation_receipts WHERE tournament_id=p_tournament_id)
 OR EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE tournament_id=p_tournament_id)
 OR EXISTS(SELECT 1 FROM smarter_private.diamond_tournament_abort_receipts WHERE tournament_id=p_tournament_id) THEN
  RAISE EXCEPTION 'original_recovery_terminal_or_refund_forbids_resurrection' USING ERRCODE='55000';END IF;
 -- This control-only operation accepts genuine management as well as service.
 -- Read the same canonical F06 lease predicates directly; never spoof the
 -- engine actor/JWT GUCs required by the financial hand mutation functions.
 SELECT * INTO lease FROM public.engine_tournament_leases WHERE tournament_id=p_tournament_id FOR KEY SHARE;
 IF lease.instance_id IS DISTINCT FROM p_instance_id OR lease.lease_generation IS DISTINCT FROM p_lease_generation
 OR lease.protocol_version IS DISTINCT FROM 2 OR lease.heartbeat_at<clock_timestamp()-interval '15 seconds'
 OR NOT EXISTS(SELECT 1 FROM public.engine_leader l WHERE l.id=true AND l.instance_id=p_instance_id
   AND l.engine_version=left(p_release_sha,8) AND l.heartbeat_at>=clock_timestamp()-interval '15 seconds') THEN
  RAISE EXCEPTION 'original_recovery_current_serving_authority_required' USING ERRCODE='55000';END IF;
 SELECT * INTO thaw FROM public.engine_maintenance_thaws WHERE freeze_started_at=p_freeze_started;
 IF NOT FOUND OR thaw.contract_version IS DISTINCT FROM 3 OR thaw.ownership_token IS DISTINCT FROM p_ownership_token
 OR thaw.thawed_by IS DISTINCT FROM left(p_release_sha,8) OR thaw.thawed_at IS NULL OR thaw.thawed_at>clock_timestamp() OR thaw.release_target_at IS NULL
 OR thaw.release_target_at>clock_timestamp() OR thaw.shifted->>'complete' IS DISTINCT FROM 'true'
 OR NOT(thaw.shifted ?& ARRAY['sit_out_at','hold_expires_at','addon_period_ends_at','reversible_until','reveal_deadline_at','rebuy_prompt_until','bomb_pot_next_due_at','cash_stay_last_tick_at','cash_rejoin_expires_at','level_started_at','cluster_break_eligible_since','cluster_move_expires_at','reconnect_presence','reconnect_snapshots'])
 OR EXISTS(SELECT 1 FROM public.engine_maintenance_break) THEN
  RAISE EXCEPTION 'original_recovery_own_complete_v3_thaw_required' USING ERRCODE='55000';END IF;
 custody:=smarter_private.tournament_recovery_original_custody(p_tournament_id);
 IF jsonb_array_length(custody)=0 OR md5(custody::text) IS DISTINCT FROM p_custody_md5
 OR EXISTS(SELECT 1 FROM smarter_private.tournament_abort_boundaries b
  CROSS JOIN LATERAL jsonb_array_elements(b.existing_permits) o
  LEFT JOIN smarter_private.f06_hand_permits h ON h.permit_id=(o.value->>'permit_id')::uuid
  LEFT JOIN smarter_private.hand_continuations c ON c.permit_id=h.permit_id
  WHERE b.operation_id=p_operation_id AND b.tournament_id=p_tournament_id AND (
   h.permit_id IS NULL OR h.tournament_id IS DISTINCT FROM p_tournament_id OR h.table_id IS DISTINCT FROM b.table_id
   OR h.hand_number::text IS DISTINCT FROM o.value->>'hand_number' OR h.lifecycle::text IS DISTINCT FROM o.value->>'lifecycle'
   OR h.custody_id::text IS DISTINCT FROM o.value->>'custody_id' OR h.generation::text IS DISTINCT FROM o.value->>'generation'
   OR EXISTS(SELECT 1 FROM smarter_private.hand_continuation_dispositions z WHERE z.table_id=h.table_id AND z.hand_number=h.hand_number AND z.disposition='disposed')
   OR CASE WHEN h.state='reserved' THEN (
     c.permit_id IS NULL OR c.table_id IS DISTINCT FROM h.table_id OR c.hand_number IS DISTINCT FROM h.hand_number
     OR c.tournament_id IS DISTINCT FROM h.tournament_id OR c.original_generation IS DISTINCT FROM h.generation
     OR c.writer_generation IS DISTINCT FROM p_lease_generation
     OR c.payload_sha256 IS DISTINCT FROM encode(extensions.digest(c.payload,'sha256'),'hex')
     OR NOT EXISTS(SELECT 1 FROM public.tables tb WHERE tb.id=h.table_id AND tb.tournament_id=p_tournament_id AND tb.f06_lifecycle=h.lifecycle)
   ) WHEN h.state='accepted' THEN NOT EXISTS(
     SELECT 1 FROM public.hand_atomic_commits ac JOIN public.hand_history hh ON hh.id=ac.hand_id AND hh.table_id=ac.table_id AND hh.hand_number=ac.hand_number
     WHERE ac.table_id=h.table_id AND ac.hand_number=h.hand_number AND ac.hand_id=h.evidence_id
      AND ac.post_commit_completed_at IS NOT NULL AND ac.post_commit_result->>'ok'='true' AND hh.tournament_id=p_tournament_id
   ) ELSE true END))
 OR EXISTS(SELECT 1 FROM smarter_private.f06_hand_permits h WHERE h.tournament_id=p_tournament_id AND h.state='reserved'
  AND NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_boundaries b CROSS JOIN LATERAL jsonb_array_elements(b.existing_permits) o
   WHERE b.operation_id=p_operation_id AND b.tournament_id=p_tournament_id AND o.value->>'permit_id'=h.permit_id::text)) THEN
  RAISE EXCEPTION 'original_recovery_canonical_original_custody_required' USING ERRCODE='55000';END IF;
 INSERT INTO smarter_private.tournament_abort_recoveries(tournament_id,operation_id,recovery_id,owner_instruction,
 instance_id,lease_generation,release_sha,freeze_started_at,ownership_token,original_target,original_custody,money_snapshot)
 VALUES(p_tournament_id,p_operation_id,p_recovery_id,CASE WHEN p_tournament_id=ANY(ARRAY['2781bcd7-cc8a-4713-ab3e-0d0a81fdf110','6379b29e-1307-4e8b-91e7-e9a0975cd64d','7986217a-0a67-4585-bd43-254356a9cb54']::uuid[]) THEN '01a1a01a-7f70-7d62-8da1-8d086594c658: preserve already-started human events; no new tournaments' ELSE '01a192b6-c749-7ac2-8c18-cadeb3923073: finish exact20 naturally; no new tournaments' END,
 p_instance_id,p_lease_generation,p_release_sha,p_freeze_started,p_ownership_token,to_jsonb(a),custody,
 smarter_private.tournament_abort_money_snapshot(p_tournament_id));
 RETURN jsonb_build_object('ok',true,'state','recovery','already_recorded',false,'recovery_id',p_recovery_id,'tournament_id',p_tournament_id);
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
 IF p_tournament_id=ANY(ARRAY['2781bcd7-cc8a-4713-ab3e-0d0a81fdf110','6379b29e-1307-4e8b-91e7-e9a0975cd64d','7986217a-0a67-4585-bd43-254356a9cb54','d5decc98-cd0f-417f-aa28-6df009a74c76']::uuid[]) THEN
  RAISE EXCEPTION 'operator_abort_superseded_preserve_started_humans' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_recoveries WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id) THEN
  RAISE EXCEPTION 'operator_abort_withdrawn_for_original_recovery' USING ERRCODE='55000';
 END IF;
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_withdraw_tournament_abort_for_original_recovery(uuid,uuid,uuid,text,uuid,text,timestamptz,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION smarter_private.assert_tournament_abort_not_recovered(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fn_ca_request_tournament_abort(p_operation_id uuid, p_tournament_ids uuid[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE ids uuid[]; t public.tournaments; generation uuid; prior smarter_private.tournament_abort_operations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF p_operation_id IS NULL OR p_tournament_ids IS NULL OR cardinality(p_tournament_ids) NOT BETWEEN 1 AND 1000
 OR array_position(p_tournament_ids,NULL) IS NOT NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'operator_abort_identity_invalid' USING ERRCODE='22023';END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT DISTINCT unnest(p_tournament_ids) id)x;
 IF cardinality(ids)<>cardinality(p_tournament_ids) THEN RAISE EXCEPTION 'operator_abort_duplicate_target' USING ERRCODE='22023';END IF;
 PERFORM smarter_private.assert_tournament_abort_not_recovered(p_operation_id,id) FROM unnest(ids) AS requested(id);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ca:tournament-abort:'||p_operation_id::text,0)) THEN
  RAISE EXCEPTION 'OPERATOR_ABORT_BUSY' USING ERRCODE='55P03';END IF;
 SELECT * INTO prior FROM smarter_private.tournament_abort_operations WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF prior.tournament_ids IS DISTINCT FROM ids OR prior.reason IS DISTINCT FROM btrim(p_reason) THEN
   RAISE EXCEPTION 'operator_abort_operation_reused' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('ok',true,'operation_id',p_operation_id,'tournament_ids',ids,'stop_requested',true,'replayed',true);
 END IF;
 -- This existing try-admission takes G and the settlement barrier before any
 -- parent/child row. It never queues an exclusive global request behind play.
 PERFORM smarter_private.cancellation_lane(ids[1]);
 PERFORM 1 FROM public.tournaments WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.tournaments WHERE id=ANY(ids))<>cardinality(ids) THEN
  RAISE EXCEPTION 'operator_abort_target_missing' USING ERRCODE='P0002';END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets WHERE tournament_id=ANY(ids)) THEN
  RAISE EXCEPTION 'operator_abort_target_owned' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.tournaments WHERE id=ANY(ids) AND (started_at IS NULL OR upper(status) NOT IN('RUNNING','BREAK','LATE_REG'))) THEN
  RAISE EXCEPTION 'operator_abort_requires_started_unsettled_event' USING ERRCODE='55000';END IF;
 INSERT INTO smarter_private.tournament_abort_operations(operation_id,tournament_ids,reason,cohort_hash)
 VALUES(p_operation_id,ids,btrim(p_reason),md5(ids::text));
 FOR t IN SELECT * FROM public.tournaments WHERE id=ANY(ids) ORDER BY id LOOP
  SELECT lease_generation INTO generation FROM public.engine_tournament_leases WHERE tournament_id=t.id AND protocol_version=2 FOR KEY SHARE;
  IF generation IS NULL THEN RAISE EXCEPTION 'operator_abort_manager_identity_missing:%',t.id USING ERRCODE='55000';END IF;
  INSERT INTO smarter_private.tournament_abort_targets(operation_id,tournament_id,state,asset,requested_generation)
  VALUES(p_operation_id,t.id,'stop_requested',CASE WHEN public.fn_poker_diamond_tournament(t.id) THEN 'diamonds' ELSE 'chips' END,generation);
  INSERT INTO smarter_private.tournament_abort_boundaries(operation_id,tournament_id,table_id,lifecycle,required,request_generation,existing_permits)
  SELECT p_operation_id,t.id,tb.id,tb.f06_lifecycle,lower(tb.status)<>'closed' AND NOT coalesce(tb.is_deleted,false),generation,
   coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.permit_id) FROM smarter_private.f06_hand_permits h WHERE h.table_id=tb.id AND h.state='reserved'),'[]'::jsonb)
  FROM public.tables tb WHERE tb.tournament_id=t.id ORDER BY tb.id;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'operation_id',p_operation_id,'tournament_ids',ids,'stop_requested',true,'replayed',false);
END $function$
;
REVOKE ALL ON FUNCTION public.fn_ca_request_tournament_abort(uuid,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_request_tournament_abort(uuid,uuid[],text) TO service_role;
COMMIT;
