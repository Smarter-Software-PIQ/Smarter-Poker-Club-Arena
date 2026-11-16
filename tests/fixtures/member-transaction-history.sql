INSERT INTO profiles(id,alias) SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Player '||i FROM generate_series(1,4)i;
INSERT INTO club_members SELECT '10000000-0000-4000-8000-000000000001',id FROM profiles;
INSERT INTO roles SELECT '10000000-0000-4000-8000-000000000001',id,CASE right(id::text,1) WHEN '1' THEN 'owner' WHEN '2' THEN 'agent' ELSE 'member' END FROM profiles;
INSERT INTO edges VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
INSERT INTO chip_transactions VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-11-16 01:00Z','agent_wallet_send',50,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',NULL,'{"source":"agent_wallet","destination":"player_wallet","op_id":"40000000-0000-4000-8000-000000000001"}');
INSERT INTO chip_ledger(id,club_id,created_at,category,amount,from_entity_id,to_entity_id,from_type,to_type,status,correlation_id)
VALUES
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-11-16 01:00Z','agent_send',50,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','agent_wallet','player_wallet','posted','40000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','2026-11-16 01:00Z','commission',100,'10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','club_treasury','agent_wallet','posted',NULL),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','2026-11-16 00:00Z','rakeback',25,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','agent_wallet','player_wallet','posted',NULL),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','2026-11-15 23:00Z','new_wallet_kind',12.34,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','agent_wallet','player_wallet','posted',NULL),
('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','2026-11-16 02:00Z','rakeback',999,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','agent_wallet','player_wallet','pending',NULL);
DO $$DECLARE c constant uuid:='10000000-0000-4000-8000-000000000001'; a constant uuid:='00000000-0000-4000-8000-000000000002'; p constant uuid:='00000000-0000-4000-8000-000000000003'; n int; first_row record;BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club',a); IF n<>4 THEN RAISE EXCEPTION 'expected 4 unique receipts and posted movements, got %',n;END IF;
 SELECT * INTO first_row FROM fn_member_transaction_history(c,'club',a,p_limit=>1);
 IF first_row.transaction_type<>'commission' OR first_row.amount<>100 OR first_row.to_user_id<>a OR first_row.metadata->>'destination'<>'agent_wallet' THEN RAISE EXCEPTION 'commission missing or malformed';END IF;
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club',a,p_before_at=>first_row.created_at,p_before_id=>first_row.id,p_before_source=>first_row.entry_source);IF n<>3 THEN RAISE EXCEPTION 'mixed source cursor lost rows: %',n;END IF;
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club',a,p_kind=>'member_agent_wallet',p_search=>'Player 3');IF n<>3 THEN RAISE EXCEPTION 'funding and opposite-party search before limit: %',n;END IF;
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club',a,p_from=>'2026-11-16 00:00Z',p_to=>'2026-11-16 01:00Z');IF n<>1 THEN RAISE EXCEPTION 'range filtering';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'downline',p);IF n<>3 THEN RAISE EXCEPTION 'agent downline reads all types';END IF;
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club','00000000-0000-4000-8000-000000000004');IF n<>0 THEN RAISE EXCEPTION 'agent escaped downline';END IF;
 PERFORM set_config('request.jwt.claim.sub',p::text,true);
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'mine',p);IF n<>3 THEN RAISE EXCEPTION 'ordinary player own history missing';END IF;
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club',a);IF n<>0 THEN RAISE EXCEPTION 'member escaped self';END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 SELECT count(*) INTO n FROM fn_member_transaction_history(c,'club',a);IF n<>0 THEN RAISE EXCEPTION 'anonymous history leak';END IF;
 IF has_function_privilege('anon','fn_member_transaction_history(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,text)','execute') THEN RAISE EXCEPTION 'anonymous grant';END IF;
END$$;
SELECT 'PASS all transaction kinds, incoming commission, outgoing rakeback, duplicate suppression, mixed-source cursor, filters, ordinary player and downline/self authorization';
-- A distinct wallet movement at the same instant and amount is not a mirror.
INSERT INTO chip_ledger SELECT '30000000-0000-4000-8000-000000000006',club_id,created_at,category,amount,from_entity_id,to_entity_id,'player_wallet',to_type,notes,metadata,status,idempotency_key,NULL,from_label FROM chip_ledger WHERE id='30000000-0000-4000-8000-000000000001';
INSERT INTO chip_transactions VALUES('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','2026-11-15 21:00Z','future_receipt_kind',17,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',NULL,'{}');
DO $$BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 IF NOT EXISTS(SELECT 1 FROM fn_member_transaction_history('10000000-0000-4000-8000-000000000001','mine','00000000-0000-4000-8000-000000000002') WHERE id='30000000-0000-4000-8000-000000000006') THEN RAISE EXCEPTION 'different funding wallet falsely deduplicated';END IF;
 IF NOT EXISTS(SELECT 1 FROM fn_member_transaction_history('10000000-0000-4000-8000-000000000001','mine','00000000-0000-4000-8000-000000000002') WHERE transaction_type='future_receipt_kind') THEN RAISE EXCEPTION 'receipt allowlist still present';END IF;
 BEGIN
  PERFORM * FROM fn_member_transaction_history('10000000-0000-4000-8000-000000000001','mine','00000000-0000-4000-8000-000000000002',p_before_source=>'invalid');
  RAISE EXCEPTION 'invalid cursor accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END$$;
SELECT 'PASS future receipt kinds, distinct same-time wallet movements, malformed cursor refusal';

-- A real promo writer uses separate clock timestamps for one operation.
INSERT INTO chip_transactions VALUES('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','2026-11-16 02:00:00.0166Z','promo_wallet_send',50,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',NULL,'{"source":"promo_wallet","destination":"player_wallet","op_id":"40000000-0000-4000-8000-000000000007"}');
INSERT INTO chip_ledger(id,club_id,created_at,category,amount,from_entity_id,to_entity_id,from_type,to_type,status,correlation_id)
VALUES('30000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','2026-11-16 02:00Z','promo_send',50,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','promo_wallet','player_wallet','posted','40000000-0000-4000-8000-000000000007');
INSERT INTO chip_ledger SELECT '30000000-0000-4000-8000-000000000008',club_id,created_at,category,amount,from_entity_id,to_entity_id,'agent_wallet',to_type,notes,metadata,status,idempotency_key,correlation_id,from_label FROM chip_ledger WHERE id='30000000-0000-4000-8000-000000000007';
DO $$BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 IF EXISTS(SELECT 1 FROM fn_member_transaction_history('10000000-0000-4000-8000-000000000001','mine','00000000-0000-4000-8000-000000000002') WHERE id='30000000-0000-4000-8000-000000000007') THEN RAISE EXCEPTION 'correlated millisecond promo mirror duplicated';END IF;
 IF NOT EXISTS(SELECT 1 FROM fn_member_transaction_history('10000000-0000-4000-8000-000000000001','mine','00000000-0000-4000-8000-000000000002') WHERE id='30000000-0000-4000-8000-000000000008') THEN RAISE EXCEPTION 'distinct correlated funding wallet hidden';END IF;
END$$;
SELECT 'PASS correlated millisecond receipts deduplicate only the matching wallet leg';
