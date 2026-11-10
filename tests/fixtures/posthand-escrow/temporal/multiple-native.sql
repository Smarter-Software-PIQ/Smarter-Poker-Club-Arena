BEGIN;
SELECT pg_temp.prepare_split(1,'rebuy');
DO $multiple$
DECLARE pending cash_participant_funding_receipts;owner cash_participant_funding_receipts;ap cash_funding_application_receipts;
 p cash_hand_provenance_receipts;part jsonb;existing jsonb;lin jsonb;ledger chip_ledger;newfund cash_participant_funding_receipts;
 new_fund uuid:=md5('native-second-pending-funding')::uuid;new_pending uuid:=md5('native-second-pending-id')::uuid;new_ledger uuid:=md5('native-second-pending-ledger')::uuid;
 updated_people jsonb;updated_issues jsonb;expected_outcome jsonb;payload jsonb;
BEGIN
 SELECT *INTO STRICT pending FROM cash_participant_funding_receipts WHERE pending_addon_id IS NOT NULL;
 SELECT *INTO STRICT ap FROM cash_funding_application_receipts WHERE funding_receipt_id=pending.id;
 SELECT *INTO STRICT p FROM cash_hand_provenance_receipts WHERE status='uncertified';
 SELECT x INTO STRICT part FROM jsonb_array_elements(p.participants)x WHERE x->>'user_id'<>pending.user_id::text;
 SELECT r.*INTO STRICT owner FROM cash_participant_funding_receipts r WHERE r.user_id=(part->>'user_id')::uuid AND operation_kind='buyin';
 SELECT *INTO STRICT ledger FROM chip_ledger WHERE id=pending.source_ledger_id;
 INSERT INTO chip_ledger SELECT(jsonb_populate_record(NULL::chip_ledger,to_jsonb(ledger)||jsonb_build_object('id',new_ledger,
  'from_entity_id',owner.user_id,'club_id',owner.funding_club_id,'amount',50))).*;
 INSERT INTO cash_participant_funding_receipts SELECT(jsonb_populate_record(NULL::cash_participant_funding_receipts,to_jsonb(pending)||jsonb_build_object(
  'id',new_fund,'pending_addon_id',new_pending,'user_id',owner.user_id,'seat_id',owner.seat_id,'occupancy_id',owner.occupancy_id,
  'seat_joined_at',owner.seat_joined_at,'account_entity_id',owner.user_id,'funding_club_id',owner.funding_club_id,'funding_union_id',owner.funding_union_id,
  'amount',50,'balance_before',1000,'balance_after',950,'source_ledger_id',new_ledger))).*;
 INSERT INTO cash_funding_application_receipts SELECT(jsonb_populate_record(NULL::cash_funding_application_receipts,to_jsonb(ap)||jsonb_build_object(
  'pending_addon_id',new_pending,'funding_receipt_id',new_fund,'original_occupancy_id',owner.occupancy_id,'applied_occupancy_id',owner.occupancy_id,'applied',50))).*;
 lin:=fn_cash_original_funding_lineage(owner.user_id,owner.table_id,owner.seat_id,owner.occupancy_id,owner.seat_joined_at,
  (part#>>'{funding_lineage,observed_at}')::timestamptz,false)||jsonb_build_object('issues',jsonb_build_array('pending_funding_application_unproven'));
 updated_people:=(SELECT jsonb_agg(CASE WHEN x->>'user_id'=owner.user_id::text THEN
  x||jsonb_build_object('funding_lineage',lin,'funding_receipts',lin->'funding_receipts')ELSE x END ORDER BY ord)
  FROM jsonb_array_elements(p.participants)WITH ORDINALITY d(x,ord));
 SELECT jsonb_agg(i ORDER BY ord,n)INTO updated_issues FROM jsonb_array_elements(updated_people)WITH ORDINALITY d(x,ord)
 CROSS JOIN LATERAL(VALUES(1,jsonb_build_object('reason','original_cash_move_lineage_unproven','details',jsonb_build_array('pending_funding_application_unproven'),'user_id',x->>'user_id')),
 (2,jsonb_build_object('reason','pending_funding_application_unproven','user_id',x->>'user_id')))r(n,i);
 UPDATE cash_hand_provenance_receipts SET participants=updated_people,issues=updated_issues WHERE table_id=p.table_id AND hand_number=p.hand_number;
 UPDATE cash_hand_participant_manifests SET participants=(SELECT jsonb_agg((SELECT z FROM jsonb_array_elements(updated_people)z WHERE z->>'user_id'=x->>'user_id')-'stack_after'ORDER BY ord)
  FROM jsonb_array_elements(participants)WITH ORDINALITY d(x,ord)),issues=updated_issues WHERE id=p.manifest_id;
 UPDATE union_pnl_cash_outcomes SET evidence=evidence||jsonb_build_object('issues',jsonb_build_array('original_cash_funding_incomplete')||updated_issues||
  (SELECT jsonb_agg(jsonb_build_object('reason','participant_earning_ownership_receipt_invalid','user_id',x->>'user_id')ORDER BY ord)FROM jsonb_array_elements(updated_people)WITH ORDINALITY d(x,ord)),
  'participants',(SELECT jsonb_agg(CASE WHEN x->>'user_id'=owner.user_id::text THEN x||jsonb_build_object('ownership_certified',false,'earning_club_id',NULL,
   'funding_receipt_ids',(SELECT jsonb_agg(r->'id')FROM jsonb_array_elements(lin->'funding_receipts')r))ELSE x END ORDER BY ord)
   FROM jsonb_array_elements(evidence->'participants')WITH ORDINALITY d(x,ord)))WHERE table_id=p.table_id AND hand_number=p.hand_number;
 UPDATE hand_atomic_commits SET post_commit_payload=jsonb_set(post_commit_payload,'{pending_addons,ids}',post_commit_payload#>'{pending_addons,ids}'||jsonb_build_array(new_pending)),
  post_commit_result=jsonb_set(post_commit_result,'{pending_addons}','2')WHERE table_id=p.table_id AND hand_number=p.hand_number;
 UPDATE hand_atomic_commits SET post_commit_payload_hash=encode(extensions.digest(convert_to(post_commit_payload::text,'UTF8'),'sha256'),'hex')WHERE table_id=p.table_id AND hand_number=p.hand_number;
 INSERT INTO union_pnl_inventory_events SELECT 900002,'table_seats',owner.seat_id,fr.observed_at,ap.transaction_id,'UPDATE',
  jsonb_build_object('id',owner.seat_id,'table_id',owner.table_id,'user_id',owner.user_id,'club_id',owner.funding_club_id,'occupancy_id',owner.occupancy_id,'joined_at',owner.seat_joined_at,'left_at',NULL,'stack',(part->>'stack_after')::numeric),
  jsonb_build_object('id',owner.seat_id,'table_id',owner.table_id,'user_id',owner.user_id,'club_id',owner.funding_club_id,'occupancy_id',owner.occupancy_id,'joined_at',owner.seat_joined_at,'left_at',NULL,'stack',(part->>'stack_after')::numeric+50)
  FROM union_pnl_transaction_frames fr WHERE fr.transaction_id=ap.transaction_id;
 IF fn_union_pnl_prove_posthand_escrow(p.table_id,p.hand_number)->>'status'IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'old multi participant unexpectedly proved';END IF;
 RAISE NOTICE 'BEFORE multiple affected pending participants refused';
END$multiple$;
\i :prover_candidate
SELECT pg_temp.assert_proven_and_certify();
ROLLBACK;
