CREATE FUNCTION pg_temp.add_pending(during_hand boolean,apply_amount numeric)RETURNS void LANGUAGE plpgsql AS $native$
DECLARE f cash_participant_funding_receipts;ap cash_funding_application_receipts;p cash_hand_provenance_receipts;
 m cash_hand_participant_manifests;leg chip_ledger;newleg chip_ledger;x jsonb;lin jsonb;payload jsonb;newissues jsonb;
 newfund uuid:=md5('native-extra-pending-fund')::uuid;newpending uuid:=md5('native-extra-pending-id')::uuid;newledger uuid:=md5('native-extra-pending-ledger')::uuid;
 refundledger uuid:=md5('native-extra-pending-refund')::uuid;t timestamptz;event union_pnl_inventory_events;
BEGIN
 SELECT *INTO STRICT f FROM cash_participant_funding_receipts WHERE pending_addon_id IS NOT NULL;
 SELECT *INTO STRICT ap FROM cash_funding_application_receipts WHERE funding_receipt_id=f.id;
 SELECT *INTO STRICT p FROM cash_hand_provenance_receipts WHERE status='uncertified';
 SELECT *INTO STRICT m FROM cash_hand_participant_manifests WHERE id=p.manifest_id;
 SELECT *INTO STRICT leg FROM chip_ledger WHERE id=f.source_ledger_id;
 t:=CASE WHEN during_hand THEN m.captured_at+interval '1 second'ELSE f.recorded_at+interval '1 millisecond'END;
 INSERT INTO chip_ledger SELECT(jsonb_populate_record(NULL::chip_ledger,to_jsonb(leg)||jsonb_build_object('id',newledger,'amount',50,'category','addon','created_at',t))).*;
 INSERT INTO cash_participant_funding_receipts SELECT(jsonb_populate_record(NULL::cash_participant_funding_receipts,to_jsonb(f)||jsonb_build_object(
  'id',newfund,'source_ledger_id',newledger,'pending_addon_id',newpending,'recorded_at',t,'operation_kind','addon','amount',50,'balance_before',1000,'balance_after',950))).*;
 INSERT INTO cash_funding_application_receipts SELECT(jsonb_populate_record(NULL::cash_funding_application_receipts,to_jsonb(ap)||jsonb_build_object(
  'pending_addon_id',newpending,'funding_receipt_id',newfund,'applied_at',ap.applied_at+interval '1 microsecond',
  'applied',apply_amount,'refunded',50-apply_amount,'applied_occupancy_id',CASE WHEN apply_amount=0 THEN NULL ELSE f.occupancy_id END))).*;
 IF NOT during_hand THEN
  SELECT value INTO STRICT x FROM jsonb_array_elements(p.participants)WHERE value->>'user_id'=f.user_id::text;
  lin:=fn_cash_original_funding_lineage(f.user_id,f.table_id,f.seat_id,f.occupancy_id,f.seat_joined_at,(x#>>'{funding_lineage,observed_at}')::timestamptz,false)
   ||jsonb_build_object('issues',jsonb_build_array('pending_funding_application_unproven','pending_funding_application_unproven'));
  newissues:=(SELECT jsonb_agg(CASE WHEN i->>'reason'='original_cash_move_lineage_unproven' THEN jsonb_set(i,'{details}',lin->'issues')ELSE i END ORDER BY ord)
   FROM jsonb_array_elements(p.issues)WITH ORDINALITY d(i,ord));
  UPDATE cash_hand_provenance_receipts SET issues=newissues,participants=(SELECT jsonb_agg(CASE WHEN value->>'user_id'=f.user_id::text THEN value||jsonb_build_object('funding_lineage',lin,'funding_receipts',lin->'funding_receipts')ELSE value END ORDER BY ord)
   FROM jsonb_array_elements(participants)WITH ORDINALITY d(value,ord))WHERE table_id=p.table_id AND hand_number=p.hand_number;
  UPDATE cash_hand_participant_manifests SET issues=newissues,participants=(SELECT jsonb_agg(CASE WHEN value->>'user_id'=f.user_id::text THEN value||jsonb_build_object('funding_lineage',lin,'funding_receipts',lin->'funding_receipts')ELSE value END ORDER BY ord)
   FROM jsonb_array_elements(participants)WITH ORDINALITY d(value,ord))WHERE id=m.id;
  UPDATE union_pnl_cash_outcomes SET evidence=jsonb_set(jsonb_set(evidence,'{issues}',jsonb_build_array('original_cash_funding_incomplete')||newissues||
   jsonb_build_array(jsonb_build_object('reason','participant_earning_ownership_receipt_invalid','user_id',f.user_id))),'{participants}',
   (SELECT jsonb_agg(CASE WHEN value->>'user_id'=f.user_id::text THEN jsonb_set(value,'{funding_receipt_ids}',
    (SELECT jsonb_agg(r->'id')FROM jsonb_array_elements(lin->'funding_receipts')r))ELSE value END ORDER BY ord)FROM jsonb_array_elements(evidence->'participants')WITH ORDINALITY d(value,ord)))
   WHERE table_id=p.table_id AND hand_number=p.hand_number;
 END IF;
 UPDATE hand_atomic_commits SET post_commit_payload=jsonb_set(post_commit_payload,'{pending_addons,ids}',post_commit_payload#>'{pending_addons,ids}'||jsonb_build_array(newpending)),
  post_commit_result=jsonb_set(post_commit_result,'{pending_addons}','2')WHERE table_id=p.table_id AND hand_number=p.hand_number;
 UPDATE hand_atomic_commits SET post_commit_payload_hash=encode(extensions.digest(convert_to(post_commit_payload::text,'UTF8'),'sha256'),'hex')WHERE table_id=p.table_id AND hand_number=p.hand_number;
 IF apply_amount>0 THEN
  SELECT *INTO STRICT event FROM union_pnl_inventory_events WHERE source_name='table_seats'AND row_id=f.seat_id AND transaction_id=ap.transaction_id;
  INSERT INTO union_pnl_inventory_events SELECT 9000000003,event.source_name,event.row_id,event.observed_at,event.transaction_id,'UPDATE',event.after_row,
   jsonb_set(event.after_row,'{stack}',to_jsonb((event.after_row->>'stack')::numeric+apply_amount));
 END IF;
 IF apply_amount<50 THEN
  INSERT INTO wallet_credit_idempotency VALUES('addon_refund:'||newpending::text,f.user_id,50-apply_amount,ap.applied_at);
  INSERT INTO chip_ledger SELECT(jsonb_populate_record(NULL::chip_ledger,to_jsonb(leg)||jsonb_build_object('id',refundledger,
   'from_type','table_stack','from_entity_id',f.table_id,'to_type','player_wallet','to_entity_id',f.user_id,
   'category','player_funding','amount',50-apply_amount,'created_at',ap.applied_at))).*;
  SELECT *INTO STRICT newleg FROM chip_ledger WHERE id=refundledger;
  INSERT INTO union_pnl_original_flows SELECT refundledger,ap.transaction_id,fr.observed_at,o.game_scope,to_jsonb(newleg)
   FROM union_pnl_transaction_frames fr CROSS JOIN union_pnl_cash_outcomes o WHERE fr.transaction_id=ap.transaction_id AND o.evidence->>'status'='blocked';
 END IF;
END$native$;
BEGIN;
SELECT pg_temp.prepare_split(1,'rebuy');
SELECT pg_temp.add_pending(true,0);
DO $before$BEGIN IF EXISTS(SELECT FROM union_pnl_cash_outcomes o WHERE o.evidence->>'status'='blocked'AND fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number)->>'status'='proven')THEN RAISE EXCEPTION 'old during-hand arrival admitted';END IF;RAISE NOTICE 'BEFORE during-hand second pending receipt refused';END$before$;
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
BEGIN;
SELECT pg_temp.prepare_split(1,'rebuy');
SELECT pg_temp.add_pending(false,50);
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
BEGIN;
DO $legacy$DECLARE o union_pnl_cash_outcomes;proof jsonb;sha text;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';proof:=fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number);
 sha:=encode(extensions.digest(convert_to(smarter_private.posthand_escrow_original_snapshot(o.table_id,o.hand_number)::text,'UTF8'),'sha256'),'hex');
 PERFORM fn_union_pnl_certify_posthand_escrow(o.table_id,o.hand_number,md5(proof::text),sha);
 CREATE TEMP TABLE native_legacy_saved AS SELECT proof original_proof,sha original_sha;
END$legacy$;
\i :prover_candidate
DO $legacy$DECLARE o union_pnl_cash_outcomes;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 IF fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number)IS DISTINCT FROM(SELECT original_proof FROM native_legacy_saved)
 OR(SELECT original_sha256 FROM smarter_private.posthand_escrow_certificates)IS DISTINCT FROM(SELECT original_sha FROM native_legacy_saved)THEN RAISE EXCEPTION 'legacy certificate proof or bytes changed';END IF;
 RAISE NOTICE 'PASS immutable old certificate proof and bytes unchanged';
END$legacy$;
ROLLBACK;
