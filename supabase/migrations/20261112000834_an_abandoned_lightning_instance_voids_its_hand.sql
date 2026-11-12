-- 20261112000834_an_abandoned_lightning_instance_voids_its_hand
--
-- AN ABANDONED LIGHTNING INSTANCE VOIDS ITS HAND (2026-11-12).
--
-- Since 2026-10-18 every lightning_hand whose instance was abandoned (reaped
-- past its deadline, or abandoned by its host) stayed settled_at NULL forever:
-- the void verdict lived only on lightning_instance.abandon_reason, so the
-- hand row was indistinguishable from a live hand. 7,505 such hands existed
-- at reconciliation time. No chips ever moved on them (nothing writes money
-- before settlement; fn_lightning_settle_hand refuses an abandoned instance
-- under the instance row lock), so the repair is a terminal marker, not a
-- money movement.
--
-- The fix, at the owning state transition (no watcher, no repair loop):
--   1. lightning_hand carries voided_at / void_reason.
--   2. The instance's transition to 'abandoned' stamps its hand void, in the
--      same transaction, whatever path abandons it (reaper, host abandon, or
--      any future one).
--   3. CHECK constraints and the immutability trigger make settled and voided
--      mutually exclusive and the void write-once, so the gap cannot regress.
--   4. The historical rows are reconciled from their instances' own verdicts.
--
-- Installed on production through the Supabase MCP as version 20261112000834
-- (readback, rollback-protected negative tests and both constraint
-- validations passed there), so the applier answers ALREADY-APPLIED by name;
-- this file is the repository's canonical copy for a fresh database.

BEGIN;

-- 1. The terminal marker.
ALTER TABLE public.lightning_hand
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text;

-- 2. The immutability law learns the void (full current body, with the void
--    rules added; see each dated comment for provenance).
CREATE OR REPLACE FUNCTION public.fn_lightning_hand_is_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_NOT_DELETABLE: hand % was formed at % and is a fact; a hand that can be deleted is a participant set that can be substituted by deleting and re-forming it',
      OLD.hand_id, OLD.formed_at USING ERRCODE = 'check_violation';
  END IF;

  -- THE LATCH IS NOT A THING A HAND CAN BE BORN WITH (2026-09-26). This
  -- trigger used to fire on UPDATE and DELETE only, so "the latch may only be
  -- set over a set that is really there" was a rule about UPDATE: a hand
  -- INSERTed already locked at player_count 6 over no participant rows was
  -- accepted, could never be given a participant, and could be dealt. The
  -- latch goes on in barrier step 10's UPDATE, over rows that exist, or not at
  -- all. The versions are NOT NULL and CHECKed by the table, so they need
  -- nothing here on the way in.
  IF TG_OP = 'INSERT' THEN
    IF NEW.participants_locked_at IS NOT NULL OR NEW.player_count IS NOT NULL THEN
      RAISE EXCEPTION 'LIGHTNING_HAND_IS_BORN_UNLOCKED: hand % was inserted already carrying the latch (participants_locked_at %, player_count %), which is barrier step 10 performed before the participants it counts exist; a hand born locked can never be given the set it claims',
        NEW.hand_id, NEW.participants_locked_at, NEW.player_count USING ERRCODE = 'check_violation';
    END IF;
    -- A HAND IS BORN LIVE (2026-11-12). The void is the instance abandonment's
    -- verdict on a hand that already exists; a hand inserted already voided is
    -- a verdict without a trial.
    IF NEW.voided_at IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'LIGHTNING_HAND_IS_BORN_LIVE: hand % may not be inserted already voided',
        NEW.hand_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.hand_id IS DISTINCT FROM OLD.hand_id
     OR NEW.cluster_id IS DISTINCT FROM OLD.cluster_id
     OR NEW.cluster_epoch IS DISTINCT FROM OLD.cluster_epoch
     OR NEW.lightning_instance_id IS DISTINCT FROM OLD.lightning_instance_id
     OR NEW.formed_at IS DISTINCT FROM OLD.formed_at THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_IMMUTABLE: hand % may not have its identity, Cluster, epoch, instance or formation time rewritten',
      OLD.hand_id USING ERRCODE = 'check_violation';
  END IF;

  -- THE VERSIONS THE HAND WAS FORMED UNDER ARE PART OF WHAT IT IS
  -- (2026-09-26). Specification 2137-2143; stamped at step 7 in the INSERT
  -- that creates the hand, so they are frozen from birth rather than from the
  -- latch - there is no moment at which rewriting one is formation.
  IF NEW.rules_version IS DISTINCT FROM OLD.rules_version
     OR NEW.matcher_version IS DISTINCT FROM OLD.matcher_version
     OR NEW.blind_algorithm_version IS DISTINCT FROM OLD.blind_algorithm_version
     OR NEW.lightning_version IS DISTINCT FROM OLD.lightning_version
     OR NEW.rake_version IS DISTINCT FROM OLD.rake_version
     -- and the request it was formed for (2026-09-26)
     OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_IMMUTABLE: hand % was formed under rules %, matcher %, blind algorithm %, lightning % and rake %, and the versions it was formed under may not be rewritten',
      OLD.hand_id, OLD.rules_version, OLD.matcher_version, OLD.blind_algorithm_version,
      OLD.lightning_version, OLD.rake_version USING ERRCODE = 'check_violation';
  END IF;

  -- LIGHTNING PHASE 6 (20261001154813): THE NUMBER A HAND IS RECORDED UNDER
  -- AND THE RECEIPT IT SETTLED WITH ARE WRITTEN ONCE. A re-bound number is a
  -- second physical hand wearing this one's identity; a rewritten receipt is
  -- a settlement that can be answered two ways.
  IF OLD.hand_number IS NOT NULL
     AND ROW(NEW.hand_number, NEW.host_table_id) IS DISTINCT FROM ROW(OLD.hand_number, OLD.host_table_id) THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_NUMBER_IS_WRITE_ONCE: hand % was bound to hand number % at host table % and may not be re-bound to % at %',
      OLD.hand_id, OLD.hand_number, OLD.host_table_id, NEW.hand_number, NEW.host_table_id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.settled_at IS NOT NULL
     AND ROW(NEW.settled_at, NEW.settle_request_id, NEW.settle_request_hash, NEW.hand_history_id, NEW.settle_receipt)
         IS DISTINCT FROM ROW(OLD.settled_at, OLD.settle_request_id, OLD.settle_request_hash, OLD.hand_history_id, OLD.settle_receipt) THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_SETTLED: hand % settled at % as hand history % and its receipt may not be rewritten',
      OLD.hand_id, OLD.settled_at, OLD.hand_history_id USING ERRCODE = 'check_violation';
  END IF;

  -- AN ABANDONED HAND IS VOID, ONCE (2026-11-12). The instance's abandonment
  -- stamps the hand (lightning_abandoned_instance_voids_its_hand). The stamp
  -- is write-once, a voided hand may not settle, and a settled hand may not
  -- be voided; the table CHECKs the last two as well, so the rule holds even
  -- if this trigger is ever bypassed.
  IF OLD.voided_at IS NOT NULL
     AND ROW(NEW.voided_at, NEW.void_reason) IS DISTINCT FROM ROW(OLD.voided_at, OLD.void_reason) THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_VOID: hand % was voided at % and its void may not be rewritten or cleared',
      OLD.hand_id, OLD.voided_at USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.voided_at IS NOT NULL AND NEW.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_VOID: hand % was voided at % and may not settle',
      OLD.hand_id, OLD.voided_at USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.settled_at IS NOT NULL AND NEW.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_SETTLED: hand % settled at % and may not be voided',
      OLD.hand_id, OLD.settled_at USING ERRCODE = 'check_violation';
  END IF;

  -- THE LATCH IS ONE-WAY. Clearing it would unlock every rule in
  -- fn_lightning_hand_player_is_immutable in a single UPDATE, which is the one
  -- bypass that would make all four of them decorative.
  IF OLD.participants_locked_at IS NOT NULL
     AND NEW.participants_locked_at IS DISTINCT FROM OLD.participants_locked_at THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_IMMUTABLE: hand % locked its participant set at % and the latch may not be cleared or moved',
      OLD.hand_id, OLD.participants_locked_at USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.participants_locked_at IS NOT NULL
     AND NEW.player_count IS DISTINCT FROM OLD.player_count THEN
    RAISE EXCEPTION 'LIGHTNING_HAND_IS_IMMUTABLE: hand % locked % participants and that count may not be rewritten',
      OLD.hand_id, OLD.player_count USING ERRCODE = 'check_violation';
  END IF;

  -- THE LATCH MAY ONLY BE SET OVER A SET THAT IS REALLY THERE. Without this a
  -- caller could lock a hand at a player_count that does not match the rows,
  -- and every later reader would believe a set of two was a set of six.
  IF OLD.participants_locked_at IS NULL AND NEW.participants_locked_at IS NOT NULL THEN
    IF NEW.player_count IS DISTINCT FROM
       (SELECT count(*)::smallint FROM public.lightning_hand_player hp WHERE hp.hand_id = NEW.hand_id) THEN
      RAISE EXCEPTION 'LIGHTNING_HAND_IS_IMMUTABLE: hand % was locked at player_count % over % participant row(s)',
        NEW.hand_id, NEW.player_count,
        (SELECT count(*) FROM public.lightning_hand_player hp WHERE hp.hand_id = NEW.hand_id)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

-- 3. The stamp, at the owning transition. Every path that abandons an
--    instance (fn_lightning_reap_formations, fn_lightning_instance_abandon,
--    or any future one) goes through state = 'abandoned' on this row, so the
--    hand is voided in the same transaction, with the instance's own reason.
CREATE OR REPLACE FUNCTION public.fn_lightning_abandoned_instance_voids_its_hand()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.hand_id IS NOT NULL THEN
    UPDATE public.lightning_hand h
       SET voided_at = clock_timestamp(),
           void_reason = coalesce(NEW.abandon_reason, 'instance abandoned')
     WHERE h.hand_id = NEW.hand_id
       AND h.settled_at IS NULL
       AND h.voided_at IS NULL;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS lightning_abandoned_instance_voids_its_hand ON public.lightning_instance;
CREATE TRIGGER lightning_abandoned_instance_voids_its_hand
  AFTER UPDATE OF state ON public.lightning_instance
  FOR EACH ROW
  WHEN (NEW.state = 'abandoned' AND OLD.state IS DISTINCT FROM 'abandoned')
  EXECUTE FUNCTION public.fn_lightning_abandoned_instance_voids_its_hand();

DROP TRIGGER IF EXISTS lightning_abandoned_instance_voids_its_hand_on_insert ON public.lightning_instance;
CREATE TRIGGER lightning_abandoned_instance_voids_its_hand_on_insert
  AFTER INSERT ON public.lightning_instance
  FOR EACH ROW
  WHEN (NEW.state = 'abandoned')
  EXECUTE FUNCTION public.fn_lightning_abandoned_instance_voids_its_hand();

-- 4. The reconciliation: every hand whose instance already carries the
--    abandoned verdict takes it, dated to when nothing vouched for the hand
--    any longer (the instance's completion or deadline), never before its own
--    formation.
UPDATE public.lightning_hand h
   SET voided_at = GREATEST(h.formed_at, coalesce(li.completed_at, li.deadline_at, h.formed_at)),
       void_reason = 'reconciled 2026-11-12: ' || coalesce(li.abandon_reason, 'instance abandoned')
  FROM public.lightning_instance li
 WHERE li.hand_id = h.hand_id
   AND li.state = 'abandoned'
   AND h.settled_at IS NULL
   AND h.voided_at IS NULL;

-- 5. Settled and voided are mutually exclusive, and a void carries its
--    reason. Added NOT VALID so the hot table is never exclusively locked for
--    a full scan, then validated (SHARE UPDATE EXCLUSIVE only); on production
--    both validations passed over all rows.
ALTER TABLE public.lightning_hand
  ADD CONSTRAINT lightning_hand_settled_or_voided_never_both
    CHECK (settled_at IS NULL OR voided_at IS NULL) NOT VALID;
ALTER TABLE public.lightning_hand
  ADD CONSTRAINT lightning_hand_void_carries_its_reason
    CHECK ((voided_at IS NULL) = (void_reason IS NULL)) NOT VALID;
ALTER TABLE public.lightning_hand VALIDATE CONSTRAINT lightning_hand_settled_or_voided_never_both;
ALTER TABLE public.lightning_hand VALIDATE CONSTRAINT lightning_hand_void_carries_its_reason;

-- 6. The migration proves itself on the open-hand side (bounded read): no
--    abandoned instance's hand remains open.
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v
    FROM public.lightning_hand h
    JOIN public.lightning_instance li ON li.hand_id = h.hand_id
   WHERE h.settled_at IS NULL AND h.voided_at IS NULL AND li.state = 'abandoned';
  IF v > 0 THEN
    RAISE EXCEPTION 'void reconciliation left % abandoned hand(s) open', v;
  END IF;
END $$;

COMMIT;
