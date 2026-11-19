-- 20261119013426_an_ended_seat_settles_its_pending_addons
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-19 01:34:26 UTC.
--
-- AN ENDED SEAT SETTLES ITS PENDING ADD-ONS (2026-11-19).
--
-- WHAT WAS WRONG (read from production rows, 2026-11-19 ~01:30 UTC).
-- public.table_pending_addons held 49 rows with resolved_at IS NULL, every one
-- a 400.00 kind 'rebuy' by a horse on a 1/2 Lightning Games FEEDER (anchor)
-- table, the oldest from 2026-11-05 06:26 UTC, new ones arriving every few
-- minutes. For all 49: chip_ledger has the 400.00 player_wallet -> table_stack
-- 'rebuy' leg at the row's own created_at (wallet debited), each has its
-- cash_participant_funding_receipts row, none has a
-- cash_funding_application_receipts row, none has a wallet_credit_idempotency
-- key 'addon_refund:<id>' (never refunded), none is frozen in a hand
-- envelope. resolve_pending_addon is the only writer that puts a pending row's
-- chips on a stack, and it stamps resolved_at in the same transaction, so an
-- unresolved row was never applied. The lightning_hand_player stack series
-- confirms it on row 07f849fb: busted to 0.00 at 23:35:14, the auto-rebuy
-- debited 400 at 23:35:15, the next hand at 23:42:32 started at 400.00 only
-- because a SECOND 400 (the Lightning top-up door, ledger 'addon') landed at
-- 23:42:32; the seat cashed out 355.60 at 23:45:45 and the rebuy stayed open.
-- The same shape holds for all 49: a direct 400 'addon' top-up 1-7 s after the
-- pending rebuy, then a cash-out of the stack alone.
--
-- THE CAUSE. A pending add-on has exactly two consumers: the accepted-hand
-- post-commit processor and fn_ca_resolve_unbound_pending_addons, both called
-- by the table's own engine. A Lightning anchor never deals (its hands are
-- played in the pool), and its halted pass (ServerTableEngineDealing
-- .passWhileDealingHalted) asks the resolver ONLY for a seated player whose
-- roster stack is 0. The moment the top-up door funded the seat the row had no
-- consumer left, and when the seat ended nothing on the exit path looked at
-- table_pending_addons at all: every cash-out moves the stack and leaves the
-- debit floating for ever. 2026-11-18 23:35-23:42 the resolver also failed 63
-- times on the ca_promo_play_through_grants NOWAIT lock (that holder is fixed),
-- which is how tonight's example lost its only window; but any miss of that
-- window strands the row, because the seat ending never settles it.
--
-- WHAT THIS CHANGES. A pending add-on now ends no later than its seat. The
-- existing AFTER triggers zz_record_ended_seat_occupancy /
-- zz_record_deleted_seat_occupancy already fire on public.table_seats at the
-- moment a cash occupancy ends (left_at set, occupant or occupancy changed, or
-- the row deleted); their function, smarter_private.fn_record_ended_seat_occupancy,
-- now settles before it records. Replacing a function body takes no lock on
-- table_seats, so no daily-window install is needed. If the
-- player has no other open seat at that table, every unresolved add-on of
-- theirs on that table that is not frozen in an open hand envelope is locked
-- and handed to the platform's own resolve_pending_addon, which - finding the
-- seat vacated - returns the whole debit through atomic_credit_wallet_and_log
-- under the idempotency key 'addon_refund:<row id>' and stamps the row
-- resolved, in the leaving transaction. A row frozen in an open envelope stays
-- with the post-commit processor, which reaches the same vacated-seat refund.
-- The block never catches an error: if the refund cannot be made the seat
-- exit rolls back whole and is retried by its caller, so a seat can never end
-- with its add-on stranded. No cron, no sweep: the exit is the moment.
--
-- THE SETTLEMENT (CLAUDE.md 10.9). Probed 2026-11-19 in one self-aborting DO
-- block (11.5): of the 49 open rows, 44 have no open seat for their player at
-- that table; resolve_pending_addon on each returned applied 0.00 / refunded
-- 400.00, 17,600.00 in total, 44 new 'addon_refund:' keys, deferred
-- constraints (ledger tally, seat custody) passed under SET CONSTRAINTS ALL
-- IMMEDIATE. All 44 are horses (10.5: refunded exactly as a human). The block
-- below asserts every probed id is still in the probed state and aborts if the
-- board moved. Rows whose seat ended after the probe and before this commit
-- (same defect, same evidence required) are settled by the same path and
-- reported. The 5 rows whose player is seated at that table now (4 re-seated
-- after the funded occupancy ended, 1 still on it) are not touched: resolving
-- them now would land 400 on a live Lightning anchor; the trigger refunds each
-- the moment that seat ends, or the engine delivers it first. Nothing is
-- "applied but never marked": the evidence above rules that shape out.
--
-- NOT CHANGED HERE, REPORTED: every one of the 49 was a double purchase. At the
-- same hand boundary fn_lightning_auto_rebuy queued the 400 rebuy and the
-- Lightning horse top-up door (requestLightningHorseTopUps) charged and landed
-- a second 400 directly. With this change the undelivered one is returned at
-- the seat's end at the latest, so no chip is lost; the top-up door not
-- consulting an open pending add-on is a separate defect for its own change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION smarter_private.fn_record_ended_seat_occupancy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_kind text; v_ended timestamptz; v_addon record; v_res record;
BEGIN
  IF OLD.user_id IS NULL OR OLD.table_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Cash only, exactly the tables fn_log_seat_stack_exit journals.
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.id = OLD.table_id AND t.tournament_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.tables t JOIN public.clubs c ON c.id = t.club_id
                 WHERE t.id = OLD.table_id AND c.asset = 'diamonds') THEN
    RETURN NULL;
  END IF;

  -- AN ENDED SEAT SETTLES ITS PENDING ADD-ONS (20261119013426). When the
  -- player's LAST open chair at this table has ended, every unresolved add-on
  -- of theirs here that no open hand envelope owns is resolved now, through
  -- resolve_pending_addon, which finds the seat vacated and returns the whole
  -- debit under 'addon_refund:<id>'. Plain FOR UPDATE, never SKIP LOCKED: a
  -- resolver holding the row may yet roll back, and a skipped row would be
  -- stranded behind an exit that already committed. No error is caught: if the
  -- refund cannot be made the exit rolls back whole and its caller retries.
  IF NOT EXISTS (SELECT 1 FROM public.table_seats s
                  WHERE s.table_id = OLD.table_id AND s.user_id = OLD.user_id
                    AND s.left_at IS NULL) THEN
    FOR v_addon IN
      SELECT a.id
        FROM public.table_pending_addons a
       WHERE a.table_id = OLD.table_id
         AND a.user_id = OLD.user_id
         AND a.resolved_at IS NULL
       ORDER BY a.created_at, a.id
       FOR UPDATE
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1
          FROM public.hand_atomic_commits c
         WHERE c.table_id = OLD.table_id
           AND c.post_commit_payload IS NOT NULL
           AND c.post_commit_completed_at IS NULL
           AND jsonb_typeof(c.post_commit_payload #> '{pending_addons,ids}') = 'array'
           AND (c.post_commit_payload #> '{pending_addons,ids}') ? v_addon.id::text
      );
      SELECT * INTO STRICT v_res
        FROM public.resolve_pending_addon(v_addon.id, NULL::numeric);
      IF COALESCE(v_res.applied, 0) <> 0 THEN
        RAISE EXCEPTION 'ENDED_SEAT_ADDON_APPLIED: add-on % landed % on a seat that had ended',
          v_addon.id, v_res.applied USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  IF OLD.joined_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_kind := 'deleted'; v_ended := COALESCE(OLD.left_at, clock_timestamp());
  ELSIF OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
        AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
        AND NEW.occupancy_id IS NOT DISTINCT FROM OLD.occupancy_id THEN
    v_kind := 'left'; v_ended := NEW.left_at;
  ELSE
    v_kind := 'reoccupied'; v_ended := COALESCE(OLD.left_at, clock_timestamp());
  END IF;
  INSERT INTO smarter_private.cash_seat_occupancy_history
    (seat_id, user_id, joined_at, table_id, occupancy_id, club_id, seat_number, stack_at_end, ended_at, end_kind)
  VALUES (OLD.id, OLD.user_id, OLD.joined_at, OLD.table_id, OLD.occupancy_id, OLD.club_id,
          OLD.seat_number, OLD.stack, v_ended, v_kind)
  ON CONFLICT (seat_id, user_id, joined_at) DO NOTHING;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_record_ended_seat_occupancy() FROM PUBLIC, anon, authenticated;

-- The two existing triggers (zz_record_ended_seat_occupancy, AFTER UPDATE OF
-- user_id, occupancy_id, left_at; zz_record_deleted_seat_occupancy, AFTER
-- DELETE) already fire at exactly the moment an occupancy ends. Replacing the
-- function body takes no lock on public.table_seats, so this installs during
-- play. Their register notes said "writes no balance and never refuses"; that
-- is no longer true, so they say what they do now.
UPDATE public.ca_declared_money_triggers
   SET note = 'AFTER row trigger: settles the ending seat''s unresolved pending add-ons through resolve_pending_addon (vacated-seat refund keyed addon_refund:<id>; refuses the exit if that refund fails) and records the ended cash occupancy into smarter_private.cash_seat_occupancy_history'
 WHERE table_name = 'table_seats' AND trigger_name = 'zz_record_ended_seat_occupancy';
UPDATE public.ca_declared_money_triggers
   SET note = 'AFTER DELETE row trigger: settles the deleted seat''s unresolved pending add-ons through resolve_pending_addon (vacated-seat refund keyed addon_refund:<id>; refuses the delete if that refund fails) and records the deleted cash occupancy into smarter_private.cash_seat_occupancy_history'
 WHERE table_name = 'table_seats' AND trigger_name = 'zz_record_deleted_seat_occupancy';

-- THE SETTLEMENT: the rows whose seat ended before this body existed.
DO $settle$
DECLARE
  v_probed uuid[] := ARRAY[
    '2931968a-7ebd-4c7e-990d-1a43845d12b2','bd8af98c-3db4-4b5c-b8b2-bed12f8775d1',
    '038653a8-2b98-463a-94cc-f417db55ae64','fc87e3bc-7834-415e-aca1-ae4965048a28',
    'f8b94da4-b3fc-47b8-892b-e0955dfe4c58','0c207b12-3efd-4dd4-88e1-7996f075b2cf',
    '6518552b-43a6-4c6f-bcc0-04430d9b9493','be855e20-6620-479d-afa6-3360d4eee381',
    '6f9701b7-cbcf-4b2d-a99e-4da1fa942d50','316d7ddf-72f3-4ce8-ba18-698e79338601',
    '1e2f97d2-ebbb-4173-a7b0-f07c115aa8fa','72c32ec0-cdb1-4914-bc58-b53d0e8750ce',
    'ea047fa0-0387-4386-8a78-8ccfc3bed120','dadbcdbb-abd4-408b-9a1c-6011259c87f3',
    '12045a9f-cf23-4623-956b-93d63794e281','4b254f5a-0687-4d44-be91-5e787d3759f1',
    'f8636604-4b18-4ff6-bb37-c3218a4e52aa','ed756827-5e77-4ac2-b9f9-24984357d615',
    '8ee29338-2e99-4dbd-aff9-6d787aa86058','6443179a-51a5-4154-b573-04e9d8f009fe',
    '32249005-e6b5-44dd-a3e5-956bbef3cbb0','1f6ccf47-c27f-4083-872e-9bd076235162',
    'bd8f24ec-c3b7-4d1e-8a27-0ee6d8e60be3','ff97dc44-637e-4bdc-aa42-7572b5110eea',
    'c7fa8b98-a17b-448f-9751-9b7c7ddbb170','85ef2583-ad26-4522-a8d6-7b6fd96676cd',
    '2bf6ed38-3c85-4028-a29f-2a818c54293a','078c2f5d-18de-4a99-b662-42cfa19b6d30',
    '73bcf479-2709-4cd3-bbad-bdb11f8d224c','8ea2bafb-b6ee-488f-9ef3-6fa9b9114764',
    '86d0d162-37f0-4613-994d-3dd124647024','0d590423-7e5f-4414-8552-1fe7573b2f9b',
    '4af760e4-6e31-4a9c-ac3d-a41ee7146f4e','cf123719-86f9-4101-b519-588b5e777268',
    'ca0c2516-f7b6-4ce0-a1cd-2767b1759bf0','63c68b00-eb77-4d88-80bd-a9a88ac795c5',
    'd0366c6d-42fa-44b3-b1e6-0df82dcd9b09','07f849fb-3f66-45cf-bb36-7bc43e6d9bee',
    '78785c6a-2b5f-48ad-93ce-ebaed6d756df','e50f39b3-7f4c-47b8-9c7d-cedd8d9bab85',
    'a65db55a-0aa0-42fe-8e74-4e7ac228a0dc','8f2c89b1-f8d6-4c2d-88b2-8b76e2b56cf5',
    '2f21ae5a-99bb-4ce4-8f11-3639a4ea0193','64995aa2-16b2-4570-9108-2506c27e0043'
  ]::uuid[];
  v_ready integer;
  v_ready_amount numeric;
  r record;
  v_res record;
  v_n integer := 0;
  v_refunded numeric := 0;
  v_probed_n integer := 0;
  v_probed_refunded numeric := 0;
BEGIN
  -- The board as probed: every id unresolved, 400.00, debited, never refunded,
  -- no open seat for its player at that table, not frozen in an envelope.
  SELECT count(*), COALESCE(sum(a.amount), 0) INTO v_ready, v_ready_amount
    FROM public.table_pending_addons a
    JOIN public.tables t ON t.id = a.table_id AND t.tournament_id IS NULL
   WHERE a.id = ANY (v_probed)
     AND a.resolved_at IS NULL
     AND a.amount = 400.00
     AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                      WHERE s.table_id = a.table_id AND s.user_id = a.user_id
                        AND s.left_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.wallet_credit_idempotency w
                      WHERE w.key = 'addon_refund:' || a.id::text)
     AND NOT EXISTS (SELECT 1 FROM public.cash_funding_application_receipts f
                      WHERE f.pending_addon_id = a.id)
     AND EXISTS (SELECT 1 FROM public.chip_ledger l
                  WHERE l.table_id = a.table_id AND l.created_at = a.created_at
                    AND l.from_type = 'player_wallet' AND l.to_type = 'table_stack'
                    AND l.amount = a.amount);
  IF v_ready <> 44 OR v_ready_amount <> 17600.00 THEN
    RAISE EXCEPTION 'BOARD_MOVED: % of 44 probed add-ons (% of 17600.00) are still in the probed state',
      v_ready, v_ready_amount;
  END IF;

  FOR r IN
    SELECT a.id, a.amount
      FROM public.table_pending_addons a
      JOIN public.tables t ON t.id = a.table_id AND t.tournament_id IS NULL
     WHERE a.resolved_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                        WHERE s.table_id = a.table_id AND s.user_id = a.user_id
                          AND s.left_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM public.hand_atomic_commits c
          WHERE c.table_id = a.table_id
            AND c.post_commit_payload IS NOT NULL
            AND c.post_commit_completed_at IS NULL
            AND jsonb_typeof(c.post_commit_payload #> '{pending_addons,ids}') = 'array'
            AND (c.post_commit_payload #> '{pending_addons,ids}') ? a.id::text)
     ORDER BY a.created_at, a.id
     FOR UPDATE OF a
  LOOP
    -- Same evidence for a row that appeared after the probe: debited, never
    -- refunded, never applied. Anything else aborts the whole settlement.
    IF EXISTS (SELECT 1 FROM public.wallet_credit_idempotency w
                WHERE w.key = 'addon_refund:' || r.id::text)
       OR EXISTS (SELECT 1 FROM public.cash_funding_application_receipts f
                   WHERE f.pending_addon_id = r.id) THEN
      RAISE EXCEPTION 'ADDON_ALREADY_SETTLED: % carries a refund key or an application receipt', r.id;
    END IF;
    SELECT * INTO STRICT v_res FROM public.resolve_pending_addon(r.id, NULL::numeric);
    IF COALESCE(v_res.applied, 0) <> 0 OR v_res.refunded IS DISTINCT FROM r.amount
       OR v_res.was_resolved IS NOT TRUE THEN
      RAISE EXCEPTION 'ADDON_SETTLEMENT_MISMATCH: % applied % refunded % of %',
        r.id, v_res.applied, v_res.refunded, r.amount;
    END IF;
    v_n := v_n + 1;
    v_refunded := v_refunded + v_res.refunded;
    IF r.id = ANY (v_probed) THEN
      v_probed_n := v_probed_n + 1;
      v_probed_refunded := v_probed_refunded + v_res.refunded;
    END IF;
  END LOOP;

  IF v_probed_n <> 44 OR v_probed_refunded <> 17600.00 THEN
    RAISE EXCEPTION 'PROBED_SET_NOT_SETTLED: % rows / % refunded, expected 44 / 17600.00',
      v_probed_n, v_probed_refunded;
  END IF;
  IF (SELECT count(*) FROM public.wallet_credit_idempotency w
       WHERE w.key = ANY (SELECT 'addon_refund:' || x::text FROM unnest(v_probed) x)) <> 44 THEN
    RAISE EXCEPTION 'PROBED_REFUND_KEYS_MISSING';
  END IF;
  RAISE NOTICE 'ended-seat add-ons settled: % rows, % refunded (probed 44 / 17600.00, % later rows / %)',
    v_n, v_refunded, v_n - v_probed_n, v_refunded - v_probed_refunded;
END
$settle$;

COMMIT;
