-- 20261113123902_record_throw_targets.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-13: build "record who gets hit". throw_usage and
-- throwable_use_receipts record who threw what and when, never at whom or at
-- which table, so nobody could read from rows whether horses throw at horses
-- as well as humans (the 2026-11-12 fix, PR #10686) or how targets spread.
--
-- public.throw_targets holds one row per charged throw: the table, the
-- thrower and their seat, the target seat and the player sitting in it. It is
-- keyed on the throw's own receipt (thrower_user_id, request_id), so a throw
-- is recorded at most once and only a throw that was actually charged can be
-- recorded. The charging function fn_use_throwable_v2 is NOT touched: the
-- record is a separate call after the charge, and a failed record never
-- refunds, re-charges or blocks a throw.
--
--   fn_record_throw_target(request, table, target seat)   browser, as auth.uid()
--   fn_horse_record_throw_target(horse, request, table, target seat)
--                                                          engine (service_role),
--                                                          binds the horse's own id
--                                                          exactly like
--                                                          fn_horse_use_throwable.
--
-- Horse or human is never read to decide anything here (CLAUDE.md 10.5); the
-- wrapper reads is_horse only to refuse binding a person's id.
--
-- No foreign key to table_seats, tables or profiles (CLAUDE.md section 2
-- rule 7): an orphan audit row is harmless, a lock on a hot table is not.
-- No hot-table DDL, so no install window is needed.

BEGIN;

SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.throw_targets (
  thrower_user_id uuid        NOT NULL,
  request_id      uuid        NOT NULL,
  throwable_id    text        NOT NULL,
  table_id        uuid        NOT NULL,
  thrower_seat    integer,
  target_seat     integer     NOT NULL,
  target_user_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (thrower_user_id, request_id),
  CONSTRAINT throw_targets_target_seat_range CHECK (target_seat BETWEEN 0 AND 12)
);

COMMENT ON TABLE public.throw_targets IS
  'One row per charged throwable: table, thrower, thrower seat, target seat and the player in it. Keyed on the throw receipt; written only by fn_record_throw_target / fn_horse_record_throw_target (2026-11-13).';

CREATE INDEX IF NOT EXISTS throw_targets_table_created_idx
  ON public.throw_targets (table_id, created_at DESC);
CREATE INDEX IF NOT EXISTS throw_targets_target_created_idx
  ON public.throw_targets (target_user_id, created_at DESC);

ALTER TABLE public.throw_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.throw_targets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.throw_targets TO service_role;

CREATE OR REPLACE FUNCTION public.fn_record_throw_target(
  p_request_id  uuid,
  p_table_id    uuid,
  p_target_seat integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_throwable    text;
  v_thrower_seat integer;
  v_target_user  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication Required');
  END IF;
  IF p_request_id IS NULL OR p_table_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing Throw');
  END IF;
  IF p_target_seat IS NULL OR p_target_seat < 0 OR p_target_seat > 12 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid Target Seat');
  END IF;

  -- Only a throw this account was actually charged for can be recorded.
  SELECT r.throwable_id
    INTO v_throwable
    FROM public.throwable_use_receipts r
   WHERE r.user_id = v_uid
     AND r.request_id = p_request_id;
  IF v_throwable IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown Throw');
  END IF;

  SELECT s.seat_number
    INTO v_thrower_seat
    FROM public.table_seats s
   WHERE s.table_id = p_table_id
     AND s.user_id = v_uid
     AND s.left_at IS NULL
   ORDER BY s.joined_at DESC NULLS LAST
   LIMIT 1;

  SELECT s.user_id
    INTO v_target_user
    FROM public.table_seats s
   WHERE s.table_id = p_table_id
     AND s.seat_number = p_target_seat
     AND s.left_at IS NULL
   ORDER BY s.joined_at DESC NULLS LAST
   LIMIT 1;

  INSERT INTO public.throw_targets (
    thrower_user_id, request_id, throwable_id, table_id,
    thrower_seat, target_seat, target_user_id
  )
  VALUES (
    v_uid, p_request_id, v_throwable, p_table_id,
    v_thrower_seat, p_target_seat, v_target_user
  )
  ON CONFLICT (thrower_user_id, request_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'recorded', FOUND,
    'target_user_id', v_target_user
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_horse_record_throw_target(
  p_horse_id    uuid,
  p_request_id  uuid,
  p_table_id    uuid,
  p_target_seat integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_horse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown User');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_horse_id AND p.is_horse IS TRUE
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not A Horse');
  END IF;

  -- auth.uid() reads these for the rest of THIS transaction only.
  PERFORM set_config('request.jwt.claim.sub', p_horse_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_horse_id::text, 'role', 'authenticated')::text,
    true
  );

  RETURN public.fn_record_throw_target(p_request_id, p_table_id, p_target_seat);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_record_throw_target(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_record_throw_target(uuid, uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_horse_record_throw_target(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_record_throw_target(uuid, uuid, uuid, integer) TO service_role;

COMMIT;
