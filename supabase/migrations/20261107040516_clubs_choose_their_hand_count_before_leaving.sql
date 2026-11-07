-- @install-window: daily-maintenance
-- 20261107040516_clubs_choose_their_hand_count_before_leaving.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- HIT AND RUN, A CLUB SETTING (owner 2026-11-06, "GO AHEAD AND FULLY BUILD").
-- The rule stays on for every cash game by default, 10 hands, plus 10 per
-- Charles Rule double. A club's owner, co-owner or admin may now switch it
-- off for the cash games the club hosts, or choose 5, 10, 15 or 20 hands
-- (the same number is added per double). A new number applies to countdowns
-- that start after it is saved; switching the rule off clears every open
-- countdown at the club's tables at once (the engine's own copy follows at
-- the next hand). Nothing else about the rule changes. No money moves.
--
-- Reads the image 20261106203853 installs, so it installs in the same daily
-- window, after it; the md5 below is that image.
-- @live-proof: (to_regprocedure('public.fn_set_club_hit_run(uuid,boolean,integer)') IS NOT NULL AND position('v_hr_hands' in pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS hit_run_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hit_run_hands integer NOT NULL DEFAULT 10;
ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_hit_run_hands_choice CHECK (hit_run_hands IN (5, 10, 15, 20)) NOT VALID;
COMMENT ON COLUMN public.clubs.hit_run_enabled IS
  'Hit and run: players in profit must play the hand count before leaving this club''s cash games.';
COMMENT ON COLUMN public.clubs.hit_run_hands IS
  'Hit and run: hands owed in profit (and added per Charles Rule double) at this club''s cash games.';

DO $patch$
DECLARE
  s text;
  p text;
  pairs text[][] := ARRAY[
    ARRAY[$a$  v_started timestamptz;
BEGIN
$a$, $b$  v_started timestamptz;
  v_hr_on boolean; v_hr_hands integer;
BEGIN
$b$],
    ARRAY[$a$  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN v_out; END IF;
$a$, $b$  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN v_out; END IF;
  -- The hosting club's choice (20261107 club setting): on and 10 by default.
  SELECT c.hit_run_enabled, c.hit_run_hands INTO v_hr_on, v_hr_hands
    FROM public.tables t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = p_table_id;
  v_hr_on := coalesce(v_hr_on, true);
  v_hr_hands := coalesce(v_hr_hands, 10);
$b$],
    ARRAY[$a$        IF NOT v_done THEN
          IF v_req = 0 THEN
$a$, $b$        IF NOT v_hr_on THEN
          v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
        ELSIF NOT v_done THEN
          IF v_req = 0 THEN
$b$],
    ARRAY['v_req := 10; v_played := 0;', 'v_req := v_hr_hands; v_played := 0;'],
    ARRAY['v_req := v_req + 10;', 'v_req := v_req + v_hr_hands;']
  ];
  i int;
BEGIN
  s := pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure);
  IF md5(s) IS DISTINCT FROM '554822ec475ed772a0b4065b2aabb096' THEN
    RAISE EXCEPTION 'HIT_RUN_CLUB_SETTING_SOURCE_CHANGED';
  END IF;
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    p := pairs[i][1];
    IF (length(s) - length(replace(s, p, ''))) / length(p) <> 1 THEN
      RAISE EXCEPTION 'HIT_RUN_CLUB_SETTING_ANCHOR_CHANGED %', i;
    END IF;
    s := replace(s, p, pairs[i][2]);
  END LOOP;
  EXECUTE s;
END $patch$;

-- Read: any member of the club (and its staff) sees the club's choice.
CREATE FUNCTION public.fn_club_hit_run_setting(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL OR public.fn_club_role(auth.uid(), p_club_id) IS NULL THEN NULL
    ELSE (SELECT jsonb_build_object(
            'contract', 'club_hit_run_setting.v1',
            'club_id', c.id,
            'enabled', c.hit_run_enabled,
            'hands', c.hit_run_hands,
            'can_edit', public.fn_ca_is_club_staff(c.id, auth.uid()))
            FROM public.clubs c WHERE c.id = p_club_id)
  END;
$function$;

-- Write: the club's owner, co-owners and admins only.
CREATE FUNCTION public.fn_set_club_hit_run(p_club_id uuid, p_enabled boolean, p_hands integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cleared integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;
  IF p_club_id IS NULL OR p_enabled IS NULL OR p_hands IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'incomplete');
  END IF;
  IF p_hands NOT IN (5, 10, 15, 20) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hands_not_offered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'club_not_found');
  END IF;
  IF NOT public.fn_ca_is_club_staff(p_club_id, auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_club_admin');
  END IF;
  UPDATE public.clubs SET hit_run_enabled = p_enabled, hit_run_hands = p_hands
   WHERE id = p_club_id;
  IF NOT p_enabled THEN
    UPDATE public.cash_player_session s
       SET hr_hands_required = 0, hr_hands_played = 0, hr_reference_stack = NULL,
           hr_doubles = 0, hr_started_at = NULL
      FROM public.tables t
     WHERE t.id = s.table_id AND t.club_id = p_club_id
       AND s.closed_at IS NULL AND NOT s.hr_completed AND s.hr_hands_required > 0;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled, 'hands', p_hands,
                            'countdowns_cleared', v_cleared);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_club_hit_run_setting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_hit_run_setting(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_set_club_hit_run(uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_club_hit_run(uuid, boolean, integer) TO authenticated, service_role;

-- The patched evaluator keeps its engine-only gate and its grants.
REVOKE ALL ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) TO service_role;

DO $verify$
BEGIN
  IF position('v_req := v_req + v_hr_hands;' in
       pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'HIT_RUN_CLUB_SETTING_NOT_APPLIED';
  END IF;
END $verify$;
COMMIT;
