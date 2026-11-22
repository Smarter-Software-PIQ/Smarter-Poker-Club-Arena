-- 20261121172609_hot_tables_autovacuum_and_fillfactor_tuning.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   High-churn dealing and ledger tables (tables, table_seats, chip_ledger,
--   hand_state_snapshots, ca_hand_gap_watch_history) accumulate dead tuples
--   continuously under 24/7 play. Default PostgreSQL autovacuum thresholds
--   (20% vacuum / 10% analyze) allow index bloat and stale planner stats that
--   can flip hot-path queries from index-scans to sequential scans.
--   Sets tighter per-table autovacuum/autoanalyze scale factors (2% / 1%) on
--   all five tables and fillfactor=80 on frequently-updated tables/table_seats
--   so HOT updates stay in-page without index churn.
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.table_seats'::regclass AND c.reloptions @> ARRAY['autovacuum_vacuum_scale_factor=0.02', 'autovacuum_analyze_scale_factor=0.01', 'fillfactor=80']) AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.tables'::regclass AND c.reloptions @> ARRAY['autovacuum_vacuum_scale_factor=0.02', 'autovacuum_analyze_scale_factor=0.01', 'fillfactor=80']))

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $tune$
DECLARE
  v_hot_update_tables text[] := ARRAY['public.tables', 'public.table_seats'];
  v_hot_churn_tables text[] := ARRAY[
    'public.chip_ledger',
    'public.hand_state_snapshots',
    'public.ca_hand_gap_watch_history'
  ];
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY v_hot_update_tables LOOP
    IF to_regclass(v_tbl) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %s SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01, fillfactor = 80)',
        v_tbl
      );
    END IF;
  END LOOP;

  FOREACH v_tbl IN ARRAY v_hot_churn_tables LOOP
    IF to_regclass(v_tbl) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %s SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01)',
        v_tbl
      );
    END IF;
  END LOOP;
END
$tune$;

COMMIT;
