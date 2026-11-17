-- Two distinct original add-on purchases were refunded together in one transaction.
-- Both 400-chip journal rows matched both genuine 400-chip application receipts;
-- DISTINCT erased the journal count, and refunds=1 rejected both returns.
-- Prove the exact multiset cardinality for the original transaction/table/club/
-- player/amount instead. A duplicate or missing ledger/application, reused funding
-- identity or wrong occupancy still refuses. No money, history or timeout changes.
-- Update both readers, the existing book admission pin and the complete inventory guard.
-- @live-proof: position('Exact original cash refund cardinality' in pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))>0 AND smarter_private.original_inventory_proof_sources_match() IS TRUE
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $refund_cardinality$
DECLARE
 guard regprocedure:='smarter_private.original_inventory_proof_sources_match()'::regprocedure;
 before_guard pg_proc%ROWTYPE; before_reader pg_proc%ROWTYPE; before_advance pg_proc%ROWTYPE;
 advance regprocedure:='public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure;
 new_full_hash text;
 r record; target regprocedure; d text; updated text; guard_def text; new_hash text;
 old_keys constant text:=$keys$  SELECT DISTINCT q.transaction_id,(q.l->>'table_id')::uuid table_id,
   (q.l->>'club_id')::uuid club_id,(q.l->>'to_entity_id')::uuid user_id,(q.l->>'amount')::numeric amount$keys$;
 new_keys constant text:=$keys$  SELECT q.transaction_id,(q.l->>'table_id')::uuid table_id,
   (q.l->>'club_id')::uuid club_id,(q.l->>'to_entity_id')::uuid user_id,(q.l->>'amount')::numeric amount,
   count(*) ledger_refunds$keys$;
 old_scope constant text:=$scope$   AND q.l->>'to_type'='player_wallet' AND q.l->>'category'='player_funding'
 ), rf_original_matches AS MATERIALIZED ($scope$;
 new_scope constant text:=$scope$   AND q.l->>'to_type'='player_wallet' AND q.l->>'category'='player_funding'
  GROUP BY q.transaction_id,(q.l->>'table_id')::uuid,(q.l->>'club_id')::uuid,
   (q.l->>'to_entity_id')::uuid,(q.l->>'amount')::numeric
 ), rf_original_matches AS MATERIALIZED ($scope$;
 old_count constant text:='k.amount,count(*) refunds,';
 new_count constant text:=$count$k.amount,
   -- Exact original cash refund cardinality; one proved owner group, not one receipt.
   CASE WHEN count(*)=k.ledger_refunds AND count(DISTINCT a.funding_receipt_id)=k.ledger_refunds
        THEN 1 ELSE 0 END refunds,$count$;
 old_group constant text:='GROUP BY k.transaction_id,k.table_id,k.club_id,k.user_id,k.amount';
 new_group constant text:='GROUP BY k.transaction_id,k.table_id,k.club_id,k.user_id,k.amount,k.ledger_refunds';
 a text; b text;
BEGIN
 SELECT * INTO STRICT before_guard FROM pg_proc WHERE oid=guard;
 IF md5(pg_get_functiondef(guard)) IS DISTINCT FROM 'a37ad1912ecb20d2a5cc59e89540cbb3'
 THEN RAISE EXCEPTION 'cash_refund_cardinality_guard_preimage_changed'; END IF;
 IF before_guard.proowner<>'postgres'::regrole OR before_guard.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 OR before_guard.provolatile<>'s' OR before_guard.prosecdef
 OR before_guard.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 THEN RAISE EXCEPTION 'cash_refund_cardinality_guard_authority_changed'; END IF;
 guard_def:=pg_get_functiondef(guard);
 FOR r IN SELECT * FROM (VALUES
  ('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)','b630a717dc1fc2edc177a896404c282d'),
  ('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','62faca4275f45085d03795b04a3f561a')) x(signature,old_hash)
 LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO STRICT before_reader FROM pg_proc WHERE oid=target;
  d:=pg_get_functiondef(target);
  IF md5(d) IS DISTINCT FROM r.old_hash THEN RAISE EXCEPTION 'cash_refund_cardinality_reader_preimage_changed'; END IF;
  IF before_reader.proowner<>'postgres'::regrole OR before_reader.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR before_reader.provolatile<>'s' OR NOT before_reader.prosecdef
  OR before_reader.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
  THEN RAISE EXCEPTION 'cash_refund_cardinality_reader_authority_changed'; END IF;
  FOR a,b IN SELECT * FROM (VALUES(old_keys,new_keys),(old_scope,new_scope),(old_count,new_count),(old_group,new_group)) anchors(old_text,new_text)
  LOOP
   IF (length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'cash_refund_cardinality_anchor_changed'; END IF;
   d:=replace(d,a,b);
  END LOOP;
  EXECUTE d;
  IF pg_get_functiondef(target) IS DISTINCT FROM d
  OR EXISTS(SELECT FROM pg_proc p WHERE oid=target AND (to_jsonb(p)-'prosrc') IS DISTINCT FROM (to_jsonb(before_reader)-'prosrc'))
  THEN RAISE EXCEPTION 'cash_refund_cardinality_reader_postimage_changed'; END IF;
  new_hash:=md5(pg_get_functiondef(target));
  IF r.old_hash='b630a717dc1fc2edc177a896404c282d' THEN new_full_hash:=new_hash; END IF;
  IF (length(guard_def)-length(replace(guard_def,r.old_hash,'')))/32<>1
  THEN RAISE EXCEPTION 'cash_refund_cardinality_guard_pin_changed'; END IF;
  guard_def:=replace(guard_def,r.old_hash,new_hash);
 END LOOP;
 -- The existing book owner admits the exact full-reader body before chunking.
 -- Move that reviewed pin in the same transaction; never abandon chunked proof.
 SELECT * INTO STRICT before_advance FROM pg_proc WHERE oid=advance;
 d:=pg_get_functiondef(advance);
 IF md5(d) IS DISTINCT FROM '276a23e5aaa880abab19217a33a8f69d'
 THEN RAISE EXCEPTION 'cash_refund_cardinality_advance_preimage_changed'; END IF;
 IF before_advance.proowner<>'postgres'::regrole OR before_advance.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
 OR before_advance.provolatile<>'v' OR before_advance.prosecdef
 OR before_advance.proconfig IS DISTINCT FROM ARRAY['search_path=public']
 THEN RAISE EXCEPTION 'cash_refund_cardinality_advance_authority_changed'; END IF;
 IF (length(d)-length(replace(d,'b630a717dc1fc2edc177a896404c282d','')))/32<>1
 THEN RAISE EXCEPTION 'cash_refund_cardinality_advance_pin_changed'; END IF;
 updated:=replace(d,'b630a717dc1fc2edc177a896404c282d',new_full_hash);
 EXECUTE updated;
 IF pg_get_functiondef(advance) IS DISTINCT FROM updated
 OR EXISTS(SELECT FROM pg_proc p WHERE oid=advance AND (to_jsonb(p)-'prosrc') IS DISTINCT FROM (to_jsonb(before_advance)-'prosrc'))
 THEN RAISE EXCEPTION 'cash_refund_cardinality_advance_postimage_changed'; END IF;
 IF (length(guard_def)-length(replace(guard_def,'276a23e5aaa880abab19217a33a8f69d','')))/32<>1
 THEN RAISE EXCEPTION 'cash_refund_cardinality_advance_guard_pin_changed'; END IF;
 guard_def:=replace(guard_def,'276a23e5aaa880abab19217a33a8f69d',md5(pg_get_functiondef(advance)));
 EXECUTE guard_def;
 IF pg_get_functiondef(guard) IS DISTINCT FROM guard_def
 OR EXISTS(SELECT FROM pg_proc p WHERE oid=guard AND (to_jsonb(p)-'prosrc') IS DISTINCT FROM (to_jsonb(before_guard)-'prosrc'))
 THEN RAISE EXCEPTION 'cash_refund_cardinality_guard_postimage_changed'; END IF;
END $refund_cardinality$;
COMMIT;
