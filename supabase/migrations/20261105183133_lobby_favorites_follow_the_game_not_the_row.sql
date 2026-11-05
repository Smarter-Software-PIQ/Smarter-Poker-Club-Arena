-- ═══════════════════════════════════════════════════════════════════════════
-- LOBBY FAVORITES FOLLOW THE GAME, NOT THE ROW (Dan 2026-11-05)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan: "WHEN A USER MARKS HIS FAVORITES FOR TOURNAMENTS OR CASH GAMES ... IT
-- SAVES FOR A COUPLE HOURS, OR MAYBE A DAY, BUT THEN THEY ALWAYS SEEM TO
-- SILENTLY FAIL ... ONCE SET, IT CAN NEVER EVER EVER CHANGE UNDER ANY
-- CIRCUMSTANCES UNLESS THE USER PHYSICALLY GOES IN AND CHANGES IT."
--
-- WHY EVERY EARLIER FIX REGRESSED. The favorite was never lost by the save.
-- It was attached to the wrong thing:
--
--   TOURNAMENTS  stored one RUN's tournament id (user_page_preferences
--                'lobby-tournament-favorites:global'). Every scheduled event
--                inserts a NEW tournaments row for each run, so the star stayed
--                on yesterday's finished row and tonight's copy came up
--                unstarred. Measured 2026-11-05: all 25 stored tournament
--                favorites pointed at a COMPLETED, CANCELLED or soon-finished
--                run while 2-31 live runs of the same schedule sat unstarred,
--                and one player had re-starred "Afternoon Free Buy" on four
--                separate days.
--   CASH         stored one TABLE id in favorite_tables with
--                ON DELETE CASCADE to tables. A cash game rebuilt by its owner
--                (new table row, same game) left the star on the closed table,
--                and deleting the old row deleted the favorite outright.
--
-- THE FIX. A favorite is a row keyed by the GAME (the schedule, or the club's
-- named cash game / tournament series), owned by the player, with NO foreign
-- key to tables or tournaments -- so no table rebuild, tournament run,
-- cleanup job or cascade can ever take it away (and per CLAUDE.md DDL rule 7
-- a hot-table foreign key is not allowed here anyway). The lobby asks the
-- database which LIVE rows match the player's favorites, so tomorrow's run and
-- a rebuilt table are starred automatically.
--
-- HARDENED. Only the player's own Unfavorite (fn_set_lobby_favorite with
-- p_on = false) or closing the account can remove a favorite. Any other
-- DELETE, UPDATE of identity, or TRUNCATE is refused by the database itself.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.player_lobby_favorites (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('cash', 'tournament')),
  game_key   text        NOT NULL CHECK (length(game_key) BETWEEN 1 AND 400),
  label      text        CHECK (label IS NULL OR length(label) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, game_key)
);

COMMENT ON TABLE public.player_lobby_favorites IS
  'A player''s starred lobby games, keyed by the game (schedule / club cash game / tournament series), never by one table or run. No FK to tables or tournaments by design. Rows are removed only by the player''s own unfavorite (fn_set_lobby_favorite) or account closure; the guard trigger refuses everything else.';

ALTER TABLE public.player_lobby_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_lobby_favorites_select_own ON public.player_lobby_favorites;
CREATE POLICY player_lobby_favorites_select_own ON public.player_lobby_favorites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON public.player_lobby_favorites FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.player_lobby_favorites TO authenticated;

-- ── The one definition of "which game is this" ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lobby_favorite_key(p_kind text, p_game_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_kind = 'tournament' THEN (
      SELECT CASE
        WHEN t.schedule_id IS NOT NULL THEN 'schedule:' || t.schedule_id::text
        ELSE 'series:' || coalesce(t.club_id::text, '') || ':' ||
             upper(coalesce(t.tournament_type, '')) || ':' || lower(btrim(t.name))
      END
      FROM public.tournaments t WHERE t.id = p_game_id)
    WHEN p_kind = 'cash' THEN (
      SELECT 'cash:' || coalesce(tb.club_id::text, '') || ':' || lower(btrim(tb.name))
      FROM public.tables tb WHERE tb.id = p_game_id AND tb.tournament_id IS NULL)
  END
$$;

REVOKE ALL ON FUNCTION public.fn_lobby_favorite_key(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── The guard: nothing but the player (or account closure) removes a star ───
CREATE OR REPLACE FUNCTION public.fn_player_lobby_favorites_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'player_lobby_favorites cannot be truncated: favorites change only when the player changes them';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.game_key IS DISTINCT FROM OLD.game_key THEN
      RAISE EXCEPTION 'player_lobby_favorites identity is immutable';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: the player's own unfavorite, or the account itself is gone.
  IF current_setting('ca.lobby_favorite_unstar', true) = OLD.user_id::text THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'player_lobby_favorites rows are removed only by the player''s own unfavorite';
END
$$;

DROP TRIGGER IF EXISTS trg_player_lobby_favorites_guard ON public.player_lobby_favorites;
CREATE TRIGGER trg_player_lobby_favorites_guard
  BEFORE UPDATE OR DELETE ON public.player_lobby_favorites
  FOR EACH ROW EXECUTE FUNCTION public.fn_player_lobby_favorites_guard();

DROP TRIGGER IF EXISTS trg_player_lobby_favorites_no_truncate ON public.player_lobby_favorites;
CREATE TRIGGER trg_player_lobby_favorites_no_truncate
  BEFORE TRUNCATE ON public.player_lobby_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_player_lobby_favorites_guard();

-- ── Star / unstar: the only write path ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_lobby_favorite(p_kind text, p_game_id uuid, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_key   text;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sign in to save favorites' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('cash', 'tournament') THEN
    RAISE EXCEPTION 'unknown favorite kind %', p_kind USING ERRCODE = '22023';
  END IF;
  v_key := public.fn_lobby_favorite_key(p_kind, p_game_id);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'that game no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF p_on THEN
    IF p_kind = 'tournament' THEN
      SELECT left(name, 200) INTO v_label FROM public.tournaments WHERE id = p_game_id;
    ELSE
      SELECT left(name, 200) INTO v_label FROM public.tables WHERE id = p_game_id;
    END IF;
    INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, label)
    VALUES (v_uid, p_kind, v_key, v_label)
    ON CONFLICT (user_id, kind, game_key) DO NOTHING;
  ELSE
    PERFORM set_config('ca.lobby_favorite_unstar', v_uid::text, true);
    DELETE FROM public.player_lobby_favorites
     WHERE user_id = v_uid AND kind = p_kind AND game_key = v_key;
    PERFORM set_config('ca.lobby_favorite_unstar', '', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'game_key', v_key, 'on', p_on);
END
$$;

REVOKE ALL ON FUNCTION public.fn_set_lobby_favorite(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_lobby_favorite(text, uuid, boolean) TO authenticated;

-- ── Which LIVE games carry the player's stars right now ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_my_lobby_favorites()
RETURNS TABLE (kind text, game_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT pf.kind, pf.game_key FROM public.player_lobby_favorites pf
    WHERE pf.user_id = auth.uid()
  )
  -- Scheduled tournaments: every live run of the schedule.
  SELECT 'tournament'::text, t.id
    FROM f JOIN public.tournaments t
      ON f.kind = 'tournament' AND f.game_key LIKE 'schedule:%'
     AND t.schedule_id = substr(f.game_key, 10)::uuid
   WHERE upper(coalesce(t.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'FINISHED')
  UNION
  -- Unscheduled series (Spins, Sit N Go's, one-offs): same club, type and name.
  SELECT 'tournament'::text, t.id
    FROM f JOIN public.tournaments t
      ON f.kind = 'tournament' AND f.game_key LIKE 'series:%'
     AND t.club_id::text = split_part(f.game_key, ':', 2)
     AND upper(coalesce(t.tournament_type, '')) = split_part(f.game_key, ':', 3)
     AND lower(btrim(t.name)) = substr(f.game_key,
           length('series:' || split_part(f.game_key, ':', 2) || ':' || split_part(f.game_key, ':', 3) || ':') + 1)
   WHERE upper(coalesce(t.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'FINISHED')
  UNION
  -- Cash: every open table of the club's named game, including a rebuilt one.
  SELECT 'cash'::text, tb.id
    FROM f JOIN public.tables tb
      ON f.kind = 'cash'
     AND tb.club_id::text = split_part(f.game_key, ':', 2)
     AND lower(btrim(tb.name)) = substr(f.game_key, length('cash:' || split_part(f.game_key, ':', 2) || ':') + 1)
   WHERE tb.tournament_id IS NULL
     AND tb.is_deleted IS NOT TRUE
     AND coalesce(tb.is_template, false) = false
     AND coalesce(tb.status, '') <> 'closed'
  LIMIT 2000
$$;

REVOKE ALL ON FUNCTION public.fn_my_lobby_favorites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_lobby_favorites() TO authenticated;

-- ── Carry every existing star forward, so nobody re-stars anything ──────────
INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, label)
SELECT ft.user_id, 'cash', public.fn_lobby_favorite_key('cash', ft.table_id), left(tb.name, 200)
  FROM public.favorite_tables ft
  JOIN public.tables tb ON tb.id = ft.table_id AND tb.tournament_id IS NULL
 WHERE public.fn_lobby_favorite_key('cash', ft.table_id) IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, label)
SELECT p.user_id, 'tournament', public.fn_lobby_favorite_key('tournament', t.id), left(t.name, 200)
  FROM public.user_page_preferences p
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p.value) = 'array' THEN p.value ELSE '[]'::jsonb END) AS ids(tid)
  JOIN public.tournaments t
    ON ids.tid ~ '^[0-9a-fA-F-]{36}$' AND t.id = ids.tid::uuid
 WHERE p.preference_key LIKE 'lobby-tournament-favorites%'
   AND public.fn_lobby_favorite_key('tournament', t.id) IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
