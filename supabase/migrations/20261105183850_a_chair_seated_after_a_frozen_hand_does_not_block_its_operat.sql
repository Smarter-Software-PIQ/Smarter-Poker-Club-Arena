-- @live-proof: md5(pg_get_functiondef('public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure))='9ec2ae80a060a9ebffeb127e39be14cb' AND NOT has_function_privilege('authenticated','public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') AND has_function_privilege('service_role','public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE')
-- 20261105183850_a_chair_seated_after_a_frozen_hand_does_not_block_its_operat.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- CLAUDE.md 10.9 / 10.11 / 10.12. This file schedules nothing, retries nothing
-- and moves no chip. It changes ONE condition in the operator cancellation of a
-- stopped tournament's unfinished original hand.
--
-- ===========================================================================
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-05)
-- ===========================================================================
--
-- Midnight Free Buy (6429087f, operation d44c4440, owner deletion intent of
-- November 2) stayed RUNNING / stop_requested after the eight other events of
-- the same closure retired at 18:18-18:22Z. Its table fe4237f3 holds the
-- retained original hand 51510645 (permit c4469b4f, reserved), captured
-- 2026-10-29 06:28:39Z with EIGHT chairs. At 09:09:01Z the same day the
-- balancer seated a NINTH player (seat 9, user 7d35b9be) on that table while
-- the hand was frozen. That chair was never dealt into the hand: it is not in
-- the capsule's seats, holds no hole card and posted nothing.
--
-- fn_ca_cancel_tournament_abort_unsettled_hand refuses any live chair that is
-- missing from the capsule, so it answered operator_abort_retained_original_
-- unproven on every attempt and the event could never quiesce. Probed on
-- production in one self-aborting DO block (CLAUDE.md 11.5) with the real
-- permit, hand image hash and lease generation:
--   current function  -> operator_abort_retained_original_unproven
--   this candidate    -> {ok: true, outcome: aborted_unsettled}, and its own
--                        money pre/post image assertion held
-- (rolled back; nothing committed).
--
-- ===========================================================================
-- WHAT THIS CHANGES
-- ===========================================================================
--
-- A live chair absent from the capsule refuses the cancellation only when it
-- was seated at or before the capsule was retained (a.joined_at <=
-- c.created_at). A chair seated afterwards cannot have been dealt into that
-- original and is exactly what the stopped table now holds; it is still bound
-- by every other check unchanged: its registration must match its seat and
-- stack (roster check above), the capsule's own chairs must all still be
-- seated, and the hand image hash the engine reviewed must match. Every other
-- byte of the function is identical to the installed body (pre-image md5
-- 2eb90c4b5312f3d2bca312f09410f4e0 asserted below; post-image md5 pinned by
-- the live proof).
--
-- Wrap ALL DDL for one change in ONE transaction (club-arena CLAUDE.md,
-- production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure)) IS DISTINCT FROM '2eb90c4b5312f3d2bca312f09410f4e0' THEN
    RAISE EXCEPTION 'late_chair_cancellation_preimage_changed';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_cancel_tournament_abort_unsettled_hand(p_operation_id uuid,p_tournament_id uuid,p_table_id uuid,p_generation uuid,p_permit_id uuid,p_expected_hash text,p_evidence jsonb)
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
   OR EXISTS(SELECT 1 FROM public.table_seats a WHERE a.table_id=h.table_id AND a.left_at IS NULL AND a.joined_at<=c.created_at AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.payload::jsonb->'seats') z WHERE a.id=(z->>'seat_id')::uuid AND a.user_id=(z->>'user_id')::uuid))))
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

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_cancel_tournament_abort_unsettled_hand(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure)) IS DISTINCT FROM '9ec2ae80a060a9ebffeb127e39be14cb' THEN
    RAISE EXCEPTION 'late_chair_cancellation_postimage_unexpected';
  END IF;
END $post$;

COMMIT;
