CREATE OR REPLACE FUNCTION public.fn_member_leave_to_treasury(p_club_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_role  text;
  v_chips numeric;
  v_after numeric;
  v_caller uuid := auth.uid();
  v_saved jsonb;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'club and user required');
  END IF;

  -- AUTHZ: service role, the member themselves, or a club treasury manager.
  IF v_caller IS NOT NULL
     AND v_caller <> p_user_id
     AND NOT public.fn_actor_can_manage_club_treasury(p_club_id) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'not authorized to remove another member from this club');
  END IF;

  SELECT role, COALESCE(chip_balance, 0)
    INTO v_role, v_chips
  FROM club_members
  WHERE club_id = p_club_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not a member');
  END IF;

  IF v_role = 'owner' THEN
    RETURN jsonb_build_object('success', false, 'error', 'owner must transfer ownership first');
  END IF;

  -- A SEATED MEMBER LEAVES THE TABLE BEFORE THE CLUB (launch audit
  -- 2026-10-05). table_seats.club_id is the club the seat was funded from. A
  -- membership deleted under a live seat leaves that stack with no wallet to
  -- cash out into, so the leave is refused here, for every caller.
  IF EXISTS (
    SELECT 1
      FROM public.table_seats ts
     WHERE ts.user_id = p_user_id
       AND ts.club_id = p_club_id
       AND ts.left_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leave Your Seat At The Table First');
  END IF;

  IF v_chips > 0 THEN
    /* THE WALLET PAYS THE TREASURY, BY NAME (2026-10-02, 20261002140203).
       This credited the treasury with no counterparty (a settlement_suspense
       leg) and then DELETEd the member row, which the delete journal booked
       as a burn of the same chips: the chips were counted out twice and in
       from nowhere once. The wallet is now emptied INTO the treasury under a
       declared club_treasury counterparty (one leg, player wallet -> club
       treasury), the treasury credit itself writes no second leg, and the
       row is deleted holding no chips. */
    v_saved := public.fn_ca_ledger_declaration_save(ARRAY['clubs']);
    PERFORM public.fn_ca_declare_ledger('treasury_transfer', 'club_treasury', p_club_id,
                                        NULL, NULL, ARRAY['clubs']);

    UPDATE club_members
       SET chip_balance = 0, updated_at = NOW()
     WHERE club_id = p_club_id AND user_id = p_user_id;

    UPDATE clubs
    SET chip_treasury = COALESCE(chip_treasury, 0) + v_chips,
        updated_at = NOW()
    WHERE id = p_club_id
    RETURNING chip_treasury INTO v_after;

    PERFORM public.fn_ca_ledger_declaration_restore(v_saved);

    IF v_after IS NULL THEN
      RAISE EXCEPTION 'club % not found while returning % chips from member %', p_club_id, v_chips, p_user_id;
    END IF;

    INSERT INTO chip_transactions (
      id, club_id, from_user_id, amount, transaction_type, notes, balance_after, created_at
    ) VALUES (
      gen_random_uuid(), p_club_id, p_user_id, v_chips,
      'leave_club_chip_return', 'Chips returned to treasury on club departure',
      v_after, NOW()
    );
  END IF;

  -- A MEMBER CAN LEAVE DEEP STACK SOCIETY (launch audit 2026-10-05). The
  -- club's delete guard refuses any club_members DELETE that has not declared
  -- itself. This door is authorized above and removes exactly one row, so it
  -- declares for that one statement and restores the setting after it.
  DECLARE
    v_teardown_before text := COALESCE(current_setting('app.deep_stack_teardown', true), '');
  BEGIN
    PERFORM set_config('app.deep_stack_teardown', 'on', true);
    DELETE FROM club_members WHERE club_id = p_club_id AND user_id = p_user_id;
    PERFORM set_config('app.deep_stack_teardown', v_teardown_before, true);
  END;

  RETURN jsonb_build_object('success', true, 'chips_returned', COALESCE(v_chips, 0));
END;
$function$
