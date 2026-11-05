-- ═══════════════════════════════════════════════════════════════════════════
-- LOBBY FAVORITES AND FILTERS ARE DURABLE ACCOUNT PREFERENCES (Dan 2026-11-05)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan: "favorites and filters are durable account preferences whose saved
-- values change only through the account owner's explicit action or
-- authorized account deletion."
--
-- ROOT CAUSES, measured on production 2026-11-05:
--   TOURNAMENT STARS stored one RUN's id; every scheduled event inserts a new
--     row per run, so all 25 stored stars sat on finished runs while 2-31 live
--     runs of the same schedule showed unstarred.
--   CASH STARS stored one TABLE id (favorite_tables, ON DELETE CASCADE).
--   FILTERS were saved under the signed-out key once the access token aged
--     out (client fix, same change).
--   WHOLE-SNAPSHOT WRITES: every save upserted the entire filter / view blob,
--     so a stale device or a replayed older snapshot overwrote newer choices,
--     and unrelated settings were rewritten with whatever that copy held.
--
-- ── IDENTITY: a favorite follows the logical game ───────────────────────────
--   schedule:<tournament_schedules.id>  a recurring tournament. Every run, and
--       every edit of the schedule (name, buy-in, structure), keeps the id.
--   board:<club>:<union>:<TYPE>:<board name>  an engine Sit N Go / Spin board.
--       Measured: every unscheduled SNG and SPIN in 30 days (388,704 rows,
--       96 boards) came from the engine's catalogue, which DEFINES a board as
--       its generated name within one owner scope and refills it by that name
--       (TournamentRecurringService ensureBoardOpen). Stack, speed and clock
--       edits keep the board; a buy-in change is a different board in the
--       engine too. A catalogue rename must add a row to lobby_game_aliases;
--       tests/lobby-favorites-follow-the-game.law.test.ts refuses one without.
--   satellite:<target series>:<TYPE>:<format>:<seats>  a satellite, by the
--       recurring event it feeds and its format, never its name.
--   tournament:<id>  a one-off event: itself.
--   cash_game:<cash_games.id>  a cash game definition (club, variant, stakes,
--       format). Every live cash table belongs to one; a rebuilt table keeps
--       it. A new cash_games row is a different game unless an alias says so.
--   table:<id>  only a legacy cash table with no game definition.
--   lobby_game_aliases maps a retired key to its successor when maintenance
--   recreates a game; nothing infers that link from a name or settings.
--
-- ── NEWER ACCEPTED STATE WINS: server-held revisions, not device clocks ─────
--   Every saved field (one filter game type, the tab, the Favorites chip, one
--   tab's sort, one page preference, one favorite) carries a revision drawn
--   from one database sequence. A change states the revision it was made
--   against. It applies only if that is still the field's current revision;
--   otherwise it is refused as a CONFLICT and the reply carries the account's
--   current value, which the device then shows and reports as not saved.
--   This does not claim to know when an offline edit happened: the first
--   change accepted against a revision wins, and any later change made
--   against that same older state is refused rather than silently applied.
--   Unfavoriting keeps the row (active = false) with its new revision, so an
--   older offline star cannot come back afterwards. A duplicate retry of an
--   applied change is refused as a conflict whose current value already equals
--   it, so the final state never changes. Only fields named in a change are
--   touched, so unrelated settings are never rewritten.
--
-- ── OWNER-ONLY, ENFORCED BY THE DATABASE ────────────────────────────────────
--   Browsers may only READ these tables; every write goes through the
--   SECURITY DEFINER functions below, which act for auth.uid() only. auth.uid()
--   is derived by PostgREST from a verified JWT; a client cannot set it, and a
--   service_role key carries no user, so the guard refuses its writes. Rows
--   are deleted only by the cascade from deleting the auth.users row, which is
--   possible only for the auth admin or a database superuser (a superuser, as
--   this migration's backfill does, can act for any account - that is the
--   database's own boundary, not one an API caller can reach).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE SEQUENCE IF NOT EXISTS public.player_preference_revision_seq;
REVOKE ALL ON SEQUENCE public.player_preference_revision_seq FROM PUBLIC, anon, authenticated;

-- ── Favorites (rows are kept on unfavorite, as active = false) ──────────────
CREATE TABLE IF NOT EXISTS public.player_lobby_favorites (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('cash', 'tournament')),
  game_key   text        NOT NULL CHECK (length(game_key) BETWEEN 1 AND 400),
  club_id    uuid,
  label      text        CHECK (label IS NULL OR length(label) <= 200),
  active     boolean     NOT NULL DEFAULT true,
  revision   bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, game_key)
);
COMMENT ON TABLE public.player_lobby_favorites IS
  'Starred lobby games, keyed by the logical game (see migration 20261105183133), never a name, table or run. No FK to any game row. Unfavorite keeps the row (active=false) with a new revision. Written only by fn_set_lobby_favorites; deleted only by account deletion.';
ALTER TABLE public.player_lobby_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_lobby_favorites_select_own ON public.player_lobby_favorites;
CREATE POLICY player_lobby_favorites_select_own ON public.player_lobby_favorites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.player_lobby_favorites FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.player_lobby_favorites TO authenticated;

-- ── A recreated game names its successor explicitly ─────────────────────────
CREATE TABLE IF NOT EXISTS public.lobby_game_aliases (
  old_key    text        PRIMARY KEY CHECK (length(old_key) BETWEEN 1 AND 400),
  new_key    text        NOT NULL CHECK (length(new_key) BETWEEN 1 AND 400 AND new_key <> old_key),
  reason     text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lobby_game_aliases IS
  'Retired lobby game key -> its successor, written by the migration that renames or recreates the game. Favorites follow it; nothing infers it from names or settings.';
ALTER TABLE public.lobby_game_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lobby_game_aliases FROM PUBLIC, anon, authenticated, service_role;

-- ── What the migration did with every legacy favorite ───────────────────────
CREATE TABLE IF NOT EXISTS public.lobby_favorites_migration_report (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL,
  source     text        NOT NULL CHECK (source IN ('favorite_tables', 'lobby-tournament-favorites')),
  raw_value  text        NOT NULL,
  outcome    text        NOT NULL CHECK (outcome IN ('mapped', 'duplicate', 'unresolved')),
  game_key   text,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lobby_favorites_migration_report IS
  'One row per legacy favorite read by migration 20261105183133: mapped to a game, a duplicate of one already mapped, or unresolved (kept here and in its untouched legacy source rather than guessed).';
ALTER TABLE public.lobby_favorites_migration_report ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lobby_favorites_migration_report FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.lobby_favorites_migration_report_id_seq FROM PUBLIC, anon, authenticated;

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
    WHEN t.satellite_target_id IS NOT NULL THEN
      'satellite:' || coalesce(
        (SELECT CASE WHEN tt.schedule_id IS NOT NULL THEN 'schedule:' || tt.schedule_id::text
                     ELSE 'tournament:' || tt.id::text END
           FROM public.tournaments tt WHERE tt.id = t.satellite_target_id),
        'tournament:' || t.satellite_target_id::text)
      || ':' || upper(coalesce(t.tournament_type, ''))
      || ':' || coalesce(t.format_contract::text, '')
      || ':' || coalesce(t.max_players::text, '')
    WHEN upper(coalesce(t.tournament_type, '')) IN ('SNG', 'SPIN')
      AND coalesce(t.format_contract::text, '') IN ('sng-v1', 'spin-v1') THEN
      'board:' || coalesce(t.club_id::text, '') || ':' || coalesce(t.union_id::text, '')
      || ':' || upper(t.tournament_type) || ':' || btrim(t.name)
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

-- Follow explicit aliases (bounded), so a recreated game keeps its stars.
CREATE OR REPLACE FUNCTION public.fn_lobby_current_key(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain(k, depth) AS (
    SELECT p_key, 0
    UNION ALL
    SELECT a.new_key, c.depth + 1
      FROM chain c JOIN public.lobby_game_aliases a ON a.old_key = c.k
     WHERE c.depth < 8
  )
  SELECT k FROM chain ORDER BY depth DESC LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.fn_lobby_tournament_key(public.tournaments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lobby_cash_key(public.tables) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lobby_favorite_key(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lobby_current_key(text) FROM PUBLIC, anon, authenticated;

-- ── Owner-only, for every preference store ──────────────────────────────────
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
    -- Only the cascade from deleting the account itself (it runs after the
    -- auth.users row is gone). No caller can make this true for a live account.
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION '% rows are removed only by deleting the account', TG_TABLE_NAME;
  END IF;
  IF v_uid IS NULL OR v_uid <> NEW.user_id THEN
    RAISE EXCEPTION '% is written only by its owner', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION '% owner is immutable', TG_TABLE_NAME;
    END IF;
    -- Each table's own identity columns, read only on that table.
    IF TG_TABLE_NAME = 'player_lobby_favorites' THEN
      IF to_jsonb(NEW)->'game_key' IS DISTINCT FROM to_jsonb(OLD)->'game_key'
         OR to_jsonb(NEW)->'kind' IS DISTINCT FROM to_jsonb(OLD)->'kind' THEN
        RAISE EXCEPTION 'player_lobby_favorites identity is immutable';
      END IF;
    ELSIF TG_TABLE_NAME = 'user_page_preferences' THEN
      IF to_jsonb(NEW)->'preference_key' IS DISTINCT FROM to_jsonb(OLD)->'preference_key' THEN
        RAISE EXCEPTION 'user_page_preferences key is immutable';
      END IF;
    ELSIF TG_TABLE_NAME = 'user_lobby_filters' THEN
      IF to_jsonb(NEW)->'club_id' IS DISTINCT FROM to_jsonb(OLD)->'club_id' THEN
        RAISE EXCEPTION 'user_lobby_filters club is immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.fn_player_preference_guard() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.user_lobby_filters
  ADD COLUMN IF NOT EXISTS revisions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_page_preferences
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

-- Browsers read; every write goes through the functions below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_lobby_filters FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_page_preferences FROM anon, authenticated;

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

-- ── Lobby filters and view: per-field changes against server revisions ─────
-- p_changes: [{ "field": "filters.HOLDEM" | "view.tab" | "view.favoritesOnly"
--               | "view.sort.<TAB>", "value": <json>, "base": <revision>|null }]
-- base null means "made before this device knew any revision": it applies
-- only to a field that has never been saved under revisions.
CREATE OR REPLACE FUNCTION public.fn_save_lobby_preferences(p_club_id uuid, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_row     public.user_lobby_filters;
  v_filters jsonb;
  v_view    jsonb;
  v_revs    jsonb;
  v_change  jsonb;
  v_field   text;
  v_base    bigint;
  v_cur     bigint;
  v_rev     bigint;
  v_results jsonb := '[]'::jsonb;
  v_value   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in to save preferences' USING ERRCODE = '42501'; END IF;
  IF p_club_id IS NULL THEN RAISE EXCEPTION 'club required' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) > 64 THEN
    RAISE EXCEPTION 'changes must be an array of at most 64' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_lobby_filters (user_id, club_id, filters, view_prefs, revisions, updated_at)
  VALUES (v_uid, p_club_id, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())
  ON CONFLICT (user_id, club_id) DO NOTHING;
  SELECT * INTO v_row FROM public.user_lobby_filters
   WHERE user_id = v_uid AND club_id = p_club_id FOR UPDATE;
  v_filters := CASE WHEN jsonb_typeof(v_row.filters) = 'object' THEN v_row.filters ELSE '{}'::jsonb END;
  v_view := CASE WHEN jsonb_typeof(v_row.view_prefs) = 'object' THEN v_row.view_prefs ELSE '{}'::jsonb END;
  v_revs := CASE WHEN jsonb_typeof(v_row.revisions) = 'object' THEN v_row.revisions ELSE '{}'::jsonb END;

  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    v_field := v_change->>'field';
    IF v_field IS NULL OR v_field !~ '^(filters\.[A-Z_]{1,24}|view\.tab|view\.favoritesOnly|view\.sort\.[A-Z_]{1,24})$'
       OR octet_length(coalesce(v_change->'value', 'null'::jsonb)::text) > 16384 THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'invalid'));
      CONTINUE;
    END IF;
    v_cur := coalesce((v_revs->>v_field)::bigint, 0);
    v_base := CASE WHEN v_change ? 'base' AND jsonb_typeof(v_change->'base') = 'number'
                   THEN (v_change->>'base')::bigint END;
    IF (v_base IS NULL AND v_cur > 0) OR (v_base IS NOT NULL AND v_base < v_cur) THEN
      v_rev := v_cur;
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'conflict'));
    ELSE
      v_rev := nextval('public.player_preference_revision_seq');
      v_value := coalesce(v_change->'value', 'null'::jsonb);
      IF v_field LIKE 'filters.%' THEN
        v_filters := jsonb_set(v_filters, ARRAY[substr(v_field, 9)], v_value, true);
      ELSIF v_field = 'view.tab' THEN
        v_view := jsonb_set(v_view, '{tab}', v_value, true);
      ELSIF v_field = 'view.favoritesOnly' THEN
        v_view := jsonb_set(v_view, '{favoritesOnly}', v_value, true);
      ELSE
        IF jsonb_typeof(v_view->'sortByTab') IS DISTINCT FROM 'object' THEN
          v_view := jsonb_set(v_view, '{sortByTab}', '{}'::jsonb, true);
        END IF;
        v_view := jsonb_set(v_view, ARRAY['sortByTab', substr(v_field, 11)], v_value, true);
      END IF;
      v_revs := jsonb_set(v_revs, ARRAY[v_field], to_jsonb(v_rev), true);
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'applied'));
    END IF;
    -- Every result carries the field's current accepted value and revision.
    v_results := jsonb_set(v_results, ARRAY[(jsonb_array_length(v_results) - 1)::text, 'revision'], to_jsonb(v_rev));
    v_results := jsonb_set(v_results, ARRAY[(jsonb_array_length(v_results) - 1)::text, 'value'],
      CASE
        WHEN v_field LIKE 'filters.%' THEN coalesce(v_filters->substr(v_field, 9), 'null'::jsonb)
        WHEN v_field = 'view.tab' THEN coalesce(v_view->'tab', 'null'::jsonb)
        WHEN v_field = 'view.favoritesOnly' THEN coalesce(v_view->'favoritesOnly', 'null'::jsonb)
        ELSE coalesce(v_view->'sortByTab'->substr(v_field, 11), 'null'::jsonb)
      END);
  END LOOP;

  UPDATE public.user_lobby_filters
     SET filters = v_filters, view_prefs = v_view, revisions = v_revs, updated_at = now()
   WHERE user_id = v_uid AND club_id = p_club_id;

  RETURN jsonb_build_object('ok', true, 'results', v_results,
    'filters', v_filters, 'view_prefs', v_view, 'revisions', v_revs);
END
$$;
REVOKE ALL ON FUNCTION public.fn_save_lobby_preferences(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_lobby_preferences(uuid, jsonb) TO authenticated;

-- ── Page preferences: the same rule, one field per preference key ──────────
-- p_changes: [{ "field": <preference_key>, "value": <json>, "base": <revision>|null }]
CREATE OR REPLACE FUNCTION public.fn_save_page_preferences(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_change  jsonb;
  v_key     text;
  v_base    bigint;
  v_row     public.user_page_preferences;
  v_cur     bigint;
  v_rev     bigint;
  v_value   jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in to save preferences' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) > 32 THEN
    RAISE EXCEPTION 'changes must be an array of at most 32' USING ERRCODE = '22023';
  END IF;
  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    v_key := v_change->>'field';
    v_value := v_change->'value';
    IF v_key IS NULL OR length(v_key) NOT BETWEEN 1 AND 240 OR v_value IS NULL
       OR jsonb_typeof(v_value) = 'null' OR octet_length(v_value::text) > 16384 THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_key, 'status', 'invalid'));
      CONTINUE;
    END IF;
    v_base := CASE WHEN v_change ? 'base' AND jsonb_typeof(v_change->'base') = 'number'
                   THEN (v_change->>'base')::bigint END;
    SELECT * INTO v_row FROM public.user_page_preferences
     WHERE user_id = v_uid AND preference_key = v_key FOR UPDATE;
    v_cur := coalesce(v_row.revision, 0);
    IF (v_base IS NULL AND v_cur > 0) OR (v_base IS NOT NULL AND v_base < v_cur) THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'field', v_key, 'status', 'conflict', 'revision', v_cur, 'value', v_row.value));
    ELSE
      v_rev := nextval('public.player_preference_revision_seq');
      INSERT INTO public.user_page_preferences (user_id, preference_key, value, revision)
      VALUES (v_uid, v_key, v_value, v_rev)
      ON CONFLICT (user_id, preference_key) DO UPDATE SET value = excluded.value, revision = excluded.revision;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'field', v_key, 'status', 'applied', 'revision', v_rev, 'value', v_value));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', v_results);
END
$$;
REVOKE ALL ON FUNCTION public.fn_save_page_preferences(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_page_preferences(jsonb) TO authenticated;

-- ── Favorites: star / unstar against the favorite's revision ────────────────
-- p_changes: [{ "kind": "cash"|"tournament", "game_id": <uuid>, "on": bool,
--               "base": <revision>|null }]  (base 0 = "I saw it never starred")
CREATE OR REPLACE FUNCTION public.fn_set_lobby_favorites(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_change  jsonb;
  v_kind    text;
  v_game    uuid;
  v_key     text;
  v_base    bigint;
  v_row     public.player_lobby_favorites;
  v_cur     bigint;
  v_rev     bigint;
  v_label   text;
  v_club    uuid;
  v_field   text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in to save favorites' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) > 64 THEN
    RAISE EXCEPTION 'changes must be an array of at most 64' USING ERRCODE = '22023';
  END IF;
  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    v_kind := v_change->>'kind';
    v_field := coalesce(v_kind, '') || ':' || coalesce(v_change->>'game_id', '');
    IF v_kind NOT IN ('cash', 'tournament') OR coalesce(v_change->>'game_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR jsonb_typeof(v_change->'on') IS DISTINCT FROM 'boolean' THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'invalid'));
      CONTINUE;
    END IF;
    v_game := (v_change->>'game_id')::uuid;
    v_key := public.fn_lobby_favorite_key(v_kind, v_game);
    IF v_key IS NULL THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'invalid'));
      CONTINUE;
    END IF;
    v_key := public.fn_lobby_current_key(v_key);
    v_base := CASE WHEN jsonb_typeof(v_change->'base') = 'number' THEN (v_change->>'base')::bigint END;
    -- The player's row for this game, including one saved under a key that
    -- an alias now forwards here: a renamed game keeps ONE favorite record.
    SELECT * INTO v_row FROM public.player_lobby_favorites pf
     WHERE pf.user_id = v_uid AND pf.kind = v_kind
       AND (pf.game_key = v_key OR public.fn_lobby_current_key(pf.game_key) = v_key)
     ORDER BY (pf.game_key = v_key) DESC, pf.revision DESC
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN v_key := v_row.game_key; END IF;
    v_cur := coalesce(v_row.revision, 0);
    IF (v_base IS NULL AND v_cur > 0) OR (v_base IS NOT NULL AND v_base < v_cur) THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'conflict',
        'game_key', v_key, 'active', coalesce(v_row.active, false), 'revision', v_cur));
      CONTINUE;
    END IF;
    v_rev := nextval('public.player_preference_revision_seq');
    IF v_kind = 'tournament' THEN
      SELECT left(name, 200), club_id INTO v_label, v_club FROM public.tournaments WHERE id = v_game;
    ELSE
      SELECT left(name, 200), club_id INTO v_label, v_club FROM public.tables WHERE id = v_game;
    END IF;
    INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, club_id, label, active, revision, updated_at)
    VALUES (v_uid, v_kind, v_key, v_club, v_label, (v_change->>'on')::boolean, v_rev, now())
    ON CONFLICT (user_id, kind, game_key) DO UPDATE
      SET active = excluded.active, revision = excluded.revision, updated_at = now(),
          label = coalesce(excluded.label, player_lobby_favorites.label),
          club_id = coalesce(player_lobby_favorites.club_id, excluded.club_id);
    v_results := v_results || jsonb_build_array(jsonb_build_object('field', v_field, 'status', 'applied',
      'game_key', v_key, 'active', (v_change->>'on')::boolean, 'revision', v_rev));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', v_results);
END
$$;
REVOKE ALL ON FUNCTION public.fn_set_lobby_favorites(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_lobby_favorites(jsonb) TO authenticated;

-- ── Which LIVE games belong to the player's favorite rows right now ─────────
-- Returns tombstones too (active = false), so a device knows the revision of
-- an unfavorited game it can see. Live means what the lobby lists.
CREATE OR REPLACE FUNCTION public.fn_my_lobby_favorites()
RETURNS TABLE (kind text, game_id uuid, game_key text, active boolean, revision bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT pf.kind, pf.game_key, public.fn_lobby_current_key(pf.game_key) AS k,
           pf.club_id, pf.active, pf.revision
      FROM public.player_lobby_favorites pf
     WHERE pf.user_id = auth.uid()
  ), live AS (
    SELECT t.* FROM public.tournaments t
     WHERE t.status IN ('ANNOUNCED', 'REGISTERING', 'RUNNING', 'LATE_REG', 'STARTING_SOON', 'BAGGED')
  )
  SELECT f.kind, t.id, f.game_key, f.active, f.revision
    FROM f JOIN live t ON f.kind = 'tournament' AND f.k LIKE 'schedule:%'
     AND t.schedule_id = substr(f.k, 10)::uuid
  UNION
  SELECT f.kind, t.id, f.game_key, f.active, f.revision
    FROM f JOIN live t ON f.kind = 'tournament' AND (f.k LIKE 'board:%' OR f.k LIKE 'satellite:%')
     AND t.club_id = f.club_id AND t.schedule_id IS NULL
   WHERE public.fn_lobby_tournament_key(t) = f.k
  UNION
  SELECT f.kind, t.id, f.game_key, f.active, f.revision
    FROM f JOIN live t ON f.kind = 'tournament' AND f.k LIKE 'tournament:%'
     AND t.id = substr(f.k, 12)::uuid
  UNION
  SELECT f.kind, tb.id, f.game_key, f.active, f.revision
    FROM f JOIN public.tables tb ON f.kind = 'cash' AND f.k LIKE 'cash_game:%'
     AND tb.cluster_id = substr(f.k, 11)::uuid
   WHERE tb.tournament_id IS NULL AND tb.is_deleted IS NOT TRUE
     AND coalesce(tb.is_template, false) = false AND coalesce(tb.status, '') <> 'closed'
  UNION
  SELECT f.kind, tb.id, f.game_key, f.active, f.revision
    FROM f JOIN public.tables tb ON f.kind = 'cash' AND f.k LIKE 'table:%'
     AND tb.id = substr(f.k, 7)::uuid
   WHERE tb.tournament_id IS NULL AND tb.is_deleted IS NOT TRUE
     AND coalesce(tb.is_template, false) = false AND coalesce(tb.status, '') <> 'closed'
  LIMIT 4000
$$;
REVOKE ALL ON FUNCTION public.fn_my_lobby_favorites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_lobby_favorites() TO authenticated;

-- ── Carry every legacy favorite forward and record what happened to it ──────
-- Legacy sources (favorite_tables, the lobby-tournament-favorites preference)
-- are read only and left exactly as they are.
DO $backfill$
DECLARE
  r     record;
  e     record;
  v_key text;
  v_n   integer;
BEGIN
  FOR r IN
    SELECT DISTINCT u.user_id FROM (
      SELECT user_id FROM public.favorite_tables
      UNION SELECT user_id FROM public.user_page_preferences
             WHERE preference_key LIKE 'lobby-tournament-favorites%') u
     WHERE EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.user_id)
  LOOP
    -- Act as the owner, local to this transaction, so the guard admits it.
    PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.user_id::text)::text, true);

    FOR e IN
      SELECT ft.table_id::text AS raw, tb.id AS table_id, tb.club_id, tb.name, tb.tournament_id,
             CASE WHEN tb.id IS NOT NULL AND tb.tournament_id IS NULL THEN public.fn_lobby_cash_key(tb) END AS k
        FROM public.favorite_tables ft
        LEFT JOIN public.tables tb ON tb.id = ft.table_id
       WHERE ft.user_id = r.user_id
       ORDER BY ft.created_at
    LOOP
      IF e.k IS NULL THEN
        INSERT INTO public.lobby_favorites_migration_report (user_id, source, raw_value, outcome, detail)
        VALUES (r.user_id, 'favorite_tables', e.raw, 'unresolved',
                CASE WHEN e.table_id IS NULL THEN 'table not found' ELSE 'not a cash table' END);
        CONTINUE;
      END IF;
      INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, club_id, label, active, revision)
      VALUES (r.user_id, 'cash', e.k, e.club_id, left(e.name, 200), true, nextval('public.player_preference_revision_seq'))
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      INSERT INTO public.lobby_favorites_migration_report (user_id, source, raw_value, outcome, game_key)
      VALUES (r.user_id, 'favorite_tables', e.raw, CASE WHEN v_n = 1 THEN 'mapped' ELSE 'duplicate' END, e.k);
    END LOOP;

    FOR e IN
      SELECT ids.tid AS raw, t.id AS tid, t.club_id, t.name,
             CASE WHEN t.id IS NOT NULL THEN public.fn_lobby_tournament_key(t) END AS k
        FROM public.user_page_preferences p
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(p.value) = 'array' THEN p.value ELSE '[]'::jsonb END)
          WITH ORDINALITY AS ids(tid, ord)
        LEFT JOIN public.tournaments t
          ON t.id = CASE WHEN ids.tid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                         THEN ids.tid::uuid END
       WHERE p.user_id = r.user_id AND p.preference_key LIKE 'lobby-tournament-favorites%'
       ORDER BY p.preference_key, ids.ord
    LOOP
      IF e.k IS NULL THEN
        INSERT INTO public.lobby_favorites_migration_report (user_id, source, raw_value, outcome, detail)
        VALUES (r.user_id, 'lobby-tournament-favorites', left(e.raw, 400), 'unresolved',
                CASE WHEN e.raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                     THEN 'not a tournament id' ELSE 'tournament not found' END);
        CONTINUE;
      END IF;
      INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, club_id, label, active, revision)
      VALUES (r.user_id, 'tournament', e.k, e.club_id, left(e.name, 200), true, nextval('public.player_preference_revision_seq'))
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      INSERT INTO public.lobby_favorites_migration_report (user_id, source, raw_value, outcome, game_key)
      VALUES (r.user_id, 'lobby-tournament-favorites', e.raw, CASE WHEN v_n = 1 THEN 'mapped' ELSE 'duplicate' END, e.k);
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
END
$backfill$;

COMMIT;
