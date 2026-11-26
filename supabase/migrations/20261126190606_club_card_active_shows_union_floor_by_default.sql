-- @live-proof: strpos(pg_get_functiondef('public.fn_kings_club_display_totals()'::regprocedure), 'active_source') > 0
-- @live-proof: to_regprocedure('public.fn_set_club_card_active_source(uuid,text)') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_club_card_active_source(uuid)') IS NOT NULL
-- 20261126190606_club_card_active_shows_union_floor_by_default.sql
--
-- Version reserved by scripts/new-migration.mjs.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-26 13:03 Chicago, of the Kings Club card: "THE KINGS CLUB
-- 'ACTIVE' NUMBER SHOULD DISPLAY HOW MANY PLAYERS ARE ACTIVE INSIDE THE MIDWAY
-- UNION, NOT JUST INSIDE THE CLUB. ONCE A CLUB 'JOINS THE UNION' THERE CLUB
-- DATA SHOULD REPORT WHATS 'LIVE IN THE UNION' AT THAT MOMENT. IT SHOULD NO
-- LONGER DISPLAY THERE CLUB DATA BY DEFAULT. THEY CAN CHANGE IT IN THE CLUB
-- SETTINGS IF THEY WANT TO DISPLAY THERE REAL TIME CLUB DATA, OVER UNION DATA."
--
-- A union member club has no floor of its own (every club game is removed
-- before it joins), so its card's ACTIVE figure counted only its own members
-- seated on the union floor: Kings Club read 148 (3 measured plus the 145
-- display addition) while the Midway Union floor carried hundreds.
--
-- 1. public.fn_club_card_active_source(club) is the one rule: 'union' when the
--    club is in a union and has not chosen otherwise, else 'club'. The choice
--    lives in clubs.settings->>'card_active_source' ('union' | 'club'); absent
--    means the default, 'union'. No column is added, so clubs takes no
--    ACCESS EXCLUSIVE lock and this file needs no maintenance window.
-- 2. public.fn_set_club_card_active_source(club, source) is the club settings
--    door: the same managers who may set the club message (owner, co-owner,
--    admin, manager, overseeing union), one row lock, jsonb_set so no other
--    settings key is touched.
-- 3. public.fn_kings_club_display_totals() reports the union floor (distinct
--    live seats, fn_batch_union_floor_players, the figure every union member
--    card already prints) as active_total when Kings Club's source is 'union',
--    with active_addition 0: a live union measurement carries no addition.
--    The member figures are unchanged. In 'club' mode it is exactly what it was.
--
-- No money moves. Only CREATE OR REPLACE FUNCTION; no hot-table lock.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_club_card_active_source(p_club_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN c.union_id IS NOT NULL
                AND COALESCE(c.settings->>'card_active_source', 'union') <> 'club'
             THEN 'union'
           ELSE 'club'
         END
    FROM public.clubs c
   WHERE c.id = p_club_id;
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_club_card_active_source(p_club_id uuid, p_source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_source text := lower(btrim(COALESCE(p_source, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF v_source NOT IN ('union', 'club') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_source');
  END IF;

  PERFORM 1 FROM public.clubs c WHERE c.id = p_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'club_not_found');
  END IF;

  IF NOT public.fn_can_manage_club_message(p_club_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  UPDATE public.clubs
     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{card_active_source}', to_jsonb(v_source), true)
   WHERE id = p_club_id;

  RETURN jsonb_build_object(
    'ok', true,
    'card_active_source', v_source,
    'effective_source', public.fn_club_card_active_source(p_club_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_kings_club_display_totals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_union uuid;
  v_union_name text;
  v_source text;
  v_members bigint;
  v_active bigint;
  v_active_addition integer;
  c_member_addition constant integer := 1500;
  c_active_addition constant integer := 145;
BEGIN
  SELECT c.id, c.union_id INTO v_id, v_union FROM public.clubs c WHERE c.club_id = 25450;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_source := public.fn_club_card_active_source(v_id);

  BEGIN
    SELECT m.member_count INTO v_members
      FROM public.fn_batch_club_realtime_member_counts(ARRAY[v_id]) m
     WHERE m.club_id = v_id;
  EXCEPTION WHEN OTHERS THEN
    v_members := NULL;
  END;

  IF v_source = 'union' THEN
    -- What is live in the union at this moment: distinct players holding a
    -- live seat on the union floor. A measurement, so no display addition.
    v_active_addition := 0;
    SELECT u.name INTO v_union_name FROM public.unions u WHERE u.id = v_union;
    BEGIN
      SELECT f.active_count INTO v_active
        FROM public.fn_batch_union_floor_players(ARRAY[v_union]) f
       WHERE f.union_id = v_union;
    EXCEPTION WHEN OTHERS THEN
      v_active := NULL;
    END;
  ELSE
    v_active_addition := c_active_addition;
    BEGIN
      SELECT a.active_count INTO v_active
        FROM public.fn_batch_club_realtime_active_counts(ARRAY[v_id]) a
       WHERE a.club_id = v_id;
      IF v_members > 0 AND v_active IS NOT NULL THEN
        v_active := LEAST(v_active, v_members);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_active := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'member_total', v_members + c_member_addition,
    'active_total', v_active + v_active_addition,
    'member_addition', c_member_addition,
    'active_addition', v_active_addition,
    'active_source', v_source,
    'active_union_name', v_union_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_club_card_active_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_club_card_active_source(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_set_club_card_active_source(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_club_card_active_source(uuid, text) TO authenticated, service_role;

COMMIT;
