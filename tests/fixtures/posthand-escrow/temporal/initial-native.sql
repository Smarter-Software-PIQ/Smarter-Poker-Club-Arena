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
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
