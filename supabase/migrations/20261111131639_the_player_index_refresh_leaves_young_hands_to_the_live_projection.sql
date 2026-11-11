-- 20261111131639_the_player_index_refresh_leaves_young_hands_to_the_live_projection
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11.
--
-- THE PLAYER INDEX REFRESH LEAVES YOUNG HANDS TO THE LIVE PROJECTION
-- (2026-11-11). The sibling of 20261111031027 (ca_roll_hand_stats_forward).
--
-- WHAT WAS WRONG (proven live). ca_refresh_hand_player_index(60000) runs from
-- PostgREST at :00/:15/:30/:45. In ONE transaction (up to 90 s) its forward
-- loop inserts ca_hand_player_idx rows for every hand_history row up to the
-- newest committed one, including hands whose live post-commit projection
-- (fn_project_hand_side_effects_after_post_commit_20260908, Projection 4) has
-- not run yet. That projection inserts the same (user_id, hand_id) keys, waits
-- on the refresh's open transaction (unique-index speculative insert) and hits
-- the 8 s statement timeout while holding the table's hand-post-commit lock
-- and player_stats rows that other tables need; the engine waits for that
-- post-commit before dealing. Evidence, 2026-11-11 12:15:00-12:15:11Z: refresh
-- pid 1626137 (10.2 s, p_max_hands 60000); post-commit pid 1626134 waited on
-- its xid inserting ca_hand_player_idx and was cancelled at 12:15:09.7, with
-- hand-post-commit and player_stats waits chained behind it; #10435 recorded
-- await_post_hand_tasks breaches at 12:15:10 (5.5 s, 3.2 s) and 11:15:06
-- (3.8 s). Over 24 h, ShareLock-on-transaction waits in relation
-- ca_hand_player_idx occur ONLY at minutes 0/15/30/45 (82 waits, up to 7.8 s),
-- and continued after 20261111031027 was installed.
--
-- WHAT THIS CHANGES. Three pieces; everything else is byte-identical to the
-- live body (pg_get_functiondef md5 8a0a2d56..., captured in
-- scripts/ci/probes/idx-refresh-lag/live-predecessor.sql):
--   1. v_bound := least(now() - 5 minutes, the start of the oldest other open
--      client transaction in this database);
--   2. the forward loop only takes hands with created_at < v_bound;
--   3. the forward insert skips a player-hand that has a fact revision
--      (ca_append_hand_fact_revision deletes a voided player's index row; the
--      refresh rebuilds from hand_history, which a revision does not change).
-- idx_ceil only advances to the last hand the loop took, so a younger hand is
-- taken by a later run and nothing is skipped: hand_history.created_at is the
-- writer's transaction start, an unseen row belongs to an open transaction
-- whose start is >= the bound, and two-phase commit is off. Every hand also
-- gets its index rows per hand from its own projection or the AFTER INSERT
-- trigger, whatever its created_at. Exactly once: the unique key
-- (user_id, hand_id) with ON CONFLICT DO NOTHING in every writer. The backfill
-- (floor) branch is unchanged; backfill_complete is already true. The
-- 5 minutes only keeps the refresh off keys still being written (performance);
-- correctness does not depend on it.
--
-- Function body only: no table is locked and no row is read or written by the
-- install. An ordinary install. Native proof: scripts/ci/test-idx-refresh-lag.py.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.ca_refresh_hand_player_index(integer)');
  v_def text;
  v_old1 text := $f$  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
$f$;
  v_new1 text := $f$  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
$f$;
  v_old2 text := $f$      WHERE created_at > c ORDER BY created_at, id LIMIT v_chunk
$f$;
  v_new2 text := $f$      WHERE created_at > c AND created_at < v_bound ORDER BY created_at, id LIMIT v_chunk
$f$;
  v_old3 text := $f$
      SELECT user_id, created_at, hand_id FROM expanded
      ORDER BY user_id, hand_id, created_at
$f$;
  v_new3 text := $f$
      SELECT user_id, created_at, hand_id FROM expanded e
      WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = e.hand_id AND r.user_id = e.user_id)
      ORDER BY user_id, hand_id, created_at
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'ca_refresh_hand_player_index(integer) is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> '8a0a2d56f0bb0c89b0b71005d753671e' AND md5(replace(replace(replace(v_def, v_new1, v_old1), v_new2, v_old2), v_new3, v_old3)) <> '8a0a2d56f0bb0c89b0b71005d753671e' THEN
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
  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
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

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.ca_refresh_hand_player_index(integer)');
  v_def text := pg_get_functiondef(to_regprocedure('public.ca_refresh_hand_player_index(integer)'));
  v_old1 text := $f$  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
$f$;
  v_new1 text := $f$  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
  v_bound timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));
$f$;
  v_old2 text := $f$      WHERE created_at > c ORDER BY created_at, id LIMIT v_chunk
$f$;
  v_new2 text := $f$      WHERE created_at > c AND created_at < v_bound ORDER BY created_at, id LIMIT v_chunk
$f$;
  v_old3 text := $f$
      SELECT user_id, created_at, hand_id FROM expanded
      ORDER BY user_id, hand_id, created_at
$f$;
  v_new3 text := $f$
      SELECT user_id, created_at, hand_id FROM expanded e
      WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = e.hand_id AND r.user_id = e.user_id)
      ORDER BY user_id, hand_id, created_at
$f$;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_new1, ''))) / length(v_new1) <> 1
     OR (length(v_def) - length(replace(v_def, v_new2, ''))) / length(v_new2) <> 1
     OR (length(v_def) - length(replace(v_def, v_new3, ''))) / length(v_new3) <> 1
     OR position(v_old2 IN v_def) <> 0 OR position(v_old3 IN v_def) <> 0 THEN
    RAISE EXCEPTION 'ca_refresh_hand_player_index: the change is not exactly the three new pieces';
  END IF;
  IF md5(replace(replace(replace(v_def, v_new1, v_old1), v_new2, v_old2), v_new3, v_old3)) <> '8a0a2d56f0bb0c89b0b71005d753671e' THEN
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
