-- 20261119185027_batch_daily_cash_retention_pruners
--
-- Harden the two daily cash-retention prune cron jobs added on 2026-11-18
-- (20261118164000 and 20261118190500) so they never run an unbounded single
-- DELETE over millions of rows when their 14-day and 30-day retention windows
-- fill.
--
-- Both tables already carry btree indexes on their retention timestamps
-- (cash_hand_chair_clubs_captured_at_idx and
-- cash_seat_occupancy_history_recorded_at_idx) and BEFORE DELETE immutability
-- triggers enforcing exact 14-day and 30-day cutoffs against now().
--
-- This migration defines two owner-only, set-based, bounded batch pruners in
-- smarter_private (using ORDER BY <ts> ASC LIMIT p_batch FOR UPDATE SKIP LOCKED
-- within a wall-clock time budget and batch ceiling) and updates the commands
-- of the two existing pg_cron jobs to call them. No new cron jobs are added;
-- retention windows (14 days / 30 days) and immutability triggers are unchanged.
--
-- periodic-work: retention only. Replaces the raw unbatched DELETE commands of
-- the two existing daily retention jobs (ca-cash-hand-chair-clubs-prune-daily
-- and ca-cash-seat-occupancy-history-prune-daily) with bounded batch pruners;
-- repairs nothing and compensates for nothing.
--
-- @live-proof: to_regprocedure('smarter_private.fn_prune_cash_hand_chair_clubs(integer,double precision,integer)') IS NOT NULL AND to_regprocedure('smarter_private.fn_prune_cash_seat_occupancy_history(integer,double precision,integer)') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-cash-hand-chair-clubs-prune-daily' AND command LIKE '%fn_prune_cash_hand_chair_clubs%') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-cash-seat-occupancy-history-prune-daily' AND command LIKE '%fn_prune_cash_seat_occupancy_history%')

BEGIN;

SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION smarter_private.fn_prune_cash_hand_chair_clubs(
  p_batch integer DEFAULT 5000,
  p_max_seconds double precision DEFAULT 15,
  p_max_batches integer DEFAULT 100
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_batch integer := LEAST(50000, GREATEST(COALESCE(p_batch, 5000), 1));
  v_max_seconds double precision := LEAST(60.0, GREATEST(COALESCE(p_max_seconds, 15.0), 0.001));
  v_max_batches integer := LEAST(200, GREATEST(COALESCE(p_max_batches, 100), 1));
  -- Match cash_hand_chair_clubs_immutable() exactly: now() - interval '14 days'.
  v_cutoff timestamptz := now() - interval '14 days';
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => v_max_seconds);
  v_batches integer := 0;
  v_n integer := 0;
  v_deleted integer := 0;
BEGIN
  LOOP
    EXIT WHEN v_batches >= v_max_batches OR clock_timestamp() >= v_deadline;

    WITH doomed AS MATERIALIZED (
      SELECT ctid
        FROM smarter_private.cash_hand_chair_clubs
       WHERE captured_at < v_cutoff
       ORDER BY captured_at ASC
       LIMIT v_batch
         FOR UPDATE SKIP LOCKED
    )
    DELETE FROM smarter_private.cash_hand_chair_clubs t
     USING doomed d
     WHERE t.ctid = d.ctid
       AND t.captured_at < v_cutoff;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted + v_n;
    v_batches := v_batches + 1;
    EXIT WHEN v_n < v_batch;
  END LOOP;

  RETURN v_deleted;
END $function$;

REVOKE ALL ON FUNCTION smarter_private.fn_prune_cash_hand_chair_clubs(integer, double precision, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION smarter_private.fn_prune_cash_hand_chair_clubs(integer, double precision, integer) IS
  'Owner-only bounded batch retention pruner for smarter_private.cash_hand_chair_clubs (14-day retention). Deletes oldest expired rows in bounded batches using cash_hand_chair_clubs_captured_at_idx with FOR UPDATE SKIP LOCKED inside a time and batch budget.';

CREATE OR REPLACE FUNCTION smarter_private.fn_prune_cash_seat_occupancy_history(
  p_batch integer DEFAULT 5000,
  p_max_seconds double precision DEFAULT 15,
  p_max_batches integer DEFAULT 100
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_batch integer := LEAST(50000, GREATEST(COALESCE(p_batch, 5000), 1));
  v_max_seconds double precision := LEAST(60.0, GREATEST(COALESCE(p_max_seconds, 15.0), 0.001));
  v_max_batches integer := LEAST(200, GREATEST(COALESCE(p_max_batches, 100), 1));
  -- Match cash_seat_occupancy_history_immutable() exactly: now() - interval '30 days'.
  v_cutoff timestamptz := now() - interval '30 days';
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => v_max_seconds);
  v_batches integer := 0;
  v_n integer := 0;
  v_deleted integer := 0;
BEGIN
  LOOP
    EXIT WHEN v_batches >= v_max_batches OR clock_timestamp() >= v_deadline;

    WITH doomed AS MATERIALIZED (
      SELECT ctid
        FROM smarter_private.cash_seat_occupancy_history
       WHERE recorded_at < v_cutoff
       ORDER BY recorded_at ASC
       LIMIT v_batch
         FOR UPDATE SKIP LOCKED
    )
    DELETE FROM smarter_private.cash_seat_occupancy_history t
     USING doomed d
     WHERE t.ctid = d.ctid
       AND t.recorded_at < v_cutoff;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted + v_n;
    v_batches := v_batches + 1;
    EXIT WHEN v_n < v_batch;
  END LOOP;

  RETURN v_deleted;
END $function$;

REVOKE ALL ON FUNCTION smarter_private.fn_prune_cash_seat_occupancy_history(integer, double precision, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION smarter_private.fn_prune_cash_seat_occupancy_history(integer, double precision, integer) IS
  'Owner-only bounded batch retention pruner for smarter_private.cash_seat_occupancy_history (30-day retention). Deletes oldest expired rows in bounded batches using cash_seat_occupancy_history_recorded_at_idx with FOR UPDATE SKIP LOCKED inside a time and batch budget.';

-- Update the two existing daily retention cron jobs in place (no new jobs).
SELECT cron.schedule(
  'ca-cash-hand-chair-clubs-prune-daily',
  '35 5 * * *',
  $cron$SET statement_timeout = '30s'; SET lock_timeout = '1s'; SELECT smarter_private.fn_prune_cash_hand_chair_clubs(5000, 15);$cron$
);

SELECT cron.schedule(
  'ca-cash-seat-occupancy-history-prune-daily',
  '40 5 * * *',
  $cron$SET statement_timeout = '30s'; SET lock_timeout = '1s'; SELECT smarter_private.fn_prune_cash_seat_occupancy_history(5000, 15);$cron$
);

-- @probe-for: smarter_private.fn_prune_cash_hand_chair_clubs
DO $probe$
BEGIN
  PERFORM smarter_private.fn_prune_cash_hand_chair_clubs(1, 1.0, 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: smarter_private.fn_prune_cash_seat_occupancy_history
DO $probe$
BEGIN
  PERFORM smarter_private.fn_prune_cash_seat_occupancy_history(1, 1.0, 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
