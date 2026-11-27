-- 20261126222226_the_bbj_drift_alarm_installs_inside_its_budget
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHY:
--
-- FeeReconciler.auditBBJDrift calls bbj_drift_since(now() - 1 day) every hour
-- as the service role, whose statements stop at 8 s. Measured read-only on
-- production at 20:35 CST on 2026-11-26: 18.5 s cold, 0.3 s warm. Nearly all
-- of the cold cost is one random probe of bbj_contributions per hand (26,582
-- probes, 18,121 pages read from disk), because hand ids are random uuids.
-- So the money alarm that compares booked BBJ with banked BBJ is cancelled
-- whenever the bank's pages are not already cached.
--
-- 20261126203947 tried to fix this by materializing the CTEs and was refused
-- on install (its inline proof re-ran the slow body past the applier's 12 s
-- budget) and then reverted by #12154. Materializing does not remove the
-- per-hand probe, so it could not have fixed the cold case either.
--
-- WHAT THIS CHANGES:
--
-- 1. A covering partial index on bbj_contributions (created_at) INCLUDE
--    (hand_id, amount), built CONCURRENTLY, so the bank rows written around
--    the window are one contiguous index range instead of 26,000 random reads.
-- 2. bbj_drift_since reads the received side through that range, grouped by
--    hand, and probes a hand by id only when the range holds nothing for it.
--    The answer is unchanged:
--    - Received is still joined BY HAND (Dan, 2026-08-30): a slice banked late
--      has a later created_at and is inside the range, and any hand the range
--      misses is looked up by hand id with no time window at all, so a
--      back-dated heal can never read as missing money.
--    - The range starts a full day before p_since. On production a hand's bank
--      row lands within 30 s of its rake row (26,798 pairs checked, 0 more
--      than an hour apart), and there is at most one row per pool and hand.
--    - The booked side, the 6 minute settle grace and the unlinkable count are
--      exactly as before.
--
-- The proof inside the transaction is cheap by construction: index
-- qualification and the function's shape. It does not call the function, so
-- the install cannot run into the applier's budget again. Speed is checked
-- live after install.
--
-- No money moves, no game table is locked, no cron schedule changes.
--
-- @live-proof: (SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_rake_records_bbj_window_cover')) AND (SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_bbj_contrib_window_cover')) AND (SELECT position('bank_window' IN pg_get_functiondef('public.bbj_drift_since(timestamptz)'::regprocedure)) > 0)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rake_records_bbj_window_cover
 ON public.rake_records USING btree (created_at) INCLUDE (hand_id, bbj_contribution)
 WHERE (bbj_contribution > (0)::numeric);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bbj_contrib_window_cover
 ON public.bbj_contributions USING btree (created_at) INCLUDE (hand_id, amount)
 WHERE (hand_id IS NOT NULL);

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

DO $verify_index$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ix.relam
    WHERE i.indexrelid = to_regclass('public.idx_rake_records_bbj_window_cover')
      AND i.indrelid = 'public.rake_records'::regclass
      AND am.amname = 'btree'
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND i.indexprs IS NULL
      AND pg_get_expr(i.indpred, i.indrelid) = '(bbj_contribution > (0)::numeric)'
      AND i.indnkeyatts = 1 AND i.indnatts = 3
      AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, 3) n)
          = ARRAY['created_at', 'hand_id', 'bbj_contribution']
  ) THEN
    RAISE EXCEPTION 'BBJ_WINDOW_COVER_NOT_QUALIFIED' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ix.relam
    WHERE i.indexrelid = to_regclass('public.idx_bbj_contrib_window_cover')
      AND i.indrelid = 'public.bbj_contributions'::regclass
      AND am.amname = 'btree'
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND i.indexprs IS NULL
      AND pg_get_expr(i.indpred, i.indrelid) = '(hand_id IS NOT NULL)'
      AND i.indnkeyatts = 1 AND i.indnatts = 3
      AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, 3) n)
          = ARRAY['created_at', 'hand_id', 'amount']
  ) THEN
    RAISE EXCEPTION 'BBJ_BANK_WINDOW_COVER_NOT_QUALIFIED' USING ERRCODE = '55000';
  END IF;
END
$verify_index$;

CREATE OR REPLACE FUNCTION public.bbj_drift_since(p_since timestamp with time zone)
 RETURNS TABLE(booked numeric, received numeric, booked_rows bigint, received_rows bigint, unlinkable_rows bigint, unlinkable_chips numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- THE BANK IS READ AS ONE RANGE, NOT ONE RANDOM PROBE PER HAND (2026-11-26).
  -- Cold, 26,000 per-hand probes of bbj_contributions took 18 s and the
  -- service role's 8 s timeout cancelled the alarm.
  WITH r AS MATERIALIZED (
    SELECT rr.hand_id, rr.bbj_contribution, rr.created_at
    FROM rake_records rr
    WHERE rr.created_at >= p_since
      AND rr.bbj_contribution > 0
  ),
  settled AS MATERIALIZED (
    -- Settled: 6 minutes, STRICTLY GREATER than fn_bbj_repair_unbanked's
    -- 5-minute grace. An alarm that judges hands its own healer is still
    -- waiting on reports the healer's patience as a shortfall.
    SELECT r.hand_id, r.bbj_contribution
    FROM r
    WHERE r.hand_id IS NOT NULL
      AND r.created_at < now() - interval '6 minutes'
  ),
  bank_range AS MATERIALIZED (
    -- An access path, not a filter on meaning: the bank rows written from a
    -- day before the window on, read as one range of
    -- idx_bbj_contrib_window_cover. MATERIALIZED keeps the planner from
    -- turning it back into one probe per hand.
    SELECT b.hand_id, b.amount
    FROM bbj_contributions b
    WHERE b.hand_id IS NOT NULL
      AND b.created_at >= p_since - interval '1 day'
  ),
  bank_window AS MATERIALIZED (
    SELECT br.hand_id, sum(br.amount) AS amount
    FROM bank_range br
    GROUP BY br.hand_id
  ),
  j AS MATERIALIZED (
    -- Join by hand, never by a second time window (2026-08-30): a hand the
    -- range holds nothing for is looked up by hand id with no window at all,
    -- so a slice banked by a back-dated heal still belongs to its hand.
    SELECT s.bbj_contribution AS booked,
           COALESCE(w.amount,
                    (SELECT sum(b.amount) FROM bbj_contributions b
                      WHERE b.hand_id = s.hand_id),
                    0) AS received
    FROM settled s
    LEFT JOIN bank_window w ON w.hand_id = s.hand_id
  )
  SELECT
    COALESCE(sum(j.booked), 0)::numeric,
    COALESCE(sum(j.received), 0)::numeric,
    count(*)::bigint,
    count(*) FILTER (WHERE j.received > 0)::bigint,
    (SELECT count(*) FROM r WHERE r.hand_id IS NULL)::bigint,
    COALESCE((SELECT sum(r.bbj_contribution) FROM r WHERE r.hand_id IS NULL), 0)::numeric
  FROM j;
$function$;

DO $post$
BEGIN
  -- Same function shape: STABLE, invoker, search_path public, sql. This block
  -- does not call the function, so the install cost does not depend on what
  -- is cached.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.bbj_drift_since(timestamptz)'::regprocedure
      AND p.provolatile = 's' AND NOT p.prosecdef
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
      AND p.proconfig = ARRAY['search_path=public']
      AND position('bank_window' IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'BBJ_DRIFT_SHAPE_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$post$;

COMMIT;
