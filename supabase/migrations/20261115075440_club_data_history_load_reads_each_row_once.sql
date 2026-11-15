-- 20261115075440_club_data_history_load_reads_each_row_once
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 07:54:40 UTC.
--
-- CLUB DATA'S HISTORY LOAD READS EACH SOURCE ROW EXACTLY ONCE, AND A DAY IS
-- LOADED ONLY WHEN EVERY PART OF IT WAS (audit of 20261115063000, findings
-- D2 and D3, 2026-11-15; owner: Club Data must match the Midway union
-- invoices 1:1).
--
-- WHAT WAS WRONG:
--   D2. A slice counted a source row when its inserting xid was visible in
--       the day's snapshot S (pg_visible_in_snapshot(xmin, S)). A snapshot's
--       in-progress list names top-level transactions; a row written inside
--       a subtransaction (the money paths insert inside EXCEPTION blocks)
--       carries the SUBtransaction's xid, which is not in that list, so a
--       row whose parent was still open at S could read as visible: the
--       slice counted it, and the live projection counted it again when the
--       parent committed. finish resolved projection failures and read Bad
--       Beat Jackpot awards by the same test.
--   D3. begin commits the day's "minus the live rows" before the slices run,
--       and nothing recorded which slices ran: a slice sent twice counted its
--       rows twice, and finish logged the day loaded whatever slices ran. A
--       day after the live projection's own day would read whole while half
--       loaded (the reader calls a day missing only up to that day).
--
-- WHAT THIS CHANGES (functions and one new ledger table; no hot-table lock,
-- no money, ledger, rake, invoice or settlement row or rule):
--   * A slice reads only rows whose xmin precedes S's xmin
--     (fn_ca_club_acct_before_snapshot). Every transaction older than S's
--     xmin had ended at S, and a subtransaction's xid is always newer than
--     its parent's, so such a row is in S exactly when it is visible now.
--   * begin, inside S itself (its REPEATABLE READ transaction), reads the
--     day's rows whose xmin is S's xmin or newer: plain MVCC visibility in S,
--     correct for subtransactions by construction. It also reads the day's
--     Bad Beat Jackpot awards and resolves the day's projection failures in S
--     (both were finish's, by the in-snapshot test).
--   * begin refuses a day after the live projection's own accounting day
--     (those days are the live projection's alone).
--   * ca_club_acct_seed_parts records begin and every slice (day, start, end,
--     snapshot, counts); a slice sent twice is refused by its key, a slice
--     with no begin of the same snapshot is refused, and finish logs the day
--     only when the slices cover the day exactly, end to end, with begin's
--     snapshot. The counts logged are the ledger's.
-- Signatures are unchanged, so the seed script runs as it is. A day whose
-- begin ran before this installation has no ledger row: its slices and
-- finish are refused, and the next run loads it again (begin clears it).
--
-- Evidence that the days loaded before this change are not affected (read on
-- production 2026-11-15 08:10Z): no src 0 fact or hand row, no journal row
-- and no projection failure exists for any accounting day before 2026-11-14,
-- so no source row of those days was written after the live projection was
-- attached (05:10:45Z), i.e. none was in progress at any load's snapshot.
--
-- @live-proof: to_regclass('public.ca_club_acct_seed_parts') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_before_snapshot(xid,pg_snapshot)') IS NOT NULL
-- @live-proof: position('fn_ca_club_acct_before_snapshot' IN pg_get_functiondef('public.fn_ca_club_acct_seed_slice(date,timestamptz,timestamptz,pg_snapshot)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $prerequisite$ BEGIN
  IF to_regprocedure('public.fn_ca_club_acct_seed_slice(date,timestamptz,timestamptz,pg_snapshot)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_PREREQUISITE_MISSING: install 20261115063000 first';
  END IF;
END $prerequisite$;

CREATE TABLE public.ca_club_acct_seed_parts (
  acct_day     date        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('begin', 'slice')),
  part_lo      timestamptz NOT NULL,
  part_hi      timestamptz NOT NULL,
  snapshot     text        NOT NULL,
  fact_inputs  bigint      NOT NULL,
  hand_inputs  bigint      NOT NULL,
  unclassified bigint      NOT NULL,
  written_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (acct_day, kind, part_lo)
);
COMMENT ON TABLE public.ca_club_acct_seed_parts IS
  'The parts of a day''s history load (20261115075440): one begin row and one row per slice, all with the begin''s snapshot. finish logs the day only when the slices cover it exactly; begin clears the day''s rows.';
ALTER TABLE public.ca_club_acct_seed_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_acct_seed_parts FROM PUBLIC, anon, authenticated, service_role;

-- Whether the transaction that inserted a row ended before snapshot S began
-- (its xmin precedes S's xmin; frozen and bootstrap rows always did).
CREATE FUNCTION public.fn_ca_club_acct_before_snapshot(p_xmin xid, p_snap pg_snapshot)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  -- A 32-bit xmin lies within 2^31 of S's xmax either way (wraparound
  -- protection), so its signed distance from xmax's low 32 bits widens it to
  -- the full xid; a row inserted after S has a later xid than S's xmax.
  SELECT CASE
    WHEN p_xmin::text::bigint < 3 THEN true
    ELSE pg_snapshot_xmax(p_snap)::text::bigint
         + (((p_xmin::text::bigint - (pg_snapshot_xmax(p_snap)::text::bigint & 4294967295)) + 6442450944) % 4294967296 - 2147483648)
         < pg_snapshot_xmin(p_snap)::text::bigint
  END;
$function$;

-- One window of the day's sources. p_recent false: rows older than S's xmin
-- (a slice, any transaction). p_recent true: rows of S's xmin or newer, read
-- by begin inside S, where MVCC shows exactly those committed at S.
CREATE FUNCTION public.fn_ca_club_acct_seed_read(p_day date, p_lo timestamptz, p_hi timestamptz,
                                                 p_snap pg_snapshot, p_recent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v jsonb; f jsonb; n_f bigint := 0; n_h bigint := 0; n_unclassified bigint := 0;
BEGIN
  v := public.fn_ca_club_acct_cash_fee_rows((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'rake_record_id', s.rake_record_id, 'player_id', s.player_id,
             'club_id', s.club_id, 'union_id', s.union_id, 'earned_at', s.earned_at, 'rake_credit', s.rake_credit))
      FROM public.unions u
      CROSS JOIN LATERAL (SELECT x.* FROM public.accounting_cash_rake_sources x
                           WHERE x.union_id = u.id AND x.earned_at >= p_lo AND x.earned_at < p_hi
                             AND public.fn_ca_club_acct_before_snapshot(x.xmin, p_snap) <> p_recent) s));
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  v := public.fn_ca_club_acct_tournament_fee_rows((
    SELECT jsonb_agg(to_jsonb(rs)) FROM public.accounting_tournament_recognized_sources rs
     WHERE rs.recognized_at >= p_lo AND rs.recognized_at < p_hi
       AND public.fn_ca_club_acct_before_snapshot(rs.xmin, p_snap) <> p_recent));
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_touch_hands((
    SELECT jsonb_agg(to_jsonb(t)) FROM public.unions u
     CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_cash_outcome_touches x
                          WHERE x.game_union_id = u.id::text
                            AND x.recognized_at >= p_lo AND x.recognized_at < p_hi
                            AND public.fn_ca_club_acct_before_snapshot(x.xmin, p_snap) <> p_recent) t)));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
  n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands((
    SELECT jsonb_agg(public.fn_ca_club_acct_link_row(r)) FROM public.union_pnl_cash_outcome_link_resolutions r
      JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
     WHERE o.recognized_at >= p_lo AND o.recognized_at < p_hi AND r.game_scope->>'game_union_id' IS NOT NULL
       AND public.fn_ca_club_acct_before_snapshot(r.xmin, p_snap) <> p_recent)));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
  n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

  f := (SELECT jsonb_agg(to_jsonb(fl)) FROM public.unions u
         CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_original_flows x
                              WHERE x.game_scope->>'game_union_id' = u.id::text
                                AND x.recognized_at >= p_lo AND x.recognized_at < p_hi
                                AND NULLIF(x.game_scope->>'tournament_id', '') IS NOT NULL
                                AND public.fn_ca_club_acct_before_snapshot(x.xmin, p_snap) <> p_recent) fl);
  v := public.fn_ca_club_acct_flow_rows(f);
  n_unclassified := public.fn_ca_club_acct_flow_eligible(f) - jsonb_array_length(v);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  RETURN jsonb_build_object('fact_inputs', n_f, 'hand_inputs', n_h, 'unclassified_flows', n_unclassified);
END;
$function$;

-- Part 1: the day's snapshot S, its load rows and parts cleared, minus the
-- live rows in S, the journal folded, and inside S: the rows of S's xmin or
-- newer, the Bad Beat Jackpot awards and the projection failures.
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_seed_begin(p_day date, p_rebuild boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  v_snap pg_snapshot := pg_current_snapshot();
  v_live_day date;
  n_live bigint; n_fix bigint; v jsonb; r jsonb; n_bbj bigint;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load needs a day' USING ERRCODE = '22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'club data accounting load begins in one REPEATABLE READ transaction';
  END IF;
  SELECT public.fn_ca_accounting_day(s.live_from) INTO v_live_day FROM public.ca_club_acct_state s;
  IF v_live_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load waits for the live projection (20261115020011)';
  END IF;
  IF p_day > v_live_day THEN
    RAISE EXCEPTION 'accounting day % is after the live projection''s day %; the live projection holds it', p_day, v_live_day
      USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    IF NOT p_rebuild THEN RAISE EXCEPTION 'accounting day % is already loaded', p_day; END IF;
    DELETE FROM public.ca_club_acct_seed_log WHERE acct_day = p_day;
  END IF;
  DELETE FROM public.ca_club_acct_seed_parts WHERE acct_day = p_day;
  DELETE FROM public.ca_club_acct_fact WHERE acct_day = p_day AND src = 1;
  DELETE FROM public.ca_club_acct_hands WHERE acct_day = p_day AND src = 1;

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

  -- Inside S: the day's rows of S's xmin or newer.
  r := public.fn_ca_club_acct_seed_read(p_day, v_lo, v_hi, v_snap, true);

  -- Inside S: the day's Bad Beat Jackpot stack awards (few; all of them).
  v := COALESCE((
    SELECT jsonb_agg(x) FROM public.bbj_payout_recipients b
     CROSS JOIN LATERAL jsonb_array_elements(public.fn_ca_club_acct_bbj_rows(b.payout_id, b.user_id, b.created_at)) x
     WHERE b.created_at >= v_lo AND b.created_at < v_hi), '[]'::jsonb);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint);
  n_bbj := jsonb_array_length(v);

  -- Inside S: every projection failure of the day that S holds is made whole
  -- by this load (its source row is in S); a boundary's only by loading it.
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.acct_day = p_day AND pf.resolved_at IS NULL AND pf.source NOT LIKE 'pnl_boundary%';
  GET DIAGNOSTICS n_fix = ROW_COUNT;

  INSERT INTO public.ca_club_acct_seed_parts (acct_day, kind, part_lo, part_hi, snapshot, fact_inputs, hand_inputs, unclassified)
  VALUES (p_day, 'begin', v_lo, v_lo, v_snap::text, (r->>'fact_inputs')::bigint + n_bbj, (r->>'hand_inputs')::bigint,
          (r->>'unclassified_flows')::bigint);

  RETURN jsonb_build_object('acct_day', p_day, 'snapshot', v_snap::text, 'journal_rows_folded', n_live,
                            'recent', r, 'bbj_rows', n_bbj, 'failures_resolved', n_fix);
END;
$function$;

-- Part 2: one window of the day, the rows that ended before S's xmin. Once.
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_seed_slice(p_day date, p_lo timestamptz, p_hi timestamptz, p_snap pg_snapshot)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  r jsonb;
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
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_parts sp
                  WHERE sp.acct_day = p_day AND sp.kind = 'begin' AND sp.snapshot = p_snap::text) THEN
    RAISE EXCEPTION 'accounting day % has no load begun with snapshot %; begin it again', p_day, p_snap::text;
  END IF;
  -- The key refuses the same slice twice.
  INSERT INTO public.ca_club_acct_seed_parts (acct_day, kind, part_lo, part_hi, snapshot, fact_inputs, hand_inputs, unclassified)
  VALUES (p_day, 'slice', p_lo, p_hi, p_snap::text, 0, 0, 0);

  r := public.fn_ca_club_acct_seed_read(p_day, p_lo, p_hi, p_snap, false);
  UPDATE public.ca_club_acct_seed_parts sp
     SET fact_inputs = (r->>'fact_inputs')::bigint, hand_inputs = (r->>'hand_inputs')::bigint,
         unclassified = (r->>'unclassified_flows')::bigint
   WHERE sp.acct_day = p_day AND sp.kind = 'slice' AND sp.part_lo = p_lo;

  RETURN jsonb_build_object('acct_day', p_day, 'from', p_lo, 'to', p_hi, 'fact_inputs', (r->>'fact_inputs')::bigint,
                            'hand_inputs', (r->>'hand_inputs')::bigint, 'unclassified_flows', (r->>'unclassified_flows')::bigint);
END;
$function$;

-- Part 3: the day is logged only when its slices cover it exactly with
-- begin's snapshot. The counts are the ledger's (the arguments are kept for
-- the seed script's call and not trusted).
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_seed_finish(p_day date, p_snap pg_snapshot, p_unclassified bigint,
                                                              p_fact_inputs bigint, p_hand_inputs bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '240s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  v_gaps bigint; v_first timestamptz; v_last timestamptz; v_other bigint;
  n_f bigint; n_h bigint; n_u bigint;
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
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_parts sp
                  WHERE sp.acct_day = p_day AND sp.kind = 'begin' AND sp.snapshot = p_snap::text) THEN
    RAISE EXCEPTION 'accounting day % has no load begun with snapshot %; begin it again', p_day, p_snap::text;
  END IF;
  SELECT count(*) FILTER (WHERE sp.snapshot <> p_snap::text) INTO v_other
    FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day = p_day;
  SELECT count(*) FILTER (WHERE x.prev_hi IS DISTINCT FROM x.part_lo AND x.rn > 1), min(x.part_lo), max(x.part_hi)
    INTO v_gaps, v_first, v_last
    FROM (SELECT sp.part_lo, sp.part_hi, lag(sp.part_hi) OVER (ORDER BY sp.part_lo) AS prev_hi,
                 row_number() OVER (ORDER BY sp.part_lo) AS rn
            FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day = p_day AND sp.kind = 'slice') x;
  IF v_other > 0 OR v_gaps IS DISTINCT FROM 0 OR v_first IS DISTINCT FROM v_lo OR v_last IS DISTINCT FROM v_hi THEN
    RAISE EXCEPTION 'accounting day % is not covered exactly by its slices (% gap(s), from %, to %, % other snapshot row(s))',
      p_day, v_gaps, v_first, v_last, v_other;
  END IF;

  DELETE FROM public.ca_club_acct_fact z
   WHERE z.acct_day = p_day AND z.src = 1
     AND z.fee = 0 AND z.result = 0 AND z.buyins = 0 AND z.cashouts = 0 AND z.hands = 0;
  DELETE FROM public.ca_club_acct_hands z WHERE z.acct_day = p_day AND z.src = 1 AND z.hands = 0;

  SELECT sum(sp.fact_inputs), sum(sp.hand_inputs), sum(sp.unclassified) INTO n_f, n_h, n_u
    FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day = p_day;
  IF n_u > 0 THEN
    INSERT INTO public.ca_club_acct_projection_failures (source, acct_day, detail)
    VALUES ('tournament_flow_unclassified', p_day,
            n_u || ' posted union tournament flow(s) no receipt rule classifies (day load)');
  END IF;

  INSERT INTO public.ca_club_acct_seed_log (acct_day, fact_rows, hand_rows) VALUES (p_day, n_f, n_h);
  RETURN jsonb_build_object('acct_day', p_day, 'fact_inputs', n_f, 'hand_inputs', n_h, 'unclassified_flows', n_u);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_club_acct_before_snapshot(xid, pg_snapshot),
  public.fn_ca_club_acct_seed_read(date, timestamptz, timestamptz, pg_snapshot, boolean),
  public.fn_ca_club_acct_seed_begin(date, boolean),
  public.fn_ca_club_acct_seed_slice(date, timestamptz, timestamptz, pg_snapshot),
  public.fn_ca_club_acct_seed_finish(date, pg_snapshot, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
