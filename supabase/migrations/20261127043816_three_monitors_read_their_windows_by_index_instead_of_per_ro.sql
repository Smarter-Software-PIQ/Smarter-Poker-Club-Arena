-- 20261127043816_three_monitors_read_their_windows_by_index_instead_of_per_ro.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THREE READERS STILL CANCELLED AFTER 20261126220936 (production, SQLSTATE
-- 57014). Each one paid for a random read per row, per pool or per pair where
-- the rows it needs sit in one index range. No answer changes: every rewrite
-- below was compared with the live definition on production, read-only, in one
-- snapshot, and every grant is restated exactly as it is live (postgres and
-- service_role only).
--
-- 1. fn_union_treasury_selftest (RakebackSettlerService, PostgREST, 8 s).
--    Its money checks are cheap warm (1.6 s) and slow cold, and the cold cost
--    sat in four reads inside fn_bbj_conservation_check, measured cold on
--    2026-11-26 (Chicago evening):
--    - SUM(chip_transactions.amount) for 'bbj_promo_sweep': 5.5 s. 10,964 rows
--      scattered over a 566 MB heap; idx_chip_tx_type_user_created carries no
--      amount. Now idx_chip_tx_bbj_promo_sweep (partial, INCLUDE amount):
--      index-only, the same pattern as idx_uwt_bbj_flows.
--    - count(*) of ca_bbj_pool_snapshots WHERE NOT is_baseline: 2.3 s (a
--      parallel scan of a 496 MB heap for 3.09M rows). Now
--      idx_ca_bbj_pool_snapshots_runs, a deduplicated partial btree on
--      (is_baseline) WHERE NOT is_baseline: index-only.
--    - fn_bbj_contributions_total's tail since its checkpoint: 1.8 to 3.8 s.
--      `created_at >= as_of` had no created_at-leading index carrying amount
--      for every row, so it walked all of idx_bbj_contrib_pool_facts (363 MB)
--      for about 3,500 rows. It now reads two ranges: hand_id IS NOT NULL by
--      idx_bbj_contrib_window_cover and hand_id IS NULL by the new
--      idx_bbj_contrib_nullhand_created (172,396 rows, last written
--      2026-09-07). fn_bbj_contributions_total_advance reads its delta the
--      same way. Both now plan with the checkpoint's value
--      (force_custom_plan), as the conservation check already does.
--    - the late pools' seeds and burns since the sweep checkpoint: two probes
--      of the chip_ledger entity indexes per pool, 8,100 probes for 4,050
--      pools. They are the same legs as the range of
--      idx_chip_ledger_bbj_pool_legs the epoch identity already reads (32,301
--      legs at 04:50Z), so they are read once and grouped by pool. The
--      remaining per-pool reads (a pool without kept sums, 2 of 4,063; a pool
--      whose kept absorbed sum does not reach its opening, 52) are LATERAL
--      key probes for only those pools, no longer a scalar subquery for every
--      pool. That block: 4,675 ms old, 222 ms new (new run first, 05:11Z).
--    Compared on production: tail 1,190.68 = 1,190.68, advance delta 560.44 =
--    560.44, seeded 406,100.22 = 406,100.22, burned 407,205.34 = 407,205.34;
--    with the LATERAL form at 05:11Z absorbed 403,400.00, seeded 406,400.22,
--    burned 407,505.34, equal in both.
--    The two unchanged statements (promo sweep sum, snapshot count) pick their
--    new index by themselves; their text is untouched.
--    NOT CHANGED: fn_bbj_contributions_total_verify still recomputes the whole
--    contributions total once a day (index-only over idx_bbj_contrib_pool_facts).
--    It is the deliberate full check and stays O(rows).
--
-- 2. fn_ca_horse_exposure_watch (cron 'ca-horse-exposure-watch-hourly', 150 s).
--    Cancelled from 02:17Z on 2026-11-27, the first run that flagged a person
--    (13,629 PLO5 hands in the firing window). Step 3, the leak breakdown, runs
--    only for a flagged person. It joined CTEs of the whole window to each
--    other; with a one-row estimate the planner rescanned the hand CTE for
--    every row of another (1,470 loops x 1,770 rows): 42 s for 300 hands,
--    quadratic, so 13,629 hands could never finish. Step 3 now works one hand
--    at a time through LATERAL reads keyed by the hand (hand_history_pkey,
--    ca_hand_facts_pkey, lightning_hand by hand_number). Compared on
--    production with the old breakdown on four samples of that person's hands
--    (150, 600, 500 from row 9,000, and 500 from row 12,500 with Lightning
--    hands): identical jsonb every time. The full 13,629 hands take 2.7 s.
--    Steps 1, 2 and 4 are unchanged byte for byte.
--
-- 3. fn_rake_attribution_drift(integer) (FeeReconciler.auditRakeAttributionDrift,
--    PostgREST rpc with p_hours = 24). About 30,000 hands a day, each summing
--    its attributions through idx_rake_attributions_hand_id: one random read
--    per hand (hand ids are random uuids), 7.5 s with 23,500 pages from disk,
--    14.7 s for the same reads on 2026-11-27 04:45Z. The attributions are now
--    read as one range of the new idx_rake_attributions_created_cover
--    (created_at) INCLUDE (hand_id, weighted_rake_credit), starting a day
--    before the window, and a hand the range holds nothing for is still summed
--    by hand id with no time window. On production every attribution carries
--    its rake row's created_at exactly (29,880 hands, lead and lag 0, none
--    with rows on both sides of the range start).
--
-- The indexes are built CONCURRENTLY before the transaction (rake_attributions,
-- chip_transactions, ca_bbj_pool_snapshots and bbj_contributions are written
-- every hand), largest first, and the transaction refuses to install if any of
-- them is not valid with exactly the shape these reads rely on.
--
-- No money moves, no game table is locked, no cron schedule or threshold
-- changes, and nothing is excluded: Horses are players here as before.
--
-- Pinned by tests/three-monitors-read-their-windows-by-index.law.test.ts.
--
-- @live-proof: (SELECT bool_and(i.indisvalid) AND count(*) = 4 FROM pg_index i WHERE i.indexrelid IN (to_regclass('public.idx_rake_attributions_created_cover'), to_regclass('public.idx_chip_tx_bbj_promo_sweep'), to_regclass('public.idx_ca_bbj_pool_snapshots_runs'), to_regclass('public.idx_bbj_contrib_nullhand_created')))
-- @live-proof: position('tail_legs' in pg_get_functiondef('public.fn_bbj_conservation_check()'::regprocedure)) > 0 AND position('b.hand_id IS NULL AND b.created_at >= v_as_of' in pg_get_functiondef('public.fn_bbj_contributions_total()'::regprocedure)) > 0 AND position('b.hand_id IS NULL AND b.created_at >= v_as_of' in pg_get_functiondef('public.fn_bbj_contributions_total_advance()'::regprocedure)) > 0
-- @live-proof: position('ra_window' in pg_get_functiondef('public.fn_rake_attribution_drift(integer)'::regprocedure)) > 0 AND position('ONE HAND AT A TIME' in pg_get_functiondef('public.fn_ca_horse_exposure_watch(timestamp with time zone,boolean)'::regprocedure)) > 0
-- @replaces-md5: public.fn_bbj_contributions_total()=6a734d07f9e43b5ebbafa5e3974abfe5
-- @replaces-md5: public.fn_bbj_contributions_total_advance()=d1a1edd7141b6a31532100bc67d3e89d
-- @replaces-md5: public.fn_bbj_conservation_check()=45166a61fd8b0f36a4bed1127b075e83
-- @replaces-md5: public.fn_rake_attribution_drift(integer)=6a2f93c5f4370088fa0ea3634d44e780
-- @replaces-md5: public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)=fed9c02ebc2fa849ff056ad1166a4fe2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rake_attributions_created_cover
 ON public.rake_attributions USING btree (created_at) INCLUDE (hand_id, weighted_rake_credit);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bbj_contrib_nullhand_created
 ON public.bbj_contributions USING btree (created_at) INCLUDE (amount)
 WHERE (hand_id IS NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ca_bbj_pool_snapshots_runs
 ON public.ca_bbj_pool_snapshots USING btree (is_baseline)
 WHERE (NOT is_baseline);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chip_tx_bbj_promo_sweep
 ON public.chip_transactions USING btree (transaction_type) INCLUDE (amount)
 WHERE (transaction_type = 'bbj_promo_sweep'::text);

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

DO $verify_index$
DECLARE
  v_ix record;
BEGIN
  FOR v_ix IN
    SELECT * FROM (VALUES
      ('public.idx_rake_attributions_created_cover', 'public.rake_attributions', NULL::text,
       1, ARRAY['created_at', 'hand_id', 'weighted_rake_credit']),
      ('public.idx_bbj_contrib_nullhand_created', 'public.bbj_contributions', '(hand_id IS NULL)',
       1, ARRAY['created_at', 'amount']),
      ('public.idx_ca_bbj_pool_snapshots_runs', 'public.ca_bbj_pool_snapshots', '(NOT is_baseline)',
       1, ARRAY['is_baseline']),
      ('public.idx_chip_tx_bbj_promo_sweep', 'public.chip_transactions', '(transaction_type = ''bbj_promo_sweep''::text)',
       1, ARRAY['transaction_type', 'amount'])
    ) AS t(ix, tbl, pred, nkey, cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
      WHERE i.indexrelid = to_regclass(v_ix.ix)
        AND i.indrelid = v_ix.tbl::regclass
        AND am.amname = 'btree'
        AND i.indisvalid AND i.indisready AND i.indislive
        AND NOT i.indisunique AND i.indexprs IS NULL
        AND pg_get_expr(i.indpred, i.indrelid) IS NOT DISTINCT FROM v_ix.pred
        AND i.indnkeyatts = v_ix.nkey AND i.indnatts = cardinality(v_ix.cols)
        AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true)
                    FROM generate_series(1, cardinality(v_ix.cols)) n) = v_ix.cols
    ) THEN
      RAISE EXCEPTION 'MONITOR_INDEX_NOT_QUALIFIED: %', v_ix.ix USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$verify_index$;

CREATE OR REPLACE FUNCTION public.fn_bbj_contributions_total()
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_as_of timestamptz;
  v_total numeric;
  v_tail  numeric;
BEGIN
  SELECT c.as_of, c.total INTO v_as_of, v_total
    FROM money_flow_checkpoint c WHERE c.metric_key = 'bbj_contributions_inflow';
  IF NOT FOUND THEN
    v_as_of := '-infinity'::timestamptz; v_total := 0;
  END IF;

  /* THE TAIL IS READ AS TWO TIME RANGES (2026-11-27). `created_at >= v_as_of`
     over the whole table had no created_at-leading index carrying amount, so
     it walked all of idx_bbj_contrib_pool_facts (363 MB) for a few thousand
     rows: 1.8 to 3.8 s cold inside fn_union_treasury_selftest. Every row has
     hand_id either set or NULL, so the same rows are the two ranges of
     idx_bbj_contrib_window_cover (hand_id IS NOT NULL) and
     idx_bbj_contrib_nullhand_created (hand_id IS NULL). Same rows, same sum. */
  SELECT COALESCE((SELECT SUM(b.amount) FROM bbj_contributions b
                    WHERE b.hand_id IS NOT NULL AND b.created_at >= v_as_of), 0)
       + COALESCE((SELECT SUM(b.amount) FROM bbj_contributions b
                    WHERE b.hand_id IS NULL AND b.created_at >= v_as_of), 0)
    INTO v_tail;

  RETURN v_total + v_tail;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bbj_contributions_total() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_contributions_total() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_bbj_contributions_total_advance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key    text := 'bbj_contributions_inflow';
  v_as_of  timestamptz;
  v_total  numeric;
  v_rows   bigint;
  v_target timestamptz := now() - interval '1 hour';
  d_total  numeric;
  d_rows   bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('money_flow_cp:' || v_key, 42));

  SELECT c.as_of, c.total, c.rows_seen INTO v_as_of, v_total, v_rows
    FROM money_flow_checkpoint c WHERE c.metric_key = v_key;
  IF NOT FOUND THEN
    v_as_of := '-infinity'::timestamptz; v_total := 0; v_rows := 0;
  END IF;

  IF v_target <= v_as_of THEN
    RETURN;
  END IF;

  -- The same two ranges as fn_bbj_contributions_total (2026-11-27): rows with
  -- a hand and rows without one, each read by its own created_at index.
  SELECT COALESCE(SUM(s.amount), 0), COALESCE(SUM(s.n), 0)
    INTO d_total, d_rows
    FROM (SELECT SUM(b.amount) AS amount, COUNT(*) AS n
            FROM bbj_contributions b
           WHERE b.hand_id IS NOT NULL AND b.created_at >= v_as_of AND b.created_at < v_target
          UNION ALL
          SELECT SUM(b.amount), COUNT(*)
            FROM bbj_contributions b
           WHERE b.hand_id IS NULL AND b.created_at >= v_as_of AND b.created_at < v_target) s;

  INSERT INTO money_flow_checkpoint
        (metric_key, as_of, total, rows_seen, last_verified_at, updated_at)
  VALUES (v_key, v_target, v_total + d_total, v_rows + d_rows, now(), now())
  ON CONFLICT (metric_key) DO UPDATE
    SET as_of      = EXCLUDED.as_of,
        total      = EXCLUDED.total,
        rows_seen  = EXCLUDED.rows_seen,
        updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bbj_contributions_total_advance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_contributions_total_advance() TO service_role;

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
     (2026-10-02, incident f3e82f59). fn_bbj_open_pool_baseline opens a later
     pool at GREATEST(created_at, epoch) and its opening balance already holds
     every leg up to that instant - the welcome seed leg has the pool's own
     created_at. Summing that baseline AND the journal since the global epoch
     counted each 100.00 seed twice. The legs a later pool's baseline absorbed
     are added back below; and its journalled seeds and burns enter the
     lifetime identity, because unlike the remembered 1,000.00 they have a
     ledger sentence. An ORIGINAL pool's seed or burn stays unexplained.

     EACH LEG IS READ ONCE (20261022162545). Seeds and burns before the
     sweep's checkpoint are its kept per-pool sums (ca_ledger_audit_bbj_pool);
     a pool without one is read whole, as before. The absorbed legs are the
     pool's own (epoch, opening] range, read by key. */
  SELECT min(taken_at) INTO v_epoch_at FROM public.ca_bbj_pool_snapshots WHERE is_baseline;
  SELECT m.through_at, m.to_total, m.from_total INTO v_cp_through, v_cp_to, v_cp_from
    FROM public.ca_ledger_audit_marks m
   WHERE m.metric = 'bbj_epoch' AND m.from_at = v_epoch_at;
  IF NOT FOUND THEN v_cp_through := NULL; v_cp_to := 0; v_cp_from := 0; END IF;
  /* EACH POOL'S LEGS ARE READ AS GROUPED SETS, NOT PER-POOL SUBQUERIES
     (2026-11-27). Every pool opened after the epoch used to run four scalar
     sums over chip_ledger correlated on the pool: 8,100 entity-index probes
     for 4,050 pools, cold leaf pages every time, inside
     fn_union_treasury_selftest's 8 s.
     - The tail after the checkpoint of a pool WITH kept sums is the range of
       idx_chip_ledger_bbj_pool_legs that the epoch identity below already
       reads: read once (tail_legs), grouped by pool, with the same category
       tests (NULL categories excluded exactly as before).
     - A pool WITHOUT kept sums (2 of 4,063 on 2026-11-27) is still read whole
       since the epoch, and a pool whose kept absorbed sum does not reach its
       opening (52) still reads its own (epoch, opening] legs. Both are read
       by key, one LATERAL probe per pool that needs it and for no other pool.
       A plain GROUP BY join was measured on production too: the planner
       hash-joins it against every bbj_pool leg since the epoch (estimated
       7.3M to 15M rows) and the read was cancelled by the statement timeout,
       so the per-pool key read stays, limited to the pools that need it.
     Same legs, same filters, same sums. */
  WITH o AS MATERIALIZED (
    SELECT p.id AS pool_id, b.opened_at, k.seeded AS kept_seeded, k.burned AS kept_burned,
           k.absorbed AS kept_absorbed, k.absorbed_to AS kept_absorbed_to,
           (k.pool_id IS NOT NULL) AS has_kept
      FROM public.bbj_pools p
      LEFT JOIN (SELECT s.pool_id, min(s.taken_at) AS opened_at
                   FROM public.ca_bbj_pool_snapshots s
                  WHERE s.is_baseline
                  GROUP BY s.pool_id) b ON b.pool_id = p.id
      LEFT JOIN public.ca_ledger_audit_bbj_pool k ON k.pool_id = p.id AND v_cp_through IS NOT NULL
     WHERE COALESCE(b.opened_at, p.created_at) > v_epoch_at
  ), tail_legs AS MATERIALIZED (
    SELECT l.to_type, l.from_type, l.to_entity_id, l.from_entity_id, l.category, l.amount
      FROM public.chip_ledger l
     WHERE (l.to_type = 'bbj_pool' OR l.from_type = 'bbj_pool')
       AND l.created_at > v_epoch_at
       AND l.created_at >= v_cp_through
  ), tail_seeded AS (
    SELECT t.to_entity_id AS pool_id, sum(t.amount) AS amount
      FROM tail_legs t
     WHERE t.to_type = 'bbj_pool' AND t.category <> 'bbj_contribution'
     GROUP BY t.to_entity_id
  ), tail_burned AS (
    SELECT t.from_entity_id AS pool_id, sum(t.amount) AS amount
      FROM tail_legs t
     WHERE t.from_type = 'bbj_pool' AND t.category NOT IN ('bbj_payout', 'promo')
     GROUP BY t.from_entity_id
  ), whole_legs AS (
    SELECT n.pool_id, ws.amount AS seeded, wb.amount AS burned
      FROM o n
      CROSS JOIN LATERAL (SELECT sum(l.amount) AS amount FROM public.chip_ledger l
                           WHERE l.to_entity_id = n.pool_id AND l.to_type = 'bbj_pool'
                             AND l.category <> 'bbj_contribution'
                             AND l.created_at > v_epoch_at) ws
      CROSS JOIN LATERAL (SELECT sum(l.amount) AS amount FROM public.chip_ledger l
                           WHERE l.from_entity_id = n.pool_id AND l.from_type = 'bbj_pool'
                             AND l.category NOT IN ('bbj_payout', 'promo')
                             AND l.created_at > v_epoch_at) wb
     WHERE NOT n.has_kept
  ), absorbed_legs AS (
    SELECT n.pool_id, ai.amount AS legs_in, ao.amount AS legs_out
      FROM o n
      CROSS JOIN LATERAL (SELECT sum(l.amount) AS amount FROM public.chip_ledger l
                           WHERE l.to_entity_id = n.pool_id AND l.to_type = 'bbj_pool'
                             AND l.created_at > v_epoch_at AND l.created_at <= n.opened_at) ai
      CROSS JOIN LATERAL (SELECT sum(l.amount) AS amount FROM public.chip_ledger l
                           WHERE l.from_entity_id = n.pool_id AND l.from_type = 'bbj_pool'
                             AND l.created_at > v_epoch_at AND l.created_at <= n.opened_at) ao
     WHERE n.opened_at IS NOT NULL AND n.kept_absorbed_to IS DISTINCT FROM n.opened_at
  )
  SELECT COALESCE(sum(x.absorbed), 0), COALESCE(sum(x.seeded), 0), COALESCE(sum(x.burned), 0)
    INTO v_absorbed, v_late_seeds, v_late_burns
    FROM o
    LEFT JOIN tail_seeded ts ON ts.pool_id = o.pool_id AND o.has_kept
    LEFT JOIN tail_burned tb ON tb.pool_id = o.pool_id AND o.has_kept
    LEFT JOIN whole_legs w ON w.pool_id = o.pool_id
    LEFT JOIN absorbed_legs a ON a.pool_id = o.pool_id
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN o.opened_at IS NULL THEN 0
             WHEN o.kept_absorbed_to = o.opened_at THEN o.kept_absorbed ELSE
          COALESCE(a.legs_in, 0) - COALESCE(a.legs_out, 0) END AS absorbed,
        COALESCE(o.kept_seeded, 0)
        + CASE WHEN o.has_kept THEN COALESCE(ts.amount, 0) ELSE COALESCE(w.seeded, 0) END AS seeded,
        COALESCE(o.kept_burned, 0)
        + CASE WHEN o.has_kept THEN COALESCE(tb.amount, 0) ELSE COALESCE(w.burned, 0) END AS burned
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
  /* END TO END, NOT INTERVAL BY INTERVAL (2026-09-09). Summing each hour's
     residue accumulated every straddled drop forever, because a leg whose
     transaction began before a snapshot and committed after it belongs to no
     window at all. One comparison across the whole epoch has only two
     boundaries instead of three hundred. The legs before the sweep's
     checkpoint are its kept totals (20261022162545). */
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

  /* THE LIFETIME DECOMPOSITION (phase 5.3). Two ledgers with different start
     dates, named rather than reported as a deficit.

     ROOT pools only: a merge folds the retired pool's counters into its
     destination, so summing every pool would count the club pool's 74,301.10
     twice. */
  SELECT COALESCE(sum(total_paid_out),0) INTO v_counters_paid
    FROM bbj_pools WHERE merged_into_pool_id IS NULL;
  SELECT COALESCE(sum(total_amount),0) INTO v_payout_rows FROM bbj_payouts;
  v_pre_table := round(v_counters_paid - v_payout_rows, 2);

  /* The historical figure is CLOSED at 71,749.31. Anything beyond it is a
     payout made since bbj_payouts existed that wrote no row - a live blind
     spot wearing a historical explanation's clothes. */
  v_unrecorded_since := round(v_pre_table - COALESCE(v_base.pre_ledger_payouts, 0), 2);

  /* Opening seeds pull the OTHER way: bank balance with no inflow row behind
     it. REMEMBERED, not read from bbj_pools.pool_amount - four functions can
     write that column, so deriving from it would let any of them move a money
     verdict, and would silently absorb a new seed the way the pre-ledger
     bucket would have absorbed a new unrecorded payout. The live column is
     reported beside it so a divergence is visible rather than load-bearing. */
  v_seeds := COALESCE(v_base.opening_seeds, 0);
  SELECT COALESCE(sum(pool_amount),0) INTO v_seeds_live FROM bbj_pools;

  v_unexplained := round(v_drift - v_pre_table + v_seeds, 2);

  RETURN jsonb_build_object(
    'inflow', round(v_in,2), 'outflow', round(v_out,2), 'balances', round(v_bal,2),
    'gap', v_gap,
    'baseline_gap', COALESCE(v_base.baseline_gap, 0),
    /* THE HEADLINE IS THE LIVE FIGURE (2026-09-09). This was v_drift, the
       lifetime gap, which is closed and does not move; the sweep reads this
       key for the incident's amount, so every incident said 70,795.11 while
       the thing that made the verdict unhealthy was a few chips. The
       lifetime figure keeps its place under 'lifetime' below. */
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

CREATE OR REPLACE FUNCTION public.fn_rake_attribution_drift(p_hours integer DEFAULT 24)
 RETURNS TABLE(hand_id uuid, rake_amount numeric, allocated numeric, difference numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1));
BEGIN
  /* THE WINDOW IS A VALUE WHEN THE QUERY IS PLANNED (2026-10-22). As a
     LANGUAGE sql SECURITY DEFINER function this query was planned with the
     window as an unknown parameter, priced at a million hands, and hash-joined
     every one of the 9.2M rake_attributions rows: 105 s for the 9,000 hands
     of a two-hour window (rake-attribution-drift-audit-hourly, 97 s average).
     Planned with the window's value (force_custom_plan), each hand reads its
     own attributions through idx_rake_attributions_hand_id: about 4 s.
     The query, its rows, columns and rounding are unchanged.

     THE ATTRIBUTIONS ARE READ AS ONE RANGE (2026-11-27). Even planned with
     its value, a day is about 30,000 hands, and one probe of
     idx_rake_attributions_hand_id per hand is one random read per hand (hand
     ids are random uuids): 7.5 s with 23,500 pages from disk, past the
     service role's 8 s. The attributions written from a day before the
     window on are now one range of idx_rake_attributions_created_cover,
     grouped by hand, and a hand that range holds nothing for is still summed
     by hand id with no time window at all, so a late or back-dated
     attribution still belongs to its hand. On production every attribution
     carries its rake row's created_at exactly (29,880 hands checked, lead and
     lag both 0), so no hand has rows on both sides of the range start.
     rake_records holds one row per hand (uq_rake_records_hand_id), so one row
     per hand is exactly the old GROUP BY. Same rows, columns and rounding. */
  RETURN QUERY
  WITH r AS MATERIALIZED (
    SELECT rr.hand_id, rr.rake_amount
      FROM public.rake_records rr
     WHERE rr.rake_method = 'WEIGHTED_CONTRIBUTED'
       AND rr.hand_id IS NOT NULL
       AND rr.rake_amount > 0
       AND rr.player_contributions IS NOT NULL
       AND rr.created_at > v_since
  ), ra_window AS MATERIALIZED (
    SELECT ra.hand_id, sum(ra.weighted_rake_credit) AS credit
      FROM public.rake_attributions ra
     WHERE ra.created_at >= v_since - interval '1 day'
       AND ra.hand_id IN (SELECT r.hand_id FROM r)
     GROUP BY ra.hand_id
  ), j AS MATERIALIZED (
    SELECT r.hand_id,
           r.rake_amount,
           CASE WHEN w.hand_id IS NOT NULL THEN COALESCE(w.credit, 0)
                ELSE COALESCE((SELECT sum(a.weighted_rake_credit)
                                 FROM public.rake_attributions a
                                WHERE a.hand_id = r.hand_id), 0) END AS allocated
      FROM r
      LEFT JOIN ra_window w ON w.hand_id = r.hand_id
  )
  SELECT j.hand_id,
         j.rake_amount,
         j.allocated,
         round(j.rake_amount - j.allocated, 2) AS difference
    FROM j
   WHERE round(j.rake_amount - j.allocated, 2) <> 0;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_rake_attribution_drift(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rake_attribution_drift(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_exposure_watch(p_at timestamp with time zone DEFAULT clock_timestamp(), p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  c_source constant text := 'horse-exposure-watch';
  c_alert constant text := 'PersonBeatsHorsesBeyondTwoSE';
  c_tz constant text := 'America/Chicago';
  c_lookback constant interval := interval '60 days';
  c_z constant numeric := 2;
  c_min constant integer := 500;
  v_windows jsonb;
  v_flagged jsonb := '[]'::jsonb;
  v_checked integer := 0;
  v_run_id bigint;
  v_f jsonb;
  v_key text;
  v_id bigint;
  v_raised integer := 0;
  v_resolved integer := 0;
  v_summary text;
BEGIN
  -- 1. Every person's PLO4/PLO5 cash hands with at least one Horse dealt, newest first, at most 2,500 per
  --    person and game, from the last 60 days. Per hand, the person's chips won from (or lost to) the Horses:
  --    each loser's loss is shared among the winners in proportion to their wins, rake removed, so a person's
  --    flow from the Horses is net * (Horse losses / all losses) when the person won and net * (Horse wins /
  --    all losses) when the person lost. The EV-adjusted figure applies the same split to ev_net_bb (all-in
  --    equity; a hand without an all-in has ev = net).
  -- 2. Rolling windows of the newest 500, 1,000 and 2,500 hands (each read only when full) and every hand of
  --    the 60 days (read from 500 hands on): bb/100 with its standard error, real and EV-adjusted. A window
  --    FIRES when its EV-adjusted rate is above +2 SE. The breakdown is taken over the largest firing window.
  WITH x AS (
    SELECT * FROM smarter_private.fn_ca_horse_exposure_hands(p_at, 100000)
  ), w AS (
    -- win 0 = every hand of the 60 days (read from 500 hands on); 500/1,000/2,500 = the newest that many.
    SELECT x.user_id, x.game, n.win,
           count(*) AS hands,
           100 * avg(x.x_real) AS real_bb100, 100 * stddev_samp(x.x_real) / sqrt(count(*)::numeric) AS real_se,
           100 * avg(x.x_ev) AS ev_bb100, 100 * stddev_samp(x.x_ev) / sqrt(count(*)::numeric) AS ev_se,
           min(x.played_at) AS from_at, max(x.played_at) AS to_at
      FROM x
      CROSS JOIN (VALUES (500), (1000), (2500), (0)) AS n(win)
     WHERE n.win = 0 OR x.rn <= n.win
     GROUP BY x.user_id, x.game, n.win
    HAVING (n.win > 0 AND count(*) = n.win) OR (n.win = 0 AND count(*) >= c_min)
  ), j AS (
    SELECT user_id, game,
           jsonb_agg(jsonb_build_object('window', CASE WHEN win = 0 THEN 'all_60_days' ELSE win::text END,
                     'hands', hands, 'real_bb100', round(real_bb100, 1), 'real_se', round(real_se, 1),
                     'ev_bb100', round(ev_bb100, 1), 'ev_se', round(ev_se, 1),
                     'fires', ev_se > 0 AND ev_bb100 > c_z * ev_se,
                     'from', from_at, 'to', to_at) ORDER BY (win = 0), win) AS windows,
           max(hands) FILTER (WHERE ev_se > 0 AND ev_bb100 > c_z * ev_se) AS fire_win
      FROM w GROUP BY user_id, game
  )
  SELECT (SELECT count(*) FROM (SELECT DISTINCT x.user_id, x.game FROM x) d),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', j.user_id, 'game', j.game, 'windows', j.windows,
                     'fire_window', j.fire_win,
                     'hand_ids', (SELECT jsonb_agg(x.hand_id) FROM x WHERE x.user_id = j.user_id AND x.game = j.game AND x.rn <= j.fire_win))
                     ORDER BY j.game, j.user_id)
                     FROM j WHERE j.fire_win IS NOT NULL), '[]'::jsonb)
    INTO v_checked, v_flagged;

  -- 3. The leak breakdown of each flagged person over its largest firing window, per Horse they shared a hand
  --    with: the channel is how that Horse's part of the hand ended (hand over preflop; all-in by either; the
  --    Horse folded on a street; called to a showdown; won without a showdown), and the table/Lightning split.
  IF jsonb_array_length(v_flagged) > 0 THEN
    -- ONE HAND AT A TIME (2026-11-27). Every read below is keyed by the hand it is working on: the hand's
    -- history row by its primary key, its facts by ca_hand_facts_pkey, its Lightning row by hand_number. The
    -- earlier form joined CTEs of the whole window to each other, and with a one-row estimate the planner
    -- rescanned a window CTE for every row of another: 300 hands took 42 s, the 13,629 hands of the first
    -- flagged person never finished. The rows and the arithmetic are the same as before.
    SELECT jsonb_agg((fl - 'hand_ids') || jsonb_build_object('breakdown', b.channels, 'by_mode', b.modes)) INTO v_flagged
      FROM jsonb_array_elements(v_flagged) fl
      CROSS JOIN LATERAL (
        WITH pairs AS MATERIALIZED (
          SELECT hh.ltg, pr.channel, pr.hand_id, pr.r, pr.ev
            FROM jsonb_array_elements(fl->'hand_ids') h
            CROSS JOIN LATERAL (SELECT (h #>> '{}')::uuid AS hand_id) w
            CROSS JOIN LATERAL (
              SELECT -- lightning_hand is read by its unique hand_number index (it has no index on hand_history_id).
                     EXISTS (SELECT 1 FROM public.lightning_hand lh
                              WHERE lh.hand_number = hx.hand_number AND lh.hand_history_id = hx.id) AS ltg,
                     (SELECT max(CASE a->>'stage' WHEN 'flop' THEN 1 WHEN 'turn' THEN 2 WHEN 'river' THEN 3 ELSE 0 END)
                        FROM jsonb_array_elements(hx.actions) a WHERE COALESCE(a->>'origin', '') <> 'forced') AS es,
                     hx.actions
                FROM public.hand_history hx
               WHERE hx.id = w.hand_id
            ) hh
            CROSS JOIN LATERAL (
              WITH hs AS MATERIALIZED (
                SELECT f.user_id, f.seat, COALESCE(p.is_horse, false) AS horse, f.net_bb::numeric AS n,
                       COALESCE(f.ev_net_bb, f.net_bb)::numeric AS e, f.was_all_in, f.went_to_showdown
                  FROM public.ca_hand_facts f
                  LEFT JOIN public.profiles p ON p.id = f.user_id
                 WHERE f.hand_id = w.hand_id
              ), t AS (
                SELECT sum(greatest(-hs.n, 0)) AS l_real, sum(greatest(-hs.e, 0)) AS l_ev FROM hs
              )
              SELECT CASE WHEN COALESCE(hh.es, 0) = 0 THEN 'preflop'
                          WHEN x.was_all_in OR p.was_all_in THEN 'all_in'
                          WHEN fs.st IS NOT NULL THEN 'horse_fold_' || (ARRAY['preflop', 'flop', 'turn', 'river'])[fs.st + 1]
                          WHEN x.went_to_showdown THEN 'calls_to_showdown'
                          ELSE 'horse_won_no_showdown' END AS channel,
                     w.hand_id,
                     CASE WHEN t.l_real > 0 AND p.n > 0 AND x.n < 0 THEN p.n * (-x.n) / t.l_real
                          WHEN t.l_real > 0 AND p.n < 0 AND x.n > 0 THEN p.n * x.n / t.l_real ELSE 0 END AS r,
                     CASE WHEN t.l_ev > 0 AND p.e > 0 AND x.e < 0 THEN p.e * (-x.e) / t.l_ev
                          WHEN t.l_ev > 0 AND p.e < 0 AND x.e > 0 THEN p.e * x.e / t.l_ev ELSE 0 END AS ev
                FROM hs p
                JOIN hs x ON x.horse
                CROSS JOIN t
                LEFT JOIN LATERAL (
                  SELECT min(CASE a->>'stage' WHEN 'preflop' THEN 0 WHEN 'flop' THEN 1 WHEN 'turn' THEN 2 WHEN 'river' THEN 3 END) AS st
                    FROM jsonb_array_elements(hh.actions) a
                   WHERE (a->>'seat')::integer = x.seat AND a->>'action' = 'fold') fs ON true
               WHERE p.user_id = (fl->>'user_id')::uuid
            ) pr
        ), per_hand AS (
          SELECT channel, hand_id, sum(r) AS r, sum(ev) AS ev FROM pairs GROUP BY channel, hand_id
        )
        SELECT (SELECT jsonb_object_agg(channel, jsonb_build_object('hands', n, 'real_bb', round(r, 1), 'ev_bb', round(ev, 1)))
                  FROM (SELECT channel, count(*) AS n, sum(r) AS r, sum(ev) AS ev FROM per_hand GROUP BY channel) c) AS channels,
               (SELECT jsonb_object_agg(CASE WHEN ltg THEN 'lightning' ELSE 'table' END,
                         jsonb_build_object('real_bb', round(r, 1), 'ev_bb', round(ev, 1)))
                  FROM (SELECT ltg, sum(r) AS r, sum(ev) AS ev FROM pairs GROUP BY ltg) m) AS modes
      ) b;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'at', p_at, 'checked', v_checked, 'flagged', v_flagged);
  END IF;

  INSERT INTO smarter_private.ca_horse_exposure_runs (ran_at, checked, flagged, result)
  VALUES (p_at, v_checked, jsonb_array_length(v_flagged), v_flagged)
  RETURNING id INTO v_run_id;

  -- 4. One alert per person and game per episode (warning, never a page: fn_ca_owner_page_kind maps nothing
  --    from this source). A repeat while it fires only bumps the receipt; after it resolves a new key alerts again.
  FOR v_f IN SELECT * FROM jsonb_array_elements(v_flagged) LOOP
    v_key := 'exposure:' || (v_f->>'game') || ':' || (v_f->>'user_id');
    IF EXISTS (SELECT 1 FROM public.operational_alert_events
                WHERE source = c_source AND event_key = v_key AND status <> 'firing') THEN
      v_key := v_key || ':' || to_char(p_at AT TIME ZONE c_tz, 'YYYYMMDDHH24MI');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.operational_alert_events
                    WHERE source = c_source AND status = 'firing'
                      AND payload->>'user_id' = v_f->>'user_id' AND payload->>'game' = v_f->>'game') THEN
      v_raised := v_raised + 1;
    END IF;
    v_summary := format('A person is beating the %s cash Horses beyond 2 SE: EV-adjusted %s ± %s bb/100 over the last %s hands against Horses (real chips %s bb/100). Analysis only: no Horse decision changes from this alert. Breakdown attached.',
      upper(v_f->>'game'),
      (SELECT w->>'ev_bb100' FROM jsonb_array_elements(v_f->'windows') w WHERE (w->>'hands')::integer = (v_f->>'fire_window')::integer LIMIT 1),
      (SELECT w->>'ev_se' FROM jsonb_array_elements(v_f->'windows') w WHERE (w->>'hands')::integer = (v_f->>'fire_window')::integer LIMIT 1),
      v_f->>'fire_window',
      (SELECT w->>'real_bb100' FROM jsonb_array_elements(v_f->'windows') w WHERE (w->>'hands')::integer = (v_f->>'fire_window')::integer LIMIT 1));
    v_id := public.fn_record_operational_alert(c_source, v_key, c_alert, 'firing', 'warning', jsonb_build_object(
      'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
      'summary', left(v_summary, 1000), 'user_id', v_f->>'user_id', 'game', v_f->>'game',
      'windows', v_f->'windows', 'fire_window', v_f->'fire_window', 'breakdown', v_f->'breakdown',
      'by_mode', v_f->'by_mode', 'run_id', v_run_id, 'at', p_at,
      'rule', 'EV-adjusted bb/100 against Horses above +2 SE over the newest 500, 1,000 or 2,500 PLO4/PLO5 cash hands or over every hand of the last 60 days (at least 500); analysis trigger only'));
  END LOOP;

  WITH closed AS (
    UPDATE public.operational_alert_events e
       SET status = 'resolved', last_received_at = p_at,
           payload = e.payload || jsonb_build_object('resolved_at', p_at,
             'resolution', format('the %s Central run found no window above +2 SE', to_char(p_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI')))
     WHERE e.source = c_source AND e.alertname = c_alert AND e.status = 'firing'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_flagged) fl
                        WHERE fl->>'user_id' = e.payload->>'user_id' AND fl->>'game' = e.payload->>'game')
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM closed;

  UPDATE smarter_private.ca_horse_exposure_runs SET raised = v_raised, resolved = v_resolved WHERE id = v_run_id;
  RETURN jsonb_build_object('ok', true, 'at', p_at, 'checked', v_checked, 'flagged', jsonb_array_length(v_flagged),
                            'raised', v_raised, 'resolved', v_resolved, 'run_id', v_run_id);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean) TO service_role;


-- @probe-for: public.fn_bbj_contributions_total
DO $probe$
DECLARE
  v numeric;
BEGIN
  v := public.fn_bbj_contributions_total();
  IF v IS NULL THEN
    RAISE EXCEPTION 'contributions total probe returned NULL';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_bbj_contributions_total_advance
DO $probe$
BEGIN
  -- Moves the bookkeeping checkpoint at most to an hour ago; the unwind below
  -- undoes it with everything else this block did.
  PERFORM public.fn_bbj_contributions_total_advance();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_bbj_conservation_check
DO $probe$
DECLARE
  v jsonb;
BEGIN
  v := public.fn_bbj_conservation_check();
  IF jsonb_typeof(v) <> 'object' OR NOT (v ? 'healthy') OR NOT (v ? 'epoch') OR (v->'lifetime') IS NULL THEN
    RAISE EXCEPTION 'conservation check probe returned %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_rake_attribution_drift
DO $probe$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.fn_rake_attribution_drift(1);
  IF v_n IS NULL OR v_n < 0 THEN
    RAISE EXCEPTION 'rake attribution drift probe returned %', v_n;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_horse_exposure_watch
DO $probe$
DECLARE
  v jsonb;
BEGIN
  -- A dry run at an instant with no hands: it reads, writes nothing, raises nothing.
  v := public.fn_ca_horse_exposure_watch('2000-01-01 00:00:00+00'::timestamptz, true);
  IF NOT (v->>'ok')::boolean OR NOT (v->>'dry_run')::boolean OR jsonb_typeof(v->'flagged') <> 'array' THEN
    RAISE EXCEPTION 'horse exposure watch probe returned %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
