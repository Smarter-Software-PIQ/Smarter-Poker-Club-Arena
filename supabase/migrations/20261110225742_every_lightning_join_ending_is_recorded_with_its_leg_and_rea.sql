-- 20261110225742_every_lightning_join_ending_is_recorded_with_its_leg_and_rea.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: to_regprocedure('public.fn_lightning_join_outcome_report(timestamp with time zone,timestamp with time zone)') IS NOT NULL
-- @live-proof: EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_lightning_join_timings' AND column_name = 'reason_code')
--
-- WHAT THIS CHANGES, AND WHY (owner direction, 2026-11-10):
--
-- Dan: "measure the complete Join-to-visible-cards path, including failed
-- attempts and tail latency", then: "report sample sizes per outcome
-- (successful, failed, abandoned) and per-stage timings; label any percentile
-- you do not have enough samples for as unknown rather than estimating."
--
-- 20261110213810 recorded a join only when its cards painted or it timed out.
-- A refused, failed or abandoned join left nothing, so a door that turned
-- players away was invisible, and a slow tail was only ever the tail of the
-- joins that worked. This records every join's ending:
--
--   client_lightning_join_timings
--     outcome      painted | timeout | refused | failed | abandoned
--     reason_code  an upper-case token ([A-Z0-9_], 1..64): the browser's own
--                  code (SIGN_IN_REQUIRED, DIALOG_CLOSED, NO_PAINT...) or a
--                  door's error code (PLATFORM_FROZEN, INSUFFICIENT_CHIPS...).
--                  Never free text: anything else is stored as UNSPECIFIED.
--                  NULL for painted.
--     ended_at     the last mark the join reached, DERIVED HERE from the
--                  marks (largest value; a tie goes to the later mark in
--                  join order), never taken from the client.
--
--   fn_report_lightning_join_timing(jsonb)   accepts the three new outcomes
--     and a reason; unchanged otherwise: auth.uid(), whitelisted marks
--     clamped to 0..600000 ms, 10 a minute per player, 200 a minute in total,
--     up to 100 rows older than 14 days pruned per accepted write.
--
--   fn_lightning_join_timing_report(since, until)   replaced (new columns):
--     per stage n, p50, p95, p99, max, and `ended_here` = joins that did not
--     paint and stopped inside that stage. Stage durations use every join
--     that reached both marks, whatever its outcome; tabs that were hidden
--     are left out of durations (their paint waited for the player) but
--     still counted in `ended_here`.
--     A PERCENTILE WITHOUT ENOUGH SAMPLES IS NULL ("unknown"), never an
--     estimate: p50 needs n >= 5, p95 needs n >= 20, p99 needs n >= 100 (at
--     least one sample beyond each percentile). max is always the observed max.
--
--   fn_lightning_join_outcome_report(since, until)   new: sample sizes by
--     group (successful = painted; failed = refused, failed, timeout;
--     abandoned), outcome, stage ended in and reason code, with how many were
--     in a hidden tab. service_role only.
--
-- Not a lightning_* table (readiness counts exactly eight of those); no
-- foreign key; client_lightning_join_timings is a new, cold telemetry table,
-- so the ALTERs lock nothing a player waits on.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.client_lightning_join_timings
  DROP CONSTRAINT client_lightning_join_timings_outcome_check,
  ADD CONSTRAINT client_lightning_join_timings_outcome_check
    CHECK (outcome IN ('painted', 'timeout', 'refused', 'failed', 'abandoned')),
  ADD COLUMN reason_code text
    CHECK (reason_code ~ '^[A-Z0-9_]{1,64}$'),
  ADD COLUMN ended_at text
    CHECK (ended_at IN ('click', 'rejoin_checked', 'dialog_shown', 'confirm', 'hold_answered',
                        'purchase_answered', 'seated', 'room_open', 'socket_connected',
                        'first_snapshot', 'first_hand', 'cards_painted'));

CREATE OR REPLACE FUNCTION public.fn_report_lightning_join_timing(p_timing jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_now     timestamptz := now();
  v_recent  integer;
  v_global  integer;
  v_marks   jsonb;
  v_cluster uuid;
  v_kind    text;
  v_outcome text;
  v_reason  text;
  v_ended   text;
BEGIN
  -- Best effort, never an error at the browser: a malformed call stores nothing.
  IF v_uid IS NULL OR p_timing IS NULL OR jsonb_typeof(p_timing) <> 'object'
     OR octet_length(p_timing::text) > 4096 THEN
    RETURN 0;
  END IF;

  v_kind := p_timing ->> 'kind';
  v_outcome := p_timing ->> 'outcome';
  IF v_kind IS NULL OR v_kind NOT IN ('buy_in', 'rejoin')
     OR v_outcome IS NULL OR v_outcome NOT IN ('painted', 'timeout', 'refused', 'failed', 'abandoned') THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_timing -> 'marks') <> 'object' THEN
    RETURN 0;
  END IF;

  -- Only the named marks, only whole milliseconds from 0 to ten minutes.
  SELECT coalesce(jsonb_object_agg(m.key, least(600000, greatest(0, round((m.value #>> '{}')::numeric)))::bigint), '{}'::jsonb)
    INTO v_marks
    FROM jsonb_each(p_timing -> 'marks') AS m(key, value)
   WHERE m.key IN ('click', 'rejoin_checked', 'dialog_shown', 'confirm', 'hold_answered',
                   'purchase_answered', 'seated', 'room_open', 'socket_connected',
                   'first_snapshot', 'first_hand', 'cards_painted')
     AND jsonb_typeof(m.value) = 'number';
  IF v_marks = '{}'::jsonb THEN
    RETURN 0;
  END IF;

  -- The stage it ended in: the last mark reached, read from the marks themselves.
  SELECT o.mark INTO v_ended
    FROM unnest(ARRAY['click', 'rejoin_checked', 'dialog_shown', 'confirm', 'hold_answered',
                      'purchase_answered', 'seated', 'room_open', 'socket_connected',
                      'first_snapshot', 'first_hand', 'cards_painted']) WITH ORDINALITY AS o(mark, n)
   WHERE v_marks ? o.mark
   ORDER BY (v_marks ->> o.mark)::bigint DESC, o.n DESC
   LIMIT 1;

  -- A reason is a code, never text: anything else is UNSPECIFIED. Painted has none.
  IF v_outcome <> 'painted' THEN
    v_reason := CASE WHEN jsonb_typeof(p_timing -> 'reason') = 'string'
                      AND (p_timing ->> 'reason') ~ '^[A-Z0-9_]{1,64}$'
                     THEN p_timing ->> 'reason' ELSE 'UNSPECIFIED' END;
  END IF;

  IF jsonb_typeof(p_timing -> 'cluster_id') = 'string'
     AND pg_input_is_valid(p_timing ->> 'cluster_id', 'uuid') THEN
    v_cluster := (p_timing ->> 'cluster_id')::uuid;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_lightning_join_timings:' || v_uid::text, 0));

  SELECT count(*) INTO v_recent FROM (
    SELECT 1 FROM public.client_lightning_join_timings
     WHERE user_id = v_uid AND received_at > v_now - interval '1 minute'
     LIMIT 10) s;
  IF v_recent >= 10 THEN
    RETURN 0;
  END IF;
  SELECT count(*) INTO v_global FROM (
    SELECT 1 FROM public.client_lightning_join_timings
     WHERE received_at > v_now - interval '1 minute'
     LIMIT 200) s;
  IF v_global >= 200 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.client_lightning_join_timings
    (user_id, cluster_id, kind, outcome, hidden, app_version, marks, reason_code, ended_at)
  VALUES (
    v_uid, v_cluster, v_kind, v_outcome,
    coalesce((p_timing -> 'hidden') = 'true'::jsonb, false),
    CASE WHEN jsonb_typeof(p_timing -> 'app_version') = 'string'
         THEN nullif(left(regexp_replace(p_timing ->> 'app_version', '[^A-Za-z0-9._+-]', '', 'g'), 64), '') END,
    v_marks, v_reason, v_ended);

  -- Retention travels with the write: at most 100 expired rows per accepted row.
  DELETE FROM public.client_lightning_join_timings
   WHERE id IN (SELECT id FROM public.client_lightning_join_timings
                 WHERE received_at < v_now - interval '14 days'
                 ORDER BY received_at LIMIT 100);

  RETURN 1;
END;
$function$;

COMMENT ON FUNCTION public.fn_report_lightning_join_timing(jsonb) IS
  'Best-effort Lightning join timing sink for signed-in players: every join ending (painted, timeout, refused, failed, abandoned) with a reason code and the stage it ended in. user_id = auth.uid(); whitelisted marks clamped to 0..600000 ms; 10/min per user, 200/min total; prunes up to 100 rows older than 14 days per write. Returns 1 when kept, else 0.';

REVOKE ALL ON FUNCTION public.fn_report_lightning_join_timing(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_report_lightning_join_timing(jsonb) TO authenticated, service_role;

DROP FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz);

CREATE FUNCTION public.fn_lightning_join_timing_report(
  p_since timestamptz DEFAULT now() - interval '24 hours',
  p_until timestamptz DEFAULT now()
)
RETURNS TABLE (leg text, ord integer, n bigint, p50_ms numeric, p95_ms numeric, p99_ms numeric,
               max_ms numeric, ended_here bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH joined AS (
    SELECT t.marks, t.kind, t.outcome, t.hidden, t.ended_at
      FROM public.client_lightning_join_timings t
     WHERE t.received_at >= p_since AND t.received_at < p_until
  ), legs(leg, ord, a, b) AS (
    VALUES
      -- the stages, in join order: a join that stops after reaching `a` ended in that stage
      ('rejoin_check',        1, 'click',             'rejoin_checked'),
      ('price_read',          2, 'rejoin_checked',    'dialog_shown'),
      ('player_decides',      3, 'dialog_shown',      'confirm'),
      ('hold_chair',          4, 'confirm',           'hold_answered'),
      ('purchase',            5, 'hold_answered',     'purchase_answered'),
      ('pool_session_read',   6, 'purchase_answered', 'seated'),
      ('route_to_room',       7, 'seated',            'room_open'),
      ('socket_connect',      8, 'room_open',         'socket_connected'),
      ('first_snapshot',      9, 'socket_connected',  'first_snapshot'),
      ('pool_wait_to_hand',  10, 'first_snapshot',    'first_hand'),
      ('hand_to_paint',      11, 'first_hand',        'cards_painted'),
      -- spans across stages (no ended_here)
      ('open_question',      12, 'click',             'dialog_shown'),
      ('click_to_cards',     14, 'click',             'cards_painted')
  ), gaps AS (
    SELECT l.leg, l.ord, ((r.marks ->> l.b)::numeric - (r.marks ->> l.a)::numeric) AS ms
      FROM joined r CROSS JOIN legs l
     WHERE NOT r.hidden AND r.marks ? l.a AND r.marks ? l.b
    UNION ALL
    -- what the player did not choose: everything but their time on the question
    SELECT 'system', 13,
           CASE WHEN r.kind = 'rejoin' OR NOT (r.marks ? 'confirm')
                THEN (r.marks ->> 'cards_painted')::numeric - (r.marks ->> 'click')::numeric
                ELSE ((r.marks ->> 'cards_painted')::numeric - (r.marks ->> 'confirm')::numeric)
                   + coalesce((r.marks ->> 'dialog_shown')::numeric - (r.marks ->> 'click')::numeric, 0) END
      FROM joined r
     WHERE NOT r.hidden AND r.marks ? 'click' AND r.marks ? 'cards_painted'
  ), stats AS (
    SELECT g.leg, g.ord, count(*)::bigint AS n,
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY g.ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY g.ms) AS p95,
           percentile_cont(0.99) WITHIN GROUP (ORDER BY g.ms) AS p99,
           max(g.ms) AS mx
      FROM gaps g
     WHERE g.ms >= 0
     GROUP BY g.leg, g.ord
  ), names(leg, ord, a) AS (
    SELECT l.leg, l.ord, CASE WHEN l.ord <= 11 THEN l.a END FROM legs l
    UNION ALL SELECT 'system', 13, NULL
  )
  SELECT nm.leg, nm.ord,
         coalesce(s.n, 0),
         CASE WHEN s.n >= 5   THEN round(s.p50::numeric, 0) END,
         CASE WHEN s.n >= 20  THEN round(s.p95::numeric, 0) END,
         CASE WHEN s.n >= 100 THEN round(s.p99::numeric, 0) END,
         s.mx,
         CASE WHEN nm.a IS NOT NULL THEN
           (SELECT count(*) FROM joined j WHERE j.outcome <> 'painted' AND j.ended_at = nm.a)
         END
    FROM names nm
    LEFT JOIN stats s ON s.leg = nm.leg
   ORDER BY nm.ord
$function$;

COMMENT ON FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz) IS
  'Lightning join stages over [p_since, p_until): n, p50 (NULL below 5 samples), p95 (NULL below 20), p99 (NULL below 100), max ms, and ended_here = joins that did not paint and stopped in that stage. Durations leave out hidden tabs. service_role only.';

REVOKE ALL ON FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz) TO service_role;

CREATE FUNCTION public.fn_lightning_join_outcome_report(
  p_since timestamptz DEFAULT now() - interval '24 hours',
  p_until timestamptz DEFAULT now()
)
RETURNS TABLE (outcome_group text, outcome text, ended_at text, reason_code text, n bigint, hidden bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE t.outcome WHEN 'painted' THEN 'successful'
                        WHEN 'abandoned' THEN 'abandoned'
                        ELSE 'failed' END,
         t.outcome, t.ended_at, t.reason_code,
         count(*)::bigint, count(*) FILTER (WHERE t.hidden)::bigint
    FROM public.client_lightning_join_timings t
   WHERE t.received_at >= p_since AND t.received_at < p_until
   GROUP BY 1, 2, 3, 4
   ORDER BY 1 DESC, 5 DESC, 2, 3, 4
$function$;

COMMENT ON FUNCTION public.fn_lightning_join_outcome_report(timestamptz, timestamptz) IS
  'Lightning join sample sizes over [p_since, p_until) by group (successful, failed, abandoned), outcome, stage ended in and reason code, with the hidden-tab count. service_role only.';

REVOKE ALL ON FUNCTION public.fn_lightning_join_outcome_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_join_outcome_report(timestamptz, timestamptz) TO service_role;

COMMIT;
