CREATE OR REPLACE FUNCTION smarter_private.tournament_rebuy_lane_held(p_tournament_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_marker text := current_setting('ca.tournament_rebuy_lane', true);
  v_t bigint;
  v_r bigint;
BEGIN
  /* THE PROOF THAT A REBUY HOLDS ITS SHARED LANE (20261118191946). The marker
     public.fn_ca_share_tournament_lane_for_rebuy sets is transaction-local and
     names the event, the player and the transaction; it proves nothing on its
     own. This backend must also hold the event's T(id) (shared is enough: the
     event's exclusive authorities are then excluded) and its rebuy key R(id)
     exclusively. Cheap when there is no marker: one setting read, no pg_locks
     scan, so the guards that call it cost an ordinary writer nothing. */
  IF p_tournament_id IS NULL OR COALESCE(v_marker, '') = '' THEN
    RETURN false;
  END IF;
  IF split_part(v_marker, ':', 1) <> p_tournament_id::text
     OR split_part(v_marker, ':', 3) <> txid_current()::text
     OR (p_user_id IS NOT NULL AND split_part(v_marker, ':', 2) <> p_user_id::text) THEN
    RETURN false;
  END IF;
  v_t := hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0);
  v_r := hashtextextended('ca:tournament-rebuy-lane:v1:' || p_tournament_id::text, 0);
  RETURN COALESCE((
    SELECT bool_or(s.k = 't') AND bool_or(s.k = 'r')
      FROM (SELECT CASE
                     WHEN l.classid = ((v_t >> 32) & 4294967295)::oid
                      AND l.objid = (v_t & 4294967295)::oid THEN 't'
                     WHEN l.classid = ((v_r >> 32) & 4294967295)::oid
                      AND l.objid = (v_r & 4294967295)::oid
                      AND l.mode = 'ExclusiveLock' THEN 'r'
                   END AS k
              FROM pg_catalog.pg_locks l
             WHERE l.pid = pg_backend_pid()
               AND l.locktype = 'advisory'
               AND l.objsubid = 1
               AND l.granted
               AND l.database = (SELECT d.oid FROM pg_catalog.pg_database d
                                  WHERE d.datname = current_database())) s), false);
END;
$function$
