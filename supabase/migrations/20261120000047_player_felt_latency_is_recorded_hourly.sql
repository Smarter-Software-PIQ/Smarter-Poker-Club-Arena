-- 20261120000047_player_felt_latency_is_recorded_hourly.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- PLAYER-FELT LATENCY: ONE NUMBER PER TABLE FOR WHAT PLAYERS FEEL
-- (owner, 2026-11-19 17:26 Chicago)
-- ============================================================================
--
-- WHY. fn_ca_hand_gap_unintended_delay grades the ENGINE's share of the wait
-- between hands (the gap minus the animation it owes). Players do not feel
-- shares: they feel the whole wait from the last thing anyone did in a hand to
-- the next deal. Nothing recorded that number per table, so a table that felt
-- slow to the people sitting at it was invisible unless the engine's own share
-- broke its budget.
--
-- WHAT THIS CHANGES (read-only on game data; nothing here starts, stops,
-- retries or changes a table, a hand, a seat or money):
--
-- 1. public.fn_ca_felt_latency(p_from, p_to) - one row per pair of
--    consecutive hands on a table whose NEXT hand was written in [p_from,
--    p_to) (at most two hours): kind (cash, tournament, lightning), table,
--    felt_ms and, for an intended wait, the reason it is excluded.
--      felt_ms = next.started_at - the last player action of the previous hand
--                (the newest actions[].timestamp of a player action, not an
--                uncalled-bet return or other history event; bounded to the
--                hand's own started_at..ended_at), or its ended_at when it has
--                no player action.
--    Intended waits are excluded, never graded:
--      idle          the next deal came 60 s or more after the hand ended (the
--                    table was waiting for players or paused), the same bound
--                    the hand-gap watch uses;
--      maintenance   an engine maintenance break overlaps the wait;
--      break         a tournament break overlaps the wait;
--      hand_for_hand a recorded hand-for-hand interval of that tournament
--                    overlaps the wait (public.ca_tournament_hand_for_hand,
--                    read only when that table exists, so this works before
--                    and after it is installed);
--      rebuy_window  a cash hand in which a player went broke: the table holds
--                    the seat for a rebuy (the hand-gap watch leaves the same
--                    shape, cash_bust, ungraded).
--    Bounded by index: the next hands by idx_hand_history_created over one
--    hour (about 9,000 rows), the previous hand by
--    idx_hand_history_table_created (one row each, 30-minute lookback), and
--    the Lightning, break and hand-for-hand probes by their own keys.
--    Measured on production at 18:00 Chicago 2026-11-19: 3.5 s for one hour.
--
-- 2. smarter_private.ca_felt_latency_hourly - the history: per hour, per kind
--    and per table, pairs, p50, p95 and max felt_ms over the graded pairs;
--    the kind rows also keep a 250 ms histogram (241 buckets, the last one
--    60 s and over) so any longer period gets exact percentiles, and the
--    excluded counts by reason. Table rows are kept 35 days, kind rows 400.
--
-- 3. public.fn_ca_felt_latency_record(p_hour) - records one closed hour
--    (default: the hour that just ended). Re-running an hour replaces it.
--    pg_cron 'ca-felt-latency-hourly' at minute 8 (a minute no other hourly
--    job uses), 120 s statement timeout.
--
-- 4. public.fn_sp_digest_felt_latency(p_day) - the digest line: for the
--    Chicago day, per kind, graded pairs, p50 and p95 from the summed
--    histograms, the worst hour's p95, the excluded counts, the slowest table
--    (30 graded pairs or more) and how many of the day's hours were recorded.
--    fn_sp_daily_digest returns it under 'felt_latency' (anchored edit of
--    production's own text, after 'engine_cutover').
--
-- periodic-work: the hourly record IS the product the owner ordered (one felt-latency number per table per hour); it measures and stores, and repairs, retries or compensates nothing.
--
-- Pinned by tests/player-felt-latency-is-recorded-hourly.law.test.ts.

-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-felt-latency-hourly' AND schedule = '8 * * * *' AND active) AND to_regclass('smarter_private.ca_felt_latency_hourly') IS NOT NULL AND to_regprocedure('public.fn_ca_felt_latency(timestamp with time zone,timestamp with time zone)') IS NOT NULL AND to_regprocedure('public.fn_ca_felt_latency_record(timestamp with time zone)') IS NOT NULL AND to_regprocedure('public.fn_sp_digest_felt_latency(date)') IS NOT NULL AND strpos(pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure), 'fn_sp_digest_felt_latency') > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_felt_latency_record(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_sp_digest_felt_latency(date)', 'EXECUTE'))

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS smarter_private.ca_felt_latency_hourly (
  hour_start  timestamptz NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('cash', 'tournament', 'lightning')),
  table_id    uuid,
  pairs       integer     NOT NULL CHECK (pairs >= 0),
  felt_p50_ms integer,
  felt_p95_ms integer,
  felt_max_ms integer,
  hist_250ms  integer[],
  excluded    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (hour_start = date_trunc('hour', hour_start)),
  CHECK ((table_id IS NULL) = (hist_250ms IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ca_felt_latency_hourly_key
  ON smarter_private.ca_felt_latency_hourly
     (hour_start, kind, COALESCE(table_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE smarter_private.ca_felt_latency_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.ca_felt_latency_hourly FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE smarter_private.ca_felt_latency_hourly TO service_role;
COMMENT ON TABLE smarter_private.ca_felt_latency_hourly IS
  'Player-felt latency per hour: last player action of a hand to the next deal, p50/p95/max per table and per kind (table_id NULL, with a 250 ms histogram and excluded counts). Written by fn_ca_felt_latency_record (pg_cron ca-felt-latency-hourly).';

-- ---------------------------------------------------------------------------
-- 1. One row per pair of consecutive hands.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_felt_latency(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (kind text, table_id uuid, felt_ms integer, excluded text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_h4h text := '';
  -- Resolved at run time: the hand-for-hand table may not be installed yet,
  -- and a static checker must not read the clause as a reference to it.
  v_h4h_rel regclass := to_regclass('public.ca_tournament_hand_for_hand');
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '2 hours' THEN
    RAISE EXCEPTION 'FELT_LATENCY_WINDOW: a window of more than zero and at most two hours is required (got % to %)', p_from, p_to;
  END IF;
  -- Hand-for-hand intervals are excluded once the engine records them.
  IF v_h4h_rel IS NOT NULL THEN
    v_h4h := format('WHEN s.tournament_id IS NOT NULL AND EXISTS (SELECT 1 FROM %s h4h'
          || ' WHERE h4h.tournament_id = s.tournament_id AND h4h.started_at < s.next_start'
          || ' AND COALESCE(h4h.ended_at, ''infinity'') > s.ended_at) THEN ''hand_for_hand''', v_h4h_rel);
  END IF;
  RETURN QUERY EXECUTE format($q$
    WITH nx AS (
      SELECT n.id, n.table_id, n.started_at, n.created_at
        FROM public.hand_history n
       WHERE n.created_at >= $1 AND n.created_at < $2
         AND n.table_id IS NOT NULL AND n.started_at IS NOT NULL
    ),
    pair AS (
      SELECT nx.id AS next_id, nx.table_id, nx.started_at AS next_start,
             p.id AS prev_id, p.tournament_id, p.started_at AS prev_start, p.ended_at, p.actions, p.players
        FROM nx
        CROSS JOIN LATERAL (
          SELECT hh.id, hh.tournament_id, hh.started_at, hh.ended_at, hh.actions, hh.players
            FROM public.hand_history hh
           WHERE hh.table_id = nx.table_id
             AND hh.created_at < nx.created_at
             AND hh.created_at >= nx.created_at - interval '30 minutes'
           ORDER BY hh.created_at DESC
           LIMIT 1) p
       WHERE p.ended_at IS NOT NULL AND nx.started_at > p.ended_at
    ),
    s AS (
      SELECT pair.*,
             (SELECT max((a->>'timestamp')::numeric)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pair.actions) = 'array' THEN pair.actions ELSE '[]'::jsonb END) a
               WHERE a ? 'userId' AND NOT a ? 'historyEvent'
                 AND (a->>'action') IS DISTINCT FROM 'return'
                 AND (a->>'timestamp') ~ '^[0-9]{10,16}(\.[0-9]+)?$') AS last_action_ms
        FROM pair
    ),
    g AS (
      SELECT CASE WHEN EXISTS (SELECT 1 FROM public.lightning_hand lh WHERE lh.hand_history_id IN (s.next_id, s.prev_id)) THEN 'lightning'
                  WHEN s.tournament_id IS NOT NULL THEN 'tournament'
                  ELSE 'cash' END AS kind,
             s.table_id,
             (extract(epoch FROM s.next_start - LEAST(s.ended_at, GREATEST(COALESCE(s.prev_start, s.ended_at),
                COALESCE(to_timestamp(s.last_action_ms / 1000.0), s.ended_at)))) * 1000)::integer AS felt_ms,
             CASE
               WHEN s.next_start - s.ended_at >= interval '60 seconds' THEN 'idle'
               WHEN EXISTS (SELECT 1 FROM public.engine_maintenance_break_log b
                             WHERE b.break_started_at < s.next_start
                               AND b.break_started_at > s.ended_at - interval '30 minutes'
                               AND COALESCE(b.break_ended_at, 'infinity') > s.ended_at) THEN 'maintenance'
               WHEN s.tournament_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tournaments t
                             WHERE t.id = s.tournament_id AND t.break_started_at < s.next_start
                               AND COALESCE(t.break_ends_at, 'infinity') > s.ended_at) THEN 'break'
               %s
               WHEN s.tournament_id IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(s.players) = 'array' THEN s.players ELSE '[]'::jsonb END) pl
                             WHERE (pl->>'stack') ~ '^-?[0-9]+(\.[0-9]+)?$' AND (pl->>'stack')::numeric = 0) THEN 'rebuy_window'
               ELSE NULL
             END AS excluded
        FROM s
    )
    SELECT g.kind, g.table_id, GREATEST(g.felt_ms, 0), g.excluded FROM g
  $q$, v_h4h)
  USING p_from, p_to;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_felt_latency(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_felt_latency(timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Record one closed hour.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_felt_latency_record(p_hour timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_from timestamptz := date_trunc('hour', COALESCE(p_hour, now() - interval '1 hour'));
  v_to   timestamptz := date_trunc('hour', COALESCE(p_hour, now() - interval '1 hour')) + interval '1 hour';
  v_t0   timestamptz := clock_timestamp();
  v_rows integer;
  v_out  jsonb;
BEGIN
  IF v_to > now() THEN
    RAISE EXCEPTION 'FELT_LATENCY_OPEN_HOUR: % has not ended yet', v_from;
  END IF;

  DELETE FROM smarter_private.ca_felt_latency_hourly WHERE hour_start = v_from;

  WITH r AS MATERIALIZED (
    SELECT * FROM public.fn_ca_felt_latency(v_from, v_to)
  ),
  per_table AS (
    SELECT r.kind, r.table_id, count(*)::int AS pairs,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.felt_ms))::int AS p50,
           round(percentile_cont(0.95) WITHIN GROUP (ORDER BY r.felt_ms))::int AS p95,
           max(r.felt_ms)::int AS mx
      FROM r WHERE r.excluded IS NULL
     GROUP BY r.kind, r.table_id
  ),
  kinds AS (SELECT DISTINCT r.kind FROM r),
  per_kind AS (
    SELECT k.kind,
           (SELECT count(*) FROM r WHERE r.kind = k.kind AND r.excluded IS NULL)::int AS pairs,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.felt_ms))::int FROM r WHERE r.kind = k.kind AND r.excluded IS NULL) AS p50,
           (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY r.felt_ms))::int FROM r WHERE r.kind = k.kind AND r.excluded IS NULL) AS p95,
           (SELECT max(r.felt_ms)::int FROM r WHERE r.kind = k.kind AND r.excluded IS NULL) AS mx,
           (SELECT array_agg(COALESCE(c.n, 0)::int ORDER BY b.i)
              FROM generate_series(0, 240) AS b(i)
              LEFT JOIN (SELECT LEAST(r.felt_ms / 250, 240) AS i, count(*) AS n
                           FROM r WHERE r.kind = k.kind AND r.excluded IS NULL GROUP BY 1) c ON c.i = b.i) AS hist,
           COALESCE((SELECT jsonb_object_agg(e.excluded, e.n)
                       FROM (SELECT r.excluded, count(*) AS n FROM r
                              WHERE r.kind = k.kind AND r.excluded IS NOT NULL GROUP BY 1) e), '{}'::jsonb) AS excl
      FROM kinds k
  )
  INSERT INTO smarter_private.ca_felt_latency_hourly
         (hour_start, kind, table_id, pairs, felt_p50_ms, felt_p95_ms, felt_max_ms, hist_250ms, excluded)
  SELECT v_from, t.kind, t.table_id, t.pairs, t.p50, t.p95, t.mx, NULL, '{}'::jsonb FROM per_table t
  UNION ALL
  SELECT v_from, k.kind, NULL, k.pairs, k.p50, k.p95, k.mx, k.hist, k.excl FROM per_kind k;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Retention: table rows 35 days, kind rows 400 days (index on hour_start).
  DELETE FROM smarter_private.ca_felt_latency_hourly
   WHERE hour_start < v_from - interval '35 days' AND table_id IS NOT NULL;
  DELETE FROM smarter_private.ca_felt_latency_hourly
   WHERE hour_start < v_from - interval '400 days';

  SELECT jsonb_build_object(
           'hour', v_from,
           'rows', v_rows,
           'kinds', COALESCE(jsonb_object_agg(h.kind, jsonb_build_object(
                      'pairs', h.pairs, 'p50_ms', h.felt_p50_ms, 'p95_ms', h.felt_p95_ms, 'excluded', h.excluded)), '{}'::jsonb),
           'ms', (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int)
    INTO v_out
    FROM smarter_private.ca_felt_latency_hourly h
   WHERE h.hour_start = v_from AND h.table_id IS NULL;
  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_felt_latency_record(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_felt_latency_record(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The digest line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sp_digest_felt_latency(p_day date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH w AS (
    SELECT (p_day::timestamp AT TIME ZONE 'America/Chicago') AS lo,
           ((p_day + 1)::timestamp AT TIME ZONE 'America/Chicago') AS hi
  ),
  kh AS (
    SELECT h.* FROM smarter_private.ca_felt_latency_hourly h, w
     WHERE h.hour_start >= w.lo AND h.hour_start < w.hi AND h.table_id IS NULL
  ),
  hist AS (
    SELECT kh.kind, b.i, sum(b.n)::bigint AS n
      FROM kh, unnest(kh.hist_250ms) WITH ORDINALITY AS b(n, i)
     GROUP BY kh.kind, b.i
  ),
  cum AS (
    SELECT hist.kind, hist.i, sum(hist.n) OVER (PARTITION BY hist.kind ORDER BY hist.i) AS c,
           sum(hist.n) OVER (PARTITION BY hist.kind) AS total
      FROM hist
  ),
  pct AS (
    SELECT cum.kind,
           min(cum.i) FILTER (WHERE cum.total > 0 AND cum.c >= 0.5 * cum.total) * 250 AS p50_ms,
           min(cum.i) FILTER (WHERE cum.total > 0 AND cum.c >= 0.95 * cum.total) * 250 AS p95_ms
      FROM cum GROUP BY cum.kind
  ),
  excl AS (
    SELECT e.kind, jsonb_object_agg(e.key, e.total) AS excluded
      FROM (SELECT kh.kind, x.key, sum(x.value::bigint) AS total
              FROM kh, jsonb_each_text(kh.excluded) x GROUP BY 1, 2) e
     GROUP BY e.kind
  ),
  worst AS (
    SELECT DISTINCT ON (kh.kind) kh.kind, kh.hour_start, kh.felt_p95_ms
      FROM kh WHERE kh.pairs >= 20 AND kh.felt_p95_ms IS NOT NULL
     ORDER BY kh.kind, kh.felt_p95_ms DESC, kh.hour_start
  ),
  per_kind AS (
    SELECT kh.kind, sum(kh.pairs)::bigint AS pairs FROM kh GROUP BY kh.kind
  ),
  slow AS (
    SELECT h.table_id, h.kind, sum(h.pairs)::bigint AS pairs,
           round(sum(h.felt_p95_ms::numeric * h.pairs) / NULLIF(sum(h.pairs), 0))::int AS p95_ms
      FROM smarter_private.ca_felt_latency_hourly h, w
     WHERE h.hour_start >= w.lo AND h.hour_start < w.hi AND h.table_id IS NOT NULL AND h.felt_p95_ms IS NOT NULL
     GROUP BY h.table_id, h.kind
    HAVING sum(h.pairs) >= 30
     ORDER BY 4 DESC, 3 DESC
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'hours_recorded', (SELECT count(DISTINCT kh.hour_start) FROM kh),
    'kinds', COALESCE((
      SELECT jsonb_object_agg(pk.kind, jsonb_build_object(
               'pairs', pk.pairs,
               'p50_ms', pct.p50_ms,
               'p95_ms', pct.p95_ms,
               'worst_hour_ct', to_char(wo.hour_start AT TIME ZONE 'America/Chicago', 'HH24:MI'),
               'worst_hour_p95_ms', wo.felt_p95_ms,
               'excluded', COALESCE(ex.excluded, '{}'::jsonb)))
        FROM per_kind pk
        LEFT JOIN pct ON pct.kind = pk.kind
        LEFT JOIN worst wo ON wo.kind = pk.kind
        LEFT JOIN excl ex ON ex.kind = pk.kind), '{}'::jsonb),
    'slowest_table', (SELECT jsonb_build_object('table_id', s.table_id, 'name', t.name, 'kind', s.kind,
                                                'p95_ms', s.p95_ms, 'pairs', s.pairs)
                        FROM slow s LEFT JOIN public.tables t ON t.id = s.table_id));
$function$;
REVOKE ALL ON FUNCTION public.fn_sp_digest_felt_latency(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_digest_felt_latency(date) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. fn_sp_daily_digest returns the line under 'felt_latency'.
-- ---------------------------------------------------------------------------
DO $digest$
DECLARE
  v_def text := pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure);
  c_old constant text := E'    ''engine_cutover'', public.fn_sp_digest_engine_cutover(v_day),\n';
  c_new constant text := E'    ''engine_cutover'', public.fn_sp_digest_engine_cutover(v_day),\n    ''felt_latency'', public.fn_sp_digest_felt_latency(v_day),\n';
BEGIN
  IF strpos(v_def, 'fn_sp_digest_felt_latency') > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'FELT_LATENCY_DIGEST_ANCHOR: the engine_cutover line of fn_sp_daily_digest did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$digest$;

-- ---------------------------------------------------------------------------
-- 5. Hourly, at minute 8.
-- ---------------------------------------------------------------------------
DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-felt-latency-hourly') THEN
    PERFORM cron.unschedule('ca-felt-latency-hourly');
  END IF;
  PERFORM cron.schedule('ca-felt-latency-hourly', '8 * * * *',
                        $cmd$SET statement_timeout = '120s'; select public.fn_ca_felt_latency_record();$cmd$);
END
$schedule$;

-- The probes fit the ordinary 12 s install transaction: the pair reader runs
-- over the last five minutes, and the recorder over a closed hour before any
-- hand was written (every statement executes; nothing is found), then the
-- whole block unwinds. The first real hour is recorded by pg_cron at :08.
-- @probe-for: public.fn_ca_felt_latency
-- @probe-for: public.fn_ca_felt_latency_record
-- @probe-exempt: public.fn_sp_daily_digest the anchored edit adds one jsonb key; a full digest run takes longer than the ordinary 12 s install transaction (its own statement timeout is 60 s), and fn_sp_digest_felt_latency, the only new call in it, is executed below
DO $probe$
DECLARE v_n integer; v_rec jsonb; v_line jsonb;
BEGIN
  SELECT count(*) INTO v_n FROM public.fn_ca_felt_latency(now() - interval '5 minutes', now());
  v_rec := public.fn_ca_felt_latency_record('2026-01-01 00:00:00+00'::timestamptz);
  IF v_rec IS NULL OR (v_rec->>'hour')::timestamptz <> '2026-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'FELT_LATENCY_PROBE: the record did not report its hour (%)', v_rec;
  END IF;
  v_line := public.fn_sp_digest_felt_latency((now() AT TIME ZONE 'America/Chicago')::date);
  IF v_line IS NULL OR NOT v_line ? 'kinds' THEN
    RAISE EXCEPTION 'FELT_LATENCY_PROBE: the digest line has no kinds (%)', v_line;
  END IF;
  IF strpos(pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure),
            '''felt_latency'', public.fn_sp_digest_felt_latency(v_day)') = 0 THEN
    RAISE EXCEPTION 'FELT_LATENCY_PROBE: fn_sp_daily_digest does not return felt_latency';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
