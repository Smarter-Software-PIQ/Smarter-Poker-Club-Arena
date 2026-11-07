-- THE 2026-10-26 WEEK'S EIGHT LOST CASH LINKS ARE RESOLVED (2026-11-07).
--
-- Midway Union's book 2026-10-26 07:00 .. 2026-11-02 08:00 UTC refuses, and
-- the weekly close will refuse it again when the queue reaches it, short by
-- exactly 9.30 chips. Re-derived read-only on production 2026-11-07:
--
--   accepted own rake      616,119.56   (fn_union_pnl_week_hand_lines,
--                                        summed over the week's 85 canonical
--                                        two-hour windows)
--   accepted linked rake   906,496.54   (fn_union_pnl_linked_cash_outcomes,
--                                        same windows)
--   accepted               1,522,616.10
--   straddle                  (10.00)   (fn_union_pnl_week_rake_straddle
--                                        returns -10.00)
--   accepted - straddle    1,522,626.10
--   cash rake accrued      1,522,635.40 (accounting_payable_earning_sources,
--                                        source_type='cash_rake_accrual')
--   short                       (9.30)
--
-- EIGHT HANDS ARE THE WHOLE DIFFERENCE. Of the 1,142,186 outcomes recognized
-- in that week whose game_scope is missing all six required keys, 1,142,178
-- already carry a link resolution. Eight do not:
--
--   recognized_at (UTC)      table_id                              hand_number
--   2026-10-26 07:41:45.899  502219fa-a021-452c-8afe-0004d5ca84ff     48576489
--   2026-10-26 15:23:03.535  42223a23-e00b-4621-bd97-b281a3e29334     48953863
--   2026-10-26 15:23:12.972  ed224ffd-6e6d-4672-875e-e8d363c123ee     48953862
--   2026-10-26 15:23:16.208  d1a25175-09a9-4efe-b2d2-f97d98850e5e     48953866
--   2026-10-26 15:23:40.412  d2598d1f-d811-4709-920a-22dd80e18046     48953834
--   2026-10-27 11:02:41.704  eef136c8-667a-442b-865e-4d828de2d284     49867027
--   2026-10-27 15:24:47.111  7796ff68-e971-463b-932a-df65a6748eb2     50000411
--   2026-10-27 15:29:49.025  cd3582a4-f0dd-4f03-a788-7cd4ec213706     50001052
--
-- Each has game_scope '{}', evidence->>'status'='blocked' and no row in
-- union_pnl_cash_outcome_link_resolutions, so it is in neither the own-union
-- population (fn_union_pnl_week_hand_lines, which needs the scope) nor the
-- linked one (fn_union_pnl_linked_cash_outcomes, which needs the resolution),
-- while its Midway cash rake accrual is counted all the same. That is both
-- the 9.30 and the second refusal, accepted_cash_original_scope_missing
-- count 8 - the same engine fault as 20260929001003 (#5556), where
-- captureCashHandProvenance lost the manifest id after the database had
-- already committed, so the signed stacks carry no funding_manifest_id.
--
-- NOTHING NEW IS INVENTED HERE. This migration only calls the sanctioned
-- resolver, public.fn_union_pnl_resolve_cash_outcome_links, created by
-- 20260929001003 for exactly this fault. The resolver re-proves each hand
-- from its own primary receipts (roster from the manifest or each seat's
-- inventory row at the deal, scope from the table's inventory row at the
-- hand, owners from funding lineage, conservation as for every hand), writes
-- only rows whose proof is 'proven', hash-binds each to its immutable
-- outcome, takes its own pg_advisory_xact_lock and skips a hand that is
-- already resolved. Dry-run twice on production over the five one-minute
-- windows below: 8 candidates proven, 8 evidence_ready, 0 refused in Midway,
-- accepted_rake 9.30 (2.50 + 6.10 + 0 + 0 + 0.70).
--
-- The 9.30 is a CHECK, never a written figure: the resolver writes the proofs
-- it can prove and this file refuses the whole transaction if what it proved
-- is not those 8 hands and that 9.30. After the links are written the week
-- reads accepted 616,119.56 + 906,505.84 = 1,522,625.40, and
-- 1,522,625.40 - (-10.00) = 1,522,635.40, the cash rake exactly.
--
-- THE SEAT-INVENTORY REFUSALS ARE LEFT ALONE. The same five windows hold 62
-- other candidates the resolver refuses with
-- seat_inventory_disagrees_with_dealt_stack (33, 28 and 1). They need no
-- link, a legitimate refusal is recorded and not forced, and this file
-- asserts nothing about them beyond reporting the count it saw.
--
-- RE-RUNNING IS A NO-OP. Every assertion accepts either the unresolved state
-- (8 unlinked, 8 to write) or the resolved one (0 unlinked, 8 already
-- resolved), and refuses anything in between, so a drifted input writes
-- nothing and a second apply inside the same transaction writes 0.
--
-- THE GUARDS READ THE EIGHT HANDS BY KEY, NOT THE WEEK (2026-11-07). As
-- first merged, the before and after counts ran the canonical link predicate,
-- fn_union_pnl_cash_outcome_link, over all 1,142,186 missing-scope outcomes
-- of the week - 61 s each on production. The read-only probe that measured
-- them had no budget; apply-recorded-migration.mjs does: the whole ordinary
-- transaction runs under transaction_timeout = TRANSACTION_BUDGET_SECONDS + 4
-- = 12 s, and the first dispatch died there with 25P04 after 12,236 ms with
-- nothing committed. These bytes were never live, so they are corrected in
-- place, as #9520 and #9881 were.
--
-- The week-wide fact the counts stood for was re-measured read-only on
-- production 2026-11-07 after 18:15Z with the same predicate: exactly 8 unlinked
-- missing-scope outcomes in the week, and they are exactly k_ids below. The
-- week is closed, so no new outcome can be recognized inside it. The guards
-- therefore read those eight rows through union_pnl_cash_outcomes_hand_id_key
-- (5 ms), and require all of them in the week and missing their scope, so a
-- wrong id refuses rather than passes. Timed on production: the eight-hand
-- check 5 ms, one resolver pass over the five windows 1.15 s; the whole block
-- (three passes) fits inside the 12 s budget with room.
--
-- @live-proof: (SELECT count(*)=8 AND bool_and(EXISTS(SELECT 1 FROM public.fn_union_pnl_cash_outcome_link(o))) FROM public.union_pnl_cash_outcomes o WHERE o.hand_id IN ('a37eb331-755e-4af1-bf6f-dd264c551422'::uuid,'19573d7e-d8ed-4f3a-aee7-9144e527cf5b'::uuid,'a573ff8f-bd6d-4d3a-8815-d86953a1fa43'::uuid,'cdd9b64e-2058-40c5-ad25-863c40ae15ee'::uuid,'cb070a92-e793-453d-ab97-c056f150c402'::uuid,'36fc66c4-34bf-49a5-8e3d-887f68573ed8'::uuid,'6b323a00-71c2-4a74-baf5-65065d1cade3'::uuid,'237eeab0-3630-492f-bed0-3ca2e4d88796'::uuid))
-- @live-proof: (SELECT count(*)=8 AND bool_and(r.proof->>'status'='proven' AND r.proof_md5=md5(r.proof::text) AND r.game_scope->>'game_union_id'='fade0000-0000-0000-0000-000000000001') FROM public.union_pnl_cash_outcome_link_resolutions r WHERE r.hand_id IN ('a37eb331-755e-4af1-bf6f-dd264c551422'::uuid,'19573d7e-d8ed-4f3a-aee7-9144e527cf5b'::uuid,'a573ff8f-bd6d-4d3a-8815-d86953a1fa43'::uuid,'cdd9b64e-2058-40c5-ad25-863c40ae15ee'::uuid,'cb070a92-e793-453d-ab97-c056f150c402'::uuid,'36fc66c4-34bf-49a5-8e3d-887f68573ed8'::uuid,'6b323a00-71c2-4a74-baf5-65065d1cade3'::uuid,'237eeab0-3630-492f-bed0-3ca2e4d88796'::uuid))

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_resolve_cash_outcome_links(timestamp with time zone,timestamp with time zone,text,boolean)'::regprocedure)) IS DISTINCT FROM '385f7f4482ba5879e65f4466a22ae18e' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_resolver_changed' USING ERRCODE='55000'; END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_prove_cash_outcome_links(timestamp with time zone,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '6c07b34875e97191e35e0d17706bc672' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_prover_changed' USING ERRCODE='55000'; END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_cash_outcome_link(union_pnl_cash_outcomes)'::regprocedure)) IS DISTINCT FROM '627c6a7dd232bb8030d5400adf8346f2' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_link_predicate_changed' USING ERRCODE='55000'; END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_linked_cash_outcomes(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '798e8c95a26ad587da13151675f47fd1' THEN
    RAISE EXCEPTION 'union_pnl_link_fix_linked_reader_changed' USING ERRCODE='55000'; END IF;
END $pre$;

DO $resolve$
DECLARE
  k_union  CONSTANT uuid        := 'fade0000-0000-0000-0000-000000000001';
  k_start  CONSTANT timestamptz := '2026-10-26 07:00:00+00';
  k_end    CONSTANT timestamptz := '2026-11-02 08:00:00+00';
  k_hands  CONSTANT integer     := 8;
  k_ids    CONSTANT uuid[]      := ARRAY['a37eb331-755e-4af1-bf6f-dd264c551422'::uuid,'19573d7e-d8ed-4f3a-aee7-9144e527cf5b'::uuid,'a573ff8f-bd6d-4d3a-8815-d86953a1fa43'::uuid,'cdd9b64e-2058-40c5-ad25-863c40ae15ee'::uuid,'cb070a92-e793-453d-ab97-c056f150c402'::uuid,'36fc66c4-34bf-49a5-8e3d-887f68573ed8'::uuid,'6b323a00-71c2-4a74-baf5-65065d1cade3'::uuid,'237eeab0-3630-492f-bed0-3ca2e4d88796'::uuid];
  k_rake   CONSTANT numeric     := 9.30;
  k_reason CONSTANT text        :=
    'Weekly close 2026-10-26 07:00Z..2026-11-02 08:00Z: eight Midway cash hands whose engine provenance link was lost are re-proved from their own primary receipts, so the week''s accepted cash rake meets its original earning and bank basis.';
  w        record;
  j        jsonb;
  v_named  bigint;
  v_before bigint;
  v_after  bigint;
  v_proven integer := 0;
  v_already integer := 0;
  v_written integer := 0;
  v_ready  integer := 0;
  v_wrote2 integer := 0;
  v_again  integer := 0;
  v_mw_hands numeric := 0;
  v_mw_rake  numeric := 0;
  v_refused  integer := 0;
BEGIN
  -- THE EIGHT ARE THE ONES NAMED. Every id is an outcome of this week whose
  -- scope is missing; a wrong or drifted id refuses here.
  SELECT count(*) INTO v_named FROM public.union_pnl_cash_outcomes o
   WHERE o.hand_id = ANY(k_ids)
     AND o.recognized_at>=k_start AND o.recognized_at<k_end
     AND NOT o.game_scope ?& ARRAY['game_union_id','host_club_id','tournament_id','is_private','asset','unit_scale'];
  IF v_named IS DISTINCT FROM k_hands::bigint THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_named_hands_drifted: % of % named hands are missing-scope outcomes of the week',
      v_named, k_hands USING ERRCODE='55000';
  END IF;

  -- BEFORE. How many of the eight the close's own predicate still refuses.
  SELECT count(*) INTO v_before FROM public.union_pnl_cash_outcomes o
   WHERE o.hand_id = ANY(k_ids)
     AND NOT EXISTS(SELECT 1 FROM public.fn_union_pnl_cash_outcome_link(o));

  -- BEFORE. What the resolver can prove, proved without writing anything.
  FOR w IN SELECT * FROM (VALUES
    ('2026-10-26 07:41:00+00'::timestamptz,'2026-10-26 07:42:00+00'::timestamptz),
    ('2026-10-26 15:23:00+00'::timestamptz,'2026-10-26 15:24:00+00'::timestamptz),
    ('2026-10-27 11:02:00+00'::timestamptz,'2026-10-27 11:03:00+00'::timestamptz),
    ('2026-10-27 15:24:00+00'::timestamptz,'2026-10-27 15:25:00+00'::timestamptz),
    ('2026-10-27 15:29:00+00'::timestamptz,'2026-10-27 15:30:00+00'::timestamptz)
   ) v(s,e) LOOP
    j := public.fn_union_pnl_resolve_cash_outcome_links(w.s,w.e,k_reason,false);
    v_proven  := v_proven  + (j->>'proven_not_written')::integer;
    v_already := v_already + (j->>'already_resolved')::integer;
    v_ready   := v_ready   + (j->>'evidence_ready')::integer;
    v_refused := v_refused + (j->>'refused')::integer;
    v_mw_hands := v_mw_hands + COALESCE((j#>>ARRAY['by_union',k_union::text,'hands'])::numeric,0);
    v_mw_rake  := v_mw_rake  + COALESCE((j#>>ARRAY['by_union',k_union::text,'accepted_rake'])::numeric,0);
  END LOOP;

  RAISE NOTICE 'union_pnl_link_fix 2026-10-26 week: unlinked=% proven=% already=% ready=% midway_hands=% midway_rake=% other_refusals=%',
    v_before, v_proven, v_already, v_ready, v_mw_hands, v_mw_rake, v_refused;

  -- The gate. Either nothing has been written yet, or this exact correction
  -- already has been; anything else is a drifted input and writes nothing.
  IF NOT ((v_before=k_hands AND v_proven=k_hands AND v_already=0)
       OR (v_before=0       AND v_proven=0       AND v_already=k_hands)) THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_population_drifted: % unlinked, % provable, % already resolved, expected % and 0 or 0 and %',
      v_before, v_proven, v_already, k_hands, k_hands USING ERRCODE='55000';
  END IF;
  IF v_mw_hands IS DISTINCT FROM k_hands::numeric OR v_mw_rake IS DISTINCT FROM k_rake THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_shortfall_drifted: % Midway hands carrying % accepted rake, expected % carrying %',
      v_mw_hands, v_mw_rake, k_hands, k_rake USING ERRCODE='55000';
  END IF;
  IF v_ready IS DISTINCT FROM k_hands THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_evidence_not_ready: % of % proofs are evidence_ready',
      v_ready, k_hands USING ERRCODE='55000';
  END IF;

  -- APPLY. The resolver writes its own proven rows, or skips what it already
  -- wrote; it never writes k_rake, which is only ever checked here.
  FOR w IN SELECT * FROM (VALUES
    ('2026-10-26 07:41:00+00'::timestamptz,'2026-10-26 07:42:00+00'::timestamptz),
    ('2026-10-26 15:23:00+00'::timestamptz,'2026-10-26 15:24:00+00'::timestamptz),
    ('2026-10-27 11:02:00+00'::timestamptz,'2026-10-27 11:03:00+00'::timestamptz),
    ('2026-10-27 15:24:00+00'::timestamptz,'2026-10-27 15:25:00+00'::timestamptz),
    ('2026-10-27 15:29:00+00'::timestamptz,'2026-10-27 15:30:00+00'::timestamptz)
   ) v(s,e) LOOP
    j := public.fn_union_pnl_resolve_cash_outcome_links(w.s,w.e,k_reason,true);
    v_written := v_written + (j->>'resolved_now')::integer;
  END LOOP;
  IF v_written IS DISTINCT FROM v_before::integer THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_write_count_wrong: resolver wrote % rows for % unlinked outcomes',
      v_written, v_before USING ERRCODE='55000';
  END IF;

  -- AFTER. None of the eight is refused by the close's predicate any more.
  SELECT count(*) INTO v_after FROM public.union_pnl_cash_outcomes o
   WHERE o.hand_id = ANY(k_ids)
     AND NOT EXISTS(SELECT 1 FROM public.fn_union_pnl_cash_outcome_link(o));
  IF v_after IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_scope_still_missing: % outcomes of the week still carry no link',
      v_after USING ERRCODE='55000';
  END IF;

  -- IDEMPOTENT. A second apply, here and on any re-run, writes nothing.
  FOR w IN SELECT * FROM (VALUES
    ('2026-10-26 07:41:00+00'::timestamptz,'2026-10-26 07:42:00+00'::timestamptz),
    ('2026-10-26 15:23:00+00'::timestamptz,'2026-10-26 15:24:00+00'::timestamptz),
    ('2026-10-27 11:02:00+00'::timestamptz,'2026-10-27 11:03:00+00'::timestamptz),
    ('2026-10-27 15:24:00+00'::timestamptz,'2026-10-27 15:25:00+00'::timestamptz),
    ('2026-10-27 15:29:00+00'::timestamptz,'2026-10-27 15:30:00+00'::timestamptz)
   ) v(s,e) LOOP
    j := public.fn_union_pnl_resolve_cash_outcome_links(w.s,w.e,k_reason,true);
    v_wrote2 := v_wrote2 + (j->>'resolved_now')::integer;
    v_again  := v_again  + (j->>'already_resolved')::integer;
  END LOOP;
  IF v_wrote2 IS DISTINCT FROM 0 OR v_again IS DISTINCT FROM k_hands THEN
    RAISE EXCEPTION 'union_pnl_link_fix_2026_10_26_not_idempotent: a second apply wrote % rows and skipped % of %',
      v_wrote2, v_again, k_hands USING ERRCODE='55000';
  END IF;
END $resolve$;

COMMIT;
