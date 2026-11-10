SET timezone='UTC';
CREATE FUNCTION pg_temp.prepare_split(applied_fraction numeric,kind text)RETURNS void LANGUAGE plpgsql AS $native$
DECLARE f cash_participant_funding_receipts;ap cash_funding_application_receipts;leg chip_ledger;ref chip_ledger;refund numeric;new_id uuid:=md5('native-posthand-refund')::uuid;
BEGIN
 SELECT r.*INTO STRICT f FROM cash_participant_funding_receipts r WHERE r.pending_addon_id IS NOT NULL;
 SELECT *INTO STRICT ap FROM cash_funding_application_receipts WHERE funding_receipt_id=f.id;
 SELECT *INTO STRICT leg FROM chip_ledger WHERE id=f.source_ledger_id;
 UPDATE chip_ledger SET category=kind WHERE id=leg.id;
 UPDATE cash_participant_funding_receipts SET operation_kind=kind WHERE id=f.id;
 refund:=f.amount-round(f.amount*applied_fraction,2);
 UPDATE cash_funding_application_receipts SET applied=f.amount-refund,refunded=refund,
  applied_occupancy_id=CASE WHEN applied_fraction=0 THEN NULL ELSE f.occupancy_id END WHERE funding_receipt_id=f.id;
 UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{stack}',
  to_jsonb((before_row->>'stack')::numeric+f.amount-refund))WHERE source_name='table_seats'AND row_id=f.seat_id AND transaction_id=ap.transaction_id;
 IF refund>0 THEN
  INSERT INTO wallet_credit_idempotency VALUES('addon_refund:'||f.pending_addon_id::text,f.user_id,refund,ap.applied_at);
  INSERT INTO chip_ledger SELECT(jsonb_populate_record(NULL::chip_ledger,to_jsonb(leg)||jsonb_build_object(
   'id',new_id,'from_type','table_stack','from_entity_id',f.table_id,'to_type','player_wallet','to_entity_id',f.user_id,
   'category','player_funding','amount',refund,'created_at',ap.applied_at))).*;
  SELECT *INTO STRICT ref FROM chip_ledger WHERE id=new_id;
  INSERT INTO union_pnl_original_flows SELECT new_id,ap.transaction_id,fr.observed_at,o.game_scope,to_jsonb(ref)
   FROM union_pnl_transaction_frames fr CROSS JOIN union_pnl_cash_outcomes o
   WHERE fr.transaction_id=ap.transaction_id AND o.evidence->>'status'='blocked';
 END IF;
END$native$;
CREATE FUNCTION pg_temp.assert_proven_and_certify()RETURNS void LANGUAGE plpgsql AS $native$
DECLARE o union_pnl_cash_outcomes;proof jsonb;sha text;raw text;people jsonb;
BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 raw:=md5(o.evidence::text);proof:=fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number);
 IF proof->>'status'IS DISTINCT FROM 'proven' THEN
 RAISE NOTICE 'REFUND DIAG %',(SELECT jsonb_agg(jsonb_build_object('ledger',to_jsonb(leg),'flow_count',(SELECT count(*)FROM union_pnl_original_flows fl WHERE fl.ledger_id=leg.id),'flows',(SELECT jsonb_agg(jsonb_build_object('transaction',fl.transaction_id::text,'snapshot_equal',fl.ledger_snapshot=to_jsonb(leg),'recognized',fl.recognized_at))FROM union_pnl_original_flows fl WHERE fl.ledger_id=leg.id)))FROM chip_ledger leg WHERE leg.category='player_funding');
 RAISE EXCEPTION 'candidate split unproved %',proof;END IF;
 sha:=encode(extensions.digest(convert_to(smarter_private.posthand_escrow_original_snapshot(o.table_id,o.hand_number)::text,'UTF8'),'sha256'),'hex');
 PERFORM fn_union_pnl_certify_posthand_escrow(o.table_id,o.hand_number,md5(proof::text),sha);
 IF fn_union_pnl_cash_outcome_accepted(o)IS DISTINCT FROM true THEN RAISE EXCEPTION 'new certificate not consumed';END IF;
 IF(SELECT md5(evidence::text)FROM union_pnl_cash_outcomes WHERE table_id=o.table_id AND hand_number=o.hand_number)IS DISTINCT FROM raw THEN RAISE EXCEPTION 'original outcome changed';END IF;
 SELECT jsonb_agg(x->'poker_delta'ORDER BY x->>'user_id')INTO people FROM jsonb_array_elements(proof->'participants')x;
 IF(SELECT sum((x->>'poker_delta')::numeric)FROM jsonb_array_elements(proof->'participants')x)IS DISTINCT FROM -3.75::numeric THEN RAISE EXCEPTION 'pending money became poker winnings';END IF;
 DELETE FROM hand_atomic_commits WHERE table_id=o.table_id AND hand_number=o.hand_number;
 IF fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number)IS DISTINCT FROM proof THEN RAISE EXCEPTION 'retained new proof changed after raw removal';END IF;
 RAISE NOTICE 'PASS split certificate consumed, poker deltas unchanged, original outcome preserved, retained proof exact without raw atomic';
END$native$;
BEGIN;
SELECT pg_temp.prepare_split(.5,'rebuy');
DO $before$BEGIN IF EXISTS(SELECT FROM union_pnl_cash_outcomes o WHERE o.evidence->>'status'='blocked'AND fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number)->>'status'='proven')THEN RAISE EXCEPTION 'old partial rebuy admitted';END IF;RAISE NOTICE 'BEFORE partial rebuy refused';END$before$;
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
BEGIN;
SELECT pg_temp.prepare_split(0,'rebuy');
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
BEGIN;
SELECT pg_temp.prepare_split(.5,'addon');
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
