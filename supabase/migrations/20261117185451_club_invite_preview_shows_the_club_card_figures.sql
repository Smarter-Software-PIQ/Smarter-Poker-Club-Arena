-- 20261117185451_club_invite_preview_shows_the_club_card_figures.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-17 12:47 CT):
--
--   "the links sent must match the kings club card. (that number is the one we
--   want sent)"
--
-- A Share & Invite link (smarter.poker/i/<code>) previewed "155 Members | 614
-- Playing Now" while the KINGS CLUB card on the home carousel showed MEMBERS
-- 1,655 and ACTIVE 236. The two read different sources:
--
--   card     live member count (fn_batch_club_realtime_member_counts)
--            + the owner's labelled display addition, and live active players
--            (fn_batch_club_realtime_active_counts, never above members)
--            + the labelled active addition (HomePage.tsx / ClubCardPanel.tsx)
--   invite   the denormalised clubs.member_count and get_club_players_playing,
--            with no display addition at all.
--
-- fn_club_card_figures is now the one server definition of the card's two
-- figures, and fn_club_invite_resolve reads it. The invite landing page, its
-- link-preview description and its OG image all print what fn_club_invite_resolve
-- returns, so every preview now matches the card.
--
-- The Diamond Arena is the one card that does not use the membership counts:
-- its membership is an entitlement row, so the card shows its live seats from
-- get_club_players_playing. fn_club_card_figures answers it the same way.
--
-- Nothing else in the resolver changes: click counting, inviter, join path and
-- ACL are identical to 20261016040136.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_club_card_figures(p_club_id uuid)
RETURNS TABLE(members integer, active integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_arena      constant uuid := '002c2d27-9584-4e52-835a-bb2be148fc81';
  v_members    integer;
  v_active     integer;
  v_add_m      integer := 0;
  v_add_a      integer := 0;
BEGIN
  IF p_club_id IS NULL THEN
    RETURN;
  END IF;

  IF p_club_id = v_arena THEN
    SELECT COALESCE(c.member_count, 0) INTO v_members FROM public.clubs c WHERE c.id = p_club_id;
    BEGIN
      v_active := public.get_club_players_playing(p_club_id::text);
    EXCEPTION WHEN OTHERS THEN
      v_active := NULL;
    END;
    RETURN QUERY SELECT COALESCE(v_members, 0), v_active;
    RETURN;
  END IF;

  SELECT m.member_count::integer INTO v_members
    FROM public.fn_batch_club_realtime_member_counts(ARRAY[p_club_id]) m
   WHERE m.club_id = p_club_id;
  v_members := COALESCE(v_members, 0);

  SELECT a.active_count::integer INTO v_active
    FROM public.fn_batch_club_realtime_active_counts(ARRAY[p_club_id]) a
   WHERE a.club_id = p_club_id;
  v_active := COALESCE(v_active, 0);
  -- Active players cannot exceed members, clamped only when members is known.
  IF v_members > 0 THEN
    v_active := LEAST(v_active, v_members);
  END IF;

  SELECT GREATEST(0, COALESCE(d.member_addition, 0)), GREATEST(0, COALESCE(d.active_addition, 0))
    INTO v_add_m, v_add_a
    FROM public.fn_club_display_labeled_additions(ARRAY[p_club_id]) d
   WHERE d.club_id = p_club_id;

  RETURN QUERY SELECT v_members + COALESCE(v_add_m, 0), v_active + COALESCE(v_add_a, 0);
END $$;

REVOKE ALL ON FUNCTION public.fn_club_card_figures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_club_card_figures(uuid) TO service_role;

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
  v_members  integer;
  v_playing  integer;
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

  -- The same two figures the club's card shows (MEMBERS and ACTIVE).
  BEGIN
    SELECT f.members, f.active INTO v_members, v_playing
      FROM public.fn_club_card_figures(v_club.id) f;
  EXCEPTION WHEN OTHERS THEN
    v_members := NULL;
    v_playing := NULL;
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
      'member_count', COALESCE(v_members, v_club.member_count, 0),
      'players_playing', v_playing
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

COMMIT;
