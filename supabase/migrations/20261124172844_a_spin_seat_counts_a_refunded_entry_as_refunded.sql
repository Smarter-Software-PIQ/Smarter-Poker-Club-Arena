-- 20261124172844_a_spin_seat_counts_a_refunded_entry_as_refunded
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-24 17:28:44 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- @live-proof: (SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%OR v_net_irregular <> 0%' AND pg_get_functiondef(p.oid) LIKE '%w.category IN (''refund'',''tournament_refund'')%' AND pg_get_functiondef(p.oid) NOT LIKE '%HAVING round(sum(w.amount),2) = round(v_t.buy_in_amount,2)%') AND count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('fn_spin_book_entry','fn_spin_draw_and_settle'))
--
-- A SPIN SEAT COUNTS A REFUNDED ENTRY AS REFUNDED (2026-11-24, incident
-- 7e8dce13-9eb8-436e-ae0e-c0af116b5dba, alert SpinHumanWaitingForOpponents).
--
-- WHAT HAPPENED
--
-- Spin 3b4c6299 (5 Chip Deep Stack Spin NLH). A player bought in at 15:29 UTC,
-- unregistered at 15:32 (refunded 5) and bought in again at 16:46. One horse
-- sat at 16:50. From then on every horse the engine offered for the third
-- seat was refused inside the seat transaction by fn_spin_book_entry:
--
--   three_paid_seats_required: paid_users 2, buyin_debits 4,
--   buyin_total 20.00, roster_users 3, seat_users 3, exact_seat_stacks 3
--
-- three refusals every 12 seconds, "SEAT-FIRST BOARD CANNOT FILL ... a human
-- is waiting" once a minute, and SpinHumanWaitingForOpponents at 506 s. The
-- player left at 16:59 after 13 minutes.
--
-- ROOT CAUSE
--
-- fn_spin_book_entry (and the legacy fn_spin_draw_and_settle, which carries
-- the same proof) decided "three paid seats" from GROSS tournament_buyin
-- debits: per player sum(debits) = buy_in, and board-wide count(debits) = 3
-- and sum(debits) = 3 * buy_in. A refund credit was never subtracted. So:
--
--   * a player who re-registers holds 5 + 5 of debits and reads as unpaid;
--   * any player who left a board before it filled leaves a fourth debit.
--
-- Either way the board can NEVER again satisfy the gate - not for a person
-- and not for the horse ladder - and the seat insert that would fill it is
-- rolled back every time. Unregistering from a seat-first Spin (which writes
-- the refund this function ignored) is newer than the 2026-09-09 gate.
-- fn_spin_draw_and_settle_atomic already proves each player's entry as
-- debits less refund credits; the booking gate was never brought to the
-- same rule.
--
-- THE FIX
--
-- Both functions now prove payment NET of refunds, the exact rule the atomic
-- launch uses (tournament_buyin debits less 'refund'/'tournament_refund'
-- credits on this tournament):
--
--   * three roster players each net exactly one buy-in;
--   * board-wide, exactly three identities net non-zero and they total
--     3 * buy_in;
--   * NEW: any identity netting anything other than 0 or one buy-in (a
--     double charge, a refund larger than the charge) refuses the seat -
--     the protection the gross count gave by accident is kept on purpose.
--
-- The refusal now reports net_paid_entries, net_buyin_total and
-- net_irregular. Nothing reads the old field names (engine logs the jsonb).
-- Reserve contribution, rake, journal and every other line of both bodies
-- are the production definitions read on 2026-11-24 (md5
-- 3e861cfde0bda50d16bc836a665bf4ab and 8f6dc9dd3e7f95a7f9e7fe58e126c825)
-- unchanged. CREATE OR REPLACE keeps the existing grants
-- (postgres, service_role).
--
-- Regression: scripts/ci/test-spin-books-net-of-refunds.py (real PG17, the
-- pinned live definition refuses the re-registered and left-the-board
-- shapes before this file and books them exactly once after it; double
-- charge and orphan refund stay refused) and
-- tests/a-spin-seat-counts-a-refunded-entry-as-refunded.law.test.ts.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_spin_book_entry(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t record;
  v_owner uuid;
  v_pool_id uuid;
  v_table_id uuid;
  v_live_seats integer;
  v_seat_users integer;
  v_exact_seat_stacks integer;
  v_roster_users integer;
  v_paid_users integer;
  v_buyin_debits integer;
  v_buyin_total numeric;
  v_net_irregular integer;
  v_collected numeric;
  v_rake_rate numeric;
  v_rake numeric;
  v_reserve_in numeric;
  v_balance numeric;
  v_reserve public.spin_reserve_ledger%ROWTYPE;
  v_reserve_count integer;
  v_journal_id uuid;
  v_journal_count integer;
  v_entry_existed boolean := false;
  v_contrib jsonb;
  v_key text := 'spin:' || p_tournament_id::text || ':entry';
BEGIN
  SELECT t.id, t.club_id, t.buy_in_amount, t.max_players, t.variant,
         t.starting_chips,
         t.tournament_type, t.status
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND
     OR (lower(COALESCE(v_t.variant,'')) <> 'spin'
         AND upper(COALESCE(v_t.tournament_type,'')) <> 'SPIN') THEN
    RETURN jsonb_build_object('ok',false,'reason','not_a_spin');
  END IF;
  IF v_t.club_id IS NULL OR COALESCE(v_t.buy_in_amount,0) <= 0
     OR COALESCE(v_t.max_players,0) <> 3
     OR v_t.starting_chips IS NULL
     OR v_t.starting_chips::text IN ('NaN','Infinity','-Infinity')
     OR v_t.starting_chips <= 0
     OR upper(COALESCE(v_t.status::text,'')) IN ('COMPLETED','CANCELLED','CANCELED') THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_spin_contract');
  END IF;

  v_table_id := public.fn_tournament_primary_table(p_tournament_id);
  SELECT count(*), count(DISTINCT s.user_id),
         count(*) FILTER (
           WHERE s.stack IS NOT DISTINCT FROM v_t.starting_chips
             AND s.stack::text NOT IN ('NaN','Infinity','-Infinity')
             AND s.stack > 0)
    INTO v_live_seats, v_seat_users, v_exact_seat_stacks
    FROM public.table_seats s
   WHERE s.table_id = v_table_id AND s.left_at IS NULL;
  SELECT count(DISTINCT tp.user_id)
    INTO v_roster_users
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;
  -- PAID MEANS PAID NET OF REFUNDS (20261124172844). A player who buys in,
  -- unregisters (refunded) and buys in again holds two buy-in debits and one
  -- refund credit. Gross debits read that as 10 paid on a 5 Spin, so the
  -- player was not "paid", the board had four debits, and every third seat
  -- was refused (three_paid_seats_required) for the life of the board.
  -- This is the same per-player rule fn_spin_draw_and_settle_atomic proves:
  -- buy-in debits less refund credits on this tournament.
  SELECT count(*) INTO v_paid_users
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
    ) n;
  SELECT EXISTS (
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id = p_tournament_id AND r.kind = 'contribution'
  ) INTO v_entry_existed;

  -- The live-seat distribution is an admission proof, not an immutable
  -- receipt proof. The third-seat transaction must begin with three exact
  -- starting stacks. Once its contribution exists, hands may redistribute or
  -- vacate those stacks; replay proves the three paid identities and the
  -- immutable contribution+journal below without demanding pre-hand state.
  IF (NOT v_entry_existed AND (
       v_table_id IS NULL OR v_live_seats <> 3 OR v_seat_users <> 3
       OR v_exact_seat_stacks <> 3
       OR EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND NOT EXISTS (
              SELECT 1 FROM public.table_seats s
               WHERE s.table_id = v_table_id AND s.left_at IS NULL
                 AND s.user_id = tp.user_id))))
     OR v_roster_users <> 3 OR v_paid_users <> 3
     OR v_buyin_debits <> 3
     OR v_net_irregular <> 0
     OR v_buyin_total <> round(v_t.buy_in_amount * 3,2) THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','three_paid_seats_required',
      'seats',v_live_seats,'seat_users',v_seat_users,
      'exact_seat_stacks',v_exact_seat_stacks,
      'roster_users',v_roster_users,'paid_users',v_paid_users,
      'net_paid_entries',v_buyin_debits,'net_buyin_total',v_buyin_total,'net_irregular',v_net_irregular);
  END IF;

  -- One lock order for both the seat trigger and the start authority.
  PERFORM 1 FROM public.tournament_escrow
   WHERE tournament_id = p_tournament_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('spin_entry:' || p_tournament_id::text,0));

  v_owner := public.fn_spin_reserve_pool(v_t.club_id);
  SELECT p.id, p.balance INTO v_pool_id, v_balance
    FROM public.spin_bonus_pools p
   WHERE p.club_id = v_owner
   FOR UPDATE;
  IF v_pool_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','no_pool_row','owner_id',v_owner);
  END IF;

  v_collected := round(v_t.buy_in_amount * 3,2);
  v_rake_rate := public.fn_spin_rake_rate(v_t.buy_in_amount);
  v_rake := round(v_collected * v_rake_rate,2);
  v_reserve_in := round(v_collected - v_rake,2);

  SELECT count(*) INTO v_reserve_count
    FROM public.spin_reserve_ledger r
   WHERE r.tournament_id = p_tournament_id AND r.kind = 'contribution';
  IF v_reserve_count > 0 THEN
    IF v_reserve_count <> 1 THEN
      RAISE EXCEPTION 'Spin % has % contribution rows',
        p_tournament_id,v_reserve_count USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_reserve
      FROM public.spin_reserve_ledger r
     WHERE r.tournament_id = p_tournament_id AND r.kind = 'contribution'
     FOR SHARE;
    IF v_reserve.club_id IS DISTINCT FROM v_owner
       OR v_reserve.amount IS DISTINCT FROM v_reserve_in
       OR v_reserve.buy_in IS DISTINCT FROM v_t.buy_in_amount
       OR v_reserve.seats IS DISTINCT FROM 3
       OR v_reserve.house_rake IS DISTINCT FROM v_rake THEN
      RAISE EXCEPTION 'Spin % existing contribution disagrees with its paid entry',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
    SELECT count(*) INTO v_journal_count
      FROM public.chip_ledger l
     WHERE l.category = 'spin_entry'
       AND l.from_type = 'prize_liability'
       AND l.from_entity_id = p_tournament_id
       AND l.to_type = 'spin_reserve'
       AND l.to_entity_id = v_pool_id
       AND l.tournament_id = p_tournament_id
       AND l.amount = v_reserve_in;
    IF v_journal_count <> 1 THEN
      RAISE EXCEPTION 'Spin % existing contribution has % exact journals',
        p_tournament_id,v_journal_count USING ERRCODE = 'P0404';
    END IF;
    SELECT l.id INTO v_journal_id
      FROM public.chip_ledger l
     WHERE l.category = 'spin_entry'
       AND l.from_type = 'prize_liability'
       AND l.from_entity_id = p_tournament_id
       AND l.to_type = 'spin_reserve'
       AND l.to_entity_id = v_pool_id
       AND l.tournament_id = p_tournament_id
       AND l.amount = v_reserve_in;
    RETURN jsonb_build_object(
      'ok',true,'reason','already_booked','collected',v_collected,
      'house_rake',v_rake,'reserve_in',v_reserve_in,'balance',v_balance,
      'owner_id',v_owner,'pool_id',v_pool_id,'seats',3,'paid_users',3,
      'entry_reserve_id',v_reserve.id,'entry_journal_id',v_journal_id);
  END IF;

  PERFORM public.fn_ca_declare_ledger(
    'spin_entry','prize_liability',p_tournament_id,NULL,v_key,NULL);
  UPDATE public.spin_bonus_pools
     SET balance = balance + v_reserve_in,
         total_deposited = total_deposited + v_reserve_in,
         spin_count = spin_count + 1,
         highest_stake = GREATEST(highest_stake,v_t.buy_in_amount),
         updated_at = now()
   WHERE id = v_pool_id
   RETURNING balance INTO v_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spin reserve pool % vanished while booking %',
      v_pool_id,p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  INSERT INTO public.spin_reserve_ledger
    (club_id,tournament_id,kind,amount,balance_after,multiplier,
     buy_in,seats,house_rake,note)
  VALUES
    (v_owner,p_tournament_id,'contribution',v_reserve_in,v_balance,NULL,
     v_t.buy_in_amount,3,v_rake,
     CASE WHEN v_owner = v_t.club_id
          THEN 'three exact paid buy-ins less fixed rake'
          ELSE format('three exact paid buy-ins less fixed rake (club %s)',v_t.club_id)
      END)
  RETURNING * INTO v_reserve;

  SELECT count(*), (array_agg(l.id ORDER BY l.created_at,l.id))[1]
    INTO v_journal_count,v_journal_id
    FROM public.chip_ledger l
   WHERE l.idempotency_key = v_key
     AND l.category = 'spin_entry'
     AND l.from_type = 'prize_liability'
     AND l.from_entity_id = p_tournament_id
     AND l.to_type = 'spin_reserve'
     AND l.to_entity_id = v_pool_id
     AND l.tournament_id = p_tournament_id
     AND l.amount = v_reserve_in;
  IF v_journal_count <> 1 THEN
    RAISE EXCEPTION 'Spin % new contribution has % exact keyed journals',
      p_tournament_id,v_journal_count USING ERRCODE = 'P0404';
  END IF;

  SELECT jsonb_object_agg(tp.user_id::text,v_t.buy_in_amount)
    INTO v_contrib
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;
  IF v_rake > 0 THEN
    INSERT INTO public.rake_records
      (hand_id,table_id,club_id,rake_amount,pot_size,num_players,
       bbj_contribution,is_tournament,tournament_id,source,
       player_contributions,metadata)
    VALUES
      (NULL,NULL,v_t.club_id,v_rake,v_collected,3,0,true,p_tournament_id,
       'fn_spin_book_entry',v_contrib,
       jsonb_build_object(
         'kind','spin_rake','buy_in',v_t.buy_in_amount,
         'rake_rate',v_rake_rate,'booked_at','third_paid_seat',
         'reserve_owner',v_owner,'treasury_credited',false,
         'distributed_by','atomic_distribute_rake',
         'rake_per_player',round(v_rake / 3,4),'seats_attributed',3));
  END IF;

  PERFORM set_config('app.ledger_category','',true);
  PERFORM set_config('app.ledger_counterparty','',true);
  PERFORM set_config('app.ledger_counterparty_entity','',true);
  PERFORM set_config('app.ledger_idempotency_key','',true);

  RETURN jsonb_build_object(
    'ok',true,'reason','booked','collected',v_collected,
    'house_rake',v_rake,'reserve_in',v_reserve_in,'balance',v_balance,
    'owner_id',v_owner,'pool_id',v_pool_id,'seats',3,'paid_users',3,
    'entry_reserve_id',v_reserve.id,'entry_journal_id',v_journal_id);
END;
$function$;

-- @probe-for: public.fn_spin_book_entry
-- Runs the new body once against the oldest partly filled Spin (it reaches
-- the net-of-refunds proof and refuses with three_paid_seats_required), or a
-- missing id on an empty database. Always undone.
DO $probe$
DECLARE
  v_id uuid;
  v_res jsonb;
BEGIN
  SELECT t.id INTO v_id FROM public.tournaments t
   WHERE t.variant = 'spin' AND t.status = 'REGISTERING' AND t.started_at IS NULL
     AND COALESCE(t.max_players, 0) = 3
   ORDER BY t.created_at LIMIT 1;
  v_res := public.fn_spin_book_entry(COALESCE(v_id, '00000000-0000-0000-0000-000000000000'::uuid));
  IF v_res IS NULL OR v_res->>'reason' IS NULL THEN
    RAISE EXCEPTION 'spin_book_entry_probe_failed: %', v_res;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

CREATE OR REPLACE FUNCTION public.fn_spin_draw_and_settle(p_tournament_id uuid, p_tiers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_t record;
  v_table_id uuid;
  v_paid_seats integer;
  v_seat_users integer;
  v_exact_seat_stacks integer;
  v_paid_users integer;
  v_roster_users integer;
  v_exact_roster_stacks integer;
  v_buyin_debits integer;
  v_buyin_total numeric;
  v_net_irregular integer;
  v_book jsonb;
  v_settle jsonb;
  v_owner uuid;
  v_pool_id uuid;
  v_available numeric;
  v_highest_stake numeric;
  v_rake_rate numeric;
  v_reserve_in numeric;
  v_tier jsonb;
  v_multiplier numeric;
  v_frequency numeric;
  v_threshold numeric;
  v_prize numeric;
  v_total numeric := 0;
  v_roll numeric;
  v_acc numeric := 0;
  v_pick numeric := NULL;
  v_eligible jsonb := '[]'::jsonb;
  v_locked jsonb := '[]'::jsonb;
  v_seen numeric[] := ARRAY[]::numeric[];
  v_booked_multiplier numeric;
  v_booked_draw numeric;
  v_leg_count integer;
  v_draw_existed boolean := false;
  v_entry_reserve_id uuid;
  v_entry_journal_id uuid;
  v_draw_reserve_id uuid;
  v_draw_journal_id uuid;
  v_escrow_reserve_out numeric;
  v_escrow_reserve_in numeric;
  v_escrow_prize_balance numeric;
  v_row_count integer;
  v_draw_key text := 'spin:' || p_tournament_id::text || ':draw';
  -- Product economics live inside the money authority. The service still
  -- submits its compiled copy during the rolling cutover, but a drifted or
  -- alternate service caller cannot change RTP, the ladder, or reserve gates.
  v_canonical_tiers constant jsonb := '[
    {"multiplier":2,"freq":4809776,"reserveThresholdX":0},
    {"multiplier":3,"freq":3930716,"reserveThresholdX":0},
    {"multiplier":4,"freq":900000,"reserveThresholdX":0},
    {"multiplier":5,"freq":250000,"reserveThresholdX":0},
    {"multiplier":10,"freq":100000,"reserveThresholdX":0},
    {"multiplier":25,"freq":7500,"reserveThresholdX":0},
    {"multiplier":50,"freq":1000,"reserveThresholdX":0},
    {"multiplier":100,"freq":1008,"reserveThresholdX":1.5}
  ]'::jsonb;
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Spin draw-and-settle requires a tournament'
      USING ERRCODE = '22023';
  END IF;
  -- DIAMOND PHASE 9: a Diamond Spin is drawn by its own arm of
  -- fn_spin_draw_and_settle_atomic, the one Spin draw authority; never here.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    RAISE EXCEPTION 'diamond_spin_is_drawn_by_its_own_authority' USING ERRCODE = '55000';
  END IF;

  SELECT t.id, t.club_id, t.buy_in_amount, t.max_players, t.variant,
         t.tournament_type, t.status, t.spin_multiplier, t.prize_pool,
         t.spin_locked_tiers, t.starting_chips
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spin tournament % does not exist', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;
  IF lower(COALESCE(v_t.variant,'')) <> 'spin'
     AND upper(COALESCE(v_t.tournament_type,'')) <> 'SPIN' THEN
    RAISE EXCEPTION 'tournament % is not a Spin', p_tournament_id
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_t.club_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = '00000000-0000-0000-0000-000000000000'::uuid
     OR COALESCE(v_t.buy_in_amount,0) <= 0
     OR COALESCE(v_t.max_players,0) <> 3
     OR v_t.starting_chips IS NULL
     OR v_t.starting_chips::text IN ('NaN','Infinity','-Infinity')
     OR v_t.starting_chips <= 0 THEN
    RAISE EXCEPTION 'Spin % has invalid club, buy-in, seat or starting-stack contract',
      p_tournament_id USING ERRCODE = '23514';
  END IF;
  IF upper(COALESCE(v_t.status::text,'')) IN
       ('COMPLETED','CANCELLED','CANCELED') THEN
    RAISE EXCEPTION 'Spin % cannot draw from status %',
      p_tournament_id, v_t.status USING ERRCODE = '55000';
  END IF;

  -- Decide admission versus replay while the tournament row is locked. No
  -- other draw authority can cross that row lock. A committed draw is an
  -- immutable money receipt: its replay must not depend on the live stack
  -- distribution or on a busted player's seat still being occupied.
  SELECT r.club_id, r.multiplier, round(-r.amount,2)
    INTO v_owner, v_booked_multiplier, v_booked_draw
    FROM public.spin_reserve_ledger r
   WHERE r.tournament_id = p_tournament_id AND r.kind = 'jackpot_draw'
   ORDER BY r.created_at, r.id
   LIMIT 1;
  v_draw_existed := v_booked_multiplier IS NOT NULL;

  -- A committed draw replays from immutable evidence and is deliberately
  -- independent of whatever tier payload a newer, older, or recovering
  -- service happens to carry. Only a brand-new money decision authenticates
  -- the caller's compiled copy against the database-owned product contract.
  IF NOT v_draw_existed AND (
       p_tiers IS NULL
       OR jsonb_typeof(p_tiers) <> 'array'
       OR p_tiers IS DISTINCT FROM v_canonical_tiers
     ) THEN
    RAISE EXCEPTION
      'Spin draw-and-settle tier contract does not match canonical economics v2026-09-05'
      USING ERRCODE = '22023';
  END IF;

  v_table_id := public.fn_tournament_primary_table(p_tournament_id);
  SELECT count(*), count(DISTINCT s.user_id),
         count(*) FILTER (
           WHERE s.stack IS NOT DISTINCT FROM v_t.starting_chips
             AND s.stack::text NOT IN ('NaN','Infinity','-Infinity')
             AND s.stack > 0)
    INTO v_paid_seats, v_seat_users, v_exact_seat_stacks
    FROM public.table_seats s
   WHERE s.table_id = v_table_id AND s.left_at IS NULL;
  SELECT count(DISTINCT tp.user_id),
         count(*) FILTER (
           WHERE tp.status = 'playing'
             AND tp.chips IS NOT DISTINCT FROM v_t.starting_chips
             AND tp.chips::text NOT IN ('NaN','Infinity','-Infinity')
             AND tp.chips > 0
             AND s.user_id IS NOT NULL
             AND tp.table_id IS NOT DISTINCT FROM s.table_id
             AND tp.seat_number IS NOT DISTINCT FROM s.seat_number)
    INTO v_roster_users, v_exact_roster_stacks
    FROM public.tournament_players tp
    LEFT JOIN public.table_seats s
      ON s.table_id = v_table_id
     AND s.user_id = tp.user_id
     AND s.left_at IS NULL
   WHERE tp.tournament_id = p_tournament_id;
  -- PAID MEANS PAID NET OF REFUNDS (20261124172844). A player who buys in,
  -- unregisters (refunded) and buys in again holds two buy-in debits and one
  -- refund credit. Gross debits read that as 10 paid on a 5 Spin, so the
  -- player was not "paid", the board had four debits, and every third seat
  -- was refused (three_paid_seats_required) for the life of the board.
  -- This is the same per-player rule fn_spin_draw_and_settle_atomic proves:
  -- buy-in debits less refund credits on this tournament.
  SELECT count(*) INTO v_paid_users
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
    ) n;
  IF v_roster_users <> 3
     OR v_paid_users <> 3
     OR v_buyin_debits <> 3
     OR v_net_irregular <> 0
     OR v_buyin_total <> round(v_t.buy_in_amount * 3,2) THEN
    RAISE EXCEPTION
      'Spin % does not have exactly three immutable paid identities (% roster users, % paid users, % net entries, % net total)',
      p_tournament_id,v_roster_users,v_paid_users,v_buyin_debits,v_buyin_total
      USING ERRCODE = '55000';
  END IF;
  IF NOT v_draw_existed
     AND (v_table_id IS NULL OR v_paid_seats <> 3 OR v_seat_users <> 3
       OR v_exact_seat_stacks <> 3
       OR v_exact_roster_stacks <> 3
       OR EXISTS (
         SELECT 1
           FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND NOT EXISTS (
              SELECT 1 FROM public.table_seats s
               WHERE s.table_id = v_table_id
                 AND s.left_at IS NULL
                 AND s.user_id = tp.user_id
            )
       )) THEN
    RAISE EXCEPTION
      'Spin % is not exactly three paid rostered starting stacks (% seats, % exact seat stacks, % seat users, % roster users, % exact roster stacks, % paid users, % net entries, % net total)',
      p_tournament_id, v_paid_seats, v_exact_seat_stacks, v_seat_users,
      v_roster_users, v_exact_roster_stacks, v_paid_users, v_buyin_debits,v_buyin_total
      USING ERRCODE = '55000';
  END IF;

  v_rake_rate := public.fn_spin_rake_rate(v_t.buy_in_amount);
  v_reserve_in := round(v_t.buy_in_amount * 3 * (1 - v_rake_rate), 2);

  IF NOT v_draw_existed THEN
    -- fn_spin_book_entry owns the escrow -> advisory -> reserve lock order.
    -- The outer transaction retains every lock it takes through the new draw.
    v_owner := public.fn_spin_reserve_pool(v_t.club_id);
    v_book := public.fn_spin_book_entry(p_tournament_id);
    IF COALESCE((v_book->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Spin % entry booking refused: %', p_tournament_id, v_book
        USING ERRCODE = 'P0404';
    END IF;
    BEGIN
      v_entry_reserve_id := (v_book->>'entry_reserve_id')::uuid;
      v_entry_journal_id := (v_book->>'entry_journal_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Spin % entry returned no immutable evidence ids: %',
        p_tournament_id,v_book USING ERRCODE = 'P0404';
    END;
  END IF;

  SELECT p.id, p.balance, GREATEST(p.highest_stake, v_t.buy_in_amount)
    INTO v_pool_id, v_available, v_highest_stake
    FROM public.spin_bonus_pools p
   WHERE p.club_id = v_owner
   FOR UPDATE;
  IF v_pool_id IS NULL THEN
    RAISE EXCEPTION 'Spin % reserve pool is missing', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_draw_existed THEN
    -- Replay is evidence-only. Do not call either lower money primitive after
    -- a draw exists: ownership may have changed since the draw, while the
    -- immutable reserve row and journal still name the exact historical pool.
    SELECT count(*), (array_agg(r.id ORDER BY r.created_at,r.id))[1]
      INTO v_row_count,v_entry_reserve_id
      FROM public.spin_reserve_ledger r
     WHERE r.tournament_id = p_tournament_id
       AND r.kind = 'contribution'
       AND r.club_id = v_owner
       AND r.amount = v_reserve_in
       AND r.buy_in = v_t.buy_in_amount
       AND r.seats = 3
       AND r.house_rake = round(v_t.buy_in_amount * 3 * v_rake_rate,2);
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'Spin % replay has % exact entry reserve rows',
        p_tournament_id,v_row_count USING ERRCODE = 'P0404';
    END IF;
    SELECT count(*), (array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_leg_count,v_entry_journal_id
      FROM public.chip_ledger l
      JOIN public.spin_reserve_ledger r ON r.id = v_entry_reserve_id
     WHERE l.category = 'spin_entry'
       AND l.from_type = 'prize_liability'
       AND l.from_entity_id = p_tournament_id
       AND l.to_type = 'spin_reserve'
       AND l.to_entity_id = v_pool_id
       AND l.tournament_id = p_tournament_id
       AND l.amount = v_reserve_in
       AND l.post_to_balance IS NOT DISTINCT FROM r.balance_after;
    IF v_leg_count <> 1 THEN
      RAISE EXCEPTION 'Spin % replay entry has % exact journal legs',
        p_tournament_id,v_leg_count USING ERRCODE = 'P0404';
    END IF;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.spin_reserve_ledger r
        WHERE r.tournament_id = p_tournament_id
          AND r.kind = 'contribution'
          AND r.club_id = v_owner
          AND r.amount = v_reserve_in
     )
     OR (SELECT count(*) FROM public.chip_ledger l
          WHERE l.category = 'spin_entry'
            AND l.from_type = 'prize_liability'
            AND l.from_entity_id = p_tournament_id
            AND l.to_type = 'spin_reserve'
            AND l.to_entity_id = v_pool_id
            AND l.amount = v_reserve_in) <> 1 THEN
    RAISE EXCEPTION 'Spin % entry did not produce exact reserve evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF v_booked_multiplier IS NULL THEN
    IF COALESCE(v_t.spin_multiplier,0) > 0 THEN
      RAISE EXCEPTION
        'Spin % row carries multiplier % without an authoritative reserve draw',
        p_tournament_id, v_t.spin_multiplier USING ERRCODE = 'P0404';
    END IF;

    FOR v_tier IN SELECT value FROM jsonb_array_elements(v_canonical_tiers) LOOP
      BEGIN
        v_multiplier := (v_tier->>'multiplier')::numeric;
        v_frequency := (v_tier->>'freq')::numeric;
        v_threshold := COALESCE((v_tier->>'reserveThresholdX')::numeric,0);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Spin % tier is not numeric: %',
          p_tournament_id, v_tier USING ERRCODE = '22023';
      END;
      IF v_multiplier IS NULL OR v_multiplier <= 0
         OR v_frequency IS NULL OR v_frequency < 0
         OR v_threshold < 0
         OR v_multiplier = ANY(v_seen) THEN
        RAISE EXCEPTION 'Spin % tier is invalid or duplicated: %',
          p_tournament_id, v_tier USING ERRCODE = '23514';
      END IF;
      v_seen := array_append(v_seen, v_multiplier);
      v_prize := round(v_t.buy_in_amount * v_multiplier, 2);

      -- v_available already includes this event's contribution. The retired
      -- draw RPC added v_reserve_in a second time whenever entry was booked.
      IF v_available < v_prize THEN
        v_locked := v_locked || jsonb_build_object(
          'multiplier',v_multiplier,'reason','unaffordable',
          'unlocksAt',round(v_prize,2));
      ELSIF v_threshold > 0
            AND v_available < v_multiplier * v_highest_stake * v_threshold THEN
        v_locked := v_locked || jsonb_build_object(
          'multiplier',v_multiplier,'reason','threshold',
          'unlocksAt',round(v_multiplier * v_highest_stake * v_threshold,2));
      ELSE
        v_eligible := v_eligible || v_tier;
        v_total := v_total + v_frequency;
      END IF;
    END LOOP;

    IF v_total <= 0 OR jsonb_array_length(v_eligible) = 0 THEN
      RAISE EXCEPTION 'Spin % has no eligible funded tier at reserve %',
        p_tournament_id, v_available USING ERRCODE = '55000';
    END IF;

    v_roll := (('x' || encode(extensions.gen_random_bytes(6),'hex'))::bit(48)::bigint)::numeric
              / 281474976710656::numeric * v_total;
    FOR v_tier IN SELECT value FROM jsonb_array_elements(v_eligible) LOOP
      v_acc := v_acc + (v_tier->>'freq')::numeric;
      IF v_roll < v_acc THEN
        v_pick := (v_tier->>'multiplier')::numeric;
        EXIT;
      END IF;
    END LOOP;
    IF v_pick IS NULL THEN
      v_pick := (v_eligible -> (jsonb_array_length(v_eligible)-1)
                            ->> 'multiplier')::numeric;
    END IF;

    PERFORM set_config('app.ledger_idempotency_key',v_draw_key,true);
    v_settle := public.fn_spin_settle_game(
      p_tournament_id, v_t.club_id, v_t.buy_in_amount, 3,
      v_pick, v_rake_rate);
    PERFORM set_config('app.ledger_idempotency_key','',true);
    v_booked_multiplier := v_pick;
    v_booked_draw := round(v_t.buy_in_amount * v_pick,2);
  ELSE
    -- The immutable reserve and journal rows are the receipt. Reconstruct only
    -- the return envelope; no lower money function runs on a replay.
    v_settle := jsonb_build_object(
      'ok',true,'reason','already_settled',
      'multiplier',v_booked_multiplier,
      'pool_covered',v_booked_draw,
      'operator_shortfall',0);
    v_locked := COALESCE(v_t.spin_locked_tiers,'[]'::jsonb);
  END IF;

  IF COALESCE((v_settle->>'ok')::boolean,false) IS NOT TRUE
     OR (v_settle->>'multiplier') IS NOT NULL
        AND (v_settle->>'multiplier')::numeric <> v_booked_multiplier
     OR COALESCE((v_settle->>'pool_covered')::numeric,0) <> v_booked_draw
     OR COALESCE((v_settle->>'operator_shortfall')::numeric,0) <> 0 THEN
    RAISE EXCEPTION 'Spin % did not settle its exact funded draw: %',
      p_tournament_id, v_settle USING ERRCODE = 'P0404';
  END IF;

  SELECT count(*), (array_agg(r.id ORDER BY r.created_at,r.id))[1]
    INTO v_row_count,v_draw_reserve_id
    FROM public.spin_reserve_ledger r
   WHERE r.tournament_id = p_tournament_id
     AND r.kind = 'jackpot_draw'
     AND r.club_id = v_owner
     AND r.multiplier = v_booked_multiplier
     AND r.buy_in = v_t.buy_in_amount
     AND r.seats = 3
     AND round(-r.amount,2) = v_booked_draw;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Spin % draw evidence is not exact after settlement',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT count(*), (array_agg(l.id ORDER BY l.created_at,l.id))[1]
    INTO v_leg_count,v_draw_journal_id
    FROM public.chip_ledger l
    JOIN public.spin_reserve_ledger r ON r.id = v_draw_reserve_id
   WHERE l.category = 'spin_prize'
     AND l.from_type = 'spin_reserve'
     AND l.from_entity_id = v_pool_id
     AND l.to_type = 'prize_liability'
     AND l.to_entity_id = p_tournament_id
     AND l.tournament_id = p_tournament_id
     AND l.amount = v_booked_draw
     AND l.post_from_balance IS NOT DISTINCT FROM r.balance_after
     AND (v_draw_existed OR l.idempotency_key = v_draw_key);
  IF v_leg_count <> 1 THEN
    RAISE EXCEPTION 'Spin % draw has % exact journal legs',
      p_tournament_id,v_leg_count USING ERRCODE = 'P0404';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.spin_reserve_ledger r
       WHERE r.id = v_entry_reserve_id
          AND r.tournament_id = p_tournament_id
          AND r.kind = 'contribution'
          AND r.club_id = v_owner
          AND r.amount = v_reserve_in
          AND r.buy_in = v_t.buy_in_amount
          AND r.seats = 3
          AND r.house_rake = round(v_t.buy_in_amount * 3 * v_rake_rate,2))
     OR NOT EXISTS (
       SELECT 1 FROM public.chip_ledger l
       JOIN public.spin_reserve_ledger r ON r.id = v_entry_reserve_id
        WHERE l.id = v_entry_journal_id
          AND l.tournament_id = p_tournament_id
          AND l.category = 'spin_entry'
          AND l.from_type = 'prize_liability'
          AND l.from_entity_id = p_tournament_id
          AND l.to_type = 'spin_reserve'
          AND l.to_entity_id = v_pool_id
          AND l.amount = v_reserve_in
          AND l.post_to_balance IS NOT DISTINCT FROM r.balance_after) THEN
    RAISE EXCEPTION 'Spin % entry receipt ids do not resolve to exact evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT e.reserve_out,e.reserve_in,e.prize_balance
    INTO v_escrow_reserve_out,v_escrow_reserve_in,v_escrow_prize_balance
    FROM public.tournament_escrow e
   WHERE e.tournament_id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_escrow_reserve_out IS DISTINCT FROM v_reserve_in
     OR v_escrow_reserve_in IS DISTINCT FROM v_booked_draw
     OR v_escrow_prize_balance IS DISTINCT FROM v_booked_draw THEN
    RAISE EXCEPTION
      'Spin % escrow does not equal entry %, draw % (out %, in %, prize %)',
      p_tournament_id,v_reserve_in,v_booked_draw,
      v_escrow_reserve_out,v_escrow_reserve_in,v_escrow_prize_balance
      USING ERRCODE = 'P0404';
  END IF;

  IF COALESCE(v_t.spin_multiplier,0) > 0
     AND v_t.spin_multiplier IS DISTINCT FROM v_booked_multiplier THEN
    RAISE EXCEPTION 'Spin % row multiplier % disagrees with immutable draw %',
      p_tournament_id,v_t.spin_multiplier,v_booked_multiplier
      USING ERRCODE = 'P0404';
  END IF;
  IF COALESCE(v_t.spin_multiplier,0) > 0
     AND v_t.prize_pool IS DISTINCT FROM v_booked_draw THEN
    RAISE EXCEPTION 'Spin % row prize pool % disagrees with immutable draw %',
      p_tournament_id,v_t.prize_pool,v_booked_draw USING ERRCODE = 'P0404';
  END IF;

  -- Stage 2 keys the immutable tournament-contract trigger to this authority.
  -- Stage 1 does not require the marker yet because the still-live old engine
  -- must be able to finish its database-first rolling cutover.
  PERFORM set_config(
    'app.spin_settlement_authority',p_tournament_id::text,true);
  UPDATE public.tournaments
     SET spin_multiplier = v_booked_multiplier,
         prize_pool = v_booked_draw,
         spin_locked_tiers = v_locked
   WHERE id = p_tournament_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  PERFORM set_config('app.spin_settlement_authority','',true);
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Spin % tournament contract could not be stamped',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.tournaments t
        WHERE t.id = p_tournament_id
          AND t.spin_multiplier IS NOT DISTINCT FROM v_booked_multiplier
          AND t.prize_pool IS NOT DISTINCT FROM v_booked_draw
          AND t.spin_locked_tiers IS NOT DISTINCT FROM v_locked
     ) THEN
    RAISE EXCEPTION 'Spin % tournament contract did not read back exactly',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  SELECT p.balance INTO v_available
    FROM public.spin_bonus_pools p WHERE p.id = v_pool_id;

  RETURN v_settle || jsonb_build_object(
    'ok',true,
    'money_path','fn_spin_draw_and_settle',
    'tournament_id',p_tournament_id,
    'seats',3,
    'paid_users',v_paid_users,
    'multiplier',v_booked_multiplier,
    'prize_pool',v_booked_draw,
    'pool_covered',v_booked_draw,
    'operator_shortfall',0,
    'draw_amount',v_booked_draw,
    'entry_amount',v_reserve_in,
    'reserve_in',v_reserve_in,
    'house_rake',round(v_t.buy_in_amount * 3 * v_rake_rate,2),
    'reserve_balance',v_available,
    'pool_id',v_pool_id,
    'entry_reserve_id',v_entry_reserve_id,
    'entry_journal_id',v_entry_journal_id,
    'draw_reserve_id',v_draw_reserve_id,
    'draw_journal_id',v_draw_journal_id,
    'escrow_reserve_out',v_escrow_reserve_out,
    'escrow_reserve_in',v_escrow_reserve_in,
    'escrow_prize_balance',v_escrow_prize_balance,
    'tournament_multiplier',v_booked_multiplier,
    'tournament_prize_pool',v_booked_draw,
    'locked',v_locked,
    'eligible_count',jsonb_array_length(v_eligible),
    'owner_id',v_owner);
END;
$function$;

-- @probe-for: public.fn_spin_draw_and_settle
-- Runs the new body once against the same board. Its own refusal codes
-- (55000, P0002, 22023, 23514) are the expected answer for a board that
-- is not yet three paid seats; any other error, such as a body that cannot
-- execute, rolls this migration back. Always undone.
DO $probe$
DECLARE
  v_id uuid;
BEGIN
  SELECT t.id INTO v_id FROM public.tournaments t
   WHERE t.variant = 'spin' AND t.status = 'REGISTERING' AND t.started_at IS NULL
     AND COALESCE(t.max_players, 0) = 3
   ORDER BY t.created_at LIMIT 1;
  BEGIN
    PERFORM public.fn_spin_draw_and_settle(
      COALESCE(v_id, '00000000-0000-0000-0000-000000000000'::uuid), '[]'::jsonb);
  EXCEPTION
    -- Its own refusals: not three paid identities / closed status / Diamond
    -- (55000), missing board (P0002), not a Spin (22023), bad contract (23514).
    WHEN SQLSTATE '55000' OR SQLSTATE 'P0002' OR SQLSTATE '22023' OR SQLSTATE '23514' THEN NULL;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
