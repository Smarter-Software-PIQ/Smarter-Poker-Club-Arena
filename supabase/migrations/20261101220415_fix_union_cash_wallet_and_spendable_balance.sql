-- ═══════════════════════════════════════════════════════════════════════════
-- FIX UNION CASH WALLET RESOLUTION, PREFERRED PAYING CLUB, AND SPENDABLE BALANCE
-- ═══════════════════════════════════════════════════════════════════════════
-- Root causes fixed:
-- 1. `fn_ca_cash_paying_club` previously returned NULL whenever the player held
--     ANY active seat in `v_union` (including a tournament seat whose club had
--    0.50 chips, or an existing cash seat whose club no longer covered the next
--    table's buy-in). That prevented `fn_ca_cash_wallet_covers`, `fn_cash_game_join`,
--    `atomic_table_buyin`, and `fn_player_spendable_balance` from falling back to
--    `fn_ca_union_wallet_that_can_pay` (e.g., KingFish with 4,745.68 in KINGS CLUB
--    and 0.50 in The Felt Society while seated in a Midway Union tournament).
-- 2. `fn_seat_club_for_user_membership_unchecked` previously returned an existing
--    seat's club in `v_union` BEFORE checking `p_preferred_club`, AND without
--    separating tournament seats from cash seats. When `atomic_table_buyin` passed
--    `COALESCE(v_paying, p_club_id)` as `p_preferred_club`, it was ignored if the
--    player held a tournament seat in the union.
-- 3. `fn_player_spendable_balance` now falls back to a funded union member club
--    when the initial union club cannot cover the need.

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

  -- 1. Honour an explicit preferred club (including `v_paying` resolved by
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

  -- 2. For a tournament table, if the player has a stamped tournament entry club,
  --    keep that entry's club on the seat.
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

CREATE OR REPLACE FUNCTION public.fn_ca_cash_paying_club(
  p_user_id uuid,
  p_table_id uuid,
  p_preferred_club uuid,
  p_amount numeric
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_union uuid;
  v_default uuid;
  v_balance numeric;
BEGIN
  IF p_user_id IS NULL OR p_table_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT t.union_id INTO v_union
    FROM public.tables t
    JOIN public.clubs c ON c.id = t.club_id
   WHERE t.id = p_table_id
     AND t.tournament_id IS NULL
     AND c.asset IS DISTINCT FROM 'diamonds';
  IF v_union IS NULL THEN
    RETURN NULL;
  END IF;

  /* Same-table seat continuity: if the player is already seated at THIS cash
     table and that seat's club can cover the requested top-up/buy-in, keep
     charging that club. Otherwise fall back to the union wallet that can pay. */
  IF EXISTS (
    SELECT 1
      FROM public.table_seats ts
      JOIN public.club_members m
        ON m.user_id = ts.user_id
       AND m.club_id = ts.club_id
       AND m.status IN ('active', 'approved')
     WHERE ts.user_id = p_user_id
       AND ts.table_id = p_table_id
       AND ts.left_at IS NULL
       AND COALESCE(m.chip_balance, 0) >= p_amount
  ) THEN
    RETURN NULL;
  END IF;

  v_default := public.fn_seat_club_for_user(p_user_id, p_table_id, p_preferred_club);
  IF v_default IS NOT NULL THEN
    SELECT m.chip_balance INTO v_balance
      FROM public.club_members m
     WHERE m.user_id = p_user_id AND m.club_id = v_default
       AND m.status IN ('active', 'approved');
    IF COALESCE(v_balance, 0) >= p_amount THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN public.fn_ca_union_wallet_that_can_pay(p_user_id, v_union, p_amount);
END
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

  IF p_table_id IS NOT NULL THEN
    v_need := GREATEST(COALESCE(public.fn_ca_cash_entry_need(p_user_id, p_table_id), 0), 0.01);
    SELECT ts.club_id INTO v_club
      FROM table_seats ts
     WHERE ts.table_id = p_table_id AND ts.user_id = p_user_id AND ts.left_at IS NULL
     LIMIT 1;
    IF v_club IS NOT NULL THEN
      SELECT COALESCE(chip_balance, 0) INTO v_balance
        FROM club_members WHERE user_id = p_user_id AND club_id = v_club;
      IF COALESCE(v_balance, 0) <= 0 THEN
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
  ELSIF p_tournament_id IS NOT NULL THEN
    v_club := COALESCE(
      public.fn_ca_entry_paying_club(p_user_id, p_tournament_id),
      public.fn_tournament_club_for_user(p_user_id, p_tournament_id, NULL)
    );
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

REVOKE ALL ON FUNCTION public.fn_seat_club_for_user_membership_unchecked(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seat_club_for_user_membership_unchecked(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_union_wallet_that_can_pay(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_cash_paying_club(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_cash_entry_need(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_cash_wallet_covers(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_entry_paying_club(uuid, uuid) FROM PUBLIC, anon, authenticated;
