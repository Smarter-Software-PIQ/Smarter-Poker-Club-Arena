-- 20261114161610_a_guarantee_moves_no_chips_until_every_entry_window_closes
-- @live-proof: position('fn_ca_guarantee_entry_period_ended(p_tournament_id)' in pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure)) > 0
-- @live-proof: position('rebuy_window_open' in pg_get_functiondef('public.fn_close_tournament_entry_window(uuid,text)'::regprocedure)) > 0
--
-- NO OVERLAY CHIPS BEFORE THE ENTRY PERIOD HAS ENDED (owner law, 2026-11-14).
--
-- Dan, 10:04 Chicago, November 14: "NO CHIPS ARE EVER EVER EVER SUPPOSED TO GO
-- TO ANY TOURNAMENT 'FOR OVERLAYS' UNTIL THE REGISTRATION / REBUY / ADD ON
-- PERIOD HAS OFFICALLY ENDED... MAKE SURE THAT IS THE LAW, AND ITS FULLY BUILT
-- AND IMPLEMENTED FOR ANY AND ALL EVENTS WITH A GUARANTEE".
--
-- WHAT WAS STILL ABLE TO HAPPEN (read from production 2026-11-14):
--   1. A rebuy event whose rebuy levels outlast its late-registration levels,
--      with no add-on, was finalized at the late-registration level.
--      fn_close_tournament_entry_window asked only whether late registration
--      was open. The 25 Chip Bankroll Builder (1,000 GTD, 9 late-registration
--      levels, 12 rebuy levels) closed at level 9 on November 11, 12 and 13
--      (entry-close receipts 19:19, 19:23 and 19:17 Chicago). Finalizing funds
--      the guarantee and also ends rebuys, so the guarantee was funded with
--      three configured rebuy levels still ahead and those rebuys were refused.
--      Sunday 200 Deep Stack (25,000 GTD, November 15) has the same shape.
--   2. fn_ca_fund_overlay_on_lock still funds a satellite's guaranteed seats at
--      the START, before any late registration, rebuy or add-on. None fired
--      since November 5 (212 completed satellites), but the path was live.
--   3. Nothing below the callers refused it: fn_apply_prize_guarantee funded
--      whenever it was called, and no ledger rule tied guarantee money to the
--      entry period.
--
-- THE LAW, BUILT:
--   - fn_ca_guarantee_entry_period_ended(id): the one answer. An event with an
--     add-on ends at the actual add-on end (rebuys and late registration run
--     through it). Any other running event ends when late registration AND the
--     rebuy window are both closed. A finalized, completing, completed or
--     cancelled event has ended; a registering event has not.
--   - fn_close_tournament_entry_window keeps the pool open (entry_closed false,
--     reason rebuy_window_open) while the rebuy window is open. Registration
--     still closes at its own level. The serving engine already asks again at
--     every blind transition and at the clock deadline, so no engine change.
--   - fn_apply_prize_guarantee refuses (entry_period_open, retryable) before
--     the period ends. Only the two settlement authorities, which close a
--     finished event whose winner is known, pass. It marks the transaction for
--     the ledger guard once it has decided.
--   - A satellite with an entry period after its start no longer has its seats
--     funded at the start; fn_ca_fund_satellite_seats_at_close_locked funds
--     them at the close, inside fn_apply_prize_guarantee. A satellite with no
--     late registration, rebuy, re-entry or add-on closes entry at its start,
--     so its start funding stays.
--   - fn_ca_overlay_waits_for_entry_close(): the ledger guard function. It is
--     attached to chip_ledger by 20261114161611 in the daily maintenance
--     window (a trigger on a hot table needs SHARE ROW EXCLUSIVE).
--
-- What is not an overlay and is left alone: a Free Buy entry's bounty part
-- booked at sign-up (key tourney:<id>:promo_head:<registration>), which is the
-- free entry's own funding. Diamond events never fund from a chip bank.
--
-- Function images only, one transaction, md5-guarded against the installed
-- images (read 2026-11-14 16:10 UTC). No chips, balances or settled rows move.
-- Tested on isolated PostgreSQL: tests/unit/aGuaranteeWaitsForEntryClose.pg.test.ts.
BEGIN;

DO $preimage$ BEGIN
  IF md5(pg_get_functiondef('public.fn_close_tournament_entry_window(uuid,text)'::regprocedure))
       IS DISTINCT FROM '5ed928768855a0a51aafd8c2132dcef4'
     OR md5(pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure))
       IS DISTINCT FROM 'b7d1bbad342cb57717d8b6f24be03e08'
     OR md5(pg_get_functiondef('public.fn_ca_fund_overlay_on_lock()'::regprocedure))
       IS DISTINCT FROM '8d9f9f1d6f6806bac9aec0202de08997' THEN
    RAISE EXCEPTION 'GUARANTEE_ENTRY_CLOSE_SOURCE_CHANGED: qualify against the current installed images';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_entry_period_ended(p_tournament_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.tournaments%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF COALESCE(t.prize_pool_finalized, false) THEN RETURN true; END IF;
  IF upper(COALESCE(t.status, '')) IN ('COMPLETING', 'COMPLETED', 'CANCELLED') THEN RETURN true; END IF;
  IF upper(COALESCE(t.status, '')) <> 'RUNNING' THEN RETURN false; END IF;
  -- An add-on event's late registration and rebuys run through the add-on
  -- (fn_tournament_late_registration_open, fn_ca_tournament_rebuy_window):
  -- its period ends at the actual add-on end and not a moment before.
  IF COALESCE(t.add_on_available, false) THEN
    RETURN t.addon_period_ends_at IS NOT NULL AND clock_timestamp() >= t.addon_period_ends_at;
  END IF;
  IF public.fn_tournament_late_registration_open(t.id) THEN RETURN false; END IF;
  IF COALESCE((public.fn_ca_tournament_rebuy_window(t.id)->>'open')::boolean, false) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_entry_period_ended(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_entry_period_ended(uuid) TO service_role;

-- A function that can move money is registered before it exists
-- (ab_ca_money_rpc_registered). Refused once at install on 2026-11-14 17:43
-- UTC without this row; nothing was installed, and the file is fixed in place.
INSERT INTO public.ca_money_rpc_registry (proname, status, notes)
SELECT 'fn_ca_fund_satellite_seats_at_close_locked', 'approved',
  'Funds a satellite''s guaranteed-seat shortfall once, at entry close: union bank chip_balance (club treasury fallback) to the event prize liability as one keyed overlay leg (tourney:<id>:satellite_seat_overlay), escrow credited by zz_ca_escrow_overlay_leg; refuses before fn_ca_guarantee_entry_period_ended; called only inside fn_apply_prize_guarantee.'
WHERE NOT EXISTS (SELECT 1 FROM public.ca_money_rpc_registry
                   WHERE proname = 'fn_ca_fund_satellite_seats_at_close_locked');

CREATE OR REPLACE FUNCTION public.fn_ca_fund_satellite_seats_at_close_locked(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.tournaments%ROWTYPE;
  v_target uuid; v_seat numeric; v_pool numeric; v_short numeric;
  v_union uuid; v_bank numeric; v_fallback numeric; v_from text;
  k text;
BEGIN
  SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(t.prize_pool_finalized, false) THEN RETURN 0; END IF;
  IF COALESCE(t.satellite_seats, 0) <= 0
     OR NOT (t.variant = 'satellite' OR upper(COALESCE(t.tournament_type, '')) = 'SATELLITE'
             OR t.satellite_target_id IS NOT NULL) THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = t.club_id AND c.asset = 'diamonds') THEN
    RETURN 0;
  END IF;
  IF NOT public.fn_ca_guarantee_entry_period_ended(p_tournament_id) THEN
    RAISE EXCEPTION 'GUARANTEE_CHIPS_BEFORE_ENTRY_CLOSE: satellite % seats cannot be funded before its entry period ends',
      p_tournament_id USING ERRCODE = '55000';
  END IF;
  k := 'tourney:' || p_tournament_id::text || ':satellite_seat_overlay';
  IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = k) THEN RETURN 0; END IF;
  v_target := COALESCE(t.satellite_target_id, t.satellite_target);
  IF v_target IS NULL THEN RETURN 0; END IF;
  SELECT round((COALESCE(t2.buy_in_amount, 0) + COALESCE(t2.buy_in_fee, 0)) * t.satellite_seats, 2)
    INTO v_seat FROM public.tournaments t2 WHERE t2.id = v_target;
  v_pool := round(COALESCE(t.prize_pool, 0), 2);
  v_short := round(GREATEST(0, COALESCE(v_seat, 0) - v_pool), 2);
  IF v_short <= 0 THEN RETURN 0; END IF;

  -- The same banks, order and alerts as the start funding it replaces.
  v_union := CASE WHEN COALESCE(t.is_private, false) THEN NULL ELSE t.union_id END;
  IF v_union IS NOT NULL THEN
    SELECT chip_balance INTO v_bank FROM public.union_wallets WHERE union_id = v_union FOR NO KEY UPDATE;
    v_from := 'union_bank';
    IF COALESCE(v_bank, 0) < v_short THEN
      SELECT chip_treasury INTO v_fallback FROM public.clubs WHERE id = t.club_id FOR NO KEY UPDATE;
      IF COALESCE(v_fallback, 0) >= v_short THEN
        v_from := 'club_treasury';
        PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
        UPDATE public.clubs SET chip_treasury = COALESCE(chip_treasury, 0) - v_short, updated_at = now()
         WHERE id = t.club_id;
        PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
        PERFORM public.fn_raise_server_financial_alert(
          'warning', 'fn_ca_fund_satellite_seats_at_close_locked',
          format('%s took its %s chip seat overlay from the club treasury: the union bank held only %s. The seats WERE funded. Refill the union bank.',
                 COALESCE(t.name, t.id::text), v_short, COALESCE(v_bank, 0)),
          jsonb_build_object('kind', 'overlay_funded_from_fallback', 'tournament_id', t.id,
            'shortfall', v_short, 'union_bank', COALESCE(v_bank, 0), 'club_treasury', COALESCE(v_fallback, 0)),
          t.id::text);
        v_union := NULL;
      ELSE
        PERFORM public.fn_raise_server_financial_alert(
          'critical', 'fn_ca_fund_satellite_seats_at_close_locked',
          format('%s needs %s chips to fund its guaranteed seats. The union bank holds %s and the club treasury holds %s. BOTH are short and the pool was NOT topped up.',
                 COALESCE(t.name, t.id::text), v_short, COALESCE(v_bank, 0), COALESCE(v_fallback, 0)),
          jsonb_build_object('kind', 'overlay_unfunded', 'tournament_id', t.id, 'shortfall', v_short,
            'bank', COALESCE(v_bank, 0), 'club_treasury', COALESCE(v_fallback, 0)),
          t.id::text);
        RETURN 0;
      END IF;
    ELSE
      PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
      UPDATE public.union_wallets SET chip_balance = chip_balance - v_short, updated_at = now()
       WHERE union_id = v_union;
      PERFORM set_config('app.ledger_autoskip_union_wallets', '0', true);
    END IF;
  ELSE
    SELECT chip_treasury INTO v_bank FROM public.clubs WHERE id = t.club_id FOR NO KEY UPDATE;
    v_from := 'club_treasury';
    IF COALESCE(v_bank, 0) < v_short THEN
      PERFORM public.fn_raise_server_financial_alert(
        'critical', 'fn_ca_fund_satellite_seats_at_close_locked',
        format('%s needs %s chips to fund its guaranteed seats and the club treasury holds %s. The pool was NOT topped up.',
               COALESCE(t.name, t.id::text), v_short, COALESCE(v_bank, 0)),
        jsonb_build_object('kind', 'overlay_unfunded', 'tournament_id', t.id, 'shortfall', v_short,
          'bank', COALESCE(v_bank, 0)),
        t.id::text);
      RETURN 0;
    END IF;
    PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
    UPDATE public.clubs SET chip_treasury = COALESCE(chip_treasury, 0) - v_short, updated_at = now()
     WHERE id = t.club_id;
    PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
  END IF;

  -- The explicit leg; zz_ca_escrow_overlay_leg credits the event's escrow.
  INSERT INTO public.chip_ledger (
    performed_by, from_type, from_entity_id, to_type, to_entity_id,
    amount, category, club_id, tournament_id, idempotency_key, description)
  VALUES (
    COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
    v_from, COALESCE(v_union, t.club_id), 'prize_liability', t.id,
    v_short, 'overlay', t.club_id, t.id, k,
    format('Satellite Seat Guarantee Funded At Entry Close: %s (%s) was %s short of %s seats worth %s',
           COALESCE(t.name, 'tournament'), t.id::text, v_short, t.satellite_seats, v_seat));
  UPDATE public.tournaments SET prize_pool = round(COALESCE(prize_pool, 0) + v_short, 2)
   WHERE id = t.id;
  RETURN v_short;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_fund_satellite_seats_at_close_locked(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_overlay_waits_for_entry_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_tid uuid := COALESCE(NEW.to_entity_id, NEW.tournament_id);
BEGIN
  IF NEW.to_type IS DISTINCT FROM 'prize_liability'
     OR NEW.category IS NULL OR NEW.category NOT IN ('overlay', 'promo_send')
     OR NEW.from_type IS NULL OR NEW.from_type NOT IN ('union_bank', 'union_wallet', 'club_treasury')
     OR v_tid IS NULL THEN
    RETURN NEW;
  END IF;
  -- A Free Buy entry's bounty part, booked at sign-up, is the free entry's own
  -- funding, not an overlay.
  IF COALESCE(NEW.idempotency_key, '') LIKE 'tourney:%:promo_head:%' THEN RETURN NEW; END IF;
  -- The one authority that decided the period has ended for this event, in
  -- this transaction (fn_apply_prize_guarantee, or a satellite start with no
  -- entry period after it).
  IF current_setting('ca.guarantee_entry_period_ended', true) = v_tid::text THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = v_tid) THEN RETURN NEW; END IF;
  IF public.fn_ca_guarantee_entry_period_ended(v_tid) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'GUARANTEE_CHIPS_BEFORE_ENTRY_CLOSE: % chips of % for tournament % refused: registration, rebuys and the add-on have not all ended',
    NEW.amount, NEW.category, v_tid
    USING ERRCODE = '55000',
          HINT = 'Owner law 2026-11-14: no overlay chips until the registration / rebuy / add-on period has ended';
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_overlay_waits_for_entry_close() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_close_tournament_entry_window(p_tournament_id uuid, p_source text DEFAULT 'engine.entry_window_close'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_deadline timestamptz;
  v_retry_ms bigint;
  v_mode text;
BEGIN
  /* THE LANE BEFORE THE ROW (2026-10-25). G shared, then T(id) exclusive,
     then the tournaments row: the order of every other writer of this
     event. Finalizing the pool here fires the deferred payer, which asks
     for T(id) exclusive at COMMIT; holding the row without the lane made
     that a deadlock with any rebuy, add-on or hand that holds T(id) and
     waits for the row. Taken first, the payer's request is re-entrant. */
  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  END IF;
  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  IF v_t.status<>'RUNNING' THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','tournament_not_running','status',v_t.status);
  END IF;

  -- The admission predicate already owns the earliest level/clock cutoff.
  -- Report a clock-bounded hybrid as minutes so the serving engine arms its
  -- existing database-relative deadline timer as well as its level events.
  v_mode := CASE WHEN COALESCE(v_t.late_reg_mins,0)>0 THEN 'minutes'
    WHEN COALESCE(v_t.late_reg_levels,v_t.rebuy_levels,0)>0 THEN 'levels'
    ELSE 'immediate' END;
  IF v_mode='minutes' AND v_t.started_at IS NULL
     AND NOT COALESCE(v_t.prize_pool_finalized,false) THEN
    RETURN jsonb_build_object('ok',false,
      'reason','started_at_required_for_minutes_window','window_mode',v_mode);
  END IF;
  -- Owner 2026-10-31: elapsed minutes and a full field cannot start add-ons
  -- before the last configured late-entry level has completed. Admission
  -- retains its existing clock/cap rules; this is the add-on/pool transition.
  IF COALESCE(v_t.add_on_available,false)
     AND NOT COALESCE(v_t.prize_pool_finalized,false)
     AND COALESCE(v_t.late_reg_levels,v_t.rebuy_levels,0)>0
     AND (v_t.current_level IS NULL OR
          v_t.current_level<COALESCE(v_t.late_reg_levels,v_t.rebuy_levels,0)) THEN
    RETURN jsonb_build_object('ok',true,'entry_closed',false,
      'window_mode','levels','retry_after_ms',NULL,
      'reason','addon_waiting_for_late_entry_levels');
  END IF;
  IF (NOT COALESCE(v_t.add_on_available,false)
          AND public.fn_tournament_late_registration_open(p_tournament_id))
     OR (COALESCE(v_t.add_on_available,false)
         AND NOT COALESCE(v_t.prize_pool_finalized,false)
         AND COALESCE(v_t.late_reg_levels,v_t.rebuy_levels,0)<=0
         AND COALESCE(v_t.late_reg_mins,0)>0
         AND clock_timestamp()<v_t.started_at+make_interval(mins=>v_t.late_reg_mins)) THEN
    IF v_mode='minutes' THEN
      v_deadline:=v_t.started_at+make_interval(mins=>v_t.late_reg_mins);
      v_retry_ms:=GREATEST(
        ceil(extract(epoch FROM (v_deadline-clock_timestamp()))*1000),0)::bigint;
    END IF;
    RETURN jsonb_build_object('ok',true,'entry_closed',false,
      'window_mode',v_mode,'retry_after_ms',v_retry_ms);
  END IF;

  -- Add-on chips can still change the final pool. Close entry now, but let the
  -- persisted add-on deadline own finalization and its receipt.
  IF COALESCE(v_t.add_on_available,false)
     AND NOT COALESCE(v_t.prize_pool_finalized,false) THEN
    RETURN jsonb_build_object(
      'ok',true,'entry_closed',true,'window_mode',v_mode,
      'finalized',false,'finalization_deferred',true,
      'reason','addon_required','retry_after_ms',NULL);
  END IF;

  /* NO OVERLAY CHIPS BEFORE THE REBUY WINDOW CLOSES (Dan, 2026-11-14: "NO
     CHIPS ARE EVER EVER EVER SUPPOSED TO GO TO ANY TOURNAMENT 'FOR OVERLAYS'
     UNTIL THE REGISTRATION / REBUY / ADD ON PERIOD HAS OFFICALLY ENDED").
     Finalizing funds the guarantee, and it also ends rebuys
     (fn_ca_tournament_rebuy_window answers closed once the pool is final). An
     event whose rebuy levels outlast its late-registration levels (the 25 Chip
     Bankroll Builder and Sunday 200 Deep Stack: 9 late-registration levels,
     12 rebuy levels, no add-on) was finalized at level 9: the guarantee was
     funded while three configured rebuy levels were still ahead, and those
     rebuys were refused. Registration still closes at its own level; the pool
     stays open and unfunded until the rebuy window closes. The engine asks
     again at every blind transition (levels), or at the clock deadline. */
  IF NOT COALESCE(v_t.prize_pool_finalized,false)
     AND COALESCE((public.fn_ca_tournament_rebuy_window(p_tournament_id)->>'open')::boolean,false) THEN
    IF COALESCE(v_t.late_reg_mins,0)>0 AND v_t.started_at IS NOT NULL THEN
      v_deadline:=v_t.started_at+make_interval(mins=>v_t.late_reg_mins);
      v_retry_ms:=GREATEST(
        ceil(extract(epoch FROM (v_deadline-clock_timestamp()))*1000),0)::bigint;
      RETURN jsonb_build_object('ok',true,'entry_closed',false,
        'window_mode','minutes','retry_after_ms',v_retry_ms,'reason','rebuy_window_open');
    END IF;
    RETURN jsonb_build_object('ok',true,'entry_closed',false,
      'window_mode','levels','retry_after_ms',NULL,'reason','rebuy_window_open');
  END IF;

  RETURN public.fn_finalize_tournament_entry_pool_locked(
    p_tournament_id,p_source,v_mode);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_apply_prize_guarantee(p_tournament_id uuid, p_source text DEFAULT 'engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_overlay numeric;
  v_ledger_count integer;
  v_escrow public.tournament_escrow%ROWTYPE;
  v_return jsonb := NULL;
  v_refusal jsonb;
BEGIN
  /* THE LANE BEFORE THE ROW (2026-10-25). G shared, then T(id) exclusive,
     then the tournaments row: the order of every other writer of this
     event. Finalizing the pool here fires the deferred payer, which asks
     for T(id) exclusive at COMMIT; holding the row without the lane made
     that a deadlock with any rebuy, add-on or hand that holds T(id) and
     waits for the row. Re-entrant for callers that already hold it. */
  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  END IF;
  /* NO GUARANTEE CHIPS BEFORE THE ENTRY PERIOD ENDS (Dan, 2026-11-14: "NO
     CHIPS ARE EVER EVER EVER SUPPOSED TO GO TO ANY TOURNAMENT 'FOR OVERLAYS'
     UNTIL THE REGISTRATION / REBUY / ADD ON PERIOD HAS OFFICALLY ENDED").
     Every overlay, guarantee promo and Free Buy cutoff funding below moves
     only after registration, rebuys and the add-on have all ended
     (fn_ca_guarantee_entry_period_ended). The two settlement authorities
     close a finished event: once its winner is known no entry can follow. */
  IF p_tournament_id IS NOT NULL
     AND COALESCE(p_source,'') NOT IN ('engine.fn_settle_tournament_places',
                                       'engine.fn_settle_tournament_final_table_deal')
     AND NOT public.fn_ca_guarantee_entry_period_ended(p_tournament_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','entry_period_open','retryable',true,
      'detail','No guarantee chips move until registration, rebuys and the add-on have all ended');
  END IF;
  IF p_tournament_id IS NOT NULL THEN
    PERFORM set_config('ca.guarantee_entry_period_ended',p_tournament_id::text,true);
  END IF;
  /* A GUARANTEE IS A FLOOR (2026-10-01). The start-time overlay part that
     money collected since has made unnecessary goes back to its bank before
     the pool is finalized, so the final pool is max(guarantee, collected).
     One subtransaction with the finalization: a refused finalization rolls
     the return back too, and the caller sees the refusal unchanged. */
  BEGIN
    v_return := public.fn_ca_return_excess_start_overlay_locked(p_tournament_id);
    /* A SATELLITE'S GUARANTEED SEATS ARE FUNDED HERE, AT THE CLOSE (2026-11-14),
       not at its start, whenever it has an entry period after the start. */
    PERFORM public.fn_ca_fund_satellite_seats_at_close_locked(p_tournament_id);
    /* TICKET FUNDING IS PART OF H (2026-11-05): promo above max(0, G - C)
       goes back to the promo wallet before the pool finalizes. */
    /* FREE BUY PROMO MOVES AT THE CUTOFF (2026-11-06): the prize-pool
       promo part is funded once here, after every entry window closed. */
    PERFORM public.fn_ca_fund_free_buy_at_cutoff_locked(p_tournament_id);
    PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);
    PERFORM public.fn_ca_fund_union_guarantee_promo_locked(p_tournament_id);
    v_result:=public.fn_ca_apply_prize_guarantee_core(
      p_tournament_id,p_source);
    IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
      v_refusal := v_result;
      RAISE EXCEPTION USING ERRCODE='P0405',
        MESSAGE='guarantee finalization refused; the excess return is rolled back with it';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0405' THEN
    RETURN v_refusal;
  END;
  v_overlay:=COALESCE((v_result->>'overlay')::numeric,0);
  IF v_overlay::text IN ('NaN','Infinity','-Infinity')
     OR v_overlay<0 OR v_overlay IS DISTINCT FROM round(v_overlay,2) THEN
    RAISE EXCEPTION 'guarantee core returned invalid overlay %',v_overlay
      USING ERRCODE='P0404';
  END IF;
  IF v_overlay>0 THEN
    SELECT count(*) INTO v_ledger_count
      FROM public.chip_ledger l
     WHERE l.idempotency_key=
             'tourney:'||p_tournament_id::text||':guarantee_overlay'
       AND l.tournament_id=p_tournament_id
       AND l.to_type='prize_liability'
       AND l.to_entity_id=p_tournament_id
       AND l.category='overlay'
       AND l.amount=v_overlay
       AND l.from_entity_id=(v_result->>'bank_entity_id')::uuid
       AND l.from_type=CASE WHEN v_result->>'bank_type'='union'
                            THEN 'union_bank' ELSE 'club_treasury' END;
    SELECT * INTO v_escrow
      FROM public.tournament_escrow e
     WHERE e.tournament_id=p_tournament_id
     FOR UPDATE;
    IF v_ledger_count<>1 OR NOT FOUND
       OR COALESCE(v_escrow.enforced,false) IS NOT TRUE
       OR v_result->>'escrow_after' IS NULL
       OR v_escrow.prize_balance IS DISTINCT FROM
            (v_result->>'escrow_after')::numeric THEN
      RAISE EXCEPTION
        'guarantee overlay is not one exact journaled escrow credit'
        USING ERRCODE='P0404';
    END IF;
  END IF;
  RETURN v_result||jsonb_build_object('overlay_journaled',true)
    ||CASE WHEN v_return IS NOT NULL
           THEN jsonb_build_object('excess_overlay_returned',v_return)
           ELSE '{}'::jsonb END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_fund_overlay_on_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_short numeric; v_union uuid; v_bank numeric; v_from text; v_store text;
  v_pool_before numeric;
  v_entrants int; v_places int; v_existing jsonb;
  v_guarantee numeric; v_seat_guarantee numeric; v_target uuid;
  v_attempt int; v_fallback numeric;
BEGIN
  IF NOT (COALESCE(OLD.status,'') IN ('ANNOUNCED','REGISTERING')
          AND NEW.status IN ('RUNNING','COMPLETING','COMPLETED')) THEN
    RETURN NEW;
  END IF;

  /* ── 1. payout table, from the field that actually entered ─────────────
     Only when nobody has registered yet. With registrations present,
     fn_guard_managed_game_lifecycle protects payout_structure and this
     trigger currently runs BEFORE it, so writing here refuses the whole
     start. Re-enabled once the trigger is renamed to sort after the guard.

     NOT FOR A SPIN (2026-09-02). A Spin's ladder comes from the tier the
     wheel drew - 10x is 80/20 - and this rule is "pay the top N% of the
     field", which on three seats rounds to one place and silently replaced
     every high multiplier with winner-take-all. 32 games, 1,592 chips. */
  SELECT count(*) INTO v_entrants
    FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id;

  -- A recovered RUNNING transition is not a new payout contract. The row
  -- is locked by its owning UPDATE; prepared/paid terms cannot be refitted
  -- to today's field. Keep the existing overlay transaction below intact.
  IF public.fn_tournament_payout_terms_committed_v1(OLD.id) THEN
    IF OLD.prize_pool_finalized IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Committed tournament payout terms have no finalized pool'
        USING ERRCODE='55000';
    END IF;
  ELSIF lower(COALESCE(NEW.variant,''))<>'spin'
        AND upper(COALESCE(NEW.tournament_type,''))<>'SPIN' THEN
    IF v_entrants > 0 AND NOT EXISTS (
         SELECT 1 FROM pg_trigger tg
          WHERE tg.tgrelid = 'public.tournaments'::regclass
            AND tg.tgname = 'zz_ca_fund_overlay_on_lock')
    THEN
      NULL;  -- stand down: the guard would refuse the start
    ELSIF v_entrants > 0 THEN
      /* Same rule as the entry close: a mystery bounty of 10 or fewer
         entries (rows plus rebuys) with at least 3 players pays 50/30/20
         (Dan, 2026-10-05). */
      v_places := CASE
        WHEN COALESCE(NEW.is_mystery_bounty,false) AND v_entrants >= 3
         AND (SELECT (count(*)+COALESCE(sum(GREATEST(COALESCE(tp.rebuys,0),0)),0))::integer
                FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id) BETWEEN 1 AND 10
        THEN 3
        ELSE GREATEST(1, LEAST(v_entrants,
                    ceil(v_entrants * public.fn_ca_effective_payout_depth(NEW.payout_depth_percent,NEW.payout_percent) / 100.0)::int)) END;
      BEGIN
        v_existing := NULLIF(btrim(COALESCE(NEW.payout_structure,'')), '')::jsonb;
      EXCEPTION WHEN OTHERS THEN v_existing := NULL; END;

      IF v_existing IS NULL
         OR jsonb_typeof(v_existing) <> 'array'
         OR jsonb_array_length(v_existing) = 0
         OR v_existing = '[{"place":1,"percentage":100}]'::jsonb
         OR jsonb_array_length(v_existing) <> v_places
      THEN
        NEW.payout_structure := CASE
          WHEN COALESCE(NEW.is_mystery_bounty,false) AND v_entrants >= 3
           AND (SELECT (count(*)+COALESCE(sum(GREATEST(COALESCE(tp.rebuys,0),0)),0))::integer
                  FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id) BETWEEN 1 AND 10
          THEN '[{"place":1,"percentage":50},{"place":2,"percentage":30},{"place":3,"percentage":20}]'::jsonb::text
          ELSE public.fn_ca_payout_structure(
                                  v_entrants, public.fn_ca_effective_payout_depth(NEW.payout_depth_percent,NEW.payout_percent))::text END;
      END IF;
    END IF;
  END IF;

  /* ── 2. the guarantee overlay, from the main bank ─────────────────────── */
  v_pool_before := round(COALESCE(NEW.prize_pool,0),2);
  v_guarantee   := public.fn_ca_place_guarantee(NEW.guaranteed_prize, NEW.bounty_pool);

  /* A GUARANTEED SEAT IS A GUARANTEE (2026-09-02). A satellite's advertised
     seats are worth target buy-in + fee each; the engine awards every one of
     them, so the bank funds the shortfall here, like any other guarantee. */
  IF COALESCE(NEW.satellite_seats, 0) > 0
     AND (NEW.variant = 'satellite'
          OR UPPER(COALESCE(NEW.tournament_type, '')) = 'SATELLITE'
          OR NEW.satellite_target_id IS NOT NULL) THEN
    v_target := COALESCE(NEW.satellite_target_id, NEW.satellite_target);
    IF v_target IS NOT NULL THEN
      SELECT round((COALESCE(t2.buy_in_amount,0) + COALESCE(t2.buy_in_fee,0)) * NEW.satellite_seats, 2)
        INTO v_seat_guarantee
        FROM public.tournaments t2 WHERE t2.id = v_target;
      v_guarantee := GREATEST(v_guarantee, COALESCE(v_seat_guarantee, 0));
    END IF;
  END IF;

  v_short := GREATEST(0, v_guarantee - v_pool_before);
  /* A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05).
     On a chip event the place floor is what the close-out will pay: the
     places collected plus the house share the ledger says is still due,
     where the field's whole payment (places + bounties + rake) is credited
     toward the guarantee. The guaranteed seats of a satellite, which the
     close-out does not cover, keep their full value against the places.
     The Diamond arm below keeps its place-based guarantee. */
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds') THEN
    v_short := GREATEST(0,
      GREATEST(public.fn_ca_guarantee_place_floor(NEW.id, NEW.prize_pool, NEW.guaranteed_prize, NEW.bounty_pool),
               COALESCE(v_seat_guarantee, 0))
      - v_pool_before);
  END IF;
  /* 2026-10-06 (20261007000010): A DIAMOND OVERLAY IS PAID FROM THE HOUSE AT
     LOCK. The shortfall moves from ca_diamond_house into the event's entry
     custody through fn_poker_diamond_tournament_settle_overlay (a house burn
     and a player-registered credit per custody share, each with its movement
     and an 'overlay' ledger row, so custody and the ledger agree), the
     earmark records the payment, and whatever the guarantee no longer needs
     is released back to the house's available balance. Never a chip bank. */
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds') THEN
    IF v_short > 0 THEN
      v_short := public.fn_poker_diamond_tournament_settle_overlay(NEW.id, 'lock', v_guarantee);
      NEW.prize_pool := round(v_pool_before + v_short, 2);
    END IF;
    PERFORM public.fn_poker_diamond_guarantee_release(NEW.id, 'lock');
    RETURN NEW;
  END IF;
  IF v_short <= 0 THEN RETURN NEW; END IF;
  /* A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES (Dan, 2026-11-04).
     The close-out (fn_ca_apply_prize_guarantee_core) pays only the real
     shortfall when the pool finalizes. Only a satellite's guaranteed seats,
     which the close-out does not cover, are still funded here. */
  IF COALESCE(v_seat_guarantee, 0) <= 0 THEN RETURN NEW; END IF;
  /* NO OVERLAY CHIPS BEFORE THE ENTRY PERIOD ENDS (Dan, 2026-11-14). A
     satellite with late registration, rebuys, re-entry or an add-on still has
     its entry period ahead at the start: its guaranteed seats are funded at
     the close (fn_ca_fund_satellite_seats_at_close_locked), never here. A
     satellite with none of those closes its entry at the start, so the start
     is its close and the seats are funded now. */
  IF COALESCE(NEW.late_reg_levels, NEW.rebuy_levels, 0) > 0
     OR COALESCE(NEW.late_reg_mins, 0) > 0
     OR COALESCE(NEW.is_rebuy, false) OR COALESCE(NEW.is_reentry, false)
     OR COALESCE(NEW.add_on_available, false) THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('ca.guarantee_entry_period_ended', NEW.id::text, true);

  /* DIAMOND PHASE 9, STEP 0 (2026-09-29): a Diamond event is never topped up from a
     chip bank. A shortfall (a guarantee, or a satellite's guaranteed seats) waits for a
     Diamond destination; until one exists the start is refused by name rather than
     funded from the Diamond Arena's chip treasury or started without its overlay. */
  -- (2026-10-06: the Diamond arm above returns before this point.)

  PERFORM set_config('app.ledger_category', 'overlay', true);
  PERFORM set_config('app.ledger_counterparty', 'prize_liability', true);
  PERFORM set_config('app.ledger_counterparty_entity', NEW.id::text, true);

  v_union := CASE WHEN COALESCE(NEW.is_private,false) THEN NULL ELSE NEW.union_id END;

  /* FOR NO KEY UPDATE, NOT FOR UPDATE (2026-10-05). The start-readiness guard
     already locks this bank row FOR NO KEY UPDATE in the same transaction
     (20260929071925, installed by 20261002083400). FOR UPDATE here upgraded
     that lock mid-start to the one mode that also conflicts with FOR KEY
     SHARE, so an overlay start still queued behind every open foreign-key
     insert that references the club. A treasury debit is a non-key update
     and needs no more than this; start-vs-start and every treasury write
     still serialize exactly as before. */
  IF v_union IS NOT NULL THEN
    SELECT chip_balance INTO v_bank FROM public.union_wallets
     WHERE union_id = v_union FOR NO KEY UPDATE;
    v_from := 'union_bank';
    v_store := 'union_wallets.chip_balance';
    IF COALESCE(v_bank,0) < v_short THEN
      /* THE MAIN BANK IS SHORT - FALL BACK TO THE CLUB TREASURY.
         Dan 2026-09-04. Refusing here meant advertising a guarantee and then
         not paying it. */
      SELECT chip_treasury INTO v_fallback
        FROM public.clubs WHERE id = NEW.club_id FOR NO KEY UPDATE;

      IF COALESCE(v_fallback,0) >= v_short THEN
        v_from  := 'club_treasury';
        v_store := 'clubs.chip_treasury';
        PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
        UPDATE public.clubs
           SET chip_treasury = COALESCE(chip_treasury,0) - v_short, updated_at = now()
         WHERE id = NEW.club_id;
        PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
        PERFORM public.fn_raise_server_financial_alert(
          'warning', 'fn_ca_fund_overlay_on_lock',
          format('%s took its %s chip overlay from the club treasury: the union bank held only %s. The guarantee WAS met. Refill the union bank.',
                 COALESCE(NEW.name, NEW.id::text), v_short, COALESCE(v_bank,0)),
          jsonb_build_object('kind','overlay_funded_from_fallback','tournament_id',NEW.id,
            'shortfall',v_short,'union_bank',COALESCE(v_bank,0),
            'club_treasury',COALESCE(v_fallback,0)), NEW.id::text);
        v_union := NULL;  -- the ledger row names the account that actually moved
      ELSE
        PERFORM public.fn_raise_server_financial_alert(
          'critical', 'fn_ca_fund_overlay_on_lock',
          format('%s needs %s chips of overlay to meet its %s guarantee. The union bank holds %s and the club treasury holds %s. BOTH are short and the pool was NOT topped up.',
                 COALESCE(NEW.name, NEW.id::text), v_short, v_guarantee,
                 COALESCE(v_bank,0), COALESCE(v_fallback,0)),
          jsonb_build_object('kind','overlay_unfunded','tournament_id',NEW.id,
            'shortfall',v_short,'bank',COALESCE(v_bank,0),
            'club_treasury',COALESCE(v_fallback,0)), NEW.id::text);
        RETURN NEW;
      END IF;
    ELSE
      PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
      UPDATE public.union_wallets
         SET chip_balance = chip_balance - v_short, updated_at = now()
       WHERE union_id = v_union;
      PERFORM set_config('app.ledger_autoskip_union_wallets', '0', true);
    END IF;
  ELSE
    SELECT chip_treasury INTO v_bank FROM public.clubs
     WHERE id = NEW.club_id FOR NO KEY UPDATE;
    v_from := 'club_treasury';
    v_store := 'clubs.chip_treasury';
    IF COALESCE(v_bank,0) < v_short THEN
      PERFORM public.fn_raise_server_financial_alert(
        'critical', 'fn_ca_fund_overlay_on_lock',
        format('%s needs %s chips of overlay to meet its %s guarantee and the club treasury holds %s. The pool was NOT topped up.',
               COALESCE(NEW.name, NEW.id::text), v_short,
               v_guarantee, COALESCE(v_bank,0)),
        jsonb_build_object('kind','overlay_unfunded','tournament_id',NEW.id,
          'shortfall',v_short,'bank',COALESCE(v_bank,0)), NEW.id::text);
      RETURN NEW;
    END IF;
    PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
    UPDATE public.clubs
       SET chip_treasury = COALESCE(chip_treasury,0) - v_short, updated_at = now()
     WHERE id = NEW.club_id;
    PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
  END IF;

  NEW.prize_pool := round(v_pool_before + v_short, 2);

  -- Funding and its escrow/journal leg are one transaction. A failed
  -- journal insert must undo the bank debit and the advertised pool change.
  -- Retry only transient deadlocks; every final error propagates to the
  -- original status update, whose existing lifecycle can retry safely.
  FOR v_attempt IN 1..3 LOOP
    BEGIN
      INSERT INTO public.chip_ledger (
        performed_by, from_type, from_entity_id, to_type, to_entity_id,
        amount, category, club_id, tournament_id, description)
      VALUES (
        COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
        v_from, COALESCE(v_union, NEW.club_id), 'prize_liability', NEW.id,
        v_short, 'overlay', NEW.club_id, NEW.id,
        format('Guarantee overlay from the main bank: %s (%s) was %s short of its %s guarantee - field made %s, bank paid %s',
               COALESCE(NEW.name, 'tournament'), NEW.id::text,
               v_short, v_guarantee,
               v_pool_before, v_short));
      EXIT;
    EXCEPTION WHEN deadlock_detected THEN
      IF v_attempt = 3 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;


-- The replaced images keep the installed ACL (postgres and service_role only),
-- stated here so no default PUBLIC grant can ever apply to them.
REVOKE ALL ON FUNCTION public.fn_close_tournament_entry_window(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_close_tournament_entry_window(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_apply_prize_guarantee(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_prize_guarantee(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_fund_overlay_on_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_fund_overlay_on_lock() TO service_role;

DO $postimage$ BEGIN
  IF position('rebuy_window_open' in pg_get_functiondef('public.fn_close_tournament_entry_window(uuid,text)'::regprocedure)) = 0
     OR position('fn_ca_guarantee_entry_period_ended(p_tournament_id)' in pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure)) = 0
     OR position('fn_ca_fund_satellite_seats_at_close_locked(p_tournament_id)' in pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure)) = 0
     OR position('ca.guarantee_entry_period_ended' in pg_get_functiondef('public.fn_ca_fund_overlay_on_lock()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'GUARANTEE_ENTRY_CLOSE_POSTIMAGE_MISSING';
  END IF;
END $postimage$;

COMMIT;
