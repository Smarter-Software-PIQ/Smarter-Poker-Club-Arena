BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX FREE-BUY & REBUY/ADD-ON UNION ENTRY PAYING CLUB AND HOME CLUB SELECTION
-- ═══════════════════════════════════════════════════════════════════════════
-- Root causes fixed:
-- 1. `fn_ca_entry_paying_club(p_user_id, p_tournament_id)` previously returned
--    `NULL` whenever `v_charge <= 0` (every Free-Buy / freeroll tournament) OR
--    whenever the default club merely covered `v_charge` (even if `v_default`
--    had 0 chips left for rebuys/add-ons while another union club held 4,745+
--    chips). Because `fn_ca_process_tournament_chip_purchase_money_v1` strictly
--    charges `tournament_players.club_id` (and `fn_union_pnl_boundary` requires
--    a single `owners` club across entry + rebuy + addon receipts), stamping an
--    unfunded union club at registration time stranded the player (and horses)
--    with `"Insufficient club chips"` when attempting to rebuy or add on.
-- 2. `fn_tournament_club_for_user(p_user_id, p_tournament_id, p_preferred_club)`
--    previously fell back for human players to `ORDER BY m.joined_at ASC NULLS
--    LAST, m.club_id LIMIT 1`, picking an empty oldest union club (`0.50` chips)
--    instead of a funded union club (`4,745.68` chips).
-- 3. `fn_player_home_club(p_user_id, p_club_hint)` previously ordered by
--    `cm.joined_at ASC NULLS LAST, cm.club_id LIMIT 1` without preferring
--    positive `chip_balance`, causing un-hinted callers to resolve to an empty
--    oldest club wallet.

CREATE OR REPLACE FUNCTION public.fn_player_home_club(
  p_user_id uuid,
  p_club_hint uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_club uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_club_hint IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.club_members cm
     WHERE cm.user_id = p_user_id
       AND cm.club_id = p_club_hint
       AND cm.status IN ('active', 'approved')
  ) THEN
    RETURN p_club_hint;
  END IF;
  SELECT cm.club_id INTO v_club
    FROM public.club_members cm
   WHERE cm.user_id = p_user_id
     AND cm.status IN ('active', 'approved')
   ORDER BY (COALESCE(cm.chip_balance, 0) > 0) DESC,
            COALESCE(cm.chip_balance, 0) DESC,
            cm.joined_at ASC NULLS LAST,
            cm.club_id
   LIMIT 1;
  RETURN v_club;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_tournament_club_for_user(
  p_user_id uuid,
  p_tournament_id uuid,
  p_preferred_club uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_union uuid;
  v_t_club uuid;
  v_club uuid;
  v_is_horse boolean := false;
  v_n int;
  v_idx int;
  v_paying text;
BEGIN
  SELECT t.union_id, t.club_id INTO v_union, v_t_club
    FROM public.tournaments t WHERE t.id = p_tournament_id;

  IF v_union IS NULL THEN
    RETURN v_t_club;                       -- standalone club tournament
  END IF;

  /* THE WALLET THAT CAN PAY IS THE WALLET THAT PAYS (2026-10-12). */
  IF p_preferred_club IS NULL THEN
    v_paying := NULLIF(current_setting('app.ca_entry_paying_club', true), '');
    IF v_paying IS NOT NULL
       AND split_part(v_paying, ':', 1) = p_tournament_id::text
       AND split_part(v_paying, ':', 2) = p_user_id::text THEN
      RETURN split_part(v_paying, ':', 3)::uuid;
    END IF;
  END IF;

  /* THE HOST CLUB IS IN ITS OWN UNION (2026-09-10). */
  IF p_preferred_club IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.club_members m
        WHERE m.user_id = p_user_id
          AND m.club_id = p_preferred_club
          AND m.status IN ('active', 'approved')
          AND (
            m.club_id = v_t_club
            OR EXISTS (
              SELECT 1 FROM public.union_clubs uc
               WHERE uc.club_id = m.club_id
                 AND uc.union_id = v_union
            )
          )
     )
  THEN
    RETURN p_preferred_club;
  END IF;

  /* AN ENTRY'S LATER MONEY USES THE WALLET THE ENTRY CAME FROM (2026-10-12). */
  SELECT tp.club_id INTO v_club
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.user_id = p_user_id
     AND tp.club_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.club_members m
        WHERE m.user_id = p_user_id
          AND m.club_id = tp.club_id
          AND m.status IN ('active', 'approved')
     )
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
     WHERE m.user_id = p_user_id AND m.status IN ('active', 'approved');
    IF v_n > 1 THEN
      v_idx := (abs(hashtextextended(p_user_id::text, 0)) % v_n)::int;
      SELECT m.club_id INTO v_club
        FROM public.club_members m
        JOIN public.union_clubs uc ON uc.club_id = m.club_id AND uc.union_id = v_union
       WHERE m.user_id = p_user_id AND m.status IN ('active', 'approved')
       ORDER BY m.club_id OFFSET v_idx LIMIT 1;
      IF v_club IS NOT NULL THEN RETURN v_club; END IF;
    END IF;
  END IF;

  -- Real players: prefer a union member club with positive chip balance, then oldest membership.
  SELECT m.club_id INTO v_club
    FROM public.club_members m
    JOIN public.union_clubs uc ON uc.club_id = m.club_id AND uc.union_id = v_union
   WHERE m.user_id = p_user_id AND m.status IN ('active', 'approved')
   ORDER BY (COALESCE(m.chip_balance, 0) > 0) DESC,
            COALESCE(m.chip_balance, 0) DESC,
            m.joined_at ASC NULLS LAST,
            m.club_id
   LIMIT 1;

  RETURN v_club;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_entry_paying_club(
  p_user_id uuid,
  p_tournament_id uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t record;
  v_charge numeric := 0;
  v_rebuy_need numeric := 0;
  v_addon_need numeric := 0;
  v_full_need numeric := 0;
  v_default uuid;
  v_balance numeric := 0;
  v_paying uuid;
BEGIN
  IF p_user_id IS NULL OR p_tournament_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT t.union_id, t.buy_in_amount, t.buy_in_fee, t.bounty_amount,
         t.rebuy_cost, t.addon_cost, t.is_rebuy, t.is_reentry, t.add_on_available,
         (COALESCE(t.is_bounty, false) OR COALESCE(t.is_pko, false)
          OR COALESCE(t.is_mystery_bounty, false)) AS is_bounty
    INTO v_t
    FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR v_t.union_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.fn_ca_tournament_unit_cents(p_tournament_id) = 100 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id AND tp.user_id = p_user_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(s.charge, 0) INTO v_charge
    FROM public.fn_tournament_entry_split(
      v_t.buy_in_amount, v_t.buy_in_fee, v_t.bounty_amount, v_t.is_bounty) s;
  v_charge := GREATEST(COALESCE(v_charge, 0), 0);

  IF COALESCE(v_t.is_rebuy, false) OR COALESCE(v_t.is_reentry, false) THEN
    v_rebuy_need := GREATEST(COALESCE(NULLIF(v_t.rebuy_cost, 0), v_t.buy_in_amount, 0), 0);
  END IF;
  IF COALESCE(v_t.add_on_available, false) THEN
    v_addon_need := GREATEST(COALESCE(NULLIF(v_t.addon_cost, 0), v_t.buy_in_amount, 0), 0);
  END IF;

  -- Prefer a union wallet that can cover the entry AND at least one rebuy + add-on
  -- so the stamped entry wallet is never stranded on subsequent rebuy/add-on purchases.
  v_full_need := GREATEST(v_charge + v_rebuy_need + v_addon_need, v_charge, 0.01);

  v_default := public.fn_tournament_club_for_user(p_user_id, p_tournament_id, NULL);
  IF v_default IS NOT NULL THEN
    SELECT COALESCE(m.chip_balance, 0) INTO v_balance
      FROM public.club_members m
     WHERE m.user_id = p_user_id AND m.club_id = v_default
       AND m.status IN ('active', 'approved');
    IF COALESCE(v_balance, 0) >= v_full_need THEN
      RETURN NULL;
    END IF;
  END IF;

  v_paying := public.fn_ca_union_wallet_that_can_pay(p_user_id, v_t.union_id, v_full_need);
  IF v_paying IS NOT NULL THEN
    RETURN v_paying;
  END IF;

  IF v_charge > 0 THEN
    IF v_default IS NOT NULL AND COALESCE(v_balance, 0) >= v_charge THEN
      RETURN NULL;
    END IF;
    RETURN public.fn_ca_union_wallet_that_can_pay(p_user_id, v_t.union_id, v_charge);
  END IF;

  -- Free-Buy / freeroll fallback when no single wallet covers v_full_need:
  RETURN COALESCE(
    public.fn_ca_union_wallet_that_can_pay(
      p_user_id, v_t.union_id, GREATEST(v_rebuy_need, v_addon_need, 0.01)
    ),
    public.fn_ca_union_wallet_that_can_pay(p_user_id, v_t.union_id, 0.01)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_entry_paying_club(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_entry_paying_club(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tournament_club_for_user(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tournament_club_for_user(uuid, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_player_home_club(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_player_home_club(uuid, uuid) TO authenticated, service_role;

COMMIT;
