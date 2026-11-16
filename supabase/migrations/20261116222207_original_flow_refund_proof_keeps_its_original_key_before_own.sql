-- Generic SQL-function plans were decorrelating the refund proof: every refund
-- entitlement's financial owner could be evaluated before its original ledger
-- key was matched. The two-hour book visit then exhausted its four-minute budget
-- even with both receipt indexes valid. Retain the original-key correlation
-- boundary, as the adjacent original cash receipt probes already do. OFFSET 0
-- deliberately prevents flattening this lateral proof; it does not limit rows,
-- suppress duplicates, change evidence, or increase any execution budget.
--
-- Move only the reviewed reader pin in the existing complete inventory guard.
-- Its normal generation changes naturally; original proof receipts stay intact.
-- @live-proof: position('Original refund key correlation boundary' in pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))>0 AND smarter_private.original_inventory_proof_sources_match() IS TRUE
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $original_key$
DECLARE
 reader regprocedure:='smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure;
 guard regprocedure:='smarter_private.original_inventory_proof_sources_match()'::regprocedure;
 before_reader pg_proc%ROWTYPE; before_guard pg_proc%ROWTYPE;
 d text; updated text; new_hash text;
 old_hash constant text:='aa5e609c6fa07876d93db86d7aa3a342';
 anchor constant text:=$old$     ELSE false END
  ) te ON true$old$;
 replacement constant text:=$new$     ELSE false END
   -- Original refund key correlation boundary: prove only this ledger's owners.
   OFFSET 0
  ) te ON true$new$;
BEGIN
 SELECT * INTO STRICT before_reader FROM pg_proc WHERE oid=reader;
 SELECT * INTO STRICT before_guard FROM pg_proc WHERE oid=guard;
 IF md5(pg_get_functiondef(reader)) IS DISTINCT FROM old_hash
 OR md5(pg_get_functiondef(guard)) IS DISTINCT FROM '2115cc50e91b586e152baa0ba6395b58'
 THEN RAISE EXCEPTION 'original_refund_key_preimage_changed'; END IF;
 IF before_reader.proowner<>'postgres'::regrole OR before_guard.proowner<>'postgres'::regrole
 OR before_reader.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 OR before_guard.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
 OR before_reader.provolatile<>'s' OR before_guard.provolatile<>'s'
 OR NOT before_reader.prosecdef OR before_guard.prosecdef
 OR before_reader.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
 OR before_guard.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 THEN RAISE EXCEPTION 'original_refund_key_authority_changed'; END IF;
 d:=pg_get_functiondef(reader);
 IF (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'original_refund_key_anchor_not_unique';
 END IF;
 updated:=replace(d,anchor,replacement);
 EXECUTE updated;
 IF pg_get_functiondef(reader) IS DISTINCT FROM updated THEN
  RAISE EXCEPTION 'original_refund_key_reader_postimage_changed';
 END IF;
 new_hash:=md5(pg_get_functiondef(reader));
 d:=pg_get_functiondef(guard);
 IF (length(d)-length(replace(d,old_hash,'')))/length(old_hash)<>1 THEN
  RAISE EXCEPTION 'original_refund_key_guard_pin_not_unique';
 END IF;
 updated:=replace(d,old_hash,new_hash);
 EXECUTE updated;
 IF pg_get_functiondef(guard) IS DISTINCT FROM updated
 OR EXISTS(SELECT FROM pg_proc WHERE strpos(prosrc,old_hash)>0)
 THEN RAISE EXCEPTION 'original_refund_key_guard_postimage_changed'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN (VALUES
   (reader::oid,to_jsonb(before_reader)),(guard::oid,to_jsonb(before_guard))) b(oid,metadata) ON p.oid=b.oid
   WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM (b.metadata-'prosrc')) THEN
  RAISE EXCEPTION 'original_refund_key_metadata_changed';
 END IF;
END $original_key$;
COMMIT;
