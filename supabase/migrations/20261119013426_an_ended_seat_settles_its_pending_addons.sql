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
-- below checks each row's own evidence and aborts whole if any row fails it
-- (it no longer pins the probed count; see the note in the block). Rows whose
-- seat ended after the probe and before this commit (same defect, same
-- evidence required) are settled by the same path and reported. The 5 rows whose player is seated at that table now (4 re-seated
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
  r record;
  v_res record;
  v_n integer := 0;
  v_refunded numeric := 0;
BEGIN
  -- Corrected 2026-11-19: the first version pinned the 44 ids probed at
  -- authoring time and aborted with BOARD_MOVED when one of those players sat
  -- back down before the apply (05:36 UTC, 43 of 44). A seat that reopened is
  -- settled by the live path, so a fixed count is the wrong assertion on a
  -- board that is in play. Each row now carries its own evidence instead:
  -- cash table, no open seat for its player there, not frozen in a hand
  -- envelope, wallet debit on the ledger, no refund key, no application
  -- receipt. Any row that fails its evidence aborts the whole settlement.
  -- Read 05:44 UTC: 72 rows / 28,800.00, every one passing all six.
  FOR r IN
    SELECT a.id, a.amount, a.table_id, a.created_at
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
    IF EXISTS (SELECT 1 FROM public.wallet_credit_idempotency w
                WHERE w.key = 'addon_refund:' || r.id::text)
       OR EXISTS (SELECT 1 FROM public.cash_funding_application_receipts f
                   WHERE f.pending_addon_id = r.id) THEN
      RAISE EXCEPTION 'ADDON_ALREADY_SETTLED: % carries a refund key or an application receipt', r.id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.chip_ledger l
                    WHERE l.table_id = r.table_id AND l.created_at = r.created_at
                      AND l.from_type = 'player_wallet' AND l.to_type = 'table_stack'
                      AND l.amount = r.amount) THEN
      RAISE EXCEPTION 'ADDON_NEVER_DEBITED: % has no wallet debit on the ledger', r.id;
    END IF;
    SELECT * INTO STRICT v_res FROM public.resolve_pending_addon(r.id, NULL::numeric);
    IF COALESCE(v_res.applied, 0) <> 0 OR v_res.refunded IS DISTINCT FROM r.amount
       OR v_res.was_resolved IS NOT TRUE THEN
      RAISE EXCEPTION 'ADDON_SETTLEMENT_MISMATCH: % applied % refunded % of %',
        r.id, v_res.applied, v_res.refunded, r.amount;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wallet_credit_idempotency w
                    WHERE w.key = 'addon_refund:' || r.id::text) THEN
      RAISE EXCEPTION 'ADDON_REFUND_KEY_MISSING: %', r.id;
    END IF;
    v_n := v_n + 1;
    v_refunded := v_refunded + v_res.refunded;
  END LOOP;
  RAISE NOTICE 'ended-seat add-ons settled: % rows, % refunded', v_n, v_refunded;
END
$settle$;

COMMIT;
