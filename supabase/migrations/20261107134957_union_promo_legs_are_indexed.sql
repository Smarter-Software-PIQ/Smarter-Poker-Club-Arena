-- 20261107134957_union_promo_legs_are_indexed.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every remote branch.
--
-- THE UNION PROMO LEGS GET AN INDEX, SO THE PROOF THAT READS THEM STAYS CHEAP.
--
-- chip_ledger is 26,065,062 rows (measured 2026-11-07) and has no index on
-- category or description. Every question about the 25-chip welcome-back promo
-- - 160 legs in the whole table - therefore costs a created_at range scan:
-- 438,631 rows for the last two days alone, and that window only grows.
--
-- This matters because 20261107130207's own `-- @live-proof:` reads those legs
-- with `created_at >= '2026-11-04'`, and production-integrity runs it. Today
-- that is a few hundred thousand rows; in six months it is tens of millions,
-- for an answer that concerns 160 of them. An index that makes the proof O(few)
-- is what keeps the proof honest instead of expensive.
--
-- WHY CONCURRENTLY, AND WHY IT MAY NOT WAIT FOR THE DAILY WINDOW.
-- A plain CREATE INDEX takes ACCESS EXCLUSIVE on chip_ledger for the whole
-- build, which stalls every money write on the platform (section 2 rule 7 and
-- rule 9). The daily-maintenance window is not an alternative here either: a
-- window file gets a 1 s lock_timeout, 5 s statements and an 8 s budget
-- (rule 10), and a 26M-row build does not fit in any of them. So this uses the
-- door's one considered exception, the sanctioned CREATE INDEX CONCURRENTLY
-- preamble (scripts/ci/migration-concurrent-preamble.mjs), on the same grounds
-- and in the same shape as 20260920185803 and 20260925205938: an index on a
-- ledger written every hand is built CONCURRENTLY, outside the transaction.
--
-- IF NOT EXISTS is required by the door so a re-dispatch after a partial run
-- skips what is already built; the transaction below then refuses an INVALID
-- leftover by name, because a failed concurrent build leaves an unusable index
-- that the planner ignores - which would look exactly like success.
--
-- Partial, so it indexes 160 rows rather than 26 million: the predicate is the
-- union promo door's own leg shape, which fn_promo_disburse writes verbatim.
--
-- @live-proof: (SELECT i.indisvalid AND i.indisready FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'idx_chip_ledger_union_promo_player')
--
-- docs/changelog/2026-11-07-the-union-promo-is-paid-once-per-player.md

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chip_ledger_union_promo_player
  ON public.chip_ledger (to_entity_id, created_at)
  INCLUDE (amount, club_id, union_id)
  WHERE category = 'promo' AND from_type = 'union_wallet' AND to_type = 'player_wallet';

BEGIN;

-- Fail fast rather than queue behind a live writer. Nothing here takes a lock
-- on a hot table, but a guard that can wedge the estate is worse than the cost
-- it saves.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_exists boolean;
  v_valid  boolean;
BEGIN
  SELECT true, i.indisvalid AND i.indisready
    INTO v_exists, v_valid
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname = 'idx_chip_ledger_union_promo_player';

  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION
      'idx_chip_ledger_union_promo_player does not exist: the CREATE INDEX CONCURRENTLY preamble did not run'
      USING ERRCODE = '55000';
  END IF;

  -- A failed concurrent build leaves the index behind, unusable, and the
  -- planner silently ignores it. Refuse rather than report success.
  IF NOT COALESCE(v_valid, false) THEN
    RAISE EXCEPTION
      'idx_chip_ledger_union_promo_player exists but is INVALID: drop it (DROP INDEX CONCURRENTLY) and re-dispatch so it is rebuilt'
      USING ERRCODE = '55000';
  END IF;
END $$;

COMMENT ON INDEX public.idx_chip_ledger_union_promo_player IS
  'The union promo door''s player legs (fn_promo_disburse union -> player). Partial: 160 rows of a 26M-row table as at 2026-11-07. Added so the welcome-back guard''s live proof and any question about who has been paid this promo cost an index lookup rather than a created_at range scan that grows for ever. See migration 20261107134957.';

COMMIT;
