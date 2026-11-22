-- 20261121152102_a_lightning_switch_off_starts_a_fresh_vpip_sample
--
-- A LIGHTNING SWITCH-OFF STARTS A FRESH VPIP SAMPLE (Horse SWITCH lane,
-- 2026-11-21). People and Horses alike.
--
-- WHAT WAS WRONG. While a Lightning pool is live nothing judges VPIP: a
-- parked anchor runs the sit-out clock alone (ServerTableEngineDealing,
-- evictExpiredSitOuts with sitOutOnly: true, and ServerTableEngineBase skips
-- collectNitEnforce when sitOutOnly). When the game leaves Lightning
-- (cash_cluster_conversion, lightning or draining -> must_move) the anchor
-- tables become ordinary tables, and their very next eviction pass runs
-- fn_nit_enforce. fn_nit_check takes its sample from fn_nit_sitting_since:
-- every ca_hand_facts row on any table of the game since the sitting in the
-- game began. Lightning hands are written to ca_hand_facts on the anchor
-- tables (LightningHandFacts.ts), so the WHOLE POOL SITTING was judged at the
-- instant of the switch-off, with the game's ten-hand, no-grace rule: an
-- immediate eviction and the two-hour bar (fn_cash_session_close,
-- vpip_evicted), no warning, for a sitting that no floor had judged while it
-- was played. A format change is not a verdict on the hands played in the
-- other format.
--
-- MEASURED (production, read-only, 30 days to 2026-11-21 15:00 UTC). 236
-- vpip_evicted bars on tables of Lightning-format games (template madness /
-- action). The player's last pool session ended:
--   lightning_off      160 (157 within 30 s of the switch-off; median 4.7 s)
--   lightning_drained   42 (the 2026-10-25 operator drain of five games)
--   anchor_seat_left    21 (left the pool, the game then switched off, the
--                           player sat back down inside the two-hour re-entry
--                           window and was barred 1-5 s later on the pool
--                           sitting: 20 of 21 had 0 hands after the switch-off)
--   no pool session     13
-- 235 were Horses, 1 a person (2026-11-09, no pool session; not this defect).
-- With the sample starting at the switch-off, 220 of the 236 (158 + 42 + 20)
-- had fewer than the game's ten hands after it and could not have been judged
-- at that instant. The six kept had 10-515 ordinary hands after the switch-off
-- and are judged on those, as before. Example, game 705270cd, 2026-11-21: the
-- switch-off committed 08:47:56.176 UTC; two Horses with 200 and 713 sampled
-- hands, every one a Lightning hand (20.5% / 21.9%), 0 hands after it, were
-- barred at 08:48:00.9 and 08:48:01.1.
--
-- THE FIX, AND WHY HERE. fn_nit_sitting_since is the one window definition
-- every reader shares (fn_nit_check, fn_nit_enforce's warning row,
-- fn_nit_status, fn_cash_vpip_status), and it already never reaches back
-- before the instant the floor came on (vpip_floor_since). It now also never
-- reaches back before the instant the game last left Lightning: the
-- closed_at of the newest committed conversion out of Lightning, or now()
-- while such a conversion is still pending (the drain). That is correct on
-- every path:
--   * switch-off: the sample is empty, so nothing is judged and an open
--     warning from before the pool is cleared as recovered rather than spent
--     by pool hands (fn_nit_hands_since counts every dealt hand);
--   * a player who stays and plays ordinary hands: judged on those hands only,
--     under the table's own rule (window, grace and warning as configured);
--   * a player who joins later: the sitting starts later still, unchanged;
--   * a player who left the pool and rejoins inside the re-entry window: the
--     sitting continues, but its sample still starts at the switch-off;
--   * Lightning switched back on: nothing judges a pool; at the next
--     switch-off the sample restarts again;
--   * an aborted switch-off (Lightning stays on) moves nothing;
--   * a game that never ran Lightning has no such row: GREATEST ignores the
--     NULL and every answer is the one it was, byte for byte.
-- Excluding Lightning hands inside fn_nit_sample instead was rejected: it
-- needs a per-hand join on every boundary read, and it still leaves a warning
-- opened before the pool to have its grace spent by pool hands
-- (fn_nit_hands_since) and evict at the switch-off.
--
-- A deliberate live pool judge is a separate, later change and is not this.
--
-- SCOPE. One CREATE OR REPLACE of an invoker-rights SQL function (STABLE, no
-- writes), pinned by pre- and post-image md5 as 20261118004324 did. Its
-- grants (postgres, service_role only) are kept by CREATE OR REPLACE and
-- asserted below. It reads cash_cluster_conversion, which every caller can
-- already read: each caller is SECURITY DEFINER owned by postgres, and
-- service_role holds SELECT. No table is altered, no hot relation is locked,
-- no row is written. Re-runnable: a second run finds the post-image and is a
-- no-op replace.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_nit_sitting_since';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'fn_nit_sitting_since is missing';
  END IF;
  -- pre-image: 20261111022301 (installed); post-image: this file.
  IF v_md5 NOT IN ('5c9907e0e981a6840f8a2f37e4faa9ce', '70c475718c763fc20934c3b7dfa0d1d0') THEN
    RAISE EXCEPTION 'fn_nit_sitting_since drifted (md5=%), refusing to edit', v_md5;
  END IF;
  IF to_regclass('public.cash_cluster_conversion') IS NULL THEN
    RAISE EXCEPTION 'public.cash_cluster_conversion is missing';
  END IF;
END
$guard$;

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
  -- A LIGHTNING SWITCH-OFF STARTS A FRESH SAMPLE (2026-11-21). The instant
  -- the game last left Lightning: the newest committed conversion out of it,
  -- or now() while one is still pending. No floor judged the pool hands, and
  -- the table that takes over does not judge them either. NULL for a game
  -- that never left Lightning, which GREATEST ignores.
  left_lightning AS (
    SELECT max(COALESCE(c.closed_at, now())) AS at
      FROM public.cash_cluster_conversion c
     WHERE c.cluster_id = p_game_id
       AND c.from_mode IN ('lightning', 'draining')
       AND c.to_mode IS DISTINCT FROM 'lightning'
       AND c.status IN ('committed', 'pending')
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
           (SELECT floor_since FROM game),
           (SELECT at FROM left_lightning));
$function$;

COMMENT ON FUNCTION public.fn_nit_sitting_since(uuid, uuid, timestamptz) IS
  'The one VPIP window definition (2026-10-24), rejoin-aware (Dan 2026-11-10): the sitting '
  'in the game, where a return inside the platform''s own re-entry window '
  '(cash_player_session.rejoin_window_ms, floored at two hours) continues the same sitting '
  'rather than starting a fresh sample, never earlier than the instant the floor came on, '
  'and never earlier than the instant the game last left Lightning (2026-11-21: a format '
  'change does not turn a whole pool sitting into an instant eviction). fn_nit_check, '
  'fn_nit_status and fn_cash_vpip_status all call it and carry no copy.';

DO $verify$
DECLARE
  v_md5  text;
  v_def  boolean;
  v_acl  text;
  v_cfg  text[];
  v_vol  "char";
BEGIN
  SELECT md5(p.prosrc), p.prosecdef, array_to_string(p.proacl, ','), p.proconfig, p.provolatile
    INTO v_md5, v_def, v_acl, v_cfg, v_vol
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_nit_sitting_since';
  IF v_md5 <> '70c475718c763fc20934c3b7dfa0d1d0' THEN
    RAISE EXCEPTION 'fn_nit_sitting_since post-image is %, expected 70c475718c763fc20934c3b7dfa0d1d0', v_md5;
  END IF;
  IF v_def THEN
    RAISE EXCEPTION 'fn_nit_sitting_since became SECURITY DEFINER';
  END IF;
  IF v_vol <> 's' THEN
    RAISE EXCEPTION 'fn_nit_sitting_since is no longer STABLE';
  END IF;
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'fn_nit_sitting_since search_path is %', v_cfg;
  END IF;
  IF has_function_privilege('anon', 'public.fn_nit_sitting_since(uuid,uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_nit_sitting_since(uuid,uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_nit_sitting_since is executable by anon or authenticated (acl %)', v_acl;
  END IF;
  -- A game that never left Lightning: the answer is the sitting itself.
  IF public.fn_nit_sitting_since('00000000-0000-0000-0000-000000000000'::uuid,
                                 '00000000-0000-0000-0000-000000000000'::uuid,
                                 '2026-01-01 00:00:00+00'::timestamptz)
     IS DISTINCT FROM '2026-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'fn_nit_sitting_since moved the window of a game with no Lightning history';
  END IF;
END
$verify$;

COMMIT;
