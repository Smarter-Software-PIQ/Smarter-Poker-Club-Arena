-- Monetary stages are already committed originals in this isolated fixture.
-- Explicit idempotent receipt adapters make no money writes. The complete
-- actual event owner, prover and certificate writer execute.
SET check_function_bodies=off;
CREATE TABLE public.table_pending_addons(id uuid PRIMARY KEY,table_id uuid,amount numeric,resolved_at timestamptz,applied_to_stack numeric,refunded numeric);
CREATE TABLE IF NOT EXISTS public.tables(id uuid PRIMARY KEY,club_id uuid,tournament_id uuid);
CREATE TABLE IF NOT EXISTS public.clubs(id uuid PRIMARY KEY,asset text);
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS club_id uuid;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS asset text;
CREATE FUNCTION smarter_private.f06_wait_table_lane(uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT 1 FROM public.tables WHERE id=$1 AND tournament_id IS NOT NULL)THEN RAISE EXCEPTION 'fixture_is_cash_only';END IF;END$$;
CREATE FUNCTION public.atomic_distribute_rake(uuid,uuid,uuid,integer,numeric,numeric,numeric,integer,jsonb,uuid,jsonb,text)
RETURNS TABLE(applied boolean,already_processed boolean,rake_record_id uuid)LANGUAGE sql AS $$SELECT false,true,md5('native-existing-rake')::uuid$$;
CREATE FUNCTION public.promo_apply_playthrough(uuid,uuid,numeric)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"already_processed":true}'::jsonb$$;
CREATE FUNCTION public.resolve_pending_addon(uuid,numeric)RETURNS TABLE(applied numeric,refunded numeric)LANGUAGE sql AS
$$SELECT a.applied,a.refunded FROM public.cash_funding_application_receipts a WHERE a.pending_addon_id=$1$$;
\i :completion_original
BEGIN;
SELECT pg_temp.prepare_split(.5,'rebuy');
INSERT INTO table_pending_addons SELECT f.pending_addon_id,f.table_id,f.amount,a.applied_at,a.applied,a.refunded FROM cash_participant_funding_receipts f JOIN cash_funding_application_receipts a ON a.funding_receipt_id=f.id;
UPDATE hand_atomic_commits SET post_commit_completed_at=NULL WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
DO $before$DECLARE result jsonb;BEGIN
 SELECT fn_ca_process_hand_post_commit_obligations(hand_id)INTO result FROM cash_hand_provenance_receipts WHERE status='uncertified';
 IF result->>'ok'IS DISTINCT FROM 'true'OR EXISTS(SELECT FROM smarter_private.posthand_escrow_certificates)THEN RAISE EXCEPTION 'before event boundary differed %',result;END IF;
 RAISE NOTICE 'BEFORE original completed event left no pending-accounting certificate';
END$before$;
UPDATE hand_atomic_commits SET post_commit_completed_at=NULL WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
\i :prover_candidate
\i :completion_candidate
DO $after$DECLARE result jsonb;again jsonb;o union_pnl_cash_outcomes;saved timestamptz;saved_result_md5 text;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 result:=fn_ca_process_hand_post_commit_obligations(o.hand_id);
 IF result->>'ok'IS DISTINCT FROM 'true'OR(SELECT count(*)FROM smarter_private.posthand_escrow_certificates)<>1
  OR fn_union_pnl_cash_outcome_accepted(o)IS DISTINCT FROM true THEN RAISE EXCEPTION 'future event failed to certify its own completed original %',result;END IF;
 SELECT post_commit_completed_at,md5(post_commit_result::text)INTO saved,saved_result_md5 FROM hand_atomic_commits WHERE hand_id=o.hand_id;
 again:=fn_ca_process_hand_post_commit_obligations(o.hand_id);
 IF again->>'already_completed'IS DISTINCT FROM 'true'OR(SELECT count(*)FROM smarter_private.posthand_escrow_certificates)<>1
  OR(SELECT post_commit_completed_at FROM hand_atomic_commits WHERE hand_id=o.hand_id)IS DISTINCT FROM saved OR(SELECT md5(post_commit_result::text)FROM hand_atomic_commits WHERE hand_id=o.hand_id)IS DISTINCT FROM saved_result_md5 OR fn_union_pnl_cash_outcome_accepted(o)IS DISTINCT FROM true THEN RAISE EXCEPTION 'future event replay changed original receipt';END IF;
 RAISE NOTICE 'PASS full actual event admits completed pending accounting in same transaction; replay preserves original completion/certificate';
END$after$;
ROLLBACK;
