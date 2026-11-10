-- Split the actual prize at the locked owner balance, including outstanding
-- wheel movements. The player's prize is never reduced by the funding split.
-- Qualify on the fixture through the paid-spin and earned-bonus RPCs.
-- @live-proof: to_regprocedure('public.fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)') IS NOT NULL AND to_regprocedure('public.fn_wheel_state_v2(uuid,bigint)') IS NOT NULL AND position('Choose One Spin At A Time' IN pg_get_functiondef('public.fn_wheel_batch_begin(uuid,text)'::regprocedure))>0
-- @live-proof: (SELECT count(*)=5 FROM pg_attribute WHERE (attrelid='public.diamond_transactions'::regclass AND attname IN ('amount','balance_after') OR attrelid='public.ca_diamond_balance_audit'::regclass AND attname IN ('old_diamonds','new_diamonds','delta')) AND atttypid='bigint'::regtype) AND EXISTS(SELECT 1 FROM public.wheel_journal_copy_progress WHERE verified_at IS NOT NULL)
-- A club or union has no diamond wallet. Its owner pays personally. An unpaid
-- advance follows the owner across clubs and Chicago business days. The house
-- funds that advance and any excess; only the advance is recoverable.
-- @live-proof: (SELECT a.atttypid='bigint'::regtype FROM pg_attribute a WHERE a.attrelid='public.profiles'::regclass AND a.attname='diamonds') AND (SELECT c.convalidated FROM pg_constraint c WHERE c.conrelid='public.profiles'::regclass AND c.conname='profiles_diamonds_nonnegative')
-- @live-proof: position('fn_wheel_finance_prize' IN pg_get_functiondef('public.fn_wheel_diamond_cards_pick(uuid,smallint)'::regprocedure))>0 AND position('fn_wheel_repay_owner_advance' IN pg_get_functiondef('public.fn_diamond_spin_settle_day(uuid,date)'::regprocedure))>0 AND NOT has_function_privilege('authenticated','public.fn_wheel_finance_prize(public.wheel_card_awards,bigint)','execute')
-- @live-proof: (SELECT public.fn_wheel_card_values_wide(500000000::bigint,1000000000::bigint,0::smallint)=ARRAY[500000000,2000000000,3000000000]::bigint[]) AND position('payout_rules_version' IN pg_get_functiondef('public.fn_wheel_diamond_cards_pick(uuid,smallint)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
-- Refuse immediately unless the entire finite set is idle before any change.
LOCK TABLE public.profiles, public.diamond_transactions, public.diamond_wallets, public.user_diamonds, public.user_diamond_balance, public.ca_diamond_balance_audit, public.ca_diamond_journal_archive, public.diamond_spin_movements, public.wheel_card_awards, public.wheel_bonus_awards, public.diamond_bonus_entries, public.diamond_choice_rounds, public.crash_rounds, public.wheel_spins, public.diamond_spin_days IN ACCESS EXCLUSIVE MODE NOWAIT;
-- Require a finished, independently verified copy of the two large relations.
-- The staging triggers have remained active since their copy horizon was sealed.
DO $prepared$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.wheel_journal_copy_progress WHERE id AND journal_done AND audit_done AND verified_at IS NOT NULL)
  OR 2<>(SELECT count(*) FROM pg_trigger WHERE tgfoid='public.fn_wheel_copy_wide_journal_row()'::regprocedure AND tgenabled IN('O','A')
   AND ((tgrelid='public.diamond_transactions'::regclass AND tgname='zzzz_wheel_copy_wide_journal')
    OR (tgrelid='public.ca_diamond_balance_audit'::regclass AND tgname='zzzz_wheel_copy_wide_audit'))) THEN
  RAISE EXCEPTION 'Complete and verify the staged diamond journal copy before cutover'; END IF;
END $prepared$;
CREATE FUNCTION public.fn_wheel_prize_funding(p_available bigint, p_prize bigint)
RETURNS TABLE(owner_diamonds bigint, platform_diamonds bigint, owner_shortfall bigint)
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
 IF p_prize < 0 OR p_available < -10000 THEN
  RAISE EXCEPTION 'Invalid Diamond Spins prize or owner balance';
 END IF;
 owner_diamonds := least(p_prize, p_available::numeric + 10000);
 platform_diamonds := p_prize - owner_diamonds;
 owner_shortfall := greatest(0, owner_diamonds - p_available);
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_prize_funding(bigint,bigint) FROM PUBLIC;

ALTER TABLE public.wheel_card_awards DROP CONSTRAINT wheel_card_awards_risk_diamonds_check,
 ADD CHECK (risk_diamonds > 0);
ALTER TABLE public.wheel_bonus_awards DROP CONSTRAINT wheel_bonus_awards_entry_diamonds_check,
 DROP CONSTRAINT wheel_bonus_awards_base_diamonds_check, ADD CHECK (entry_diamonds > 0 AND base_diamonds > 0);
ALTER TABLE public.diamond_bonus_entries DROP CONSTRAINT diamond_bonus_entries_budget_shape,
 ADD CONSTRAINT diamond_bonus_entries_budget_shape CHECK (
  (wheel_award_id IS NULL AND base_diamonds BETWEEN 25 AND 2500 AND added_diamonds IN (0,base_diamonds))
  OR (wheel_award_id IS NOT NULL AND base_diamonds > 0 AND added_diamonds BETWEEN 0 AND base_diamonds));

-- Apply the guarantee to awards first played after installation, including awards
-- still waiting from an older wheel. Completed and already-open legacy rounds
-- keep the contract sealed when they started.
ALTER TABLE public.wheel_bonus_awards ADD COLUMN play_rules_version smallint;
CREATE FUNCTION public.fn_wheel_bonus_guarantee(a public.wheel_bonus_awards)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path=public AS $guarantee$
 SELECT coalesce((SELECT jsonb_build_object('payout_rules_version',2,
   'wheel_diamonds_per_chip',s.diamonds_per_chip,
   'wheel_minimum_payout_chips',coalesce((s.receipt_v2->>'minimum_bonus_payout_chips')::numeric,
      ceil(a.base_diamonds::numeric*150/s.diamonds_per_chip)/100))
 FROM public.wheel_spins s WHERE s.id=a.spin_id AND
 (a.status='pending' OR a.play_rules_version=2 OR s.receipt_v2->>'payout_rules_version'='2')),'{}'::jsonb)
$guarantee$;
REVOKE ALL ON FUNCTION public.fn_wheel_bonus_guarantee(public.wheel_bonus_awards) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.fn_wheel_earned_prize_floor(p_commit uuid)
RETURNS numeric LANGUAGE sql STABLE STRICT SET search_path=public AS $floor$
 SELECT (public.fn_wheel_bonus_guarantee(a)->>'wheel_minimum_payout_chips')::numeric
 FROM public.wheel_bonus_awards a WHERE a.commit_id=p_commit
$floor$;
REVOKE ALL ON FUNCTION public.fn_wheel_earned_prize_floor(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wheel_earned_prize_floor(uuid) TO service_role;

-- Day profits become playable at settlement. An owner's open negative days
-- already encumber the matching wallet diamonds, including when playing at another club.
CREATE FUNCTION public.fn_wheel_spendable(p_user uuid,p_wallet numeric)
RETURNS bigint LANGUAGE sql STABLE SET search_path=public AS $spendable$
 SELECT greatest(0,coalesce(p_wallet,0)-coalesce(sum(greatest(-pending_diamonds,0)),0))::bigint
 FROM public.diamond_spin_days WHERE owner_id=p_user AND status='open'
$spendable$;
REVOKE ALL ON FUNCTION public.fn_wheel_spendable(uuid,numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_wheel_purchased_balance(p_user uuid)
RETURNS bigint LANGUAGE sql STABLE SET search_path=public AS $purchased$
 SELECT coalesce(sum(issued-consumed-refunded),0)::bigint FROM public.diamond_purchase_lots
 WHERE user_id=p_user AND frozen_at IS NULL AND issued-consumed-refunded>0
$purchased$;
REVOKE ALL ON FUNCTION public.fn_wheel_purchased_balance(uuid) FROM PUBLIC,anon,authenticated;

-- Replace only verified source fragments so other installed accounting changes survive.
DO $migration$
DECLARE patch record; definition text; bodies jsonb:='{}'::jsonb;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
 ('public.fn_wheel_award_receipt(uuid)',$old$ WHERE a.commit_id=p_commit),'{}'::jsonb)$old$,$new$ WHERE a.commit_id=p_commit),'{}'::jsonb)
 || COALESCE((SELECT public.fn_wheel_bonus_guarantee(a) FROM public.wheel_bonus_awards a WHERE a.commit_id=p_commit),'{}'::jsonb)$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$  IF NOT p_welcome AND pool.chips_paid>pool.intake_diamonds/v_rate+cfg.exposure_allowance_chips THEN RAISE EXCEPTION 'The Wheel Exposure Limit Was Exceeded'; END IF;$old$,$new$$new$),
  ('public.fn_diamond_spin_chip_payouts(uuid,date)',$old$WHERE l.from_entity_id=h.store_id$old$,$new$WHERE (l.from_entity_id=h.store_id OR
      (h.host_kind='union' AND l.from_type='club_treasury' AND l.union_id=h.host_id))$new$),
  ('public.fn_diamond_spin_chip_payouts(uuid,date)',$old$l.from_type IN ('union_wallet','union_bank')$old$,$new$l.from_type IN ('union_wallet','union_bank','club_treasury')$new$),
  ('public.fn_diamond_spin_chip_payouts(uuid,date)',$old$h.host_kind='club' AND l.from_type IN ('promo_wallet','club_treasury')$old$,$new$h.host_kind='club' AND l.from_type IN ('promo_wallet','club_treasury')
          AND (l.from_type<>'club_treasury' OR l.union_id IS NULL)$new$),
  ('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)',$old$    IF p_kind = 'union' THEN
      UPDATE public.union_wallets SET chip_balance = COALESCE(chip_balance, 0) - from_bank, updated_at = now()
       WHERE union_id = p_host AND COALESCE(chip_balance, 0) >= from_bank
       RETURNING chip_balance INTO bank_after;
    ELSE
      UPDATE public.clubs SET chip_treasury = COALESCE(chip_treasury, 0) - from_bank, updated_at = now()
       WHERE id = p_host AND COALESCE(chip_treasury, 0) >= from_bank
       RETURNING chip_treasury INTO bank_after;
    END IF;
$old$,$new$    UPDATE public.clubs SET chip_treasury = COALESCE(chip_treasury, 0) - from_bank, updated_at = now()
     WHERE id = p_club AND COALESCE(chip_treasury, 0) >= from_bank
     RETURNING chip_treasury INTO bank_after;
$new$),
  ('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)',$old$  from_promo := LEAST(p_amount, v_lock.o_promo);$old$,$new$  IF p_kind = 'union' THEN
    SELECT COALESCE(chip_treasury, 0) INTO STRICT v_lock.o_bank
      FROM public.clubs WHERE id = p_club FOR UPDATE;
    v_lock.o_cover := v_lock.o_promo + v_lock.o_bank;
  END IF;
  from_promo := LEAST(p_amount, v_lock.o_promo);$new$),
  ('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)',$old$    IF from_bank > 0 THEN
      INSERT INTO public.union_wallet_transactions
        (union_id, club_id, wallet, direction, amount, balance_after, tx_type, notes, created_by)
      VALUES (p_host, p_club, 'chip_balance', 'debit', from_bank, bank_after, p_category,
              p_note || ' (promo wallet was short, the bank covered it)', p_user);
    END IF;
$old$,$new$$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$  IF v_today >= cfg.max_spins_per_player_per_day THEN
    RETURN jsonb_build_object('ok', false, 'error', format('You Have Reached Today''s Limit Of %s Spins', cfg.max_spins_per_player_per_day));
  END IF;$old$,$new$$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$p_entry_diamonds NOT BETWEEN 25 AND 2500$old$,$new$p_entry_diamonds < 1$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$p_entry_diamonds NOT BETWEEN 25 AND 2500$old$,$new$p_entry_diamonds < 1$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$Choose 25 To 2,500 Diamonds$old$,$new$Choose A Positive Whole Diamond Amount$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$ max_funded:=GREATEST(0,LEAST(2500,floor((cover-held)*rate/100),
   floor((COALESCE(owner_diamonds,0)-card_hold)/2),floor((float_now-card_hold_float)/2),
   floor((cfg.exposure_allowance_chips+COALESCE((s#>>'{pool,intake_diamonds}')::numeric,0)/rate-COALESCE((s#>>'{pool,chips_paid}')::numeric,0))*rate/99)))::integer;
$old$,$new$ max_funded:=COALESCE((s#>>'{player,diamonds}')::integer,0);
 max_funded:=public.fn_wheel_spendable(auth.uid(),max_funded);
 s:=jsonb_set(s,'{player,spendable}',to_jsonb(max_funded));
$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$ IF cover-held<ceil(p_entry_diamonds::numeric/rate*100*100)/100 OR COALESCE(owner_diamonds,0)+p_entry_diamonds-card_hold<3*p_entry_diamonds OR float_now+p_entry_diamonds-card_hold_float<3*p_entry_diamonds THEN funded:=false;reason:='The Host Must Fund Every Prize Before A Spin'; END IF;
 IF COALESCE((s#>>'{pool,chips_paid}')::numeric,0)+ceil(100*p_entry_diamonds::numeric/rate*100)/100>round((COALESCE((s#>>'{pool,intake_diamonds}')::numeric,0)+p_entry_diamonds)/rate,2)+cfg.exposure_allowance_chips THEN funded:=false;reason:='The Host Must Fund Every Prize Before A Spin'; END IF;
$old$,$new$$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$    IF gcfg.max_multiplier_cents<2000 THEN max_funded:=0;
    ELSE max_funded:=LEAST(max_funded,GREATEST(0,floor(rate*gcfg.cap_fraction*headroom/(minimum_cap::numeric/100-gcfg.cap_fraction)/boost))::integer); END IF;
    cap:=public.fn_diamond_game_cap_cents(gcfg,gp,cover,p_entry_diamonds*boost::numeric/rate,GREATEST(gcfg.max_multiplier_cents,minimum_cap));
    IF cap<2000*(boost+1)/boost OR gcfg.max_multiplier_cents<2000 THEN funded:=false;reason:='The Host Must Fund Every Bonus Before A Spin'; END IF;
$old$,$new$    IF gcfg.max_multiplier_cents<2000 THEN funded:=false;reason:='Every Bonus Game Must Support Its Prize Table'; END IF;
$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$'min_entry',25,'max_entry',2500,'max_funded_entry'$old$,$new$'min_entry',1,'max_entry',max_funded,'max_funded_entry'$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$'min_entry',25,'max_entry',2500));$old$,$new$'min_entry',1,'max_entry',max_funded));$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$  IF v_bank-v_reserved < ceil(v_price::numeric/v_rate*100*100)/100
   OR v_owner_dia+v_dia_now-v_card_hold<3*v_price
   OR (NOT p_welcome AND pool.diamond_float+v_dia_now-v_card_hold_float<3*v_price) THEN
   RETURN jsonb_build_object('ok',false,'error',v_cover_refusal); END IF;
$old$,$new$$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$  IF NOT p_welcome AND pool.chips_paid+ceil(100*v_price::numeric/v_rate*100)/100>v_intake_chips+cfg.exposure_allowance_chips THEN
   RETURN jsonb_build_object('ok',false,'error','The Host Must Fund Every Prize Before A Spin'); END IF;
$old$,$new$$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$    v_cap:=public.fn_diamond_game_cap_cents(v_gcfg,v_gpool,v_bank,v_budget::numeric/v_rate,GREATEST(v_gcfg.max_multiplier_cents,2000*(v_boost+1)/v_boost));
$old$,$new$    v_cap:=GREATEST(v_gcfg.max_multiplier_cents,2000*(v_boost+1)/v_boost);
$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$CASE WHEN cfg.purchased_only THEN LEAST(v_diamonds, v_purchased)::integer ELSE v_diamonds::integer END$old$,$new$v_diamonds::integer$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$    IF cfg.purchased_only THEN
      v_remaining := v_price;
      FOR v_lot IN SELECT * FROM public.diamond_purchase_lots l
                    WHERE l.user_id = v_user AND l.frozen_at IS NULL
                      AND (l.issued - l.consumed - l.refunded) > 0
                    ORDER BY l.created_at, l.id FOR UPDATE LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_lot.issued - v_lot.consumed - v_lot.refunded);
        UPDATE public.diamond_purchase_lots SET consumed = consumed + v_take WHERE id = v_lot.id;
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'fn_wheel_spin_core: purchased lots could not cover the spin (% short) after the availability check passed', v_remaining;
      END IF;
    END IF;
$old$,$new$    IF cfg.purchased_only THEN
      v_remaining := LEAST(v_price, v_purchased);
      FOR v_lot IN SELECT * FROM public.diamond_purchase_lots l
                    WHERE l.user_id = v_user AND l.frozen_at IS NULL
                      AND (l.issued - l.consumed - l.refunded) > 0
                    ORDER BY l.created_at, l.id FOR UPDATE LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_lot.issued - v_lot.consumed - v_lot.refunded);
        UPDATE public.diamond_purchase_lots SET consumed = consumed + v_take WHERE id = v_lot.id;
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'fn_wheel_spin_core: purchased lots could not cover the spin (% short) after the availability check passed', v_remaining;
      END IF;
    END IF;
$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$  SELECT * INTO v_run FROM public.wheel_runs WHERE user_id=v_user AND club_id=p_club_id AND status='open' FOR UPDATE;$old$,$new$  UPDATE public.wheel_runs SET status='closed',closed_at=transaction_timestamp()
   WHERE user_id=v_user AND club_id=p_club_id AND status='open';$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$p_bet<25 OR p_bet>(CASE WHEN award.id IS NULL THEN 5000 ELSE 7500 END)$old$,$new$p_bet<1 OR (award.id IS NULL AND p_bet NOT BETWEEN 25 AND 5000)$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$IF v_today >= o_cfg.max_rounds_per_player_per_day THEN$old$,$new$IF award.id IS NULL AND v_today >= o_cfg.max_rounds_per_player_per_day THEN$new$),
  ('public.fn_crash_start(uuid,uuid,text,integer,integer)',$old$IF pool.chips_paid + pool.reserved_chips >$old$,$new$IF (public.fn_wheel_starting_award()).id IS NULL AND pool.chips_paid + pool.reserved_chips >$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_cap:=GREATEST(v_gcfg.max_multiplier_cents,2000*(v_boost+1)/v_boost);$old$,$new$v_cap:=2000*(v_boost+1)/v_boost;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$IF v_cap<2000*(v_boost+1)/v_boost OR$old$,$new$IF v_cap<2000 OR$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$sum(3*c.risk_diamonds)$old$,$new$sum(3::bigint*c.risk_diamonds)$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$ELSE 3*c.risk_diamonds END$old$,$new$ELSE 3::bigint*c.risk_diamonds END$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$sum(3*c.risk_diamonds)$old$,$new$sum(3::bigint*c.risk_diamonds)$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$ELSE 3*c.risk_diamonds END$old$,$new$ELSE 3::bigint*c.risk_diamonds END$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_budget integer;$old$,$new$v_budget bigint;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_budget:=v_price*v_boost;$old$,$new$v_budget:=v_price::bigint*v_boost;$new$),
  ('public.fn_wheel_bonus_start(uuid,uuid,text,boolean,text,integer,integer,integer,integer)',$old$SET status='starting',commit_id=p_commit_id,request=wanted$old$,$new$SET status='starting',play_rules_version=2,commit_id=p_commit_id,request=wanted$new$),
  ('public.fn_wheel_bonus_state(uuid,text,boolean,text,uuid)',$old$total integer;$old$,$new$total bigint;$new$),
  ('public.fn_wheel_bonus_state(uuid,text,boolean,text,uuid)',$old$(v_award->>'bet_diamonds')::integer$old$,$new$(v_award->>'bet_diamonds')::bigint$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_price integer;$old$,$new$v_price bigint;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_spendable integer;$old$,$new$v_spendable bigint;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_remaining integer;$old$,$new$v_remaining bigint;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_half integer;$old$,$new$v_half bigint;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_spendable := v_diamonds::integer;$old$,$new$v_spendable := public.fn_wheel_spendable(v_user,v_diamonds);$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$NOT public.fn_wheel_batch_active(v_run.id,p_commit_id,p_entry_diamonds) AND $old$,$new$$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$IF public.fn_wheel_batch_active(v_run.id,p_commit_id,p_entry_diamonds) THEN v_cap:=LEAST(v_cap,2000*(v_boost+1)/v_boost); END IF;$old$,$new$$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$prior.receipt_v2->>'entry_value_diamonds')::integer$old$,$new$prior.receipt_v2->>'entry_value_diamonds')::bigint$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$'wheel-v4-cards-half:'||v_client||':'||v_nonce)*100)::integer$old$,$new$'wheel-v4-cards-half:'||v_client||':'||v_nonce)*100)::bigint$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$max_funded integer;$old$,$new$max_funded bigint;$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$'{player,diamonds}')::integer$old$,$new$'{player,diamonds}')::bigint$new$),
  ('public.fn_wheel_bonus_state(uuid,text,boolean,text,uuid)',$old$v_paid integer;$old$,$new$v_paid bigint;$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$v_debit integer;$old$,$new$v_debit bigint;$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$v_spendable integer;$old$,$new$v_spendable bigint;$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$LEAST(o_diamonds, v_purchased)::integer ELSE o_diamonds::integer$old$,$new$LEAST(o_diamonds, v_purchased)::bigint ELSE o_diamonds::bigint$new$),
  ('public.fn_diamond_game_state(uuid,text)',$old$v_spendable integer := 0$old$,$new$v_spendable bigint := 0$new$),
  ('public.fn_diamond_game_state(uuid,text)',$old$LEAST(v_diamonds, v_purchased)::integer ELSE v_diamonds::integer$old$,$new$LEAST(v_diamonds, v_purchased)::bigint ELSE v_diamonds::bigint$new$),
  ('public.fn_wheel_state(uuid)',$old$v_spendable integer := 0$old$,$new$v_spendable bigint := 0$new$),
  ('public.fn_wheel_state(uuid)',$old$LEAST(v_diamonds, v_purchased)::integer ELSE v_diamonds::integer$old$,$new$LEAST(v_diamonds, v_purchased)::bigint ELSE v_diamonds::bigint$new$),
  ('public.fn_horse_diamond_spins(uuid,text,jsonb)',$old$(a->>'entry_diamonds')::integer$old$,$new$(a->>'entry_diamonds')::bigint$new$),
  ('public.fn_horse_diamond_spins(uuid,text,jsonb)',$old$(a->>'denom')::integer$old$,$new$(a->>'denom')::bigint$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_purchased integer$old$,$new$v_purchased bigint$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$public.fn_wheel_purchased_available(v_user)$old$,$new$public.fn_wheel_purchased_balance(v_user)$new$),
  ('public.fn_wheel_state(uuid)',$old$v_purchased integer$old$,$new$v_purchased bigint$new$),
  ('public.fn_wheel_state(uuid)',$old$public.fn_wheel_purchased_available(v_user)$old$,$new$public.fn_wheel_purchased_balance(v_user)$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$v_purchased integer$old$,$new$v_purchased bigint$new$),
  ('public.fn_diamond_game_admit(text,uuid,uuid,text,integer)',$old$public.fn_wheel_purchased_available(v_user)$old$,$new$public.fn_wheel_purchased_balance(v_user)$new$),
  ('public.fn_diamond_game_state(uuid,text)',$old$v_purchased integer$old$,$new$v_purchased bigint$new$),
  ('public.fn_diamond_game_state(uuid,text)',$old$public.fn_wheel_purchased_available(v_user)$old$,$new$public.fn_wheel_purchased_balance(v_user)$new$),
  ('public.fn_wheel_v4_model(boolean)',$old$(3,'0.2x Chips','chips',NULL,0.2,1.2,6667)$old$,$new$(3,'0.5x Chips','chips',NULL,0.5,3,6667)$new$),
  ('public.fn_wheel_v4_model(boolean)',$old$(6,'0.25x Chips','chips',NULL,0.25,1.5,6666)$old$,$new$(6,'0.5x Chips','chips',NULL,0.5,3,6666)$new$),
  ('public.fn_wheel_v4_model(boolean)',$old$(9,'0.3x Chips','chips',NULL,0.3,1.8,6667)$old$,$new$(9,'0.5x Chips','chips',NULL,0.5,3,6667)$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$fn_wheel_v4_model(v_vip))<>480000$old$,$new$fn_wheel_v4_model(v_vip))<>510000$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$   v_value_chips:=v_prize_chips;$old$,$new$   v_prize_chips:=GREATEST(v_prize_chips,ceil(v_price::numeric*50/v_rate)/100);
   v_value_chips:=v_prize_chips;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_half:=(public.fn_diamond_round_chip_cents(v_price*.5/100,cm.server_seed,'wheel-v4-cards-half:'||v_client||':'||v_nonce)*100)::bigint;$old$,$new$v_half:=ceil(v_price::numeric/2)::bigint;$new$),
  ('public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',$old$v_result:=jsonb_build_object('ok',true,'contract_version',4,'model','wheel-v4',$old$,$new$v_result:=jsonb_build_object('ok',true,'contract_version',4,'payout_rules_version',2,'minimum_payout_chips',ceil(v_price::numeric*50/v_rate)/100,'minimum_bonus_payout_chips',ceil(v_award.base_diamonds::numeric*150/v_rate)/100,'model','wheel-v4',$new$),
  ('public.fn_wheel_state_v2(uuid,integer)',$old$RETURN s||jsonb_build_object('contract_version',4,'model_version','wheel-v4','vip',vip,'enabled',true,'available',$old$,$new$RETURN s||jsonb_build_object('contract_version',4,'payout_rules_version',2,'minimum_payout_chips',ceil(p_entry_diamonds::numeric*50/rate)/100,'model_version','wheel-v4','vip',vip,'enabled',true,'available',$new$),
  ('public.fn_wheel_bonus_public_award(wheel_bonus_awards,boolean)',$old$'won_order',public.fn_wheel_prize_order(a.spin_id))$old$,$new$'won_order',public.fn_wheel_prize_order(a.spin_id)) || public.fn_wheel_bonus_guarantee(a)$new$),
  ('public.fn_wheel_bonus_state(uuid,text,boolean,text,uuid)',$old$v_paid:=a.entry_diamonds$old$,$new$IF v_award->>'payout_rules_version'='2' THEN v_state:=v_state||jsonb_build_object('payout_rules_version',2,'wheel_minimum_payout_chips',v_award->'wheel_minimum_payout_chips','wheel_diamonds_per_chip',v_award->'wheel_diamonds_per_chip'); END IF;
  v_paid:=a.entry_diamonds$new$),
  ('public.fn_choice_act(uuid,text,integer,integer)',$old$ IF r.status<>'open' THEN
  IF v_pay>r.reserved_chips THEN$old$,$new$ IF r.status<>'open' THEN
  v_pay:=greatest(v_pay,public.fn_wheel_earned_prize_floor(r.commit_id));
  IF v_pay>r.reserved_chips THEN$new$),
  ('public.fn_choice_start(uuid,text,text,integer,uuid,text,integer)',$old$v_reserve:=ceil(v_prizes[p_max_steps]*100)/100;$old$,$new$v_reserve:=greatest(ceil(v_prizes[p_max_steps]*100)/100,public.fn_wheel_earned_prize_floor(p_commit_id));$new$),
  ('public.fn_crash_decide(crash_rounds,boolean,text,integer)',$old$  IF v_payout > 0 THEN$old$,$new$  v_payout:=greatest(v_payout,public.fn_wheel_earned_prize_floor(r.commit_id));
  IF v_payout > 0 THEN$new$),
  ('public.fn_crash_decide(crash_rounds,boolean,text,integer)',$old$IF pool.chips_paid + pool.reserved_chips >$old$,$new$IF public.fn_wheel_earned_prize_floor(r.commit_id) IS NULL AND pool.chips_paid + pool.reserved_chips >$new$),
  ('public.fn_plinko_bonus_run(uuid,uuid,text,integer,integer,integer)',$old$ paid:=GREATEST(paid,v_minimum);$old$,$new$ paid:=greatest(paid,v_minimum,public.fn_wheel_earned_prize_floor(p_commit));$new$)
 ) AS changes(signature, prior, replacement)
 LOOP
  definition:=COALESCE(bodies->>patch.signature,pg_get_functiondef(patch.signature::regprocedure));
  IF cardinality(string_to_array(definition,patch.prior)) IS DISTINCT FROM (CASE WHEN patch.prior IN ('v_budget:=v_price*v_boost;', 'prior.receipt_v2->>''entry_value_diamonds'')::integer','(a->>''entry_diamonds'')::integer') THEN 3 ELSE 2 END) THEN
   RAISE EXCEPTION 'Diamond Spins source mismatch for %', patch.signature;
  END IF;
  bodies:=jsonb_set(bodies,ARRAY[patch.signature],to_jsonb(replace(definition,patch.prior,patch.replacement)));
 END LOOP;
 FOR definition IN SELECT value FROM jsonb_each_text(bodies) LOOP EXECUTE definition; END LOOP;
END $migration$;
CREATE OR REPLACE FUNCTION public.fn_wheel_batch_begin(p_request_id uuid, p_client_seed text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.wheel_batch_requests;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Sign In To Spin'); END IF;
 IF p_client_seed IS NULL OR length(p_client_seed) NOT BETWEEN 1 AND 60 THEN RETURN jsonb_build_object('ok',false,'error','Choose A Valid Batch Seed'); END IF;
 SELECT * INTO r FROM public.wheel_batch_requests WHERE id=p_request_id AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','That Batch Could Not Be Found'); END IF;
 IF r.status='complete' THEN
  IF r.client_seed IS DISTINCT FROM p_client_seed THEN RETURN jsonb_build_object('ok',false,'error','This Batch Used A Different Seed'); END IF;
  RETURN r.receipt||jsonb_build_object('replayed',true);
 END IF;
 RETURN jsonb_build_object('ok',false,'error','Choose One Spin At A Time','charged_diamonds',0);
END $function$;
CREATE OR REPLACE FUNCTION public.fn_wheel_batch_prepare(p_request_id uuid, p_club_id uuid, p_spins integer, p_entry_diamonds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.wheel_batch_requests;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Sign In To Spin'); END IF;
 IF p_request_id IS NULL OR p_spins IS NULL OR p_spins NOT IN(5,10,25) OR p_entry_diamonds IS NULL OR p_entry_diamonds < 1 THEN RETURN jsonb_build_object('ok',false,'error','Choose Valid Batch Settings'); END IF;
 SELECT * INTO r FROM public.wheel_batch_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF r.user_id IS DISTINCT FROM auth.uid() OR r.club_id IS DISTINCT FROM p_club_id OR r.spins IS DISTINCT FROM p_spins OR r.entry_diamonds IS DISTINCT FROM p_entry_diamonds THEN RETURN jsonb_build_object('ok',false,'error','This Batch Belongs To Different Settings'); END IF;
  RETURN jsonb_build_object('ok',true,'request_id',r.id,'spins',r.spins,'entry_diamonds',r.entry_diamonds,'status',r.status,'tickets',r.tickets,'receipt',r.receipt);
 END IF;
 RETURN jsonb_build_object('ok',false,'error','Choose One Spin At A Time','charged_diamonds',0);
END $function$;
CREATE OR REPLACE FUNCTION public.fn_wheel_run_begin(p_club_id uuid, p_spins integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user uuid:=auth.uid(); v_host uuid; v_run public.wheel_runs;
BEGIN
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Sign In To Spin'); END IF;
 IF p_spins IS NULL OR p_spins NOT IN(5,10,25) THEN
  RETURN jsonb_build_object('ok',false,'error','Choose 5, 10 Or 25 Spins'); END IF;
 SELECT h.host_id INTO v_host FROM public.fn_wheel_host(p_club_id) h;
 IF v_host IS NULL THEN RETURN jsonb_build_object('ok',false,'error','That Club Could Not Be Found'); END IF;
 IF NOT public.fn_wheel_v2_enabled() THEN
  RETURN jsonb_build_object('ok',false,'error','The New Wheel Is Not Open Yet'); END IF;
 SELECT * INTO v_run FROM public.wheel_runs WHERE user_id=v_user AND status='open' FOR UPDATE;
 IF v_run.id IS NOT NULL THEN
  IF v_run.club_id IS DISTINCT FROM p_club_id OR v_run.spins IS DISTINCT FROM p_spins THEN
   RETURN jsonb_build_object('ok',false,'error','Finish The Run You Already Started'); END IF;
  RETURN jsonb_build_object('ok',true,'run_id',v_run.id,'spins',v_run.spins,'spins_done',v_run.spins_done);
 END IF;
 RETURN jsonb_build_object('ok',false,'error','Choose One Spin At A Time','charged_diamonds',0);
END $function$;

-- A Super game's entitlement
-- can be twice that stake. Give only earned game amounts and projections
-- this wider range; regular game admission still enforces its original rules.
DO $storage$
DECLARE book text; book_owner name; acl_entry record; grants_sql text:=''; options text;
BEGIN
 SELECT pg_get_viewdef(c.oid),pg_get_userbyid(c.relowner),array_to_string(c.reloptions,',')
 INTO STRICT book,book_owner,options FROM pg_class c WHERE c.oid='public.diamond_game_round_book'::regclass;
 FOR acl_entry IN SELECT acl.grantee,acl.privilege_type,acl.is_grantable FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE c.oid='public.diamond_game_round_book'::regclass AND acl.grantee<>c.relowner
 LOOP
  grants_sql:=grants_sql||format('GRANT %s ON public.diamond_game_round_book TO %s%s;',acl_entry.privilege_type,
   CASE WHEN acl_entry.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(acl_entry.grantee)) END,
   CASE WHEN acl_entry.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
 END LOOP;
 DROP VIEW public.diamond_game_round_book;
 ALTER TABLE public.diamond_bonus_entries DROP COLUMN total_diamonds;
 ALTER TABLE public.diamond_bonus_entries ALTER COLUMN base_diamonds TYPE bigint;
 ALTER TABLE public.diamond_bonus_entries ADD COLUMN total_diamonds bigint GENERATED ALWAYS AS (base_diamonds+added_diamonds) STORED;
 ALTER TABLE public.diamond_choice_rounds ALTER COLUMN bet_diamonds TYPE bigint;
 ALTER TABLE public.crash_rounds ALTER COLUMN bet_diamonds TYPE bigint;
 ALTER TABLE public.wheel_spins ALTER COLUMN spin_price_diamonds TYPE bigint;
 ALTER TABLE public.wheel_bonus_awards DROP CONSTRAINT wheel_bonus_awards_check1,
  ALTER COLUMN entry_diamonds TYPE bigint,
  ALTER COLUMN base_diamonds TYPE bigint, ADD CHECK(base_diamonds=entry_diamonds::bigint*boost_multiplier);
 EXECUTE format('CREATE VIEW public.diamond_game_round_book %s AS %s',CASE WHEN options IS NULL THEN '' ELSE 'WITH ('||options||')' END,book);
 EXECUTE format('ALTER VIEW public.diamond_game_round_book OWNER TO %I',book_owner);
 REVOKE ALL ON public.diamond_game_round_book FROM PUBLIC,anon,authenticated,service_role;
 IF grants_sql<>'' THEN EXECUTE grants_sql; END IF;
END $storage$;

DO $wide$
DECLARE work record; original text; replacement text; sig regprocedure; arg text; principals text; existing_owner name;
BEGIN
 FOR work IN SELECT * FROM (VALUES
  ('fn_diamond_game_paid_diamonds(integer)',ARRAY['p_stake']),
  ('fn_wheel_bonus_player_debit(integer)',ARRAY['p_total']),
  ('fn_diamond_game_debit_text(text,integer,boolean)',ARRAY['p_stake']),
  ('fn_diamond_game_debit_meta(integer)',ARRAY['p_stake']),
  ('fn_diamond_game_take_bet(uuid,integer,boolean,text,text,text,jsonb,uuid,text)',ARRAY['p_bet']),
  ('fn_diamond_game_admit(text,uuid,uuid,text,integer)',ARRAY['p_bet']),
  ('fn_crash_start(uuid,uuid,text,integer,integer)',ARRAY['p_bet_diamonds']),
  ('fn_choice_start(uuid,text,text,integer,uuid,text,integer)',ARRAY['p_bet']),
  ('fn_diamond_bonus_floor(numeric,integer,integer,integer)',ARRAY['p_paid_diamonds']),
  ('fn_wheel_v4_segments(integer,integer,boolean,boolean)',ARRAY['p_entry']),
  ('fn_wheel_state_v2(uuid,integer)',ARRAY['p_entry_diamonds']),
  ('fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid)',ARRAY['p_entry_diamonds']),
  ('fn_plinko_bonus_run(uuid,uuid,text,integer,integer,integer)',ARRAY['p_total','p_denom']),
  ('fn_wheel_bonus_start(uuid,uuid,text,boolean,text,integer,integer,integer,integer)',ARRAY['p_denom'])
 ) f(signature,args)
 LOOP
  sig:=('public.'||work.signature)::regprocedure;
  SELECT pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),
   (SELECT string_agg(quote_ident(pg_get_userbyid(a.grantee)),',') FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner)
   INTO STRICT original,existing_owner,principals FROM pg_proc p WHERE p.oid=sig;
  IF existing_owner<>'postgres' OR has_function_privilege('anon',sig,'execute') THEN
   RAISE EXCEPTION 'Unexpected Diamond Spins function authority: %',sig; END IF;
  replacement:=original;
  FOREACH arg IN ARRAY work.args LOOP
   IF array_length(string_to_array(replacement,arg||' integer'),1) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Unexpected type at %.%',sig,arg; END IF;
   replacement:=replace(replacement,arg||' integer',arg||' bigint');
  END LOOP;
  IF work.signature LIKE 'fn_diamond_game_paid_diamonds(%' OR work.signature LIKE 'fn_wheel_bonus_player_debit(%' THEN
   replacement:=replace(replacement,' RETURNS integer',' RETURNS bigint');
  ELSIF work.signature LIKE 'fn_wheel_bonus_start(%' THEN
   replacement:=replace(replacement,'total integer;','total bigint;');
   replacement:=replace(replacement,'(v_result->>''bet_diamonds'')::integer','(v_result->>''bet_diamonds'')::bigint');
  END IF;
  EXECUTE format('DROP FUNCTION %s',sig);
  EXECUTE replacement;
  SELECT p.oid::regprocedure INTO STRICT sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND p.proname=split_part(work.signature,'(',1);
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',sig,existing_owner);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',sig);
  IF principals IS NOT NULL THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s',sig,principals); END IF;
 END LOOP;
END $wide$;

SET LOCAL lock_timeout = '1s';

-- Integer wallets can overflow from a legal spin: 715,827,883 diamonds can
-- win 2,147,483,649. Keep the same canonical wallet, mirrors and journal.
DO $reconciliation$
DECLARE view_rec record; staged_views jsonb:='[]';
BEGIN
 -- Temporarily detach only the SELECT rule of each reconciliation view.
 -- Its OID, downstream views, ACL, ownership, comments and options survive.
 -- Neither its placeholder nor the column swap is visible outside this transaction.
 FOR view_rec IN SELECT c.oid,c.relname::text AS name,pg_get_viewdef(c.oid) AS body,
  CASE WHEN c.reloptions IS NULL THEN '' ELSE ' WITH ('||array_to_string(c.reloptions,',')||')' END AS opts,
  (SELECT string_agg(format('NULL::%s AS %I',format_type(a.atttypid,a.atttypmod),a.attname),',' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS placeholder,
  (SELECT string_agg(format('s.%I::%s AS %I',a.attname,format_type(a.atttypid,a.atttypmod),a.attname),',' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS projection
  FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v' AND
   c.relname IN ('trivia_ledger_recon_date','trivia_ledger_recon_reference','trivia_ledger_recon_user')
 LOOP
  staged_views:=staged_views||to_jsonb(view_rec);
  EXECUTE format('CREATE OR REPLACE VIEW public.%I%s AS SELECT %s WHERE false',view_rec.name,view_rec.opts,view_rec.placeholder);
 END LOOP;
 PERFORM set_config('app.wheel_reconciliation_views',staged_views::text,true);
END $reconciliation$;
-- Give the archive rewrite its own bounded statement inside the same transaction.
ALTER TABLE public.ca_diamond_journal_archive ALTER COLUMN amount TYPE bigint, ALTER COLUMN balance_after TYPE bigint;
DO $width$
DECLARE t record; rel record; restored record; ddl text; saved jsonb:='[]'::jsonb;
 view_rec record; staged_views jsonb:=current_setting('app.wheel_reconciliation_views')::jsonb; original_index_comment text;
 directory_oid oid:=to_regclass('public.all_users'); directory_sql text; directory_options text;
 directory_owner name; directory_comment text; directory_columns text; grants text:=''; comments text:=''; grant_row record;
BEGIN
 -- World Hub's unified directory selects profiles.diamonds. Preserve its
 -- existing projection and permissions only when it actually depends on this column.
 IF EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=r.oid
  JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
  WHERE r.ev_class=directory_oid AND d.refclassid='pg_class'::regclass AND a.attrelid='public.profiles'::regclass AND a.attname='diamonds') THEN
  SELECT pg_get_viewdef(c.oid),array_to_string(c.reloptions,','),pg_get_userbyid(c.relowner),obj_description(c.oid,'pg_class')
   INTO STRICT directory_sql,directory_options,directory_owner,directory_comment FROM pg_class c WHERE c.oid=directory_oid AND c.relkind='v';
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum),
   coalesce(string_agg(format('COMMENT ON COLUMN public.all_users.%I IS %L;',a.attname,col_description(a.attrelid,a.attnum)),'')
    FILTER(WHERE col_description(a.attrelid,a.attnum) IS NOT NULL),'')
   INTO directory_columns,comments FROM pg_attribute a WHERE a.attrelid=directory_oid AND a.attnum>0 AND NOT a.attisdropped;
  IF EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=directory_oid AND rulename<>'_RETURN') OR
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=directory_oid AND NOT tgisinternal) OR
    EXISTS(SELECT 1 FROM pg_attrdef WHERE adrelid=directory_oid) OR
    EXISTS(SELECT 1 FROM pg_seclabel WHERE classoid='pg_class'::regclass AND objoid=directory_oid)
   THEN RAISE EXCEPTION 'Unexpected writable or security-labelled all_users view'; END IF;
  FOR grant_row IN
   SELECT ac.*,NULL::text AS col,c.relowner FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) ac WHERE c.oid=directory_oid
   UNION ALL SELECT ac.*,a.attname::text,c.relowner FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    CROSS JOIN LATERAL aclexplode(a.attacl) ac WHERE c.oid=directory_oid
  LOOP
   IF grant_row.grantor<>grant_row.relowner THEN RAISE EXCEPTION 'Unexpected all_users privilege grantor'; END IF;
   IF grant_row.grantee<>grant_row.relowner THEN
    grants:=grants||format('GRANT %s%s ON public.all_users TO %s%s;',grant_row.privilege_type,
     CASE WHEN grant_row.col IS NULL THEN '' ELSE format(' (%I)',grant_row.col) END,
     CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END,
     CASE WHEN grant_row.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
   END IF;
  END LOOP;
  DROP VIEW public.all_users; -- RESTRICT deliberately protects unknown dependents.
 END IF;
 -- Postgres will not widen columns referenced by an UPDATE OF or WHEN
 -- trigger. Preserve their definitions, enable mode and comment atomically.
 FOR t IN
  SELECT DISTINCT g.oid,g.tgrelid::regclass AS tbl,g.tgname,pg_get_triggerdef(g.oid) AS definition,
   g.tgenabled,obj_description(g.oid,'pg_trigger') AS comment
  FROM pg_trigger g JOIN pg_depend d ON d.classid='pg_trigger'::regclass AND d.objid=g.oid
  JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
  WHERE NOT g.tgisinternal AND d.refclassid='pg_class'::regclass AND
   ((a.attrelid='public.profiles'::regclass AND a.attname IN('diamonds','diamond_balance'))
    OR (a.attrelid='public.diamond_transactions'::regclass AND a.attname IN('amount','balance_after'))
    OR (a.attrelid IN('public.user_diamonds'::regclass,'public.user_diamond_balance'::regclass,
        'public.diamond_wallets'::regclass) AND a.attname IN('balance','lifetime_earned','lifetime_spent')))
 LOOP
  saved:=saved||to_jsonb(t);
  EXECUTE format('DROP TRIGGER %I ON %s',t.tgname,t.tbl);
 END LOOP;
 -- Most of the financial journal's indexes are untouched: the row id, their
 -- indexed columns and all foreign keys retain identity. The one partial index
 -- on amount was built concurrently from the staged column ahead of this window.
 IF NOT EXISTS(SELECT 1 FROM pg_index s JOIN pg_index o ON o.indrelid=s.indrelid
  WHERE s.indexrelid='public.wheel_stage_trivia_family_created_idx'::regclass AND s.indisvalid AND s.indisready
   AND o.indexrelid='public.diamond_transactions_trivia_family_created_idx'::regclass AND o.indisvalid AND s.indkey=o.indkey
   AND replace(pg_get_expr(s.indpred,s.indrelid),'wheel_amount64','amount')=pg_get_expr(o.indpred,o.indrelid)) THEN
  RAISE EXCEPTION 'Staged trivia index is not qualified'; END IF;
 original_index_comment:=obj_description('public.diamond_transactions_trivia_family_created_idx'::regclass,'pg_class');
 DROP INDEX public.diamond_transactions_trivia_family_created_idx;
 ALTER TABLE public.diamond_transactions DROP CONSTRAINT wheel_stage_journal_matches;
 ALTER TABLE public.ca_diamond_balance_audit DROP CONSTRAINT wheel_stage_audit_matches;
 DROP TRIGGER zzzz_wheel_copy_wide_journal ON public.diamond_transactions;
 DROP TRIGGER zzzz_wheel_copy_wide_audit ON public.ca_diamond_balance_audit;
 -- DROP COLUMN can silently take table-local indexes and constraints. Refuse
 -- any newly introduced dependency rather than removing its protection.
 IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
   WHERE d.refclassid='pg_class'::regclass AND
   ((a.attrelid='public.diamond_transactions'::regclass AND a.attname IN('amount','balance_after')) OR
    (a.attrelid='public.ca_diamond_balance_audit'::regclass AND a.attname IN('old_diamonds','new_diamonds','delta'))))
  THEN RAISE EXCEPTION 'Unrecognized dependency on an original diamond journal column'; END IF;
 ALTER TABLE public.diamond_transactions DROP COLUMN amount,DROP COLUMN balance_after;
 ALTER TABLE public.diamond_transactions RENAME COLUMN wheel_amount64 TO amount;
 ALTER TABLE public.diamond_transactions RENAME COLUMN wheel_balance_after64 TO balance_after;
 ALTER TABLE public.diamond_transactions ALTER COLUMN amount DROP DEFAULT;
 ALTER INDEX public.wheel_stage_trivia_family_created_idx RENAME TO diamond_transactions_trivia_family_created_idx;
 IF original_index_comment IS NOT NULL THEN
  EXECUTE format('COMMENT ON INDEX public.diamond_transactions_trivia_family_created_idx IS %L',original_index_comment); END IF;
 ALTER TABLE public.ca_diamond_balance_audit DROP COLUMN old_diamonds,DROP COLUMN new_diamonds,DROP COLUMN delta;
 ALTER TABLE public.ca_diamond_balance_audit RENAME COLUMN wheel_old64 TO old_diamonds;
 ALTER TABLE public.ca_diamond_balance_audit RENAME COLUMN wheel_new64 TO new_diamonds;
 ALTER TABLE public.ca_diamond_balance_audit RENAME COLUMN wheel_delta64 TO delta;
 FOR rel IN SELECT * FROM (VALUES
  ('public.profiles'::regclass,ARRAY['diamonds','diamond_balance']),
  ('public.user_diamonds'::regclass,ARRAY['balance','lifetime_earned','lifetime_spent']),
  ('public.user_diamond_balance'::regclass,ARRAY['balance','lifetime_earned','lifetime_spent']),
  ('public.diamond_wallets'::regclass,ARRAY['balance','lifetime_earned','lifetime_spent']),
  ('public.diamond_spin_movements'::regclass,ARRAY['amount']),
  ('public.wheel_card_awards'::regclass,ARRAY['risk_diamonds','half_diamonds','paid_diamonds'])
 ) AS cols(tbl,names)
 LOOP
  SELECT string_agg(format('ALTER COLUMN %I TYPE bigint',attname),', ') INTO ddl
  FROM pg_attribute WHERE attrelid=rel.tbl AND attname=ANY(rel.names) AND atttypid='integer'::regtype;
  IF ddl IS NOT NULL THEN EXECUTE format('ALTER TABLE %s %s',rel.tbl,ddl); END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=rel.tbl AND attname=ANY(rel.names)
      AND atttypid='bigint'::regtype)<>cardinality(rel.names) THEN
   RAISE EXCEPTION 'Unexpected Diamond wallet schema in %',rel.tbl;
  END IF;
 END LOOP;
 FOR restored IN SELECT * FROM jsonb_to_recordset(saved)
   AS x(tbl text,tgname text,definition text,tgenabled text,comment text)
 LOOP
  EXECUTE restored.definition;
  IF restored.tgenabled<>'O' THEN
   EXECUTE format('ALTER TABLE %s %s TRIGGER %I',restored.tbl,
    CASE restored.tgenabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA'
     WHEN 'A' THEN 'ENABLE ALWAYS' END,restored.tgname);
  END IF;
  IF restored.comment IS NOT NULL THEN EXECUTE format('COMMENT ON TRIGGER %I ON %s IS %L',
   restored.tgname,restored.tbl,restored.comment); END IF;
 END LOOP;
 FOR view_rec IN SELECT * FROM jsonb_to_recordset(staged_views) AS v(name text,body text,opts text,projection text) LOOP
  -- SUM(int8) is numeric. Keep the two public platform_net aggregate columns
  -- at their original bigint ABI, together with every other declared field.
  IF view_rec.name IN ('trivia_ledger_recon_date','trivia_ledger_recon_user') THEN
   EXECUTE format('CREATE OR REPLACE VIEW public.%I%s AS SELECT %s FROM (%s) s', view_rec.name,view_rec.opts,
    view_rec.projection,rtrim(view_rec.body,E'; \n\t'));
  ELSE EXECUTE format('CREATE OR REPLACE VIEW public.%I%s AS %s',view_rec.name,view_rec.opts,view_rec.body);
  END IF;
 END LOOP;
 IF directory_sql IS NOT NULL THEN
  EXECUTE format('CREATE VIEW public.all_users (%s) %s AS %s',directory_columns,
   CASE WHEN directory_options IS NULL THEN '' ELSE 'WITH ('||directory_options||')' END,directory_sql);
  EXECUTE format('ALTER VIEW public.all_users OWNER TO %I',directory_owner);
  -- Supabase default ACLs can differ from the original view's effective grants.
  FOR grant_row IN SELECT DISTINCT ac.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) ac
   WHERE c.oid='public.all_users'::regclass AND ac.grantee<>c.relowner LOOP
   EXECUTE format('REVOKE ALL ON public.all_users FROM %s',CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END);
  END LOOP;
  IF grants<>'' THEN EXECUTE grants; END IF;
  IF directory_comment IS NOT NULL THEN EXECUTE format('COMMENT ON VIEW public.all_users IS %L',directory_comment); END IF;
  IF comments<>'' THEN EXECUTE comments; END IF;
 END IF;
END $width$;
DROP FUNCTION public.fn_wheel_copy_wide_journal_batch(integer);
DROP FUNCTION public.fn_wheel_verify_wide_journal_copy();
DROP FUNCTION public.fn_wheel_copy_wide_journal_row();
DO $archive$
DECLARE original text:=pg_get_functiondef('public.fn_ca_journal_append_only()'::regprocedure);
BEGIN
 IF position($narrow$(v_j->>'amount')::integer, (v_j->>'balance_after')::integer$narrow$ IN original)=0 THEN
  RAISE EXCEPTION 'Diamond archive writer changed'; END IF;
 EXECUTE replace(original,$narrow$(v_j->>'amount')::integer, (v_j->>'balance_after')::integer$narrow$,
  $wide$(v_j->>'amount')::bigint, (v_j->>'balance_after')::bigint$wide$);
END $archive$;
ALTER TABLE public.diamond_spin_days DROP CONSTRAINT diamond_spin_days_pending_diamonds_check;

-- One wide implementation behind each existing integer entry point. Keep the
-- original RPC OID, grants, argument names and defaults. The bigint overload
-- is private and takes a differently named amount so PostgREST retains an
-- unambiguous signature for existing callers.
DO $writers$
DECLARE writer record; source text; implementation text; wrapper text; old_body text;
BEGIN
 FOR writer IN SELECT * FROM (VALUES
  ('public.deduct_diamonds(uuid,integer,text,text,text,jsonb,text,integer)'::regprocedure,
   'public.deduct_diamonds(uuid,bigint,text,text,text,jsonb,text,integer)',
   'public.deduct_diamonds(p_user_id,p_amount::bigint,p_description,p_transaction_type,p_source,p_metadata,p_reference_id,p_cooldown_seconds)'),
  ('public.add_diamonds_to_balance(uuid,integer,text,text,text,uuid)'::regprocedure,
   'public.add_diamonds_to_balance(uuid,bigint,text,text,text,uuid)',
   'public.add_diamonds_to_balance(p_user_id,p_amount::bigint,p_type,p_description,p_reference_id,p_counterparty_id)'),
  ('public.fn_diamond_spin_book(uuid,uuid,uuid,text,uuid,text,integer,text,text,date)'::regprocedure,
   'public.fn_diamond_spin_book(uuid,uuid,uuid,text,uuid,text,bigint,text,text,date)',
   'public.fn_diamond_spin_book(p_owner,p_club,p_host,p_kind,p_player,p_movement,p_amount::bigint,p_operation,p_description,p_day)')
 ) AS writers(narrow,wide,delegate)
 LOOP
  SELECT pg_get_functiondef(oid),prosrc INTO STRICT source,old_body FROM pg_proc WHERE oid=writer.narrow;
  IF to_regprocedure(writer.wide) IS NOT NULL OR position('p_amount integer' in source)=0 THEN
   RAISE EXCEPTION 'Unexpected wallet writer signature: %',writer.narrow; END IF;
  implementation:=replace(replace(source,'p_amount integer','p_amount bigint'),'p_amount','p_wide_amount');
  implementation:=replace(implementation,'v_current integer;','v_current bigint;');
  implementation:=replace(implementation,'v_new_balance integer;','v_new_balance bigint;');
  implementation:=replace(implementation,'(-v_existing_amount)::integer','(-v_existing_amount)::bigint');
  implementation:=replace(implementation,'v_raw_amount integer','v_raw_amount bigint');
  implementation:=regexp_replace(implementation,
   '  IF v_actual_amount < -2147483648 OR v_actual_amount > 2147483647 THEN[^;]*;[[:space:]]*END IF;', '');
  implementation:=regexp_replace(implementation,
   '  IF v_new_balance > 2147483647 THEN[^;]*;[[:space:]]*END IF;', '');
  implementation:=replace(implementation,'bucket.pending_diamonds+p_wide_amount,0)>2147483647',
   'bucket.pending_diamonds+p_wide_amount,0)>9223372036854775807');
  IF writer.narrow='public.add_diamonds_to_balance(uuid,integer,text,text,text,uuid)'::regprocedure THEN
   IF strpos(implementation,'v_exact_type := p_type IN (')=0 OR strpos(implementation,'IF v_type_key = ''arena_withdraw'' THEN')=0 THEN RAISE EXCEPTION 'Unrecognized exact-amount wallet classification'; END IF;
   implementation:=replace(implementation,'v_exact_type := p_type IN (',$guard$IF p_type='wheel_prize_underwriting' AND NOT EXISTS (
     SELECT 1 FROM public.wheel_prize_financing f JOIN public.wheel_card_awards a ON a.id=f.award_id
     WHERE f.player_id=p_user_id AND f.issued=p_wide_amount AND f.issued>0
      AND p_reference_id='wheel-cards:'||a.id||':issued' AND a.status='picked' AND a.paid_diamonds=f.prize
   ) THEN RAISE EXCEPTION 'Unmatched wheel prize underwriting'; END IF;
   v_exact_type := p_type IN ('wheel_prize_underwriting','wheel_prize_house',$guard$);
   implementation:=replace(implementation,'IF v_type_key = ''arena_withdraw'' THEN',$class$IF v_type_key='wheel_prize_house' THEN
    v_issuance_class := 'transferred'; v_counterparty := 'house:diamond_house';
   ELSIF v_type_key = 'arena_withdraw' THEN$class$);
  END IF;
  EXECUTE implementation;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',writer.wide);
  wrapper:=replace(source,old_body,'BEGIN RETURN '||writer.delegate||'; END;');
  EXECUTE wrapper;
 END LOOP;
END $writers$;

DO $mirrors$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('public.fn_diamond_side_tables_follow_profiles()'::regprocedure);
 EXECUTE replace(body,'::int,','::bigint,');
 body:=pg_get_functiondef('public.fn_ca_audit_diamond_change()'::regprocedure);
 IF position('v_old integer; v_new integer' IN body)=0 THEN RAISE EXCEPTION 'Wallet audit definition changed'; END IF;
 EXECUTE replace(replace(body,'v_old integer; v_new integer','v_old bigint; v_new bigint'),'v_delta integer','v_delta bigint');
 body:=pg_get_functiondef('public.fn_diamond_spin_wallet_reserve()'::regprocedure);
 EXECUTE replace(body,'+incoming>2147483647','+incoming>9223372036854775807');
 body:=pg_get_functiondef('public.fn_diamond_spin_settle_day(uuid,date)'::regprocedure);
 EXECUTE replace(replace(replace(body,'v_net integer','v_net bigint'),'v_credit integer','v_credit bigint'),'pending_diamonds::integer','pending_diamonds::bigint');
END $mirrors$;

CREATE FUNCTION public.fn_wheel_card_values_wide(p_half bigint,p_risk bigint,p_permutation smallint)
RETURNS bigint[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE p_permutation
  WHEN 0 THEN ARRAY[p_half,2*p_risk,3*p_risk] WHEN 1 THEN ARRAY[p_half,3*p_risk,2*p_risk]
  WHEN 2 THEN ARRAY[2*p_risk,p_half,3*p_risk] WHEN 3 THEN ARRAY[2*p_risk,3*p_risk,p_half]
  WHEN 4 THEN ARRAY[3*p_risk,p_half,2*p_risk] WHEN 5 THEN ARRAY[3*p_risk,2*p_risk,p_half] END
$$;
REVOKE ALL ON FUNCTION public.fn_wheel_card_values_wide(bigint,bigint,smallint) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.wheel_owner_credit (
 owner_id uuid PRIMARY KEY REFERENCES public.profiles(id),
 outstanding bigint NOT NULL DEFAULT 0 CHECK (outstanding BETWEEN 0 AND 10000)
);
CREATE TABLE public.wheel_prize_financing (
 award_id uuid PRIMARY KEY REFERENCES public.wheel_card_awards(id),
 owner_id uuid NOT NULL REFERENCES public.profiles(id),
 player_id uuid NOT NULL REFERENCES public.profiles(id),
 host_id uuid NOT NULL, club_id uuid NOT NULL,
 day date NOT NULL,
 prize bigint NOT NULL CHECK (prize > 0),
 owner_cash bigint NOT NULL CHECK (owner_cash >= 0),
 owner_advance bigint NOT NULL CHECK (owner_advance BETWEEN 0 AND 10000),
 platform_expense bigint NOT NULL CHECK (platform_expense >= 0),
 house_cash bigint NOT NULL CHECK (house_cash >= 0),
 issued bigint NOT NULL CHECK (issued >= 0),
 CHECK (house_cash+issued=owner_advance+platform_expense),
 outstanding_after bigint NOT NULL CHECK (outstanding_after BETWEEN 0 AND 10000),
 CHECK (owner_cash + owner_advance + platform_expense = prize),
 CHECK (outstanding_after >= owner_advance)
);
CREATE INDEX wheel_prize_financing_owner_day ON public.wheel_prize_financing(owner_id,day);
CREATE TABLE public.wheel_owner_credit_repayments (
 owner_id uuid NOT NULL REFERENCES public.profiles(id),
 day date NOT NULL,
 amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 10000),
 outstanding_after bigint NOT NULL CHECK (outstanding_after BETWEEN 0 AND 9999),
 PRIMARY KEY(owner_id,day)
);
ALTER TABLE public.wheel_owner_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_prize_financing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheel_owner_credit_repayments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wheel_owner_credit, public.wheel_prize_financing,
 public.wheel_owner_credit_repayments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wheel_owner_credit, public.wheel_prize_financing,
 public.wheel_owner_credit_repayments TO service_role;

-- Historical owner liability belongs to the sealed award and to the close's
-- recorded owner. A club sale can change the current owner between those
-- events. New wagers still require the current host and owner.
DO $historical$
DECLARE body text; denial text:='  RAISE EXCEPTION ''Diamond Spin Custody Does Not Match The Current Host Owner''; END IF;';
BEGIN
 body:=pg_get_functiondef('public.fn_diamond_spin_book(uuid,uuid,uuid,text,uuid,text,bigint,text,text,date)'::regprocedure);
 IF strpos(body,denial)=0 THEN RAISE EXCEPTION 'Current spin owner guard changed'; END IF;
 EXECUTE replace(body,denial,$rule$
  IF p_movement<>'diamond_prize' OR p_day IS NULL OR NOT (
   EXISTS(SELECT 1 FROM public.wheel_prize_financing f JOIN public.wheel_card_awards a ON a.id=f.award_id
    WHERE f.owner_id=p_owner AND f.day=p_day AND f.player_id=p_player AND f.club_id=p_club AND f.host_id=p_host
      AND a.host_kind=p_kind AND a.status='picked' AND f.owner_cash=-p_wide_amount
      AND p_operation='wheel-cards:'||f.award_id||':custody' AND p_description='Diamond Spins: Diamonds Cards')
   OR (p_operation='wheel-credit-repayment:'||p_owner||':'||p_day AND p_description='Diamond Spins Owner Advance Repayment'
     AND EXISTS(SELECT 1 FROM public.wheel_owner_credit_repayments c WHERE c.owner_id=p_owner AND c.day=p_day AND c.amount=-p_wide_amount)
     AND EXISTS(SELECT 1 FROM public.diamond_spin_movements m WHERE m.owner_id=p_owner AND m.day=p_day
       AND m.player_id=p_player AND m.club_id=p_club AND m.host_id=p_host AND m.host_kind=p_kind))
  ) THEN RAISE EXCEPTION 'Diamond Spin Custody Does Not Match The Current Host Owner'; END IF;
 END IF;$rule$);
END $historical$;

-- The normal player transfer check proves a profile exists. For a transfer
-- from the house prove the debit itself, including account, player and award.
DO $house_guard$
DECLARE body text; anchor text := '  IF v_cp ~*';
BEGIN
 body:=pg_get_functiondef('public.fn_ca_diamond_transfer_names_its_counterparty()'::regprocedure);
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Diamond counterparty guard changed'; END IF;
 EXECUTE replace(body,anchor,$rule$  IF NEW.transaction_type='wheel_prize_house' AND v_cp='house:diamond_house' AND EXISTS (
    SELECT 1 FROM public.wheel_prize_financing f JOIN public.ca_diamond_house_ledger h
      ON h.reference='wheel-cards:'||f.award_id||':house'
    WHERE h.reference=NEW.reference_id AND f.player_id=NEW.user_id AND h.user_id=f.player_id
      AND f.house_cash=NEW.amount AND h.delta=-NEW.amount AND h.reason='wheel_prize_underwriting'
  ) THEN RETURN NEW; END IF;
$rule$||anchor);
END $house_guard$;

-- The platform-issued part remains a measured wheel expense. Promotional
-- earning caps apply to earned activity; they cannot cancel a sealed prize.
DO $earn$
DECLARE body text; anchor text:='IF v_cap IS NOT NULL AND v_awarded > v_cap THEN';
BEGIN
 body:=pg_get_functiondef('public.fn_ca_diamond_engine_of(text,text,text,text,text)'::regprocedure);
 IF strpos(body, $needle$IN ('wheel_prize', 'wheel_spin')$needle$)=0 THEN RAISE EXCEPTION 'Diamond wheel expense classifier changed'; END IF;
 EXECUTE replace(body,$needle$IN ('wheel_prize', 'wheel_spin')$needle$,$replacement$IN ('wheel_prize', 'wheel_spin','wheel_prize_underwriting')$replacement$);
 body:=pg_get_functiondef('public.fn_ca_diamond_earn_ledger()'::regprocedure);
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Diamond earnings limit changed'; END IF;
 EXECUTE replace(body,anchor,$replacement$IF v_cap IS NOT NULL AND v_awarded>v_cap AND NOT (
    NEW.transaction_type IS NOT DISTINCT FROM 'wheel_prize_underwriting' AND EXISTS(
     SELECT 1 FROM public.wheel_prize_financing f WHERE f.player_id=NEW.user_id AND f.issued=NEW.amount
      AND NEW.reference_id='wheel-cards:'||f.award_id||':issued')
   ) THEN$replacement$);
END $earn$;

-- Move existing house diamonds; the unique reference and the cash ledger
-- witness the transfer. The operator's outstanding tournament earmarks are
-- already spoken for and are excluded by the platform's own availability read.
CREATE FUNCTION public.fn_wheel_house_diamond_leg(p_delta bigint,p_reference text,p_player uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE after_balance numeric;
BEGIN
 PERFORM 1 FROM public.ca_diamond_house WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Diamond house account is missing'; END IF;
 IF p_delta<0 AND public.fn_ca_diamond_house_available() < -p_delta THEN
  RAISE EXCEPTION 'Platform diamond underwriting account requires funding'; END IF;
 UPDATE public.ca_diamond_house SET balance=balance+p_delta,updated_at=now()
 WHERE id=1 RETURNING balance INTO STRICT after_balance;
 INSERT INTO public.ca_diamond_house_ledger(delta,balance_after,reason,reference,user_id)
 VALUES(p_delta,after_balance,CASE WHEN p_delta>0 THEN 'wheel_owner_advance_repayment'
 ELSE 'wheel_prize_underwriting' END,p_reference,p_player);
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_house_diamond_leg(bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Called under the picked award and ordered profile locks, in the same
-- transaction as the player credit. Replay returns before this writer.
CREATE FUNCTION public.fn_wheel_finance_prize(a public.wheel_card_awards,p_prize bigint)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE available bigint; outstanding_before bigint; cash_part bigint; advance_part bigint;
 house_part bigint; house_cash bigint:=0; issued bigint:=0; credit jsonb;
 house_wallet constant uuid:='00000000-0000-0000-0000-00000000d1a0';
 allocation record; op text:='wheel-cards:'||a.id; day_now date;
BEGIN
 IF p_prize<=0 OR a.status <> 'picked' OR a.paid_diamonds IS DISTINCT FROM p_prize THEN
  RAISE EXCEPTION 'A funded prize must match its picked card'; END IF;
 SELECT greatest(0,public.fn_diamond_spin_available(a.owner_id))::bigint INTO STRICT available;
 SELECT outstanding INTO outstanding_before FROM public.wheel_owner_credit WHERE owner_id=a.owner_id;
 outstanding_before:=coalesce(outstanding_before,0);
 cash_part:=least(available,p_prize);
 SELECT * INTO STRICT allocation FROM public.fn_wheel_prize_funding(-outstanding_before,p_prize-cash_part);
 advance_part:=allocation.owner_diamonds;
 house_part:=advance_part+allocation.platform_diamonds;
 day_now:=(clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
 IF house_part>0 THEN
  INSERT INTO public.ca_diamond_house(id,balance) VALUES(1,0) ON CONFLICT(id) DO NOTHING;
  PERFORM 1 FROM public.ca_diamond_house WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Diamond house account is missing'; END IF;
  house_cash:=least(house_part,greatest(0,public.fn_ca_diamond_house_available()));
  issued:=house_part-house_cash;
  IF house_cash>0 THEN PERFORM public.fn_wheel_house_diamond_leg(-house_cash,op||':house',a.user_id); END IF;
  INSERT INTO public.wheel_owner_credit(owner_id,outstanding) VALUES(a.owner_id,outstanding_before+advance_part)
  ON CONFLICT(owner_id) DO UPDATE SET outstanding=EXCLUDED.outstanding;
  INSERT INTO public.notifications(user_id,type,title,message,data,action_url,link)
  VALUES(a.owner_id,'diamond_spin_owner_credit','Diamond Spins Needs More Diamonds',
   format('The player was paid %s diamonds. Your outstanding advance is %s diamonds. The platform covered %s diamonds beyond your credit limit.',
    p_prize,outstanding_before+advance_part,allocation.platform_diamonds),
   jsonb_build_object('award_id',a.id,'club_id',a.club_id,'outstanding_diamonds',outstanding_before+advance_part,
    'platform_diamonds',allocation.platform_diamonds),
   '/hub/club-arena/clubs/'||a.club_id||'/diamond-games-operations',
   '/hub/club-arena/clubs/'||a.club_id||'/diamond-games-operations');
 END IF;
 INSERT INTO public.wheel_prize_financing(award_id,owner_id,player_id,host_id,club_id,day,prize,owner_cash,owner_advance,platform_expense,house_cash,issued,outstanding_after)
 VALUES(a.id,a.owner_id,a.user_id,a.host_id,a.club_id,day_now,p_prize,cash_part,advance_part,allocation.platform_diamonds,house_cash,issued,outstanding_before+advance_part);
 IF cash_part>0 THEN
  PERFORM public.fn_diamond_spin_book(a.owner_id,a.club_id,a.host_id,a.host_kind,a.user_id,
   'diamond_prize',-cash_part,op||':custody','Diamond Spins: Diamonds Cards',day_now);
  credit:=public.add_diamonds_to_balance(a.user_id,cash_part,'transfer','Diamond Spins: Diamonds',op,a.owner_id);
  IF credit->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Owner prize payment failed: %',credit; END IF;
 END IF;
 IF house_cash>0 THEN
  credit:=public.add_diamonds_to_balance(a.user_id,house_cash,'wheel_prize_house','Diamond Spins: Platform Funding',op||':house',house_wallet);
  IF credit->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'House prize payment failed: %',credit; END IF;
 END IF;
 IF issued>0 THEN
  -- This is explicit, new supply. A sealed, authenticated pick and the exact
  -- funding receipt are both required. A stop on discretionary issuance must
  -- still work even when the caller is an ordinarily fully funded transfer.
  PERFORM public.fn_ca_assert_emergency_path('positive_issuance');
  credit:=public.add_diamonds_to_balance(a.user_id,issued,'wheel_prize_underwriting',
   'Diamond Spins: Platform Prize Underwriting',op||':issued',NULL);
  IF credit->>'success' IS DISTINCT FROM 'true' OR NOT EXISTS(
    SELECT 1 FROM public.ca_mint_ledger WHERE diamond_tx_id=(credit->>'transaction_id')::uuid
     AND asset='diamonds' AND action='mint' AND holder_type='player' AND holder_id=a.user_id AND amount=issued
  ) THEN RAISE EXCEPTION 'Wheel prize issuance has no exact register receipt'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_finance_prize(public.wheel_card_awards,bigint) FROM PUBLIC,anon,authenticated,service_role;

-- Before closing the day, the net intake and any free owner cash repay the
-- advance into the house account. The repayment is an actual prize expense
-- before the existing profit burn. Settled days return before this call.
CREATE FUNCTION public.fn_wheel_repay_owner_advance(p_owner uuid,p_day date)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE due bigint; available numeric; recovered bigint; target record; op text;
BEGIN
 SELECT outstanding INTO due FROM public.wheel_owner_credit WHERE owner_id=p_owner FOR UPDATE;
 IF coalesce(due,0)=0 THEN RETURN; END IF;
 SELECT coalesce(p.diamonds,0)+d.pending_diamonds-coalesce((
  SELECT sum(greatest(-other.pending_diamonds,0)) FROM public.diamond_spin_days other
  WHERE other.owner_id=p_owner AND other.day<>p_day AND other.status='open'),0)
 INTO STRICT available FROM public.profiles p JOIN public.diamond_spin_days d ON d.owner_id=p.id
 WHERE p.id=p_owner AND d.day=p_day AND d.status='open';
 recovered:=least(due,greatest(available,0));
 IF recovered=0 THEN RETURN; END IF;
 SELECT m.club_id,m.host_id,m.host_kind,m.player_id INTO STRICT target
 FROM public.diamond_spin_movements m WHERE m.owner_id=p_owner AND m.day=p_day
 ORDER BY m.created_at,m.id LIMIT 1;
 op:='wheel-credit-repayment:'||p_owner||':'||p_day;
 INSERT INTO public.wheel_owner_credit_repayments(owner_id,day,amount,outstanding_after)
 VALUES(p_owner,p_day,recovered,due-recovered);
 PERFORM public.fn_diamond_spin_book(p_owner,target.club_id,target.host_id,target.host_kind,target.player_id,
  'diamond_prize',-recovered::integer,op,'Diamond Spins Owner Advance Repayment',p_day);
 PERFORM public.fn_wheel_house_diamond_leg(recovered,op,p_owner);
 UPDATE public.wheel_owner_credit SET outstanding=outstanding-recovered WHERE owner_id=p_owner;
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_repay_owner_advance(uuid,date) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE body text; old_leg text:=$leg$PERFORM public.fn_diamond_spin_book(a.owner_id,a.club_id,a.host_id,a.host_kind,v_user,'diamond_prize',-v_paid,
   'wheel-cards:'||a.id||':custody','Diamond Spins: Diamonds Cards');$leg$;
 anchor text:=' SELECT COALESCE(sum(amount),0),count(*) INTO total,movement_total';
BEGIN
 body:=pg_get_functiondef('public.fn_wheel_diamond_cards_pick(uuid,smallint)'::regprocedure);
 IF position(old_leg in body)=0 OR position('diamond_float=diamond_float-v_paid' in body)=0 THEN
  RAISE EXCEPTION 'Wheel card payout definition changed'; END IF;
 body:=replace(body,'v_values integer[]; v_paid integer','v_values bigint[]; v_paid bigint; v_rules jsonb');
 body:=replace(body,' v_values:=public.fn_wheel_card_values',$seal$ SELECT CASE WHEN receipt_v2->>'payout_rules_version'='2' THEN '{"payout_rules_version":2}'::jsonb
   ELSE '{}'::jsonb END INTO v_rules FROM public.wheel_spins WHERE id=a.spin_id;
 v_rules:=coalesce(v_rules,'{}'::jsonb);
 v_values:=public.fn_wheel_card_values_wide$seal$);
 body:=replace(body,'RETURN jsonb_build_object(''ok'',true,''replayed''','RETURN v_rules || jsonb_build_object(''ok'',true,''replayed''');
 body:=replace(body,old_leg,'PERFORM public.fn_wheel_finance_prize(a,v_paid);');
 IF position($old$  v_credit:=public.add_diamonds_to_balance(v_user,v_paid,'transfer','Diamond Spins: Diamonds',
   'wheel-cards:'||a.id,a.owner_id);
  IF COALESCE((v_credit->>'success')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'The Diamond Card Prize Credit Failed: %',v_credit->>'error'; END IF;
$old$ IN body)=0 THEN RAISE EXCEPTION 'Wheel credit fragment changed'; END IF;
 body:=replace(body,$old$  v_credit:=public.add_diamonds_to_balance(v_user,v_paid,'transfer','Diamond Spins: Diamonds',
   'wheel-cards:'||a.id,a.owner_id);
  IF COALESCE((v_credit->>'success')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'The Diamond Card Prize Credit Failed: %',v_credit->>'error'; END IF;
$old$,'');
 -- The display float is a statistic of net inflow left in the wheel. Spending
 -- beyond its balance is backed by the owner/house transfer recorded above.
 body:=replace(body,'diamond_float=diamond_float-v_paid','diamond_float=greatest(diamond_float-v_paid,0)');
 EXECUTE body;
 body:=pg_get_functiondef('public.fn_diamond_spin_settle_day(uuid,date)'::regprocedure);
 IF position(anchor in body)=0 THEN RAISE EXCEPTION 'Wheel settlement definition changed'; END IF;
 EXECUTE replace(body,anchor,' PERFORM public.fn_wheel_repay_owner_advance(p_owner,p_day);
 SELECT * INTO STRICT bucket FROM public.diamond_spin_days WHERE owner_id=p_owner AND day=p_day;
'||anchor);
END $patch$;
DO $budget$ BEGIN
 IF clock_timestamp()-transaction_timestamp() >= interval '8 seconds' THEN
  RAISE EXCEPTION 'Diamond wallet cutover exceeded eight seconds';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
  WHERE l.pid=pg_backend_pid() AND c.relnamespace='public'::regnamespace
  AND c.relname IN ('clubs','tables','hand_history') AND l.mode IN
  ('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')) THEN
  RAISE EXCEPTION 'Unexpected gameplay relation in Diamond wallet cutover';
 END IF;
END $budget$;
COMMIT;
