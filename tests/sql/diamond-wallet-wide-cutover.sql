-- Every ABI, permission, downstream dependency and reconciliation row survives
-- the wider source types. Compare before any additional fixture mutations.
\set ON_ERROR_STOP on
DO $probe$
DECLARE before_row public.test_diamond_recon_before; after_columns jsonb; changes bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM public.test_diamond_storage_before s WHERE pg_relation_filenode(s.oid) IS DISTINCT FROM s.filenode) THEN RAISE EXCEPTION 'Ledger heap or preserved index rewritten'; END IF;
 FOR before_row IN SELECT * FROM public.test_diamond_recon_before LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=before_row.oid AND c.relname=before_row.relname
   AND c.relowner=before_row.relowner AND c.relacl IS NOT DISTINCT FROM before_row.relacl AND c.reloptions IS NOT DISTINCT FROM before_row.reloptions
   AND obj_description(c.oid,'pg_class') IS NOT DISTINCT FROM before_row.comment) THEN RAISE EXCEPTION 'Changed metadata or OID on %',before_row.relname; END IF;
  SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attacl,col_description(a.attrelid,a.attnum)) ORDER BY a.attnum)
   INTO after_columns FROM pg_attribute a WHERE a.attrelid=before_row.oid AND a.attnum>0 AND NOT a.attisdropped;
  IF after_columns IS DISTINCT FROM before_row.columns THEN RAISE EXCEPTION 'Changed column identity, type or grants on %',before_row.relname; END IF;
 END LOOP;
 WITH after_rows AS (
  SELECT 'date'::text name,to_jsonb(d) entry FROM public.trivia_ledger_recon_date d UNION ALL SELECT 'user',to_jsonb(u) FROM public.trivia_ledger_recon_user u
  UNION ALL SELECT 'reference',to_jsonb(r) FROM public.trivia_ledger_recon_reference r
 ), changed AS ((TABLE public.test_diamond_recon_rows EXCEPT ALL TABLE after_rows) UNION ALL (TABLE after_rows EXCEPT ALL TABLE public.test_diamond_recon_rows))
 SELECT count(*) INTO changes FROM changed;
 IF changes<>0 THEN RAISE EXCEPTION 'Reconciliation returned different rows after migration'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wheel_journal_copy_progress WHERE id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Copy receipt lost'; END IF;
END $probe$;

-- The existing archive trigger uses the wide amount and the same journal id.
-- Only the synthetic credit is closed and the entire test is rolled back.
BEGIN;
SET LOCAL "request.jwt.claims"='{"role":"service_role"}';
DO $archive$
DECLARE player constant uuid:='d1000000-0000-4000-8000-000000000005'; owner_id constant uuid:='d1000000-0000-4000-8000-000000000002';
 id_to_archive uuid; after_balance bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN RAISE EXCEPTION 'Private fixture required'; END IF;
 PERFORM public.add_diamonds_to_balance(player,3000000000::bigint,'transfer','Wide archive fixture','fixture:wide-archive',owner_id);
 SELECT id,balance_after INTO STRICT id_to_archive,after_balance FROM public.diamond_transactions WHERE reference_id='fixture:wide-archive' AND amount=3000000000;
 PERFORM set_config('app.ledger_maintenance','private PG17 wide archive qualification',true);
 DELETE FROM public.diamond_transactions WHERE id=id_to_archive;
 IF NOT EXISTS(SELECT 1 FROM public.ca_diamond_journal_archive WHERE id=id_to_archive AND amount=3000000000 AND balance_after=after_balance) THEN RAISE EXCEPTION 'Wide archive lost economic values'; END IF;
END $archive$;
ROLLBACK;
