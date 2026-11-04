-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- THE HORSE SPLIT RUNS BESIDE RUNNING TOURNAMENTS (2026-11-02).
--
-- Rakeback for 2026-10-26..11-02 paid at 18:38Z and Dan ordered the split now
-- (13:16 CT). Read before arming the drain: 2,860 horse entries are open, 704 of
-- them in the closed Diamond Arena (whose entries ride Diamond rails, not a
-- chip membership), and 64 full Midway Spins have sat REGISTERING since last
-- night. Requiring every event to finish first would keep the whole fleet off
-- the floor indefinitely. So, from 20261102141229:
--
-- * A tournament seat is its entry's: seating, moving and re-seating a horse
--   in an event it already entered is never judged at seat time, in any phase.
--   New cash seats, new entries, memberships and rejoins are still refused
--   while the split runs and judged by assignment afterwards.
-- * The platform arena is not a club and is outside the split.
-- * Preflight blocks on live CASH seats, not on open tournament entries.
-- * A membership in a club the horse leaves that still pays an open entry is
--   swept now, recorded 'deferred', and departs (agent wallet claimed, wallet
--   swept again) in a new final stage, 'settling', once its events finish;
--   the operation is complete only when none remain.
-- * Chips that reach an assigned wallet between its sweep and its funding are
--   claimed to the bank first ('settle_wallet_claim'), so every horse is
--   funded from exactly 0 to exactly 10,000; the receipts prove it.
-- Preimages md5-guarded. Small evidence-table CHECK changes only.
-- @live-proof: (SELECT position('20261102191900' IN pg_get_functiondef('public.fn_ca_horse_club_split_execute(uuid,integer)'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_reject_automated_user_club_row()'::regprocedure)) IS DISTINCT FROM '1a1085e35cacdc619f9509733b51b428'
 THEN RAISE EXCEPTION 'automated_club_guard_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_stamp_seat_club()'::regprocedure)) IS DISTINCT FROM '06ace966fb210e38a4889262f60416ff'
 THEN RAISE EXCEPTION 'seat_stamp_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_ca_horse_club_split_execute(uuid,integer)'::regprocedure)) IS DISTINCT FROM '4ab1c99141b80446d828043570b975a3'
 THEN RAISE EXCEPTION 'split_execute_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_ca_horse_club_split_preflight()'::regprocedure)) IS DISTINCT FROM '6b3897ff4c80a9c1c782a20957b390d0'
 THEN RAISE EXCEPTION 'split_preflight_preimage_changed'; END IF;
 IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_operations) THEN
  RAISE EXCEPTION 'split_operation_already_started'; END IF;
END
$guard$;

ALTER TABLE public.ca_horse_club_split_receipts DROP CONSTRAINT ca_horse_club_split_receipts_kind_check;
ALTER TABLE public.ca_horse_club_split_receipts ADD CONSTRAINT ca_horse_club_split_receipts_kind_check
  CHECK (kind IN ('player_wallet_claim','settle_wallet_claim','agent_wallet_claim','departed','deferred','joined',
                  'downline_released','mint','fund_10000','kings_display'));
ALTER TABLE public.ca_horse_club_split_operations DROP CONSTRAINT ca_horse_club_split_operations_stage_check;
ALTER TABLE public.ca_horse_club_split_operations ADD CONSTRAINT ca_horse_club_split_operations_stage_check
  CHECK (stage IN ('draining','sweeping','minting','funding','enforcing','settling','complete'));

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_refusal(p_horse uuid, p_host uuid, p_wallet uuid, p_membership boolean)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_phase text := public.fn_ca_horse_split_phase(); v_home uuid;
BEGIN
  IF v_phase = 'inactive' THEN RETURN NULL; END IF;
  -- The platform arena is not a club; its entitlement rules govern it (20261102191900).
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_host AND coalesce(c.is_platform, false)) THEN RETURN NULL; END IF;
  IF v_phase IN ('draining','executing') THEN
    -- The operation itself writes memberships (departures) under its own flag.
    IF coalesce(current_setting('app.horse_club_split_operation', true), '') <> '' THEN RETURN NULL; END IF;
    RETURN 'HORSE_CLUB_SPLIT_IN_PROGRESS: Horses Are Paused While Their Clubs Are Reassigned';
  END IF;
  v_home := public.fn_ca_horse_assigned_club(p_horse);
  IF v_home IS NULL THEN
    RETURN 'HORSE_HAS_NO_ASSIGNED_CLUB: This Horse Is Not On The Club Manifest';
  END IF;
  IF p_host = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid THEN
    RETURN 'HORSE_NOT_ADMITTED_TO_KINGS_CLUB: Kings Club Has No Horses';
  END IF;
  IF p_membership THEN
    IF p_host IS DISTINCT FROM v_home THEN
      RETURN 'HORSE_ONE_CLUB_ONLY: A Horse Belongs Only To Its Assigned Club';
    END IF;
  ELSIF p_host IS DISTINCT FROM v_home
     AND NOT EXISTS (SELECT 1 FROM public.clubs u
                       JOIN public.union_clubs uc ON uc.union_id = u.union_id AND uc.club_id = v_home
                      WHERE u.id = p_host AND coalesce(u.is_union, false)) THEN
    RETURN 'HORSE_ONE_CLUB_ONLY: A Horse Plays Only In Its Assigned Club Or Its Union';
  END IF;
  IF p_wallet IS NOT NULL AND p_wallet IS DISTINCT FROM v_home THEN
    RETURN 'HORSE_ONE_CLUB_ONLY: A Horse Is Funded Only From Its Assigned Club';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_reject_automated_user_club_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id uuid;
  v_user_id uuid;
  v_automated boolean := false;
  v_is_horse boolean := false;
  v_refusal text;
  v_tournament_seat boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'club_members' THEN
    v_club_id := NEW.club_id;
    v_user_id := NEW.user_id;
    v_automated := COALESCE(NEW.is_bot, false);
  ELSIF TG_TABLE_NAME = 'agents' THEN
    v_club_id := NEW.club_id;
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'table_seats' THEN
    -- A historical/departed seat remains immutable evidence. Only a live seat
    -- can put an automated player back onto a user-created club table.
    IF NEW.left_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT t.club_id, t.tournament_id IS NOT NULL INTO v_club_id, v_tournament_seat FROM public.tables t WHERE t.id = NEW.table_id;
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'tournament_players' THEN
    SELECT t.club_id INTO v_club_id
      FROM public.tournaments t WHERE t.id = NEW.tournament_id;
    v_user_id := NEW.user_id;
  ELSE
    RAISE EXCEPTION 'Unsupported Automated-Club Guard Table: %', TG_TABLE_NAME;
  END IF;

  v_is_horse := COALESCE(
    (SELECT p.is_horse FROM public.profiles p WHERE p.id = v_user_id), false
  );
  v_automated := v_automated OR v_is_horse;

  IF v_automated AND NOT public.fn_ca_house_board_allows_automation(v_club_id) THEN
    RAISE EXCEPTION 'AUTOMATED_PLAYER_HOUSE_BOARD_ONLY: Automated Players Cannot Enter A User-Created Club'
      USING ERRCODE = '42501';
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229). Agents rows follow
  -- their membership; a departed membership update (lifecycle) is judged by
  -- fn_guard_membership_lifecycle_write instead.
  -- A tournament seat belongs to an entry that was admitted when it was made;
  -- the event seats, moves and re-seats it in any phase (20261102191900).
  IF v_is_horse AND TG_TABLE_NAME <> 'agents' AND NOT v_tournament_seat THEN
    v_refusal := public.fn_ca_horse_club_refusal(
      v_user_id, v_club_id,
      CASE WHEN TG_TABLE_NAME = 'tournament_players' THEN NEW.club_id END,
      TG_TABLE_NAME = 'club_members');
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_stamp_seat_club()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_refusal text;
BEGIN
  -- A SEAT KEEPS THE CLUB IT WAS SEATED UNDER (2026-09-10). Nothing that the
  -- stamp is derived from changed, and the seat already carries a club, so
  -- there is nothing to derive. This was 6.0 ms of club_members lookups on
  -- every stack write; see the migration header.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id
     AND NEW.club_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT NULL AND NEW.table_id IS NOT NULL THEN
    NEW.club_id := COALESCE(
      public.fn_seat_club_for_user(NEW.user_id, NEW.table_id, NEW.club_id),
      NEW.club_id
    );
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229): a live horse seat is
  -- funded only from the horse's assigned club, whatever routed it here.
  IF NEW.left_at IS NULL AND NEW.user_id IS NOT NULL
     AND public.fn_ca_horse_split_phase() <> 'inactive'
     -- A tournament seat is its entry's; only cash seats are judged here (20261102191900).
     AND NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.id = NEW.table_id AND t.tournament_id IS NOT NULL)
     AND COALESCE((SELECT p.is_horse FROM public.profiles p WHERE p.id = NEW.user_id), false) THEN
    v_refusal := public.fn_ca_horse_club_refusal(
      NEW.user_id, (SELECT t.club_id FROM public.tables t WHERE t.id = NEW.table_id), NEW.club_id, false);
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_split_preflight()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_week_end timestamptz := '2026-11-02 08:00:00+00';
  v_n bigint;
  v_owed jsonb;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;

  -- The week's rakeback must be paid first, and nothing of it still owed.
  IF NOT EXISTS (SELECT 1 FROM public.weekly_accounting_payout_pauses p
                  WHERE p.period_end = v_week_end AND p.phase = 'released'
                    AND coalesce(p.result->>'success','') = 'true') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','weekly_payout_not_released','period_end',v_week_end));
  END IF;
  BEGIN
    v_owed := smarter_private.weekly_payout_scope_plan(v_week_end, now());
  EXCEPTION WHEN OTHERS THEN
    v_owed := jsonb_build_array(jsonb_build_object('error', SQLERRM));
  END;
  IF jsonb_array_length(coalesce(v_owed,'[]'::jsonb)) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','weekly_payout_scopes_still_owed','owed',v_owed));
  END IF;

  IF EXISTS (SELECT 1 FROM public.ca_horse_fleet_policy f WHERE f.scope='global' AND coalesce(f.enabled,true)) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_fleet_enabled'));
  END IF;

  SELECT count(*) INTO v_n FROM public.table_seats ts JOIN public.profiles p ON p.id=ts.user_id AND p.is_horse
    JOIN public.tables t ON t.id = ts.table_id
   WHERE ts.left_at IS NULL AND t.tournament_id IS NULL;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_live_cash_seats','count',v_n)); END IF;

  -- Tournament entries no longer block (20261102191900): a membership an open entry is
  -- paid from is swept now and departs when its events finish (stage settling).
  SELECT count(*) INTO v_n FROM public.tournament_players tp JOIN public.profiles p ON p.id=tp.user_id AND p.is_horse
    JOIN public.tournaments t ON t.id=tp.tournament_id
   WHERE lower(coalesce(tp.status::text,'')) IN ('registered','playing')
     AND upper(coalesce(t.status::text,'')) NOT IN ('COMPLETED','CANCELLED');

  SELECT count(*) INTO v_n FROM public.cashout_requests cr JOIN public.profiles p ON p.id=cr.player_id AND p.is_horse
   WHERE cr.status IN ('pending','approved');
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_cashouts','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.chip_escrow_holds h JOIN public.profiles p ON p.id=h.user_id AND p.is_horse
   WHERE h.status='held';
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_escrow','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.tournament_tickets tt JOIN public.profiles p ON p.id=tt.holder_id AND p.is_horse
   WHERE tt.status='issued';
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_tickets','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.club_members cm JOIN public.profiles p ON p.id=cm.user_id AND p.is_horse
   WHERE abs(coalesce(cm.held_chips,0))+abs(coalesce(cm.locked_chips,0))+abs(coalesce(cm.promo_balance,0))
        +abs(coalesce(cm.credit_used,0))+abs(coalesce(cm.diamonds,0)) <> 0;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_unreconciled_member_balances','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.agents a JOIN public.profiles p ON p.id=a.user_id AND p.is_horse
   WHERE abs(coalesce(a.player_wallet_balance,0))+abs(coalesce(a.player_balance,0))+abs(coalesce(a.promo_balance,0))
        +abs(coalesce(a.credit_used,0)) <> 0;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_unreconciled_agent_balances','count',v_n)); END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers,
    'open_horse_tournament_entries', v_n,
    'phase', public.fn_ca_horse_split_phase(), 'checked_at', clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_split_wallet_leg(
  p_op uuid, p_kind text, p_club uuid, p_horse uuid, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_key uuid := public.fn_ca_horse_split_op_key(p_op, p_kind, p_club, p_horse);
  v_bank_before numeric; v_bank_after numeric; v_before numeric; v_after numeric; v_agent uuid;
  v_type text; v_reason text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts r
              WHERE r.operation_id = p_op AND r.horse_id = p_horse AND r.club_id = p_club AND r.kind = p_kind) THEN
    RETURN jsonb_build_object('replayed', true);
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('skipped', true); END IF;

  SELECT coalesce(c.chip_treasury,0) INTO v_bank_before FROM public.clubs c WHERE c.id = p_club FOR UPDATE;
  IF v_bank_before IS NULL THEN RAISE EXCEPTION 'horse_split_club_missing %', p_club; END IF;

  IF p_kind IN ('player_wallet_claim', 'settle_wallet_claim') THEN
    v_type := 'club_bank_claim'; v_reason := 'Horse Club Split: Wallet Returned To The Club Bank (Dan, 2026-11-02)';
    SELECT coalesce(cm.chip_balance,0) INTO v_before FROM public.club_members cm
     WHERE cm.club_id = p_club AND cm.user_id = p_horse FOR UPDATE;
    IF v_before < p_amount THEN RAISE EXCEPTION 'horse_split_wallet_short % % % %', p_club, p_horse, v_before, p_amount; END IF;
    PERFORM public.fn_ca_declare_ledger('club_bank_claim', 'club_treasury', p_club, NULL,
      'club_bank_claim:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    UPDATE public.club_members SET chip_balance = coalesce(chip_balance,0) - p_amount, updated_at = now()
     WHERE club_id = p_club AND user_id = p_horse RETURNING chip_balance INTO v_after;
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury,0) + p_amount, updated_at = now()
     WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
  ELSIF p_kind = 'agent_wallet_claim' THEN
    v_type := 'club_bank_claim'; v_reason := 'Horse Club Split: Agent Wallet Returned To The Club Bank (Dan, 2026-11-02)';
    SELECT a.id, coalesce(a.agent_wallet_balance,0) INTO v_agent, v_before FROM public.agents a
     WHERE a.club_id = p_club AND a.user_id = p_horse FOR UPDATE;
    IF v_agent IS NULL OR v_before < p_amount THEN RAISE EXCEPTION 'horse_split_agent_wallet_short % %', p_club, p_horse; END IF;
    PERFORM public.fn_ca_declare_ledger('club_bank_claim', 'club_treasury', p_club, NULL,
      'club_bank_claim:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    UPDATE public.agents SET agent_wallet_balance = coalesce(agent_wallet_balance,0) - p_amount, updated_at = now()
     WHERE id = v_agent RETURNING agent_wallet_balance INTO v_after;
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury,0) + p_amount, updated_at = now()
     WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
  ELSIF p_kind = 'fund_10000' THEN
    v_type := 'club_bank_send'; v_reason := 'Horse Club Split: Restart At 10,000 (Dan, 2026-11-02)';
    IF v_bank_before < p_amount THEN RAISE EXCEPTION 'horse_split_bank_short % % %', p_club, v_bank_before, p_amount; END IF;
    SELECT coalesce(cm.chip_balance,0) INTO v_before FROM public.club_members cm
     WHERE cm.club_id = p_club AND cm.user_id = p_horse FOR UPDATE;
    PERFORM public.fn_ca_declare_ledger('club_bank_send', 'club_treasury', p_club, NULL,
      'club_bank_send:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury,0) - p_amount, updated_at = now()
     WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
    UPDATE public.club_members SET chip_balance = coalesce(chip_balance,0) + p_amount, updated_at = now()
     WHERE club_id = p_club AND user_id = p_horse RETURNING chip_balance INTO v_after;
  ELSE
    RAISE EXCEPTION 'horse_split_unknown_leg %', p_kind;
  END IF;
  PERFORM set_config('app.ledger_autoskip_clubs', '', true);

  INSERT INTO public.chip_transactions(club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
  VALUES (p_club,
          CASE WHEN v_type = 'club_bank_claim' THEN p_horse END,
          CASE WHEN v_type = 'club_bank_send' THEN p_horse END,
          p_amount, v_type, v_reason,
          jsonb_build_object('op_id', v_key, 'operation', 'horse-club-split-20261102', 'operation_id', p_op,
            'leg', p_kind, 'actor', 'horse_club_split_operation',
            'source', CASE WHEN p_kind='agent_wallet_claim' THEN 'agent_wallet' WHEN p_kind IN ('player_wallet_claim','settle_wallet_claim') THEN 'player_wallet' ELSE 'club_bank' END,
            'destination', CASE WHEN v_type='club_bank_send' THEN 'player_wallet' ELSE 'club_bank' END,
            'bank_before', v_bank_before, 'bank_after', v_bank_after,
            'holder_balance_before', v_before, 'holder_balance_after', v_after),
          v_bank_after);

  INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, amount,
    wallet_before, wallet_after, bank_before, bank_after, op_key)
  VALUES (p_op, p_horse, p_club, p_kind, p_amount, v_before, v_after, v_bank_before, v_bank_after, v_key);
  RETURN jsonb_build_object('amount', p_amount, 'bank_after', v_bank_after, 'wallet_after', v_after);
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_split_execute(p_operation uuid, p_max_rows integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  c_dss constant uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
  c_felt constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_kings constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  v_op public.ca_horse_club_split_operations%ROWTYPE;
  v_pre jsonb; r record; v_done integer := 0; v_need numeric; v_have numeric; v_short numeric;
  v_mint jsonb; v_summary jsonb; v_changed integer; v_minted numeric := 0;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_op FROM public.ca_horse_club_split_operations WHERE operation_id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'horse_club_split_unknown_operation' USING ERRCODE='22023'; END IF;
  IF v_op.stage = 'complete' THEN RETURN jsonb_build_object('stage','complete','replayed',true,'summary',v_op.summary); END IF;
  PERFORM set_config('app.horse_club_split_operation', p_operation::text, true);

  IF v_op.stage = 'draining' THEN
    v_pre := public.fn_ca_horse_club_split_preflight();
    UPDATE public.ca_horse_club_split_operations SET preflight = v_pre WHERE operation_id = p_operation;
    IF NOT (v_pre->>'ready')::boolean THEN
      RETURN jsonb_build_object('stage','draining','advanced',false,'preflight',v_pre);
    END IF;
    UPDATE public.ca_horse_club_split_state SET phase='executing', changed_at=clock_timestamp() WHERE singleton;
    UPDATE public.ca_horse_club_split_operations SET stage='sweeping' WHERE operation_id = p_operation;
    v_op.stage := 'sweeping';
  END IF;

  IF v_op.stage = 'sweeping' THEN
    -- Every horse membership row: claim the player wallet into ITS club's bank;
    -- in a club the horse leaves, also claim the agent wallet and depart it.
    FOR r IN
      SELECT cm.club_id, cm.user_id AS horse_id, coalesce(cm.chip_balance,0) AS wallet,
             public.fn_ca_horse_assigned_club(cm.user_id) AS home,
             cm.membership_lifecycle_status AS lifecycle,
             (SELECT coalesce(a.agent_wallet_balance,0) FROM public.agents a
               WHERE a.club_id = cm.club_id AND a.user_id = cm.user_id) AS agent_wallet
        FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
       WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts x
                          WHERE x.operation_id = p_operation AND x.horse_id = cm.user_id AND x.club_id = cm.club_id
                            AND x.kind IN ('departed','player_wallet_claim','deferred'))
         AND (coalesce(cm.chip_balance,0) > 0
              OR (cm.membership_lifecycle_status = 'active'
                  AND cm.club_id IS DISTINCT FROM public.fn_ca_horse_assigned_club(cm.user_id)))
       ORDER BY cm.club_id, cm.user_id
       LIMIT p_max_rows
    LOOP
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'player_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      IF r.club_id IS DISTINCT FROM r.home AND r.lifecycle = 'active' AND EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id
                         LEFT JOIN public.clubs h ON h.id = t.club_id
                        WHERE tp.user_id = r.horse_id AND tp.club_id = r.club_id
                          AND lower(coalesce(tp.status::text,'')) IN ('registered','playing')
                          AND upper(coalesce(t.status::text,'')) NOT IN ('COMPLETED','CANCELLED')
                          AND NOT coalesce(h.is_platform, false)) THEN
        -- An open entry is still paid from this membership: it departs when its
        -- events finish (stage settling, 20261102191900).
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'deferred', jsonb_build_object('assigned_club', r.home))
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
      ELSIF r.club_id IS DISTINCT FROM r.home AND r.lifecycle = 'active' THEN
        IF coalesce(r.agent_wallet,0) > 0 THEN
          PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'agent_wallet_claim', r.club_id, r.horse_id, r.agent_wallet);
        END IF;
        -- Horses below a departing horse agent go direct to the club.
        WITH released AS (
          UPDATE public.club_members d
             SET agent_id = CASE WHEN d.agent_id = r.horse_id THEN NULL ELSE d.agent_id END,
                 parent_agent_id = CASE WHEN d.parent_agent_id = r.horse_id THEN NULL ELSE d.parent_agent_id END,
                 updated_at = clock_timestamp()
           WHERE d.club_id = r.club_id AND d.user_id <> r.horse_id
             AND d.membership_lifecycle_status = 'active'
             AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)
             AND EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = d.user_id AND hp.is_horse)
          RETURNING d.user_id)
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        SELECT p_operation, x.user_id, r.club_id, 'downline_released', jsonb_build_object('former_agent', r.horse_id)
          FROM released x
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
        IF EXISTS (SELECT 1 FROM public.club_members d JOIN public.profiles hp ON hp.id = d.user_id AND NOT coalesce(hp.is_horse,false)
                    WHERE d.club_id = r.club_id AND d.membership_lifecycle_status = 'active' AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)) THEN
          RAISE EXCEPTION 'horse_split_human_downline % %', r.club_id, r.horse_id;
        END IF;
        UPDATE public.agents SET status = 'suspended', updated_at = clock_timestamp()
         WHERE club_id = r.club_id AND user_id = r.horse_id AND status IS DISTINCT FROM 'suspended';
        PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
        UPDATE public.club_members cm
           SET status = 'suspended', is_active = false, membership_lifecycle_status = 'departed',
               departed_at = clock_timestamp(), departed_by = NULL,
               departure_reason = 'Horse Club Split (Dan, 2026-11-02)', updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id AND cm.membership_lifecycle_status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
        IF v_changed <> 1 THEN RAISE EXCEPTION 'horse_split_membership_changed % %', r.club_id, r.horse_id; END IF;
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'departed', jsonb_build_object('assigned_club', r.home));
      END IF;
      v_done := v_done + 1;
    END LOOP;
    IF v_done >= p_max_rows THEN
      RETURN jsonb_build_object('stage','sweeping','advanced',true,'rows',v_done,'more',true);
    END IF;
    -- A manifest horse without an active membership in its assigned club joins
    -- it now (22 on 2026-11-02: 18 Felt-only horses moved to Deep Stack and 4
    -- held no Deep Stack or Felt membership). Same source the join door uses;
    -- a horse membership starts at zero and is funded below.
    FOR r IN SELECT a.horse_id, a.club_id,
                    (SELECT cm.membership_lifecycle_status FROM public.club_members cm
                      WHERE cm.user_id = a.horse_id AND cm.club_id = a.club_id) AS lifecycle
               FROM public.ca_horse_club_assignments a
              WHERE NOT EXISTS (SELECT 1 FROM public.club_members cm
                                 WHERE cm.user_id = a.horse_id AND cm.club_id = a.club_id
                                   AND cm.membership_lifecycle_status = 'active'
                                   AND coalesce(cm.status,'active') IN ('active','approved')) LOOP
      IF r.lifecycle IS NULL THEN
        PERFORM set_config('app.club_membership_source', 'join_club', true);
        INSERT INTO public.club_members(club_id, user_id, role, status, is_active, is_bot, chip_balance, membership_lifecycle_status)
        VALUES (r.club_id, r.horse_id, 'player', 'active', true, true, 0, 'active');
        PERFORM set_config('app.club_membership_source', '', true);
      ELSE
        PERFORM set_config('app.club_membership_lifecycle_write', 'rejoin', true);
        UPDATE public.club_members cm
           SET status = 'active', is_active = true, membership_lifecycle_status = 'active',
               departed_at = NULL, departed_by = NULL, departure_reason = NULL, updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
      END IF;
      INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
      VALUES (p_operation, r.horse_id, r.club_id, 'joined', jsonb_build_object('previous_lifecycle', r.lifecycle))
      ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
    END LOOP;
    UPDATE public.ca_horse_club_split_operations SET stage='minting' WHERE operation_id = p_operation;
    v_op.stage := 'minting';
  END IF;

  IF v_op.stage = 'minting' THEN
    FOR r IN SELECT x.club_id, count(*) AS horses FROM public.ca_horse_club_assignments x GROUP BY x.club_id LOOP
      IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts m
                  WHERE m.operation_id = p_operation AND m.club_id = r.club_id AND m.kind = 'mint') THEN CONTINUE; END IF;
      v_need := r.horses * 10000 - coalesce((SELECT sum(f.amount) FROM public.ca_horse_club_split_receipts f
                  WHERE f.operation_id = p_operation AND f.club_id = r.club_id AND f.kind = 'fund_10000'), 0);
      SELECT coalesce(c.chip_treasury,0) INTO v_have FROM public.clubs c WHERE c.id = r.club_id FOR UPDATE;
      v_short := greatest(0, v_need - v_have);
      IF v_short > 0 THEN
        IF v_minted + v_short > v_op.mint_cap THEN
          RAISE EXCEPTION 'horse_split_mint_exceeds_authorized_cap club % short % cap %', r.club_id, v_short, v_op.mint_cap;
        END IF;
        -- The Mint takes only the service identity; this body is reachable only
        -- by a trusted caller (fn_caller_is_engine above).
        PERFORM set_config('request.jwt.claim.role', 'service_role', true);
        v_mint := public.fn_ca_mint('chips', 'club', r.club_id, round(v_short, 2),
          'Horse Club Split: Shortfall To Restart Every Assigned Horse At 10,000 (Dan, 2026-11-02)',
          'horse-club-split:' || p_operation::text || ':mint:' || r.club_id::text, 'admin');
        IF coalesce((v_mint->>'ok')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'horse_split_mint_refused %', v_mint;
        END IF;
        v_minted := v_minted + v_short;
      END IF;
      INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, amount, bank_before, bank_after, detail)
      VALUES (p_operation, NULL, r.club_id, 'mint', v_short, v_have, v_have + v_short,
              jsonb_build_object('needed', v_need, 'mint', coalesce(v_mint, '{}'::jsonb)));
    END LOOP;
    UPDATE public.ca_horse_club_split_operations SET stage='funding' WHERE operation_id = p_operation;
    v_op.stage := 'funding';
  END IF;

  IF v_op.stage = 'funding' THEN
    v_done := 0;
    FOR r IN SELECT a.horse_id, a.club_id, coalesce(cm.chip_balance,0) AS wallet
               FROM public.ca_horse_club_assignments a
               JOIN public.club_members cm ON cm.user_id = a.horse_id AND cm.club_id = a.club_id
              WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts f
                                 WHERE f.operation_id = p_operation AND f.horse_id = a.horse_id
                                   AND f.club_id = a.club_id AND f.kind = 'fund_10000')
              ORDER BY a.club_id, a.horse_id LIMIT p_max_rows LOOP
      -- Chips that reached the assigned wallet after its sweep (a running event
      -- paying out) go to the bank first, so every horse restarts at exactly
      -- 10,000 (20261102191900).
      IF r.wallet < 0 THEN RAISE EXCEPTION 'horse_split_negative_wallet % %', r.horse_id, r.wallet; END IF;
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'settle_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'fund_10000', r.club_id, r.horse_id, 10000);
      v_done := v_done + 1;
    END LOOP;
    IF v_done >= p_max_rows THEN
      RETURN jsonb_build_object('stage','funding','advanced',true,'rows',v_done,'more',true);
    END IF;
    UPDATE public.ca_horse_club_split_operations SET stage='enforcing' WHERE operation_id = p_operation;
    v_op.stage := 'enforcing';
  END IF;

  IF v_op.stage = 'enforcing' THEN
    -- Every assigned horse was funded from zero to exactly 10,000 (20261102191900).
    IF EXISTS (SELECT 1 FROM public.ca_horse_club_assignments a
                WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts f
                                   WHERE f.operation_id = p_operation AND f.horse_id = a.horse_id AND f.club_id = a.club_id
                                     AND f.kind = 'fund_10000' AND f.wallet_before = 0 AND f.wallet_after = 10000)) THEN
      RAISE EXCEPTION 'horse_split_assigned_horse_not_funded_to_10000';
    END IF;
    SELECT jsonb_build_object(
      'deep_stack', count(*) FILTER (WHERE cm.club_id = c_dss AND a.club_id = c_dss),
      'felt', count(*) FILTER (WHERE cm.club_id = c_felt AND a.club_id = c_felt))
      INTO v_summary
      FROM public.club_members cm JOIN public.ca_horse_club_assignments a ON a.horse_id = cm.user_id
     WHERE cm.membership_lifecycle_status = 'active';
    IF (v_summary->>'deep_stack')::int <> 500 OR (v_summary->>'felt')::int <> 500 THEN
      RAISE EXCEPTION 'horse_split_assignment_state_wrong %', v_summary;
    END IF;
    UPDATE public.ca_horse_club_split_state SET phase='enforcing', changed_at=clock_timestamp() WHERE singleton;
    UPDATE public.ca_horse_club_split_operations SET stage='settling' WHERE operation_id = p_operation;
    v_op.stage := 'settling';
  END IF;

  IF v_op.stage = 'settling' THEN
    -- Memberships deferred for an open entry depart once their events finish (20261102191900).
    v_done := 0;
    FOR r IN
      SELECT cm.club_id, cm.user_id AS horse_id, coalesce(cm.chip_balance,0) AS wallet,
             public.fn_ca_horse_assigned_club(cm.user_id) AS home,
             (SELECT coalesce(ag.agent_wallet_balance,0) FROM public.agents ag
               WHERE ag.club_id = cm.club_id AND ag.user_id = cm.user_id) AS agent_wallet
        FROM public.ca_horse_club_split_receipts d
        JOIN public.club_members cm ON cm.user_id = d.horse_id AND cm.club_id = d.club_id
       WHERE d.operation_id = p_operation AND d.kind = 'deferred'
         AND cm.membership_lifecycle_status = 'active'
       ORDER BY cm.club_id, cm.user_id
       LIMIT p_max_rows
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.tournament_players tp JOIN public.tournaments t ON t.id = tp.tournament_id
                         LEFT JOIN public.clubs h ON h.id = t.club_id
                        WHERE tp.user_id = r.horse_id AND tp.club_id = r.club_id
                          AND lower(coalesce(tp.status::text,'')) IN ('registered','playing')
                          AND upper(coalesce(t.status::text,'')) NOT IN ('COMPLETED','CANCELLED')
                          AND NOT coalesce(h.is_platform, false));
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'settle_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      IF coalesce(r.agent_wallet,0) > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'agent_wallet_claim', r.club_id, r.horse_id, r.agent_wallet);
      END IF;
        -- Horses below a departing horse agent go direct to the club.
        WITH released AS (
          UPDATE public.club_members d
             SET agent_id = CASE WHEN d.agent_id = r.horse_id THEN NULL ELSE d.agent_id END,
                 parent_agent_id = CASE WHEN d.parent_agent_id = r.horse_id THEN NULL ELSE d.parent_agent_id END,
                 updated_at = clock_timestamp()
           WHERE d.club_id = r.club_id AND d.user_id <> r.horse_id
             AND d.membership_lifecycle_status = 'active'
             AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)
             AND EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = d.user_id AND hp.is_horse)
          RETURNING d.user_id)
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        SELECT p_operation, x.user_id, r.club_id, 'downline_released', jsonb_build_object('former_agent', r.horse_id)
          FROM released x
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
        IF EXISTS (SELECT 1 FROM public.club_members d JOIN public.profiles hp ON hp.id = d.user_id AND NOT coalesce(hp.is_horse,false)
                    WHERE d.club_id = r.club_id AND d.membership_lifecycle_status = 'active' AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)) THEN
          RAISE EXCEPTION 'horse_split_human_downline % %', r.club_id, r.horse_id;
        END IF;
        UPDATE public.agents SET status = 'suspended', updated_at = clock_timestamp()
         WHERE club_id = r.club_id AND user_id = r.horse_id AND status IS DISTINCT FROM 'suspended';
        PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
        UPDATE public.club_members cm
           SET status = 'suspended', is_active = false, membership_lifecycle_status = 'departed',
               departed_at = clock_timestamp(), departed_by = NULL,
               departure_reason = 'Horse Club Split (Dan, 2026-11-02)', updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id AND cm.membership_lifecycle_status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
        IF v_changed <> 1 THEN RAISE EXCEPTION 'horse_split_membership_changed % %', r.club_id, r.horse_id; END IF;
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'departed', jsonb_build_object('assigned_club', r.home));
      v_done := v_done + 1;
    END LOOP;
    SELECT count(*) INTO v_changed
      FROM public.ca_horse_club_split_receipts d
      JOIN public.club_members cm ON cm.user_id = d.horse_id AND cm.club_id = d.club_id
     WHERE d.operation_id = p_operation AND d.kind = 'deferred' AND cm.membership_lifecycle_status = 'active';
    IF v_changed > 0 THEN
      RETURN jsonb_build_object('stage','settling','departed_now',v_done,'still_deferred',v_changed);
    END IF;
    SELECT jsonb_build_object(
      'deep_stack', count(*) FILTER (WHERE cm.club_id = c_dss),
      'felt', count(*) FILTER (WHERE cm.club_id = c_felt),
      'kings', count(*) FILTER (WHERE cm.club_id = c_kings),
      'other_active_horse_memberships', count(*) FILTER (WHERE cm.club_id NOT IN (c_dss, c_felt)))
      INTO v_summary
      FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
      LEFT JOIN public.clubs h ON h.id = cm.club_id
     WHERE cm.membership_lifecycle_status = 'active' AND NOT coalesce(h.is_platform, false);
    IF (v_summary->>'deep_stack')::int <> 500 OR (v_summary->>'felt')::int <> 500
       OR (v_summary->>'kings')::int <> 0 OR (v_summary->>'other_active_horse_memberships')::int <> 0 THEN
      RAISE EXCEPTION 'horse_split_final_state_wrong %', v_summary;
    END IF;
    v_summary := v_summary || jsonb_build_object(
      'minted', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='mint'),
      'claimed_player', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind IN ('player_wallet_claim','settle_wallet_claim')),
      'claimed_agent', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='agent_wallet_claim'),
      'funded', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='fund_10000'),
      'departed', (SELECT count(*) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='departed'),
      'manifest_sha256', '22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270');
    UPDATE public.ca_horse_club_split_operations
       SET stage='complete', completed_at=clock_timestamp(), summary=v_summary WHERE operation_id = p_operation;
    RETURN jsonb_build_object('stage','complete','summary',v_summary);
  END IF;
  RETURN jsonb_build_object('stage', v_op.stage);
END $$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_preflight() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_split_wallet_leg(uuid, text, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_execute(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_club_refusal(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
COMMIT;
