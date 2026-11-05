-- ═══════════════════════════════════════════════════════════════════════════
-- LOBBY FAVORITES AND FILTERS ARE DURABLE ACCOUNT PREFERENCES (Dan 2026-11-05)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan: "favorites and filters are durable account preferences whose saved
-- values change only through the account owner's explicit action or
-- authorized account deletion."
--
-- ROOT CAUSES, measured on production 2026-11-05:
--
--   TOURNAMENT STARS stored one RUN's id. Every scheduled event inserts a new
--     tournaments row per run, so all 25 stored stars sat on completed,
--     cancelled or finishing runs while 2-31 live runs of the same schedule
--     showed unstarred. One player re-starred the same event on four days.
--   CASH STARS stored one TABLE id (favorite_tables, ON DELETE CASCADE to
--     tables). A rebuilt table left the star behind and deleting the old row
--     deleted the star.
--   FILTERS were written under the signed-out key whenever the access token
--     had aged out (client fix, same change).
--   STALE REPLAY: a device holding an unconfirmed older choice re-sent it on
--     its next open and overwrote a newer choice made on another device.
--
-- IDENTITY. A favorite follows the GAME, never a display name:
--   schedule:<tournament_schedules.id>  every run of one recurring tournament.
--       A schedule yields exactly one tournament type; renames by the club
--       (measured: "Satellite $5" -> "Satellite 5") keep the star.
--   catalog:<md5 of the game definition>  Sit N Go / Spin / unscheduled
--       satellite games the engine respawns from its catalogue. The definition
--       is club, union, type, game, variant, buy-in, fee, field size, table
--       size, speed, stack, spin type and every format flag, plus for a
--       satellite the recurring event it feeds. Measured: each live definition
--       maps to exactly one game, and the same name appears as up to four
--       different games across clubs, which name matching would have merged.
--   tournament:<id>  a one-off event with no schedule: that event itself.
--   cash_game:<cash_games.id>  the club's cash game definition (club,
--       variant, stakes, format). Every live cash table belongs to one, and a
--       rebuilt table keeps it. Measured: a table named "PLO5 1/2 Madness"
--       belongs to the game "PLO5 1.00/2.00 Lightning Games", and a Classic
--       "PLO5 2/5 Madness" game replaced a Madness game of the same name;
--       name matching would have starred the wrong game in both cases.
--   table:<id>  only for a legacy cash table with no game definition.
--
-- NOTHING ERASES A STAR. player_lobby_favorites has no foreign key to tables,
-- tournaments or cash_games (CLAUDE.md DDL rule 7, and so no rebuild, run end
-- or cleanup can cascade into it). A finished run, a closed table or a game
-- that is temporarily not running simply has no live row to light; the saved
-- choice stays and lights again when the game does.
--
-- OWNER-ONLY WRITES, ENFORCED BY THE DATABASE. On player_lobby_favorites,
-- user_lobby_filters and user_page_preferences every insert, update and delete
-- must be made by the signed-in owner (auth.uid() = user_id), except the
-- cascade from deleting the account itself. TRUNCATE is refused. Measured
-- before this change: nothing but the player's own browser writes these
-- tables, and their past deletions came from account deletions.
--
-- NEWER CHOICE WINS, ENFORCED BY THE DATABASE. Writes carry the time the
-- player made the choice. An update whose choice is older than the stored one
-- keeps the stored value instead, so a late replay cannot undo a newer pick.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ── Favorites ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.player_lobby_favorites (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('cash', 'tournament')),
  game_key   text        NOT NULL CHECK (length(game_key) BETWEEN 1 AND 400),
  club_id    uuid,
  label      text        CHECK (label IS NULL OR length(label) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, game_key)
);

COMMENT ON TABLE public.player_lobby_favorites IS
  'A player''s starred lobby games, keyed by the game (schedule, catalogue definition, cash game definition), never by a name, one table or one run. No FK to tables, tournaments or cash_games by design. Written only by fn_set_lobby_favorite; removed only by the owner''s unfavorite or account deletion.';

ALTER TABLE public.player_lobby_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_lobby_favorites_select_own ON public.player_lobby_favorites;
CREATE POLICY player_lobby_favorites_select_own ON public.player_lobby_favorites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.player_lobby_favorites FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.player_lobby_favorites TO authenticated;

-- ── The one definition of "which game is this" ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lobby_tournament_key(t public.tournaments)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN t.schedule_id IS NOT NULL THEN 'schedule:' || t.schedule_id::text
    WHEN upper(coalesce(t.tournament_type, '')) IN ('SNG', 'SPIN', 'SATELLITE')
      OR t.satellite_target_id IS NOT NULL THEN
      'catalog:' || md5(concat_ws('|',
        coalesce(t.club_id::text, ''), coalesce(t.union_id::text, ''),
        upper(coalesce(t.tournament_type, '')), lower(coalesce(t.game_type, '')),
        lower(coalesce(t.variant, '')),
        coalesce(t.buy_in_amount::text, ''), coalesce(t.buy_in_fee::text, ''),
        coalesce(t.max_players::text, ''), coalesce(t.table_size::text, ''),
        lower(coalesce(t.blind_speed, '')), coalesce(t.starting_chips::text, ''),
        lower(coalesce(t.spin_type, '')),
        coalesce(t.is_premium_spin, false)::text, coalesce(t.is_bounty, false)::text,
        coalesce(t.is_pko, false)::text, coalesce(t.is_mystery_bounty, false)::text,
        coalesce(t.is_rebuy, false)::text, coalesce(t.is_reentry, false)::text,
        coalesce(t.add_on_available, false)::text, coalesce(t.is_vip_only, false)::text,
        coalesce(t.is_private, false)::text,
        CASE WHEN t.satellite_target_id IS NULL THEN ''
             ELSE coalesce((SELECT 'schedule:' || tt.schedule_id::text
                              FROM public.tournaments tt
                             WHERE tt.id = t.satellite_target_id AND tt.schedule_id IS NOT NULL),
                           'run:' || t.satellite_target_id::text) END))
    ELSE 'tournament:' || t.id::text
  END
$$;

CREATE OR REPLACE FUNCTION public.fn_lobby_cash_key(tb public.tables)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN tb.cluster_id IS NOT NULL THEN 'cash_game:' || tb.cluster_id::text
              ELSE 'table:' || tb.id::text END
$$;

CREATE OR REPLACE FUNCTION public.fn_lobby_favorite_key(p_kind text, p_game_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_kind = 'tournament' THEN
      (SELECT public.fn_lobby_tournament_key(t) FROM public.tournaments t WHERE t.id = p_game_id)
    WHEN p_kind = 'cash' THEN
      (SELECT public.fn_lobby_cash_key(tb) FROM public.tables tb
        WHERE tb.id = p_game_id AND tb.tournament_id IS NULL)
  END
$$;

REVOKE ALL ON FUNCTION public.fn_lobby_tournament_key(public.tournaments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lobby_cash_key(public.tables) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lobby_favorite_key(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── Owner-only writes and newer-choice-wins, for every preference store ─────
CREATE OR REPLACE FUNCTION public.fn_player_preference_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '% cannot be truncated: saved preferences change only through their owner', TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_uid IS NOT NULL AND v_uid = OLD.user_id THEN RETURN OLD; END IF;
    -- The account itself is being deleted (the FK cascade runs after it).
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION '% rows are removed only by their owner or by deleting the account', TG_TABLE_NAME;
  END IF;

  IF v_uid IS NULL OR v_uid <> NEW.user_id THEN
    RAISE EXCEPTION '% is written only by its owner', TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION '% owner is immutable', TG_TABLE_NAME;
    END IF;
    -- A late replay of an older choice keeps the newer stored one.
    IF TG_TABLE_NAME = 'user_lobby_filters' THEN
      IF NEW.filters IS DISTINCT FROM OLD.filters
         AND NEW.filters_changed_at IS NOT NULL AND OLD.filters_changed_at IS NOT NULL
         AND NEW.filters_changed_at < OLD.filters_changed_at THEN
        NEW.filters := OLD.filters;
        NEW.filters_changed_at := OLD.filters_changed_at;
      END IF;
      IF NEW.view_prefs IS DISTINCT FROM OLD.view_prefs
         AND NEW.view_prefs_changed_at IS NOT NULL AND OLD.view_prefs_changed_at IS NOT NULL
         AND NEW.view_prefs_changed_at < OLD.view_prefs_changed_at THEN
        NEW.view_prefs := OLD.view_prefs;
        NEW.view_prefs_changed_at := OLD.view_prefs_changed_at;
      END IF;
    ELSIF TG_TABLE_NAME = 'user_page_preferences' THEN
      IF NEW.preference_key IS DISTINCT FROM OLD.preference_key THEN
        RAISE EXCEPTION 'user_page_preferences key is immutable';
      END IF;
      IF NEW.value IS DISTINCT FROM OLD.value
         AND NEW.changed_at IS NOT NULL AND OLD.changed_at IS NOT NULL
         AND NEW.changed_at < OLD.changed_at THEN
        NEW.value := OLD.value;
        NEW.changed_at := OLD.changed_at;
      END IF;
    ELSIF TG_TABLE_NAME = 'player_lobby_favorites' THEN
      IF (NEW.kind, NEW.game_key) IS DISTINCT FROM (OLD.kind, OLD.game_key) THEN
        RAISE EXCEPTION 'player_lobby_favorites identity is immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.fn_player_preference_guard() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.user_lobby_filters
  ADD COLUMN IF NOT EXISTS filters_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_prefs_changed_at timestamptz;
ALTER TABLE public.user_page_preferences
  ADD COLUMN IF NOT EXISTS changed_at timestamptz;

DROP TRIGGER IF EXISTS trg_player_lobby_favorites_guard ON public.player_lobby_favorites;
CREATE TRIGGER trg_player_lobby_favorites_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.player_lobby_favorites
  FOR EACH ROW EXECUTE FUNCTION public.fn_player_preference_guard();
DROP TRIGGER IF EXISTS trg_player_lobby_favorites_no_truncate ON public.player_lobby_favorites;
CREATE TRIGGER trg_player_lobby_favorites_no_truncate
  BEFORE TRUNCATE ON public.player_lobby_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_player_preference_guard();

DROP TRIGGER IF EXISTS trg_user_lobby_filters_guard ON public.user_lobby_filters;
CREATE TRIGGER trg_user_lobby_filters_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_lobby_filters
  FOR EACH ROW EXECUTE FUNCTION public.fn_player_preference_guard();
DROP TRIGGER IF EXISTS trg_user_lobby_filters_no_truncate ON public.user_lobby_filters;
CREATE TRIGGER trg_user_lobby_filters_no_truncate
  BEFORE TRUNCATE ON public.user_lobby_filters
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_player_preference_guard();

DROP TRIGGER IF EXISTS trg_user_page_preferences_guard ON public.user_page_preferences;
CREATE TRIGGER trg_user_page_preferences_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_page_preferences
  FOR EACH ROW EXECUTE FUNCTION public.fn_player_preference_guard();
DROP TRIGGER IF EXISTS trg_user_page_preferences_no_truncate ON public.user_page_preferences;
CREATE TRIGGER trg_user_page_preferences_no_truncate
  BEFORE TRUNCATE ON public.user_page_preferences
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_player_preference_guard();

-- ── Star / unstar: the only write path for favorites ────────────────────────
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
  v_club  uuid;
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
      SELECT left(name, 200), club_id INTO v_label, v_club FROM public.tournaments WHERE id = p_game_id;
    ELSE
      SELECT left(name, 200), club_id INTO v_label, v_club FROM public.tables WHERE id = p_game_id;
    END IF;
    INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, club_id, label)
    VALUES (v_uid, p_kind, v_key, v_club, v_label)
    ON CONFLICT (user_id, kind, game_key) DO NOTHING;
  ELSE
    DELETE FROM public.player_lobby_favorites
     WHERE user_id = v_uid AND kind = p_kind AND game_key = v_key;
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'game_key', v_key, 'on', p_on);
END
$$;

REVOKE ALL ON FUNCTION public.fn_set_lobby_favorite(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_lobby_favorite(text, uuid, boolean) TO authenticated;

-- ── Which LIVE games carry the player's stars right now ─────────────────────
-- Live means what the lobby lists (ClubHomePage LOBBY_TOURNAMENT_STATUSES,
-- plus ANNOUNCED). The status list drives idx_tournaments_status_start_time:
-- measured 6 ms for the busiest club against 169 ms by start time.
CREATE OR REPLACE FUNCTION public.fn_my_lobby_favorites()
RETURNS TABLE (kind text, game_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT pf.kind, pf.game_key, pf.club_id
      FROM public.player_lobby_favorites pf
     WHERE pf.user_id = auth.uid()
  )
  SELECT 'tournament'::text, t.id
    FROM f JOIN public.tournaments t
      ON f.kind = 'tournament' AND f.game_key LIKE 'schedule:%'
     AND t.schedule_id = substr(f.game_key, 10)::uuid
   WHERE t.status IN ('ANNOUNCED', 'REGISTERING', 'RUNNING', 'LATE_REG', 'STARTING_SOON', 'BAGGED')
  UNION
  SELECT 'tournament'::text, t.id
    FROM f JOIN public.tournaments t
      ON f.kind = 'tournament' AND f.game_key LIKE 'catalog:%'
     AND t.club_id = f.club_id AND t.schedule_id IS NULL
   WHERE t.status IN ('ANNOUNCED', 'REGISTERING', 'RUNNING', 'LATE_REG', 'STARTING_SOON', 'BAGGED')
     AND public.fn_lobby_tournament_key(t) = f.game_key
  UNION
  SELECT 'tournament'::text, t.id
    FROM f JOIN public.tournaments t
      ON f.kind = 'tournament' AND f.game_key LIKE 'tournament:%'
     AND t.id = substr(f.game_key, 12)::uuid
   WHERE t.status IN ('ANNOUNCED', 'REGISTERING', 'RUNNING', 'LATE_REG', 'STARTING_SOON', 'BAGGED')
  UNION
  SELECT 'cash'::text, tb.id
    FROM f JOIN public.tables tb
      ON f.kind = 'cash' AND f.game_key LIKE 'cash_game:%'
     AND tb.cluster_id = substr(f.game_key, 11)::uuid
   WHERE tb.tournament_id IS NULL AND tb.is_deleted IS NOT TRUE
     AND coalesce(tb.is_template, false) = false AND coalesce(tb.status, '') <> 'closed'
  UNION
  SELECT 'cash'::text, tb.id
    FROM f JOIN public.tables tb
      ON f.kind = 'cash' AND f.game_key LIKE 'table:%'
     AND tb.id = substr(f.game_key, 7)::uuid
   WHERE tb.tournament_id IS NULL AND tb.is_deleted IS NOT TRUE
     AND coalesce(tb.is_template, false) = false AND coalesce(tb.status, '') <> 'closed'
  LIMIT 2000
$$;

REVOKE ALL ON FUNCTION public.fn_my_lobby_favorites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_lobby_favorites() TO authenticated;

-- ── Carry every existing star forward, so nobody re-stars anything ──────────
-- The guard admits only the owner, so the backfill acts as each owner in turn
-- (auth.uid() reads request.jwt.claim.sub), local to this transaction.
DO $backfill$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT u.user_id FROM (
      SELECT user_id FROM public.favorite_tables
      UNION SELECT user_id FROM public.user_page_preferences
             WHERE preference_key LIKE 'lobby-tournament-favorites%') u
     WHERE EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.user_id)
  LOOP
    PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.user_id::text)::text, true);

    INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, club_id, label)
    SELECT ft.user_id, 'cash', public.fn_lobby_cash_key(tb), tb.club_id, left(tb.name, 200)
      FROM public.favorite_tables ft
      JOIN public.tables tb ON tb.id = ft.table_id AND tb.tournament_id IS NULL
     WHERE ft.user_id = r.user_id
    ON CONFLICT DO NOTHING;

    INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, club_id, label)
    SELECT p.user_id, 'tournament', public.fn_lobby_tournament_key(t), t.club_id, left(t.name, 200)
      FROM public.user_page_preferences p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p.value) = 'array' THEN p.value ELSE '[]'::jsonb END) AS ids(tid)
      JOIN public.tournaments t
        ON ids.tid ~ '^[0-9a-fA-F-]{36}$' AND t.id = ids.tid::uuid
     WHERE p.user_id = r.user_id
       AND p.preference_key LIKE 'lobby-tournament-favorites%'
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
END
$backfill$;

COMMIT;
