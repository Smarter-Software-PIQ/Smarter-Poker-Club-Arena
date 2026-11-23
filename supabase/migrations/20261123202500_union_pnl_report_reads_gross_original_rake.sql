-- 20261123202500_union_pnl_report_reads_gross_original_rake.sql
--
-- UNION P&L EVIDENCE REPORT AND BOUNDARY STRADDLE READ GROSS ORIGINAL RAKE
-- (Incident 605ea9ca - union_accounting_scheduler; drift 378c5998 and
-- 25365b5d union_eco_not_recorded).
--
-- ROOT CAUSE (proved read-only on production 2026-11-23, runs 45253851448
-- and 45258370142):
-- Migration 20261116154831 ("Promo-funded fees still fill the original 4x
-- target, but create no agent commission or player rakeback. Preserve gross
-- rake, bank evidence, immutable fee sources and historical agreements.
-- Change only the eligible earning basis.") changed
-- public.accounting_payable_earning_sources.rake_credit from gross rake to
-- COALESCE((s.contract->>'payable_rake_credit')::numeric, s.rake_credit),
-- which subtracts promo_excluded_credit so agent commission and player
-- rakeback exclude promo-funded fees while preserving gross rake inside
-- s.contract->>'rake_credit' (and keeping excluded gross in club_residual).
--
-- However, two consumers in the weekly union close still read s.rake_credit
-- from accounting_payable_earning_sources expecting gross original rake:
--   1. public.fn_union_pnl_evidence_report(uuid, timestamptz, timestamptz)
--      (its own comment states: "Gross original rake still belongs in the
--      all-player P&L and bank reconciliation.")
--   2. public.fn_union_pnl_week_rake_straddle(uuid, timestamptz, timestamptz)
--
-- Measured on Midway Union (fade0000-0000-0000-0000-000000000001) for the
-- first weekly close under prospective promo play-through
-- (2026-11-16T08:00:00Z .. 2026-11-23T08:00:00Z, 493,222 cash hands):
--   accepted_rake (union_pnl_cash_outcomes)        = 493,953.10
--   straddle (1 hand bae10b31 crossing 08:00Z)     =       0.85
--   payable_cash_rake (s.rake_credit)              = 493,868.61  (short 83.64)
--   cash_promo_excluded (165 rows)                 =      83.64
--   gross_cash_rake (contract->>'rake_credit')     = 493,952.25
--   accepted_rake - straddle - gross_cash_rake     =       0.00  (EXACT MATCH)
--   payable_tourn_rake / gross_tourn_rake          =  95,543.22 / 95,545.00
--   tourn_promo_excluded                           =       1.78
--
-- FIX AT SOURCE:
--   1. In fn_union_pnl_evidence_report's rake CTE, read gross original rake
--      COALESCE((s.contract->>'rake_credit')::numeric, s.rake_credit) for
--      generated, cash_rake, and tournament_rake while leaving earned
--      (fn_union_club_rake_basis) and accounting_payable_earning_sources
--      (agent commission and player rakeback) untouched.
--   2. In fn_union_pnl_week_rake_straddle, read the same gross original rake
--      so any promo-funded hand straddling a week boundary cancels cleanly on
--      both sides of accepted_rake - straddle = cash_rake.
--   3. Move the two downstream MD5 pins (fn_accounting_union_earned_plan_advance
--      and smarter_private.original_inventory_proof_sources_match) in the same
--      transaction and verify original_inventory_proof_sources_match() IS TRUE
--      with zero stale pins remaining in pg_proc.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND smarter_private.original_inventory_basis_generation() LIKE 'original-inventory-245-v1:%' AND position('GROSS ORIGINAL RAKE (20261123202500)' IN pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure)) > 0 AND position('GROSS ORIGINAL RAKE (20261123202500)' IN pg_get_functiondef('public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $apply_gross_rake_fix$
DECLARE
  c_report   CONSTANT text := 'public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)';
  c_straddle CONSTANT text := 'public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz)';
  c_adv      CONSTANT text := 'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)';
  c_psm      CONSTANT text := 'smarter_private.original_inventory_proof_sources_match()';

  old_report   CONSTANT text := '26cb0f6e4912cd3e8980f657bb52d50c';
  old_straddle CONSTANT text := '9e6e85c51b06dae44b0639ee843dfa56';
  old_adv      CONSTANT text := 'ba8d54bcf62c86357be6437421d1d45d';
  old_psm      text;

  new_report   text;
  new_straddle text;
  new_adv      text;

  d  text;
  p  text;
  a1 text;
  r1 text;
  m  jsonb;
  m2 jsonb;
  k  integer;
  v_stale text;
BEGIN
  -- 0. Verify preimages and healthy pin state before touching any function.
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'GROSS_RAKE_PREIMAGE_SOURCES_MISMATCH' USING ERRCODE = '55000';
  END IF;
  old_psm := md5(pg_get_functiondef(c_psm::regprocedure));

  d := pg_get_functiondef(c_report::regprocedure);
  IF md5(d) IS DISTINCT FROM old_report THEN
    RAISE EXCEPTION 'GROSS_RAKE_PREIMAGE_REPORT %', md5(d) USING ERRCODE = '55000';
  END IF;

  -- 1. Patch fn_union_pnl_evidence_report rake CTE to read gross original rake.
  a1 :=
    E' rake AS MATERIALIZED (\n'
    || E'  SELECT s.club_id,sum(s.rake_credit) generated,COALESCE(k.earned,0) earned,\n'
    || E'   sum(s.rake_credit) FILTER(WHERE s.source_type=''cash_rake_accrual'') cash_rake,\n'
    || E'   sum(s.rake_credit) FILTER(WHERE s.source_type=''tournament_fee_accrual'') tournament_rake\n'
    || E'  FROM public.accounting_payable_earning_sources s';
  r1 :=
    E' rake AS MATERIALIZED (\n'
    || E'  -- GROSS ORIGINAL RAKE (20261123202500): preserve gross original rake for\n'
    || E'  -- union P&L and bank reconciliation after 20261116154831 narrowed\n'
    || E'  -- accounting_payable_earning_sources.rake_credit to payable_rake_credit.\n'
    || E'  SELECT s.club_id,sum(COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)) generated,COALESCE(k.earned,0) earned,\n'
    || E'   sum(COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)) FILTER(WHERE s.source_type=''cash_rake_accrual'') cash_rake,\n'
    || E'   sum(COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)) FILTER(WHERE s.source_type=''tournament_fee_accrual'') tournament_rake\n'
    || E'  FROM public.accounting_payable_earning_sources s';

  k := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'GROSS_RAKE_REPORT_ANCHOR_COUNT %', k USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_report::regprocedure;
  p := replace(d, a1, r1);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_report::regprocedure;
  new_report := md5(pg_get_functiondef(c_report::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_report::regprocedure) <> p OR new_report = old_report THEN
    RAISE EXCEPTION 'GROSS_RAKE_REPORT_POSTIMAGE %', new_report USING ERRCODE = '55000';
  END IF;

  -- 2. Patch fn_union_pnl_week_rake_straddle to read gross original rake too.
  d := pg_get_functiondef(c_straddle::regprocedure);
  IF md5(d) IS DISTINCT FROM old_straddle THEN
    RAISE EXCEPTION 'GROSS_RAKE_PREIMAGE_STRADDLE %', md5(d) USING ERRCODE = '55000';
  END IF;
  a1 := 'SELECT COALESCE(sum(CASE WHEN o.recognized_at < p_start THEN -s.rake_credit ELSE s.rake_credit END), 0)';
  r1 :=
    E'-- GROSS ORIGINAL RAKE (20261123202500): match gross accepted rake on boundary straddlers.\n'
    || '  SELECT COALESCE(sum(CASE WHEN o.recognized_at < p_start THEN -COALESCE((s.contract->>''rake_credit'')::numeric, s.rake_credit) ELSE COALESCE((s.contract->>''rake_credit'')::numeric, s.rake_credit) END), 0)';
  k := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'GROSS_RAKE_STRADDLE_ANCHOR_COUNT %', k USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_straddle::regprocedure;
  p := replace(d, a1, r1);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_straddle::regprocedure;
  new_straddle := md5(pg_get_functiondef(c_straddle::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_straddle::regprocedure) <> p OR new_straddle = old_straddle THEN
    RAISE EXCEPTION 'GROSS_RAKE_STRADDLE_POSTIMAGE %', new_straddle USING ERRCODE = '55000';
  END IF;

  -- 3. Move fn_accounting_union_earned_plan_advance's pin on the report.
  d := pg_get_functiondef(c_adv::regprocedure);
  IF md5(d) IS DISTINCT FROM old_adv THEN
    RAISE EXCEPTION 'GROSS_RAKE_PREIMAGE_ADVANCE %', md5(d) USING ERRCODE = '55000';
  END IF;
  k := (length(d) - length(replace(d, old_report, ''))) / length(old_report);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'GROSS_RAKE_ADVANCE_ANCHOR_COUNT %', k USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_adv::regprocedure;
  p := replace(d, old_report, new_report);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_adv::regprocedure;
  new_adv := md5(pg_get_functiondef(c_adv::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_adv::regprocedure) <> p OR new_adv = old_adv THEN
    RAISE EXCEPTION 'GROSS_RAKE_ADVANCE_POSTIMAGE %', new_adv USING ERRCODE = '55000';
  END IF;

  -- 4. Move the 69-source list's pins for report and advance.
  d := pg_get_functiondef(c_psm::regprocedure);
  IF (length(d) - length(replace(d, old_report, ''))) / length(old_report) <> 1
     OR (length(d) - length(replace(d, old_adv, ''))) / length(old_adv) <> 1 THEN
    RAISE EXCEPTION 'GROSS_RAKE_SOURCES_ANCHOR_MISMATCH' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_psm::regprocedure;
  p := replace(replace(d, old_report, new_report), old_adv, new_adv);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_psm::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm::regprocedure) <> p THEN
    RAISE EXCEPTION 'GROSS_RAKE_SOURCES_POSTIMAGE %', md5(pg_get_functiondef(c_psm::regprocedure)) USING ERRCODE = '55000';
  END IF;

  -- 5. Assert the full 69-source list holds and zero stale pins remain.
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'GROSS_RAKE_SOURCES_STILL_DIFFER' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_basis_generation() NOT LIKE 'original-inventory-245-v1:%' THEN
    RAISE EXCEPTION 'GROSS_RAKE_GENERATION_SHAPE %', smarter_private.original_inventory_basis_generation() USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES (old_report), (old_straddle), (old_adv), (old_psm)) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'GROSS_RAKE_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$apply_gross_rake_fix$;

COMMIT;
