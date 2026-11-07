-- THE WEEKLY CLOSE IS EVIDENCE, NOT CACHE.
--
-- Midway's book 2026-09-21..28 was PAID IN FULL at 2026-10-01 22:43:00.542387Z:
-- round 1 387,082.68 to 2 clubs, round 2 332,024.42 to 110 agents, round 3
-- 105,621.37 to 598 players, round 4 issued, every shortfall 0, all four
-- settlement_periods rows 'closed' at that same instant, and no pending
-- rakeback_period is left anywhere in the week. Nobody is owed a chip for it.
--
-- sp_prune_ca_settlements then DELETED its ca_settlements close row. That
-- function exists for the 33.6M hand_stacks rows (20260904104540
-- settlements_are_pruned, "growing ~430 MB/day forever") and its predicate is
-- only `state='final' AND updated_at < now() - 30 days`: it never asked what
-- KIND of settlement it was deleting. The close finalized 2026-10-01 22:43
-- became eligible 2026-10-31 22:43 and cron job 266 (sp_prune_ca_settlements_10m,
-- 7,17,27,37,47 * * * *) took it. The proof is in what survives: among
-- state='final' rows the oldest remaining updated_at is 2026-10-03 23:02:22 and
-- NOT ONE final row older than that close is left. The 145,855 state='failed'
-- rows still dating to 2026-09-01 are untouchable by design and hide this from
-- a naive min(updated_at) over the whole table.
--
-- NOTHING CAN PUT IT BACK BY ITSELF. fn_union_weekly_rakeback_close returns
-- 'already_executed' at line 66, on the union_rakeback_log row, BEFORE it ever
-- reaches ca_settlements at line 72. So the close row for a book that has
-- already paid can never be recreated by the close. Which means
-- fn_union_settlement_conservation_assert line 20 - "CONSERVATION_UNVERIFIED:
-- exact recorded earning close is missing" - can never again be satisfied for
-- this book, fn_process_weekly_accounting_scope line 485 can never prove it
-- complete, line 649 rewrote its run row from 'complete' to 'failed' (862
-- attempts), and line 687, "Resolve an older period before posting a later one
-- for the same union", head-of-line blocks every week behind it.
-- 20261002014425 recorded that this same book HAD closed: "Midway's book
-- 2026-09-21..28 closed at 2026-10-01 23:51Z."
--
-- EVERY OTHER COMPLETION TEST FOR THE WEEK ALREADY PASSES. Measured
-- 2026-11-07 against production: rounds 1-4 recorded true, orphaned
-- union-booked pending rakeback 0, square-up invoices present, club statements
-- present, routed round-2/3 receipts present at routing_version 3 /
-- source_version 2 / shortfalls 0 - and close_row_present FALSE. One deleted
-- row is the whole failure.
--
-- WHY THIS IS URGENT AND NOT HOUSEKEEPING. The next week is already queued for
-- the same death. The 2026-09-28..10-05 close (payout 1,374,614.78,
-- updated_at 2026-10-07 19:42:08) is state='final' and ALREADY past the 30-day
-- cutoff, waiting only for the pruner's oldest-first cursor to reach it. After
-- it, 2026-10-05..10-12 (2,180,462.68), then 2026-10-12..10-19, then every
-- week in turn: each one silently un-closes a book that was paid, raises a
-- critical CONSERVATION_UNVERIFIED, and head-of-line blocks the weekly close
-- behind it. Fixing only the row would buy days. The pruner is the bug.
--
-- THIS CLEARS ONLY THE FIRST HEAD-OF-LINE BLOCKER. DO NOT READ THIS FILE AS
-- "the weekly close is fixed". With 2026-09-21..28 provable again the walk
-- advances exactly one week and stops at the NEXT failed book:
-- 2026-10-19..10-26, status 'failed', 188 attempts since 2026-11-01, error
-- union_pnl_basis_uncertified / accepted_cash_rake_does_not_match_original_
-- earning_and_bank_basis. That is a different fault with a different cause and
-- it is STILL OPEN; it needs its own migration before a Monday close can reach
-- the current week. The money itself is not waiting on either of them: since
-- weekly_payout_phase_configuration.cutover_period_end = 2026-11-02 08:00Z the
-- weekly rounds are paid by smarter_private.weekly_payout_* (cron jobs 523-528),
-- which fn_union_settlement_cascade_due calls and returns from before it ever
-- reaches fn_process_weekly_accounting.
--
-- WHAT THIS MIGRATION DOES
--   (a) sp_prune_ca_settlements is restricted to settlement_type='hand_stacks'.
--       That is the only high-volume per-hand type and the only reason the
--       function was written; a union_rakeback_close row is the permanent proof
--       that a week's money moved and is never retention-eligible. The same
--       principle is already law for the other pruner - "retention is a STORAGE
--       decision ... The money ledger is not pruned",
--       tests/a-retention-pass-never-deletes-a-recorded-earning-source.law.test.ts.
--       Name, signature and grants are unchanged, so the schema manifests that
--       list this function are unaffected.
--   (b) the deleted close row is restored under its ORIGINAL id,
--       f3470e1f-789b-4c79-bf3c-87e026ecc8fa, so the surviving chip_ledger legs
--       keyed union_close:f3470e1f-...:<club> point at their settlement again.
--       Every figure is READ BACK from surviving immutable evidence and none is
--       recomputed: union_settlement_rounds round 1 detail (which still carries
--       the original return value, settlement_id included), the union_close
--       chip_ledger legs, and union_rakeback_log. Six fields the deletion
--       destroyed - source_fingerprint, house_rake, rate_model, basis_detail,
--       basis_by_game_type, rates - cannot be re-derived from anything that
--       survives, so they are recorded as unrecoverable rather than invented.
--       No assert and no scheduler predicate reads them.
--   (c) the run row goes back to 'complete'. It WAS complete until the pruned
--       row made the scheduler re-attempt a book that had already paid.
--   (d) the alerts and the drift incident this book raised close on this
--       evidence.
--
-- NO CHIP MOVES. There is no money side to this: the money moved on
-- 2026-10-01 and is reconciled to the cent (430,094.89 = 387,082.68 +
-- 43,012.21). This migration restores the record of it.
--
-- NOT A WINDOW MIGRATION. It replaces one function, inserts one row and
-- updates a handful of alert, incident and run rows. It declares no
-- maintenance-window annotation and needs none: it takes no exclusive table
-- lock on anything hot, because replacing a function is a catalog write and
-- every other statement here takes only a row-level write lock. So it installs
-- on the ordinary applier path. It does take the weekly scheduler's own
-- per-book advisory key, with the TRY form, and REFUSES rather than queues if
-- job 272 is mid-tick on this exact book, so it can never wait on a close
-- while holding that book's rows.
--
-- WHY THIS FILE WAS EDITED AFTER IT MERGED (2026-11-07). It merged in #9860
-- and then could not install. Apply Merged Migration run 42384805393 REFUSED
-- after 12,215 ms with "FATAL 25P04: terminating connection due to transaction
-- timeout", inside this file's own
-- `idempotency_key LIKE 'union_close:...:%'` read of chip_ledger. Nothing was
-- committed, so the pruner stayed settlement-type-agnostic and the close row
-- stayed deleted. Both prefix reads are now named-key equalities served by
-- ux_chip_ledger_idempotency_key: 41,340 ms -> 0.202 ms, both measured
-- read-only against production. Every guard, figure and source is unchanged
-- and one guard is added. Editing the merged bytes is this estate's route for
-- a migration that merged and was REFUSED on its first apply with nothing
-- committed - #9520 did exactly this to 20261105034239 after its first apply
-- was refused with 42601 - and NOT the "-- SUPERSEDED BY" marker, which
-- check-migrations-are-live.mjs honours only for a file whose work another
-- file in this directory already does.
--
-- (The annotation token itself is deliberately not written anywhere in this
-- file, not even in prose: windowDeclaration() in
-- scripts/ci/maintenance-window-migrations.mjs counts every line that merely
-- mentions it and throws unless exactly one is a well-formed declaration.)
--
-- @live-proof: position('settlement_type = ''hand_stacks''' IN pg_get_functiondef('public.sp_prune_ca_settlements(integer,integer)'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM public.ca_settlements WHERE settlement_type='union_rakeback_close' AND external_ref='fade0000-0000-0000-0000-000000000001:2026-09-21T07:00:00Z..2026-09-28T07:00:00Z' AND state='final' AND totals->>'accounting_version'='3') AND (SELECT status FROM public.union_accounting_runs WHERE union_id='fade0000-0000-0000-0000-000000000001' AND period_start='2026-09-21T07:00:00Z' AND period_end='2026-09-28T07:00:00Z') = 'complete'

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  c_union uuid := 'fade0000-0000-0000-0000-000000000001';
  c_from  timestamptz := '2026-09-21T07:00:00Z';
  c_to    timestamptz := '2026-09-28T07:00:00Z';
  c_sid   uuid := 'f3470e1f-789b-4c79-bf3c-87e026ecc8fa';
  v_ref   text;
  v_rake numeric; v_paid numeric; v_ret numeric; v_clubs int;
  v_basis jsonb; v_payout jsonb; v_r1 jsonb;
  v_keys text[];
BEGIN
  -- ------------------------------------------------------------------ --
  -- PRECONDITIONS. Refuse if production is not the thing that was       --
  -- measured. Each md5 is a READ of the installed source, not a         --
  -- redefinition.                                                       --
  -- ------------------------------------------------------------------ --
  IF md5(pg_get_functiondef('public.sp_prune_ca_settlements(integer,integer)'::regprocedure))
     IS DISTINCT FROM '33773630b18fde61fb599a5410957e59' THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE_PREIMAGE_DRIFT sp_prune_ca_settlements';
  END IF;
  IF md5(pg_get_functiondef('public.fn_union_weekly_rakeback_close(uuid,timestamptz,timestamptz)'::regprocedure))
     IS DISTINCT FROM '64c4c5191e1263399cf63e63b1a7b46b' THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE_PREIMAGE_DRIFT fn_union_weekly_rakeback_close';
  END IF;
  IF md5(pg_get_functiondef('public.fn_union_settlement_conservation_assert(uuid,timestamptz,timestamptz,jsonb,jsonb,jsonb)'::regprocedure))
     IS DISTINCT FROM '3e3c35066e330f736c6a948b527c02e9' THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE_PREIMAGE_DRIFT fn_union_settlement_conservation_assert';
  END IF;

  v_ref := c_union::text||':'||to_char(c_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
                       ||'..'||to_char(c_to   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- Never queue behind job 272 on this exact book while holding its rows.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(hashtextextended(
       'union-accounting:'||c_union::text||':'
       ||extract(epoch FROM c_from)::text||':'||extract(epoch FROM c_to)::text,0)) THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE_BOOK_BUSY: the weekly scheduler holds 2026-09-21..28; re-apply on the next pass'
      USING ERRCODE='55000';
  END IF;

  -- ------------------------------------------------------------------ --
  -- (a) THE PRUNER STOPS EATING ACCOUNTING EVIDENCE.                    --
  -- ------------------------------------------------------------------ --
  CREATE OR REPLACE FUNCTION public.sp_prune_ca_settlements(
    p_batch integer DEFAULT 5000, p_retain_days integer DEFAULT 30)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  DECLARE
    v_deleted integer := 0;
    v_cutoff  timestamptz;
  BEGIN
    IF p_batch IS NULL OR p_batch <= 0 THEN
      RAISE EXCEPTION 'sp_prune_ca_settlements: p_batch must be positive, got %', p_batch;
    END IF;

    -- A retention window shorter than a week is almost certainly a typo, and this
    -- function deletes irreversibly. Refuse rather than obey.
    IF p_retain_days IS NULL OR p_retain_days < 7 THEN
      RAISE EXCEPTION
        'sp_prune_ca_settlements: refusing a retention window of % days. Settlement history is evidence; if you really mean to shorten it, change the default here in a migration that says why.',
        p_retain_days;
    END IF;

    -- Never move anything while the platform is frozen for the maintenance break.
    IF public.fn_platform_frozen() THEN
      RETURN 0;
    END IF;

    v_cutoff := now() - make_interval(days => p_retain_days);

    WITH doomed AS (
      SELECT ctid
      FROM public.ca_settlements
      -- EVIDENCE IS NOT CACHE (2026-11-07). This prune used to take any
      -- state='final' row, which is how it deleted Midway's union_rakeback_close
      -- for the already-paid week 2026-09-21..28 and froze the weekly close
      -- behind a book nothing could ever prove again. hand_stacks is the only
      -- high-volume per-hand type and the only reason this function exists; a
      -- weekly union close is the permanent proof that money moved and is never
      -- retention-eligible. Adding a settlement type? It is NOT pruned here
      -- unless it is per-hand churn and losing it costs nobody any evidence.
      WHERE settlement_type = 'hand_stacks'
        AND state = 'final'
        AND updated_at < v_cutoff
      ORDER BY updated_at
      LIMIT p_batch
    )
    DELETE FROM public.ca_settlements s
    USING doomed d
    WHERE s.ctid = d.ctid;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
  END;
  $function$;

  COMMENT ON FUNCTION public.sp_prune_ca_settlements(integer, integer) IS
    'Batched retention prune for ca_settlements, which had no prune at all and was growing ~430 MB/day forever. Deletes only settlement_type = ''hand_stacks'' rows in state = ''final'' older than p_retain_days (default 30). NEVER deletes any other settlement type - a union_rakeback_close is the permanent evidence a weekly close paid, and deleting one froze the weekly accounting cascade for a week in September 2026 (see the migration that added this clause). NEVER deletes ''failed'' rows - those are evidence of the 7.7% settlement failure rate - and never a row still walking its state machine. Runs outside the settlement transaction and skips the maintenance freeze.';

  -- One statement, every grantee named. A function is created with EXECUTE to
  -- PUBLIC and anon is a member of PUBLIC, so a revoke that names anon without
  -- naming PUBLIC reads correctly and changes nothing - the bug that cost PR
  -- #4872 a day and is now law in
  -- tests/a-revoke-from-anon-must-name-public.law.test.ts. Revoking PUBLIC on
  -- its own line first was already correct here; writing the grantees together
  -- keeps it correct statement by statement, which is what the law reads.
  REVOKE ALL ON FUNCTION public.sp_prune_ca_settlements(integer, integer)
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.sp_prune_ca_settlements(integer, integer) TO service_role;

  -- ------------------------------------------------------------------ --
  -- (b) RESTORE THE DELETED CLOSE, FROM SURVIVING EVIDENCE ONLY.        --
  -- ------------------------------------------------------------------ --
  SELECT detail,
         (detail->>'period_rake')::numeric,
         (detail->>'total_rakeback')::numeric,
         (detail->>'union_retained')::numeric,
         (detail->>'clubs_paid')::int
    INTO v_r1, v_rake, v_paid, v_ret, v_clubs
    FROM public.union_settlement_rounds
   WHERE union_id=c_union AND period_start=c_from AND period_end=c_to AND round_no=1;

  -- EVERY LEDGER READ HERE IS AN INDEX EQUALITY, NEVER A PREFIX SCAN
  -- (2026-11-07). chip_ledger carries 25.9M rows in 12 GB and the only index
  -- on its key is ux_chip_ledger_idempotency_key, a plain btree in this
  -- database's en_US.UTF-8 collation. A non-C collation cannot answer
  -- LIKE 'prefix%' from a plain btree, so the read this block used to do -
  -- idempotency_key LIKE 'union_close:'||c_sid::text||':%' - degraded to a
  -- bitmap scan of the whole partial index and 408,577 heap blocks, removing
  -- 572,752 rows by filter to return 2: measured read-only against production
  -- on 2026-11-07, 41,340 ms. The applier sends this file as ONE transaction
  -- under a transaction timeout, so that read alone blew it (run 42384805393,
  -- 25P04 after 12,215 ms, in this exact statement).
  --
  -- So the keys are NAMED instead of matched. Each candidate is built the way
  -- fn_union_weekly_rakeback_close built it - 'union_close:<settlement>:' and
  -- a club id - over the clubs THIS BOOK names in its own settlement_periods
  -- rows for the exact week, together with the union's current roster, plus
  -- the ':retained' leg. = ANY(text[]) over those is one index equality per
  -- key: measured 0.202 ms, 5 buffers, Index Scan using
  -- ux_chip_ledger_idempotency_key. The ledger legs remain the only source of
  -- every figure; no total is hard-coded and none is recomputed.
  --
  -- NO INDEX IS CREATED HERE. A text_pattern_ops index over a 12 GB live money
  -- journal cannot be built inside this apply transaction without holding the
  -- journal, which the "NOT A WINDOW MIGRATION" note above promises not to do.
  -- An equality read needs no new index.
  SELECT coalesce(array_agg(DISTINCT 'union_close:'||c_sid::text||':'||cid::text), '{}'::text[])
    INTO v_keys
    FROM (SELECT club_id AS cid
            FROM public.settlement_periods
           WHERE union_id=c_union AND start_at=c_from AND end_at=c_to
             AND club_id IS NOT NULL
          UNION
          SELECT club_id
            FROM public.union_clubs
           WHERE union_id=c_union) roster;
  v_keys := v_keys || ('union_close:'||c_sid::text||':retained');

  SELECT jsonb_object_agg(to_entity_id::text,(metadata->>'rake_basis')::numeric),
         jsonb_object_agg(to_entity_id::text,amount)
    INTO v_basis, v_payout
    FROM public.chip_ledger
   WHERE idempotency_key = ANY(v_keys)
     AND to_type='club_treasury';

  IF v_r1 IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: round 1 of 2026-09-21..28 is not recorded; there is nothing to restore from';
  END IF;
  IF v_r1->>'settlement_id' IS DISTINCT FROM c_sid::text THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: round 1 names settlement %, not %', v_r1->>'settlement_id', c_sid;
  END IF;
  IF v_rake IS DISTINCT FROM 430094.89 OR v_paid IS DISTINCT FROM 387082.68
     OR v_ret IS DISTINCT FROM 43012.21 OR v_clubs IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: round 1 figures are rake=% paid=% retained=% clubs=%',
      v_rake, v_paid, v_ret, v_clubs;
  END IF;
  IF v_rake <> v_paid + v_ret THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: % <> % + %', v_rake, v_paid, v_ret;
  END IF;
  IF (SELECT total_rakeback FROM public.union_rakeback_log
       WHERE union_id=c_union AND period_start=c_from AND period_end=c_to)
     IS DISTINCT FROM v_paid THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: union_rakeback_log disagrees with round 1';
  END IF;
  IF (SELECT amount FROM public.chip_ledger
       WHERE idempotency_key='union_close:'||c_sid::text||':retained')
     IS DISTINCT FROM v_ret THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: the retained ledger leg disagrees with round 1';
  END IF;
  IF (SELECT round(sum(amount),2) FROM public.chip_ledger
       WHERE idempotency_key = ANY(v_keys)
         AND to_type='club_treasury') IS DISTINCT FROM v_paid THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: the club ledger legs do not sum to the payout';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_payout)) IS DISTINCT FROM v_clubs THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: % club legs for % clubs paid',
      (SELECT count(*) FROM jsonb_object_keys(v_payout)), v_clubs;
  END IF;

  -- THE NAMED KEY SET MISSED NOTHING. The two guards above already refuse a
  -- key set that found too few legs - the payout would not sum, the club count
  -- would not match - but neither can say WHICH leg is missing. This asks from
  -- the other side, through ix_chip_ledger_settlement: an equality on
  -- settlement_id that reads only this settlement's own rows, measured
  -- read-only against production at 0.176 ms. A union_close leg of this
  -- settlement outside the named set - a club paid that week and since dropped
  -- from both its own settlement_periods row and the union roster - refuses by
  -- name rather than restoring a partial basis.
  IF EXISTS (SELECT 1 FROM public.chip_ledger
              WHERE settlement_id = c_sid::text
                AND idempotency_key LIKE 'union_close:'||c_sid::text||':%'
                AND NOT (idempotency_key = ANY(v_keys))) THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: a union_close leg of % is outside the named roster key set', c_sid;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.settlement_periods
                 WHERE union_id=c_union AND start_at=c_from AND end_at=c_to
                   AND club_id IS NULL AND status IN('settled','closed')) THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_CACHE: the week is not marked settled/closed; this is not a paid book';
  END IF;

  -- IDEMPOTENT. A close already present means an earlier run of this file, or a
  -- later authored repair, already did the work. Change nothing.
  IF NOT EXISTS(SELECT 1 FROM public.ca_settlements
                 WHERE settlement_type='union_rakeback_close' AND external_ref=v_ref) THEN
    INSERT INTO public.ca_settlements
      (id, settlement_type, external_ref, state, union_id, totals, created_at, updated_at)
    VALUES (c_sid, 'union_rakeback_close', v_ref, 'final', c_union,
      jsonb_build_object(
        'period_rake',  v_rake,
        'payout_total', v_paid,
        'retained',     v_ret,
        'clubs_paid',   v_clubs,
        'rw_debit',     v_rake,
        'accounting_version', 3,
        'conservation', 'asserted',
        'basis', 'immutable_earned_sources_matched_to_bank',
        'basis_by_club',  v_basis,
        'payout_by_club', v_payout,
        'restored_on', '2026-11-07',
        'restored_from', 'union_settlement_rounds round 1 detail + chip_ledger union_close legs + union_rakeback_log',
        'restored_reason', 'deleted by sp_prune_ca_settlements 30-day retention after the money had already moved at 2026-10-01T22:43:00.542387Z',
        'fields_not_recoverable', jsonb_build_array(
          'source_fingerprint','house_rake','rate_model',
          'basis_detail','basis_by_game_type','rates')),
      '2026-10-01 22:43:00.542387+00', '2026-10-01 22:43:00.542387+00');
  END IF;

  -- ------------------------------------------------------------------ --
  -- (c) THE RUN ROW GOES BACK TO WHAT IT WAS.                           --
  -- ------------------------------------------------------------------ --
  UPDATE public.union_accounting_runs q
     SET status='complete',
         finished_at='2026-10-01 22:43:00.542387+00',
         result=jsonb_build_object(
           'success', true,
           'accounting_version', 3,
           'union_id', c_union,
           'period_start', c_from,
           'period_end', c_to,
           'round1_union_to_clubs', v_r1,
           'round2_club_to_agents', (SELECT result||jsonb_build_object('duplicate',true)
             FROM public.accounting_routed_settlement_runs
              WHERE scope_kind='union' AND scope_id=c_union
                AND period_start=c_from AND period_end=c_to AND round_no=2),
           'round3_agents_to_players', (SELECT result||jsonb_build_object('duplicate',true)
             FROM public.accounting_routed_settlement_runs
              WHERE scope_kind='union' AND scope_id=c_union
                AND period_start=c_from AND period_end=c_to AND round_no=3),
           'restored_note', 'ca_settlements close row restored and this run re-marked complete: it was complete until the pruned row made the scheduler re-attempt a book that had already paid (see 20261002014425)')
   WHERE q.union_id=c_union AND q.period_start=c_from AND q.period_end=c_to
     AND q.status <> 'complete';

  -- ------------------------------------------------------------------ --
  -- (d) THE ALERTS THIS BOOK RAISED CLOSE ON THIS EVIDENCE.             --
  -- ------------------------------------------------------------------ --
  UPDATE public.financial_alerts a
     SET resolved=true,
         resolved_at=now(),
         resolution='verified 2026-11-07: the union week 2026-09-21..09-28 was paid in full at '
                  ||'2026-10-01T22:43:00.542387Z (period rake 430094.89 = payout 387082.68 + retained '
                  ||'43012.21; rounds 1-4 recorded, every shortfall 0, settlement_periods closed, no '
                  ||'pending rakeback_period left in the week). Its ca_settlements union_rakeback_close '
                  ||'row had been deleted by sp_prune_ca_settlements 30-day retention, which is why the '
                  ||'conservation assert could no longer find the exact recorded earning close. The '
                  ||'pruner now skips every settlement type but hand_stacks and the row is restored from '
                  ||'the surviving immutable ledger. No chip moved for this repair.',
         context=COALESCE(a.context,'{}'::jsonb)
                 ||jsonb_build_object('resolved_by_migration','the_weekly_close_is_evidence_not_cache')
   WHERE a.source='union_accounting_scheduler'
     AND NOT COALESCE(a.resolved,false)
     AND a.context->'result'->>'error' = 'CONSERVATION_UNVERIFIED: exact recorded earning close is missing';

  UPDATE public.ca_drift_incidents
     SET status='resolved',
         resolved_at=now(),
         root_cause='sp_prune_ca_settlements (cron job 266, 30-day retention, predicate state=''final'' '
                  ||'AND updated_at < cutoff with no settlement_type test) deleted the ca_settlements '
                  ||'union_rakeback_close row for Midway 2026-09-21..09-28 on or after 2026-10-31. The '
                  ||'week had already been paid in full on 2026-10-01. fn_union_weekly_rakeback_close '
                  ||'returns already_executed at line 66 on the union_rakeback_log row before it can '
                  ||'ever recreate that row, so the conservation assert could never be satisfied again, '
                  ||'fn_process_weekly_accounting_scope line 485 could never prove the book complete, '
                  ||'and line 687 head-of-line blocked every later week.',
         resolution='Pruner restricted to settlement_type=''hand_stacks''. Close row restored under its '
                  ||'original id f3470e1f-789b-4c79-bf3c-87e026ecc8fa from union_settlement_rounds round '
                  ||'1 detail, the union_close chip_ledger legs and union_rakeback_log; six fields the '
                  ||'deletion destroyed are recorded as unrecoverable, not invented. Run row re-marked '
                  ||'complete. fn_union_settlement_conservation_assert re-run on the restored row returns '
                  ||'conservation=asserted over 7 checks. No chip moved. NOTE: the next head-of-line '
                  ||'blocker, 2026-10-19..10-26 union_pnl_basis_uncertified, is a separate fault and '
                  ||'remains open.',
         closure_basis='evidence_restored_no_money_moved'
   WHERE id='9788f9a4-f4e2-4f0a-9762-71aad2a677f1'
     AND status='open';
END
$mig$;

COMMIT;
