-- OPPONENT HUD (2026-11-20, PLO-OWNER lane OPPONENT-HUD): the Horses' lifetime public profile of every opponent.
-- Owner 2026-11-20 3:15 / 3:18 / 3:20 PM Chicago: the Horses hold a built-in heads-up display of every opponent
-- (person or Horse alike) from hand one, built from all previously played hands, never from unshown hole cards.
--
-- One row per opponent (user_id) and game family (plo4, plo5); user_id '*' holds the family's population priors.
-- The profile JSON is built by the engine (server/src/engine/opponentHud/OpponentHudProfile.ts) from public hand
-- records only; this migration stores and serves it. Nothing here reads hand_history.players cards.
--
-- Writes: the engine's main thread upserts the profiles it changed (fn_opponent_hud_profiles_upsert, at most 200 rows
-- per call); the backfill (server/scripts/opponent-hud-build.ts) writes the same way with rebuild=true.
-- MORE THAN ONE WRITER (2026-11-21): a profile row is written whole, and more than one engine process can hold the
-- same player (a cutover overlap, a standby, the backfill under a live engine). Every row carries a revision (rev).
-- A writer names the revision it built on (base_rev; 0 = it found no row) and the function writes the row only when
-- the stored row is still that revision, in one statement under the row's lock (compare-and-swap); otherwise nothing
-- is written and the key is returned as refused. The engine then re-reads the stored row, applies only the hands it
-- holds that the stored profile does not list (the hand id lists inside the profile are the idempotency key, so they
-- hold here, in the database, not in any one process), and saves again. No interleaving of writers can lose or
-- double a hand (scripts/ci/test-opponent-hud-upsert-postgres.sh proves it with concurrent sessions).
BEGIN;

CREATE TABLE IF NOT EXISTS public.opponent_hud_profiles (
  user_id text NOT NULL,
  family text NOT NULL CHECK (family IN ('plo4','plo5')),
  version integer NOT NULL,
  hands bigint NOT NULL DEFAULT 0 CHECK (hands >= 0),
  wm_ms bigint NOT NULL DEFAULT -1,
  rev bigint NOT NULL DEFAULT 1 CHECK (rev >= 1),
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, family)
);
CREATE INDEX IF NOT EXISTS opponent_hud_profiles_recent ON public.opponent_hud_profiles (family, updated_at DESC);
ALTER TABLE public.opponent_hud_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opponent_hud_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.opponent_hud_profiles TO service_role;

-- Read up to 50 named profiles of one family (the engine's warm on a seat event).
CREATE OR REPLACE FUNCTION public.fn_opponent_hud_profiles_read(p_user_ids text[], p_family text)
RETURNS SETOF public.opponent_hud_profiles LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_family NOT IN ('plo4','plo5') OR coalesce(cardinality(p_user_ids), 0) NOT BETWEEN 1 AND 50 THEN RETURN; END IF;
  RETURN QUERY SELECT p.* FROM public.opponent_hud_profiles p
   WHERE p.family = p_family AND p.user_id = ANY(p_user_ids) ORDER BY p.user_id;
END $f$;

-- Page through the profiles updated since a time (the engine's boot prewarm and the operator dump), keyset by user.
CREATE OR REPLACE FUNCTION public.fn_opponent_hud_profiles_recent(
  p_family text, p_since timestamptz, p_after_user text, p_limit integer)
RETURNS SETOF public.opponent_hud_profiles LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_family NOT IN ('plo4','plo5') OR p_limit NOT BETWEEN 1 AND 500 THEN RETURN; END IF;
  RETURN QUERY SELECT p.* FROM public.opponent_hud_profiles p
   WHERE p.family = p_family AND p.updated_at >= p_since AND p.user_id > coalesce(p_after_user, '')
   ORDER BY p.user_id LIMIT p_limit;
END $f$;

-- Upsert up to 200 rows [{user_id, family, version, hands, wm_ms, base_rev, profile, rebuild?}]; returns the refused
-- keys ('family|user_id'). A player's row needs base_rev (compare-and-swap, above). rebuild=true replaces the row and
-- moves its revision. The population rows ('*') and the sync point ('#sync') hold no per-hand record: the later
-- watermark wins.
CREATE OR REPLACE FUNCTION public.fn_opponent_hud_profiles_upsert(p_rows jsonb)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $f$
DECLARE
  r jsonb;
  refused text[] := '{}';
  n integer := 0;
  k integer;
  uid text;
  fam text;
  base bigint;
  rebuild boolean;
  cur public.opponent_hud_profiles;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'opponent hud upsert: an array of at most 200 rows';
  END IF;
  -- rows are taken in key order whatever order the caller sent them: two callers never lock in opposite orders
  FOR r IN SELECT e FROM jsonb_array_elements(p_rows) e ORDER BY e->>'user_id', e->>'family' LOOP
    n := n + 1;
    uid := coalesce(r->>'user_id', '');
    fam := r->>'family';
    IF fam IS NULL OR fam NOT IN ('plo4','plo5') OR uid = ''
       OR jsonb_typeof(r->'profile') IS DISTINCT FROM 'object' OR coalesce((r->>'hands')::bigint, -1) < 0
       OR (r->>'version') IS NULL OR (r->>'wm_ms') IS NULL THEN
      refused := refused || (coalesce(fam, '') || '|' || uid);
      CONTINUE;
    END IF;
    rebuild := coalesce((r->>'rebuild')::boolean, false);
    base := (r->>'base_rev')::bigint;
    IF rebuild THEN
      -- the backfill: the row is replaced whole and its revision moves, so an engine process holding the old row is
      -- refused at its next save and merges its own hands onto this one
      INSERT INTO public.opponent_hud_profiles (user_id, family, version, hands, wm_ms, rev, profile, updated_at)
      VALUES (uid, fam, (r->>'version')::integer, (r->>'hands')::bigint, (r->>'wm_ms')::bigint, 1, r->'profile', now())
      ON CONFLICT (user_id, family) DO UPDATE SET
        version = excluded.version, hands = excluded.hands, wm_ms = excluded.wm_ms,
        rev = public.opponent_hud_profiles.rev + 1, profile = excluded.profile, updated_at = now();
      CONTINUE;
    END IF;
    IF uid IN ('*', '#sync') THEN
      -- the population rows and the sync point hold no per-hand record: the later watermark wins, atomically
      INSERT INTO public.opponent_hud_profiles (user_id, family, version, hands, wm_ms, rev, profile, updated_at)
      VALUES (uid, fam, (r->>'version')::integer, (r->>'hands')::bigint, (r->>'wm_ms')::bigint, 1, r->'profile', now())
      ON CONFLICT (user_id, family) DO UPDATE SET
        version = excluded.version, hands = excluded.hands, wm_ms = excluded.wm_ms,
        rev = public.opponent_hud_profiles.rev + 1, profile = excluded.profile, updated_at = now()
      WHERE NOT (excluded.version = public.opponent_hud_profiles.version AND (
        excluded.hands < public.opponent_hud_profiles.hands OR excluded.wm_ms < public.opponent_hud_profiles.wm_ms));
      GET DIAGNOSTICS k = ROW_COUNT;
      IF k = 0 THEN refused := refused || (fam || '|' || uid); END IF;
      CONTINUE;
    END IF;
    -- A PLAYER'S PROFILE: compare-and-swap on the row revision. The writer names the revision it built on (0: it
    -- found no row). One statement decides under the row's lock; a writer that did not start from the stored row
    -- changes nothing and is told so. No whole-row write can erase hands another process counted.
    IF base IS NULL OR base < 0 THEN
      refused := refused || (fam || '|' || uid);
      CONTINUE;
    END IF;
    UPDATE public.opponent_hud_profiles SET
      version = (r->>'version')::integer, hands = (r->>'hands')::bigint, wm_ms = (r->>'wm_ms')::bigint,
      rev = rev + 1, profile = r->'profile', updated_at = now()
     WHERE user_id = uid AND family = fam AND rev = base;
    GET DIAGNOSTICS k = ROW_COUNT;
    IF k = 0 THEN
      -- no row at that revision: either the row has moved (refused), or there is no row at all (first save)
      INSERT INTO public.opponent_hud_profiles (user_id, family, version, hands, wm_ms, rev, profile, updated_at)
      VALUES (uid, fam, (r->>'version')::integer, (r->>'hands')::bigint, (r->>'wm_ms')::bigint, base + 1,
              r->'profile', now())
      ON CONFLICT (user_id, family) DO NOTHING;
      GET DIAGNOSTICS k = ROW_COUNT;
      IF k = 0 THEN refused := refused || (fam || '|' || uid); END IF;
    END IF;
  END LOOP;
  RETURN refused;
END $f$;

-- Page through PLO4/PLO5 cash hands for the backfill and the reconciliation, PUBLIC FIELDS ONLY: each player is
-- projected to seat, userId and stack (the dealt cards never leave the database), each action to its public fields
-- and the actor's own row of the recorded public node. Keyset by (created_at, id).
CREATE OR REPLACE FUNCTION public.fn_opponent_hud_hands_page(
  p_after_at timestamptz, p_after_id uuid, p_until timestamptz, p_limit integer)
RETURNS TABLE (id uuid, created_at timestamptz, ended_at timestamptz, game_variant text, tournament_id uuid,
  big_blind numeric, button_seat smallint, bomb_pot jsonb, community_cards text[], community_cards2 text[],
  rit_boards jsonb, showdown jsonb, winners jsonb, players jsonb, actions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 2000 THEN RETURN; END IF;
  RETURN QUERY
  SELECT h.id, h.created_at, h.ended_at, h.game_variant, h.tournament_id, h.big_blind, h.button_seat,
    h.bomb_pot, h.community_cards, h.community_cards2, h.rit_boards, h.showdown, h.winners,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('seat', p->'seat', 'userId', p->'userId', 'stack', p->'stack')),
       '[]'::jsonb) FROM jsonb_array_elements(h.players) p),
    (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'seat', a->'seat', 'userId', a->'userId', 'action', a->'action', 'amount', a->'amount', 'stage', a->'stage',
        'dead', a->'dead',
        'publicNode', CASE WHEN a ? 'publicNode' THEN jsonb_build_object(
            'pot', a->'publicNode'->'pot', 'toCall', a->'publicNode'->'toCall',
            'currentBet', a->'publicNode'->'currentBet',
            'seats', (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(a->'publicNode'->'seats') s
                       WHERE (s->>0)::int = (a->>'seat')::int)) END)) ORDER BY o), '[]'::jsonb)
       FROM jsonb_array_elements(h.actions) WITH ORDINALITY AS x(a, o))
  FROM public.hand_history h
  WHERE h.game_variant IN ('plo4','plo5') AND h.tournament_id IS NULL
    AND (h.created_at > p_after_at OR (h.created_at = p_after_at AND h.id > p_after_id))
    AND h.created_at <= p_until
  ORDER BY h.created_at, h.id
  LIMIT p_limit;
END $f$;

REVOKE ALL ON FUNCTION public.fn_opponent_hud_profiles_read(text[], text),
  public.fn_opponent_hud_profiles_recent(text, timestamptz, text, integer),
  public.fn_opponent_hud_profiles_upsert(jsonb),
  public.fn_opponent_hud_hands_page(timestamptz, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_opponent_hud_profiles_read(text[], text),
  public.fn_opponent_hud_profiles_recent(text, timestamptz, text, integer),
  public.fn_opponent_hud_profiles_upsert(jsonb),
  public.fn_opponent_hud_hands_page(timestamptz, uuid, timestamptz, integer) TO service_role;

-- Function probes (scripts/ci/templates/function-probe.sql): each body runs once and is undone.
-- @probe-for: public.fn_opponent_hud_profiles_upsert
DO $probe$
BEGIN
  -- a rebuild row reaches the insert path; a malformed row reaches the refusal path
  IF public.fn_opponent_hud_profiles_upsert(
       '[{"user_id":"probe-user","family":"plo4","version":1,"hands":0,"wm_ms":0,"rebuild":true,"profile":{}},
         {"user_id":"probe-user","family":"holdem","version":1,"hands":0,"wm_ms":0,"profile":{}}]'::jsonb)
     IS DISTINCT FROM ARRAY['holdem|probe-user'] THEN
    RAISE EXCEPTION 'opponent hud probe: upsert refused set differs';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_opponent_hud_profiles_read
DO $probe$
BEGIN
  PERFORM public.fn_opponent_hud_profiles_read(ARRAY['probe-user'], 'plo4');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_opponent_hud_profiles_recent
DO $probe$
BEGIN
  PERFORM public.fn_opponent_hud_profiles_recent('plo4', now(), NULL, 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_opponent_hud_hands_page
DO $probe$
BEGIN
  -- an empty time range: the body runs without scanning history. hand_history exists in every database this
  -- migration installs into; the throwaway PostgreSQL of scripts/ci/test-opponent-hud-upsert-postgres.sh holds only
  -- this migration, so there the call is skipped (plpgsql_check covers the body).
  IF to_regclass('public.hand_history') IS NOT NULL THEN
    PERFORM public.fn_opponent_hud_hands_page(now(), NULL, now(), 1);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
