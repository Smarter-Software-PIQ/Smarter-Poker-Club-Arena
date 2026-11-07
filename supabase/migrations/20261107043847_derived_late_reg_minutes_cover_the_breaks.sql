-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_tournament_level_clock_floor()'::regprocedure), 'fn_ca_late_registration_break_allowance') > 0 AND public.fn_ca_late_registration_break_allowance(120) = 30 AND public.fn_ca_late_registration_break_allowance(60) = 20
-- 20261107043847_derived_late_reg_minutes_cover_the_breaks.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-06: "FINISH THIS UP YOURSELF". Found while making the lobby
-- countdown honest (#9769, #9777, #9793).
--
-- The final INSERT trigger fn_ca_tournament_level_clock_floor rewrites
-- late_reg_mins to the NOMINAL length of the entry levels, whatever the writer
-- sent. fn_tournament_late_registration_open closes an ordinary event at
-- whichever comes first of its levels and those minutes (since 20260926035534),
-- and the minutes were only meant to stop a STALLED level clock holding entry
-- open past the advertised window. But the synchronized :55 break stops the
-- level clock for about ten minutes (measured over 152 breaks on 2026-11-06/07:
-- first resumed hand a median 627 s after :55; the Nightly 10K's clock stopped
-- 01:55:00 - 02:05:04), and the nominal minutes run on through it. So every
-- break-taking event whose window crossed a break closed entry before the last
-- level it advertises: the Sunday 200 Deep Stack (12 levels, 120 minutes)
-- would have closed about two levels early.
--
-- THE FIX, at the authority that writes the value:
--   * fn_ca_late_registration_break_allowance(nominal): ten minutes for every
--     break the window can cross, counted over the window it grows to
--     (nominal 60 -> 20, 120 -> 30). Still a hard cap for a stalled clock.
--   * the floor trigger adds it for events that take synchronized breaks
--     (mtt-v1/mtt-v2 with synchronized_breaks not false), EXCEPT Free Buys,
--     whose sixty minutes are the owner's hour (the lock trigger sets 12/60)
--     and are the rule itself, not a derived cap.
--   * upcoming rows (not started, derived minutes equal to the nominal
--     length) are brought onto the same rule through the sanctioned
--     app.lock_level_clock path of fn_guard_managed_game_lifecycle.
-- Unchanged: levels, levels-only schedules (minutes 0), add-on admission (its
-- window alone decides), Free Buys, started events, chips, entries, payouts.
-- The level gate stays authoritative; the clock stays a cap.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_ca_late_registration_break_allowance(p_nominal integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_allow integer := 0;
  v_next integer;
BEGIN
  IF p_nominal IS NULL OR p_nominal <= 0 THEN RETURN 0; END IF;
  -- Ten measured minutes per break the window can cross; the window grows by
  -- what it adds, so settle it (it converges in a few steps).
  FOR i IN 1..10 LOOP
    v_next := 10 * (floor((p_nominal + v_allow) / 60.0)::integer + 1);
    EXIT WHEN v_next = v_allow;
    v_allow := v_next;
  END LOOP;
  RETURN v_allow;
END
$fn$;

DO $patch$
DECLARE
  v_definition text;
  v_before text := E'   WHERE e.n<=NEW.late_reg_levels AND NOT coalesce((e.value->>''isBreak'')::boolean,false);\n  END IF;';
  v_after text := E'   WHERE e.n<=NEW.late_reg_levels AND NOT coalesce((e.value->>''isBreak'')::boolean,false);\n'
    || E'   -- 2026-11-07: a derived clock caps a stalled level clock; it must not\n'
    || E'   -- close entry before the advertised last level because breaks stopped\n'
    || E'   -- the levels. Free Buy minutes are the owner''s hour and stay as set.\n'
    || E'   IF coalesce(NEW.late_reg_mins,0)>0\n'
    || E'      AND NEW.format_contract::text IN (''mtt-v1'',''mtt-v2'')\n'
    || E'      AND NEW.synchronized_breaks IS DISTINCT FROM false\n'
    || E'      AND NOT coalesce(NEW.free_buy,false)\n'
    || E'      AND NOT (lower(coalesce(NEW.name,'''')) ~ ''free ?buy''\n'
    || E'               AND coalesce(NEW.buy_in_amount,0)+coalesce(NEW.buy_in_fee,0)=0) THEN\n'
    || E'    NEW.late_reg_mins := NEW.late_reg_mins + public.fn_ca_late_registration_break_allowance(NEW.late_reg_mins);\n'
    || E'   END IF;\n'
    || E'  END IF;';
  v_count integer;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_tournament_level_clock_floor()'::regprocedure)
    INTO v_definition;
  IF strpos(v_definition, 'fn_ca_late_registration_break_allowance') > 0 THEN
    RAISE EXCEPTION 'fn_ca_tournament_level_clock_floor already carries the break allowance';
  END IF;
  v_count := (length(v_definition) - length(replace(v_definition, v_before, ''))) / length(v_before);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'fn_ca_tournament_level_clock_floor source drift: expected one derived-minutes block, found %', v_count;
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END
$patch$;

-- Upcoming events onto the same rule. Only rows whose minutes still equal the
-- nominal length of their entry levels (the derived value), so an explicit
-- clock is never touched.
DO $backfill$
DECLARE
  v_updated integer;
BEGIN
  PERFORM set_config('app.lock_level_clock', 'on', true);
  WITH c AS (
    SELECT t.id,
      (SELECT ceil(coalesce(sum(coalesce(nullif((e.value->>'durationMinutes')::numeric,0),
                                          nullif((e.value->>'duration_minutes')::numeric,0),
                                          (e.value->>'duration')::numeric/60)),0))::integer
         FROM jsonb_array_elements(t.blind_structure::jsonb) WITH ORDINALITY e(value,n)
        WHERE e.n <= t.late_reg_levels
          AND NOT coalesce((e.value->>'isBreak')::boolean,false)) AS nominal
    FROM public.tournaments t
    WHERE upper(coalesce(t.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING')
      AND t.started_at IS NULL
      AND coalesce(t.current_level,0) = 0
      AND NOT coalesce(t.prize_pool_finalized,false)
      AND t.format_contract::text IN ('mtt-v1','mtt-v2')
      AND t.synchronized_breaks IS DISTINCT FROM false
      AND coalesce(t.late_reg_levels,0) > 0
      AND coalesce(t.late_reg_mins,0) > 0
      AND NOT coalesce(t.free_buy,false)
      AND NOT (lower(coalesce(t.name,'')) ~ 'free ?buy'
               AND coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0) = 0)
  )
  UPDATE public.tournaments t
     SET late_reg_mins = c.nominal + public.fn_ca_late_registration_break_allowance(c.nominal)
    FROM c
   WHERE t.id = c.id
     AND c.nominal > 0
     AND t.late_reg_mins = c.nominal;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'derived late-reg minutes moved onto the break allowance: % upcoming events', v_updated;
END
$backfill$;

COMMIT;
