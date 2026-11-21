-- 20261122094628_the_horse_exposure_hands_are_planned_for_their_own_window.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WENT WRONG (Production Alerts, PgCronJobFailingRepeatedly row 446831 and the
-- fn_ca_cron_failure_watch rows after it): ca-horse-exposure-watch-hourly has failed
-- every run on 2026-11-21 with "canceling statement due to statement timeout ...
-- SQL function fn_ca_horse_exposure_hands statement 1".
--
-- ROOT CAUSE, measured read-only on production 2026-11-21:
--   smarter_private.fn_ca_horse_exposure_hands (20261121011654) is LANGUAGE sql with a
--   SET search_path clause, so PostgreSQL never inlines it and plans its body with p_at
--   as an unknown parameter (a generic plan). EXPLAIN (GENERIC_PLAN) of the body picks
--   a Parallel Index Scan on idx_hand_history_created - every hand of the 60 days -
--   and applies has_human / game / tournament / bomb_pot as heap filters, estimating
--   53 rows per worker. With a known timestamp the planner uses the partial index
--   idx_hand_history_human_created (has_human) and the body returns ~25.6k hands and
--   ~137k seats in 6.66 s cold. The generic plan ran past 60 s; the watch's limit is
--   120 s. The header of 20261121011654 says "Hands are found through
--   idx_hand_history_human_created": that held for a literal, never for the function.
--
-- THE FIX: the same body, byte for byte apart from $1/$2 for p_at/p_per, is now run by
--   plpgsql RETURN QUERY EXECUTE ... USING. A dynamic statement is planned once per
--   call with its actual values (a custom plan), so the window p_at - 60 days .. p_at
--   is visible to the planner on every run. No timeout is raised, no threshold moves,
--   no index is created on hand_history, and the result set is unchanged.
--
-- LOCKS: CREATE OR REPLACE FUNCTION on a smarter_private function only; it takes no
--   lock on hand_history, ca_hand_facts or profiles. No install window needed.
--
-- Pinned by tests/the-horse-exposure-hands-are-planned-for-their-own-window.law.test.ts.
--
-- @live-proof: (SELECT l.lanname = 'plpgsql' AND p.prosrc ILIKE '%RETURN QUERY EXECUTE%' AND p.prosrc ILIKE '%USING p_at, p_per%' FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('smarter_private.fn_ca_horse_exposure_hands(timestamp with time zone, integer)'))

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '20s';

CREATE OR REPLACE FUNCTION smarter_private.fn_ca_horse_exposure_hands(p_at timestamptz, p_per integer)
 RETURNS TABLE (user_id uuid, game text, hand_id uuid, played_at timestamptz, rn bigint, x_real numeric, x_ev numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- EXECUTE, not a static query: a dynamic statement gets a custom plan for this
  -- call's p_at, so the partial index idx_hand_history_human_created is chosen.
  -- A static or LANGUAGE sql body is planned generically and scans every hand.
  RETURN QUERY EXECUTE $q$
  WITH base AS (
    SELECT hh.id, hh.created_at
      FROM public.hand_history hh
     WHERE hh.has_human AND hh.created_at > $1 - interval '60 days' AND hh.created_at <= $1
       AND hh.game_variant IN ('plo4', 'plo5') AND hh.tournament_id IS NULL AND hh.bomb_pot IS NULL
  ), seats AS (
    SELECT f.hand_id, f.user_id, f.game_variant AS game, b.created_at AS played_at,
           COALESCE(p.is_horse, false) AS horse,
           f.net_bb::numeric AS n, COALESCE(f.ev_net_bb, f.net_bb)::numeric AS e
      FROM base b
      JOIN public.ca_hand_facts f ON f.hand_id = b.id
      LEFT JOIN public.profiles p ON p.id = f.user_id
  ), hands AS (
    SELECT s.hand_id,
           sum(greatest(-s.n, 0)) AS l_real,
           sum(greatest(-s.n, 0)) FILTER (WHERE s.horse) AS hl_real,
           sum(greatest(s.n, 0)) FILTER (WHERE s.horse) AS hw_real,
           sum(greatest(-s.e, 0)) AS l_ev,
           sum(greatest(-s.e, 0)) FILTER (WHERE s.horse) AS hl_ev,
           sum(greatest(s.e, 0)) FILTER (WHERE s.horse) AS hw_ev
      FROM seats s
     GROUP BY s.hand_id
    HAVING bool_or(s.horse) AND bool_or(NOT s.horse)
  ), person AS (
    SELECT s.user_id, s.game, s.hand_id, s.played_at,
           CASE WHEN h.l_real > 0 AND s.n > 0 THEN s.n * COALESCE(h.hl_real, 0) / h.l_real
                WHEN h.l_real > 0 AND s.n < 0 THEN s.n * COALESCE(h.hw_real, 0) / h.l_real ELSE 0 END AS x_real,
           CASE WHEN h.l_ev > 0 AND s.e > 0 THEN s.e * COALESCE(h.hl_ev, 0) / h.l_ev
                WHEN h.l_ev > 0 AND s.e < 0 THEN s.e * COALESCE(h.hw_ev, 0) / h.l_ev ELSE 0 END AS x_ev
      FROM seats s
      JOIN hands h ON h.hand_id = s.hand_id
     WHERE NOT s.horse
  )
  SELECT r.user_id, r.game, r.hand_id, r.played_at, r.rn, r.x_real, r.x_ev
    FROM (SELECT person.*, row_number() OVER (PARTITION BY person.user_id, person.game
                                              ORDER BY person.played_at DESC, person.hand_id) AS rn
            FROM person) r
   WHERE r.rn <= $2
$q$ USING p_at, p_per;
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.fn_ca_horse_exposure_hands(timestamptz, integer) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION smarter_private.fn_ca_horse_exposure_hands(timestamptz, integer) IS
  'Each person''s PLO4/PLO5 cash hands with a Horse dealt in the 60 days to p_at, with chips taken from or paid to the Horses (20261121011654). Runs its body through RETURN QUERY EXECUTE so every call is planned for its own window (20261122094628): a generic plan scanned every hand and timed out the hourly watch.';

COMMIT;
