-- 20261125022710_hourly_cron_sweeps_indexes_checkpoints_and_query_plans.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- HOURLY PG_CRON SWEEPS: PERMANENT INDEXES, SAFE-HORIZON CHECKPOINTS & QUERY PLANS
-- (Track 2 — 6 slowest hourly jobs running 38–51 s avg / 51–282 s max vs 60 s headroom)
--
-- Live read-only diagnosis (`EXPLAIN (ANALYZE, BUFFERS)` + `cron.job_run_details` 24h):
--
--   1. Job 128 `club-rake-rollup-catchup` (`fn_club_rake_rollup_catchup(3)`, 6.60 s avg / 51.30 s max):
--      - `fn_club_rake_rollup_day(uuid,date)` called `fn_ca_launch_accounting_accepts(a.club_id,
--        (SELECT rr.created_at FROM rake_records rr WHERE rr.id = a.rake_record_id))` per row
--        (>102k correlated PK lookups + function calls for yesterday; exceeded 60 s in read-only probe)
--        even though `fn_ca_launch_accounting_cutoff('club', p_club_id)` is constant per club and NULL
--        for all union clubs.
--      - `fn_ca_reporting_rollups_from_facts(date)` probed `rake_attributions_whole_hand_cover`
--        28,154 times by random UUID `rake_record_id` (102,683 heap fetches, 27,157 disk reads = 18.4–21.1 s).
--        Two-phase window read via `idx_rake_attributions_club_created` over `[v_lo - 1h, v_hi + 24h)`
--        with exact fallback for unmatched ids drops this to ~1.8 s (0 rows miss the window).
--
--   2. Job 231 `ca-pay-backed-payout-shortfalls-hourly` (`fn_pay_backed_payout_shortfalls()`, 49.59 s avg / 123.76 s max):
--      - `house_corrections` CTE scanned 36,120 disk pages of `idx_chip_ledger_tournament_category`
--        `(tournament_id, category)` to return 0 rows (`14,562.6 ms`). Partial covering index on
--        `(tournament_id) INCLUDE (amount) WHERE ... category='correction' AND to_type='prize_liability'
--        AND from_type IN ('union_bank','club_treasury')` holds 2 rows (~0.05 ms).
--      - `rake_totals` CTE scanned all 1,771,800 historical rows of `idx_rake_records_club_data_tournament_window`
--        (`10,503.8 ms`, 114,317 disk reads). Bounding `rr.created_at >= (SELECT min(created_at) - interval '1 day'
--        FROM eligible)` uses the existing index over ~35 days (`410 ms`, 0 diffs across all 60,445 events).
--
--   3. Job 155 `rake-bbj-invariant-audit-hourly` (`fn_rake_bbj_audit(2)`, 56.06 s avg / 281.70 s max):
--      - `fn_bbj_reconcile(uuid)` re-summed all 13,198,134 `chip_ledger` legs since `2026-09-04` for
--        pool `f9806a7f` every hour (`23.9 s` warm, >200 s cold). Safe-horizon checkpoint table
--        `public.ca_bbj_reconcile_marks` stores exact unrounded per-pool sums up to
--        `LEAST(now() - 6h, min(xact_start) - 1m)`, so each run reads only the 6h tail (~50 ms).
--      - `fn_bbj_reconcile_all()` called `fn_bbj_reconcile` sequentially across all 3,820 active pools
--        (26,740 statements + O(N^2) `v_out := v_out || ...` JSONB array copying + 3,820 Seq Scans of
--        `ca_ledger_write_failures` = `16.3 s`). Rewritten as a set-based mark advance + single atomic
--        set-based `INSERT INTO ca_bbj_pool_snapshots ... RETURNING *` + `jsonb[]` aggregation +
--        `idx_ca_ledger_write_failures_occurred_at`.
--      - `fn_rake_bbj_invariants(integer)` (`5.5 s`): materializes `scope` CTE once and uses
--        `CROSS JOIN LATERAL` in `I4` and `I6` to avoid double-evaluating `fn_effective_bbj_drop`
--        and `SUM(weighted_rake_credit)` per row.
--
--   4. Job 123 `union-integrity-sweep` (`fn_union_integrity_sweep_all()`, 44.59 s avg / 150.76 s max):
--      - `fn_union_integrity_sweep(uuid,integer)` used `EXISTS(union_clubs) OR EXISTS(clubs)` on
--        `chip_transactions`, preventing use of `idx_chip_tx_club_created (club_id, created_at DESC)` and
--        forcing a 31,940-page B-tree scan (`19.15 s` per scan, up to 3x per run). Materializing
--        `v_scope_clubs uuid[]` and filtering `ct.club_id = ANY (v_scope_clubs)` hits the index (<2 ms).
--      - Co-seating did a 3.2M-row Parallel Seq Scan of `table_seats` (74,685 disk reads = `1.8–2.6 s`)
--        because `table_seats` had no index on `joined_at`. `idx_table_seats_joined_at_cover` turns it
--        into a covering Index Only Scan (<10 ms).
--
--   5. Job 214 `ca-ratchet-watch-hourly` (`fn_ca_ratchet_watch()`, 32.33 s avg / 85.86 s max):
--      - `fn_ca_completed_without_a_champion()` scanned 990k `COMPLETED` tournaments + 3.2M
--        `tournament_players` rows (`4,045,072` shared buffers, `17.65 s` cold / `2.79 s` warm).
--        Partial indexes `idx_tournaments_completed_id` + `idx_tournament_players_winner_tid` with a
--        materialized `no_win` anti-join reduce buffers ~580x (~7k pages, ~150 ms).
--      - `fn_ca_undeclared_money_paths()` ran backtracking regexes over all `pg_proc x watched`
--        pairs, de-TOASTing `prosrc` 35x per function (`10.16 s`). Materializing `lower(prosrc)` and
--        de-TOASTed `prosrc` once in `fns` + pre-filtering by `position(tbl)` & `position(col)` drops
--        it to `0.56 s` with 100% identical regex and contract rules.
--
--   6. Job 233 `ca-conservation-sweep-hourly` (`fn_ca_conservation_sweep()`, 38.58 s avg / 70.55 s max):
--      - `fn_ca_ledger_audit_checkpoint_advance()` and `fn_bbj_conservation_check()` ran 2 correlated
--        `chip_ledger` subqueries per late BBJ pool across 3,855 pools (7,710 probes each = ~18 s + 2.7 s).
--        Replaced with a single set-based `chip_ledger` range scan grouped by `pool_id` for kept pools
--        (preserving exact full-range fallback for unkept pools).
--      - `fn_bbj_promo_bank_check()` (`5.29 s`) + `fn_bbj_contributions_total()` scanned all 6.15M
--        append-only `bbj_contributions` rows (`0` updates, `0` deletes ever). Added
--        `idx_bbj_contributions_created_at_cover` and safe-horizon `public.ca_bbj_promo_audit_mark`
--        advanced inside `fn_ca_ledger_audit_checkpoint_advance()`.
--      - `fn_union_governance_check()` (`2.61 s`): 3 zero-row partial indexes on `tournaments` and
--        `tables` eliminate `2.55 s` of scans without modifying the function.
--      - `fn_ca_knockout_door_stalled()` (`1.60 s`): split `max(resolved_at)` from `resolved_at IS NULL`
--        backed by two partial indexes on `tournament_knockout_candidates` (~0.2 ms).
--
-- STRICT NON-COLLISION:
--   - Zero `cron.job` mutations (`cron.schedule` / `cron.alter_job` / `cron.unschedule`).
--   - Zero PR #11956 function touches.
--   - Zero watched guard (`fn_ca_guard_watchlist`) touches.
--   - Exact financial/audit semantics, return shapes, SECURITY DEFINER, search_path, and ACLs preserved.
--
-- @replaces-md5: public.fn_club_rake_rollup_day(uuid,date)=a71de30b73dbe5ccfe3cc32c9e363c50
-- @replaces-md5: public.fn_ca_reporting_rollups_from_facts(date)=cc3dde7765d2ed383b26ea9c96cd9a20
-- @replaces-md5: public.fn_pay_backed_payout_shortfalls(boolean,integer)=8a6a20c6856b200dfa0ff7a1550044e4
-- @replaces-md5: public.fn_bbj_reconcile(uuid)=516d3dbfab2ab31588907ef4934771e3
-- @replaces-md5: public.fn_bbj_reconcile_all()=e1250fbc290628ac23400c111624eef4
-- @replaces-md5: public.fn_rake_bbj_invariants(integer)=2a8c79452ced863cfb15364d1e62a40c
-- @replaces-md5: public.fn_union_integrity_sweep(uuid,integer)=f764df872c6812b8186bf2329e670f76
-- @replaces-md5: public.fn_ca_completed_without_a_champion()=962fc139f74e4840902d5a4655ac8f26
-- @replaces-md5: public.fn_ca_undeclared_money_paths()=86cf4170398c88a22f012c0748998fe7
-- @replaces-md5: public.fn_ca_ledger_audit_checkpoint_advance()=dbb5a1efc418461bfd190e5fdeb204e4
-- @replaces-md5: public.fn_bbj_conservation_check()=45166a61fd8b0f36a4bed1127b075e83
-- @replaces-md5: public.fn_bbj_promo_bank_check()=8061f898a2b966eda4c518851fd7e8b9
-- @replaces-md5: public.fn_ca_knockout_door_stalled(integer)=0ac830e35079db87132632bab2e6cf37
--
-- @live-proof: (SELECT (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND i.indisvalid AND i.indisready AND c.relname IN ('idx_chip_ledger_house_corrections_by_tournament','idx_table_seats_joined_at_cover','idx_tournaments_completed_id','idx_tournament_players_winner_tid','idx_bbj_contributions_created_at_cover','idx_tournaments_private_union','idx_tables_private_union','idx_tables_live_union_club_mismatch','idx_tournament_knockout_candidates_pending_unresolved','idx_tournament_knockout_candidates_resolved_at','idx_ca_ledger_write_failures_occurred_at')) = 11 AND to_regclass('public.ca_bbj_reconcile_marks') IS NOT NULL AND to_regclass('public.ca_bbj_promo_audit_mark') IS NOT NULL AND position('v_cutoff := public.fn_ca_launch_accounting_cutoff' IN pg_get_functiondef('public.fn_club_rake_rollup_day(uuid,date)'::regprocedure)) > 0 AND position('window_attributions AS MATERIALIZED' IN pg_get_functiondef('public.fn_ca_reporting_rollups_from_facts(date)'::regprocedure)) > 0 AND position('min(created_at) - interval ''1 day''' IN pg_get_functiondef('public.fn_pay_backed_payout_shortfalls(boolean,integer)'::regprocedure)) > 0 AND position('ca_bbj_reconcile_marks' IN pg_get_functiondef('public.fn_bbj_reconcile(uuid)'::regprocedure)) > 0 AND position('ca_bbj_reconcile_marks' IN pg_get_functiondef('public.fn_bbj_reconcile_all()'::regprocedure)) > 0 AND position('WITH scope AS MATERIALIZED' IN pg_get_functiondef('public.fn_rake_bbj_invariants(integer)'::regprocedure)) > 0 AND position('ct.club_id = ANY (v_scope_clubs)' IN pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'::regprocedure)) > 0 AND position('WITH no_win AS MATERIALIZED' IN pg_get_functiondef('public.fn_ca_completed_without_a_champion()'::regprocedure)) > 0 AND position('position(w.tbl_l in f.src_l) > 0' IN pg_get_functiondef('public.fn_ca_undeclared_money_paths()'::regprocedure)) > 0 AND position('ca_bbj_promo_audit_mark' IN pg_get_functiondef('public.fn_ca_ledger_audit_checkpoint_advance()'::regprocedure)) > 0 AND position('tail_by_pool AS MATERIALIZED' IN pg_get_functiondef('public.fn_bbj_conservation_check()'::regprocedure)) > 0 AND position('ca_bbj_promo_audit_mark' IN pg_get_functiondef('public.fn_bbj_promo_bank_check()'::regprocedure)) > 0 AND position('WHERE c.resolved_at IS NULL' IN pg_get_functiondef('public.fn_ca_knockout_door_stalled(integer)'::regprocedure)) > 0)

-- Concurrent indexes built outside the transaction (zero table write locks).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chip_ledger_house_corrections_by_tournament ON public.chip_ledger (tournament_id) INCLUDE (amount) WHERE tournament_id IS NOT NULL AND category = 'correction' AND to_type = 'prize_liability' AND from_type IN ('union_bank', 'club_treasury');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_table_seats_joined_at_cover ON public.table_seats (joined_at) INCLUDE (user_id, table_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournaments_completed_id ON public.tournaments (id) WHERE status = 'COMPLETED';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournament_players_winner_tid ON public.tournament_players (tournament_id) WHERE status = 'winner';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bbj_contributions_created_at_cover ON public.bbj_contributions (created_at) INCLUDE (amount, promo_portion, main_portion, backup_portion);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournaments_private_union ON public.tournaments (id) WHERE COALESCE(is_private, false) AND union_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tables_private_union ON public.tables (id) WHERE COALESCE(is_private, false) AND union_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tables_live_union_club_mismatch ON public.tables (id) WHERE union_id IS NOT NULL AND COALESCE(is_private, false) = false AND club_id IS DISTINCT FROM union_id AND COALESCE(is_deleted, false) = false AND status NOT IN ('closed', 'deleted');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournament_knockout_candidates_pending_unresolved ON public.tournament_knockout_candidates (tournament_id) WHERE resolved_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournament_knockout_candidates_resolved_at ON public.tournament_knockout_candidates (resolved_at DESC) WHERE resolved_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ca_ledger_write_failures_occurred_at ON public.ca_ledger_write_failures (occurred_at);

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '90s';

-- ── 0. Installer role, concurrent index validity, and preimage/ACL guard ────
DO $guard$
DECLARE
  v_ix text;
  v_ok boolean;
  r record;
  v_def text;
  v_md5 text;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'HOURLY_CRON_PERF_INSTALLER_ROLE: % may not install this migration', current_user
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_ix IN ARRAY ARRAY[
    'idx_chip_ledger_house_corrections_by_tournament',
    'idx_table_seats_joined_at_cover',
    'idx_tournaments_completed_id',
    'idx_tournament_players_winner_tid',
    'idx_bbj_contributions_created_at_cover',
    'idx_tournaments_private_union',
    'idx_tables_private_union',
    'idx_tables_live_union_club_mismatch',
    'idx_tournament_knockout_candidates_pending_unresolved',
    'idx_tournament_knockout_candidates_resolved_at',
    'idx_ca_ledger_write_failures_occurred_at'
  ] LOOP
    SELECT (i.indisvalid AND i.indisready AND i.indislive) INTO v_ok
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_ix;
    IF v_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'HOURLY_CRON_PERF_INDEX_INVALID: public.% is missing or not valid/ready', v_ix
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  CREATE TEMP TABLE _hourly_cron_perf_meta (
    sig text PRIMARY KEY,
    proowner oid NOT NULL,
    prosecdef boolean NOT NULL,
    proconfig text[],
    proacl aclitem[]
  ) ON COMMIT DROP;

  FOR r IN SELECT * FROM (VALUES
    ('public.fn_club_rake_rollup_day(uuid,date)', 'a71de30b73dbe5ccfe3cc32c9e363c50', 'v_cutoff := public.fn_ca_launch_accounting_cutoff'),
    ('public.fn_ca_reporting_rollups_from_facts(date)', 'cc3dde7765d2ed383b26ea9c96cd9a20', 'window_attributions AS MATERIALIZED'),
    ('public.fn_pay_backed_payout_shortfalls(boolean,integer)', '8a6a20c6856b200dfa0ff7a1550044e4', 'min(created_at) - interval ''1 day'''),
    ('public.fn_bbj_reconcile(uuid)', '516d3dbfab2ab31588907ef4934771e3', 'ca_bbj_reconcile_marks'),
    ('public.fn_bbj_reconcile_all()', 'e1250fbc290628ac23400c111624eef4', 'ca_bbj_reconcile_marks'),
    ('public.fn_rake_bbj_invariants(integer)', '2a8c79452ced863cfb15364d1e62a40c', 'WITH scope AS MATERIALIZED'),
    ('public.fn_union_integrity_sweep(uuid,integer)', 'f764df872c6812b8186bf2329e670f76', 'ct.club_id = ANY (v_scope_clubs)'),
    ('public.fn_ca_completed_without_a_champion()', '962fc139f74e4840902d5a4655ac8f26', 'WITH no_win AS MATERIALIZED'),
    ('public.fn_ca_undeclared_money_paths()', '86cf4170398c88a22f012c0748998fe7', 'position(w.tbl_l in f.src_l) > 0'),
    ('public.fn_ca_ledger_audit_checkpoint_advance()', 'dbb5a1efc418461bfd190e5fdeb204e4', 'ca_bbj_promo_audit_mark'),
    ('public.fn_bbj_conservation_check()', '45166a61fd8b0f36a4bed1127b075e83', 'tail_by_pool AS MATERIALIZED'),
    ('public.fn_bbj_promo_bank_check()', '8061f898a2b966eda4c518851fd7e8b9', 'ca_bbj_promo_audit_mark'),
    ('public.fn_ca_knockout_door_stalled(integer)', '0ac830e35079db87132632bab2e6cf37', 'WHERE c.resolved_at IS NULL')
  ) AS t(sig, expected_md5, post_marker) LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    v_md5 := md5(v_def);
    IF v_md5 <> r.expected_md5 AND position(r.post_marker IN v_def) = 0 THEN
      RAISE EXCEPTION 'HOURLY_CRON_PERF_PREIMAGE_DRIFT: % has md5 %, expected %', r.sig, v_md5, r.expected_md5
        USING ERRCODE = '55000';
    END IF;
    INSERT INTO _hourly_cron_perf_meta (sig, proowner, prosecdef, proconfig, proacl)
    SELECT r.sig, p.proowner, p.prosecdef, p.proconfig, p.proacl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = r.sig::regprocedure;
  END LOOP;
END $guard$;

-- ── 1. Internal safe-horizon checkpoint tables (append-only sums only) ──────
CREATE TABLE IF NOT EXISTS public.ca_bbj_reconcile_marks (
  pool_id uuid PRIMARY KEY,
  base_taken_at timestamp with time zone NOT NULL,
  through_at timestamp with time zone NOT NULL,
  journal_main numeric NOT NULL DEFAULT 0,
  journal_backup numeric NOT NULL DEFAULT 0,
  journal_promo numeric NOT NULL DEFAULT 0,
  advanced_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_bbj_reconcile_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_bbj_reconcile_marks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_bbj_reconcile_marks TO service_role;

CREATE TABLE IF NOT EXISTS public.ca_bbj_promo_audit_mark (
  id integer PRIMARY KEY CHECK (id = 1),
  through_at timestamp with time zone NOT NULL,
  contributed numeric NOT NULL DEFAULT 0,
  pre_triple_bank numeric NOT NULL DEFAULT 0,
  rated_amount numeric NOT NULL DEFAULT 0,
  rated_promo numeric NOT NULL DEFAULT 0,
  rows_counted bigint NOT NULL DEFAULT 0,
  advanced_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_bbj_promo_audit_mark ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_bbj_promo_audit_mark FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_bbj_promo_audit_mark TO service_role;

-- ── 2. Job 128: fn_club_rake_rollup_day(uuid,date) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_club_rake_rollup_day(p_club_id uuid, p_day date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := p_day::timestamptz;
  v_end   timestamptz := (p_day + 1)::timestamptz;
  v_rows  integer := 0;
  v_cutoff timestamptz;
BEGIN
  IF v_end > date_trunc('day', now()) THEN
    RAISE EXCEPTION 'club rake rollup: day % is not complete', p_day;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('club_rake_rollup:' || p_club_id::text || ':' || p_day::text, 42));

  DELETE FROM club_rake_daily_user WHERE club_id = p_club_id AND day = p_day;

  -- A club's launch accounting cutoff is a property of p_club_id, not each
  -- attribution row. When NULL, fn_ca_launch_accounting_accepts is always true,
  -- avoiding >100k per-row rake_records lookups and function invocations.
  v_cutoff := public.fn_ca_launch_accounting_cutoff('club', p_club_id);

  IF v_cutoff IS NULL THEN
    WITH split AS (
      SELECT a.player_id AS user_id, round(a.rake_amount * 100)::bigint AS cents
        FROM rake_attributions a
       WHERE a.club_id = p_club_id
         AND a.created_at >= v_start AND a.created_at < v_end
         AND a.rake_amount > 0
    ), ins AS (
      INSERT INTO club_rake_daily_user (club_id, day, user_id, rake_amount, hands)
      SELECT p_club_id, p_day, s.user_id, SUM(s.cents)::numeric / 100, count(*)
        FROM split s GROUP BY s.user_id
      RETURNING 1
    )
    SELECT count(*) INTO v_rows FROM ins;
  ELSE
    WITH split AS (
      SELECT a.player_id AS user_id, round(a.rake_amount * 100)::bigint AS cents
        FROM rake_attributions a
        JOIN public.rake_records rr ON rr.id = a.rake_record_id
       WHERE a.club_id = p_club_id
         AND a.created_at >= v_start AND a.created_at < v_end
         AND a.rake_amount > 0
         AND rr.created_at IS NOT NULL
         AND isfinite(rr.created_at)
         AND rr.created_at >= v_cutoff
    ), ins AS (
      INSERT INTO club_rake_daily_user (club_id, day, user_id, rake_amount, hands)
      SELECT p_club_id, p_day, s.user_id, SUM(s.cents)::numeric / 100, count(*)
        FROM split s GROUP BY s.user_id
      RETURNING 1
    )
    SELECT count(*) INTO v_rows FROM ins;
  END IF;

  INSERT INTO club_rake_rollup_complete (club_id, day, rows_written, computed_at)
  VALUES (p_club_id, p_day, v_rows, now())
  ON CONFLICT (club_id, day) DO UPDATE
    SET rows_written = EXCLUDED.rows_written, computed_at = EXCLUDED.computed_at;

  RETURN v_rows;
END $function$;

REVOKE ALL ON FUNCTION public.fn_club_rake_rollup_day(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_club_rake_rollup_day(uuid, date) TO service_role;

-- ── 3. Job 128: fn_ca_reporting_rollups_from_facts(date) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_reporting_rollups_from_facts(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_from_day date := public.fn_ca_club_data_facts_from();
  v_lo timestamptz := (p_day::timestamp AT TIME ZONE 'UTC');
  v_hi timestamptz := ((p_day + 1)::timestamp AT TIME ZONE 'UTC');
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_tables bigint; v_players bigint; v_tournaments bigint;
BEGIN
  IF p_day IS NULL OR p_day > v_today OR v_from_day IS NULL OR p_day < v_from_day THEN
    RETURN jsonb_build_object('day', p_day, 'skipped', 'outside_club_data_facts', 'facts_from', v_from_day);
  END IF;
  IF now() < v_hi + interval '10 minutes' THEN
    PERFORM pg_advisory_xact_lock(918273645);
  END IF;

  DELETE FROM public.club_table_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_table_player_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_player_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_tournament_daily WHERE stat_date = p_day;
  DELETE FROM public.ca_club_tournament_player_daily WHERE stat_date = p_day;

  WITH day_facts AS MATERIALIZED (
    SELECT f.club_id, f.game_id, f.stat_date, f.kind, f.user_id, f.fee, f.buyins, f.cashouts, f.winnings
      FROM public.ca_club_data_fact f
     WHERE f.stat_date = p_day
  ), rr AS MATERIALIZED (
    SELECT r.id, r.table_id, r.created_at, t.union_id, t.club_id AS table_club,
           CASE WHEN jsonb_typeof(r.player_contributions) = 'object' THEN r.player_contributions ELSE '{}'::jsonb END AS pc
      FROM public.rake_records r
      JOIN public.tables t ON t.id = r.table_id AND t.tournament_id IS NULL
     WHERE r.created_at >= v_lo AND r.created_at < v_hi
       AND r.rake_amount > 0 AND r.tournament_id IS NULL AND NOT COALESCE(r.is_tournament, false)
  ), contrib AS MATERIALIZED (
    SELECT rr.id, rr.table_id, rr.created_at, rr.union_id, rr.table_club, e.key::uuid AS uid
      FROM rr CROSS JOIN LATERAL jsonb_each_text(rr.pc) e
     WHERE e.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       AND (CASE WHEN e.value ~ '^[0-9]+(\.[0-9]+)?$' THEN e.value::numeric ELSE 0 END) > 0
  ), contrib_ids AS MATERIALIZED (
    SELECT DISTINCT id FROM contrib
  ), window_attributions AS MATERIALIZED (
    -- Sequential range read over idx_rake_attributions_club_created avoids
    -- 28k+ random rake_record_id heap fetches; late/backfilled attributions
    -- outside the 49h window are still fetched by rake_record_id below.
    SELECT ra.rake_record_id, ra.player_id, ra.club_id
      FROM public.rake_attributions ra
      JOIN contrib_ids r ON r.id = ra.rake_record_id
     WHERE ra.club_id = ANY (ARRAY(SELECT k.id FROM public.clubs k))
       AND ra.created_at >= v_lo - interval '1 hour'
       AND ra.created_at < v_hi + interval '24 hours'
  ), matched_attributions AS MATERIALIZED (
    SELECT rake_record_id, player_id, club_id FROM window_attributions
    UNION ALL
    SELECT ra.rake_record_id, ra.player_id, ra.club_id
      FROM contrib_ids r
      JOIN public.rake_attributions ra ON ra.rake_record_id = r.id
     WHERE NOT EXISTS (SELECT 1 FROM window_attributions w WHERE w.rake_record_id = r.id)
  ), clubbed AS (
    SELECT c.id, c.table_id,
           COALESCE(ra.club_id, rc.club, st.club,
                    public.fn_ca_cash_reporting_club(c.union_id, c.table_club, c.uid)) AS club_id,
           c.created_at
      FROM contrib c
      LEFT JOIN matched_attributions ra ON ra.rake_record_id = c.id AND ra.player_id = c.uid
      LEFT JOIN LATERAL (
        SELECT a.club_id AS club FROM (
          (SELECT x.funding_club_id AS club_id, x.seat_joined_at AS arrived_at, x.recorded_at AS seq_at, x.id AS seq_id
             FROM public.cash_participant_funding_receipts x
            WHERE ra.club_id IS NULL AND x.operation_kind = 'buyin' AND x.table_id = c.table_id
              AND x.account_entity_id = c.uid AND x.seat_joined_at <= c.created_at
            ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1)
          UNION ALL
          (SELECT m.club_id, m.created_at AS arrived_at, m.created_at AS seq_at, m.move_id AS seq_id
             FROM public.cash_seat_move_receipts m
            WHERE ra.club_id IS NULL AND m.to_table_id = c.table_id AND m.player_id = c.uid
              AND m.created_at <= c.created_at
            ORDER BY m.created_at DESC, m.move_id DESC LIMIT 1)
        ) a ORDER BY a.arrived_at DESC, a.seq_at DESC, a.seq_id DESC LIMIT 1) rc ON true
      LEFT JOIN LATERAL (
        SELECT ts.club_id AS club FROM public.table_seats ts
         WHERE ra.club_id IS NULL AND rc.club IS NULL AND ts.table_id = c.table_id
           AND ts.user_id = c.uid AND ts.club_id IS NOT NULL AND ts.joined_at <= c.created_at
         ORDER BY ts.joined_at DESC LIMIT 1) st ON true
  ), cut AS MATERIALIZED (
    -- A stable boundary is a property of the club, not each contribution.
    SELECT c.club_id, public.fn_ca_launch_accounting_cutoff('club', c.club_id) AS cutoff
      FROM (SELECT DISTINCT club_id FROM clubbed WHERE club_id IS NOT NULL) c
  ), hands AS (
    SELECT h.club_id, h.table_id, SUM(h.hands)::int AS hands, SUM(h.src)::int AS src FROM (
      SELECT cl.club_id, cl.table_id, count(DISTINCT cl.id) AS hands, count(*) AS src
        FROM clubbed cl JOIN cut ON cut.club_id = cl.club_id
       WHERE cut.cutoff IS NULL
          OR (cl.created_at IS NOT NULL AND isfinite(cl.created_at) AND cl.created_at >= cut.cutoff)
       GROUP BY 1, 2
      UNION ALL
      -- A raked hand that named nobody is the table's club's hand.
      SELECT rr.table_club, rr.table_id, count(*), count(*)
        FROM rr
       WHERE rr.table_club IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM contrib c WHERE c.id = rr.id)
       GROUP BY 1, 2) h
     GROUP BY 1, 2
  ),
  table_rows AS (
    INSERT INTO public.club_table_daily
      (club_id, table_id, stat_date, union_id, rake, hands, players, buyins, cashouts, net, source_rows, updated_at)
    SELECT f.club_id, f.game_id, p_day, t.union_id,
           SUM(f.fee), COALESCE(MAX(h.hands), 0),
           (count(DISTINCT f.user_id) FILTER (WHERE f.fee > 0 AND f.user_id <> v_zero))::int,
           round(SUM(f.buyins), 2), round(SUM(f.cashouts), 2), round(SUM(f.cashouts) - SUM(f.buyins), 2),
           COALESCE(MAX(h.src), 0), now()
      FROM day_facts f
      JOIN public.tables t ON t.id = f.game_id
      LEFT JOIN hands h ON h.club_id = f.club_id AND h.table_id = f.game_id
     WHERE f.stat_date = p_day AND f.kind = 'CASH'
     GROUP BY f.club_id, f.game_id, t.union_id
    RETURNING 1
  ),
  table_player_rows AS (
    INSERT INTO public.ca_club_table_player_daily (club_id, table_id, stat_date, user_id)
    SELECT DISTINCT f.club_id, f.game_id, p_day, f.user_id
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.kind = 'CASH' AND f.fee > 0 AND f.user_id <> v_zero
    ON CONFLICT DO NOTHING
    RETURNING 1
  ),
  player_rows AS (
    INSERT INTO public.ca_club_player_daily (club_id, user_id, stat_date, cash_net, tournament_net, updated_at)
    SELECT f.club_id, f.user_id, p_day,
           COALESCE(SUM(f.winnings) FILTER (WHERE f.kind = 'CASH'), 0),
           COALESCE(SUM(f.winnings) FILTER (WHERE f.kind = 'TOURNAMENT'), 0), now()
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.user_id <> v_zero
     GROUP BY f.club_id, f.user_id
    HAVING bool_or(f.buyins <> 0 OR f.cashouts <> 0)
    RETURNING 1
  ),
  tournament_rows AS (
    INSERT INTO public.ca_club_tournament_daily (club_id, tournament_id, stat_date, fee, winnings, updated_at)
    SELECT f.club_id, f.game_id, p_day, SUM(f.fee), SUM(f.winnings), now()
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.kind = 'TOURNAMENT'
     GROUP BY f.club_id, f.game_id
    RETURNING 1
  ),
  tournament_player_rows AS (
    INSERT INTO public.ca_club_tournament_player_daily (club_id, tournament_id, user_id, stat_date, updated_at)
    SELECT DISTINCT f.club_id, f.game_id, f.user_id, p_day, now()
      FROM day_facts f
     WHERE f.stat_date = p_day AND f.kind = 'TOURNAMENT' AND f.user_id <> v_zero
       AND (f.buyins <> 0 OR f.cashouts <> 0)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM table_rows),
         (SELECT count(*) FROM player_rows),
         (SELECT count(*) FROM tournament_rows)
    INTO v_tables, v_players, v_tournaments;

  RETURN jsonb_build_object('day', p_day, 'source', 'ca_club_data_fact', 'table_rows', v_tables,
                            'player_rows', v_players, 'tournament_rows', v_tournaments);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_reporting_rollups_from_facts(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_reporting_rollups_from_facts(date) TO service_role;

-- ── 4. Job 231: fn_pay_backed_payout_shortfalls(boolean,integer) ────────────
CREATE OR REPLACE FUNCTION public.fn_pay_backed_payout_shortfalls(p_apply boolean DEFAULT false, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record; v_res jsonb;
  v_paid numeric := 0; v_events integer := 0;
  v_withheld numeric := 0; v_withheld_events integer := 0;
  v_refused integer := 0; v_refused_chips numeric := 0;
  v_alerts integer := 0;
  v_delta_after numeric;
  /* HOW FAR BACK THIS QUESTION REACHES (2026-09-19).
     There was no bound here, so fn_tournament_conservation_delta ran per row
     over every COMPLETED tournament and the job was cancelled at 120s on 21 of
     its last 24 runs. A shortfall is created at settlement and is detectable
     within hours; 30 days is about a 100x margin on that. Measured: bounded
     21,817 ms against production, unbounded over 120,000 ms and cancelled.
     Widen it deliberately if a shortfall is ever found older than this. */
  v_window_days integer := 30;
BEGIN
  FOR r IN
    WITH eligible AS MATERIALIZED (
      SELECT t.id, t.name, t.club_id, t.prize_pool, t.ended_at, t.created_at
      FROM public.tournaments t
      WHERE t.status = 'COMPLETED'
        AND NOT (COALESCE(t.variant, '') = 'satellite' OR UPPER(COALESCE(t.tournament_type, '')) = 'SATELLITE' OR t.satellite_target_id IS NOT NULL)
        AND COALESCE(t.variant, '') <> 'spin'
        -- A Diamond event is paid from its own diamond escrow, never by this
        -- chip sweep (2026-10-09). Its chip-side delta is meaningless.
        AND NOT EXISTS (SELECT 1 FROM public.clubs c
                         WHERE c.id = t.club_id AND c.asset = 'diamonds'
                           AND c.is_platform IS TRUE AND c.union_id IS NULL
                           AND t.union_id IS NULL)
        AND t.ended_at > now() - make_interval(days => GREATEST(v_window_days, 1))
    ), wallet_receipts AS NOT MATERIALIZED (
      SELECT related_entity_id, type, category, amount
      FROM public.wallet_transactions
      WHERE related_entity_id IS NOT NULL
        AND ((type = 'debit' AND category IN ('tournament_buyin','rebuy','addon'))
          OR (type = 'credit' AND category IN ('refund','prize','bounty')))
    ), wallet_totals AS MATERIALIZED (
      SELECT w.related_entity_id AS id,
        sum(w.amount) FILTER (WHERE w.type = 'debit' AND w.category IN ('tournament_buyin','rebuy','addon')) AS money_in,
        sum(w.amount) FILTER (WHERE w.type = 'credit' AND w.category = 'refund') AS refunds,
        sum(w.amount) FILTER (WHERE w.type = 'credit' AND w.category = 'prize') AS prizes,
        sum(w.amount) FILTER (WHERE w.type = 'credit' AND w.category = 'bounty') AS bounties
      FROM wallet_receipts w JOIN eligible e ON e.id = w.related_entity_id
      WHERE (w.type = 'debit' AND w.category IN ('tournament_buyin','rebuy','addon'))
         OR (w.type = 'credit' AND w.category IN ('refund','prize','bounty'))
      GROUP BY w.related_entity_id
    ), rake_totals AS MATERIALIZED (
      -- Bounded by the earliest eligible tournament's creation time (-1d margin)
      -- so idx_rake_records_club_data_tournament_window reads only ~35 days
      -- instead of every historical tournament rake record ever written.
      SELECT rr.tournament_id AS id, sum(rr.rake_amount) AS rake
      FROM public.rake_records rr JOIN eligible e ON e.id = rr.tournament_id
      WHERE rr.is_tournament AND rr.rake_amount <> 0 AND rr.tournament_id IS NOT NULL
        AND rr.created_at >= COALESCE((SELECT min(created_at) - interval '1 day' FROM eligible), '-infinity'::timestamptz)
      GROUP BY rr.tournament_id
    ), overlay_totals AS MATERIALIZED (
      SELECT l.tournament_id AS id, sum(l.amount) AS overlay
      FROM public.chip_ledger l JOIN eligible e ON e.id = l.tournament_id
      WHERE l.category = 'overlay' AND l.to_type = 'prize_liability'
      GROUP BY l.tournament_id
    ), returned_overlays AS MATERIALIZED (
      SELECT l.tournament_id AS id, sum(l.amount) AS returned
      FROM public.chip_ledger l JOIN eligible e ON e.id = l.tournament_id
      WHERE l.category = 'reversal' AND l.from_type = 'prize_liability'
        AND l.from_entity_id = l.tournament_id
        AND l.metadata->>'kind' = 'reviewed_void_overlay_return'
      GROUP BY l.tournament_id
    ), house_corrections AS MATERIALIZED (
      SELECT l.tournament_id AS id, sum(l.amount) AS amount
      FROM public.chip_ledger l JOIN eligible e ON e.id = l.tournament_id
      WHERE l.tournament_id IS NOT NULL
        AND l.category = 'correction' AND l.to_type = 'prize_liability'
        AND l.from_type IN ('union_bank','club_treasury')
      GROUP BY l.tournament_id
    ), seat_income AS MATERIALIZED (
      SELECT e.id, sum(sp.amount) AS amount
      FROM public.tournament_payouts sp
      JOIN eligible e ON sp.metadata->>'satellite_target_id' = e.id::text
      LEFT JOIN public.tournament_satellite_awards a
        ON a.tournament_id = sp.tournament_id AND a.place = sp.position
      LEFT JOIN public.tournament_tickets k ON k.id = COALESCE(a.ticket_id, CASE WHEN sp.metadata->>'ticket_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (sp.metadata->>'ticket_id')::uuid END) -- no award row: the payout carries its ticket (2026-10-03)
      WHERE sp.source IN ('satellite_seat','satellite_ticket')
        AND sp.metadata->>'satellite_target_id' IS NOT NULL
        AND COALESCE(a.delivery_kind, 'seat') IN ('seat','ticket')
        AND (k.id IS NULL OR (k.status = 'redeemed' AND NOT EXISTS (SELECT 1 FROM public.chip_ledger cl WHERE cl.idempotency_key = 'ticket:' || k.id::text || ':closed-target-cash' AND cl.category = 'ticket_redeem')))
      GROUP BY e.id
    ), seat_outgoing AS MATERIALIZED (
      SELECT e.id, sum(sp.amount) AS amount
      FROM public.tournament_payouts sp JOIN eligible e ON e.id = sp.tournament_id
      LEFT JOIN public.tournament_satellite_awards a
        ON a.tournament_id = sp.tournament_id AND a.place = sp.position
      LEFT JOIN public.tournament_tickets k ON k.id = COALESCE(a.ticket_id, CASE WHEN sp.metadata->>'ticket_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (sp.metadata->>'ticket_id')::uuid END) -- no award row: the payout carries its ticket (2026-10-03)
      WHERE sp.source IN ('satellite_seat','satellite_ticket')
        AND COALESCE(a.delivery_kind, 'seat') IN ('seat','ticket')
        AND COALESCE(k.status, 'issued') IN ('issued','redeemed')
        AND NOT (
          k.id IS NULL
          AND EXISTS (SELECT 1 FROM public.wallet_transactions w
                      WHERE w.related_entity_id = e.id
                        AND w.type = 'credit' AND w.category = 'prize'
                        AND w.user_id = sp.user_id AND w.amount = sp.amount)
        )
      GROUP BY e.id
    ), deltas AS MATERIALIZED (
      SELECT e.*, COALESCE(w.prizes, 0) AS wallet_prizes,
        round(COALESCE(w.money_in, 0) - COALESCE(w.refunds, 0)
          - COALESCE(rr.rake, 0) - COALESCE(w.prizes, 0) - COALESCE(w.bounties, 0)
          + GREATEST(COALESCE(l.overlay, 0), COALESCE(o.amount, 0)) - COALESCE(ro.returned, 0)
          + COALESCE(hc.amount, 0)
          + COALESCE(b.amount, 0) + COALESCE(si.amount, 0) - COALESCE(so.amount, 0), 2) AS delta
      FROM eligible e
      LEFT JOIN wallet_totals w ON w.id = e.id
      LEFT JOIN rake_totals rr ON rr.id = e.id
      LEFT JOIN overlay_totals l ON l.id = e.id
      LEFT JOIN returned_overlays ro ON ro.id = e.id
      LEFT JOIN house_corrections hc ON hc.id = e.id
      LEFT JOIN public.tournament_guarantee_overlays o ON o.tournament_id = e.id
      LEFT JOIN public.tournament_conservation_baseline b ON b.tournament_id = e.id
      LEFT JOIN seat_income si ON si.id = e.id
      LEFT JOIN seat_outgoing so ON so.id = e.id
    )
    SELECT t.id, t.name, t.club_id, t.prize_pool,
      COALESCE((public.fn_tournament_payout_reconcile(t.id, false)->>'total_top_up')::numeric, 0) AS topup,
      t.delta, t.wallet_prizes
    FROM deltas t
    WHERE t.delta > 0.01
    ORDER BY t.ended_at ASC NULLS LAST
    LIMIT GREATEST(p_limit, 1)
  LOOP
    CONTINUE WHEN r.topup <= 0.005;

    /* CONSERVATION REFUSES BEFORE THE POOL DOES (2026-09-01).
       The reconciler computes "already paid" from tournament_payouts, on
       purpose - counting ledger rows instead caused two real double-pays. The
       cost of that choice is that an event whose record is incomplete reports
       a debt it does not have, and 61 events on this platform hold 5,515.91
       chips of prizes that reached wallets and were never recorded. If such a
       pool is ever funded, this sweep would pay them a second time.

       An event that has already disbursed its whole pool to wallets owes
       nobody, whatever the paperwork says. Refuse, and say so, so the record
       gets fixed rather than paid twice. */
    IF r.wallet_prizes + 0.01 >= COALESCE(r.prize_pool, 0) AND COALESCE(r.prize_pool, 0) > 0 THEN
      v_refused := v_refused + 1;
      v_refused_chips := v_refused_chips + r.topup;
      INSERT INTO public.financial_alerts (severity, source, message, context)
      SELECT 'warning', 'fn_pay_backed_payout_shortfalls',
             format('%s already paid %s of its %s pool to wallets, so the %s the reconciler reports as owed is a missing tournament_payouts record, not a debt. Paying nothing.',
                    COALESCE(r.name, r.id::text), round(r.wallet_prizes,2),
                    round(COALESCE(r.prize_pool,0),2), round(r.topup,2))
           , jsonb_build_object('kind','refused_already_disbursed','tournament_id',r.id,
               'club_id',r.club_id,'wallet_prizes',round(r.wallet_prizes,2),
               'prize_pool',round(COALESCE(r.prize_pool,0),2),'reported_top_up',round(r.topup,2))
       WHERE NOT EXISTS (SELECT 1 FROM public.financial_alerts fa
                          WHERE fa.source='fn_pay_backed_payout_shortfalls'
                            AND fa.resolved IS NOT TRUE
                            AND fa.context->>'kind'='refused_already_disbursed'
                            AND fa.context->>'tournament_id' = r.id::text);
      IF FOUND THEN v_alerts := v_alerts + 1; END IF;
      CONTINUE;
    END IF;

    -- The event must be holding at least what it is about to pay out. Not
    -- `delta >= 0` - that would let an event with 3 chips spare pay out 300.
    IF r.delta < r.topup THEN
      v_withheld := v_withheld + r.topup;
      v_withheld_events := v_withheld_events + 1;
      /* WITHHOLDING IS NEVER SILENT (2026-09-01).
         This branch used to increment a counter that reached a console line
         and nothing else. Money owed to a player and not paid produced no
         durable record anywhere, so nobody could find it later, and nobody
         did. It is a deduped alert now, per event, naming the gap. */
      INSERT INTO public.financial_alerts (severity, source, message, context)
      SELECT 'critical', 'fn_pay_backed_payout_shortfalls',
             format('%s owes players %s and its pool holds %s, so nothing was paid. The shortfall needs funding before anyone can be paid.',
                    COALESCE(r.name, r.id::text), round(r.topup,2), round(r.delta,2))
           , jsonb_build_object('kind','withheld_unfunded_pool','tournament_id',r.id,
               'club_id',r.club_id,'owed',round(r.topup,2),'pool_holds',round(r.delta,2),
               'funding_gap',round(r.topup - r.delta,2),
               'detail','no money was moved; funding an advertised guarantee is a human decision')
       WHERE NOT EXISTS (SELECT 1 FROM public.financial_alerts fa
                          WHERE fa.source='fn_pay_backed_payout_shortfalls'
                            AND fa.resolved IS NOT TRUE
                            AND fa.context->>'kind'='withheld_unfunded_pool'
                            AND fa.context->>'tournament_id' = r.id::text);
      IF FOUND THEN v_alerts := v_alerts + 1; END IF;
      CONTINUE;
    END IF;

    IF p_apply THEN
      /* ONE SETTLE PATH (Lane A3, 2026-09-02): the reconciler settles every
         place through fn_settle_tournament_obligation. `total_settled` is what
         that path actually paid; `total_top_up` is what was wanted. */
      v_res := public.fn_tournament_payout_reconcile(r.id, true);
      v_delta_after := public.fn_tournament_conservation_delta(r.id);

      IF v_delta_after < -0.01 THEN
        RAISE EXCEPTION 'paying % would leave conservation at %; refusing', r.id, v_delta_after;
      END IF;

      INSERT INTO public.tournament_payout_backfill_log
        (tournament_id, top_up, delta_before, delta_after)
      VALUES (r.id, COALESCE((v_res->>'total_settled')::numeric, (v_res->>'total_top_up')::numeric, r.topup), r.delta, v_delta_after)
      ON CONFLICT (tournament_id) DO UPDATE
        SET top_up = EXCLUDED.top_up,
            delta_before = EXCLUDED.delta_before,
            delta_after = EXCLUDED.delta_after;

      v_paid := v_paid + COALESCE((v_res->>'total_settled')::numeric, (v_res->>'total_top_up')::numeric, 0);
    ELSE
      v_paid := v_paid + r.topup;
    END IF;
    v_events := v_events + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'applied', p_apply,
    'events_paid', v_events, 'chips_paid', round(v_paid, 2),
    'events_withheld_unfunded_pool', v_withheld_events,
    'chips_withheld_unfunded_pool', round(v_withheld, 2),
    'events_refused_already_disbursed', v_refused,
    'chips_refused_already_disbursed', round(v_refused_chips, 2),
    'alerts_raised', v_alerts,
    'window_days', v_window_days,
    'money_path', 'fn_settle_tournament_obligation');
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_pay_backed_payout_shortfalls(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pay_backed_payout_shortfalls(boolean, integer) TO service_role;

-- ── 5 & 6. Job 155: fn_bbj_reconcile(uuid) & fn_bbj_reconcile_all() ─────────
-- Anchored live-source edits (never declaring new repair/reconcile functions;
-- see 20260927141643_bbj_meter_separates_cumulative_banks_from_recent_flows.sql).
DO $patch_bbj_reconcile$
DECLARE
  v_src text;
  v_old text;
  v_new text;
  v_hits integer;
  v_next text;
BEGIN
  -- 5. Patch public.fn_bbj_reconcile(uuid)
  v_src := pg_get_functiondef('public.fn_bbj_reconcile(uuid)'::regprocedure);
  IF position('ca_bbj_reconcile_marks' IN v_src) = 0 THEN
    v_old := $old_rec$DECLARE
  v_prev public.ca_bbj_pool_snapshots%ROWTYPE;
  v_base public.ca_bbj_pool_snapshots%ROWTYPE;
  v_now timestamptz := clock_timestamp();  -- not now(): two runs in one transaction must not collide
  v_main numeric; v_backup numeric; v_promo numeric;
  jm numeric := 0; jb numeric := 0; jp numeric := 0;
  v_drops numeric := 0; v_pay numeric := 0; v_sweep numeric := 0; v_fund numeric := 0; v_moves numeric := 0;
  v_fail integer := 0;
  v_row public.ca_bbj_pool_snapshots%ROWTYPE;
BEGIN
  IF NOT (current_user IN ('postgres', 'supabase_admin') OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'fn_bbj_reconcile is service only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_prev FROM public.ca_bbj_pool_snapshots WHERE pool_id = p_pool_id ORDER BY taken_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_bbj_reconcile: pool % has no opening balance; write the baseline first', p_pool_id;
  END IF;
  SELECT * INTO v_base FROM public.ca_bbj_pool_snapshots
   WHERE pool_id = p_pool_id AND is_baseline ORDER BY taken_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_bbj_reconcile: pool % has no opening balance row', p_pool_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bbj_pools WHERE id = p_pool_id) THEN
    RAISE EXCEPTION 'fn_bbj_reconcile: pool % not found', p_pool_id;
  END IF;

  -- ONE STATEMENT, ONE SNAPSHOT: the banks and the legs are read together so
  -- a write that commits between two reads cannot show in one and not the
  -- other. Every leg the autoledger wrote for this pool's own columns since the
  -- previous snapshot: the labelled side is the pool's bank, its sign is the
  -- side the label sits on (a bank move is two self-legs, one label each).
  -- A leg where the pool is only somebody else's counterparty carries no
  -- bbj_pools label and moves no bank, so it is not counted.
  -- The banks, cumulative journal and recent flow counters share one snapshot.
  -- Canonical incoming labels have bounded index values. The exceptional
  -- incoming branch and outgoing branch preserve arbitrary and NULL labels.
  WITH cumulative_legs AS (
    SELECT l.amount AS signed, l.to_label AS lbl
      FROM public.chip_ledger l
     WHERE l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool'
       AND l.created_at > v_base.taken_at
       AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64)
    UNION ALL
    SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
           CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
      FROM public.chip_ledger l
     WHERE l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool'
       AND l.created_at > v_base.taken_at
       AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
       AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64) IS NOT TRUE
    UNION ALL
    SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
           CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
      FROM public.chip_ledger l
     WHERE l.from_entity_id = p_pool_id AND l.from_type = 'bbj_pool'
       AND (l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool') IS NOT TRUE
       AND l.created_at > v_base.taken_at
       AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
  ), cumulative AS (
    SELECT COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.main_balance'), 0) AS m,
           COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.backup_balance'), 0) AS b,
           COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.promo_balance'), 0) AS p
      FROM cumulative_legs
  ), recent AS (
    SELECT COALESCE(sum(l.amount) FILTER (WHERE l.category = 'bbj_contribution' AND l.to_type = 'bbj_pool' AND l.from_type <> 'bbj_pool'), 0) AS drops,
           COALESCE(sum(l.amount) FILTER (WHERE l.category = 'bbj_payout' AND l.from_type = 'bbj_pool'), 0) AS payouts,
           COALESCE(sum(l.amount) FILTER (WHERE l.category = 'promo' AND l.from_type = 'bbj_pool'), 0) AS sweeps,
           COALESCE(sum(l.amount) FILTER (WHERE l.category = 'transfer' AND l.to_type = 'bbj_pool'), 0) AS funding,
           COALESCE(sum(l.amount) FILTER (WHERE l.from_type = 'bbj_pool' AND l.to_type = 'bbj_pool'), 0) / 2 AS moves
      FROM public.chip_ledger l
     WHERE ((l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool') OR (l.from_entity_id = p_pool_id AND l.from_type = 'bbj_pool'))
       AND l.created_at > v_base.taken_at AND l.created_at > v_prev.taken_at
       AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
  ), banks AS (
    SELECT COALESCE(main_balance, 0) AS m, COALESCE(backup_balance, 0) AS b, COALESCE(promo_balance, 0) AS p
      FROM public.bbj_pools WHERE id = p_pool_id
  )
  SELECT banks.m, banks.b, banks.p, cumulative.m, cumulative.b, cumulative.p,
         recent.drops, recent.payouts, recent.sweeps, recent.funding, recent.moves
    INTO v_main, v_backup, v_promo, jm, jb, jp, v_drops, v_pay, v_sweep, v_fund, v_moves
    FROM banks CROSS JOIN cumulative CROSS JOIN recent;$old_rec$;

    v_new := $new_rec$DECLARE
  v_prev public.ca_bbj_pool_snapshots%ROWTYPE;
  v_base public.ca_bbj_pool_snapshots%ROWTYPE;
  v_now timestamptz := clock_timestamp();  -- not now(): two runs in one transaction must not collide
  v_horizon timestamptz;
  v_mark_through timestamptz;
  v_mark_m numeric := 0; v_mark_b numeric := 0; v_mark_p numeric := 0;
  v_add_m numeric := 0; v_add_b numeric := 0; v_add_p numeric := 0;
  v_main numeric; v_backup numeric; v_promo numeric;
  jm numeric := 0; jb numeric := 0; jp numeric := 0;
  v_drops numeric := 0; v_pay numeric := 0; v_sweep numeric := 0; v_fund numeric := 0; v_moves numeric := 0;
  v_fail integer := 0;
  v_row public.ca_bbj_pool_snapshots%ROWTYPE;
BEGIN
  IF NOT (current_user IN ('postgres', 'supabase_admin') OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'fn_bbj_reconcile is service only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_prev FROM public.ca_bbj_pool_snapshots WHERE pool_id = p_pool_id ORDER BY taken_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_bbj_reconcile: pool % has no opening balance; write the baseline first', p_pool_id;
  END IF;
  SELECT * INTO v_base FROM public.ca_bbj_pool_snapshots
   WHERE pool_id = p_pool_id AND is_baseline ORDER BY taken_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_bbj_reconcile: pool % has no opening balance row', p_pool_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bbj_pools WHERE id = p_pool_id) THEN
    RAISE EXCEPTION 'fn_bbj_reconcile: pool % not found', p_pool_id;
  END IF;

  -- SAFE-HORIZON CHECKPOINT (append-only chip_ledger): advance per-pool exact
  -- cumulative sums up to LEAST(now() - 6h, min(xact_start) - 1m) so each
  -- hourly reading sums only the tail (v_mark_through, infinity) instead of
  -- re-summing 13M+ historical legs since the pool's opening baseline.
  SELECT LEAST(now() - interval '6 hours', COALESCE(min(a.xact_start), now()) - interval '1 minute')
    INTO v_horizon
    FROM pg_stat_activity a WHERE a.xact_start IS NOT NULL;

  v_mark_through := v_base.taken_at;
  IF pg_try_advisory_xact_lock(hashtextextended('ca_bbj_reconcile_mark:' || p_pool_id::text, 0)) THEN
    SELECT m.through_at, m.journal_main, m.journal_backup, m.journal_promo
      INTO v_mark_through, v_mark_m, v_mark_b, v_mark_p
      FROM public.ca_bbj_reconcile_marks m
     WHERE m.pool_id = p_pool_id AND m.base_taken_at = v_base.taken_at;
    IF NOT FOUND THEN
      v_mark_through := v_base.taken_at;
      v_mark_m := 0; v_mark_b := 0; v_mark_p := 0;
      INSERT INTO public.ca_bbj_reconcile_marks (pool_id, base_taken_at, through_at, journal_main, journal_backup, journal_promo, advanced_at)
      VALUES (p_pool_id, v_base.taken_at, v_base.taken_at, 0, 0, 0, now())
      ON CONFLICT (pool_id) DO UPDATE
        SET base_taken_at = EXCLUDED.base_taken_at, through_at = EXCLUDED.through_at,
            journal_main = 0, journal_backup = 0, journal_promo = 0, advanced_at = now();
    END IF;
    IF v_horizon > v_mark_through THEN
      WITH delta_legs AS (
        SELECT l.amount AS signed, l.to_label AS lbl
          FROM public.chip_ledger l
         WHERE l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool'
           AND l.created_at > v_mark_through AND l.created_at <= v_horizon
           AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64)
        UNION ALL
        SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
               CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
          FROM public.chip_ledger l
         WHERE l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool'
           AND l.created_at > v_mark_through AND l.created_at <= v_horizon
           AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
           AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64) IS NOT TRUE
        UNION ALL
        SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
               CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
          FROM public.chip_ledger l
         WHERE l.from_entity_id = p_pool_id AND l.from_type = 'bbj_pool'
           AND (l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool') IS NOT TRUE
           AND l.created_at > v_mark_through AND l.created_at <= v_horizon
           AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
      )
      SELECT COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.main_balance'), 0),
             COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.backup_balance'), 0),
             COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.promo_balance'), 0)
        INTO v_add_m, v_add_b, v_add_p
        FROM delta_legs;

      v_mark_m := v_mark_m + v_add_m;
      v_mark_b := v_mark_b + v_add_b;
      v_mark_p := v_mark_p + v_add_p;
      v_mark_through := v_horizon;

      UPDATE public.ca_bbj_reconcile_marks
         SET through_at = v_mark_through,
             journal_main = v_mark_m,
             journal_backup = v_mark_b,
             journal_promo = v_mark_p,
             advanced_at = now()
       WHERE pool_id = p_pool_id AND base_taken_at = v_base.taken_at;
    END IF;
  ELSE
    SELECT m.through_at, m.journal_main, m.journal_backup, m.journal_promo
      INTO v_mark_through, v_mark_m, v_mark_b, v_mark_p
      FROM public.ca_bbj_reconcile_marks m
     WHERE m.pool_id = p_pool_id AND m.base_taken_at = v_base.taken_at;
    IF NOT FOUND THEN
      v_mark_through := v_base.taken_at;
      v_mark_m := 0; v_mark_b := 0; v_mark_p := 0;
    END IF;
  END IF;

  -- ONE STATEMENT, ONE SNAPSHOT: banks, cumulative tail after v_mark_through,
  -- and recent flow counters share one snapshot.
  WITH cumulative_legs AS (
    SELECT l.amount AS signed, l.to_label AS lbl
      FROM public.chip_ledger l
     WHERE l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool'
       AND l.created_at > v_mark_through
       AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64)
    UNION ALL
    SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
           CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
      FROM public.chip_ledger l
     WHERE l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool'
       AND l.created_at > v_mark_through
       AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
       AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64) IS NOT TRUE
    UNION ALL
    SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
           CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
      FROM public.chip_ledger l
     WHERE l.from_entity_id = p_pool_id AND l.from_type = 'bbj_pool'
       AND (l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool') IS NOT TRUE
       AND l.created_at > v_mark_through
       AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
  ), cumulative AS (
    SELECT v_mark_m + COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.main_balance'), 0) AS m,
           v_mark_b + COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.backup_balance'), 0) AS b,
           v_mark_p + COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.promo_balance'), 0) AS p
      FROM cumulative_legs
  ), recent AS (
    SELECT COALESCE(sum(l.amount) FILTER (WHERE l.category = 'bbj_contribution' AND l.to_type = 'bbj_pool' AND l.from_type <> 'bbj_pool'), 0) AS drops,
           COALESCE(sum(l.amount) FILTER (WHERE l.category = 'bbj_payout' AND l.from_type = 'bbj_pool'), 0) AS payouts,
           COALESCE(sum(l.amount) FILTER (WHERE l.category = 'promo' AND l.from_type = 'bbj_pool'), 0) AS sweeps,
           COALESCE(sum(l.amount) FILTER (WHERE l.category = 'transfer' AND l.to_type = 'bbj_pool'), 0) AS funding,
           COALESCE(sum(l.amount) FILTER (WHERE l.from_type = 'bbj_pool' AND l.to_type = 'bbj_pool'), 0) / 2 AS moves
      FROM public.chip_ledger l
     WHERE ((l.to_entity_id = p_pool_id AND l.to_type = 'bbj_pool') OR (l.from_entity_id = p_pool_id AND l.from_type = 'bbj_pool'))
       AND l.created_at > v_base.taken_at AND l.created_at > v_prev.taken_at
       AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
  ), banks AS (
    SELECT COALESCE(main_balance, 0) AS m, COALESCE(backup_balance, 0) AS b, COALESCE(promo_balance, 0) AS p
      FROM public.bbj_pools WHERE id = p_pool_id
  )
  SELECT banks.m, banks.b, banks.p, cumulative.m, cumulative.b, cumulative.p,
         recent.drops, recent.payouts, recent.sweeps, recent.funding, recent.moves
    INTO v_main, v_backup, v_promo, jm, jb, jp, v_drops, v_pay, v_sweep, v_fund, v_moves
    FROM banks CROSS JOIN cumulative CROSS JOIN recent;$new_rec$;

    v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'HOURLY_CRON_PERF_ANCHOR_MISMATCH: public.fn_bbj_reconcile(uuid) hits=%', v_hits
        USING ERRCODE = '55000';
    END IF;
    v_next := replace(v_src, v_old, v_new);
    EXECUTE v_next;
  END IF;

  -- 6. Patch public.fn_bbj_reconcile_all()
  v_src := pg_get_functiondef('public.fn_bbj_reconcile_all()'::regprocedure);
  IF position('ca_bbj_reconcile_marks' IN v_src) = 0 THEN
    v_old := $old_all$DECLARE
  p record; s public.ca_bbj_pool_snapshots%ROWTYPE; prev public.ca_bbj_pool_snapshots%ROWTYPE;
  v_out jsonb := '[]'::jsonb; v_two numeric; v_prev_cum numeric := 0; v_comparable boolean := false;
  v_alerts int := 0; v_opened int := 0;
BEGIN
  IF NOT (current_user IN ('postgres', 'supabase_admin') OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'fn_bbj_reconcile_all is service only' USING ERRCODE = '42501';
  END IF;
  FOR p IN SELECT b.id, b.union_id, b.club_id FROM public.bbj_pools b WHERE b.status = 'active' ORDER BY b.created_at LOOP
    -- A pool the meter has never seen opens its own balance (second cut).
    IF NOT EXISTS (SELECT 1 FROM public.ca_bbj_pool_snapshots x WHERE x.pool_id = p.id) THEN
      PERFORM public.fn_bbj_open_pool_baseline(p.id);
      v_opened := v_opened + 1;
    END IF;
    s := public.fn_bbj_reconcile(p.id);
    SELECT * INTO prev FROM public.ca_bbj_pool_snapshots WHERE id = s.prev_id;
    -- Two consecutive snapshots: a leg that commits after a read straddles one
    -- boundary and reverses at the next, so a single-interval swing is noise
    -- and a two-interval sum is a finding.
    /* The residue is now cumulative since the pool's opening balance, so a
       drop that straddled a reading is inside the next one and the number
       comes back on its own. What cannot come back on its own is a leak, and
       a leak grows: the finding is a non-zero residue that moved FURTHER in
       the same direction than the reading before it. */
    v_two := s.unexplained_main + s.unexplained_backup + s.unexplained_promo;
    /* NOT COMPARABLE IS NOT GROWTH (2026-09-09). prev may have been taken
       before this meter changed what it measures. Two numbers from two
       different bases say nothing about each other, and calling the
       difference growth is how the basis change of 10:21 today raised two
       incidents against pools that had not moved. When the bases differ the
       reading is recorded and the growth test is skipped for that one run;
       the next run has a comparable predecessor and the test resumes. A
       write failure is a fact rather than a comparison, so it still raises
       on its own below. */
    v_comparable := (prev.id IS NOT NULL AND NOT prev.is_baseline
                     AND prev.basis_version IS NOT DISTINCT FROM s.basis_version);
    v_prev_cum := COALESCE(CASE WHEN prev.is_baseline THEN 0
                                ELSE prev.unexplained_main + prev.unexplained_backup + prev.unexplained_promo END, 0);
    IF (v_comparable AND abs(v_two) > 0.01 AND abs(v_two) > abs(v_prev_cum)
        AND sign(v_two) = COALESCE(NULLIF(sign(v_prev_cum), 0), sign(v_two)))
       OR s.write_failures > 0 THEN
      v_alerts := v_alerts + 1;
      -- PHASE 6.2 (2026-09-05): the kill switch reads every pool's two-snapshot figure.
      PERFORM public.fn_ca_kill_switch_trip('fn_bbj_reconcile', v_two,
        format('BBJ pool %s moved %s beyond the journal over two snapshots', p.id, round(v_two, 2)));
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_bbj_reconcile', 'bbj_error', CASE WHEN abs(v_two) >= 100 OR s.write_failures > 0 THEN 'critical' ELSE 'warning' END,
        'bbj-meter:' || p.id::text || ':' || to_char(s.taken_at, 'YYYY-MM-DD-HH24'),
        round(v_two, 2), 0, round(v_two, 2), 'ledger', 'bbj_pools', p.id, p.club_id, p.union_id,
        NULL, NULL, NULL, NULL, NULL, NULL,
        format('BBJ pool banks are %s beyond the journal since this pool opened, up from %s at the previous reading (main %s, backup %s, promo %s; %s ledger write failure(s)): a bbj_pools write without a leg, or a leg without a write. A residue that grows in the same direction twice is not a reading boundary.',
               round(v_two, 2), round(v_prev_cum, 2), s.unexplained_main, s.unexplained_backup, s.unexplained_promo, s.write_failures),
        false,
        jsonb_build_object('snapshot_id', s.id, 'pool_id', p.id, 'unexplained_main', s.unexplained_main,
                           'unexplained_backup', s.unexplained_backup, 'unexplained_promo', s.unexplained_promo,
                           'write_failures', s.write_failures));
    END IF;
    v_out := v_out || jsonb_build_object('pool_id', p.id, 'snapshot_id', s.id,
                'main', s.main, 'backup', s.backup, 'promo', s.promo,
                'unexplained', round(s.unexplained_main + s.unexplained_backup + s.unexplained_promo, 2),
                'drops', s.drops_since, 'payouts', s.payouts_since, 'sweeps', s.sweeps_since);
  END LOOP;
  /* THIS METER RAISES UNDER A FRESH KEY EVERY HOUR, so an incident it has
     stopped reporting can never fold into a later one and can never close on
     its own: left alone it accumulates one open row per pool per hour
     forever. Recording the run lets fn_ca_resolve_cleared_incidents close
     what two consecutive readings have declined to raise. */
  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_bbj_reconcile', jsonb_build_object('alerts', v_alerts, 'opened', v_opened));

  RETURN jsonb_build_object('pools', v_out, 'alerts', v_alerts, 'opened', v_opened);
END;$old_all$;

    v_new := $new_all$DECLARE
  p record;
  v_out_arr jsonb[] := ARRAY[]::jsonb[];
  v_two numeric; v_prev_cum numeric := 0; v_comparable boolean := false;
  v_alerts int := 0; v_opened int := 0;
  v_horizon timestamptz;
  v_recent_min timestamptz;
  v_now timestamptz;
  v_cum_min timestamptz;
  v_add_m numeric; v_add_b numeric; v_add_p numeric;
  v_r record;
BEGIN
  IF NOT (current_user IN ('postgres', 'supabase_admin') OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'fn_bbj_reconcile_all is service only' USING ERRCODE = '42501';
  END IF;

  -- Step 1: Open baselines only for active pools the meter has never seen.
  FOR p IN
    SELECT b.id
      FROM public.bbj_pools b
     WHERE b.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.ca_bbj_pool_snapshots x WHERE x.pool_id = b.id)
     ORDER BY b.created_at
  LOOP
    PERFORM public.fn_bbj_open_pool_baseline(p.id);
    v_opened := v_opened + 1;
  END LOOP;

  -- Step 2: Advance safe-horizon per-pool journal checkpoints in batch so every
  -- active pool reads only its recent tail instead of re-reading 13M+ legs.
  SELECT LEAST(now() - interval '6 hours', COALESCE(min(a.xact_start), now()) - interval '1 minute')
    INTO v_horizon
    FROM pg_stat_activity a WHERE a.xact_start IS NOT NULL;

  IF pg_try_advisory_xact_lock(hashtextextended('ca_bbj_reconcile_marks_batch', 0)) THEN
    -- Seed/reset marks for active pools missing one or whose baseline moved.
    INSERT INTO public.ca_bbj_reconcile_marks (pool_id, base_taken_at, through_at, journal_main, journal_backup, journal_promo, advanced_at)
    SELECT b.id, bs.taken_at, bs.taken_at, 0, 0, 0, now()
      FROM public.bbj_pools b
      JOIN LATERAL (
        SELECT s.taken_at FROM public.ca_bbj_pool_snapshots s
         WHERE s.pool_id = b.id AND s.is_baseline
         ORDER BY s.taken_at LIMIT 1
      ) bs ON true
      LEFT JOIN public.ca_bbj_reconcile_marks m ON m.pool_id = b.id
     WHERE b.status = 'active'
       AND (m.pool_id IS NULL OR m.base_taken_at IS DISTINCT FROM bs.taken_at)
    ON CONFLICT (pool_id) DO UPDATE
      SET base_taken_at = EXCLUDED.base_taken_at,
          through_at = EXCLUDED.through_at,
          journal_main = 0, journal_backup = 0, journal_promo = 0,
          advanced_at = now();

    -- Pools more than 24h behind the horizon (initial backfill / reset) use
    -- per-pool partial covering indexes on chip_ledger.
    FOR p IN
      SELECT m.pool_id, m.base_taken_at, m.through_at
        FROM public.ca_bbj_reconcile_marks m
        JOIN public.bbj_pools b ON b.id = m.pool_id AND b.status = 'active'
       WHERE m.through_at < v_horizon - interval '24 hours'
    LOOP
      IF pg_try_advisory_xact_lock(hashtextextended('ca_bbj_reconcile_mark:' || p.pool_id::text, 0)) THEN
        WITH delta_legs AS (
          SELECT l.amount AS signed, l.to_label AS lbl
            FROM public.chip_ledger l
           WHERE l.to_entity_id = p.pool_id AND l.to_type = 'bbj_pool'
             AND l.created_at > p.through_at AND l.created_at <= v_horizon
             AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64)
          UNION ALL
          SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                      WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
                 CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                      WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
            FROM public.chip_ledger l
           WHERE l.to_entity_id = p.pool_id AND l.to_type = 'bbj_pool'
             AND l.created_at > p.through_at AND l.created_at <= v_horizon
             AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
             AND (l.to_label IN ('bbj_pools.main_balance', 'bbj_pools.backup_balance', 'bbj_pools.promo_balance') AND octet_length(l.to_label) <= 64) IS NOT TRUE
          UNION ALL
          SELECT CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                      WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END,
                 CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                      WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END
            FROM public.chip_ledger l
           WHERE l.from_entity_id = p.pool_id AND l.from_type = 'bbj_pool'
             AND (l.to_entity_id = p.pool_id AND l.to_type = 'bbj_pool') IS NOT TRUE
             AND l.created_at > p.through_at AND l.created_at <= v_horizon
             AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
        )
        SELECT COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.main_balance'), 0),
               COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.backup_balance'), 0),
               COALESCE(sum(signed) FILTER (WHERE lbl = 'bbj_pools.promo_balance'), 0)
          INTO v_add_m, v_add_b, v_add_p
          FROM delta_legs;

        UPDATE public.ca_bbj_reconcile_marks
           SET through_at = v_horizon,
               journal_main = journal_main + v_add_m,
               journal_backup = journal_backup + v_add_b,
               journal_promo = journal_promo + v_add_p,
               advanced_at = now()
         WHERE pool_id = p.pool_id AND base_taken_at = p.base_taken_at;
      END IF;
    END LOOP;

    -- Steady-state hourly advance across ALL active pools in ONE range scan.
    SELECT min(m.through_at) INTO v_recent_min
      FROM public.ca_bbj_reconcile_marks m
      JOIN public.bbj_pools b ON b.id = m.pool_id AND b.status = 'active'
     WHERE m.through_at < v_horizon AND m.through_at >= v_horizon - interval '24 hours';

    IF v_recent_min IS NOT NULL THEN
      WITH targets AS MATERIALIZED (
        SELECT m.pool_id, m.base_taken_at, m.through_at
          FROM public.ca_bbj_reconcile_marks m
          JOIN public.bbj_pools b ON b.id = m.pool_id AND b.status = 'active'
         WHERE m.through_at < v_horizon AND m.through_at >= v_horizon - interval '24 hours'
      ), raw_legs AS MATERIALIZED (
        SELECT l.to_entity_id, l.from_entity_id, l.to_type, l.from_type,
               l.to_label, l.from_label, l.amount, l.created_at
          FROM public.chip_ledger l
         WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
           AND l.created_at > v_recent_min AND l.created_at <= v_horizon
           AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
      ), expanded AS (
        SELECT l.to_entity_id AS pool_id, l.created_at,
               CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END AS signed,
               CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END AS lbl
          FROM raw_legs l
         WHERE l.to_type = 'bbj_pool'
        UNION ALL
        SELECT l.from_entity_id AS pool_id, l.created_at,
               CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END AS signed,
               CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                    WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END AS lbl
          FROM raw_legs l
         WHERE l.from_type = 'bbj_pool'
           AND (l.to_entity_id = l.from_entity_id AND l.to_type = 'bbj_pool') IS NOT TRUE
      ), agg AS (
        SELECT t.pool_id,
               COALESCE(sum(e.signed) FILTER (WHERE e.lbl = 'bbj_pools.main_balance'), 0) AS add_m,
               COALESCE(sum(e.signed) FILTER (WHERE e.lbl = 'bbj_pools.backup_balance'), 0) AS add_b,
               COALESCE(sum(e.signed) FILTER (WHERE e.lbl = 'bbj_pools.promo_balance'), 0) AS add_p
          FROM targets t
          LEFT JOIN expanded e ON e.pool_id = t.pool_id AND e.created_at > t.through_at
         GROUP BY t.pool_id
      )
      UPDATE public.ca_bbj_reconcile_marks m
         SET through_at = v_horizon,
             journal_main = m.journal_main + agg.add_m,
             journal_backup = m.journal_backup + agg.add_b,
             journal_promo = m.journal_promo + agg.add_p,
             advanced_at = now()
        FROM agg
       WHERE m.pool_id = agg.pool_id;
    END IF;
  END IF;

  -- Step 3: Snapshot ALL active pools in ONE atomic statement (one snapshot
  -- shared across banks, cumulative tails, recent flows, and write failures).
  v_now := clock_timestamp();
  SELECT min(COALESCE(m.through_at, bs.taken_at)) INTO v_cum_min
    FROM public.bbj_pools b
    JOIN LATERAL (
      SELECT s.taken_at FROM public.ca_bbj_pool_snapshots s
       WHERE s.pool_id = b.id AND s.is_baseline
       ORDER BY s.taken_at LIMIT 1
    ) bs ON true
    LEFT JOIN public.ca_bbj_reconcile_marks m
      ON m.pool_id = b.id AND m.base_taken_at = bs.taken_at
   WHERE b.status = 'active';

  FOR v_r IN
    WITH active_pools AS MATERIALIZED (
      SELECT b.id AS pool_id, b.union_id, b.club_id, b.created_at,
             COALESCE(b.main_balance, 0) AS main_bal,
             COALESCE(b.backup_balance, 0) AS backup_bal,
             COALESCE(b.promo_balance, 0) AS promo_bal,
             row_number() OVER (ORDER BY b.created_at, b.id) AS ord
        FROM public.bbj_pools b
       WHERE b.status = 'active'
    ), pool_ctx AS MATERIALIZED (
      SELECT ap.*,
             prev.id AS prev_id, prev.taken_at AS prev_taken_at,
             prev.is_baseline AS prev_is_baseline, prev.basis_version AS prev_basis_version,
             prev.unexplained_main AS prev_unexp_m,
             prev.unexplained_backup AS prev_unexp_b,
             prev.unexplained_promo AS prev_unexp_p,
             base.taken_at AS base_taken_at,
             base.main AS base_main, base.backup AS base_backup, base.promo AS base_promo,
             COALESCE(m.through_at, base.taken_at) AS mark_through,
             COALESCE(m.journal_main, 0) AS mark_m,
             COALESCE(m.journal_backup, 0) AS mark_b,
             COALESCE(m.journal_promo, 0) AS mark_p
        FROM active_pools ap
        JOIN LATERAL (
          SELECT s.id, s.taken_at, s.is_baseline, s.basis_version,
                 s.unexplained_main, s.unexplained_backup, s.unexplained_promo
            FROM public.ca_bbj_pool_snapshots s
           WHERE s.pool_id = ap.pool_id
           ORDER BY s.taken_at DESC LIMIT 1
        ) prev ON true
        JOIN LATERAL (
          SELECT s.taken_at, s.main, s.backup, s.promo
            FROM public.ca_bbj_pool_snapshots s
           WHERE s.pool_id = ap.pool_id AND s.is_baseline
           ORDER BY s.taken_at LIMIT 1
        ) base ON true
        LEFT JOIN public.ca_bbj_reconcile_marks m
          ON m.pool_id = ap.pool_id AND m.base_taken_at = base.taken_at
    ), tail_raw AS MATERIALIZED (
      SELECT l.to_entity_id, l.from_entity_id, l.to_type, l.from_type,
             l.to_label, l.from_label, l.category, l.amount, l.created_at
        FROM public.chip_ledger l
       WHERE v_cum_min IS NOT NULL
         AND (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
         AND l.created_at > v_cum_min
         AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
    ), tail_expanded AS MATERIALIZED (
      SELECT l.to_entity_id AS pool_id, l.created_at, l.category, l.to_type, l.from_type, l.amount,
             CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                  WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END AS signed,
             CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                  WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END AS lbl
        FROM tail_raw l
       WHERE l.to_type = 'bbj_pool'
      UNION ALL
      SELECT l.from_entity_id AS pool_id, l.created_at, l.category, l.to_type, l.from_type, l.amount,
             CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.amount
                  WHEN l.from_label LIKE 'bbj_pools.%' THEN -l.amount ELSE 0 END AS signed,
             CASE WHEN l.to_label LIKE 'bbj_pools.%' THEN l.to_label
                  WHEN l.from_label LIKE 'bbj_pools.%' THEN l.from_label END AS lbl
        FROM tail_raw l
       WHERE l.from_type = 'bbj_pool'
         AND (l.to_entity_id = l.from_entity_id AND l.to_type = 'bbj_pool') IS NOT TRUE
    ), tail_agg AS MATERIALIZED (
      SELECT pc.pool_id,
             COALESCE(sum(te.signed) FILTER (WHERE te.created_at > pc.mark_through AND te.lbl = 'bbj_pools.main_balance'), 0) AS add_m,
             COALESCE(sum(te.signed) FILTER (WHERE te.created_at > pc.mark_through AND te.lbl = 'bbj_pools.backup_balance'), 0) AS add_b,
             COALESCE(sum(te.signed) FILTER (WHERE te.created_at > pc.mark_through AND te.lbl = 'bbj_pools.promo_balance'), 0) AS add_p,
             COALESCE(sum(te.amount) FILTER (WHERE te.created_at > pc.base_taken_at AND te.created_at > pc.prev_taken_at AND te.category = 'bbj_contribution' AND te.to_type = 'bbj_pool' AND te.from_type <> 'bbj_pool'), 0) AS drops,
             COALESCE(sum(te.amount) FILTER (WHERE te.created_at > pc.base_taken_at AND te.created_at > pc.prev_taken_at AND te.category = 'bbj_payout' AND te.from_type = 'bbj_pool'), 0) AS payouts,
             COALESCE(sum(te.amount) FILTER (WHERE te.created_at > pc.base_taken_at AND te.created_at > pc.prev_taken_at AND te.category = 'promo' AND te.from_type = 'bbj_pool'), 0) AS sweeps,
             COALESCE(sum(te.amount) FILTER (WHERE te.created_at > pc.base_taken_at AND te.created_at > pc.prev_taken_at AND te.category = 'transfer' AND te.to_type = 'bbj_pool'), 0) AS funding,
             COALESCE(sum(te.amount) FILTER (WHERE te.created_at > pc.base_taken_at AND te.created_at > pc.prev_taken_at AND te.from_type = 'bbj_pool' AND te.to_type = 'bbj_pool'), 0) / 2 AS moves
        FROM pool_ctx pc
        LEFT JOIN tail_expanded te ON te.pool_id = pc.pool_id
       GROUP BY pc.pool_id
    ), older_recent AS MATERIALIZED (
      -- Rare fallback: only pools whose previous snapshot is older than v_cum_min.
      SELECT pc.pool_id,
             COALESCE(sum(l.amount) FILTER (WHERE l.category = 'bbj_contribution' AND l.to_type = 'bbj_pool' AND l.from_type <> 'bbj_pool'), 0) AS drops,
             COALESCE(sum(l.amount) FILTER (WHERE l.category = 'bbj_payout' AND l.from_type = 'bbj_pool'), 0) AS payouts,
             COALESCE(sum(l.amount) FILTER (WHERE l.category = 'promo' AND l.from_type = 'bbj_pool'), 0) AS sweeps,
             COALESCE(sum(l.amount) FILTER (WHERE l.category = 'transfer' AND l.to_type = 'bbj_pool'), 0) AS funding,
             COALESCE(sum(l.amount) FILTER (WHERE l.from_type = 'bbj_pool' AND l.to_type = 'bbj_pool'), 0) / 2 AS moves
        FROM pool_ctx pc
        LEFT JOIN public.chip_ledger l
          ON ((l.to_entity_id = pc.pool_id AND l.to_type = 'bbj_pool') OR (l.from_entity_id = pc.pool_id AND l.from_type = 'bbj_pool'))
         AND l.created_at > pc.base_taken_at AND l.created_at > pc.prev_taken_at
         AND l.created_at <= v_cum_min
         AND (l.to_label LIKE 'bbj_pools.%' OR l.from_label LIKE 'bbj_pools.%')
       WHERE v_cum_min IS NOT NULL AND GREATEST(pc.base_taken_at, pc.prev_taken_at) < v_cum_min
       GROUP BY pc.pool_id
    ), fail_times AS MATERIALIZED (
      SELECT f.occurred_at
        FROM public.ca_ledger_write_failures f
       WHERE f.occurred_at <= v_now
         AND f.message ILIKE '%bbj_pools.%'
    ), computed AS (
      SELECT pc.*,
             pc.mark_m + COALESCE(ta.add_m, 0) AS jm,
             pc.mark_b + COALESCE(ta.add_b, 0) AS jb,
             pc.mark_p + COALESCE(ta.add_p, 0) AS jp,
             COALESCE(ta.drops, 0) + COALESCE(orr.drops, 0) AS v_drops,
             COALESCE(ta.payouts, 0) + COALESCE(orr.payouts, 0) AS v_pay,
             COALESCE(ta.sweeps, 0) + COALESCE(orr.sweeps, 0) AS v_sweep,
             COALESCE(ta.funding, 0) + COALESCE(orr.funding, 0) AS v_fund,
             COALESCE(ta.moves, 0) + COALESCE(orr.moves, 0) AS v_moves,
             (SELECT count(*)::int FROM fail_times ft WHERE ft.occurred_at > pc.prev_taken_at) AS v_fail
        FROM pool_ctx pc
        LEFT JOIN tail_agg ta ON ta.pool_id = pc.pool_id
        LEFT JOIN older_recent orr ON orr.pool_id = pc.pool_id
    ), ins AS (
      INSERT INTO public.ca_bbj_pool_snapshots
        (pool_id, taken_at, is_baseline, prev_id, main, backup, promo,
         journal_main, journal_backup, journal_promo,
         drops_since, payouts_since, sweeps_since, funding_since, moves_since, write_failures,
         unexplained_main, unexplained_backup, unexplained_promo, basis_version)
      SELECT c.pool_id, v_now, false, c.prev_id, c.main_bal, c.backup_bal, c.promo_bal,
             round(c.jm, 2), round(c.jb, 2), round(c.jp, 2),
             round(c.v_drops, 2), round(c.v_pay, 2), round(c.v_sweep, 2), round(c.v_fund, 2), round(c.v_moves, 2), c.v_fail,
             round((c.main_bal - c.base_main) - c.jm, 2),
             round((c.backup_bal - c.base_backup) - c.jb, 2),
             round((c.promo_bal - c.base_promo) - c.jp, 2),
             'cumulative-since-open-v1'
        FROM computed c
       ORDER BY c.ord
      RETURNING *
    )
    SELECT i.*,
           pc.ord, pc.union_id, pc.club_id,
           pc.prev_id AS p_id, pc.prev_is_baseline, pc.prev_basis_version,
           pc.prev_unexp_m, pc.prev_unexp_b, pc.prev_unexp_p
      FROM ins i
      JOIN pool_ctx pc ON pc.pool_id = i.pool_id
     ORDER BY pc.ord
  LOOP
    v_two := v_r.unexplained_main + v_r.unexplained_backup + v_r.unexplained_promo;
    v_comparable := (v_r.p_id IS NOT NULL AND NOT v_r.prev_is_baseline
                     AND v_r.prev_basis_version IS NOT DISTINCT FROM v_r.basis_version);
    v_prev_cum := COALESCE(CASE WHEN v_r.prev_is_baseline THEN 0
                                ELSE v_r.prev_unexp_m + v_r.prev_unexp_b + v_r.prev_unexp_p END, 0);
    IF (v_comparable AND abs(v_two) > 0.01 AND abs(v_two) > abs(v_prev_cum)
        AND sign(v_two) = COALESCE(NULLIF(sign(v_prev_cum), 0), sign(v_two)))
       OR v_r.write_failures > 0 THEN
      v_alerts := v_alerts + 1;
      -- PHASE 6.2 (2026-09-05): the kill switch reads every pool's two-snapshot figure.
      PERFORM public.fn_ca_kill_switch_trip('fn_bbj_reconcile', v_two,
        format('BBJ pool %s moved %s beyond the journal over two snapshots', v_r.pool_id, round(v_two, 2)));
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_bbj_reconcile', 'bbj_error', CASE WHEN abs(v_two) >= 100 OR v_r.write_failures > 0 THEN 'critical' ELSE 'warning' END,
        'bbj-meter:' || v_r.pool_id::text || ':' || to_char(v_r.taken_at, 'YYYY-MM-DD-HH24'),
        round(v_two, 2), 0, round(v_two, 2), 'ledger', 'bbj_pools', v_r.pool_id, v_r.club_id, v_r.union_id,
        NULL, NULL, NULL, NULL, NULL, NULL,
        format('BBJ pool banks are %s beyond the journal since this pool opened, up from %s at the previous reading (main %s, backup %s, promo %s; %s ledger write failure(s)): a bbj_pools write without a leg, or a leg without a write. A residue that grows in the same direction twice is not a reading boundary.',
               round(v_two, 2), round(v_prev_cum, 2), v_r.unexplained_main, v_r.unexplained_backup, v_r.unexplained_promo, v_r.write_failures),
        false,
        jsonb_build_object('snapshot_id', v_r.id, 'pool_id', v_r.pool_id, 'unexplained_main', v_r.unexplained_main,
                           'unexplained_backup', v_r.unexplained_backup, 'unexplained_promo', v_r.unexplained_promo,
                           'write_failures', v_r.write_failures));
    END IF;
    v_out_arr := array_append(v_out_arr, jsonb_build_object('pool_id', v_r.pool_id, 'snapshot_id', v_r.id,
                'main', v_r.main, 'backup', v_r.backup, 'promo', v_r.promo,
                'unexplained', round(v_r.unexplained_main + v_r.unexplained_backup + v_r.unexplained_promo, 2),
                'drops', v_r.drops_since, 'payouts', v_r.payouts_since, 'sweeps', v_r.sweeps_since));
  END LOOP;

  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_bbj_reconcile', jsonb_build_object('alerts', v_alerts, 'opened', v_opened));

  RETURN jsonb_build_object('pools', COALESCE(to_jsonb(v_out_arr), '[]'::jsonb), 'alerts', v_alerts, 'opened', v_opened);
END;$new_all$;

    v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'HOURLY_CRON_PERF_ANCHOR_MISMATCH: public.fn_bbj_reconcile_all() hits=%', v_hits
        USING ERRCODE = '55000';
    END IF;
    v_next := replace(v_src, v_old, v_new);
    EXECUTE v_next;
  END IF;
END $patch_bbj_reconcile$;

REVOKE ALL ON FUNCTION public.fn_bbj_reconcile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_reconcile(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_bbj_reconcile_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_reconcile_all() TO service_role;

-- ── 7. Job 155: fn_rake_bbj_invariants(integer) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_rake_bbj_invariants(p_hours integer DEFAULT 2)
 RETURNS TABLE(check_name text, violations bigint, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(COALESCE(p_hours, 2), 1));
  -- Rule checks: settlement is not instant, but nothing heals a broken rule.
  v_grace timestamptz := now() - interval '5 minutes';
  /* THE GRACE BELONGS TO THE WRITER, NOT TO A REPAIR SCHEDULE (2026-09-22).
     I5 and I7 used to ask the job scheduler when a repair job last ran. A
     retired job answered NULL, the fallback was now() - 2 hours, and with
     p_hours = 2 that window is empty, so I5 read zero by construction. The
     rake and the BBJ drop of an accepted hand are owed by its post-commit
     envelope, committed with the hand, and banked in one transaction by
     fn_ca_process_hand_post_commit_obligations. Five minutes is that
     writer's own bound: a hand still owed after it is I9, a hand owed by
     nothing is I7. */
  v_min_dealt integer;
  v_inelig text[];
BEGIN
  SELECT r.bbj_min_players_dealt, r.bbj_ineligible_variants INTO v_min_dealt, v_inelig
    FROM public.ca_rake_rules r WHERE r.id = 1;

  RETURN QUERY
  WITH scope AS MATERIALIZED (
    SELECT r.hand_id, r.rake_amount, COALESCE(r.bbj_contribution, 0) AS bbj,
           r.pot_size, COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(hh.players) = 'array' THEN hh.players END), r.num_players) AS num_players, r.rake_method, r.player_contributions,
           r.created_at, hh.created_at AS hand_at,
           t.id AS tid, t.small_blind, t.big_blind, t.club_id,
           lower(COALESCE(hh.game_variant, t.game_variant::text)) AS variant,
           COALESCE(array_length(hh.community_cards, 1), 0) AS board
      FROM rake_records r
      JOIN tables t ON t.id = r.table_id
      LEFT JOIN hand_history hh ON hh.id = r.hand_id
     WHERE r.source = 'atomic_distribute_rake'
       AND r.created_at >= v_since AND r.created_at < v_grace
       AND t.tournament_id IS NULL AND r.is_tournament IS NOT TRUE
  )
  SELECT 'I1_drop_under_3_dealt'::text, count(*)::bigint,
         COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'n', num_players)) FILTER (WHERE true), '[]'::jsonb)
    FROM (SELECT hand_id, num_players FROM scope
           WHERE bbj > 0 AND num_players IS NOT NULL AND num_players < v_min_dealt LIMIT 20) x
  UNION ALL
  SELECT 'I2_drop_on_ineligible_variant', count(*)::bigint,
         COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'variant', variant)), '[]'::jsonb)
    FROM (SELECT hand_id, variant FROM scope
           WHERE bbj > 0 AND variant = ANY (v_inelig) LIMIT 20) x
  UNION ALL
  SELECT 'I3_deductions_exceed_pot', count(*)::bigint,
         COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'pot', pot_size, 'take', take)), '[]'::jsonb)
    FROM (SELECT hand_id, pot_size, rake_amount + bbj AS take FROM scope
           WHERE pot_size IS NOT NULL AND pot_size > 0
             AND rake_amount + bbj > pot_size + 0.001 LIMIT 20) x
  UNION ALL
  SELECT 'I4_eligible_flop_no_drop', count(*)::bigint,
         COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'n', num_players, 'board', board, 'expected', expected)), '[]'::jsonb)
    FROM (SELECT s.hand_id, s.num_players, s.board, d.expected
            FROM scope s
            CROSS JOIN LATERAL (
              SELECT public.fn_effective_bbj_drop(s.big_blind, s.num_players, s.board >= 3, s.club_id,
                                                  s.tid, s.variant, s.small_blind, s.pot_size, s.rake_amount) AS expected
            ) d
           WHERE s.bbj = 0 AND s.board >= 3
             AND d.expected > 0
           LIMIT 20) x
  UNION ALL
  SELECT 'I5_drop_not_banked_to_pool', count(*)::bigint,
         jsonb_build_object('grace_until', v_grace, 'grace_source', 'writer',
                            'owner', 'fn_ca_process_hand_post_commit_obligations',
                            'hands', COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'bbj', bbj)), '[]'::jsonb))
    FROM (SELECT s.hand_id, s.bbj FROM scope s
           WHERE s.bbj > 0 AND s.hand_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM bbj_contributions b
                              WHERE b.hand_id = s.hand_id
                                AND abs(b.amount - s.bbj) <= 0.01)
             -- A DROP WAITING IN hand_bank_obligation_pending IS OWED, NOT
             -- LOST (20261118071728); a row older than the grace is I9.
             AND NOT EXISTS (SELECT 1 FROM hand_bank_obligation_pending bp
                              WHERE bp.hand_id = s.hand_id
                                AND bp.kind = 'bbj_contribution') LIMIT 20) x
  UNION ALL
  SELECT 'I6_ledger_not_reconciled', count(*)::bigint,
         COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'rake', rake_amount, 'alloc', alloc)), '[]'::jsonb)
    FROM (SELECT s.hand_id, s.rake_amount, a.alloc
            FROM scope s
            CROSS JOIN LATERAL (
              SELECT COALESCE(SUM(ra.weighted_rake_credit), 0) AS alloc
                FROM rake_attributions ra WHERE ra.hand_id = s.hand_id
            ) a
           WHERE s.rake_method = 'WEIGHTED_CONTRIBUTED' AND s.rake_amount > 0
             AND s.hand_id IS NOT NULL AND s.player_contributions IS NOT NULL
             AND round(a.alloc, 2) <> round(s.rake_amount, 2) LIMIT 20) x
  UNION ALL
  SELECT 'I7_raked_hand_never_banked', count(*)::bigint,
         jsonb_build_object('grace_until', v_grace, 'grace_source', 'writer',
                            'owner', 'fn_ca_process_hand_post_commit_obligations',
                            'means', 'a raked cash hand older than five minutes with no rake record and no pending post-commit envelope owing it. Nothing durable will bank it, so this is a genuine loss. The accepted-hand door commits the rake obligation with the hand and fn_ca_process_hand_post_commit_obligations banks it in one transaction, so this reads zero unless a writer broke.',
                            'hands', COALESCE(jsonb_agg(jsonb_build_object('hand', id, 'rake', rake_amount)), '[]'::jsonb))
    FROM (SELECT hh.id, hh.rake_amount
            FROM hand_history hh
            JOIN tables t ON t.id = hh.table_id
           WHERE hh.tournament_id IS NULL AND t.tournament_id IS NULL
             AND t.club_id IS NOT NULL AND hh.rake_amount > 0
             AND hh.created_at >= v_since
             AND hh.created_at < v_grace
             AND NOT EXISTS (SELECT 1 FROM rake_records rr WHERE rr.hand_id = hh.id)
             AND NOT EXISTS (SELECT 1 FROM rake_records rr2
                              WHERE rr2.table_id = hh.table_id
                                AND rr2.created_at BETWEEN hh.created_at - interval '2 hours'
                                                       AND hh.created_at + interval '12 hours'
                                AND rr2.metadata->>'hand_number' = hh.hand_number::text)
             -- A DIAMOND CLUB BANKS ITS RAKE IN ca_diamond_rake_accrual, NOT
             -- rake_records (2026-10-08). The post-commit consumer refuses chip
             -- obligations on a diamond hand (diamond_hand_has_chip_obligations),
             -- so such a hand never has a rake_records row. It is banked when its
             -- accrual rows sum to exactly the hand's rake; anything less stays I7.
             AND NOT EXISTS (SELECT 1 FROM clubs dc
                              WHERE dc.id = t.club_id
                                AND dc.asset = 'diamonds'
                                AND (SELECT COALESCE(sum(a.amount), 0)
                                       FROM ca_diamond_rake_accrual a
                                      WHERE a.table_id = hh.table_id
                                        AND a.hand_number = hh.hand_number
                                        AND a.kind = 'rake') = hh.rake_amount)
             AND NOT EXISTS (SELECT 1 FROM hand_atomic_commits c
                              WHERE c.hand_id = hh.id
                                AND c.post_commit_payload IS NOT NULL
                                AND c.post_commit_completed_at IS NULL)
             -- A RAKE WAITING IN cash_rake_pending IS OWED, NOT LOST (20261118):
             -- the completed envelope stored it there and the hand's projection
             -- continuation banks it. A row older than the grace is I9.
             AND NOT EXISTS (SELECT 1 FROM cash_rake_pending rp WHERE rp.hand_id = hh.id)
           LIMIT 20) x
  UNION ALL
  SELECT 'I9_rake_owed_by_a_pending_envelope', count(*)::bigint,
         jsonb_build_object('grace_until', v_grace,
                            'owner', 'fn_ca_process_hand_post_commit_obligations',
                            'means', 'an accepted hand whose post-commit envelope still owes its rake or BBJ drop more than five minutes after the hand committed. Late, not lost: the envelope is the record, and only fn_ca_process_hand_post_commit_obligations may bank it, with the contributions that attribute it. Nothing else banks it, so a hand stays here until the engine or its successor drains the envelope.',
                            'hands', COALESCE(jsonb_agg(jsonb_build_object('hand', hand_id, 'table', table_id,
                                               'hand_number', hand_number, 'committed_at', committed_at)), '[]'::jsonb))
    FROM (SELECT c.hand_id, c.table_id, c.hand_number, c.committed_at
            FROM hand_atomic_commits c
           WHERE c.post_commit_payload IS NOT NULL
             AND c.post_commit_completed_at IS NULL
             AND c.committed_at < v_grace
             AND (jsonb_typeof(c.post_commit_payload->'rake') = 'object'
                  OR jsonb_typeof(c.post_commit_payload->'bbj_contribution') = 'object')
          UNION ALL
          -- 20261118: a completed envelope's rake still waiting to be banked.
          SELECT rp.hand_id, rp.table_id, rp.hand_number, rp.created_at
            FROM cash_rake_pending rp
           WHERE rp.created_at < v_grace
          UNION ALL
          -- 20261118071728: a completed envelope's BBJ drop or insurance leg
          -- still waiting to be banked.
          -- One line per hand: a hand already listed above for its rake is not
          -- counted again.
          SELECT bp.hand_id, bp.table_id, bp.hand_number, min(bp.created_at)
            FROM hand_bank_obligation_pending bp
           WHERE bp.created_at < v_grace
             AND NOT EXISTS (SELECT 1 FROM cash_rake_pending rp
                              WHERE rp.hand_id = bp.hand_id AND rp.created_at < v_grace)
           GROUP BY 1, 2, 3
           ORDER BY 4
           LIMIT 20) x
  UNION ALL
  /* I8: HOW LATE THE LIVE PATH BANKED. A measurement beside the two alarms:
     I7 says a raked hand is owed by nothing, I9 says an envelope still owes
     it, and I8 counts the hands whose rake landed more than five minutes after
     the hand. It carries violations 0 on purpose: lateness that has already
     resolved is read, not paged on. */
  SELECT 'I8_rake_banked_late', 0::bigint,
         jsonb_build_object(
           'hands', (SELECT count(*) FROM scope s
                      WHERE s.hand_at IS NOT NULL
                        AND s.created_at - s.hand_at > interval '5 minutes'),
           'chips', (SELECT COALESCE(round(sum(s.rake_amount), 2), 0) FROM scope s
                      WHERE s.hand_at IS NOT NULL
                        AND s.created_at - s.hand_at > interval '5 minutes'),
           'window_hours', p_hours,
           'means', 'rake banked more than five minutes after its hand was recorded: an envelope that completed late. Counted here, never raised.',
           'raises', 'never - this is a measurement, not an alarm. I7 and I9 are the alarms.');
END $function$;

REVOKE ALL ON FUNCTION public.fn_rake_bbj_invariants(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rake_bbj_invariants(integer) TO service_role;

-- ── 8. Job 123: fn_union_integrity_sweep(uuid,integer) ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_union_integrity_sweep(p_union_id uuid DEFAULT 'fade0000-0000-0000-0000-000000000001'::uuid, p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := now() - make_interval(hours => GREATEST(p_hours,1));
  v_scope_clubs uuid[];
  v_agent_flags jsonb := '[]'::jsonb;
  v_dump_flags jsonb := '[]'::jsonb;
  v_coseat_flags jsonb := '[]'::jsonb;
  v_total int := 0;
BEGIN
  IF p_union_id IS NULL THEN
    RAISE EXCEPTION 'union identity is required' USING ERRCODE='22004';
  END IF;
  IF NOT public.fn_caller_is_engine() AND (auth.uid() IS NULL OR ( NOT public.fn_is_union_overseer(p_union_id, auth.uid()))) THEN RAISE EXCEPTION 'not_authorised'; END IF;

  SELECT COALESCE(array_agg(sc.club_id), '{}'::uuid[]) INTO v_scope_clubs
    FROM (
      SELECT uc.club_id FROM public.union_clubs uc WHERE uc.union_id = p_union_id
      UNION
      SELECT c.id FROM public.clubs c WHERE c.id = p_union_id AND c.is_union IS TRUE
    ) sc;

  WITH scope_clubs AS MATERIALIZED (
    SELECT unnest(v_scope_clubs) AS club_id
  ),
  roster AS (
    SELECT DISTINCT m.agent_id, m.user_id AS player_id
      FROM public.club_members m
      JOIN scope_clubs sc ON sc.club_id=m.club_id
     WHERE m.agent_id IS NOT NULL
       -- AN AGENT ROSTER COUNTS NO HORSE (2026-10-09), as the co-seating
       -- signal below already reads it.
       AND NOT EXISTS (SELECT 1 FROM public.profiles hp
                        WHERE hp.id = m.user_id AND COALESCE(hp.is_horse, false))
  ),
  /* A SESSION IS COUNTED WHOLE (2026-11-12). The net used to read each
     wallet row by its own created_at, so a cash session or tournament that
     began just before the window brought its cashout or prize in without the
     buy-in that paid for it (row 377222: a 136.08 prize counted against no
     40.00 buy-in, 17 minutes outside the window). Rows of the previous 24
     hours are read as well, and a pre-window DEBIT counts only when the same
     player has a CREDIT in the window on the same table (cash) or tournament,
     and for cash only when no cashout at that table closed it before the
     window. Nothing else from before the window is counted. */
  scoped AS MATERIALIZED (
    SELECT r.agent_id, r.player_id, wt.type, wt.category, wt.amount, wt.created_at,
           wt.table_id, wt.related_entity_id
      FROM roster r
      JOIN wallet_transactions wt ON wt.user_id = r.player_id
                                 AND wt.created_at >= v_from - interval '24 hours'
     WHERE EXISTS (
       SELECT 1 FROM public.tables t WHERE t.id=wt.table_id
         AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))
        OR (wt.table_id IS NULL AND EXISTS (
          SELECT 1 FROM public.tournaments t WHERE t.id=wt.related_entity_id
            AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs)))))
  ),
  net AS (
    SELECT s.agent_id,
           SUM(CASE WHEN s.type='credit' AND s.category IN ('cashout','prize','bounty') THEN s.amount ELSE 0 END)
         - SUM(CASE WHEN s.type='debit'  AND s.category IN ('buyin','rebuy','addon','tournament_buyin') THEN s.amount ELSE 0 END) AS player_net,
           COUNT(DISTINCT s.player_id) AS players
      FROM scoped s
     WHERE s.created_at >= v_from
        OR (s.type = 'debit'
            AND EXISTS (SELECT 1 FROM scoped w
                         WHERE w.player_id = s.player_id AND w.type = 'credit'
                           AND w.created_at >= v_from
                           AND w.table_id IS NOT DISTINCT FROM s.table_id
                           AND (s.table_id IS NOT NULL OR w.related_entity_id = s.related_entity_id))
            AND (s.table_id IS NULL OR NOT EXISTS (
                  SELECT 1 FROM scoped c
                   WHERE c.player_id = s.player_id AND c.table_id = s.table_id
                     AND c.type = 'credit' AND c.category = 'cashout'
                     AND c.created_at > s.created_at AND c.created_at < v_from)))
     GROUP BY s.agent_id
  ),
  rake AS (
    SELECT r.agent_id,
           SUM(rr.rake_amount * (e.value::numeric) / NULLIF(c.total,0)) AS rake
      FROM rake_records rr
      CROSS JOIN LATERAL (SELECT SUM(t.value::numeric) AS total
                            FROM jsonb_each_text(rr.player_contributions) t(key,value)) c
      CROSS JOIN LATERAL jsonb_each_text(rr.player_contributions) e(key,value)
      JOIN roster r ON r.player_id = (e.key)::uuid
     WHERE rr.created_at >= v_from AND rr.player_contributions IS NOT NULL AND c.total > 0
       AND (
         EXISTS (SELECT 1 FROM public.tables t WHERE t.id=rr.table_id
           AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))
         OR (rr.table_id IS NULL AND EXISTS (
           SELECT 1 FROM public.tournaments t WHERE t.id=rr.tournament_id
             AND (t.union_id=p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs)))))
         OR (rr.table_id IS NULL AND rr.tournament_id IS NULL
           AND rr.club_id IN (SELECT club_id FROM scope_clubs))
       )
     GROUP BY r.agent_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_user_id', f.agent_id, 'players', f.players,
           'player_net', round(f.player_net,2), 'rake_generated', round(COALESCE(f.rake,0),2),
           'win_to_rake_ratio', round(f.player_net / NULLIF(COALESCE(f.rake,0),0), 2))), '[]'::jsonb)
    INTO v_agent_flags
    FROM (SELECT n.agent_id, n.players, n.player_net, k.rake
            FROM net n LEFT JOIN rake k ON k.agent_id = n.agent_id
           WHERE n.player_net > 0
             AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)
          OFFSET 0) f
   -- A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000), measured only
   -- for an agent whose 24 h edge already holds (20261119121500): the fence
   -- keeps the planner from pushing the 7-day measure down onto every agent
   -- with a positive net before the rake join.
   WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, f.agent_id, 7);

  -- Constraining ct.club_id = ANY (v_scope_clubs) lets PostgreSQL seek
  -- idx_chip_tx_club_created (club_id, created_at DESC) per union club
  -- instead of scanning the entire chip_transactions index.
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_dump_flags FROM (
    SELECT jsonb_build_object(
             'from_user', ct.from_user_id, 'to_user', ct.to_user_id,
             'transfers', count(*), 'total', round(sum(ct.amount),2)) AS x
      FROM chip_transactions ct
     WHERE ct.club_id = ANY (v_scope_clubs)
       AND ct.created_at >= v_from
       AND ct.from_user_id IS NOT NULL
       AND ct.to_user_id IS NOT NULL
       AND public.fn_union_transfer_counts_as_dump(ct)
     GROUP BY ct.from_user_id, ct.to_user_id
    HAVING sum(ct.amount) > 0
  ) s;

  -- Co-seating, excluding horse-vs-horse (simulated players always co-seat).
  /* EVERY PAIR THIS COUNTS HAS A PLAYER WHO IS NOT A HORSE (2026-10-22), so
     the pairs are found from those players' seats, read through
     idx_table_seats_joined_at_cover / idx_table_seats_user, and their
     tablemates through idx_table_seats_table. Same pairs, same counts, same
     order and limit. */
  SELECT COALESCE(jsonb_agg(y), '[]'::jsonb) INTO v_coseat_flags FROM (
    SELECT jsonb_build_object('player_a', pr.a, 'player_b', pr.b,
                              'shared_tables', count(DISTINCT pr.table_id)) AS y
      FROM (SELECT LEAST(h.user_id, o.user_id) AS a, GREATEST(h.user_id, o.user_id) AS b,
                   h.table_id
              FROM profiles hp
              CROSS JOIN LATERAL (
                SELECT ts.user_id, ts.table_id
                  FROM table_seats ts
                 WHERE ts.user_id = hp.id AND ts.joined_at >= v_from) h
              JOIN tables t ON t.id = h.table_id AND t.union_id = p_union_id
              JOIN table_seats o ON o.table_id = h.table_id AND o.user_id <> h.user_id
                                AND o.joined_at >= v_from
             WHERE NOT COALESCE(hp.is_horse, false)) pr
     GROUP BY pr.a, pr.b
    HAVING count(DISTINCT pr.table_id) >= 8
     ORDER BY count(DISTINCT pr.table_id) DESC
     LIMIT 20
  ) s2;

  v_total := jsonb_array_length(v_agent_flags)
           + jsonb_array_length(v_dump_flags)
           + jsonb_array_length(v_coseat_flags);

  IF v_total > 0 THEN
    -- Each union owns its incident window; serialize concurrent reporters.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'union_integrity_alert:' || p_union_id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM financial_alerts
                     WHERE source = 'fn_union_integrity_sweep'
                       AND context->>'union_id'=p_union_id::text
                       AND created_at > now() - interval '20 hours') THEN
    INSERT INTO financial_alerts (severity, source, message, context)
    VALUES ('warning', 'fn_union_integrity_sweep',
            'Union integrity sweep raised ' || v_total || ' signal(s) - review by agent',
            jsonb_build_object('union_id', p_union_id, 'window_hours', p_hours,
                               'agent_roster_winning', v_agent_flags,
                               'direct_chip_transfer', v_dump_flags,
                               'co_seating', v_coseat_flags));
    END IF;
  END IF;

  /* A MISFIRE CLOSES ON A RE-MEASUREMENT (20261118165323). An open sweep alert of
     this union whose only signals are direct chip transfers closes once its own
     window, read again through fn_union_transfer_counts_as_dump, holds no dump:
     every transfer it named was the sender's own cashout through the club's
     cashier or the agent credit route. An alert that also names a winning agent roster or a
     co-seating pair stays open: those are review items for a person. */
  UPDATE financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = 'verified: re-measured over its own window; none of its direct chip transfers is a player-to-player dump (each was the sender''s own cashout through the club cashier or the agent credit route)'
   WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved
     AND a.context->>'union_id' = p_union_id::text
     AND jsonb_array_length(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) = 0
     AND jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0
     AND NOT EXISTS (
       SELECT 1 FROM chip_transactions ct
        WHERE ct.club_id = ANY (v_scope_clubs)
          AND ct.created_at >= a.created_at - make_interval(hours => GREATEST(COALESCE((a.context->>'window_hours')::int, 24), 1))
          AND ct.created_at <= a.created_at
          AND ct.from_user_id IS NOT NULL
          AND ct.to_user_id IS NOT NULL
          AND public.fn_union_transfer_counts_as_dump(ct));

  /* A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000). An open alert
     closes on a re-measurement when it names no co-seating pair, none of its
     direct transfers is a dump, and no roster it names has a sustained 7-day
     edge now. Co-seating stays a review item for a person. */
  UPDATE financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = 'verified: re-measured; no agent roster it names holds a sustained 7-day edge (net > 10x rake), and none of its direct chip transfers is a player-to-player dump'
   WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved
     AND a.context->>'union_id' = p_union_id::text
     AND jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) e
        WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, (e->>'agent_user_id')::uuid, 7))
     AND NOT EXISTS (
       SELECT 1 FROM chip_transactions ct
        WHERE ct.club_id = ANY (v_scope_clubs)
          AND ct.created_at >= a.created_at - make_interval(hours => GREATEST(COALESCE((a.context->>'window_hours')::int, 24), 1))
          AND ct.created_at <= a.created_at
          AND ct.from_user_id IS NOT NULL
          AND ct.to_user_id IS NOT NULL
          AND public.fn_union_transfer_counts_as_dump(ct));

  RETURN jsonb_build_object(
    'union_id', p_union_id, 'window_hours', p_hours, 'signals', v_total,
    'agent_roster_winning', v_agent_flags,
    'direct_chip_transfer', v_dump_flags,
    'co_seating', v_coseat_flags);
END $function$;

REVOKE ALL ON FUNCTION public.fn_union_integrity_sweep(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_union_integrity_sweep(uuid, integer) TO authenticated, service_role;

-- ── 9. Job 214: fn_ca_completed_without_a_champion() ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_completed_without_a_champion()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Merge Anti Join of two compact partial indexes (idx_tournaments_completed_id
  -- vs idx_tournament_players_winner_tid) emits only COMPLETED tournaments that
  -- lack a winner; only those rare rows probe tournament_players for entrants.
  WITH no_win AS MATERIALIZED (
    SELECT t.id
      FROM public.tournaments t
     WHERE t.status = 'COMPLETED'
       AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                        WHERE tp.tournament_id = t.id AND tp.status = 'winner')
  )
  SELECT count(*)::int
    FROM no_win nw
   WHERE EXISTS (SELECT 1 FROM public.tournament_players tp
                  WHERE tp.tournament_id = nw.id);
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_completed_without_a_champion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_completed_without_a_champion() TO service_role;

-- ── 10. Job 214: fn_ca_undeclared_money_paths() ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_undeclared_money_paths()
 RETURNS TABLE(proname text, tbl text, col text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH watched AS MATERIALIZED (
    SELECT DISTINCT
           c.relname::text AS tbl,
           lower(c.relname::text) AS tbl_l,
           m[1] AS col,
           lower(m[1]) AS col_l
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc  p ON p.oid = t.tgfoid
      CROSS JOIN LATERAL regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+)=([a-z_]+)''', 'g') m
     -- IN (...), not '=': a migration that reads pg_get_functiondef and holds
     -- an EXECUTE must not read as redefining the journal trigger it names
     -- (tests/a-declared-guard-change-is-recorded-not-raised.law.test.ts).
     WHERE NOT t.tgisinternal AND p.proname IN ('fn_ca_autoledger')
  ), sys_fns AS MATERIALIZED (
    SELECT array_agg(g.proname) AS names
      FROM public.ca_money_rpc_registry g
     WHERE g.status = 'system'
  ), fns AS MATERIALIZED (
    -- De-TOAST prosrc once per candidate function and discard functions that
    -- already declare their counterparty, are audited system functions, or
    -- contain no UPDATE keyword before joining against watched (tbl, col).
    SELECT p.proname::text AS proname,
           s.prosrc,
           s.src_l,
           (s.prosrc ~* 'INSERT\s+INTO\s+(public\.)?chip_ledger\y') AS writes_own_leg
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL (SELECT (p.prosrc || '') AS prosrc, lower(p.prosrc) AS src_l) s
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname NOT IN ('fn_ca_autoledger', 'fn_ca_autoledger_delete',
                             'fn_ca_declare_ledger', 'fn_ca_undeclared_money_paths')
       AND NOT (p.proname::text = ANY (COALESCE((SELECT names FROM sys_fns), '{}'::text[])))
       AND position('update' in s.src_l) > 0
       AND position('fn_ca_declare_ledger' in s.src_l) = 0
       AND position('app.ledger_counterparty' in s.src_l) = 0
  )
  SELECT DISTINCT f.proname, w.tbl, w.col
    FROM fns f
    JOIN watched w
      -- Fast exact substring gate before statement-scoped regex assignment check
      ON position(w.tbl_l in f.src_l) > 0
     AND position(w.col_l in f.src_l) > 0
     AND f.prosrc ~* ('UPDATE\s+(public\.)?' || w.tbl || '\y[^;]*?\ySET\y[^;]*?\y' || w.col || '\s*=')
   WHERE NOT (f.writes_own_leg AND f.prosrc ~* ('ledger_autoskip_' || w.tbl || '\y'))
   ORDER BY 1, 2, 3
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_undeclared_money_paths() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_undeclared_money_paths() TO service_role;

-- ── 11. Job 233: fn_ca_ledger_audit_checkpoint_advance() ────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_ledger_audit_checkpoint_advance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_horizon timestamptz; v_from timestamptz; v_through timestamptz;
  v_n bigint; v_to numeric; v_out numeric;
  v_promo_through timestamptz;
  v_p_contrib numeric; v_p_pre numeric; v_p_rated_amt numeric; v_p_rated_promo numeric; v_p_rows bigint;
  v_report jsonb := '{}'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca_ledger_audit_checkpoint_advance', 0)) THEN
    RETURN jsonb_build_object('skipped', 'another advance holds the lock');
  END IF;

  -- THE HORIZON. A leg is written with created_at = its transaction's start
  -- and the journal is append-only, so once every transaction that began
  -- before an instant has ended, no leg older than it can still appear. Six
  -- hours back, and a minute before the oldest transaction still open.
  SELECT LEAST(now() - interval '6 hours', COALESCE(min(a.xact_start), now()) - interval '1 minute')
    INTO v_horizon
    FROM pg_stat_activity a WHERE a.xact_start IS NOT NULL;

  -- 1. Member nets since the chip baseline (fn_chip_drift_since_baseline).
  SELECT min(b.taken_at) INTO v_from FROM public.ca_chip_baseline b;
  IF v_from IS NOT NULL THEN
    SELECT m.through_at INTO v_through FROM public.ca_ledger_audit_marks m
     WHERE m.metric = 'chip_drift' AND m.from_at = v_from FOR UPDATE;
    IF NOT FOUND THEN
      DELETE FROM public.ca_ledger_audit_member_net WHERE true;  -- a reset: the baseline moved, every remembered net is void
      INSERT INTO public.ca_ledger_audit_marks AS m (metric, from_at, through_at, legs, advanced_at)
      VALUES ('chip_drift', v_from, v_from, 0, now())
      ON CONFLICT (metric) DO UPDATE
        SET from_at = EXCLUDED.from_at, through_at = EXCLUDED.through_at,
            to_total = 0, from_total = 0, legs = 0, advanced_at = now();
      v_through := v_from;
    END IF;
    IF v_horizon > v_through THEN
      WITH sides AS (
        SELECT cl.club_id AS c_id, cl.to_entity_id AS u_id, cl.amount AS amt
          FROM public.chip_ledger cl
         WHERE cl.club_id IS NOT NULL AND cl.to_type = 'player_wallet'
           AND cl.created_at >= v_through AND cl.created_at < v_horizon
        UNION ALL
        SELECT cl.club_id, cl.from_entity_id, -cl.amount
          FROM public.chip_ledger cl
         WHERE cl.club_id IS NOT NULL AND cl.from_type = 'player_wallet'
           AND cl.created_at >= v_through AND cl.created_at < v_horizon
      ), d AS (
        SELECT s.c_id, s.u_id, sum(s.amt) AS net, count(*) AS n
          FROM sides s WHERE s.u_id IS NOT NULL GROUP BY 1, 2
      ), up AS (
        INSERT INTO public.ca_ledger_audit_member_net AS t (club_id, user_id, net)
        SELECT d.c_id, d.u_id, d.net FROM d
        ON CONFLICT (club_id, user_id) DO UPDATE SET net = t.net + EXCLUDED.net
        RETURNING 1
      )
      SELECT COALESCE((SELECT sum(d.n) FROM d), 0) INTO v_n;
      UPDATE public.ca_ledger_audit_marks
         SET through_at = v_horizon, legs = legs + v_n, advanced_at = now()
       WHERE metric = 'chip_drift';
      v_report := v_report || jsonb_build_object('chip_drift', jsonb_build_object('through', v_horizon, 'legs', v_n));
    END IF;
  END IF;

  -- 2. BBJ legs since the epoch (fn_bbj_conservation_check).
  SELECT min(s.taken_at) INTO v_from FROM public.ca_bbj_pool_snapshots s WHERE s.is_baseline;
  IF v_from IS NOT NULL THEN
    SELECT m.through_at INTO v_through FROM public.ca_ledger_audit_marks m
     WHERE m.metric = 'bbj_epoch' AND m.from_at = v_from FOR UPDATE;
    IF NOT FOUND THEN
      DELETE FROM public.ca_ledger_audit_bbj_pool WHERE true;  -- a reset: the epoch moved, every remembered pool total is void
      INSERT INTO public.ca_ledger_audit_marks AS m (metric, from_at, through_at, legs, advanced_at)
      VALUES ('bbj_epoch', v_from, v_from, 0, now())
      ON CONFLICT (metric) DO UPDATE
        SET from_at = EXCLUDED.from_at, through_at = EXCLUDED.through_at,
            to_total = 0, from_total = 0, legs = 0, advanced_at = now();
      v_through := v_from;
    END IF;
    IF v_horizon > v_through THEN
      -- Every pool, both directions (the epoch identity).
      SELECT COALESCE(sum(CASE WHEN l.to_type = 'bbj_pool' THEN l.amount ELSE 0 END), 0),
             COALESCE(sum(CASE WHEN l.from_type = 'bbj_pool' THEN l.amount ELSE 0 END), 0),
             count(*)
        INTO v_to, v_out, v_n
        FROM public.chip_ledger l
       WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
         AND l.created_at > v_from AND l.created_at >= v_through AND l.created_at < v_horizon;

      -- Set-based advance across all kept late pools in ONE range scan of
      -- chip_ledger over [v_through, v_horizon); only newly-added unkept pools
      -- (0-2/hr) probe their full (v_from, v_horizon) range.
      WITH late AS MATERIALIZED (
        SELECT p.id AS pool_id, (x.pool_id IS NOT NULL) AS kept, b.opened_at,
               x.absorbed AS kept_absorbed, x.absorbed_to AS kept_absorbed_to
          FROM public.bbj_pools p
          LEFT JOIN (SELECT s.pool_id, min(s.taken_at) AS opened_at
                       FROM public.ca_bbj_pool_snapshots s
                      WHERE s.is_baseline
                      GROUP BY s.pool_id) b ON b.pool_id = p.id
          LEFT JOIN public.ca_ledger_audit_bbj_pool x ON x.pool_id = p.id
         WHERE COALESCE(b.opened_at, p.created_at) > v_from OR x.pool_id IS NOT NULL
      ), slice_legs AS MATERIALIZED (
        SELECT l.to_entity_id, l.from_entity_id, l.to_type, l.from_type, l.category, l.amount
          FROM public.chip_ledger l
         WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
           AND l.created_at > v_from AND l.created_at >= v_through AND l.created_at < v_horizon
      ), slice_seeded AS MATERIALIZED (
        SELECT sl.to_entity_id AS pool_id, sum(sl.amount) AS amt
          FROM slice_legs sl
         WHERE sl.to_type = 'bbj_pool' AND sl.category <> 'bbj_contribution'
         GROUP BY sl.to_entity_id
      ), slice_burned AS MATERIALIZED (
        SELECT sl.from_entity_id AS pool_id, sum(sl.amount) AS amt
          FROM slice_legs sl
         WHERE sl.from_type = 'bbj_pool' AND sl.category NOT IN ('bbj_payout', 'promo')
         GROUP BY sl.from_entity_id
      ), sums AS (
        SELECT o.pool_id,
               CASE WHEN o.kept THEN COALESCE(ss.amt, 0)
                    ELSE COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                                    WHERE l.to_entity_id = o.pool_id AND l.to_type = 'bbj_pool'
                                      AND l.category <> 'bbj_contribution'
                                      AND l.created_at > v_from
                                      AND l.created_at < v_horizon), 0) END AS seeded,
               CASE WHEN o.kept THEN COALESCE(sb.amt, 0)
                    ELSE COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                                    WHERE l.from_entity_id = o.pool_id AND l.from_type = 'bbj_pool'
                                      AND l.category NOT IN ('bbj_payout', 'promo')
                                      AND l.created_at > v_from
                                      AND l.created_at < v_horizon), 0) END AS burned,
               CASE WHEN o.opened_at IS NULL OR o.opened_at >= v_horizon THEN NULL
                    WHEN o.kept_absorbed_to IS NOT DISTINCT FROM o.opened_at THEN o.kept_absorbed
                    ELSE COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                                    WHERE l.to_entity_id = o.pool_id AND l.to_type = 'bbj_pool'
                                      AND l.created_at > v_from AND l.created_at <= o.opened_at), 0)
                       - COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                                    WHERE l.from_entity_id = o.pool_id AND l.from_type = 'bbj_pool'
                                      AND l.created_at > v_from AND l.created_at <= o.opened_at), 0) END AS absorbed,
               CASE WHEN o.opened_at IS NULL OR o.opened_at >= v_horizon THEN NULL ELSE o.opened_at END AS absorbed_to
          FROM late o
          LEFT JOIN slice_seeded ss ON ss.pool_id = o.pool_id
          LEFT JOIN slice_burned sb ON sb.pool_id = o.pool_id
      )
      INSERT INTO public.ca_ledger_audit_bbj_pool AS t (pool_id, seeded, burned, absorbed, absorbed_to)
      SELECT s.pool_id, s.seeded, s.burned, s.absorbed, s.absorbed_to FROM sums s
      ON CONFLICT (pool_id) DO UPDATE
        SET seeded = t.seeded + EXCLUDED.seeded, burned = t.burned + EXCLUDED.burned,
            absorbed = EXCLUDED.absorbed, absorbed_to = EXCLUDED.absorbed_to;

      UPDATE public.ca_ledger_audit_marks
         SET through_at = v_horizon, to_total = to_total + v_to, from_total = from_total + v_out,
             legs = legs + v_n, advanced_at = now()
       WHERE metric = 'bbj_epoch';
      v_report := v_report || jsonb_build_object('bbj_epoch', jsonb_build_object('through', v_horizon, 'legs', v_n));
    END IF;
  END IF;

  -- 3. Append-only bbj_contributions promo totals (fn_bbj_promo_bank_check).
  SELECT m.through_at INTO v_promo_through
    FROM public.ca_bbj_promo_audit_mark m
   WHERE m.id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    v_promo_through := '-infinity'::timestamptz;
    INSERT INTO public.ca_bbj_promo_audit_mark (id, through_at, contributed, pre_triple_bank, rated_amount, rated_promo, rows_counted, advanced_at)
    VALUES (1, '-infinity'::timestamptz, 0, 0, 0, 0, 0, now())
    ON CONFLICT (id) DO NOTHING;
  END IF;
  IF v_horizon > v_promo_through THEN
    SELECT COALESCE(sum(promo_portion), 0),
           COALESCE(sum(amount) FILTER (WHERE main_portion IS NULL AND backup_portion IS NULL AND promo_portion IS NULL), 0),
           COALESCE(sum(amount) FILTER (WHERE promo_portion IS NOT NULL), 0),
           COALESCE(sum(promo_portion) FILTER (WHERE promo_portion IS NOT NULL), 0),
           count(*)
      INTO v_p_contrib, v_p_pre, v_p_rated_amt, v_p_rated_promo, v_p_rows
      FROM public.bbj_contributions
     WHERE created_at >= v_promo_through AND created_at < v_horizon;

    UPDATE public.ca_bbj_promo_audit_mark
       SET through_at = v_horizon,
           contributed = contributed + v_p_contrib,
           pre_triple_bank = pre_triple_bank + v_p_pre,
           rated_amount = rated_amount + v_p_rated_amt,
           rated_promo = rated_promo + v_p_rated_promo,
           rows_counted = rows_counted + v_p_rows,
           advanced_at = now()
     WHERE id = 1;
    v_report := v_report || jsonb_build_object('bbj_promo', jsonb_build_object('through', v_horizon, 'rows', v_p_rows));
  END IF;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_ledger_audit_checkpoint_advance() FROM PUBLIC, anon, authenticated, service_role;

-- ── 12. Job 233: fn_bbj_conservation_check() ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bbj_conservation_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_in numeric; v_out numeric; v_bal numeric; v_gap numeric; v_base record;
  v_epoch_at timestamptz; v_epoch_unexp numeric; v_epoch_runs int;
  v_counters_paid numeric; v_payout_rows numeric; v_pre_table numeric;
  v_unrecorded_since numeric; v_seeds_live numeric;
  v_seeds numeric; v_drift numeric; v_unexplained numeric; v_tol numeric;
  v_absorbed numeric := 0; v_late_seeds numeric := 0; v_late_burns numeric := 0;
  v_cp_through timestamptz; v_cp_to numeric := 0; v_cp_from numeric := 0;
BEGIN
  v_in := fn_bbj_contributions_total();
  v_in := v_in + (SELECT COALESCE(SUM(amount),0) FROM union_wallet_transactions WHERE tx_type='bbj_fund');

  v_out := (SELECT COALESCE(SUM(total_amount),0) FROM bbj_payouts)
         + (SELECT COALESCE(SUM(amount),0) FROM union_wallet_transactions WHERE tx_type='bbj_promo_sweep')
         + (SELECT COALESCE(SUM(amount),0) FROM chip_transactions WHERE transaction_type='bbj_promo_sweep')
         + (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions
             WHERE category='promotion' AND description='BBJ promo pool payout');

  /* A POOL OPENED AFTER THE EPOCH IS MEASURED FROM ITS OWN OPENING
     (2026-10-02, incident f3e82f59). Set-based tail scan over chip_ledger
     replaces 3,855 x 2 per-pool correlated subqueries for kept pools while
     preserving exact full-range reads for unkept pools and unkept openings. */
  SELECT min(taken_at) INTO v_epoch_at FROM public.ca_bbj_pool_snapshots WHERE is_baseline;
  SELECT m.through_at, m.to_total, m.from_total INTO v_cp_through, v_cp_to, v_cp_from
    FROM public.ca_ledger_audit_marks m
   WHERE m.metric = 'bbj_epoch' AND m.from_at = v_epoch_at;
  IF NOT FOUND THEN v_cp_through := NULL; v_cp_to := 0; v_cp_from := 0; END IF;

  WITH late_pools AS MATERIALIZED (
    SELECT p.id AS pool_id, b.opened_at,
           (k.pool_id IS NOT NULL) AS is_kept,
           k.seeded AS kept_seeded, k.burned AS kept_burned,
           k.absorbed AS kept_absorbed, k.absorbed_to AS kept_absorbed_to
      FROM public.bbj_pools p
      LEFT JOIN (SELECT s.pool_id, min(s.taken_at) AS opened_at
                   FROM public.ca_bbj_pool_snapshots s
                  WHERE s.is_baseline
                  GROUP BY s.pool_id) b ON b.pool_id = p.id
      LEFT JOIN public.ca_ledger_audit_bbj_pool k ON k.pool_id = p.id AND v_cp_through IS NOT NULL
     WHERE COALESCE(b.opened_at, p.created_at) > v_epoch_at
  ), tail_raw AS MATERIALIZED (
    SELECT l.to_entity_id, l.from_entity_id, l.to_type, l.from_type, l.category, l.amount
      FROM public.chip_ledger l
     WHERE v_cp_through IS NOT NULL
       AND (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
       AND l.created_at > v_epoch_at
       AND l.created_at >= v_cp_through
  ), tail_by_pool AS MATERIALIZED (
    SELECT pool_id, sum(seeded) AS seeded, sum(burned) AS burned
      FROM (
        SELECT tr.to_entity_id AS pool_id, tr.amount AS seeded, 0::numeric AS burned
          FROM tail_raw tr
         WHERE tr.to_type = 'bbj_pool' AND tr.category <> 'bbj_contribution'
        UNION ALL
        SELECT tr.from_entity_id AS pool_id, 0::numeric AS seeded, tr.amount AS burned
          FROM tail_raw tr
         WHERE tr.from_type = 'bbj_pool' AND tr.category NOT IN ('bbj_payout', 'promo')
      ) s
     GROUP BY pool_id
  )
  SELECT COALESCE(sum(x.absorbed), 0), COALESCE(sum(x.seeded), 0), COALESCE(sum(x.burned), 0)
    INTO v_absorbed, v_late_seeds, v_late_burns
    FROM late_pools o
    LEFT JOIN tail_by_pool tp ON tp.pool_id = o.pool_id
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN o.opened_at IS NULL THEN 0
             WHEN o.kept_absorbed_to = o.opened_at THEN o.kept_absorbed ELSE
          COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                     WHERE l.to_entity_id = o.pool_id AND l.to_type = 'bbj_pool'
                       AND l.created_at > v_epoch_at AND l.created_at <= o.opened_at), 0)
        - COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                     WHERE l.from_entity_id = o.pool_id AND l.from_type = 'bbj_pool'
                       AND l.created_at > v_epoch_at AND l.created_at <= o.opened_at), 0) END AS absorbed,
        CASE WHEN o.is_kept THEN COALESCE(o.kept_seeded, 0) + COALESCE(tp.seeded, 0)
             ELSE COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                             WHERE l.to_entity_id = o.pool_id AND l.to_type = 'bbj_pool'
                               AND l.category <> 'bbj_contribution'
                               AND l.created_at > v_epoch_at), 0) END AS seeded,
        CASE WHEN o.is_kept THEN COALESCE(o.kept_burned, 0) + COALESCE(tp.burned, 0)
             ELSE COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
                             WHERE l.from_entity_id = o.pool_id AND l.from_type = 'bbj_pool'
                               AND l.category NOT IN ('bbj_payout', 'promo')
                               AND l.created_at > v_epoch_at), 0) END AS burned
    ) x;
  v_in := v_in + v_late_seeds;
  v_out := v_out + v_late_burns;

  SELECT COALESCE(SUM(main_balance+backup_balance+promo_balance),0) INTO v_bal FROM bbj_pools;

  v_gap := round(v_in - v_out - v_bal, 2);
  SELECT * INTO v_base FROM bbj_conservation_baseline WHERE id = 1;
  v_tol := COALESCE(v_base.tolerance, 1.00);
  v_drift := round(v_gap - COALESCE(v_base.baseline_gap, 0), 2);

  -- THE EPOCH (Phase 4.2): since the opening balances, the journal identity per
  -- pool per bank. This is what `healthy` means; the lifetime figures stay.
  SELECT min(taken_at) INTO v_epoch_at FROM public.ca_bbj_pool_snapshots WHERE is_baseline;
  SELECT count(*) INTO v_epoch_runs FROM public.ca_bbj_pool_snapshots WHERE NOT is_baseline;
  SELECT round(
           (SELECT COALESCE(sum(main_balance + backup_balance + promo_balance), 0) FROM public.bbj_pools)
         - (SELECT COALESCE(sum(b.main + b.backup + b.promo), 0)
              FROM public.ca_bbj_pool_snapshots b WHERE b.is_baseline)
         - ((v_cp_to - v_cp_from)
            + (SELECT COALESCE(sum(CASE WHEN l.to_type = 'bbj_pool' THEN l.amount ELSE 0 END), 0)
                    - COALESCE(sum(CASE WHEN l.from_type = 'bbj_pool' THEN l.amount ELSE 0 END), 0)
                 FROM public.chip_ledger l
                WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
                  AND l.created_at > v_epoch_at
                  AND l.created_at >= COALESCE(v_cp_through, '-infinity'::timestamptz))), 2)
    INTO v_epoch_unexp;
  v_epoch_unexp := round(v_epoch_unexp + v_absorbed, 2);

  SELECT COALESCE(sum(total_paid_out),0) INTO v_counters_paid
    FROM bbj_pools WHERE merged_into_pool_id IS NULL;
  SELECT COALESCE(sum(total_amount),0) INTO v_payout_rows FROM bbj_payouts;
  v_pre_table := round(v_counters_paid - v_payout_rows, 2);
  v_unrecorded_since := round(v_pre_table - COALESCE(v_base.pre_ledger_payouts, 0), 2);
  v_seeds := COALESCE(v_base.opening_seeds, 0);
  SELECT COALESCE(sum(pool_amount),0) INTO v_seeds_live FROM bbj_pools;
  v_unexplained := round(v_drift - v_pre_table + v_seeds, 2);

  RETURN jsonb_build_object(
    'inflow', round(v_in,2), 'outflow', round(v_out,2), 'balances', round(v_bal,2),
    'gap', v_gap,
    'baseline_gap', COALESCE(v_base.baseline_gap, 0),
    'drift_from_baseline', round(COALESCE(v_epoch_unexp, 0), 2),
    'lifetime_drift_from_baseline', v_drift,
    'tolerance', v_tol,
    'lifetime', jsonb_build_object(
      'drift_from_baseline', v_drift,
      'paid_before_the_payout_table', v_pre_table,
      'pre_ledger_payouts_known', COALESCE(v_base.pre_ledger_payouts, 0),
      'paid_without_a_payout_row_since', v_unrecorded_since,
      'opening_seeds_known', v_seeds,
      'journalled_seeds_after_epoch', round(v_late_seeds, 2),
      'journalled_burns_after_epoch', round(v_late_burns, 2),
      'legacy_pool_amount_live', round(v_seeds_live,2),
      'unexplained', v_unexplained,
      'known_residue', COALESCE(v_base.lifetime_residue, 0),
      'moved_since_resolution', round(v_unexplained - COALESCE(v_base.lifetime_residue,0), 2),
      'note', 'The gap is two ledgers with different start dates, not missing chips. bbj_contributions begins 2026-03-03; bbj_payouts begins 2026-07-22. The union pool paid forty jackpots in between (71,749.31), and bbj_pools.total_paid_out is the witness that was there. Against it, 1,000.00 of opening seed sits in a bank with no contribution row. Both are CLOSED historical figures. `paid_without_a_payout_row_since` and `moved_since_resolution` are the live signals; everything else here is memory.'),
    'lifetime_healthy',
          abs(v_unexplained - COALESCE(v_base.lifetime_residue, 0)) <= v_tol
      AND abs(v_unrecorded_since) <= 0.01,
    'epoch', jsonb_build_object(
      'opened_at', v_epoch_at,
      'snapshots', v_epoch_runs,
      'unexplained_since_opening', round(v_epoch_unexp, 2),
      'absorbed_by_later_openings', round(v_absorbed, 2),
      'known_residue', COALESCE(v_base.epoch_residue, 0),
      'moved_since_recorded', round(v_epoch_unexp - COALESCE(v_base.epoch_residue, 0), 2)),
    'healthy', v_epoch_at IS NOT NULL
               AND abs(v_epoch_unexp - COALESCE(v_base.epoch_residue, 0)) <= v_tol);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bbj_conservation_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_conservation_check() TO service_role;

-- ── 13. Job 233: fn_bbj_promo_bank_check() ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bbj_promo_bank_check()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  /* SAFE-HORIZON CHECKPOINTED CONTRIBUTIONS: bbj_contributions is strictly
     append-only (0 updates, 0 deletes). Sums older than the sweep's open-xact
     horizon sit in ca_bbj_promo_audit_mark; this reads only the tail via
     idx_bbj_contributions_created_at_cover (plus any NULL created_at rows),
     falling back to a full scan when no mark exists yet. */
  WITH mk AS MATERIALIZED (
    SELECT COALESCE((SELECT m.through_at FROM public.ca_bbj_promo_audit_mark m WHERE m.id = 1), '-infinity'::timestamptz) AS through_at,
           COALESCE((SELECT m.contributed FROM public.ca_bbj_promo_audit_mark m WHERE m.id = 1), 0) AS contributed,
           COALESCE((SELECT m.pre_triple_bank FROM public.ca_bbj_promo_audit_mark m WHERE m.id = 1), 0) AS pre_triple_bank,
           COALESCE((SELECT m.rated_amount FROM public.ca_bbj_promo_audit_mark m WHERE m.id = 1), 0) AS rated_amount,
           COALESCE((SELECT m.rated_promo FROM public.ca_bbj_promo_audit_mark m WHERE m.id = 1), 0) AS rated_promo
  ), tail AS (
    SELECT COALESCE(sum(b.promo_portion), 0) AS contributed,
           COALESCE(sum(b.amount) FILTER (WHERE b.main_portion IS NULL AND b.backup_portion IS NULL AND b.promo_portion IS NULL), 0) AS pre_triple_bank,
           COALESCE(sum(b.amount) FILTER (WHERE b.promo_portion IS NOT NULL), 0) AS rated_amount,
           COALESCE(sum(b.promo_portion) FILTER (WHERE b.promo_portion IS NOT NULL), 0) AS rated_promo
      FROM public.bbj_contributions b
     WHERE b.created_at >= (SELECT through_at FROM mk)
  ), nulls AS (
    SELECT COALESCE(sum(b.promo_portion), 0) AS contributed,
           COALESCE(sum(b.amount) FILTER (WHERE b.main_portion IS NULL AND b.backup_portion IS NULL AND b.promo_portion IS NULL), 0) AS pre_triple_bank,
           COALESCE(sum(b.amount) FILTER (WHERE b.promo_portion IS NOT NULL), 0) AS rated_amount,
           COALESCE(sum(b.promo_portion) FILTER (WHERE b.promo_portion IS NOT NULL), 0) AS rated_promo
      FROM public.bbj_contributions b
     WHERE b.created_at IS NULL
  ), c AS (
    SELECT mk.contributed + tail.contributed + nulls.contributed AS contributed,
           mk.pre_triple_bank + tail.pre_triple_bank + nulls.pre_triple_bank AS pre_triple_bank,
           mk.rated_amount + tail.rated_amount + nulls.rated_amount AS rated_amount,
           mk.rated_promo + tail.rated_promo + nulls.rated_promo AS rated_promo
      FROM mk, tail, nulls
  ), t AS (
    SELECT
      (SELECT c.contributed FROM c)                                                             AS contributed,
      /* RECORDED MOVES BETWEEN BANKS (2026-10-23). fn_bbj_move_between_banks
         is the other way chips enter (or leave) a promo bank; each move is a
         ca_bbj_bucket_moves row. Net into promo counts on the entered side. */
      (SELECT COALESCE(sum(amount) FILTER (WHERE to_bank = 'promo'),0)
            - COALESCE(sum(amount) FILTER (WHERE from_bank = 'promo'),0)
         FROM ca_bbj_bucket_moves)                                                              AS moved_in,
      (SELECT COALESCE(sum(amount),0) FROM union_wallet_transactions WHERE tx_type='bbj_promo_sweep') AS swept_to_union,
      /* A UNION JOIN CLOSURE COUNTS ITS PROMO PART ONLY (2026-10-12): it closes
         main, backup and promo in one bbj_promo_sweep row. */
      (SELECT COALESCE(sum(CASE WHEN metadata->>'reason'='union_join'
                                THEN COALESCE((metadata->>'bbj_promo')::numeric,0) ELSE amount END),0)
         FROM chip_transactions WHERE transaction_type='bbj_promo_sweep') AS swept_to_club,
      (SELECT COALESCE(sum(promo_balance),0) FROM bbj_pools)                                     AS still_held,
      (SELECT c.pre_triple_bank FROM c)                                                         AS pre_triple_bank,
      /* The promo rate the rows that DO record their split actually show. Not
         a constant from config: the rate has varied by stakes tier and over
         time, and what matters here is what this pool really banked. */
      (SELECT CASE WHEN c.rated_amount > 0
                   THEN c.rated_promo / c.rated_amount ELSE 0 END
         FROM c)                                                                                AS observed_rate
  ), g AS (
    SELECT t.*,
           round(swept_to_union + swept_to_club + still_held - contributed - moved_in, 2) AS gap,
           round(pre_triple_bank * observed_rate, 2)                                      AS era_promo
      FROM t
  )
  SELECT jsonb_build_object(
    'promo_contributed', round(contributed,2),
    'moved_into_promo',  round(moved_in,2),
    'swept_to_union',    round(swept_to_union,2),
    'swept_to_club',     round(swept_to_club,2),
    'still_held',        round(still_held,2),
    'over_swept',        gap,
    'pre_triple_bank_contributions', round(pre_triple_bank,2),
    'pre_triple_bank_promo_at_observed_rate', era_promo,
    'observed_promo_rate', round(observed_rate * 100, 4),
    'explained_by_pre_triple_bank', (gap > 0.01 AND gap <= era_promo),
    'unexplained',       GREATEST(round(gap - era_promo, 2), 0),
    'reconciles',        (GREATEST(round(gap - era_promo, 2), 0) <= 0.01),
    'note', 'The promo bank balances once the pre-triple-bank era and the recorded moves between banks are accounted for. 49,714 contribution rows from 2026-03-03..07 carry NULL portions - the columns did not exist yet - so their promo money is real but counts as zero on the "entered" side. Chips moved into promo by fn_bbj_move_between_banks (ca_bbj_bucket_moves) count as entered. `unexplained` is the number that matters: chips that left the promo bank and cannot be traced to any contribution or recorded move. Only that should ever raise an alarm. The portions are deliberately NOT backfilled: inventing a split nobody recorded would be editing history.'
  ) FROM g;
$function$;

REVOKE ALL ON FUNCTION public.fn_bbj_promo_bank_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_promo_bank_check() TO service_role;

-- ── 14. Job 233: fn_ca_knockout_door_stalled(integer) ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_knockout_door_stalled(p_stall_minutes integer DEFAULT 15)
 RETURNS TABLE(last_resolved_at timestamp with time zone, stalled_minutes numeric, pending_candidates bigint, pending_past_prompt bigint, oldest_expired_prompt_minutes numeric, detail text)
 LANGUAGE sql
 STABLE
AS $function$
  -- Separate idx_tournament_knockout_candidates_resolved_at backward lookup
  -- from idx_tournament_knockout_candidates_pending_unresolved pending scan so
  -- 1.87M historical resolved rows are never scanned.
  WITH last_res AS (
    SELECT max(r.resolved_at) AS last_resolved_at
      FROM public.tournament_knockout_candidates r
     WHERE r.resolved_at IS NOT NULL
  ), pend AS (
    SELECT count(*) AS pending,
           count(*) FILTER (WHERE c.rebuy_prompt_until IS NULL OR c.rebuy_prompt_until < now()) AS past_prompt,
           min(COALESCE(c.rebuy_prompt_until, c.created_at))
             FILTER (WHERE c.rebuy_prompt_until IS NULL OR c.rebuy_prompt_until < now()) AS oldest_prompt
      FROM public.tournament_knockout_candidates c
     WHERE c.resolved_at IS NULL
       AND upper(COALESCE((SELECT t.status FROM public.tournaments t
                            WHERE t.id = c.tournament_id), ''))
           NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
  ), k AS (
    SELECT last_res.last_resolved_at, pend.pending, pend.past_prompt, pend.oldest_prompt
      FROM last_res, pend
  )
  SELECT k.last_resolved_at,
         round((extract(epoch FROM (now() - k.last_resolved_at)) / 60.0)::numeric, 1),
         k.pending, k.past_prompt,
         round((extract(epoch FROM (now() - k.oldest_prompt)) / 60.0)::numeric, 1),
         'the knockout door has not resolved a single candidate for '
           || round((extract(epoch FROM (now() - k.last_resolved_at)) / 60.0)::numeric, 1)
           || ' minute(s) while ' || k.past_prompt
           || ' candidate(s) are waiting with no open rebuy decision, '
           || 'the oldest for '
           || round((extract(epoch FROM (now() - k.oldest_prompt)) / 60.0)::numeric, 1)
           || ' minute(s). Healthy is a gap of 2.04s (p50) and 19.19s (p99): '
           || 'this is not a quiet door, it is a stopped one, and every player '
           || 'behind it is neither eliminated nor allowed to rebuy'
    FROM k
   WHERE k.past_prompt > 0
     AND (k.last_resolved_at IS NULL
          OR k.last_resolved_at < now() - make_interval(mins => GREATEST(p_stall_minutes, 1)))
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_knockout_door_stalled(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_knockout_door_stalled(integer) TO service_role;

-- ── 15. Verify owner, SECURITY DEFINER, proconfig, and ACLs unchanged ───────
DO $meta_check$
DECLARE
  r record;
  v_cur record;
BEGIN
  FOR r IN SELECT * FROM _hourly_cron_perf_meta LOOP
    SELECT p.proowner, p.prosecdef, p.proconfig, p.proacl
      INTO v_cur
      FROM pg_catalog.pg_proc p
     WHERE p.oid = r.sig::regprocedure;
    IF v_cur.proowner IS DISTINCT FROM r.proowner
       OR v_cur.prosecdef IS DISTINCT FROM r.prosecdef
       OR v_cur.proconfig IS DISTINCT FROM r.proconfig
       OR v_cur.proacl IS DISTINCT FROM r.proacl THEN
      RAISE EXCEPTION 'HOURLY_CRON_PERF_META_CHANGED: % owner/security/config/acl drifted', r.sig
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $meta_check$;

-- ── 16. Mandatory pre-commit runtime probes (subtransaction-unwound) ────────
-- @probe-for: public.fn_club_rake_rollup_day
DO $probe_rollup_day$
BEGIN
  PERFORM public.fn_club_rake_rollup_day('00000000-0000-0000-0000-000000000000'::uuid, (now() AT TIME ZONE 'UTC')::date - 2);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_rollup_day$;

-- @probe-for: public.fn_ca_reporting_rollups_from_facts
DO $probe_reporting_facts$
BEGIN
  PERFORM public.fn_ca_reporting_rollups_from_facts('2099-01-01'::date);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_reporting_facts$;

-- @probe-for: public.fn_pay_backed_payout_shortfalls
DO $probe_shortfalls$
BEGIN
  PERFORM public.fn_pay_backed_payout_shortfalls(false, 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_shortfalls$;

-- @probe-for: public.fn_bbj_reconcile
DO $probe_bbj_rec$
DECLARE v_pid uuid;
BEGIN
  SELECT b.id INTO v_pid
    FROM public.bbj_pools b
   WHERE b.status = 'active'
     AND b.main_balance = 0 AND b.backup_balance = 0 AND b.promo_balance = 0
     AND EXISTS (SELECT 1 FROM public.ca_bbj_pool_snapshots s WHERE s.pool_id = b.id AND s.is_baseline)
   ORDER BY b.created_at DESC LIMIT 1;
  IF v_pid IS NULL THEN
    SELECT b.id INTO v_pid
      FROM public.bbj_pools b
     WHERE EXISTS (SELECT 1 FROM public.ca_bbj_pool_snapshots s WHERE s.pool_id = b.id AND s.is_baseline)
     ORDER BY b.created_at DESC LIMIT 1;
  END IF;
  IF v_pid IS NOT NULL THEN
    PERFORM public.fn_bbj_reconcile(v_pid);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_bbj_rec$;

-- @probe-for: public.fn_bbj_reconcile_all
DO $probe_bbj_rec_all$
BEGIN
  PERFORM public.fn_bbj_reconcile_all();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_bbj_rec_all$;

-- @probe-for: public.fn_rake_bbj_invariants
DO $probe_rake_inv$
BEGIN
  PERFORM count(*) FROM public.fn_rake_bbj_invariants(1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_rake_inv$;

-- @probe-for: public.fn_union_integrity_sweep
DO $probe_union_sweep$
BEGIN
  PERFORM public.fn_union_integrity_sweep('00000000-0000-0000-0000-000000000000'::uuid, 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_union_sweep$;

-- @probe-for: public.fn_ca_completed_without_a_champion
DO $probe_no_champ$
BEGIN
  PERFORM public.fn_ca_completed_without_a_champion();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_no_champ$;

-- @probe-for: public.fn_ca_undeclared_money_paths
DO $probe_undeclared$
BEGIN
  PERFORM count(*) FROM public.fn_ca_undeclared_money_paths();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_undeclared$;

-- @probe-for: public.fn_ca_ledger_audit_checkpoint_advance
DO $probe_cp_adv$
BEGIN
  PERFORM public.fn_ca_ledger_audit_checkpoint_advance();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_cp_adv$;

-- @probe-for: public.fn_bbj_conservation_check
DO $probe_bbj_cons$
BEGIN
  PERFORM public.fn_bbj_conservation_check();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_bbj_cons$;

-- @probe-for: public.fn_bbj_promo_bank_check
DO $probe_bbj_promo$
BEGIN
  PERFORM public.fn_bbj_promo_bank_check();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_bbj_promo$;

-- @probe-for: public.fn_ca_knockout_door_stalled
DO $probe_ko_stall$
BEGIN
  PERFORM count(*) FROM public.fn_ca_knockout_door_stalled(15);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_ko_stall$;

COMMIT;
