-- 20261115063000_club_data_history_loads_a_day_in_bounded_parts
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 06:30:00 UTC.
--
-- CLUB DATA'S ACCOUNTING HISTORY LOADS A DAY IN BOUNDED PARTS (owner,
-- 2026-11-14: Club Data must match the Midway union invoices 1:1).
--
-- WHAT WAS WRONG (measured on production 2026-11-15, read-only):
-- fn_ca_club_acct_seed_day (20261115020010) loads one accounting day in ONE
-- REPEATABLE READ transaction. fn_ca_bound_outside_snapshots (20261006170925)
-- cancels any outside session whose snapshot is older than five minutes,
-- because a pinned horizon stalled the tables twice. A day's load does not
-- fit: 2026-09-17 ran 5 min 12 s (59,560 blocked-evidence touches at about
-- 21 ms each), 2026-09-18 passed five minutes (11,574), and 2026-10-24 (a
-- Saturday, 78 blocked) ran 5 min 13 s on volume alone: one two-hour slice of
-- 2026-10-25 00:00-02:00Z costs 16.3 s (52,263 cash fees 2.2 s, 15,770
-- touches 5.7 s, 11,183 link resolutions 7.8 s, 66,054 fact rows 0.5 s).
-- Every load was cancelled with nothing written; the November days are
-- heavier. So the history could never finish.
--
-- WHAT THIS CHANGES: a day is loaded as
--   fn_ca_club_acct_seed_begin(day, rebuild)       one REPEATABLE READ transaction
--   fn_ca_club_acct_seed_slice(day, lo, hi, snap)   one short transaction per slice
--   fn_ca_club_acct_seed_finish(day, snap, n, ...)  one short transaction
-- begin takes the day's snapshot S (pg_current_snapshot() of its REPEATABLE
-- READ transaction), clears the day's load rows (src 1), and in S writes
-- minus what the live projection holds for the day (src 0) and folds the
-- day's journal rows, exactly as the one-transaction load did. Each slice
-- then adds the source rows of its window WHOSE INSERTING TRANSACTION IS
-- VISIBLE IN S (fn_ca_club_acct_in_snapshot(xmin, S)), so the whole day is
-- counted as of S however long the slices take: a source row committed after
-- S is the live projection's alone (src 0, or a recorded failure), and a row
-- committed before S is in src 1 once with its live part subtracted in S.
-- This is the one-snapshot load's arithmetic with the reading spread over
-- transactions that each finish in well under a minute. finish adds the
-- day's Bad Beat Jackpot stack awards visible in S, removes all-zero rows,
-- resolves the day's live projection failures visible in S (a failure
-- recorded after S belongs to a row the load did not read and stays open),
-- records an unclassified tournament flow count as a failure, and writes the
-- load log. A day is complete only when its log row exists, so a stopped
-- load leaves the day reported missing; the next begin clears it again.
--
-- A frozen source row reports xmin 2 (FrozenTransactionId) and was committed
-- long before S; any other xmin is within 2^31 of S's xmax (wraparound
-- protection), so it is widened to xid8 against S's epoch.
--
-- Not changed: fn_ca_club_acct_seed_day (still a correct one-transaction load
-- for a light day), the live projection, the readers, any money, ledger,
-- rake, invoice or settlement row or rule. Functions only: no hot-table lock.
-- The seed script (scripts/ci/club-data-accounting-seed.mjs) loads every day
-- this way, two-hour slices.
--
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_seed_begin(date,boolean)') IS NOT NULL AND to_regprocedure('public.fn_ca_club_acct_seed_slice(date,timestamptz,timestamptz,pg_snapshot)') IS NOT NULL AND to_regprocedure('public.fn_ca_club_acct_seed_finish(date,pg_snapshot,bigint,bigint,bigint)') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $prerequisite$ BEGIN
  IF to_regprocedure('public.fn_ca_club_acct_seed_day(date,boolean)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_PREREQUISITE_MISSING: install 20261115020010 first';
  END IF;
END $prerequisite$;

-- Whether the transaction that inserted a row (its xmin) is visible in S.
CREATE FUNCTION public.fn_ca_club_acct_in_snapshot(p_xmin xid, p_snap pg_snapshot)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT CASE
    WHEN p_xmin::text::bigint < 3 THEN true   -- frozen (2) or bootstrap
    ELSE pg_visible_in_snapshot((
      CASE WHEN ((pg_snapshot_xmax(p_snap)::text::bigint >> 32) << 32) + p_xmin::text::bigint
                > pg_snapshot_xmax(p_snap)::text::bigint
           THEN ((pg_snapshot_xmax(p_snap)::text::bigint >> 32) << 32) + p_xmin::text::bigint - 4294967296
           ELSE ((pg_snapshot_xmax(p_snap)::text::bigint >> 32) << 32) + p_xmin::text::bigint END)::text::xid8,
      p_snap)
  END;
$function$;

-- Part 1: the day's snapshot, its load rows cleared, minus the live rows.
CREATE FUNCTION public.fn_ca_club_acct_seed_begin(p_day date, p_rebuild boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  n_live bigint;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load needs a day' USING ERRCODE = '22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'club data accounting load begins in one REPEATABLE READ transaction';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_state) THEN
    RAISE EXCEPTION 'club data accounting load waits for the live projection (20261115020011)';
  END IF;
  IF v_lo > now() THEN
    RAISE EXCEPTION 'accounting day % has not started', p_day USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    IF NOT p_rebuild THEN RAISE EXCEPTION 'accounting day % is already loaded', p_day; END IF;
    DELETE FROM public.ca_club_acct_seed_log WHERE acct_day = p_day;
  END IF;
  DELETE FROM public.ca_club_acct_fact WHERE acct_day = p_day AND src = 1;
  DELETE FROM public.ca_club_acct_hands WHERE acct_day = p_day AND src = 1;

  -- Minus what the live aggregate rows hold for the day in S; the day's
  -- journal rows in S are folded in (as fn_ca_club_acct_seed_day does).
  PERFORM public.fn_ca_club_acct_put((
    SELECT jsonb_agg(jsonb_build_object('club_id', f.club_id, 'acct_day', f.acct_day, 'kind', f.kind,
             'game_id', f.game_id, 'user_id', f.user_id, 'union_id', f.union_id, 'fee', -f.fee, 'result', -f.result,
             'buyins', -f.buyins, 'cashouts', -f.cashouts, 'hands', -f.hands, 'at', f.last_at))
      FROM public.ca_club_acct_fact f WHERE f.acct_day = p_day AND f.src = 0), 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands((
    SELECT jsonb_agg(jsonb_build_object('club_id', h.club_id, 'acct_day', h.acct_day, 'table_id', h.table_id,
             'hands', -h.hands))
      FROM public.ca_club_acct_hands h WHERE h.acct_day = p_day AND h.src = 0), 1::smallint);
  DELETE FROM public.ca_club_acct_fact_journal j WHERE j.acct_day = p_day;
  GET DIAGNOSTICS n_live = ROW_COUNT;
  DELETE FROM public.ca_club_acct_hands_journal j WHERE j.acct_day = p_day;

  RETURN jsonb_build_object('acct_day', p_day, 'snapshot', pg_current_snapshot()::text,
                            'journal_rows_folded', n_live);
END;
$function$;

-- Part 2: one window of the day, reading only source rows visible in S.
CREATE FUNCTION public.fn_ca_club_acct_seed_slice(p_day date, p_lo timestamptz, p_hi timestamptz, p_snap pg_snapshot)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  v jsonb; f jsonb; n_f bigint := 0; n_h bigint := 0; n_unclassified bigint := 0;
BEGIN
  IF p_day IS NULL OR p_lo IS NULL OR p_hi IS NULL OR p_snap IS NULL OR p_lo < v_lo OR p_hi > v_hi OR p_lo >= p_hi THEN
    RAISE EXCEPTION 'club data accounting slice [%, %) is not inside accounting day %', p_lo, p_hi, p_day
      USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    RAISE EXCEPTION 'accounting day % is already loaded; begin it again to rebuild it', p_day;
  END IF;

  v := public.fn_ca_club_acct_cash_fee_rows((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'rake_record_id', s.rake_record_id, 'player_id', s.player_id,
             'club_id', s.club_id, 'union_id', s.union_id, 'earned_at', s.earned_at, 'rake_credit', s.rake_credit))
      FROM public.unions u
      CROSS JOIN LATERAL (SELECT x.* FROM public.accounting_cash_rake_sources x
                           WHERE x.union_id = u.id AND x.earned_at >= p_lo AND x.earned_at < p_hi
                             AND public.fn_ca_club_acct_in_snapshot(x.xmin, p_snap)) s));
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  v := public.fn_ca_club_acct_tournament_fee_rows((
    SELECT jsonb_agg(to_jsonb(rs)) FROM public.accounting_tournament_recognized_sources rs
     WHERE rs.recognized_at >= p_lo AND rs.recognized_at < p_hi
       AND public.fn_ca_club_acct_in_snapshot(rs.xmin, p_snap)));
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_touch_hands((
    SELECT jsonb_agg(to_jsonb(t)) FROM public.unions u
     CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_cash_outcome_touches x
                          WHERE x.game_union_id = u.id::text
                            AND x.recognized_at >= p_lo AND x.recognized_at < p_hi
                            AND public.fn_ca_club_acct_in_snapshot(x.xmin, p_snap)) t)));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
  n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands((
    SELECT jsonb_agg(public.fn_ca_club_acct_link_row(r)) FROM public.union_pnl_cash_outcome_link_resolutions r
      JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
     WHERE o.recognized_at >= p_lo AND o.recognized_at < p_hi AND r.game_scope->>'game_union_id' IS NOT NULL
       AND public.fn_ca_club_acct_in_snapshot(r.xmin, p_snap))));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
  n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

  f := (SELECT jsonb_agg(to_jsonb(fl)) FROM public.unions u
         CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_original_flows x
                              WHERE x.game_scope->>'game_union_id' = u.id::text
                                AND x.recognized_at >= p_lo AND x.recognized_at < p_hi
                                AND NULLIF(x.game_scope->>'tournament_id', '') IS NOT NULL
                                AND public.fn_ca_club_acct_in_snapshot(x.xmin, p_snap)) fl);
  v := public.fn_ca_club_acct_flow_rows(f);
  n_unclassified := public.fn_ca_club_acct_flow_eligible(f) - jsonb_array_length(v);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  RETURN jsonb_build_object('acct_day', p_day, 'from', p_lo, 'to', p_hi, 'fact_inputs', n_f, 'hand_inputs', n_h,
                            'unclassified_flows', n_unclassified);
END;
$function$;

-- Part 3: the day's BBJ stack awards in S, clean-up, failures, the log row.
CREATE FUNCTION public.fn_ca_club_acct_seed_finish(p_day date, p_snap pg_snapshot, p_unclassified bigint,
                                                   p_fact_inputs bigint, p_hand_inputs bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  v jsonb; n_f bigint := COALESCE(p_fact_inputs, 0); n_fix bigint;
BEGIN
  IF p_day IS NULL OR p_snap IS NULL THEN
    RAISE EXCEPTION 'club data accounting finish needs a day and its snapshot' USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    RAISE EXCEPTION 'accounting day % is already loaded', p_day;
  END IF;

  v := COALESCE((
    SELECT jsonb_agg(x) FROM public.bbj_payout_recipients r
     CROSS JOIN LATERAL jsonb_array_elements(public.fn_ca_club_acct_bbj_rows(r.payout_id, r.user_id, r.created_at)) x
     WHERE r.created_at >= v_lo AND r.created_at < v_hi
       AND public.fn_ca_club_acct_in_snapshot(r.xmin, p_snap)), '[]'::jsonb);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  DELETE FROM public.ca_club_acct_fact z
   WHERE z.acct_day = p_day AND z.src = 1
     AND z.fee = 0 AND z.result = 0 AND z.buyins = 0 AND z.cashouts = 0 AND z.hands = 0;
  DELETE FROM public.ca_club_acct_hands z WHERE z.acct_day = p_day AND z.src = 1 AND z.hands = 0;

  -- The day is whole again for every live projection failure the load's
  -- snapshot held; a boundary's failures are resolved only by loading it.
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.acct_day = p_day AND pf.resolved_at IS NULL AND pf.source NOT LIKE 'pnl_boundary%'
     AND public.fn_ca_club_acct_in_snapshot(pf.xmin, p_snap);
  GET DIAGNOSTICS n_fix = ROW_COUNT;
  IF COALESCE(p_unclassified, 0) > 0 THEN
    INSERT INTO public.ca_club_acct_projection_failures (source, acct_day, detail)
    VALUES ('tournament_flow_unclassified', p_day,
            p_unclassified || ' posted union tournament flow(s) no receipt rule classifies (day load)');
  END IF;

  INSERT INTO public.ca_club_acct_seed_log (acct_day, fact_rows, hand_rows) VALUES (p_day, n_f, COALESCE(p_hand_inputs, 0));
  RETURN jsonb_build_object('acct_day', p_day, 'fact_inputs', n_f, 'hand_inputs', COALESCE(p_hand_inputs, 0),
                            'failures_resolved', n_fix, 'unclassified_flows', COALESCE(p_unclassified, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_club_acct_in_snapshot(xid, pg_snapshot),
  public.fn_ca_club_acct_seed_begin(date, boolean),
  public.fn_ca_club_acct_seed_slice(date, timestamptz, timestamptz, pg_snapshot),
  public.fn_ca_club_acct_seed_finish(date, pg_snapshot, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
