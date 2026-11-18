-- A refused hand obligation never holds its table, and a refusal that cannot
-- change on retry is named once, at its source, instead of retried forever.
--
-- INCIDENT d2d79c4f (2026-11-18): hand 59989058's stored rake refused
-- 23514 cash_earning_seat_provenance_missing_or_ambiguous on every attempt
-- (7,000+ by 19:04 UTC, about one a second). Two defects made one bad hand
-- into a stopped table:
--
--   1. ONE HAND HELD ITS WHOLE TABLE. a0_finish_hand_post_commit_obligations
--      refuses to let a hand's outbox row leave while its rake, BBJ drop or
--      insurance leg is stored, and fn_project_hand_side_effects ends every
--      pass while one is stored. The engine walks a table's outbox in hand
--      order and stops at the first row the database keeps, so the table's
--      later hands never even reached their own banking: 22 later rakes sat at
--      zero attempts behind the one that could never bank.
--   2. EVERY REFUSAL WAS TREATED AS A RETRY. A refusal no retry can change
--      (a check, a data or a privilege refusal, a named refusal) was retried
--      as if a lock were busy, and paged only through the ten-minute stranded
--      watchdog.
--
-- THE LAW HERE:
--   * The two bankers classify. A transient refusal (serialization or
--     deadlock class 40, lock_not_available 55P03, object_in_use 55006,
--     resources 53, operator 57, connection 08) stays retryable, exactly as
--     before. Every other refusal is DETERMINISTIC: the obligation is marked
--     terminal under the current money-law epoch and one critical
--     financial_alerts row names it at the source, at once. While the law is
--     unchanged the banker answers 'terminal' without running again.
--   * A terminal obligation stays stored in its own row (held on the felt by
--     the tally, never lost), but it no longer holds its hand: the projection
--     pass and the outbox finish accept 'terminal', so the hand's statistics
--     project and the table's later hands bank and project in order.
--   * A REFUSAL IS ASKED AGAIN WHEN THE LAW CHANGES, deterministically and
--     without a timer. Every CREATE or ALTER FUNCTION/PROCEDURE commits one
--     row in smarter_private.money_law_changes (only while a terminal
--     obligation exists); the epoch is the newest committed row, so a fix
--     still being installed is never seen early. The banker reads the epoch
--     BEFORE it runs, so an attempt made under the old code can never be
--     stamped with the new epoch. The next pass on the obligation's table asks
--     every terminal obligation stamped under an older epoch again, with the
--     same call, before any lock, never waiting on a shared row. Why the epoch
--     and not a timer: the only thing that can change a deterministic answer
--     is a change of code, so a change of code is the only re-ask. Why any
--     function and not a named list: the refusal can come from anywhere in
--     the call graph (atomic_distribute_rake, fn_cash_earning_club, the BBJ
--     and insurance writers and their readers); a list would silently miss
--     the function that fixes it.
--   * fn_post_commit_stranded_watchdog no longer counts an obligation already
--     named terminal under the current law (it is paged at its source); an
--     obligation whose law has changed and still waits is counted as before.
--
-- No watcher, sweeper or repair job is added: the re-ask runs inside the
-- table's own continuation, and the epoch only moves when code is installed.

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS smarter_private.money_law_changes (
  id             bigserial   PRIMARY KEY,
  changed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  command_tag    text,
  object_identity text
);
REVOKE ALL ON smarter_private.money_law_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE smarter_private.money_law_changes_id_seq FROM PUBLIC, anon, authenticated;
INSERT INTO smarter_private.money_law_changes (command_tag, object_identity)
VALUES ('MIGRATION', 'a_refused_hand_obligation_never_holds_its_table');

CREATE OR REPLACE FUNCTION smarter_private.money_law_epoch()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE(max(id), 0) FROM smarter_private.money_law_changes
$function$;
REVOKE ALL ON FUNCTION smarter_private.money_law_epoch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.money_law_epoch() TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.bank_refusal_is_transient(p_sqlstate text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT p_sqlstate IS NULL
      OR left(p_sqlstate, 2) IN ('40', '53', '57', '08')
      OR p_sqlstate IN ('55P03', '55006')
$function$;
REVOKE ALL ON FUNCTION smarter_private.bank_refusal_is_transient(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.bank_refusal_is_transient(text) TO service_role;

ALTER TABLE public.cash_rake_pending
  ADD COLUMN IF NOT EXISTS terminal_epoch bigint,
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;
ALTER TABLE public.hand_bank_obligation_pending
  ADD COLUMN IF NOT EXISTS terminal_epoch bigint,
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;
CREATE INDEX IF NOT EXISTS cash_rake_pending_terminal_idx
  ON public.cash_rake_pending (table_id, hand_number) WHERE terminal_epoch IS NOT NULL;
CREATE INDEX IF NOT EXISTS hand_bank_obligation_pending_terminal_idx
  ON public.hand_bank_obligation_pending (table_id, hand_number) WHERE terminal_epoch IS NOT NULL;

CREATE OR REPLACE FUNCTION smarter_private.fn_money_law_changed()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  -- Only a held refusal needs the law to move; with none, nothing is written.
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending WHERE terminal_epoch IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending WHERE terminal_epoch IS NOT NULL) THEN
    INSERT INTO smarter_private.money_law_changes (command_tag, object_identity)
    SELECT c.command_tag, c.object_identity
      FROM pg_event_trigger_ddl_commands() c
     WHERE c.object_type IN ('function', 'procedure')
     LIMIT 1;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_money_law_changed() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS ca_money_law_change_reasks_refusals;
CREATE EVENT TRIGGER ca_money_law_change_reasks_refusals ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE PROCEDURE', 'ALTER PROCEDURE')
  EXECUTE FUNCTION smarter_private.fn_money_law_changed();

CREATE OR REPLACE FUNCTION public.fn_ca_bank_pending_cash_rake(p_hand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  p public.cash_rake_pending%ROWTYPE;
  r record;
  v_union uuid;
  v_lock_timeout text := current_setting('lock_timeout');
  v_state text;
  v_msg text;
  v_epoch bigint;
  v_was_terminal boolean := false;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'cash_rake_bank_not_authorised' USING ERRCODE = '42501';
  END IF;
  -- Read BEFORE the attempt: an attempt under old code never carries a new epoch.
  v_epoch := smarter_private.money_law_epoch();

  BEGIN
    SELECT * INTO p FROM public.cash_rake_pending c
     WHERE c.hand_id = p_hand_id
       FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      -- Banked already, or another continuation holds it right now.
      RETURN jsonb_build_object('status', 'absent', 'hand_id', p_hand_id);
    END IF;

    /* A DETERMINISTIC REFUSAL STANDS UNTIL THE LAW CHANGES (20261118192000).
       Answer it without running it again. */
    IF p.terminal_epoch IS NOT NULL AND p.terminal_epoch >= v_epoch THEN
      RETURN jsonb_build_object('status', 'terminal', 'hand_id', p_hand_id,
                                'error', p.last_error, 'terminal_at', p.terminal_at);
    END IF;
    v_was_terminal := p.terminal_epoch IS NOT NULL;

    /* NEVER WAIT FOR THE SHARED WALLET ROW. The union this rake is routed to
       is the game's stamp, read as atomic_distribute_rake reads it. A wallet
       someone holds leaves the obligation exactly where it is; whoever holds
       it is not this hand's problem and this hand is not theirs. */
    SELECT CASE WHEN COALESCE(t.is_private, false) THEN NULL ELSE t.union_id END
      INTO v_union
      FROM public.tables t WHERE t.id = p.table_id;
    IF v_union IS NOT NULL THEN
      PERFORM 1 FROM public.union_wallets w
        WHERE w.union_id = v_union
          FOR NO KEY UPDATE NOWAIT;
    END IF;
    PERFORM set_config('lock_timeout', '250ms', true);

    -- The call the envelope made, argument for argument.
    SELECT * INTO r
      FROM public.atomic_distribute_rake(
        p.table_id,
        (p.rake->>'club_id')::uuid,
        p.hand_id,
        p.hand_number::integer,
        (p.rake->>'amount')::numeric,
        COALESCE((p.rake->>'bbj')::numeric, 0),
        NULLIF(p.rake->>'pot', '')::numeric,
        NULLIF(p.rake->>'num_players', '')::integer,
        COALESCE(p.rake->'contributions', '{}'::jsonb),
        NULLIF(p.rake->>'tournament_id', '')::uuid,
        COALESCE(p.rake->'returned_uncalled', '{}'::jsonb),
        COALESCE(NULLIF(p.rake->>'method', ''), 'WEIGHTED_CONTRIBUTED')
      );
    IF NOT FOUND OR NOT (
      COALESCE(r.applied, false)
      OR COALESCE(r.already_processed, false)
      OR r.rake_record_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'rake obligation did not produce a receipt for hand %', p_hand_id;
    END IF;

    DELETE FROM public.cash_rake_pending c WHERE c.hand_id = p_hand_id;
    IF v_was_terminal THEN
      UPDATE public.financial_alerts a
         SET resolved = true, resolved_at = now(),
             resolution = 'banked after the money law that refused it changed'
       WHERE a.source = 'bank_obligation_terminal_refusal' AND NOT a.resolved
         AND a.context->>'hand_id' = p_hand_id::text AND a.context->>'obligation' = 'rake';
    END IF;
    PERFORM set_config('lock_timeout', v_lock_timeout, true);
    RETURN jsonb_build_object(
      'status', 'banked', 'hand_id', p_hand_id, 'amount', p.amount,
      'applied', r.applied, 'already_processed', r.already_processed,
      'recovered', r.recovered, 'rake_record_id', r.rake_record_id,
      'route', r.spendable_route, 'union_id', r.union_id_out);
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('status', 'busy', 'hand_id', p_hand_id);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  -- Refused: nothing above was kept. The obligation stays, and says why.
  IF smarter_private.bank_refusal_is_transient(v_state) THEN
    UPDATE public.cash_rake_pending c
       SET attempts = c.attempts + 1,
           last_attempt_at = clock_timestamp(),
           last_error = left(v_state || ': ' || v_msg, 500)
     WHERE c.hand_id = p_hand_id;
    RETURN jsonb_build_object('status', 'refused', 'hand_id', p_hand_id,
                              'sqlstate', v_state, 'error', v_msg);
  END IF;

  /* A REFUSAL NO RETRY CAN CHANGE (20261118192000): held under this law,
     named once at its source, and no longer holding its hand or table. */
  UPDATE public.cash_rake_pending c
     SET attempts = c.attempts + 1,
         last_attempt_at = clock_timestamp(),
         last_error = left(v_state || ': ' || v_msg, 500),
         terminal_epoch = v_epoch,
         terminal_at = clock_timestamp()
   WHERE c.hand_id = p_hand_id;
  IF FOUND THEN
    INSERT INTO public.financial_alerts (severity, source, message, context)
    VALUES ('critical', 'bank_obligation_terminal_refusal',
      'A stored hand rake was refused by a rule no retry can change: ' || left(v_msg, 200)
        || '. It is held on its own row, not lost, and is asked again when the money law next changes.',
      jsonb_build_object('obligation', 'rake', 'hand_id', p_hand_id, 'table_id', p.table_id,
                         'hand_number', p.hand_number, 'amount', p.amount, 'sqlstate', v_state,
                         'error', left(v_msg, 500), 'law_epoch', v_epoch));
  END IF;
  RETURN jsonb_build_object('status', 'terminal', 'hand_id', p_hand_id,
                            'sqlstate', v_state, 'error', v_msg);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ca_bank_pending_hand_obligations(p_hand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  k record;
  p public.hand_bank_obligation_pending%ROWTYPE;
  v_lock_timeout text := current_setting('lock_timeout');
  v_pool_id uuid;
  v_receipt uuid;
  v_union uuid; v_club uuid; v_private boolean;
  v_state text; v_msg text;
  v_items jsonb := '[]'::jsonb;
  v_status text;
  v_epoch bigint;
  v_was_terminal boolean;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'hand_bank_obligation_not_authorised' USING ERRCODE = '42501';
  END IF;
  -- Read BEFORE any attempt: an attempt under old code never carries a new epoch.
  v_epoch := smarter_private.money_law_epoch();

  FOR k IN
    SELECT b.kind, b.item_key
      FROM public.hand_bank_obligation_pending b
     WHERE b.hand_id = p_hand_id
     ORDER BY b.kind, b.item_key
  LOOP
    v_state := NULL; v_msg := NULL; v_was_terminal := false;
    BEGIN
      SELECT * INTO p FROM public.hand_bank_obligation_pending b
       WHERE b.hand_id = p_hand_id AND b.kind = k.kind AND b.item_key = k.item_key
         FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        -- Banked already, or another continuation holds it right now.
        v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'absent');
        CONTINUE;
      END IF;

      /* A DETERMINISTIC REFUSAL STANDS UNTIL THE LAW CHANGES (20261118192000). */
      IF p.terminal_epoch IS NOT NULL AND p.terminal_epoch >= v_epoch THEN
        v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'terminal',
                                                 'error', p.last_error);
        CONTINUE;
      END IF;
      v_was_terminal := p.terminal_epoch IS NOT NULL;

      IF p.kind = 'bbj_contribution' THEN
        /* NEVER WAIT FOR THE UNION'S POOL. The same advisory key and the same
           pool choice the envelope made, each refused at once if anyone holds
           it. The drop banks to the union the envelope read at hand time
           (UNION LAW: money follows the union of the game when the hand was
           played, as rake does), never to one read later. */
        v_union := p.union_id;
        IF NOT pg_try_advisory_xact_lock(hashtextextended(
             'bbj-pool:' || COALESCE(v_union::text, 'club:' || (p.obligation->>'club_id')), 0)) THEN
          RAISE EXCEPTION 'bbj pool lock held' USING ERRCODE = '55P03';
        END IF;
        v_pool_id := NULL;
        IF v_union IS NULL THEN
          SELECT bp.id INTO v_pool_id
            FROM public.bbj_pools bp
           WHERE bp.club_id = (p.obligation->>'club_id')::uuid
             AND bp.status = 'active'
           ORDER BY bp.created_at, bp.id
           LIMIT 1
           FOR UPDATE NOWAIT;
          /* A standalone club whose pool was closed because it joined a union
             while this drop waited. fn_close_club_wallets_on_union_join paid
             that pool's balance into the club's chip_treasury and retired the
             pool; there is no receipt shape for a drop paid straight into a
             treasury, so this drop is refused by name (it pages through
             fn_post_commit_stranded_watchdog) instead of opening an orphan
             pool the club no longer plays under. */
          IF v_pool_id IS NULL AND EXISTS (
               SELECT 1 FROM public.bbj_pools bp
                WHERE bp.club_id = (p.obligation->>'club_id')::uuid
                  AND bp.union_id IS NULL AND bp.status = 'retired') THEN
            RAISE EXCEPTION 'bbj_club_pool_closed_on_union_join: club %''s pool was retired into its chip_treasury (fn_close_club_wallets_on_union_join) while drop of hand % waited',
              p.obligation->>'club_id', p_hand_id USING ERRCODE = '55000';
          END IF;
        ELSE
          SELECT bp.id INTO v_pool_id
            FROM public.bbj_pools bp
           WHERE bp.union_id = v_union
             AND bp.status = 'active'
           ORDER BY bp.created_at, bp.id
           LIMIT 1
           FOR UPDATE NOWAIT;
        END IF;
        PERFORM set_config('lock_timeout', '250ms', true);
        IF v_pool_id IS NULL THEN
          IF v_union IS NULL THEN
            INSERT INTO public.bbj_pools(club_id, main_balance, backup_balance, promo_balance, status)
            VALUES ((p.obligation->>'club_id')::uuid, 0, 0, 0, 'active') RETURNING id INTO v_pool_id;
          ELSE
            INSERT INTO public.bbj_pools(union_id, main_balance, backup_balance, promo_balance, status)
            VALUES (v_union, 0, 0, 0, 'active') RETURNING id INTO v_pool_id;
          END IF;
        END IF;

        -- The call the envelope made, argument for argument.
        SELECT r.id INTO v_receipt
          FROM public.bbj_record_contribution(
            v_pool_id,
            p.hand_id,
            p.table_id,
            (p.obligation->>'amount')::numeric,
            0, 0, 0,
            COALESCE((p.obligation->>'big_blind')::numeric, 2),
            p.hand_number::integer,
            (p.obligation->>'club_id')::uuid
          ) r;
        IF v_receipt IS NULL THEN
          RAISE EXCEPTION 'BBJ contribution produced no receipt for hand %', p_hand_id;
        END IF;
      ELSE
        /* NEVER WAIT FOR THE INSURANCE BANK. The bank is the one the envelope
           stored (the union of the game at hand time); record_insurance_transaction
           chooses it again from the table and club, and a leg whose bank would
           now differ is refused by name rather than paid from another bank.
           A net payout takes the union's 'insurance-bank:' lock by try, as
           the envelope and the debit door serialise on it; the bank row is
           taken NOWAIT, only when the leg moves it. */
        SELECT t.club_id, t.union_id, COALESCE(t.is_private, false)
          INTO v_club, v_union, v_private
          FROM public.tables t WHERE t.id = p.table_id;
        IF v_private THEN
          v_union := NULL;
        ELSIF v_union IS NULL THEN
          SELECT c.union_id INTO v_union FROM public.clubs c
           WHERE c.id = (p.obligation->>'club_id')::uuid;
        END IF;
        IF v_union IS DISTINCT FROM p.union_id THEN
          RAISE EXCEPTION 'insurance_bank_union_changed: hand % stored union %, the table now banks with %',
            p_hand_id, p.union_id, v_union USING ERRCODE = '55000';
        END IF;
        IF p.felt_amount < 0 AND v_union IS NOT NULL
           AND NOT pg_try_advisory_xact_lock(hashtextextended('insurance-bank:' || v_union::text, 0)) THEN
          RAISE EXCEPTION 'insurance bank lock held' USING ERRCODE = '55P03';
        END IF;
        IF p.felt_amount <> 0 THEN
          IF v_union IS NOT NULL THEN
            PERFORM 1 FROM public.union_wallets w
              WHERE w.union_id = v_union FOR NO KEY UPDATE NOWAIT;
          ELSE
            PERFORM 1 FROM public.club_wallets w
              WHERE w.club_id = (p.obligation->>'club_id')::uuid FOR NO KEY UPDATE NOWAIT;
          END IF;
        END IF;
        PERFORM set_config('lock_timeout', '250ms', true);

        -- The call the envelope made, argument for argument.
        SELECT r.id INTO v_receipt
          FROM public.record_insurance_transaction(
            p.table_id,
            (p.obligation->>'club_id')::uuid,
            p.hand_number::integer,
            (p.obligation->>'player_id')::uuid,
            COALESCE((p.obligation->>'equity_percent')::numeric, 0),
            COALESCE((p.obligation->>'premium')::numeric, 0),
            COALESCE((p.obligation->>'insured_amount')::numeric, 0),
            COALESCE((p.obligation->>'payout')::numeric, 0),
            COALESCE((p.obligation->>'player_won')::boolean, false),
            COALESCE(NULLIF(p.obligation->>'kind', ''), 'insurance')::varchar
          ) r;
        IF v_receipt IS NULL THEN
          RAISE EXCEPTION 'insurance obligation produced no receipt for hand %', p_hand_id;
        END IF;
      END IF;

      DELETE FROM public.hand_bank_obligation_pending b
       WHERE b.hand_id = p_hand_id AND b.kind = p.kind AND b.item_key = p.item_key;
      IF v_was_terminal THEN
        UPDATE public.financial_alerts a
           SET resolved = true, resolved_at = now(),
               resolution = 'banked after the money law that refused it changed'
         WHERE a.source = 'bank_obligation_terminal_refusal' AND NOT a.resolved
           AND a.context->>'hand_id' = p_hand_id::text AND a.context->>'obligation' = p.kind
           AND a.context->>'item' = p.item_key;
      END IF;
      PERFORM set_config('lock_timeout', v_lock_timeout, true);
      v_items := v_items || jsonb_build_object('kind', p.kind, 'item', p.item_key, 'status', 'banked',
                                               'receipt', v_receipt, 'amount', p.felt_amount);
      CONTINUE;
    EXCEPTION
      WHEN lock_not_available THEN
        v_state := 'busy';
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    PERFORM set_config('lock_timeout', v_lock_timeout, true);

    IF v_state = 'busy' THEN
      -- Whoever holds the shared row is not this hand's problem: the
      -- obligation stays exactly where it is.
      v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'busy');
    ELSIF smarter_private.bank_refusal_is_transient(v_state) THEN
      -- Refused: nothing above was kept. The obligation stays, and says why.
      UPDATE public.hand_bank_obligation_pending b
         SET attempts = b.attempts + 1,
             last_attempt_at = clock_timestamp(),
             last_error = left(v_state || ': ' || v_msg, 500)
       WHERE b.hand_id = p_hand_id AND b.kind = k.kind AND b.item_key = k.item_key;
      v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'refused',
                                               'sqlstate', v_state, 'error', v_msg);
    ELSE
      /* A REFUSAL NO RETRY CAN CHANGE (20261118192000): held under this law,
         named once at its source, and no longer holding its hand or table. */
      UPDATE public.hand_bank_obligation_pending b
         SET attempts = b.attempts + 1,
             last_attempt_at = clock_timestamp(),
             last_error = left(v_state || ': ' || v_msg, 500),
             terminal_epoch = v_epoch,
             terminal_at = clock_timestamp()
       WHERE b.hand_id = p_hand_id AND b.kind = k.kind AND b.item_key = k.item_key;
      IF FOUND THEN
        INSERT INTO public.financial_alerts (severity, source, message, context)
        VALUES ('critical', 'bank_obligation_terminal_refusal',
          'A stored hand ' || replace(k.kind, '_', ' ') || ' was refused by a rule no retry can change: '
            || left(v_msg, 200) || '. It is held on its own row, not lost, and is asked again when the money law next changes.',
          jsonb_build_object('obligation', k.kind, 'item', k.item_key, 'hand_id', p_hand_id,
                             'table_id', p.table_id, 'hand_number', p.hand_number, 'amount', p.felt_amount,
                             'sqlstate', v_state, 'error', left(v_msg, 500), 'law_epoch', v_epoch));
      END IF;
      v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'terminal',
                                               'sqlstate', v_state, 'error', v_msg);
    END IF;
  END LOOP;

  v_status := CASE
    WHEN jsonb_array_length(v_items) = 0 THEN 'absent'
    WHEN EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending b WHERE b.hand_id = p_hand_id) THEN
      CASE WHEN v_items @> '[{"status":"refused"}]' THEN 'refused'
           WHEN v_items @> '[{"status":"busy"}]' OR v_items @> '[{"status":"absent"}]' THEN 'busy'
           ELSE 'terminal' END
    ELSE 'banked' END;
  RETURN jsonb_build_object('status', v_status, 'hand_id', p_hand_id, 'items', v_items);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_project_hand_side_effects(p_hand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table_id uuid;
  v_hand_number bigint;
  v_history_table_id uuid;
  v_history_hand_number bigint;
  v_commit_table_id uuid;
  v_commit_hand_number bigint;
  v_post_commit jsonb;
  v_seat_uid uuid;
  v_hand_bank jsonb;
  v_reask jsonb;
  v_reask_hand uuid;
BEGIN
  IF NOT (current_user IN ('postgres','service_role')) THEN
    RAISE EXCEPTION 'fn_project_hand_side_effects is engine/service only';
  END IF;

  /* LOCK ORDER 1: read the exact durable scope without claiming the outbox.
     Another worker may finish it after this read; the implementation claim
     below remains the sole authority to apply projections. */
  SELECT o.table_id, o.hand_number
    INTO v_table_id, v_hand_number
    FROM public.hand_projection_outbox o
   WHERE o.hand_id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_pending',
      'hand_id', p_hand_id
    );
  END IF;

  SELECT h.table_id, h.hand_number
    INTO v_history_table_id, v_history_hand_number
    FROM public.hand_history h
   WHERE h.id = p_hand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending hand projection has no hand history row: %', p_hand_id;
  END IF;

  SELECT c.table_id, c.hand_number
    INTO v_commit_table_id, v_commit_hand_number
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id;
  IF NOT FOUND
     OR v_history_table_id IS DISTINCT FROM v_table_id
     OR v_history_hand_number IS DISTINCT FROM v_hand_number
     OR v_commit_table_id IS DISTINCT FROM v_table_id
     OR v_commit_hand_number IS DISTINCT FROM v_hand_number THEN
    RAISE EXCEPTION
      'pending hand projection scope disagrees with immutable hand receipt: %',
      p_hand_id;
  END IF;

  /* A REFUSAL IS ASKED AGAIN AFTER THE LAW CHANGES (20261118192000). An earlier
     hand of this table whose stored obligation was refused deterministically
     no longer holds the table: its outbox row left with the obligation still
     stored. Once code has been installed since that refusal, this table's
     next pass asks it again with the same call, before any table or player
     lock, never waiting on a shared row. Its own hand's pass keeps asking too. */
  FOR v_reask_hand IN
    SELECT x.hand_id FROM (
      SELECT rp.hand_id, rp.hand_number FROM public.cash_rake_pending rp
       WHERE rp.table_id = v_table_id AND rp.hand_id <> p_hand_id
         AND rp.terminal_epoch IS NOT NULL
         AND rp.terminal_epoch < smarter_private.money_law_epoch()
      UNION
      SELECT bp.hand_id, bp.hand_number FROM public.hand_bank_obligation_pending bp
       WHERE bp.table_id = v_table_id AND bp.hand_id <> p_hand_id
         AND bp.terminal_epoch IS NOT NULL
         AND bp.terminal_epoch < smarter_private.money_law_epoch()) x
     ORDER BY x.hand_number
     LIMIT 4
  LOOP
    v_reask := COALESCE(v_reask, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'hand_id', v_reask_hand,
      'cash_rake', CASE WHEN EXISTS (SELECT 1 FROM public.cash_rake_pending r WHERE r.hand_id = v_reask_hand)
                        THEN public.fn_ca_bank_pending_cash_rake(v_reask_hand) END,
      'hand_bank', CASE WHEN EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending b WHERE b.hand_id = v_reask_hand)
                        THEN public.fn_ca_bank_pending_hand_obligations(v_reask_hand) END));
  END LOOP;
  /* Anything banked holds its wallet or pool until COMMIT: end the pass here,
     as the hand's own banking does. A re-ask that refused again holds nothing. */
  IF v_reask IS NOT NULL AND jsonb_path_exists(v_reask, '$.** ? (@.status == "banked")') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', 'refused_obligation_banked_after_law_change',
      'reask', v_reask,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* THE HAND'S BBJ DROP AND INSURANCE LEGS ARE BANKED BY ITS OWN
     CONTINUATION (20261118071728), in the same pass as its rake and before any
     table or player lock. The banker never waits for the union's BBJ pool or
     insurance bank; a busy one leaves the obligation stored. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = p_hand_id) THEN
    v_hand_bank := public.fn_ca_bank_pending_hand_obligations(p_hand_id);
  END IF;

  /* THE HAND'S RAKE IS BANKED BY ITS OWN CONTINUATION (20261118). A cash
     hand's completed envelope stores its rake in cash_rake_pending instead of
     crediting the shared union wallet row, so a dealing table never waits on
     whoever holds that row. This pass banks it before any table or player
     lock is taken and never waits for the wallet. It ends here either way:
     the outbox row is the durable continuation, and the worker already
     defers predecessor_pending without claiming success. Statistics run on
     the next pass, so they never run while this transaction holds the wallet. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = p_hand_id) THEN
    v_post_commit := public.fn_ca_bank_pending_cash_rake(p_hand_id);
    /* A rake refused by a rule no retry can change (20261118192000) holds
       nothing and no longer holds this hand: it stays stored, named at its
       source, and the hand projects so its table's later hands proceed. */
    IF v_post_commit->>'status' IS DISTINCT FROM 'terminal' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', CASE WHEN v_post_commit->>'status' = 'banked'
                     THEN 'cash_rake_banked_in_this_transaction'
                     ELSE 'cash_rake_pending' END,
      'cash_rake', v_post_commit,
      'hand_bank', v_hand_bank,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
    END IF;
  END IF;

  /* A pass that banked (or tried to bank) a drop or an insurance leg ends
     here, like the rake pass above: statistics never run while this
     transaction holds the pool or the bank (20261118071728). */
  IF v_hand_bank IS NOT NULL
     AND (v_hand_bank->>'status' IS DISTINCT FROM 'terminal'
          OR jsonb_path_exists(v_hand_bank, '$.items[*] ? (@.status == "banked")')) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', CASE WHEN v_hand_bank->>'status' IN ('banked', 'absent')
                     THEN 'hand_bank_obligations_banked_in_this_transaction'
                     ELSE 'hand_bank_obligations_pending' END,
      'hand_bank', v_hand_bank,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* LOCK ORDER 1b (20261019): this tournament's shared lane, waiting, before
     any lock, so the post-commit and projection writes below are never
     refused by a tournament authority mid-transaction. */
  PERFORM smarter_private.f06_wait_table_lane(v_table_id);

  /* LOCK ORDER 2: every path that can consume the frozen post-commit envelope
     owns this per-table advisory lock before reaching any player/stat row. */
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-post-commit:' || v_table_id::text, 0)
  );

  /* LOCK ORDER 3: consume the exact stored envelope, or leave the outbox row
     untouched. predecessor_pending is returned unchanged so the event-driven
     worker preserves causal order. Any thrown validation/hash error aborts the
     transaction and is intentionally not converted into success. */
  /* LOCK ORDER 2b (20261015094418): one player order for the whole
     transaction. The rake, promo and projection passes below each touch a
     player's player_stats row, each in its own order; two hands sharing
     players deadlocked between passes. Every seated player is claimed here,
     in uuid order, before any pass runs. */
  FOR v_seat_uid IN
    SELECT DISTINCT (pl->>'userId')::uuid
      FROM public.hand_history h,
           jsonb_array_elements(CASE WHEN jsonb_typeof(h.players) = 'array'
                                     THEN h.players ELSE '[]'::jsonb END) pl
     WHERE h.id = p_hand_id
       AND (pl->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('player-stats:' || v_seat_uid::text, 0));
  END LOOP;

  v_post_commit :=
    public.fn_ca_process_hand_post_commit_obligations(p_hand_id);
  IF COALESCE((v_post_commit->>'ok')::boolean, false) IS NOT TRUE
     AND COALESCE(v_post_commit->>'reason', '') <> 'legacy_no_obligations' THEN
    RETURN COALESCE(v_post_commit, '{}'::jsonb) || jsonb_build_object(
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* A newly completed envelope still holds the union wallet row until this
     transaction commits. End this pass before taking projection locks or
     writing dashboard facts. The outbox row is the durable continuation.
     The existing worker already defers predecessor_pending without claiming
     success: here its predecessor is the just-completed financial phase. */
  IF (v_post_commit->>'ok')::boolean IS TRUE
     AND (v_post_commit->>'already_completed')::boolean IS FALSE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', 'post_commit_completed_in_this_transaction',
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* LOCK ORDER 4: projection serialisation comes after post-commit. The
     preserved implementation next claims this exact outbox row FOR UPDATE,
     checks projection predecessors, applies the unchanged projections, and
     deletes through a0_finish_hand_post_commit_obligations. The trigger's
     second processor call is an idempotent completed/legacy assertion while
     this transaction still owns both advisory locks. */
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-projection:' || v_table_id::text, 0)
  );

  RETURN public.fn_project_hand_side_effects_after_post_commit_20260908(
    p_hand_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_finish_hand_post_commit_obligations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.fn_ca_process_hand_post_commit_obligations(OLD.hand_id);
  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE
     AND v_result->>'reason' <> 'legacy_no_obligations' THEN
    RAISE EXCEPTION 'hand post-commit obligations remain pending for %: %',
      OLD.hand_id, v_result;
  END IF;
  /* 20261118: the outbox row is the continuation that banks a cash hand's
     stored rake. It may not leave while that rake is still pending. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_cash_rake(OLD.hand_id);
    /* 20261118192000: a rake refused by a rule no retry can change stays
       stored and named; it does not hold the hand's outbox row. */
    IF COALESCE(v_result->>'status', '') NOT IN ('banked', 'terminal') THEN
      RAISE EXCEPTION 'hand rake remains pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  /* 20261118071728: nor while its BBJ drop or an insurance leg is pending. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_hand_obligations(OLD.hand_id);
    IF COALESCE(v_result->>'status', '') NOT IN ('banked', 'terminal') THEN
      RAISE EXCEPTION 'hand bank obligations remain pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_post_commit_stranded_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare v_n int; v_oldest timestamptz; v_sample jsonb;
  v_pending int; v_pending_oldest timestamptz; v_pending_sample jsonb;
begin
  select count(*), min(committed_at),
         coalesce(jsonb_agg(jsonb_build_object('table_id', table_id, 'hand_number', hand_number, 'committed_at', committed_at)) filter (where rn <= 10), '[]')
    into v_n, v_oldest, v_sample
    from (select table_id, hand_number, committed_at, row_number() over (order by committed_at) rn
            from hand_atomic_commits
           where post_commit_payload is not null and post_commit_completed_at is null
             and committed_at < now() - interval '10 minutes') s;

  /* 20261118071728: a completed envelope's rake, BBJ drop or insurance leg
     still stored after the same grace. Its hand's outbox row cannot leave, so
     that table's projections wait on it: page, with why it has not banked. */
  select count(*), min(created_at),
         coalesce(jsonb_agg(jsonb_build_object('obligation', kind, 'hand_id', hand_id, 'table_id', table_id,
                                               'hand_number', hand_number, 'stored_at', created_at,
                                               'attempts', attempts, 'last_error', last_error))
                  filter (where rn <= 10), '[]')
    into v_pending, v_pending_oldest, v_pending_sample
    from (select u.*, row_number() over (order by u.created_at) rn
            from (select 'rake'::text kind, rp.hand_id, rp.table_id, rp.hand_number, rp.created_at,
                         rp.attempts, rp.last_error
                    from cash_rake_pending rp
                   where rp.created_at < now() - interval '10 minutes'
                     and (rp.terminal_epoch is null or rp.terminal_epoch < smarter_private.money_law_epoch())
                  union all
                  select bp.kind, bp.hand_id, bp.table_id, bp.hand_number, bp.created_at,
                         bp.attempts, bp.last_error
                    from hand_bank_obligation_pending bp
                   where bp.created_at < now() - interval '10 minutes'
                     and (bp.terminal_epoch is null or bp.terminal_epoch < smarter_private.money_law_epoch())) u) s;

  if v_n + v_pending > 0 then
    if not exists (select 1 from financial_alerts where source='fn_post_commit_stranded_watchdog' and not resolved) then
      insert into financial_alerts (severity, source, message, context)
      values ('critical','fn_post_commit_stranded_watchdog',
        (v_n + v_pending) || ' committed hand obligation(s) still unfinished after 10+ minutes (' || v_n || ' envelope(s), oldest ' || coalesce(v_oldest::text, '-') || '; ' || v_pending || ' stored rake/BBJ/insurance obligation(s), oldest ' || coalesce(v_pending_oldest::text, '-') || '). Players'' balances, stats or rake for these hands may be incomplete.',
        jsonb_build_object('stranded', v_n, 'oldest', v_oldest, 'sample', v_sample,
                           'pending_obligations', v_pending, 'pending_oldest', v_pending_oldest,
                           'pending_sample', v_pending_sample));
    end if;
  else
    update financial_alerts set resolved = true, resolved_at = now(), resolution = 'no stranded post-commit work remains'
     where source='fn_post_commit_stranded_watchdog' and not resolved;
  end if;
  return jsonb_build_object('stranded', v_n, 'oldest', v_oldest,
                            'pending_obligations', v_pending, 'pending_oldest', v_pending_oldest);
end $function$;

-- Every redefined function keeps production's exact grants: service_role only.
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_project_hand_side_effects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_project_hand_side_effects(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_finish_hand_post_commit_obligations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_post_commit_stranded_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_post_commit_stranded_watchdog() TO service_role;

COMMIT;
