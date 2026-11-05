-- 20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 03:52:20 UTC.
--
-- THE FIVE DAILY MIDWAY FREE BUYS ROTATE FOUR FORMATS (owner, 2026-11-04).
-- 08:30 Morning = regular NLH, 250 guarantee, rebuys and add-ons.
-- 12:30 Midday and 00:30 Midnight = the November 2 promo PKO (unchanged).
-- 16:30 Afternoon = all-in-or-fold, 500 guarantee, rebuys only.
-- 20:30 Prime Time = mystery bounty; every chip in splits 0.50/0.50.
-- What was wrong: the November 2 money rails (20261102154336) recognised only
-- the PKO shape, and the zz_ Free Buy trigger forced every Midway Free Buy back
-- to PKO, so the other three formats could not exist or would take a fee.
-- What this changes:
--  1. public.fn_ca_midway_free_buy_format(uuid) names the format
--     (pko/mystery/aiof/regular, NULL for anything else); the PKO predicate is
--     now exactly format = 'pko'.
--  2. fn_ca_midway_free_buy_promo_head funds exactly 1 promo chip per
--     registration for every format, same idempotency key and journal shape:
--     pko -> bounty, regular/aiof -> prize, mystery -> 0.50 bounty + 0.50 prize.
--     Its return path reverses the same components. Human and horse
--     registration book the same components to the pools.
--  3. Rebuys and add-ons stay paid from the player's own wallet with zero fee
--     for every format: regular/aiof all prize, pko unchanged, mystery
--     0.50 bounty / 0.50 prize (including the add-on). Charge split (refund
--     entitlements and live escrow) and the escrow shadow agree.
--  4. The schedule writer admits exactly one start outside 06:00-23:00 Chicago:
--     the Midway union's "Midnight Free Buy (NLH)" at 00:30.
--  5. fn_freerolls_are_free_buy shapes an unregistered Midway Free Buy to the
--     format its flags name, and holds a registered one to its entered shape.
--  6. Unregistered future Morning/Afternoon/Prime Time rows are reshaped here;
--     Midday/Midnight stay PKO; schedules are left to the engine's board sync.
-- Exact replacements over the live definitions read 2026-11-05 (md5 guards).
-- Unregister and atomic cancellation already call the promo owner for every
-- registration and need no change. No wallet balance moves in this migration.
-- Native proof: scripts/ci/test-midway-free-buy-rotation.py
-- @live-proof: public.fn_ca_midway_free_buy_format('39b5fa14-2332-472f-b0df-cde4edcdf62b'::uuid) IS NOT DISTINCT FROM 'pko' AND position('daily_window_start_carveout' IN pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure))>0 AND position('bounty_part' IN pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_midway_free_buy_pko') IS DISTINCT FROM '74c6b7b38d3ffb4dc6d6b7d0ca7618f6' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_pko'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_midway_free_buy_promo_head') IS DISTINCT FROM '5313d401a1be8b69da9b056fb8d8b229' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_promo_head'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_register_for_tournament_before_atomic_capacity_20260907') IS DISTINCT FROM 'f20ad629733c84ff9edccf5656cfa7c1' THEN RAISE EXCEPTION 'Inspected definition changed: fn_register_for_tournament_before_atomic_capacity_20260907'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_register_horse_for_tournament_before_maintenance_gate') IS DISTINCT FROM '8ba69fc6cf0b2d335aa99b9319443cfa' THEN RAISE EXCEPTION 'Inspected definition changed: fn_register_horse_for_tournament_before_maintenance_gate'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_process_tournament_chip_purchase_money_v1') IS DISTINCT FROM '5ae795e2d0bb7df088170af0059fc12d' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_process_tournament_chip_purchase_money_v1'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_tournament_charge_split') IS DISTINCT FROM '7620d47568b1575ecc96feed58548bf9' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_tournament_charge_split'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_tournament_escrow_chips') IS DISTINCT FROM '19bab4c0381bdf68742ec63b447e7434' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_tournament_escrow_chips'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_ca_convert_midway_free_buy') IS DISTINCT FROM '90b2ec6d789bc45d38468305067c1e89' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_convert_midway_free_buy'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_freerolls_are_free_buy') IS DISTINCT FROM '50cb7586c42a53de9f4fac9345a81bea' THEN RAISE EXCEPTION 'Inspected definition changed: fn_freerolls_are_free_buy'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_upsert_tournament_schedule') IS DISTINCT FROM 'ede65ecb243fbc42745a642ea2a74b89' THEN RAISE EXCEPTION 'Inspected definition changed: fn_upsert_tournament_schedule'; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.fn_ca_midway_free_buy_format(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Midway Free Buy format predicate already exists'; END IF; END $$;

-- Private money owners stay registered before their CREATE statements (the
-- November 2 installation guard correction). No execution privilege is added.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_midway_free_buy_promo_head','approved','Private Midway-only one-chip promo funding or unplayed return, exact registration idempotency, settlement lane, balance guard and chip ledger with escrow conservation.'),
 ('fn_ca_convert_midway_free_buy','approved','Private owner-authorized unstarted Midway Free Buy conversion; locks event and roster, refuses played or funded rows, funds each head through the registered promo owner.')
ON CONFLICT(proname) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_format(p_tournament_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE
   WHEN t.is_pko AND NOT coalesce(t.is_mystery_bounty,false)
        AND t.bounty_amount=1 AND t.guaranteed_prize=0 THEN 'pko'
   WHEN coalesce(t.is_mystery_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND t.bounty_amount=0.50 THEN 'mystery'
   WHEN NOT coalesce(t.is_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND NOT coalesce(t.is_mystery_bounty,false)
        AND coalesce(t.all_in_or_fold,false) THEN 'aiof'
   WHEN NOT coalesce(t.is_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND NOT coalesce(t.is_mystery_bounty,false)
        AND NOT coalesce(t.all_in_or_fold,false) THEN 'regular'
   END
 FROM public.tournaments t WHERE t.id=p_tournament_id
  AND (t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
       OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
  AND t.free_buy
  AND upper(t.tournament_type)='MTT' AND t.buy_in_amount=0 AND t.buy_in_fee=0
  AND t.satellite_target_id IS NULL AND lower(coalesce(t.variant,''))<>'satellite';
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_pko(p_tournament_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce(public.fn_ca_midway_free_buy_format(p_tournament_id)='pko',false);
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head(p_tournament_id uuid, p_registration_id uuid, p_return boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 t public.tournaments%ROWTYPE;
 p public.tournament_players%ROWTYPE;
 funded public.chip_ledger%ROWTYPE;
 prior public.chip_ledger%ROWTYPE;
 k text;
 n integer;
 previous_skip text;
 v_format text;
 v_bounty numeric;
 v_prize numeric;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 v_format:=public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL THEN RETURN 0; END IF;
 -- 2026-11-04 rotation: the one promo chip lands by format. pko: the bounty
 -- head (unchanged). regular/aiof: the prize pool. mystery: half each.
 v_bounty:=CASE v_format WHEN 'pko' THEN 1 WHEN 'mystery' THEN 0.50 ELSE 0 END;
 v_prize:=round(1-v_bounty,2);
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
      OR (v_bounty>0 AND (p.current_bounty IS NULL OR p.current_bounty<v_bounty)) THEN
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
   IF upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING','RUNNING','BREAK') OR (v_bounty>0 AND p.current_bounty IS DISTINCT FROM v_bounty) THEN
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
   CASE WHEN NOT p_return THEN 'union_wallets.promo_wallet' WHEN v_format='pko' THEN 'tournament_escrow.bounty_balance'
        WHEN v_format='mystery' THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   CASE WHEN p_return THEN 'union_wallet' ELSE 'prize_liability' END,
   CASE WHEN p_return THEN 'fade0000-0000-0000-0000-000000000001'::uuid ELSE p_tournament_id END,
   CASE WHEN p_return THEN 'union_wallets.promo_wallet' WHEN v_format='pko' THEN 'tournament_escrow.bounty_balance'
        WHEN v_format='mystery' THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   1,CASE WHEN p_return THEN 'reversal' ELSE 'promo_send' END,t.club_id,p_tournament_id,k,
   CASE WHEN p_return AND v_format='pko' THEN 'Unplayed Free Buy Bounty Returned To Midway Promo Funds'
        WHEN p_return THEN 'Unplayed Free Buy Entry Returned To Midway Promo Funds'
        WHEN v_format='pko' THEN 'Midway Promo Funds Free Buy Initial Bounty'
        ELSE 'Midway Promo Funds Free Buy Initial Entry' END,
   jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',p_registration_id,
     'user_id',p.user_id,'return',p_return,'funding_ledger_id',funded.id,
     'format',v_format,'bounty_part',v_bounty,'prize_part',v_prize));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head',
   p_gross_in=>CASE WHEN p_return THEN -1 ELSE 1 END,
   p_bounty_in=>CASE WHEN p_return THEN -v_bounty ELSE v_bounty END);
 IF p_return THEN
   UPDATE public.tournaments SET bounty_pool=bounty_pool-v_bounty,prize_pool=prize_pool-v_prize
    WHERE id=p_tournament_id AND bounty_pool>=v_bounty AND prize_pool>=v_prize;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'Promo return exceeds funded bounty or prize pool'; END IF;
 END IF;
 RETURN 1;
END;
$function$
;

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
  v_mfb text;
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

  -- Midway Free Buy rotation (2026-11-04): the player pays nothing; the
  -- promo chip is booked to the pool(s) of the event's format.
  v_mfb:=public.fn_ca_midway_free_buy_format(p_tournament_id);
  IF v_mfb='pko' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;
  ELSIF v_mfb='mystery' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0.50;
  ELSIF v_mfb IN ('regular','aiof') THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=1;
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
  v_mfb text;
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

  -- Midway Free Buy rotation (2026-11-04): the player pays nothing; the
  -- promo chip is booked to the pool(s) of the event's format.
  v_mfb:=public.fn_ca_midway_free_buy_format(p_tournament_id);
  IF v_mfb='pko' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;
  ELSIF v_mfb='mystery' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0.50;
  ELSIF v_mfb IN ('regular','aiof') THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=1;
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
  IF public.fn_ca_midway_free_buy_format(p_tournament_id) IS NOT NULL THEN v_fee_ratio:=0; END IF;
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
  IF v_is_bounty AND (p_rebuy_type<>'addon'
     OR public.fn_ca_midway_free_buy_format(p_tournament_id)='mystery') THEN
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
    -- A Midway Mystery Free Buy add-on splits like its entries and rebuys.
    refund_bounty := CASE WHEN v_is_bounty
        AND public.fn_ca_midway_free_buy_format(p_tournament_id)='mystery' THEN
      public.fn_ca_unit_floor_cents(
        round(LEAST(GREATEST(0,round(COALESCE(v_t.bounty_amount,0),2)),v_gross)*100)::bigint,
        public.fn_ca_tournament_unit_cents(p_tournament_id))::numeric / 100
      ELSE 0 END;
    refund_prize := round(v_gross-refund_bounty,2);
    refund_fee := 0;
  ELSE
    IF v_gross IS DISTINCT FROM round(v_gross) THEN
      RAISE EXCEPTION 'rebuy charge must be a positive whole chip amount'
        USING ERRCODE = '23514';
    END IF;
    v_ratio := public.fn_ca_tournament_purchase_fee_ratio(
      v_t.buy_in_amount, v_t.buy_in_fee, public.fn_ca_tournament_unit_cents(p_tournament_id));
    IF public.fn_ca_midway_free_buy_format(p_tournament_id) IS NOT NULL THEN v_ratio:=0; END IF;
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
WITH owner_out AS (SELECT coalesce(sum(prize),0) prize,coalesce(sum(bounty),0) bounty,coalesce(sum(refund_fee_reserved),0) refund_fee FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id=p_tournament_id AND asset='chips'), t AS (
  SELECT id,COALESCE(buy_in_amount,0) AS buy_in_amount,
         COALESCE(buy_in_fee,0) AS buy_in_fee,
         COALESCE(bounty_amount,0) AS bounty_amount,
         (COALESCE(is_bounty,false) OR COALESCE(is_pko,false)
          OR COALESCE(is_mystery_bounty,false)) AS is_b,
         public.fn_ca_midway_free_buy_format(p_tournament_id) AS mfb
    FROM public.tournaments WHERE id=p_tournament_id
), promo AS (
  SELECT coalesce(sum(CASE WHEN l.category='promo_send' THEN l.amount ELSE -l.amount END),0) AS amount,
         coalesce(sum((CASE WHEN l.category='promo_send' THEN 1 ELSE -1 END)
           *coalesce((l.metadata->>'bounty_part')::numeric,l.amount)),0) AS bounty
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
    WHEN NOT t.is_b OR (lower(l.category)='addon' AND t.mfb IS DISTINCT FROM 'mystery') THEN 0
    WHEN lower(l.category)='tournament_buyin' THEN round(t.bounty_amount,2)
    ELSE public.fn_ca_unit_floor_cents(
      round(LEAST(
        GREATEST(0,round(t.bounty_amount,2)),
        round(l.amount,2)-public.fn_ca_recovery_fee_cents(
          round(round(l.amount,2)*100)::bigint,
          CASE WHEN t.mfb IS NOT NULL THEN 0
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
    round(rr.fee_in+owner_out.refund_fee,2) AS fee_in,
    round(rr.fee_in-rr.fee_sat+owner_out.refund_fee,2) AS fee_entries,
    round(direct_bounty.amount+stl.split_bounty+tk.ticket_bounty+promo.bounty,2) AS bounty_in,
    round(CASE WHEN ov.ledger_overlay>0 THEN ov.ledger_overlay
      ELSE tgo.tgo_amount END-ov.returned,2) AS overlay_in,
    round(stl.moved-stl.split_moved-rr.fee_sat+rr.fee_sat_split,2)
      AS satellite_in,
    round(w.prize_out+sat.funded_awards_out+owner_out.prize,2) AS prize_out,
    round(w.bounty_out+owner_out.bounty,2) AS bounty_out,
    round(fo.fee_out,2) AS fee_out,
    round(w.refund_out,2) AS refund_out,
    round(exact_refunds.total,2) AS exact_total,
    round(exact_refunds.prize,2) AS exact_prize,
    round(exact_refunds.bounty,2) AS exact_bounty,
    round(exact_refunds.fee,2) AS exact_fee
  FROM t,w,direct_bounty,rr,stl,ov,tk,tgo,sat,fo,exact_refunds,owner_out,promo
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

CREATE OR REPLACE FUNCTION public.fn_ca_convert_midway_free_buy(p_tournament_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t public.tournaments%ROWTYPE; p record; n integer:=0; prior_context text; e public.tournament_escrow%ROWTYPE;
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
 SELECT * INTO STRICT t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF public.fn_ca_midway_free_buy_format(t.id) IS NOT NULL THEN RETURN 0; END IF;
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

  -- Midway Free Buys (owner 2026-11-04): four formats, each funded with one
  -- Midway promo chip per entry. The format is read from the row's flags
  -- (mystery, then PKO/bounty, then all-in-or-fold, else regular) and every
  -- money-relevant column is set to that format's one shape. A registered
  -- event keeps the shape its players entered under; only the private
  -- legacy converter may change it, inside its own transaction.
  IF (NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid
      OR NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
     AND NEW.free_buy AND NEW.satellite_target_id IS NULL
     AND lower(coalesce(NEW.variant,''))<>'satellite' THEN
    IF TG_OP='UPDATE'
       AND EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=NEW.id) THEN
      IF NOT coalesce(OLD.is_pko,false) AND NOT coalesce(OLD.is_mystery_bounty,false)
         AND NOT coalesce(OLD.is_bounty,false)
         AND coalesce(current_setting('app.midway_free_buy_conversion',true),'')=OLD.id::text THEN
        RETURN NEW;
      END IF;
      NEW.is_bounty:=OLD.is_bounty; NEW.is_pko:=OLD.is_pko; NEW.is_mystery_bounty:=OLD.is_mystery_bounty;
      NEW.bounty_amount:=OLD.bounty_amount; NEW.guaranteed_prize:=OLD.guaranteed_prize;
      NEW.buy_in_fee:=OLD.buy_in_fee; NEW.all_in_or_fold:=OLD.all_in_or_fold;
      NEW.is_rebuy:=OLD.is_rebuy; NEW.is_reentry:=OLD.is_reentry; NEW.rebuy_cost:=OLD.rebuy_cost;
      NEW.add_on_available:=OLD.add_on_available; NEW.addon_from_start:=OLD.addon_from_start;
      NEW.addon_cost:=OLD.addon_cost; NEW.addon_chips:=OLD.addon_chips; NEW.addon_levels:=OLD.addon_levels;
      NEW.mystery_bounty_min:=OLD.mystery_bounty_min; NEW.mystery_bounty_max:=OLD.mystery_bounty_max;
      RETURN NEW;
    END IF;
    v_op:=CASE WHEN coalesce(NEW.is_mystery_bounty,false) THEN 'mystery'
               WHEN coalesce(NEW.is_pko,false) OR coalesce(NEW.is_bounty,false) THEN 'pko'
               WHEN coalesce(NEW.all_in_or_fold,false) THEN 'aiof'
               ELSE 'regular' END;
    NEW.buy_in_fee:=0; NEW.is_rebuy:=true; NEW.is_reentry:=true; NEW.rebuy_cost:=1;
    IF TG_OP='INSERT' THEN
      NEW.rebuy_chips:=CASE WHEN coalesce(NEW.rebuy_chips,0)>0 THEN NEW.rebuy_chips
        ELSE coalesce(nullif(NEW.starting_chips,0),10000) END;
      NEW.rebuy_levels:=CASE WHEN coalesce(NEW.rebuy_levels,0)>0 THEN NEW.rebuy_levels ELSE 4 END;
    END IF;
    IF v_op='pko' THEN
      NEW.is_bounty:=true; NEW.is_pko:=true; NEW.is_mystery_bounty:=false;
      NEW.bounty_amount:=1; NEW.guaranteed_prize:=0;
    ELSIF v_op='mystery' THEN
      NEW.is_bounty:=true; NEW.is_pko:=false; NEW.is_mystery_bounty:=true; NEW.all_in_or_fold:=false;
      NEW.variant:='mystery_bounty';
      NEW.bounty_amount:=0.50; NEW.guaranteed_prize:=0;
      NEW.mystery_bounty_min:=0.25; NEW.mystery_bounty_max:=5.00;
      NEW.mystery_bounty_profile:='classic'; NEW.mystery_bounty_activation:='at_the_money';
      NEW.mystery_bounty_activation_value:=NULL; NEW.mystery_bounty_pool_percent:=100;
      NEW.mystery_bounty_regular_pool_percent:=0; NEW.mystery_bounty_top_percent:=20;
      NEW.mystery_bounty_stage:=coalesce(NEW.mystery_bounty_stage,'pending');
    ELSE
      NEW.is_bounty:=false; NEW.is_pko:=false; NEW.is_mystery_bounty:=false;
      NEW.bounty_amount:=0; NEW.all_in_or_fold:=(v_op='aiof');
      NEW.guaranteed_prize:=CASE WHEN v_op='aiof' THEN 500 ELSE 250 END;
    END IF;
    IF v_op IN ('regular','mystery') THEN
      -- The add-on is open from the start; addon_levels counts levels after
      -- the rebuy cutoff, so 1 keeps it inside the first hour.
      NEW.add_on_available:=true; NEW.addon_from_start:=true;
      NEW.addon_cost:=1; NEW.addon_levels:=1;
      NEW.addon_chips:=coalesce(nullif(NEW.addon_chips,0),nullif(NEW.starting_chips,0),10000);
    ELSE
      NEW.add_on_available:=false; NEW.addon_from_start:=false;
      NEW.addon_cost:=NULL; NEW.addon_chips:=NULL; NEW.addon_levels:=NULL;
    END IF;
    NEW.short_description:=CASE v_op
      WHEN 'pko' THEN 'Free Entry. Midway Promo Funds Your 1-Chip Bounty. 1-Chip Rebuys. No Add-Ons Or Rake. All Prizes Are Bounties: 50% To Your Wallet, 50% To Your Head. The Winner Keeps Their Bounty.'
      WHEN 'regular' THEN 'Free Entry. Midway Promo Funds Your Entry. 250 Chip Guarantee. 1-Chip Rebuys And Add-Ons For The First Hour. No Rake.'
      WHEN 'aiof' THEN 'All-In Or Fold. Free Entry. Midway Promo Funds Your Entry. 500 Chip Guarantee. 1-Chip Rebuys For The First Hour. No Add-Ons Or Rake.'
      ELSE 'Mystery Bounty. Free Entry. Midway Promo Funds Your 1-Chip Entry: Half To The Mystery Bounty Pool, Half To The Prize Pool. 1-Chip Rebuys And Add-Ons For The First Hour Split The Same Way. No Rake.' END;
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

-- THE ONE DAILY-WINDOW CARVE-OUT (owner 2026-11-04): the Midway union's
-- Midnight Free Buy starts at 00:30 Chicago. Nothing else moves the hours.
CREATE OR REPLACE FUNCTION smarter_private.daily_window_start_carveout(
 p_union_id uuid,p_club_id uuid,p_name text,p_local_start time)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT coalesce((p_union_id='fade0000-0000-0000-0000-000000000001'::uuid
     OR p_club_id='fade0000-0000-0000-0000-000000000001'::uuid)
   AND p_name='Midnight Free Buy (NLH)' AND p_local_start='00:30'::time,false)
$f$;
REVOKE ALL ON FUNCTION smarter_private.daily_window_start_carveout(uuid,uuid,text,time) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text; o text; n text;
BEGIN
 d:=pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure);
 o:=$o$       NOT BETWEEN pol.first_tournament_start AND pol.last_tournament_start) THEN
    RETURN jsonb_build_object('error','tournament_start_outside_daily_hours'$o$;
 n:=$n$       NOT BETWEEN pol.first_tournament_start AND pol.last_tournament_start
       -- 20261105035220: the Midway union's 00:30 Midnight Free Buy only.
       AND NOT smarter_private.daily_window_start_carveout(v_union_id,v_club_id,v_name,
         (((dd + tm::time) AT TIME ZONE coalesce(v_zone,'UTC')) AT TIME ZONE pol.time_zone)::time)) THEN
    RETURN jsonb_build_object('error','tournament_start_outside_daily_hours'$n$;
 IF (length(d)-length(replace(d,o,'')))<>length(o) THEN RAISE EXCEPTION 'schedule_upsert_patch_not_single'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;

-- Preserve the inspected execution boundaries explicitly.
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_format(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_midway_free_buy_format(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_pko(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_midway_free_buy_pko(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_convert_midway_free_buy(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_charge_split(uuid,text,numeric) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_escrow_chips(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_escrow_chips(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_freerolls_are_free_buy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_freerolls_are_free_buy() TO service_role;

-- Reshape the existing unregistered future Morning, Afternoon and Prime Time
-- Free Buys to their slot's format. Each row is locked once (1 s lock_timeout)
-- and skipped if it has gained a registration or any money since it was read.
DO $reshape$
DECLARE r record; reg integer; changed integer:=0; skipped integer:=0;
BEGIN
 FOR r IN SELECT id,name FROM public.tournaments
  WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid
    AND free_buy AND upper(tournament_type)='MTT' AND status IN ('ANNOUNCED','REGISTERING')
    AND started_at IS NULL AND start_time>now()
    AND name IN ('Morning Free Buy (NLH)','Afternoon Free Buy (NLH)','Prime Time Free Buy (NLH)')
  ORDER BY id
 LOOP
  PERFORM 1 FROM public.tournaments t WHERE t.id=r.id FOR UPDATE;
  SELECT count(*) INTO reg FROM public.tournament_players tp WHERE tp.tournament_id=r.id;
  IF reg>0 OR EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=r.id
       AND (t.status NOT IN ('ANNOUNCED','REGISTERING') OR t.started_at IS NOT NULL
            OR coalesce(t.prize_pool,0)<>0 OR coalesce(t.bounty_pool,0)<>0
            OR coalesce(t.prize_pool_finalized,false))) THEN
   skipped:=skipped+1; CONTINUE;
  END IF;
  IF r.name='Morning Free Buy (NLH)' THEN
   UPDATE public.tournaments SET is_bounty=false,is_pko=false,is_mystery_bounty=false,
     bounty_amount=0,guaranteed_prize=250,all_in_or_fold=false,buy_in_fee=0,
     is_rebuy=true,is_reentry=true,rebuy_cost=1,rebuy_chips=starting_chips,rebuy_levels=late_reg_levels,max_rebuys=NULL,
     add_on_available=true,addon_from_start=true,addon_cost=1,addon_chips=starting_chips,addon_levels=1,
     short_description='Free Entry. Midway Promo Funds Your Entry. 250 Chip Guarantee. 1-Chip Rebuys And Add-Ons For The First Hour. No Rake.'
   WHERE id=r.id;
  ELSIF r.name='Afternoon Free Buy (NLH)' THEN
   UPDATE public.tournaments SET is_bounty=false,is_pko=false,is_mystery_bounty=false,
     bounty_amount=0,guaranteed_prize=500,all_in_or_fold=true,buy_in_fee=0,
     is_rebuy=true,is_reentry=true,rebuy_cost=1,rebuy_chips=starting_chips,rebuy_levels=late_reg_levels,max_rebuys=NULL,
     add_on_available=false,addon_from_start=false,addon_cost=NULL,addon_chips=NULL,addon_levels=NULL,
     short_description='All-In Or Fold. Free Entry. Midway Promo Funds Your Entry. 500 Chip Guarantee. 1-Chip Rebuys For The First Hour. No Add-Ons Or Rake.'
   WHERE id=r.id;
  ELSE
   UPDATE public.tournaments SET is_bounty=true,is_pko=false,is_mystery_bounty=true,variant='mystery_bounty',
     bounty_amount=0.50,guaranteed_prize=0,all_in_or_fold=false,buy_in_fee=0,
     mystery_bounty_min=0.25,mystery_bounty_max=5.00,mystery_bounty_profile='classic',
     mystery_bounty_activation='at_the_money',mystery_bounty_activation_value=NULL,
     mystery_bounty_pool_percent=100,mystery_bounty_regular_pool_percent=0,
     mystery_bounty_top_percent=20,mystery_bounty_stage='pending',
     is_rebuy=true,is_reentry=true,rebuy_cost=1,rebuy_chips=starting_chips,rebuy_levels=late_reg_levels,max_rebuys=NULL,
     add_on_available=true,addon_from_start=true,addon_cost=1,addon_chips=starting_chips,addon_levels=1,
     short_description='Mystery Bounty. Free Entry. Midway Promo Funds Your 1-Chip Entry: Half To The Mystery Bounty Pool, Half To The Prize Pool. 1-Chip Rebuys And Add-Ons For The First Hour Split The Same Way. No Rake.'
   WHERE id=r.id;
  END IF;
  IF (public.fn_ca_midway_free_buy_format(r.id) IS DISTINCT FROM
     (CASE r.name WHEN 'Morning Free Buy (NLH)' THEN 'regular'
       WHEN 'Afternoon Free Buy (NLH)' THEN 'aiof' ELSE 'mystery' END)) THEN
   RAISE EXCEPTION 'Reshaped Midway Free Buy % did not take its slot format',r.id;
  END IF;
  changed:=changed+1;
 END LOOP;
 RAISE NOTICE 'Midway Free Buy rotation reshaped % events, skipped % with entries',changed,skipped;
END;
$reshape$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
