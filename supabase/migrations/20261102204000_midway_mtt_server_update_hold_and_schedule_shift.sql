-- @live-proof: SELECT (public.fn_get_tournament_start_hold_status()->>'blocked')::boolean AS blocked, public.fn_get_tournament_start_hold_status()->>'popup_message' AS popup_message;
-- @live-proof: SELECT COUNT(*)::int AS shifted_count FROM public.tournaments WHERE union_id = 'fade0000-0000-0000-0000-000000000001' AND status = 'REGISTERING' AND start_time >= '2026-11-02 23:00:00+00'::timestamptz AND start_time <= '2026-11-03 03:30:00+00'::timestamptz;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Public reader RPC for the owner-authorized tournament start hold status and popup copy.
CREATE OR REPLACE FUNCTION public.fn_get_tournament_start_hold_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_role text := COALESCE(auth.role(), 'anon');
  v_hold record;
BEGIN
  IF v_role NOT IN ('anon', 'authenticated', 'service_role') THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'reason', NULL,
      'requested_at', NULL,
      'popup_message', NULL
    );
  END IF;

  SELECT
    COALESCE(h.blocked, false) AS blocked,
    h.reason,
    h.requested_at
  INTO v_hold
  FROM public.ca_tournament_start_hold h
  WHERE h.singleton = true;

  RETURN jsonb_build_object(
    'blocked', COALESCE(v_hold.blocked, false),
    'reason', v_hold.reason,
    'requested_at', v_hold.requested_at,
    'popup_message', CASE
      WHEN COALESCE(v_hold.blocked, false) THEN
        'MIDWAY UNION MTT''S ARE ON A SERVER UPDATE, THEY WILL BE BACK ONLINE AND RUNNING AT 6PM CST. ALL GAMES ARE FROZE UNTIL THE FINAL SERVER UPDATE IS COMPLETED.'
      ELSE NULL
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_tournament_start_hold_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_tournament_start_hold_status() TO anon, authenticated, service_role;

INSERT INTO public.ca_browser_definer_allowlist (proname, reason)
VALUES (
  'fn_get_tournament_start_hold_status',
  'Public read-only tournament start hold status and Midway Union MTT server-update popup banner'
)
ON CONFLICT (proname) DO NOTHING;

-- 2. Stop AI horse top-ups and new unstarted tournament registrations while fn_ca_new_tournament_starts_blocked() is active,
-- while preserving late registration and re-entry on already-started (RUNNING) tournaments.
CREATE OR REPLACE FUNCTION public.fn_ca_lock_tournament_seat_acquisition(
  p_tournament_id uuid,
  p_table_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_tournament_id uuid := p_tournament_id;
  v_table_id uuid := p_table_id;
  v_status text;
  v_max integer := 0;
  v_active integer := 0;
  v_started_at timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','missing_user_id');
  END IF;
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id, p_table_id);
  PERFORM pg_advisory_xact_lock_shared(530093);
  IF EXISTS(SELECT 1 FROM public.ca_operator_floor_hold h JOIN public.ca_launch_operator_scopes m ON m.operation_id=h.operation_id JOIN public.tournaments t ON t.id=COALESCE(p_tournament_id,(SELECT tournament_id FROM public.tables WHERE id=p_table_id)) WHERE h.mode='park' AND (t.club_id=ANY(m.club_ids) OR t.union_id=ANY(m.club_ids)) AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id AND tp.user_id=p_user_id)) THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530090,1);
  IF public.fn_ca_new_tournament_starts_blocked()
     AND public.fn_ca_launch_tournament_has_started(COALESCE(p_tournament_id,(SELECT tournament_id FROM public.tables WHERE id=p_table_id))) IS NOT TRUE
     AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=COALESCE(p_tournament_id,(SELECT tournament_id FROM public.tables WHERE id=p_table_id)) AND tp.user_id=p_user_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('table_cap'), hashtext(p_user_id::text));
  PERFORM public.fn_lock_daily_mission_user(p_user_id);

  IF v_table_id IS NOT NULL THEN
    SELECT tb.tournament_id
    INTO v_tournament_id
    FROM public.tables tb
    WHERE tb.id = v_table_id
    FOR UPDATE;
  END IF;

  IF v_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  PERFORM 1
  FROM public.tournament_launch_receipts r
  WHERE r.tournament_id = v_tournament_id
  FOR UPDATE;

  SELECT
    upper(COALESCE(t.status::text, '')),
    COALESCE(t.max_players, 0),
    t.started_at
  INTO v_status, v_max, v_started_at
  FROM public.tournaments t
  WHERE t.id = v_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  PERFORM 1
  FROM public.tables tb
  WHERE tb.tournament_id = v_tournament_id
    AND COALESCE(tb.status, 'active') <> 'closed'
  ORDER BY tb.id
  FOR UPDATE;

  PERFORM 1
  FROM public.tournament_players tp
  WHERE tp.tournament_id = v_tournament_id
    AND tp.status::text IN ('registered', 'playing')
  ORDER BY tp.id
  FOR UPDATE;

  PERFORM 1
  FROM public.table_seats ts
  JOIN public.tables tb ON tb.id = ts.table_id
  WHERE tb.tournament_id = v_tournament_id
    AND ts.left_at IS NULL
  ORDER BY ts.id
  FOR UPDATE;

  SELECT COUNT(DISTINCT u.uid)::integer
  INTO v_active
  FROM (
    SELECT tp.user_id AS uid
    FROM public.tournament_players tp
    WHERE tp.tournament_id = v_tournament_id
      AND tp.status::text IN ('registered', 'playing')
      AND tp.user_id IS NOT NULL
    UNION
    SELECT ts.user_id AS uid
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
    WHERE tb.tournament_id = v_tournament_id
      AND COALESCE(tb.status, 'active') <> 'closed'
      AND ts.left_at IS NULL
      AND ts.user_id IS NOT NULL
  ) u;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', v_tournament_id,
    'table_id', v_table_id,
    'status', v_status,
    'max_players', v_max,
    'active_players', v_active,
    'started_at', v_started_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_lock_tournament_seat_acquisition(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_lock_tournament_seat_acquisition(uuid, uuid, uuid) TO service_role;

-- 3. Ensure owner-authorized hold singleton is set in production and shift the 18 paused Midway Union REGISTERING MTTs by +3 hours 30 minutes idempotently.
DO $$
DECLARE
  v_expected_count integer := 0;
  v_verified_count integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournaments
    WHERE id = '90603e12-b9e1-46a0-aa48-8f1880b9a77d'::uuid
  ) THEN
    INSERT INTO public.ca_tournament_start_hold (singleton, blocked, reason, requested_at, operation_id)
    VALUES (
      true,
      true,
      'Owner explicit instruction in chat fe763bed-7adb-4146-824b-b547e2779b83 (2026-11-02 14:20 CST): ALLOW THE CURRENT RUNNING TOURNAMENTS TO FINISH IF THATS POSSIBLE BUT DO NOT START ANY NEW ONES. FREEZE THEM NOW, AND THEN WHEN YOU RE OPEN THIS AT 6PM. ADD 3:30 MIN TO THE FUTURE START DATES OF ALL THE TOURNAMENTS THAT ARE CURRENTLY DONT RUN BECAUSE WE PAUSED THEM.',
      now(),
      'fe763bed-7adb-4146-824b-b547e2779b83'
    )
    ON CONFLICT (singleton) DO UPDATE
      SET blocked = true,
          reason = EXCLUDED.reason,
          operation_id = EXCLUDED.operation_id;
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('app.owner_tournament_start_shift', 'fe763bed-7adb-4146-824b-b547e2779b83', true);

  WITH target_mtts(id, original_start_time, shifted_start_time) AS (
    VALUES
      ('37ad7860-3743-46e6-9a39-6701aa1b648a'::uuid, '2026-11-02 19:30:00+00'::timestamptz, '2026-11-02 23:00:00+00'::timestamptz),
      ('6b504816-aec0-49f9-8c5c-89baacc37f3b'::uuid, '2026-11-02 20:15:00+00'::timestamptz, '2026-11-02 23:45:00+00'::timestamptz),
      ('bc8150f7-e744-465a-a3bf-8a6e6804e2a1'::uuid, '2026-11-02 20:30:00+00'::timestamptz, '2026-11-03 00:00:00+00'::timestamptz),
      ('0d73ad93-ae1e-4ddd-9926-94833e26b006'::uuid, '2026-11-02 20:45:00+00'::timestamptz, '2026-11-03 00:15:00+00'::timestamptz),
      ('fb2d3bb5-f092-4b9a-80dd-517b9ec04ee9'::uuid, '2026-11-02 21:00:00+00'::timestamptz, '2026-11-03 00:30:00+00'::timestamptz),
      ('0778af66-7924-44dd-b537-56af19adf1ad'::uuid, '2026-11-02 21:30:00+00'::timestamptz, '2026-11-03 01:00:00+00'::timestamptz),
      ('31ac3b30-0b30-4d52-af51-b6d9313821c8'::uuid, '2026-11-02 21:45:00+00'::timestamptz, '2026-11-03 01:15:00+00'::timestamptz),
      ('5c0f2270-9494-496f-8d89-2c03f6964dd1'::uuid, '2026-11-02 21:45:00+00'::timestamptz, '2026-11-03 01:15:00+00'::timestamptz),
      ('92b3acdb-eddd-4162-b8ee-58ea18b90abd'::uuid, '2026-11-02 22:00:00+00'::timestamptz, '2026-11-03 01:30:00+00'::timestamptz),
      ('c6a0efb2-c668-48fd-a954-7c56e389a9fe'::uuid, '2026-11-02 22:00:00+00'::timestamptz, '2026-11-03 01:30:00+00'::timestamptz),
      ('2932d8c3-eb6a-4c0a-a6fe-db075255f5c4'::uuid, '2026-11-02 22:15:00+00'::timestamptz, '2026-11-03 01:45:00+00'::timestamptz),
      ('90603e12-b9e1-46a0-aa48-8f1880b9a77d'::uuid, '2026-11-02 22:30:00+00'::timestamptz, '2026-11-03 02:00:00+00'::timestamptz),
      ('83815033-02a7-4e25-adde-cad5992ec8bb'::uuid, '2026-11-02 23:00:00+00'::timestamptz, '2026-11-03 02:30:00+00'::timestamptz),
      ('e24f2f82-c8e6-4141-8ff2-93f082947c02'::uuid, '2026-11-02 23:30:00+00'::timestamptz, '2026-11-03 03:00:00+00'::timestamptz),
      ('0ed2aeb4-7c86-4544-aa37-1f6445acccd2'::uuid, '2026-11-02 23:45:00+00'::timestamptz, '2026-11-03 03:15:00+00'::timestamptz),
      ('13c60a03-75a9-4301-a17f-b7e7ff69ba6d'::uuid, '2026-11-02 23:45:00+00'::timestamptz, '2026-11-03 03:15:00+00'::timestamptz),
      ('6c38d6e5-1558-4504-8375-002fb6cf586c'::uuid, '2026-11-03 00:00:00+00'::timestamptz, '2026-11-03 03:30:00+00'::timestamptz),
      ('96019aab-25ed-4b13-8228-0f4852659299'::uuid, '2026-11-03 00:00:00+00'::timestamptz, '2026-11-03 03:30:00+00'::timestamptz)
  )
  UPDATE public.tournaments t
  SET start_time = target_mtts.shifted_start_time,
      updated_at = now()
  FROM target_mtts
  WHERE t.id = target_mtts.id
    AND t.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid
    AND t.status = 'REGISTERING'
    AND t.start_time = target_mtts.original_start_time;

  WITH target_mtts(id, shifted_start_time) AS (
    VALUES
      ('37ad7860-3743-46e6-9a39-6701aa1b648a'::uuid, '2026-11-02 23:00:00+00'::timestamptz),
      ('6b504816-aec0-49f9-8c5c-89baacc37f3b'::uuid, '2026-11-02 23:45:00+00'::timestamptz),
      ('bc8150f7-e744-465a-a3bf-8a6e6804e2a1'::uuid, '2026-11-03 00:00:00+00'::timestamptz),
      ('0d73ad93-ae1e-4ddd-9926-94833e26b006'::uuid, '2026-11-03 00:15:00+00'::timestamptz),
      ('fb2d3bb5-f092-4b9a-80dd-517b9ec04ee9'::uuid, '2026-11-03 00:30:00+00'::timestamptz),
      ('0778af66-7924-44dd-b537-56af19adf1ad'::uuid, '2026-11-03 01:00:00+00'::timestamptz),
      ('31ac3b30-0b30-4d52-af51-b6d9313821c8'::uuid, '2026-11-03 01:15:00+00'::timestamptz),
      ('5c0f2270-9494-496f-8d89-2c03f6964dd1'::uuid, '2026-11-03 01:15:00+00'::timestamptz),
      ('92b3acdb-eddd-4162-b8ee-58ea18b90abd'::uuid, '2026-11-03 01:30:00+00'::timestamptz),
      ('c6a0efb2-c668-48fd-a954-7c56e389a9fe'::uuid, '2026-11-03 01:30:00+00'::timestamptz),
      ('2932d8c3-eb6a-4c0a-a6fe-db075255f5c4'::uuid, '2026-11-03 01:45:00+00'::timestamptz),
      ('90603e12-b9e1-46a0-aa48-8f1880b9a77d'::uuid, '2026-11-03 02:00:00+00'::timestamptz),
      ('83815033-02a7-4e25-adde-cad5992ec8bb'::uuid, '2026-11-03 02:30:00+00'::timestamptz),
      ('e24f2f82-c8e6-4141-8ff2-93f082947c02'::uuid, '2026-11-03 03:00:00+00'::timestamptz),
      ('0ed2aeb4-7c86-4544-aa37-1f6445acccd2'::uuid, '2026-11-03 03:15:00+00'::timestamptz),
      ('13c60a03-75a9-4301-a17f-b7e7ff69ba6d'::uuid, '2026-11-03 03:15:00+00'::timestamptz),
      ('6c38d6e5-1558-4504-8375-002fb6cf586c'::uuid, '2026-11-03 03:30:00+00'::timestamptz),
      ('96019aab-25ed-4b13-8228-0f4852659299'::uuid, '2026-11-03 03:30:00+00'::timestamptz)
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE t.start_time = target_mtts.shifted_start_time)::integer
  INTO v_expected_count, v_verified_count
  FROM public.tournaments t
  JOIN target_mtts ON target_mtts.id = t.id
  WHERE t.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid
    AND t.status = 'REGISTERING';

  IF v_verified_count <> v_expected_count THEN
    RAISE EXCEPTION 'midway_mtt_schedule_shift_verification_failed: expected % shifted Midway Union MTTs, found %',
      v_expected_count, v_verified_count
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMIT;
