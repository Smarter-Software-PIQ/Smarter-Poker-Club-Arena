-- ═══════════════════════════════════════════════════════════════════════════
-- A CLASSIC REJOIN CONTINUES THE VPIP SITTING, AND THE APPROVED FLOORS GO LIVE
-- (Dan, owner approval 2026-11-10)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan approved the nine per-variant floors and the ten-hand grace, as PRODUCT
-- SETTINGS and not as claims about optimal strategy: nlh 20, plo4 30, plo5 50,
-- plo6 50, plo8 30, flo8 25, flh 15, short_deck 20, pineapple 25; grace 10
-- additional dealt hands after the first warning. plo8, short_deck and
-- pineapple had no 30-hand sample in the measured window and their floors are
-- recorded as judgment-based in ca_classic_vpip_floors.note. Scope stays
-- Classic cash games at 0.50/1.00 and above, humans and horses alike. Action
-- and Madness are untouched.
--
-- This migration does two things the first one deliberately did not.
--
-- 1. A REJOIN CONTINUES THE SITTING, SO LEAVING IS NOT AN ESCAPE HATCH.
--    fn_nit_sitting_since read the OPEN roster row, so a player one hand from
--    the boot could stand up, sit back down, and return with an empty sample
--    and no warning. That is a hole, and the fix is not a new penalty of my
--    invention: the platform already decides when a return is the SAME
--    session. cash_player_session.rejoin_window_ms carries that window, its
--    CHECK floors it at 7200000 ms, the Classic snapshot's rejoin_window_min
--    is 120 minutes, and fn_cash_session_close writes a
--    cash_rejoin_constraints row valid for exactly that long so a returning
--    player cannot reset their stack basis either. The same window now decides
--    the VPIP sitting: a return inside it continues the sample, the open
--    warning and the hands left in its grace; an absence longer than it is a
--    genuinely new sitting and starts clean. One rule, two uses, no new
--    punishment - and it is the same two hours as the eviction bar Dan set on
--    2026-09-05, so a booted player cannot come back inside it at all.
--
--    Grace cannot be waited out either, because it is counted in DEALT HANDS
--    after the warning (fn_nit_hands_since). A player who sits out plays no
--    hands and spends no grace; they return with exactly what they left with.
--
-- 2. THE APPROVED FLOORS ARE ACTIVATED, NOW, THROUGH THE MAINTAINED PATH.
--    The first migration installed the machinery and wrote no live row, which
--    left activation waiting on the next unrelated write to each game. Dan has
--    approved the values, so that wait is removed here: every eligible Classic
--    game is touched so fn_cash_game_floor_from_template recomputes its
--    promise, and fn_cash_apply_ruleset then carries that promise onto the
--    game's tables - the same two steps any other ruleset change takes. Each
--    game's result is recorded in ca_classic_vpip_activations, and the
--    post-conditions at the bottom ABORT the whole transaction if any eligible
--    game or live table is not judging afterwards, or if anything outside the
--    approved scope picked the rule up.
--
--    Measured immediately before writing this: 95 eligible games across 9
--    variants with 69 live tables, every one in an active chips club. No
--    retired club and no Diamond club is in scope today; a Diamond club's
--    tables are projected by fn_poker_diamond_project_cluster, which
--    fn_cash_apply_ruleset hands off to, so the table-level post-condition
--    below is scoped to non-Diamond clubs while the floor itself is written
--    for every asset.
--
-- NOBODY IS JUDGED ON A HAND PLAYED BEFORE THE FLOOR EXISTED. The trigger sets
-- vpip_floor_since only when it is absent, so plo5 and plo6 keep the instant
-- their 50 came on in October and every newly floored game starts counting
-- now. With a rolling thirty and a thirty-hand minimum, no seat can even be
-- warned until it has played thirty dealt hands after this migration commits.
--
-- No ALTER TABLE on public.tables, so nothing takes ACCESS EXCLUSIVE on a hot
-- relation: one new relation, two CREATE OR REPLACE, and bounded ROW EXCLUSIVE
-- writes to 95 game rows and 69 table rows. One transaction (CLAUDE.md 2).

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- -- 1. The sitting survives a rejoin, on the platform's own window ---------
CREATE OR REPLACE FUNCTION public.fn_nit_sitting_since(p_game_id uuid, p_user_id uuid,
                                                       p_fallback timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH game AS (
    -- The platform's own re-entry window, floored at the two hours
    -- cash_player_session_window_floor already enforces.
    SELECT GREATEST(7200000,
             COALESCE((g.ruleset_snapshot->>'rejoin_window_min')::integer, 120) * 60000)::bigint
             AS rejoin_ms,
           (g.ruleset_snapshot->>'vpip_floor_since')::timestamptz AS floor_since
      FROM public.cash_games g
     WHERE g.id = p_game_id
  ),
  visits AS (
    SELECT r.joined_at,
           lag(r.left_at) OVER (ORDER BY r.joined_at) AS prev_left
      FROM public.cash_game_roster r
     WHERE r.game_id = p_game_id AND r.user_id = p_user_id
  ),
  -- A return inside the window continues the same sitting; a longer absence
  -- starts a new one. Every row that STARTS a sitting increments the counter,
  -- so the newest sitting is the highest one.
  grouped AS (
    SELECT v.joined_at,
           sum(CASE
                 WHEN v.prev_left IS NULL THEN 1
                 WHEN v.joined_at - v.prev_left
                      > make_interval(secs => (SELECT rejoin_ms FROM game) / 1000.0) THEN 1
                 ELSE 0
               END) OVER (ORDER BY v.joined_at ROWS UNBOUNDED PRECEDING) AS sitting
      FROM visits v
  )
  SELECT GREATEST(
           COALESCE(
             (SELECT min(a.joined_at) FROM grouped a
               WHERE a.sitting = (SELECT max(b.sitting) FROM grouped b)),
             p_fallback),
           (SELECT floor_since FROM game));
$function$;

COMMENT ON FUNCTION public.fn_nit_sitting_since(uuid, uuid, timestamptz) IS
  'The one VPIP window definition (2026-10-24), now rejoin-aware (Dan 2026-11-10): the '
  'sitting in the game, where a return inside the platform''s own re-entry window '
  '(cash_player_session.rejoin_window_ms, floored at two hours) continues the same sitting '
  'rather than starting a fresh sample, and never earlier than the instant the floor came on. '
  'fn_nit_check, fn_nit_status and fn_cash_vpip_status all call it and carry no copy.';

-- -- 2. The activation ledger -----------------------------------------------
-- No foreign key to a hot relation (CLAUDE.md 2, rule 7).
CREATE TABLE IF NOT EXISTS public.ca_classic_vpip_activations (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  game_id        uuid NOT NULL,
  club_id        uuid,
  variant        text NOT NULL,
  bb             numeric NOT NULL,
  floor_percent  integer NOT NULL,
  window_hands   integer NOT NULL,
  grace_hands    integer NOT NULL,
  tables_updated integer NOT NULL,
  migration      text NOT NULL DEFAULT '20261111022301',
  activated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ca_classic_vpip_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_classic_vpip_activations FROM PUBLIC;
REVOKE ALL ON TABLE public.ca_classic_vpip_activations FROM anon;
REVOKE ALL ON TABLE public.ca_classic_vpip_activations FROM authenticated;
REVOKE ALL ON TABLE public.ca_classic_vpip_activations FROM service_role;
REVOKE ALL ON SEQUENCE public.ca_classic_vpip_activations_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.ca_classic_vpip_activations IS
  'One row per Classic game the approved VPIP floor was activated on (Dan 2026-11-10), with '
  'the values applied and how many of its tables the maintained ruleset path updated. An '
  'audit record, read by people; nothing in the running game reads it.';

-- -- 3. Activation, through the maintained ruleset path ----------------------
DO $activate$
DECLARE
  r       record;
  v_n     integer;
  v_games integer := 0;
  v_tables integer := 0;
BEGIN
  FOR r IN
    SELECT g.id, g.club_id, g.variant, g.bb,
           fl.floor_percent, fl.window_hands, fl.warn_grace_hands
      FROM public.cash_games g
      JOIN public.ca_classic_vpip_floors fl
        ON fl.variant = g.variant AND g.bb >= fl.min_bb
      JOIN public.clubs c ON c.id = g.club_id
     WHERE g.template_name = 'classic'
       AND g.closed_at IS NULL
       AND COALESCE(c.lifecycle_status, '') <> 'retired'
     ORDER BY g.id
  LOOP
    -- Touching the row is what makes fn_cash_game_floor_from_template
    -- recompute the game's promise; fn_cash_apply_ruleset then carries that
    -- promise onto this game's tables, exactly as it does for any other
    -- ruleset change. Nothing here writes nit_game or maintain_* by hand.
    UPDATE public.cash_games SET ruleset_snapshot = ruleset_snapshot WHERE id = r.id;
    v_n := public.fn_cash_apply_ruleset(r.id);

    INSERT INTO public.ca_classic_vpip_activations
      (game_id, club_id, variant, bb, floor_percent, window_hands, grace_hands, tables_updated)
    VALUES
      (r.id, r.club_id, r.variant, r.bb, r.floor_percent, r.window_hands,
       r.warn_grace_hands, COALESCE(v_n, 0));

    v_games := v_games + 1;
    v_tables := v_tables + COALESCE(v_n, 0);
  END LOOP;

  RAISE NOTICE 'Classic VPIP floor activated on % game(s); % table row(s) updated by the maintained path',
    v_games, v_tables;
END
$activate$;

-- -- 4. Post-conditions: this transaction aborts unless it actually took ----
DO $verify$
DECLARE v_bad integer; v_detail text;
BEGIN
  -- (a) Every eligible game now promises its approved floor, window, rolling
  --     mode and grace, and carries the instant the floor came on.
  SELECT count(*), string_agg(DISTINCT g.variant, ', ')
    INTO v_bad, v_detail
    FROM public.cash_games g
    JOIN public.ca_classic_vpip_floors fl ON fl.variant = g.variant AND g.bb >= fl.min_bb
    JOIN public.clubs c ON c.id = g.club_id
   WHERE g.template_name = 'classic' AND g.closed_at IS NULL
     AND COALESCE(c.lifecycle_status, '') <> 'retired'
     AND (COALESCE((g.ruleset_snapshot->>'vpip_floor')::integer, 0) < fl.floor_percent
       OR COALESCE((g.ruleset_snapshot->>'vpip_window')::integer, 0) <> fl.window_hands
       OR COALESCE((g.ruleset_snapshot->>'vpip_rolling')::boolean, false) IS NOT TRUE
       OR COALESCE((g.ruleset_snapshot->>'vpip_grace_hands')::integer, -1) <> fl.warn_grace_hands
       OR (g.ruleset_snapshot->>'vpip_floor_since') IS NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ACTIVATION_INCOMPLETE: % eligible game(s) do not carry the approved floor (%)',
      v_bad, v_detail;
  END IF;

  -- (b) Every live table of an eligible game is judging. Scoped to non-Diamond
  --     clubs: fn_cash_apply_ruleset hands a Diamond cluster to
  --     fn_poker_diamond_project_cluster, which owns that projection.
  SELECT count(*) INTO v_bad
    FROM public.tables t
    JOIN public.cash_games g ON g.id = t.cluster_id
    JOIN public.ca_classic_vpip_floors fl ON fl.variant = g.variant AND g.bb >= fl.min_bb
    JOIN public.clubs c ON c.id = g.club_id
   WHERE g.template_name = 'classic' AND g.closed_at IS NULL
     AND COALESCE(c.lifecycle_status, '') <> 'retired'
     AND COALESCE(c.asset, 'chips') <> 'diamonds'
     AND t.tournament_id IS NULL
     AND t.status IN ('running', 'waiting')
     AND (t.nit_game IS NOT TRUE
       OR t.maintain_percent_min < fl.floor_percent
       OR t.maintain_hands <> fl.window_hands);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ACTIVATION_TABLES_INCOMPLETE: % live table(s) of an eligible game are not judging',
      v_bad;
  END IF;

  -- (c) And NOTHING outside the approved scope picked the rule up: no Action or
  --     Madness game, and nothing below 0.50/1.00, carries the rolling floor.
  SELECT count(*) INTO v_bad
    FROM public.cash_games g
   WHERE g.closed_at IS NULL
     AND (g.ruleset_snapshot ? 'vpip_rolling')
     AND NOT (g.template_name = 'classic'
              AND EXISTS (SELECT 1 FROM public.ca_classic_vpip_floors fl
                           WHERE fl.variant = g.variant AND g.bb >= fl.min_bb));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ACTIVATION_OVERREACH: % game(s) outside the approved scope carry the rolling floor',
      v_bad;
  END IF;

  -- (d) Action and Madness still judge the way they did: a ten-hand window and
  --     no grace. If this trips, the Classic branch has leaked.
  SELECT count(*) INTO v_bad
    FROM public.cash_games g
   WHERE g.closed_at IS NULL
     AND g.template_name <> 'classic'
     AND (COALESCE((g.ruleset_snapshot->>'vpip_window')::integer, 10) <> 10
       OR COALESCE((g.ruleset_snapshot->>'vpip_grace_hands')::integer, 0) <> 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ACTIVATION_TOUCHED_OTHER_TEMPLATES: % non-Classic game(s) changed', v_bad;
  END IF;
END
$verify$;

COMMIT;
