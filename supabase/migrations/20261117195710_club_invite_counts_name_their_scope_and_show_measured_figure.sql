-- 20261117195710_club_invite_counts_name_their_scope_and_show_measured_figure.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-17 13:49 CT):
--
--   "Finish the invite-count fix so every number accurately identifies what it
--   measures. Club membership and union-wide activity are different figures
--   and must not be presented as though both belong to KINGS CLUB."
--   "Do not present configured additions as measured members or live players."
--
-- WHAT EACH FIGURE MEASURES (traced on production 2026-11-17)
--
--   Members      club_members rows of the club with status NULL, active or
--                approved (fn_batch_club_realtime_member_counts). Measured.
--   Playing      DISTINCT accounts holding a live, not-away seat on the floor
--                the club plays on. A union member club plays on its union's
--                floor (fn_batch_union_realtime_active_counts, the same read
--                the union card uses): tables stamped with the union, the
--                union's club row and every member club. A club with no union
--                plays on its own tables. Unique players, never seats: at the
--                time of writing Midway Union held 417 occupied seats for 312
--                distinct players. It counts every account in a seat, Horses
--                included, as every union figure does (CLAUDE.md 10.5).
--   Additions    club_display_member_boost (+1,000 for The Felt Society and
--                Deep Stack Society, folded into every member count) and
--                club_display_labeled_additions (+1,500 members / +233 active
--                for KINGS CLUB, added by the club card). Both are configured
--                display figures with no member or seat behind them.
--
-- WHAT CHANGES
--
--   1. Both display additions are retired: set to zero and constrained to
--      stay zero, so every reader (card, union totals, search, invites, old
--      cached clients) shows the measured count.
--   2. fn_club_share_figures(club) is the one definition of the two figures
--      an invite carries and the exact words that name them:
--        "152 Members In KINGS CLUB"
--        "312 Playing Across Midway Union Now"   (union member club)
--        "4 Playing In <Club> Now"               (club with no union)
--      The union is the club's own (union_clubs, then clubs.union_id), never a
--      fixed name. A figure that cannot be read is NULL and its line is
--      omitted; it never becomes a zero or another metric.
--   3. fn_club_invite_resolve (landing page, link preview, preview image) and
--      fn_club_invite_link (the copied message) both return those figures.
--   4. fn_club_card_figures (20261117185451) is dropped; it folded the
--      additions into the invite and is superseded by fn_club_share_figures.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

-- 1. Configured display additions are retired and cannot return.
UPDATE public.club_display_member_boost
   SET boost = 0,
       reason = reason || ' | 2026-11-17: retired, counts show measured members only.',
       set_at = now()
 WHERE boost <> 0;
ALTER TABLE public.club_display_member_boost
  ADD CONSTRAINT club_display_member_boost_retired CHECK (boost = 0);

UPDATE public.club_display_labeled_additions
   SET member_addition = 0,
       active_addition = 0,
       reason = reason || ' | 2026-11-17: retired, counts show measured members and players only.',
       set_at = now()
 WHERE member_addition <> 0 OR active_addition <> 0;
ALTER TABLE public.club_display_labeled_additions
  ADD CONSTRAINT club_display_labeled_additions_retired
  CHECK (member_addition = 0 AND active_addition = 0);

-- 2. The figures an invite carries, and the words that name them.
DROP FUNCTION public.fn_club_card_figures(uuid);

CREATE FUNCTION public.fn_club_share_figures(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_club        record;
  v_union_id    uuid;
  v_union_name  text;
  v_scope       text;
  v_members     integer;
  v_playing     integer;
  v_members_line  text;
  v_activity_line text;
BEGIN
  SELECT c.id, c.name, c.asset, c.union_id INTO v_club FROM public.clubs c WHERE c.id = p_club_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Members. A diamonds arena's membership is an entitlement row, not a roster,
  -- so it has no member figure to print.
  IF COALESCE(v_club.asset, '') <> 'diamonds' THEN
    BEGIN
      SELECT m.member_count::integer INTO v_members
        FROM public.fn_batch_club_realtime_member_counts(ARRAY[p_club_id]) m
       WHERE m.club_id = p_club_id;
    EXCEPTION WHEN OTHERS THEN
      v_members := NULL;
    END;
  END IF;

  -- The floor the club plays on.
  SELECT uc.union_id INTO v_union_id FROM public.union_clubs uc WHERE uc.club_id = p_club_id LIMIT 1;
  v_union_id := COALESCE(v_union_id, v_club.union_id);
  IF v_union_id IS NOT NULL AND COALESCE(v_club.asset, '') <> 'diamonds' THEN
    v_scope := 'union';
    SELECT NULLIF(btrim(u.name), '') INTO v_union_name FROM public.unions u WHERE u.id = v_union_id;
    BEGIN
      SELECT a.active_count::integer INTO v_playing
        FROM public.fn_batch_union_realtime_active_counts(ARRAY[v_union_id]) a
       WHERE a.union_id = v_union_id;
    EXCEPTION WHEN OTHERS THEN
      v_playing := NULL;
    END;
  ELSE
    v_scope := 'club';
    BEGIN
      IF COALESCE(v_club.asset, '') = 'diamonds' THEN
        v_playing := public.fn_diamond_arena_players_playing(p_club_id);
      ELSE
        SELECT count(DISTINCT ts.user_id)::integer INTO v_playing
          FROM public.tables t
          JOIN public.table_seats ts ON ts.table_id = t.id
           AND ts.left_at IS NULL AND COALESCE(ts.is_away, false) = false
         WHERE t.club_id = p_club_id
           AND lower(COALESCE(t.status, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_playing := NULL;
    END;
  END IF;

  IF v_members IS NOT NULL THEN
    v_members_line := to_char(v_members, 'FM999,999,999,990')
      || CASE WHEN v_members = 1 THEN ' Member In ' ELSE ' Members In ' END
      || v_club.name;
  END IF;
  IF v_playing IS NOT NULL THEN
    v_activity_line := to_char(v_playing, 'FM999,999,999,990')
      || CASE WHEN v_scope = 'union'
              THEN ' Playing Across ' || COALESCE(v_union_name, 'The Union') || ' Now'
              ELSE ' Playing In ' || v_club.name || ' Now' END;
  END IF;

  RETURN jsonb_build_object(
    'members', v_members,
    'players_playing', v_playing,
    'activity_scope', v_scope,
    'activity_scope_name', CASE WHEN v_scope = 'union' THEN v_union_name ELSE v_club.name END,
    'members_line', v_members_line,
    'activity_line', v_activity_line
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_club_share_figures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_club_share_figures(uuid) TO service_role;

-- 3a. The landing page, link preview and preview image.
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
      'activity_line', v_figures->>'activity_line'
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
CREATE OR REPLACE FUNCTION public.fn_club_invite_link(p_club_id uuid, p_device_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_member record;
  v_club   record;
  v_code   text;
  v_alpha  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try    integer := 0;
  v_device text := NULLIF(left(btrim(COALESCE(p_device_id, '')), 128), '');
  v_figures jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;

  SELECT id, club_id, name, slug INTO v_club FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Club not found');
  END IF;

  SELECT status, role INTO v_member FROM public.club_members
   WHERE club_id = p_club_id AND user_id = v_uid;
  IF NOT FOUND OR v_member.status NOT IN ('active', 'approved', 'automatic') THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_a_member',
                              'error', 'Only club members can invite players.');
  END IF;

  SELECT code INTO v_code FROM public.club_invite_links
   WHERE club_id = p_club_id AND inviter_id = v_uid;

  IF v_code IS NULL THEN
    LOOP
      v_try := v_try + 1;
      SELECT string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '')
        INTO v_code FROM generate_series(1, 7);
      BEGIN
        INSERT INTO public.club_invite_links (code, club_id, inviter_id, inviter_device_id)
        VALUES (v_code, p_club_id, v_uid, v_device);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Either the random code was taken, or a concurrent call created this
        -- inviter's row first. Prefer the existing row.
        SELECT code INTO v_code FROM public.club_invite_links
         WHERE club_id = p_club_id AND inviter_id = v_uid;
        EXIT WHEN v_code IS NOT NULL;
        IF v_try >= 8 THEN RAISE EXCEPTION 'Could not allocate an invite code'; END IF;
      END;
    END LOOP;
  ELSIF v_device IS NOT NULL THEN
    UPDATE public.club_invite_links SET inviter_device_id = v_device
     WHERE code = v_code AND inviter_device_id IS DISTINCT FROM v_device;
  END IF;

  BEGIN
    v_figures := public.fn_club_share_figures(p_club_id);
  EXCEPTION WHEN OTHERS THEN
    v_figures := NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'code', v_code,
    'short_path', '/i/' || v_code,
    'join_path', public.fn_club_invite_join_path(p_club_id, v_uid, v_code),
    'club', jsonb_build_object('id', v_club.id, 'club_id', v_club.club_id, 'name', v_club.name, 'slug', v_club.slug),
    'figures', v_figures
  );
END $$;

COMMIT;
