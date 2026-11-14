-- 20261114194730_the_four_played_cert_hu_clubs_retire_with_their_owners
--
-- Reserved by scripts/new-migration.mjs on 2026-11-14 19:47:30 UTC.
--
-- CLAUDE.md 10.9 / 10.11: the reasoning goes in this header, not just the SQL.
--
-- THE FOUR PLAYED CERT HU CLUBS RETIRE WITH THEIR OWNERS (Dan, 2026-11-14):
--   "REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE POKER ARENA."
--
-- WHAT IS LEFT, READ FROM ROWS (2026-11-14 19:40-19:50 UTC). After the
-- reserved post-deploy identities were retired (20261114163238, 185038,
-- 192610), four remain, each the owner of a heads-up rematch certification
-- club that scripts/ci/certify-heads-up-rematch.mjs created on 2026-11-09 and
-- whose run died before its cleanup:
--
--   club                                  name              owner            treasury
--   5db856cf-7a83-4a7e-9ed1-2ee4a83f141c  Cert HU 05448714  PostDeploy58e6e  99,700.00
--   e5d50964-7f44-47fe-948c-81bb8d633f25  Cert HU 08278575  PostDeploy97c6a  99,700.00
--   f5eebc0e-00f3-467c-b753-79cfebcaeda0  Cert HU 10629595  PostDeploya5afb  99,699.90
--   17b36e27-0671-404e-8d92-308e4ee69b8a  Cert HU 12100714  PostDeployf9c82  99,699.80
--
-- Each club holds exactly its welcome package and the certificate's own play:
--   - the 100,000.00 opening grant, less the package's BBJ principal (100.00,
--     bbj_pools main, untouched: no contribution, payout or promo) and Spin
--     reserve seed (200.00, spin_bonus_pools balance = seeded_amount, seed
--     source chip_treasury, nothing returned yet), less 0.10 burned as the fee
--     of each completed heads-up Sit & Go (1 or 2 per club), plus a 0.10
--     standalone-week rake mint where one was booked. Treasury + 300.00 is the
--     club's whole estate: 100,000.00 / 100,000.00 / 99,999.90 / 99,999.80.
--   - members: the owner (active, zero balances) and the run's two players,
--     both reserved identities, both already deleted and departed, zero
--     balances. No agents, no club or diamond wallet balance, no inventory,
--     no issued ticket, no cashout, chip request, escrow hold or open
--     settlement period, no leaderboard seed, nobody seated, no session, no
--     waitlist, no pending managed command, unused wheel and diamond-game pools.
--   - games: 9 welcome cash games (live, no seat), 1 welcome schedule spawning
--     a daily MTT, 12 welcome Sit & Go / Spin boards, and 15 or 16 unstarted
--     tournaments in all, every one with 0 players, no escrow money, no spin
--     multiplier and no start; 1-2 completed heads-up Sit & Gos (with play).
--
-- WHY NO DOOR RETIRED THEM. fn_retire_settled_club runs
-- fn_unwind_unused_first_club_welcome_package first, and that unwind refuses a
-- club in which any Sit & Go was played (WELCOME_PACKAGE_HAS_PLAY_OR_
-- REGISTRATION_HISTORY). The Cert Residue Sweep has refused all four on every
-- run since 2026-11-09 (runs 42602987778, 43628368812, 43631715353), and
-- certify-heads-up-rematch.mjs stopped creating such clubs for exactly this
-- reason (CERTIFICATION_CLUB_CAN_RETIRE = false). Nothing creates a fifth, so
-- this is a one-time settlement of exactly these four ids, not a new door.
--
-- WHAT THIS DOES, PER CLUB, AND WHY EACH STEP IS SAFE.
--   1. Proves everything above again from rows, inside the transaction, with
--      the club, member, tournament and pool rows locked, and refuses on any
--      difference (identity, owner namespace, union, every balance, every
--      seat, every unstarted game, both pools, the exact treasury).
--   2. As the owner (request.jwt claims, the way
--      fn_ca_retire_stale_welcome_fixture_with_history acts as a fixture's
--      owner), stops every recurrence source and cancels or closes every game
--      exactly as the welcome unwind does: Spin pool inactive, schedules
--      inactive, wheel and diamond-game configs disabled, Spin/BBJ flags off,
--      cash games dormant, every unstarted tournament cancelled through
--      atomic_cancel_tournament (the receipted door; each receipt is asserted
--      zero-player and fully settled), every open table closed, any pending
--      managed command cancelled. No money moves in this step.
--   3. Returns the welcome principal to the club bank through the platform's
--      own movers, byte for byte the unwind's: fn_spin_deactivate returns the
--      200.00 seed (asserted), and the 100.00 BBJ principal moves through
--      fn_spin_move_owner_wallet under a treasury_transfer declaration, with
--      its chip_transactions row; the BBJ pool is retired. The welcome items
--      are marked retired under one operation id with its reset receipt.
--   4. Retires the whole estate, now all in the club bank, to chip_retirement
--      (a non-circulating store, so the supply meter reads a burn, never chips
--      vanishing) through fn_ca_declare_ledger('burn','chip_retirement',...),
--      the declaration fn_retire_settled_club and fn_ca_retire_certification_
--      club use; the burn row is read back by its idempotency key and asserted
--      to the cent. Total for the four: 399,999.70.
--   5. Asserts fn_club_retirement_impact reads zero everywhere (chips,
--      diamonds, inventory, obligations, running tables, live tournaments,
--      cash games, schedules, commands, diamond games).
--   6. Marks the owner's profile deleted with no actor claim
--      (fn_only_close_account_closes_an_account refuses the owner deleting
--      itself); the deleted-account triggers prove custody settled and depart
--      the membership while the club is still active.
--   7. Retires the club through fn_retire_settled_club_core_20260906 as the
--      owner, which rechecks every balance and obligation, writes the audit
--      trail and flips lifecycle to 'retired' with records retained, and emits
--      the same per-recipient events fn_retire_settled_club emits.
--
-- WHAT IS KEPT. Every club row, hand, tournament, receipt, ledger and
-- membership row stays, read-only behind the retired-club guard. Nothing is
-- deleted. The run's two players per club were already deleted earlier today.
--
-- LOCKS. The settlement lane (terminal G, then hand barrier B) is taken with
-- try-locks first, as smarter_private.cancellation_lane takes it, so this
-- never queues an exclusive request ahead of a hand; busy means refused, and
-- it is sent again. Every cancellation inside re-enters the held lane.
--
-- @live-proof: (SELECT count(*) FROM public.clubs WHERE id IN ('5db856cf-7a83-4a7e-9ed1-2ee4a83f141c','e5d50964-7f44-47fe-948c-81bb8d633f25','f5eebc0e-00f3-467c-b753-79cfebcaeda0','17b36e27-0671-404e-8d92-308e4ee69b8a') AND lifecycle_status='retired' AND chip_treasury=0) = 4 AND (SELECT count(*) FROM public.profiles WHERE id IN ('b6424182-88d2-46a7-a3d4-e7ea68ead245','54d534d6-5984-471b-86b2-5b9ff37cafc3','57bca7de-9099-47c2-8364-eba25cbf1ff7','c18acfca-d33b-4ef8-a280-ba90a4d94e40') AND status='deleted') = 4

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $cert_hu_retire$
DECLARE
  c record;
  v_club public.clubs%ROWTYPE;
  v_email text;
  v_bbj public.bbj_pools%ROWTYPE;
  v_spin public.spin_bonus_pools%ROWTYPE;
  v_op uuid;
  v_t uuid;
  v_cancel jsonb;
  v_cancelled integer;
  v_open integer;
  v_spin_result jsonb;
  v_saved jsonb;
  v_after numeric;
  v_total numeric;
  v_key text;
  v_impact jsonb;
  v_result jsonb;
  v_recipient uuid;
  v_n integer;
  v_retired_total numeric := 0;
  v_prior_claims text := current_setting('request.jwt.claims', true);
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF public.fn_platform_frozen() THEN
    RAISE EXCEPTION 'CERT_HU_PLATFORM_FROZEN: send again after the thaw' USING ERRCODE = '55000';
  END IF;
  -- The settlement lane, G then B, never queued (smarter_private.cancellation_lane).
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca:tournament-terminal-settlement:v1', 0)) THEN
    RAISE EXCEPTION 'CERT_HU_SETTLEMENT_LANE_BUSY: send again' USING ERRCODE = '55P03';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca:hand-settlement-barrier:v1', 0)) THEN
    RAISE EXCEPTION 'CERT_HU_HAND_BARRIER_BUSY: send again' USING ERRCODE = '55P03';
  END IF;

  FOR c IN
    SELECT * FROM (VALUES
      ('17b36e27-0671-404e-8d92-308e4ee69b8a'::uuid, 'Cert HU 12100714', 'c18acfca-d33b-4ef8-a280-ba90a4d94e40'::uuid, 99699.80::numeric),
      ('5db856cf-7a83-4a7e-9ed1-2ee4a83f141c'::uuid, 'Cert HU 05448714', 'b6424182-88d2-46a7-a3d4-e7ea68ead245'::uuid, 99700.00::numeric),
      ('e5d50964-7f44-47fe-948c-81bb8d633f25'::uuid, 'Cert HU 08278575', '54d534d6-5984-471b-86b2-5b9ff37cafc3'::uuid, 99700.00::numeric),
      ('f5eebc0e-00f3-467c-b753-79cfebcaeda0'::uuid, 'Cert HU 10629595', '57bca7de-9099-47c2-8364-eba25cbf1ff7'::uuid, 99699.90::numeric)
    ) x(club_id, club_name, owner_id, treasury)
    ORDER BY club_id
  LOOP
    v_op := gen_random_uuid();
    PERFORM set_config('app.ledger_idempotency_key', '', true);

    -- 1. Prove the club is exactly what was measured.
    PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:' || c.club_id::text, 0));
    SELECT * INTO v_club FROM public.clubs WHERE id = c.club_id FOR UPDATE;
    IF NOT FOUND OR v_club.name IS DISTINCT FROM c.club_name OR v_club.name NOT LIKE 'Cert HU %'
       OR v_club.owner_id IS DISTINCT FROM c.owner_id OR v_club.lifecycle_status IS DISTINCT FROM 'active'
       OR v_club.union_id IS NOT NULL OR COALESCE(v_club.is_union, false)
       OR COALESCE(v_club.asset, 'chips') <> 'chips' THEN
      RAISE EXCEPTION 'CERT_HU_IDENTITY_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = c.owner_id;
    IF v_email IS NULL OR v_email NOT LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
       OR NOT public.fn_ca_reserved_certification_identity(c.owner_id) THEN
      RAISE EXCEPTION 'CERT_HU_OWNER_REFUSED: %', c.club_id USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.unions u WHERE u.id = c.club_id)
       OR EXISTS (SELECT 1 FROM public.union_clubs uc WHERE uc.club_id = c.club_id OR uc.union_id = c.club_id) THEN
      RAISE EXCEPTION 'CERT_HU_UNION_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;
    IF v_club.chip_treasury IS DISTINCT FROM c.treasury OR COALESCE(v_club.chip_pool, 0) <> 0
       OR COALESCE(v_club.promo_balance, 0) <> 0 OR COALESCE(v_club.insurance_balance, 0) <> 0 THEN
      RAISE EXCEPTION 'CERT_HU_BANK_CHANGED: % treasury % expected %', c.club_id, v_club.chip_treasury, c.treasury
        USING ERRCODE = '55000';
    END IF;

    PERFORM 1 FROM public.club_members m WHERE m.club_id = c.club_id ORDER BY m.user_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.club_members m WHERE m.club_id = c.club_id
                AND (NOT public.fn_ca_reserved_certification_identity(m.user_id)
                  OR abs(COALESCE(m.chip_balance, 0)) + abs(COALESCE(m.promo_balance, 0))
                   + abs(COALESCE(m.held_chips, 0)) + abs(COALESCE(m.locked_chips, 0))
                   + abs(COALESCE(m.credit_used, 0)) + abs(COALESCE(m.credit_limit, 0))
                   + abs(COALESCE(m.diamonds, 0)) <> 0
                  OR (m.membership_lifecycle_status = 'active' AND m.user_id <> c.owner_id)))
       OR NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.club_id = c.club_id
                       AND m.user_id = c.owner_id AND m.role = 'owner'
                       AND m.membership_lifecycle_status = 'active')
       OR EXISTS (SELECT 1 FROM public.agents a WHERE a.club_id = c.club_id) THEN
      RAISE EXCEPTION 'CERT_HU_MEMBERSHIP_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;

    IF EXISTS (SELECT 1 FROM public.club_wallets w WHERE w.club_id = c.club_id AND COALESCE(w.chip_balance, 0) <> 0)
       OR EXISTS (SELECT 1 FROM public.club_diamond_wallets w WHERE w.club_id = c.club_id AND COALESCE(w.balance, 0) <> 0)
       OR EXISTS (SELECT 1 FROM public.promo_vault_inventory i WHERE i.club_id = c.club_id AND COALESCE(i.quantity, 0) <> 0)
       OR EXISTS (SELECT 1 FROM public.tournament_tickets k WHERE k.club_id = c.club_id AND k.status = 'issued')
       OR EXISTS (SELECT 1 FROM public.cashout_requests r WHERE r.club_id = c.club_id AND r.status IN ('pending', 'approved'))
       OR EXISTS (SELECT 1 FROM public.chip_requests r WHERE r.club_id = c.club_id AND r.status = 'pending')
       OR EXISTS (SELECT 1 FROM public.chip_escrow_holds h WHERE h.club_id = c.club_id AND h.status = 'held')
       OR EXISTS (SELECT 1 FROM public.chip_escrow e JOIN public.cashout_requests r ON r.id = e.cashout_request_id
                   WHERE r.club_id = c.club_id AND e.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.settlement_periods sp WHERE sp.club_id = c.club_id
                   AND lower(COALESCE(sp.status::text, '')) IN ('open', 'processing', 'disputed'))
       OR EXISTS (SELECT 1 FROM public.club_opening_setups s WHERE s.club_id = c.club_id
                   AND COALESCE(s.leaderboard_seed_remaining, 0) <> 0) THEN
      RAISE EXCEPTION 'CERT_HU_CUSTODY_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;

    IF EXISTS (SELECT 1 FROM public.table_seats s JOIN public.tables t ON t.id = s.table_id
                WHERE t.club_id = c.club_id AND s.left_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.table_sessions s JOIN public.tables t ON t.id = s.table_id
                   WHERE t.club_id = c.club_id AND COALESCE(s.is_active, false) AND s.left_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.table_waitlist w JOIN public.tables t ON t.id = w.table_id
                   WHERE t.club_id = c.club_id AND w.status IN ('waiting', 'notified'))
       OR EXISTS (SELECT 1 FROM public.cash_game_waitlist w JOIN public.cash_games g ON g.id = w.game_id
                   WHERE g.club_id = c.club_id AND w.status IN ('waiting', 'notified')) THEN
      RAISE EXCEPTION 'CERT_HU_SEATED_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;

    PERFORM 1 FROM public.tournaments t WHERE t.club_id = c.club_id ORDER BY t.id FOR UPDATE;
    SELECT count(*) INTO v_open FROM public.tournaments t
     WHERE t.club_id = c.club_id AND upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED');
    IF v_open > 20 OR EXISTS (
         SELECT 1 FROM public.tournaments t
          WHERE t.club_id = c.club_id
            AND upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
            AND (t.started_at IS NOT NULL OR COALESCE(t.current_players, 0) <> 0
              OR COALESCE(t.spin_multiplier, 0) <> 0 OR COALESCE(t.prize_pool, 0) <> 0
              OR upper(COALESCE(t.status::text, '')) <> 'REGISTERING'
              OR public.fn_poker_diamond_tournament(t.id)
              OR EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = t.id)
              OR EXISTS (SELECT 1 FROM public.tournament_escrow e WHERE e.tournament_id = t.id
                          AND (e.prize_balance <> 0 OR e.bounty_balance <> 0 OR e.fee_balance <> 0))))
       OR EXISTS (SELECT 1 FROM public.tournament_obligations o JOIN public.tournaments t ON t.id = o.tournament_id
                   WHERE t.club_id = c.club_id AND o.amount_owed > o.amount_paid)
       OR EXISTS (SELECT 1 FROM public.managed_game_schedules ms WHERE ms.status = 'executing' AND (
                   (ms.game_kind = 'tournament' AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = ms.game_id AND t.club_id = c.club_id))
                   OR (ms.game_kind = 'table' AND EXISTS (SELECT 1 FROM public.tables t WHERE t.id = ms.game_id AND t.club_id = c.club_id)))) THEN
      RAISE EXCEPTION 'CERT_HU_LIVE_GAME_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_bbj FROM public.bbj_pools WHERE club_id = c.club_id AND union_id IS NULL FOR UPDATE;
    SELECT * INTO v_spin FROM public.spin_bonus_pools WHERE club_id = c.club_id FOR UPDATE;
    IF (SELECT count(*) FROM public.bbj_pools WHERE club_id = c.club_id) <> 1
       OR v_bbj.id IS NULL OR v_bbj.main_balance IS DISTINCT FROM 100
       OR COALESCE(v_bbj.backup_balance, 0) <> 0 OR COALESCE(v_bbj.promo_balance, 0) <> 0
       OR COALESCE(v_bbj.total_contributed, 0) <> 0 OR COALESCE(v_bbj.total_paid_out, 0) <> 0
       OR COALESCE(v_bbj.hit_count, 0) <> 0
       OR EXISTS (SELECT 1 FROM public.bbj_contributions b WHERE b.pool_id = v_bbj.id)
       OR EXISTS (SELECT 1 FROM public.bbj_payouts b WHERE b.pool_id = v_bbj.id)
       OR EXISTS (SELECT 1 FROM public.wallet_credit_idempotency i WHERE i.key LIKE 'bbjpromo:' || v_bbj.id::text || ':%')
       OR (SELECT count(*) FROM public.spin_bonus_pools WHERE club_id = c.club_id) <> 1
       OR v_spin.id IS NULL OR v_spin.balance IS DISTINCT FROM 200 OR v_spin.seeded_amount IS DISTINCT FROM 200
       OR v_spin.seed_source_wallet IS DISTINCT FROM 'chip_treasury' OR COALESCE(v_spin.seed_returned_amount, 0) <> 0
       OR public.fn_spin_reserve_pool(c.club_id) IS DISTINCT FROM c.club_id
       OR (SELECT f.amount FROM public.club_welcome_package_funding f WHERE f.club_id = c.club_id AND f.destination = 'bbj_main') IS DISTINCT FROM 100
       OR (SELECT f.amount FROM public.club_welcome_package_funding f WHERE f.club_id = c.club_id AND f.destination = 'spin_reserve') IS DISTINCT FROM 200
       OR EXISTS (SELECT 1 FROM public.wheel_pools p WHERE p.host_id = c.club_id
                   AND (p.spins <> 0 OR p.intake_diamonds <> 0 OR p.chips_minted <> 0 OR p.chips_paid <> 0 OR p.diamonds_paid <> 0))
       OR EXISTS (SELECT 1 FROM public.diamond_game_pools p WHERE p.host_id = c.club_id
                   AND (p.rounds <> 0 OR p.intake_diamonds <> 0 OR p.chips_minted <> 0 OR p.chips_paid <> 0 OR p.reserved_chips <> 0)) THEN
      RAISE EXCEPTION 'CERT_HU_POOLS_NOT_PRISTINE: %', c.club_id USING ERRCODE = '55000';
    END IF;

    -- 2. As the owner: stop every recurrence source, cancel or close every game.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', c.owner_id, 'role', 'service_role')::text, true);
    PERFORM set_config('request.jwt.claim.sub', c.owner_id::text, true);

    UPDATE public.spin_bonus_pools SET is_active = false, deactivated_at = now(), updated_at = now()
     WHERE club_id = c.club_id;
    UPDATE public.tournament_schedules SET active = false, updated_at = now()
     WHERE club_id = c.club_id AND active;
    UPDATE public.wheel_configs SET enabled = false, updated_at = now(), updated_by = c.owner_id
     WHERE host_id = c.club_id AND enabled;
    UPDATE public.diamond_game_configs SET enabled = false, updated_at = now(), updated_by = c.owner_id
     WHERE host_id = c.club_id AND enabled;
    UPDATE public.clubs SET spins_enabled = false, bbj_enabled = false, bbj_rake_enabled = false, updated_at = now()
     WHERE id = c.club_id;

    PERFORM set_config('app.managed_game_lifecycle', 'on', true);
    UPDATE public.cash_games SET enabled = false, state = 'dormant', closed_at = COALESCE(closed_at, now()),
           closed_by = c.owner_id, updated_at = now()
     WHERE club_id = c.club_id AND (enabled OR state <> 'dormant');

    v_cancelled := 0;
    FOR v_t IN SELECT t.id FROM public.tournaments t
                WHERE t.club_id = c.club_id
                  AND upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
                ORDER BY t.id LOOP
      v_cancel := public.atomic_cancel_tournament(v_t, c.owner_id);
      IF v_cancel->>'ok' IS DISTINCT FROM 'true'
         OR v_cancel->>'fully_settled' IS DISTINCT FROM 'true'
         OR v_cancel->>'status' IS DISTINCT FROM 'CANCELLED'
         OR v_cancel->>'tournament_id' IS DISTINCT FROM v_t::text
         OR COALESCE((v_cancel->>'source_player_count')::integer, -1) <> 0 THEN
        RAISE EXCEPTION 'CERT_HU_CANCELLATION_RECEIPT_REFUSED: % %', v_t, left(v_cancel::text, 300)
          USING ERRCODE = '55000';
      END IF;
      v_cancelled := v_cancelled + 1;
    END LOOP;
    IF v_cancelled <> v_open THEN
      RAISE EXCEPTION 'CERT_HU_CANCELLATION_COUNT: % cancelled of %', v_cancelled, v_open USING ERRCODE = '55000';
    END IF;

    UPDATE public.tables SET status = 'closed', current_players = 0, updated_at = now()
     WHERE club_id = c.club_id AND lower(COALESCE(status::text, '')) NOT IN ('closed', 'deleted');
    UPDATE public.managed_game_schedules SET status = 'cancelled', completed_at = now(),
           result = jsonb_build_object('ok', false, 'reason', 'cert_hu_retirement')
     WHERE status IN ('scheduled', 'executing') AND (
       (game_kind = 'tournament' AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = game_id AND t.club_id = c.club_id))
       OR (game_kind = 'table' AND EXISTS (SELECT 1 FROM public.tables t WHERE t.id = game_id AND t.club_id = c.club_id)));

    -- 3. The welcome principal returns to the club bank through the platform's movers.
    v_spin_result := public.fn_spin_deactivate(c.club_id, c.owner_id);
    IF COALESCE((v_spin_result->>'seed_returned')::numeric, 0) IS DISTINCT FROM 200
       OR COALESCE((v_spin_result->>'live_games')::integer, -1) <> 0 THEN
      RAISE EXCEPTION 'CERT_HU_SPIN_SEED_RETURN_REFUSED: % %', c.club_id, v_spin_result USING ERRCODE = '55000';
    END IF;

    v_saved := public.fn_ca_ledger_declaration_save(ARRAY['bbj_pools']);
    PERFORM public.fn_ca_declare_ledger('treasury_transfer', 'bbj_pool', v_bbj.id, NULL, NULL, ARRAY['bbj_pools']);
    PERFORM set_config('app.ledger_counterparty_label', 'bbj_pools.main_balance', true);
    v_after := public.fn_spin_move_owner_wallet(c.club_id, 'club', 'chip_treasury', 100);
    IF v_after IS NULL THEN
      RAISE EXCEPTION 'CERT_HU_BBJ_RETURN_REFUSED: %', c.club_id USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.chip_transactions (id, club_id, amount, transaction_type, notes, balance_after, metadata)
    VALUES (gen_random_uuid(), c.club_id, 100, 'bbj_promo_sweep',
      'Unused welcome-package BBJ principal returned to club treasury before certification club retirement',
      v_after, jsonb_build_object('reason', 'cert_hu_retirement', 'operation_id', v_op, 'pool_id', v_bbj.id));
    UPDATE public.bbj_pools SET main_balance = 0, backup_balance = 0, promo_balance = 0, status = 'retired', updated_at = now()
     WHERE id = v_bbj.id;
    PERFORM public.fn_ca_ledger_declaration_restore(v_saved);

    UPDATE public.club_welcome_package_items SET retired_at = now(), reset_operation_id = v_op
     WHERE club_id = c.club_id AND retired_at IS NULL;
    INSERT INTO public.club_welcome_reset_receipts (club_id, operation_id, actor_id, result)
    VALUES (c.club_id, v_op, c.owner_id, jsonb_build_object(
      'ok', true, 'replayed', false, 'club_id', c.club_id, 'operation_id', v_op,
      'reason', 'cert_hu_retirement', 'migration', '20261114194730',
      'returned_to_treasury', jsonb_build_object('bbj', 100, 'spin', 200),
      'tournaments_cancelled', v_cancelled, 'completed_at', transaction_timestamp()));

    -- 4. The whole estate, now all in the club bank, retires to chip_retirement.
    SELECT chip_treasury INTO v_total FROM public.clubs WHERE id = c.club_id;
    IF v_total IS DISTINCT FROM c.treasury + 300
       OR EXISTS (SELECT 1 FROM public.bbj_pools b WHERE b.club_id = c.club_id
                   AND abs(COALESCE(b.main_balance, 0)) + abs(COALESCE(b.backup_balance, 0)) + abs(COALESCE(b.promo_balance, 0)) <> 0)
       OR EXISTS (SELECT 1 FROM public.spin_bonus_pools s WHERE s.club_id = c.club_id AND COALESCE(s.balance, 0) <> 0) THEN
      RAISE EXCEPTION 'CERT_HU_ESTATE_NOT_IN_BANK: % treasury % expected %', c.club_id, v_total, c.treasury + 300
        USING ERRCODE = '55000';
    END IF;
    v_key := 'cert-hu-retire:' || c.club_id::text;
    PERFORM public.fn_ca_declare_ledger('burn', 'chip_retirement', NULL, NULL, v_key, NULL);
    UPDATE public.clubs SET chip_treasury = 0, updated_at = clock_timestamp()
     WHERE id = c.club_id AND chip_treasury = v_total;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CERT_HU_BANK_CHANGED_DURING_RETIREMENT: %', c.club_id USING ERRCODE = '55000';
    END IF;
    PERFORM set_config('app.ledger_category', '', true);
    PERFORM set_config('app.ledger_counterparty', '', true);
    PERFORM set_config('app.ledger_idempotency_key', '', true);
    SELECT count(*) INTO v_n FROM public.chip_ledger l
     WHERE l.idempotency_key = v_key AND l.category = 'burn' AND l.status = 'posted'
       AND l.from_type = 'club_treasury' AND l.from_entity_id = c.club_id
       AND l.to_type = 'chip_retirement' AND l.amount = v_total;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'CERT_HU_BURN_UNPROVEN: % (% rows)', c.club_id, v_n USING ERRCODE = '55000';
    END IF;
    v_retired_total := v_retired_total + v_total;

    -- 5. Nothing is left to settle.
    v_impact := public.fn_club_retirement_impact(c.club_id);
    IF COALESCE((v_impact->>'wallet_chips')::numeric, -1) <> 0
       OR COALESCE((v_impact->>'diamonds')::numeric, -1) <> 0
       OR COALESCE((v_impact->>'inventory_items')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'open_obligations')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'running_tables')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'active_tournaments')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'active_cash_games')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'active_tournament_schedules')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'pending_managed_commands')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'active_diamond_games')::bigint, -1) <> 0
       OR COALESCE((v_impact->>'union_affiliated')::boolean, true) THEN
      RAISE EXCEPTION 'CERT_HU_IMPACT_NOT_ZERO: % %', c.club_id, v_impact USING ERRCODE = '55000';
    END IF;

    -- 6. The owner's account is deleted with no actor claim; its membership departs.
    PERFORM set_config('request.jwt.claims', COALESCE(v_prior_claims, ''), true);
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prior_sub, ''), true);
    UPDATE public.profiles SET status = 'deleted', updated_at = now()
     WHERE id = c.owner_id AND status IS DISTINCT FROM 'deleted';
    IF NOT FOUND
       OR EXISTS (SELECT 1 FROM public.club_members m JOIN public.clubs k ON k.id = m.club_id
                   WHERE m.user_id = c.owner_id AND m.membership_lifecycle_status = 'active'
                     AND k.lifecycle_status = 'active')
       OR EXISTS (SELECT 1 FROM public.club_members m WHERE m.user_id = c.owner_id
                   AND abs(COALESCE(m.chip_balance, 0)) + abs(COALESCE(m.held_chips, 0)) + abs(COALESCE(m.locked_chips, 0)) <> 0) THEN
      RAISE EXCEPTION 'CERT_HU_OWNER_NOT_RETIRED: %', c.owner_id USING ERRCODE = '55000';
    END IF;

    -- 7. The club retires with its records, through the retained-record core.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', c.owner_id, 'role', 'service_role')::text, true);
    PERFORM set_config('request.jwt.claim.sub', c.owner_id::text, true);
    v_result := public.fn_retire_settled_club_core_20260906(c.club_id, c.club_name,
      'Heads-up rematch certification club: its run died before cleanup; one-time settlement 20261114194730 (owner, 2026-11-14)');
    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE
       OR COALESCE((v_result->>'already_retired')::boolean, true) THEN
      RAISE EXCEPTION 'CERT_HU_RETIREMENT_REFUSED: % %', c.club_id, left(COALESCE(v_result::text, 'null'), 300)
        USING ERRCODE = '55000';
    END IF;
    FOR v_recipient IN
      SELECT c.owner_id UNION SELECT cm.user_id FROM public.club_members cm WHERE cm.club_id = c.club_id
    LOOP
      PERFORM public.fn_emit_game_management_event(
        'club_identity_changed', c.club_id, NULL, v_recipient, 'club', c.club_id, NULL,
        jsonb_build_object('operation', 'retire', 'lifecycle_status', 'retired', 'records_retained', true));
    END LOOP;

    PERFORM set_config('request.jwt.claims', COALESCE(v_prior_claims, ''), true);
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prior_sub, ''), true);
    PERFORM set_config('app.managed_game_lifecycle', '', true);
  END LOOP;

  -- The four, together, exactly as measured.
  IF v_retired_total IS DISTINCT FROM 399999.70::numeric THEN
    RAISE EXCEPTION 'CERT_HU_TOTAL_RETIRED: % expected 399999.70', v_retired_total USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.clubs
       WHERE id IN ('5db856cf-7a83-4a7e-9ed1-2ee4a83f141c','e5d50964-7f44-47fe-948c-81bb8d633f25',
                    'f5eebc0e-00f3-467c-b753-79cfebcaeda0','17b36e27-0671-404e-8d92-308e4ee69b8a')
         AND lifecycle_status = 'retired' AND chip_treasury = 0 AND COALESCE(chip_pool, 0) = 0
         AND COALESCE(promo_balance, 0) = 0 AND COALESCE(insurance_balance, 0) = 0) <> 4
     OR (SELECT count(*) FROM public.profiles
          WHERE id IN ('b6424182-88d2-46a7-a3d4-e7ea68ead245','54d534d6-5984-471b-86b2-5b9ff37cafc3',
                       '57bca7de-9099-47c2-8364-eba25cbf1ff7','c18acfca-d33b-4ef8-a280-ba90a4d94e40')
            AND status = 'deleted') <> 4 THEN
    RAISE EXCEPTION 'CERT_HU_FINAL_STATE' USING ERRCODE = '55000';
  END IF;
END
$cert_hu_retire$;

COMMIT;
