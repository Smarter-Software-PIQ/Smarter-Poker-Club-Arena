-- @live-proof: (SELECT count(*)=2 FROM smarter_private.hand_submission_source_corrections WHERE proof->>'proof_version'='20261117170259')
-- 20261117170259_promo_addon_stranded_tournament_hands_settle_once.sql
--
-- WHAT WAS WRONG
--
-- From Promo Play Through enforcement (2026-11-17 14:28 UTC) until 20261117164841,
-- fn_ca_promo_profit_capture_tournament_hand compared the commit's written
-- stack with the engine's ending stack. The original delta-mode commit writes
-- engine stack + rebased[user]. Morning Free Buy f6990f30's 3,000-chip add-on
-- (15:34-15:35 UTC) left two hands retained at their tables:
--   196db7be #59866957 (submission dfc5147c) and d6a9e2ff #59866958 (8ca1934f).
-- The successor generation took each hand's ONE financial claim through
-- fn_ca_resume_hand_submission while the defect was live. The refusal (P0001,
-- original_tournament_earning_hand_players_mismatch) was recorded as the hand's
-- financial answer, so every later start reads successor_financial_claim_spent
-- and 17 seated players have had no dealer since 15:35 UTC.
--
-- WHAT THIS CHANGES
--
-- Recovery through the existing door, exactly as 20261015011723 and
-- 20261105041928 did:
--   1. smarter_private.promo_addon_rebase_source_correction_proof proves the
--      cause from each hand's own rows against a frozen list of the 2
--      submissions (request, handoff, result, permit and snapshot digests
--      pinned): the refusal is exactly this guard error, the handoff is from the
--      original generation, the reserved permit and incomplete snapshot are the
--      hand's own, every original seat is still seated with stack_before, or
--      stack_before + addon_chips where its registration bought the add-on (the
--      resume's own add-on rule), nothing is recorded for the hand, and the
--      guard fix 20261117164841 is installed and live.
--   2. The proof dispatcher falls back to it after the five existing proofs.
--   3. The 2 hands are certified through certify_original_hand_source_correction,
--      the operator-only door every earlier correction used. It credits nothing:
--      the engine's own resume then settles each retained hand once, through
--      fn_ca_commit_hand_settlement with its original request.
--
-- MEASURED (read-only, 2026-11-17 ~16:58 UTC): exactly these 2 submissions carry
-- the refusal and no correction, claim, failure, disposal or outbox; each
-- handoff's original generation is the submission's; each permit is reserved in
-- that generation; 12 of 14 seats differ from stack_before by exactly the
-- 3,000 add-on with tournament_players.add_on true, the other 2 by zero.
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
SET LOCAL search_path=public;

DO $guard$BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN RAISE EXCEPTION 'promo_addon_operator_refused' USING ERRCODE='42501';END IF;
 IF NULLIF(current_setting('ca.break_window_migration_override',true),'') IS NOT NULL THEN RAISE EXCEPTION 'promo_addon_override_refused';END IF;
 IF public.fn_platform_frozen() IS DISTINCT FROM false OR public.fn_active_maintenance_release_boundary() IS NOT NULL THEN RAISE EXCEPTION 'promo_addon_freeze_refused';END IF;
 IF EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261117170259') THEN RAISE EXCEPTION 'promo_addon_history_replay';END IF;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261117164841') THEN RAISE EXCEPTION 'promo_addon_guard_fix_missing';END IF;
 IF to_regprocedure('smarter_private.promo_addon_rebase_source_correction_proof(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'promo_addon_proof_exists';END IF;
END $guard$;

CREATE OR REPLACE FUNCTION smarter_private.promo_addon_rebase_source_correction_proof(e uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE x record;s smarter_private.hand_submissions;h smarter_private.hand_submission_handoffs;z smarter_private.hand_submission_handoff_results;p smarter_private.f06_hand_permits;stack_hand uuid;tour uuid;
BEGIN
 -- THE PROMO ADD-ON REBASE REFUSAL, PROVED FROM THE HAND'S OWN ROWS (2026-11-17).
 SELECT * INTO x FROM(VALUES
('dfc5147c-aa9c-4724-80e7-fad3c2ca62e4'::uuid,'196db7be-9d78-43b7-9207-8d9d700a76df'::uuid,59866957::bigint,'22f64d0d555a246e4f1603aaf25e39e2dac001fd91ae0b0c4ad22705ed984a21','f3c48f1294348f9c50e3b7908d1c17e3','c6d6ff84fbf30f61ba5753805babfa88','083982d5984b5757b2a4448d1628cd24','1900b3a7-56e0-4d75-9551-eaffb8c1073c'::uuid,'738e2c7faca3c180dd9b1ad4060904e0','6ae2bdceb46f7b903d9d1e1fe2026737'),
('8ca1934f-3da9-464b-8d1b-f3c3ba463251'::uuid,'d6a9e2ff-304f-4e2c-8d78-119a224d22fb'::uuid,59866958::bigint,'222779dec8bcd96864dc29221509ffb4e6717c5f1eb18a765cc0cbe032ce25b0','836487ac3554a71e1d1f5979a9992b8e','b7ea1e583ba94c7da83164e7126e5c06','53c293342fb235e151d2751626f1418a','141034b3-b975-44d7-819e-6e328fdc22bb'::uuid,'f3276154316fd08613162fe424a6ed57','de7a6e08470fefc0338caf7b9337fa8e')
 )v(submission_id,table_id,hand_number,request_sha,request_md5,handoff_md5,result_md5,permit_id,permit_md5,snapshot_md5) WHERE submission_id=e;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO s FROM smarter_private.hand_submissions WHERE submission_id=e;
 SELECT * INTO h FROM smarter_private.hand_submission_handoffs WHERE submission_id=e;
 SELECT * INTO z FROM smarter_private.hand_submission_handoff_results WHERE submission_id=e;
 SELECT * INTO p FROM smarter_private.f06_hand_permits WHERE permit_id=x.permit_id;
 IF s.submission_id IS NULL OR h.submission_id IS NULL OR z.submission_id IS NULL OR p.permit_id IS NULL THEN RETURN NULL;END IF;
 tour:=(s.request#>>'{p_hand_row,tournament_id}')::uuid;
 stack_hand:=md5('ca-hand:'||s.table_id::text||':'||s.hand_number::text||CASE WHEN coalesce(s.request->>'p_ref','')='' THEN '' ELSE ':'||(s.request->>'p_ref') END)::uuid;
 IF s.table_id IS DISTINCT FROM x.table_id OR s.hand_number IS DISTINCT FROM x.hand_number
 OR s.request_hash IS DISTINCT FROM x.request_sha OR encode(sha256(convert_to(s.request::text,'UTF8')),'hex') IS DISTINCT FROM s.request_hash
 OR md5(s.request::text) IS DISTINCT FROM x.request_md5
 OR md5(to_jsonb(h)::text) IS DISTINCT FROM x.handoff_md5 OR md5(to_jsonb(z)::text) IS DISTINCT FROM x.result_md5
 OR h.original_generation IS DISTINCT FROM s.lease_generation OR h.request_hash IS DISTINCT FROM s.request_hash
 OR z.result->>'reason' IS DISTINCT FROM 'successor_authority_refused' OR z.result->>'sqlstate' IS DISTINCT FROM 'P0001'
 OR z.result->>'error' IS DISTINCT FROM 'original_tournament_earning_hand_players_mismatch'
 OR z.result->'success' IS DISTINCT FROM 'false'::jsonb OR z.result->'atomic_hand_commit' IS DISTINCT FROM 'false'::jsonb
 OR tour IS NULL OR tour IS DISTINCT FROM p.tournament_id
 OR NOT EXISTS(SELECT FROM public.tables t WHERE t.id=s.table_id AND t.tournament_id=tour AND NOT COALESCE(t.is_deleted,false))
 OR NOT EXISTS(SELECT FROM public.tournaments ev WHERE ev.id=tour AND ev.status='RUNNING')
 OR p.table_id IS DISTINCT FROM s.table_id OR p.hand_number IS DISTINCT FROM s.hand_number
 OR p.generation IS DISTINCT FROM s.lease_generation OR p.state IS DISTINCT FROM 'reserved'
 OR md5(to_jsonb(p)::text) IS DISTINCT FROM x.permit_md5
 OR (SELECT count(*) FROM public.hand_state_snapshots a WHERE a.table_id=s.table_id AND a.hand_number=s.hand_number AND NOT a.is_complete) IS DISTINCT FROM 1::bigint
 OR NOT EXISTS(SELECT FROM public.hand_state_snapshots a WHERE a.table_id=s.table_id AND a.hand_number=s.hand_number AND NOT a.is_complete AND md5(to_jsonb(a)::text)=x.snapshot_md5)
 OR jsonb_typeof(s.request->'p_stacks') IS DISTINCT FROM 'array' OR jsonb_array_length(s.request->'p_stacks')=0
 -- Every original seat is still seated with the stack the hand dealt from, or
 -- that plus the event's add-on its registration bought (the resume's own rule).
 OR EXISTS(SELECT FROM jsonb_array_elements(s.request->'p_stacks') o(value) WHERE NOT EXISTS(
  SELECT FROM public.table_seats t WHERE t.table_id=s.table_id AND t.id=(o.value->>'seat_id')::uuid
   AND t.user_id=(o.value->>'user_id')::uuid AND t.joined_at=(o.value->>'seat_joined_at')::timestamptz AND t.left_at IS NULL
   AND (t.stack=(o.value->>'stack_before')::numeric
    OR EXISTS(SELECT FROM public.tournament_players tp JOIN public.tournaments ev ON ev.id=tp.tournament_id
     WHERE tp.tournament_id=tour AND tp.user_id=t.user_id AND tp.add_on IS TRUE AND COALESCE(ev.addon_chips,0)>0
      AND t.stack=(o.value->>'stack_before')::numeric+ev.addon_chips))))
 OR EXISTS(SELECT FROM public.settlement_idempotency_keys c WHERE c.table_id=s.table_id AND c.hand_id=stack_hand)
 OR EXISTS(SELECT FROM public.ca_settlements c WHERE c.settlement_type='hand_stacks' AND c.external_ref=s.table_id::text||':'||stack_hand::text)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_failures f WHERE f.submission_id=e)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_correction_claims c WHERE c.submission_id=e)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_disposals d WHERE d.submission_id=e OR (d.table_id=s.table_id AND d.hand_number=s.hand_number))
 OR EXISTS(SELECT FROM public.hand_atomic_commits c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM public.hand_history c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM smarter_private.f06_hand_permits c WHERE c.table_id=s.table_id AND c.hand_number>s.hand_number)
 OR EXISTS(SELECT FROM public.hand_projection_outbox c WHERE c.hand_id=e)
 -- The defect's own fix is installed and live: written = stack + rebased.
 OR NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261117164841')
 OR position($q$IS DISTINCT FROM (v->>'stack')::numeric+COALESCE((h.stack_result->'rebased'->>(v->>'user_id'))::numeric,0)$q$ IN (SELECT pg_get_functiondef(f.oid) FROM pg_proc f WHERE f.oid='public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure))=0
 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('submission_id',e,'table_id',s.table_id,'hand_number',s.hand_number,'request_hash',s.request_hash,
 'request_md5',x.request_md5,'handoff_md5',x.handoff_md5,'result_md5',x.result_md5,'original_generation',s.lease_generation,
 'permit_id',p.permit_id,'scope','tournament','tournament_id',tour,'source_cause','promo_tournament_hand_addon_rebase',
 'source_version','20261117164841','proof_version','20261117170259');
END $function$
;
REVOKE ALL ON FUNCTION smarter_private.promo_addon_rebase_source_correction_proof(uuid) FROM PUBLIC;

DO $install$
DECLARE
 o_d text:=$anchor$ RETURN smarter_private.fl_null_cap_source_correction_proof(e);
$anchor$;
 n_d text:=$anchor$ proof:=smarter_private.fl_null_cap_source_correction_proof(e);
 IF proof IS NOT NULL THEN RETURN proof;END IF;
 -- The tournament hands the promo add-on rebase refusal stranded (2026-11-17).
 RETURN smarter_private.promo_addon_rebase_source_correction_proof(e);
$anchor$;
 sig_d constant regprocedure:='smarter_private.original_hand_source_correction_proof(uuid)'::regprocedure;
 d text; before jsonb;
BEGIN
 d:=pg_get_functiondef(sig_d);
 IF md5(d)<>'2a39ba510cffe4c22afb09f7763468b6' THEN RAISE EXCEPTION 'promo_addon_dispatcher_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o_d,'')))/length(o_d)<>1 THEN RAISE EXCEPTION 'promo_addon_dispatcher_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig_d;
 EXECUTE replace(d,o_d,n_d);
 d:=pg_get_functiondef(sig_d);
 IF (length(d)-length(replace(d,'smarter_private.promo_addon_rebase_source_correction_proof(e)','')))/length('smarter_private.promo_addon_rebase_source_correction_proof(e)')<>1
 OR (length(d)-length(replace(d,'smarter_private.fl_null_cap_source_correction_proof(e)','')))/length('smarter_private.fl_null_cap_source_correction_proof(e)')<>1
 THEN RAISE EXCEPTION 'promo_addon_dispatcher_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig_d) IS DISTINCT FROM before THEN RAISE EXCEPTION 'promo_addon_dispatcher_security_refused';END IF;
END $install$;

DO $certify$
DECLARE expected constant uuid[]:=ARRAY['dfc5147c-aa9c-4724-80e7-fad3c2ca62e4'::uuid,'8ca1934f-3da9-464b-8d1b-f3c3ba463251'::uuid]; e uuid; c jsonb;
BEGIN
 FOREACH e IN ARRAY expected LOOP
  IF smarter_private.promo_addon_rebase_source_correction_proof(e) IS NULL THEN RAISE EXCEPTION 'promo_addon_proof_refused: %',e;END IF;
  IF smarter_private.original_hand_source_correction_proof(e)->>'proof_version' IS DISTINCT FROM '20261117170259' THEN RAISE EXCEPTION 'promo_addon_dispatch_refused: %',e;END IF;
  c:=smarter_private.certify_original_hand_source_correction(e);
  IF c->>'certified' IS DISTINCT FROM 'true' OR c->>'financial_payment' IS DISTINCT FROM 'false'
  OR c->'proof'->>'source_cause' IS DISTINCT FROM 'promo_tournament_hand_addon_rebase' THEN RAISE EXCEPTION 'promo_addon_certify_refused: %',c;END IF;
 END LOOP;
 IF (SELECT count(*) FROM smarter_private.hand_submission_source_corrections WHERE submission_id=ANY(expected))<>2 THEN RAISE EXCEPTION 'promo_addon_certified_count';END IF;
 IF EXISTS(SELECT FROM smarter_private.hand_submission_correction_claims WHERE submission_id=ANY(expected)) THEN RAISE EXCEPTION 'promo_addon_claimed_early';END IF;
END $certify$;

COMMIT;
