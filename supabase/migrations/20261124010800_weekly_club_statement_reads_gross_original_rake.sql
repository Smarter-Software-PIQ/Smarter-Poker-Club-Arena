-- 20261124010800_weekly_club_statement_reads_gross_original_rake.sql
--
-- WEEKLY CLUB ACCOUNTING SUMMARY AND RAKE SNAPSHOT READ GROSS ORIGINAL RAKE
-- (Incident 605ea9ca - union_accounting_scheduler; drift 378c5998).
--
-- ROOT CAUSE (proved read-only on production 2026-11-24):
-- Migration 20261116154831 narrowed public.accounting_payable_earning_sources.rake_credit
-- to COALESCE((s.contract->>'payable_rake_credit')::numeric, s.rake_credit)
-- (gross minus promo_excluded_credit) so agent commission and player rakeback
-- exclude promo-funded fees, while preserving gross original rake in
-- s.contract->>'rake_credit'.
--
-- PR #11870 (20261123202500) aligned fn_union_pnl_evidence_report and
-- fn_union_pnl_week_rake_straddle to read gross original rake. Downstream in
-- the same weekly union close, fn_issue_scope_weekly_accounting calls:
--   1. public.fn_club_weekly_accounting_summary(uuid)
--      - compares union_basis against close_row.totals->'basis_by_club' (gross)
--      - compares private_banked + private_burned against private_basis (gross)
--      - compares tournament_source_groups total against
--        accounting_tournament_fee_recognitions.net_rake (gross)
--   2. public.fn_capture_weekly_club_rake_snapshot(uuid)
--      - certifies source_fingerprint_v3, cash_rake, tournament_rake and
--        total_rake against the summary breakdown
--
-- Both still read payable s.rake_credit from accounting_payable_earning_sources.
-- On Midway Union (fade0000-0000-0000-0000-000000000001) week
-- 2026-11-16T08:00:00Z..2026-11-23T08:00:00Z, KINGS CLUB (a41434bb-8d0c-400a-8f0d-e8b3d65afed4,
-- 9,050 rows, 178 promo-excluded rows):
--   close_row.totals->'basis_by_club' (gross) = 11,352.96
--   payable s.rake_credit                     = 11,267.54
--   promo_excluded_credit (165 cash + 13 trn) =     85.42  (83.64 + 1.78)
--   gross COALESCE(contract->>'rake_credit')  = 11,352.96  (EXACT MATCH, fp f124a7756b7b4585b37d0655344db436)
--
-- FIX AT SOURCE:
--   1. In fn_club_weekly_accounting_summary(uuid), project gross original rake
--      COALESCE((a.contract->>'rake_credit')::numeric,a.rake_credit) in the
--      main basis/fingerprint subquery and in tournament_source_groups.
--   2. In fn_capture_weekly_club_rake_snapshot(uuid), project the identical
--      gross original rake so snapshot certification matches summary
--      bit-for-bit on source_fingerprint_v3 and totals.
--   3. Leave accounting_payable_earning_sources untouched so agent commission
--      and player rakeback continue excluding promo-funded fees.
--
-- @live-proof: position('GROSS ORIGINAL RAKE (20261124010800)' IN pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure)) > 0 AND position('GROSS ORIGINAL RAKE (20261124010800)' IN pg_get_functiondef('public.fn_capture_weekly_club_rake_snapshot(uuid)'::regprocedure)) > 0 AND md5(pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure)) IS DISTINCT FROM '0b5f87114dd95cb3f2b9802f20a564ec' AND md5(pg_get_functiondef('public.fn_capture_weekly_club_rake_snapshot(uuid)'::regprocedure)) IS DISTINCT FROM '5070d885fa29e226e4cb43370767a245'

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $apply_weekly_statement_gross_rake$
DECLARE
  c_summary  CONSTANT text := 'public.fn_club_weekly_accounting_summary(uuid)';
  c_snapshot CONSTANT text := 'public.fn_capture_weekly_club_rake_snapshot(uuid)';

  old_summary  CONSTANT text := '0b5f87114dd95cb3f2b9802f20a564ec';
  old_snapshot CONSTANT text := '5070d885fa29e226e4cb43370767a245';

  new_summary  text;
  new_snapshot text;

  d  text;
  p  text;
  a1 text;
  r1 text;
  a2 text;
  r2 text;
  m  jsonb;
  m2 jsonb;
  k1 integer;
  k2 integer;
  v_stale text;
BEGIN
  -- 1. Patch public.fn_club_weekly_accounting_summary(uuid) to read gross original rake
  --    for statement basis, fingerprint, and private tournament deposit proof.
  d := pg_get_functiondef(c_summary::regprocedure);
  IF md5(d) IS DISTINCT FROM old_summary THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_PREIMAGE_SUMMARY %', md5(d) USING ERRCODE = '55000';
  END IF;

  a1 :=
    E' FROM (\n'
    || E'  SELECT * FROM public.accounting_payable_earning_sources a\n'
    || E'   WHERE period.union_id IS NULL AND a.coordinator_union_id IS NULL\n'
    || E'  UNION ALL\n'
    || E'  SELECT * FROM public.accounting_payable_earning_sources a\n'
    || E'   WHERE period.union_id IS NOT NULL AND a.coordinator_union_id=period.union_id\n'
    || ' )s';

  r1 :=
    E' FROM (\n'
    || E'  -- GROSS ORIGINAL RAKE (20261124010800): reconcile statement basis and fingerprint against gross union close and bank receipts.\n'
    || E'  SELECT a.source_type,a.source_id,a.rake_record_id,a.club_id,a.union_id,a.earned_at,\n'
    || E'   COALESCE((a.contract->>''rake_credit'')::numeric,a.rake_credit) AS rake_credit\n'
    || E'  FROM public.accounting_payable_earning_sources a\n'
    || E'   WHERE period.union_id IS NULL AND a.coordinator_union_id IS NULL\n'
    || E'  UNION ALL\n'
    || E'  SELECT a.source_type,a.source_id,a.rake_record_id,a.club_id,a.union_id,a.earned_at,\n'
    || E'   COALESCE((a.contract->>''rake_credit'')::numeric,a.rake_credit) AS rake_credit\n'
    || E'  FROM public.accounting_payable_earning_sources a\n'
    || E'   WHERE period.union_id IS NOT NULL AND a.coordinator_union_id=period.union_id\n'
    || ' )s';

  a2 :=
    E'    SELECT e.rake_credit,e.club_id,e.union_id,e.coordinator_union_id,e.earned_at\n'
    || E'    FROM public.accounting_payable_earning_sources e\n'
    || '    WHERE e.tournament_id=k.source_group AND e.source_type=''tournament_fee_accrual''';

  r2 :=
    E'    SELECT COALESCE((e.contract->>''rake_credit'')::numeric,e.rake_credit) AS rake_credit,e.club_id,e.union_id,e.coordinator_union_id,e.earned_at\n'
    || E'    FROM public.accounting_payable_earning_sources e\n'
    || '    WHERE e.tournament_id=k.source_group AND e.source_type=''tournament_fee_accrual''';

  k1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  k2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  IF k1 IS DISTINCT FROM 1 OR k2 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_SUMMARY_ANCHOR_COUNT %/%', k1, k2 USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_summary::regprocedure;
  p := replace(replace(d, a1, r1), a2, r2);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_summary::regprocedure;
  new_summary := md5(pg_get_functiondef(c_summary::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_summary::regprocedure) <> p OR new_summary = old_summary THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_SUMMARY_POSTIMAGE %', new_summary USING ERRCODE = '55000';
  END IF;

  -- 2. Patch public.fn_capture_weekly_club_rake_snapshot(uuid) to project the exact same
  --    gross original rake so snapshot certification matches summary bit-for-bit.
  d := pg_get_functiondef(c_snapshot::regprocedure);
  IF md5(d) IS DISTINCT FROM old_snapshot THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_PREIMAGE_SNAPSHOT %', md5(d) USING ERRCODE = '55000';
  END IF;

  a1 :=
    E' FROM public.accounting_payable_earning_sources e WHERE e.club_id=inv.club_id\n'
    || '  AND e.coordinator_union_id IS NOT DISTINCT FROM u AND e.earned_at>=a AND e.earned_at<b;';

  r1 :=
    E' FROM (\n'
    || E'  -- GROSS ORIGINAL RAKE (20261124010800): match fn_club_weekly_accounting_summary gross basis and fingerprint.\n'
    || E'  SELECT s.source_type,s.source_id,s.rake_record_id,s.club_id,s.coordinator_union_id,s.earned_at,\n'
    || E'   COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit) AS rake_credit\n'
    || E'  FROM public.accounting_payable_earning_sources s WHERE s.club_id=inv.club_id\n'
    || E'   AND s.coordinator_union_id IS NOT DISTINCT FROM u AND s.earned_at>=a AND s.earned_at<b\n'
    || ' ) e;';

  k1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF k1 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_SNAPSHOT_ANCHOR_COUNT %', k1 USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_snapshot::regprocedure;
  p := replace(d, a1, r1);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_snapshot::regprocedure;
  new_snapshot := md5(pg_get_functiondef(c_snapshot::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_snapshot::regprocedure) <> p OR new_snapshot = old_snapshot THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_SNAPSHOT_POSTIMAGE %', new_snapshot USING ERRCODE = '55000';
  END IF;

  -- 3. Verify zero stale MD5 pins remain anywhere in pg_proc.
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES (old_summary), (old_snapshot)) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'WEEKLY_STMT_GROSS_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$apply_weekly_statement_gross_rake$;

-- @probe-for: public.fn_club_weekly_accounting_summary
-- @probe-for: public.fn_capture_weekly_club_rake_snapshot
DO $probe_weekly_statement_gross_rake$
DECLARE
  v_hit_summary  boolean := false;
  v_hit_snapshot boolean := false;
BEGIN
  BEGIN
    PERFORM public.fn_club_weekly_accounting_summary('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'probe-unwind-unexpected-summary';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_hit_summary := true;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM public.fn_capture_weekly_club_rake_snapshot('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'probe-unwind-unexpected-snapshot';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_hit_snapshot := true;
  END;

  IF NOT v_hit_summary OR NOT v_hit_snapshot THEN
    RAISE EXCEPTION 'probe-unwind-incomplete';
  END IF;

  BEGIN
    RAISE EXCEPTION 'probe-unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe-unwind' THEN
      RAISE;
    END IF;
  END;
END
$probe_weekly_statement_gross_rake$;

COMMIT;
