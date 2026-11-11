-- 20261110235631_the_touched_step_is_certified_in_sub_ranges.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- THE TOUCHED STEP IS CERTIFIED IN SUB-RANGES
-- (Reliability incident a544b469-9226-4770-9f77-d5a77e085ea7,
--  union_accounting_scheduler, union fade0000-0000-0000-0000-000000000001)
-- ============================================================================
--
-- WHAT WENT WRONG, READ FROM ROWS. The chunked weekly close (cron job 272,
-- 4 minute scope budget) is exhausted inside fn_union_pnl_evidence_report at
-- the 'touched' step. financial_alerts rows with source
-- union_accounting_scheduler and message "A weekly accounting scope did not
-- finish its scheduler visit" carry
--   {error:"weekly_scope_statement_budget_exhausted", sqlstate:"57014",
--    timeout_function:"fn_union_pnl_evidence_report", timeout_line:"228",
--    statement_timeout:"4min"}
-- fn_accounting_close_warm_stop() only yields BETWEEN steps, so a single
-- statement that overruns the budget aborts the attempt and keeps NOTHING.
-- The run for 2026-11-02 to 2026-11-09 has climbed past 28 attempts with no
-- progress through that step.
--
-- WHY IT CANNOT FIT. Two of its joins are CTE-scan nested loops, so the cost
-- is quadratic in the rows of the period: union_touched is a Nested Loop Semi
-- Join, and both unresolved_registrations and the final count are Nested Loop
-- Left Joins. Measured on the stuck week, worst 6 hour slice: 204,675,344 then
-- 1,182,765,165 rows removed by join filter.
--
-- MEASURED, EXPLAIN (ANALYZE) on production read-only, worst slice of each
-- candidate, budget 240 s:
--   full week   1 slice    631,738 rows   projected ~6.8 h    fails
--   1 day       7 slices   199,239 rows   projected ~43 min   fails
--   6 hour     28 slices    61,789 rows   ~250 s              fails, ~104% of budget
--   3 hour     56 slices    31,214 rows   66.75 s             PASSES, 3.6x headroom
--   2 hour     84 slices    21,195 rows   31.37 s             passes
-- 3 hour is the largest size whose worst slice is measured inside the budget
-- with real margin, and the largest keeps the tick count and the wall clock
-- lowest: 56 ticks at 5 minutes is 4.7 h, inside the 12 hour certificate TTL.
--
-- WHY THE SUM IS THE SAME NUMBER. 'bad' is a COUNT of touch rows, not a set
-- and not order dependent, and the count is one per touch row because
-- union_touched is not deduplicated and both LEFT JOINs preserve its
-- cardinality. Two further facts, both read from the code and measured:
--   1. The rows PARTITION. fn_union_pnl_touched_registrations filters on two
--      half-open predicates over the same bounds. They can never disagree:
--      fn_union_pnl_inventory_observe is the only writer of framed events and
--      stamps each event with its frame's observed_at. Measured: 0 of
--      8,518,586 touch rows have frame_observed_at <> observed_at, and 0 of
--      the week's 631,738 events have frames.observed_at <> events.observed_at.
--   2. A row's verdict has NO period dependence: entries reads all funding
--      receipts of the registration unfiltered, union membership is per
--      tournament, the satellite owner helper is time free, and
--      v_open_resolved is the week level array computed before this step.
-- So the sum over any contiguous half-open tiling equals the full week.
-- Measured on the stuck week: 631,738 rows at 7 slices, at 28, at 56, and at
-- one week. Slices are GENERATED, not counted, because a DST week is 167 or
-- 169 hours; LEAST clamps the final end to p_end.
--
-- NOTHING IS SKIPPED AND NO BOOK IS CERTIFIED EARLY. Each completed sub-range
-- is certified under the SAME 'pnl_touched' kind at its own narrower
-- (start,end) key and read back on the next visit, which IS the resumption.
-- The week's own certificate is still written only from the complete sum, and
-- the clean-versus-problem verdict at the week key is preserved verbatim
-- (bad=0 -> 'pnl_touched', bad>0 -> 'pnl_touched_problem'). A sub-range key can
-- never equal a week key. Sub-range certificates use the plain kind even when
-- that slice's bad > 0, deliberately: a sub-range certifies a MEASUREMENT of a
-- slice of evidence, not a clean book, and the _problem kind carries a 1 hour
-- TTL against the 12 hour one, which would make dirty slices unresumable.
--
-- OVERLAP SAFETY. fn_accounting_close_certify upserts on
-- (kind,union_id,period_start,period_end). Two overlapping visits computing
-- the same sub-range compute the SAME value, because the inputs are
-- append-only immutable capture tables and the verdict is time free, so
-- last-writer-wins is value preserving. Worst case is duplicated work, never a
-- divergent certificate. No advisory lock is added.
--
-- ONE SUB-RANGE PER VISIT, THROUGH THE YIELD THAT ALREADY EXISTS.
-- fn_accounting_close_certify sets app.accounting_close_certified, which is
-- what fn_accounting_close_warm_stop reads, so the first sub-range certified
-- in an attempt trips the existing warm stop and the attempt returns
-- 'warming'. No timeout is extended, fn_accounting_close_warm_stop is not
-- touched, and no cron, watcher, reconciler or repair loop is added: this
-- reuses the chunked-close contract the boundary and flows steps already use.
--
-- HARDENING. The exactness of the sum rests on frame_observed_at =
-- observed_at, which is unenforced today (the table carries only a PK on
-- event_id and a source_name CHECK). Measured violations: 0 of 8,518,586. The
-- CHECK is added NOT VALID, so it takes no table scan and still gates every
-- future insert; VALIDATE CONSTRAINT can follow out of band.
--
-- @live-proof: position('SUB-RANGE CERTIFIED TOUCHED STEP (20261110235631)' in pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'union_pnl_inventory_touches_frame_is_observed' AND conrelid = 'public.union_pnl_inventory_touches'::regclass)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) <> '80f29ec1270de41106ee6302153a7cfe' THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_PREIMAGE_CHANGED: fn_union_pnl_evidence_report was edited since this patch was qualified; requalify before installing';
  END IF;
  IF to_regprocedure('public.fn_accounting_close_warm_stop()') IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_PREIMAGE_CHANGED: fn_accounting_close_warm_stop is missing';
  END IF;
END
$pre$;

DO $slice$
DECLARE
  s text;
  n text;
  k integer;
  c_sig constant text := 'public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)';
  c_decl_old constant text := $do$ v_cert jsonb; v_generation text;v_hand_parts jsonb;$do$;
  c_decl_new constant text := $dn$ v_cert jsonb; v_generation text;v_hand_parts jsonb;
 v_slice jsonb; v_slice_start timestamptz; v_slice_end timestamptz; v_slice_bad bigint;$dn$;
  c_open_old constant text := $ao$ IF v_cert IS NOT NULL THEN
  v_bad:=(v_cert->>'bad')::bigint;
 ELSE
 WITH touched AS MATERIALIZED (
  SELECT w.registration_id row_id,w.touched_tournament_id tournament_id
  FROM public.fn_union_pnl_touched_registrations(p_start,p_end,v_inv) w$ao$;
  c_open_new constant text := $an$ IF v_cert IS NOT NULL THEN
  v_bad:=(v_cert->>'bad')::bigint;
 ELSE
 -- SUB-RANGE CERTIFIED TOUCHED STEP (20261110235631): this one statement
 -- cannot fit a 4 minute scope budget. Two of its joins are CTE scan nested
 -- loops, so its cost is quadratic in the rows of the period: measured on the
 -- week of 2026-11-02, 204,675,344 then 1,182,765,165 join filter evaluations
 -- for a single 6 hour slice. The week is therefore proved in 3 hour
 -- sub-ranges, each certified under the SAME 'pnl_touched' kind at its own
 -- narrower (start,end) key, and summed. 'bad' is a count of touch rows, the
 -- two range predicates of fn_union_pnl_touched_registrations are the same
 -- predicate (fn_union_pnl_inventory_observe stamps every event with its
 -- frame's observed_at and is the only writer), and a row's verdict has no
 -- period dependence, so the sum over any contiguous half-open tiling is the
 -- identical number the full week returns. Measured: 631738 rows at 7, 28 and
 -- 56 slices and at one week. Slices are generated rather than counted because
 -- a DST week is 167 or 169 hours, and LEAST clamps the last end to p_end.
 -- Nothing is skipped, no timeout is extended, and the week's own certificate
 -- is still written only from the complete sum, below.
 v_bad:=0;
 FOR v_slice_start,v_slice_end IN
  SELECT s.a,LEAST(s.a+interval '3 hours',p_end)
  FROM generate_series(p_start,p_end-interval '1 microsecond',interval '3 hours') s(a) ORDER BY s.a
 LOOP
 v_slice:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_touched',p_union_id,v_slice_start,v_slice_end),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_touched',p_union_id,v_slice_start,v_slice_end));
 IF v_slice IS NOT NULL THEN
  v_bad:=v_bad+(v_slice->>'bad')::bigint;
 ELSE
 WITH touched AS MATERIALIZED (
  SELECT w.registration_id row_id,w.touched_tournament_id tournament_id
  FROM public.fn_union_pnl_touched_registrations(v_slice_start,v_slice_end,v_inv) w$an$;
  c_close_old constant text := $bo$ ) SELECT count(*) INTO v_bad FROM union_touched i LEFT JOIN entries e ON e.registration_id=i.row_id
 LEFT JOIN satellite_owners o ON o.row_id=i.row_id
 WHERE (NOT COALESCE(e.has_entry,false) AND i.row_id<>ALL(v_open_resolved)
   AND o.owner IS NULL)
  OR COALESCE(e.has_other,false);
  IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad));
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad)); END IF;$bo$;
  c_close_new constant text := $bn$ ) SELECT count(*) INTO v_slice_bad FROM union_touched i LEFT JOIN entries e ON e.registration_id=i.row_id
 LEFT JOIN satellite_owners o ON o.row_id=i.row_id
 WHERE (NOT COALESCE(e.has_entry,false) AND i.row_id<>ALL(v_open_resolved)
   AND o.owner IS NULL)
  OR COALESCE(e.has_other,false);
  PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,v_slice_start,v_slice_end,jsonb_build_object('bad',v_slice_bad));
  v_bad:=v_bad+v_slice_bad;
  -- One sub-range per visit, through the yield that already exists:
  -- fn_accounting_close_certify sets app.accounting_close_certified, which is
  -- what fn_accounting_close_warm_stop reads. The next visit resumes from the
  -- sub-ranges already certified above. No new setting, no new deadline.
  IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 END IF;
 END LOOP;
  IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad));
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad)); END IF;$bn$;
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  FOR k IN 1..1 LOOP
    IF (length(s) - length(replace(s, c_decl_old, ''))) / length(c_decl_old) <> 1 THEN
      RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: DECLARE anchor is not unique';
    END IF;
    IF (length(s) - length(replace(s, c_open_old, ''))) / length(c_open_old) <> 1 THEN
      RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: loop-open anchor is not unique';
    END IF;
    IF (length(s) - length(replace(s, c_close_old, ''))) / length(c_close_old) <> 1 THEN
      RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: loop-close anchor is not unique';
    END IF;
  END LOOP;
  n := replace(replace(replace(s, c_decl_old, c_decl_new), c_open_old, c_open_new), c_close_old, c_close_new);
  IF n = s THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: patch did not change the function';
  END IF;
  EXECUTE n;
END
$slice$;

-- The invariant the sum rests on, gated for every future insert.
ALTER TABLE public.union_pnl_inventory_touches
  ADD CONSTRAINT union_pnl_inventory_touches_frame_is_observed
  CHECK (frame_observed_at = observed_at) NOT VALID;

DO $post$
BEGIN
  IF position('SUB-RANGE CERTIFIED TOUCHED STEP (20261110235631)' in
              pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_POSTIMAGE: the marker is not in the installed function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'union_pnl_inventory_touches_frame_is_observed'
                    AND conrelid = 'public.union_pnl_inventory_touches'::regclass) THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_POSTIMAGE: the frame_is_observed CHECK was not added';
  END IF;
END
$post$;

COMMIT;
