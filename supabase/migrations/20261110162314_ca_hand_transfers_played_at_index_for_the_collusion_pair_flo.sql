-- THE COLLUSION PAIR-FLOW SCAN GETS AN INDEX IT CAN RANGE-SCAN (2026-11-10).
--
-- public.fn_ca_collusion_scan(p_days) opens with one aggregate over
-- public.ca_hand_transfers filtered by `played_at > now() - p_days`. That table
-- holds ~73.5M rows (9.5 GB heap, 16 GB of indexes) and EVERY index on it leads
-- with winner_id or loser_id, so played_at could only ever be an index
-- CONDITION on a full traversal of a 73.5M-entry index, never a range scan.
-- Read from production 2026-11-10:
--
--   Index Scan using idx_ca_hand_transfers_winner  (cost=0.57..1140058.66)
--     Index Cond: (played_at > (now() - '7 days'::interval))
--     Filter: (amount > '0'::numeric)
--
-- Measured the same day, read-only, at the function's own budget: that
-- aggregate does NOT finish inside 120 s statement_timeout. ca-collusion-daily
-- failed the last 3 of its 3 runs with SQLSTATE 57014 at `fn_ca_collusion_scan
-- line 6 at FOR over SELECT rows`, and drift incident
-- c3f667d5-422b-47bb-9b1b-0898fa1c7003 (fn_ca_cron_failure_watch, critical) has
-- been open since 2026-11-09 21:37 with no successful run in 24 h. A collusion
-- scan that cannot run is not a check at all (CLAUDE.md 10.83).
--
-- played_at correlation on this table is 0.999966 - inserts are append-only -
-- so a plain btree on played_at gives a tight range scan whose heap access is
-- effectively sequential, and no INCLUDE columns are needed. winner_id and
-- loser_id are NOT NULL, so the scan's `IS NOT NULL` predicates are
-- tautologies; the index is deliberately NOT partial on them, and not partial
-- on `amount > 0` either, so any other time-window read of this table can use
-- it too.
--
-- Scope is deliberately one index. Separately observed and NOT bundled here:
-- autoanalyze last ran 2026-11-02 (its 10 % scale factor needs ~7.3M inserts on
-- a table this size), so the planner's played_at histogram ends before the
-- 7-day window and it estimates 7,357 rows for a window holding millions. That
-- estimate no longer selects the access path once played_at leads an index, so
-- it is not a blocker for this repair; it is recorded for a follow-up that can
-- be judged on its own evidence rather than smuggled into an index change.
--
-- This migration moves no money, settles nothing, and changes no alert, rule,
-- threshold or function body. Every threshold and every signal
-- fn_ca_collusion_scan writes is left exactly as it is, including its
-- info/warning split and its cert-account handling.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.ca_hand_transfers'::regclass AND c.relname='ca_hand_transfers_played_at_idx' AND i.indisvalid AND i.indisready)

CREATE INDEX CONCURRENTLY IF NOT EXISTS ca_hand_transfers_played_at_idx
  ON public.ca_hand_transfers (played_at);

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $verify$
DECLARE v_valid boolean; v_lead text;
BEGIN
  SELECT i.indisvalid AND i.indisready INTO v_valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.ca_hand_transfers'::regclass
     AND c.relname = 'ca_hand_transfers_played_at_idx';
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ca_hand_transfers_played_at_idx is missing or not a valid, ready index';
  END IF;
  SELECT a.attname INTO v_lead
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
   WHERE i.indrelid = 'public.ca_hand_transfers'::regclass
     AND c.relname = 'ca_hand_transfers_played_at_idx';
  IF v_lead IS DISTINCT FROM 'played_at' THEN
    RAISE EXCEPTION 'ca_hand_transfers_played_at_idx must lead with played_at, leads with %', v_lead;
  END IF;
END
$verify$;
COMMIT;
