-- 20261118002641_kings_club_labeled_display_totals.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Disclosed Kings Club display totals for the card and all invite surfaces.
-- Keep the measured counters, union activity and persisted values intact.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

-- The same measured counters and active clamp as the lobby card.
-- Only the two disclosed display totals for club code 25450 leave this read.
CREATE FUNCTION public.fn_kings_club_display_totals()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
  v_members bigint;
  v_active bigint;
  c_member_addition constant integer := 1500;
  c_active_addition constant integer := 145;
BEGIN
  SELECT c.id INTO v_id FROM public.clubs c WHERE c.club_id = 25450;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT m.member_count INTO v_members
      FROM public.fn_batch_club_realtime_member_counts(ARRAY[v_id]) m
     WHERE m.club_id = v_id;
  EXCEPTION WHEN OTHERS THEN
    v_members := NULL;
  END;

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

  RETURN jsonb_build_object(
    'member_total', v_members + c_member_addition,
    'active_total', v_active + c_active_addition,
    'member_addition', c_member_addition,
    'active_addition', c_active_addition
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_kings_club_display_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kings_club_display_totals() TO authenticated, service_role;

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
  v_club_active_display_line text;
  v_display jsonb;
BEGIN
  SELECT c.id, c.club_id, c.name, c.asset, c.union_id INTO v_club FROM public.clubs c WHERE c.id = p_club_id;
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

  IF v_club.club_id = 25450 THEN
    v_display := public.fn_kings_club_display_totals();
    IF v_display->>'member_total' IS NOT NULL THEN
      v_members_line := to_char((v_display->>'member_total')::bigint, 'FM999,999,999,990')
        || ' KINGS CLUB Member Display Total (+'
        || to_char((v_display->>'member_addition')::bigint, 'FM999,999,999,990') || ' Configured)';
    END IF;
    IF v_display->>'active_total' IS NOT NULL THEN
      v_club_active_display_line := to_char((v_display->>'active_total')::bigint, 'FM999,999,999,990')
        || ' KINGS CLUB Active Display Total (+'
        || to_char((v_display->>'active_addition')::bigint, 'FM999,999,999,990') || ' Configured)';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'members', v_members,
    'players_playing', v_playing,
    'horses_playing', v_horses,
    'activity_scope', v_scope,
    'activity_scope_name', CASE WHEN v_scope = 'union' THEN v_union_name ELSE v_club.name END,
    'members_line', v_members_line,
    'activity_line', v_activity_line,
    'club_active_display_line', v_club_active_display_line
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_club_share_figures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_club_share_figures(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_club_invite_resolve(p_code text, p_count_click boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text := upper(btrim(COALESCE(p_code, '')));
  v_link     record;
  v_club     record;
  v_inviter  record;
  v_active   boolean;
  v_figures  jsonb;
BEGIN
  IF v_code !~ '^[A-HJ-NP-Z2-9]{7}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_link FROM public.club_invite_links WHERE code = v_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT id, club_id, slug, name, description, logo_url, avatar_url, member_count, lifecycle_status, asset
    INTO v_club FROM public.clubs WHERE id = v_link.club_id;
  IF NOT FOUND OR COALESCE(v_club.lifecycle_status, 'active') <> 'active' THEN
    RETURN jsonb_build_object('found', false, 'code', v_code, 'reason', 'club_unavailable');
  END IF;

  SELECT id, COALESCE(NULLIF(btrim(alias), ''), username) AS username, player_number INTO v_inviter FROM public.profiles WHERE id = v_link.inviter_id;

  SELECT EXISTS (
    SELECT 1 FROM public.club_members cm
     WHERE cm.club_id = v_link.club_id AND cm.user_id = v_link.inviter_id
       AND cm.status IN ('active', 'approved', 'automatic')
  ) INTO v_active;

  -- Measured members of this club, and distinct players on the floor it plays
  -- on, each with the words that say which is which.
  BEGIN
    v_figures := public.fn_club_share_figures(v_club.id);
  EXCEPTION WHEN OTHERS THEN
    v_figures := NULL;
  END;

  -- Only the landing page's server request (service role, no auth.uid()) counts
  -- an open; it skips link-preview bots and repeat opens from the same browser.
  -- A signed-in caller can no longer inflate the count.
  IF p_count_click AND v_uid IS NULL THEN
    UPDATE public.club_invite_links
       SET click_count = click_count + 1, last_clicked_at = now()
     WHERE code = v_code;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'code', v_code,
    'club', jsonb_build_object(
      'id', v_club.id, 'club_id', v_club.club_id, 'slug', v_club.slug, 'name', v_club.name,
      'description', v_club.description,
      'logo_url', COALESCE(v_club.logo_url, v_club.avatar_url),
      'member_count', v_figures->'members',
      'players_playing', v_figures->'players_playing',
      'activity_scope', v_figures->>'activity_scope',
      'activity_scope_name', v_figures->>'activity_scope_name',
      'members_line', v_figures->>'members_line',
      'activity_line', v_figures->>'activity_line',
      'club_active_display_line', v_figures->>'club_active_display_line'
    ),
    'inviter', jsonb_build_object(
      'alias', COALESCE(NULLIF(btrim(v_inviter.username), ''), 'A Club Member'),
      'player_number', v_inviter.player_number,
      'active', v_active
    ),
    'join_path', public.fn_club_invite_join_path(v_link.club_id, v_link.inviter_id, v_code),
    'expires_after_days', 30
  );
END $$;

-- 3b. The copied message travels with the same two lines.

COMMIT;
