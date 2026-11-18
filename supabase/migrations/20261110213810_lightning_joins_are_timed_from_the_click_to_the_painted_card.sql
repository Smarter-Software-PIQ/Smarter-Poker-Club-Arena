-- 20261110213810_lightning_joins_are_timed_from_the_click_to_the_painted_card.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: to_regprocedure('public.fn_report_lightning_join_timing(jsonb)') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_lightning_join_timing_report(timestamp with time zone,timestamp with time zone)') IS NOT NULL
--
-- WHAT THIS CHANGES, AND WHY (owner direction, 2026-11-10):
--
-- Dan's first Lightning hand took 18.4 s from his pool session opening
-- (15:41:10.04Z) to the hand being dealt (15:41:28.56Z). The engine's Phase 12
-- latency ledger times the legs it can see (fold ack, idle pool, match, hand to
-- first render), but nothing recorded the browser's half of a JOIN: the click,
-- the buy-in question, the purchase, the room page, the table socket, the first
-- snapshot. So the 18.4 s could not be attributed, and a slow join could never be
-- shown to be a client leg or a server one.
--
-- This adds a first-party sink for exactly that, one row per join:
--
--   client_lightning_join_timings              one row per Lightning join a browser
--                                       completed (cards painted) or gave up on
--                                       (timeout). Marks are whole milliseconds
--                                       from the Join click, on the browser's
--                                       own monotonic clock. RLS on, no policy:
--                                       no browser role can read or write it.
--   fn_report_lightning_join_timing     the ONE door in. SECURITY DEFINER so a
--                                       browser can write without a table grant;
--                                       user_id is auth.uid(), never a client
--                                       value; marks are whitelisted, numeric
--                                       and clamped; per user 10 a minute, 200 a
--                                       minute in total; best effort, never an
--                                       error at the browser.
--   fn_lightning_join_timing_report     per-leg n / p50 / p95 over a window, for
--                                       service_role reads only.
--
-- RETENTION is part of the write: each accepted row deletes at most 100 rows
-- older than fourteen days, so the table stays bounded with no scheduled job.
--
-- NOT the client error sink. fn_report_client_errors feeds the error-rate
-- gauges and the daily digest; a timing row there would be counted as an error.
--
-- NOT a lightning_* table, on purpose: fn_lightning_rollout_readiness requires
-- the set of lightning_* tables service_role can SELECT to be exactly its
-- eight named gameplay tables, and a ninth turns every Cluster NO_GO
-- (tests/lightning/lightning-readiness-names-its-tables.law.test.ts). This is
-- browser telemetry, not a gameplay table, so it is named like the other
-- client sink (client_error_events).
--
-- NO FOREIGN KEY (CLAUDE.md DDL rule 7: a log table never references a hot
-- table). Every object is new, so nothing existing is locked.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.client_lightning_join_timings (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  user_id      uuid NOT NULL,
  cluster_id   uuid,
  kind         text NOT NULL CHECK (kind IN ('buy_in', 'rejoin')),
  outcome      text NOT NULL CHECK (outcome IN ('painted', 'timeout')),
  hidden       boolean NOT NULL DEFAULT false,
  app_version  text CHECK (char_length(app_version) <= 64),
  marks        jsonb NOT NULL CHECK (jsonb_typeof(marks) = 'object' AND octet_length(marks::text) <= 1024)
);

COMMENT ON TABLE public.client_lightning_join_timings IS
  'One row per Lightning join a browser timed: marks are ms from the Join click (browser monotonic clock). Written only through fn_report_lightning_join_timing; read through fn_lightning_join_timing_report.';

CREATE INDEX client_lightning_join_timings_received_at_idx
  ON public.client_lightning_join_timings (received_at);
CREATE INDEX client_lightning_join_timings_user_received_idx
  ON public.client_lightning_join_timings (user_id, received_at);

ALTER TABLE public.client_lightning_join_timings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_lightning_join_timings FROM PUBLIC, anon, authenticated, service_role;
-- Diagnostic reads only; every write goes through the two definer functions.
GRANT SELECT ON public.client_lightning_join_timings TO service_role;

CREATE FUNCTION public.fn_report_lightning_join_timing(p_timing jsonb)
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
BEGIN
  -- Best effort, never an error at the browser: a malformed call stores nothing.
  IF v_uid IS NULL OR p_timing IS NULL OR jsonb_typeof(p_timing) <> 'object'
     OR octet_length(p_timing::text) > 4096 THEN
    RETURN 0;
  END IF;

  v_kind := p_timing ->> 'kind';
  v_outcome := p_timing ->> 'outcome';
  IF v_kind IS NULL OR v_kind NOT IN ('buy_in', 'rejoin')
     OR v_outcome IS NULL OR v_outcome NOT IN ('painted', 'timeout') THEN
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

  INSERT INTO public.client_lightning_join_timings (user_id, cluster_id, kind, outcome, hidden, app_version, marks)
  VALUES (
    v_uid, v_cluster, v_kind, v_outcome,
    coalesce((p_timing -> 'hidden') = 'true'::jsonb, false),
    CASE WHEN jsonb_typeof(p_timing -> 'app_version') = 'string'
         THEN nullif(left(regexp_replace(p_timing ->> 'app_version', '[^A-Za-z0-9._+-]', '', 'g'), 64), '') END,
    v_marks);

  -- Retention travels with the write: at most 100 expired rows per accepted row.
  DELETE FROM public.client_lightning_join_timings
   WHERE id IN (SELECT id FROM public.client_lightning_join_timings
                 WHERE received_at < v_now - interval '14 days'
                 ORDER BY received_at LIMIT 100);

  RETURN 1;
END;
$function$;

COMMENT ON FUNCTION public.fn_report_lightning_join_timing(jsonb) IS
  'Best-effort Lightning join timing sink for signed-in players. user_id = auth.uid(); whitelisted marks clamped to 0..600000 ms; 10/min per user, 200/min total; prunes up to 100 rows older than 14 days per write. Returns 1 when kept, else 0.';

REVOKE ALL ON FUNCTION public.fn_report_lightning_join_timing(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_report_lightning_join_timing(jsonb) TO authenticated, service_role;

-- Per-leg n / p50 / p95 over a window. A leg is the gap between two marks of
-- the same join; a join without both marks contributes nothing to that leg.
-- 'player_decides' is the player's own time on the buy-in question; 'system'
-- is every leg the player did not choose (click -> question, confirm -> cards).
CREATE FUNCTION public.fn_lightning_join_timing_report(
  p_since timestamptz DEFAULT now() - interval '24 hours',
  p_until timestamptz DEFAULT now()
)
RETURNS TABLE (leg text, ord integer, n bigint, p50_ms numeric, p95_ms numeric, max_ms numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH joined AS (
    SELECT t.marks, t.kind
      FROM public.client_lightning_join_timings t
     WHERE t.received_at >= p_since AND t.received_at < p_until
       AND NOT t.hidden AND t.outcome = 'painted'
  ), legs(leg, ord, a, b) AS (
    VALUES
      ('open_question',        1, 'click',             'dialog_shown'),
      ('rejoin_check',         2, 'click',             'rejoin_checked'),
      ('player_decides',       3, 'dialog_shown',      'confirm'),
      ('hold_chair',           4, 'confirm',           'hold_answered'),
      ('purchase',             5, 'hold_answered',     'purchase_answered'),
      ('pool_session_read',    6, 'purchase_answered', 'seated'),
      ('route_to_room',        7, 'seated',            'room_open'),
      ('socket_connect',       8, 'room_open',         'socket_connected'),
      ('first_snapshot',       9, 'socket_connected',  'first_snapshot'),
      ('pool_wait_to_hand',   10, 'first_snapshot',    'first_hand'),
      ('hand_to_paint',       11, 'first_hand',        'cards_painted')
  ), gaps AS (
    SELECT l.leg, l.ord, ((r.marks ->> l.b)::numeric - (r.marks ->> l.a)::numeric) AS ms
      FROM joined r CROSS JOIN legs l
     WHERE r.marks ? l.a AND r.marks ? l.b
    UNION ALL
    SELECT 'system', 12,
           CASE WHEN r.kind = 'rejoin' OR NOT (r.marks ? 'confirm')
                THEN (r.marks ->> 'cards_painted')::numeric - (r.marks ->> 'click')::numeric
                ELSE ((r.marks ->> 'cards_painted')::numeric - (r.marks ->> 'confirm')::numeric)
                   + coalesce((r.marks ->> 'dialog_shown')::numeric - (r.marks ->> 'click')::numeric, 0) END
      FROM joined r
     WHERE r.marks ? 'click' AND r.marks ? 'cards_painted'
  )
  SELECT g.leg, g.ord, count(*)::bigint,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.ms)::numeric, 0),
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY g.ms)::numeric, 0),
         max(g.ms)
    FROM gaps g
   WHERE g.ms >= 0
   GROUP BY g.leg, g.ord
   ORDER BY g.ord
$function$;

COMMENT ON FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz) IS
  'Lightning join legs (n, p50, p95, max ms) from client_lightning_join_timings over [p_since, p_until); visible tabs and painted joins only. service_role only.';

REVOKE ALL ON FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_join_timing_report(timestamptz, timestamptz) TO service_role;

COMMIT;
