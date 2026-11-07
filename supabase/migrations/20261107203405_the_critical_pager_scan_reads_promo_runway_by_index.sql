-- 20261107203405_the_critical_pager_scan_reads_promo_runway_by_index
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 20:34:05 UTC.
--
-- THE CRITICAL PAGER HAS NOT COMPLETED A SCAN SINCE THE PROMO RUNWAY WATCH
-- WAS ADDED.
--
-- fn_sp_critical_scan() is called every five minutes by the service role,
-- whose statement_timeout is 8 s. Every call in the retained logs failed:
-- `POST /rpc/fn_sp_critical_scan` 500 at :x0:45 and :x5:45 from at least
-- 2026-11-06 00:50 UTC to 2026-11-07 20:25 UTC (483 calls), each one
-- `canceling statement due to statement timeout`. sp_critical_pages has not
-- recorded a page since 2026-11-03 07:15 UTC. The pager was blind.
--
-- Measured (2026-11-07, production, one rolled-back probe per branch): every
-- branch of the scan costs milliseconds except fn_sp_midway_free_buy_watch(),
-- 3.7 s, and inside it the 7-day promo runway read on chip_ledger (26M rows,
-- 29 GB), 4.6 s on its own under EXPLAIN ANALYZE. Its predicate is
--   created_at in the last 7 days AND (
--     (from_label = 'union_wallets.promo_wallet' AND from_entity_id IN (union, wallet))
--  OR (to_label   = 'union_wallets.promo_wallet' AND to_entity_id   IN (union, wallet))
--  OR (to_label IS NULL AND from_type = 'bbj_pool' AND to_type = 'union_wallet'
--      AND to_entity_id IN (union, wallet)))
-- and the only indexes it can use are idx_chip_ledger_from/to_entity_created.
-- The union's wallet row receives 628,543 legs a week under other labels, so
-- the to_entity bitmap heap-reads 159,043 blocks and discards 626,384 rows to
-- keep 8,421. Under any load that is past 8 s, and the whole scan is refused.
--
-- THE FIX IS AN INDEX OVER EXACTLY THOSE LEGS. Partial, on the three label
-- and type shapes the runway reads and nothing else (8,421 rows a week of
-- 26M), keyed by created_at and covering every column the read touches, so
-- the runway becomes an index-only range of a few thousand entries. The
-- planner proves the read's OR-of-ANDs implies this OR predicate (checked on a
-- 200,000-row probe table: Index Only Scan, no heap). The function's text and
-- the rule it computes are unchanged; nothing is rewritten around the pager.
--
-- WHY CONCURRENTLY: the same grounds and the same sanctioned preamble as
-- 20261107134957 (scripts/ci/migration-concurrent-preamble.mjs). A plain
-- CREATE INDEX holds SHARE on chip_ledger for the whole build and stalls every
-- money write; a window file's 5 s statements cannot build over 26M rows.
-- IF NOT EXISTS lets a re-dispatch skip a finished build; the transaction
-- refuses an INVALID leftover by name.
--
-- The transaction then proves the point of the change, not just its object:
-- EXPLAIN of the runway read must name this index. If the planner ever stops
-- choosing it, the migration refuses rather than reporting a pager that still
-- cannot finish.
--
-- @live-proof: (SELECT i.indisvalid AND i.indisready FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'idx_chip_ledger_union_promo_runway_legs')
--
-- docs/changelog/2026-11-07-the-critical-pager-can-finish-its-scan.md

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chip_ledger_union_promo_runway_legs
  ON public.chip_ledger (created_at)
  INCLUDE (amount, category, from_label, to_label, from_type, to_type, from_entity_id, to_entity_id)
  WHERE from_label = 'union_wallets.promo_wallet'
     OR to_label = 'union_wallets.promo_wallet'
     OR (to_label IS NULL AND from_type = 'bbj_pool' AND to_type = 'union_wallet');

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_exists boolean;
  v_valid  boolean;
  v_wallet uuid;
  v_plan   text := '';
  v_line   record;
BEGIN
  SELECT true, i.indisvalid AND i.indisready
    INTO v_exists, v_valid
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname = 'idx_chip_ledger_union_promo_runway_legs';

  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION
      'idx_chip_ledger_union_promo_runway_legs does not exist: the CREATE INDEX CONCURRENTLY preamble did not run'
      USING ERRCODE = '55000';
  END IF;
  IF NOT COALESCE(v_valid, false) THEN
    RAISE EXCEPTION
      'idx_chip_ledger_union_promo_runway_legs exists but is INVALID: drop it (DROP INDEX CONCURRENTLY) and re-dispatch so it is rebuilt'
      USING ERRCODE = '55000';
  END IF;

  -- The runway read exactly as fn_sp_midway_free_buy_watch() issues it.
  SELECT w.id INTO v_wallet
    FROM public.union_wallets w WHERE w.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid;
  FOR v_line IN EXECUTE format($q$
    EXPLAIN (FORMAT TEXT)
    SELECT COALESCE(sum(CASE WHEN l.from_label = 'union_wallets.promo_wallet' AND l.category <> 'promo' THEN l.amount END), 0),
           COALESCE(sum(CASE WHEN l.from_label = 'union_wallets.promo_wallet' AND l.category = 'promo' THEN l.amount END), 0),
           COALESCE(sum(CASE WHEN l.from_label IS DISTINCT FROM 'union_wallets.promo_wallet' THEN l.amount END), 0)
      FROM public.chip_ledger l
     WHERE l.created_at > now() - interval '7 days' AND l.created_at <= now()
       AND ((l.from_label = 'union_wallets.promo_wallet'
             AND l.from_entity_id IN ('fade0000-0000-0000-0000-000000000001'::uuid, %1$L::uuid))
         OR (l.to_label = 'union_wallets.promo_wallet'
             AND l.to_entity_id IN ('fade0000-0000-0000-0000-000000000001'::uuid, %1$L::uuid))
         OR (l.to_label IS NULL AND l.from_type = 'bbj_pool' AND l.to_type = 'union_wallet'
             AND l.to_entity_id IN ('fade0000-0000-0000-0000-000000000001'::uuid, %1$L::uuid)))
  $q$, v_wallet)
  LOOP
    v_plan := v_plan || v_line."QUERY PLAN" || E'\n';
  END LOOP;
  IF position('idx_chip_ledger_union_promo_runway_legs' IN coalesce(v_plan, '')) = 0 THEN
    RAISE EXCEPTION 'the promo runway read does not use idx_chip_ledger_union_promo_runway_legs: %', v_plan
      USING ERRCODE = '55000';
  END IF;
END $$;

COMMENT ON INDEX public.idx_chip_ledger_union_promo_runway_legs IS
  'The Midway promo runway legs (fn_sp_midway_free_buy_watch, read by fn_sp_critical_scan every five minutes under an 8 s budget). Partial: about 8,400 rows a week of a 26M-row table as at 2026-11-07. Without it the runway read scanned 628k unrelated union-wallet legs a week and the critical pager timed out on every call. See migration 20261107203405.';

COMMIT;
