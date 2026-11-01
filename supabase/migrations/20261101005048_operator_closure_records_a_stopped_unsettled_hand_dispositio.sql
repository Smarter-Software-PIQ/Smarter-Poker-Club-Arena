-- @live-proof: (SELECT bool_and(coalesce(md5(pg_get_functiondef(to_regprocedure(signature)))=expected,false)) FROM (VALUES ('fn_ca_ack_tournament_abort_boundary(uuid,uuid,uuid,uuid,bigint,jsonb)','7c0f9c9f2a8fd1e08002bc651bb635af'),('fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)','2eb90c4b5312f3d2bca312f09410f4e0'),('fn_ca_tournament_abort_stop_state(uuid,uuid)','f74b1f0d1d87c46973983de3b0d1c145'),('smarter_private.assert_tournament_abort_absence(uuid,uuid,uuid,uuid,jsonb)','e9af6f4efecbb36d49a0856ed9e11c3c'),('smarter_private.f06_immutable_identity()','a0d8646624b3a0830c9a757723da0ddb'),('smarter_private.f06_retained_submission_guard()','44902103e4c5f0feba7d19081af4325e'),('smarter_private.tournament_abort_archived_write_guard()','355c603dfe781cad526e7885008722b4'),('smarter_private.tournament_abort_hand_image(uuid)','7b20a8a44796f434023eb0364e582f71'),('smarter_private.tournament_abort_pending(uuid)','76d438db7f3c86791e81eed9b16d4b0e')) x(signature,expected)) AND (SELECT count(*)=6 FROM pg_trigger WHERE tgname='tournament_abort_archived_write' AND tgenabled='O' AND tgtype=23) AND (SELECT relrowsecurity FROM pg_class WHERE oid='smarter_private.tournament_abort_hand_dispositions'::regclass) AND NOT has_function_privilege('authenticated','public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE')
-- 20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @install-window: daily-maintenance
-- WHAT THIS CHANGES, AND WHY:
-- Explicit owner-directed equal-share closure needs a durable disposition for
-- stopped originals, including missing capsules. Preserve every available image,
-- refuse accepted outcomes, and serialize late writers against the closure.
-- This migration itself changes no financial balances or tournament outcomes.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

-- Explicit tournament cancellation, never an assertion that a reserved hand
-- was unstarted. Original images remain private and immutable. No wallet,
-- chip, player, snapshot or hand-result row is changed by this authority.
CREATE TABLE smarter_private.tournament_abort_hand_dispositions (
 receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL,
 tournament_id uuid NOT NULL,
 table_id uuid NOT NULL,
 permit_id uuid NOT NULL UNIQUE,
 generation uuid NOT NULL,
 writer_generation uuid NOT NULL,
 hand_number bigint NOT NULL,
 expected_hash text NOT NULL,
 original jsonb NOT NULL,
 boundary jsonb NOT NULL,
 outcome text NOT NULL DEFAULT 'aborted_unsettled' CHECK(outcome='aborted_unsettled'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX tournament_abort_hand_dispositions_table ON smarter_private.tournament_abort_hand_dispositions(table_id);
ALTER TABLE smarter_private.tournament_abort_hand_dispositions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.tournament_abort_hand_dispositions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tournament_abort_hand_disposition_immutable BEFORE UPDATE OR DELETE ON smarter_private.tournament_abort_hand_dispositions
FOR EACH ROW EXECUTE FUNCTION smarter_private.hand_submission_immutable();
CREATE TRIGGER tournament_abort_hand_disposition_no_truncate BEFORE TRUNCATE ON smarter_private.tournament_abort_hand_dispositions
FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.hand_submission_immutable();

CREATE FUNCTION smarter_private.tournament_abort_hand_image(p_permit_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
 SELECT jsonb_build_object('permit',to_jsonb(h),
 'parks',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.break_id) FROM smarter_private.f06_operations o WHERE o.source_table_id=h.table_id AND NOT(o.state=ANY(smarter_private.f06_terminal_operation_states()))),'[]'::jsonb),
 'continuations',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.hand_number) FROM smarter_private.hand_continuations c WHERE c.table_id=h.table_id),'[]'::jsonb),
 'submissions',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.hand_number) FROM smarter_private.hand_submissions c WHERE c.table_id=h.table_id AND c.hand_number=h.hand_number),'[]'::jsonb),
 'snapshots',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.hand_number) FROM public.hand_state_snapshots c WHERE c.table_id=h.table_id AND NOT c.is_complete),'[]'::jsonb),
 'seats',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.table_seats s WHERE s.table_id=h.table_id AND s.left_at IS NULL),'[]'::jsonb),
 'players',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'table_id',p.table_id,'seat_number',p.seat_number,'status',p.status,'chips',p.chips,'eliminated_at',p.eliminated_at) ORDER BY p.id) FROM public.tournament_players p WHERE p.tournament_id=h.tournament_id AND p.table_id=h.table_id),'[]'::jsonb))
 FROM smarter_private.f06_hand_permits h WHERE h.permit_id=p_permit_id;
$fn$;
REVOKE ALL ON FUNCTION smarter_private.tournament_abort_hand_image(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.assert_tournament_abort_absence(p_operation_id uuid,p_tournament_id uuid,p_table_id uuid,p_generation uuid,p_evidence jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE t public.tables;
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_not_recovered(p_operation_id,p_tournament_id);
 PERFORM smarter_private.f06_authority(p_tournament_id,p_generation);
 IF NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a WHERE a.operation_id=p_operation_id AND a.tournament_id=p_tournament_id AND a.state<>'settled') THEN
  RAISE EXCEPTION 'operator_abort_target_not_acknowledgeable' USING ERRCODE='55000';END IF;
 SELECT * INTO t FROM public.tables WHERE id=p_table_id AND tournament_id=p_tournament_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR p_evidence IS NULL
 OR ((p_evidence->>'kind'='tournament_abort_absent_boundary_v2' AND p_evidence->>'physical_engine_absent'='true' AND p_evidence->'engine_id'='null'::jsonb)
 OR (p_evidence->>'kind'='tournament_abort_cancelled_boundary_v2' AND p_evidence->>'closure_mode'='equal_share' AND length(p_evidence->>'engine_id')>0)) IS DISTINCT FROM true
 OR p_evidence->>'certificate_version' IS DISTINCT FROM '2'
 OR p_evidence->>'physical_stopped' IS DISTINCT FROM 'true'
 OR p_evidence->>'parked_before_retirement' IS DISTINCT FROM 'false'
 OR p_evidence->>'drained' IS DISTINCT FROM 'true'
 OR p_evidence->>'manager_tail_joined' IS DISTINCT FROM 'true'
 OR p_evidence->>'pending_writers' IS DISTINCT FROM '0'
 OR p_evidence->>'bank_state_write_pending' IS DISTINCT FROM 'false'
 OR (p_evidence->>'lifecycle')::bigint IS DISTINCT FROM t.f06_lifecycle THEN
  RAISE EXCEPTION 'operator_abort_absence_unproven' USING ERRCODE='P0404';END IF;
 IF jsonb_typeof(p_evidence->'source_table_ids') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM public.tables x WHERE x.tournament_id=p_tournament_id AND lower(x.status)<>'closed' AND NOT coalesce(x.is_deleted,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_evidence->'source_table_ids') z WHERE z.value::uuid=x.id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_evidence->'source_table_ids') z WHERE NOT EXISTS(SELECT 1 FROM public.tables x WHERE x.id=z.value::uuid AND x.tournament_id=p_tournament_id)) THEN
  RAISE EXCEPTION 'operator_abort_physical_roster_incomplete' USING ERRCODE='P0404';END IF;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.assert_tournament_abort_absence(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand(p_operation_id uuid,p_tournament_id uuid,p_table_id uuid,p_generation uuid,p_permit_id uuid,p_expected_hash text,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE h smarter_private.f06_hand_permits; prior smarter_private.tournament_abort_hand_dispositions; original jsonb; receipt uuid; before_money jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF p_evidence->>'closure_mode' IS DISTINCT FROM 'equal_share' THEN RAISE EXCEPTION 'operator_abort_explicit_equal_share_required' USING ERRCODE='42501';END IF;
 PERFORM smarter_private.assert_tournament_abort_absence(p_operation_id,p_tournament_id,p_table_id,p_generation,p_evidence);
 SELECT * INTO prior FROM smarter_private.tournament_abort_hand_dispositions WHERE permit_id=p_permit_id;
 IF FOUND THEN
  IF (prior.operation_id,prior.tournament_id,prior.table_id,prior.expected_hash) IS DISTINCT FROM (p_operation_id,p_tournament_id,p_table_id,p_expected_hash) THEN RAISE EXCEPTION 'operator_abort_hand_changed_replay' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'receipt_id',prior.receipt_id,'outcome',prior.outcome);
 END IF;
 SELECT * INTO h FROM smarter_private.f06_hand_permits WHERE permit_id=p_permit_id AND tournament_id=p_tournament_id AND table_id=p_table_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR h.state<>'reserved' OR h.evidence_id IS NOT NULL OR h.hand_number IS DISTINCT FROM (p_evidence->>'hand_number')::bigint
 OR h.lifecycle IS DISTINCT FROM (p_evidence->>'lifecycle')::bigint THEN RAISE EXCEPTION 'operator_abort_hand_identity_changed' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM smarter_private.f06_operations o WHERE o.tournament_id=p_tournament_id AND NOT(o.state=ANY(smarter_private.f06_terminal_operation_states())) FOR UPDATE NOWAIT;
 IF EXISTS(SELECT 1 FROM smarter_private.hand_submissions s WHERE s.table_id=h.table_id AND s.hand_number=h.hand_number)
 OR EXISTS(SELECT 1 FROM smarter_private.f06_hand_dispatch d WHERE d.permit_id=h.permit_id)
 OR EXISTS(SELECT 1 FROM public.hand_atomic_commits a WHERE a.table_id=h.table_id AND a.hand_number=h.hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_history a WHERE a.table_id=h.table_id AND a.hand_number=h.hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_state_snapshots s WHERE s.table_id=h.table_id AND NOT s.is_complete AND s.hand_number<>h.hand_number)
 OR EXISTS(SELECT 1 FROM smarter_private.f06_hand_permits x WHERE x.table_id=h.table_id AND x.state='reserved' AND x.permit_id<>h.permit_id)
 OR EXISTS(SELECT 1 FROM smarter_private.f06_operations o WHERE o.tournament_id=p_tournament_id AND NOT(o.state=ANY(smarter_private.f06_terminal_operation_states())) AND
  (o.state<>'park_requested' OR o.revision<>0 OR o.custody_id IS NOT NULL OR o.custody_generation IS NOT NULL OR o.manifest IS NOT NULL
   OR EXISTS(SELECT 1 FROM smarter_private.f06_members m WHERE m.break_id=o.break_id)
   OR EXISTS(SELECT 1 FROM smarter_private.f06_attempts a WHERE a.break_id=o.break_id))) THEN
  RAISE EXCEPTION 'operator_abort_hand_has_retained_or_accepted_work' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.table_seats s WHERE s.table_id=h.table_id AND s.left_at IS NULL FOR UPDATE NOWAIT;
 PERFORM 1 FROM public.tournament_players p WHERE p.tournament_id=h.tournament_id AND p.table_id=h.table_id FOR UPDATE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public.table_seats s WHERE s.table_id=h.table_id AND s.left_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.table_seats s LEFT JOIN public.tournament_players p ON p.tournament_id=h.tournament_id AND p.user_id=s.user_id AND p.table_id=h.table_id AND p.status='playing' AND p.eliminated_at IS NULL WHERE s.table_id=h.table_id AND s.left_at IS NULL AND (p.id IS NULL OR p.chips IS DISTINCT FROM s.stack OR p.seat_number IS DISTINCT FROM s.seat_number))
 OR EXISTS(SELECT 1 FROM public.tournament_players p WHERE p.tournament_id=h.tournament_id AND p.table_id=h.table_id AND p.status='playing' AND p.eliminated_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.table_seats s WHERE s.table_id=h.table_id AND s.user_id=p.user_id AND s.left_at IS NULL AND s.stack=p.chips AND s.seat_number=p.seat_number)) THEN
  RAISE EXCEPTION 'operator_abort_hand_roster_unproven' USING ERRCODE='55000';END IF;
 -- Lock and preserve the exact private original. Current chips can differ
 -- from prehand chips; identities and current seat/registration accounting cannot.
 PERFORM 1 FROM smarter_private.hand_continuations c WHERE c.table_id=h.table_id FOR UPDATE NOWAIT;
 PERFORM 1 FROM smarter_private.hand_submissions c WHERE c.table_id=h.table_id AND c.hand_number=h.hand_number FOR UPDATE NOWAIT;
 PERFORM 1 FROM public.hand_state_snapshots c WHERE c.table_id=h.table_id AND NOT c.is_complete FOR UPDATE NOWAIT;
 IF EXISTS(SELECT 1 FROM smarter_private.hand_continuations c WHERE c.table_id=h.table_id AND
  (c.permit_id<>h.permit_id OR c.hand_number<>h.hand_number OR c.tournament_id<>h.tournament_id OR c.original_generation<>h.generation
   OR c.payload_sha256<>encode(extensions.digest(convert_to(c.payload,'UTF8'),'sha256'),'hex')
   OR (c.payload::jsonb->'original') IS DISTINCT FROM jsonb_build_object('tournament_id',h.tournament_id::text,'table_id',h.table_id::text,'permit_id',h.permit_id::text,'lease_generation',h.generation::text,'custody_id',h.custody_id::text,'lifecycle',h.lifecycle::text,'hand_number',h.hand_number::text)
   OR jsonb_typeof(c.payload::jsonb->'seats') IS DISTINCT FROM 'array'
   OR jsonb_array_length(c.payload::jsonb->'seats')=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload::jsonb->'seats') z WHERE NOT EXISTS(SELECT 1 FROM public.table_seats a WHERE a.table_id=h.table_id AND a.id=(z->>'seat_id')::uuid AND a.user_id=(z->>'user_id')::uuid AND a.left_at IS NULL))
   OR EXISTS(SELECT 1 FROM public.table_seats a WHERE a.table_id=h.table_id AND a.left_at IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload::jsonb->'seats') z WHERE a.id=(z->>'seat_id')::uuid AND a.user_id=(z->>'user_id')::uuid))))
 OR EXISTS(SELECT 1 FROM smarter_private.hand_continuation_dispositions d WHERE d.table_id=h.table_id AND d.hand_number=h.hand_number AND d.disposition='retained' AND NOT EXISTS(SELECT 1 FROM smarter_private.hand_continuations c WHERE c.permit_id=h.permit_id))
 OR EXISTS(SELECT 1 FROM smarter_private.hand_submissions c WHERE c.table_id=h.table_id AND c.hand_number=h.hand_number AND c.request_hash<>encode(extensions.digest(convert_to(c.request::text,'UTF8'),'sha256'),'hex')) THEN
  RAISE EXCEPTION 'operator_abort_retained_original_unproven' USING ERRCODE='55000';END IF;
 original:=smarter_private.tournament_abort_hand_image(p_permit_id);
 IF p_expected_hash IS NULL OR encode(extensions.digest(convert_to(original::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_expected_hash THEN RAISE EXCEPTION 'operator_abort_hand_review_changed' USING ERRCODE='55000';END IF;
 before_money:=smarter_private.tournament_abort_money_snapshot(p_tournament_id);
 INSERT INTO smarter_private.tournament_abort_hand_dispositions(operation_id,tournament_id,table_id,permit_id,generation,writer_generation,hand_number,expected_hash,original,boundary)
 VALUES(p_operation_id,p_tournament_id,p_table_id,p_permit_id,h.generation,p_generation,h.hand_number,p_expected_hash,original,p_evidence) RETURNING receipt_id INTO receipt;
 UPDATE smarter_private.f06_operations SET state='withdrawn_before_manifest',abort_receipt_id=receipt
 WHERE source_table_id=h.table_id AND state='park_requested' AND revision=0 AND custody_id IS NULL AND custody_generation IS NULL AND manifest IS NULL;
 UPDATE smarter_private.f06_hand_permits SET state='aborted_unsettled',evidence_id=receipt WHERE permit_id=p_permit_id AND state='reserved';
 IF NOT FOUND OR before_money IS DISTINCT FROM smarter_private.tournament_abort_money_snapshot(p_tournament_id) THEN RAISE EXCEPTION 'operator_abort_hand_postimage_changed' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('ok',true,'replayed',false,'receipt_id',receipt,'outcome','aborted_unsettled');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb) TO service_role;

DO $pin$ BEGIN
IF md5(pg_get_functiondef('smarter_private.f06_immutable_identity()'::regprocedure))<>'0fe40a0711ef6d196c6883d3b9e8b86f'
OR md5(pg_get_functiondef('public.fn_ca_ack_tournament_abort_boundary(uuid,uuid,uuid,uuid,bigint,jsonb)'::regprocedure))<>'41be36ae0daa566c7bee444ec8d2aebf'
OR md5(pg_get_functiondef('public.fn_ca_tournament_abort_stop_state(uuid,uuid)'::regprocedure))<>'f078025253ce10976e30588e31b46663'
THEN RAISE EXCEPTION 'OPERATOR_CLOSURE_BOUNDARY_PREIMAGE_CHANGED';END IF;END $pin$;

CREATE OR REPLACE FUNCTION smarter_private.f06_immutable_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'F06_HISTORY_IMMUTABLE' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='f06_operations' AND (to_jsonb(OLD)->>'state')='withdrawn_before_manifest' THEN
 RAISE EXCEPTION 'F06_WITHDRAWAL_IMMUTABLE' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='f06_hand_permits' AND (to_jsonb(NEW)->>'state')='aborted_unsettled' AND NOT EXISTS(
 SELECT 1 FROM smarter_private.f06_unsettled_hand_aborts a WHERE a.receipt_id=(to_jsonb(NEW)->>'evidence_id')::uuid
 AND a.permit_id=(to_jsonb(NEW)->>'permit_id')::uuid AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'table_id')::uuid
 AND a.generation=(to_jsonb(NEW)->>'generation')::uuid AND a.hand_number=(to_jsonb(NEW)->>'hand_number')::bigint) AND NOT EXISTS(SELECT 1 FROM smarter_private.f06_generation_abort_hands a
 WHERE a.receipt_id=(to_jsonb(NEW)->>'evidence_id')::uuid AND a.permit_id=(to_jsonb(NEW)->>'permit_id')::uuid
 AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'table_id')::uuid
 AND a.generation=(to_jsonb(NEW)->>'generation')::uuid AND a.hand_number=(to_jsonb(NEW)->>'hand_number')::bigint) AND NOT EXISTS(SELECT 1 FROM smarter_private.f06_mixed_abort_hands a
 WHERE a.receipt_id=(to_jsonb(NEW)->>'evidence_id')::uuid AND a.permit_id=(to_jsonb(NEW)->>'permit_id')::uuid
 AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'table_id')::uuid
 AND a.generation=(to_jsonb(NEW)->>'generation')::uuid AND a.hand_number=(to_jsonb(NEW)->>'hand_number')::bigint) AND NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions a WHERE a.receipt_id=(to_jsonb(NEW)->>'evidence_id')::uuid AND a.permit_id=(to_jsonb(NEW)->>'permit_id')::uuid AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'table_id')::uuid AND a.generation=(to_jsonb(NEW)->>'generation')::uuid AND a.hand_number=(to_jsonb(NEW)->>'hand_number')::bigint AND a.original->'permit'=to_jsonb(OLD)) THEN
 RAISE EXCEPTION 'F06_ABORT_RECEIPT_REQUIRED' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='f06_operations' AND (to_jsonb(NEW)->>'state')='withdrawn_before_manifest' AND NOT EXISTS(
 SELECT 1 FROM smarter_private.f06_unsettled_hand_aborts a WHERE a.receipt_id=(to_jsonb(NEW)->>'abort_receipt_id')::uuid
 AND a.break_id=(to_jsonb(NEW)->>'break_id')::uuid AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid
 AND a.table_id=(to_jsonb(NEW)->>'source_table_id')::uuid AND a.generation=(to_jsonb(NEW)->>'origin_generation')::uuid) AND NOT EXISTS(SELECT 1 FROM smarter_private.f06_generation_abort_hands a
 WHERE a.receipt_id=(to_jsonb(NEW)->>'abort_receipt_id')::uuid AND a.break_id=(to_jsonb(NEW)->>'break_id')::uuid
 AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'source_table_id')::uuid
 AND a.generation=(to_jsonb(NEW)->>'origin_generation')::uuid) AND NOT EXISTS(SELECT 1 FROM smarter_private.f06_mixed_abort_hands a
 WHERE a.receipt_id=(to_jsonb(NEW)->>'abort_receipt_id')::uuid AND a.break_id=(to_jsonb(NEW)->>'break_id')::uuid
 AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'source_table_id')::uuid
 AND a.generation=(to_jsonb(NEW)->>'origin_generation')::uuid) AND NOT EXISTS(
 SELECT 1 FROM smarter_private.f06_no_start_continuations a
 WHERE a.receipt_id=(to_jsonb(NEW)->>'abort_receipt_id')::uuid
 AND a.break_id=(to_jsonb(NEW)->>'break_id')::uuid
 AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid
 AND a.table_id=(to_jsonb(NEW)->>'source_table_id')::uuid
 AND a.original_generation=(to_jsonb(NEW)->>'origin_generation')::uuid
 AND a.park=(to_jsonb(OLD))
 AND (to_jsonb(NEW)-'state'-'abort_receipt_id')=(to_jsonb(OLD)-'state'-'abort_receipt_id')) AND NOT EXISTS(
 SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions a WHERE a.receipt_id=(to_jsonb(NEW)->>'abort_receipt_id')::uuid
 AND a.tournament_id=(to_jsonb(NEW)->>'tournament_id')::uuid AND a.table_id=(to_jsonb(NEW)->>'source_table_id')::uuid
 AND a.original->'parks' @> jsonb_build_array(to_jsonb(OLD)) AND a.boundary->>'closure_mode'='equal_share'
 AND to_jsonb(OLD)->>'state'='park_requested' AND to_jsonb(OLD)->>'revision'='0'
 AND (to_jsonb(NEW)-'state'-'abort_receipt_id')=(to_jsonb(OLD)-'state'-'abort_receipt_id')) THEN
 RAISE EXCEPTION 'F06_ABORT_RECEIPT_REQUIRED' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='f06_hand_permits' AND ((to_jsonb(OLD)-'state'-'evidence_id') IS DISTINCT FROM (to_jsonb(NEW)-'state'-'evidence_id') OR to_jsonb(OLD)->>'state'<>'reserved') THEN
 RAISE EXCEPTION 'F06_HAND_IDENTITY_IMMUTABLE' USING ERRCODE='55000'; END IF;
 IF TG_TABLE_NAME='f06_members' OR
 (TG_TABLE_NAME='f06_attempts' AND ((to_jsonb(OLD)-'state'-'receipt') IS DISTINCT FROM (to_jsonb(NEW)-'state'-'receipt') OR to_jsonb(OLD)->>'state'<>'active')) OR
 (TG_TABLE_NAME='f06_operations' AND ((to_jsonb(OLD)-'state'-'manifest'-'revision'-'custody_id'-'custody_generation'-'cleanup_kind'-'close_receipt'-'abort_receipt_id') IS DISTINCT FROM (to_jsonb(NEW)-'state'-'manifest'-'revision'-'custody_id'-'custody_generation'-'cleanup_kind'-'close_receipt'-'abort_receipt_id') OR (to_jsonb(OLD)->'manifest'<>'null'::jsonb AND to_jsonb(OLD)->'manifest' IS DISTINCT FROM to_jsonb(NEW)->'manifest') OR (to_jsonb(OLD)->'close_receipt'<>'null'::jsonb AND to_jsonb(OLD)->'close_receipt' IS DISTINCT FROM to_jsonb(NEW)->'close_receipt'))) THEN
 RAISE EXCEPTION 'F06_IDENTITY_IMMUTABLE' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_abort_stop_state(p_operation_id uuid, p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets; g uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_abort_target_not_owned' USING ERRCODE='55000';END IF;
 SELECT lease_generation INTO g FROM public.engine_tournament_leases WHERE tournament_id=p_tournament_id AND protocol_version=2 AND heartbeat_at>=clock_timestamp()-interval '30 seconds';
 RETURN jsonb_build_object('ok',true,'operation_id',a.operation_id,'tournament_id',a.tournament_id,'state',CASE WHEN EXISTS(SELECT 1 FROM smarter_private.tournament_abort_recoveries r WHERE r.tournament_id=a.tournament_id AND r.operation_id=a.operation_id) THEN 'recovery' ELSE a.state END,
  'requested_generation',a.requested_generation,'current_generation',g,'quiescence_generation',a.quiescence->>'generation',
  'current_boundary_valid',(a.state='quiesced' AND g IS NOT NULL AND a.quiescence->>'generation'=g::text AND a.money_snapshot=smarter_private.tournament_abort_money_snapshot(p_tournament_id) AND a.quiescence->>'money_hash'=md5(a.money_snapshot::text) AND NOT smarter_private.tournament_abort_pending(p_tournament_id) AND NOT EXISTS(SELECT 1 FROM public.tables tb WHERE tb.tournament_id=p_tournament_id AND lower(tb.status)<>'closed' AND NOT coalesce(tb.is_deleted,false) AND NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_boundaries b WHERE b.operation_id=p_operation_id AND b.table_id=tb.id AND b.lifecycle=tb.f06_lifecycle AND b.acknowledged_generation=g AND b.acknowledged_at IS NOT NULL))),'receipt',a.receipt,'tournament_status',(SELECT status FROM public.tournaments WHERE id=p_tournament_id),'money_snapshot',a.money_snapshot,'money_hash',a.quiescence->>'money_hash','pending',smarter_private.tournament_abort_pending(p_tournament_id),
  'tables',coalesce((SELECT jsonb_agg(jsonb_build_object('table_id',t.id,'lifecycle',t.f06_lifecycle::text,'required',lower(t.status)<>'closed' AND NOT coalesce(t.is_deleted,false),'requested_generation',a.requested_generation,'current_generation',g,'durable_hand_number',greatest(coalesce((SELECT max(h.hand_number) FROM smarter_private.f06_hand_permits h WHERE h.table_id=t.id),0),coalesce((SELECT max(h.hand_number) FROM public.hand_history h WHERE h.table_id=t.id),0)),'cancellable_permit_id',(SELECT h.permit_id FROM smarter_private.f06_hand_permits h WHERE h.table_id=t.id AND h.state='reserved' ORDER BY h.hand_number DESC LIMIT 1),'cancellable_hand_hash',(SELECT encode(extensions.digest(convert_to(smarter_private.tournament_abort_hand_image(h.permit_id)::text,'UTF8'),'sha256'),'hex') FROM smarter_private.f06_hand_permits h WHERE h.table_id=t.id AND h.state='reserved' ORDER BY h.hand_number DESC LIMIT 1)) ORDER BY t.id) FROM public.tables t WHERE t.tournament_id=p_tournament_id),'[]'::jsonb));
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_ack_tournament_abort_boundary(p_operation_id uuid, p_tournament_id uuid, p_table_id uuid, p_lease_generation uuid, p_hand_number bigint, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets; t public.tables; snapshot jsonb; absent boolean:=coalesce(p_evidence->>'kind' IN('tournament_abort_absent_boundary_v2','tournament_abort_cancelled_boundary_v2'),false);
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_not_recovered(p_operation_id,p_tournament_id);
 -- The only producer is the explicit engine abort request, after its own
 -- physical park, all bank/private writers, and manager callback tails JOIN.
 -- floor_state remains a read and can never manufacture this certificate.
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.f06_authority(p_tournament_id,p_lease_generation);
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR a.state='settled' THEN RAISE EXCEPTION 'operator_abort_target_not_acknowledgeable' USING ERRCODE='55000';END IF;
 IF absent THEN PERFORM smarter_private.assert_tournament_abort_absence(p_operation_id,p_tournament_id,p_table_id,p_lease_generation,p_evidence);END IF;
 SELECT * INTO t FROM public.tables WHERE id=p_table_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR p_hand_number IS NULL OR p_hand_number<0 OR p_evidence IS NULL
 OR (NOT absent AND (p_evidence->>'kind' IS DISTINCT FROM 'tournament_abort_boundary_v1'
 OR p_evidence->>'certificate_version' IS DISTINCT FROM '1'
 OR p_evidence->>'parked_before_retirement' IS DISTINCT FROM 'true'))
 OR p_evidence->>'physical_stopped' IS DISTINCT FROM 'true'
 OR p_evidence->>'drained' IS DISTINCT FROM 'true'
 OR p_evidence->>'manager_tail_joined' IS DISTINCT FROM 'true'
 OR p_evidence->>'pending_writers' IS DISTINCT FROM '0'
 OR p_evidence->>'bank_state_write_pending' IS DISTINCT FROM 'false'
 OR (p_evidence->>'lifecycle')::bigint IS DISTINCT FROM t.f06_lifecycle
 OR (p_evidence->>'hand_number')::bigint IS DISTINCT FROM p_hand_number THEN
  RAISE EXCEPTION 'operator_abort_physical_boundary_unverified' USING ERRCODE='P0404';END IF;
 IF jsonb_typeof(p_evidence->'source_table_ids') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM public.tables x WHERE x.tournament_id=p_tournament_id AND lower(x.status)<>'closed' AND NOT coalesce(x.is_deleted,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_evidence->'source_table_ids') z WHERE z.value::uuid=x.id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_evidence->'source_table_ids') z WHERE NOT EXISTS(SELECT 1 FROM public.tables x WHERE x.id=z.value::uuid AND x.tournament_id=p_tournament_id)) THEN
  RAISE EXCEPTION 'operator_abort_physical_roster_incomplete' USING ERRCODE='P0404';END IF;
 IF smarter_private.tournament_abort_pending(p_tournament_id) THEN
  RAISE EXCEPTION 'operator_abort_accepted_hand_or_award_pending' USING ERRCODE='55000';END IF;
 INSERT INTO smarter_private.tournament_abort_boundaries(operation_id,tournament_id,table_id,lifecycle,required,request_generation,existing_permits,acknowledged_generation,acknowledgement,acknowledged_at)
 VALUES(p_operation_id,p_tournament_id,p_table_id,t.f06_lifecycle,lower(t.status)<>'closed' AND NOT coalesce(t.is_deleted,false),a.requested_generation,'[]'::jsonb,p_lease_generation,p_evidence,clock_timestamp())
 ON CONFLICT(table_id) DO UPDATE SET lifecycle=EXCLUDED.lifecycle,required=EXCLUDED.required,
 acknowledged_generation=EXCLUDED.acknowledged_generation,acknowledgement=EXCLUDED.acknowledgement,acknowledged_at=EXCLUDED.acknowledged_at
 WHERE smarter_private.tournament_abort_boundaries.operation_id=p_operation_id AND smarter_private.tournament_abort_boundaries.tournament_id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_abort_boundary_owned' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tables tb WHERE tb.tournament_id=p_tournament_id AND lower(tb.status)<>'closed' AND NOT coalesce(tb.is_deleted,false)
  AND NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_boundaries b WHERE b.operation_id=p_operation_id AND b.table_id=tb.id
    AND b.lifecycle=tb.f06_lifecycle AND b.acknowledged_generation=p_lease_generation AND b.acknowledged_at IS NOT NULL)) THEN
  snapshot:=smarter_private.tournament_abort_money_snapshot(p_tournament_id);
  UPDATE smarter_private.tournament_abort_targets SET state='quiesced',money_snapshot=snapshot,
   quiescence=jsonb_build_object('generation',p_lease_generation,'money_hash',md5(snapshot::text),'certified_at',clock_timestamp())
  WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'operation_id',p_operation_id,'tournament_id',p_tournament_id,'table_id',p_table_id,
 'generation',p_lease_generation,'state',(SELECT state FROM smarter_private.tournament_abort_targets WHERE tournament_id=p_tournament_id));
END $function$
;

-- Archive recognition does not rewrite a historical retained disposition.
DO $pin$ BEGIN IF md5(pg_get_functiondef('smarter_private.f06_retained_submission_guard()'::regprocedure))<>'ea4b333e8dcb2e7b8d1966f5ada67b1a' THEN RAISE EXCEPTION 'OPERATOR_CLOSURE_RETAINED_PREIMAGE_CHANGED';END IF;END $pin$;
CREATE OR REPLACE FUNCTION smarter_private.f06_retained_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d smarter_private.hand_submission_dispositions;
BEGIN
 IF NEW.state = 'accepted' AND EXISTS (SELECT 1 FROM smarter_private.hand_continuations c WHERE c.permit_id = NEW.permit_id) THEN
  IF NOT EXISTS (SELECT 1 FROM public.hand_atomic_commits a WHERE a.table_id = NEW.table_id
    AND a.hand_number = NEW.hand_number AND a.hand_id = NEW.evidence_id AND a.post_commit_completed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'HAND_CONTINUATION_ACCEPTANCE_UNPROVEN' USING ERRCODE='55000';
  END IF;
  -- Positive atomic acceptance owns cleanup; no periodic private-deck retention.
  DELETE FROM smarter_private.hand_continuations WHERE permit_id = NEW.permit_id;
 END IF;
 IF NEW.state='aborted_unsettled' AND EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions a
 WHERE a.receipt_id=NEW.evidence_id AND a.permit_id=NEW.permit_id AND a.table_id=NEW.table_id AND a.hand_number=NEW.hand_number
 AND a.original->'permit'=to_jsonb(OLD) AND a.boundary->>'closure_mode'='equal_share') THEN RETURN NEW;END IF;
 IF NEW.state NOT IN ('never_started','aborted_unsettled') THEN RETURN NEW; END IF;
 PERFORM smarter_private.assert_hand_continuation_disposition(NEW.table_id, NEW.hand_number);
 INSERT INTO smarter_private.hand_submission_dispositions(table_id,hand_number,permit_id,disposition,submission_id)
 VALUES(NEW.table_id,NEW.hand_number,NEW.permit_id,'disposed',NULL) ON CONFLICT(table_id,hand_number) DO NOTHING;
 SELECT * INTO STRICT d FROM smarter_private.hand_submission_dispositions WHERE table_id=NEW.table_id AND hand_number=NEW.hand_number;
 IF d.disposition<>'disposed' OR (d.permit_id IS NOT NULL AND d.permit_id IS DISTINCT FROM NEW.permit_id) THEN
  RAISE EXCEPTION 'F06_RETAINED_HAND_SUBMISSION_REQUIRES_ACCEPTED_DISPOSITION' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $function$
;

-- A physical late writer shares the table lock with cancellation. Either its
-- accepted outcome is observed first, or the immutable cancellation wins.
-- Existing retention DELETEs cannot introduce a late accepted outcome and must
-- remain available. The immutable archive itself retains the original images.
CREATE FUNCTION smarter_private.tournament_abort_archived_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE tab uuid; event_id uuid;
BEGIN
 -- A move cannot escape the old archived identity by changing its table ID.
 FOR tab IN SELECT DISTINCT x FROM unnest(ARRAY[(to_jsonb(NEW)->>'table_id')::uuid,(to_jsonb(OLD)->>'table_id')::uuid]) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT tournament_id INTO event_id FROM public.tables WHERE id=tab;
  IF event_id IS NULL THEN CONTINUE;END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
   RAISE EXCEPTION 'TOURNAMENT_ARCHIVE_WRITER_READ_COMMITTED_REQUIRED' USING ERRCODE='55000';END IF;
  IF NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a WHERE a.tournament_id=event_id) THEN CONTINUE;END IF;
  PERFORM 1 FROM public.tables WHERE id=tab FOR UPDATE;
  -- Separate SPI statement after the lock obtains a fresh READ COMMITTED
  -- snapshot, including the cancellation that committed while we waited.
  IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions d WHERE d.table_id=tab) THEN
   RAISE EXCEPTION 'TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR' USING ERRCODE='55000';END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.tournament_abort_archived_write_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tournament_abort_archived_write BEFORE INSERT OR UPDATE ON smarter_private.hand_continuations FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_abort_archived_write_guard();
CREATE TRIGGER tournament_abort_archived_write BEFORE INSERT OR UPDATE ON smarter_private.hand_submissions FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_abort_archived_write_guard();
CREATE TRIGGER tournament_abort_archived_write BEFORE INSERT OR UPDATE ON public.hand_state_snapshots FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_abort_archived_write_guard();
CREATE TRIGGER tournament_abort_archived_write BEFORE INSERT OR UPDATE ON public.hand_history FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_abort_archived_write_guard();
CREATE TRIGGER tournament_abort_archived_write BEFORE INSERT OR UPDATE ON smarter_private.f06_hand_dispatch FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_abort_archived_write_guard();
CREATE TRIGGER tournament_abort_archived_write BEFORE INSERT OR UPDATE ON public.hand_atomic_commits FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_abort_archived_write_guard();

DO $pin$ BEGIN IF md5(pg_get_functiondef('smarter_private.tournament_abort_pending(uuid)'::regprocedure))<>'57b7e46c04d323a1cfcb770635def66d' THEN RAISE EXCEPTION 'OPERATOR_CLOSURE_PENDING_PREIMAGE_CHANGED';END IF;END $pin$;
CREATE OR REPLACE FUNCTION smarter_private.tournament_abort_pending(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
 SELECT smarter_private.f06_lease_has_pending_custody(p_tournament_id,NULL)
 OR EXISTS(SELECT 1 FROM public.tables t JOIN public.hand_state_snapshots s ON s.table_id=t.id WHERE t.tournament_id=p_tournament_id AND NOT s.is_complete
 AND NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions d JOIN smarter_private.f06_hand_permits h ON h.permit_id=d.permit_id
 WHERE d.tournament_id=p_tournament_id AND d.table_id=s.table_id AND d.hand_number=s.hand_number AND h.state='aborted_unsettled' AND h.evidence_id=d.receipt_id
 AND d.original->'snapshots' @> jsonb_build_array(to_jsonb(s))))
 OR EXISTS(SELECT 1 FROM public.tournament_obligations o WHERE o.tournament_id=p_tournament_id AND o.kind<>'refund' AND o.amount_paid IS DISTINCT FROM o.amount_owed)
 OR EXISTS(SELECT 1 FROM public.tournament_bounty_obligations o WHERE o.tournament_id=p_tournament_id AND o.state IS DISTINCT FROM 'settled');
$fn$;

COMMIT;
