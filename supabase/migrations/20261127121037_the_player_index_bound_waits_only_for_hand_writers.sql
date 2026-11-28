-- 20261127121037_the_player_index_bound_waits_only_for_hand_writers
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-27 12:10:37 UTC.
--
-- THE PLAYER INDEX BOUND WAITS ONLY FOR HAND WRITERS (2026-11-27,
-- ClubArenaStatsIndexLag outside every maintenance break).
--
-- WHAT WAS WRONG (read from production, 2026-11-27). 20261111131639 bounded
-- ca_refresh_hand_player_index's forward loop by the start of the oldest open
-- transaction of ANY client backend in the database. Any long transaction -
-- an agent's analytics query, an idle-in-transaction pooler session, a
-- multi-statement script - therefore stops the index for as long as it stays
-- open, although it cannot write a hand_history row. club-stats-maintenance
-- heartbeats (probe_heartbeats, probe_name club-stats-maintenance):
--
--   run (UTC)   hands  idx_ceil after the run
--   09:00:13      0    08:40:00   (08:45 run had set 08:40:00)
--   11:00:02    143    10:55:00
--   11:15:05      0    10:55:00   <- lock taken (ceil not NULL), no hand taken
--   11:30:13    283    11:24:52
--   11:45:02      0    11:24:52   <- same
--   12:00:02    266    11:54:58
--
-- A run that cannot take the advisory lock returns a NULL ceil, so these runs
-- held the lock, and hand_history holds 40-59 hands per five minutes over the
-- whole span. The only way the loop takes no hand is v_bound <= idx_ceil:
-- some other backend's transaction had been open for 20 minutes or more.
-- pg_cron ran nothing longer than five minutes and auto_explain logged no
-- statement that long, so the pin was an open transaction, not a hand writer
-- (every engine role has an 8 s statement timeout and a 10 s idle timeout).
-- The watermark then aged past the 30-minute threshold and
-- ClubArenaStatsIndexLag fired at 11:25 and 11:56 (operational_alert_events
-- 449660/449662, 449663/449667), and earlier off-cycle at 2026-11-24 14:56
-- and 2026-11-25 09:25, 09:55, 11:55, 12:25 - none of them in a break.
--
-- WHAT THIS CHANGES. One line; everything else is byte-identical to the live
-- body (pg_get_functiondef md5 189b93e13db1ced3dd258aebfc46cd49, read
-- 2026-11-27, which is the body 20261111131639 installs):
--   v_bound := least(now() - 5 minutes, the start of the oldest open
--   transaction that holds a write lock on public.hand_history).
-- Why that is still exactly-once and skips nothing that matters:
--   * hand_history.created_at is its writer's transaction start, and a writer
--     holds RowExclusiveLock on hand_history from its INSERT until it ends, so
--     every uncommitted hand that could later appear below the bound belongs
--     to a lock holder whose start is >= the bound.
--   * A transaction that opened more than five minutes ago and has not yet
--     inserted is not counted. No hand writer does that (8 s statement and
--     10 s idle-in-transaction limits on the engine roles), and even then the
--     hand is not lost: trg_ca_stats_live_from_hand and the post-commit
--     projection index every hand on insert, whatever its created_at, and
--     every writer uses ON CONFLICT DO NOTHING on (user_id, hand_id).
--   * The five-minute floor that keeps the refresh off keys the live
--     projection is still writing (20261111131639) is unchanged.
--
-- Function body only: no table is locked and no row is read or written by the
-- install. An ordinary install. Native proof:
-- scripts/ci/test-idx-refresh-unrelated-xact.py (workflow
-- the-player-index-is-not-held-by-an-unrelated-transaction.yml).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.ca_refresh_hand_player_index(integer)');
  v_def text;
  v_old1 text := $f$  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
$f$;
  v_new1 text := $f$  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_locks l ON l.pid = a.pid WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL AND l.locktype = 'relation' AND l.relation = 'public.hand_history'::regclass AND l.mode IN ('RowExclusiveLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')), now()));
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'ca_refresh_hand_player_index(integer) is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> '189b93e13db1ced3dd258aebfc46cd49' AND md5(replace(v_def, v_new1, v_old1)) <> '189b93e13db1ced3dd258aebfc46cd49' THEN
    RAISE EXCEPTION 'ca_refresh_hand_player_index is not the pinned text (md5 %)', md5(v_def);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{search_path=public,statement_timeout=10min}') THEN
    RAISE EXCEPTION 'ca_refresh_hand_player_index authority changed';
  END IF;
END $m$;

CREATE OR REPLACE FUNCTION public.ca_refresh_hand_player_index(p_max_hands integer DEFAULT 50000)
 RETURNS TABLE(hands_indexed integer, rows_added integer, floor_at timestamp with time zone, ceil_at timestamp with time zone, complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '10min'
AS $function$
DECLARE
  f timestamptz; c timestamptz; done boolean; new_floor timestamptz; new_ceil timestamptz;
  n_hands int := 0; n_rows int := 0; k int; kr int;
  v_chunk constant int := 3000;
  v_budget int := least(greatest(coalesce(p_max_hands, 3000), 1), 200000);
  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_locks l ON l.pid = a.pid WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL AND l.locktype = 'relation' AND l.relation = 'public.hand_history'::regclass AND l.mode IN ('RowExclusiveLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')), now()));
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ca_hand_player_idx_background')) THEN
    RETURN QUERY SELECT 0, 0, NULL::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;

  SELECT idx_floor, idx_ceil, backfill_complete INTO f, c, done
  FROM public.ca_hand_player_idx_state WHERE id FOR UPDATE;
  IF f IS NULL THEN f := now(); END IF;
  IF c IS NULL THEN c := now(); END IF;

  LOOP
    EXIT WHEN n_hands >= v_budget OR clock_timestamp() >= v_deadline;
    SELECT max(created_at) INTO new_ceil
    FROM (
      SELECT created_at FROM public.hand_history
      WHERE created_at > c AND created_at < v_bound ORDER BY created_at, id LIMIT v_chunk
    ) bounded;
    EXIT WHEN new_ceil IS NULL;
    WITH src AS (
      SELECT h.id, h.created_at, h.players FROM public.hand_history h
      WHERE h.created_at > c AND h.created_at <= new_ceil
    ), expanded AS (
      SELECT DISTINCT ((pl->>'userId')::uuid) AS user_id, s.created_at, s.id AS hand_id
      FROM src s, jsonb_array_elements(s.players) pl
      WHERE pl->>'userId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ), ins AS (
      INSERT INTO public.ca_hand_player_idx (user_id, created_at, hand_id)
      SELECT user_id, created_at, hand_id FROM expanded e
      WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = e.hand_id AND r.user_id = e.user_id)
      ORDER BY user_id, hand_id, created_at
      ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT (SELECT count(*) FROM src)::int, (SELECT count(*) FROM ins)::int INTO k, kr;
    n_hands := n_hands + coalesce(k, 0); n_rows := n_rows + coalesce(kr, 0); c := new_ceil;
  END LOOP;

  IF NOT done AND clock_timestamp() < v_deadline THEN
    SELECT min(created_at) INTO new_floor FROM (
      SELECT created_at FROM public.hand_history
      WHERE created_at < f ORDER BY created_at DESC LIMIT v_chunk
    ) q;
    IF new_floor IS NULL THEN done := true;
    ELSE
      WITH src AS (
        SELECT h.id, h.created_at, h.players FROM public.hand_history h
        WHERE h.created_at < f AND h.created_at >= new_floor
      ), expanded AS (
        SELECT DISTINCT ((pl->>'userId')::uuid) AS user_id, s.created_at, s.id AS hand_id
        FROM src s, jsonb_array_elements(s.players) pl
        WHERE pl->>'userId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ), ins AS (
        INSERT INTO public.ca_hand_player_idx (user_id, created_at, hand_id)
        SELECT user_id, created_at, hand_id FROM expanded
      ORDER BY user_id, hand_id, created_at
        ON CONFLICT DO NOTHING RETURNING 1
      )
      SELECT (SELECT count(*) FROM src)::int, (SELECT count(*) FROM ins)::int INTO k, kr;
      n_hands := n_hands + coalesce(k, 0); n_rows := n_rows + coalesce(kr, 0); f := new_floor;
      IF NOT EXISTS (SELECT 1 FROM public.hand_history WHERE created_at < f) THEN done := true; END IF;
    END IF;
  END IF;

  UPDATE public.ca_hand_player_idx_state
  SET idx_floor = least(coalesce(idx_floor, f), f),
      idx_ceil = greatest(coalesce(idx_ceil, c), c),
      backfill_complete = done,
      rows_indexed = rows_indexed + n_rows,
      updated_at = now()
  WHERE id;

  RETURN QUERY SELECT n_hands, n_rows, f, c, done;
END;
$function$;

-- Executes the new body once (p_max_hands 1: at most one 3,000-hand chunk) so
-- the pg_locks join in v_bound runs before COMMIT; always undone.
-- @probe-for: public.ca_refresh_hand_player_index
DO $probe$
BEGIN
  PERFORM * FROM public.ca_refresh_hand_player_index(1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- Restated, unchanged: CREATE OR REPLACE keeps the existing grants, and the
-- postflight below proves the ACL is exactly what it was.
REVOKE ALL ON FUNCTION public.ca_refresh_hand_player_index(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ca_refresh_hand_player_index(integer) TO service_role;

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.ca_refresh_hand_player_index(integer)');
  v_def text;
  v_old1 text := $f$  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
$f$;
  v_new1 text := $f$  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_locks l ON l.pid = a.pid WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL AND l.locktype = 'relation' AND l.relation = 'public.hand_history'::regclass AND l.mode IN ('RowExclusiveLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')), now()));
$f$;
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF (length(v_def) - length(replace(v_def, v_new1, ''))) / length(v_new1) <> 1
     OR position(v_old1 IN v_def) <> 0 THEN
    RAISE EXCEPTION 'ca_refresh_hand_player_index: the change is not exactly the one new line';
  END IF;
  IF md5(replace(v_def, v_new1, v_old1)) <> '189b93e13db1ced3dd258aebfc46cd49' THEN
    RAISE EXCEPTION 'ca_refresh_hand_player_index: the reverse substitution does not reproduce the pinned text';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{search_path=public,statement_timeout=10min}') THEN
    RAISE EXCEPTION 'ca_refresh_hand_player_index authority changed';
  END IF;
END $m$;

COMMIT;
