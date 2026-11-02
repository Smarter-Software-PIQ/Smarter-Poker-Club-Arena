-- Midway promo-funded bounty-only Free Buys. Owner instruction 2026-11-02.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_register_for_tournament_before_atomic_capacity_20260907') IS DISTINCT FROM 'e63be2814e7a32620b7e529d92d3c1c7' THEN RAISE EXCEPTION 'Inspected definition changed: fn_register_for_tournament_before_atomic_capacity_20260907'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_register_horse_for_tournament_before_maintenance_gate') IS DISTINCT FROM '058f765455a186b402b3a9a06a9a9b52' THEN RAISE EXCEPTION 'Inspected definition changed: fn_register_horse_for_tournament_before_maintenance_gate'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_process_tournament_chip_purchase_money_v1') IS DISTINCT FROM '30b96a6e6fe359d10e186c68a023c8fd' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_process_tournament_chip_purchase_money_v1'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_tournament_charge_split') IS DISTINCT FROM '26545c9dc6b043859f3090a915e5347a' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_tournament_charge_split'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_tournament_escrow_chips') IS DISTINCT FROM '255a830f5ecb4c6c1e7518fe33c4090c' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_tournament_escrow_chips'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_unregister_tournament_player_exact') IS DISTINCT FROM '2d7adf316b2651ce9df7530a4008e8c0' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_unregister_tournament_player_exact'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='atomic_cancel_tournament') IS DISTINCT FROM '68c722e9ffa162f8d9b3cef1f28b8b6d' THEN RAISE EXCEPTION 'Inspected definition changed: atomic_cancel_tournament'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_freerolls_are_free_buy') IS DISTINCT FROM '594e683b9c3d71deb209a3852c17b1de' THEN RAISE EXCEPTION 'Inspected definition changed: fn_freerolls_are_free_buy'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='trg_freeze_registered_tournament_settlement_contract') IS DISTINCT FROM 'caf4aedb5da06e764930e61d9ed7158e' THEN RAISE EXCEPTION 'Inspected definition changed: trg_freeze_registered_tournament_settlement_contract'; END IF; END $$;

DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_guard_managed_game_lifecycle') IS DISTINCT FROM '9427a9188600a598463e3cb1914cf5f6' THEN RAISE EXCEPTION 'Inspected definition changed: fn_guard_managed_game_lifecycle'; END IF; END $$;

-- One promo-funded initial head is journaled with its exact registration identity.
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_pko(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id
  AND (t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
       OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
  AND t.free_buy AND t.is_pko AND NOT coalesce(t.is_mystery_bounty,false)
  AND upper(t.tournament_type)='MTT' AND t.buy_in_amount=0 AND t.buy_in_fee=0
  AND t.bounty_amount=1 AND t.guaranteed_prize=0
  AND t.satellite_target_id IS NULL AND lower(coalesce(t.variant,''))<>'satellite');
$$;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_pko(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_midway_free_buy_pko(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head(
 p_tournament_id uuid,p_registration_id uuid,p_return boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 t public.tournaments%ROWTYPE;
 p public.tournament_players%ROWTYPE;
 funded public.chip_ledger%ROWTYPE;
 prior public.chip_ledger%ROWTYPE;
 k text;
 n integer;
 previous_skip text;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT public.fn_ca_midway_free_buy_pko(p_tournament_id) THEN RETURN 0; END IF;
 SELECT * INTO p FROM public.tournament_players
 WHERE id=p_registration_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Promo bounty requires its exact registration'; END IF;
 k:='tourney:'||p_tournament_id||':promo_head:'||p_registration_id;
 SELECT * INTO funded FROM public.chip_ledger WHERE idempotency_key=k;
 IF funded.id IS NOT NULL AND (funded.amount IS DISTINCT FROM 1 OR funded.category IS DISTINCT FROM 'promo_send'
   OR funded.from_type IS DISTINCT FROM 'union_wallet' OR funded.from_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
   OR funded.to_type IS DISTINCT FROM 'prize_liability' OR funded.to_entity_id IS DISTINCT FROM p_tournament_id
   OR funded.metadata->>'registration_id' IS DISTINCT FROM p_registration_id::text) THEN
   RAISE EXCEPTION 'Promo bounty funding identity conflict';
 END IF;
 IF p_return THEN
   IF funded.id IS NULL THEN RETURN 0; END IF;
   IF t.started_at IS NOT NULL OR upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING')
      OR coalesce(p.status,'') NOT IN ('registered','playing')
      OR p.current_bounty IS NULL OR p.current_bounty<1 THEN
     RAISE EXCEPTION 'A played bounty cannot be returned as an unplayed promotion';
   END IF;
   k:=k||':return';
   SELECT * INTO prior FROM public.chip_ledger WHERE idempotency_key=k;
   IF prior.id IS NOT NULL THEN
     IF prior.amount IS DISTINCT FROM 1 OR prior.from_entity_id IS DISTINCT FROM p_tournament_id
        OR prior.category IS DISTINCT FROM 'reversal' OR prior.from_type IS DISTINCT FROM 'prize_liability'
        OR prior.to_type IS DISTINCT FROM 'union_wallet'
        OR prior.to_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
        OR prior.metadata->>'funding_ledger_id' IS DISTINCT FROM funded.id::text THEN
       RAISE EXCEPTION 'Promo bounty return identity conflict';
     END IF;
     RETURN 0;
   END IF;
 ELSE
   IF funded.id IS NOT NULL THEN RETURN 0; END IF;
   IF upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING','RUNNING','BREAK') OR p.current_bounty IS DISTINCT FROM 1 THEN
     RAISE EXCEPTION 'Promo funding requires a newly registered one-chip head';
   END IF;
 END IF;
 -- Initialize before the new ledger leg, then update once after it. This
 -- avoids counting a first-seen leg both through shadow initialization and delta.
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head prelock');
 previous_skip:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET
   promo_wallet=promo_wallet+CASE WHEN p_return THEN 1 ELSE -1 END,updated_at=now()
 WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid
   AND (p_return OR promo_wallet>=1);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this entry'; END IF;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(previous_skip,''),true);
 INSERT INTO public.chip_ledger(
   performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
   amount,category,club_id,tournament_id,idempotency_key,description,metadata)
 VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),CASE WHEN p_return THEN 'prize_liability' ELSE 'union_wallet' END,
   CASE WHEN p_return THEN p_tournament_id ELSE 'fade0000-0000-0000-0000-000000000001'::uuid END,
   CASE WHEN p_return THEN 'tournament_escrow.bounty_balance' ELSE 'union_wallets.promo_wallet' END,
   CASE WHEN p_return THEN 'union_wallet' ELSE 'prize_liability' END,
   CASE WHEN p_return THEN 'fade0000-0000-0000-0000-000000000001'::uuid ELSE p_tournament_id END,
   CASE WHEN p_return THEN 'union_wallets.promo_wallet' ELSE 'tournament_escrow.bounty_balance' END,
   1,CASE WHEN p_return THEN 'reversal' ELSE 'promo_send' END,t.club_id,p_tournament_id,k,
   CASE WHEN p_return THEN 'Unplayed Free Buy Bounty Returned To Midway Promo Funds'
        ELSE 'Midway Promo Funds Free Buy Initial Bounty' END,
   jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',p_registration_id,
     'user_id',p.user_id,'return',p_return,'funding_ledger_id',funded.id));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head',
   p_gross_in=>CASE WHEN p_return THEN -1 ELSE 1 END,
   p_bounty_in=>CASE WHEN p_return THEN -1 ELSE 1 END);
 IF p_return THEN
   UPDATE public.tournaments SET bounty_pool=bounty_pool-1 WHERE id=p_tournament_id AND bounty_pool>=1;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'Promo return exceeds funded bounty pool'; END IF;
 END IF;
 RETURN 1;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- The private conversion transaction is the sole exception to the registered
-- contract lock. It changes only this owner-authorized format, before play.
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_conversion_transition(o jsonb,n jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(
   current_setting('app.midway_free_buy_conversion',true)=o->>'id'
   AND current_setting('role',true) IN ('none','service_role')
   AND o->>'status' IN ('ANNOUNCED','REGISTERING') AND n->>'status'=o->>'status'
   AND o->>'started_at' IS NULL AND NOT coalesce((o->>'prize_pool_finalized')::boolean,false)
   AND (o->>'union_id'='fade0000-0000-0000-0000-000000000001'
        OR o->>'club_id'='fade0000-0000-0000-0000-000000000001')
   AND (o->>'free_buy')::boolean AND upper(o->>'tournament_type')='MTT'
   AND (o->>'buy_in_amount')::numeric=0 AND (o->>'buy_in_fee')::numeric=0
   AND NOT coalesce((o->>'is_pko')::boolean,false)
   AND n->>'satellite_target_id' IS NULL AND coalesce(n->>'variant','')<>'satellite'
   AND (n->>'is_pko')::boolean AND (n->>'is_bounty')::boolean
   AND NOT (n->>'is_mystery_bounty')::boolean
   AND (n->>'bounty_amount')::numeric=1 AND (n->>'guaranteed_prize')::numeric=0
   AND (n->>'is_rebuy')::boolean AND (n->>'is_reentry')::boolean
   AND (n->>'rebuy_cost')::numeric=1 AND NOT (n->>'add_on_available')::boolean
   AND NOT (n->>'addon_from_start')::boolean
   AND n->>'addon_cost' IS NULL AND n->>'addon_chips' IS NULL AND n->>'addon_levels' IS NULL
   AND (o-ARRAY['is_pko','is_bounty','is_mystery_bounty','bounty_amount','guaranteed_prize',
      'is_rebuy','is_reentry','rebuy_cost','add_on_available','addon_from_start','addon_cost',
      'addon_chips','addon_levels','short_description','updated_at'])
     = (n-ARRAY['is_pko','is_bounty','is_mystery_bounty','bounty_amount','guaranteed_prize',
      'is_rebuy','is_reentry','rebuy_cost','add_on_available','addon_from_start','addon_cost',
      'addon_chips','addon_levels','short_description','updated_at']),false);
$$;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_convert_midway_free_buy(p_tournament_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.tournaments%ROWTYPE; p record; n integer:=0; prior_context text; e public.tournament_escrow%ROWTYPE;
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
 SELECT * INTO STRICT t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF public.fn_ca_midway_free_buy_pko(t.id) THEN RETURN 0; END IF;
 IF ((t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
          OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
         AND t.free_buy AND upper(t.tournament_type)='MTT'
         AND t.buy_in_amount=0 AND t.buy_in_fee=0) IS NOT TRUE
    OR coalesce(t.status,'') NOT IN ('ANNOUNCED','REGISTERING') OR t.started_at IS NOT NULL
    OR coalesce(t.prize_pool_finalized,false) OR coalesce(t.is_bounty,false)
    OR coalesce(t.is_pko,false) OR coalesce(t.is_mystery_bounty,false)
    OR t.satellite_target_id IS NOT NULL OR lower(coalesce(t.variant,''))='satellite'
    OR coalesce(t.prize_pool,0)<>0 OR coalesce(t.bounty_pool,0)<>0
    OR coalesce(t.total_rake,0)<>0 THEN
   RAISE EXCEPTION 'Free Buy conversion requires an unplayed unfunded legacy event';
 END IF;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=t.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=t.id
   AND (status IS DISTINCT FROM 'registered' OR coalesce(rebuys,0)<>0 OR coalesce(add_on,false)
        OR coalesce(current_bounty,0)<>0 OR coalesce(bounty_winnings,0)<>0
        OR table_id IS NOT NULL OR eliminated_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'Free Buy conversion cannot change played or paid registrations';
 END IF;
 PERFORM public.fn_ca_escrow_apply(t.id,'Midway Free Buy conversion prelock');
 SELECT * INTO STRICT e FROM public.tournament_escrow WHERE tournament_id=t.id;
 IF coalesce(e.gross_in,0)<>0 OR coalesce(e.overlay_in,0)<>0 OR coalesce(e.satellite_in,0)<>0
    OR coalesce(e.prize_balance,0)<>0 OR coalesce(e.bounty_balance,0)<>0 OR coalesce(e.fee_balance,0)<>0 THEN
   RAISE EXCEPTION 'Free Buy conversion cannot reclassify existing money';
 END IF;
 prior_context:=current_setting('app.midway_free_buy_conversion',true);
 PERFORM set_config('app.midway_free_buy_conversion',t.id::text,true);
 UPDATE public.tournaments SET is_bounty=true,is_pko=true,is_mystery_bounty=false,
   bounty_amount=1,guaranteed_prize=0,is_rebuy=true,is_reentry=true,rebuy_cost=1,
   add_on_available=false,addon_from_start=false,addon_cost=NULL,addon_chips=NULL,addon_levels=NULL,
   short_description='Free Entry. Midway Promo Funds Your 1-Chip Bounty. 1-Chip Rebuys. No Add-Ons Or Rake. All Prizes Are Bounties: 50% To Your Wallet, 50% To Your Head. The Winner Keeps Their Bounty.'
 WHERE id=t.id;
 PERFORM set_config('app.midway_free_buy_conversion',coalesce(prior_context,''),true);
 FOR p IN SELECT id FROM public.tournament_players WHERE tournament_id=t.id ORDER BY id LOOP
   UPDATE public.tournament_players SET current_bounty=1 WHERE id=p.id;
   n:=n+public.fn_ca_midway_free_buy_promo_head(t.id,p.id,false)::integer;
 END LOOP;
 UPDATE public.tournaments SET bounty_pool=n WHERE id=t.id;
 IF n<>(SELECT count(*) FROM public.tournament_players WHERE tournament_id=t.id)
    OR n<>(SELECT bounty_balance FROM public.tournament_escrow WHERE tournament_id=t.id) THEN
   RAISE EXCEPTION 'Converted Free Buy does not have exactly one funded head per registration';
 END IF;
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_convert_midway_free_buy(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_register_for_tournament_before_atomic_capacity_20260907(p_tournament_id uuid, p_seat_first_internal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original_entitlement uuid; v_original_wallet uuid;
  v_uid uuid := auth.uid();
  v_unit integer := public.fn_ca_tournament_unit_cents(p_tournament_id);  -- DIAMOND PHASE 8
  v_dia jsonb;                                                              -- DIAMOND PHASE 8
  v_t record; v_username text;
  v_split record;
  v_is_bounty boolean; v_head numeric := 0;
  v_player_id uuid;
  v_late_open boolean := false; v_ok boolean;
  v_start_chips integer := 0;
  v_players_before integer;
  v_expected_cached_players integer;
  v_rows integer;
  v_seat jsonb := NULL;                                  -- LATE SEAT 2026-08-23
  v_seat_reason text;                                    -- SEAT FIX 2026-08-27
  v_led_cat text; v_led_cp text; v_led_ent text; v_led_tid text; -- CHIP STANDARD 1.2 2026-09-02
BEGIN
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_register_for_tournament requires an authenticated caller' USING ERRCODE = '28000';
  END IF;
  SELECT id, status, buy_in_amount, buy_in_fee, max_players, current_players,
         late_reg_levels, late_reg_mins, current_level, started_at, club_id, name, prize_pool_finalized,
         is_bounty, is_pko, is_mystery_bounty, bounty_amount,
         start_time, authorized_to_register, is_vip_only, early_bird_enabled, early_bird_chips,
         variant
    INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); END IF;

  -- SEAT-FIRST GUARD 2026-08-27, REBUILT 2026-08-28. A seat-first event is
  -- bought by taking a seat; registering into one debits the player for a
  -- seat that is never allocated. But the seat path ITSELF registers the
  -- player through this function, so the guard admits that caller via
  -- p_seat_first_internal - the original guard refused it too and no human
  -- could buy a Spin or Heads-Up seat at all. And the predicate is now the
  -- CANONICAL seat-first test (variant 'spin' OR a positive max_players <= 2), matching
  -- fn_take_seat_and_buy_in and fn_sync_seat_first_player_count: the original
  -- blocked ALL sngs, which left 6-max and 9-max SNGs with no entry path in
  -- either door.
  IF NOT p_seat_first_internal
     AND NOT public.fn_ca_tournament_is_unlimited(p_tournament_id)
     AND (lower(COALESCE(v_t.variant, '')) = 'spin'
       OR (v_t.max_players IS NOT NULL
         AND v_t.max_players > 0 AND v_t.max_players <= 2)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'seat_first_variant',
      'detail', 'This format is entered by taking a seat, not by registering. '
                || 'Call fn_take_seat_and_buy_in for the seat you want.',
      'variant', v_t.variant);
  END IF;

  IF v_t.status = 'RUNNING' THEN
    v_late_open:=public.fn_tournament_late_registration_open(p_tournament_id);
  END IF;
  IF v_t.status NOT IN ('ANNOUNCED', 'REGISTERING') AND NOT v_late_open THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed');
  END IF;
  SELECT count(*)::integer INTO v_players_before
    FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status::text IN ('registered','playing');
  IF v_t.current_players IS DISTINCT FROM v_players_before THEN
    RAISE EXCEPTION
      'Tournament roster cache diverged before registration (cached %, actual %)',
      v_t.current_players,v_players_before
      USING ERRCODE='P0404';
  END IF;
  IF NOT public.fn_ca_tournament_is_unlimited(p_tournament_id)
     AND v_t.max_players IS NOT NULL AND v_t.max_players > 0
     AND v_players_before >= v_t.max_players THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_full');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_players WHERE tournament_id = p_tournament_id AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END IF;

  -- PARITY GATE 1 (2026-08-22): owner-approved registration list.
  IF COALESCE(v_t.authorized_to_register, false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tournament_registration_approvals a
                    WHERE a.tournament_id = p_tournament_id AND a.user_id = v_uid)
       AND NOT public.is_club_admin(v_t.club_id, v_uid) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized_to_register');
    END IF;
  END IF;

  -- PARITY GATE 2 (2026-08-22): VIP-only events.
  IF COALESCE(v_t.is_vip_only, false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles pr
                    WHERE pr.id = v_uid AND COALESCE(pr.is_vip, false)
                      AND (pr.vip_expires_at IS NULL OR pr.vip_expires_at > now()))
       AND NOT EXISTS (SELECT 1 FROM public.club_members m
                        WHERE m.club_id = v_t.club_id AND m.user_id = v_uid
                          AND m.role IN ('owner', 'co_owner', 'admin', 'agent')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'vip_only');
    END IF;
  END IF;

  -- PARITY 3 (2026-08-22): early bird bonus chips for pre-start registration.
  IF COALESCE(v_t.early_bird_enabled, false)
     AND now() < v_t.start_time
     AND COALESCE(v_t.early_bird_chips, 0) > 0 THEN
    v_start_chips := v_t.early_bird_chips;
  END IF;

  SELECT COALESCE(NULLIF(display_name, ''), NULLIF(username, ''), 'Player')
    INTO v_username FROM public.profiles WHERE id = v_uid;

  v_is_bounty := COALESCE(v_t.is_bounty, false) OR COALESCE(v_t.is_pko, false)
                 OR COALESCE(v_t.is_mystery_bounty, false);

  SELECT * INTO v_split FROM public.fn_tournament_entry_split(
    v_t.buy_in_amount, v_t.buy_in_fee, v_t.bounty_amount, v_is_bounty);

  IF public.fn_ca_midway_free_buy_pko(p_tournament_id) THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;
  END IF;
  IF v_is_bounty AND v_split.prize < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'misconfigured_bounty',
      'detail', format('bounty %s + rake %s exceeds buy-in %s',
                       v_split.bounty, v_split.rake, v_split.charge));
  END IF;

  -- MYSTERY BOUNTY 2026-08-25: every bounty format puts the flat bounty on
  -- the head; the mystery value is drawn from a funded inventory at the
  -- knockout, not from a seeded PRNG at the till.
  IF v_is_bounty THEN
    v_head := v_split.bounty;
  END IF;

  IF v_split.charge > 0 AND v_unit = 100 THEN
    -- DIAMOND PHASE 8: a Diamond entry is custody, not a club-wallet debit. The
    -- roster row is written first so the custody row can name it; the whole
    -- transaction still rolls back together.
    IF v_split.charge <> trunc(v_split.charge) OR v_split.prize <> trunc(v_split.prize)
       OR v_split.rake <> trunc(v_split.rake) OR v_split.bounty <> trunc(v_split.bounty) THEN
      RAISE EXCEPTION 'diamond_tournament_requires_whole_amounts' USING ERRCODE = '23514';
    END IF;
    v_player_id := gen_random_uuid();
    BEGIN
      v_dia := public.fn_poker_diamond_tournament_charge(
        v_uid, p_tournament_id, 'entry', v_split.charge, v_split.prize, v_split.bounty, v_split.rake,
        v_player_id, 'poker-tournament-entry:' || p_tournament_id::text || ':' || v_uid::text || ':' || v_player_id::text);
    EXCEPTION WHEN OTHERS THEN
      -- DIAMOND PHASE 8: an ordinary refusal is answered the way the chip core
      -- answers one, with a reason the client can say; anything else is raised.
      IF SQLERRM LIKE '%insufficient_settled_diamonds%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_diamonds');
      ELSIF SQLERRM LIKE '%diamond_tournaments_not_open%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'diamond_tournaments_not_open');
      ELSIF SQLERRM LIKE '%diamond_debt_requires_settlement%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'diamond_debt_requires_settlement');
      ELSIF SQLERRM LIKE '%diamond_tournament_entry_already_held%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
      END IF;
      RAISE;
    END;
  ELSIF v_split.charge = 0 AND v_unit = 100 THEN
    -- 2026-10-06 (20261007000010): A DIAMOND FREEROLL ENTRY. Nothing is
    -- charged; the entry is an active custody row at zero, so the seat guards
    -- (P0810, P0812) admit the seat and a one-Diamond rebuy or add-on has an
    -- entry to land in. A horse enters through this same arm (CLAUDE.md 10.5).
    v_player_id := gen_random_uuid();
    BEGIN
      v_dia := public.fn_poker_diamond_tournament_free_entry(v_uid, p_tournament_id, v_player_id);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%diamond_tournaments_not_open%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'diamond_tournaments_not_open');
      ELSIF SQLERRM LIKE '%diamond_tournament_entry_already_held%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
      END IF;
      RAISE;
    END;
  ELSIF v_split.charge > 0 THEN
    -- CHIP STANDARD 1.2 (2026-09-02): THE REGISTRATION DEBIT NAMES ITS COUNTERPARTY.
    -- trg_club_members_audit_chip_movement journals the wallet write below; with no
    -- declaration it landed as adjustment player_wallet -> table_stack with no
    -- tournament_id (19,538 rows / 407,412.00 a day). Declared with set_config, not
    -- fn_ca_declare_ledger, so a vocabulary miss can never refuse a buy-in (the
    -- writer falls back to adjustment on its own). The whole charge (prize + bounty
    -- + fee) is ONE wallet write and so ONE row, booked against the tournament
    -- (prize_liability) that holds all three until it completes. The four settings
    -- are restored right after so nothing later in this transaction inherits them.
    v_led_cat := current_setting('app.ledger_category', true);
    v_led_cp  := current_setting('app.ledger_counterparty', true);
    v_led_ent := current_setting('app.ledger_counterparty_entity', true);
    v_led_tid := current_setting('app.ledger_tournament', true);
    PERFORM set_config('app.ledger_category', 'tournament_buyin', true);
    PERFORM set_config('app.ledger_counterparty', 'prize_liability', true);
    PERFORM set_config('app.ledger_counterparty_entity', p_tournament_id::text, true);
    PERFORM set_config('app.ledger_tournament', p_tournament_id::text, true);
    PERFORM set_config('app.pnl_tournament_entitlement','',true);
    v_ok := public.atomic_deduct_wallet_and_log(
      v_uid, v_split.charge, 'tournament_buyin',
      'Tournament buy-in: ' || COALESCE(v_t.name, 'tournament') ||
        CASE WHEN v_is_bounty
             THEN ' (' || v_split.prize || ' prize + ' || v_split.bounty || ' bounty + ' || v_split.rake || ' fee)'
             WHEN v_split.rake > 0
             THEN ' (' || v_split.prize || ' + ' || v_split.rake || ' fee)'
             ELSE '' END,
      NULL, NULL, p_tournament_id);
    v_original_entitlement:=NULLIF(current_setting('app.pnl_tournament_entitlement',true),'')::uuid;
    PERFORM set_config('app.ledger_category', COALESCE(v_led_cat, ''), true);
    PERFORM set_config('app.ledger_counterparty', COALESCE(v_led_cp, ''), true);
    PERFORM set_config('app.ledger_counterparty_entity', COALESCE(v_led_ent, ''), true);
    PERFORM set_config('app.ledger_tournament', COALESCE(v_led_tid, ''), true);
    IF NOT COALESCE(v_ok, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
    END IF;
    PERFORM public.log_wallet_transaction(
      v_uid, 'PLAYER', v_split.charge, 'debit', 'tournament_buyin',
      'Tournament buy-in: ' || COALESCE(v_t.name, 'tournament'),
      NULL, NULL, p_tournament_id);
    v_original_wallet:=NULLIF(current_setting('app.pnl_tournament_wallet_tx',true),'')::uuid;
  END IF;

  BEGIN
    IF v_dia IS NOT NULL THEN
      -- DIAMOND PHASE 8: the roster row carries the id the custody row was named with.
      -- DIAMOND PHASE 9: the head rides on the roster row as it does for a
      -- chip entry, so the roster trigger does not seed it a second time.
      INSERT INTO public.tournament_players
        (id, tournament_id, user_id, username, chips, status, current_bounty, mystery_bounty_value, bounties_collected, bounty_winnings)
      VALUES (v_player_id, p_tournament_id, v_uid, COALESCE(v_username,'Player'), v_start_chips, 'registered',
              v_head, 0, 0, 0)
      RETURNING id INTO v_player_id;
    ELSIF v_is_bounty THEN
      INSERT INTO public.tournament_players
        (tournament_id, user_id, username, chips, status, current_bounty, mystery_bounty_value, bounties_collected, bounty_winnings)
      VALUES (p_tournament_id, v_uid, COALESCE(v_username,'Player'), v_start_chips, 'registered', v_head, 0, 0, 0)
      RETURNING id INTO v_player_id;
    ELSE
      INSERT INTO public.tournament_players (tournament_id, user_id, username, chips, status)
      VALUES (p_tournament_id, v_uid, COALESCE(v_username,'Player'), v_start_chips, 'registered')
      RETURNING id INTO v_player_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'Tournament registration identity changed after its atomic debit; retry the complete transaction'
      USING ERRCODE = '55000';
  END;

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,v_player_id,false);
  IF v_split.rake > 0 AND v_t.club_id IS NOT NULL AND v_unit = 1 THEN
    -- DIAMOND PHASE 8: a Diamond fee stays in custody until the event settles;
    -- rake_records is the chip estate's fee rail.
    INSERT INTO public.rake_records
      (hand_id, table_id, club_id, rake_amount, pot_size, num_players, bbj_contribution,
       is_tournament, tournament_id, source, metadata)
    VALUES (NULL, NULL, v_t.club_id, v_split.rake, v_split.charge, 1, 0, true, p_tournament_id,
            'fn_register_for_tournament',
            jsonb_build_object('kind','tournament_entry_fee','user_id',v_uid,'registration_id',v_player_id));
  END IF;

  -- The roster trigger already writes the exact count while an event is
  -- ANNOUNCED/REGISTERING, but deliberately leaves RUNNING counts to the
  -- transaction that also seats the late entrant. Incrementing the cached
  -- value here therefore double-counted every pre-start entry. Require the
  -- exact state produced by that trigger (or the unchanged RUNNING state),
  -- then publish one roster-derived value together with the funded pools.
  v_expected_cached_players:=CASE
    WHEN v_t.status IN ('ANNOUNCED','REGISTERING') THEN v_players_before+1
    ELSE v_players_before
  END;
  UPDATE public.tournaments
     SET current_players = v_players_before + 1,
         prize_pool  = COALESCE(prize_pool, 0)  + v_split.prize,
         bounty_pool = COALESCE(bounty_pool, 0) + v_split.bounty,
         total_rake  = COALESCE(total_rake, 0)  + v_split.rake
   WHERE id = p_tournament_id
     AND current_players IS NOT DISTINCT FROM v_expected_cached_players;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION
      'Tournament roster cache changed during registration'
      USING ERRCODE='55000';
  END IF;

  -- LATE SEAT 2026-08-23
  IF v_late_open THEN
    v_seat := public.fn_seat_late_registrant(p_tournament_id, v_uid);

    -- SEAT FIX 2026-08-27: a late registrant who cannot be seated must not be
    -- charged; abort so debit, roster row, rake record and pool increments
    -- roll back together. 'already_seated_or_missing' is NOT a failure.
    v_seat_reason := v_seat->>'reason';
    IF NOT COALESCE((v_seat->>'ok')::boolean, false)
       AND COALESCE(v_seat_reason, '') <> 'already_seated_or_missing' THEN
      RAISE EXCEPTION
        'Late registration could not seat the player (%) - no charge has been made',
        COALESCE(v_seat_reason, 'unknown')
        USING ERRCODE = '55000';
    END IF;
  END IF;

  PERFORM public.fn_ca_record_tournament_participant_funding(v_player_id,'entry',NULL,
    v_split.charge,CASE WHEN v_unit=100 THEN 'diamonds' ELSE 'chips' END,
    v_original_entitlement,v_original_wallet,v_dia);

  RETURN jsonb_build_object('ok', true, 'registration_id', v_player_id,
    'cost', v_split.charge, 'prize_contribution', v_split.prize,
    'bounty_contribution', v_split.bounty, 'rake', v_split.rake,
    'bounty_head', CASE WHEN v_head > 0 THEN v_head END,
    'early_bird_chips', CASE WHEN v_start_chips > 0 THEN v_start_chips END,
    'late_registration', v_late_open,                    -- LATE SEAT 2026-08-23
    -- DIAMOND PHASE 8: the receipt names its asset and, for a Diamond entry,
    -- the wallet after the charge, so the client can move the balance it shows.
    'asset', CASE WHEN v_dia IS NOT NULL THEN 'diamonds' ELSE 'chips' END,
    'diamonds_after', CASE WHEN v_dia IS NOT NULL THEN (SELECT p.diamonds FROM public.profiles p WHERE p.id = v_uid) END,
    'seat', v_seat);                                     -- LATE SEAT 2026-08-23
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_register_horse_for_tournament_before_maintenance_gate(p_tournament_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_original_entitlement uuid; v_original_wallet uuid;
  -- 20261005224736 / A18 'own_balance' + CLAUDE.md 10.5: a Diamond entry is
  -- custody, exactly as it is for a person. The unit decides the asset, read
  -- from the same function the human door reads it from.
  v_unit integer := public.fn_ca_tournament_unit_cents(p_tournament_id);
  v_dia jsonb;
  v_t record; v_username text;
  v_split record;
  v_is_bounty boolean; v_head numeric := 0;
  v_player_id uuid;
  v_is_horse boolean;
  v_ok boolean;
  v_late_open boolean := false;
  v_start_chips integer := 0;
  v_players_before integer;
  v_expected_cached_players integer;
  v_rows integer;
  v_seat jsonb := NULL;
  v_seat_reason text;
  v_led_cat text; v_led_cp text; v_led_ent text; v_led_tid text; -- CHIP STANDARD 1.2 2026-09-02
BEGIN
  SELECT is_horse INTO v_is_horse FROM public.profiles WHERE id = p_user_id;
  IF NOT COALESCE(v_is_horse, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_horse');
  END IF;

  SELECT id, status, buy_in_amount, buy_in_fee, max_players, current_players,
         club_id, name, is_bounty, is_pko, is_mystery_bounty,
         bounty_amount, start_time, early_bird_enabled, early_bird_chips,
         prize_pool_finalized
    INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); END IF;

  -- THE HUMAN DOOR'S STATUS TEST (2026-09-11). A finalized pool takes no
  -- entrant and says so as a reason; a RUNNING event admits an entrant while
  -- its late registration is open, exactly as fn_register_for_tournament does.
  IF COALESCE(v_t.prize_pool_finalized, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed');
  END IF;
  IF v_t.status = 'RUNNING' THEN
    v_late_open := public.fn_tournament_late_registration_open(p_tournament_id);
  END IF;
  IF v_t.status NOT IN ('ANNOUNCED', 'REGISTERING') AND NOT v_late_open THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed');
  END IF;

  SELECT count(*)::integer INTO v_players_before
    FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status::text IN ('registered','playing');
  IF v_t.current_players IS DISTINCT FROM v_players_before THEN
    RAISE EXCEPTION
      'Tournament roster cache diverged before horse registration (cached %, actual %)',
      v_t.current_players,v_players_before
      USING ERRCODE='P0404';
  END IF;
  /* ONE DEFINITION OF FULL (2026-09-06). This read `current_players >=
     max_players`, and on a seat-first event that column is overwritten with
     the live SEATED count - so an emptied seat read as a vacancy and this
     function walked back through the door, up to 32 paid entries into a
     two-handed sit-and-go. fn_enforce_tournament_capacity is the authority
     and would now refuse the insert outright; asking here keeps the refusal a
     reason rather than an exception, and rolls back nothing. */
  IF public.fn_tournament_entry_cap_reached(p_tournament_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_full');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_players
              WHERE tournament_id = p_tournament_id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END IF;

  IF COALESCE(v_t.early_bird_enabled, false)
     AND now() < v_t.start_time
     AND COALESCE(v_t.early_bird_chips, 0) > 0 THEN
    v_start_chips := v_t.early_bird_chips;
  END IF;

  SELECT COALESCE(NULLIF(display_name, ''), NULLIF(username, ''), 'Player')
    INTO v_username FROM public.profiles WHERE id = p_user_id;

  v_is_bounty := COALESCE(v_t.is_bounty, false) OR COALESCE(v_t.is_pko, false)
                 OR COALESCE(v_t.is_mystery_bounty, false);

  SELECT * INTO v_split FROM public.fn_tournament_entry_split(
    v_t.buy_in_amount, v_t.buy_in_fee, v_t.bounty_amount, v_is_bounty);

  IF public.fn_ca_midway_free_buy_pko(p_tournament_id) THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;
  END IF;
  IF v_is_bounty AND v_split.prize < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'misconfigured_bounty');
  END IF;

  -- MYSTERY BOUNTY 2026-08-25: no roll here either. A horse and a human must
  -- enter the same event on the same terms; when the two register functions
  -- disagreed about how a bounty head was set, they were two tournaments.
  IF v_is_bounty THEN
    v_head := v_split.bounty;
  END IF;

  IF v_split.charge > 0 AND v_unit = 100 THEN
    -- 20261005224736 / A18 'own_balance' + 10.5: THE HORSE PAYS THROUGH THE
    -- DOOR THE PERSON PAYS THROUGH. This arm is the human door's Diamond arm
    -- statement for statement, with the horse's own id in place of auth.uid().
    -- A Diamond entry is custody, not a club-wallet debit; the roster row is
    -- written after the charge and carries the id the custody row was named
    -- with. The horse's Diamonds are its own (profiles.diamonds, ruling 9) -
    -- no house money reaches this path, and the chip treasury funder (a
    -- chip account ruling 16 forbids in a Diamond format) is never called.
    IF v_split.charge <> trunc(v_split.charge) OR v_split.prize <> trunc(v_split.prize)
       OR v_split.rake <> trunc(v_split.rake) OR v_split.bounty <> trunc(v_split.bounty) THEN
      RAISE EXCEPTION 'diamond_tournament_requires_whole_amounts' USING ERRCODE = '23514';
    END IF;
    v_player_id := gen_random_uuid();
    BEGIN
      v_dia := public.fn_poker_diamond_tournament_charge(
        p_user_id, p_tournament_id, 'entry', v_split.charge, v_split.prize, v_split.bounty, v_split.rake,
        v_player_id, 'poker-tournament-entry:' || p_tournament_id::text || ':' || p_user_id::text || ':' || v_player_id::text);
    EXCEPTION WHEN OTHERS THEN
      -- An ordinary refusal is answered the way the chip core answers one,
      -- with a reason the caller can say; anything else is raised.
      IF SQLERRM LIKE '%insufficient_settled_diamonds%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_diamonds');
      ELSIF SQLERRM LIKE '%diamond_tournaments_not_open%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'diamond_tournaments_not_open');
      ELSIF SQLERRM LIKE '%diamond_debt_requires_settlement%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'diamond_debt_requires_settlement');
      ELSIF SQLERRM LIKE '%diamond_tournament_entry_already_held%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
      END IF;
      RAISE;
    END;
  ELSIF v_split.charge = 0 AND v_unit = 100 THEN
    -- 2026-10-06 (20261007000010): A DIAMOND FREEROLL ENTRY. Nothing is
    -- charged; the entry is an active custody row at zero, so the seat guards
    -- (P0810, P0812) admit the seat and a one-Diamond rebuy or add-on has an
    -- entry to land in. A horse enters through this same arm (CLAUDE.md 10.5).
    v_player_id := gen_random_uuid();
    BEGIN
      v_dia := public.fn_poker_diamond_tournament_free_entry(p_user_id, p_tournament_id, v_player_id);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%diamond_tournaments_not_open%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'diamond_tournaments_not_open');
      ELSIF SQLERRM LIKE '%diamond_tournament_entry_already_held%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
      END IF;
      RAISE;
    END;
  ELSIF v_split.charge > 0 THEN
    -- CHIP STANDARD 1.2 (2026-09-02): THE HORSE DOOR DECLARES EXACTLY AS THE HUMAN
    -- DOOR (R11 - horses and humans are identical on every path). The wallet write
    -- below is journaled by trg_club_members_audit_chip_movement; undeclared it landed
    -- as adjustment player_wallet -> table_stack with no tournament. set_config, not
    -- fn_ca_declare_ledger, for the same reason as fn_register_for_tournament: a
    -- vocabulary miss must never refuse a buy-in. Restored right after the write.
    v_led_cat := current_setting('app.ledger_category', true);
    v_led_cp  := current_setting('app.ledger_counterparty', true);
    v_led_ent := current_setting('app.ledger_counterparty_entity', true);
    v_led_tid := current_setting('app.ledger_tournament', true);
    PERFORM set_config('app.ledger_category', 'tournament_buyin', true);
    PERFORM set_config('app.ledger_counterparty', 'prize_liability', true);
    PERFORM set_config('app.ledger_counterparty_entity', p_tournament_id::text, true);
    PERFORM set_config('app.ledger_tournament', p_tournament_id::text, true);
    PERFORM set_config('app.pnl_tournament_entitlement','',true);
    v_ok := public.atomic_deduct_wallet_and_log(
      p_user_id, v_split.charge, 'tournament_buyin',
      'Tournament buy-in: ' || COALESCE(v_t.name, 'tournament'),
      NULL, NULL, p_tournament_id);
    v_original_entitlement:=NULLIF(current_setting('app.pnl_tournament_entitlement',true),'')::uuid;
    PERFORM set_config('app.ledger_category', COALESCE(v_led_cat, ''), true);
    PERFORM set_config('app.ledger_counterparty', COALESCE(v_led_cp, ''), true);
    PERFORM set_config('app.ledger_counterparty_entity', COALESCE(v_led_ent, ''), true);
    PERFORM set_config('app.ledger_tournament', COALESCE(v_led_tid, ''), true);
    IF NOT COALESCE(v_ok, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
    END IF;
    PERFORM set_config('app.pnl_tournament_wallet_tx','',true);
    PERFORM public.log_wallet_transaction(
      p_user_id, 'PLAYER', v_split.charge, 'debit', 'tournament_buyin',
      'Tournament buy-in: ' || COALESCE(v_t.name, 'tournament'),
      NULL, NULL, p_tournament_id);
    v_original_wallet:=NULLIF(current_setting('app.pnl_tournament_wallet_tx',true),'')::uuid;
  END IF;

  BEGIN
    IF v_dia IS NOT NULL THEN
      -- 20261005224736: the roster row carries the id the custody row was
      -- named with, and the head rides on it as it does for a chip entry so
      -- the roster trigger does not seed it a second time. The human door's
      -- Diamond insert, with the horse's own id.
      INSERT INTO public.tournament_players
        (id, tournament_id, user_id, username, chips, status, current_bounty,
         mystery_bounty_value, bounties_collected, bounty_winnings)
      VALUES (v_player_id, p_tournament_id, p_user_id, COALESCE(v_username,'Player'),
              v_start_chips, 'registered', v_head, 0, 0, 0)
      RETURNING id INTO v_player_id;
    ELSIF v_is_bounty THEN
      INSERT INTO public.tournament_players
        (tournament_id, user_id, username, chips, status, current_bounty,
         mystery_bounty_value, bounties_collected, bounty_winnings)
      VALUES (p_tournament_id, p_user_id, COALESCE(v_username,'Player'), v_start_chips,
              'registered', v_head, 0, 0, 0)
      RETURNING id INTO v_player_id;
    ELSE
      INSERT INTO public.tournament_players (tournament_id, user_id, username, chips, status)
      VALUES (p_tournament_id, p_user_id, COALESCE(v_username,'Player'), v_start_chips, 'registered')
      RETURNING id INTO v_player_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'Horse tournament registration identity changed after its atomic debit; retry the complete transaction'
      USING ERRCODE = '55000';
  END;

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,v_player_id,false);
  IF v_split.rake > 0 AND v_t.club_id IS NOT NULL AND v_unit = 1 THEN
    INSERT INTO public.rake_records
      (hand_id, table_id, club_id, rake_amount, pot_size, num_players, bbj_contribution,
       is_tournament, tournament_id, source, metadata)
    VALUES (NULL, NULL, v_t.club_id, v_split.rake, v_split.charge, 1, 0, true, p_tournament_id,
            'fn_register_horse_for_tournament',
            jsonb_build_object('kind','tournament_entry_fee','user_id',p_user_id,
                               'registration_id',v_player_id));
  END IF;

  -- The roster trigger refreshes the cached count while ANNOUNCED/REGISTERING
  -- and leaves RUNNING to the transaction that seats the late entrant - the
  -- same expectation the human core holds.
  v_expected_cached_players := CASE
    WHEN v_t.status IN ('ANNOUNCED','REGISTERING') THEN v_players_before + 1
    ELSE v_players_before
  END;
  UPDATE public.tournaments
     SET current_players = v_players_before + 1,
         prize_pool  = COALESCE(prize_pool, 0)  + v_split.prize,
         bounty_pool = COALESCE(bounty_pool, 0) + v_split.bounty,
         total_rake  = COALESCE(total_rake, 0)  + v_split.rake
   WHERE id = p_tournament_id
     AND current_players IS NOT DISTINCT FROM v_expected_cached_players;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION
      'Tournament roster cache changed during horse registration'
      USING ERRCODE='55000';
  END IF;

  -- LATE SEAT, as the human core does it: an entrant who cannot be seated is
  -- not charged - the 55000 abort rolls the debit, the roster row, the rake
  -- record and the pool increments back together.
  IF v_late_open THEN
    v_seat := public.fn_seat_late_registrant(p_tournament_id, p_user_id);
    v_seat_reason := v_seat->>'reason';
    IF NOT COALESCE((v_seat->>'ok')::boolean, false)
       AND COALESCE(v_seat_reason, '') <> 'already_seated_or_missing' THEN
      RAISE EXCEPTION
        'Late registration could not seat the player (%) - no charge has been made',
        COALESCE(v_seat_reason, 'unknown')
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- 20261005224736: the asset follows the unit, exactly as the human door
  -- records it. A chip entry still binds this transaction's actual debit IDs;
  -- a Diamond entry binds its custody receipt instead, which is what every
  -- later Diamond door reads.
  PERFORM public.fn_ca_record_tournament_participant_funding(v_player_id,'entry',NULL,
    v_split.charge,CASE WHEN v_unit=100 THEN 'diamonds' ELSE 'chips' END,
    v_original_entitlement,v_original_wallet,v_dia);

  RETURN jsonb_build_object('ok', true, 'registration_id', v_player_id,
    'cost', v_split.charge, 'prize_contribution', v_split.prize,
    'bounty_contribution', v_split.bounty, 'rake', v_split.rake,
    'late_registration', v_late_open,
    'asset', CASE WHEN v_dia IS NOT NULL THEN 'diamonds' ELSE 'chips' END,
    'diamonds_after', CASE WHEN v_dia IS NOT NULL
                           THEN (SELECT p.diamonds FROM public.profiles p WHERE p.id = p_user_id) END,
    'seat', v_seat);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_ca_process_tournament_chip_purchase_money_v1(p_tournament_id uuid, p_user_id uuid, p_rebuy_type text, p_cost numeric, p_chips numeric, p_current_level integer, p_client_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_original_entitlement uuid; v_original_wallet uuid;
  v_t record;
  v_p record;
  v_unit integer := public.fn_ca_tournament_unit_cents(p_tournament_id);  -- DIAMOND PHASE 8
  v_dia jsonb;                                                              -- DIAMOND PHASE 8
  v_balance numeric;
  v_ratio numeric;
  v_is_bounty boolean;
  v_bounty_head numeric;
  v_base numeric;
  v_fee numeric;
  v_total numeric;
  v_add integer;
  v_new_chips integer;
  v_seat record;
  v_key text;
  v_inserted integer;
  v_cat text;
  v_club uuid;
  v_stack_after numeric;
  v_expected numeric;
  v_fee_ratio numeric;
  v_was_seated boolean:=false;
  v_rows integer;
  v_led_cat text;
  v_led_cp text;
  v_led_ent text;
  v_led_tid text;
BEGIN
  IF NOT (COALESCE(auth.role(),'service_role')='service_role')
     AND (auth.uid() IS NULL OR auth.uid()<>p_user_id) THEN
    RAISE EXCEPTION
      'process_tournament_rebuy: caller may only transact for themselves'
      USING ERRCODE='42501';
  END IF;
  IF p_rebuy_type NOT IN ('rebuy','reentry','addon') THEN
    RAISE EXCEPTION 'Invalid rebuy type: %',p_rebuy_type
      USING ERRCODE='22023';
  END IF;
  IF p_client_token IS NULL OR length(btrim(p_client_token))=0
     OR length(btrim(p_client_token))>128 THEN
    RAISE EXCEPTION 'exact tournament chip-purchase token is required'
      USING ERRCODE='22023';
  END IF;

  SELECT id,name,club_id,status,buy_in_amount,buy_in_fee,starting_chips,
         is_rebuy,is_reentry,add_on_available,addon_period_triggered,
         rebuy_cost,rebuy_chips,rebuy_levels,late_reg_levels,max_rebuys,
         max_reentries,addon_cost,addon_chips,addon_levels,current_level,
         prize_pool,is_bounty,is_pko,is_mystery_bounty,bounty_amount
    INTO v_t
    FROM public.tournaments
   WHERE id=p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002';
  END IF;
  IF v_t.status NOT IN ('RUNNING','REGISTERING','ANNOUNCED') THEN
    RAISE EXCEPTION 'Tournament is not accepting chip purchases (status %)',v_t.status;
  END IF;

  SELECT id,chips,status,prize,rebuys,add_on,table_id,club_id
    INTO v_p
    FROM public.tournament_players
   WHERE tournament_id=p_tournament_id AND user_id=p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not registered in this tournament';
  END IF;
  IF v_p.status='eliminated' AND COALESCE(v_p.prize,0)>0 THEN
    RAISE EXCEPTION
      'Finishing Place Already Paid - A Rebuy Cannot Resurrect A Settled Result';
  END IF;
  v_club:=v_p.club_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION
      'Tournament entry funding club is missing; refusing a substituted wallet'
      USING ERRCODE='P0404';
  END IF;

  v_cat:=CASE WHEN p_rebuy_type='addon' THEN 'addon' ELSE 'rebuy' END;
  v_key:=CASE WHEN p_rebuy_type='addon'
    THEN 'tourney:'||p_tournament_id::text||':addon:'||p_user_id::text
    ELSE 'tourney:'||p_tournament_id::text||':'||p_rebuy_type||':'||
         p_user_id::text||':tok:'||btrim(p_client_token)
  END;

  IF p_rebuy_type='addon' THEN
    PERFORM 1
      FROM public.table_seats s
      JOIN public.tables tb ON tb.id=s.table_id
     WHERE s.user_id=p_user_id AND s.left_at IS NULL
       AND tb.tournament_id=p_tournament_id
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'No Live Seat For This % - Aborting So No Charge Is Made',p_rebuy_type;
    END IF;
    IF NOT COALESCE(v_t.add_on_available,false) THEN
      RAISE EXCEPTION 'Add-ons are not offered in this tournament';
    END IF;
    IF COALESCE(v_p.add_on,false) THEN
      RAISE EXCEPTION 'Add-on already taken';
    END IF;
    v_base:=COALESCE(NULLIF(v_t.addon_cost,0),v_t.buy_in_amount,0);
    v_add:=COALESCE(NULLIF(v_t.addon_chips,0),v_t.starting_chips,0)::integer;
  ELSE
    IF p_rebuy_type='rebuy' AND NOT COALESCE(v_t.is_rebuy,false) THEN
      RAISE EXCEPTION 'Rebuys are not offered in this tournament';
    END IF;
    IF p_rebuy_type='reentry' AND NOT COALESCE(v_t.is_reentry,false) THEN
      RAISE EXCEPTION 'Re-entries are not offered in this tournament';
    END IF;
    IF p_rebuy_type='rebuy' AND v_t.max_rebuys IS NOT NULL
       AND COALESCE(v_p.rebuys,0)>=v_t.max_rebuys THEN
      RAISE EXCEPTION 'Rebuy limit reached (% of %)',v_p.rebuys,v_t.max_rebuys;
    END IF;
    IF p_rebuy_type='reentry' AND v_t.max_reentries IS NOT NULL
       AND COALESCE(v_p.rebuys,0)>=v_t.max_reentries THEN
      RAISE EXCEPTION
        'Re-entry limit reached (% of %)',v_p.rebuys,v_t.max_reentries;
    END IF;
    IF p_rebuy_type='rebuy'
       AND COALESCE(v_p.chips,0)>COALESCE(v_t.starting_chips,0) THEN
      RAISE EXCEPTION 'Stack too high for a rebuy';
    END IF;
    /* CONSERVATION (a) 2026-09-11. A re-entry REPLACES the seat stack below
       (stack = v_add) while the roster gains rebuys + 1, so the conservation
       check's expected side gains rebuy_chips at the same moment. Taken while
       the entry still holds chips, that destroys them AND inflates expected.
       A re-entry follows a bust, so the live population for this is zero; it
       is refused rather than left to silently unbalance the event. */
    IF p_rebuy_type='reentry' AND COALESCE(v_p.chips,0)>0 THEN
      RAISE EXCEPTION
        'A Re-Entry Starts A New Stack And This Entry Still Holds % Chips - Aborting So No Charge Is Made',
        v_p.chips
        USING ERRCODE='55000';
    END IF;
    v_base:=COALESCE(NULLIF(v_t.rebuy_cost,0),v_t.buy_in_amount,0);
    v_add:=COALESCE(NULLIF(v_t.rebuy_chips,0),v_t.starting_chips,0)::integer;
  END IF;

  v_fee_ratio:=public.fn_ca_tournament_purchase_fee_ratio(
    v_t.buy_in_amount,v_t.buy_in_fee,v_unit);
  IF public.fn_ca_midway_free_buy_pko(p_tournament_id) THEN v_fee_ratio:=0; END IF;
  v_ratio:=CASE WHEN p_rebuy_type='addon' THEN 0 ELSE v_fee_ratio END;
  v_total:=round(v_base::numeric);
  v_fee:=CASE WHEN v_ratio>0 AND v_total>0
    THEN public.fn_ca_recovery_fee_cents(
           round(v_total*100)::bigint,v_ratio,
           public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric/100    ELSE 0
  END;
  v_base:=round(v_total-v_fee,2);
  v_is_bounty:=COALESCE(v_t.is_bounty,false)
    OR COALESCE(v_t.is_pko,false)
    OR COALESCE(v_t.is_mystery_bounty,false);
  IF v_is_bounty AND p_rebuy_type<>'addon' THEN
    v_bounty_head:=public.fn_ca_unit_floor_cents(
      round(LEAST(GREATEST(0,round(COALESCE(v_t.bounty_amount,0),2)),
                  v_base)*100)::bigint,
      public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric/100;
    v_base:=v_base-v_bounty_head;
  ELSE
    v_bounty_head:=0;
  END IF;
  IF p_cost IS NOT NULL AND abs(p_cost-v_total)>0.01 THEN
    RAISE EXCEPTION
      'Price mismatch: client quoted %, server computed %',p_cost,v_total
      USING ERRCODE='22023';
  END IF;
  IF v_add<=0 OR v_total<0 OR v_fee<0 OR v_base<0 OR v_bounty_head<0
     OR round(v_base+v_bounty_head+v_fee,2)<>round(v_total,2) THEN
    RAISE EXCEPTION 'Tournament chip-purchase quote does not conserve'
      USING ERRCODE='P0404';
  END IF;

  INSERT INTO public.wallet_credit_idempotency(key,user_id,amount)
  VALUES(v_key,p_user_id,v_total)
  ON CONFLICT(key) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF v_inserted=0 THEN
    RETURN jsonb_build_object(
      'success',true,'idempotent',true,'new_stack',v_p.chips,
      'rebuy_type',p_rebuy_type);
  END IF;

  IF v_unit = 100 THEN
    -- DIAMOND PHASE 8: the purchase reserves settled Diamonds into the entry's
    -- custody row. The chip-wallet debit below is the chip estate's.
    v_dia := public.fn_poker_diamond_tournament_charge(
      p_user_id, p_tournament_id, p_rebuy_type, v_total, v_base, v_bounty_head, v_fee, v_p.id, v_key);
    v_balance := 0;
  ELSE
  PERFORM public.fn_ensure_club_wallet(p_user_id,v_club);
  SELECT chip_balance INTO v_balance
    FROM public.club_members
   WHERE user_id=p_user_id AND club_id=v_club
   FOR UPDATE;
  IF v_balance IS NULL OR v_balance<v_total THEN
    RAISE EXCEPTION 'Insufficient club chips: need %, have %',
      v_total,COALESCE(v_balance,0);
  END IF;

  v_led_cat:=current_setting('app.ledger_category',true);
  v_led_cp:=current_setting('app.ledger_counterparty',true);
  v_led_ent:=current_setting('app.ledger_counterparty_entity',true);
  v_led_tid:=current_setting('app.ledger_tournament',true);
  PERFORM set_config('app.ledger_category',v_cat,true);
  PERFORM set_config('app.ledger_counterparty','prize_liability',true);
  PERFORM set_config(
    'app.ledger_counterparty_entity',p_tournament_id::text,true);
  PERFORM set_config('app.ledger_tournament',p_tournament_id::text,true);
  PERFORM set_config('app.pnl_tournament_entitlement','',true);
  UPDATE public.club_members
     SET chip_balance=chip_balance-v_total,updated_at=now()
   WHERE user_id=p_user_id AND club_id=v_club;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  v_original_entitlement:=NULLIF(current_setting('app.pnl_tournament_entitlement',true),'')::uuid;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Exact tournament funding wallet changed during debit'
      USING ERRCODE='55000';
  END IF;
  END IF; -- DIAMOND PHASE 8: end of the chip-wallet branch
  PERFORM set_config('app.ledger_category',COALESCE(v_led_cat,''),true);
  PERFORM set_config('app.ledger_counterparty',COALESCE(v_led_cp,''),true);
  PERFORM set_config(
    'app.ledger_counterparty_entity',COALESCE(v_led_ent,''),true);
  PERFORM set_config('app.ledger_tournament',COALESCE(v_led_tid,''),true);

  IF p_rebuy_type='reentry' THEN
    UPDATE public.tournament_players
       SET chips=v_add,status='playing',eliminated_at=NULL,position=NULL,
           rebuys=COALESCE(rebuys,0)+1
     WHERE tournament_id=p_tournament_id AND user_id=p_user_id
     RETURNING chips INTO v_new_chips;
  ELSIF p_rebuy_type='addon' THEN
    UPDATE public.tournament_players
       SET chips=COALESCE(chips,0)+v_add,add_on=true
     WHERE tournament_id=p_tournament_id AND user_id=p_user_id
     RETURNING chips INTO v_new_chips;
  ELSE
    UPDATE public.tournament_players
       SET chips=COALESCE(chips,0)+v_add,status='playing',
           eliminated_at=NULL,position=NULL,
           rebuys=COALESCE(rebuys,0)+1
     WHERE tournament_id=p_tournament_id AND user_id=p_user_id
     RETURNING chips INTO v_new_chips;
  END IF;
  IF v_new_chips IS NULL THEN
    RAISE EXCEPTION 'Locked tournament roster changed during chip grant'
      USING ERRCODE='55000';
  END IF;

  IF v_bounty_head>0 THEN
    UPDATE public.tournament_players
       SET current_bounty=CASE WHEN p_rebuy_type='reentry'
         THEN v_bounty_head
         ELSE COALESCE(current_bounty,0)+v_bounty_head END
     WHERE tournament_id=p_tournament_id AND user_id=p_user_id;
  END IF;

  SELECT s.id,s.stack INTO v_seat
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE s.user_id=p_user_id AND s.left_at IS NULL
     AND tb.tournament_id=p_tournament_id
   ORDER BY (tb.status IS DISTINCT FROM 'closed') DESC,
            s.joined_at DESC NULLS LAST,s.id DESC
   LIMIT 1;
  IF FOUND THEN
    v_was_seated:=true;
    v_expected:=CASE WHEN p_rebuy_type='reentry'
      THEN v_add ELSE COALESCE(v_seat.stack,0)+v_add END;
    /* CONSERVATION (b) 2026-09-11. The roster above has already booked this
       purchase, so the supply this is measured against already contains the
       chips being bought. The felt must land inside it. An event that is
       already over its cap keeps playing; it may not get further over.
       See ca_drift_incidents 8b8fe26c and this migration's header. */
    PERFORM public.fn_ca_assert_tournament_chip_grant(
      p_tournament_id,p_user_id,v_seat.id,v_expected,
      'tournament '||p_rebuy_type);
    UPDATE public.table_seats
       SET stack=CASE WHEN p_rebuy_type='reentry'
         THEN v_add ELSE COALESCE(stack,0)+v_add END
     WHERE id=v_seat.id
     RETURNING stack INTO v_stack_after;
    IF v_stack_after IS NULL OR v_stack_after<>v_expected THEN
      RAISE EXCEPTION
        'Chip Grant Did Not Land: % Expected Stack %, Seat % Holds % - Aborting So No Charge Is Made',
        p_rebuy_type,v_expected,v_seat.id,v_stack_after;
    END IF;
    UPDATE public.tournament_players
       SET chips=(SELECT stack FROM public.table_seats WHERE id=v_seat.id)::integer
     WHERE tournament_id=p_tournament_id AND user_id=p_user_id
     RETURNING chips INTO v_new_chips;
  ELSIF p_rebuy_type='addon' THEN
    RAISE EXCEPTION
      'Seat Disappeared During % - Aborting So No Charge Is Made',p_rebuy_type;
  END IF;

  UPDATE public.tournaments
     SET prize_pool=COALESCE(prize_pool,0)+v_base,
         bounty_pool=COALESCE(bounty_pool,0)+v_bounty_head
   WHERE id=p_tournament_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'Tournament vanished during chip-purchase pool booking'
      USING ERRCODE='55000';
  END IF;

  IF v_fee>0 AND v_t.club_id IS NOT NULL AND v_unit = 100 THEN
    -- DIAMOND PHASE 8: the fee stays in custody until the event settles.
    UPDATE public.tournaments
       SET total_rake=COALESCE(total_rake,0)+v_fee
     WHERE id=p_tournament_id;
  ELSIF v_fee>0 AND v_t.club_id IS NOT NULL THEN
    INSERT INTO public.rake_records(
      hand_id,table_id,club_id,rake_amount,pot_size,num_players,
      bbj_contribution,is_tournament,tournament_id,source,metadata)
    VALUES(
      NULL,NULL,v_t.club_id,v_fee,v_fee,1,0,true,p_tournament_id,
      'process_tournament_rebuy',jsonb_build_object(
        'kind','tournament_'||p_rebuy_type||'_fee','user_id',p_user_id,
        'entry_club_id',v_club));
    UPDATE public.tournaments
       SET total_rake=COALESCE(total_rake,0)+v_fee
     WHERE id=p_tournament_id;
  END IF;

  IF v_unit = 1 THEN -- DIAMOND PHASE 8: wallet_transactions is the chip receipt
  INSERT INTO public.wallet_transactions(
    user_id,wallet_type,type,amount,category,description,
    related_entity_id,balance_after)
  VALUES(
    p_user_id,'PLAYER','debit',v_total,v_cat,
    'Tournament '||p_rebuy_type||': '||COALESCE(v_t.name,'tournament')||
      ' ('||v_base||' prize + '||v_bounty_head||' bounty + '||v_fee||
      ' fee) [club wallet]',
    p_tournament_id,v_balance-v_total) RETURNING id INTO v_original_wallet;
  END IF; -- DIAMOND PHASE 8

  PERFORM public.fn_ca_record_tournament_participant_funding(v_p.id,p_rebuy_type,v_key,
    v_total,CASE WHEN v_unit=100 THEN 'diamonds' ELSE 'chips' END,
    v_original_entitlement,v_original_wallet,v_dia);

  RETURN jsonb_build_object(
    'success',true,'new_stack',v_new_chips,'rebuy_type',p_rebuy_type,
    'chips_added',v_add,'cost',v_total,'fee',v_fee,'seated',v_was_seated,
    'bounty_head_funded',v_bounty_head);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_charge_split(p_tournament_id uuid, p_charge_category text, p_gross numeric)
 RETURNS TABLE(refund_prize numeric, refund_bounty numeric, refund_fee numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t record;
  v_entry record;
  v_kind text := lower(btrim(COALESCE(p_charge_category,'')));
  v_gross numeric := round(COALESCE(p_gross,0),2);
  v_is_bounty boolean;
  v_ratio numeric;
  v_fee numeric;
  v_bounty numeric;
BEGIN
  IF p_tournament_id IS NULL OR p_gross IS NULL
     OR p_gross::text IN ('NaN','Infinity','-Infinity')
     OR p_gross IS DISTINCT FROM v_gross OR v_gross <= 0
     OR v_kind NOT IN ('tournament_buyin','rebuy','addon') THEN
    RAISE EXCEPTION 'tournament charge split received an invalid contract'
      USING ERRCODE = '22003';
  END IF;
  SELECT t.buy_in_amount,t.buy_in_fee,t.bounty_amount,
         t.is_bounty,t.is_pko,t.is_mystery_bounty
    INTO v_t FROM public.tournaments t WHERE t.id=p_tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament charge split has no tournament %',p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;
  v_is_bounty := COALESCE(v_t.is_bounty,false)
              OR COALESCE(v_t.is_pko,false)
              OR COALESCE(v_t.is_mystery_bounty,false);
  IF v_kind='tournament_buyin' THEN
    SELECT * INTO v_entry FROM public.fn_tournament_entry_split(
      v_t.buy_in_amount,v_t.buy_in_fee,v_t.bounty_amount,v_is_bounty);
    IF v_entry.charge IS DISTINCT FROM v_gross THEN
      RAISE EXCEPTION
        'tournament buy-in ledger amount % does not match its funded split %',
        v_gross,v_entry.charge USING ERRCODE = '23514';
    END IF;
    refund_prize := v_entry.prize;
    refund_bounty := v_entry.bounty;
    refund_fee := v_entry.rake;
  ELSIF v_kind='addon' THEN
    IF v_gross IS DISTINCT FROM round(v_gross) THEN
      RAISE EXCEPTION 'add-on charge must be a positive whole chip amount'
        USING ERRCODE = '23514';
    END IF;
    refund_prize := v_gross;
    refund_bounty := 0;
    refund_fee := 0;
  ELSE
    IF v_gross IS DISTINCT FROM round(v_gross) THEN
      RAISE EXCEPTION 'rebuy charge must be a positive whole chip amount'
        USING ERRCODE = '23514';
    END IF;
    v_ratio := public.fn_ca_tournament_purchase_fee_ratio(
      v_t.buy_in_amount, v_t.buy_in_fee, public.fn_ca_tournament_unit_cents(p_tournament_id));
    IF public.fn_ca_midway_free_buy_pko(p_tournament_id) THEN v_ratio:=0; END IF;
    v_fee := public.fn_ca_recovery_fee_cents(
      round(v_gross*100)::bigint, v_ratio,
      public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric / 100;    v_bounty := CASE WHEN v_is_bounty THEN
      public.fn_ca_unit_floor_cents(
        round(LEAST(GREATEST(0,round(COALESCE(v_t.bounty_amount,0),2)),
                    v_gross-v_fee)*100)::bigint,
        public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric / 100
      ELSE 0 END;
    refund_fee := v_fee;
    refund_bounty := v_bounty;
    refund_prize := round(v_gross-v_fee-v_bounty,2);
  END IF;
  IF refund_prize IS NULL OR refund_bounty IS NULL OR refund_fee IS NULL
     OR refund_prize::text IN ('NaN','Infinity','-Infinity')
     OR refund_bounty::text IN ('NaN','Infinity','-Infinity')
     OR refund_fee::text IN ('NaN','Infinity','-Infinity')
     OR refund_prize < 0 OR refund_bounty < 0 OR refund_fee < 0
     OR v_gross IS DISTINCT FROM
          round(refund_prize+refund_bounty+refund_fee,2) THEN
    RAISE EXCEPTION 'tournament charge split produced invalid component rails'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEXT;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_escrow_chips(p_tournament_id uuid)
 RETURNS TABLE(prize_in numeric, bounty_in numeric, fee_in numeric, overlay_in numeric, satellite_in numeric, prize_out numeric, bounty_out numeric, fee_out numeric, refund_out numeric, prize_balance numeric, bounty_balance numeric, fee_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH t AS (
  SELECT id,COALESCE(buy_in_amount,0) AS buy_in_amount,
         COALESCE(buy_in_fee,0) AS buy_in_fee,
         COALESCE(bounty_amount,0) AS bounty_amount,
         (COALESCE(is_bounty,false) OR COALESCE(is_pko,false)
          OR COALESCE(is_mystery_bounty,false)) AS is_b
    FROM public.tournaments WHERE id=p_tournament_id
), promo AS (
  SELECT coalesce(sum(CASE WHEN l.category='promo_send' THEN l.amount ELSE -l.amount END),0) AS amount
  FROM public.chip_ledger l WHERE l.tournament_id=p_tournament_id
    AND l.metadata->>'kind'='midway_free_buy_promo_head'
    AND l.category IN ('promo_send','reversal')
), w AS (
  SELECT
    COALESCE(sum(amount) FILTER (WHERE type='debit'
      AND category IN ('tournament_buyin','rebuy','addon')),0) AS gross_in,
    COALESCE(sum(amount) FILTER (WHERE type='credit' AND category='prize'),0)
      - COALESCE(sum(amount) FILTER (WHERE type='debit'
          AND category IN ('prize','prize_reversal')),0) AS prize_out,
    COALESCE(sum(amount) FILTER (WHERE type='credit' AND category='bounty'),0)
      AS bounty_out,
    COALESCE(sum(amount) FILTER (WHERE type='credit'
      AND category IN ('refund','tournament_refund')),0) AS refund_out
  FROM public.wallet_transactions WHERE related_entity_id=p_tournament_id
), direct_bounty AS (
  SELECT round(COALESCE(sum(CASE
    WHEN NOT t.is_b OR lower(l.category)='addon' THEN 0
    WHEN lower(l.category)='tournament_buyin' THEN round(t.bounty_amount,2)
    ELSE public.fn_ca_unit_floor_cents(
      round(LEAST(
        GREATEST(0,round(t.bounty_amount,2)),
        round(l.amount,2)-public.fn_ca_recovery_fee_cents(
          round(round(l.amount,2)*100)::bigint,
          CASE WHEN public.fn_ca_midway_free_buy_pko(p_tournament_id) THEN 0
          ELSE public.fn_ca_tournament_fee_ratio(t.buy_in_amount,t.buy_in_fee) END,
          public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric/100
      )*100)::bigint,
      public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric/100    END),0),2) AS amount
  FROM t JOIN public.chip_ledger l
    ON l.tournament_id=p_tournament_id
   AND l.from_type='player_wallet' AND l.to_type='prize_liability'
   AND l.to_entity_id=p_tournament_id
   AND lower(l.category) IN ('tournament_buyin','rebuy','addon')
), rr AS (
  SELECT
    COALESCE(sum(rake_amount),0) AS fee_in,
    COALESCE(sum(rake_amount) FILTER (
      WHERE source='fn_award_satellite_seat'),0) AS fee_sat,
    COALESCE(sum(rake_amount) FILTER (
      WHERE source='fn_award_satellite_seat'
        AND metadata->>'entry_split_version'='2'),0) AS fee_sat_split,
    COALESCE(sum(COALESCE(pot_size,0)-rake_amount) FILTER (
      WHERE source='fn_award_satellite_seat'),0) AS satellite_in
  FROM public.rake_records
  WHERE tournament_id=p_tournament_id AND is_tournament
    AND NOT (rake_amount<0 AND source IN (
      'atomic_cancel_tournament','fn_unregister_from_tournament'))
), ov AS (
  /* A REVIEWED VOID RETURNS ITS OVERLAY (2026-09-27). The void of a retired
     event (smarter_private.f06_void_retired_mixed_custody_event) sends the
     guarantee overlay back to its funder as one 'reversal' leg out of
     prize_liability, and takes it out of the maintained escrow. The shadow
     nets it too, or it reads the returned overlay as money still in the pool. */
  SELECT COALESCE(sum(a.amount),0) AS ledger_overlay,
         (SELECT COALESCE(sum(r.amount),0) FROM public.chip_ledger r
     WHERE r.tournament_id=p_tournament_id AND r.category='reversal'
       AND r.from_type='prize_liability' AND r.from_entity_id=p_tournament_id
       AND r.metadata->>'kind'='reviewed_void_overlay_return') AS returned
    FROM public.chip_ledger a
   WHERE a.to_entity_id=p_tournament_id
     AND a.to_type='prize_liability'
     AND (a.category='overlay' OR
       (a.category='correction' AND a.from_type IN ('union_bank','club_treasury')))
     AND NOT (COALESCE(a.description,'') LIKE 'auto-ledgered%'
       AND EXISTS (
         SELECT 1 FROM public.chip_ledger b
          WHERE b.to_entity_id=a.to_entity_id AND b.category='overlay'
            AND b.to_type='prize_liability' AND b.id<>a.id
            AND b.amount=a.amount
            AND COALESCE(b.description,'') NOT LIKE 'auto-ledgered%'
            AND abs(extract(epoch FROM (b.created_at-a.created_at)))<5))
), stl AS (
  SELECT COALESCE(sum(amount),0) AS moved,
    COALESCE(sum(amount) FILTER (
      WHERE metadata->>'entry_split_version'='2'),0) AS split_moved,
    COALESCE(sum((metadata->>'entry_fee')::numeric) FILTER (
      WHERE metadata->>'entry_split_version'='2'),0) AS split_fee,
    COALESCE(sum((metadata->>'entry_bounty')::numeric) FILTER (
      WHERE metadata->>'entry_split_version'='2'),0) AS split_bounty
  FROM public.chip_ledger
  WHERE to_entity_id=p_tournament_id AND to_type='prize_liability'
    AND idempotency_key LIKE 'tourney:%:seat:%:pool_transfer'
), tk AS (
  /* A TICKET ENTRY IS AN ENTRY (2026-09-10): a tournament-entry ticket
     redeemed into this event moves its value escrow -> prize_liability
     with no wallet debit and no pool transfer; the escrow triggers count
     it as an entry and so must the shadow. */
  SELECT COALESCE(sum(amount),0) AS ticket_in,
         COALESCE(sum((metadata->>'entry_bounty')::numeric),0) AS ticket_bounty
    FROM public.chip_ledger
   WHERE to_entity_id=p_tournament_id AND to_type='prize_liability'
     AND from_type='escrow' AND category='ticket_redeem'
), tgo AS (
  SELECT COALESCE(sum(amount),0) AS tgo_amount
    FROM public.tournament_guarantee_overlays
   WHERE tournament_id=p_tournament_id
), sat AS (
  SELECT COALESCE(sum(p.amount),0) AS funded_awards_out
    FROM public.tournament_payouts p
    LEFT JOIN public.tournament_satellite_awards a
      ON a.payout_id=p.id
     AND a.tournament_id=p.tournament_id
     AND a.delivery_kind='ticket'
   WHERE p.tournament_id=p_tournament_id
     AND (p.source='satellite_seat'
       OR (p.source='satellite_ticket' AND a.payout_id IS NOT NULL))
), fo AS (
  SELECT COALESCE(sum(amount),0) AS fee_out
    FROM public.tournament_rake_settlements
   WHERE tournament_id=p_tournament_id AND settled_at IS NOT NULL
), exact_refunds AS (
  SELECT COALESCE(sum(amount_paid_now),0) AS total,
         COALESCE(sum(refund_prize),0) AS prize,
         COALESCE(sum(refund_bounty),0) AS bounty,
         COALESCE(sum(refund_fee),0) AS fee
    FROM public.tournament_refund_tranches
   WHERE tournament_id=p_tournament_id
), calc AS (
  SELECT
    round(w.gross_in+stl.split_moved-stl.split_fee+tk.ticket_in+promo.amount,2) AS gross_in,
    round(rr.fee_in,2) AS fee_in,
    round(rr.fee_in-rr.fee_sat,2) AS fee_entries,
    round(direct_bounty.amount+stl.split_bounty+tk.ticket_bounty+promo.amount,2) AS bounty_in,
    round(CASE WHEN ov.ledger_overlay>0 THEN ov.ledger_overlay
      ELSE tgo.tgo_amount END-ov.returned,2) AS overlay_in,
    round(stl.moved-stl.split_moved-rr.fee_sat+rr.fee_sat_split,2)
      AS satellite_in,
    round(w.prize_out+sat.funded_awards_out,2) AS prize_out,
    round(w.bounty_out,2) AS bounty_out,
    round(fo.fee_out,2) AS fee_out,
    round(w.refund_out,2) AS refund_out,
    round(exact_refunds.total,2) AS exact_total,
    round(exact_refunds.prize,2) AS exact_prize,
    round(exact_refunds.bounty,2) AS exact_bounty,
    round(exact_refunds.fee,2) AS exact_fee
  FROM t,w,direct_bounty,rr,stl,ov,tk,tgo,sat,fo,exact_refunds,promo
), split AS (
  SELECT c.*,round(c.gross_in-c.fee_entries-c.bounty_in,2) AS prize_in,
         round(c.refund_out-c.exact_total,2) AS legacy_refund
    FROM calc c
), apportioned AS (
  SELECT s.*,
    CASE WHEN (s.prize_in+s.satellite_in+s.bounty_in+s.fee_in)>0
      THEN round(s.legacy_refund*(s.prize_in+s.satellite_in)
        /(s.prize_in+s.satellite_in+s.bounty_in+s.fee_in),2)
      ELSE s.legacy_refund END AS legacy_prize,
    CASE WHEN (s.prize_in+s.satellite_in+s.bounty_in+s.fee_in)>0
      THEN round(s.legacy_refund*s.bounty_in
        /(s.prize_in+s.satellite_in+s.bounty_in+s.fee_in),2)
      ELSE 0 END AS legacy_bounty
  FROM split s
)
SELECT a.prize_in,a.bounty_in,a.fee_in,a.overlay_in,a.satellite_in,
       a.prize_out,a.bounty_out,a.fee_out,a.refund_out,
       round(a.prize_in+a.overlay_in+a.satellite_in-a.prize_out
         -a.legacy_prize-a.exact_prize,2) AS prize_balance,
       round(a.bounty_in-a.bounty_out-a.legacy_bounty-a.exact_bounty,2)
         AS bounty_balance,
       round(a.fee_in-a.fee_out
         -(a.legacy_refund-a.legacy_prize-a.legacy_bounty)-a.exact_fee,2)
         AS fee_balance
  FROM apportioned a;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_ca_unregister_tournament_player_exact(p_tournament_id uuid, p_user_id uuid, p_expected_table_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_reg public.tournament_players%ROWTYPE;
  v_ent record;
  v_fee_group record;
  v_settle jsonb;
  v_receipt jsonb;
  v_escrow_before public.tournament_escrow%ROWTYPE;
  v_escrow_after public.tournament_escrow%ROWTYPE;
  v_players_before integer;
  v_rows integer;
  v_seat_number integer;
  v_seats_taken integer;
  v_non_cash_count integer;
  v_wallet_debits numeric:=0;
  v_wallet_refunds_before numeric:=0;
  v_wallet_refunds_after numeric:=0;
  v_entitled_wallet_total numeric:=0;
  v_tranche_total numeric:=0;
  v_refund_prize numeric:=0;
  v_refund_bounty numeric:=0;
  v_refund_fee numeric:=0;
  v_refund_total numeric:=0;
  v_wallet_amount numeric:=0;
  v_ticket_amount numeric:=0;
  v_running_owed numeric:=0;
  v_rake_before numeric:=0;
  v_rake_after numeric:=0;
  v_fees_reversed numeric:=0;
  v_entitlement_ids uuid[]:='{}'::uuid[];
  v_ticket_ids uuid[]:='{}'::uuid[];
  v_credit_ledger_ids uuid[]:='{}'::uuid[];
  v_wallet_transaction_ids uuid[]:='{}'::uuid[];
  v_source_wallet_club_ids uuid[]:='{}'::uuid[];
  v_fee_reversal_ids uuid[]:='{}'::uuid[];
  v_fee_source_rake_record_ids uuid[]:='{}'::uuid[];
  v_fee_entitlement_ids uuid[]:='{}'::uuid[];
  v_fee_reversal_id uuid;
  v_fee_source_count integer:=0;
  v_fee_source_entitlement_count integer:=0;
  v_fee_source_amount numeric:=0;
  v_request_id uuid:=COALESCE(p_request_id,gen_random_uuid());
  v_start_authority text:='scheduled_clock';
  v_launch_completed_at timestamptz;
  v_persisted_hand_exists boolean:=false;
  v_actual_status text;
  v_actual_started_at timestamptz;
  v_unregistered_at timestamptz;
  v_description text:=COALESCE(
    NULLIF(btrim(p_description),''),'Tournament unregistration refund');
BEGIN
  IF p_tournament_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'tournament and player ids are required'
      USING ERRCODE='22004';
  END IF;
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  -- DIAMOND PHASE 8: a Diamond entry never rode the chip rails. Every
  -- caller of this authority (the lobby, the seat, the administrator, the
  -- launch) sends it home through its own door before a chip rail is
  -- touched. A caller that named no request id is given one exactly as
  -- this authority mints its own. A seat exit naming a table the player
  -- does not sit at answers not_seated unless its request id is already
  -- settled, in which case the door replays that receipt.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    IF p_expected_table_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                        WHERE s.table_id=p_expected_table_id AND s.user_id=p_user_id AND s.left_at IS NULL)
       AND NOT (p_request_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.poker_diamond_tournament_ledger l
                   WHERE l.tournament_id=p_tournament_id AND l.user_id=p_user_id AND l.kind='refund'
                     AND l.request->>'request_id'=p_request_id::text)) THEN
      RETURN jsonb_build_object('ok',false,'reason','not_seated');
    END IF;
    RETURN public.fn_poker_diamond_tournament_unregister(
      p_tournament_id, p_user_id, COALESCE(p_request_id, gen_random_uuid()));
  END IF;
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF v_t.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  -- Spins and Heads-Up Sit & Gos are separate products, but both are
  -- seat-first: start_time is only their human fill-window deadline. Neither
  -- product has a scheduled start. Satellite feeders remain outside this
  -- change and retain the existing scheduled-clock contract.
  IF v_t.format_contract='spin-v1' THEN
    v_start_authority:='spin_actual_start';
  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_start_authority:='heads_up_sng_actual_start';
  END IF;
  /* A release performed by the launch that holds this event's INCOMPLETE
     launch receipt has its own start authority. The clock has passed
     start_time, but no hand has been dealt (checked below, fails closed)
     and the receipt has not been completed, so the seat-first proofs -
     started_at unset, launch not completed - are the right ones and the
     receipt records launch_release. The launch names its receipt through
     the transaction-local app.ca_launch_release_launch_id, set only by
     fn_ca_release_unseatable_registrant_at_launch. */
  IF v_start_authority='scheduled_clock' AND EXISTS (
       SELECT 1 FROM public.tournament_launch_receipts r
        WHERE r.tournament_id=p_tournament_id
          AND r.completed_at IS NULL
          AND r.launch_id::text=NULLIF(
            current_setting('app.ca_launch_release_launch_id',true),'')) THEN
    v_start_authority:='launch_release';
  END IF;

  -- A caller-supplied request id is a durable operation identity. It may only
  -- name this exact player/event/endpoint scope. If its pre-start outcome is
  -- already committed, replay that immutable outcome even when the wall clock
  -- is now past the start; this branch performs no new unregistration writes.
  IF p_request_id IS NOT NULL THEN
    IF EXISTS(
      SELECT 1 FROM public.tournament_unregistration_receipts r
       WHERE r.request_id=p_request_id
         AND (r.tournament_id IS DISTINCT FROM p_tournament_id
           OR r.user_id IS DISTINCT FROM p_user_id
           OR r.source_table_id IS DISTINCT FROM p_expected_table_id)) THEN
      RAISE EXCEPTION 'unregistration request id belongs to another intent'
        USING ERRCODE='22023';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.tournament_unregistration_receipts r
       WHERE r.request_id=p_request_id) THEN
      v_receipt:=public.fn_ca_tournament_unregistration_receipt(
        p_tournament_id,p_user_id,p_expected_table_id,p_request_id);
      IF v_receipt IS NOT NULL THEN
        RETURN v_receipt||jsonb_build_object('replayed',true);
      END IF;
      RAISE EXCEPTION
        'unregistration request id belongs to a prior registration lifecycle'
        USING ERRCODE='P0404';
    END IF;
  END IF;

  SELECT * INTO v_reg FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
     AND tp.status::text IN ('registered','playing')
   ORDER BY tp.id LIMIT 1 FOR UPDATE;
  IF upper(COALESCE(v_t.status::text,'')) NOT IN ('ANNOUNCED','REGISTERING') THEN
    RETURN jsonb_build_object('ok',false,'reason','registration_closed');
  END IF;
  PERFORM public.fn_ca_tournament_recorded_format(p_tournament_id);

  -- A persisted hand is stronger actual-start evidence than either a mutable
  -- parent status or a launch receipt that an interrupted launcher failed to
  -- complete. Canonical accepted-hand commits carry tournament_id; the
  -- table-linked branch also fails closed for older rows that omitted it. The
  -- exclusive lifecycle advisory lock above serializes this read against the
  -- shared lock held by every canonical accepted-hand commit.
  SELECT EXISTS (
           SELECT 1
             FROM public.hand_history hh
            WHERE hh.tournament_id=p_tournament_id
         ) OR EXISTS (
           SELECT 1
             FROM public.tables hand_table
             JOIN public.hand_history hh ON hh.table_id=hand_table.id
            WHERE hand_table.tournament_id=p_tournament_id
         )
    INTO v_persisted_hand_exists;
  IF v_persisted_hand_exists THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;
  IF v_start_authority='scheduled_clock' THEN
    IF v_t.start_time IS NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','registration_schedule_unset');
    END IF;
    IF clock_timestamp()>=v_t.start_time THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  ELSE
    SELECT r.completed_at INTO v_launch_completed_at
      FROM public.tournament_launch_receipts r
     WHERE r.tournament_id=p_tournament_id;
    IF v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  END IF;
  IF v_reg.id IS NULL THEN
    -- Rolling clients without a request id may recover a just-lost response
    -- only while registration remains open. They can never turn an old receipt
    -- into a successful post-start response.
    IF p_request_id IS NULL THEN
      v_receipt:=public.fn_ca_tournament_unregistration_receipt(
        p_tournament_id,p_user_id,p_expected_table_id,NULL);
      IF v_receipt IS NOT NULL THEN
        RETURN v_receipt||jsonb_build_object('replayed',true);
      END IF;
    END IF;
    RETURN jsonb_build_object('ok',false,'reason','not_registered');
  END IF;
  IF p_expected_table_id IS NOT NULL THEN
    SELECT s.seat_number INTO v_seat_number
      FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
     WHERE s.table_id=p_expected_table_id AND s.user_id=p_user_id
       AND s.left_at IS NULL AND tb.tournament_id=p_tournament_id
     ORDER BY s.id LIMIT 1 FOR UPDATE OF s;
    IF v_seat_number IS NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','not_seated');
    END IF;
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id
       AND r.kind IN ('contribution','jackpot_draw')) THEN
    RETURN jsonb_build_object('ok',false,'reason','spin_entry_already_booked');
  END IF;

  PERFORM 1 FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
   ORDER BY e.entitlement_kind,e.id FOR UPDATE;
  SELECT count(*) INTO v_non_cash_count
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND e.registration_id=v_reg.id
     AND e.entitlement_kind IN ('satellite_seat','tournament_ticket')
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id);
  IF COALESCE(v_reg.is_satellite_qualifier,false)
     AND v_non_cash_count<>1 THEN
    RAISE EXCEPTION
      'satellite-funded registration % requires one unspent ticket entitlement',
      v_reg.id USING ERRCODE='P0404';
  END IF;
  IF NOT COALESCE(v_reg.is_satellite_qualifier,false)
     AND v_non_cash_count<>0 THEN
    RAISE EXCEPTION
      'cash registration % cannot own a satellite ticket entitlement',v_reg.id
      USING ERRCODE='P0404';
  END IF;

  SELECT round(COALESCE(sum(e.refund_prize),0),2),
         round(COALESCE(sum(e.refund_bounty),0),2),
         round(COALESCE(sum(e.refund_fee),0),2),
         round(COALESCE(sum(e.gross),0),2),
         round(COALESCE(sum(e.gross),0),2),
         0::numeric
    INTO v_refund_prize,v_refund_bounty,v_refund_fee,v_refund_total,
         v_wallet_amount,v_ticket_amount
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND (e.entitlement_kind='wallet_charge' OR e.registration_id=v_reg.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id);
  IF v_refund_total IS DISTINCT FROM
       round(v_refund_prize+v_refund_bounty+v_refund_fee,2)
     OR v_refund_total IS DISTINCT FROM
       round(v_wallet_amount+v_ticket_amount,2) THEN
    RAISE EXCEPTION 'registration % has invalid entitlement totals',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  -- A funded satellite entry does not invent a player-wallet debit.
  -- It returns the same escrow value in cash through its exact source proof.
  IF COALESCE(v_reg.is_satellite_qualifier,false)
     AND EXISTS (
       SELECT 1 FROM public.tournament_refund_entitlements e
        WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
          AND e.entitlement_kind='wallet_charge'
          AND NOT EXISTS (
            SELECT 1 FROM public.tournament_refund_tranches tr
             WHERE tr.entitlement_id=e.id)) THEN
    RAISE EXCEPTION
      'satellite-funded registration % has an unexpected wallet charge',
      v_reg.id USING ERRCODE='P0404';
  END IF;

  SELECT round(COALESCE(sum(w.amount),0),2) INTO v_wallet_debits
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=p_user_id
     AND w.type='debit'
     AND lower(w.category) IN ('tournament_buyin','rebuy','addon');
  SELECT round(COALESCE(sum(e.gross),0),2) INTO v_entitled_wallet_total
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND e.entitlement_kind='wallet_charge';
  SELECT round(COALESCE(sum(w.amount),0),2) INTO v_wallet_refunds_before
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=p_user_id
     AND w.type='credit'
     AND lower(w.category) IN ('refund','tournament_refund');
  SELECT round(COALESCE(sum(tr.amount_paid_now),0),2) INTO v_tranche_total
    FROM public.tournament_refund_tranches tr
   WHERE tr.tournament_id=p_tournament_id AND tr.user_id=p_user_id;
  IF v_wallet_debits IS DISTINCT FROM v_entitled_wallet_total
     OR v_wallet_refunds_before IS DISTINCT FROM v_tranche_total
     OR v_wallet_refunds_before>(
       SELECT COALESCE(sum(e.gross),0)
         FROM public.tournament_refund_entitlements e
        WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM public.tournament_tickets tk
             WHERE tk.source_refund_entitlement_id=e.id)) THEN
    RAISE EXCEPTION 'registration % wallet and entitlement journals disagree',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  v_running_owed:=v_tranche_total;

  SELECT round(COALESCE(sum(r.rake_amount),0),2) INTO v_rake_before
    FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  SELECT COALESCE(array_agg(e.id ORDER BY e.id),ARRAY[]::uuid[])
    INTO v_fee_entitlement_ids
    FROM public.tournament_refund_entitlements e
   WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
     AND (e.entitlement_kind='wallet_charge' OR e.registration_id=v_reg.id)
     AND e.refund_fee>0
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS(
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id);

  -- Bind every fee-bearing entitlement to its actual same-transaction rake
  -- journal. The refund wallet club is deliberately absent from this match:
  -- it identifies the payer, while rake_records.club_id identifies the fee
  -- recipient and can be a different club.
  WITH fee_sources AS MATERIALIZED (
    SELECT e.id AS entitlement_id,r.id AS rake_record_id,
           r.club_id,r.rake_amount
      FROM public.tournament_refund_entitlements e
      JOIN public.chip_ledger l ON l.id=e.source_ledger_id
      JOIN public.rake_records r
        ON r.tournament_id=e.tournament_id
       AND r.is_tournament IS TRUE
       AND r.club_id IS NOT NULL
       AND r.rake_amount=e.refund_fee
       AND r.created_at=l.created_at
       AND r.metadata->>'user_id'=e.user_id::text
       AND (
         (e.entitlement_kind='wallet_charge'
          AND e.charge_category='tournament_buyin'
          AND r.source IN (
            'fn_register_for_tournament','fn_register_horse_for_tournament')
          AND r.metadata->>'kind'='tournament_entry_fee'
          AND r.metadata->>'registration_id'=v_reg.id::text)
         OR (e.entitlement_kind='wallet_charge'
          AND e.charge_category='rebuy'
          AND r.source='process_tournament_rebuy'
          AND r.metadata->>'kind' IN (
            'tournament_rebuy_fee','tournament_reentry_fee'))
         OR (e.entitlement_kind='satellite_seat'
          AND r.source='fn_award_satellite_seat'
          AND r.metadata->>'kind'='satellite_seat_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text)
         OR (e.entitlement_kind='tournament_ticket'
          AND r.source='fn_register_for_tournament_with_ticket'
          AND r.metadata->>'kind'='tournament_ticket_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text))
     WHERE e.id=ANY(v_fee_entitlement_ids)
  )
  SELECT count(*),count(DISTINCT entitlement_id),
         round(COALESCE(sum(rake_amount),0),2),
         COALESCE(array_agg(rake_record_id ORDER BY rake_record_id),
                  ARRAY[]::uuid[])
    INTO v_fee_source_count,v_fee_source_entitlement_count,
         v_fee_source_amount,v_fee_source_rake_record_ids
    FROM fee_sources;
  IF v_fee_source_count<>cardinality(v_fee_entitlement_ids)
     OR v_fee_source_entitlement_count<>cardinality(v_fee_entitlement_ids)
     OR v_fee_source_count<>(
       SELECT count(DISTINCT id)
         FROM unnest(v_fee_source_rake_record_ids) source(id))
     OR v_fee_source_amount IS DISTINCT FROM v_refund_fee THEN
    RAISE EXCEPTION
      'registration % fee entitlements do not map one-to-one to exact rake evidence',
      v_reg.id USING ERRCODE='P0404';
  END IF;
  PERFORM 1 FROM public.rake_records r
   WHERE r.id=ANY(v_fee_source_rake_record_ids)
   ORDER BY r.club_id,r.id FOR UPDATE;

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,v_reg.id,true);
  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id;
  PERFORM public.fn_ca_escrow_apply(
    p_tournament_id,'unregister entitlement escrow prelock');
  SELECT * INTO v_escrow_before FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  SELECT count(*) INTO v_players_before FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status::text IN ('registered','playing');
  IF v_escrow_before.tournament_id IS NULL
     OR v_escrow_before.enforced IS DISTINCT FROM true
     OR v_players_before<=0
     OR v_t.current_players IS DISTINCT FROM v_players_before
     OR v_t.prize_pool IS DISTINCT FROM v_escrow_before.prize_balance
     OR v_t.bounty_pool IS DISTINCT FROM v_escrow_before.bounty_balance
     OR v_t.total_rake IS DISTINCT FROM v_escrow_before.fee_balance
     OR v_t.total_rake IS DISTINCT FROM v_rake_before
     OR v_t.prize_pool<v_refund_prize
     OR v_t.bounty_pool<v_refund_bounty
     OR v_t.total_rake<v_refund_fee THEN
    RAISE EXCEPTION 'registration % cannot leave divergent tournament state',v_reg.id
      USING ERRCODE='P0404';
  END IF;

  FOR v_ent IN
    SELECT e.* FROM public.tournament_refund_entitlements e
     WHERE e.tournament_id=p_tournament_id AND e.user_id=p_user_id
       AND (e.entitlement_kind='wallet_charge' OR e.registration_id=v_reg.id)
       AND NOT EXISTS(
         SELECT 1 FROM public.tournament_refund_tranches tr
          WHERE tr.entitlement_id=e.id)
       AND NOT EXISTS(
         SELECT 1 FROM public.tournament_tickets tk
          WHERE tk.source_refund_entitlement_id=e.id)
     ORDER BY e.entitlement_kind,e.id
  LOOP
    v_running_owed:=round(v_running_owed+v_ent.gross,2);
    v_settle:=public.fn_settle_tournament_refund_exact(
      p_tournament_id,p_user_id,v_ent.refund_wallet_club_id,v_running_owed,
      v_ent.refund_prize,v_ent.refund_bounty,v_ent.refund_fee,
      'fn_unregister_from_tournament',v_description);
    IF COALESCE((v_settle->>'ok')::boolean,false) IS NOT TRUE
       OR (v_settle->>'entitlement_id')::uuid IS DISTINCT FROM v_ent.id
       OR (v_settle->>'paid')::numeric IS DISTINCT FROM v_ent.gross
       OR (v_settle->>'amount_paid')::numeric IS DISTINCT FROM v_running_owed
       OR (v_settle->>'source_wallet_club_id')::uuid
            IS DISTINCT FROM v_ent.refund_wallet_club_id THEN
      RAISE EXCEPTION 'registration % exact wallet refund failed',v_reg.id
        USING ERRCODE='P0404';
    END IF;
    v_entitlement_ids:=array_append(v_entitlement_ids,v_ent.id);
    v_source_wallet_club_ids:=array_append(
      v_source_wallet_club_ids,v_ent.refund_wallet_club_id);
    v_credit_ledger_ids:=array_append(
      v_credit_ledger_ids,(v_settle->>'credit_ledger_id')::uuid);
    v_wallet_transaction_ids:=array_append(
      v_wallet_transaction_ids,(v_settle->>'wallet_transaction_id')::uuid);
  END LOOP;

  FOR v_fee_group IN
    SELECT r.club_id,round(sum(r.rake_amount),2) AS fee,
           array_agg(r.id ORDER BY r.id) AS source_rake_record_ids,
           array_agg(e.id ORDER BY e.id) AS entitlement_ids
      FROM public.rake_records r
      JOIN public.tournament_refund_entitlements e
        ON e.id=ANY(v_fee_entitlement_ids)
       AND e.refund_fee=r.rake_amount
       AND e.tournament_id=r.tournament_id
       AND e.user_id=p_user_id
       AND r.metadata->>'user_id'=e.user_id::text
       AND (
         (e.entitlement_kind='wallet_charge'
          AND e.charge_category='tournament_buyin'
          AND r.source IN (
            'fn_register_for_tournament','fn_register_horse_for_tournament')
          AND r.metadata->>'kind'='tournament_entry_fee'
          AND r.metadata->>'registration_id'=v_reg.id::text)
         OR (e.entitlement_kind='wallet_charge'
          AND e.charge_category='rebuy'
          AND r.source='process_tournament_rebuy'
          AND r.metadata->>'kind' IN (
            'tournament_rebuy_fee','tournament_reentry_fee'))
         OR (e.entitlement_kind='satellite_seat'
          AND r.source='fn_award_satellite_seat'
          AND r.metadata->>'kind'='satellite_seat_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text)
         OR (e.entitlement_kind='tournament_ticket'
          AND r.source='fn_register_for_tournament_with_ticket'
          AND r.metadata->>'kind'='tournament_ticket_entry_fee'
          AND r.metadata->>'registration_id'=e.registration_id::text))
      JOIN public.chip_ledger l
        ON l.id=e.source_ledger_id AND l.created_at=r.created_at
     WHERE r.id=ANY(v_fee_source_rake_record_ids)
     GROUP BY r.club_id ORDER BY r.club_id
  LOOP
    IF v_fee_group.fee>0 THEN
      INSERT INTO public.rake_records(
        hand_id,table_id,club_id,rake_amount,pot_size,num_players,
        bbj_contribution,is_tournament,tournament_id,source,metadata)
      VALUES(
        NULL,NULL,v_fee_group.club_id,-v_fee_group.fee,v_fee_group.fee,1,
        0,true,p_tournament_id,'fn_unregister_from_tournament',
        jsonb_build_object(
          'kind','tournament_fee_refund','user_id',p_user_id,
          'registration_id',v_reg.id,
          'fee_recipient_club_id',v_fee_group.club_id,
          'entitlement_ids',to_jsonb(v_fee_group.entitlement_ids),
          'original_rake_record_ids',
            to_jsonb(v_fee_group.source_rake_record_ids)))
      RETURNING id INTO v_fee_reversal_id;
      v_fee_reversal_ids:=array_append(
        v_fee_reversal_ids,v_fee_reversal_id);
      v_fees_reversed:=round(v_fees_reversed+v_fee_group.fee,2);
    END IF;
  END LOOP;
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_fee_reversal_ids
    FROM unnest(v_fee_reversal_ids) reversal(id);
  IF v_fees_reversed IS DISTINCT FROM v_refund_fee THEN
    RAISE EXCEPTION
      'registration % reversed % in exact fee rows but owes %',
      v_reg.id,v_fees_reversed,v_refund_fee USING ERRCODE='P0404';
  END IF;

  UPDATE public.tournaments
     SET current_players=v_players_before-1,
         prize_pool=round(v_t.prize_pool-v_refund_prize,2),
         bounty_pool=round(v_t.bounty_pool-v_refund_bounty,2),
         total_rake=round(v_t.total_rake-v_refund_fee,2),updated_at=now()
   WHERE id=p_tournament_id
     AND current_players IS NOT DISTINCT FROM v_players_before
     AND prize_pool IS NOT DISTINCT FROM v_t.prize_pool
     AND bounty_pool IS NOT DISTINCT FROM v_t.bounty_pool
     AND total_rake IS NOT DISTINCT FROM v_t.total_rake;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'registration % tournament cache changed',v_reg.id
      USING ERRCODE='55000';
  END IF;

  UPDATE public.table_seats s
     SET left_at=transaction_timestamp(),status='left',leave_pending=false,
         is_sitting_out=false,is_away=false,sit_out_at=NULL,
         scheduled_leave_hands=NULL
   WHERE s.user_id=p_user_id AND s.left_at IS NULL
     AND EXISTS(SELECT 1 FROM public.tables tb
                 WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id);
  UPDATE public.tables tb
     SET current_players=(SELECT count(*) FROM public.table_seats s
                           WHERE s.table_id=tb.id AND s.left_at IS NULL),
         updated_at=now()
   WHERE tb.tournament_id=p_tournament_id;
  DELETE FROM public.tournament_players tp WHERE tp.id=v_reg.id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'registration % was not deleted after settlement',v_reg.id
      USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_escrow_after FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id;
  SELECT round(COALESCE(sum(r.rake_amount),0),2) INTO v_rake_after
    FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  SELECT round(COALESCE(sum(w.amount),0),2) INTO v_wallet_refunds_after
    FROM public.wallet_transactions w
   WHERE w.related_entity_id=p_tournament_id AND w.user_id=p_user_id
     AND w.type='credit'
     AND lower(w.category) IN ('refund','tournament_refund');
  IF (SELECT count(*) FROM public.tournament_players tp
       WHERE tp.tournament_id=p_tournament_id
         AND tp.status::text IN ('registered','playing'))<>v_players_before-1
     OR v_wallet_refunds_after IS DISTINCT FROM
          round(v_wallet_refunds_before+v_wallet_amount,2)
     OR v_escrow_after.prize_balance IS DISTINCT FROM
          round(v_escrow_before.prize_balance-v_refund_prize,2)
     OR v_escrow_after.bounty_balance IS DISTINCT FROM
          round(v_escrow_before.bounty_balance-v_refund_bounty,2)
     OR v_escrow_after.fee_balance IS DISTINCT FROM
          round(v_escrow_before.fee_balance-v_refund_fee,2)
     OR v_rake_after IS DISTINCT FROM round(v_rake_before-v_refund_fee,2)
     OR NOT EXISTS(
       SELECT 1 FROM public.tournaments t
        WHERE t.id=p_tournament_id
          AND t.current_players=v_players_before-1
          AND t.prize_pool=v_escrow_after.prize_balance
          AND t.bounty_pool=v_escrow_after.bounty_balance
          AND t.total_rake=v_rake_after) THEN
    RAISE EXCEPTION 'registration % did not leave exact final state',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  IF p_expected_table_id IS NOT NULL THEN
    SELECT count(*) INTO v_seats_taken FROM public.table_seats s
     WHERE s.table_id=p_expected_table_id AND s.left_at IS NULL;
  END IF;

  -- Re-prove the chosen start authority after all money and seat work. Timed
  -- events still use the locked schedule cutoff; every product also treats a
  -- persisted hand as irreversible start truth; seat-first products further
  -- use status, started_at and completed launch truth. Any loss of the race
  -- rolls every preceding write back atomically.
  v_unregistered_at:=clock_timestamp();
  SELECT EXISTS (
           SELECT 1
             FROM public.hand_history hh
            WHERE hh.tournament_id=p_tournament_id
         ) OR EXISTS (
           SELECT 1
             FROM public.tables hand_table
             JOIN public.hand_history hh ON hh.table_id=hand_table.id
            WHERE hand_table.tournament_id=p_tournament_id
         )
    INTO v_persisted_hand_exists;
  IF v_persisted_hand_exists THEN
    RAISE EXCEPTION
      'tournament hand persisted before unregistration could commit'
      USING ERRCODE='55000';
  END IF;
  IF v_start_authority='scheduled_clock' THEN
    IF v_unregistered_at>=v_t.start_time THEN
      RAISE EXCEPTION 'tournament started before unregistration could commit'
        USING ERRCODE='55000';
    END IF;
  ELSE
    SELECT t.status::text,t.started_at,launch.completed_at
      INTO v_actual_status,v_actual_started_at,v_launch_completed_at
      FROM public.tournaments t
      LEFT JOIN public.tournament_launch_receipts launch
        ON launch.tournament_id=t.id
     WHERE t.id=p_tournament_id;
    IF upper(COALESCE(v_actual_status,'')) NOT IN ('ANNOUNCED','REGISTERING')
       OR v_actual_started_at IS NOT NULL
       OR v_launch_completed_at IS NOT NULL THEN
      RAISE EXCEPTION
        'seat-first tournament started before unregistration could commit'
        USING ERRCODE='55000';
    END IF;
  END IF;

  INSERT INTO public.tournament_unregistration_receipts(
    registration_id,request_id,tournament_id,user_id,source_table_id,
    refunded_chips,returned_ticket_value,entitlement_ids,ticket_ids,
    source_wallet_club_ids,credit_ledger_ids,wallet_transaction_ids,
    fees_reversed,fee_reversal_ids,fee_source_rake_record_ids,
    seat_number,seats_taken,scheduled_start_at,start_authority,settled_at)
  VALUES(
    v_reg.id,v_request_id,p_tournament_id,p_user_id,p_expected_table_id,
    v_wallet_amount,v_ticket_amount,v_entitlement_ids,v_ticket_ids,
    v_source_wallet_club_ids,v_credit_ledger_ids,v_wallet_transaction_ids,
    v_fees_reversed,v_fee_reversal_ids,v_fee_source_rake_record_ids,
    v_seat_number,v_seats_taken,v_t.start_time,v_start_authority,v_unregistered_at);
  v_receipt:=public.fn_ca_tournament_unregistration_receipt(
    p_tournament_id,p_user_id,p_expected_table_id,v_request_id);
  IF v_receipt IS NULL
     OR (v_receipt->>'registration_id')::uuid IS DISTINCT FROM v_reg.id THEN
    RAISE EXCEPTION 'registration % has no exact unregistration receipt',v_reg.id
      USING ERRCODE='P0404';
  END IF;
  RETURN v_receipt||jsonb_build_object('replayed',false);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.atomic_cancel_tournament(p_tournament_id uuid, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid := COALESCE(
    auth.uid(),p_admin_id,'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid);
  v_t public.tournaments%ROWTYPE;
  v_stored public.tournament_cancellation_receipts%ROWTYPE;
  v_e public.tournament_escrow%ROWTYPE;
  v_player record;
  v_entitlement public.tournament_refund_entitlements%ROWTYPE;
  v_fee record;
  v_contribution public.spin_reserve_ledger%ROWTYPE;
  v_draw public.spin_reserve_ledger%ROWTYPE;
  v_pool public.spin_bonus_pools%ROWTYPE;
  v_settle jsonb;
  v_receipt jsonb;
  v_refunds jsonb := '[]'::jsonb;
  v_ticket_returns jsonb := '[]'::jsonb;
  v_source_player_ids uuid[] := ARRAY[]::uuid[];
  v_refunded_registration_ids uuid[] := ARRAY[]::uuid[];
  v_ticket_return_ids uuid[] := ARRAY[]::uuid[];
  v_zero_refund_registration_ids uuid[] := ARRAY[]::uuid[];
  v_closed_table_ids uuid[] := ARRAY[]::uuid[];
  v_source_seat_ids uuid[] := ARRAY[]::uuid[];
  v_released_seat_ids uuid[] := ARRAY[]::uuid[];
  v_fee_reversal_ids uuid[] := ARRAY[]::uuid[];
  v_registration_id uuid;
  v_fee_reversal_id uuid;
  v_original_entry_journal_id uuid;
  v_original_draw_journal_id uuid;
  v_draw_reversal_id uuid;
  v_draw_reversal_journal_id uuid;
  v_contribution_reversal_id uuid;
  v_contribution_reversal_journal_id uuid;
  v_spin_unwind_id uuid;
  v_source_player_count integer := 0;
  v_refunded_count integer := 0;
  v_refund_line_count integer := 0;
  v_ticket_return_count integer := 0;
  v_zero_refund_count integer := 0;
  v_closed_table_count integer := 0;
  v_source_seat_count integer := 0;
  v_released_seat_count integer := 0;
  v_total_refunded numeric := 0;
  v_total_ticket_returned numeric := 0;
  v_fees_reversed numeric := 0;
  v_total_rake_before numeric := 0;
  v_total_rake_after numeric := 0;
  v_total_owed numeric;
  v_draw_amount numeric := 0;
  v_pool_balance_before numeric;
  v_pool_balance_after numeric;
  v_rows integer;
  v_journal_count integer;
  v_cancelled_at timestamptz := transaction_timestamp();
  v_close_note constant text := 'atomic cancellation receipt: exact zero';
BEGIN
  -- Every terminal authority takes this lock before any row lock. Cancellation,
  -- satellite finish and cash finish can touch the same wallets and event rows.
  PERFORM smarter_private.cancellation_lane(p_tournament_id);
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Tournament id is required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;
  -- DIAMOND PHASE 8: a Diamond event is cancelled by its own authority, which
  -- returns every entry from custody and writes the same immutable receipt;
  -- the chip rails below never saw a Diamond entry.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    RETURN public.fn_poker_diamond_tournament_cancel(p_tournament_id, p_admin_id);
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.fn_can_create_games(v_t.club_id,v_uid) THEN
    RAISE EXCEPTION 'Only the governed game operator may cancel a tournament'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_stored FROM public.tournament_cancellation_receipts h
   WHERE h.tournament_id=p_tournament_id FOR UPDATE;
  IF FOUND THEN
    RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id,NULL);
  END IF;
  IF upper(COALESCE(v_t.status::text,'')) IN
       ('COMPLETED','CANCELLED','CANCELED','COMPLETING') THEN
    RAISE EXCEPTION 'Tournament is already %',v_t.status USING ERRCODE='55000';
  END IF;

  -- A tournament that has started is resumed or settled, never voided.
  -- start_time is a schedule/fill deadline; it is not proof that play began.
  -- The stored receipt above remains replayable without another cancellation.
  IF v_t.started_at IS NOT NULL
     OR upper(COALESCE(v_t.status::text,'')) IN ('RUNNING','BREAK')
     OR COALESCE(v_t.spin_multiplier,0)>0
     OR EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.spin_draw_receipts r
                 WHERE r.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
                 WHERE r.tournament_id=p_tournament_id AND r.kind='jackpot_draw')
     OR EXISTS (SELECT 1 FROM public.hand_history hh
                 WHERE hh.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tables tb
                 JOIN public.hand_history hh ON hh.table_id=tb.id
                 WHERE tb.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                 WHERE o.tournament_id=p_tournament_id
                   AND o.kind<>'refund' AND o.amount_paid>0) THEN
    RAISE EXCEPTION
      'Tournament has started or committed awards; resume or settle it instead of cancelling'
      USING ERRCODE='55000';
  END IF;

  PERFORM public.fn_lock_accounting_tournament_recognition_week(p_tournament_id,transaction_timestamp());

  -- Freeze every identity before any payer runs. Any concurrent registration,
  -- seat move or hand settlement either committed before these locks and is in
  -- the receipt, or waits behind this transaction and sees a terminal parent.
  PERFORM 1 FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
   ORDER BY tp.user_id,tp.id FOR UPDATE;
  PERFORM 1 FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id ORDER BY tb.id FOR UPDATE;
  PERFORM 1 FROM public.table_seats s
   JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id
   ORDER BY s.table_id,s.id FOR UPDATE OF s;
  SELECT COALESCE(array_agg(tp.id ORDER BY tp.id),ARRAY[]::uuid[])
    INTO v_source_player_ids FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id;
  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id),ARRAY[]::uuid[])
    INTO v_closed_table_ids FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id;
  SELECT COALESCE(array_agg(s.id ORDER BY s.table_id,s.id),ARRAY[]::uuid[])
    INTO v_source_seat_ids FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id;
  v_source_player_count := cardinality(v_source_player_ids);
  v_closed_table_count := cardinality(v_closed_table_ids);
  v_source_seat_count := cardinality(v_source_seat_ids);

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,tp.id,true)
    FROM public.tournament_players tp WHERE tp.tournament_id=p_tournament_id ORDER BY tp.id;
  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id;
  PERFORM public.fn_ca_escrow_apply(
    p_tournament_id,'atomic cancellation escrow prelock');
  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  IF v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR v_t.prize_pool IS DISTINCT FROM v_e.prize_balance
     OR v_t.bounty_pool IS DISTINCT FROM v_e.bounty_balance
     OR v_t.total_rake IS DISTINCT FROM v_e.fee_balance THEN
    RAISE EXCEPTION 'tournament % caches do not equal exact escrow before cancellation',
      p_tournament_id USING ERRCODE='P0404';
  END IF;

  -- A booked Spin first gives back its draw, then withdraws this event's own
  -- contribution. Each pool movement creates its strict journal before the
  -- matching immutable reversal row and all four ids are stored together.
  PERFORM 1 FROM public.spin_reserve_ledger r
   WHERE r.tournament_id=p_tournament_id ORDER BY r.created_at,r.id FOR UPDATE;
  SELECT * INTO v_contribution FROM public.spin_reserve_ledger r
   WHERE r.tournament_id=p_tournament_id AND r.kind='contribution';
  IF FOUND THEN
    IF (SELECT count(*) FROM public.spin_reserve_ledger r
         WHERE r.tournament_id=p_tournament_id AND r.kind='contribution') <> 1
       OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
                   WHERE r.tournament_id=p_tournament_id
                     AND r.kind IN ('draw_reversal','contribution_reversal'))
       OR EXISTS (SELECT 1 FROM public.tournament_spin_cancellation_unwinds u
                   WHERE u.tournament_id=p_tournament_id) THEN
      RAISE EXCEPTION 'Spin % has an ambiguous or partially unwound reserve contract',
        p_tournament_id USING ERRCODE='P0404';
    END IF;
    SELECT * INTO v_draw FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id AND r.kind='jackpot_draw';
    IF FOUND AND (SELECT count(*) FROM public.spin_reserve_ledger r
                   WHERE r.tournament_id=p_tournament_id
                     AND r.kind='jackpot_draw') <> 1 THEN
      RAISE EXCEPTION 'Spin % has more than one immutable draw',p_tournament_id
        USING ERRCODE='P0404';
    END IF;
    SELECT * INTO v_pool FROM public.spin_bonus_pools p
     WHERE p.club_id=v_contribution.club_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Spin % original reserve owner is missing',p_tournament_id
        USING ERRCODE='P0404';
    END IF;
    v_pool_balance_before := v_pool.balance;
    IF v_pool_balance_before IS NULL
       OR v_pool_balance_before::text IN ('NaN','Infinity','-Infinity')
       OR v_pool_balance_before<0 THEN
      RAISE EXCEPTION 'Spin % reserve balance is invalid',p_tournament_id
        USING ERRCODE='22003';
    END IF;
    SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_journal_count,v_original_entry_journal_id
      FROM public.chip_ledger l
     WHERE l.tournament_id=p_tournament_id
       AND l.category='spin_entry'
       AND l.from_type='prize_liability'
       AND l.from_entity_id=p_tournament_id
       AND l.to_type='spin_reserve' AND l.to_entity_id=v_pool.id
       AND l.amount=v_contribution.amount;
    IF v_journal_count<>1 OR v_contribution.amount<=0 THEN
      RAISE EXCEPTION 'Spin % contribution has no single exact journal',p_tournament_id
        USING ERRCODE='P0404';
    END IF;

    IF v_draw.id IS NOT NULL THEN
      IF v_draw.club_id IS DISTINCT FROM v_contribution.club_id
         OR v_draw.amount>=0 THEN
        RAISE EXCEPTION 'Spin % draw disagrees with its contribution owner',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
      v_draw_amount := round(-v_draw.amount,2);
      SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
        INTO v_journal_count,v_original_draw_journal_id
        FROM public.chip_ledger l
       WHERE l.tournament_id=p_tournament_id
         AND l.category='spin_prize'
         AND l.from_type='spin_reserve' AND l.from_entity_id=v_pool.id
         AND l.to_type='prize_liability' AND l.to_entity_id=p_tournament_id
         AND l.amount=v_draw_amount;
      IF v_journal_count<>1 THEN
        RAISE EXCEPTION 'Spin % draw has no single exact journal',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
      PERFORM public.fn_ca_declare_ledger(
        'reversal','prize_liability',p_tournament_id,NULL,
        'spin:'||p_tournament_id::text||':cancel:draw',NULL);
      UPDATE public.spin_bonus_pools
         SET balance=balance+v_draw_amount,updated_at=now()
       WHERE id=v_pool.id RETURNING balance INTO v_pool_balance_after;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Spin % reserve vanished during draw reversal',p_tournament_id
          USING ERRCODE='55000';
      END IF;
      INSERT INTO public.spin_reserve_ledger
        (club_id,tournament_id,kind,amount,balance_after,multiplier,
         buy_in,seats,house_rake,note)
      VALUES
        (v_draw.club_id,p_tournament_id,'draw_reversal',v_draw_amount,
         v_pool_balance_after,v_draw.multiplier,v_draw.buy_in,v_draw.seats,
         v_draw.house_rake,'atomic cancellation reversed the exact reserve draw')
      RETURNING id INTO v_draw_reversal_id;
      SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
        INTO v_journal_count,v_draw_reversal_journal_id
        FROM public.chip_ledger l
       WHERE l.idempotency_key='spin:'||p_tournament_id::text||':cancel:draw'
         AND l.tournament_id=p_tournament_id AND l.category='reversal'
         AND l.from_type='prize_liability' AND l.from_entity_id=p_tournament_id
         AND l.to_type='spin_reserve' AND l.to_entity_id=v_pool.id
         AND l.amount=v_draw_amount;
      IF v_journal_count<>1 THEN
        RAISE EXCEPTION 'Spin % draw reversal has no single exact journal',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
    ELSE
      v_pool_balance_after := v_pool_balance_before;
    END IF;

    IF v_pool_balance_after<v_contribution.amount THEN
      RAISE EXCEPTION 'Spin % reserve cannot return its own contribution',p_tournament_id
        USING ERRCODE='P0403';
    END IF;
    PERFORM public.fn_ca_declare_ledger(
      'reversal','prize_liability',p_tournament_id,NULL,
      'spin:'||p_tournament_id::text||':cancel:entry',NULL);
    UPDATE public.spin_bonus_pools
       SET balance=balance-v_contribution.amount,updated_at=now()
     WHERE id=v_pool.id RETURNING balance INTO v_pool_balance_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Spin % reserve vanished during contribution reversal',p_tournament_id
        USING ERRCODE='55000';
    END IF;
    INSERT INTO public.spin_reserve_ledger
      (club_id,tournament_id,kind,amount,balance_after,multiplier,
       buy_in,seats,house_rake,note)
    VALUES
      (v_contribution.club_id,p_tournament_id,'contribution_reversal',
       -v_contribution.amount,v_pool_balance_after,v_contribution.multiplier,
       v_contribution.buy_in,v_contribution.seats,v_contribution.house_rake,
       'atomic cancellation returned the exact entry contribution')
    RETURNING id INTO v_contribution_reversal_id;
    SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_journal_count,v_contribution_reversal_journal_id
      FROM public.chip_ledger l
     WHERE l.idempotency_key='spin:'||p_tournament_id::text||':cancel:entry'
       AND l.tournament_id=p_tournament_id AND l.category='reversal'
       AND l.from_type='spin_reserve' AND l.from_entity_id=v_pool.id
       AND l.to_type='prize_liability' AND l.to_entity_id=p_tournament_id
       AND l.amount=v_contribution.amount;
    IF v_journal_count<>1 THEN
      RAISE EXCEPTION 'Spin % contribution reversal has no single exact journal',
        p_tournament_id USING ERRCODE='P0404';
    END IF;
    INSERT INTO public.tournament_spin_cancellation_unwinds(
      tournament_id,pool_id,reserve_owner_id,
      original_contribution_id,original_draw_id,
      original_entry_journal_id,original_draw_journal_id,
      draw_reversal_id,draw_reversal_journal_id,
      contribution_reversal_id,contribution_reversal_journal_id,
      contribution_amount,draw_amount,pool_balance_before,pool_balance_after,
      settled_at)
    VALUES(
      p_tournament_id,v_pool.id,v_contribution.club_id,
      v_contribution.id,v_draw.id,
      v_original_entry_journal_id,v_original_draw_journal_id,
      v_draw_reversal_id,v_draw_reversal_journal_id,
      v_contribution_reversal_id,v_contribution_reversal_journal_id,
      v_contribution.amount,v_draw_amount,v_pool_balance_before,
      v_pool_balance_after,v_cancelled_at)
    RETURNING tournament_id INTO v_spin_unwind_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id
       AND r.kind IN ('jackpot_draw','draw_reversal','contribution_reversal')) THEN
    RAISE EXCEPTION 'Spin % has reserve evidence without its contribution',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  -- Return each unconsumed funded entitlement as cash to its recorded club.
  -- The exact refund payer proves wallet, satellite transfer or redeemed-ticket
  -- funding and excludes value already returned as a ticket. Stored historical
  -- cancellation receipts continue to replay through their original evidence.
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_entitlements e
    JOIN public.tournament_players tp ON tp.id=e.registration_id
    JOIN public.tournament_tickets tk
      ON tk.source_refund_entitlement_id=e.id
   WHERE e.tournament_id=p_tournament_id
     AND tp.tournament_id=p_tournament_id) THEN
    RAISE EXCEPTION 'active qualifier roster already has an unreceipted return ticket'
      USING ERRCODE='P0404';
  END IF;
  /* A DISPOSED ENTITLEMENT DOES NOT BLOCK A CANCELLATION (2026-10-05).

     This guard exists to catch an entitlement the refund loop below would
     MISS: one still owed money with no roster row to pay it through. It
     used to demand a live tournament_players row for EVERY entitlement,
     which is strictly stronger than the loop's own rule. The loop selects
     an entitlement only when it has no tournament_refund_tranches row and
     no tournament_tickets return - this function's own definition of
     "already disposed" - so an entitlement holding either of those is
     settled evidence the loop would never pay a second time, and demanding
     a roster row for it refused a cancellation that was in fact complete.

     The roster row is exactly what goes missing: fn_ca_unregister_tournament
     _player_exact DELETEs tournament_players when it refunds a registration,
     while tournament_refund_entitlements is append-only and carries no
     disposed marker, so the two can never be reconciled by repair - only by
     reading the tranche, which is what the loop already does.

     Measured on Deep Stack Society, 2026-10-05: 561 entitlements across 29
     events, every one paid in full through that authority (sum paid 5506.00
     = sum entitled 5506.00; none partial, none untranched) with every roster
     row deleted. Those 29 events could therefore never reach CANCELLED, and
     the club could never be retired at all, because fn_retire_settled_club
     refuses while any tournament is still active.

     The two arms now agree by construction: an entitlement trips this guard
     only if the loop would have wanted to pay it. An untranched, unticketed
     entitlement with no roster row still raises - the case this was written
     for. The ticket arm is unexercised by the measurement above (no return
     tickets exist for those events) and stays guarded on the dangerous side
     by the unreceipted-return-ticket check immediately preceding, which
     still refuses a ticketed entitlement whose qualifier is on the roster. */
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_entitlements e
    LEFT JOIN public.tournament_players tp
      ON tp.tournament_id=e.tournament_id AND tp.user_id=e.user_id
   WHERE e.tournament_id=p_tournament_id
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id)
     AND (tp.id IS NULL OR (e.entitlement_kind IN (
            'satellite_seat','tournament_ticket')
          AND e.registration_id IS DISTINCT FROM tp.id))) THEN
    RAISE EXCEPTION 'refund entitlement is detached from the frozen roster'
      USING ERRCODE='P0404';
  END IF;
  FOR v_player IN
    SELECT DISTINCT ON (tp.user_id) tp.id,tp.user_id
      FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id IS NOT NULL
     ORDER BY tp.user_id,tp.id
  LOOP
    -- The owner-only plan validates every source ledger, wallet debit and
    -- escrow rail. Identity comes from the locked entitlement table below.
    PERFORM 1 FROM public.fn_ca_tournament_refund_plan(
      p_tournament_id,v_player.user_id);
    LOOP
      SELECT e.* INTO v_entitlement
        FROM public.tournament_refund_entitlements e
       WHERE e.tournament_id=p_tournament_id
         AND e.user_id=v_player.user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_refund_tranches tr
            WHERE tr.entitlement_id=e.id)
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_tickets tk
            WHERE tk.source_refund_entitlement_id=e.id)
       ORDER BY e.entitlement_kind,e.id
       LIMIT 1 FOR UPDATE OF e;
      EXIT WHEN NOT FOUND;
      v_registration_id:=COALESCE(v_entitlement.registration_id,v_player.id);
      IF v_entitlement.entitlement_kind IN (
          'wallet_charge','satellite_seat','tournament_ticket') THEN
        SELECT COALESCE(o.amount_paid,0)+v_entitlement.gross
          INTO v_total_owed FROM public.tournament_obligations o
         WHERE o.tournament_id=p_tournament_id AND o.kind='refund'
           AND o.place IS NULL AND o.user_id=v_player.user_id FOR UPDATE;
        IF NOT FOUND THEN v_total_owed:=v_entitlement.gross; END IF;
        v_settle:=public.fn_settle_tournament_refund_exact(
          p_tournament_id,v_player.user_id,
          v_entitlement.refund_wallet_club_id,v_total_owed,
          v_entitlement.refund_prize,v_entitlement.refund_bounty,
          v_entitlement.refund_fee,'atomic_cancel_tournament',
          'Tournament cancellation refund: '||COALESCE(v_t.name,'Unknown'));
        IF COALESCE((v_settle->>'ok')::boolean,false) IS NOT TRUE
           OR COALESCE((v_settle->>'fully_settled')::boolean,false) IS NOT TRUE
           OR COALESCE((v_settle->>'remaining')::numeric,-1)<>0
           OR (v_settle->>'entitlement_id')::uuid
                IS DISTINCT FROM v_entitlement.id
           OR v_settle->>'entitlement_kind' IS DISTINCT FROM v_entitlement.entitlement_kind
           OR (v_settle->>'paid')::numeric IS DISTINCT FROM v_entitlement.gross
           OR (v_settle->>'refund_prize')::numeric
                IS DISTINCT FROM v_entitlement.refund_prize
           OR (v_settle->>'refund_bounty')::numeric
                IS DISTINCT FROM v_entitlement.refund_bounty
           OR (v_settle->>'refund_fee')::numeric
                IS DISTINCT FROM v_entitlement.refund_fee THEN
          RAISE EXCEPTION 'exact cancellation refund refused entitlement %: %',
            v_entitlement.id,v_settle USING ERRCODE='55000';
        END IF;
        v_refunds:=v_refunds||jsonb_build_array(jsonb_build_object(
          'registration_id',v_registration_id,
          'user_id',v_player.user_id,
          'entitlement_id',v_entitlement.id,
          'entitlement_kind',v_entitlement.entitlement_kind,
          'source_wallet_club_id',v_entitlement.refund_wallet_club_id,
          'gross_paid',v_entitlement.gross,
          'amount_paid_before',(v_settle->>'already_paid')::numeric,
          'amount_paid_now',(v_settle->>'paid')::numeric,
          'refund_prize',(v_settle->>'refund_prize')::numeric,
          'refund_bounty',(v_settle->>'refund_bounty')::numeric,
          'refund_fee',(v_settle->>'refund_fee')::numeric,
          'obligation_id',(v_settle->>'obligation_id')::uuid,
          'idempotency_key',v_settle->>'idempotency_key',
          'credit_ledger_id',(v_settle->>'credit_ledger_id')::uuid,
          'wallet_transaction_id',(v_settle->>'wallet_transaction_id')::uuid));
        v_refund_line_count:=v_refund_line_count+1;
        v_total_refunded:=round(
          v_total_refunded+(v_settle->>'paid')::numeric,2);
      ELSE
        RAISE EXCEPTION 'unknown cancellation entitlement kind %',
          v_entitlement.entitlement_kind USING ERRCODE='P0404';
      END IF;
      IF NOT v_registration_id=ANY(v_refunded_registration_ids) THEN
        v_refunded_registration_ids:=array_append(
          v_refunded_registration_ids,v_registration_id);
      END IF;
    END LOOP;
  END LOOP;
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_refunded_registration_ids
    FROM unnest(v_refunded_registration_ids) ids(id);
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_zero_refund_registration_ids
    FROM unnest(v_source_player_ids) ids(id)
   WHERE NOT id=ANY(v_refunded_registration_ids);
  v_refunded_count:=cardinality(v_refunded_registration_ids);
  v_zero_refund_count:=cardinality(v_zero_refund_registration_ids);

  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.fn_ca_tournament_refund_plan(
                    p_tournament_id,tp.user_id))) THEN
    RAISE EXCEPTION 'cancellation left a refundable entitlement unpaid'
      USING ERRCODE='55000';
  END IF;

  -- Rake reversal is attribution only: the exact refund payer already returned
  -- the fee component from escrow. Reverse each current player's net fee and
  -- each aggregate Spin source exactly once, retaining immutable source ids.
  IF EXISTS (SELECT 1 FROM public.rake_records r
              WHERE r.tournament_id=p_tournament_id
                AND r.source='atomic_cancel_tournament') THEN
    RAISE EXCEPTION 'unreceipted cancellation rake evidence already exists'
      USING ERRCODE='P0404';
  END IF;
  SELECT round(COALESCE(sum(r.rake_amount),0),2)
    INTO v_total_rake_before FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  IF v_total_rake_before<0
     OR v_total_rake_before::text IN ('NaN','Infinity','-Infinity')
     OR round(COALESCE(v_t.total_rake,0),2) IS DISTINCT FROM v_total_rake_before THEN
    RAISE EXCEPTION 'tournament % rake cache and evidence disagree',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  FOR v_fee IN
    SELECT tp.user_id,r.club_id,
           round(sum(r.rake_amount),2) AS amount,
           jsonb_agg(r.id ORDER BY r.id) AS source_ids
      FROM (SELECT DISTINCT p.user_id FROM public.tournament_players p
             WHERE p.tournament_id=p_tournament_id AND p.user_id IS NOT NULL) tp
      JOIN public.rake_records r
        ON r.tournament_id=p_tournament_id AND r.is_tournament
       AND r.metadata->>'user_id'=tp.user_id::text
     GROUP BY tp.user_id,r.club_id HAVING round(sum(r.rake_amount),2)>0
     ORDER BY tp.user_id,r.club_id
  LOOP
    INSERT INTO public.rake_records(
      hand_id,table_id,club_id,rake_amount,pot_size,num_players,
      bbj_contribution,is_tournament,tournament_id,source,metadata)
    VALUES(NULL,NULL,v_fee.club_id,-v_fee.amount,v_fee.amount,1,0,true,
      p_tournament_id,'atomic_cancel_tournament',jsonb_build_object(
        'kind','tournament_fee_refund','user_id',v_fee.user_id,
        'original_rake_record_ids',v_fee.source_ids))
    RETURNING id INTO v_fee_reversal_id;
    v_fee_reversal_ids:=array_append(v_fee_reversal_ids,v_fee_reversal_id);
    v_fees_reversed:=round(v_fees_reversed+v_fee.amount,2);
  END LOOP;
  FOR v_fee IN
    SELECT r.*,round(r.rake_amount+COALESCE((SELECT sum(rr.rake_amount)
      FROM public.rake_records rr WHERE rr.tournament_id=p_tournament_id
       AND rr.source='atomic_cancel_tournament'
       AND rr.metadata->>'original_rake_record_id'=r.id::text),0),2) AS amount
      FROM public.rake_records r
     WHERE r.tournament_id=p_tournament_id AND r.is_tournament
       AND r.source IN ('fn_spin_book_entry','fn_spin_settle_game')
       AND r.rake_amount>0 AND NULLIF(r.metadata->>'user_id','') IS NULL
     ORDER BY r.id FOR UPDATE
  LOOP
    IF v_fee.amount>0 THEN
      INSERT INTO public.rake_records(
        hand_id,table_id,club_id,rake_amount,pot_size,num_players,
        bbj_contribution,is_tournament,tournament_id,source,
        player_contributions,metadata)
      VALUES(NULL,NULL,v_fee.club_id,-v_fee.amount,v_fee.pot_size,
        v_fee.num_players,0,true,p_tournament_id,'atomic_cancel_tournament',
        v_fee.player_contributions,jsonb_build_object(
          'kind','spin_rake_refund','original_source',v_fee.source,
          'original_rake_record_id',v_fee.id))
      RETURNING id INTO v_fee_reversal_id;
      v_fee_reversal_ids:=array_append(v_fee_reversal_ids,v_fee_reversal_id);
      v_fees_reversed:=round(v_fees_reversed+v_fee.amount,2);
    END IF;
  END LOOP;
  SELECT round(COALESCE(sum(r.rake_amount),0),2)
    INTO v_total_rake_after FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  IF v_total_rake_after IS DISTINCT FROM 0::numeric
     OR v_fees_reversed IS DISTINCT FROM v_total_rake_before THEN
    RAISE EXCEPTION 'tournament % fee reversal did not close exactly',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  IF v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR v_e.prize_balance IS DISTINCT FROM 0::numeric
     OR v_e.bounty_balance IS DISTINCT FROM 0::numeric
     OR v_e.fee_balance IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'tournament % cancellation did not close all escrow banks',
      p_tournament_id USING ERRCODE='P0404';
  END IF;
  UPDATE public.tournament_escrow
     SET closed_at=v_cancelled_at,close_note=v_close_note,updated_at=now()
   WHERE tournament_id=p_tournament_id AND closed_at IS NULL
     AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament % lost its exact-zero escrow close',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  UPDATE public.tournament_players
     SET status='eliminated',eliminated_at=v_cancelled_at,
         chips=0,current_bounty=0
   WHERE tournament_id=p_tournament_id;
  WITH released AS (
    UPDATE public.table_seats s
       SET left_at=v_cancelled_at,status='left',leave_pending=false,
           is_sitting_out=false,is_away=false,sit_out_at=NULL,
           scheduled_leave_hands=NULL
      FROM public.tables tb
     WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id
       AND s.left_at IS NULL RETURNING s.id)
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_released_seat_ids FROM released;
  v_released_seat_count:=cardinality(v_released_seat_ids);
  UPDATE public.table_seats s
     SET status='left',leave_pending=false,is_sitting_out=false,is_away=false,
         sit_out_at=NULL,scheduled_leave_hands=NULL
   WHERE s.id=ANY(v_source_seat_ids) AND s.left_at IS NOT NULL;

  UPDATE public.tournaments
     SET status='CANCELLED',ended_at=v_cancelled_at,updated_at=now(),
         prize_pool=0,bounty_pool=0,total_rake=0,current_players=0,
         on_break=false,break_started_at=NULL,break_ends_at=NULL
   WHERE id=p_tournament_id
     AND upper(COALESCE(status::text,'')) NOT IN
         ('COMPLETED','CANCELLED','CANCELED','COMPLETING');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament % lost its cancellation lifecycle claim',
      p_tournament_id USING ERRCODE='55000';
  END IF;
  UPDATE public.tables
     SET status='closed',lifecycle='closed',current_players=0,
         terminal_closed_at=v_cancelled_at,updated_at=now()
   WHERE tournament_id=p_tournament_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>v_closed_table_count THEN
    RAISE EXCEPTION 'tournament % did not close every table',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_fee_reversal_ids FROM unnest(v_fee_reversal_ids) ids(id);
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_ticket_return_ids FROM unnest(v_ticket_return_ids) ids(id);
  v_receipt:=jsonb_build_object(
    'ok',true,'success',true,'fully_settled',true,'receipt_version',2,
    'tournament_id',p_tournament_id,'actor_id',v_actor,'status','CANCELLED',
    'source_player_count',v_source_player_count,
    'refunded_count',v_refunded_count,'refund_line_count',v_refund_line_count,
    'ticket_return_count',v_ticket_return_count,
    'total_ticket_returned',v_total_ticket_returned,
    'total_refunded',v_total_refunded,'fees_reversed',v_fees_reversed,
    'closed_table_count',v_closed_table_count,
    'source_seat_count',v_source_seat_count,
    'released_seat_count',v_released_seat_count,
    'refunds',v_refunds,'ticket_returns',v_ticket_returns,
    'settled_at',v_cancelled_at);
  INSERT INTO public.tournament_cancellation_receipts(
    tournament_id,actor_id,receipt_version,
    source_player_count,source_player_ids,
    refunded_count,refunded_registration_ids,refund_line_count,
    ticket_return_count,ticket_return_ids,total_ticket_returned,
    zero_refund_count,zero_refund_registration_ids,
    total_refunded,fees_reversed,total_rake_before,total_rake_after,
    closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,
    released_seat_count,released_seat_ids,fee_reversal_ids,
    escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,
    receipt,settled_at)
  VALUES(
    p_tournament_id,v_actor,2,
    v_source_player_count,v_source_player_ids,
    v_refunded_count,v_refunded_registration_ids,v_refund_line_count,
    v_ticket_return_count,v_ticket_return_ids,v_total_ticket_returned,
    v_zero_refund_count,v_zero_refund_registration_ids,
    v_total_refunded,v_fees_reversed,v_total_rake_before,v_total_rake_after,
    v_closed_table_count,v_closed_table_ids,v_source_seat_count,v_source_seat_ids,
    v_released_seat_count,v_released_seat_ids,v_fee_reversal_ids,
    v_cancelled_at,v_close_note,v_spin_unwind_id,v_receipt,v_cancelled_at);

  PERFORM public.fn_record_accounting_tournament_cancellation(p_tournament_id);
  RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id,v_actor);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_freerolls_are_free_buy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed jsonb := '{}'::jsonb;
  v_stack   integer;
  v_op      text;
  v_price   numeric;
BEGIN
  IF NOT public.fn_is_free_buy_event(
       NEW.buy_in_amount, NEW.buy_in_fee, NEW.tournament_type, NEW.variant
     ) THEN
    RETURN NEW;
  END IF;

  -- A live or finished event keeps the contract its players entered under.
  -- Inserts are always pre-start.
  IF TG_OP = 'UPDATE'
     AND upper(COALESCE(NEW.status, '')) NOT IN ('ANNOUNCED', 'REGISTERING') THEN
    RETURN NEW;
  END IF;

  -- Midway's November 2 format supersedes add-ons and fixed guarantees.
  -- A pre-existing registered legacy event is converted explicitly in this
  -- migration, with its sponsor funding in the same transaction.
  IF (NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid
      OR NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
     AND NEW.free_buy AND NEW.satellite_target_id IS NULL
     AND lower(coalesce(NEW.variant,''))<>'satellite' THEN
    IF TG_OP='UPDATE' AND NOT coalesce(OLD.is_pko,false)
       AND EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=NEW.id) THEN
      RETURN NEW;
    END IF;
    NEW.is_bounty:=true; NEW.is_pko:=true; NEW.is_mystery_bounty:=false;
    NEW.bounty_amount:=1; NEW.guaranteed_prize:=0; NEW.buy_in_fee:=0;
    NEW.is_rebuy:=true; NEW.is_reentry:=true; NEW.rebuy_cost:=1;
    IF TG_OP='INSERT' THEN
      NEW.rebuy_chips:=CASE WHEN coalesce(NEW.rebuy_chips,0)>0 THEN NEW.rebuy_chips
        ELSE coalesce(nullif(NEW.starting_chips,0),10000) END;
      NEW.rebuy_levels:=CASE WHEN coalesce(NEW.rebuy_levels,0)>0 THEN NEW.rebuy_levels ELSE 4 END;
    END IF;
    NEW.add_on_available:=false; NEW.addon_from_start:=false;
    NEW.addon_cost:=NULL; NEW.addon_chips:=NULL; NEW.addon_levels:=NULL;
    NEW.short_description:='Free Entry. Midway Promo Funds Your 1-Chip Bounty. 1-Chip Rebuys. No Add-Ons Or Rake. All Prizes Are Bounties: 50% To Your Wallet, 50% To Your Head. The Winner Keeps Their Bounty.';
    RETURN NEW;
  END IF;
  v_stack := COALESCE(NULLIF(NEW.starting_chips, 0), 10000);

  /* EVERY FREEROLL REBUY AND ADD-ON HAS ONE PRICE (Dan 2026-10-16): "ALL REBUY
     ADD ON'S FOR MIDWAY UNION ARE 1 CHIP REBUY ADD ON NOT 2, DIAMOND REBUYS
     ARE 100 DIAMONDS (ONE DOLLAR)". 1 in a chip club, 100 in a Diamond club.
     The 2026-09-04 exception that let a scheduled Free Buy charge 2 is gone. */
  v_price := CASE
    WHEN EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds')
      THEN 100.00
    ELSE 1.00
  END;

  IF NEW.buy_in_fee IS DISTINCT FROM 0 THEN
    v_changed := v_changed || jsonb_build_object('buy_in_fee',
      jsonb_build_object('from', NEW.buy_in_fee, 'to', 0));
    NEW.buy_in_fee := 0;
  END IF;

  IF NOT COALESCE(NEW.is_rebuy, false) THEN
    v_changed := v_changed || jsonb_build_object('is_rebuy',
      jsonb_build_object('from', NEW.is_rebuy, 'to', true));
    NEW.is_rebuy := true;
  END IF;

  IF NOT COALESCE(NEW.add_on_available, false) THEN
    v_changed := v_changed || jsonb_build_object('add_on_available',
      jsonb_build_object('from', NEW.add_on_available, 'to', true));
    NEW.add_on_available := true;
  END IF;

  IF NEW.rebuy_cost IS DISTINCT FROM v_price THEN
    v_changed := v_changed || jsonb_build_object('rebuy_cost',
      jsonb_build_object('from', NEW.rebuy_cost, 'to', v_price));
    NEW.rebuy_cost := v_price;
  END IF;

  IF NEW.addon_cost IS DISTINCT FROM v_price THEN
    v_changed := v_changed || jsonb_build_object('addon_cost',
      jsonb_build_object('from', NEW.addon_cost, 'to', v_price));
    NEW.addon_cost := v_price;
  END IF;

  IF COALESCE(NEW.rebuy_chips, 0) <= 0 THEN
    v_changed := v_changed || jsonb_build_object('rebuy_chips',
      jsonb_build_object('from', NEW.rebuy_chips, 'to', v_stack));
    NEW.rebuy_chips := v_stack;
  END IF;

  IF COALESCE(NEW.addon_chips, 0) <= 0 THEN
    v_changed := v_changed || jsonb_build_object('addon_chips',
      jsonb_build_object('from', NEW.addon_chips, 'to', v_stack));
    NEW.addon_chips := v_stack;
  END IF;

  IF COALESCE(NEW.rebuy_levels, 0) <= 0 THEN
    v_changed := v_changed || jsonb_build_object('rebuy_levels',
      jsonb_build_object('from', NEW.rebuy_levels, 'to', 4));
    NEW.rebuy_levels := 4;
  END IF;

  IF COALESCE(NEW.addon_levels, 0) <= 0 THEN
    v_changed := v_changed || jsonb_build_object('addon_levels',
      jsonb_build_object('from', NEW.addon_levels, 'to', 1));
    NEW.addon_levels := 1;
  END IF;

  IF NEW.max_rebuys IS NOT NULL AND NEW.max_rebuys <= 0 THEN
    v_changed := v_changed || jsonb_build_object('max_rebuys',
      jsonb_build_object('from', NEW.max_rebuys, 'to', NULL));
    NEW.max_rebuys := NULL;
  END IF;

  IF v_changed <> '{}'::jsonb THEN
    v_op := CASE
      WHEN COALESCE(current_setting('app.freeroll_free_buy_backfill', true), '') = 'on'
        THEN 'BACKFILL'
      ELSE TG_OP
    END;
    BEGIN
      INSERT INTO public.ca_freeroll_free_buy_log
        (tournament_id, tournament_name, op, status, changed)
      VALUES
        (NEW.id, NEW.name, v_op, NEW.status, v_changed);
    EXCEPTION WHEN OTHERS THEN
      -- The log is evidence, not a gate. Never let it block the row.
      RAISE WARNING 'fn_freerolls_are_free_buy: could not log % for %: %',
        v_op, NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.trg_freeze_registered_tournament_settlement_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME='tournaments' AND public.fn_ca_midway_free_buy_conversion_transition(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF ROW(NEW.variant, NEW.tournament_type, NEW.satellite_target_id,
         NEW.bubble_protection, round(COALESCE(NEW.buy_in_amount, 0), 2),
         round(COALESCE(NEW.guaranteed_prize, 0), 2))
     IS NOT DISTINCT FROM
     ROW(OLD.variant, OLD.tournament_type, OLD.satellite_target_id,
         OLD.bubble_protection, round(COALESCE(OLD.buy_in_amount, 0), 2),
         round(COALESCE(OLD.guaranteed_prize, 0), 2)) THEN
    RETURN NEW;
  END IF;
  IF upper(COALESCE(OLD.status, '')) IN ('COMPLETING', 'COMPLETED')
     OR upper(COALESCE(NEW.status, '')) IN ('COMPLETING', 'COMPLETED') THEN
    RAISE EXCEPTION
      'tournament % settlement class, guarantee, Bubble Protection and buy-in are frozen once settlement begins',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'tournament % settlement class, guarantee, Bubble Protection and buy-in are frozen after its first entrant',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_guard_managed_game_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_engine boolean := COALESCE(auth.role(), '') = 'service_role';
  v_managed_command boolean :=
    COALESCE(current_setting('app.managed_game_lifecycle', true), '') = 'on';
  v_protected_tournament_keys text[] := ARRAY[
    'name', 'start_time', 'max_players', 'buy_in_amount', 'buy_in_fee',
    'guaranteed_prize', 'late_reg_mins', 'starting_chips', 'blind_structure',
    'payout_structure', 'game_type', 'variant', 'tournament_type', 'is_rebuy',
    'rebuy_cost', 'rebuy_chips', 'rebuy_levels', 'add_on_available',
    'addon_cost', 'addon_chips', 'is_bounty', 'bounty_amount', 'is_pko',
    'is_mystery_bounty', 'mystery_bounty_min', 'mystery_bounty_max',
    'description', 'short_description', 'min_players', 'late_reg_levels',
    'is_reentry', 'max_rebuys', 'max_reentries', 'addon_levels',
    'addon_break_minutes', 'is_private', 'is_vip_only', 'ban_chat',
    'all_in_or_fold', 'label_as_new', 'hide_club_name', 'is_pinned',
    'action_time_seconds', 'table_size', 'accelerated_mtt', 'big_blind_ante',
    'authorized_to_register', 'early_bird_enabled', 'early_bird_chips',
    'bubble_protection', 'final_table_deal_enabled', 'restart_every_minutes',
    'synchronized_breaks', 'is_multi_day', 'total_days', 'is_xmtt',
    'union_id', 'satellite_target_id', 'satellite_seats', 'spin_type',
    'mystery_bounty_profile', 'mystery_bounty_activation',
    'mystery_bounty_activation_value', 'mystery_bounty_pool_percent',
    'mystery_bounty_top_percent', 'settings'
  ];
  v_key text;
  v_new_document jsonb;
  v_old_document jsonb;
BEGIN
  IF TG_TABLE_NAME='tournaments' AND public.fn_ca_midway_free_buy_conversion_transition(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;

  -- One owner-authorized correction: the journal binds both complete row images.
  -- No GUC alone, caller impersonation, trigger disabling or other event is admitted.
  IF TG_TABLE_NAME='tournaments' THEN
  IF current_user='postgres'
     AND OLD.id='6b72abc3-bd16-488c-aea5-54b1eace98d5'::uuid
     AND OLD.status='RUNNING' AND NEW.status='RUNNING'
     AND OLD.prize_pool=5000 AND NEW.prize_pool=4050
     AND OLD.guaranteed_prize=5000 AND NEW.guaranteed_prize=5000
     AND OLD.bounty_pool=950 AND NEW.bounty_pool=950
     AND OLD.prize_pool_finalized AND NEW.prize_pool_finalized
     AND (to_jsonb(NEW)-ARRAY['prize_pool','payout_structure'])
       =(to_jsonb(OLD)-ARRAY['prize_pool','payout_structure'])
     AND current_setting('app.owner_bounty_guarantee_correction',true)=
       'tourney:6b72abc3-bd16-488c-aea5-54b1eace98d5:owner_bounty_guarantee_20261102'
     AND EXISTS (
       SELECT 1 FROM public.chip_ledger l
       WHERE l.idempotency_key=current_setting('app.owner_bounty_guarantee_correction',true)
         AND l.tournament_id=OLD.id AND l.category='reversal' AND l.amount=950
         AND l.from_type='prize_liability' AND l.from_entity_id=OLD.id
         AND l.to_type='union_bank'
         AND l.to_entity_id='fade0000-0000-0000-0000-000000000001'::uuid
         AND l.metadata->>'kind'='owner_bounty_guarantee_correction'
         AND l.metadata->'tournament_before'=to_jsonb(OLD)
         AND l.metadata->'tournament_after'=to_jsonb(NEW)
         AND l.metadata->>'overlay_after'='1580'
         AND l.metadata->>'owner_instruction'=
           'go through and manually change the payout to the corrected 5000 prize pool and pay the overlay'
     ) THEN
    RETURN NEW;
  END IF;
  END IF;
  IF TG_TABLE_NAME = 'tables' THEN
    IF lower(COALESCE(NEW.status, '')) IN ('closed', 'deleted')
       AND lower(COALESCE(OLD.status, '')) NOT IN ('closed', 'deleted')
       AND EXISTS (
         SELECT 1
         FROM public.table_seats ts
         WHERE ts.table_id = NEW.id
           AND ts.left_at IS NULL
       ) THEN
      RAISE EXCEPTION 'This table cannot be closed while players are seated'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_is_engine
       AND NOT v_managed_command
       AND (
         lower(COALESCE(NEW.status, '')) = 'deleted'
         AND lower(COALESCE(OLD.status, '')) <> 'deleted'
         OR COALESCE(NEW.is_deleted, false) AND NOT COALESCE(OLD.is_deleted, false)
       ) THEN
      RAISE EXCEPTION 'Table lifecycle changes must use fn_close_managed_game'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'tournaments'
     AND EXISTS (
       SELECT 1
       FROM public.tournament_players tp
       WHERE tp.tournament_id = NEW.id
     ) THEN
    IF NOT v_is_engine
       AND upper(COALESCE(NEW.status, '')) IN ('CANCELLED', 'CANCELED')
       AND upper(COALESCE(OLD.status, '')) NOT IN ('CANCELLED', 'CANCELED')
       -- DIAMOND PHASE 10: platform staff cancel a Diamond event through
       -- fn_poker_diamond_cancel_tournament, which names that one event here,
       -- in its own transaction, around the Diamond cancellation authority
       -- that first returns every entry from its own custody row.
       AND COALESCE(current_setting('app.poker_diamond_staff_cancel', true), '') IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'This tournament cannot be cancelled after a player has registered'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_is_engine THEN
      v_new_document := to_jsonb(NEW);
      v_old_document := to_jsonb(OLD);
      FOREACH v_key IN ARRAY v_protected_tournament_keys LOOP
        -- THE CLUB ARENA SHOWS NO DOLLAR SIGN (2026-10-09): the one change a
        -- registered event's display text may take is the dollar-free rewrite
        -- of the text it already had (public.fn_ca_text_without_dollar).
        CONTINUE WHEN v_key IN ('name', 'short_description', 'description')
          AND jsonb_typeof(v_old_document -> v_key) = 'string'
          AND (v_new_document ->> v_key) IS NOT DISTINCT FROM
              public.fn_ca_text_without_dollar(v_old_document ->> v_key);
        -- Only the canonical Diamond denomination correction may alter a registered event.
        CONTINUE WHEN v_key IN ('name', 'short_description', 'description')
          AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id
          AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds')
          AND jsonb_typeof(v_old_document -> v_key) = 'string'
          AND (v_new_document ->> v_key) IS NOT DISTINCT FROM
              public.fn_ca_diamond_guarantee_copy(v_old_document ->> v_key);
        -- Root may lock a pre-start event's level clock (Dan 2026-10-21: every
        -- level one fixed clock, never a range). Only the clock and the late
        -- registration it derives; every other protected field still runs below.
        CONTINUE WHEN v_key IN ('blind_structure', 'late_reg_mins', 'late_reg_levels', 'rebuy_levels')
          AND current_user = 'postgres'
          AND COALESCE(current_setting('app.lock_level_clock', true), '') = 'on'
          AND upper(COALESCE(OLD.status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING');
        -- Root may give a pre-start bounty event its rebuy (Dan 2026-10-21: no
        -- bounty or mystery bounty tournament is a freezeout). Only the rebuy
        -- keys, only toward a rebuy; every other protected field runs below.
        CONTINUE WHEN v_key IN ('is_rebuy', 'is_reentry', 'rebuy_cost', 'rebuy_chips', 'rebuy_levels', 'max_rebuys', 'max_reentries')
          AND current_user = 'postgres'
          AND COALESCE(current_setting('app.bounty_rebuy_rule', true), '') = 'on'
          AND COALESCE(NEW.is_rebuy, false)
          AND upper(COALESCE(OLD.status, '')) IN ('ANNOUNCED', 'REGISTERING');
        -- Root may apply the mystery terms to a pre-start event (Dan 2026-10-22:
        -- no bounty before the money; chests only). Only these keys.
        CONTINUE WHEN v_key IN ('mystery_bounty_pool_percent', 'mystery_bounty_activation', 'mystery_bounty_activation_value', 'short_description')
          AND current_user = 'postgres'
          AND COALESCE(current_setting('app.mystery_terms_rule', true), '') = 'on'
          AND upper(COALESCE(OLD.status, '')) IN ('ANNOUNCED', 'REGISTERING');
        -- Root may correct only the known literal-eight Diamond clock to its
        -- authored indexed ladder. Every other protected field still runs below.
        CONTINUE WHEN v_key='late_reg_mins' AND current_user='postgres'
          AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id
          AND OLD.tournament_type='MTT' AND OLD.late_reg_mins=8
          AND OLD.late_reg_levels>0 AND NOT COALESCE(OLD.prize_pool_finalized,false)
          AND (OLD.status IN ('ANNOUNCED','REGISTERING') OR
               (OLD.status='RUNNING' AND COALESCE(OLD.current_level,0)<OLD.late_reg_levels))
          AND EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=OLD.club_id AND c.asset='diamonds' AND c.is_platform IS TRUE)
          AND NEW.late_reg_mins=public.fn_ca_mtt_late_registration_minutes(OLD.blind_structure::jsonb,OLD.late_reg_levels);
        -- Root may set a pre-start event's add-on break to sixty seconds (Dan
        -- 2026-10-25: "ADD ON BREAK SHOULD ONLY BE 60 SECONDS"). Only this key,
        -- only to 1; every other protected field still runs below.
        CONTINUE WHEN v_key = 'addon_break_minutes'
          AND current_user = 'postgres'
          AND COALESCE(current_setting('app.addon_break_rule', true), '') = 'on'
          AND NEW.addon_break_minutes = 1
          AND upper(COALESCE(OLD.status, '')) IN ('ANNOUNCED', 'REGISTERING');
        -- THE PROVISIONAL LADDER FOLLOWS THE FIELD (Dan 2026-10-21): until the
        -- pool is finalized, payout_structure may take exactly one value, the
        -- paid depth of the current field. Nothing else passes here.
        CONTINUE WHEN v_key = 'payout_structure'
          AND NOT COALESCE(OLD.prize_pool_finalized, false)
          AND NOT COALESCE(NEW.prize_pool_finalized, false)
          AND public.fn_safe_jsonb_array(NEW.payout_structure::text)
              IS NOT DISTINCT FROM public.fn_ca_provisional_payout_structure(NEW.id);
        IF (v_new_document -> v_key) IS DISTINCT FROM (v_old_document -> v_key) THEN
          RAISE EXCEPTION 'This tournament cannot be modified after a player has registered'
            USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NOT v_is_engine
     AND NOT v_managed_command
     AND upper(COALESCE(NEW.status, '')) IN ('CANCELLED', 'CANCELED')
     AND upper(COALESCE(OLD.status, '')) NOT IN ('CANCELLED', 'CANCELED') THEN
    RAISE EXCEPTION 'Tournament lifecycle changes must use fn_close_managed_game'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$

;

-- All existing unstarted Midway Free Buys, including already registered
-- events, were explicitly included by the owner on November 2. The row lock
-- serializes conversion with registration and launch; running events are
-- excluded and the private converter rechecks every condition after locking.
DO $convert$
DECLARE ids uuid[]; event_id uuid; funded integer:=0;
BEGIN
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO ids FROM public.tournaments
  WHERE (union_id='fade0000-0000-0000-0000-000000000001'::uuid
         OR club_id='fade0000-0000-0000-0000-000000000001'::uuid)
    AND free_buy AND upper(tournament_type)='MTT'
    AND status IN ('ANNOUNCED','REGISTERING') AND started_at IS NULL
    AND buy_in_amount=0 AND buy_in_fee=0
    AND satellite_target_id IS NULL AND lower(coalesce(variant,''))<>'satellite'
;
 -- Acquire all event lanes before the shared promo-wallet debit. This keeps
 -- a registration in another selected event from waiting on our wallet
 -- while we wait on its event lane. No row or wallet lock precedes these.
 FOREACH event_id IN ARRAY ids LOOP
   PERFORM public.fn_ca_lock_settlement_lane_for_tournament(event_id);
 END LOOP;
 FOREACH event_id IN ARRAY ids LOOP
   funded:=funded+public.fn_ca_convert_midway_free_buy(event_id);
 END LOOP;
 RAISE NOTICE 'Midway promo funded % initial Free Buy heads',funded;
END;
$convert$;
UPDATE public.tournament_schedules SET config=config||jsonb_build_object(
 'midwayFreeBuyFormat','promo-pko-v1','buyIn',0,'buyInFee',0,'guaranteedPrize',0,
 'isBounty',true,'isPko',true,'isMysteryBounty',false,'bountyAmount',1,
 'isRebuy',true,'isReentry',true,'rebuyCost',1,'addOnAvailable',false,
 'addonFromStart',false,'addonCost',NULL,'addonChips',NULL,'addonLevels',NULL)
WHERE club_id='fade0000-0000-0000-0000-000000000001'::uuid
 AND config->>'type'='fixed_board' AND config->>'fixedBoard' LIKE '% Free Buy (NLH)';
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
