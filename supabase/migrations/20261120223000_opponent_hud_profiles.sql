-- OPPONENT HUD (2026-11-20, PLO-OWNER lane OPPONENT-HUD): the Horses' lifetime public profile of every opponent.
-- Owner 2026-11-20 3:15 / 3:18 / 3:20 PM Chicago: the Horses hold a built-in heads-up display of every opponent
-- (person or Horse alike) from hand one, built from all previously played hands, never from unshown hole cards.
--
-- One row per opponent (user_id) and game family (plo4, plo5); user_id '*' holds the family's population priors.
-- The profile JSON is built by the engine (server/src/engine/opponentHud/OpponentHudProfile.ts) from public hand
-- records only; this migration stores and serves it. Nothing here reads hand_history.players cards.
--
-- Writes: the engine's main thread upserts the profiles it updated (fn_opponent_hud_profiles_upsert, at most 200 rows
-- per call); the backfill and the nightly reconciliation (server/scripts/opponent-hud-build.ts) write the same way. An
-- upsert never moves a row backwards: a row is replaced only when the incoming profile has at least as many hands and
-- a watermark at least as new (or the caller marks it a rebuild), so a stale engine cache can never erase lifetime
-- history; the refused user ids are returned so the engine reloads them.
BEGIN;

CREATE TABLE IF NOT EXISTS public.opponent_hud_profiles (
  user_id text NOT NULL,
  family text NOT NULL CHECK (family IN ('plo4','plo5')),
  version integer NOT NULL,
  hands bigint NOT NULL DEFAULT 0 CHECK (hands >= 0),
  wm_ms bigint NOT NULL DEFAULT -1,
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, family)
);
CREATE INDEX IF NOT EXISTS opponent_hud_profiles_recent ON public.opponent_hud_profiles (family, updated_at DESC);
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

-- Upsert up to 200 rows [{user_id, family, version, hands, wm_ms, profile, rebuild?}]; returns the refused user ids
-- (family-qualified as 'family|user_id').
CREATE OR REPLACE FUNCTION public.fn_opponent_hud_profiles_upsert(p_rows jsonb)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $f$
DECLARE
  r jsonb;
  refused text[] := '{}';
  n integer := 0;
  cur public.opponent_hud_profiles;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'opponent hud upsert: an array of at most 200 rows';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    n := n + 1;
    IF (r->>'family') NOT IN ('plo4','plo5') OR coalesce(r->>'user_id', '') = ''
       OR jsonb_typeof(r->'profile') <> 'object' OR (r->>'hands')::bigint < 0 THEN
      refused := refused || ((r->>'family') || '|' || coalesce(r->>'user_id', ''));
      CONTINUE;
    END IF;
    SELECT * INTO cur FROM public.opponent_hud_profiles
     WHERE user_id = r->>'user_id' AND family = r->>'family' FOR UPDATE;
    IF FOUND AND coalesce((r->>'rebuild')::boolean, false) = false AND (
         (r->>'version')::integer = cur.version AND (
           (r->>'hands')::bigint < cur.hands OR (r->>'wm_ms')::bigint < cur.wm_ms))
    THEN
      refused := refused || ((r->>'family') || '|' || (r->>'user_id'));
      CONTINUE;
    END IF;
    INSERT INTO public.opponent_hud_profiles (user_id, family, version, hands, wm_ms, profile, updated_at)
    VALUES (r->>'user_id', r->>'family', (r->>'version')::integer, (r->>'hands')::bigint, (r->>'wm_ms')::bigint,
            r->'profile', now())
    ON CONFLICT (user_id, family) DO UPDATE SET
      version = excluded.version, hands = excluded.hands, wm_ms = excluded.wm_ms,
      profile = excluded.profile, updated_at = now();
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

COMMIT;
