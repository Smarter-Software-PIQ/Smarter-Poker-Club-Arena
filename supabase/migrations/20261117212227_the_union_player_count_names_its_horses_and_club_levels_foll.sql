-- 20261117212227_the_union_player_count_names_its_horses_and_club_levels_foll.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-17 15:18 CT):
--
--   "Keep the union count inclusive of legitimate Horse accounts, but label it
--   clearly, for example '296 Players Across Midway Union Now · Includes
--   Horses.' Do not imply 296 humans. Use dynamic values."
--   "Determine whether removing display additions actually changes levels,
--   benefits, permissions or financial behavior."
--
-- 1. fn_batch_union_floor_players(unions) is the one definition of the union
--    figure the invite and the club card print: DISTINCT accounts in a live,
--    not-away seat on the union's floor (the same floor and seat rule as
--    fn_batch_union_realtime_active_counts), with how many of them are Horses.
--    fn_club_share_figures words it "<n> Players Across <Union> Now", adding
--    " · Includes Horses" whenever at least one counted account is a Horse.
--    A club with no union counts its members seated on its own floor (the
--    card's ACTIVE read) and is worded the same way. The count itself is
--    unchanged: Horses stay in it, as in every union figure (CLAUDE.md 10.5).
--
-- 2. Levels. A club's or union's level is fn_club_level_for_members of its
--    member count, written to clubs/unions.level by fn_apply_club_ladder and
--    fn_apply_union_ladder. Traced on production 2026-11-17: no function, RLS
--    policy, engine path, Club Arena or World Hub code reads that level or
--    member count to grant a benefit, permission, limit, fee, rake, rakeback
--    or payout (Create Table's game-type unlock is fixed at level 1). Level is
--    a display figure, so it follows the measured member count. The union row
--    already did when its ladder last ran; The Felt Society and Deep Stack
--    Society still store the level of their retired +1,000 display boost
--    (35 for about 1,500 members, against 28 for their ~505 measured). Their
--    ladder is applied once here through the maintained writer so the stored
--    level, thresholds and member_count match what every card already shows.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.fn_batch_union_floor_players(p_union_ids uuid[])
RETURNS TABLE(union_id uuid, active_count bigint, horse_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH requested AS (
    SELECT DISTINCT r.union_id FROM unnest(p_union_ids) r(union_id)
  ),
  floor_tables AS (
    -- Same floor as fn_batch_union_realtime_active_counts: tables stamped with
    -- the union, the union's own club row and every member club.
    SELECT requested.union_id, t.id AS table_id
      FROM requested
      JOIN public.tables t
        ON (t.union_id = requested.union_id
            OR t.club_id = requested.union_id
            OR t.club_id IN (SELECT uc.club_id FROM public.union_clubs uc
                              WHERE uc.union_id = requested.union_id))
     WHERE lower(COALESCE(t.status, '')) NOT IN ('closed','completed','cancelled','finished')
  ),
  seated AS (
    SELECT DISTINCT f.union_id, ts.user_id
      FROM floor_tables f
      JOIN public.table_seats ts ON ts.table_id = f.table_id
       AND ts.left_at IS NULL AND COALESCE(ts.is_away, false) = false
  )
  SELECT requested.union_id,
         count(s.user_id)::bigint,
         count(s.user_id) FILTER (WHERE p.is_horse IS TRUE)::bigint
    FROM requested
    LEFT JOIN seated s ON s.union_id = requested.union_id
    LEFT JOIN public.profiles p ON p.id = s.user_id
   GROUP BY requested.union_id;
$$;
REVOKE ALL ON FUNCTION public.fn_batch_union_floor_players(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_batch_union_floor_players(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_club_share_figures(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_club        record;
  v_is_union    boolean;
  v_union_id    uuid;
  v_union_name  text;
  v_scope       text;
  v_members     integer;
  v_playing     integer;
  v_horses      integer;
  v_members_line  text;
  v_activity_line text;
BEGIN
  SELECT c.id, c.name, c.asset, c.union_id INTO v_club FROM public.clubs c WHERE c.id = p_club_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The union's own club row speaks for the whole union.
  v_is_union := EXISTS (SELECT 1 FROM public.unions u WHERE u.id = p_club_id);

  -- Members. A diamonds arena's membership is an entitlement row, not a roster,
  -- so it has no member figure to print.
  IF v_is_union THEN
    BEGIN
      SELECT m.member_count::integer INTO v_members
        FROM public.fn_batch_union_realtime_member_counts(ARRAY[p_club_id]) m
       WHERE m.union_id = p_club_id;
    EXCEPTION WHEN OTHERS THEN
      v_members := NULL;
    END;
  ELSIF COALESCE(v_club.asset, '') <> 'diamonds' THEN
    BEGIN
      SELECT m.member_count::integer INTO v_members
        FROM public.fn_batch_club_realtime_member_counts(ARRAY[p_club_id]) m
       WHERE m.club_id = p_club_id;
    EXCEPTION WHEN OTHERS THEN
      v_members := NULL;
    END;
  END IF;

  -- The floor the club plays on.
  IF v_is_union THEN
    v_union_id := p_club_id;
  ELSE
    SELECT uc.union_id INTO v_union_id FROM public.union_clubs uc WHERE uc.club_id = p_club_id LIMIT 1;
    v_union_id := COALESCE(v_union_id, v_club.union_id);
  END IF;
  IF v_union_id IS NOT NULL AND COALESCE(v_club.asset, '') <> 'diamonds' THEN
    v_scope := 'union';
    SELECT NULLIF(btrim(u.name), '') INTO v_union_name FROM public.unions u WHERE u.id = v_union_id;
    BEGIN
      SELECT a.active_count::integer, a.horse_count::integer INTO v_playing, v_horses
        FROM public.fn_batch_union_floor_players(ARRAY[v_union_id]) a
       WHERE a.union_id = v_union_id;
    EXCEPTION WHEN OTHERS THEN
      v_playing := NULL;
      v_horses := NULL;
    END;
  ELSE
    v_scope := 'club';
    BEGIN
      IF COALESCE(v_club.asset, '') = 'diamonds' THEN
        v_playing := public.fn_diamond_arena_players_playing(p_club_id);
        v_horses := NULL;
      ELSE
        -- Members seated on the club's own floor: fn_batch_club_realtime_active_counts.
        SELECT a.active_count::integer INTO v_playing
          FROM public.fn_batch_club_realtime_active_counts(ARRAY[p_club_id]) a
         WHERE a.club_id = p_club_id;
        SELECT count(DISTINCT ts.user_id)::integer INTO v_horses
          FROM public.club_members cm
          JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse IS TRUE
          JOIN public.table_seats ts ON ts.user_id = cm.user_id
           AND ts.left_at IS NULL AND COALESCE(ts.is_away, false) = false
          JOIN public.tables t ON t.id = ts.table_id AND t.club_id = p_club_id
           AND lower(COALESCE(t.status, '')) NOT IN ('closed','completed','cancelled','finished')
         WHERE cm.club_id = p_club_id
           AND (cm.status IS NULL OR cm.status IN ('active', 'approved'));
        IF v_members > 0 THEN
          v_playing := LEAST(v_playing, v_members);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_playing := NULL;
      v_horses := NULL;
    END;
  END IF;

  IF v_members IS NOT NULL THEN
    v_members_line := to_char(v_members, 'FM999,999,999,990')
      || CASE WHEN v_members = 1 THEN ' Member' ELSE ' Members' END
      || CASE WHEN v_is_union THEN ' Across ' || COALESCE(v_union_name, v_club.name)
              ELSE ' In ' || v_club.name END;
  END IF;
  IF v_playing IS NOT NULL THEN
    v_activity_line := to_char(v_playing, 'FM999,999,999,990')
      || CASE WHEN v_playing = 1 THEN ' Player' ELSE ' Players' END
      || CASE WHEN v_scope = 'union'
              THEN ' Across ' || COALESCE(v_union_name, 'The Union') || ' Now'
              ELSE ' In ' || v_club.name || ' Now' END
      || CASE WHEN COALESCE(v_horses, 0) > 0 THEN ' · Includes Horses' ELSE '' END;
  END IF;

  RETURN jsonb_build_object(
    'members', v_members,
    'players_playing', v_playing,
    'horses_playing', v_horses,
    'activity_scope', v_scope,
    'activity_scope_name', CASE WHEN v_scope = 'union' THEN v_union_name ELSE v_club.name END,
    'members_line', v_members_line,
    'activity_line', v_activity_line
  );
END $$;

-- 2. The two clubs whose stored level still carries the retired display boost.
SELECT public.fn_apply_club_ladder(b.club_id)
  FROM public.club_display_member_boost b
  JOIN public.clubs c ON c.id = b.club_id
 WHERE c.member_count IS DISTINCT FROM public.fn_get_club_realtime_member_count(b.club_id);

COMMIT;
