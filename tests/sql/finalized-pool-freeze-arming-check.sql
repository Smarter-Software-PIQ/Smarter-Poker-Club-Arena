-- Both directions, against the armed production guard.
--
-- Each case runs the REAL statement shape the named production writer issues,
-- not a paraphrase of it, and asserts admitted or refused by name.

\set ON_ERROR_STOP on

-- ───────────────────────────────────────────────────────────────────────────
-- 1. THE SATELLITE-SEAT OVERLAY AT LOCK IS NOT A WRITE THIS TRIGGER SEES.
--
-- The statement is the one fn_complete_tournament_launch_before_lease_generation
-- issues verbatim:
--     UPDATE public.tournaments
--        SET status = 'RUNNING', started_at = ...
--      WHERE id = ... AND status = 'REGISTERING';
--
-- Its target list names status and started_at. A BEFORE UPDATE OF <cols>
-- trigger fires on the columns the STATEMENT names, so the freeze trigger does
-- not fire at all - even though zz_ca_fund_overlay_on_lock, which runs on this
-- statement, assigns NEW.prize_pool on a row whose pool is already finalized.
-- There is therefore no door to build for this write.
DO $lock_overlay$
DECLARE v_after numeric;
BEGIN
  UPDATE public.tournaments
     SET status = 'RUNNING', started_at = '2026-11-07 12:00:00+00'
   WHERE id = 'bbbb0000-0000-0000-0000-000000000001'
     AND status = 'REGISTERING';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL the lock statement matched no row'; END IF;
  SELECT prize_pool INTO v_after FROM public.tournaments
   WHERE id = 'bbbb0000-0000-0000-0000-000000000001';
  IF v_after IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION
      'FAIL the seat overlay did not fund a finalized pool at lock (pool is %)',
      v_after;
  END IF;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION
    'FAIL the armed guard refused the satellite-seat overlay at lock: %', SQLERRM;
END;
$lock_overlay$;

-- 2. AND THE PROOF ABOVE IS NOT VACUOUS. The identical overlay, on a statement
-- whose target list names ONE guarded column, IS refused. This is what the
-- trigger would do to the lock write if the lock statement ever named one.
DO $lock_overlay_named$
BEGIN
  BEGIN
    UPDATE public.tournaments
       SET status = 'RUNNING', started_at = '2026-11-07 12:00:00+00',
           prize_pool_finalized = true
     WHERE id = 'bbbb0000-0000-0000-0000-000000000002'
       AND status = 'REGISTERING';
    RAISE EXCEPTION 'FAIL a named-column lock overlay was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the named-column lock: %', SQLERRM;
    END IF;
  END;
END;
$lock_overlay_named$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. THE FOUR ORIGINAL REFUSALS, plus the pool itself.
DO $original$
DECLARE
  c_event constant uuid := 'cccc0000-0000-0000-0000-000000000001';
BEGIN
  BEGIN
    UPDATE public.tournaments SET prize_pool_finalized = false WHERE id = c_event;
    RAISE EXCEPTION 'FAIL reopening a finalized pool was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%cannot be reopened%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for reopening: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE public.tournaments
       SET payout_structure = '[{"place":1,"percentage":100}]' WHERE id = c_event;
    RAISE EXCEPTION 'FAIL a finalized payout structure change was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%payout structure and Spin draw cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for payout structure: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE public.tournaments SET spin_multiplier = 25 WHERE id = c_event;
    RAISE EXCEPTION 'FAIL a finalized Spin draw change was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%payout structure and Spin draw cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the Spin draw: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE public.tournaments SET guaranteed_prize = 500 WHERE id = c_event;
    RAISE EXCEPTION 'FAIL a finalized guarantee change was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%guarantee cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the guarantee: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE public.tournaments SET prize_pool = 999 WHERE id = c_event;
    RAISE EXCEPTION 'FAIL a finalized pool change was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the pool: %', SQLERRM; END IF;
  END;
END;
$original$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. THE BLOCKER THE INVESTIGATION FOUND, ONE: a cancel zeroes a finalized
-- pool. This is the statement shape of fn_ca_settle_tournament_abort,
-- fn_ca_settle_tournament_abort_equal_share and fn_ca_owner_retire_tournament.
-- Production did it to 130 events with funded finalized pools on 2026-11-05
-- (399,934.10 chips of pool) and to 2 more on 2026-09-27. Two of them had
-- real refund legs, so the zeroing is not stale-row cleanup:
--   PLO5 Mystery Bounty Satellite 5   6b918210, pool finalized 145.50 at
--     2026-11-02 18:27:11 UTC, cancelled 2026-11-05 07:12:13 UTC, pool -> 0;
--   Sunday Deep Stack Satellite 25    d0e730b1, pool finalized 600.00 at
--     2026-11-05 02:07:18 UTC, cancelled 2026-11-05 07:41:09 UTC, pool -> 0.
-- The armed guard refuses every one of them.
DO $cancel$
BEGIN
  BEGIN
    UPDATE public.tournaments
       SET status = 'CANCELLED', ended_at = now(), updated_at = now(),
           prize_pool = 0, bounty_pool = 0, total_rake = 0, current_players = 0
     WHERE id = 'cccc0000-0000-0000-0000-000000000001';
    RAISE EXCEPTION
      'UNEXPECTED: the cancel path zeroed a finalized pool under the armed guard';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the cancel path: %', SQLERRM; END IF;
  END;
END;
$cancel$;

-- 5. THE BLOCKER, TWO: an owner-approved guarantee overlay paid INTO a pool
-- that has already finalized. Production did exactly this on 2026-11-05 at
-- 20:15:01 UTC to Morning Free Buy (NLH) 930eee14, moving its pool 0 -> 250
-- against ledger leg 1b10c373 (entry closed 15:30:00). The armed guard
-- refuses it.
DO $owner_overlay$
BEGIN
  BEGIN
    UPDATE public.tournaments
       SET prize_pool = round(COALESCE(prize_pool, 0) + 250, 2)
     WHERE id = 'cccc0000-0000-0000-0000-000000000002';
    RAISE EXCEPTION
      'UNEXPECTED: a post-finalization owner overlay was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the owner overlay: %', SQLERRM; END IF;
  END;
END;
$owner_overlay$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. THE EXISTING SATELLITE-SETTLEMENT DOOR STILL ADMITS ITS ONE WRITE, and
-- still refuses the wrong state, a hitchhiking column and a replay.
DO $door$
DECLARE
  c_sat constant uuid := 'dddd0000-0000-0000-0000-000000000001';
  c_run constant uuid := 'dddd0000-0000-0000-0000-000000000002';
  v_pool numeric;
BEGIN
  -- 6a. The wrong state is refused even with the full corroboration present.
  PERFORM set_config('app.atomic_satellite_settlement', c_run::text, true);
  BEGIN
    UPDATE public.tournaments
       SET prize_pool = round(COALESCE(prize_pool, 0) - 45, 2) WHERE id = c_run;
    RAISE EXCEPTION 'FAIL a RUNNING satellite debit was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the RUNNING debit: %', SQLERRM; END IF;
  END;

  -- 6b. A second column may not hitchhike on the admitted debit.
  PERFORM set_config('app.atomic_satellite_settlement', c_sat::text, true);
  BEGIN
    UPDATE public.tournaments
       SET prize_pool = round(COALESCE(prize_pool, 0) - 45, 2), bounty_pool = 1
     WHERE id = c_sat;
    RAISE EXCEPTION 'FAIL a hitchhiking column was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the hitchhiker: %', SQLERRM; END IF;
  END;

  -- 6c. Without the GUC the same proven debit is refused.
  PERFORM set_config('app.atomic_satellite_settlement', '', true);
  BEGIN
    UPDATE public.tournaments
       SET prize_pool = round(COALESCE(prize_pool, 0) - 45, 2) WHERE id = c_sat;
    RAISE EXCEPTION 'FAIL an unannounced debit was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the unannounced debit: %', SQLERRM; END IF;
  END;

  -- 6d. The one provable debit is admitted. This is the statement
  -- fn_award_satellite_seat issues against the satellite row.
  PERFORM set_config('app.atomic_satellite_settlement', c_sat::text, true);
  UPDATE public.tournaments
     SET prize_pool = round(COALESCE(prize_pool, 0) - 45, 2) WHERE id = c_sat;
  SELECT prize_pool INTO v_pool FROM public.tournaments WHERE id = c_sat;
  IF v_pool IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION 'FAIL the admitted debit did not land (pool is %)', v_pool;
  END IF;
END;
$door$;

-- 6e. A REPLAY IS REFUSED. The payout receipt and the transfer journal the
-- award writes in the same transaction are what make the second debit
-- unprovable. Put them there, restore the pool, and ask again.
INSERT INTO public.tournament_payouts (tournament_id, user_id, position, source)
VALUES ('dddd0000-0000-0000-0000-000000000001',
        'ffff0000-0000-0000-0000-000000000001', 1, 'satellite_seat');
INSERT INTO public.chip_ledger (idempotency_key)
VALUES ('tourney:dddd0000-0000-0000-0000-000000000001:seat:ffff0000-0000-0000-0000-000000000001:pool_transfer');

DO $replay$
BEGIN
  -- Restore the pre-debit pool without the guard's help, so the replay is the
  -- same 90 -> 45 statement the door admitted once.
  ALTER TABLE public.tournaments
    DISABLE TRIGGER zzzz_freeze_finalized_tournament_prize_pool;
  UPDATE public.tournaments SET prize_pool = 90
   WHERE id = 'dddd0000-0000-0000-0000-000000000001';
  ALTER TABLE public.tournaments
    ENABLE TRIGGER zzzz_freeze_finalized_tournament_prize_pool;
  PERFORM set_config('app.atomic_satellite_settlement',
    'dddd0000-0000-0000-0000-000000000001', true);
  BEGIN
    UPDATE public.tournaments
       SET prize_pool = round(COALESCE(prize_pool, 0) - 45, 2)
     WHERE id = 'dddd0000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL a replayed satellite debit was admitted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%prize pool cannot change%' THEN
      RAISE EXCEPTION 'FAIL wrong refusal for the replay: %', SQLERRM; END IF;
  END;
END;
$replay$;

SELECT 'PASS: the satellite-seat overlay at lock is outside the trigger''s column list and needs no door; the same overlay on a named column is refused; the four original refusals hold; the cancel path and a post-finalization owner overlay are REFUSED; the satellite-settlement door admits one provable debit and refuses the wrong state, a hitchhiker, an unannounced debit and a replay' AS result;
