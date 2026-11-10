BEGIN;
SELECT pg_temp.prepare_split(.5,'rebuy');
INSERT INTO table_pending_addons SELECT f.pending_addon_id,f.table_id,f.amount,a.applied_at,a.applied,a.refunded FROM cash_participant_funding_receipts f JOIN cash_funding_application_receipts a ON a.funding_receipt_id=f.id;
UPDATE hand_atomic_commits SET post_commit_completed_at=NULL WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
\i :prover_candidate
\i :completion_candidate
CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
DO $refusal$DECLARE result jsonb;o union_pnl_cash_outcomes;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 result:=fn_ca_process_hand_post_commit_obligations(o.hand_id);
 IF result->>'ok'IS DISTINCT FROM 'true'OR result#>>'{accounting_admission,reason}'IS DISTINCT FROM 'original_sources_unqualified'
  OR(SELECT post_commit_completed_at IS NULL OR post_commit_result IS DISTINCT FROM result FROM hand_atomic_commits WHERE hand_id=o.hand_id)
  OR EXISTS(SELECT FROM smarter_private.posthand_escrow_certificates)OR fn_union_pnl_cash_outcome_accepted(o)IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'accounting qualification either held valid financial completion or claimed a certificate %',result;END IF;
 RAISE NOTICE 'PASS source-unqualified accounting refusal is durable without rolling back valid completed obligations or claiming certification';
END$refusal$;
ROLLBACK;
BEGIN;
SELECT pg_temp.prepare_split(.5,'rebuy');
INSERT INTO table_pending_addons SELECT f.pending_addon_id,f.table_id,f.amount,a.applied_at,a.applied,a.refunded FROM cash_participant_funding_receipts f JOIN cash_funding_application_receipts a ON a.funding_receipt_id=f.id;
UPDATE hand_atomic_commits SET post_commit_completed_at=NULL WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
\i :prover_candidate
\i :completion_candidate
DO $error$DECLARE o union_pnl_cash_outcomes;before_row jsonb;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 SELECT to_jsonb(a)INTO before_row FROM hand_atomic_commits a WHERE hand_id=o.hand_id;
 BEGIN
  CREATE OR REPLACE FUNCTION public.fn_union_pnl_prove_posthand_escrow(p_table uuid,p_number bigint)RETURNS jsonb LANGUAGE plpgsql AS $fault$BEGIN RAISE EXCEPTION 'native_unexpected_proof_error';END$fault$;
  PERFORM fn_ca_process_hand_post_commit_obligations(o.hand_id);
  RAISE EXCEPTION 'unexpected proof failure swallowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'native_unexpected_proof_error'THEN RAISE;END IF;END;
 IF(SELECT to_jsonb(a)FROM hand_atomic_commits a WHERE hand_id=o.hand_id)IS DISTINCT FROM before_row
  OR EXISTS(SELECT FROM smarter_private.posthand_escrow_certificates)THEN RAISE EXCEPTION 'unexpected error left partial completion or certificate';END IF;
 RAISE NOTICE 'PASS unexpected proof error remains visible and atomically rolls back its own completion/certificate';
END$error$;
ROLLBACK;

BEGIN;
SELECT pg_temp.prepare_split(.5,'rebuy');
INSERT INTO table_pending_addons SELECT f.pending_addon_id,f.table_id,f.amount,a.applied_at,a.applied,a.refunded FROM cash_participant_funding_receipts f JOIN cash_funding_application_receipts a ON a.funding_receipt_id=f.id;
UPDATE hand_atomic_commits SET post_commit_completed_at=NULL WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
\i :prover_candidate
\i :completion_candidate
CREATE OR REPLACE FUNCTION public.fn_platform_frozen()RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
DO $refusal$DECLARE result jsonb;o union_pnl_cash_outcomes;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 result:=fn_ca_process_hand_post_commit_obligations(o.hand_id);
 IF result->>'ok'IS DISTINCT FROM 'true'OR result#>>'{accounting_admission,reason}'IS DISTINCT FROM 'accounting_admission_platform_frozen'
  OR(SELECT post_commit_completed_at IS NULL OR post_commit_result IS DISTINCT FROM result FROM hand_atomic_commits WHERE hand_id=o.hand_id)
  OR EXISTS(SELECT FROM smarter_private.posthand_escrow_certificates)OR fn_union_pnl_cash_outcome_accepted(o)IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'accounting qualification either held valid financial completion or claimed a certificate %',result;END IF;
 RAISE NOTICE 'PASS frozen accounting refusal is durable without rolling back valid completed obligations or claiming certification';
END$refusal$;
ROLLBACK;
