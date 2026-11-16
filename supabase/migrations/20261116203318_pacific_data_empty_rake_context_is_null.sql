-- @live-proof: (SELECT count(*)=2 AND bool_and((length(p.prosrc)-length(replace(p.prosrc,$ctx$nullif(current_setting('ca.pacific_rake_record',true),'')::uuid$ctx$,'')))/length($ctx$nullif(current_setting('ca.pacific_rake_record',true),'')::uuid$ctx$)=2 AND position($raw$current_setting('ca.pacific_rake_record')::uuid$raw$ IN p.prosrc)=0) FROM pg_proc p WHERE p.oid IN(to_regprocedure('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'),to_regprocedure('public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)')))
-- A restored custom GUC is an empty string, not a UUID. PostgreSQL may
-- evaluate the indexed EXISTS cast before an adjacent boolean guard.
-- Normalize at every cast; preserve both aggregate writers and their ACLs.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
DO $context$
DECLARE r record;d text;old_cast text:='current_setting(''ca.pacific_rake_record'')::uuid';
 new_cast text:='nullif(current_setting(''ca.pacific_rake_record'',true),'''')::uuid';
BEGIN
 FOR r IN SELECT * FROM(VALUES
 ('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)','caf725b26e6115f60b80412183c61be0'),
 ('public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)','246735d855771ebedf6278a514a4bffe'))x(signature,preimage) LOOP
  d:=pg_get_functiondef(r.signature::regprocedure);
  IF md5(d)<>r.preimage THEN RAISE EXCEPTION 'PACIFIC_EMPTY_CONTEXT_PREIMAGE_CHANGED: %',r.signature; END IF;
  IF (length(d)-length(replace(d,old_cast,'')))/length(old_cast)<>2 THEN
   RAISE EXCEPTION 'PACIFIC_EMPTY_CONTEXT_CAST_CONTRACT_CHANGED: %',r.signature;
  END IF;
  d:=replace(d,old_cast,new_cast);
  IF position(old_cast IN d)>0 THEN RAISE EXCEPTION 'PACIFIC_EMPTY_CONTEXT_UNSAFE_CAST_REMAINED'; END IF;
  EXECUTE d;
 END LOOP;
END $context$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz) TO service_role;
-- The finite rebuild must include old in-flight callbacks and their failures.
-- Preserve the original attachment date and reporting-source boundaries.
UPDATE public.ca_club_data_pacific_state SET attachment_xid=pg_current_xact_id()::text::xid WHERE id=true;
COMMIT;
