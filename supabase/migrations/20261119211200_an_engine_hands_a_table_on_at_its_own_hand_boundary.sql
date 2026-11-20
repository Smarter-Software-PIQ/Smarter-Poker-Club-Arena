-- 20261119211200_an_engine_hands_a_table_on_at_its_own_hand_boundary.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Owner order (Dan, 2026-11-19 12:54 Chicago): "WE NEED TO STOP REQUIRING AN
-- ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
--
-- Today a new engine replaces the running one in one global step (drain every
-- table, freeze, swap, thaw). The rolling handoff moves ownership of each table
-- (or each tournament, whose manager owns all of its tables) from the old
-- engine instance to the new one at that unit's own hand boundary, through the
-- lease rows that already decide who may deal. Design:
-- docs/ENGINE-ROLLING-HANDOFF.md. Engine side:
-- server/src/handoff/RollingHandoffCoordinator.ts, behind
-- ENGINE_ROLLING_HANDOFF=on (default OFF, so nothing calls these functions
-- until the flag is turned on by a later, owner-authorized release).
--
-- 1. public.engine_lease_handoffs: one row per move (and per return of a
--    move whose adoption failed). It is the audit trail and the mailbox the
--    successor reads. No foreign key to any hot relation (CLAUDE.md section 2
--    rule 7): an orphan row here is harmless, a lock on tables is not.
--
-- 2. public.fn_engine_hand_off_lease_v1: the one atomic compare-and-set. The
--    holder proves (instance, generation, fresh heartbeat) and the row moves to
--    (successor, new generation, fresh heartbeat). FOR UPDATE on the lease row
--    waits behind any in-flight hand commit (which holds FOR KEY SHARE), so a
--    move can never land in the middle of a settlement; after it, the old
--    generation can commit nothing (every commit re-checks the exact
--    generation). The successor then claims with claim_table_lease_v2 /
--    claim_tournament_lease_v2 using that exact generation, which those
--    functions already grant as a renewal. NO EXISTING LEASE FUNCTION CHANGES.
--    An exact replay of a committed request answers ok again (an answer lost
--    in transport is not a second move). A `return` puts a failed adoption back
--    with the instance that handed it, even when the adopter's own failed start
--    already released the row.
--
-- 3. public.fn_engine_handed_leases_v1: the open moves addressed to one
--    instance whose lease row still names that instance and generation. A move
--    nobody adopted goes stale with its lease after the audited 30 seconds and
--    drops out of this list by itself; ordinary discovery recovers the table.
--
-- 4. public.fn_engine_settle_lease_handoff_v1: the successor records the
--    outcome (adopted, or abandoned for a failed return).
--
-- 5. public.fn_engine_open_lease_handoffs_v1: how many live moves from or to
--    one instance are still unsettled. The old instance retires only at zero,
--    because until its moves are adopted a failed one may still come back.
--
-- Grants: service_role only, like every lease function.
-- Takes no lock on clubs, tables or hand_history; creating functions and a new
-- table needs no install window.

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS public.engine_lease_handoffs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            text        NOT NULL CHECK (scope IN ('table', 'tournament')),
  lease_key        uuid        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('handoff', 'return')),
  parent_id        uuid,
  from_instance    text        NOT NULL,
  from_generation  uuid        NOT NULL,
  to_instance      text        NOT NULL,
  to_version       text,
  to_generation    uuid        NOT NULL,
  fingerprint      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  state            text        NOT NULL DEFAULT 'handed'
                     CHECK (state IN ('handed', 'adopted', 'returned', 'abandoned')),
  handed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at       timestamptz,
  detail           text,
  CONSTRAINT engine_lease_handoffs_moves
    CHECK (from_instance <> to_instance AND from_generation <> to_generation),
  CONSTRAINT engine_lease_handoffs_return_names_its_parent
    CHECK ((kind = 'return') = (parent_id IS NOT NULL))
);

COMMENT ON TABLE public.engine_lease_handoffs IS
  'Rolling engine handoff: one row per lease moved between engine instances at a hand boundary (docs/ENGINE-ROLLING-HANDOFF.md).';

CREATE UNIQUE INDEX IF NOT EXISTS engine_lease_handoffs_one_move_per_generation
  ON public.engine_lease_handoffs (scope, lease_key, to_generation);

CREATE INDEX IF NOT EXISTS engine_lease_handoffs_open_by_successor
  ON public.engine_lease_handoffs (to_instance)
  WHERE state = 'handed';

ALTER TABLE public.engine_lease_handoffs ENABLE ROW LEVEL SECURITY;
-- Written only through the definer functions below; service_role may read the
-- audit trail and nothing else.
REVOKE ALL ON public.engine_lease_handoffs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.engine_lease_handoffs TO service_role;

CREATE OR REPLACE FUNCTION public.fn_engine_hand_off_lease_v1(
  p_scope           text,
  p_lease_key       uuid,
  p_from_instance   text,
  p_from_generation uuid,
  p_to_instance     text,
  p_to_version      text,
  p_to_generation   uuid,
  p_fingerprint     jsonb DEFAULT '{}'::jsonb,
  p_kind            text  DEFAULT 'handoff',
  p_parent_id       uuid  DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_holder     text;
  v_generation uuid;
  v_protocol   integer;
  v_heartbeat  timestamptz;
  v_found      boolean;
  v_inserted   boolean;
  v_id         uuid;
  v_replay     public.engine_lease_handoffs%ROWTYPE;
  v_parent     public.engine_lease_handoffs%ROWTYPE;
BEGIN
  IF p_scope IS NULL
     OR p_scope NOT IN ('table', 'tournament')
     OR p_lease_key IS NULL
     OR length(btrim(COALESCE(p_from_instance, ''))) = 0
     OR length(btrim(COALESCE(p_to_instance, ''))) = 0
     OR p_from_instance = p_to_instance
     OR p_from_generation IS NULL
     OR p_to_generation IS NULL
     OR p_from_generation = p_to_generation
     OR p_kind IS NULL
     OR p_kind NOT IN ('handoff', 'return')
     OR (p_kind = 'return') <> (p_parent_id IS NOT NULL)
     OR (p_fingerprint IS NOT NULL AND jsonb_typeof(p_fingerprint) <> 'object') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  /* One move decision per lease at a time, so an exact replay and a second
     request can never both pass the replay check below. */
  PERFORM pg_advisory_xact_lock(
    hashtextextended('engine-lease-handoff:' || p_scope || ':' || p_lease_key::text, 0)
  );

  /* An answer lost in transport is replayed by the engine with the SAME
     request. If it already committed, say so again; never move twice. */
  SELECT h.* INTO v_replay
    FROM public.engine_lease_handoffs h
   WHERE h.scope = p_scope
     AND h.lease_key = p_lease_key
     AND h.to_generation = p_to_generation;
  IF FOUND THEN
    IF v_replay.from_instance = p_from_instance
       AND v_replay.from_generation = p_from_generation
       AND v_replay.to_instance = p_to_instance
       AND v_replay.kind = p_kind THEN
      RETURN jsonb_build_object('ok', true, 'handoff_id', v_replay.id, 'replayed', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'generation_already_used');
  END IF;

  IF p_kind = 'return' THEN
    SELECT h.* INTO v_parent
      FROM public.engine_lease_handoffs h
     WHERE h.id = p_parent_id
     FOR UPDATE;
    IF NOT FOUND
       OR v_parent.state <> 'handed'
       OR v_parent.kind <> 'handoff'
       OR v_parent.scope <> p_scope
       OR v_parent.lease_key <> p_lease_key
       OR v_parent.to_instance <> p_from_instance
       OR v_parent.to_generation <> p_from_generation
       OR v_parent.from_instance <> p_to_instance THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'return_parent_mismatch');
    END IF;
  END IF;

  IF p_scope = 'table' THEN
    SELECT l.instance_id, l.lease_generation, l.protocol_version, l.heartbeat_at
      INTO v_holder, v_generation, v_protocol, v_heartbeat
      FROM public.engine_table_leases l
     WHERE l.table_id = p_lease_key
     FOR UPDATE;
  ELSE
    SELECT l.instance_id, l.lease_generation, l.protocol_version, l.heartbeat_at
      INTO v_holder, v_generation, v_protocol, v_heartbeat
      FROM public.engine_tournament_leases l
     WHERE l.tournament_id = p_lease_key
     FOR UPDATE;
  END IF;
  v_found := FOUND;

  IF NOT v_found THEN
    IF p_kind <> 'return' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'lease_missing');
    END IF;
    /* The adopter's own failed start released its exact row. Give the unit
       back to the instance that handed it; if anybody claimed it meanwhile,
       that claim stands and this return is refused. */
    IF p_scope = 'table' THEN
      INSERT INTO public.engine_table_leases AS l (
        table_id, instance_id, engine_version, acquired_at, heartbeat_at,
        lease_generation, protocol_version
      ) VALUES (
        p_lease_key, p_to_instance, p_to_version, clock_timestamp(), clock_timestamp(),
        p_to_generation, 2
      )
      ON CONFLICT (table_id) DO NOTHING;
      v_inserted := FOUND;
    ELSE
      INSERT INTO public.engine_tournament_leases AS l (
        tournament_id, instance_id, engine_version, acquired_at, heartbeat_at,
        lease_generation, protocol_version
      ) VALUES (
        p_lease_key, p_to_instance, p_to_version, clock_timestamp(), clock_timestamp(),
        p_to_generation, 2
      )
      ON CONFLICT (tournament_id) DO NOTHING;
      v_inserted := FOUND;
    END IF;
    IF NOT v_inserted THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'lease_claimed_meanwhile');
    END IF;
  ELSE
    IF v_protocol IS DISTINCT FROM 2
       OR v_holder IS DISTINCT FROM p_from_instance
       OR v_generation IS DISTINCT FROM p_from_generation THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'lease_not_held', 'holder', v_holder);
    END IF;
    IF v_heartbeat < clock_timestamp() - make_interval(
         secs => public.fn_engine_lease_stale_seconds()
       ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'lease_stale');
    END IF;
    IF p_scope = 'table' THEN
      UPDATE public.engine_table_leases l
         SET instance_id = p_to_instance,
             engine_version = p_to_version,
             acquired_at = clock_timestamp(),
             heartbeat_at = clock_timestamp(),
             lease_generation = p_to_generation,
             protocol_version = 2
       WHERE l.table_id = p_lease_key;
    ELSE
      UPDATE public.engine_tournament_leases l
         SET instance_id = p_to_instance,
             engine_version = p_to_version,
             acquired_at = clock_timestamp(),
             heartbeat_at = clock_timestamp(),
             lease_generation = p_to_generation,
             protocol_version = 2
       WHERE l.tournament_id = p_lease_key;
    END IF;
  END IF;

  IF p_kind = 'return' THEN
    UPDATE public.engine_lease_handoffs h
       SET state = 'returned',
           settled_at = clock_timestamp(),
           detail = 'returned to ' || p_to_instance
     WHERE h.id = p_parent_id;
  END IF;

  INSERT INTO public.engine_lease_handoffs (
    scope, lease_key, kind, parent_id, from_instance, from_generation,
    to_instance, to_version, to_generation, fingerprint
  ) VALUES (
    p_scope, p_lease_key, p_kind, p_parent_id, p_from_instance, p_from_generation,
    p_to_instance, p_to_version, p_to_generation, COALESCE(p_fingerprint, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'handoff_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_engine_handed_leases_v1(p_to_instance text)
 RETURNS TABLE(
   handoff_id    uuid,
   scope         text,
   lease_key     uuid,
   from_instance text,
   to_generation uuid,
   fingerprint   jsonb,
   kind          text,
   handed_at     timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT h.id, h.scope, h.lease_key, h.from_instance, h.to_generation,
         h.fingerprint, h.kind, h.handed_at
    FROM public.engine_lease_handoffs h
   WHERE h.to_instance = p_to_instance
     AND h.state = 'handed'
     AND (
       (h.scope = 'table' AND EXISTS (
          SELECT 1 FROM public.engine_table_leases l
           WHERE l.table_id = h.lease_key
             AND l.instance_id = h.to_instance
             AND l.lease_generation = h.to_generation))
       OR
       (h.scope = 'tournament' AND EXISTS (
          SELECT 1 FROM public.engine_tournament_leases l
           WHERE l.tournament_id = h.lease_key
             AND l.instance_id = h.to_instance
             AND l.lease_generation = h.to_generation))
     )
   ORDER BY h.handed_at, h.id
$function$;

CREATE OR REPLACE FUNCTION public.fn_engine_open_lease_handoffs_v1(p_instance text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
    FROM public.engine_lease_handoffs h
   WHERE h.state = 'handed'
     AND (h.from_instance = p_instance OR h.to_instance = p_instance)
     AND (
       (h.scope = 'table' AND EXISTS (
          SELECT 1 FROM public.engine_table_leases l
           WHERE l.table_id = h.lease_key
             AND l.instance_id = h.to_instance
             AND l.lease_generation = h.to_generation))
       OR
       (h.scope = 'tournament' AND EXISTS (
          SELECT 1 FROM public.engine_tournament_leases l
           WHERE l.tournament_id = h.lease_key
             AND l.instance_id = h.to_instance
             AND l.lease_generation = h.to_generation))
     )
$function$;

CREATE OR REPLACE FUNCTION public.fn_engine_settle_lease_handoff_v1(
  p_handoff_id uuid,
  p_instance   text,
  p_outcome    text,
  p_detail     text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_handoff_id IS NULL
     OR length(btrim(COALESCE(p_instance, ''))) = 0
     OR p_outcome IS NULL
     OR p_outcome NOT IN ('adopted', 'abandoned') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  UPDATE public.engine_lease_handoffs h
     SET state = p_outcome,
         settled_at = clock_timestamp(),
         detail = left(p_detail, 500)
   WHERE h.id = p_handoff_id
     AND h.to_instance = p_instance
     AND h.state = 'handed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.engine_lease_handoffs h
     WHERE h.id = p_handoff_id
       AND h.to_instance = p_instance
       AND h.state = p_outcome
  ) THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'not_open');
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_engine_hand_off_lease_v1(text, uuid, text, uuid, text, text, uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_engine_handed_leases_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_engine_settle_lease_handoff_v1(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_engine_open_lease_handoffs_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_engine_hand_off_lease_v1(text, uuid, text, uuid, text, text, uuid, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_engine_handed_leases_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_engine_settle_lease_handoff_v1(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_engine_open_lease_handoffs_v1(text) TO service_role;

-- Each probe runs the body before COMMIT in a subtransaction it always undoes
-- (tests/a-migration-proves-its-functions-before-commit.law.test.ts).

-- @probe-for: public.fn_engine_hand_off_lease_v1
DO $probe$
DECLARE
  v jsonb;
BEGIN
  -- A lease nobody holds is refused, never invented.
  v := public.fn_engine_hand_off_lease_v1(
    'table', gen_random_uuid(), 'probe-old', gen_random_uuid(),
    'probe-new', 'probe', gen_random_uuid(), '{}'::jsonb, 'handoff', NULL);
  IF v ->> 'reason' IS DISTINCT FROM 'lease_missing' THEN
    RAISE EXCEPTION 'hand-off probe expected lease_missing, got %', v;
  END IF;
  v := public.fn_engine_hand_off_lease_v1(
    'tournament', gen_random_uuid(), 'probe-old', gen_random_uuid(),
    'probe-new', 'probe', gen_random_uuid(), '{}'::jsonb, 'handoff', NULL);
  IF v ->> 'reason' IS DISTINCT FROM 'lease_missing' THEN
    RAISE EXCEPTION 'tournament hand-off probe expected lease_missing, got %', v;
  END IF;
  -- A return with no open parent is refused.
  v := public.fn_engine_hand_off_lease_v1(
    'table', gen_random_uuid(), 'probe-new', gen_random_uuid(),
    'probe-old', 'probe', gen_random_uuid(), '{}'::jsonb, 'return', gen_random_uuid());
  IF v ->> 'reason' IS DISTINCT FROM 'return_parent_mismatch' THEN
    RAISE EXCEPTION 'return probe expected return_parent_mismatch, got %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_engine_settle_lease_handoff_v1
DO $probe$
DECLARE
  v_id uuid;
  v    jsonb;
BEGIN
  INSERT INTO public.engine_lease_handoffs (
    scope, lease_key, kind, from_instance, from_generation, to_instance, to_generation
  ) VALUES (
    'table', gen_random_uuid(), 'handoff', 'probe-old', gen_random_uuid(), 'probe-new', gen_random_uuid()
  ) RETURNING id INTO v_id;
  v := public.fn_engine_settle_lease_handoff_v1(v_id, 'probe-new', 'adopted', 'probe');
  IF (v ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'settle probe expected ok, got %', v;
  END IF;
  v := public.fn_engine_settle_lease_handoff_v1(v_id, 'probe-new', 'adopted', 'probe');
  IF (v ->> 'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'settle probe expected an idempotent replay, got %', v;
  END IF;
  v := public.fn_engine_settle_lease_handoff_v1(v_id, 'probe-other', 'adopted', 'probe');
  IF v ->> 'reason' IS DISTINCT FROM 'not_open' THEN
    RAISE EXCEPTION 'settle probe expected not_open for a stranger, got %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.fn_engine_handed_leases_v1('probe-new')) THEN
    RAISE EXCEPTION 'handed-leases probe listed a settled move';
  END IF;
  IF public.fn_engine_open_lease_handoffs_v1('probe-new') <> 0 THEN
    RAISE EXCEPTION 'open-handoffs probe counted a move whose lease never existed';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
