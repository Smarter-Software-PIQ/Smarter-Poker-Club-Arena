-- Reserved 20261118015251. Prepare private transaction-scoped evidence for
-- automated MTT entries. Only the subsequent activation changes an existing
-- public or financial authority. The helper owners are never executable
-- by API roles. Partial installation therefore leaves attendance unchanged.
-- @live-proof: (SELECT count(*)=4 AND bool_and(md5(pg_get_functiondef(p.oid))=v.digest AND p.proowner='postgres'::regrole AND NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,p.oid,'EXECUTE'))) FROM (VALUES ('smarter_private.acquire_mtt_entry_lane(uuid,uuid,uuid)','5b53ed9a10de11de610c27cb1e626f86'),('smarter_private.is_background_mtt_admission(uuid,uuid)','b78fb15976b5071ac4cbb3341f9b3382'),('smarter_private.owns_background_mtt_admission(uuid,uuid)','18e92749d21ef81582b7de8f6ec581bd'),('smarter_private.purchase_mtt_to_attendance_target(uuid,uuid,boolean,bigint)','ebe73512d4f8f90537ceaf32dedb8493')) v(name,digest) JOIN pg_proc p ON p.oid=to_regprocedure(v.name)) AND EXISTS(SELECT FROM pg_class c WHERE c.oid=to_regclass('smarter_private.background_mtt_admission') AND c.relpersistence='u' AND c.relrowsecurity AND NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_table_privilege(r,c.oid,'INSERT')))
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

CREATE UNLOGGED TABLE smarter_private.background_mtt_admission (
  writer_xid xid8 PRIMARY KEY,
  tournament_id uuid NOT NULL,
  user_id uuid NOT NULL
);
ALTER TABLE smarter_private.background_mtt_admission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.background_mtt_admission FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.is_background_mtt_admission(event_id uuid,member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM smarter_private.background_mtt_admission a
   WHERE a.writer_xid=pg_current_xact_id_if_assigned() AND a.tournament_id=event_id AND a.user_id=member_id);
$$;
REVOKE ALL ON FUNCTION smarter_private.is_background_mtt_admission(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Only the actual funding coordinator can insert the private record, and only
-- after obtaining all three transaction locks. Verify them at the physical
-- chair and at a ticket's immutable source when admitting this beneficiary.
CREATE FUNCTION smarter_private.owns_background_mtt_admission(event_id uuid,member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN NOT smarter_private.is_background_mtt_admission(event_id,member_id) THEN false ELSE
 NOT EXISTS(
   SELECT FROM (VALUES
     (hashtextextended('ca:tournament-terminal-settlement:v1',0),'ShareLock'),
     (hashtextextended('ca:tournament-terminal-settlement:v1:'||event_id::text,0),'ShareLock'),
     (hashtextextended('ca:background-mtt-admission:v1:'||event_id::text,0),'ExclusiveLock')) AS wanted(key,mode)
   WHERE NOT EXISTS(SELECT FROM pg_locks l WHERE l.pid=pg_backend_pid() AND l.granted
     AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
     AND l.locktype='advisory' AND l.objsubid=1 AND l.mode=wanted.mode
     AND l.classid=(((wanted.key>>32)&4294967295)::oid) AND l.objid=((wanted.key&4294967295)::oid))
 ) END;
$$;
REVOKE ALL ON FUNCTION smarter_private.owns_background_mtt_admission(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Existing purchase delegates reenter their original event lane at several
-- points. Only this private original purchase is already fenced by the three
-- locks and the exact beneficiary. Every other entrant keeps the old owner.
CREATE FUNCTION smarter_private.acquire_mtt_entry_lane(event_id uuid,table_id uuid,member_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE effective_event uuid:=event_id;
BEGIN
  IF table_id IS NOT NULL AND effective_event IS NULL THEN
    SELECT t.tournament_id INTO effective_event FROM public.tables t WHERE t.id=$2;
  END IF;
  IF smarter_private.is_background_mtt_admission(effective_event,member_id) THEN
    IF table_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.tables t WHERE t.id=$2 AND t.tournament_id=effective_event) THEN
      RAISE EXCEPTION 'background_mtt_admission_table_mismatch' USING ERRCODE='23514';
    END IF;
    RETURN true;
  END IF;
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(event_id,table_id);
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION smarter_private.acquire_mtt_entry_lane(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $original_attendance$
DECLARE signature regprocedure:='public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)'::regprocedure;
   definition text:=pg_get_functiondef(signature);
BEGIN
 IF md5(definition)<>'afb54a9112c4fe974ef3b398d8dbe748' THEN RAISE EXCEPTION 'background_attendance_source_changed'; END IF;
 EXECUTE replace(definition,'public.fn_register_horse_for_tournament_to_target(','smarter_private.purchase_mtt_to_attendance_target(');
END $original_attendance$;
REVOKE ALL ON FUNCTION smarter_private.purchase_mtt_to_attendance_target(uuid,uuid,boolean,bigint)
 FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
