-- 20261108204901_scope_weekly_private_tournament_deposit_proof
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 20:49:01 UTC.
--
-- The already-paid Midway week timed out in the private-deposit proof of
-- its club statement. That proof rediscovered tournament sources even when
-- no private recognition receipt existed. The receipt-first read of the
-- same week returned the same empty deposits in 0.67 seconds, with no
-- second fee-source scan. Existing source groups also match by event key.
-- Keep the same cutoff, cross-club and out-of-week disposition checks.
-- @live-proof: md5(pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure))='0b5f87114dd95cb3f2b9802f20a564ec'

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';
SET LOCAL search_path = pg_catalog, public;

DO $patch$
DECLARE
  summary text := pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure);
  old_deposit constant text := $old_deposit$  FROM public.accounting_tournament_fee_recognitions f WHERE f.union_id IS NULL AND f.net_rake>0 AND f.tournament_id IN(
   SELECT y.tournament_id FROM public.accounting_tournament_fee_recognitions y
    WHERE y.bank_club_id=period.club_id AND y.recognized_at>=period.start_at AND y.recognized_at<period.end_at
   UNION SELECT s.tournament_id FROM public.accounting_payable_earning_sources s WHERE s.source_type='tournament_fee_accrual'
    AND s.club_id=period.club_id AND s.union_id IS NULL AND period.union_id IS NULL AND s.coordinator_union_id IS NULL
    AND s.earned_at>=period.start_at AND s.earned_at<period.end_at
   UNION SELECT s.tournament_id FROM public.accounting_payable_earning_sources s WHERE s.source_type='tournament_fee_accrual'
    AND s.club_id=period.club_id AND s.union_id IS NULL AND period.union_id IS NOT NULL AND s.coordinator_union_id=period.union_id
    AND s.earned_at>=period.start_at AND s.earned_at<period.end_at)$old_deposit$;
  new_deposit constant text := $new_deposit$  FROM public.accounting_tournament_fee_recognitions f
  WHERE f.union_id IS NULL AND f.net_rake>0
   -- Payable tournament earnings use their original recognition timestamp.
   AND f.recognized_at>=period.start_at AND f.recognized_at<period.end_at
   AND (f.bank_club_id=period.club_id OR EXISTS(
    SELECT 1 FROM public.accounting_payable_earning_sources s
    WHERE s.source_type='tournament_fee_accrual' AND s.tournament_id=f.tournament_id
     AND s.club_id=period.club_id AND s.union_id IS NULL
     AND ((period.union_id IS NULL AND s.coordinator_union_id IS NULL)
       OR (period.union_id IS NOT NULL AND s.coordinator_union_id=period.union_id))
     AND s.earned_at>=period.start_at AND s.earned_at<period.end_at
    OFFSET 0))$new_deposit$;
  old_group constant text := $old_group$FROM deposit_source_keys k JOIN public.accounting_payable_earning_sources s ON s.tournament_id=k.source_group
  WHERE k.source_type='tournament_fee_accrual' AND s.source_type='tournament_fee_accrual'$old_group$;
  new_group constant text := $new_group$FROM (SELECT source_group,banked_at FROM deposit_source_keys
         WHERE source_type='tournament_fee_accrual') k
   CROSS JOIN LATERAL (
    SELECT e.rake_credit,e.club_id,e.union_id,e.coordinator_union_id,e.earned_at
    FROM public.accounting_payable_earning_sources e
    WHERE e.tournament_id=k.source_group AND e.source_type='tournament_fee_accrual'
    OFFSET 0
   ) s$new_group$;
BEGIN
  IF md5(summary) IS DISTINCT FROM 'bd105ce624b837390cf77f09ae02946b'
     OR cardinality(string_to_array(summary, old_deposit)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(summary, old_group)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WEEKLY_PRIVATE_DEPOSIT_PREIMAGE_CHANGED';
  END IF;
  IF md5(pg_get_viewdef('public.accounting_payable_earning_sources'::regclass,true))
     IS DISTINCT FROM '4b5df14ee82835c51a81745b0d1be413' THEN
    RAISE EXCEPTION 'WEEKLY_PAYABLE_RECOGNITION_CONTRACT_CHANGED';
  END IF;
  EXECUTE replace(replace(summary,old_deposit,new_deposit),old_group,new_group);
END
$patch$;

COMMIT;
