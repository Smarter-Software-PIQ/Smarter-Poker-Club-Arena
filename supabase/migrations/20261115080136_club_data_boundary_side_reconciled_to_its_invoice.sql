-- 20261115080136_club_data_boundary_side_reconciled_to_its_invoice
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 08:01:36 UTC.
--
-- A WEEK BOUNDARY'S CARRIED TOURNAMENT ENTRIES ARE LOADED WHEN THE KEPT
-- CERTIFICATE RECONCILES THE WEEK TO ITS INVOICE TO THE CENT (audit finding
-- D1, 2026-11-15; owner: Club Data must match the Midway union invoices 1:1).
--
-- WHAT WAS WRONG: fn_ca_club_acct_load_boundary (20261115020010) loads a
-- side of a week boundary only from a pnl_boundary certificate version
-- certified before that week's invoice was created
-- (fn_ca_union_pnl_boundary_for_invoice). The certificates were kept only
-- from 2026-11-15 (20261115015159), so for most past weeks the kept version
-- was certified AFTER the invoice and the side loaded nothing: the week's
-- tournament results then lacked exactly the entries still running at the
-- boundary, and the week read "not invoice-exact". Measured on production
-- (read-only, 2026-11-15 08:15Z), week 2026-10-19..10-26: the model's week
-- total plus the kept 10-26 certificate's entries equals each invoice's
-- players_won to the cent (Deep Stack -1,219,999.26 + 30,951.54 =
-- -1,189,047.72; The Felt Society -814,844.11 + 21,584.63 = -793,259.48;
-- KINGS CLUB -812,742.03 + 17,564.43 = -795,177.60; Midway house 7,449.31 +
-- 300.00 = 7,749.31; Club Savage 0 = 0).
--
-- WHAT THIS CHANGES (report-side read model only; no money, ledger, rake,
-- invoice, settlement or certificate row or rule):
--   * fn_ca_club_acct_verify_week(union, week start): for an invoiced week
--     whose opening or closing side is not invoice-exact, every day of the
--     week loaded (or live) and the kept certificates of both boundaries
--     present, it takes the earliest kept version for each side that is not
--     exact and loads it ONLY IF, for every club of the week's invoices (and
--     every club the model holds for the week), model week result + those
--     entries = the invoice's stored players_won to the cent. The side is
--     then exact with basis 'reconciled_to_invoice'; otherwise nothing
--     changes and the answer names each club's difference.
--   * fn_ca_club_acct_load_boundary records each side's basis
--     ('invoice_version', 'latest_version' before an invoice exists, NULL
--     when it loaded nothing) and, for a side it could not load, asks
--     fn_ca_club_acct_verify_week for the adjacent week (so a certificate
--     that arrives after its week's invoice reconciles at once, through the
--     existing capture trigger). A verification that raises never fails the
--     load or the certificate.
--   * The history load (club-data-accounting-seed.mjs) loads every kept
--     boundary again after its days, so weeks reconcile once their days are
--     loaded. No timer.
--
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_verify_week(uuid,timestamptz)') IS NOT NULL
-- @live-proof: EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ca_club_acct_boundary_log' AND column_name = 'closing_basis')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $prerequisite$ BEGIN
  IF to_regprocedure('public.fn_ca_club_acct_load_boundary(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_PREREQUISITE_MISSING: install 20261115020010 first';
  END IF;
END $prerequisite$;

ALTER TABLE public.ca_club_acct_boundary_log
  ADD COLUMN opening_basis text CHECK (opening_basis IN ('invoice_version', 'latest_version', 'reconciled_to_invoice')),
  ADD COLUMN closing_basis text CHECK (closing_basis IN ('invoice_version', 'latest_version', 'reconciled_to_invoice'));
COMMENT ON COLUMN public.ca_club_acct_boundary_log.opening_basis IS
  'invoice_version: the version the week''s invoice could have used; latest_version: no invoice yet; reconciled_to_invoice: the earliest kept version, loaded because it reconciles the week to its invoice per club to the cent (fn_ca_club_acct_verify_week); NULL: nothing loaded (not exact).';

CREATE FUNCTION public.fn_ca_club_acct_verify_week(p_union uuid, p_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_end timestamptz; d0 date; d1 date; v_live date;
  v_open_exact boolean; v_close_exact boolean;
  v_open public.ca_union_pnl_boundary_capture; v_close public.ca_union_pnl_boundary_capture;
  v_rows jsonb := '[]'::jsonb; v_open_rows jsonb := '[]'::jsonb; v_close_rows jsonb := '[]'::jsonb;
  v_missing int; v_diffs jsonb; v_bad int;
BEGIN
  SELECT sp.end_at INTO v_end
    FROM public.settlement_periods sp
   WHERE sp.union_id = p_union AND sp.start_at = p_start
     AND EXISTS (SELECT 1 FROM public.settlement_invoices si WHERE si.period_id = sp.id
                   AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled')
   ORDER BY sp.end_at LIMIT 1;
  IF v_end IS NULL THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'no_invoice');
  END IF;
  SELECT COALESCE(g.opening_exact, false) INTO v_open_exact FROM public.ca_club_acct_boundary_log g
   WHERE g.union_id = p_union AND g.boundary = p_start;
  SELECT COALESCE(g.closing_exact, false) INTO v_close_exact FROM public.ca_club_acct_boundary_log g
   WHERE g.union_id = p_union AND g.boundary = v_end;
  v_open_exact := COALESCE(v_open_exact, false); v_close_exact := COALESCE(v_close_exact, false);
  IF v_open_exact AND v_close_exact THEN
    RETURN jsonb_build_object('verified', true, 'reason', 'already_exact');
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:b:' || public.fn_ca_club_acct_boundary_key(p_union, p_start), 0))
     OR NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:b:' || public.fn_ca_club_acct_boundary_key(p_union, v_end), 0)) THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'boundary_busy');
  END IF;

  d0 := public.fn_ca_accounting_day(p_start);
  d1 := public.fn_ca_accounting_day(v_end - interval '1 microsecond');
  SELECT public.fn_ca_accounting_day(s.live_from) INTO v_live FROM public.ca_club_acct_state s;
  SELECT count(*) INTO v_missing
    FROM generate_series(d0, d1, interval '1 day') g(d)
   WHERE (v_live IS NULL OR g.d::date <= v_live)
     AND NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = g.d::date);
  IF v_missing > 0 OR EXISTS (SELECT 1 FROM public.ca_club_acct_projection_failures pf
                               WHERE pf.resolved_at IS NULL AND pf.acct_day BETWEEN d0 AND d1
                                 AND pf.source NOT LIKE 'pnl_boundary%') THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'days_not_whole', 'missing_days', v_missing);
  END IF;

  IF NOT v_open_exact THEN
    SELECT k.* INTO v_open FROM public.ca_union_pnl_boundary_capture k
     WHERE k.union_id = p_union AND k.boundary = p_start ORDER BY k.certified_at, k.captured_at LIMIT 1;
    IF v_open.union_id IS NULL THEN
      RETURN jsonb_build_object('verified', false, 'reason', 'no_kept_certificate', 'boundary', p_start);
    END IF;
    v_open_rows := public.fn_ca_club_acct_boundary_rows(p_union, p_start, v_open.value, d0, -1);
  END IF;
  IF NOT v_close_exact THEN
    SELECT k.* INTO v_close FROM public.ca_union_pnl_boundary_capture k
     WHERE k.union_id = p_union AND k.boundary = v_end ORDER BY k.certified_at, k.captured_at LIMIT 1;
    IF v_close.union_id IS NULL THEN
      RETURN jsonb_build_object('verified', false, 'reason', 'no_kept_certificate', 'boundary', v_end);
    END IF;
    v_close_rows := public.fn_ca_club_acct_boundary_rows(p_union, v_end, v_close.value, d1, 1);
  END IF;
  v_rows := v_open_rows || v_close_rows;

  WITH model AS (
    SELECT f.club_id, f.result FROM public.ca_club_acct_fact f
     WHERE f.union_id = p_union AND f.acct_day BETWEEN d0 AND d1
       -- a side that is not exact is replaced by its candidate below
       AND NOT (f.src = 2 AND ((NOT v_open_exact AND f.acct_day = d0 AND f.last_at = p_start)
                            OR (NOT v_close_exact AND f.acct_day = d1 AND f.last_at = v_end)))
    UNION ALL
    SELECT j.club_id, j.result FROM public.ca_club_acct_fact_journal j
     WHERE j.union_id = p_union AND j.acct_day BETWEEN d0 AND d1
    UNION ALL
    SELECT (x->>'club_id')::uuid, (x->>'result')::numeric FROM jsonb_array_elements(v_rows) x
  ), m AS (
    SELECT club_id, round(sum(result), 2) AS r FROM model GROUP BY club_id
  ), inv AS (
    SELECT si.club_id, round((si.breakdown->>'players_won')::numeric, 2) AS pw
      FROM public.settlement_invoices si JOIN public.settlement_periods sp ON sp.id = si.period_id
     WHERE sp.union_id = p_union AND sp.start_at = p_start AND sp.end_at = v_end
       AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled'
  )
  SELECT jsonb_agg(jsonb_build_object('club_id', COALESCE(inv.club_id, m.club_id), 'invoice', inv.pw, 'model', m.r,
                                      'difference', COALESCE(m.r, 0) - COALESCE(inv.pw, 0))
                   ORDER BY COALESCE(inv.club_id, m.club_id)),
         count(*) FILTER (WHERE COALESCE(m.r, 0) <> COALESCE(inv.pw, 0) OR inv.pw IS NULL AND m.r <> 0)
    INTO v_diffs, v_bad
    FROM inv FULL JOIN m ON m.club_id = inv.club_id;

  IF v_bad > 0 OR v_diffs IS NULL THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'does_not_reconcile', 'clubs', v_diffs);
  END IF;

  DELETE FROM public.ca_club_acct_fact f
   WHERE f.src = 2 AND f.union_id = p_union
     AND ((NOT v_open_exact AND f.acct_day = d0 AND f.last_at = p_start)
       OR (NOT v_close_exact AND f.acct_day = d1 AND f.last_at = v_end));
  PERFORM public.fn_ca_club_acct_put(v_rows, 2::smallint);
  IF NOT v_open_exact THEN
    UPDATE public.ca_club_acct_boundary_log g
       SET opening_md5 = v_open.value_md5, opening_exact = true, opening_basis = 'reconciled_to_invoice',
           fact_rows = g.fact_rows + jsonb_array_length(v_open_rows), loaded_at = clock_timestamp()
     WHERE g.union_id = p_union AND g.boundary = p_start;
  END IF;
  IF NOT v_close_exact THEN
    UPDATE public.ca_club_acct_boundary_log g
       SET closing_md5 = v_close.value_md5, closing_exact = true, closing_basis = 'reconciled_to_invoice',
           fact_rows = g.fact_rows + jsonb_array_length(v_close_rows), loaded_at = clock_timestamp()
     WHERE g.union_id = p_union AND g.boundary = v_end;
  END IF;
  RETURN jsonb_build_object('verified', true, 'reason', 'reconciled_to_invoice', 'clubs', v_diffs,
                            'opening_loaded', NOT v_open_exact, 'closing_loaded', NOT v_close_exact);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_load_boundary(p_union uuid, p_boundary timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_open_day date := public.fn_ca_accounting_day(p_boundary);
  v_close_day date := public.fn_ca_accounting_day(p_boundary - interval '1 microsecond');
  v_open_issued timestamptz; v_close_issued timestamptz;
  v_open public.ca_union_pnl_boundary_capture; v_close public.ca_union_pnl_boundary_capture;
  v_rows jsonb := '[]'::jsonb;
  v_prev_start timestamptz; v_n bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:b:' || public.fn_ca_club_acct_boundary_key(p_union, p_boundary), 0)) THEN
    RETURN NULL;
  END IF;
  SELECT min(si.created_at) INTO v_open_issued
    FROM public.settlement_invoices si JOIN public.settlement_periods sp ON sp.id = si.period_id
   WHERE sp.union_id = p_union AND sp.start_at = p_boundary
     AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled';
  SELECT min(si.created_at), min(sp.start_at) INTO v_close_issued, v_prev_start
    FROM public.settlement_invoices si JOIN public.settlement_periods sp ON sp.id = si.period_id
   WHERE sp.union_id = p_union AND sp.end_at = p_boundary
     AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled';
  v_open := public.fn_ca_union_pnl_boundary_for_invoice(p_union, p_boundary, COALESCE(v_open_issued, 'infinity'));
  v_close := public.fn_ca_union_pnl_boundary_for_invoice(p_union, p_boundary, COALESCE(v_close_issued, 'infinity'));

  DELETE FROM public.ca_club_acct_fact f
   WHERE f.src = 2 AND f.union_id = p_union AND f.last_at = p_boundary AND f.acct_day IN (v_open_day, v_close_day);
  IF v_open.union_id IS NOT NULL THEN
    v_rows := v_rows || public.fn_ca_club_acct_boundary_rows(p_union, p_boundary, v_open.value, v_open_day, -1);
  END IF;
  IF v_close.union_id IS NOT NULL THEN
    v_rows := v_rows || public.fn_ca_club_acct_boundary_rows(p_union, p_boundary, v_close.value, v_close_day, 1);
  END IF;
  PERFORM public.fn_ca_club_acct_put(v_rows, 2::smallint);

  INSERT INTO public.ca_club_acct_boundary_log AS g
    (union_id, boundary, opening_md5, opening_exact, closing_md5, closing_exact, fact_rows, loaded_at,
     opening_basis, closing_basis)
  VALUES (p_union, p_boundary, v_open.value_md5, v_open.union_id IS NOT NULL,
          v_close.value_md5, v_close.union_id IS NOT NULL, jsonb_array_length(v_rows), clock_timestamp(),
          CASE WHEN v_open.union_id IS NULL THEN NULL WHEN v_open_issued IS NULL THEN 'latest_version' ELSE 'invoice_version' END,
          CASE WHEN v_close.union_id IS NULL THEN NULL WHEN v_close_issued IS NULL THEN 'latest_version' ELSE 'invoice_version' END)
  ON CONFLICT (union_id, boundary) DO UPDATE
     SET opening_md5 = EXCLUDED.opening_md5, opening_exact = EXCLUDED.opening_exact,
         closing_md5 = EXCLUDED.closing_md5, closing_exact = EXCLUDED.closing_exact,
         fact_rows = EXCLUDED.fact_rows, loaded_at = EXCLUDED.loaded_at,
         opening_basis = EXCLUDED.opening_basis, closing_basis = EXCLUDED.closing_basis;
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.source LIKE 'pnl_boundary%' AND pf.resolved_at IS NULL
     AND pf.source_key = public.fn_ca_club_acct_boundary_key(p_union, p_boundary);
  v_n := jsonb_array_length(v_rows);

  -- A side that loaded nothing: reconcile its week to its invoice (D1). A
  -- verification that raises changes nothing and never fails this load.
  IF v_open.union_id IS NULL AND v_open_issued IS NOT NULL THEN
    BEGIN
      PERFORM public.fn_ca_club_acct_verify_week(p_union, p_boundary);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'club data boundary reconciliation for the week from % raised: % %', p_boundary, SQLSTATE, SQLERRM;
    END;
  END IF;
  IF v_close.union_id IS NULL AND v_prev_start IS NOT NULL THEN
    BEGIN
      PERFORM public.fn_ca_club_acct_verify_week(p_union, v_prev_start);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'club data boundary reconciliation for the week from % raised: % %', v_prev_start, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_club_acct_verify_week(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_load_boundary(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
