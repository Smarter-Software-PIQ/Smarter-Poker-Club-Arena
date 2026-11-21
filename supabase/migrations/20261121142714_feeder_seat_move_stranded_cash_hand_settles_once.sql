-- @live-proof: (SELECT count(*)=1 FROM smarter_private.hand_submission_source_corrections WHERE proof->>'proof_version'='20261121142714')
-- 20261121142714_feeder_seat_move_stranded_cash_hand_settles_once.sql
--
-- WHAT WAS WRONG
--
-- Cash table dbbc148e hand #60380607 (submission 9684692d) was refused at
-- 08:16 UTC by fn_ca_promo_profit_capture_cash with
-- original_winnings_sources_exceed_accepted_stack: player e922e29a's promo
-- principal (7.20) was still keyed to dbbc148e although his seat had spent 23
-- minutes and 37 hands on feeder a5d84d81 and come back with 2.64, because
-- fn_cash_seat_move_execute moved the chips but never the promo positions.
-- The original generation exhausted its replay, and the successor generation
-- spent the hand's ONE financial claim through fn_ca_resume_hand_submission
-- while the stale position was still there, so every start since reads
-- successor_financial_claim_spent and the table is rebuilt about twenty times
-- a minute (ClubArenaEngineKillStorm, nine seated players with no dealer).
--
-- WHAT THIS CHANGES
--
-- Recovery through the existing door, exactly as 20261117170259 did:
--   1. smarter_private.feeder_promo_position_source_correction_proof proves the
--      cause from the hand's own rows against the one pinned submission
--      (request, handoff and result digests): the refusal is exactly this
--      guard error, the handoff is from the original generation, the open
--      snapshot is the hand's own, every original seat is still seated with
--      stack_before, nothing is recorded for the hand, and no dealt player's
--      principal plus winnings custody at this table now exceeds the stack it
--      rides on (20261121142000 settled the stale 4.56).
--   2. The proof dispatcher falls back to it after the existing proofs.
--   3. The hand is certified through certify_original_hand_source_correction,
--      the operator-only door every earlier correction used. It credits
--      nothing: the engine's own resume then settles the retained hand once,
--      through fn_ca_commit_hand_settlement with its original request.
--
-- MEASURED (read-only, 2026-11-21 ~14:27 UTC): exactly this submission carries
-- the refusal; no correction, claim, failure, disposal, outbox, settlement key
-- or later hand; 8 of 8 original seats at stack_before; one open snapshot;
-- e922e29a principal at dbbc148e 2.64 against stack_before 2.64.
--
-- The root fix (a seat move carries every promo position with its stack) is
-- 20261121143500_a_seat_move_carries_its_promo_positions.
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
SET LOCAL search_path=public;

DO $guard$BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN RAISE EXCEPTION 'feeder_promo_operator_refused' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() IS DISTINCT FROM false OR public.fn_active_maintenance_release_boundary() IS NOT NULL THEN RAISE EXCEPTION 'feeder_promo_freeze_refused';END IF;
 IF EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261121142714') THEN RAISE EXCEPTION 'feeder_promo_history_replay';END IF;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261121142000') THEN RAISE EXCEPTION 'feeder_promo_position_settlement_missing';END IF;
 IF to_regprocedure('smarter_private.feeder_promo_position_source_correction_proof(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'feeder_promo_proof_exists';END IF;
END $guard$;

CREATE OR REPLACE FUNCTION smarter_private.feeder_promo_position_source_correction_proof(e uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE x record;s smarter_private.hand_submissions;h smarter_private.hand_submission_handoffs;z smarter_private.hand_submission_handoff_results;stack_hand uuid;
BEGIN
 -- THE FEEDER SEAT-MOVE PROMO POSITION REFUSAL, PROVED FROM THE HAND'S OWN ROWS (2026-11-21).
 SELECT * INTO x FROM(VALUES
('9684692d-ce58-4ed5-ba75-9f9e63f85103'::uuid,'dbbc148e-384a-4c38-abb6-833b2d2847ff'::uuid,60380607::bigint,'aafbb4978fc803d21bdbee3404c37d5cc7c0f22b39991bfe5311276b757973c8','0d441e9b8a09a8543437245229237050','37c7ae91b0495bcb78f3270c89f210f3','bad4925a0f59bdf94b8adf860ee87004')
 )v(submission_id,table_id,hand_number,request_sha,request_md5,handoff_md5,result_md5) WHERE submission_id=e;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO s FROM smarter_private.hand_submissions WHERE submission_id=e;
 SELECT * INTO h FROM smarter_private.hand_submission_handoffs WHERE submission_id=e;
 SELECT * INTO z FROM smarter_private.hand_submission_handoff_results WHERE submission_id=e;
 IF s.submission_id IS NULL OR h.submission_id IS NULL OR z.submission_id IS NULL THEN RETURN NULL;END IF;
 stack_hand:=md5('ca-hand:'||s.table_id::text||':'||s.hand_number::text||CASE WHEN coalesce(s.request->>'p_ref','')='' THEN '' ELSE ':'||(s.request->>'p_ref') END)::uuid;
 IF s.table_id IS DISTINCT FROM x.table_id OR s.hand_number IS DISTINCT FROM x.hand_number
 OR s.request_hash IS DISTINCT FROM x.request_sha OR encode(sha256(convert_to(s.request::text,'UTF8')),'hex') IS DISTINCT FROM s.request_hash
 OR md5(s.request::text) IS DISTINCT FROM x.request_md5
 OR md5(to_jsonb(h)::text) IS DISTINCT FROM x.handoff_md5 OR md5(to_jsonb(z)::text) IS DISTINCT FROM x.result_md5
 OR h.original_generation IS DISTINCT FROM s.lease_generation OR h.request_hash IS DISTINCT FROM s.request_hash
 OR z.result->>'reason' IS DISTINCT FROM 'successor_authority_refused' OR z.result->>'sqlstate' IS DISTINCT FROM 'P0001'
 OR z.result->>'error' IS DISTINCT FROM 'original_winnings_sources_exceed_accepted_stack'
 OR z.result->'success' IS DISTINCT FROM 'false'::jsonb OR z.result->'atomic_hand_commit' IS DISTINCT FROM 'false'::jsonb
 OR NOT EXISTS(SELECT FROM public.tables t WHERE t.id=s.table_id AND t.tournament_id IS NULL AND NOT COALESCE(t.is_deleted,false))
 OR (SELECT count(*) FROM public.hand_state_snapshots a WHERE a.table_id=s.table_id AND a.hand_number=s.hand_number AND NOT a.is_complete) IS DISTINCT FROM 1::bigint
 OR jsonb_typeof(s.request->'p_stacks') IS DISTINCT FROM 'array' OR jsonb_array_length(s.request->'p_stacks')=0
 -- Every original seat is still seated with the stack the hand dealt from.
 OR EXISTS(SELECT FROM jsonb_array_elements(s.request->'p_stacks') o(value) WHERE NOT EXISTS(
  SELECT FROM public.table_seats t WHERE t.table_id=s.table_id AND t.id=(o.value->>'seat_id')::uuid
   AND t.user_id=(o.value->>'user_id')::uuid AND t.joined_at=(o.value->>'seat_joined_at')::timestamptz AND t.left_at IS NULL
   AND t.stack=(o.value->>'stack_before')::numeric))
 -- The source is corrected: no dealt player's restricted promo position at
 -- this table now exceeds the stack the hand dealt from.
 OR EXISTS(SELECT FROM jsonb_array_elements(s.request->'p_stacks') o(value) WHERE
   COALESCE((SELECT sum(c.amount) FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
     WHERE g.user_id=(o.value->>'user_id')::uuid AND g.closed_at IS NULL AND c.kind='table_stack' AND c.entity_id=s.table_id),0)
  +COALESCE((SELECT sum(c.amount) FROM public.ca_promo_profit_custody c
     WHERE c.user_id=(o.value->>'user_id')::uuid AND c.kind='table_stack' AND c.entity_id=s.table_id),0)
  >(o.value->>'stack_before')::numeric)
 OR NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261121142000')
 OR EXISTS(SELECT FROM public.settlement_idempotency_keys c WHERE c.table_id=s.table_id AND c.hand_id=stack_hand)
 OR EXISTS(SELECT FROM public.ca_settlements c WHERE c.settlement_type='hand_stacks' AND c.external_ref=s.table_id::text||':'||stack_hand::text)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_failures f WHERE f.submission_id=e)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_correction_claims c WHERE c.submission_id=e)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_disposals d WHERE d.submission_id=e OR (d.table_id=s.table_id AND d.hand_number=s.hand_number))
 OR EXISTS(SELECT FROM public.hand_atomic_commits c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM public.hand_history c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM smarter_private.f06_hand_permits c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM public.hand_projection_outbox c WHERE c.hand_id=e)
 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('submission_id',e,'table_id',s.table_id,'hand_number',s.hand_number,'request_hash',s.request_hash,
 'request_md5',x.request_md5,'handoff_md5',x.handoff_md5,'result_md5',x.result_md5,'original_generation',s.lease_generation,
 'scope','cash','source_cause','promo_position_left_behind_by_cash_seat_move',
 'source_version','20261121142000','proof_version','20261121142714');
END $function$
;
REVOKE ALL ON FUNCTION smarter_private.feeder_promo_position_source_correction_proof(uuid) FROM PUBLIC;

DO $install$
DECLARE
 o_d text:=$anchor$ RETURN smarter_private.promo_addon_rebase_source_correction_proof(e);
$anchor$;
 n_d text:=$anchor$ proof:=smarter_private.promo_addon_rebase_source_correction_proof(e);
 IF proof IS NOT NULL THEN RETURN proof;END IF;
 -- The cash hand a feeder seat move's stale promo position stranded (2026-11-21).
 RETURN smarter_private.feeder_promo_position_source_correction_proof(e);
$anchor$;
 sig_d constant regprocedure:='smarter_private.original_hand_source_correction_proof(uuid)'::regprocedure;
 d text; before jsonb;
BEGIN
 d:=pg_get_functiondef(sig_d);
 IF md5(d)<>'b8db2960345ffe51a4645b76c3c36a65' THEN RAISE EXCEPTION 'feeder_promo_dispatcher_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o_d,'')))/length(o_d)<>1 THEN RAISE EXCEPTION 'feeder_promo_dispatcher_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig_d;
 EXECUTE replace(d,o_d,n_d);
 d:=pg_get_functiondef(sig_d);
 IF (length(d)-length(replace(d,'smarter_private.feeder_promo_position_source_correction_proof(e)','')))/length('smarter_private.feeder_promo_position_source_correction_proof(e)')<>1
 OR (length(d)-length(replace(d,'smarter_private.promo_addon_rebase_source_correction_proof(e)','')))/length('smarter_private.promo_addon_rebase_source_correction_proof(e)')<>1
 THEN RAISE EXCEPTION 'feeder_promo_dispatcher_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig_d) IS DISTINCT FROM before THEN RAISE EXCEPTION 'feeder_promo_dispatcher_security_refused';END IF;
END $install$;

DO $certify$
DECLARE e constant uuid:='9684692d-ce58-4ed5-ba75-9f9e63f85103'; c jsonb;
BEGIN
 IF smarter_private.feeder_promo_position_source_correction_proof(e) IS NULL THEN RAISE EXCEPTION 'feeder_promo_proof_refused: %',e;END IF;
 IF smarter_private.original_hand_source_correction_proof(e)->>'proof_version' IS DISTINCT FROM '20261121142714' THEN RAISE EXCEPTION 'feeder_promo_dispatch_refused: %',e;END IF;
 c:=smarter_private.certify_original_hand_source_correction(e);
 IF c->>'certified' IS DISTINCT FROM 'true' OR c->>'financial_payment' IS DISTINCT FROM 'false'
 OR c->'proof'->>'source_cause' IS DISTINCT FROM 'promo_position_left_behind_by_cash_seat_move' THEN RAISE EXCEPTION 'feeder_promo_certify_refused: %',c;END IF;
 IF (SELECT count(*) FROM smarter_private.hand_submission_source_corrections WHERE submission_id=e)<>1 THEN RAISE EXCEPTION 'feeder_promo_certified_count';END IF;
 IF EXISTS(SELECT FROM smarter_private.hand_submission_correction_claims WHERE submission_id=e) THEN RAISE EXCEPTION 'feeder_promo_claimed_early';END IF;
END $certify$;

COMMIT;
