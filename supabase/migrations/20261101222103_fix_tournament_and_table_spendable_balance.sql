BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX TOURNAMENT SEAT STAMPING, LATE-REG SEAT REUSE, AND SPENDABLE BALANCE
-- ═══════════════════════════════════════════════════════════════════════════
-- Root causes fixed:
-- 1. `fn_seat_club_for_user_membership_unchecked` previously checked
--    `p_preferred_club` BEFORE `tournament_players.club_id` on tournament tables.
--    When `fn_seat_late_registrant_before_maintenance_gate` reused a vacated
--    `table_seats` row with `club_id = COALESCE(club_id, v_club)`, the trigger
--    passed the departed occupant's `club_id` as `p_preferred_club`, stamping
--    the departed occupant's club (e.g., The Felt Society with 0.50 chips) onto
--    the new player's tournament seat instead of `tournament_players.club_id`
--    (e.g., KINGS CLUB with 4,745.68 chips).
-- 2. `fn_seat_late_registrant_before_maintenance_gate` now reads `tp.club_id`
--    from `tournament_players` and sets `club_id = COALESCE(v_tp_club, v_club)`.
-- 3. `fn_player_spendable_balance` previously treated `p_table_id` as a cash
--    table even when `tables.tournament_id IS NOT NULL`, AND checked
--    `COALESCE(v_balance, 0) <= 0` instead of `< v_need`. As a result, when a
--    tournament table's Add-On or Rebuy modal called `readTableFundingBalance`
--    with `{ tableId }`, `fn_player_spendable_balance` read `table_seats.club_id`
--    (0.50 chips) instead of the tournament entry's wallet (4,745.68 chips),
--    falsely showing "Insufficient Balance".

CREATE OR REPLACE FUNCTION public.fn_seat_club_for_user_membership_unchecked(
  p_user_id uuid,
  p_table_id uuid,
  p_preferred_club uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_union uuid;
  v_table_club uuid;
  v_table_tournament_id uuid;
  v_club uuid;
  v_is_horse boolean := false;
  v_n int;
  v_idx int;
BEGIN
  SELECT t.union_id, t.club_id, t.tournament_id
    INTO v_union, v_table_club, v_table_tournament_id
    FROM public.tables t
   WHERE t.id = p_table_id;

  IF v_union IS NULL THEN
    RETURN v_table_club;                       -- standalone club game
  END IF;

  -- 1. For a tournament table, the club stamped on `tournament_players` is the
  --    authoritative entry club and must NEVER be overridden by a reused seat's
  --    prior `club_id` passed through `p_preferred_club`.
  IF v_table_tournament_id IS NOT NULL THEN
    SELECT tp.club_id INTO v_club
      FROM public.tournament_players tp
     WHERE tp.tournament_id = v_table_tournament_id
       AND tp.user_id = p_user_id
       AND tp.club_id IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.club_members m
          WHERE m.user_id = p_user_id
            AND m.club_id = tp.club_id
            AND m.status IN ('active', 'approved')
       )
     LIMIT 1;
    IF v_club IS NOT NULL THEN
      RETURN v_club;
    END IF;
  END IF;

  -- 2. Honour an explicit preferred club (including `v_paying` resolved by
  --    `fn_ca_cash_paying_club` in `atomic_table_buyin`) when the player is an
  --    active/approved member of that club in this union.
  IF p_preferred_club IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.club_members m
        WHERE m.user_id = p_user_id
          AND m.club_id = p_preferred_club
          AND m.status IN ('active', 'approved')
          AND (
            m.club_id = v_table_club
            OR EXISTS (
              SELECT 1
                FROM public.union_clubs uc
               WHERE uc.club_id = m.club_id
                 AND uc.union_id = v_union
            )
          )
     )
  THEN
    RETURN p_preferred_club;
  END IF;

  -- 3. Existing active seat of the SAME kind (cash vs tournament) in this union.
  --    A tournament seat never overrides a cash table's wallet selection, and on
  --    cash tables a seat whose club still holds chips is preferred first.
  SELECT ts.club_id INTO v_club
    FROM public.table_seats ts
    JOIN public.tables t2 ON t2.id = ts.table_id
    LEFT JOIN public.club_members cm
      ON cm.user_id = p_user_id
     AND cm.club_id = ts.club_id
     AND cm.status IN ('active', 'approved')
   WHERE ts.user_id = p_user_id
     AND ts.left_at IS NULL
     AND ts.club_id IS NOT NULL
     AND t2.union_id = v_union
     AND (t2.tournament_id IS NOT NULL) = (v_table_tournament_id IS NOT NULL)
     AND lower(coalesce(t2.status, '')) NOT IN ('closed','completed','cancelled','finished')
   ORDER BY (COALESCE(cm.chip_balance, 0) > 0) DESC,
            COALESCE(cm.chip_balance, 0) DESC,
            ts.joined_at ASC NULLS LAST
   LIMIT 1;
  IF v_club IS NOT NULL THEN
    RETURN v_club;
  END IF;

  SELECT COALESCE(p.is_horse, false) INTO v_is_horse
    FROM public.profiles p
   WHERE p.id = p_user_id;

  IF v_is_horse THEN
    SELECT count(*) INTO v_n
      FROM public.club_members m
      JOIN public.union_clubs uc ON uc.club_id = m.club_id AND uc.union_id = v_union
     WHERE m.user_id = p_user_id AND m.status IN ('active','approved');

    IF v_n > 1 THEN
      v_idx := (abs(hashtextextended(p_user_id::text, 0)) % v_n)::int;
      SELECT m.club_id INTO v_club
        FROM public.club_members m
        JOIN public.union_clubs uc ON uc.club_id = m.club_id AND uc.union_id = v_union
       WHERE m.user_id = p_user_id AND m.status IN ('active','approved')
       ORDER BY m.club_id
       OFFSET v_idx LIMIT 1;
      IF v_club IS NOT NULL THEN RETURN v_club; END IF;
    END IF;
  END IF;

  -- Real players: prefer a member club in the union with positive balance, then oldest membership.
  SELECT m.club_id INTO v_club
    FROM public.club_members m
    JOIN public.union_clubs uc ON uc.club_id = m.club_id AND uc.union_id = v_union
   WHERE m.user_id = p_user_id AND m.status IN ('active','approved')
   ORDER BY (COALESCE(m.chip_balance, 0) > 0) DESC,
            COALESCE(m.chip_balance, 0) DESC,
            m.joined_at ASC NULLS LAST,
            m.club_id
   LIMIT 1;

  RETURN v_club;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seat_late_registrant_before_maintenance_gate(
  p_tournament_id uuid,
  p_user_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_previous_money_path text := current_setting('app.money_path',true);
  v_status text;
  v_start_chips integer;
  v_club uuid;
  v_tp_club uuid;
  v_bonus integer;
  v_chips integer;
  v_table uuid;
  v_cap int;
  v_seat int;
  v_taken int;
  v_opened boolean := false;
  v_capacity jsonb;
BEGIN
  PERFORM set_config('app.money_path', 'fn_seat_late_registrant', true); -- CHIP STANDARD C2: sanctioned seat creator (trg_ca_guard_seat_creation)
  SELECT status, COALESCE(starting_chips, 0), club_id
    INTO v_status, v_start_chips, v_club
    FROM public.tournaments WHERE id = p_tournament_id;

  IF v_status IS DISTINCT FROM 'RUNNING' THEN
    PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);
    RETURN jsonb_build_object('ok', false, 'reason', 'not_running');
  END IF;

  SELECT COALESCE(chips, 0), club_id
    INTO v_bonus, v_tp_club
    FROM public.tournament_players
   WHERE tournament_id = p_tournament_id
     AND user_id = p_user_id
     AND table_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.table_seats s
        JOIN public.tables tb ON tb.id = s.table_id
       WHERE tb.tournament_id = p_tournament_id
         AND s.user_id = p_user_id
         AND s.left_at IS NULL
     )
     FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);
    RETURN jsonb_build_object('ok', false, 'reason', 'already_seated_or_missing');
  END IF;

  v_chips := v_start_chips + GREATEST(v_bonus, 0);

  SELECT tb.id, COALESCE(tb.max_players, 9)
    INTO v_table, v_cap
    FROM public.tables tb
   WHERE tb.tournament_id = p_tournament_id
     AND lower(COALESCE(tb.status, '')) IN ('waiting', 'running', 'active')
     AND COALESCE(tb.is_deleted,false)=false
     AND NOT EXISTS (SELECT 1 FROM smarter_private.f06_operations o
                      WHERE o.source_table_id = tb.id
                        AND o.state NOT IN ('acknowledged', 'withdrawn_before_manifest'))
     AND (
       SELECT count(*) FROM public.table_seats s
        WHERE s.table_id = tb.id AND s.left_at IS NULL
     ) < COALESCE(tb.max_players, 9)
   ORDER BY (
       SELECT count(*) FROM public.table_seats s
        WHERE s.table_id = tb.id AND s.left_at IS NULL
     ) DESC, tb.created_at ASC
   LIMIT 1
     FOR UPDATE OF tb;

  -- Capacity owns the table format, current blinds, legal chairs and durable
  -- manager receipt. The entry already exists here, so reserve no second entry.
  IF v_table IS NULL THEN
    v_capacity := public.fn_ensure_late_registration_capacity(p_tournament_id,0);
    v_table := NULLIF(v_capacity->>'table_id','')::uuid;
    IF COALESCE((v_capacity->>'ok')::boolean,false) IS NOT TRUE
       OR v_table IS NULL THEN
      PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);
      RETURN jsonb_build_object('ok',false,'reason','no_open_seat');
    END IF;
    SELECT tb.max_players INTO STRICT v_cap FROM public.tables tb
     WHERE tb.id=v_table AND tb.tournament_id=p_tournament_id
       AND tb.status IN ('waiting','running','active')
       AND COALESCE(tb.is_deleted,false)=false FOR UPDATE;
    v_opened := COALESCE((v_capacity->>'created')::boolean,false);
  END IF;

  SELECT g.n INTO v_seat
    FROM generate_series(1, v_cap) AS g(n)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.table_seats s
      WHERE s.table_id = v_table AND s.seat_number = g.n AND s.left_at IS NULL
   )
   ORDER BY g.n LIMIT 1;

  IF v_seat IS NULL THEN
    PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_seat');
  END IF;

  UPDATE public.table_seats
     SET user_id        = p_user_id,
         stack          = v_chips,
         left_at        = NULL,
         joined_at      = now(),
         is_sitting_out = false,
         is_away        = false,
         club_id        = COALESCE(v_tp_club, v_club)
   WHERE table_id = v_table AND seat_number = v_seat AND left_at IS NOT NULL;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.table_seats (table_id, user_id, seat_number, stack, club_id)
      VALUES (v_table, p_user_id, v_seat, v_chips, COALESCE(v_tp_club, v_club));
    EXCEPTION WHEN unique_violation THEN
      PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);
      RETURN jsonb_build_object('ok', false, 'reason', 'seat_race');
    END;
  END IF;

  UPDATE public.tournament_players
     SET status      = 'playing',
         chips       = v_chips,
         table_id    = v_table,
         seat_number = v_seat
   WHERE tournament_id = p_tournament_id AND user_id = p_user_id;

  SELECT count(*) INTO v_taken
    FROM public.table_seats WHERE table_id = v_table AND left_at IS NULL;
  UPDATE public.tables SET current_players = v_taken WHERE id = v_table;

  PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);

  RETURN jsonb_build_object('ok', true, 'table_id', v_table,
    'seat_number', v_seat, 'chips', v_chips, 'opened_table', v_opened);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.money_path',COALESCE(v_previous_money_path,''),true);
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_player_spendable_balance(
  p_user_id uuid,
  p_club_id uuid DEFAULT NULL::uuid,
  p_table_id uuid DEFAULT NULL::uuid,
  p_tournament_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_club uuid := NULL;
  v_club_name text := NULL;
  v_balance numeric := 0;
  v_source text := 'club_chips';
  v_paying uuid := NULL;
  v_union uuid := NULL;
  v_need numeric := 0;
  v_table_tournament_id uuid := NULL;
BEGIN
  IF NOT public.fn_caller_is_engine()
     AND (
       auth.uid() IS NULL
       OR (
         p_user_id IS DISTINCT FROM auth.uid()
         AND NOT EXISTS (
           SELECT 1 FROM club_members cm
            WHERE cm.user_id = p_user_id
              AND cm.agent_id = auth.uid()
         )
         AND NOT EXISTS (
           SELECT 1 FROM club_members cm2
           JOIN union_clubs uc ON uc.club_id = cm2.club_id
            WHERE cm2.user_id = p_user_id
              AND public.fn_is_union_overseer(uc.union_id, auth.uid())
         )
       )
     )
  THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('balance', 0, 'source', 'none', 'club_id', NULL, 'club_name', NULL);
  END IF;

  IF p_table_id IS NOT NULL AND p_tournament_id IS NULL THEN
    SELECT t.tournament_id INTO v_table_tournament_id
      FROM public.tables t
     WHERE t.id = p_table_id;
  END IF;

  IF p_tournament_id IS NOT NULL THEN
    v_club := COALESCE(
      public.fn_ca_entry_paying_club(p_user_id, p_tournament_id),
      public.fn_tournament_club_for_user(p_user_id, p_tournament_id, NULL)
    );
    SELECT t.union_id,
           GREATEST(
             COALESCE(NULLIF(t.addon_cost, 0), NULLIF(t.rebuy_cost, 0), t.buy_in_amount, 0)
             + COALESCE(t.buy_in_fee, 0),
             0.01
           )
      INTO v_union, v_need
      FROM public.tournaments t
     WHERE t.id = p_tournament_id;
    IF v_club IS NOT NULL THEN
      SELECT COALESCE(chip_balance, 0) INTO v_balance
        FROM club_members WHERE user_id = p_user_id AND club_id = v_club;
    END IF;
    IF v_union IS NOT NULL AND COALESCE(v_balance, 0) < v_need THEN
      v_paying := COALESCE(
        public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, v_need),
        public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, 0.01)
      );
      IF v_paying IS NOT NULL THEN
        v_club := v_paying;
      END IF;
    END IF;
  ELSIF v_table_tournament_id IS NOT NULL THEN
    v_club := COALESCE(
      public.fn_ca_entry_paying_club(p_user_id, v_table_tournament_id),
      public.fn_tournament_club_for_user(p_user_id, v_table_tournament_id, NULL)
    );
    SELECT t.union_id,
           GREATEST(
             COALESCE(NULLIF(t.addon_cost, 0), NULLIF(t.rebuy_cost, 0), t.buy_in_amount, 0)
             + COALESCE(t.buy_in_fee, 0),
             0.01
           )
      INTO v_union, v_need
      FROM public.tournaments t
     WHERE t.id = v_table_tournament_id;
    IF v_club IS NOT NULL THEN
      SELECT COALESCE(chip_balance, 0) INTO v_balance
        FROM club_members WHERE user_id = p_user_id AND club_id = v_club;
    END IF;
    IF v_union IS NOT NULL AND COALESCE(v_balance, 0) < v_need THEN
      v_paying := COALESCE(
        public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, v_need),
        public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, 0.01)
      );
      IF v_paying IS NOT NULL THEN
        v_club := v_paying;
      END IF;
    END IF;
  ELSIF p_table_id IS NOT NULL THEN
    v_need := GREATEST(COALESCE(public.fn_ca_cash_entry_need(p_user_id, p_table_id), 0), 0.01);
    SELECT ts.club_id INTO v_club
      FROM table_seats ts
     WHERE ts.table_id = p_table_id AND ts.user_id = p_user_id AND ts.left_at IS NULL
     LIMIT 1;
    IF v_club IS NOT NULL THEN
      SELECT COALESCE(chip_balance, 0) INTO v_balance
        FROM club_members WHERE user_id = p_user_id AND club_id = v_club;
      IF COALESCE(v_balance, 0) < v_need THEN
        v_paying := public.fn_ca_cash_paying_club(p_user_id, p_table_id, p_club_id, v_need);
        IF v_paying IS NOT NULL THEN
          v_club := v_paying;
        END IF;
      END IF;
    ELSE
      v_club := public.fn_seat_club_for_user(p_user_id, p_table_id, p_club_id);
      v_paying := public.fn_ca_cash_paying_club(p_user_id, p_table_id, p_club_id, v_need);
      IF v_paying IS NOT NULL THEN
        v_club := v_paying;
      END IF;
    END IF;
  ELSIF p_club_id IS NOT NULL THEN
    SELECT m.club_id, COALESCE(m.chip_balance, 0)
      INTO v_club, v_balance
      FROM club_members m
     WHERE m.user_id = p_user_id AND m.club_id = p_club_id
       AND m.status IN ('active', 'approved')
     LIMIT 1;
    IF v_club IS NULL OR COALESCE(v_balance, 0) <= 0 THEN
      SELECT COALESCE(c.union_id, uc.union_id) INTO v_union
        FROM clubs c
        LEFT JOIN union_clubs uc ON uc.club_id = c.id
       WHERE c.id = p_club_id
       LIMIT 1;
      IF v_union IS NOT NULL THEN
        v_paying := public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, 0.01);
        IF v_paying IS NOT NULL THEN
          v_club := v_paying;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_club IS NULL THEN
    SELECT m.club_id INTO v_club
      FROM club_members m
     WHERE m.user_id = p_user_id AND m.status IN ('active', 'approved')
     ORDER BY (COALESCE(m.chip_balance, 0) > 0) DESC,
              COALESCE(m.chip_balance, 0) DESC,
              m.joined_at ASC NULLS LAST,
              m.club_id
     LIMIT 1;
  END IF;

  IF v_club IS NOT NULL THEN
    SELECT COALESCE(chip_balance, 0) INTO v_balance
      FROM club_members WHERE user_id = p_user_id AND club_id = v_club;
    SELECT c.name INTO v_club_name FROM clubs c WHERE c.id = v_club;
  ELSE
    SELECT COALESCE(balance, 0) INTO v_balance
      FROM wallets WHERE user_id = p_user_id AND wallet_type = 'PLAYER';
    v_source := 'smarter_poker_wallet';
  END IF;

  RETURN jsonb_build_object(
    'balance', COALESCE(v_balance, 0),
    'source', v_source,
    'club_id', v_club,
    'club_name', v_club_name,
    'club_scoped', true
  );
END
$function$;

-- Repair any live tournament seat rows where `table_seats.club_id` diverged from
-- the player's stamped `tournament_players.club_id` due to seat reuse.
UPDATE public.table_seats ts
   SET club_id = tp.club_id
  FROM public.tables tb
  JOIN public.tournament_players tp ON tp.tournament_id = tb.tournament_id
 WHERE tb.id = ts.table_id
   AND tb.tournament_id IS NOT NULL
   AND ts.user_id = tp.user_id
   AND ts.left_at IS NULL
   AND tp.club_id IS NOT NULL
   AND ts.club_id IS DISTINCT FROM tp.club_id
   AND EXISTS (
     SELECT 1
       FROM public.club_members m
      WHERE m.user_id = ts.user_id
        AND m.club_id = tp.club_id
        AND m.status IN ('active', 'approved')
   );

REVOKE ALL ON FUNCTION public.fn_seat_club_for_user_membership_unchecked(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seat_club_for_user_membership_unchecked(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_seat_late_registrant_before_maintenance_gate(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
