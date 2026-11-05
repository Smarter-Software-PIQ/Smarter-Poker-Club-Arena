-- @live-proof: (SELECT count(*)=8 FROM smarter_private.hand_submission_source_corrections WHERE proof->>'proof_version'='20261105041928')
-- 20261105041928_fixed_limit_hands_stranded_by_the_null_cap_settle_once.sql
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 04:19:28 UTC.
--
-- WHAT WAS WRONG
--
-- PR #9450 made the engine's getMaxBuyIn() return NULL for fixed-limit cash
-- tables and put that NULL into post_commit_obligations.pending_addons.max_buy_in.
-- fn_ca_commit_hand_settlement's add-on guard refused anything but a positive
-- JSON number, so every FLH/FLO8 hand commit was refused
-- 'atomic hand commit refused (invalid_post_commit_addons)'. The guard was fixed
-- by 20261105032543 (installed 2026-11-05 04:09 UTC), but the eight fixed-limit
-- cash tables still cannot deal:
--
--   each one holds ONE retained hand (03:05-03:07 UTC). The successor generation
--   took that hand's one financial claim through fn_ca_resume_hand_submission
--   while the defect was live; the refusal (P0001, successor_authority_refused)
--   was recorded as the hand's financial answer, so every later start reads
--   successor_financial_claim_spent and the engine is rebuilt every few seconds
--   (engine_recovery_events: ~8,000 start_failed:start_seed_hand_count kills on
--   exactly these 8 tables between 03:06 and 04:13 UTC; no other table).
--
-- WHAT THIS CHANGES
--
-- Recovery through the existing door, exactly as 20261015011723 did for the
-- metadata defect:
--   1. smarter_private.fl_null_cap_source_correction_proof proves the cause from
--      each hand's own rows against a frozen list of the 8 submissions (request,
--      handoff and result digests pinned): intact request whose pending_addons
--      max_buy_in is JSON null, handoff from the original generation, refusal
--      exactly invalid_post_commit_addons, nothing recorded for the hand (no
--      settlement key, settlement, failure, claim, disposal, commit, history,
--      later permit or outbox), cash table, and the guard fix installed (version
--      recorded and the live guard accepting JSON null).
--   2. The proof dispatcher falls back to it after the four existing proofs.
--   3. The 8 hands are certified through certify_original_hand_source_correction,
--      the operator-only door every earlier correction used. It credits nothing:
--      the engine's own resume then settles each retained hand once, through
--      fn_ca_commit_hand_settlement with its original request.
--
-- MEASURED (read-only, 2026-11-05 04:15 UTC): exactly these 8 submissions carry
-- the refusal and no correction; for each, the request hash re-derives, the
-- handoff's original generation is the submission's, max_buy_in is JSON null,
-- there is no settlement key/failure/permit/outbox, and every p_stacks seat is
-- still seated with stack = stack_before (0 mismatches).
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
SET LOCAL search_path=public;

DO $guard$BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN RAISE EXCEPTION 'fl_null_cap_operator_refused' USING ERRCODE='42501';END IF;
 IF NULLIF(current_setting('ca.break_window_migration_override',true),'') IS NOT NULL THEN RAISE EXCEPTION 'fl_null_cap_override_refused';END IF;
 IF public.fn_platform_frozen() IS DISTINCT FROM false OR public.fn_active_maintenance_release_boundary() IS NOT NULL THEN RAISE EXCEPTION 'fl_null_cap_freeze_refused';END IF;
 IF EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261105041928') THEN RAISE EXCEPTION 'fl_null_cap_history_replay';END IF;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261105032543') THEN RAISE EXCEPTION 'fl_null_cap_guard_fix_missing';END IF;
 IF to_regprocedure('smarter_private.fl_null_cap_source_correction_proof(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'fl_null_cap_proof_exists';END IF;
END $guard$;

CREATE OR REPLACE FUNCTION smarter_private.fl_null_cap_source_correction_proof(e uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE x record;s smarter_private.hand_submissions;h smarter_private.hand_submission_handoffs;z smarter_private.hand_submission_handoff_results;stack_hand uuid;
BEGIN
 -- THE NULL-CAP REFUSAL, PROVED FROM THE HAND'S OWN ROWS (2026-11-05). Frozen
 -- list: the 8 fixed-limit cash hands refused invalid_post_commit_addons while
 -- the guard read a JSON-null max_buy_in as invalid (fixed by 20261105032543).
 SELECT * INTO x FROM(VALUES
('143b34db-80a8-461c-97af-79b19cf4d7b9'::uuid,'f2e5f584-5fe9-4841-aa43-40652dc94613'::uuid,55007828::bigint,'8b14d0ac4779e169bcd2f420cae30bb5de0ac2586f7011afa08a8a5c8aa9b8b8','87ec368cfe80f75099d7abfb57add0de','53d316e94371b2d2ed623b940a83f843','d7a3826b1787cb6d1ab358dfd484a6bd'),
('1b753af7-cbb7-4b53-a164-6bc8bdea6993'::uuid,'42ad5814-ae7a-4fc8-9fa8-666ca6092c69'::uuid,55007849::bigint,'0e70fee1a431c42af4c8e2070834df691954c452237702a6f2d2ccee0cf34599','30b3b24efd55bfbede7b4a88715dc100','f1a6e766cb7ad9558414f52963d34eba','61d2d2e6f5dc748ff80f812b2396a6ca'),
('2f190b79-a089-4dbc-b642-9547ed292b8e'::uuid,'d552311d-75a5-447d-9106-e7bff0036b1a'::uuid,55007976::bigint,'2f6b5163b415911f78066252e47a34147895575f1f5d353512bc1824a17a3afc','68aa7271b90f89c6924610a852f17b89','4480779fb8c887572090dcd861989c54','8fe2a25a5cf01b09536474b5ab653165'),
('36d31d8c-850e-4d65-a2d7-94d1f057600f'::uuid,'7e1e81ef-ae98-4ef0-b44e-c0569a97e8a3'::uuid,55007916::bigint,'bbd2ef9b3113d959ef7a8f6e0bdcd4ace9c847c72a80812f6229ee3a8f6caf79','f4972d917e33e396adf53f845762b7a0','e0caab021bb79fd8fe07f33bcf19f641','3aa7a1c1dd81d31a3b52e9df78496985'),
('494e5e1e-9ab4-4c9d-95c1-b1ef6ab7bde2'::uuid,'19e033d0-6711-4c38-ba8f-f28311b1bff5'::uuid,55007826::bigint,'d6b131acd8f51a3b57e9e9d2e1444055841bb7a6866d01a1b18ead8eb58a0557','9dfee759a7864f2c45bfdcf2bc6e058e','b03499db23fdbc8c5eee45a88f697ad8','bf815040468c04a1b145f3d50a59166d'),
('6106bfe0-0565-4bf1-a54c-711419cf5821'::uuid,'95ec07f2-1a7d-489c-bddc-5e06ee765234'::uuid,55007941::bigint,'d029e7651179c2dd2e3de6ef8f6b4435b53a92e2c4393cb439340447d213b253','8006ecb054e922a4a006ae8b692507cf','1db0f6a202dd1e409cdb6d1f3035dce7','114ba5780b988e38fb803529b723df4d'),
('9d95015b-1b21-4c20-87b8-56e11c5e3cb2'::uuid,'c43a1531-4028-45cb-b53f-15d0493068e1'::uuid,55007975::bigint,'99725141b9c1e910220a835402b8aeecab6d9e96dfecf7ebd02fbdc0025f4f09','13a4fb6f5768b5f8347a6251275b4b25','35146a8c04951c984051fe0ff1ff6aec','515d43f677562313ee4d1e9f41c145ad'),
('e678a7a4-1f20-4c97-a548-c126189bd26a'::uuid,'e891c37b-1380-42ef-a38d-24630a330476'::uuid,55007872::bigint,'603493294ab761818af54be0c21143d01793407a93033c3830fdb002ce21d05f','8dd92038dd4b4954490b6763edffed53','071fe33676a61ad985a6344d6a4d4853','239a68b54dd33ac11cf74c77dc6fc5d3')
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
 OR z.result->>'error' IS DISTINCT FROM 'atomic hand commit refused (invalid_post_commit_addons)'
 OR z.result->'success' IS DISTINCT FROM 'false'::jsonb OR z.result->'atomic_hand_commit' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(s.request#>'{p_post_commit_obligations,pending_addons,max_buy_in}') IS DISTINCT FROM 'null'
 OR s.request#>>'{p_hand_row,tournament_id}' IS NOT NULL
 OR NOT EXISTS(SELECT FROM public.tables t WHERE t.id=s.table_id AND t.tournament_id IS NULL AND NOT COALESCE(t.is_deleted,false))
 OR EXISTS(SELECT FROM public.settlement_idempotency_keys c WHERE c.table_id=s.table_id AND c.hand_id=stack_hand)
 OR EXISTS(SELECT FROM public.ca_settlements c WHERE c.settlement_type='hand_stacks' AND c.external_ref=s.table_id::text||':'||stack_hand::text)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_failures f WHERE f.submission_id=e)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_correction_claims c WHERE c.submission_id=e)
 OR EXISTS(SELECT FROM smarter_private.hand_submission_disposals d WHERE d.submission_id=e OR (d.table_id=s.table_id AND d.hand_number=s.hand_number))
 OR EXISTS(SELECT FROM public.hand_atomic_commits c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM public.hand_history c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM smarter_private.f06_hand_permits c WHERE c.table_id=s.table_id AND c.hand_number>=s.hand_number)
 OR EXISTS(SELECT FROM public.hand_projection_outbox c WHERE c.hand_id=e)
 -- The defect's own fix is installed and live: the guard accepts JSON null.
 OR NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261105032543')
 OR position($q$NOT IN ('number', 'null')$q$ IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid='public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure))=0
 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('submission_id',e,'table_id',s.table_id,'hand_number',s.hand_number,'request_hash',s.request_hash,
 'request_md5',x.request_md5,'handoff_md5',x.handoff_md5,'result_md5',x.result_md5,'original_generation',s.lease_generation,
 'scope','cash','source_cause','fixed_limit_null_max_buy_in','source_version','20261105032543','proof_version','20261105041928');
END $function$
;
REVOKE ALL ON FUNCTION smarter_private.fl_null_cap_source_correction_proof(uuid) FROM PUBLIC;

DO $install$
DECLARE
 o_d text:=$anchor$ RETURN smarter_private.metadata_defect_source_correction_proof(e);
$anchor$;
 n_d text:=$anchor$ proof:=smarter_private.metadata_defect_source_correction_proof(e);
 IF proof IS NOT NULL THEN RETURN proof;END IF;
 -- The fixed-limit hands the JSON-null max buy-in refusal stranded (2026-11-05).
 RETURN smarter_private.fl_null_cap_source_correction_proof(e);
$anchor$;
 sig_d constant regprocedure:='smarter_private.original_hand_source_correction_proof(uuid)'::regprocedure;
 d text; before jsonb;
BEGIN
 d:=pg_get_functiondef(sig_d);
 IF md5(d)<>'4f8a0958e5785cb557ddf413d3d9b015' THEN RAISE EXCEPTION 'fl_null_cap_dispatcher_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o_d,'')))/length(o_d)<>1 THEN RAISE EXCEPTION 'fl_null_cap_dispatcher_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig_d;
 EXECUTE replace(d,o_d,n_d);
 d:=pg_get_functiondef(sig_d);
 IF (length(d)-length(replace(d,'smarter_private.fl_null_cap_source_correction_proof(e)','')))/length('smarter_private.fl_null_cap_source_correction_proof(e)')<>1
 OR (length(d)-length(replace(d,'smarter_private.metadata_defect_source_correction_proof(e)','')))/length('smarter_private.metadata_defect_source_correction_proof(e)')<>1
 THEN RAISE EXCEPTION 'fl_null_cap_dispatcher_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig_d) IS DISTINCT FROM before THEN RAISE EXCEPTION 'fl_null_cap_dispatcher_security_refused';END IF;
END $install$;

DO $certify$
DECLARE expected constant uuid[]:=ARRAY['143b34db-80a8-461c-97af-79b19cf4d7b9'::uuid,'1b753af7-cbb7-4b53-a164-6bc8bdea6993'::uuid,'2f190b79-a089-4dbc-b642-9547ed292b8e'::uuid,'36d31d8c-850e-4d65-a2d7-94d1f057600f'::uuid,'494e5e1e-9ab4-4c9d-95c1-b1ef6ab7bde2'::uuid,'6106bfe0-0565-4bf1-a54c-711419cf5821'::uuid,'9d95015b-1b21-4c20-87b8-56e11c5e3cb2'::uuid,'e678a7a4-1f20-4c97-a548-c126189bd26a'::uuid]; e uuid; c jsonb;
BEGIN
 FOREACH e IN ARRAY expected LOOP
  IF smarter_private.fl_null_cap_source_correction_proof(e) IS NULL THEN RAISE EXCEPTION 'fl_null_cap_proof_refused: %',e;END IF;
  IF smarter_private.original_hand_source_correction_proof(e)->>'proof_version' IS DISTINCT FROM '20261105041928' THEN RAISE EXCEPTION 'fl_null_cap_dispatch_refused: %',e;END IF;
  c:=smarter_private.certify_original_hand_source_correction(e);
  IF c->>'certified' IS DISTINCT FROM 'true' OR c->>'financial_payment' IS DISTINCT FROM 'false'
  OR c->'proof'->>'source_cause' IS DISTINCT FROM 'fixed_limit_null_max_buy_in' THEN RAISE EXCEPTION 'fl_null_cap_certify_refused: %',c;END IF;
 END LOOP;
 IF (SELECT count(*) FROM smarter_private.hand_submission_source_corrections WHERE submission_id=ANY(expected))<>8 THEN RAISE EXCEPTION 'fl_null_cap_certified_count';END IF;
 IF EXISTS(SELECT FROM smarter_private.hand_submission_correction_claims WHERE submission_id=ANY(expected)) THEN RAISE EXCEPTION 'fl_null_cap_claimed_early';END IF;
END $certify$;

COMMIT;
