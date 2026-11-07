-- Signed-in entrants can recover their own ranked seat or ticket from its original settlement.
-- @live-proof: (SELECT md5(prosrc)='52141e892e578dea1215d0804bf393ca' FROM pg_proc WHERE oid='public.fn_get_my_satellite_qualifier_result(uuid)'::regprocedure)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE routine regprocedure:='public.fn_get_my_satellite_qualifier_result(uuid)'::regprocedure;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=routine) IS DISTINCT FROM 'a73b0b8c0e0a3f6d1e5ad3a4057888dc' THEN
   RAISE EXCEPTION 'SATELLITE_SIGNED_IN_RESULT_PREIMAGE_DRIFT';
 END IF;
 EXECUTE replace(pg_get_functiondef(routine),$before$ IF NOT FOUND OR h.receipt_version<>3 THEN RETURN NULL; END IF;$before$,$after$ IF NOT FOUND THEN RETURN NULL; END IF;
 IF h.receipt_version=2 THEN
   -- The immutable settlement header and its per-player award commit together.
   -- Reconnecting must not lock the live target or invoke a financial writer.
   SELECT * INTO a FROM public.tournament_satellite_awards
    WHERE tournament_id=h.tournament_id AND user_id=actor;
   IF NOT FOUND THEN RETURN NULL; END IF;
   IF h.source_closed_at IS NULL OR h.source_escrow_closed_at IS NULL OR h.settled_at IS NULL
      OR a.place IS DISTINCT FROM p.position OR a.place IS NULL OR a.place<1
      OR a.amount IS DISTINCT FROM h.ticket_cost OR a.amount<=0
      OR a.delivery_kind NOT IN ('seat','ticket','cash')
      OR (a.delivery_kind='seat' AND a.registration_id IS NULL)
      OR (a.delivery_kind='ticket' AND a.ticket_id IS NULL) THEN
     RAISE EXCEPTION 'ranked satellite award unproven' USING ERRCODE='55000';
   END IF;
   RETURN jsonb_build_object('ok',true,'receipt_version',2,'tournament_id',h.tournament_id,
     'user_id',actor,'target_id',h.target_id,'qualified',true,'position',a.place,
     'amount',a.amount,'delivery_kind',a.delivery_kind,'registration_id',a.registration_id,
     'ticket_id',a.ticket_id,'settled_at',h.settled_at);
 END IF;
 IF h.receipt_version<>3 THEN RETURN NULL; END IF;$after$);
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=routine) IS DISTINCT FROM '52141e892e578dea1215d0804bf393ca' THEN
   RAISE EXCEPTION 'SATELLITE_SIGNED_IN_RESULT_POSTIMAGE_DRIFT';
 END IF;
END;
$migration$;
COMMIT;
