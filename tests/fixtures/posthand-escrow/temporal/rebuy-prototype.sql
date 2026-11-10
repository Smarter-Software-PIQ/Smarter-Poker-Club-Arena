BEGIN;
DO $before$DECLARE k uuid;proof jsonb;BEGIN
 SELECT id INTO STRICT k FROM cash_participant_funding_receipts WHERE pending_addon_id IS NOT NULL;
 UPDATE chip_ledger SET category='rebuy'WHERE id=(SELECT source_ledger_id FROM cash_participant_funding_receipts WHERE id=k);
 UPDATE cash_participant_funding_receipts SET operation_kind='rebuy'WHERE id=k;
 SELECT fn_union_pnl_prove_posthand_escrow(table_id,hand_number)INTO proof FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 IF proof->>'status'IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'old rebuy unexpectedly proved';END IF;
 RAISE NOTICE 'BEFORE rebuy refused %',proof;
END$before$;
\i :prover_candidate
DO $after$DECLARE proof jsonb;BEGIN
 SELECT fn_union_pnl_prove_posthand_escrow(table_id,hand_number)INTO proof FROM union_pnl_cash_outcomes WHERE evidence->>'status'='blocked';
 IF proof->>'status'IS DISTINCT FROM 'proven' THEN RAISE EXCEPTION 'candidate rebuy unproved %',proof;END IF;
 RAISE NOTICE 'AFTER rebuy proven %',proof->>'resolution_kind';
END$after$;
ROLLBACK;
