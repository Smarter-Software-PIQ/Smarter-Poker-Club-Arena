-- MIDWAY UNION WEEKLY CLOSE: THE RAKE CHECK READS HANDS THAT STRADDLE THE
-- WEEK BOUNDARY (2026-11-07).
--
-- The Midway Union close for the week of 2026-10-19 failed 188 times with
-- union_pnl_basis_uncertified / accepted_cash_rake_does_not_match_original_
-- earning_and_bank_basis, which left the week's ECO rows and union invoices
-- unwritten and kept incident f6593b8d (union_eco_not_recorded) open.
--
-- MEASURED (read-only, day by day, then hand by hand):
--   accepted cash rake (hand lines 1,480,491.87 + linked Lightning hands
--   422,270.65)                       = 1,902,762.52
--   earned cash rake (accounting_payable_earning_sources, earned_at in week)
--                                     = 1,902,752.52
--   difference                        =        10.00
-- The 10.00 is exactly two Lightning hands of 5.00 each (f3d588c6, 13b549d5)
-- recognized at 06:59:59.79 and 06:59:59.87 on 2026-10-26, inside the week,
-- whose rake was distributed by atomic_distribute_rake in its own
-- transaction 0.24-0.26 s later, at 07:00:00.03 and 07:00:00.11, so the
-- earning sources (earned_at = rake_records.created_at) and therefore the
-- payout plan put that rake in the NEXT week. Both sides are right about
-- their own instant; the check compared them as if they used one clock.
-- Every other day of the week matched to the cent.
--
-- THE CORRECTION (verification only; no row, chip or payout plan moves):
-- fn_union_pnl_week_rake_straddle returns, for this union, the earned rake
-- of accepted hands recognized inside the week but earned within ten
-- minutes after its end (out), minus the earned rake of hands recognized
-- within ten minutes before its start but earned inside it (in). The report
-- now requires accepted - (out - in) = earned. The payout basis stays
-- earned_at, so the earned plans already certified are unchanged, and a
-- hand that straddles a boundary is counted once on each side of the check.
-- A skew longer than ten minutes still fails the check, as it should.
-- Re-measured read-only with this exact predicate:
--   week of 2026-10-19: straddle 10.00 -> 1,902,762.52 - 10.00 = 1,902,752.52 (match)
--   week of 2026-10-26: straddle -10.00 (the same two hands, counted in)
--
-- @live-proof: to_regprocedure('public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz)') IS NOT NULL AND position('fn_union_pnl_week_rake_straddle' IN pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'ca8931142b7e8ad6bbac07bd0913d268' THEN
    RAISE EXCEPTION 'WEEKLY_RAKE_STRADDLE_PREIMAGE_DRIFT fn_union_pnl_evidence_report';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_union_pnl_week_rake_straddle(p_union_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(sum(CASE WHEN o.recognized_at < p_start THEN -s.rake_credit ELSE s.rake_credit END), 0)
    FROM public.accounting_payable_earning_sources s
    JOIN public.rake_records r ON r.id = s.rake_record_id
    JOIN public.union_pnl_cash_outcomes o ON o.hand_id = r.hand_id
   WHERE s.source_type = 'cash_rake_accrual'
     AND s.union_id = p_union_id
     -- The same accepted population the report reads: this union's own
     -- outcomes, and linked (Lightning) outcomes through their resolutions.
     AND (o.game_scope->>'game_union_id' = p_union_id::text
          OR EXISTS (SELECT 1 FROM public.union_pnl_cash_outcome_link_resolutions l
                      WHERE l.table_id = o.table_id AND l.hand_number = o.hand_number
                        AND l.hand_id = o.hand_id
                        AND l.game_scope->>'game_union_id' = p_union_id::text))
     AND ((s.earned_at >= p_end AND s.earned_at < p_end + interval '10 minutes'
           AND o.recognized_at >= p_start AND o.recognized_at < p_end)
       OR (s.earned_at >= p_start AND s.earned_at < p_start + interval '10 minutes'
           AND o.recognized_at < p_start AND o.recognized_at >= p_start - interval '10 minutes'))
$fn$;
REVOKE ALL ON FUNCTION public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz) TO service_role;

DO $wire$
DECLARE b text; a1 text; r1 text; a2 text; r2 text;
BEGIN
  SELECT pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure) INTO b;
  a1 := 'IF v_cash_reconciled AND v_accepted_rake IS NOT DISTINCT FROM v_cash_rake THEN';
  r1 := 'IF v_cash_reconciled AND (v_accepted_rake IS NOT DISTINCT FROM v_cash_rake OR v_accepted_rake-public.fn_union_pnl_week_rake_straddle(p_union_id,p_start,p_end) IS NOT DISTINCT FROM v_cash_rake) THEN';
  a2 := 'IF v_accepted_rake IS DISTINCT FROM v_cash_rake THEN v_issues:=';
  r2 := 'IF v_accepted_rake IS DISTINCT FROM v_cash_rake AND v_accepted_rake-public.fn_union_pnl_week_rake_straddle(p_union_id,p_start,p_end) IS DISTINCT FROM v_cash_rake THEN v_issues:=';
  IF (length(b) - length(replace(b, a1, ''))) / length(a1) <> 1
     OR (length(b) - length(replace(b, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'WEEKLY_RAKE_STRADDLE_PREIMAGE_DRIFT anchors';
  END IF;
  EXECUTE replace(replace(b, a1, r1), a2, r2);
END $wire$;

COMMIT;
