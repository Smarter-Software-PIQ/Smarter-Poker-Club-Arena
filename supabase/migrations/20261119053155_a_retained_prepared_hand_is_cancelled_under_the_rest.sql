-- ═══════════════════════════════════════════════════════════════════════
-- 20261119053155_a_retained_prepared_hand_is_cancelled_under_the_rest.sql
-- ═══════════════════════════════════════════════════════════════════════
-- TIER:        2
-- AUTHOR:      Claude (lane E1, hand delay)
-- AFFECTS:     one new service-role function, one trigger body replaced
-- IRREVERSIBLE: no
--
-- WHY:
--   Dan 2026-11-18: "i just don't want any 'un intended delays'". A
--   tournament deal still made one database round trip AFTER the 1.5 s rest:
--   the seq-0 save of the prepared original (fn_f06_retain_hand_continuation,
--   about 0.15-0.2 s on production). It could not move under the rest because
--   a saved-but-unstarted original had no way out: fn_f06_cancel_prepared_hand
--   refuses it (the never_started transition meets the immutable 'retained'
--   continuation disposition, HAND_CONTINUATION_UNSETTLED), so a pause that
--   arrived after the save fenced the engine (retained_original_start_unproven).
--
-- HOW:
--   fn_f06_cancel_retained_prepared_hand is that way out, for the one process
--   that saved it. Same identity, same reply and the same receipt row
--   (f06_prepared_hand_cancellations) as fn_f06_cancel_prepared_hand, so every
--   reader of that receipt (late-writer fence, last-table continuation,
--   recovery) reads it unchanged. In one transaction, under the same
--   maintenance lane and table lane the save takes:
--     * the permit must still be reserved, with no start evidence;
--     * its private capsule, if one was saved, must be exactly the unstarted
--       seq-0 original of this permit written by this generation (no events,
--       handStarted false); it is deleted;
--     * the receipt is inserted and the permit becomes never_started.
--   A replay returns the same receipt. A save still in flight after the
--   cancel is refused by the save itself (its permit is no longer reserved).
--   Refused while the platform is frozen: a capsule attested for a frozen
--   original stays the custody the maintenance break reads.
--
--   f06_retained_submission_guard admits never_started for exactly that case:
--   a 'retained' disposition, the matching receipt, and no capsule left. Every
--   other path (including fn_f06_cancel_prepared_hand on a saved original)
--   is refused exactly as before.
--
-- PROOF: scripts/ci/test-f06-retained-prepared-cancel-postgres.py (native
-- PostgreSQL 16, production's exact bodies): exactly-once cancel, replay
-- identity, no strand (capsule gone, table's next hand saves), refusals.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('smarter_private.f06_retained_submission_guard()')))
       IS DISTINCT FROM '44902103e4c5f0feba7d19081af4325e' THEN
    RAISE EXCEPTION 'RETAINED_PREPARED_CANCEL_GUARD_PREIMAGE_CHANGED';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_f06_retain_hand_continuation(uuid,uuid,uuid,bigint,bigint,text,text)')))
       IS DISTINCT FROM '64833fbf30f5e2011550f6f59f8a7fab'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_f06_cancel_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)')))
       IS DISTINCT FROM '2eaabb545cbc3251be0cef438b08f989' THEN
    RAISE EXCEPTION 'RETAINED_PREPARED_CANCEL_NEIGHBOUR_CHANGED';
  END IF;
  IF to_regprocedure('public.fn_f06_cancel_retained_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'RETAINED_PREPARED_CANCEL_ALREADY_EXISTS';
  END IF;
END
$preimage$;

CREATE FUNCTION public.fn_f06_cancel_retained_prepared_hand(
  p_tournament_id uuid, p_lease_generation uuid, p_table_id uuid, p_lifecycle bigint,
  p_permit_id uuid, p_hand_number bigint, p_custody_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE h smarter_private.f06_hand_permits; r smarter_private.f06_prepared_hand_cancellations;
 c smarter_private.hand_continuations; v jsonb; ctl jsonb;
BEGIN
 IF p_tournament_id IS NULL OR p_lease_generation IS NULL OR p_table_id IS NULL
 OR p_lifecycle IS NULL OR p_permit_id IS NULL OR p_hand_number IS NULL
 OR p_hand_number<1 OR p_custody_id IS NULL THEN
 RAISE EXCEPTION 'F06_PREPARED_IDENTITY_REQUIRED' USING ERRCODE='22023'; END IF;
 -- The lanes the save takes, in its order: the continuation maintenance lane
 -- shared, then this table's shared tournament lane (table and seats FOR UPDATE).
 PERFORM smarter_private.lock_hand_continuation_maintenance_lane();
 PERFORM public.fn_ca_f06_share_table_lane(p_tournament_id,p_lease_generation,p_table_id);
 SELECT * INTO h FROM smarter_private.f06_hand_permits WHERE permit_id=p_permit_id FOR UPDATE;
 IF NOT FOUND OR (h.tournament_id,h.generation,h.table_id,h.lifecycle,h.hand_number,h.custody_id)
 IS DISTINCT FROM(p_tournament_id,p_lease_generation,p_table_id,p_lifecycle,p_hand_number,p_custody_id) THEN
 RAISE EXCEPTION 'F06_PREPARED_ORIGINAL_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM smarter_private.f06_prepared_hand_cancellations WHERE permit_id=p_permit_id;
 IF FOUND THEN
 -- The exact replay: the same receipt, nothing written.
 IF (r.tournament_id,r.generation,r.table_id,r.lifecycle,r.hand_number,r.custody_id)
 IS DISTINCT FROM(p_tournament_id,p_lease_generation,p_table_id,p_lifecycle,p_hand_number,p_custody_id)
 OR h.state<>'never_started' OR h.evidence_id IS DISTINCT FROM p_permit_id
 OR EXISTS(SELECT 1 FROM smarter_private.hand_continuations x WHERE x.permit_id=p_permit_id) THEN
 RAISE EXCEPTION 'F06_PREPARED_RECEIPT_CHANGED' USING ERRCODE='55000'; END IF;
 ELSE
 IF public.fn_platform_frozen() THEN
 RAISE EXCEPTION 'PLATFORM_FROZEN: retained preparation keeps its capsule' USING ERRCODE='55000'; END IF;
 IF h.state<>'reserved' OR h.evidence_id IS NOT NULL THEN
 RAISE EXCEPTION 'F06_PREPARED_NOT_RESERVED' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tables tb JOIN public.tournaments t ON t.id=tb.tournament_id
 WHERE tb.id=p_table_id AND tb.tournament_id=p_tournament_id AND tb.f06_lifecycle=p_lifecycle
 AND upper(t.status)='RUNNING' AND lower(tb.status)<>'closed' AND NOT COALESCE(tb.is_deleted,false)) THEN
 RAISE EXCEPTION 'F06_HAND_LIFECYCLE' USING ERRCODE='55000'; END IF;
 -- The same start witnesses fn_f06_cancel_prepared_hand refuses on, plus a
 -- submitted hand: their absence alone never grants the cancel, the caller's
 -- positive local non-start does; their presence always refuses it.
 IF EXISTS(SELECT 1 FROM smarter_private.f06_hand_dispatch WHERE permit_id=p_permit_id)
 OR EXISTS(SELECT 1 FROM public.hand_atomic_commits WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_history WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_state_snapshots WHERE table_id=p_table_id AND NOT is_complete AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.hand_private_state WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM public.table_hole_cards WHERE table_id=p_table_id AND hand_number=p_hand_number)
 OR EXISTS(SELECT 1 FROM smarter_private.hand_submissions WHERE table_id=p_table_id AND hand_number=p_hand_number) THEN
 RAISE EXCEPTION 'F06_PREPARED_START_EVIDENCE' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM smarter_private.hand_continuations
 WHERE table_id=p_table_id AND hand_number=p_hand_number FOR UPDATE;
 IF FOUND THEN
 -- Only this generation's own unstarted seq-0 save of this permit. A batch
 -- with events, a started controller or a successor's claim is a hand.
 v:=c.payload::jsonb;
 ctl:=(v#>>'{batch,controller}')::jsonb;
 IF c.permit_id IS DISTINCT FROM p_permit_id OR c.tournament_id IS DISTINCT FROM p_tournament_id
 OR c.original_generation IS DISTINCT FROM p_lease_generation
 OR c.writer_generation IS DISTINCT FROM p_lease_generation
 OR c.sequence<>0 OR v#>>'{batch,sequence}' IS DISTINCT FROM '0'
 OR v#>'{batch,events}' IS DISTINCT FROM '[]'::jsonb
 OR ctl->'handStarted' IS DISTINCT FROM 'false'::jsonb
 OR v#>>'{original,permit_id}' IS DISTINCT FROM p_permit_id::text
 OR v#>>'{original,hand_number}' IS DISTINCT FROM p_hand_number::text THEN
 RAISE EXCEPTION 'F06_RETAINED_ORIGINAL_NOT_PREPARED' USING ERRCODE='55000'; END IF;
 DELETE FROM smarter_private.hand_continuations WHERE table_id=p_table_id AND hand_number=p_hand_number;
 END IF;
 INSERT INTO smarter_private.f06_prepared_hand_cancellations
 (permit_id,tournament_id,generation,table_id,lifecycle,hand_number,custody_id)
 VALUES(p_permit_id,p_tournament_id,p_lease_generation,p_table_id,p_lifecycle,p_hand_number,p_custody_id);
 UPDATE smarter_private.f06_hand_permits SET state='never_started',evidence_id=p_permit_id
 WHERE permit_id=p_permit_id RETURNING * INTO h;
 END IF;
 RETURN to_jsonb(h)||jsonb_build_object('ok',true,'lifecycle',h.lifecycle::text,'hand_number',h.hand_number::text);
END $function$;

REVOKE ALL ON FUNCTION public.fn_f06_cancel_retained_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_f06_cancel_retained_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)
  TO service_role;

-- Executed before COMMIT. Its only lawful outcome without a live lease is its
-- own identity refusal, which proves the body compiles and runs; every other
-- path (lanes, capsule, receipt, guard) is executed on production's exact
-- bodies by scripts/ci/test-f06-retained-prepared-cancel-postgres.py.
-- @probe-for: public.fn_f06_cancel_retained_prepared_hand
DO $probe$
BEGIN
  BEGIN
    PERFORM public.fn_f06_cancel_retained_prepared_hand(NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'RETAINED_PREPARED_CANCEL_PROBE_ACCEPTED_NULL_IDENTITY';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'F06_PREPARED_IDENTITY_REQUIRED' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

CREATE OR REPLACE FUNCTION smarter_private.f06_retained_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d smarter_private.hand_submission_dispositions;
BEGIN
 IF NEW.state = 'accepted' AND EXISTS (SELECT 1 FROM smarter_private.hand_continuations c WHERE c.permit_id = NEW.permit_id) THEN
  IF NOT EXISTS (SELECT 1 FROM public.hand_atomic_commits a WHERE a.table_id = NEW.table_id
    AND a.hand_number = NEW.hand_number AND a.hand_id = NEW.evidence_id AND a.post_commit_completed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'HAND_CONTINUATION_ACCEPTANCE_UNPROVEN' USING ERRCODE='55000';
  END IF;
  -- Positive atomic acceptance owns cleanup; no periodic private-deck retention.
  DELETE FROM smarter_private.hand_continuations WHERE permit_id = NEW.permit_id;
 END IF;
 IF NEW.state='aborted_unsettled' AND EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions a
 WHERE a.receipt_id=NEW.evidence_id AND a.permit_id=NEW.permit_id AND a.table_id=NEW.table_id AND a.hand_number=NEW.hand_number
 AND a.original->'permit'=to_jsonb(OLD) AND a.boundary->>'closure_mode'='equal_share') THEN RETURN NEW;END IF;
 IF NEW.state NOT IN ('never_started','aborted_unsettled') THEN RETURN NEW; END IF;
 -- A RETAINED PREPARED ORIGINAL CANCELLED BEFORE IT STARTED (2026-11-19).
 -- fn_f06_cancel_retained_prepared_hand deleted its unstarted seq-0 capsule
 -- and wrote the prepared-cancellation receipt in this transaction; the
 -- immutable 'retained' disposition stays as the record of the save.
 IF NOT (NEW.state='never_started' AND NEW.evidence_id=NEW.permit_id
   AND EXISTS(SELECT 1 FROM smarter_private.f06_prepared_hand_cancellations x
     WHERE (x.permit_id,x.tournament_id,x.generation,x.table_id,x.lifecycle,x.hand_number,x.custody_id)
         = (NEW.permit_id,NEW.tournament_id,NEW.generation,NEW.table_id,NEW.lifecycle,NEW.hand_number,NEW.custody_id))
   AND EXISTS(SELECT 1 FROM smarter_private.hand_continuation_dispositions z
     WHERE z.table_id=NEW.table_id AND z.hand_number=NEW.hand_number AND z.disposition='retained')
   AND NOT EXISTS(SELECT 1 FROM smarter_private.hand_continuations c
     WHERE c.permit_id=NEW.permit_id OR (c.table_id=NEW.table_id AND c.hand_number=NEW.hand_number))) THEN
  PERFORM smarter_private.assert_hand_continuation_disposition(NEW.table_id, NEW.hand_number);
 END IF;
 INSERT INTO smarter_private.hand_submission_dispositions(table_id,hand_number,permit_id,disposition,submission_id)
 VALUES(NEW.table_id,NEW.hand_number,NEW.permit_id,'disposed',NULL) ON CONFLICT(table_id,hand_number) DO NOTHING;
 SELECT * INTO STRICT d FROM smarter_private.hand_submission_dispositions WHERE table_id=NEW.table_id AND hand_number=NEW.hand_number;
 IF d.disposition<>'disposed' OR (d.permit_id IS NOT NULL AND d.permit_id IS DISTINCT FROM NEW.permit_id) THEN
  RAISE EXCEPTION 'F06_RETAINED_HAND_SUBMISSION_REQUIRES_ACCEPTED_DISPOSITION' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $function$;

COMMIT;
