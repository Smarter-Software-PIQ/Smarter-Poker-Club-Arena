CREATE FUNCTION pg_temp.must_refuse(label text,mutation text)RETURNS void LANGUAGE plpgsql AS $native$
DECLARE o union_pnl_cash_outcomes;proof jsonb;
BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 BEGIN
  EXECUTE mutation;proof:=fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number);
  IF proof->>'status'IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'negative admitted %: %',label,proof;END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback native counterexample';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 IF fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number)->>'status'IS DISTINCT FROM 'proven' THEN RAISE EXCEPTION 'negative rollback changed baseline %',label;END IF;
 RAISE NOTICE 'PASS refusal: %',label;
END$native$;
BEGIN;
SELECT pg_temp.prepare_split(.5,'rebuy');
\i :prover_candidate
SELECT pg_temp.must_refuse('predecessor atomic request stacks',$mut$UPDATE cash_hand_provenance_receipts SET atomic_receipt=jsonb_set(atomic_receipt,'{stack_result,request,stacks}',(SELECT jsonb_agg(jsonb_set(x,'{stack}',to_jsonb((x->>'stack')::numeric+1)))FROM jsonb_array_elements(atomic_receipt#>'{stack_result,request,stacks}')x))WHERE status<>'uncertified'$mut$);
SELECT pg_temp.must_refuse('refund identity owner',$mut$UPDATE wallet_credit_idempotency SET user_id=md5('wrong-owner')::uuid$mut$);
SELECT pg_temp.must_refuse('refund identity amount',$mut$UPDATE wallet_credit_idempotency SET amount=amount+1$mut$);
SELECT pg_temp.must_refuse('missing posted refund leg',$mut$DELETE FROM chip_ledger WHERE category='player_funding'$mut$);
SELECT pg_temp.must_refuse('refund original transaction',$mut$UPDATE union_pnl_original_flows SET transaction_id='99999999'::xid8$mut$);
SELECT pg_temp.must_refuse('refund original snapshot',$mut$UPDATE union_pnl_original_flows SET ledger_snapshot=jsonb_set(ledger_snapshot,'{club_id}',to_jsonb(md5('wrong-club')::text))$mut$);
SELECT pg_temp.must_refuse('refund essential captured key',$mut$UPDATE union_pnl_original_flows SET ledger_snapshot=ledger_snapshot-'amount'$mut$);
SELECT pg_temp.must_refuse('applied felt delta',$mut$UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{stack}',to_jsonb((after_row->>'stack')::numeric+.01))$mut$);
SELECT pg_temp.must_refuse('applied occupancy',$mut$UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{occupancy_id}',to_jsonb(md5('wrong-occupancy')::text))$mut$);
SELECT pg_temp.must_refuse('application before signed hand',$mut$UPDATE cash_funding_application_receipts SET applied_at=(SELECT accepted_at FROM cash_hand_provenance_receipts WHERE status='uncertified')$mut$);
SELECT pg_temp.must_refuse('application after completed event',$mut$UPDATE cash_funding_application_receipts SET applied_at=(SELECT post_commit_completed_at+interval '1 second'FROM hand_atomic_commits WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified'))$mut$);
SELECT pg_temp.must_refuse('duplicate sealed pending ID',$mut$
 UPDATE hand_atomic_commits SET post_commit_payload=jsonb_set(post_commit_payload,'{pending_addons,ids}',(post_commit_payload#>'{pending_addons,ids}')||(post_commit_payload#>'{pending_addons,ids}'))WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
 UPDATE hand_atomic_commits SET post_commit_payload_hash=encode(extensions.digest(convert_to(post_commit_payload::text,'UTF8'),'sha256'),'hex')WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified')
$mut$);
SELECT pg_temp.must_refuse('missing sealed pending set',$mut$
 UPDATE hand_atomic_commits SET post_commit_payload=jsonb_set(post_commit_payload,'{pending_addons,ids}','[]')WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified');
 UPDATE hand_atomic_commits SET post_commit_payload_hash=encode(extensions.digest(convert_to(post_commit_payload::text,'UTF8'),'sha256'),'hex')WHERE hand_id=(SELECT hand_id FROM cash_hand_provenance_receipts WHERE status='uncertified')
$mut$);
SELECT pg_temp.must_refuse('duplicate refund rail multiplicity',$mut$
 INSERT INTO chip_ledger SELECT(jsonb_populate_record(NULL::chip_ledger,to_jsonb(l)||jsonb_build_object('id',md5('duplicate-native-refund')::uuid))).*FROM chip_ledger l WHERE category='player_funding';
 INSERT INTO union_pnl_original_flows SELECT l.id,f.transaction_id,f.recognized_at,f.game_scope,to_jsonb(l)FROM chip_ledger l CROSS JOIN union_pnl_original_flows f WHERE l.id=md5('duplicate-native-refund')::uuid
$mut$);
-- An equal timestamp with a different timezone spelling is the same captured
-- instant. Every other captured ledger key still has to be byte-identical.
UPDATE union_pnl_original_flows SET ledger_snapshot=jsonb_set(ledger_snapshot,'{created_at}',to_jsonb(to_char((ledger_snapshot->>'created_at')::timestamptz AT TIME ZONE 'America/Chicago','YYYY-MM-DD"T"HH24:MI:SS.US')||'-05:00'));
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
BEGIN;
SELECT pg_temp.prepare_split(1,'rebuy');
SELECT pg_temp.add_pending(false,50);
\i :prover_candidate
SELECT pg_temp.must_refuse('same-transaction seat chain order',$mut$UPDATE union_pnl_inventory_events SET event_id=900003 WHERE event_id=9000000003$mut$);
ROLLBACK;
