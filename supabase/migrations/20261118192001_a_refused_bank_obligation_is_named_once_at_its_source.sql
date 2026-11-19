-- The bankers half of 20261118192000_a_refused_hand_obligation_never_holds_its_table
-- (read its header for the law). That migration taught the projection pass and the
-- outbox finish to accept a 'terminal' obligation and created the money-law epoch;
-- this one makes the two bankers classify their refusals and produce it.
-- Separate files because the envelope (fn_ca_process_hand_post_commit_obligations,
-- called by the projection pass) and atomic_distribute_rake (called by the cash
-- banker) may not share a migration after 20261118035606
-- (tests/a-cash-hand-never-waits-on-the-union-wallet.law.test.ts).

BEGIN;

SET LOCAL lock_timeout = '4s';

-- THE PREIMAGE PIN. Every body below was generated from the live definition
-- with these md5s. If any has changed since, another change landed first: this
-- migration refuses to install rather than silently revert it. Regenerate.
DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_bank_pending_cash_rake'::regproc)) IS DISTINCT FROM '41b3262d07e6ad9d70cb92d076a59448' THEN
    RAISE EXCEPTION 'preimage of public.fn_ca_bank_pending_cash_rake changed since this migration was generated' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_bank_pending_hand_obligations'::regproc)) IS DISTINCT FROM 'a1ac68083959360811d3b33b8c674f86' THEN
    RAISE EXCEPTION 'preimage of public.fn_ca_bank_pending_hand_obligations changed since this migration was generated' USING ERRCODE = '55000';
  END IF;
END $preimage$;

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

-- Every redefined function keeps production's exact grants: service_role only.
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) TO service_role;

COMMIT;
