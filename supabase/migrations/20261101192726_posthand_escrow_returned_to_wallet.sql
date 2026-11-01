-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- POSTHAND ESCROW: A FULLY RETURNED PENDING APPLICATION PROVES THE HAND TOO.
--
-- Midway Oct 19-26 refuses to close over one hand (05d8e6bc-07ca-4980-b5f3-
-- 476ca4439e41 / 43640739, 2026-10-22 09:54Z): a player requested an addon,
-- moved tables, and the addon was refunded to his wallet in full BEFORE the
-- hand settled -- but the dealt manifest froze the application as pending, so
-- his ownership stayed uncertified and his -2.00 books to no club. The
-- existing posthand escrow only proves the mirror case (the pending amount
-- APPLIED to the same, unmoved occupancy after the hand), so it refused this
-- hand with pending_escrow_moved_occupancy.
--
-- This migration teaches fn_union_pnl_prove_posthand_escrow the returned
-- case: when the affected participant's occupancy moved, the single pending
-- receipt in his re-proved lineage must be an addon whose application was
-- refunded in full (applied 0), never applied anywhere in the lineage, with a
-- posted table-stack -> player-wallet ledger return of the exact amount. All
-- other verification (live lineage re-proof against the ledger for every
-- participant, signed stacks, conservation, frozen-issue shape) is unchanged
-- and still runs first. posthand_escrow_project_evidence now labels
-- qualified_basis with the proof's own resolution_kind; for every existing
-- certificate that string is byte-identical to the old constant, so no
-- retained sha changes. Neither function is in the original-inventory pinned
-- source set, so the generation is untouched. No money moves.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)'::regprocedure))
    IS DISTINCT FROM 'c0554046c74ab6997805d312c1848c76' THEN RAISE EXCEPTION 'posthand_escrow_prover_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('smarter_private.posthand_escrow_project_evidence(jsonb,jsonb)'::regprocedure))
    IS DISTINCT FROM '95ef5461c27ea58c3ff77e6f8d47df88' THEN RAISE EXCEPTION 'posthand_escrow_project_preimage_changed'; END IF;
 IF position('fn_union_pnl_prove_posthand_escrow' IN pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))>0 THEN
  RAISE EXCEPTION 'posthand_escrow_prover_is_generation_pinned'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_union_pnl_prove_posthand_escrow(p_table uuid, p_number bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE o union_pnl_cash_outcomes; p cash_hand_provenance_receipts; m cash_hand_participant_manifests;
 a hand_atomic_commits; prev cash_hand_provenance_receipts; f cash_participant_funding_receipts; app cash_funding_application_receipts;
 cert smarter_private.posthand_escrow_certificates; retained boolean; live boolean; completed_at timestamptz; pending_ids jsonb; result jsonb;
 affected uuid; part jsonb; original jsonb; lin jsonb; ref jsonb; owned uuid; refs uuid[]; total numeric:=0;
 v_n bigint; v_refund_ledger uuid;
 before_stack numeric; after_stack numeric; prev_stack numeric; submitted jsonb; proof_people jsonb:='[]'; witness union_pnl_inventory_events;
BEGIN
 SELECT * INTO o FROM union_pnl_cash_outcomes WHERE table_id=p_table AND hand_number=p_number;
 IF NOT FOUND OR o.evidence->>'status' IS DISTINCT FROM 'blocked'
  OR o.evidence->'all_players_included' IS DISTINCT FROM 'true'::jsonb
  OR o.evidence->'game_scope' IS DISTINCT FROM o.game_scope
  OR o.transaction_id IS NULL OR o.recognized_at IS NULL OR NOT isfinite(o.recognized_at)
  OR NOT EXISTS(SELECT 1 FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=o.transaction_id AND fr.observed_at=o.recognized_at) THEN RAISE EXCEPTION 'escrow_refused:blocked_original_population_required';END IF;
 SELECT * INTO STRICT p FROM cash_hand_provenance_receipts WHERE table_id=p_table AND hand_number=p_number;
 SELECT * INTO STRICT m FROM cash_hand_participant_manifests WHERE id=p.manifest_id;
 IF (p.table_id,p.hand_number,p.hand_id,p.payload_hash,p.game_scope) IS DISTINCT FROM (o.table_id,o.hand_number,o.hand_id,o.payload_hash,o.game_scope)
  OR (m.table_id,m.hand_number,m.game_scope) IS DISTINCT FROM (p_table,p_number,o.game_scope)
  OR m.issues IS DISTINCT FROM p.issues OR p.status IS DISTINCT FROM 'uncertified'
  OR p.funding_provenance_complete IS DISTINCT FROM false OR p.all_players_included IS DISTINCT FROM true
  OR p.accepted_at IS NULL OR NOT isfinite(p.accepted_at) OR m.captured_at IS NULL OR NOT isfinite(m.captured_at) OR m.captured_at>o.recognized_at OR o.recognized_at>p.accepted_at
  OR o.game_scope->>'asset' IS DISTINCT FROM 'chips' OR o.game_scope->'unit_scale' IS DISTINCT FROM '2'::jsonb
  OR o.game_scope->'tournament_id' IS DISTINCT FROM 'null'::jsonb
  OR pg_input_is_valid(o.game_scope->>'host_club_id','uuid') IS DISTINCT FROM true
  OR pg_input_is_valid(o.game_scope->>'game_union_id','uuid') IS DISTINCT FROM true
  OR jsonb_typeof(o.game_scope->'is_private') IS DISTINCT FROM 'boolean'
  OR NOT o.game_scope ?& ARRAY['host_club_id','game_union_id','asset','unit_scale','is_private','tournament_id']
  OR p.accepted_request->>'table_id' IS DISTINCT FROM p_table::text OR p.accepted_request->>'hand_number' IS DISTINCT FROM p_number::text
  OR NOT public.fn_cash_signed_retained_request_matches(p_table,p_number,p.payload_hash,p.accepted_request) THEN
  RAISE EXCEPTION 'escrow_refused:original_identity_or_signature_disagrees';END IF;
 SELECT min((x->>'user_id'))::uuid INTO affected FROM jsonb_array_elements(m.issues) x;
 IF affected IS NULL OR jsonb_array_length(m.issues)<>2
  OR NOT m.issues @> jsonb_build_array(jsonb_build_object('reason','pending_funding_application_unproven','user_id',affected),jsonb_build_object('reason','original_cash_move_lineage_unproven','user_id',affected,'details',jsonb_build_array('pending_funding_application_unproven')))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(m.issues) x WHERE x->>'user_id' IS DISTINCT FROM affected::text
    OR NOT (x=jsonb_build_object('reason','pending_funding_application_unproven','user_id',affected)
      OR x=jsonb_build_object('reason','original_cash_move_lineage_unproven','user_id',affected,'details',jsonb_build_array('pending_funding_application_unproven'))))
  OR o.evidence->'issues' IS DISTINCT FROM (jsonb_build_array('original_cash_funding_incomplete')||m.issues||
    jsonb_build_array(jsonb_build_object('reason','participant_earning_ownership_receipt_invalid','user_id',affected))) THEN
  RAISE EXCEPTION 'escrow_refused:only_exact_pending_escrow_defects_qualify';END IF;
 SELECT * INTO cert FROM smarter_private.posthand_escrow_certificates WHERE table_id=p_table AND hand_number=p_number;
 retained:=FOUND;
 IF retained AND (cert.hand_id IS DISTINCT FROM o.hand_id
  OR cert.original_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(cert.original::text,'UTF8'),'sha256'),'hex')
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['source_financial_request_sha256','original_accounting_evidence_sha256','qualified_evidence_sha256','original_participant_roster_sha256','immutable_financial_sha256','original_atomic_sha256','compact_atomic_sha256','original_stack_result_sha256','original_stack_request_sha256','postcommit_payload_sha256','postcommit_request_sha256','postcommit_result_sha256']) name WHERE jsonb_typeof(cert.original->name) IS DISTINCT FROM 'string' OR cert.original->>name !~ '^[a-f0-9]{64}$')
  OR cert.original->'version' IS DISTINCT FROM '1'::jsonb
  OR cert.original->>'table_id' IS DISTINCT FROM p_table::text OR cert.original->>'hand_number' IS DISTINCT FROM p_number::text
  OR cert.original->>'hand_id' IS DISTINCT FROM o.hand_id::text OR cert.original->>'manifest_id' IS DISTINCT FROM p.manifest_id::text
  OR (cert.original->>'accepted_at')::timestamptz IS DISTINCT FROM p.accepted_at
  OR cert.original->>'source_financial_request_sha256' IS DISTINCT FROM p.payload_hash
  OR cert.original->>'original_accounting_evidence_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(o.evidence::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'original_participant_roster_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(p.participants::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'immutable_financial_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to((to_jsonb(p)-ARRAY['accepted_request','atomic_receipt','accepted_at'])::text,'UTF8'),'sha256'),'hex')
  OR (encode(extensions.digest(convert_to(p.atomic_receipt::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM cert.original->>'original_atomic_sha256'
   AND encode(extensions.digest(convert_to(p.atomic_receipt::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM cert.original->>'compact_atomic_sha256')
  OR cert.original->>'stack_hand_id' IS DISTINCT FROM p.atomic_receipt#>>'{stack_result,hand_id}'
  OR cert.original->>'original_stack_result_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to((p.atomic_receipt->'stack_result')::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'original_stack_request_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to((p.atomic_receipt#>'{stack_result,request}')::text,'UTF8'),'sha256'),'hex')
  OR cert.original->>'postcommit_payload_sha256' IS NULL OR cert.original->>'postcommit_payload_sha256' !~ '^[a-f0-9]{64}$'
  OR cert.original->>'postcommit_request_sha256' IS NULL OR cert.original->>'postcommit_request_sha256' !~ '^[a-f0-9]{64}$'
  OR cert.original->>'postcommit_result_sha256' IS NULL OR cert.original->>'postcommit_result_sha256' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(cert.original->'pending_ids') IS DISTINCT FROM 'array'
  OR (jsonb_array_length(cert.original->'pending_ids')<>1
   AND NOT (jsonb_array_length(cert.original->'pending_ids')=0 AND cert.original#>>'{proof,resolution_kind}'='original_pending_escrow_returned_to_wallet'))
  OR (jsonb_array_length(cert.original->'pending_ids')>0 AND NOT pg_input_is_valid(cert.original#>>'{pending_ids,0}','uuid'))
  OR cert.original->>'committed_at' IS NULL OR cert.original->>'completed_at' IS NULL
  OR NOT isfinite((cert.original->>'committed_at')::timestamptz) OR NOT isfinite((cert.original->>'completed_at')::timestamptz)
  OR (cert.original->>'completed_at')::timestamptz<(cert.original->>'committed_at')::timestamptz) THEN
  RAISE EXCEPTION 'escrow_refused:immutable_original_postcommit_certificate_disagrees';END IF;
 SELECT * INTO a FROM hand_atomic_commits WHERE table_id=p_table AND hand_number=p_number;
 live:=FOUND;
 IF live THEN
 IF a.hand_id IS DISTINCT FROM o.hand_id OR a.payload_hash IS DISTINCT FROM o.payload_hash
  OR a.stack_result IS DISTINCT FROM p.atomic_receipt->'stack_result'
  OR p.atomic_receipt->>'table_id' IS DISTINCT FROM p_table::text OR p.atomic_receipt->>'hand_number' IS DISTINCT FROM p_number::text
  OR a.stack_result->'success' IS DISTINCT FROM 'true'::jsonb OR a.stack_result->'conservation_checked' IS DISTINCT FROM 'true'::jsonb
  OR a.post_commit_completed_at IS NULL OR NOT isfinite(a.post_commit_completed_at) OR a.post_commit_result->'ok' IS DISTINCT FROM 'true'::jsonb
  OR p.stack_claim->>'status' IS DISTINCT FROM 'succeeded' OR p.stack_claim->'result' IS DISTINCT FROM a.stack_result
  OR p.stack_settlement->>'state' IS DISTINCT FROM 'final'
  OR p.stack_claim->>'table_id' IS DISTINCT FROM p_table::text
  OR p.stack_claim->>'hand_id' IS DISTINCT FROM a.stack_result->>'hand_id'
  OR p.stack_settlement->>'hand_id' IS DISTINCT FROM a.stack_result->>'hand_id'
  OR NOT EXISTS(SELECT 1 FROM settlement_idempotency_keys k WHERE k.table_id=p_table AND k.hand_id=(a.stack_result->>'hand_id')::uuid
    AND k.status='succeeded' AND smarter_private.horse_settlement_original_result(k.table_id,k.hand_id,k.result)=a.stack_result)
  OR NOT EXISTS(SELECT 1 FROM ca_settlements c WHERE c.table_id=p_table AND c.hand_id=(a.stack_result->>'hand_id')::uuid
    AND c.state='final' AND c.totals=p.stack_settlement->'totals') THEN RAISE EXCEPTION 'escrow_refused:original_atomic_completion_required';END IF;
 submitted:=a.post_commit_payload-'accepted_hand_facts';
 IF jsonb_typeof(a.post_commit_payload) IS DISTINCT FROM 'object'
  OR a.post_commit_payload->>'version' IS DISTINCT FROM '1'
  OR jsonb_typeof(a.post_commit_payload->'accepted_hand_facts') IS DISTINCT FROM 'object'
  OR jsonb_typeof(a.post_commit_payload#>'{pending_addons,ids}') IS DISTINCT FROM 'array'
  OR encode(extensions.digest(convert_to(a.post_commit_payload::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM a.post_commit_payload_hash
  OR a.post_commit_result->>'hand_id' IS DISTINCT FROM a.hand_id::text
  OR a.post_commit_result->>'hand_number' IS DISTINCT FROM a.hand_number::text
  OR a.committed_at IS NULL OR NOT isfinite(a.committed_at) OR a.post_commit_completed_at<a.committed_at THEN
  RAISE EXCEPTION 'escrow_refused:original_postcommit_seal_disagrees';END IF;
 submitted:=submitted#-'{pending_addons,ids}';
 IF encode(extensions.digest(convert_to(submitted::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM a.post_commit_request_hash THEN
  RAISE EXCEPTION 'escrow_refused:original_postcommit_request_disagrees';END IF;

  completed_at:=a.post_commit_completed_at;pending_ids:=a.post_commit_payload#>'{pending_addons,ids}';
  IF retained AND (cert.original->>'postcommit_payload_sha256' IS DISTINCT FROM a.post_commit_payload_hash
   OR cert.original->>'postcommit_request_sha256' IS DISTINCT FROM a.post_commit_request_hash
   OR cert.original->>'postcommit_result_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(a.post_commit_result::text,'UTF8'),'sha256'),'hex')
   OR (cert.original->>'committed_at')::timestamptz IS DISTINCT FROM a.committed_at
   OR (cert.original->>'completed_at')::timestamptz IS DISTINCT FROM a.post_commit_completed_at
   OR cert.original->'pending_ids' IS DISTINCT FROM pending_ids) THEN
   RAISE EXCEPTION 'escrow_refused:retained_postcommit_certificate_conflicts_with_original_live';END IF;
 ELSE
  IF NOT retained OR p.atomic_receipt->>'table_id' IS DISTINCT FROM p_table::text
   OR p.atomic_receipt->>'hand_number' IS DISTINCT FROM p_number::text
   OR p.atomic_receipt->>'hand_id' IS DISTINCT FROM o.hand_id::text OR p.atomic_receipt->>'payload_hash' IS DISTINCT FROM o.payload_hash
   OR p.atomic_receipt#>'{stack_result,success}' IS DISTINCT FROM 'true'::jsonb
   OR p.atomic_receipt#>'{stack_result,conservation_checked}' IS DISTINCT FROM 'true'::jsonb
   OR p.stack_claim->>'status' IS DISTINCT FROM 'succeeded' OR p.stack_claim->'result' IS DISTINCT FROM p.atomic_receipt->'stack_result'
   OR p.stack_settlement->>'state' IS DISTINCT FROM 'final'
   OR NOT EXISTS(SELECT 1 FROM settlement_idempotency_keys k WHERE k.table_id=p_table AND k.hand_id=(p.atomic_receipt#>>'{stack_result,hand_id}')::uuid
    AND k.status='succeeded' AND smarter_private.horse_settlement_original_result(k.table_id,k.hand_id,k.result)=p.atomic_receipt->'stack_result')
   OR NOT EXISTS(SELECT 1 FROM ca_settlements c WHERE c.table_id=p_table AND c.hand_id=(p.atomic_receipt#>>'{stack_result,hand_id}')::uuid
    AND c.state='final' AND c.totals=p.stack_settlement->'totals') THEN
   RAISE EXCEPTION 'escrow_refused:retained_original_atomic_completion_required';END IF;
  IF EXISTS(SELECT 1 FROM smarter_private.horse_settlement_key_certificates k WHERE k.table_id=p_table AND k.hand_number=p_number
   AND ((k.history_hand_id,k.manifest_id,k.stack_hand_id) IS DISTINCT FROM (o.hand_id,p.manifest_id,(p.atomic_receipt#>>'{stack_result,hand_id}')::uuid)
    OR k.original_result_sha256 IS DISTINCT FROM cert.original->>'original_stack_result_sha256'
    OR k.original_request_sha256 IS DISTINCT FROM cert.original->>'original_stack_request_sha256'
    OR k.accounting_evidence_sha256 IS DISTINCT FROM cert.original->>'qualified_evidence_sha256'
    OR k.settled_at IS DISTINCT FROM (cert.original->>'completed_at')::timestamptz)) THEN
   RAISE EXCEPTION 'escrow_refused:original_retention_key_certificate_disagrees';END IF;
  completed_at:=(cert.original->>'completed_at')::timestamptz;pending_ids:=cert.original->'pending_ids';
 END IF;
 IF jsonb_typeof(p.participants) IS DISTINCT FROM 'array' OR jsonb_array_length(p.participants) NOT BETWEEN 2 AND 10
  OR jsonb_array_length(p.participants)<>jsonb_array_length(m.participants)
  OR jsonb_array_length(p.participants)<>jsonb_array_length(o.evidence->'participants')
  OR jsonb_array_length(p.participants)<>jsonb_array_length(p.accepted_request->'stacks')
  OR (SELECT count(DISTINCT x->>'user_id') FROM jsonb_array_elements(p.participants) x)<>jsonb_array_length(p.participants) THEN
  RAISE EXCEPTION 'escrow_refused:full_original_roster_required';END IF;
 FOR part IN SELECT x FROM jsonb_array_elements(p.participants) x LOOP
  before_stack:=fn_pnl_evidence_cents(part->'stack_before');after_stack:=fn_pnl_evidence_cents(part->'stack_after');
  IF before_stack IS NULL OR after_stack IS NULL OR before_stack<0 OR after_stack<0
   OR jsonb_typeof(part->'is_horse') IS DISTINCT FROM 'boolean' OR part->>'user_id' IS NULL OR part->>'seat_id' IS NULL OR part->>'occupancy_id' IS NULL OR part->>'seat_joined_at' IS NULL THEN
   RAISE EXCEPTION 'escrow_refused:strict_original_stack_and_identity_required';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(m.participants) x WHERE x->>'user_id'=part->>'user_id'
    AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
    AND x->>'seat_joined_at'=part->>'seat_joined_at' AND x->'is_horse'=part->'is_horse' AND x->'stack_before'=part->'stack_before'
    AND x->'funding_lineage'=part->'funding_lineage')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(p.accepted_request->'stacks') x WHERE x->>'user_id'=part->>'user_id'
    AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
    AND x->>'seat_joined_at'=part->>'seat_joined_at' AND fn_pnl_evidence_cents(x->'stack_before')=before_stack
    AND fn_pnl_evidence_cents(x->'stack')=after_stack)<>1
   OR (SELECT count(*) FROM jsonb_array_elements(p.atomic_receipt#>'{stack_result,request,stacks}') x WHERE x->>'user_id'=part->>'user_id'
    AND x->>'seat_id'=part->>'seat_id' AND x->>'seat_joined_at'=part->>'seat_joined_at'
    AND fn_pnl_evidence_cents(x->'stack_before')=before_stack AND fn_pnl_evidence_cents(x->'stack')=after_stack)<>1 THEN
   RAISE EXCEPTION 'escrow_refused:signed_original_player_disagrees';END IF;
  lin:=fn_cash_original_funding_lineage((part->>'user_id')::uuid,p_table,(part->>'seat_id')::uuid,(part->>'occupancy_id')::uuid,
   (part->>'seat_joined_at')::timestamptz,(part#>>'{funding_lineage,observed_at}')::timestamptz,false);
  IF lin->'issues' IS DISTINCT FROM '[]'::jsonb OR (lin-'issues') IS DISTINCT FROM ((part->'funding_lineage')-'issues')
   OR part#>'{funding_lineage,issues}' IS DISTINCT FROM (CASE WHEN part->>'user_id'=affected::text THEN '["pending_funding_application_unproven"]'::jsonb ELSE '[]'::jsonb END)
   OR jsonb_array_length(lin->'funding_receipts')=0 THEN RAISE EXCEPTION 'escrow_refused:original_lineage_disagrees';END IF;
  owned:=NULL;refs:=ARRAY[]::uuid[];
  FOR ref IN SELECT x FROM jsonb_array_elements(lin->'funding_receipts') x LOOP
   SELECT * INTO STRICT f FROM cash_participant_funding_receipts WHERE id=(ref->>'id')::uuid;
   IF f.id=ANY(refs) OR f.user_id IS DISTINCT FROM (part->>'user_id')::uuid OR f.account_type IS DISTINCT FROM 'player_wallet'
    OR f.account_entity_id IS DISTINCT FROM f.user_id OR f.funding_club_id IS NULL OR (owned IS NOT NULL AND owned<>f.funding_club_id)
    OR f.funding_union_id::text IS DISTINCT FROM o.game_scope->>'game_union_id' OR f.asset IS DISTINCT FROM 'chips' OR f.unit_scale IS DISTINCT FROM 2
    OR f.amount IS NULL OR f.amount<=0 OR f.amount<>round(f.amount,2) OR f.amount::text IN('NaN','Infinity','-Infinity')
    OR f.balance_before-f.balance_after IS DISTINCT FROM f.amount THEN RAISE EXCEPTION 'escrow_refused:original_wallet_owner_or_debit_disagrees';END IF;
   owned:=f.funding_club_id;refs:=array_append(refs,f.id);
  END LOOP;
  IF (SELECT count(*) FROM cash_participant_funding_receipts WHERE id=ANY(refs) AND operation_kind='buyin')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(o.evidence->'participants') x WHERE x->>'user_id'=part->>'user_id'
    AND x->'is_horse'=part->'is_horse' AND fn_pnl_evidence_cents(x->'observed_stack_delta')=after_stack-before_stack
    AND x->>'ownership_scope'='original_chip_funding_club'
    AND (SELECT array_agg(id ORDER BY id) FROM jsonb_array_elements_text(x->'funding_receipt_ids') t(id))=
        (SELECT array_agg(id::text ORDER BY id::text) FROM unnest(refs) t(id))
    AND CASE WHEN part->>'user_id'=affected::text THEN x->'ownership_certified'='false'::jsonb AND x->'earning_club_id'='null'::jsonb
      ELSE x->'ownership_certified'='true'::jsonb AND x->>'earning_club_id'=owned::text END)<>1 THEN
   RAISE EXCEPTION 'escrow_refused:original_earning_ownership_disagrees';END IF;
  total:=total+after_stack-before_stack;
  proof_people:=proof_people||jsonb_build_array(jsonb_build_object('user_id',part->>'user_id','earning_club_id',owned,'funding_receipt_ids',refs,'poker_delta',after_stack-before_stack));
 END LOOP;
 IF p.signed_external_net IS DISTINCT FROM 0 OR fn_pnl_evidence_cents(p.accepted_request->'inflow') IS DISTINCT FROM 0
  OR p.rake IS NULL OR p.bbj IS NULL OR p.rake<0 OR p.bbj<0 OR total+p.rake+p.bbj IS DISTINCT FROM 0
  OR fn_pnl_evidence_cents(o.evidence->'accepted_rake') IS DISTINCT FROM p.rake
  OR fn_pnl_evidence_cents(o.evidence->'accepted_bbj') IS DISTINCT FROM p.bbj
  OR fn_pnl_evidence_cents(o.evidence->'accepted_external_net') IS DISTINCT FROM p.signed_external_net
  OR fn_pnl_evidence_cents(o.evidence->'observed_delta_total') IS DISTINCT FROM total
  OR fn_pnl_evidence_cents(p.accepted_request->'rake') IS DISTINCT FROM p.rake OR fn_pnl_evidence_cents(p.accepted_request->'bbj') IS DISTINCT FROM p.bbj THEN
  RAISE EXCEPTION 'escrow_refused:original_played_conservation_disagrees';END IF;
 SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants) x WHERE x->>'user_id'=affected::text;
 IF part#>'{funding_lineage,moves}' IS DISTINCT FROM '[]'::jsonb THEN
  -- RETURNED PENDING ESCROW 20261101: the pending application was refunded to
  -- the wallet in full and never applied to any stack, and the occupancy had
  -- moved tables, so the applied-after-the-hand escrow below cannot describe
  -- it. The participant loop above has already re-proved the whole funding
  -- lineage (moves included) clean against the ledger today, with the frozen
  -- manifest issue exactly the pending application. Here the single pending
  -- receipt is verified refunded in full, never applied anywhere in this
  -- lineage, with its posted wallet-return ledger row.
  SELECT count(*) INTO v_n FROM jsonb_array_elements(part#>'{funding_lineage,funding_receipts}') x WHERE (x->>'pending_addon_id') IS NOT NULL;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'escrow_refused:single_pending_receipt_required';END IF;
  SELECT r.* INTO STRICT f FROM cash_participant_funding_receipts r
   WHERE r.id=(SELECT (x->>'id')::uuid FROM jsonb_array_elements(part#>'{funding_lineage,funding_receipts}') x WHERE (x->>'pending_addon_id') IS NOT NULL);
  SELECT * INTO STRICT app FROM cash_funding_application_receipts WHERE funding_receipt_id=f.id;
  IF f.operation_kind IS DISTINCT FROM 'addon' OR f.pending_addon_id IS NULL OR f.user_id IS DISTINCT FROM affected
   OR app.pending_addon_id IS DISTINCT FROM f.pending_addon_id OR app.original_occupancy_id IS DISTINCT FROM f.occupancy_id
   OR app.applied IS DISTINCT FROM 0::numeric OR app.refunded IS DISTINCT FROM f.amount OR app.applied_occupancy_id IS NOT NULL
   OR app.transaction_id IS NULL OR app.applied_at IS NULL OR NOT isfinite(app.applied_at)
   OR pending_ids IS DISTINCT FROM '[]'::jsonb
   OR EXISTS(SELECT 1 FROM cash_funding_application_receipts ap JOIN cash_participant_funding_receipts fr2 ON fr2.id=ap.funding_receipt_id
     WHERE ap.applied>0 AND fr2.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(part#>'{funding_lineage,funding_receipts}') x)) THEN
   RAISE EXCEPTION 'escrow_refused:returned_exact_unapplied_escrow_required';END IF;
  SELECT count(*) INTO v_n FROM chip_ledger l WHERE l.status='posted' AND l.from_type='table_stack' AND l.from_entity_id=f.table_id
   AND l.to_type='player_wallet' AND l.to_entity_id=affected AND l.amount=f.amount
   AND l.created_at>=f.recorded_at AND l.created_at<=app.applied_at;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'escrow_refused:posted_wallet_return_ledger_required';END IF;
  SELECT l.id INTO v_refund_ledger FROM chip_ledger l WHERE l.status='posted' AND l.from_type='table_stack' AND l.from_entity_id=f.table_id
   AND l.to_type='player_wallet' AND l.to_entity_id=affected AND l.amount=f.amount
   AND l.created_at>=f.recorded_at AND l.created_at<=app.applied_at;
  result:=jsonb_build_object('status','proven','resolution_kind','original_pending_escrow_returned_to_wallet','table_id',p_table,
   'hand_number',p_number,'hand_id',o.hand_id,'outcome_payload_hash',o.payload_hash,'outcome_evidence_md5',md5(o.evidence::text),
   'pending_funding_receipt',f.id,'pending_addon_id',f.pending_addon_id,'escrow_amount',f.amount,
   'refund_ledger',v_refund_ledger::text,'application_transaction',app.transaction_id::text,
   'played_stack_before',fn_pnl_evidence_cents(part->'stack_before'),'played_stack_after',fn_pnl_evidence_cents(part->'stack_after'),
   'participants',proof_people,'current_membership_used',false,'current_seats_used',false);
 ELSE
 SELECT pr.* INTO STRICT prev FROM cash_hand_provenance_receipts pr CROSS JOIN LATERAL jsonb_array_elements(pr.participants) x
  WHERE pr.table_id=p_table AND pr.hand_number<p_number AND x->>'occupancy_id'=part->>'occupancy_id' ORDER BY pr.hand_number DESC LIMIT 1;
 SELECT fn_pnl_evidence_cents(x->'stack_after') INTO STRICT prev_stack FROM jsonb_array_elements(prev.participants) x
  WHERE x->>'user_id'=affected::text AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
   AND x->>'seat_joined_at'=part->>'seat_joined_at';
 IF prev.accepted_at IS NULL OR NOT isfinite(prev.accepted_at) OR prev.accepted_at>=m.captured_at
  OR prev.game_scope IS DISTINCT FROM o.game_scope OR prev_stack IS DISTINCT FROM fn_pnl_evidence_cents(part->'stack_before')
  OR NOT fn_cash_signed_retained_request_matches(p_table,prev.hand_number,prev.payload_hash,prev.accepted_request)
  OR prev.atomic_receipt->>'hand_id' IS DISTINCT FROM prev.hand_id::text
  OR prev.atomic_receipt->>'payload_hash' IS DISTINCT FROM prev.payload_hash
  OR prev.atomic_receipt->'stack_result'->'success' IS DISTINCT FROM 'true'::jsonb
  OR prev.atomic_receipt->'stack_result'->'conservation_checked' IS DISTINCT FROM 'true'::jsonb
  OR (SELECT count(*) FROM jsonb_array_elements(prev.accepted_request->'stacks') x WHERE x->>'user_id'=affected::text
    AND x->>'seat_id'=part->>'seat_id' AND x->>'occupancy_id'=part->>'occupancy_id'
    AND x->>'seat_joined_at'=part->>'seat_joined_at' AND fn_pnl_evidence_cents(x->'stack')=prev_stack)<>1
  OR (SELECT count(*) FROM jsonb_array_elements(prev.atomic_receipt#>'{stack_result,request,stacks}') x WHERE x->>'user_id'=affected::text
    AND x->>'seat_id'=part->>'seat_id' AND x->>'seat_joined_at'=part->>'seat_joined_at' AND fn_pnl_evidence_cents(x->'stack')=prev_stack)<>1
  OR NOT EXISTS(SELECT 1 FROM union_pnl_cash_outcomes old WHERE old.table_id=p_table AND old.hand_number=prev.hand_number
    AND old.hand_id=prev.hand_id AND old.payload_hash=prev.payload_hash AND old.game_scope=prev.game_scope AND fn_union_pnl_cash_outcome_accepted(old)) THEN
  RAISE EXCEPTION 'escrow_refused:equal_original_accepted_predecessor_required';END IF;
 SELECT r.* INTO STRICT f FROM cash_participant_funding_receipts r WHERE r.occupancy_id=(part->>'occupancy_id')::uuid
  AND r.recorded_at>prev.accepted_at AND r.recorded_at<=m.captured_at;
 SELECT * INTO STRICT app FROM cash_funding_application_receipts WHERE funding_receipt_id=f.id;
 IF f.operation_kind IS DISTINCT FROM 'addon' OR f.pending_addon_id IS NULL OR f.user_id IS DISTINCT FROM affected
  OR f.table_id IS DISTINCT FROM p_table OR f.seat_id::text IS DISTINCT FROM part->>'seat_id'
  OR f.seat_joined_at IS DISTINCT FROM (part->>'seat_joined_at')::timestamptz
  OR app.pending_addon_id IS DISTINCT FROM f.pending_addon_id OR app.original_occupancy_id IS DISTINCT FROM f.occupancy_id
  OR app.applied_occupancy_id IS DISTINCT FROM f.occupancy_id OR app.applied IS DISTINCT FROM f.amount OR app.refunded IS DISTINCT FROM 0
  OR app.transaction_id IS NULL OR app.applied_at IS NULL OR NOT isfinite(app.applied_at)
  OR app.applied_at<=p.accepted_at OR app.applied_at>completed_at
  OR pending_ids IS DISTINCT FROM jsonb_build_array(f.pending_addon_id)
  OR EXISTS(SELECT 1 FROM cash_funding_application_receipts ap JOIN cash_participant_funding_receipts fr ON fr.id=ap.funding_receipt_id
    WHERE fr.occupancy_id=f.occupancy_id AND ap.applied>0 AND ap.applied_at>prev.accepted_at AND ap.applied_at<=m.captured_at) THEN
  RAISE EXCEPTION 'escrow_refused:unplayed_exact_posthand_application_required';END IF;
 SELECT e.* INTO STRICT witness FROM union_pnl_inventory_events e
  WHERE e.transaction_id=app.transaction_id AND e.source_name='table_seats' AND e.row_id=f.seat_id;
 IF witness.operation IS DISTINCT FROM 'UPDATE' OR witness.before_row->>'occupancy_id' IS DISTINCT FROM f.occupancy_id::text
  OR witness.after_row->>'occupancy_id' IS DISTINCT FROM f.occupancy_id::text
  OR witness.before_row->>'user_id' IS DISTINCT FROM affected::text OR witness.after_row->>'user_id' IS DISTINCT FROM affected::text
  OR witness.before_row->>'id' IS DISTINCT FROM f.seat_id::text OR witness.after_row->>'id' IS DISTINCT FROM f.seat_id::text
  OR witness.before_row->>'club_id' IS DISTINCT FROM f.funding_club_id::text OR witness.after_row->>'club_id' IS DISTINCT FROM f.funding_club_id::text
  OR (witness.before_row->>'joined_at')::timestamptz IS DISTINCT FROM f.seat_joined_at
  OR (witness.after_row->>'joined_at')::timestamptz IS DISTINCT FROM f.seat_joined_at
  OR witness.observed_at IS NULL OR NOT isfinite(witness.observed_at) OR witness.observed_at<=p.accepted_at OR witness.observed_at>app.applied_at
  OR witness.before_row->>'table_id' IS DISTINCT FROM p_table::text OR witness.after_row->>'table_id' IS DISTINCT FROM p_table::text
  OR witness.before_row->'left_at' IS DISTINCT FROM 'null'::jsonb OR witness.after_row->'left_at' IS DISTINCT FROM 'null'::jsonb
  OR fn_pnl_evidence_cents(witness.before_row->'stack') IS DISTINCT FROM fn_pnl_evidence_cents(part->'stack_after')
  OR fn_pnl_evidence_cents(witness.after_row->'stack')-fn_pnl_evidence_cents(witness.before_row->'stack') IS DISTINCT FROM f.amount
  OR NOT EXISTS(SELECT 1 FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=app.transaction_id AND fr.observed_at=witness.observed_at) THEN
  RAISE EXCEPTION 'escrow_refused:original_posthand_felt_conservation_required';END IF;
 result:=jsonb_build_object('status','proven','resolution_kind','original_unplayed_escrow_applied_after_signed_hand','table_id',p_table,
  'hand_number',p_number,'hand_id',o.hand_id,'outcome_payload_hash',o.payload_hash,'outcome_evidence_md5',md5(o.evidence::text),
  'pending_funding_receipt',f.id,'pending_addon_id',f.pending_addon_id,'escrow_amount',f.amount,
  'previous_hand',prev.hand_number,'played_stack_before',fn_pnl_evidence_cents(part->'stack_before'),
  'played_stack_after',fn_pnl_evidence_cents(part->'stack_after'),'posthand_stack',fn_pnl_evidence_cents(witness.after_row->'stack'),
  'application_transaction',app.transaction_id::text,'participants',proof_people,'current_membership_used',false,'current_seats_used',false);
 END IF;
 IF retained AND (cert.original->'proof' IS DISTINCT FROM result
  OR cert.original->>'qualified_evidence_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(smarter_private.posthand_escrow_project_evidence(o.evidence,result)::text,'UTF8'),'sha256'),'hex')) THEN
  RAISE EXCEPTION 'escrow_refused:immutable_original_posthand_proof_disagrees';END IF;
 RETURN result;
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM LIKE 'escrow_refused:%' THEN RETURN jsonb_build_object('status','refused','reason',SQLERRM);END IF;RAISE;
 WHEN no_data_found OR too_many_rows OR invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RETURN jsonb_build_object('status','refused','reason','missing_duplicate_or_malformed_original');
END $function$;

CREATE OR REPLACE FUNCTION smarter_private.posthand_escrow_project_evidence(p_evidence jsonb, p_proof jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT p_evidence||jsonb_build_object('status','ready','basis_certified',true,'payment_authorized',false,'issues','[]'::jsonb,
  'participants',(SELECT jsonb_agg(o.participant||jsonb_build_object('earning_club_id',p.participant->'earning_club_id','ownership_certified',true) ORDER BY o.n)
   FROM jsonb_array_elements(p_evidence->'participants') WITH ORDINALITY o(participant,n)
   JOIN LATERAL jsonb_array_elements(p_proof->'participants') p(participant) ON p.participant->>'user_id'=o.participant->>'user_id'),
  'qualified_basis',p_proof->>'resolution_kind');
$function$;

-- The live ACLs, restated so the migration itself closes definer access
-- (the owner-definer callers need no grant; service_role keeps its existing
-- telemetry access; nothing is reachable without an account).
REVOKE ALL ON FUNCTION public.fn_union_pnl_prove_posthand_escrow(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_pnl_prove_posthand_escrow(uuid,bigint) TO service_role;
REVOKE ALL ON FUNCTION smarter_private.posthand_escrow_project_evidence(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

DO $post$
DECLARE r jsonb;
BEGIN
 IF position('original_pending_escrow_returned_to_wallet' IN pg_get_functiondef('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'posthand_escrow_returned_branch_missing'; END IF;
 IF has_function_privilege('anon','public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)','EXECUTE') THEN
  RAISE EXCEPTION 'posthand_escrow_prover_reachable_without_account'; END IF;
 -- the one hand this exists for must now PROVE (nothing is written here)
 r:=public.fn_union_pnl_prove_posthand_escrow('05d8e6bc-07ca-4980-b5f3-476ca4439e41',43640739);
 IF r->>'status' IS DISTINCT FROM 'proven' OR r->>'resolution_kind' IS DISTINCT FROM 'original_pending_escrow_returned_to_wallet' THEN
  RAISE EXCEPTION 'posthand_escrow_returned_case_still_refused: %', r; END IF;
END
$post$;
COMMIT;
