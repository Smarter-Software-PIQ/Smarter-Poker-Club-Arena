-- 20261123163016_union_pnl_cash_link_resolution_nov18_p16.sql
--
-- RESOLVE NOV 18 ALIAS-REGRESSION UNLINKED CASH OUTCOMES (Part 16/18:
-- 2026-11-18T20:59:00Z .. 2026-11-18T21:02:00Z).
--
-- ROOT CAUSE (Incident 605ea9ca - union_accounting_scheduler; drift 378c5998
-- and 25365b5d union_eco_not_recorded):
-- Between 2026-11-18 20:12:48Z and 2026-11-18 21:04:56Z, migration
-- 20261118164000 introduced an ambiguous alias x inside
-- fn_cash_capture_hand_manifest (fixed at source by 20261118202500 and
-- guarded by 20261119005831). Exactly 987 Classic cash hands across 15 Midway
-- Union tables settled in 2026-11-18T20:14:04Z..2026-11-18T21:05:55Z without
-- a dealt manifest link, leaving game_scope = '{}' and blocking Midway's
-- 2026-11-16..2026-11-23 weekly close (accepted_cash_original_scope_missing:
-- 987).
--
-- SANCTIONED RESOLUTION ONLY:
-- Calls public.fn_union_pnl_resolve_cash_outcome_links (20260929001003) on
-- one-microsecond windows at each unlinked hand's exact recognized_at inside
-- [2026-11-18T20:59:00Z, 2026-11-18T21:02:00Z) so already-resolved Lightning hands are never scanned.
-- Re-proves every hand from primary receipts (seat_inventory + funding
-- lineage + conservation), writes only 'proven' rows bound by proof_md5,
-- never bypasses original_pnl_immutable, and is idempotent on re-run.
--
-- @live-proof: (SELECT NOT EXISTS (SELECT 1 FROM public.union_pnl_cash_outcomes o WHERE o.recognized_at >= '2026-11-18T20:59:00Z'::timestamptz AND o.recognized_at < '2026-11-18T21:02:00Z'::timestamptz AND NOT o.game_scope ?& ARRAY['game_union_id','host_club_id','tournament_id','is_private','asset','unit_scale'] AND NOT EXISTS (SELECT 1 FROM public.fn_union_pnl_cash_outcome_link(o))))

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_resolve_cash_outcome_links(timestamp with time zone,timestamp with time zone,text,boolean)'::regprocedure)) IS DISTINCT FROM '385f7f4482ba5879e65f4466a22ae18e' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_nov18_resolver_changed' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_prove_cash_outcome_links(timestamp with time zone,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '6c07b34875e97191e35e0d17706bc672' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_nov18_prover_changed' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_cash_outcome_link(union_pnl_cash_outcomes)'::regprocedure)) IS DISTINCT FROM '627c6a7dd232bb8030d5400adf8346f2' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_nov18_link_predicate_changed' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '21241121f4e4fe29a7becb1ff692d722' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_nov18_linked_reader_changed' USING ERRCODE = '55000';
  END IF;
END
$pre$;

DO $resolve$
DECLARE
  k_union  CONSTANT uuid        := 'fade0000-0000-0000-0000-000000000001';
  k_start  CONSTANT timestamptz := '2026-11-18T20:59:00Z'::timestamptz;
  k_end    CONSTANT timestamptz := '2026-11-18T21:02:00Z'::timestamptz;
  k_reason CONSTANT text        :=
    'Weekly close 2026-11-16 08:00Z..2026-11-23 08:00Z: Classic cash hands dealt during the 2026-11-18 20:12Z..21:05Z fn_cash_capture_hand_manifest alias regression (20261118164000, fixed 20261118202500) are re-proved from their own primary receipts via fn_union_pnl_resolve_cash_outcome_links (part 16/18).';
  r            record;
  j            jsonb;
  v_written    integer := 0;
  v_already    integer := 0;
  v_refused    integer := 0;
  v_mw_hands   numeric := 0;
  v_mw_rake    numeric := 0;
  v_after      bigint  := 0;
  v_first_miss text    := NULL;
  v_ref_sample jsonb   := '{}'::jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT o.recognized_at
      FROM public.union_pnl_cash_outcomes o
     WHERE o.recognized_at >= k_start
       AND o.recognized_at < k_end
       AND NOT o.game_scope ?& ARRAY['game_union_id','host_club_id','tournament_id','is_private','asset','unit_scale']
       AND NOT EXISTS (
         SELECT 1
           FROM public.union_pnl_cash_outcome_link_resolutions lr
          WHERE lr.table_id = o.table_id
            AND lr.hand_number = o.hand_number
       )
     ORDER BY o.recognized_at
  LOOP
    j := public.fn_union_pnl_resolve_cash_outcome_links(
      r.recognized_at,
      r.recognized_at + interval '1 microsecond',
      k_reason,
      true
    );
    v_written  := v_written  + COALESCE((j->>'resolved_now')::integer, 0);
    v_already  := v_already  + COALESCE((j->>'already_resolved')::integer, 0);
    v_refused  := v_refused  + COALESCE((j->>'refused')::integer, 0);
    v_mw_hands := v_mw_hands + COALESCE((j#>>ARRAY['by_union', k_union::text, 'hands'])::numeric, 0);
    v_mw_rake  := v_mw_rake  + COALESCE((j#>>ARRAY['by_union', k_union::text, 'accepted_rake'])::numeric, 0);
    IF COALESCE((j->>'refused')::integer, 0) > 0 AND v_ref_sample = '{}'::jsonb THEN
      v_ref_sample := COALESCE(j->'refusals', '{}'::jsonb);
    END IF;
  END LOOP;

  SELECT count(*),
         min(o.table_id::text || '#' || o.hand_number::text)
    INTO v_after, v_first_miss
    FROM public.union_pnl_cash_outcomes o
   WHERE o.recognized_at >= k_start
     AND o.recognized_at < k_end
     AND NOT o.game_scope ?& ARRAY['game_union_id','host_club_id','tournament_id','is_private','asset','unit_scale']
     AND NOT EXISTS (SELECT 1 FROM public.fn_union_pnl_cash_outcome_link(o));

  RAISE NOTICE 'union_pnl_link_fix nov18 p16 (2026-11-18T20:59:00Z..2026-11-18T21:02:00Z): written=% already=% refused=% midway_hands=% midway_rake=% remaining=%',
    v_written, v_already, v_refused, v_mw_hands, v_mw_rake, v_after;

  IF v_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'union_pnl_link_fix_nov18_p16_unresolved: remaining=% written=% refused=% sample=% first=%',
      v_after, v_written, v_refused, v_ref_sample::text, COALESCE(v_first_miss, 'none')
      USING ERRCODE = '55000';
  END IF;
END
$resolve$;

COMMIT;
