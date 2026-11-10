BEGIN;
INSERT INTO public.cash_hand_provenance_receipts(table_id,hand_number,accepted_at,participants,accepted_request)
SELECT md5('native-first')::uuid,g,'2026-10-01Z',jsonb_build_array(jsonb_build_object('occupancy_id',md5('old-'||g)::text)),to_jsonb(repeat(md5(g::text),30))FROM generate_series(1,1000)g;
INSERT INTO public.cash_hand_provenance_receipts(table_id,hand_number,accepted_at,participants,accepted_request)
SELECT md5('native-first')::uuid,g,'2026-10-06Z',jsonb_build_array(jsonb_build_object('occupancy_id',md5('future-'||g)::text)),to_jsonb(repeat(md5(g::text),30))FROM generate_series(1001,2000)g;
INSERT INTO public.cash_hand_provenance_receipts(table_id,hand_number,accepted_at,participants,accepted_request)
SELECT md5('other-table-'||(g%99))::uuid,g,'2026-10-06Z',jsonb_build_array(jsonb_build_object('occupancy_id',md5('other-'||g)::text)),to_jsonb(repeat(md5(g::text),30))FROM generate_series(2001,12000)g;
CREATE INDEX native_lookup_time ON public.cash_hand_provenance_receipts(accepted_at,table_id,hand_number);
CREATE INDEX cash_hand_provenance_table_time_cover ON public.cash_hand_provenance_receipts(table_id,accepted_at,hand_number);
ANALYZE public.cash_hand_provenance_receipts;
PREPARE native_lookup_query(uuid,bigint,timestamptz,uuid)AS  WITH original_keys AS MATERIALIZED(
  SELECT pr.hand_number FROM public.cash_hand_provenance_receipts pr
   WHERE pr.table_id=$1 AND pr.hand_number<$2 AND pr.accepted_at>=$3
 ), ordered_keys AS(SELECT k.hand_number FROM original_keys k ORDER BY k.hand_number DESC OFFSET 0)
 SELECT original.* FROM ordered_keys k CROSS JOIN LATERAL(
  SELECT pr.*FROM public.cash_hand_provenance_receipts pr WHERE pr.table_id=$1 AND pr.hand_number=k.hand_number
   AND pr.participants @>jsonb_build_array(jsonb_build_object('occupancy_id',$4::text))OFFSET 0
 )original ORDER BY k.hand_number DESC LIMIT 1
;
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,TIMING OFF)EXECUTE native_lookup_query(md5('native-first')::uuid,1001,'2026-10-05Z',md5('new-occupancy')::uuid);
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,TIMING OFF)EXECUTE native_lookup_query(md5('native-first')::uuid,1001,'2026-10-05Z',md5('new-occupancy')::uuid);
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,TIMING OFF)SELECT *FROM smarter_private.original_cash_hand_predecessor(md5('native-first')::uuid,1001,'2026-10-05Z',md5('new-occupancy')::uuid);
DO $first$DECLARE n bigint;BEGIN
 SELECT count(*)INTO n FROM smarter_private.original_cash_hand_predecessor(md5('native-first')::uuid,1001,'2026-10-05Z',md5('new-occupancy')::uuid);
 IF n<>0 OR current_setting('plan_cache_mode')<>'force_custom_plan' THEN RAISE EXCEPTION 'first occupancy/mode restore failed';END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)'::regprocedure AND proconfig @>ARRAY['plan_cache_mode=force_generic_plan','search_path=pg_catalog, public']AND provolatile='s'AND NOT prosecdef AND proacl='{postgres=X/postgres}'::aclitem[])THEN RAISE EXCEPTION 'private lookup metadata changed';END IF;
END$first$;
UPDATE cash_hand_provenance_receipts SET accepted_at='2026-10-05Z',participants=jsonb_build_array(jsonb_build_object('occupancy_id',md5('new-occupancy')::uuid::text))WHERE table_id=md5('native-first')::uuid AND hand_number=499;
UPDATE cash_hand_provenance_receipts SET accepted_at='2026-10-07Z',participants=jsonb_build_array(jsonb_build_object('occupancy_id',md5('new-occupancy')::uuid::text))WHERE table_id=md5('native-first')::uuid AND hand_number=500;
DO $causal$DECLARE h bigint;BEGIN SELECT hand_number INTO h FROM smarter_private.original_cash_hand_predecessor(md5('native-first')::uuid,1001,'2026-10-05Z',md5('new-occupancy')::uuid);
 IF h IS DISTINCT FROM 500::bigint THEN RAISE EXCEPTION 'future accepted nearest hidden';END IF;
END$causal$;
-- Fault the actual helper's backing relation without changing its source.
CREATE FUNCTION pg_temp.lookup_fault(jsonb)RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native_lookup_fault';END$$;
ALTER TABLE public.cash_hand_provenance_receipts RENAME TO native_lookup_saved;
DO $view$DECLARE cols text;BEGIN SELECT string_agg(CASE WHEN a.attname='participants'THEN 'pg_temp.lookup_fault(participants) AS participants'ELSE quote_ident(a.attname)END,','ORDER BY a.attnum)INTO cols FROM pg_attribute a WHERE a.attrelid='public.native_lookup_saved'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 EXECUTE 'CREATE VIEW public.cash_hand_provenance_receipts AS SELECT '||cols||' FROM public.native_lookup_saved';END$view$;
DO $fault$BEGIN
 BEGIN PERFORM *FROM smarter_private.original_cash_hand_predecessor(md5('native-first')::uuid,1001,'2026-10-05Z',md5('new-occupancy')::uuid);RAISE EXCEPTION 'fault not reached';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'native_lookup_fault'THEN RAISE;END IF;END;
 IF current_setting('plan_cache_mode')<>'force_custom_plan'THEN RAISE EXCEPTION 'error leaked plan cache mode';END IF;
 RAISE NOTICE 'PASS actual private helper bounded generic lookup, first occupancy, future accepted nearest, ACL and caller setting restoration on return/error';
END$fault$;
ROLLBACK;
