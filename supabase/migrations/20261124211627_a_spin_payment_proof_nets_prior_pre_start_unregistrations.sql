-- 20261124211627_a_spin_payment_proof_nets_prior_pre_start_unregistrations.sql
--
-- Incident: 3c817b04-bc3a-4bc5-aa43-b2eee257584d (SpinFleetProducingNothing,
-- inbox events 448694..448706 on 2026-11-24).
--
-- ROOT CAUSE.
-- Pre-start Spin unregistration (fn_ca_unregister_tournament_player_exact,
-- start_authority = 'spin_actual_start') legitimately deletes the player's
-- tournament_players row, sets table_seats.left_at, consumes their
-- tournament_refund_entitlements row via tournament_refund_tranches, and
-- appends a matching 'refund'/'tournament_refund' credit to the immutable
-- wallet_transactions ledger. The original 'tournament_buyin' debit row
-- remains forever in wallet_transactions.
--
-- Four Spin payment-proof functions counted raw historical debit / entry rows
-- without netting prior pre-start refunds:
--   1. public.fn_spin_book_entry(uuid): v_paid_users summed only debits (so a
--      player who unregistered and re-entered failed paid_users, 131 refusals
--      on board 3b4c6299), and v_buyin_debits / v_buyin_total counted all raw
--      debits (so any prior unregister permanently poisoned seat 3 with
--      three_paid_seats_required: 45 more refusals on 3b4c6299 with
--      buyin_debits=5 and 30 refusals on 935e11b9 with buyin_debits=4).
--      fn_sync_seat_first_player_count raised P0404 on every 3rd-seat attempt
--      (humans, horses, and the spin_seat_first_fill runbook) until unfilled
--      expiry cancelled the board past the 8400s ladder envelope.
--   2. public.fn_spin_draw_and_settle(uuid, jsonb): exact same raw-debit bug.
--   3. public.fn_prove_played_spin_launch_recovery(uuid): entitlements,
--      payments, and charge_evidence CTEs counted refunded entitlements and
--      raw debits without excluding tournament_refund_tranches or netting
--      refund credits.
--   4. public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid):
--      entitlements, payments, and charge_evidence CTEs counted refunded /
--      released Diamond custody rows without excluding kind='refund' rows.
-- Additionally:
--   5. smarter_private.reliability_runbook_spin_seat_first_fill captured
--      SQLERRM into v_res->>'error' on raised seat-door exceptions, then
--      dropped it when recording the door_refused board entry, hiding the
--      three_paid_seats_required error on incident 3c817b04 attempts 4 and 5.
--
-- FIX.
-- Net prior pre-start refunds in all four payment proofs while refusing any
-- non-rostered user with a non-zero net paid amount or net entry count, and
-- record last_error in reliability_runbook_spin_seat_first_fill when present.
--
-- 45: live-proof checks all 5 functions (including net_count tightening on top of 20261124172844)
-- @live-proof: (SELECT position('AS net_count' IN pg_get_functiondef('public.fn_spin_book_entry(uuid)'::regprocedure)) > 0 AND position('AS net_count' IN pg_get_functiondef('public.fn_spin_draw_and_settle(uuid,jsonb)'::regprocedure)) > 0 AND position('tournament_refund_tranches' IN pg_get_functiondef('public.fn_prove_played_spin_launch_recovery(uuid)'::regprocedure)) > 0 AND position('rf.kind = ''refund''' IN pg_get_functiondef('public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)'::regprocedure)) > 0 AND position('''last_error''' IN pg_get_functiondef('smarter_private.reliability_runbook_spin_seat_first_fill(uuid,boolean,jsonb,timestamptz)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. public.fn_spin_book_entry(uuid): tighten post-20261124172844 net-paid
--    proof with per-user net entry count (= 1 for rostered players, = 0 for
--    departed players) and case-insensitive category matching, rejecting split
--    partial debits (e.g. 2 x 2.50 on a 5.00 Spin) while preserving every
--    v_net_irregular / 20261124172844 live-proof invariant.
DO $fix_spin_book_entry$
DECLARE
  v_oid oid := 'public.fn_spin_book_entry(uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_old text := $old$  SELECT count(*) INTO v_paid_users
    FROM (
      SELECT tp.user_id
        FROM public.tournament_players tp
        JOIN public.wallet_transactions w
          ON w.related_entity_id = tp.tournament_id
         AND w.user_id = tp.user_id
         AND ((w.type = 'debit' AND w.category = 'tournament_buyin')
              OR (w.type = 'credit' AND w.category IN ('refund','tournament_refund')))
       WHERE tp.tournament_id = p_tournament_id
       GROUP BY tp.user_id
      HAVING round(sum(CASE WHEN w.type = 'debit' THEN w.amount ELSE -w.amount END),2)
             = round(v_t.buy_in_amount,2)
    ) paid;
  -- Board-wide: exactly three identities still hold one exact buy-in, every
  -- other identity (a player who left) nets to zero, and nobody nets to any
  -- other amount (a double charge, a refund larger than the charge).
  SELECT count(*) FILTER (WHERE n.net <> 0),
         round(COALESCE(sum(n.net),0),2),
         count(*) FILTER (WHERE n.net <> 0
                            AND n.net <> round(v_t.buy_in_amount,2))
    INTO v_buyin_debits,v_buyin_total,v_net_irregular
    FROM (
      SELECT w.user_id,
             round(sum(CASE WHEN w.type = 'debit' THEN w.amount
                            ELSE -w.amount END),2) AS net
        FROM public.wallet_transactions w
       WHERE w.related_entity_id = p_tournament_id
         AND ((w.type = 'debit' AND w.category = 'tournament_buyin')
              OR (w.type = 'credit' AND w.category IN ('refund','tournament_refund')))
       GROUP BY w.user_id
    ) n;$old$;
  v_new text := $new$  SELECT count(*) INTO v_paid_users
    FROM (
      SELECT tp.user_id
        FROM public.tournament_players tp
        JOIN public.wallet_transactions w
          ON w.related_entity_id = tp.tournament_id
         AND w.user_id = tp.user_id
         AND ((w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              OR (w.type = 'credit' AND (w.category IN ('refund','tournament_refund') OR lower(w.category) IN ('refund','tournament_refund'))))
       WHERE tp.tournament_id = p_tournament_id
       GROUP BY tp.user_id
      HAVING round(sum(CASE WHEN w.type = 'debit' THEN w.amount ELSE -w.amount END),2)
             = round(v_t.buy_in_amount,2)
         AND (count(*) FILTER (WHERE w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              - count(*) FILTER (WHERE w.type = 'credit' AND lower(w.category) IN ('refund','tournament_refund'))) = 1
    ) paid;
  -- Board-wide: exactly three identities still hold one exact buy-in and
  -- net entry count 1, every other identity (a player who left) nets to zero
  -- amount and zero count, and nobody holds split/malformed entries.
  SELECT count(*) FILTER (WHERE n.net <> 0 OR n.net_count <> 0),
         round(COALESCE(sum(n.net),0),2),
         count(*) FILTER (WHERE (n.net <> 0 OR n.net_count <> 0)
                            AND (n.net <> round(v_t.buy_in_amount,2) OR n.net_count <> 1))
    INTO v_buyin_debits,v_buyin_total,v_net_irregular
    FROM (
      SELECT w.user_id,
             round(sum(CASE WHEN w.type = 'debit' THEN w.amount
                            ELSE -w.amount END),2) AS net,
             (count(*) FILTER (WHERE w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              - count(*) FILTER (WHERE w.type = 'credit' AND lower(w.category) IN ('refund','tournament_refund'))) AS net_count
        FROM public.wallet_transactions w
       WHERE w.related_entity_id = p_tournament_id
         AND ((w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              OR (w.type = 'credit' AND (w.category IN ('refund','tournament_refund') OR lower(w.category) IN ('refund','tournament_refund'))))
       GROUP BY w.user_id
    ) n;$new$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_spin_book_entry already enforces net_count and case-insensitive refund netting';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_spin_book_entry payment-proof anchor expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix_spin_book_entry$;

-- 2. public.fn_spin_draw_and_settle(uuid, jsonb): same post-20261124172844
--    net_count and case-insensitive refund tightening.
DO $fix_spin_draw_and_settle$
DECLARE
  v_oid oid := 'public.fn_spin_draw_and_settle(uuid,jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_old text := $old$  SELECT count(*) INTO v_paid_users
    FROM (
      SELECT tp.user_id
        FROM public.tournament_players tp
        JOIN public.wallet_transactions w
          ON w.related_entity_id = tp.tournament_id
         AND w.user_id = tp.user_id
         AND ((w.type = 'debit' AND w.category = 'tournament_buyin')
              OR (w.type = 'credit' AND w.category IN ('refund','tournament_refund')))
       WHERE tp.tournament_id = p_tournament_id
       GROUP BY tp.user_id
      HAVING round(sum(CASE WHEN w.type = 'debit' THEN w.amount ELSE -w.amount END),2)
             = round(v_t.buy_in_amount,2)
    ) paid;
  -- Board-wide: exactly three identities still hold one exact buy-in, every
  -- other identity (a player who left) nets to zero, and nobody nets to any
  -- other amount (a double charge, a refund larger than the charge).
  SELECT count(*) FILTER (WHERE n.net <> 0),
         round(COALESCE(sum(n.net),0),2),
         count(*) FILTER (WHERE n.net <> 0
                            AND n.net <> round(v_t.buy_in_amount,2))
    INTO v_buyin_debits,v_buyin_total,v_net_irregular
    FROM (
      SELECT w.user_id,
             round(sum(CASE WHEN w.type = 'debit' THEN w.amount
                            ELSE -w.amount END),2) AS net
        FROM public.wallet_transactions w
       WHERE w.related_entity_id = p_tournament_id
         AND ((w.type = 'debit' AND w.category = 'tournament_buyin')
              OR (w.type = 'credit' AND w.category IN ('refund','tournament_refund')))
       GROUP BY w.user_id
    ) n;$old$;
  v_new text := $new$  SELECT count(*) INTO v_paid_users
    FROM (
      SELECT tp.user_id
        FROM public.tournament_players tp
        JOIN public.wallet_transactions w
          ON w.related_entity_id = tp.tournament_id
         AND w.user_id = tp.user_id
         AND ((w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              OR (w.type = 'credit' AND (w.category IN ('refund','tournament_refund') OR lower(w.category) IN ('refund','tournament_refund'))))
       WHERE tp.tournament_id = p_tournament_id
       GROUP BY tp.user_id
      HAVING round(sum(CASE WHEN w.type = 'debit' THEN w.amount ELSE -w.amount END),2)
             = round(v_t.buy_in_amount,2)
         AND (count(*) FILTER (WHERE w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              - count(*) FILTER (WHERE w.type = 'credit' AND lower(w.category) IN ('refund','tournament_refund'))) = 1
    ) paid;
  -- Board-wide: exactly three identities still hold one exact buy-in and
  -- net entry count 1, every other identity (a player who left) nets to zero
  -- amount and zero count, and nobody holds split/malformed entries.
  SELECT count(*) FILTER (WHERE n.net <> 0 OR n.net_count <> 0),
         round(COALESCE(sum(n.net),0),2),
         count(*) FILTER (WHERE (n.net <> 0 OR n.net_count <> 0)
                            AND (n.net <> round(v_t.buy_in_amount,2) OR n.net_count <> 1))
    INTO v_buyin_debits,v_buyin_total,v_net_irregular
    FROM (
      SELECT w.user_id,
             round(sum(CASE WHEN w.type = 'debit' THEN w.amount
                            ELSE -w.amount END),2) AS net,
             (count(*) FILTER (WHERE w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              - count(*) FILTER (WHERE w.type = 'credit' AND lower(w.category) IN ('refund','tournament_refund'))) AS net_count
        FROM public.wallet_transactions w
       WHERE w.related_entity_id = p_tournament_id
         AND ((w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
              OR (w.type = 'credit' AND (w.category IN ('refund','tournament_refund') OR lower(w.category) IN ('refund','tournament_refund'))))
       GROUP BY w.user_id
    ) n;$new$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_spin_draw_and_settle already enforces net_count and case-insensitive refund netting';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_spin_draw_and_settle payment-proof anchor expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix_spin_draw_and_settle$;

-- 3. public.fn_prove_played_spin_launch_recovery(uuid): exclude consumed
--    entitlements and net wallet refunds in the chip played-Spin proof.
DO $fix_played_spin_recovery$
DECLARE
  v_oid oid := 'public.fn_prove_played_spin_launch_recovery(uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_old text := $old$), entitlements AS (
  SELECT count(e.id) AS entitlement_count,
         count(DISTINCT e.user_id) AS entitlement_users,
         count(DISTINCT e.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = e.user_id
           )
         ) AS roster_entitlement_users,
         min(e.gross) AS min_gross,
         max(e.gross) AS max_gross,
         round(COALESCE(sum(e.gross), 0), 2) AS gross_total
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id = p_tournament_id
     AND e.entitlement_kind = 'wallet_charge'
     AND e.charge_category = 'tournament_buyin'
), payments AS (
  SELECT count(w.id) AS payment_count,
         count(DISTINCT w.user_id) AS paid_users,
         count(DISTINCT w.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = w.user_id
           )
         ) AS roster_paid_users,
         min(w.amount) AS min_amount,
         max(w.amount) AS max_amount,
         round(COALESCE(sum(w.amount), 0), 2) AS payment_total
    FROM public.wallet_transactions w
   WHERE w.related_entity_id = p_tournament_id
     AND w.type = 'debit'
     AND w.category = 'tournament_buyin'
), charge_evidence AS (
  SELECT count(l.id) AS source_charge_count,
         count(l.id) FILTER (
           WHERE l.tournament_id = e.tournament_id
             AND l.club_id = e.refund_wallet_club_id
             AND l.from_type = 'player_wallet'
             AND l.from_entity_id = e.user_id
             AND l.to_type = 'prize_liability'
             AND l.to_entity_id = e.tournament_id
             AND l.category = e.charge_category
             AND l.amount = e.gross
         ) AS exact_source_charges
    FROM public.tournament_refund_entitlements e
    LEFT JOIN public.chip_ledger l ON l.id = e.source_ledger_id
   WHERE e.tournament_id = p_tournament_id
     AND e.entitlement_kind = 'wallet_charge'
     AND e.charge_category = 'tournament_buyin'
), reserve_evidence AS ($old$;
  v_new text := $new$), entitlements AS (
  SELECT count(e.id) AS entitlement_count,
         count(DISTINCT e.user_id) AS entitlement_users,
         count(DISTINCT e.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = e.user_id
           )
         ) AS roster_entitlement_users,
         min(e.gross) AS min_gross,
         max(e.gross) AS max_gross,
         round(COALESCE(sum(e.gross), 0), 2) AS gross_total
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id = p_tournament_id
     AND e.entitlement_kind = 'wallet_charge'
     AND e.charge_category = 'tournament_buyin'
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id = e.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id = e.id
     )
), payments_by_user AS (
  SELECT w.user_id,
         (count(*) FILTER (WHERE w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
          - count(*) FILTER (WHERE w.type = 'credit' AND lower(w.category) IN ('refund', 'tournament_refund'))) AS net_count,
         round(COALESCE(sum(CASE
           WHEN w.type = 'debit' AND lower(w.category) = 'tournament_buyin' THEN w.amount
           ELSE -w.amount END), 0), 2) AS net_amount
    FROM public.wallet_transactions w
   WHERE w.related_entity_id = p_tournament_id
     AND ((w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
          OR (w.type = 'credit' AND lower(w.category) IN ('refund', 'tournament_refund')))
   GROUP BY w.user_id
  HAVING (count(*) FILTER (WHERE w.type = 'debit' AND lower(w.category) = 'tournament_buyin')
          - count(*) FILTER (WHERE w.type = 'credit' AND lower(w.category) IN ('refund', 'tournament_refund'))) <> 0
      OR round(COALESCE(sum(CASE
           WHEN w.type = 'debit' AND lower(w.category) = 'tournament_buyin' THEN w.amount
           ELSE -w.amount END), 0), 2) <> 0
), payments AS (
  SELECT COALESCE(sum(p.net_count), 0) AS payment_count,
         count(*) AS paid_users,
         count(*) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = p.user_id
           )
         ) AS roster_paid_users,
         min(p.net_amount) AS min_amount,
         max(p.net_amount) AS max_amount,
         round(COALESCE(sum(p.net_amount), 0), 2) AS payment_total
    FROM payments_by_user p
), charge_evidence AS (
  SELECT count(l.id) AS source_charge_count,
         count(l.id) FILTER (
           WHERE l.tournament_id = e.tournament_id
             AND l.club_id = e.refund_wallet_club_id
             AND l.from_type = 'player_wallet'
             AND l.from_entity_id = e.user_id
             AND l.to_type = 'prize_liability'
             AND l.to_entity_id = e.tournament_id
             AND l.category = e.charge_category
             AND l.amount = e.gross
         ) AS exact_source_charges
    FROM public.tournament_refund_entitlements e
    LEFT JOIN public.chip_ledger l ON l.id = e.source_ledger_id
   WHERE e.tournament_id = p_tournament_id
     AND e.entitlement_kind = 'wallet_charge'
     AND e.charge_category = 'tournament_buyin'
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id = e.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id = e.id
     )
), reserve_evidence AS ($new$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_prove_played_spin_launch_recovery already nets prior pre-start refunds';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_prove_played_spin_launch_recovery payment-proof anchor expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix_played_spin_recovery$;

-- 4. public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid): exclude
--    refunded/released pre-start entries in the Diamond played-Spin proof.
DO $fix_diamond_played_spin_recovery$
DECLARE
  v_oid oid := 'public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_old text := $old$), entitlements AS (
  -- A Diamond entry's immutable record is its entry row in the Diamond
  -- tournament ledger, where a chip entry's is its refund entitlement.
  SELECT count(l.id) AS entitlement_count,
         count(DISTINCT l.user_id) AS entitlement_users,
         count(DISTINCT l.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = l.user_id
           )
         ) AS roster_entitlement_users,
         min(l.amount) AS min_gross,
         max(l.amount) AS max_gross,
         round(COALESCE(sum(l.amount), 0), 2) AS gross_total
    FROM public.poker_diamond_tournament_ledger l
   WHERE l.tournament_id = p_tournament_id
     AND l.kind = 'entry'
), payments AS (
  -- A Diamond entry is paid by the player's own reserve movement from the
  -- wallet into the event's custody, where a chip entry is paid by its wallet
  -- debit. Every entry custody the event ever held is read, released or not.
  SELECT count(m.request_id) AS payment_count,
         count(DISTINCT m.user_id) AS paid_users,
         count(DISTINCT m.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = m.user_id
           )
         ) AS roster_paid_users,
         min(m.amount) AS min_amount,
         max(m.amount) AS max_amount,
         round(COALESCE(sum(m.amount), 0), 2) AS payment_total
    FROM public.poker_diamond_custody c
    JOIN public.poker_diamond_movements m
      ON m.custody_id = c.id
     AND m.action = 'reserve'
     AND m.source_account = 'player:' || m.user_id::text
   WHERE c.purpose = 'tournament_entry'
     AND c.target_id = p_tournament_id
), charge_evidence AS (
  -- Each entry row names its player's own active entry custody for this
  -- event, keyed to its registration, and the reserve movement and wallet
  -- journal that paid it in, where a chip entitlement names its source
  -- ledger leg.
  SELECT count(l.id) AS source_charge_count,
         count(l.id) FILTER (
           WHERE c.user_id = l.user_id
             AND c.purpose = 'tournament_entry'
             AND c.target_id = l.tournament_id
             AND c.state = 'active'
             AND c.entry_key = 'entry:' || l.registration_id::text
             AND l.prize_part = l.amount
             AND l.bounty_part = 0
             AND l.fee_part = 0
             AND EXISTS (
               SELECT 1
                 FROM public.tournament_players tp
                WHERE tp.id = l.registration_id
                  AND tp.tournament_id = l.tournament_id
                  AND tp.user_id = l.user_id
             )
             AND EXISTS (
               SELECT 1
                 FROM public.poker_diamond_movements m
                WHERE m.custody_id = c.id
                  AND m.action = 'reserve'
                  AND m.user_id = l.user_id
                  AND m.source_account = 'player:' || l.user_id::text
                  AND m.amount = l.amount
                  AND m.wallet_journal_id = l.wallet_journal_id
             )
             AND EXISTS (
               SELECT 1
                 FROM public.diamond_transactions j
                WHERE j.id = l.wallet_journal_id
                  AND j.user_id = l.user_id
                  AND j.amount = -l.amount
             )
         ) AS exact_source_charges
    FROM public.poker_diamond_tournament_ledger l
    LEFT JOIN public.poker_diamond_custody c ON c.id = l.custody_id
   WHERE l.tournament_id = p_tournament_id
     AND l.kind = 'entry'
), draw_evidence AS ($old$;
  v_new text := $new$), entitlements AS (
  -- A Diamond entry's immutable record is its entry row in the Diamond
  -- tournament ledger, where a chip entry's is its refund entitlement.
  -- Entries refunded before the draw are excluded so a prior pre-start
  -- unregistration cannot block played-Spin recovery.
  SELECT count(l.id) AS entitlement_count,
         count(DISTINCT l.user_id) AS entitlement_users,
         count(DISTINCT l.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = l.user_id
           )
         ) AS roster_entitlement_users,
         min(l.amount) AS min_gross,
         max(l.amount) AS max_gross,
         round(COALESCE(sum(l.amount), 0), 2) AS gross_total
    FROM public.poker_diamond_tournament_ledger l
   WHERE l.tournament_id = p_tournament_id
     AND l.kind = 'entry'
     AND NOT EXISTS (
       SELECT 1
         FROM public.poker_diamond_tournament_ledger rf
        WHERE rf.tournament_id = l.tournament_id
          AND rf.custody_id = l.custody_id
          AND rf.kind = 'refund'
     )
), payments AS (
  -- A Diamond entry is paid by the player's own reserve movement from the
  -- wallet into the event's custody, where a chip entry is paid by its wallet
  -- debit. Only custodies that were released by a recorded refund are excluded;
  -- an unrefunded released custody still fails the proof.
  SELECT count(m.request_id) AS payment_count,
         count(DISTINCT m.user_id) AS paid_users,
         count(DISTINCT m.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = m.user_id
           )
         ) AS roster_paid_users,
         min(m.amount) AS min_amount,
         max(m.amount) AS max_amount,
         round(COALESCE(sum(m.amount), 0), 2) AS payment_total
    FROM public.poker_diamond_custody c
    JOIN public.poker_diamond_movements m
      ON m.custody_id = c.id
     AND m.action = 'reserve'
     AND m.source_account = 'player:' || m.user_id::text
   WHERE c.purpose = 'tournament_entry'
     AND c.target_id = p_tournament_id
     AND NOT (
       c.state = 'released'
       AND EXISTS (
         SELECT 1
           FROM public.poker_diamond_tournament_ledger rf
          WHERE rf.tournament_id = p_tournament_id
            AND rf.custody_id = c.id
            AND rf.kind = 'refund'
       )
     )
), charge_evidence AS (
  -- Each unrefunded entry row names its player's own active entry custody for
  -- this event, keyed to its registration, and the reserve movement and wallet
  -- journal that paid it in, where a chip entitlement names its source
  -- ledger leg.
  SELECT count(l.id) AS source_charge_count,
         count(l.id) FILTER (
           WHERE c.user_id = l.user_id
             AND c.purpose = 'tournament_entry'
             AND c.target_id = l.tournament_id
             AND c.state = 'active'
             AND c.entry_key = 'entry:' || l.registration_id::text
             AND l.prize_part = l.amount
             AND l.bounty_part = 0
             AND l.fee_part = 0
             AND EXISTS (
               SELECT 1
                 FROM public.tournament_players tp
                WHERE tp.id = l.registration_id
                  AND tp.tournament_id = l.tournament_id
                  AND tp.user_id = l.user_id
             )
             AND EXISTS (
               SELECT 1
                 FROM public.poker_diamond_movements m
                WHERE m.custody_id = c.id
                  AND m.action = 'reserve'
                  AND m.user_id = l.user_id
                  AND m.source_account = 'player:' || l.user_id::text
                  AND m.amount = l.amount
                  AND m.wallet_journal_id = l.wallet_journal_id
             )
             AND EXISTS (
               SELECT 1
                 FROM public.diamond_transactions j
                WHERE j.id = l.wallet_journal_id
                  AND j.user_id = l.user_id
                  AND j.amount = -l.amount
             )
         ) AS exact_source_charges
    FROM public.poker_diamond_tournament_ledger l
    LEFT JOIN public.poker_diamond_custody c ON c.id = l.custody_id
   WHERE l.tournament_id = p_tournament_id
     AND l.kind = 'entry'
     AND NOT EXISTS (
       SELECT 1
         FROM public.poker_diamond_tournament_ledger rf
        WHERE rf.tournament_id = l.tournament_id
          AND rf.custody_id = l.custody_id
          AND rf.kind = 'refund'
     )
), draw_evidence AS ($new$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_poker_diamond_prove_played_spin_launch_recovery already excludes refunded entries';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_poker_diamond_prove_played_spin_launch_recovery payment-proof anchor expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix_diamond_played_spin_recovery$;

-- 5. smarter_private.reliability_runbook_spin_seat_first_fill: preserve
--    v_res->>'error' as last_error when the seat door raises an exception.
DO $fix_spin_fill_runbook_error$
DECLARE
  v_oid oid := 'smarter_private.reliability_runbook_spin_seat_first_fill(uuid,boolean,jsonb,timestamptz)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_old text := $old$      v_boards := v_boards || (v_board || jsonb_build_object('result', 'door_refused', 'tried', v_tried,
                                                              'last_reason', coalesce(v_res->>'reason', 'no candidate')));$old$;
  v_new text := $new$      v_boards := v_boards || (v_board || jsonb_build_object('result', 'door_refused', 'tried', v_tried,
                                                              'last_reason', coalesce(v_res->>'reason', 'no candidate'))
                               || CASE WHEN v_res ? 'error' THEN jsonb_build_object('last_error', v_res->>'error') ELSE '{}'::jsonb END);$new$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE EXCEPTION 'reliability_runbook_spin_seat_first_fill already preserves last_error';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'reliability_runbook_spin_seat_first_fill door_refused anchor expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix_spin_fill_runbook_error$;

-- @probe-for: public.fn_spin_book_entry
DO $probe_spin_book_entry$
DECLARE
  v jsonb;
BEGIN
  v := public.fn_spin_book_entry(gen_random_uuid());
  IF v->>'reason' IS DISTINCT FROM 'not_a_spin' THEN
    RAISE EXCEPTION 'probe_unexpected_fn_spin_book_entry: %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_spin_book_entry$;

-- @probe-for: public.fn_spin_draw_and_settle
DO $probe_spin_draw_and_settle$
BEGIN
  BEGIN
    PERFORM public.fn_spin_draw_and_settle(gen_random_uuid(), '[]'::jsonb);
    RAISE EXCEPTION 'probe_expected_missing_spin';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM NOT LIKE 'Spin tournament % does not exist' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_spin_draw_and_settle$;

-- @probe-for: public.fn_prove_played_spin_launch_recovery
DO $probe_played_spin_recovery$
DECLARE
  v jsonb;
BEGIN
  v := public.fn_prove_played_spin_launch_recovery(gen_random_uuid());
  IF COALESCE((v->>'ok')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'probe_unexpected_played_spin_recovery: %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_played_spin_recovery$;

-- @probe-for: public.fn_poker_diamond_prove_played_spin_launch_recovery
DO $probe_diamond_played_spin_recovery$
DECLARE
  v jsonb;
BEGIN
  v := public.fn_poker_diamond_prove_played_spin_launch_recovery(gen_random_uuid());
  IF COALESCE((v->>'ok')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'probe_unexpected_diamond_played_spin_recovery: %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_diamond_played_spin_recovery$;

-- @probe-for: smarter_private.reliability_runbook_spin_seat_first_fill
DO $probe_spin_fill_runbook$
DECLARE
  v jsonb;
BEGIN
  v := smarter_private.reliability_runbook_spin_seat_first_fill(
    gen_random_uuid(), true, '{}'::jsonb, clock_timestamp()
  );
  IF NOT (v ? 'outcome') THEN
    RAISE EXCEPTION 'probe_unexpected_spin_fill_runbook: %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_spin_fill_runbook$;

-- Post-install ACL and content verification (fails closed).
DO $verify_all$
BEGIN
  IF position('AS net_count' IN pg_get_functiondef('public.fn_spin_book_entry(uuid)'::regprocedure)) = 0
     OR position('OR v_net_irregular <> 0' IN pg_get_functiondef('public.fn_spin_book_entry(uuid)'::regprocedure)) = 0
     OR position('w.category IN (''refund'',''tournament_refund'')' IN pg_get_functiondef('public.fn_spin_book_entry(uuid)'::regprocedure)) = 0
     OR position('AS net_count' IN pg_get_functiondef('public.fn_spin_draw_and_settle(uuid,jsonb)'::regprocedure)) = 0
     OR position('OR v_net_irregular <> 0' IN pg_get_functiondef('public.fn_spin_draw_and_settle(uuid,jsonb)'::regprocedure)) = 0
     OR position('w.category IN (''refund'',''tournament_refund'')' IN pg_get_functiondef('public.fn_spin_draw_and_settle(uuid,jsonb)'::regprocedure)) = 0
     OR position('tournament_refund_tranches' IN pg_get_functiondef('public.fn_prove_played_spin_launch_recovery(uuid)'::regprocedure)) = 0
     OR position('rf.kind = ''refund''' IN pg_get_functiondef('public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)'::regprocedure)) = 0
     OR position('''last_error''' IN pg_get_functiondef('smarter_private.reliability_runbook_spin_seat_first_fill(uuid,boolean,jsonb,timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'spin_net_paid_postimage_verification_failed';
  END IF;
  IF has_function_privilege('anon', 'public.fn_spin_book_entry(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_spin_book_entry(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_spin_draw_and_settle(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_spin_draw_and_settle(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_prove_played_spin_launch_recovery(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_prove_played_spin_launch_recovery(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_poker_diamond_prove_played_spin_launch_recovery(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'smarter_private.reliability_runbook_spin_seat_first_fill(uuid,boolean,jsonb,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'smarter_private.reliability_runbook_spin_seat_first_fill(uuid,boolean,jsonb,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'spin_net_paid_acl_drift';
  END IF;
END
$verify_all$;

COMMIT;
