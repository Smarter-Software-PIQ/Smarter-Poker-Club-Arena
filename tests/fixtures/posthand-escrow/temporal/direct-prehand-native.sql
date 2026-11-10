BEGIN;
SELECT pg_temp.prepare_split(1,'addon');
DO $initial$DECLARE o union_pnl_cash_outcomes;p cash_hand_provenance_receipts;part jsonb;f cash_participant_funding_receipts;queued cash_participant_funding_receipts;t timestamptz;BEGIN
 SELECT *INTO STRICT o FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 SELECT *INTO STRICT p FROM cash_hand_provenance_receipts WHERE table_id=o.table_id AND hand_number=o.hand_number;
 SELECT r.*INTO STRICT queued FROM cash_participant_funding_receipts r WHERE pending_addon_id IS NOT NULL;
 SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants)x WHERE x->>'user_id'=queued.user_id::text;
 SELECT r.*INTO STRICT f FROM cash_participant_funding_receipts r WHERE r.user_id=queued.user_id AND r.operation_kind='buyin';
 t:=queued.recorded_at-interval '1 second';
 DELETE FROM cash_hand_provenance_receipts WHERE table_id=o.table_id AND hand_number<o.hand_number;
 DELETE FROM union_pnl_cash_outcomes WHERE table_id=o.table_id AND hand_number<o.hand_number;
 UPDATE cash_participant_funding_receipts SET amount=(part->>'stack_before')::numeric,balance_before=1000,
  balance_after=1000-(part->>'stack_before')::numeric,recorded_at=t,transaction_id='900001'::xid8 WHERE id=f.id;
 UPDATE chip_ledger SET amount=(part->>'stack_before')::numeric,created_at=t WHERE id=f.source_ledger_id;
 INSERT INTO union_pnl_transaction_frames VALUES('900001'::xid8,t,NULL);
 INSERT INTO union_pnl_inventory_events VALUES(900001,'table_seats',f.seat_id,t,'900001'::xid8,'INSERT',NULL,
  jsonb_build_object('id',f.seat_id,'table_id',f.table_id,'user_id',f.user_id,'club_id',f.funding_club_id,
   'occupancy_id',f.occupancy_id,'joined_at',f.seat_joined_at,'left_at',NULL,'stack',(part->>'stack_before')::numeric));
 IF fn_union_pnl_prove_posthand_escrow(o.table_id,o.hand_number)->>'status'IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'old first occupancy unexpectedly proved';END IF;
 RAISE NOTICE 'BEFORE legitimate first occupancy refused by predecessor-only branch';
END$initial$;
DO $direct$DECLARE f cash_participant_funding_receipts;queued cash_participant_funding_receipts;leg chip_ledger;p cash_hand_provenance_receipts;part jsonb;lin jsonb;e union_pnl_inventory_events;t timestamptz;
BEGIN
 SELECT *INTO STRICT queued FROM cash_participant_funding_receipts WHERE pending_addon_id IS NOT NULL;
 SELECT *INTO STRICT f FROM cash_participant_funding_receipts WHERE user_id=queued.user_id AND operation_kind='buyin';
 SELECT *INTO STRICT leg FROM chip_ledger WHERE id=f.source_ledger_id;
 SELECT *INTO STRICT p FROM cash_hand_provenance_receipts WHERE status='uncertified';
 SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants)x WHERE x->>'user_id'=f.user_id::text;
 t:=f.recorded_at+interval '500 milliseconds';
 UPDATE cash_participant_funding_receipts SET amount=amount-50,balance_after=balance_after+50 WHERE id=f.id;
 UPDATE chip_ledger SET amount=amount-50 WHERE id=f.source_ledger_id;
 UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{stack}',to_jsonb((after_row->>'stack')::numeric-50))WHERE event_id=900001;
 INSERT INTO chip_ledger SELECT(jsonb_populate_record(NULL::chip_ledger,to_jsonb(leg)||jsonb_build_object('id',md5('native-direct-prehand-leg')::uuid,'category','addon','amount',50,'created_at',t))).*;
 INSERT INTO cash_participant_funding_receipts SELECT(jsonb_populate_record(NULL::cash_participant_funding_receipts,to_jsonb(f)||jsonb_build_object('id',md5('native-direct-prehand-funding')::uuid,'source_ledger_id',md5('native-direct-prehand-leg')::uuid,'operation_kind','addon','amount',50,'balance_before',1000,'balance_after',950,'transaction_id','900009','recorded_at',t))).*;
 INSERT INTO union_pnl_transaction_frames VALUES('900009'::xid8,t,NULL);
 SELECT *INTO STRICT e FROM union_pnl_inventory_events WHERE event_id=900001;
 INSERT INTO union_pnl_inventory_events VALUES(900009,'table_seats',f.seat_id,t,'900009'::xid8,'UPDATE',e.after_row,jsonb_set(e.after_row,'{stack}',to_jsonb((e.after_row->>'stack')::numeric+50)));
 lin:=fn_cash_original_funding_lineage(f.user_id,f.table_id,f.seat_id,f.occupancy_id,f.seat_joined_at,(part#>>'{funding_lineage,observed_at}')::timestamptz,false)||jsonb_build_object('issues',part#>'{funding_lineage,issues}');
 UPDATE cash_hand_provenance_receipts SET participants=(SELECT jsonb_agg(CASE WHEN x->>'user_id'=f.user_id::text THEN x||jsonb_build_object('funding_lineage',lin,'funding_receipts',lin->'funding_receipts')ELSE x END ORDER BY ord)FROM jsonb_array_elements(participants)WITH ORDINALITY d(x,ord))WHERE table_id=p.table_id AND hand_number=p.hand_number;
 UPDATE cash_hand_participant_manifests SET participants=(SELECT jsonb_agg(CASE WHEN x->>'user_id'=f.user_id::text THEN x||jsonb_build_object('funding_lineage',lin,'funding_receipts',lin->'funding_receipts')ELSE x END ORDER BY ord)FROM jsonb_array_elements(participants)WITH ORDINALITY d(x,ord))WHERE id=p.manifest_id;
 UPDATE union_pnl_cash_outcomes SET evidence=jsonb_set(evidence,'{participants}',(SELECT jsonb_agg(CASE WHEN x->>'user_id'=f.user_id::text THEN jsonb_set(x,'{funding_receipt_ids}',(SELECT jsonb_agg(r->'id')FROM jsonb_array_elements(lin->'funding_receipts')r))ELSE x END ORDER BY ord)FROM jsonb_array_elements(evidence->'participants')WITH ORDINALITY d(x,ord)))WHERE table_id=p.table_id AND hand_number=p.hand_number;
END$direct$;
\i :prover_candidate
SELECT pg_temp.must_refuse('direct prehand forged event',$bad$UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{occupancy_id}',to_jsonb(md5('wrong-direct-occupancy')::uuid::text))WHERE event_id=900009$bad$);
SELECT pg_temp.must_refuse('direct prehand wrong amount',$bad$UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{stack}',to_jsonb((after_row->>'stack')::numeric+1))WHERE event_id=900009$bad$);
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
