-- Captured live function preimages and table shapes, November 1 2026.
-- Isolated empty fixture only; no production data or credentials.
SET check_function_bodies=off;
CREATE TABLE public.unions(id uuid,name text);
CREATE TABLE public.poker_diamond_tournament_ledger(tournament_id uuid,kind text,amount numeric);
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT null::uuid';
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('test.role',true),''),'service_role')$$;
CREATE TABLE public.chip_ledger ("id" uuid DEFAULT gen_random_uuid(),"performed_by" uuid,"from_type" text,"from_entity_id" uuid,"from_label" text,"to_type" text,"to_entity_id" uuid,"to_label" text,"amount" numeric(15,2) DEFAULT 0,"category" text,"description" text,"notes" text,"club_id" uuid,"union_id" uuid,"table_id" uuid,"hand_id" uuid,"tournament_id" uuid,"created_at" timestamp with time zone DEFAULT now(),"idempotency_key" text,"correlation_id" uuid,"causation_id" uuid,"settlement_id" text,"epoch_id" integer DEFAULT 0,"actor_service" text,"db_role" text,"pre_from_balance" numeric DEFAULT 0,"post_from_balance" numeric DEFAULT 0,"pre_to_balance" numeric DEFAULT 0,"post_to_balance" numeric DEFAULT 0,"status" text,"metadata" jsonb,"chain_seq" bigint DEFAULT 0,"prev_hash" text,"row_hash" text);
CREATE TABLE public.clubs ("id" uuid DEFAULT gen_random_uuid(),"name" text,"description" text,"owner_id" uuid,"created_at" timestamp with time zone DEFAULT now(),"is_union" boolean DEFAULT false,"club_id" integer DEFAULT 0,"avatar_url" text,"is_public" boolean DEFAULT false,"requires_approval" boolean DEFAULT false,"gps_restricted" boolean DEFAULT false,"settings" jsonb,"updated_at" timestamp with time zone DEFAULT now(),"union_id" uuid,"color_theme" text,"slug" text,"chip_treasury" numeric(18,2) DEFAULT 0,"total_rake" numeric(18,2) DEFAULT 0,"online_count" integer DEFAULT 0,"game_types" text[],"member_count" integer DEFAULT 0,"table_count" integer DEFAULT 0,"promo_balance" numeric(14,2) DEFAULT 0,"code" text,"rake_percent" numeric(5,2) DEFAULT 0,"rake_cap_bb" numeric(8,2) DEFAULT 0,"max_tables" integer DEFAULT 0,"max_members" integer DEFAULT 0,"status" text,"hands_played" bigint DEFAULT 0,"logo_url" text,"banner_url" text,"game_variants" text[],"settlement_locked" boolean DEFAULT false,"settlement_locked_until" timestamp with time zone DEFAULT now(),"auto_settlement_enabled" boolean DEFAULT false,"auto_settlement_day" text,"auto_settlement_hour" integer DEFAULT 0,"club_commission_rate" numeric(5,4) DEFAULT 0,"insurance_balance" numeric(14,2) DEFAULT 0,"bbj_enabled" boolean DEFAULT false,"player_level" integer DEFAULT 0,"hierarchy_level" integer DEFAULT 0,"level" integer DEFAULT 0,"player_threshold_current" integer DEFAULT 0,"player_threshold_next" integer DEFAULT 0,"hierarchy_units" numeric(10,2) DEFAULT 0,"hierarchy_units_rounded_up" integer DEFAULT 0,"hierarchy_threshold_current" integer DEFAULT 0,"hierarchy_threshold_next" integer DEFAULT 0,"tags" text[],"average_rating" numeric(3,2) DEFAULT 0,"game_type" text,"settlement_lock_until" timestamp with time zone DEFAULT now(),"card_image_url" text,"active_players" integer DEFAULT 0,"default_rake_percent" numeric(5,2) DEFAULT 0,"rake_cap" numeric(18,4) DEFAULT 0,"min_buyin_bb" integer DEFAULT 0,"max_buyin_bb" integer DEFAULT 0,"allow_straddle" boolean DEFAULT false,"allow_run_it_twice" boolean DEFAULT false,"allow_rabbit_hunt" boolean DEFAULT false,"logo" text,"is_private" boolean DEFAULT false,"min_buy_in" numeric(18,4) DEFAULT 0,"max_buy_in" numeric(18,4) DEFAULT 0,"default_game_type" text,"allow_insurance" boolean DEFAULT false,"auto_approve_agents" boolean DEFAULT false,"auto_settlement" boolean DEFAULT false,"active_tables" integer DEFAULT 0,"admin_count" integer DEFAULT 0,"super_agent_count" integer DEFAULT 0,"agent_count" integer DEFAULT 0,"chip_pool" numeric(18,2) DEFAULT 0,"bbj_rake_enabled" boolean DEFAULT false,"spins_enabled" boolean DEFAULT false,"spins_preseed_amount" integer DEFAULT 0,"spins_wallet_funding" text,"ticker_enabled" boolean DEFAULT false,"guarantee_treasury_floor" numeric DEFAULT 0,"guarantee_enforcement_enabled" boolean DEFAULT false,"tagline" text,"opening_checklist_started_at" timestamp with time zone DEFAULT now(),"lobby_message" text,"lobby_message_updated_at" timestamp with time zone DEFAULT now(),"message_revision" bigint DEFAULT 0,"lifecycle_status" text,"retired_at" timestamp with time zone DEFAULT now(),"retired_by" uuid,"retirement_reason" text,"asset" text,"is_platform" boolean DEFAULT false);
CREATE TABLE public.financial_alerts ("id" uuid DEFAULT gen_random_uuid(),"severity" text,"source" text,"message" text,"context" jsonb,"resolved" boolean DEFAULT false,"resolved_at" timestamp with time zone DEFAULT now(),"created_at" timestamp with time zone DEFAULT now(),"resolved_by" uuid,"resolution" text);
CREATE TABLE public.tournament_escrow ("tournament_id" uuid,"enforced" boolean DEFAULT false,"gross_in" numeric DEFAULT 0,"fee_entries_in" numeric DEFAULT 0,"satellite_fee_in" numeric DEFAULT 0,"bounty_in" numeric DEFAULT 0,"overlay_in" numeric DEFAULT 0,"satellite_in" numeric DEFAULT 0,"prize_out" numeric DEFAULT 0,"bounty_out" numeric DEFAULT 0,"fee_out" numeric DEFAULT 0,"refund_prize" numeric DEFAULT 0,"refund_bounty" numeric DEFAULT 0,"refund_fee" numeric DEFAULT 0,"prize_balance" numeric(15,2) DEFAULT 0,"bounty_balance" numeric(15,2) DEFAULT 0,"fee_balance" numeric(15,2) DEFAULT 0,"opened_at" timestamp with time zone DEFAULT now(),"opened_from" text,"updated_at" timestamp with time zone DEFAULT now(),"closed_at" timestamp with time zone DEFAULT now(),"close_note" text,"reserve_out" numeric DEFAULT 0,"reserve_in" numeric DEFAULT 0,"terminal_closed_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.tournament_final_table_deal_batches ("tournament_id" uuid,"plan_fingerprint" text,"plan" jsonb,"prior_standings_fingerprint" text,"live_input_snapshot" jsonb,"live_input_fingerprint" text,"field_count" integer DEFAULT 0,"live_count" integer DEFAULT 0,"structure_place_count" integer DEFAULT 0,"place_line_count" integer DEFAULT 0,"deal_line_count" integer DEFAULT 0,"place_amount" numeric(15,2) DEFAULT 0,"deal_amount" numeric(15,2) DEFAULT 0,"amount_owed" numeric(15,2) DEFAULT 0,"bubble_contract_required" boolean DEFAULT false,"bubble_obligation_id" uuid,"bubble_user_id" uuid,"bubble_source" text,"bubble_amount_owed" numeric(15,2) DEFAULT 0,"bubble_amount_paid_before" numeric(15,2) DEFAULT 0,"amount_moved" numeric(15,2) DEFAULT 0,"escrow_prize_before" numeric(15,2) DEFAULT 0,"escrow_prize_after" numeric(15,2) DEFAULT 0,"deal_table_id" uuid,"chip_leader" uuid,"source" text,"prepared_at" timestamp with time zone DEFAULT now(),"settled_at" timestamp with time zone DEFAULT now(),"contract_version" integer DEFAULT 0);
CREATE TABLE public.tournament_guarantee_overlays ("tournament_id" uuid,"club_id" uuid,"amount" numeric(15,2) DEFAULT 0,"pool_before" numeric(15,2) DEFAULT 0,"pool_after" numeric(15,2) DEFAULT 0,"treasury_after" numeric(15,2) DEFAULT 0,"source" text,"funded_at" timestamp with time zone DEFAULT now(),"bank_type" character varying(10),"bank_entity_id" uuid,"union_id" uuid,"terminal_closed_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.tournament_obligations ("id" uuid DEFAULT gen_random_uuid(),"tournament_id" uuid,"kind" text,"place" integer DEFAULT 0,"user_id" uuid,"amount_owed" numeric(15,2) DEFAULT 0,"amount_paid" numeric(15,2) DEFAULT 0,"source" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"settled_at" timestamp with time zone DEFAULT now(),"adjustment_id" uuid,"terminal_closed_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.tournament_payouts ("id" uuid DEFAULT gen_random_uuid(),"tournament_id" uuid,"user_id" uuid,"position" integer DEFAULT 0,"amount" numeric(15,2) DEFAULT 0,"source" text,"created_at" timestamp with time zone DEFAULT now(),"idempotency_key" text,"paid_at" timestamp with time zone DEFAULT now(),"tournament_type" text,"field_size" integer DEFAULT 0,"prize_pool" numeric DEFAULT 0,"payout_structure" jsonb,"recorded_by" text,"metadata" jsonb,"terminal_closed_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.tournament_place_settlement_batches ("tournament_id" uuid,"mode" text,"plan_fingerprint" text,"place_count" integer DEFAULT 0,"amount_owed" numeric(15,2) DEFAULT 0,"escrow_required" numeric(15,2) DEFAULT 0,"escrow_available" numeric(15,2) DEFAULT 0,"bubble_contract_required" boolean DEFAULT false,"bubble_obligation_id" uuid,"bubble_user_id" uuid,"bubble_source" text,"bubble_amount_owed" numeric(15,2) DEFAULT 0,"bubble_amount_paid_before" numeric(15,2) DEFAULT 0,"source" text,"prepared_at" timestamp with time zone DEFAULT now(),"settled_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.tournament_players ("id" uuid DEFAULT gen_random_uuid(),"tournament_id" uuid,"user_id" uuid,"username" text,"chips" integer DEFAULT 0,"status" text,"position" integer DEFAULT 0,"prize" numeric(15,2) DEFAULT 0,"rebuys" integer DEFAULT 0,"add_on" boolean DEFAULT false,"registered_at" timestamp with time zone DEFAULT now(),"eliminated_at" timestamp with time zone DEFAULT now(),"bounties_collected" integer DEFAULT 0,"bounty_winnings" numeric(15,2) DEFAULT 0,"mystery_bounty_value" numeric(15,2) DEFAULT 0,"current_bounty" numeric DEFAULT 0,"table_id" uuid,"seat_number" integer DEFAULT 0,"chip_count" numeric DEFAULT 0,"club_id" uuid,"is_satellite_qualifier" boolean DEFAULT false,"rebuy_prompt_until" timestamp with time zone DEFAULT now(),"push_15m_sent" boolean DEFAULT false,"push_2m_sent" boolean DEFAULT false,"source_satellite_id" uuid,"elimination_sequence" bigint DEFAULT 0,"terminal_closed_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.tournaments ("id" uuid DEFAULT gen_random_uuid(),"name" text,"description" text,"game_type" text,"variant" text,"buy_in_amount" numeric(15,2) DEFAULT 0,"buy_in_fee" numeric(15,2) DEFAULT 0,"guaranteed_prize" numeric(15,2) DEFAULT 0,"start_time" timestamp with time zone DEFAULT now(),"status" text,"current_players" integer DEFAULT 0,"max_players" integer DEFAULT 0,"late_reg_mins" integer DEFAULT 0,"starting_chips" integer DEFAULT 0,"blind_structure" text,"payout_structure" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"club_id" uuid,"started_at" timestamp with time zone DEFAULT now(),"ended_at" timestamp with time zone DEFAULT now(),"current_level" integer DEFAULT 0,"prize_pool" numeric(18,2) DEFAULT 0,"is_rebuy" boolean DEFAULT false,"add_on_available" boolean DEFAULT false,"rebuy_cost" numeric(15,2) DEFAULT 0,"rebuy_chips" integer DEFAULT 0,"rebuy_levels" integer DEFAULT 0,"addon_cost" numeric(15,2) DEFAULT 0,"addon_chips" integer DEFAULT 0,"min_players" integer DEFAULT 0,"tournament_type" text,"is_bounty" boolean DEFAULT false,"bounty_amount" numeric(15,2) DEFAULT 0,"is_pko" boolean DEFAULT false,"is_mystery_bounty" boolean DEFAULT false,"mystery_bounty_min" numeric(15,2) DEFAULT 0,"mystery_bounty_max" numeric(15,2) DEFAULT 0,"is_xmtt" boolean DEFAULT false,"union_id" uuid,"is_multi_day" boolean DEFAULT false,"parent_tournament_id" uuid,"flight_number" integer DEFAULT 0,"day_number" integer DEFAULT 0,"total_days" integer DEFAULT 0,"flight_end_chips_snapshot" jsonb,"survivors_advance_to" uuid,"is_pinned" boolean DEFAULT false,"spin_multiplier" numeric DEFAULT 0,"is_premium_spin" boolean DEFAULT false,"prize_pool_finalized" boolean DEFAULT false,"is_turbo" boolean DEFAULT false,"blind_speed" text,"spin_type" text,"total_rake" numeric(18,2) DEFAULT 0,"late_reg_levels" integer DEFAULT 0,"addon_levels" integer DEFAULT 0,"is_reentry" boolean DEFAULT false,"satellite_target" uuid,"max_rebuys" integer DEFAULT 0,"max_reentries" integer DEFAULT 0,"level_started_at" timestamp with time zone DEFAULT now(),"addon_period_triggered" boolean DEFAULT false,"satellite_target_id" uuid,"final_table_triggered" boolean DEFAULT false,"bounty_pool" numeric(18,2) DEFAULT 0,"bounty_pool_paid" numeric DEFAULT 0,"on_break" boolean DEFAULT false,"break_started_at" timestamp with time zone DEFAULT now(),"break_ends_at" timestamp with time zone DEFAULT now(),"is_private" boolean DEFAULT false,"spin_locked_tiers" jsonb,"short_description" text,"is_vip_only" boolean DEFAULT false,"ban_chat" boolean DEFAULT false,"all_in_or_fold" boolean DEFAULT false,"label_as_new" boolean DEFAULT false,"hide_club_name" boolean DEFAULT false,"action_time_seconds" integer DEFAULT 0,"table_size" integer DEFAULT 0,"accelerated_mtt" boolean DEFAULT false,"addon_break_minutes" integer DEFAULT 0,"big_blind_ante" boolean DEFAULT false,"authorized_to_register" boolean DEFAULT false,"early_bird_enabled" boolean DEFAULT false,"early_bird_chips" integer DEFAULT 0,"bubble_protection" boolean DEFAULT false,"final_table_deal_enabled" boolean DEFAULT false,"restart_every_minutes" integer DEFAULT 0,"synchronized_breaks" boolean DEFAULT false,"satellite_seats" integer DEFAULT 0,"schedule_id" uuid,"mystery_bounty_activation" text,"mystery_bounty_activation_value" numeric DEFAULT 0,"mystery_bounty_profile" text,"mystery_bounty_top_percent" numeric DEFAULT 0,"mystery_bounty_regular_pool_percent" numeric DEFAULT 0,"mystery_bounty_pool_percent" numeric DEFAULT 0,"mystery_bounty_stage" text,"mystery_bounty_activated_at" timestamp with time zone DEFAULT now(),"mystery_bounty_activated_players" integer DEFAULT 0,"mystery_bounty_pool_cents" bigint DEFAULT 0,"allow_rabbit_hunt" boolean DEFAULT false,"spin_reveal_lag_ms" integer DEFAULT 0,"addon_period_started_at" timestamp with time zone DEFAULT now(),"addon_period_ends_at" timestamp with time zone DEFAULT now(),"payout_percent" smallint DEFAULT 0,"free_buy" boolean DEFAULT false,"addon_from_start" boolean DEFAULT false,"spin_reveal_at" timestamp with time zone DEFAULT now(),"mystery_bounty_activation_generation" bigint DEFAULT 0,"entry_contract_locked" boolean DEFAULT false,"blind_level_state" jsonb,"payout_math_version" smallint DEFAULT 0,"payout_unit_cents" integer DEFAULT 0,"format_contract" text,"restart_source_id" uuid,"payout_depth_percent" numeric(5,2) DEFAULT 0);
CREATE TABLE public.union_wallet_transactions ("id" uuid DEFAULT gen_random_uuid(),"union_id" uuid,"wallet" text,"direction" text,"amount" numeric(20,4) DEFAULT 0,"balance_after" numeric(20,4) DEFAULT 0,"tx_type" text,"club_id" uuid,"period_id" uuid,"notes" text,"created_by" uuid,"created_at" timestamp with time zone DEFAULT now());
CREATE TABLE public.union_wallets ("id" uuid DEFAULT gen_random_uuid(),"union_id" uuid,"chip_balance" numeric(20,2) DEFAULT 0,"rake_wallet" numeric(20,2) DEFAULT 0,"bbj_wallet" numeric(20,2) DEFAULT 0,"promo_wallet" numeric(20,2) DEFAULT 0,"insurance_wallet" numeric(20,2) DEFAULT 0,"total_rake_collected" numeric(20,2) DEFAULT 0,"total_settlements" numeric DEFAULT 0,"updated_at" timestamp with time zone DEFAULT now(),"created_at" timestamp with time zone DEFAULT now(),"spin_reserve_wallet" numeric(20,2) DEFAULT 0);
CREATE TABLE public.wallet_transactions ("id" uuid DEFAULT gen_random_uuid(),"user_id" uuid,"wallet_type" text,"amount" numeric(15,2) DEFAULT 0,"type" text,"category" text,"description" text,"related_entity_id" uuid,"table_id" uuid,"hand_id" uuid,"created_at" timestamp with time zone DEFAULT now(),"balance_after" numeric DEFAULT 0,"terminal_closed_at" timestamp with time zone DEFAULT now());
ALTER TABLE tournaments ADD PRIMARY KEY(id);
ALTER TABLE tournament_escrow ADD PRIMARY KEY(tournament_id);
ALTER TABLE tournament_guarantee_overlays ADD UNIQUE(tournament_id);
CREATE UNIQUE INDEX ledger_key ON chip_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE FUNCTION public.is_club_member(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.fn_tournament_payout_terms_committed_v1(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.fn_raise_server_financial_alert(text,text,text,jsonb,text) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN; END';
CREATE OR REPLACE FUNCTION public.fn_ca_apply_prize_guarantee_core(p_tournament_id uuid, p_source text DEFAULT 'engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t                    record;
  v_after                record;
  v_overlay_row          public.tournament_guarantee_overlays%ROWTYPE;
  v_result               jsonb;
  v_pool_before          numeric := 0;
  v_guarantee            numeric := 0;
  v_final                numeric := 0;
  v_overlay              numeric := 0;
  v_escrow_before        numeric := 0;
  v_escrow_after         numeric := 0;
  v_escrow_before_found  boolean := false;
  v_escrow_after_found   boolean := false;
  v_escrow_enforced      boolean := false;
  v_union                uuid;
  v_expected_bank_type   text;
  v_expected_bank_entity uuid;
  v_club_bank_before     numeric := 0;
  v_bank_before          numeric := 0;
  v_bank_after           numeric := 0;
  v_bank_row_found       boolean := false;
  v_ledger_inserted      integer := 0;
  v_old_category         text;
  v_old_counterparty     text;
  v_old_entity           text;
  v_old_tournament       text;
  v_failure              text;
  v_failure_state        text;
BEGIN
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_id_required',
                              'retryable', false);
  END IF;

  SELECT t.id, t.club_id, t.name, t.status, t.union_id,
         COALESCE(t.is_private, false) AS is_private,
         round(COALESCE(t.prize_pool, 0), 2) AS pool,
         round(COALESCE(t.guaranteed_prize, 0), 2) AS guarantee,
         COALESCE(t.prize_pool_finalized, false) AS finalized
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found',
                              'retryable', false);
  END IF;

  v_pool_before := v_t.pool;
  v_guarantee := v_t.guarantee;
  v_final := GREATEST(v_pool_before, v_guarantee);
  v_overlay := round(v_final - v_pool_before, 2);

  /* Finalized is irreversible. A published pool that was finalized below its
     guarantee is evidence requiring an explicit, reviewed correction; the
     runtime must never reopen and silently reprice it. */
  IF v_t.finalized AND v_pool_before + 0.005 < v_guarantee THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'finalized_guarantee_is_below_published_floor',
      'prize_pool', v_pool_before, 'guaranteed_prize', v_guarantee,
      'retryable', false);
  END IF;

  SELECT round(COALESCE(e.prize_balance, 0), 2)
    INTO v_escrow_before
    FROM public.tournament_escrow e
   WHERE e.tournament_id = p_tournament_id
   FOR UPDATE;
  v_escrow_before_found := FOUND;

  BEGIN
    IF v_overlay > 0 THEN
      /* Lock and snapshot the real bank before calling the legacy debit core.
         Its overlay row describes the movement; only the live before/after
         balance proves that movement happened exactly once. */
      SELECT round(COALESCE(c.chip_treasury, 0), 2)
        INTO v_club_bank_before
        FROM public.clubs c
       WHERE c.id = v_t.club_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'guarantee host club does not exist',
                              ERRCODE = '23503';
      END IF;

      /* Funding ownership was captured on the event. A later club union move
         cannot redirect this liability, and a private event always belongs to
         its host club even when that club is currently union-affiliated. */
      v_union := CASE WHEN v_t.is_private THEN NULL ELSE v_t.union_id END;
      IF v_union IS NOT NULL THEN
        SELECT round(COALESCE(uw.chip_balance, 0), 2)
          INTO v_bank_before
          FROM public.union_wallets uw
         WHERE uw.union_id = v_union
         FOR UPDATE;
        v_bank_row_found := FOUND;
      END IF;
      IF v_bank_row_found THEN
        v_expected_bank_type := 'union';
        v_expected_bank_entity := v_union;
      ELSE
        v_expected_bank_type := 'club';
        v_expected_bank_entity := v_t.club_id;
        v_bank_before := v_club_bank_before;
      END IF;
      IF v_bank_before + 0.005 < v_overlay THEN
        RAISE EXCEPTION USING
          MESSAGE = format(
            'guarantee bank holds %s but the advertised overlay requires %s',
            v_bank_before, v_overlay),
          ERRCODE = '23514';
      END IF;
    END IF;

    v_old_category := current_setting('app.ledger_category', true);
    v_old_counterparty := current_setting('app.ledger_counterparty', true);
    v_old_entity := current_setting('app.ledger_counterparty_entity', true);
    v_old_tournament := current_setting('app.ledger_tournament', true);
    PERFORM set_config('app.ledger_tournament', p_tournament_id::text, true);

    v_result := public.fn_apply_prize_guarantee_before_atomic_proof(
      p_tournament_id, COALESCE(NULLIF(btrim(p_source), ''), 'engine'));
    IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = COALESCE(v_result->>'reason', 'guarantee core refused'),
                            ERRCODE = '23514';
    END IF;
    IF v_overlay > 0 AND COALESCE((v_result->>'already_funded')::boolean, false) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'an existing overlay claim did not prove this short pool was funded',
        ERRCODE = '23514';
    END IF;

    IF v_overlay > 0 THEN
      SELECT * INTO v_overlay_row
        FROM public.tournament_guarantee_overlays o
       WHERE o.tournament_id = p_tournament_id
       FOR UPDATE;
      IF NOT FOUND
         OR v_overlay_row.club_id IS DISTINCT FROM v_t.club_id
         OR abs(round(v_overlay_row.amount, 2) - v_overlay) > 0.005
         OR abs(round(v_overlay_row.pool_before, 2) - v_pool_before) > 0.005
         OR abs(round(v_overlay_row.pool_after, 2) - v_final) > 0.005
         OR v_overlay_row.bank_type IS DISTINCT FROM v_expected_bank_type
         OR v_overlay_row.bank_entity_id IS DISTINCT FROM v_expected_bank_entity
         OR v_overlay_row.treasury_after IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'guarantee overlay claim does not match its bank debit and pool',
                              ERRCODE = '23514';
      END IF;

      IF v_expected_bank_type = 'union' THEN
        SELECT round(COALESCE(uw.chip_balance, 0), 2)
          INTO v_bank_after
          FROM public.union_wallets uw
         WHERE uw.union_id = v_expected_bank_entity
         FOR UPDATE;
      ELSE
        SELECT round(COALESCE(c.chip_treasury, 0), 2)
          INTO v_bank_after
          FROM public.clubs c
         WHERE c.id = v_expected_bank_entity
         FOR UPDATE;
      END IF;
      IF NOT FOUND
         OR abs(v_bank_after - (v_bank_before - v_overlay)) > 0.005
         OR abs(round(v_overlay_row.treasury_after, 2) - v_bank_after) > 0.005 THEN
        RAISE EXCEPTION USING MESSAGE = 'guarantee bank did not debit the exact overlay',
                              ERRCODE = '23514';
      END IF;

      /* The legacy core's balance UPDATE produces an auto-ledger twin. Live
         escrow deliberately ignores auto-ledger overlay rows, so publish the
         one explicit, deterministic bank -> prize-liability leg it requires.
         This insert is in the same subtransaction as the bank debit. */
      INSERT INTO public.chip_ledger (
        performed_by, from_type, from_entity_id, to_type, to_entity_id,
        amount, category, club_id, tournament_id, idempotency_key, description)
      VALUES (
        COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
        CASE WHEN v_expected_bank_type = 'union' THEN 'union_bank' ELSE 'club_treasury' END,
        v_expected_bank_entity, 'prize_liability', p_tournament_id,
        v_overlay, 'overlay', v_t.club_id, p_tournament_id,
        'tourney:' || p_tournament_id::text || ':guarantee_overlay',
        'Guarantee Overlay Funded For ' || COALESCE(v_t.name, p_tournament_id::text))
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS v_ledger_inserted = ROW_COUNT;
      IF v_ledger_inserted <> 1 THEN
        RAISE EXCEPTION USING MESSAGE = 'guarantee overlay journal key already exists unexpectedly',
                              ERRCODE = '23505';
      END IF;
    END IF;

    SELECT t.status, round(COALESCE(t.prize_pool, 0), 2) AS pool,
           round(COALESCE(t.guaranteed_prize, 0), 2) AS guarantee,
           COALESCE(t.prize_pool_finalized, false) AS finalized
      INTO v_after
      FROM public.tournaments t
     WHERE t.id = p_tournament_id
     FOR UPDATE;
    IF NOT FOUND OR NOT v_after.finalized
       OR abs(v_after.pool - v_final) > 0.005
       OR v_after.pool + 0.005 < v_after.guarantee THEN
      RAISE EXCEPTION USING MESSAGE = 'guarantee core did not publish the exact funded final pool',
                            ERRCODE = '23514';
    END IF;

    SELECT COALESCE(e.enforced, false), round(COALESCE(e.prize_balance, 0), 2)
      INTO v_escrow_enforced, v_escrow_after
      FROM public.tournament_escrow e
     WHERE e.tournament_id = p_tournament_id
     FOR UPDATE;
    v_escrow_after_found := FOUND;
    IF v_overlay > 0 AND (
         NOT v_escrow_after_found OR NOT v_escrow_enforced
         OR abs((v_escrow_after - CASE WHEN v_escrow_before_found
                                      THEN v_escrow_before ELSE 0 END) - v_overlay) > 0.005
       ) THEN
      RAISE EXCEPTION USING MESSAGE = 'guarantee bank debit did not credit live escrow exactly',
                            ERRCODE = '23514';
    END IF;

    PERFORM set_config('app.ledger_category', COALESCE(v_old_category, ''), true);
    PERFORM set_config('app.ledger_counterparty', COALESCE(v_old_counterparty, ''), true);
    PERFORM set_config('app.ledger_counterparty_entity', COALESCE(v_old_entity, ''), true);
    PERFORM set_config('app.ledger_tournament', COALESCE(v_old_tournament, ''), true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_failure = MESSAGE_TEXT,
                            v_failure_state = RETURNED_SQLSTATE;
  END;

  IF v_failure IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'atomic_guarantee_funding_aborted',
      'detail', v_failure, 'sqlstate', v_failure_state,
      'prize_pool', v_pool_before, 'guaranteed_prize', v_guarantee,
      'retryable', v_failure_state IN ('40001', '40P01', '55P03'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'prize_pool', v_after.pool,
    'overlay', v_overlay, 'bank_type', v_expected_bank_type,
    'bank_entity_id', v_expected_bank_entity,
    'bank_before', CASE WHEN v_overlay > 0 THEN v_bank_before ELSE NULL END,
    'bank_after', CASE WHEN v_overlay > 0 THEN v_bank_after ELSE NULL END,
    'treasury_after', CASE WHEN v_overlay > 0 THEN v_bank_after ELSE NULL END,
    'escrow_before', CASE WHEN v_escrow_before_found THEN v_escrow_before ELSE NULL END,
    'escrow_after', CASE WHEN v_escrow_after_found THEN v_escrow_after ELSE NULL END,
    'already_finalized', v_t.finalized AND v_overlay = 0,
    'retryable', false);
END;
$function$
;
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
  v_guarantee   := round(COALESCE(NEW.guaranteed_prize,0),2);

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
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_overlay_shortfall(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(0, round(COALESCE(t.guaranteed_prize,0),2) - round(COALESCE(t.prize_pool,0),2))
    FROM public.tournaments t WHERE t.id = p_tournament_id;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_return_excess_start_overlay_locked(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_system_actor constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  v_t public.tournaments%ROWTYPE;
  v_key text;
  v_sources integer;
  v_from_type text;
  v_from_entity uuid;
  v_first_leg uuid;
  v_funded numeric;
  v_returned numeric;
  v_pool numeric;
  v_guarantee numeric;
  v_seat_guarantee numeric;
  v_target_id uuid;
  v_collected numeric;
  v_target numeric;
  v_excess numeric;
  v_before numeric;
  v_after numeric;
  v_ledger_id uuid;
BEGIN
  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_t.prize_pool_finalized, false) THEN
    RETURN NULL;  -- a finalized pool is never repriced
  END IF;
  /* 2026-10-06 (20261007000010): A DIAMOND GUARANTEE IS A FLOOR TOO. When the
     prize pool closes, a Diamond event's pool is brought to exactly
     max(guarantee, collected): overlay the entries collected since lock made
     unnecessary returns from the custody to the house, and any guarantee
     still uncovered is paid from its earmark. One function, the same one the
     lock uses; the unused earmark is released. */
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    v_excess := public.fn_poker_diamond_tournament_settle_overlay(p_tournament_id, 'finalize',
                  public.fn_poker_diamond_tournament_effective_guarantee(p_tournament_id));
    PERFORM public.fn_poker_diamond_guarantee_release(p_tournament_id, 'finalize');
    IF v_excess = 0 THEN RETURN NULL; END IF;
    UPDATE public.tournaments SET prize_pool = round(COALESCE(prize_pool, 0) + v_excess, 2)
     WHERE id = p_tournament_id;
    RETURN jsonb_build_object('asset', 'diamonds', 'bank_type', 'diamond_house',
      'overlay_delta', v_excess, 'amount', GREATEST(-v_excess, 0),
      'pool_before', round(COALESCE(v_t.prize_pool, 0), 2),
      'pool_after', round(COALESCE(v_t.prize_pool, 0) + v_excess, 2));
  END IF;
  v_key := 'tourney:' || p_tournament_id::text || ':guarantee_overlay_excess_return';
  IF EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key = v_key) THEN
    RETURN NULL;
  END IF;

  -- The start-time legs fn_ca_fund_overlay_on_lock wrote (the finalization
  -- leg carries its own idempotency key and cannot exist before finalizing).
  SELECT count(DISTINCT (l.from_type, l.from_entity_id)), min(l.from_type),
         (array_agg(l.from_entity_id ORDER BY l.created_at, l.id))[1],
         (array_agg(l.id ORDER BY l.created_at, l.id))[1],
         round(COALESCE(sum(l.amount), 0), 2)
    INTO v_sources, v_from_type, v_from_entity, v_first_leg, v_funded
    FROM public.chip_ledger l
   WHERE l.tournament_id = p_tournament_id
     AND l.category = 'overlay'
     AND l.to_type = 'prize_liability'
     AND l.to_entity_id = p_tournament_id
     AND l.from_type IN ('union_bank', 'club_treasury')
     AND l.idempotency_key IS DISTINCT FROM 'tourney:' || p_tournament_id::text || ':guarantee_overlay'
     AND COALESCE(l.description, '') NOT LIKE 'auto-ledgered%';
  IF COALESCE(v_funded, 0) <= 0 OR v_sources <> 1 THEN
    RETURN NULL;
  END IF;
  SELECT round(COALESCE(sum(r.amount), 0), 2) INTO v_returned
    FROM public.chip_ledger r
   WHERE r.tournament_id = p_tournament_id AND r.category = 'reversal'
     AND r.from_type = 'prize_liability' AND r.from_entity_id = p_tournament_id
     AND r.metadata->>'kind' = 'reviewed_void_overlay_return';
  v_funded := round(v_funded - v_returned, 2);
  IF v_funded <= 0 THEN RETURN NULL; END IF;

  v_pool := round(COALESCE(v_t.prize_pool, 0), 2);
  v_guarantee := round(COALESCE(v_t.guaranteed_prize, 0), 2);
  -- The same effective guarantee the lock trigger funded: a satellite's
  -- guaranteed seats are worth target buy-in + fee each.
  IF COALESCE(v_t.satellite_seats, 0) > 0
     AND (v_t.variant = 'satellite'
          OR upper(COALESCE(v_t.tournament_type, '')) = 'SATELLITE'
          OR v_t.satellite_target_id IS NOT NULL) THEN
    v_target_id := COALESCE(v_t.satellite_target_id, v_t.satellite_target);
    IF v_target_id IS NOT NULL THEN
      SELECT round((COALESCE(t2.buy_in_amount, 0) + COALESCE(t2.buy_in_fee, 0)) * v_t.satellite_seats, 2)
        INTO v_seat_guarantee FROM public.tournaments t2 WHERE t2.id = v_target_id;
      v_guarantee := GREATEST(v_guarantee, COALESCE(v_seat_guarantee, 0));
    END IF;
  END IF;

  v_collected := round(v_pool - v_funded, 2);
  v_target := GREATEST(v_guarantee, v_collected);
  v_excess := round(LEAST(v_funded, GREATEST(0, v_pool - v_target)), 2);
  IF v_excess <= 0 THEN RETURN NULL; END IF;

  -- Lock order of the finalization core: tournament, escrow, then the bank.
  PERFORM 1 FROM public.tournament_escrow e
   WHERE e.tournament_id = p_tournament_id FOR UPDATE;
  IF v_from_type = 'union_bank' THEN
    SELECT round(COALESCE(chip_balance, 0), 2) INTO v_before FROM public.union_wallets
     WHERE union_id = v_from_entity FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
    UPDATE public.union_wallets SET chip_balance = chip_balance + v_excess, updated_at = now()
     WHERE union_id = v_from_entity RETURNING round(chip_balance, 2) INTO v_after;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '0', true);
  ELSE
    SELECT round(COALESCE(chip_treasury, 0), 2) INTO v_before FROM public.clubs
     WHERE id = v_from_entity FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
    UPDATE public.clubs SET chip_treasury = COALESCE(chip_treasury, 0) + v_excess, updated_at = now()
     WHERE id = v_from_entity RETURNING round(chip_treasury, 2) INTO v_after;
    PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
  END IF;
  IF v_after IS DISTINCT FROM round(v_before + v_excess, 2) THEN
    RAISE EXCEPTION 'excess overlay return did not credit its bank exactly'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.chip_ledger (
    performed_by, from_type, from_entity_id, to_type, to_entity_id,
    amount, category, club_id, tournament_id, description, idempotency_key, metadata)
  VALUES (
    c_system_actor, 'prize_liability', p_tournament_id, v_from_type, v_from_entity,
    v_excess, 'reversal', v_t.club_id, p_tournament_id,
    format('Guarantee overlay excess returned to its source: %s (%s) collected %s against its %s guarantee, so the %s start-time overlay needed only %s',
           COALESCE(v_t.name, 'tournament'), p_tournament_id, v_collected, v_guarantee,
           v_funded, round(v_funded - v_excess, 2)),
    v_key,
    jsonb_build_object('kind', 'reviewed_void_overlay_return',
      'reason', 'guarantee_overlay_excess_at_finalization',
      'original_overlay_ledger_id', v_first_leg, 'funded_overlay', v_funded,
      'collected', v_collected, 'guarantee', v_guarantee,
      'pool_before', v_pool, 'pool_after', round(v_pool - v_excess, 2),
      'source_balance_before', v_before, 'source_balance_after', v_after))
  RETURNING id INTO v_ledger_id;
  PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'guarantee overlay excess return',
                                    p_overlay_in => -v_excess);

  UPDATE public.tournaments
     SET prize_pool = round(v_pool - v_excess, 2)
   WHERE id = p_tournament_id;

  RETURN jsonb_build_object('amount', v_excess, 'bank_type', v_from_type,
    'bank_entity_id', v_from_entity, 'funded_overlay', v_funded,
    'collected', v_collected, 'guarantee', v_guarantee,
    'pool_before', v_pool, 'pool_after', round(v_pool - v_excess, 2),
    'ledger_id', v_ledger_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_freeze_finalized_tournament_prize_pool()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_delta numeric;
  v_candidate_count integer := 0;
BEGIN
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND NOT COALESCE(NEW.prize_pool_finalized, false) THEN
    RAISE EXCEPTION
      'finalized tournament % prize pool cannot be reopened', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND (NEW.payout_structure IS DISTINCT FROM OLD.payout_structure
          OR NEW.spin_multiplier IS DISTINCT FROM OLD.spin_multiplier) THEN
    RAISE EXCEPTION
      'finalized tournament % payout structure and Spin draw cannot change', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND round(COALESCE(NEW.guaranteed_prize, 0), 2)
         IS DISTINCT FROM round(COALESCE(OLD.guaranteed_prize, 0), 2) THEN
    RAISE EXCEPTION 'finalized tournament % guarantee cannot change', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(OLD.prize_pool_finalized, false)
     AND round(COALESCE(NEW.prize_pool, 0), 2)
         IS DISTINCT FROM round(COALESCE(OLD.prize_pool, 0), 2) THEN
    v_delta := round(COALESCE(OLD.prize_pool, 0) - COALESCE(NEW.prize_pool, 0), 2);

    IF v_delta > 0
       AND COALESCE(NEW.prize_pool, 0) >= 0
       AND COALESCE(NEW.prize_pool_finalized, false)
       AND OLD.status = 'COMPLETING'
       AND OLD.satellite_target_id IS NOT NULL
       AND current_setting('app.atomic_satellite_settlement', true) = OLD.id::text
       /* No second column may hitchhike on the narrowly admitted debit. */
       AND (to_jsonb(NEW) - 'prize_pool') = (to_jsonb(OLD) - 'prize_pool') THEN
      SELECT count(*)::integer
        INTO v_candidate_count
        FROM public.tournament_satellite_settlement_batches b
        JOIN public.tournament_satellite_entitlements e
          ON e.tournament_id = b.tournament_id
         AND e.target_tournament_id = b.target_tournament_id
         AND e.target_tournament_id = OLD.satellite_target_id
         AND round(e.ticket_value, 2) = v_delta
        JOIN public.tournament_players source_player
          ON source_player.tournament_id = OLD.id
         AND source_player.position = e.position
         AND source_player.status IN ('winner', 'eliminated')
        JOIN public.tournament_players target_player
          ON target_player.tournament_id = e.target_tournament_id
         AND target_player.user_id = source_player.user_id
         AND COALESCE(target_player.is_satellite_qualifier, false)
         AND target_player.source_satellite_id = OLD.id
        JOIN public.tournaments target
          ON target.id = e.target_tournament_id
       WHERE b.tournament_id = OLD.id
         AND b.settled_at IS NULL
         AND round(
               GREATEST(COALESCE(target.buy_in_amount, 0), 0)
               + GREATEST(COALESCE(target.buy_in_fee, 0), 0),
               2
             ) = v_delta
         AND (
           SELECT count(*)::integer
             FROM public.rake_records target_rake
            WHERE target_rake.tournament_id = target.id
              AND target_rake.source = 'fn_award_satellite_seat'
              AND target_rake.metadata->>'satellite_id' = OLD.id::text
              AND target_rake.metadata->>'user_id' = source_player.user_id::text
              AND target_rake.metadata->>'registration_id' = target_player.id::text
         ) = CASE WHEN COALESCE(target.buy_in_fee, 0) > 0 THEN 1 ELSE 0 END
         AND (
           SELECT count(*)::integer
             FROM public.rake_records exact_target_rake
            WHERE exact_target_rake.tournament_id = target.id
              AND exact_target_rake.source = 'fn_award_satellite_seat'
              AND exact_target_rake.metadata->>'satellite_id' = OLD.id::text
              AND exact_target_rake.metadata->>'user_id' = source_player.user_id::text
              AND exact_target_rake.metadata->>'registration_id' = target_player.id::text
              AND round(exact_target_rake.rake_amount, 2)
                  = round(COALESCE(target.buy_in_fee, 0), 2)
              AND round(COALESCE(exact_target_rake.pot_size, 0), 2) = v_delta
         ) = CASE WHEN COALESCE(target.buy_in_fee, 0) > 0 THEN 1 ELSE 0 END
         /* At this exact instruction the target seat exists, but the source
            payout and transfer journal do not. A replay or second debit has
            either one and therefore cannot match this predicate. */
         AND NOT EXISTS (
           SELECT 1
             FROM public.tournament_payouts payout
            WHERE payout.tournament_id = OLD.id
              AND payout.user_id = source_player.user_id
              AND payout.position = e.position
              AND payout.source = 'satellite_seat'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM public.chip_ledger ledger
            WHERE ledger.idempotency_key =
              'tourney:' || OLD.id::text || ':seat:'
              || source_player.user_id::text || ':pool_transfer'
         );
    END IF;

    IF v_candidate_count = 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finalized tournament % prize pool cannot change from % to %',
      NEW.id, OLD.prize_pool, NEW.prize_pool USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_apply_prize_guarantee_before_atomic_proof(p_tournament_id uuid, p_source text DEFAULT 'engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_t record; v_overlay numeric; v_final numeric; v_claimed integer;
  v_union uuid; v_bank_type text; v_bank_entity uuid;
  v_balance_after numeric; v_bank_name text; v_updated integer;
  v_note text := 'Guarantees are funded daily; union rake returns at the '
              || 'weekly rakeback close, so a mid-week dip is usually timing. '
              || 'Escalate if it survives a close.';
begin
  select t.id, t.club_id, t.name, t.union_id, coalesce(t.is_private, false) as is_private,
         coalesce(t.prize_pool, 0) as pool,
         coalesce(t.guaranteed_prize, 0) as gtd, coalesce(t.prize_pool_finalized, false) as finalized
    into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_t.finalized then
    return jsonb_build_object('ok', true, 'already_finalized', true, 'prize_pool', v_t.pool);
  end if;

  v_final := greatest(v_t.pool, v_t.gtd);
  v_overlay := round(v_final - v_t.pool, 2);

  if v_overlay > 0 then
    -- ZERO-DRIFT phase 2: overlay funding = 'overlay' vs the tournament.
    perform set_config('app.ledger_category', 'overlay', true);
    perform set_config('app.ledger_counterparty', 'prize_liability', true);
    perform set_config('app.ledger_counterparty_entity', p_tournament_id::text, true);

    -- The event owns its funding scope, as in fn_ca_fund_overlay_on_lock.
    -- A club joining another union must not redirect this event's guarantee.
    v_union := CASE WHEN v_t.is_private THEN NULL ELSE v_t.union_id END;
    if v_union is not null then
      v_bank_type := 'union'; v_bank_entity := v_union;
    else
      v_bank_type := 'club'; v_bank_entity := v_t.club_id;
    end if;

    insert into public.tournament_guarantee_overlays
      (tournament_id, club_id, amount, pool_before, pool_after, source,
       bank_type, bank_entity_id, union_id)
    values (p_tournament_id, v_t.club_id, v_overlay, v_t.pool, v_final,
            coalesce(p_source, 'engine'), v_bank_type, v_bank_entity, v_union)
    on conflict (tournament_id) do nothing;
    get diagnostics v_claimed = row_count;

    if v_claimed = 0 then
      update public.tournaments set prize_pool_finalized = true where id = p_tournament_id;
      return jsonb_build_object('ok', true, 'already_funded', true, 'prize_pool', v_t.pool);
    end if;

    if v_bank_type = 'union' then
      update public.union_wallets
         set chip_balance = coalesce(chip_balance, 0) - v_overlay,
             updated_at = now()
       where union_id = v_union
       returning chip_balance into v_balance_after;

      if v_balance_after is null then
        update public.tournament_guarantee_overlays
           set bank_type = 'club', bank_entity_id = v_t.club_id
         where tournament_id = p_tournament_id;
        update public.clubs
           set chip_treasury = coalesce(chip_treasury, 0) - v_overlay, updated_at = now()
         where id = v_t.club_id
         returning chip_treasury into v_balance_after;
        v_bank_type := 'club'; v_bank_entity := v_t.club_id;
      else
        insert into public.union_wallet_transactions
          (union_id, wallet, direction, amount, balance_after, tx_type, club_id, notes)
        values
          (v_union, 'chip_balance', 'debit', v_overlay, v_balance_after,
           'guarantee_overlay', v_t.club_id,
           'Overlay for tournament ' || coalesce(v_t.name, p_tournament_id::text)
             || ' (' || p_tournament_id || '), pool ' || v_t.pool || ' -> ' || v_final);
      end if;
    else
      update public.clubs
         set chip_treasury = coalesce(chip_treasury, 0) - v_overlay, updated_at = now()
       where id = v_t.club_id
       returning chip_treasury into v_balance_after;
    end if;

    -- A missing bank must not manufacture an overlay or finalize the pool.
    -- RETURNING yields a non-null numeric balance after any actual debit,
    -- including the existing union-to-club fallback.
    if v_balance_after is null then
      raise exception 'guarantee_funding_bank_missing: tournament %, bank %/%',
        p_tournament_id, v_bank_type, v_bank_entity;
    end if;

    update public.tournament_guarantee_overlays
       set treasury_after = v_balance_after
     where tournament_id = p_tournament_id;

    select case when v_bank_type = 'union'
                then (select u.name from public.unions u where u.id = v_union)
                else (select c.name from public.clubs c where c.id = v_t.club_id) end
      into v_bank_name;

    if v_balance_after is not null and v_balance_after < 0 then
      update public.financial_alerts
         set severity = 'critical',
             message = 'Bank is negative from funding advertised guarantees: '
                       || coalesce(v_bank_name, v_bank_entity::text),
             context = jsonb_build_object(
                         'bank_type', v_bank_type,
                         'bank_entity_id', v_bank_entity,
                         'club_id', v_t.club_id,
                         'balance_after', v_balance_after,
                         'shortfall', round(-v_balance_after, 2),
                         'latest_tournament_id', p_tournament_id,
                         'latest_overlay', v_overlay,
                         'note', v_note),
             created_at = now()
       where source = 'fn_apply_prize_guarantee'
         and resolved is not true
         and context->>'bank_entity_id' = v_bank_entity::text;
      get diagnostics v_updated = row_count;

      if v_updated = 0 then
        insert into public.financial_alerts (severity, source, message, context)
        values ('critical', 'fn_apply_prize_guarantee',
                'Bank is negative from funding advertised guarantees: '
                  || coalesce(v_bank_name, v_bank_entity::text),
                jsonb_build_object(
                  'bank_type', v_bank_type,
                  'bank_entity_id', v_bank_entity,
                  'club_id', v_t.club_id,
                  'balance_after', v_balance_after,
                  'shortfall', round(-v_balance_after, 2),
                  'latest_tournament_id', p_tournament_id,
                  'latest_overlay', v_overlay,
                  'note', v_note));
      end if;
    end if;
  end if;

  update public.tournaments
     set prize_pool = v_final, prize_pool_finalized = true
   where id = p_tournament_id;

  return jsonb_build_object('ok', true, 'prize_pool', v_final,
    'overlay', coalesce(v_overlay, 0),
    'bank_type', v_bank_type, 'bank_entity_id', v_bank_entity,
    'treasury_after', v_balance_after);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_backpay_guarantee_shortfalls(p_apply boolean DEFAULT false, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t record;
  v_short numeric; v_union uuid; v_bank numeric; v_from text; v_actor uuid;
  v_events int := 0; v_chips numeric := 0; v_distributed numeric := 0;
  v_skipped jsonb := '[]'::jsonb; v_rec jsonb;
BEGIN
  SELECT performed_by INTO v_actor
    FROM public.chip_ledger
   WHERE category = 'overlay' AND performed_by IS NOT NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    SELECT id INTO v_actor FROM public.profiles WHERE role = 'god' ORDER BY created_at LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no operator account to attribute the back-payment to');
  END IF;

  FOR t IN
    WITH candidates AS (
      SELECT tt.id, tt.name, tt.club_id, tt.guaranteed_prize, tt.prize_pool, tt.ended_at,
             COALESCE((SELECT sum(w.amount) FROM public.wallet_transactions w
                        WHERE w.related_entity_id = tt.id AND w.type='credit'
                          AND w.category IN ('prize','bounty')),0) AS paid_all,
             (SELECT count(*) FROM public.tournament_players tp
               WHERE tp.tournament_id = tt.id) AS players
        FROM public.tournaments tt
       WHERE tt.status = 'COMPLETED'
         AND COALESCE(tt.tournament_type,'') = 'MTT'
         AND COALESCE(tt.variant,'') NOT IN ('satellite','spin')
         AND COALESCE(tt.guaranteed_prize,0) > 0
    )
    SELECT * FROM candidates
     WHERE paid_all < guaranteed_prize - 0.01
     ORDER BY ended_at
     LIMIT GREATEST(p_limit,1)
  LOOP
    v_short := round(t.guaranteed_prize - t.paid_all, 2);

    IF t.players = 0 THEN
      v_skipped := v_skipped || jsonb_build_object('tournament', t.name, 'why', 'no finishers recorded');
      CONTINUE;
    END IF;

    v_events := v_events + 1;
    v_chips  := v_chips + v_short;

    IF NOT p_apply THEN CONTINUE; END IF;

    SELECT union_id INTO v_union FROM public.clubs WHERE id = t.club_id;
    v_from := 'union_bank'; v_bank := NULL;
    IF v_union IS NOT NULL THEN
      SELECT chip_balance INTO v_bank FROM public.union_wallets
       WHERE union_id = v_union FOR UPDATE;
    END IF;
    IF v_union IS NULL OR COALESCE(v_bank,0) < v_short THEN
      SELECT chip_treasury INTO v_bank FROM public.clubs WHERE id = t.club_id FOR UPDATE;
      v_from := 'club_treasury';
    END IF;
    IF COALESCE(v_bank,0) < v_short THEN
      v_skipped := v_skipped || jsonb_build_object('tournament', t.name,
                     'why', 'bank short', 'needed', v_short, 'bank', COALESCE(v_bank,0));
      v_events := v_events - 1; v_chips := v_chips - v_short;
      CONTINUE;
    END IF;

    IF v_from = 'union_bank' THEN
      PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
      UPDATE public.union_wallets SET chip_balance = chip_balance - v_short
       WHERE union_id = v_union;
      PERFORM set_config('app.ledger_autoskip_union_wallets', '0', true);
    ELSE
      PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
      UPDATE public.clubs SET chip_treasury = chip_treasury - v_short WHERE id = t.club_id;
      PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
    END IF;

    -- The pool must show the overlay before the reconciler reads it: expected
    -- is pool x structure, so raising the pool IS what makes each place's
    -- entitlement come out at the guaranteed level.
    UPDATE public.tournaments
       SET prize_pool = round(GREATEST(COALESCE(prize_pool,0), t.guaranteed_prize), 2)
     WHERE id = t.id;

    INSERT INTO public.chip_ledger
      (amount, category, from_type, from_entity_id, to_type, to_entity_id,
       club_id, status, performed_by, description, idempotency_key, metadata)
    VALUES (v_short, 'overlay',
            CASE WHEN v_from='union_bank' THEN 'union_bank' ELSE 'club_treasury' END,
            CASE WHEN v_from='union_bank' THEN v_union ELSE t.club_id END,
            'prize_liability', t.id, t.club_id, 'posted', v_actor,
            format('Guarantee shortfall back-payment from the main bank: %s was %s short of its %s guarantee - players had been paid %s',
                   t.name, v_short, round(t.guaranteed_prize,2), round(t.paid_all,2)),
            'guarantee-backpay:' || t.id::text,
            jsonb_build_object('tournament_id', t.id, 'shortfall', v_short,
                               'guarantee', t.guaranteed_prize, 'already_paid', t.paid_all,
                               'distributed_by', 'fn_tournament_payout_reconcile',
                               'money_path', 'fn_settle_tournament_obligation'))
    ON CONFLICT DO NOTHING;

    -- DISTRIBUTION IS NOT THIS FUNCTION'S JOB. The reconciler owns the
    -- structure, tops up each place to its entitlement through
    -- fn_settle_tournament_obligation (Lane A3, 2026-09-02), which writes the
    -- tournament_payouts rows and never claws back.
    v_rec := public.fn_tournament_payout_reconcile(t.id, true);
    v_distributed := v_distributed + COALESCE((v_rec->>'total_settled')::numeric, (v_rec->>'total_top_up')::numeric, 0);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'applied', p_apply,
                            'events', v_events, 'funded', round(v_chips,2),
                            'distributed', round(v_distributed,2), 'skipped', v_skipped,
                            'money_path', 'fn_settle_tournament_obligation');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_prize_overpay_unexplained(p_window interval DEFAULT '10 days'::interval)
 RETURNS TABLE(tournament_id uuid, name text, ended_at timestamp with time zone, prize_pool numeric, guaranteed_prize numeric, paid numeric, excess numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH p AS (
    SELECT t.id, t.name, t.ended_at, t.tournament_type,
           round(COALESCE(t.prize_pool, 0), 2)       AS pool,
           round(COALESCE(t.guaranteed_prize, 0), 2) AS guar,
           COALESCE(t.satellite_seats, 0)            AS seats,
           COALESCE((SELECT round(sum(w.amount), 2)
                       FROM public.wallet_transactions w
                      WHERE w.related_entity_id = t.id
                        AND w.type = 'credit'
                        -- bounty money is funded by the bounty pool, not the
                        -- prize pool, and is reconciled by its own check.
                        -- A registration refund hands back a buy-in that
                        -- never became prize money, so it is not a payout
                        -- either (2026-10-05): counting it read every
                        -- refunded registration as an overpay of exactly
                        -- that refund.
                        AND COALESCE(w.category, '') NOT IN ('bounty', 'refund')), 0) AS paid
      FROM public.tournaments t
     WHERE t.status = 'COMPLETED'
       AND COALESCE(t.prize_pool, 0) > 0
       AND t.ended_at > now() - p_window
  )
  SELECT id, name, ended_at, pool, guar, paid, round(paid - GREATEST(pool, guar), 2)
    FROM p
   WHERE paid > GREATEST(pool, guar) + 0.01
     AND seats = 0                       -- a seat is not a share of the pool
     AND tournament_type <> 'SPIN'       -- a Spin pays a club-funded multiple
   ORDER BY paid - GREATEST(pool, guar) DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_poker_diamond_tournament_effective_guarantee(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(COALESCE(t.guaranteed_prize, 0),
    CASE WHEN COALESCE(t.satellite_seats, 0) > 0
              AND (t.variant = 'satellite' OR upper(COALESCE(t.tournament_type, '')) = 'SATELLITE'
                   OR t.satellite_target_id IS NOT NULL)
         THEN COALESCE((SELECT (COALESCE(t2.buy_in_amount, 0) + COALESCE(t2.buy_in_fee, 0)) * t.satellite_seats
                          FROM public.tournaments t2
                         WHERE t2.id = COALESCE(t.satellite_target_id, t.satellite_target)), 0)
         ELSE 0 END)
    FROM public.tournaments t WHERE t.id = p_tournament_id
$function$
;
CREATE OR REPLACE FUNCTION public.fn_tournament_guarantee_check(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_checked   integer := 0;
  v_short     integer := 0;
  v_unpaid    integer := 0;
  v_chips     numeric := 0;
  v_raised    integer := 0;
  r           record;
BEGIN
  FOR r IN
    WITH scope AS (
      SELECT t.id, t.name, t.club_id, t.guaranteed_prize,
             COALESCE(t.prize_pool, 0) AS pool,
             /* THE BUBBLE IS PAID FROM THE GUARANTEED POOL (2026-10-03). A
                bubble-protected event reserves one base buy-in for its stone
                bubble out of the prize pool before the ladder is priced, and
                says so on the event page. That refund is part of what the
                guarantee paid out, as is an overlay backpay that made a short
                pool whole. Leaving them out read f84852af (Sunday $200 Deep
                Stack, 2026-09-27: 19,820.00 to places 1-2 plus 180.00 to the
                bubble, 20,000.00 in all) as 180.00 short, and 690bfcb0 on
                2026-09-14 the same way. */
             COALESCE((
               SELECT sum(p.amount) FROM public.tournament_payouts p
                WHERE p.tournament_id = t.id
                  AND p.source IN ('structure','reconcile','hu_shortfall',
                                   'late_reg_adjustment','final_table_deal',
                                   'spin_backpay','bubble_protection',
                                   'overlay_backpay')
             ), 0) AS paid,
             EXISTS (SELECT 1 FROM public.tournament_guarantee_overlays o
                      WHERE o.tournament_id = t.id) AS overlay_funded,
             t.ended_at
        FROM public.tournaments t
       WHERE COALESCE(t.guaranteed_prize, 0) > 0
         AND t.status = 'COMPLETED'
         AND t.ended_at > now() - make_interval(hours => GREATEST(p_hours, 1))
         AND COALESCE(t.variant, '') <> 'satellite'
         AND UPPER(COALESCE(t.tournament_type, '')) <> 'SATELLITE'
    )
    SELECT * FROM scope
  LOOP
    v_checked := v_checked + 1;

    -- Rounded to the cent before comparing: the payout structure distributes
    -- in basis points with the residual on the last paid place, so an exact
    -- equality test would report a phantom shortfall of a fraction of a chip.
    CONTINUE WHEN round(r.paid, 2) >= round(r.guaranteed_prize, 2);

    v_short := v_short + 1;
    v_chips := v_chips + (r.guaranteed_prize - r.paid);
    IF r.paid = 0 THEN v_unpaid := v_unpaid + 1; END IF;

    -- One alert per event, ever. Re-running this hourly must not manufacture
    -- a new critical for the same settled tournament.
    IF NOT EXISTS (
      SELECT 1 FROM public.financial_alerts a
       WHERE a.source = 'Tournament.guarantee_not_met'
         AND a.context ->> 'tournament_id' = r.id::text
    ) THEN
      INSERT INTO public.financial_alerts (severity, source, message, context)
      VALUES (
        CASE WHEN r.paid = 0 THEN 'critical' ELSE 'warning' END,
        'Tournament.guarantee_not_met',
        CASE WHEN r.paid = 0
          THEN 'A tournament advertised a guaranteed prize, crowned its field, and paid nobody anything.'
          ELSE 'A tournament paid out less than its advertised guaranteed prize.'
        END,
        jsonb_build_object(
          'tournament_id',    r.id,
          'tournament_name',  r.name,
          'club_id',          r.club_id,
          'guaranteed_prize', r.guaranteed_prize,
          'prize_pool',       r.pool,
          'actually_paid',    r.paid,
          'shortfall',        round(r.guaranteed_prize - r.paid, 2),
          'overlay_funded',   r.overlay_funded,
          'ended_at',         r.ended_at
        )
      );
      v_raised := v_raised + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'window_hours', GREATEST(p_hours, 1),
    'checked', v_checked,
    'short_of_guarantee', v_short,
    'paid_nothing', v_unpaid,
    'chips_short', round(v_chips, 2),
    'alerts_raised', v_raised
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_settlement_mismatch(p_window interval DEFAULT '48:00:00'::interval)
 RETURNS TABLE(kind text, tournament_id uuid, name text, ended_at timestamp with time zone, prize_pool numeric, guaranteed_prize numeric, paid numeric, delta numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH p AS (
    SELECT t.id, t.name, t.ended_at, t.tournament_type,
           round(COALESCE(t.prize_pool, 0), 2)       AS pool,
           round(COALESCE(t.guaranteed_prize, 0), 2) AS guar,
           COALESCE(t.satellite_seats, 0)            AS seats,
           COALESCE((SELECT round(sum(w.amount), 2)
                       FROM public.wallet_transactions w
                      WHERE w.related_entity_id = t.id
                        AND w.type = 'credit'
                        -- A REFUND IS NOT A PRIZE (2026-10-11). A
                        -- registration refund hands back a buy-in that never
                        -- became prize money; counting it read 22 events in
                        -- 30 days as overpaid by exactly their refunds, and
                        -- could hide an underpayment of the same size.
                        AND COALESCE(w.category, '') NOT IN ('bounty', 'refund')), 0)
           -- A DIAMOND PLACE IS PAID FROM THE DIAMOND BOOK (2026-10-09). A
           -- platform Diamond event writes no wallet credit; its places are
           -- 'prize' legs of poker_diamond_tournament_ledger. All 26 events
           -- this read as "underpaid" on 2026-10-09 were Diamond events whose
           -- escrow had paid out to the last Diamond.
           + COALESCE((SELECT round(sum(l.amount), 2)
                         FROM public.poker_diamond_tournament_ledger l
                        WHERE l.tournament_id = t.id AND l.kind = 'prize'), 0) AS paid
      FROM public.tournaments t
     WHERE t.status = 'COMPLETED'
       AND COALESCE(t.prize_pool, 0) > 0
       AND t.ended_at > now() - p_window
       -- a satellite pays in SEATS and a Spin pays a club-funded multiple;
       -- neither is measurable against the pool. Do NOT use spin_type here:
       -- it is the string 'standard' on every row in the table, MTTs included.
       AND COALESCE(t.satellite_seats, 0) = 0
       AND t.tournament_type <> 'SPIN'
  )
  SELECT 'underpaid', id, name, ended_at, pool, guar, paid,
         round(GREATEST(pool, guar) - paid, 2)
    FROM p WHERE paid + 0.01 < GREATEST(pool, guar)
  UNION ALL
  SELECT 'overpaid', id, name, ended_at, pool, guar, paid,
         round(paid - GREATEST(pool, guar), 2)
    FROM p WHERE paid > GREATEST(pool, guar) + 0.01
   ORDER BY 8 DESC;
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
CREATE OR REPLACE FUNCTION public.fn_ca_guard_tournament_restart_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_source public.tournaments%ROWTYPE; v_target_row public.tournaments%ROWTYPE;
 v_abi text; v_target uuid; v_column text; v_total numeric; v_fee numeric; v_mtt boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.restart_source_id IS NOT NULL THEN RAISE EXCEPTION 'TOURNAMENT_RESTART_HISTORY_IMMUTABLE' USING ERRCODE='22023';END IF;
  RETURN OLD;
 ELSIF TG_OP='UPDATE' THEN
  IF NEW.restart_source_id IS DISTINCT FROM OLD.restart_source_id THEN
   RAISE EXCEPTION 'TOURNAMENT_RESTART_SOURCE_IMMUTABLE' USING ERRCODE='22023';END IF;
  RETURN NEW;
 END IF;
 IF NEW.restart_source_id IS NULL THEN RETURN NEW;END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'service_role required for tournament restart' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(530090,1);
 v_abi:=public.fn_ca_lock_mtt_admission_contract();
 IF public.fn_entry_purchases_frozen() THEN RAISE EXCEPTION 'TOURNAMENT_RESTART_PLATFORM_FROZEN' USING ERRCODE='55000';END IF;
 SELECT * INTO v_source FROM public.tournaments WHERE id=NEW.restart_source_id FOR UPDATE;
 IF NOT FOUND OR upper(COALESCE(v_source.status,''))<>'COMPLETED' OR v_source.ended_at IS NULL
    OR v_source.schedule_id IS NOT NULL OR COALESCE(v_source.restart_every_minutes,0)<=0
    OR NEW.club_id IS DISTINCT FROM v_source.club_id OR NEW.union_id IS DISTINCT FROM v_source.union_id
    OR NEW.game_type IS DISTINCT FROM v_source.game_type OR NEW.status IS DISTINCT FROM 'REGISTERING'
    OR NEW.current_players IS DISTINCT FROM 0 OR NEW.schedule_id IS NOT NULL OR NEW.start_time IS NULL
    OR NOT isfinite(NEW.start_time) OR NEW.start_time<=clock_timestamp() THEN
  RAISE EXCEPTION 'TOURNAMENT_RESTART_INVALID_SOURCE' USING ERRCODE='22023';END IF;
 -- NULL terminal parents have no historical exemption. Seat-first/Spin games
 -- are replaced by their board, never cloned by the timed restart path.
 v_mtt:=v_source.format_contract IN ('mtt-v1','mtt-v2');
 IF v_source.format_contract IS NULL OR v_source.format_contract NOT IN ('mtt-v1','mtt-v2','sng-v1')
    OR NEW.format_contract IS NOT NULL
    OR (v_mtt AND NOT public.fn_ca_is_new_mtt(to_jsonb(NEW)))
    OR (v_source.format_contract='sng-v1' AND (COALESCE(v_source.max_players,0)<=2
      OR public.fn_ca_is_new_mtt(to_jsonb(NEW))
      OR v_source.satellite_target_id IS NOT NULL OR v_source.satellite_target IS NOT NULL)) THEN
  RAISE EXCEPTION 'TOURNAMENT_RESTART_FORMAT_MISMATCH' USING ERRCODE='22023';END IF;
 FOREACH v_column IN ARRAY ARRAY['club_id','union_id','is_xmtt','name','game_type','variant','tournament_type','starting_chips','blind_structure','payout_structure','payout_percent','guaranteed_prize','late_reg_levels','late_reg_mins','rebuy_levels','is_rebuy','is_reentry','rebuy_cost','rebuy_chips','add_on_available','addon_cost','addon_chips','addon_levels','is_bounty','bounty_amount','is_pko','is_mystery_bounty','mystery_bounty_min','mystery_bounty_max','mystery_bounty_profile','mystery_bounty_activation','mystery_bounty_activation_value','mystery_bounty_pool_percent','mystery_bounty_regular_pool_percent','mystery_bounty_top_percent','spin_type','satellite_seats','is_private','short_description','is_vip_only','ban_chat','all_in_or_fold','label_as_new','hide_club_name','action_time_seconds','table_size','accelerated_mtt','addon_break_minutes','big_blind_ante','authorized_to_register','early_bird_enabled','early_bird_chips','bubble_protection','final_table_deal_enabled','restart_every_minutes','synchronized_breaks','max_rebuys','max_reentries','is_multi_day','total_days','is_pinned'] LOOP
  IF to_jsonb(NEW)->v_column IS DISTINCT FROM to_jsonb(v_source)->v_column THEN
   RAISE EXCEPTION 'TOURNAMENT_RESTART_BUSINESS_MISMATCH: %',v_column USING ERRCODE='22023';END IF;
 END LOOP;
 IF ((v_abi='legacy-capacity-v1' OR NOT v_mtt) AND (NEW.max_players IS DISTINCT FROM v_source.max_players
      OR NEW.min_players IS DISTINCT FROM v_source.min_players))
    OR (v_abi='unlimited-mtt-v2' AND v_mtt AND (NEW.max_players IS NOT NULL
      OR NEW.min_players IS DISTINCT FROM GREATEST(3,COALESCE(v_source.min_players,3)))) THEN
  RAISE EXCEPTION 'TOURNAMENT_RESTART_CAPACITY_MISMATCH' USING ERRCODE='22023';END IF;
 -- The existing caller only repairs an out-of-policy legacy fee split. Its
 -- player-paid total is fixed, and compliant booked splits pass unchanged.
 v_total:=v_source.buy_in_amount+v_source.buy_in_fee;
 v_fee:=LEAST(v_source.buy_in_fee,trunc(v_total*0.1*100)/100);
 IF v_total IS NULL OR v_total::text IN ('NaN','Infinity','-Infinity')
    OR NEW.buy_in_fee IS DISTINCT FROM v_fee OR NEW.buy_in_amount IS DISTINCT FROM v_total-v_fee THEN
  RAISE EXCEPTION 'TOURNAMENT_RESTART_PRICE_MISMATCH' USING ERRCODE='22023';END IF;
 IF (v_source.satellite_target_id IS NOT NULL AND v_source.satellite_target IS NOT NULL
      AND v_source.satellite_target_id<>v_source.satellite_target)
    OR (NEW.satellite_target_id IS NOT NULL AND NEW.satellite_target IS NOT NULL
      AND NEW.satellite_target_id<>NEW.satellite_target) THEN
  RAISE EXCEPTION 'TOURNAMENT_RESTART_TARGET_MISMATCH' USING ERRCODE='22023';END IF;
 v_target:=COALESCE(v_source.satellite_target_id,v_source.satellite_target);
 IF COALESCE(NEW.satellite_target_id,NEW.satellite_target) IS DISTINCT FROM v_target
    OR (v_target IS NULL AND (upper(COALESCE(v_source.tournament_type,''))='SATELLITE'
      OR lower(COALESCE(v_source.variant,''))='satellite')) THEN
  RAISE EXCEPTION 'TOURNAMENT_RESTART_TARGET_MISMATCH' USING ERRCODE='22023';END IF;
 IF v_target IS NOT NULL THEN
  SELECT * INTO v_target_row FROM public.tournaments WHERE id=v_target FOR UPDATE;
  IF NOT FOUND OR upper(v_target_row.status) NOT IN ('ANNOUNCED','REGISTERING')
    OR v_target_row.start_time IS NULL OR NOT isfinite(v_target_row.start_time)
    OR v_target_row.start_time<=NEW.start_time OR v_target_row.prize_pool_finalized IS TRUE
    OR (NEW.union_id IS NOT NULL AND v_target_row.union_id IS DISTINCT FROM NEW.union_id)
    OR (NEW.union_id IS NULL AND (v_target_row.club_id IS DISTINCT FROM NEW.club_id OR v_target_row.union_id IS NOT NULL))
    OR NOT public.fn_ca_satellite_target_accepts_new_feeder(v_target) THEN
   RAISE EXCEPTION 'TOURNAMENT_RESTART_TARGET_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END IF;
 RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.trg_tournament_atomic_place_completion_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch                       public.tournament_place_settlement_batches%ROWTYPE;
  v_count                       integer := 0;
  v_open                        integer := 0;
  v_mismatches                  integer := 0;
  v_extra_prizes                integer := 0;
  v_player_count                integer := 0;
  v_unranked_count              integer := 0;
  v_distinct_positions          integer := 0;
  v_min_position                integer := 0;
  v_max_position                integer := 0;
  v_winner_count                integer := 0;
  v_winner_place_one            integer := 0;
  v_nonterminal_count           integer := 0;
  v_missing_bust_time           integer := 0;
  v_canonical_mismatches        integer := 0;
  v_payout_evidence_mismatches  integer := 0;
  v_unexpected_payout_evidence  integer := 0;
  v_bubble_user                 uuid;
  v_bubble_holders              integer := 0;
  v_bubble_obligations          integer := 0;
  v_bubble_matching             integer := 0;
  v_bubble_owed                 numeric := 0;
  v_bubble_paid                 numeric := 0;
  v_bubble_evidence             numeric := 0;
  v_bubble_conflicts            integer := 0;
  v_bubble_evidence_exists      boolean := false;
  v_bubble_required             boolean := false;
  v_bubble_contract_required    boolean := false;
  v_bubble_invalid              boolean := false;
  v_bubble_obligation_id        uuid;
  v_bubble_source               text;
  v_bubble_settled_at           timestamptz;
  v_total                       numeric := 0;
  v_escrow_balance              numeric := 0;
  v_escrow_enforced             boolean := false;
  v_escrow_found                boolean := false;
  v_fingerprint                 text;
  v_ftd_check                   jsonb;
BEGIN
  IF lower(COALESCE(NEW.variant, '')) = 'satellite'
     OR upper(COALESCE(NEW.tournament_type, '')) = 'SATELLITE'
     OR NEW.satellite_target_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /* During rollout the atomic deal migration lands after this normal-place
     migration. A single forged deal marker must not become a completion bypass
     in that interval. Only the later deal verifier can exempt the event, and
     its full batch/ledger/result proof must pass. Dynamic SQL keeps this
     migration installable before that function exists. */
  IF EXISTS (SELECT 1 FROM public.tournament_payouts p
              WHERE p.tournament_id = NEW.id AND p.source = 'final_table_deal')
     OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                 WHERE o.tournament_id = NEW.id AND o.kind = 'final_table_deal') THEN
    IF EXISTS(SELECT 1 FROM public.tournament_final_table_deal_batches b
       WHERE b.tournament_id=NEW.id AND b.contract_version=2) THEN
      PERFORM public.fn_ca_verify_terminal_final_deal_batch(NEW.id,true);
      RETURN NEW;
    END IF;
    IF to_regprocedure('public.fn_check_atomic_final_table_deal(uuid)') IS NULL THEN
      RAISE EXCEPTION
        'final-table deal tournament % cannot complete before its atomic verifier is installed', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE 'SELECT public.fn_check_atomic_final_table_deal($1)'
       INTO v_ftd_check USING NEW.id;
    IF NOT COALESCE((v_ftd_check->>'ok')::boolean, false) THEN
      RAISE EXCEPTION
        'final-table deal tournament % failed atomic verification: %',
        NEW.id, COALESCE(v_ftd_check->>'reason', 'unknown')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT COALESCE(NEW.prize_pool_finalized, false)
     OR round(COALESCE(NEW.prize_pool, 0), 2) + 0.005
        < round(COALESCE(NEW.guaranteed_prize, 0), 2) THEN
    RAISE EXCEPTION
      'normal tournament % cannot complete before its prize pool is funded and finalized', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_batch
    FROM public.tournament_place_settlement_batches b
   WHERE b.tournament_id = NEW.id;
  IF NOT FOUND OR v_batch.mode <> 'structure' OR v_batch.settled_at IS NULL THEN
    RAISE EXCEPTION 'normal tournament % cannot complete without a settled atomic place batch', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_batch.escrow_available + 0.005 < v_batch.escrow_required THEN
    RAISE EXCEPTION 'normal tournament % cannot complete without immutable escrow funding proof', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_batch.escrow_required > 0.005 THEN
    SELECT e.enforced, round(COALESCE(e.prize_balance, 0), 2)
      INTO v_escrow_enforced, v_escrow_balance
      FROM public.tournament_escrow e
     WHERE e.tournament_id = NEW.id
     FOR UPDATE;
    v_escrow_found := FOUND;
    IF NOT v_escrow_found OR NOT v_escrow_enforced OR v_escrow_balance < -0.005 THEN
      RAISE EXCEPTION
        'normal tournament % cannot complete without a live non-negative enforced prize escrow', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT count(*), round(COALESCE(sum(o.amount_owed), 0), 2),
         count(*) FILTER (WHERE o.amount_paid + 0.005 < o.amount_owed),
         md5(COALESCE(jsonb_agg(jsonb_build_object(
           'place', o.place, 'user_id', o.user_id,
           'club_id', tp.club_id,
           'cents', round(o.amount_owed * 100)::bigint)
           ORDER BY o.place), '[]'::jsonb)::text)
    INTO v_count, v_total, v_open, v_fingerprint
    FROM public.tournament_obligations o
    JOIN public.tournament_players tp
      ON tp.tournament_id = o.tournament_id
     AND tp.position = o.place AND tp.user_id = o.user_id
   WHERE o.tournament_id = NEW.id AND o.kind = 'place';

  SELECT count(*) INTO v_mismatches
    FROM public.tournament_obligations o
    LEFT JOIN public.tournament_players tp
      ON tp.tournament_id = o.tournament_id AND tp.position = o.place
   WHERE o.tournament_id = NEW.id AND o.kind = 'place'
     AND (tp.user_id IS NULL
          OR tp.user_id IS DISTINCT FROM o.user_id
          OR round(COALESCE(tp.prize, 0) * 100)::bigint
             <> round(o.amount_owed * 100)::bigint);

  SELECT count(*) INTO v_extra_prizes
    FROM public.tournament_players tp
   WHERE tp.tournament_id = NEW.id
     AND round(COALESCE(tp.prize, 0) * 100)::bigint > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_obligations o
        WHERE o.tournament_id = tp.tournament_id AND o.kind = 'place'
          AND o.place = tp.position AND o.user_id = tp.user_id
     );

  SELECT count(*), count(*) FILTER (WHERE tp.position IS NULL),
         count(DISTINCT tp.position), COALESCE(min(tp.position), 0),
         COALESCE(max(tp.position), 0),
         count(*) FILTER (WHERE tp.status = 'winner'),
         count(*) FILTER (WHERE tp.status = 'winner' AND tp.position = 1),
         count(*) FILTER (WHERE tp.status NOT IN ('winner', 'eliminated')),
         count(*) FILTER (WHERE tp.status = 'eliminated' AND tp.eliminated_at IS NULL)
    INTO v_player_count, v_unranked_count, v_distinct_positions,
         v_min_position, v_max_position, v_winner_count,
         v_winner_place_one, v_nonterminal_count, v_missing_bust_time
    FROM public.tournament_players tp
   WHERE tp.tournament_id = NEW.id;

  WITH eliminated AS (
    SELECT tp.id,
           v_player_count - (row_number() OVER (
             ORDER BY tp.eliminated_at ASC, tp.id ASC
           ))::integer + 1 AS canonical_position
      FROM public.tournament_players tp
     WHERE tp.tournament_id = NEW.id AND tp.status = 'eliminated'
  )
  SELECT count(*) INTO v_canonical_mismatches
    FROM eliminated e
    JOIN public.tournament_players tp ON tp.id = e.id
   WHERE tp.position IS DISTINCT FROM e.canonical_position;

  SELECT count(*) INTO v_payout_evidence_mismatches
    FROM public.tournament_obligations o
    CROSS JOIN LATERAL (
      SELECT round(COALESCE(sum(p.amount), 0), 2) AS paid
        FROM public.tournament_payouts p
       WHERE p.tournament_id = o.tournament_id
         AND p.position = o.place
         AND p.user_id = o.user_id
         AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                           'late_reg_adjustment', 'clawback', 'spin_backpay',
                           'overlay_backpay')
              OR public.fn_tournament_payout_key_is_place_evidence(
                   p.tournament_id, p.idempotency_key))
    ) evidence
   WHERE o.tournament_id = NEW.id AND o.kind = 'place'
     AND (o.amount_paid < -0.005
          OR o.amount_paid > o.amount_owed + 0.005
          OR abs(round(o.amount_paid, 2) - evidence.paid) > 0.005);

  SELECT count(*) INTO v_unexpected_payout_evidence
    FROM (
      SELECT p.position, p.user_id
        FROM public.tournament_payouts p
       WHERE p.tournament_id = NEW.id
         AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                           'late_reg_adjustment', 'clawback', 'spin_backpay',
                           'overlay_backpay')
              OR public.fn_tournament_payout_key_is_place_evidence(
                   p.tournament_id, p.idempotency_key))
       GROUP BY p.position, p.user_id
      HAVING abs(round(sum(p.amount), 2)) > 0.005
    ) evidence
   WHERE NOT EXISTS (
     SELECT 1 FROM public.tournament_obligations o
      WHERE o.tournament_id = NEW.id AND o.kind = 'place'
        AND o.place = evidence.position AND o.user_id = evidence.user_id
   );

  SELECT EXISTS (
           SELECT 1 FROM public.tournament_obligations o
            WHERE o.tournament_id = NEW.id
              AND o.kind = 'bubble_protection'
         ) OR EXISTS (
           SELECT 1
             FROM public.tournament_payouts p
            WHERE p.tournament_id = NEW.id
              AND p.source = 'bubble_protection'
            GROUP BY p.tournament_id
           HAVING abs(round(sum(p.amount), 2)) > 0.005
         )
    INTO v_bubble_evidence_exists;
  v_bubble_required := COALESCE(NEW.bubble_protection, false)
                       OR v_bubble_evidence_exists;
  v_bubble_contract_required := v_bubble_required
    AND v_batch.place_count > 0 AND v_player_count > v_batch.place_count;

  IF (v_bubble_evidence_exists OR v_bubble_contract_required)
     AND round(COALESCE(NEW.buy_in_amount, 0), 2) <= 0 THEN
    RAISE EXCEPTION
      'normal tournament % has Bubble Protection evidence with no valid published contract', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_bubble_evidence_exists AND NOT v_bubble_contract_required THEN
    RAISE EXCEPTION
      'normal tournament % has Bubble Protection evidence with no valid published contract', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_batch.bubble_contract_required IS DISTINCT FROM v_bubble_contract_required THEN
    v_bubble_invalid := true;
  END IF;

  IF v_bubble_contract_required THEN
    SELECT count(*), (array_agg(tp.user_id ORDER BY tp.id))[1]
      INTO v_bubble_holders, v_bubble_user
      FROM public.tournament_players tp
     WHERE tp.tournament_id = NEW.id
       AND tp.position = v_batch.place_count + 1;

    SELECT count(*),
           count(*) FILTER (WHERE o.user_id = v_bubble_user AND o.place IS NULL),
           COALESCE(max(o.amount_owed) FILTER (
             WHERE o.user_id = v_bubble_user AND o.place IS NULL), 0),
           COALESCE(max(o.amount_paid) FILTER (
             WHERE o.user_id = v_bubble_user AND o.place IS NULL), 0)
      INTO v_bubble_obligations, v_bubble_matching, v_bubble_owed, v_bubble_paid
      FROM public.tournament_obligations o
     WHERE o.tournament_id = NEW.id AND o.kind = 'bubble_protection';

    SELECT round(COALESCE(sum(p.amount), 0), 2)
      INTO v_bubble_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = NEW.id
       AND p.user_id = v_bubble_user AND p.position IS NULL
       AND p.source = 'bubble_protection';

    SELECT count(*) INTO v_bubble_conflicts
      FROM (
        SELECT p.position, p.user_id
          FROM public.tournament_payouts p
         WHERE p.tournament_id = NEW.id
           AND p.source = 'bubble_protection'
           AND (p.position IS NOT NULL OR p.user_id IS DISTINCT FROM v_bubble_user)
         GROUP BY p.position, p.user_id
        HAVING abs(round(sum(p.amount), 2)) > 0.005
      ) unexpected_bubble;

    IF v_bubble_obligations = 1 AND v_bubble_matching = 1 THEN
      SELECT o.id, o.source, o.amount_owed, o.amount_paid, o.settled_at
        INTO v_bubble_obligation_id, v_bubble_source,
             v_bubble_owed, v_bubble_paid, v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.tournament_id = NEW.id AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_bubble_user
       FOR UPDATE;
    END IF;

    v_bubble_invalid := v_bubble_invalid
      OR v_bubble_holders <> 1 OR v_bubble_user IS NULL
      OR v_bubble_obligations <> 1 OR v_bubble_matching <> 1
      OR v_bubble_obligation_id IS DISTINCT FROM v_batch.bubble_obligation_id
      OR v_bubble_user IS DISTINCT FROM v_batch.bubble_user_id
      OR v_bubble_source IS DISTINCT FROM v_batch.bubble_source
      OR COALESCE(v_bubble_source, '') NOT IN ('engine.eliminatePlayer', 'engine.atomicPlaceSettlement')
      OR abs(v_bubble_owed - round(COALESCE(NEW.buy_in_amount, 0), 2)) > 0.005
      OR abs(v_bubble_owed - v_batch.bubble_amount_owed) > 0.005
      OR v_bubble_paid + 0.005 < v_bubble_owed
      OR v_bubble_paid + 0.005 < v_batch.bubble_amount_paid_before
      OR abs(v_bubble_paid - v_bubble_evidence) > 0.005
      OR v_bubble_settled_at IS NULL
      OR v_bubble_conflicts > 0;
  ELSE
    v_bubble_invalid := v_bubble_invalid
      OR v_batch.bubble_obligation_id IS NOT NULL
      OR v_batch.bubble_user_id IS NOT NULL
      OR v_batch.bubble_source IS NOT NULL
      OR abs(v_batch.bubble_amount_owed) > 0.005
      OR abs(v_batch.bubble_amount_paid_before) > 0.005;
  END IF;

  IF v_count <> v_batch.place_count OR v_open <> 0
     OR abs(v_total - v_batch.amount_owed) > 0.005
     OR abs(v_batch.amount_owed - round(COALESCE(NEW.prize_pool, 0), 2)) > 0.005
     OR v_fingerprint <> v_batch.plan_fingerprint OR v_mismatches > 0
     OR v_extra_prizes > 0
     OR v_player_count = 0 OR v_unranked_count > 0
     OR v_distinct_positions <> v_player_count
     OR v_min_position <> 1 OR v_max_position <> v_player_count
     OR v_winner_count <> 1 OR v_winner_place_one <> 1
     OR v_nonterminal_count <> 0 OR v_missing_bust_time <> 0
     OR v_canonical_mismatches <> 0
     OR v_payout_evidence_mismatches > 0
     OR v_unexpected_payout_evidence > 0
     OR v_bubble_invalid THEN
    RAISE EXCEPTION
      'normal tournament % cannot complete: batch count %, open %, total %, result mismatches %, extra prize rows %, players %, unranked %, rank range %..%, winners %, winner at place one %, nonterminal %, payout mismatches %, unexpected payout groups %, bubble obligations %, bubble conflicts %',
      NEW.id, v_count, v_open, v_total, v_mismatches, v_extra_prizes,
      v_player_count, v_unranked_count, v_min_position, v_max_position,
      v_winner_count, v_winner_place_one, v_nonterminal_count,
      v_payout_evidence_mismatches, v_unexpected_payout_evidence,
      v_bubble_obligations, v_bubble_conflicts
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_settle_tournament_places_atomic(p_tournament_id uuid, p_source text DEFAULT 'engine.atomicPlaceSettlement'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t                   record;
  v_batch               public.tournament_place_settlement_batches%ROWTYPE;
  v_source              text := COALESCE(NULLIF(btrim(p_source), ''), 'engine.atomicPlaceSettlement');
  v_obligation_count    integer := 0;
  v_open_count          integer := 0;
  v_result_mismatches   integer := 0;
  v_extra_prize_count   integer := 0;
  v_unranked_count      integer := 0;
  v_distinct_positions integer := 0;
  v_player_count        integer := 0;
  v_min_position        integer := 0;
  v_max_position        integer := 0;
  v_winner_count        integer := 0;
  v_winner_place_one    integer := 0;
  v_nonterminal_count   integer := 0;
  v_missing_bust_time   integer := 0;
  v_canonical_mismatches integer := 0;
  v_payout_evidence_mismatches integer := 0;
  v_unexpected_payout_evidence integer := 0;
  v_bubble_user         uuid;
  v_bubble_holders      integer := 0;
  v_bubble_obligations  integer := 0;
  v_bubble_matching     integer := 0;
  v_bubble_owed         numeric := 0;
  v_bubble_paid         numeric := 0;
  v_bubble_evidence     numeric := 0;
  v_bubble_conflicts    integer := 0;
  v_bubble_evidence_exists boolean := false;
  v_bubble_required     boolean := false;
  v_bubble_contract_required boolean := false;
  v_bubble_invalid      boolean := false;
  v_bubble_obligation_id uuid;
  v_bubble_source       text;
  v_bubble_settled_at   timestamptz;
  v_obligation_total    numeric := 0;
  v_required_unpaid     numeric := 0;
  v_bubble_required_unpaid numeric := 0;
  v_total_required_unpaid numeric := 0;
  v_escrow_balance      numeric := 0;
  v_escrow_before       numeric := 0;
  v_escrow_after        numeric := 0;
  v_escrow_enforced     boolean := false;
  v_escrow_found        boolean := false;
  v_paid_this_call      numeric := 0;
  v_actual_fingerprint text;
  v_result              jsonb;
  v_after_paid          numeric;
  v_after_bubble_paid   numeric;
  v_failure             text;
  v_failure_state       text;
  r                     record;
BEGIN
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_id_required',
                              'paid', 0, 'retryable', false);
  END IF;

  SELECT t.id, t.name, t.status, round(COALESCE(t.prize_pool, 0), 2) AS prize_pool,
         round(COALESCE(t.guaranteed_prize, 0), 2) AS guaranteed_prize,
         COALESCE(t.prize_pool_finalized, false) AS prize_pool_finalized,
         t.variant, t.tournament_type, t.satellite_target_id,
         COALESCE(t.bubble_protection, false) AS bubble_protection,
         round(COALESCE(t.buy_in_amount, 0), 2) AS buy_in_amount
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found',
                              'paid', 0, 'retryable', false);
  END IF;
  IF lower(COALESCE(v_t.variant, '')) = 'satellite'
     OR upper(COALESCE(v_t.tournament_type, '')) = 'SATELLITE'
     OR v_t.satellite_target_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'satellite_has_its_own_settlement',
                              'paid', 0, 'retryable', false);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id AND p.source = 'final_table_deal'
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'final_table_deal'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'final_table_deal_has_its_own_settlement',
                              'paid', 0, 'retryable', false);
  END IF;
  IF NOT v_t.prize_pool_finalized
     OR v_t.prize_pool + 0.005 < v_t.guaranteed_prize THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'prize_pool_is_not_funded_and_finalized',
                              'prize_pool', v_t.prize_pool,
                              'guaranteed_prize', v_t.guaranteed_prize,
                              'prize_pool_finalized', v_t.prize_pool_finalized,
                              'paid', 0, 'retryable', false);
  END IF;

  SELECT * INTO v_batch
    FROM public.tournament_place_settlement_batches b
   WHERE b.tournament_id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_plan_not_prepared',
                              'paid', 0, 'retryable', false);
  END IF;

  PERFORM 1
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
   ORDER BY tp.id
   FOR UPDATE;

  SELECT count(*), round(COALESCE(sum(o.amount_owed), 0), 2),
         count(*) FILTER (WHERE o.amount_paid + 0.005 < o.amount_owed),
         round(COALESCE(sum(GREATEST(o.amount_owed - o.amount_paid, 0)), 0), 2),
         md5(COALESCE(jsonb_agg(jsonb_build_object(
           'place', o.place, 'user_id', o.user_id,
           'club_id', tp.club_id,
           'cents', round(o.amount_owed * 100)::bigint)
           ORDER BY o.place), '[]'::jsonb)::text)
    INTO v_obligation_count, v_obligation_total, v_open_count,
         v_required_unpaid, v_actual_fingerprint
    FROM public.tournament_obligations o
    JOIN public.tournament_players tp
      ON tp.tournament_id = o.tournament_id
     AND tp.position = o.place AND tp.user_id = o.user_id
   WHERE o.tournament_id = p_tournament_id AND o.kind = 'place';

  SELECT count(*), count(*) FILTER (WHERE tp.position IS NULL),
         count(DISTINCT tp.position), COALESCE(min(tp.position), 0),
         COALESCE(max(tp.position), 0),
         count(*) FILTER (WHERE tp.status = 'winner'),
         count(*) FILTER (WHERE tp.status = 'winner' AND tp.position = 1),
         count(*) FILTER (WHERE tp.status NOT IN ('winner', 'eliminated')),
         count(*) FILTER (WHERE tp.status = 'eliminated' AND tp.eliminated_at IS NULL)
    INTO v_player_count, v_unranked_count, v_distinct_positions,
         v_min_position, v_max_position, v_winner_count,
         v_winner_place_one, v_nonterminal_count, v_missing_bust_time
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;

  WITH eliminated AS (
    SELECT tp.id,
           v_player_count - (row_number() OVER (
             ORDER BY tp.eliminated_at ASC, tp.id ASC
           ))::integer + 1 AS canonical_position
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id AND tp.status = 'eliminated'
  )
  SELECT count(*) INTO v_canonical_mismatches
    FROM eliminated e
    JOIN public.tournament_players tp ON tp.id = e.id
   WHERE tp.position IS DISTINCT FROM e.canonical_position;

  SELECT count(*) INTO v_result_mismatches
    FROM public.tournament_obligations o
    LEFT JOIN public.tournament_players tp
      ON tp.tournament_id = o.tournament_id AND tp.position = o.place
   WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
     AND (tp.user_id IS NULL
          OR tp.user_id IS DISTINCT FROM o.user_id
          OR round(COALESCE(tp.prize, 0) * 100)::bigint
             <> round(o.amount_owed * 100)::bigint);

  SELECT count(*) INTO v_extra_prize_count
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND round(COALESCE(tp.prize, 0) * 100)::bigint > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_obligations o
        WHERE o.tournament_id = tp.tournament_id AND o.kind = 'place'
          AND o.place = tp.position AND o.user_id = tp.user_id
     );

  /* An obligation's paid marker is never authoritative by itself. It must
     equal the net, attributable payout ledger evidence for that exact
     tournament, place and player, and it may not exceed the entitlement. */
  SELECT count(*) INTO v_payout_evidence_mismatches
    FROM public.tournament_obligations o
    CROSS JOIN LATERAL (
      SELECT round(COALESCE(sum(p.amount), 0), 2) AS paid
        FROM public.tournament_payouts p
       WHERE p.tournament_id = o.tournament_id
         AND p.position = o.place
         AND p.user_id = o.user_id
         AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                           'late_reg_adjustment', 'clawback', 'spin_backpay',
                           'overlay_backpay')
              OR public.fn_tournament_payout_key_is_place_evidence(
                   p.tournament_id, p.idempotency_key))
    ) evidence
   WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
     AND (o.amount_paid < -0.005
          OR o.amount_paid > o.amount_owed + 0.005
          OR abs(round(o.amount_paid, 2) - evidence.paid) > 0.005);

  /* Every non-zero place payout group must map back to the frozen obligation
     with the same recipient. This catches extra places and wrong recipients. */
  SELECT count(*) INTO v_unexpected_payout_evidence
    FROM (
      SELECT p.position, p.user_id
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                           'late_reg_adjustment', 'clawback', 'spin_backpay',
                           'overlay_backpay')
              OR public.fn_tournament_payout_key_is_place_evidence(
                   p.tournament_id, p.idempotency_key))
       GROUP BY p.position, p.user_id
      HAVING abs(round(sum(p.amount), 2)) > 0.005
    ) evidence
   WHERE NOT EXISTS (
     SELECT 1 FROM public.tournament_obligations o
      WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
        AND o.place = evidence.position AND o.user_id = evidence.user_id
   );

  /* The batch names the only Bubble obligation this transaction may advance.
     Re-prove its current identity, frozen amount, recipient, source and exact
     ledger evidence before any money moves. */
  SELECT EXISTS (
           SELECT 1 FROM public.tournament_obligations o
            WHERE o.tournament_id = p_tournament_id
              AND o.kind = 'bubble_protection'
         ) OR EXISTS (
           SELECT 1
             FROM public.tournament_payouts p
            WHERE p.tournament_id = p_tournament_id
              AND p.source = 'bubble_protection'
            GROUP BY p.tournament_id
           HAVING abs(round(sum(p.amount), 2)) > 0.005
         )
    INTO v_bubble_evidence_exists;
  v_bubble_required := v_t.bubble_protection OR v_bubble_evidence_exists;
  v_bubble_contract_required := v_bubble_required
    AND v_batch.place_count > 0 AND v_player_count > v_batch.place_count;

  IF (v_bubble_evidence_exists OR v_bubble_contract_required)
     AND v_t.buy_in_amount <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'bubble_protection_evidence_has_no_valid_contract',
      'paid', 0, 'buy_in_amount', v_t.buy_in_amount,
      'paid_places', v_batch.place_count, 'field_size', v_player_count,
      'retryable', false);
  END IF;
  IF v_bubble_evidence_exists AND NOT v_bubble_contract_required THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'bubble_protection_evidence_has_no_valid_contract',
      'paid', 0, 'buy_in_amount', v_t.buy_in_amount,
      'paid_places', v_batch.place_count, 'field_size', v_player_count,
      'retryable', false);
  END IF;

  IF v_batch.bubble_contract_required IS DISTINCT FROM v_bubble_contract_required THEN
    v_bubble_invalid := true;
  END IF;

  IF v_bubble_contract_required THEN
    SELECT count(*), (array_agg(tp.user_id ORDER BY tp.id))[1]
      INTO v_bubble_holders, v_bubble_user
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.position = v_batch.place_count + 1;

    SELECT count(*),
           count(*) FILTER (WHERE o.user_id = v_bubble_user AND o.place IS NULL),
           COALESCE(max(o.amount_owed) FILTER (
             WHERE o.user_id = v_bubble_user AND o.place IS NULL), 0),
           COALESCE(max(o.amount_paid) FILTER (
             WHERE o.user_id = v_bubble_user AND o.place IS NULL), 0)
      INTO v_bubble_obligations, v_bubble_matching, v_bubble_owed, v_bubble_paid
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'bubble_protection';

    SELECT round(COALESCE(sum(p.amount), 0), 2)
      INTO v_bubble_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.user_id = v_bubble_user AND p.position IS NULL
       AND p.source = 'bubble_protection';

    SELECT count(*) INTO v_bubble_conflicts
      FROM (
        SELECT p.position, p.user_id
          FROM public.tournament_payouts p
         WHERE p.tournament_id = p_tournament_id
           AND p.source = 'bubble_protection'
           AND (p.position IS NOT NULL OR p.user_id IS DISTINCT FROM v_bubble_user)
         GROUP BY p.position, p.user_id
        HAVING abs(round(sum(p.amount), 2)) > 0.005
      ) unexpected_bubble;

    IF v_bubble_obligations = 1 AND v_bubble_matching = 1 THEN
      SELECT o.id, o.source, o.amount_owed, o.amount_paid, o.settled_at
        INTO v_bubble_obligation_id, v_bubble_source,
             v_bubble_owed, v_bubble_paid, v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_bubble_user
       FOR UPDATE;
    END IF;

    v_bubble_invalid := v_bubble_invalid
      OR v_bubble_holders <> 1 OR v_bubble_user IS NULL
      OR v_bubble_obligations <> 1 OR v_bubble_matching <> 1
      OR v_bubble_obligation_id IS DISTINCT FROM v_batch.bubble_obligation_id
      OR v_bubble_user IS DISTINCT FROM v_batch.bubble_user_id
      OR v_bubble_source IS DISTINCT FROM v_batch.bubble_source
      OR COALESCE(v_bubble_source, '') NOT IN ('engine.eliminatePlayer', 'engine.atomicPlaceSettlement')
      OR abs(v_bubble_owed - v_t.buy_in_amount) > 0.005
      OR abs(v_bubble_owed - v_batch.bubble_amount_owed) > 0.005
      OR v_bubble_paid < -0.005 OR v_bubble_paid > v_bubble_owed + 0.005
      OR v_bubble_paid + 0.005 < v_batch.bubble_amount_paid_before
      OR (v_t.status <> 'COMPLETED'
          AND abs(v_bubble_paid - v_batch.bubble_amount_paid_before) > 0.005)
      OR abs(v_bubble_paid - v_bubble_evidence) > 0.005
      OR (v_bubble_paid + 0.005 >= v_bubble_owed
          AND v_bubble_settled_at IS NULL)
      OR (v_bubble_paid + 0.005 < v_bubble_owed
          AND v_bubble_settled_at IS NOT NULL)
      OR v_bubble_conflicts > 0;

    v_bubble_required_unpaid := round(GREATEST(v_bubble_owed - v_bubble_paid, 0), 2);
  ELSE
    v_bubble_invalid := v_bubble_invalid
      OR v_batch.bubble_obligation_id IS NOT NULL
      OR v_batch.bubble_user_id IS NOT NULL
      OR v_batch.bubble_source IS NOT NULL
      OR abs(v_batch.bubble_amount_owed) > 0.005
      OR abs(v_batch.bubble_amount_paid_before) > 0.005;
  END IF;

  v_total_required_unpaid := round(v_required_unpaid + v_bubble_required_unpaid, 2);

  IF v_batch.mode <> 'structure'
     OR v_obligation_count <> v_batch.place_count
     OR abs(v_obligation_total - v_batch.amount_owed) > 0.005
     OR abs(v_batch.amount_owed - v_t.prize_pool) > 0.005
     OR v_batch.escrow_available + 0.005 < v_batch.escrow_required
     OR v_actual_fingerprint <> v_batch.plan_fingerprint
     OR v_result_mismatches > 0
     OR v_extra_prize_count > 0
     OR v_payout_evidence_mismatches > 0
     OR v_unexpected_payout_evidence > 0
     OR v_player_count = 0 OR v_unranked_count > 0
     OR v_distinct_positions <> v_player_count
     OR v_min_position <> 1 OR v_max_position <> v_player_count
     OR v_winner_count <> 1 OR v_winner_place_one <> 1
     OR v_nonterminal_count <> 0 OR v_missing_bust_time <> 0
     OR v_canonical_mismatches <> 0
     OR v_bubble_invalid
     OR (v_t.status <> 'COMPLETED'
         AND abs(v_batch.escrow_required - v_total_required_unpaid) > 0.005) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'prepared_place_plan_failed_validation', 'paid', 0,
      'places', v_obligation_count, 'expected_places', v_batch.place_count,
      'amount_owed', v_obligation_total, 'expected_amount', v_batch.amount_owed,
      'prize_pool', v_t.prize_pool, 'result_mismatches', v_result_mismatches,
      'extra_prize_rows', v_extra_prize_count,
      'payout_evidence_mismatches', v_payout_evidence_mismatches,
      'unexpected_payout_evidence', v_unexpected_payout_evidence,
      'unranked', v_unranked_count, 'min_position', v_min_position,
      'max_position', v_max_position, 'winners', v_winner_count,
      'winner_at_place_one', v_winner_place_one,
      'nonterminal_players', v_nonterminal_count,
      'eliminated_without_time', v_missing_bust_time,
      'canonical_position_mismatches', v_canonical_mismatches,
      'bubble_holders', v_bubble_holders,
      'bubble_obligations', v_bubble_obligations,
      'bubble_evidence_conflicts', v_bubble_conflicts, 'retryable', false);
  END IF;

  IF v_total_required_unpaid > 0.005 THEN
    SELECT e.enforced, round(COALESCE(e.prize_balance, 0), 2)
      INTO v_escrow_enforced, v_escrow_balance
      FROM public.tournament_escrow e
     WHERE e.tournament_id = p_tournament_id
     FOR UPDATE;
    v_escrow_found := FOUND;
    IF NOT v_escrow_found OR NOT v_escrow_enforced
       OR v_escrow_balance + 0.005 < v_total_required_unpaid THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'prize_escrow_is_not_funded', 'paid', 0,
        'required_unpaid', v_total_required_unpaid,
        'place_unpaid', v_required_unpaid,
        'bubble_unpaid', v_bubble_required_unpaid,
        'escrow_available', CASE WHEN v_escrow_found THEN v_escrow_balance ELSE NULL END,
        'escrow_enforced', CASE WHEN v_escrow_found THEN v_escrow_enforced ELSE NULL END,
        'retryable', false);
    END IF;
    v_escrow_before := v_escrow_balance;
  END IF;

  IF v_t.status = 'COMPLETED' THEN
    IF v_batch.settled_at IS NOT NULL AND v_open_count = 0
       AND (NOT v_batch.bubble_contract_required
            OR v_bubble_paid + 0.005 >= v_bubble_owed) THEN
      RETURN jsonb_build_object('ok', true, 'tournament_id', p_tournament_id,
                                'paid', 0, 'places', v_obligation_count,
                                'bubble_obligation_id', v_bubble_obligation_id,
                                'already_completed', true, 'retryable', false);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'completed_batch_is_not_fully_settled',
                              'paid', 0, 'open_places', v_open_count,
                              'bubble_paid', v_bubble_paid,
                              'retryable', false);
  END IF;
  IF COALESCE(v_t.status, '') <> 'COMPLETING' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_completing',
                              'status', v_t.status, 'paid', 0, 'retryable', false);
  END IF;

  BEGIN
    PERFORM set_config('app.atomic_tournament_place_batch', p_tournament_id::text, true);

    IF v_batch.bubble_contract_required AND v_bubble_required_unpaid > 0.005 THEN
      v_result := public.fn_settle_tournament_obligation_before_atomic_batch_gate(
        p_tournament_id, 'bubble_protection', NULL, v_batch.bubble_user_id,
        v_batch.bubble_amount_owed, v_batch.bubble_source,
        'Bubble protection: buy-in returned to the stone bubble', NULL
      );
      IF NOT COALESCE((v_result->>'ok')::boolean, false)
         OR NULLIF(v_result->>'obligation_id', '')::uuid
            IS DISTINCT FROM v_batch.bubble_obligation_id THEN
        RAISE EXCEPTION USING
          MESSAGE = format('Bubble Protection refused: %s',
                           COALESCE(v_result->>'refused_reason', 'wrong obligation')),
          ERRCODE = 'P0001';
      END IF;

      SELECT o.amount_paid, o.source, o.amount_owed, o.settled_at
        INTO v_after_bubble_paid, v_bubble_source, v_bubble_owed, v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.id = v_batch.bubble_obligation_id
         AND o.tournament_id = p_tournament_id
         AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_batch.bubble_user_id;
      IF NOT FOUND
         OR v_bubble_source IS DISTINCT FROM v_batch.bubble_source
         OR abs(v_bubble_owed - v_batch.bubble_amount_owed) > 0.005
         OR v_after_bubble_paid + 0.005 < v_batch.bubble_amount_owed
         OR v_bubble_settled_at IS NULL THEN
        RAISE EXCEPTION USING
          MESSAGE = format('Bubble Protection only reached %s of %s',
                           COALESCE(v_after_bubble_paid, 0),
                           v_batch.bubble_amount_owed),
          ERRCODE = 'P0001';
      END IF;
      v_paid_this_call := v_paid_this_call
        + round(COALESCE((v_result->>'paid')::numeric, 0), 2);
    END IF;

    FOR r IN
      SELECT o.id, o.place, o.user_id, o.amount_owed
        FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
       ORDER BY o.place DESC
       FOR UPDATE
    LOOP
      v_result := public.fn_settle_tournament_obligation_before_atomic_batch_gate(
        p_tournament_id, 'place', r.place, r.user_id, r.amount_owed,
        v_source, 'Tournament prize: position ' || r.place::text, NULL
      );
      IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
        RAISE EXCEPTION USING
          MESSAGE = format('place %s refused: %s', r.place,
                           COALESCE(v_result->>'refused_reason', 'unknown')),
          ERRCODE = 'P0001';
      END IF;

      SELECT o.amount_paid INTO v_after_paid
        FROM public.tournament_obligations o WHERE o.id = r.id;
      IF v_after_paid + 0.005 < r.amount_owed THEN
        RAISE EXCEPTION USING
          MESSAGE = format('place %s only reached %s of %s', r.place,
                           v_after_paid, r.amount_owed),
          ERRCODE = 'P0001';
      END IF;
      v_paid_this_call := v_paid_this_call
        + round(COALESCE((v_result->>'paid')::numeric, 0), 2);
    END LOOP;

    SELECT count(*) INTO v_open_count
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
       AND o.amount_paid + 0.005 < o.amount_owed;
    IF v_open_count > 0 THEN
      RAISE EXCEPTION USING
        MESSAGE = format('%s place obligation(s) remain open', v_open_count),
        ERRCODE = 'P0001';
    END IF;

    IF v_batch.bubble_contract_required THEN
      SELECT o.amount_paid, o.source, o.amount_owed, o.settled_at
        INTO v_bubble_paid, v_bubble_source, v_bubble_owed, v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.id = v_batch.bubble_obligation_id
         AND o.tournament_id = p_tournament_id
         AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_batch.bubble_user_id;
      IF NOT FOUND
         OR v_bubble_source IS DISTINCT FROM v_batch.bubble_source
         OR abs(v_bubble_owed - v_batch.bubble_amount_owed) > 0.005
         OR v_bubble_paid + 0.005 < v_bubble_owed
         OR v_bubble_settled_at IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'Bubble Protection remains open after settlement',
                              ERRCODE = 'P0001';
      END IF;

      SELECT round(COALESCE(sum(p.amount), 0), 2)
        INTO v_bubble_evidence
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.user_id = v_batch.bubble_user_id
         AND p.position IS NULL AND p.source = 'bubble_protection';
      IF abs(v_bubble_paid - v_bubble_evidence) > 0.005 THEN
        RAISE EXCEPTION USING
          MESSAGE = 'Bubble Protection payout evidence does not equal its paid obligation',
          ERRCODE = '23514';
      END IF;
    END IF;

    /* A wallet credit is not a complete transfer unless the same transaction
       also consumes the prize liability. Prove the exact escrow delta rather
       than trusting the child response or merely checking for non-negativity;
       a missing/disabled escrow trigger would otherwise leave reusable phantom
       funds behind after paying every wallet. */
    IF v_total_required_unpaid > 0.005 THEN
      SELECT round(COALESCE(e.prize_balance, 0), 2)
        INTO v_escrow_after
        FROM public.tournament_escrow e
       WHERE e.tournament_id = p_tournament_id AND e.enforced
       FOR UPDATE;
      IF NOT FOUND
         OR round((v_escrow_before - v_escrow_after) * 100)::bigint
            <> round(v_total_required_unpaid * 100)::bigint
         OR round(v_paid_this_call * 100)::bigint
            <> round(v_total_required_unpaid * 100)::bigint THEN
        RAISE EXCEPTION USING
          MESSAGE = format(
            'prize escrow moved %s and child calls reported %s; exact required payout was %s',
            round(v_escrow_before - v_escrow_after, 2), v_paid_this_call,
            v_total_required_unpaid),
          ERRCODE = '23514';
      END IF;
    END IF;

    /* Re-prove the ledger after the final child call. This rejects an RPC
       response that claims success without writing the exact payout evidence,
       or one that writes evidence for a different place or recipient. */
    SELECT count(*) INTO v_payout_evidence_mismatches
      FROM public.tournament_obligations o
      CROSS JOIN LATERAL (
        SELECT round(COALESCE(sum(p.amount), 0), 2) AS paid
          FROM public.tournament_payouts p
         WHERE p.tournament_id = o.tournament_id
           AND p.position = o.place
           AND p.user_id = o.user_id
           AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                             'late_reg_adjustment', 'clawback', 'spin_backpay',
                             'overlay_backpay')
                OR public.fn_tournament_payout_key_is_place_evidence(
                     p.tournament_id, p.idempotency_key))
      ) evidence
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
       AND (o.amount_paid < -0.005
            OR o.amount_paid > o.amount_owed + 0.005
            OR abs(round(o.amount_paid, 2) - evidence.paid) > 0.005);

    SELECT count(*) INTO v_unexpected_payout_evidence
      FROM (
        SELECT p.position, p.user_id
          FROM public.tournament_payouts p
         WHERE p.tournament_id = p_tournament_id
           AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                             'late_reg_adjustment', 'clawback', 'spin_backpay',
                             'overlay_backpay')
                OR public.fn_tournament_payout_key_is_place_evidence(
                     p.tournament_id, p.idempotency_key))
         GROUP BY p.position, p.user_id
        HAVING abs(round(sum(p.amount), 2)) > 0.005
      ) evidence
     WHERE NOT EXISTS (
       SELECT 1 FROM public.tournament_obligations o
        WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
          AND o.place = evidence.position AND o.user_id = evidence.user_id
     );
    IF v_payout_evidence_mismatches > 0 OR v_unexpected_payout_evidence > 0 THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'post-settlement payout evidence mismatch: obligations %s, unexpected groups %s',
          v_payout_evidence_mismatches, v_unexpected_payout_evidence),
        ERRCODE = '23514';
    END IF;

    /* The trigger gate is needed only while the child RPC advances frozen
       place rows. Clear it before touching the batch header or tournament and
       again after the subtransaction so the caller can never inherit it. */
    PERFORM set_config('app.atomic_tournament_place_batch', '', true);

    UPDATE public.tournament_place_settlement_batches
       SET settled_at = COALESCE(settled_at, now()), source = v_source
     WHERE tournament_id = p_tournament_id
       AND plan_fingerprint = v_actual_fingerprint
       AND bubble_contract_required = v_bubble_contract_required
       AND bubble_obligation_id IS NOT DISTINCT FROM v_bubble_obligation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'the prepared batch changed before settlement',
                            ERRCODE = '40001';
    END IF;

    UPDATE public.tournaments
       SET status = 'COMPLETED',
           ended_at = COALESCE(ended_at, clock_timestamp()),
           on_break = false,
           break_ends_at = NULL
     WHERE id = p_tournament_id AND status = 'COMPLETING';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'COMPLETING claim was lost before completion',
                            ERRCODE = '40001';
    END IF;

    /* Durable completion includes the physical tables. The tournament status
       transition above releases live seats through its database triggers; the
       close below is kept in this same exception subtransaction so a table
       trigger or constraint failure rolls every prize and COMPLETED back. */
    UPDATE public.tables
       SET status = 'closed', current_players = 0
     WHERE tournament_id = p_tournament_id
       AND (status IS DISTINCT FROM 'closed' OR current_players IS DISTINCT FROM 0);
    IF EXISTS (
         SELECT 1 FROM public.tables
          WHERE tournament_id = p_tournament_id
            AND (status IS DISTINCT FROM 'closed' OR current_players IS DISTINCT FROM 0)
       ) OR EXISTS (
         SELECT 1
           FROM public.table_seats s
           JOIN public.tables tb ON tb.id = s.table_id
          WHERE tb.tournament_id = p_tournament_id AND s.left_at IS NULL
       ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'completed tournament retained a nonterminal table or live seat',
        ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_result_mismatches
      FROM public.tournament_obligations o
      LEFT JOIN public.tournament_players tp
        ON tp.tournament_id = o.tournament_id AND tp.position = o.place
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
       AND (tp.user_id IS NULL
            OR tp.user_id IS DISTINCT FROM o.user_id
            OR round(COALESCE(tp.prize, 0) * 100)::bigint
               <> round(o.amount_owed * 100)::bigint);

    SELECT count(*) INTO v_extra_prize_count
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND round(COALESCE(tp.prize, 0) * 100)::bigint > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.tournament_obligations o
          WHERE o.tournament_id = tp.tournament_id AND o.kind = 'place'
            AND o.place = tp.position AND o.user_id = tp.user_id
       );
    IF v_result_mismatches > 0 OR v_extra_prize_count > 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'completion trigger changed the frozen place plan',
                            ERRCODE = '23514';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_failure = MESSAGE_TEXT,
                            v_failure_state = RETURNED_SQLSTATE;
  END;

  PERFORM set_config('app.atomic_tournament_place_batch', '', true);

  IF v_failure IS NOT NULL THEN
    BEGIN
      PERFORM public.fn_raise_server_financial_alert(
        'critical', 'fn_settle_tournament_places_atomic',
        format('Atomic place settlement aborted for %s: %s',
               COALESCE(v_t.name, p_tournament_id::text), v_failure),
        jsonb_build_object('tournament_id', p_tournament_id,
                           'sqlstate', v_failure_state, 'reason', v_failure,
                           'places', v_obligation_count,
                           'amount_owed', v_obligation_total,
                           'open_obligations', v_open_count,
                           'bubble_obligation_id', v_bubble_obligation_id,
                           'source', v_source),
        'atomic-place-settle:' || p_tournament_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'atomic_settlement_aborted',
      'detail', v_failure, 'sqlstate', v_failure_state, 'paid', 0,
      'places', v_obligation_count,
      'bubble_obligation_id', v_bubble_obligation_id,
      'retryable', v_failure_state IN ('40001', '40P01', '55P03'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'tournament_id', p_tournament_id,
                            'paid', round(v_paid_this_call, 2),
                            'places', v_obligation_count,
                            'bubble_obligation_id', v_bubble_obligation_id,
                            'completed', true, 'retryable', false,
                            'record', 'tournament_obligations');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_settle_final_table_deal_atomic(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t                       record;
  v_batch                   public.tournament_final_table_deal_batches%ROWTYPE;
  v_check                   jsonb;
  v_struct                  jsonb := '[]'::jsonb;
  v_trimmed                 jsonb := '[]'::jsonb;
  v_place_plan              jsonb := '[]'::jsonb;
  v_deal_shares             jsonb := '[]'::jsonb;
  v_deal_plan               jsonb := '[]'::jsonb;
  v_plan                    jsonb := '[]'::jsonb;
  v_payouts                 jsonb := '[]'::jsonb;
  v_plan_fingerprint        text;
  v_prior_standings_fingerprint text;
  v_live_input_snapshot     jsonb := '[]'::jsonb;
  v_live_input_fingerprint  text;
  v_field_count             integer := 0;
  v_live_count              integer := 0;
  v_deal_table_id           uuid;
  v_seated_active_tables    integer := 0;
  v_all_live_seats          integer := 0;
  v_active_live_seats       integer := 0;
  v_distinct_seat_users     integer := 0;
  v_matching_live_users     integer := 0;
  v_seat_stack_mismatches   integer := 0;
  v_live_missing_registration integer := 0;
  v_other_count             integer := 0;
  v_live_positioned         integer := 0;
  v_eliminated_count        integer := 0;
  v_eliminated_ranked       integer := 0;
  v_eliminated_distinct     integer := 0;
  v_eliminated_min          integer := 0;
  v_eliminated_max          integer := 0;
  v_eliminated_missing_time integer := 0;
  v_eliminated_canonical_mismatches integer := 0;
  v_structure_places        integer := 0;
  v_structure_distinct      integer := 0;
  v_structure_min           integer := 0;
  v_structure_max           integer := 0;
  v_total_bp                bigint := 0;
  v_pool_cents              bigint := 0;
  v_remaining_cents         bigint := 0;
  v_expected_cents          bigint := 0;
  v_place_total_cents       bigint := 0;
  v_prior_place_paid_cents  bigint := 0;
  v_deal_total_cents        bigint := 0;
  v_available_cents         bigint := 0;
  v_unpaid_cents            bigint := 0;
  v_total_unpaid_cents      bigint := 0;
  v_floor_paid_cents        bigint := 0;
  v_remainder_cents         bigint := 0;
  v_total_chips             numeric := 0;
  v_rank                    integer := 0;
  v_share_cents             bigint := 0;
  v_leader                  uuid;
  v_holder                  uuid;
  v_holders                 integer := 0;
  v_seeded_paid             numeric := 0;
  v_wrong_recipients        integer := 0;
  v_conflicts               integer := 0;
  v_existing                public.tournament_obligations%ROWTYPE;
  v_result                  jsonb;
  v_after_paid              numeric := 0;
  v_paid_this_call          numeric := 0;
  v_place_paid_this_call    numeric := 0;
  v_deal_paid_this_call     numeric := 0;
  v_bubble_paid_this_call   numeric := 0;
  v_bubble_user             uuid;
  v_bubble_holders          integer := 0;
  v_bubble_obligations      integer := 0;
  v_bubble_matching         integer := 0;
  v_bubble_owed             numeric := 0;
  v_bubble_paid             numeric := 0;
  v_bubble_evidence         numeric := 0;
  v_bubble_conflicts        integer := 0;
  v_bubble_obligation_id    uuid;
  v_bubble_source           text;
  v_bubble_settled_at       timestamptz;
  v_bubble_row_found        boolean := false;
  v_bubble_needs_insert     boolean := false;
  v_bubble_unpaid_cents     bigint := 0;
  v_after_bubble_paid       numeric := 0;
  v_bubble_obligation_present boolean := false;
  v_bubble_payout_present   boolean := false;
  v_bubble_required         boolean := false;
  v_bubble_shape_valid      boolean := false;
  v_escrow                  public.tournament_escrow%ROWTYPE;
  v_escrow_after            numeric := 0;
  v_failure                 text;
  v_failure_state           text;
  r                         record;
BEGIN
  PERFORM public.fn_ca_lock_settlement_lane_global();
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_id_required',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  SELECT t.id, t.name, t.status, round(COALESCE(t.prize_pool, 0), 2) AS prize_pool,
         round(COALESCE(t.guaranteed_prize, 0), 2) AS guaranteed_prize,
         COALESCE(t.prize_pool_finalized, false) AS prize_pool_finalized,
         COALESCE(t.final_table_deal_enabled, false) AS final_table_deal_enabled,
         COALESCE(t.table_size, 9) AS table_size, t.payout_structure,
         t.variant, t.tournament_type, t.satellite_target_id, t.spin_multiplier,
         COALESCE(t.is_bounty, false) AS is_bounty,
         COALESCE(t.is_pko, false) AS is_pko,
         COALESCE(t.is_mystery_bounty, false) AS is_mystery_bounty,
         COALESCE(t.mystery_bounty_stage, 'pending') AS mystery_bounty_stage,
         COALESCE(t.bubble_protection, false) AS bubble_protection,
         round(COALESCE(t.buy_in_amount, 0), 2) AS buy_in_amount
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  SELECT * INTO v_batch
    FROM public.tournament_final_table_deal_batches b
   WHERE b.tournament_id = p_tournament_id
   FOR UPDATE;

  IF v_t.status = 'COMPLETED' THEN
    v_check := public.fn_check_atomic_final_table_deal(p_tournament_id);
    IF COALESCE((v_check->>'ok')::boolean, false) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'user_id', x.user_id, 'amount', x.cents / 100.0, 'rank', x.rank)
               ORDER BY x.rank), '[]'::jsonb)
        INTO v_payouts
        FROM jsonb_to_recordset(v_batch.plan)
          AS x(kind text, place integer, user_id uuid, cents bigint, rank integer)
       WHERE x.kind = 'final_table_deal';
      RETURN jsonb_build_object(
        'ok', true, 'paid', 0, 'place_paid', 0, 'deal_paid', 0, 'bubble_paid', 0,
        'completed', true, 'already_completed', true,
        'players', v_batch.live_count, 'chip_leader', v_batch.chip_leader,
        'deal_table_id', v_batch.deal_table_id,
        'bubble_contract_required', v_batch.bubble_contract_required,
        'bubble_obligation_id', v_batch.bubble_obligation_id,
        'payouts', v_payouts, 'retryable', false);
    END IF;
    RETURN v_check || jsonb_build_object('paid', 0, 'completed', false,
                                         'retryable', false);
  END IF;

  IF v_t.status <> 'RUNNING' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_running',
                              'status', v_t.status, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;
  IF NOT v_t.final_table_deal_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deal_not_enabled',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF lower(COALESCE(v_t.variant, '')) = 'satellite'
     OR upper(COALESCE(v_t.tournament_type, '')) = 'SATELLITE'
     OR v_t.satellite_target_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'satellite_has_its_own_settlement',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF NOT v_t.prize_pool_finalized
     OR v_t.prize_pool + 0.005 < v_t.guaranteed_prize THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'prize_pool_is_not_funded_and_finalized',
                              'prize_pool', v_t.prize_pool,
                              'guaranteed_prize', v_t.guaranteed_prize,
                              'prize_pool_finalized', v_t.prize_pool_finalized,
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF v_batch.tournament_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.tournament_payouts p
                 WHERE p.tournament_id = p_tournament_id
                   AND p.source = 'final_table_deal')
     OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                 WHERE o.tournament_id = p_tournament_id
                   AND o.kind = 'final_table_deal') THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'legacy_or_incomplete_deal_has_no_atomic_replay',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  /* Parent-to-child locks make the physical-table predicate stable through
     COMMIT. A new tournament table needs a foreign-key key-share lock on the
     tournament row; a new seat needs one on its table row. Both parents are
     already FOR UPDATE, while every existing live seat is locked directly. */
  PERFORM 1
    FROM public.tables tb
   WHERE tb.tournament_id = p_tournament_id
   ORDER BY tb.id
   FOR UPDATE;
  PERFORM 1
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
   WHERE tb.tournament_id = p_tournament_id
     AND ts.left_at IS NULL
   ORDER BY ts.id
   FOR UPDATE OF ts;
  PERFORM 1
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
   ORDER BY tp.id
   FOR UPDATE;
  PERFORM 1
    FROM public.tournament_deal_votes v
   WHERE v.tournament_id = p_tournament_id
   ORDER BY v.user_id
   FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE tp.status = 'playing' AND tp.eliminated_at IS NULL),
         count(*) FILTER (WHERE tp.status NOT IN ('playing', 'eliminated')),
         count(*) FILTER (WHERE tp.status = 'playing' AND tp.position IS NOT NULL),
         count(*) FILTER (WHERE tp.status = 'eliminated'),
         count(tp.position) FILTER (WHERE tp.status = 'eliminated'),
         count(DISTINCT tp.position) FILTER (WHERE tp.status = 'eliminated'),
         COALESCE(min(tp.position) FILTER (WHERE tp.status = 'eliminated'), 0),
         COALESCE(max(tp.position) FILTER (WHERE tp.status = 'eliminated'), 0),
         count(*) FILTER (
           WHERE tp.status = 'eliminated' AND tp.eliminated_at IS NULL),
         COALESCE(sum(tp.chips) FILTER (
           WHERE tp.status = 'playing' AND tp.eliminated_at IS NULL), 0)
    INTO v_field_count, v_live_count, v_other_count, v_live_positioned,
         v_eliminated_count, v_eliminated_ranked, v_eliminated_distinct,
         v_eliminated_min, v_eliminated_max, v_eliminated_missing_time,
         v_total_chips
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;

  WITH prior AS (
    SELECT tp.id, tp.user_id, tp.position, tp.eliminated_at,
           v_field_count - (row_number() OVER (
             ORDER BY tp.eliminated_at ASC, tp.id ASC
           ))::integer + 1 AS canonical_position
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status = 'eliminated'
  )
  SELECT count(*) FILTER (
           WHERE p.position IS DISTINCT FROM p.canonical_position),
         md5(COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'user_id', p.user_id, 'position', p.position,
           'eliminated_at_utc', to_char(
             p.eliminated_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US'))
           ORDER BY p.position, p.id), '[]'::jsonb)::text)
    INTO v_eliminated_canonical_mismatches,
         v_prior_standings_fingerprint
    FROM prior p;

  IF v_live_count < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough_players',
                              'players', v_live_count, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;
  IF v_live_count > v_t.table_size THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_at_final_table',
                              'players', v_live_count, 'table_size', v_t.table_size,
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF v_other_count > 0 OR v_live_positioned > 0
     OR v_live_count + v_eliminated_count <> v_field_count
     OR v_eliminated_ranked <> v_eliminated_count
     OR v_eliminated_distinct <> v_eliminated_count
     OR (v_eliminated_count > 0
         AND (v_eliminated_min <> v_live_count + 1
              OR v_eliminated_max <> v_field_count
              OR v_eliminated_max - v_eliminated_min + 1
                 <> v_eliminated_count)) THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'standings_before_deal_are_not_contiguous',
                              'field', v_field_count, 'live', v_live_count,
                              'other_statuses', v_other_count,
                              'live_with_position', v_live_positioned,
                              'classified_players',
                                v_live_count + v_eliminated_count,
                              'eliminated', v_eliminated_count,
                              'eliminated_ranked', v_eliminated_ranked,
                              'eliminated_distinct', v_eliminated_distinct,
                              'eliminated_range', jsonb_build_array(v_eliminated_min,
                                                                    v_eliminated_max),
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF v_eliminated_missing_time > 0
     OR v_eliminated_canonical_mismatches > 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'prior_eliminated_standings_are_not_canonical',
      'eliminated_without_time', v_eliminated_missing_time,
      'canonical_mismatches', v_eliminated_canonical_mismatches,
      'rule', 'earliest eliminated_at then id receives the largest position',
      'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF v_total_chips <= 0 OR EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status = 'playing' AND tp.eliminated_at IS NULL
       AND COALESCE(tp.chips, 0) <= 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'live_chip_totals_are_invalid',
                              'total_chips', v_total_chips, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;

  /* "Final table" means one physical occupied table and an exact seat set,
     not merely a live headcount below table_size. Include live-seat residue
     on paused/closed tables in the all-seat count so stale merge residue also
     fails closed. Null-user seats, duplicate seats, eliminated seats, missing
     live players and split tables each make at least one equality fail. */
  SELECT count(DISTINCT tb.id) FILTER (
           WHERE tb.status::text IN ('running', 'waiting') AND ts.id IS NOT NULL),
         count(ts.id),
         count(ts.id) FILTER (
           WHERE tb.status::text IN ('running', 'waiting')),
         count(DISTINCT ts.user_id),
         count(DISTINCT ts.user_id) FILTER (
           WHERE EXISTS (
             SELECT 1
               FROM public.tournament_players live
              WHERE live.tournament_id = p_tournament_id
                AND live.user_id = ts.user_id
                AND live.status = 'playing'
                AND live.eliminated_at IS NULL
           ))
    INTO v_seated_active_tables, v_all_live_seats, v_active_live_seats,
         v_distinct_seat_users, v_matching_live_users
    FROM public.tables tb
    LEFT JOIN public.table_seats ts
      ON ts.table_id = tb.id AND ts.left_at IS NULL
   WHERE tb.tournament_id = p_tournament_id;

  SELECT tb.id INTO v_deal_table_id
    FROM public.tables tb
   WHERE tb.tournament_id = p_tournament_id
     AND tb.status::text IN ('running', 'waiting')
     AND EXISTS (
       SELECT 1 FROM public.table_seats ts
        WHERE ts.table_id = tb.id AND ts.left_at IS NULL
     )
   ORDER BY tb.id
   LIMIT 1;

  IF v_seated_active_tables <> 1 OR v_deal_table_id IS NULL
     OR v_all_live_seats <> v_live_count
     OR v_active_live_seats <> v_live_count
     OR v_distinct_seat_users <> v_live_count
     OR v_matching_live_users <> v_live_count THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'physical_final_table_seat_set_is_not_exact',
      'players', v_live_count, 'deal_table_id', v_deal_table_id,
      'seated_active_tables', v_seated_active_tables,
      'all_live_seats', v_all_live_seats,
      'active_live_seats', v_active_live_seats,
      'distinct_seat_users', v_distinct_seat_users,
      'matching_live_users', v_matching_live_users,
      'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  SELECT count(*) FILTER (WHERE tp.registered_at IS NULL),
         count(*) FILTER (WHERE ts.stack IS DISTINCT FROM tp.chips),
         COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', tp.id,
           'user_id', tp.user_id,
           'chips', tp.chips,
           'registered_at_utc', to_char(
             tp.registered_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US'),
           'rebuys', COALESCE(tp.rebuys, 0),
           'add_on', COALESCE(tp.add_on, false),
           'seat_id', ts.id,
           'table_id', tb.id,
           'seat_stack', ts.stack)
           ORDER BY tp.chips DESC, tp.registered_at ASC, tp.user_id ASC),
           '[]'::jsonb)
    INTO v_live_missing_registration, v_seat_stack_mismatches,
         v_live_input_snapshot
    FROM public.tournament_players tp
    JOIN public.table_seats ts
      ON ts.user_id = tp.user_id AND ts.left_at IS NULL
    JOIN public.tables tb
      ON tb.id = ts.table_id AND tb.id = v_deal_table_id
   WHERE tp.tournament_id = p_tournament_id
     AND tp.status = 'playing' AND tp.eliminated_at IS NULL;

  IF jsonb_array_length(v_live_input_snapshot) <> v_live_count
     OR v_live_missing_registration > 0
     OR v_seat_stack_mismatches > 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'live_deal_inputs_do_not_match_seat_stacks',
      'players', v_live_count,
      'snapshot_rows', jsonb_array_length(v_live_input_snapshot),
      'missing_registered_at', v_live_missing_registration,
      'seat_stack_mismatches', v_seat_stack_mismatches,
      'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  v_live_input_fingerprint := md5(v_live_input_snapshot::text);

  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status = 'playing' AND tp.eliminated_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.tournament_deal_votes v
          WHERE v.tournament_id = p_tournament_id AND v.user_id = tp.user_id
       )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deal_vote_is_not_unanimous',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  v_pool_cents := round(v_t.prize_pool * 100)::bigint;
  IF v_pool_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_prize_pool_to_deal',
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  BEGIN
    IF lower(COALESCE(v_t.variant, '')) = 'spin'
       OR upper(COALESCE(v_t.tournament_type, '')) = 'SPIN' THEN
      IF v_t.spin_multiplier IS NULL OR v_t.spin_multiplier <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'spin_multiplier_is_not_persisted',
                                  'paid', 0, 'completed', false, 'retryable', false);
      END IF;
      SELECT l.structure INTO v_struct
        FROM public.spin_payout_ladder l
       WHERE l.multiplier = v_t.spin_multiplier;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false,
                                  'reason', 'spin_multiplier_has_no_canonical_ladder',
                                  'spin_multiplier', v_t.spin_multiplier,
                                  'paid', 0, 'completed', false, 'retryable', false);
      END IF;
    ELSE
      v_struct := public.fn_safe_jsonb_array(v_t.payout_structure);
    END IF;

    IF jsonb_array_length(v_struct) = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_struct) e
       WHERE jsonb_typeof(e) <> 'object'
          OR COALESCE(e->>'place', '') !~ '^[1-9][0-9]*$'
          OR COALESCE(e->>'percentage', '') !~ '^[0-9]+([.][0-9]+)?$'
          OR (e->>'percentage')::numeric < 0
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payout_structure_is_invalid',
                                'paid', 0, 'completed', false, 'retryable', false);
    END IF;

    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'place')::integer), '[]'::jsonb)
      INTO v_trimmed
      FROM jsonb_array_elements(v_struct) e
     WHERE (e->>'place')::integer <= v_field_count;

    SELECT count(*), count(DISTINCT (e->>'place')::integer),
           COALESCE(min((e->>'place')::integer), 0),
           COALESCE(max((e->>'place')::integer), 0),
           COALESCE(sum(round((e->>'percentage')::numeric * 100)::bigint), 0)
      INTO v_structure_places, v_structure_distinct,
           v_structure_min, v_structure_max, v_total_bp
      FROM jsonb_array_elements(v_trimmed) e;

    IF v_structure_places = 0 OR v_structure_distinct <> v_structure_places
       OR v_structure_min <> 1 OR v_structure_max <> v_structure_places
       OR v_total_bp <= 0 THEN
      RETURN jsonb_build_object('ok', false,
                                'reason', 'payout_places_are_not_contiguous',
                                'places', v_structure_places,
                                'last_place', v_structure_max,
                                'paid', 0, 'completed', false, 'retryable', false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payout_structure_is_invalid',
                              'detail', SQLERRM, 'paid', 0,
                              'completed', false, 'retryable', false);
  END;

  v_remaining_cents := v_pool_cents;
  FOR r IN
    SELECT (e->>'place')::integer AS place,
           round((e->>'percentage')::numeric * 100)::bigint AS bp
      FROM jsonb_array_elements(v_trimmed) e
     ORDER BY (e->>'place')::integer
  LOOP
    IF r.place = v_structure_max THEN
      v_expected_cents := GREATEST(v_remaining_cents, 0);
    ELSE
      v_expected_cents := GREATEST(
        LEAST(v_remaining_cents,
              round(v_pool_cents * r.bp::numeric / v_total_bp)::bigint), 0);
    END IF;
    v_remaining_cents := v_remaining_cents - v_expected_cents;

    IF r.place > v_live_count THEN
      SELECT count(*), (array_agg(tp.user_id ORDER BY tp.id))[1]
        INTO v_holders, v_holder
        FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id AND tp.position = r.place;
      IF v_holders <> 1 OR v_holder IS NULL THEN
        RETURN jsonb_build_object('ok', false,
                                  'reason', 'earned_place_has_no_unique_holder',
                                  'place', r.place, 'holders', v_holders,
                                  'paid', 0, 'completed', false, 'retryable', false);
      END IF;
      v_place_plan := v_place_plan || jsonb_build_array(jsonb_build_object(
        'kind', 'place', 'place', r.place, 'user_id', v_holder,
        'cents', v_expected_cents, 'rank', NULL));
      v_place_total_cents := v_place_total_cents + v_expected_cents;
    END IF;
  END LOOP;

  IF v_remaining_cents <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'structure_does_not_allocate_pool',
                              'unallocated_cents', v_remaining_cents,
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  /* A positive result cache is an entitlement signal, never evidence that it
     was paid. A stale lower cache is safely promoted to the finalized
     structure below; a cache above or outside that structure would require a
     pricing decision or clawback, so the deal must leave it untouched and
     refuse for review. Live players cannot already hold a place prize. */
  SELECT count(*) INTO v_conflicts
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND round(COALESCE(tp.prize, 0) * 100)::bigint > 0
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_to_recordset(v_place_plan)
           AS x(kind text, place integer, user_id uuid, cents bigint, rank integer)
        WHERE x.place = tp.position AND x.user_id = tp.user_id
          AND round(COALESCE(tp.prize, 0) * 100)::bigint <= x.cents
     );
  IF v_conflicts > 0 THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'recorded_positive_prize_conflicts_with_deal_plan',
                              'rows', v_conflicts, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.tournament_obligations o
            WHERE o.tournament_id = p_tournament_id
              AND o.kind = 'bubble_protection'
         ), EXISTS (
           SELECT 1 FROM public.tournament_payouts p
            WHERE p.tournament_id = p_tournament_id
              AND p.source = 'bubble_protection'
         )
    INTO v_bubble_obligation_present, v_bubble_payout_present;
  v_bubble_shape_valid := v_t.buy_in_amount > 0
    AND v_structure_places > 0 AND v_field_count > v_structure_places;
  v_bubble_required := (v_t.bubble_protection AND v_bubble_shape_valid)
    OR v_bubble_obligation_present OR v_bubble_payout_present;

  IF v_bubble_required AND NOT v_bubble_shape_valid THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'bubble_protection_contract_shape_is_invalid',
      'buy_in_amount', v_t.buy_in_amount,
      'structure_places', v_structure_places, 'field_count', v_field_count,
      'bubble_obligation_present', v_bubble_obligation_present,
      'bubble_payout_present', v_bubble_payout_present,
      'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  IF v_bubble_required THEN
    /* A deal may be accepted before the natural bubble. In that case the final
       stone-bubble rank belongs to a still-live player and no persisted
       position exists yet. Derive that holder from the exact locked snapshot
       using the same ordering that builds and stamps the deal plan below. If
       the natural bubble already occurred, its durable eliminated position is
       the source of truth. */
    IF v_structure_places + 1 <= v_live_count THEN
      SELECT count(*), (array_agg(ranked.user_id ORDER BY ranked.rank))[1]
        INTO v_bubble_holders, v_bubble_user
        FROM (
          SELECT s.user_id,
                 row_number() OVER (
                   ORDER BY s.chips DESC, s.registered_at_utc ASC, s.user_id ASC
                 )::integer AS rank
            FROM jsonb_to_recordset(v_live_input_snapshot)
              AS s(player_id uuid, user_id uuid, chips numeric,
                   registered_at_utc text, rebuys integer, add_on boolean,
                   seat_id uuid, table_id uuid, seat_stack numeric)
        ) ranked
       WHERE ranked.rank = v_structure_places + 1;
    ELSE
      SELECT count(*), (array_agg(tp.user_id ORDER BY tp.id))[1]
        INTO v_bubble_holders, v_bubble_user
        FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.position = v_structure_places + 1;
    END IF;

    SELECT count(*),
           count(*) FILTER (WHERE o.user_id = v_bubble_user AND o.place IS NULL),
           COALESCE(max(o.amount_owed) FILTER (
             WHERE o.user_id = v_bubble_user AND o.place IS NULL), 0),
           COALESCE(max(o.amount_paid) FILTER (
             WHERE o.user_id = v_bubble_user AND o.place IS NULL), 0)
      INTO v_bubble_obligations, v_bubble_matching, v_bubble_owed, v_bubble_paid
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'bubble_protection';

    SELECT round(COALESCE(sum(p.amount), 0), 2)
      INTO v_bubble_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.user_id = v_bubble_user AND p.position IS NULL
       AND p.source = 'bubble_protection';

    SELECT count(*) INTO v_bubble_conflicts
      FROM (
        SELECT p.position, p.user_id
          FROM public.tournament_payouts p
         WHERE p.tournament_id = p_tournament_id
           AND p.source = 'bubble_protection'
           AND (p.position IS NOT NULL OR p.user_id IS DISTINCT FROM v_bubble_user)
         GROUP BY p.position, p.user_id
        HAVING abs(round(sum(p.amount), 2)) > 0.005
      ) unexpected_bubble;

    IF v_bubble_obligations = 0 AND NOT v_bubble_payout_present THEN
      v_bubble_obligation_id := gen_random_uuid();
      v_bubble_source := 'engine.atomicFinalTableDeal';
      v_bubble_owed := v_t.buy_in_amount;
      v_bubble_paid := 0;
      v_bubble_settled_at := NULL;
      v_bubble_needs_insert := true;
    ELSIF v_bubble_obligations = 1 AND v_bubble_matching = 1 THEN
      SELECT o.id, o.source, o.amount_owed, o.amount_paid, o.settled_at
        INTO v_bubble_obligation_id, v_bubble_source, v_bubble_owed,
             v_bubble_paid, v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_bubble_user
       FOR UPDATE;
    END IF;

    IF v_bubble_holders <> 1 OR v_bubble_user IS NULL
       OR (NOT v_bubble_needs_insert
           AND (v_bubble_obligations <> 1 OR v_bubble_matching <> 1))
       OR (v_bubble_needs_insert
           AND (v_bubble_obligations <> 0 OR v_bubble_payout_present))
       OR v_bubble_obligation_id IS NULL
       OR COALESCE(v_bubble_source, '') NOT IN ('engine.eliminatePlayer', 'engine.atomicFinalTableDeal')
       OR abs(v_bubble_owed - v_t.buy_in_amount) > 0.005
       OR v_bubble_paid < -0.005 OR v_bubble_paid > v_bubble_owed + 0.005
       OR abs(v_bubble_paid - v_bubble_evidence) > 0.005
       OR (v_bubble_paid + 0.005 >= v_bubble_owed
           AND v_bubble_settled_at IS NULL)
       OR (v_bubble_paid + 0.005 < v_bubble_owed
           AND v_bubble_settled_at IS NOT NULL)
       OR v_bubble_conflicts > 0 THEN
      RETURN jsonb_build_object('ok', false,
                                'reason', 'bubble_protection_obligation_is_not_exact',
                                'bubble_place', v_structure_places + 1,
                                'user_id', v_bubble_user,
                                'expected', v_t.buy_in_amount,
                                'amount_owed', v_bubble_owed,
                                'amount_paid', v_bubble_paid,
                                'payout_evidence', v_bubble_evidence,
                                'conflicts', v_bubble_conflicts,
                                'paid', 0, 'completed', false, 'retryable', false);
    END IF;
    v_bubble_unpaid_cents := round(
      GREATEST(v_bubble_owed - v_bubble_paid, 0) * 100)::bigint;
  END IF;

  FOR r IN
    SELECT (p->>'place')::integer AS place,
           (p->>'user_id')::uuid AS user_id,
           (p->>'cents')::bigint AS cents
      FROM jsonb_array_elements(v_place_plan) p
     ORDER BY (p->>'place')::integer
  LOOP
    SELECT round(COALESCE(sum(p.amount), 0), 2)
      INTO v_seeded_paid
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.position = r.place AND p.user_id = r.user_id
       AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                         'late_reg_adjustment', 'clawback', 'spin_backpay',
                         'overlay_backpay')
            OR EXISTS (
              SELECT 1 FROM public.tournament_obligations eo
               WHERE eo.tournament_id = p_tournament_id
                 AND eo.kind = 'place' AND eo.place = r.place
                 AND eo.user_id = r.user_id
                 AND p.idempotency_key LIKE
                   'tourney:' || p_tournament_id::text || ':obl:' ||
                   eo.id::text || ':%'
            ));

    SELECT count(*) INTO v_wrong_recipients
      FROM (
        SELECT p.user_id
          FROM public.tournament_payouts p
         WHERE p.tournament_id = p_tournament_id AND p.position = r.place
           AND p.user_id IS DISTINCT FROM r.user_id
           AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                             'late_reg_adjustment', 'clawback', 'spin_backpay',
                             'overlay_backpay')
                OR EXISTS (
                  SELECT 1 FROM public.tournament_obligations eo
                   WHERE eo.tournament_id = p_tournament_id
                     AND eo.kind = 'place' AND eo.place = p.position
                     AND eo.user_id = p.user_id
                     AND p.idempotency_key LIKE
                       'tourney:' || p_tournament_id::text || ':obl:' ||
                       eo.id::text || ':%'
                ))
         GROUP BY p.user_id
        HAVING abs(round(sum(p.amount), 2)) > 0.005
      ) wrong;

    SELECT * INTO v_existing
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place' AND o.place = r.place
     FOR UPDATE;

    IF v_wrong_recipients > 0 OR v_seeded_paid < -0.005
       OR v_seeded_paid > r.cents / 100.0 + 0.005
       OR (FOUND AND abs(round(v_existing.amount_paid, 2) - v_seeded_paid) > 0.005)
       OR (FOUND AND v_existing.amount_owed > r.cents / 100.0 + 0.005)
       OR (FOUND AND v_existing.amount_paid > 0
                    AND v_existing.user_id IS DISTINCT FROM r.user_id) THEN
      RETURN jsonb_build_object('ok', false,
                                'reason', 'earned_place_evidence_conflicts_with_plan',
                                'place', r.place, 'user_id', r.user_id,
                                'expected', r.cents / 100.0,
                                'payout_evidence', v_seeded_paid,
                                'wrong_recipients', v_wrong_recipients,
                                'paid', 0, 'completed', false, 'retryable', false);
    END IF;
    v_prior_place_paid_cents := v_prior_place_paid_cents
      + round(v_seeded_paid * 100)::bigint;
  END LOOP;

  SELECT count(*) INTO v_conflicts
    FROM (
      SELECT p.position, p.user_id
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.position IS NOT NULL
         AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                           'late_reg_adjustment', 'clawback', 'spin_backpay',
                           'overlay_backpay')
              OR EXISTS (
                SELECT 1 FROM public.tournament_obligations eo
                 WHERE eo.tournament_id = p_tournament_id
                   AND eo.kind = 'place' AND eo.place = p.position
                   AND eo.user_id = p.user_id
                   AND p.idempotency_key LIKE
                     'tourney:' || p_tournament_id::text || ':obl:' ||
                     eo.id::text || ':%'
              ))
       GROUP BY p.position, p.user_id
      HAVING abs(round(sum(p.amount), 2)) > 0.005
    ) evidence
   WHERE NOT EXISTS (
     SELECT 1 FROM jsonb_to_recordset(v_place_plan)
       AS x(kind text, place integer, user_id uuid, cents bigint, rank integer)
      WHERE x.place = evidence.position AND x.user_id = evidence.user_id
   );
  IF v_conflicts > 0 THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'paid_place_evidence_is_outside_deal_plan',
                              'rows', v_conflicts, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;

  SELECT count(*) INTO v_conflicts
    FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(v_place_plan)
         AS x(kind text, place integer, user_id uuid, cents bigint, rank integer)
        WHERE x.place = o.place AND x.user_id = o.user_id
     );
  IF v_conflicts > 0 THEN
    RETURN jsonb_build_object('ok', false,
                              'reason', 'place_obligation_is_outside_deal_plan',
                              'rows', v_conflicts, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;

  v_available_cents := v_pool_cents - v_place_total_cents;
  IF v_available_cents < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'earned_places_exceed_prize_pool',
                              'earned_place_cents', v_place_total_cents,
                              'pool_cents', v_pool_cents, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;

  SELECT sum(s.chips) INTO v_total_chips
    FROM jsonb_to_recordset(v_live_input_snapshot)
      AS s(player_id uuid, user_id uuid, chips numeric,
           registered_at_utc text, rebuys integer, add_on boolean,
           seat_id uuid, table_id uuid, seat_stack numeric);

  SELECT s.user_id INTO v_leader
    FROM jsonb_to_recordset(v_live_input_snapshot)
      AS s(player_id uuid, user_id uuid, chips numeric,
           registered_at_utc text, rebuys integer, add_on boolean,
           seat_id uuid, table_id uuid, seat_stack numeric)
   ORDER BY s.chips DESC, s.registered_at_utc ASC, s.user_id ASC
   LIMIT 1;

  FOR r IN
    SELECT s.user_id, s.chips
      FROM jsonb_to_recordset(v_live_input_snapshot)
        AS s(player_id uuid, user_id uuid, chips numeric,
             registered_at_utc text, rebuys integer, add_on boolean,
             seat_id uuid, table_id uuid, seat_stack numeric)
     ORDER BY s.chips DESC, s.registered_at_utc ASC, s.user_id ASC
  LOOP
    v_rank := v_rank + 1;
    v_share_cents := floor(r.chips / v_total_chips * v_available_cents)::bigint;
    v_floor_paid_cents := v_floor_paid_cents + v_share_cents;
    v_deal_shares := v_deal_shares || jsonb_build_array(jsonb_build_object(
      'user_id', r.user_id, 'cents', v_share_cents, 'rank', v_rank));
  END LOOP;
  v_remainder_cents := v_available_cents - v_floor_paid_cents;

  FOR r IN
    SELECT (p->>'user_id')::uuid AS user_id,
           (p->>'cents')::bigint AS cents,
           (p->>'rank')::integer AS rank
      FROM jsonb_array_elements(v_deal_shares) p
     ORDER BY (p->>'rank')::integer
  LOOP
    v_share_cents := r.cents
      + CASE WHEN r.user_id = v_leader THEN v_remainder_cents ELSE 0 END;
    v_deal_plan := v_deal_plan || jsonb_build_array(jsonb_build_object(
      'kind', 'final_table_deal', 'place', NULL, 'user_id', r.user_id,
      'cents', v_share_cents, 'rank', r.rank));
    v_deal_total_cents := v_deal_total_cents + v_share_cents;
    v_payouts := v_payouts || jsonb_build_array(jsonb_build_object(
      'user_id', r.user_id, 'amount', v_share_cents / 100.0, 'rank', r.rank));
  END LOOP;

  IF v_place_total_cents + v_deal_total_cents <> v_pool_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deal_plan_does_not_allocate_pool',
                              'places', v_place_total_cents / 100.0,
                              'deal', v_deal_total_cents / 100.0,
                              'pool', v_pool_cents / 100.0, 'paid', 0,
                              'completed', false, 'retryable', false);
  END IF;

  /* A finalized number is not money. Lock the enforced escrow row and prove
     it holds every cent this transaction still needs to move. A manually
     inflated prize_pool/prize_pool_finalized pair therefore cannot authorize
     a deal. Prior place payments backed by exact payout evidence are the only
  subtraction from the required cash. */
  v_unpaid_cents := v_pool_cents - v_prior_place_paid_cents;
  v_total_unpaid_cents := v_unpaid_cents + v_bubble_unpaid_cents;
  SELECT * INTO v_escrow
    FROM public.tournament_escrow e
   WHERE e.tournament_id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_escrow.enforced THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'enforced_escrow_is_required',
                              'required', v_total_unpaid_cents / 100.0,
                              'place_and_deal_required', v_unpaid_cents / 100.0,
                              'bubble_required', v_bubble_unpaid_cents / 100.0,
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;
  IF round(v_escrow.prize_balance * 100)::bigint < v_total_unpaid_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'escrow_cannot_fund_atomic_deal',
                              'required', v_total_unpaid_cents / 100.0,
                              'place_and_deal_required', v_unpaid_cents / 100.0,
                              'bubble_required', v_bubble_unpaid_cents / 100.0,
                              'escrow_prize_balance', v_escrow.prize_balance,
                              'paid', 0, 'completed', false, 'retryable', false);
  END IF;

  v_plan := v_place_plan || v_deal_plan;
  v_plan_fingerprint := md5(jsonb_build_object(
    'bubble_contract_required', v_bubble_required,
    'bubble_obligation_id', v_bubble_obligation_id,
    'bubble_user_id', v_bubble_user,
    'bubble_source', v_bubble_source,
    'bubble_amount_owed', round(COALESCE(v_bubble_owed, 0) * 100)::bigint,
    'bubble_amount_paid_before', round(COALESCE(v_bubble_paid, 0) * 100)::bigint,
    'deal_table_id', v_deal_table_id,
    'live_input_fingerprint', v_live_input_fingerprint,
    'prior_standings_fingerprint', v_prior_standings_fingerprint,
    'plan', v_plan)::text);

  BEGIN
    /* The format-owned transaction claims its terminal work before moving
       any money. This is intentionally inside the exception subtransaction:
       any failed prize, bounty or rake leg restores RUNNING together with
       every balance. It also gives the rake contract the terminal-in-progress
       status it requires without an application-side status writer. */
    PERFORM set_config('app.atomic_final_table_deal_batch', p_tournament_id::text, true);
    UPDATE public.tournaments
       SET status = 'COMPLETING', updated_at = now()
     WHERE id = p_tournament_id AND status = 'RUNNING';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'RUNNING claim was lost before deal settlement',
                            ERRCODE = '40001';
    END IF;

    IF v_bubble_needs_insert THEN
      INSERT INTO public.tournament_obligations
        (id, tournament_id, kind, place, user_id, amount_owed, amount_paid,
         source, settled_at)
      VALUES
        (v_bubble_obligation_id, p_tournament_id, 'bubble_protection', NULL,
         v_bubble_user, v_bubble_owed, 0, v_bubble_source, NULL);
    END IF;

    FOR r IN
      SELECT (p->>'place')::integer AS place,
             (p->>'user_id')::uuid AS user_id,
             (p->>'cents')::bigint AS cents
        FROM jsonb_array_elements(v_place_plan) p
       ORDER BY (p->>'place')::integer
    LOOP
      SELECT round(COALESCE(sum(p.amount), 0), 2)
        INTO v_seeded_paid
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.position = r.place AND p.user_id = r.user_id
         AND (p.source IN ('structure', 'reconcile', 'hu_shortfall',
                           'late_reg_adjustment', 'clawback', 'spin_backpay',
                           'overlay_backpay')
              OR EXISTS (
                SELECT 1 FROM public.tournament_obligations eo
                 WHERE eo.tournament_id = p_tournament_id
                   AND eo.kind = 'place' AND eo.place = r.place
                   AND eo.user_id = r.user_id
                   AND p.idempotency_key LIKE
                     'tourney:' || p_tournament_id::text || ':obl:' ||
                     eo.id::text || ':%'
              ));

      INSERT INTO public.tournament_obligations
        (tournament_id, kind, place, user_id, amount_owed, amount_paid,
         source, settled_at)
      VALUES
        (p_tournament_id, 'place', r.place, r.user_id, r.cents / 100.0,
         v_seeded_paid, 'engine.atomicFinalTableDeal',
         CASE WHEN v_seeded_paid + 0.005 >= r.cents / 100.0 THEN now() ELSE NULL END)
      ON CONFLICT (tournament_id, kind, place) WHERE place IS NOT NULL
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        amount_owed = EXCLUDED.amount_owed,
        amount_paid = EXCLUDED.amount_paid,
        source = EXCLUDED.source,
        updated_at = now(),
        settled_at = EXCLUDED.settled_at;
    END LOOP;

    FOR r IN
      SELECT (p->>'user_id')::uuid AS user_id,
             (p->>'cents')::bigint AS cents,
             (p->>'rank')::integer AS rank
        FROM jsonb_array_elements(v_deal_plan) p
       ORDER BY (p->>'rank')::integer
    LOOP
      INSERT INTO public.tournament_obligations
        (tournament_id, kind, place, user_id, amount_owed, amount_paid,
         source, settled_at)
      VALUES
        (p_tournament_id, 'final_table_deal', NULL, r.user_id,
         r.cents / 100.0, 0, 'engine.atomicFinalTableDeal',
         CASE WHEN r.cents = 0 THEN now() ELSE NULL END);
    END LOOP;

    UPDATE public.tournament_players tp
       SET prize = COALESCE((
             SELECT sum(x.cents) / 100.0
               FROM jsonb_to_recordset(v_plan)
                 AS x(kind text, place integer, user_id uuid, cents bigint, rank integer)
              WHERE x.user_id = tp.user_id
           ), 0)
     WHERE tp.tournament_id = p_tournament_id;

    FOR r IN
      SELECT (p->>'user_id')::uuid AS user_id,
             (p->>'rank')::integer AS rank
        FROM jsonb_array_elements(v_deal_plan) p
       ORDER BY (p->>'rank')::integer
    LOOP
      UPDATE public.tournament_players
         SET position = r.rank,
             status = CASE WHEN r.rank = 1 THEN 'winner' ELSE 'eliminated' END,
             eliminated_at = CASE
               WHEN r.rank = 1 THEN NULL
               ELSE COALESCE(eliminated_at, clock_timestamp())
             END
       WHERE tournament_id = p_tournament_id AND user_id = r.user_id
         AND status = 'playing' AND eliminated_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = format(
          'live deal player %s changed before standings were stamped', r.user_id),
          ERRCODE = '40001';
      END IF;
    END LOOP;

    /* Stamping precedes the immutable batch inside this same subtransaction.
       The result-freeze trigger recognizes the batch immediately after this
       insert, without blocking the settler's own legitimate stamps above. */
    INSERT INTO public.tournament_final_table_deal_batches
      (tournament_id, plan_fingerprint, plan, prior_standings_fingerprint,
       live_input_snapshot, live_input_fingerprint,
       field_count, live_count, structure_place_count, place_line_count,
       deal_line_count, place_amount, deal_amount, amount_owed, amount_moved,
       escrow_prize_before, escrow_prize_after, deal_table_id,
       bubble_contract_required, bubble_obligation_id, bubble_user_id,
       bubble_source, bubble_amount_owed, bubble_amount_paid_before,
       chip_leader, source)
    VALUES
      (p_tournament_id, v_plan_fingerprint, v_plan,
       v_prior_standings_fingerprint, v_live_input_snapshot,
       v_live_input_fingerprint, v_field_count, v_live_count,
       v_structure_places, jsonb_array_length(v_place_plan),
       jsonb_array_length(v_deal_plan), v_place_total_cents / 100.0,
       v_deal_total_cents / 100.0, v_pool_cents / 100.0,
       v_total_unpaid_cents / 100.0, v_escrow.prize_balance, NULL, v_deal_table_id,
       v_bubble_required, v_bubble_obligation_id, v_bubble_user,
       v_bubble_source, v_bubble_owed, v_bubble_paid,
       v_leader, 'engine.atomicFinalTableDeal');

    IF v_bubble_required AND v_bubble_unpaid_cents > 0 THEN
      v_result := public.fn_settle_tournament_obligation_before_atomic_batch_gate(
        p_tournament_id, 'bubble_protection', NULL, v_bubble_user,
        v_bubble_owed, v_bubble_source,
        'Bubble protection: buy-in returned to the stone bubble', NULL);
      IF NOT COALESCE((v_result->>'ok')::boolean, false)
         OR NULLIF(v_result->>'obligation_id', '')::uuid
            IS DISTINCT FROM v_bubble_obligation_id THEN
        RAISE EXCEPTION USING MESSAGE = format(
          'atomic final-table-deal Bubble leg refused: %s',
          COALESCE(v_result->>'refused_reason', 'wrong obligation')),
          ERRCODE = '23514';
      END IF;

      SELECT o.amount_paid, o.source, o.amount_owed, o.settled_at
        INTO v_after_bubble_paid, v_bubble_source, v_bubble_owed,
             v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.id = v_bubble_obligation_id
         AND o.tournament_id = p_tournament_id
         AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_bubble_user;
      IF NOT FOUND
         OR COALESCE(v_bubble_source, '') NOT IN ('engine.eliminatePlayer', 'engine.atomicFinalTableDeal')
         OR v_after_bubble_paid + 0.005 < v_bubble_owed
         OR v_bubble_settled_at IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = format(
          'atomic final-table-deal Bubble leg only reached %s of %s',
          COALESCE(v_after_bubble_paid, 0), v_bubble_owed),
          ERRCODE = '23514';
      END IF;
      v_bubble_paid_this_call := round(
        COALESCE((v_result->>'paid')::numeric, 0), 2);
      v_paid_this_call := v_paid_this_call + v_bubble_paid_this_call;
    END IF;

    FOR r IN
      SELECT x.kind, x.place, x.user_id, x.cents, x.rank
        FROM jsonb_to_recordset(v_plan)
          AS x(kind text, place integer, user_id uuid, cents bigint, rank integer)
       ORDER BY CASE WHEN x.kind = 'place' THEN 0 ELSE 1 END,
                x.place NULLS LAST, x.rank NULLS LAST
    LOOP
      v_result := public.fn_settle_tournament_obligation_before_atomic_batch_gate(
        p_tournament_id, r.kind, r.place, r.user_id, r.cents / 100.0,
        'engine.atomicFinalTableDeal',
        CASE WHEN r.kind = 'place'
             THEN format('Tournament prize: position %s', r.place)
             ELSE 'Final table deal (chip-proportional chop)' END);
      IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
        RAISE EXCEPTION USING MESSAGE = format(
          'atomic final-table-deal leg refused for %s/%s/%s: %s',
          r.kind, COALESCE(r.place::text, '-'), r.user_id,
          COALESCE(v_result->>'refused_reason', 'unknown')),
          ERRCODE = '23514';
      END IF;

      SELECT o.amount_paid INTO v_after_paid
        FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id AND o.kind = r.kind
         AND o.user_id = r.user_id
         AND ((r.kind = 'place' AND o.place = r.place)
              OR (r.kind = 'final_table_deal' AND o.place IS NULL));
      IF NOT FOUND OR abs(round(v_after_paid, 2) - r.cents / 100.0) > 0.005 THEN
        RAISE EXCEPTION USING MESSAGE = format(
          'atomic final-table-deal leg partially settled for %s/%s/%s: expected %s, stored %s',
          r.kind, COALESCE(r.place::text, '-'), r.user_id,
          r.cents / 100.0, COALESCE(v_after_paid, 0)),
          ERRCODE = '23514';
      END IF;

      v_paid_this_call := v_paid_this_call
        + round(COALESCE((v_result->>'paid')::numeric, 0), 2);
      IF r.kind = 'place' THEN
        v_place_paid_this_call := v_place_paid_this_call
          + round(COALESCE((v_result->>'paid')::numeric, 0), 2);
      ELSE
        v_deal_paid_this_call := v_deal_paid_this_call
          + round(COALESCE((v_result->>'paid')::numeric, 0), 2);
      END IF;
    END LOOP;

    IF v_bubble_required THEN
      SELECT o.amount_paid, o.source, o.amount_owed, o.settled_at
        INTO v_after_bubble_paid, v_bubble_source, v_bubble_owed,
             v_bubble_settled_at
        FROM public.tournament_obligations o
       WHERE o.id = v_bubble_obligation_id
         AND o.tournament_id = p_tournament_id
         AND o.kind = 'bubble_protection'
         AND o.place IS NULL AND o.user_id = v_bubble_user;
      v_bubble_row_found := FOUND;
      SELECT round(COALESCE(sum(p.amount), 0), 2)
        INTO v_bubble_evidence
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.user_id = v_bubble_user
         AND p.position IS NULL AND p.source = 'bubble_protection';
      IF NOT v_bubble_row_found
         OR COALESCE(v_bubble_source, '') NOT IN ('engine.eliminatePlayer', 'engine.atomicFinalTableDeal')
         OR v_after_bubble_paid + 0.005 < v_bubble_owed
         OR v_bubble_settled_at IS NULL
         OR abs(v_after_bubble_paid - v_bubble_evidence) > 0.005 THEN
        RAISE EXCEPTION USING MESSAGE =
          'Bubble Protection is not fully settled with exact payout evidence',
          ERRCODE = '23514';
      END IF;
    END IF;

    IF abs(v_paid_this_call - v_total_unpaid_cents / 100.0) > 0.005 THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'atomic final-table-deal payment total was incomplete: expected %s, moved %s',
        v_total_unpaid_cents / 100.0, v_paid_this_call),
        ERRCODE = '23514';
    END IF;

    SELECT round(e.prize_balance, 2) INTO v_escrow_after
      FROM public.tournament_escrow e
     WHERE e.tournament_id = p_tournament_id
     FOR UPDATE;
    IF NOT FOUND
       OR abs(v_escrow.prize_balance - v_paid_this_call - v_escrow_after) > 0.005 THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'escrow did not debit with the atomic deal: before %s, moved %s, after %s',
        v_escrow.prize_balance, v_paid_this_call, COALESCE(v_escrow_after, 0)),
        ERRCODE = '23514';
    END IF;

    UPDATE public.tournament_final_table_deal_batches
       SET settled_at = COALESCE(settled_at, now()),
           escrow_prize_after = v_escrow_after
     WHERE tournament_id = p_tournament_id
       AND plan_fingerprint = v_plan_fingerprint;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'the final-table-deal batch changed before completion',
                            ERRCODE = '40001';
    END IF;

    v_check := public.fn_check_atomic_final_table_deal(p_tournament_id);
    IF NOT COALESCE((v_check->>'ok')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'atomic final-table-deal verification refused completion: %s', v_check::text),
        ERRCODE = '23514';
    END IF;

    /* Completion certification requires every financial domain, so the deal
       transaction owns those terminal legs too. Calling the existing guarded
       functions here keeps their immutable receipts and rolls their wallet
       effects back if any later readiness proof fails. */
    IF v_t.is_bounty OR v_t.is_pko OR v_t.is_mystery_bounty THEN
      IF public.fn_tournament_has_unsettled_bounties(p_tournament_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'pending bounty obligations block final-table deal completion',
                              ERRCODE = '23514';
      END IF;
      IF v_t.is_mystery_bounty AND v_t.mystery_bounty_stage <> 'pending' THEN
        v_result := public.fn_mystery_bounty_settle(p_tournament_id, v_leader);
        IF NOT COALESCE((v_result->>'ok')::boolean, false)
           OR NOT COALESCE((v_result->>'balanced')::boolean, false) THEN
          RAISE EXCEPTION USING MESSAGE = format(
            'atomic final-table-deal mystery bounty leg refused: %s', v_result::text),
                                ERRCODE = '23514';
        END IF;
      END IF;
      v_result := public.fn_finalize_bounty_pool(p_tournament_id, v_leader);
      IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
        RAISE EXCEPTION USING MESSAGE = format(
          'atomic final-table-deal bounty pool leg refused: %s', v_result::text),
                              ERRCODE = '23514';
      END IF;
    END IF;

    v_result := public.fn_settle_tournament_rake(
      p_tournament_id, 'engine.atomicFinalTableDeal');
    IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'atomic final-table-deal rake leg refused: %s', v_result::text),
                            ERRCODE = '23514';
    END IF;

    UPDATE public.tournaments
       SET status = 'COMPLETED', ended_at = COALESCE(ended_at, clock_timestamp()),
           on_break = false, break_ends_at = NULL, updated_at = now()
     WHERE id = p_tournament_id AND status = 'COMPLETING';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'RUNNING claim was lost before deal completion',
                            ERRCODE = '40001';
    END IF;

    /* A committed deal includes its physical table shutdown. The status
       transition releases seats through the database triggers; any failure to
       close or prove the terminal table state aborts every deal payment too. */
    UPDATE public.tables
       SET status = 'closed', current_players = 0
     WHERE tournament_id = p_tournament_id
       AND (status IS DISTINCT FROM 'closed' OR current_players IS DISTINCT FROM 0);
    IF EXISTS (
         SELECT 1 FROM public.tables
          WHERE tournament_id = p_tournament_id
            AND (status IS DISTINCT FROM 'closed' OR current_players IS DISTINCT FROM 0)
       ) OR EXISTS (
         SELECT 1
           FROM public.table_seats s
           JOIN public.tables tb ON tb.id = s.table_id
          WHERE tb.tournament_id = p_tournament_id AND s.left_at IS NULL
       ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'completed final-table deal retained a nonterminal table or live seat',
        ERRCODE = '23514';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_failure = MESSAGE_TEXT,
                            v_failure_state = RETURNED_SQLSTATE;
  END;

  PERFORM set_config('app.atomic_final_table_deal_batch', '', true);

  IF v_failure IS NOT NULL THEN
    BEGIN
      PERFORM public.fn_raise_server_financial_alert(
        'critical', 'fn_settle_final_table_deal_atomic',
        format('Atomic final-table deal aborted for %s: %s',
               COALESCE(v_t.name, p_tournament_id::text), v_failure),
        jsonb_build_object('tournament_id', p_tournament_id,
                           'sqlstate', v_failure_state,
                           'reason', v_failure,
                           'field_count', v_field_count,
                           'live_count', v_live_count,
                           'place_amount', v_place_total_cents / 100.0,
                           'deal_amount', v_deal_total_cents / 100.0),
        'atomic-final-table-deal:' || p_tournament_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'atomic_deal_aborted', 'detail', v_failure,
      'sqlstate', v_failure_state, 'paid', 0, 'completed', false,
      'retryable', v_failure_state IN ('40001', '40P01', '55P03'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'paid', round(v_paid_this_call, 2),
    'place_paid', round(v_place_paid_this_call, 2),
    'deal_paid', round(v_deal_paid_this_call, 2),
    'bubble_paid', round(v_bubble_paid_this_call, 2),
    'completed', true, 'already_completed', false,
    'players', v_live_count, 'chip_leader', v_leader,
    'deal_table_id', v_deal_table_id,
    'bubble_contract_required', v_bubble_required,
    'bubble_obligation_id', v_bubble_obligation_id,
    'place_amount', v_place_total_cents / 100.0,
    'deal_amount', v_deal_total_cents / 100.0,
    'payouts', v_payouts, 'retryable', false,
    'record', 'tournament_final_table_deal_batches');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_settle_tournament_final_table_deal(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_t record;
  v_status text;
  v_table_size integer;
  v_field_size integer;
  v_live_count integer;
  v_live_table_count integer;
  v_live_seat_count integer;
  v_live_seated_users integer;
  v_vote_count integer;
  v_total_chips numeric;
  v_pool_cents bigint;
  v_prior_paid_cents bigint;
  v_fixed_entitlement_cents bigint := 0;
  v_fixed_paid_cents bigint := 0;
  v_fixed_shortfall_cents bigint := 0;
  v_fixed_count integer := 0;
  v_ladder_max_place integer;
  v_bubble_place integer;
  v_bubble_user_id uuid;
  v_bubble_amount numeric(15,2) := 0;
  v_bubble_entitlement_cents bigint := 0;
  v_bubble_paid_cents bigint := 0;
  v_bubble_shortfall_cents bigint := 0;
  v_bubble_obligation_count integer := 0;
  v_bubble_candidate_count integer := 0;
  v_has_bubble boolean := false;
  v_bubble_obligation_source text :=
    'engine.fn_settle_tournament_bubble_protection';
  v_undistributed_cents bigint;
  v_distributed_cents bigint := 0;
  v_remainder_cents bigint;
  v_share_cents bigint;
  v_amount numeric(15,2);
  v_rank integer := 0;
  v_rows integer;
  v_now timestamptz := now();
  v_leader uuid;
  v_result jsonb;
  v_guarantee_result jsonb;
  v_ladder jsonb := '[]'::jsonb;
  v_fixed jsonb := '[]'::jsonb;
  v_shares jsonb := '[]'::jsonb;
  v_payouts jsonb := '[]'::jsonb;
  v_winner_amount numeric(15,2) := 0;
  v_row record;
  v_ob public.tournament_obligations%ROWTYPE;
  v_evidence numeric;
  v_evidence_count integer;
  v_modern_batch public.tournament_final_table_deal_batches%ROWTYPE;
  v_modern_input jsonb;
  v_modern_tail jsonb;
  v_modern_plan jsonb;
  v_modern_table uuid;
  v_modern_escrow_before numeric;
  v_modern_required numeric;
  v_modern_claim jsonb;
  v_not_pool text[] := ARRAY[
    'satellite_seat','bounty','mystery_bounty','bounty_residual',
    'own_bounty','mystery_bounty_residual'
  ];
BEGIN
  -- Share the same first lock as the whole-event terminal authority. Re-entry
  -- from that authority is transaction-local and immediate.
  PERFORM public.fn_ca_lock_settlement_lane_global();
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'final-table deal requires a tournament id'
      USING ERRCODE = '22004';
  END IF;

  -- Canonical money lock order: tournament, authoritative guarantee-funding
  -- bank, complete roster, complete obligation set. Every validation and every
  -- amount derivation follows it.
  SELECT t.id, t.status, t.prize_pool, t.final_table_deal_enabled,
         t.table_size, t.variant, t.tournament_type, t.satellite_target_id,
         t.satellite_target, t.bubble_protection, t.buy_in_amount,
         t.guaranteed_prize, t.prize_pool_finalized
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % does not exist', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;

  v_status := upper(COALESCE(v_t.status::text, ''));
  IF v_status NOT IN ('RUNNING','COMPLETING','COMPLETED') THEN
    RAISE EXCEPTION 'tournament % cannot execute or replay a deal from status %',
      p_tournament_id, v_t.status USING ERRCODE = '55000';
  END IF;
  IF lower(COALESCE(v_t.variant::text, '')) = 'satellite'
     OR upper(COALESCE(v_t.tournament_type::text, '')) = 'SATELLITE'
     OR v_t.satellite_target_id IS NOT NULL
     OR v_t.satellite_target IS NOT NULL THEN
    RAISE EXCEPTION 'tournament % is a satellite, not a cash final-table deal',
      p_tournament_id USING ERRCODE = '22023';
  END IF;

  -- Replay a certified v2 batch without changing even transient money/cache state.
  SELECT * INTO v_modern_batch FROM public.tournament_final_table_deal_batches
   WHERE tournament_id=p_tournament_id FOR UPDATE;
  IF FOUND AND v_modern_batch.contract_version=2 THEN
    IF v_status NOT IN ('COMPLETING','COMPLETED') THEN
      RAISE EXCEPTION 'canonical final deal batch has no claimed lifecycle';
    END IF;
    PERFORM public.fn_ca_verify_terminal_final_deal_batch(
      p_tournament_id,v_status='COMPLETED');
    IF NOT EXISTS(SELECT 1 FROM public.tournament_finish_receipts f
      WHERE f.tournament_id=p_tournament_id AND f.finish_kind='final_table_deal'
       AND f.winner_user_id=v_modern_batch.chip_leader
       AND (v_status<>'COMPLETED' OR f.certified_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'canonical final deal replay has no matching finish receipt';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('place',(x->>'place')::integer,
      'user_id',(x->>'user_id')::uuid,'amount',(x->>'cents')::numeric/100)
      ORDER BY (x->>'place')::integer),
      max((x->>'cents')::numeric/100) FILTER(WHERE (x->>'place')::integer=1)
      INTO v_payouts,v_winner_amount FROM jsonb_array_elements(v_modern_batch.plan) x
      WHERE x->>'kind'='final_table_deal';
    RETURN jsonb_build_object('ok',true,'fully_settled',true,'status',v_status,
      'payouts',v_payouts,'winner_amount',v_winner_amount,
      'money_path','fn_settle_tournament_final_table_deal');
  ELSIF FOUND AND v_status='RUNNING' THEN
    RAISE EXCEPTION 'prepared historical deal requires its original authority';
  END IF;

  -- The chop and any guarantee overlay are one commit. A process-side funding
  -- request can improve the live preview, but it is never settlement evidence:
  -- this locked authority funds again idempotently and proves the refreshed
  -- pool before it derives fixed places or a single deal share.
  IF v_t.prize_pool IS NULL
     OR v_t.prize_pool::text IN ('NaN','Infinity','-Infinity')
     OR v_t.prize_pool < 0
     OR v_t.prize_pool IS DISTINCT FROM round(v_t.prize_pool, 2) THEN
    RAISE EXCEPTION 'tournament % has invalid whole-cent prize pool %',
      p_tournament_id, v_t.prize_pool USING ERRCODE = '22003';
  END IF;
  IF v_t.guaranteed_prize IS NOT NULL
     AND (v_t.guaranteed_prize::text IN ('NaN','Infinity','-Infinity')
       OR v_t.guaranteed_prize < 0
       OR v_t.guaranteed_prize IS DISTINCT FROM round(v_t.guaranteed_prize, 2)) THEN
    RAISE EXCEPTION 'tournament % has invalid whole-cent guarantee %',
      p_tournament_id, v_t.guaranteed_prize USING ERRCODE = '22003';
  END IF;
  v_guarantee_result := public.fn_apply_prize_guarantee(
    p_tournament_id, 'engine.fn_settle_tournament_final_table_deal');
  IF COALESCE((v_guarantee_result->>'ok')::boolean, false) IS NOT TRUE
     OR (COALESCE((v_guarantee_result->>'overlay')::numeric,0) > 0
         AND COALESCE(
           (v_guarantee_result->>'overlay_journaled')::boolean,false)
             IS NOT TRUE) THEN
    RAISE EXCEPTION 'tournament % guarantee funding refused before deal: %',
      p_tournament_id, v_guarantee_result USING ERRCODE = 'P0404';
  END IF;

  SELECT t.id, t.status, t.prize_pool, t.final_table_deal_enabled,
         t.table_size, t.variant, t.tournament_type, t.satellite_target_id,
         t.satellite_target, t.bubble_protection, t.buy_in_amount,
         t.guaranteed_prize, t.prize_pool_finalized
    INTO v_t
    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF COALESCE(v_t.prize_pool_finalized, false) IS NOT TRUE
     OR v_t.prize_pool IS NULL
     OR v_t.prize_pool::text IN ('NaN','Infinity','-Infinity')
     OR v_t.prize_pool IS DISTINCT FROM round(v_t.prize_pool, 2)
     OR v_t.prize_pool < COALESCE(v_t.guaranteed_prize, 0)
     OR v_guarantee_result->>'prize_pool' IS NULL
     OR (v_guarantee_result->>'prize_pool')::numeric IS DISTINCT FROM v_t.prize_pool THEN
    RAISE EXCEPTION
      'tournament % guarantee funding did not produce one finalized locked deal pool: result %, pool %, guarantee %, finalized %',
      p_tournament_id, v_guarantee_result, v_t.prize_pool,
      v_t.guaranteed_prize, v_t.prize_pool_finalized USING ERRCODE = 'P0404';
  END IF;

  PERFORM 1
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
   ORDER BY tp.id
   FOR UPDATE;

  PERFORM 1
    FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id
   ORDER BY o.kind, o.place NULLS LAST, o.id
   FOR UPDATE;

  -- Evidence rows are append-only. Canonical payers hold the tournament lock;
  -- row locks additionally keep an existing receipt stable while it is proved.
  PERFORM 1
    FROM public.tournament_payouts p
   WHERE p.tournament_id = p_tournament_id
   ORDER BY p.id
   FOR SHARE;

  IF v_t.table_size IS NULL OR v_t.table_size < 2 OR v_t.table_size > 10 THEN
    RAISE EXCEPTION 'tournament % has invalid final-table size %',
      p_tournament_id, v_t.table_size USING ERRCODE = '23514';
  END IF;
  v_table_size := v_t.table_size;

  SELECT count(*) INTO v_field_size
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;
  IF v_field_size < 2 THEN
    RAISE EXCEPTION 'tournament % has fewer than two roster rows', p_tournament_id
      USING ERRCODE = '23514';
  END IF;

  -- Every payout row that consumes the prize pool must be finite, nonnegative,
  -- whole-cent evidence tied to the exact wallet-credit identity. The player
  -- prize column is deliberately absent from this calculation: it is a cache,
  -- never evidence that money moved.
  IF EXISTS (
    SELECT 1
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
       AND (
         p.amount IS NULL
         OR p.amount::text IN ('NaN','Infinity','-Infinity')
         OR p.amount <= 0
         OR p.amount IS DISTINCT FROM round(p.amount, 2)
         OR NOT EXISTS (
           SELECT 1
             FROM public.tournament_players tp
            WHERE tp.tournament_id = p_tournament_id
              AND tp.user_id = p.user_id
              AND (p."position" IS NULL OR tp.position = p."position")
         )
         OR (p.amount > 0 AND (
           p.idempotency_key IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM public.wallet_credit_idempotency k
              WHERE k.key = p.idempotency_key
                AND k.user_id = p.user_id
                AND k.amount = p.amount
           )
         ))
       )
  ) THEN
    RAISE EXCEPTION 'tournament % has malformed or unbacked prize payout evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF v_t.prize_pool IS NULL
     OR v_t.prize_pool::text IN ('NaN','Infinity','-Infinity')
     OR v_t.prize_pool <= 0
     OR v_t.prize_pool IS DISTINCT FROM round(v_t.prize_pool, 2) THEN
    RAISE EXCEPTION 'tournament % has invalid whole-cent prize pool %',
      p_tournament_id, v_t.prize_pool USING ERRCODE = '22003';
  END IF;
  v_pool_cents := round(v_t.prize_pool * 100)::bigint;

  -- The locked structure fixes every already-eliminated cash entitlement.
  -- Live places are superseded by the unanimous chip chop; places below the
  -- live field remain exact structure debts and reduce the chop residual at
  -- their full entitlement, whether previously unpaid, partly paid or paid.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'place', a.place,
           'amount', a.amount,
           'cents', round(a.amount * 100)::bigint
         ) ORDER BY a.place), '[]'::jsonb)
    INTO v_ladder
    FROM public.fn_ca_tournament_place_amounts(p_tournament_id) a;
  IF jsonb_array_length(v_ladder) = 0 THEN
    RAISE EXCEPTION 'tournament % derived an empty cash structure',
      p_tournament_id USING ERRCODE = '23514';
  END IF;
  SELECT max((e->>'place')::integer)
    INTO v_ladder_max_place
    FROM jsonb_array_elements(v_ladder) e;
  IF v_ladder_max_place IS NULL OR v_ladder_max_place < 1 THEN
    RAISE EXCEPTION 'tournament % derived an invalid cash structure tail',
      p_tournament_id USING ERRCODE = '23514';
  END IF;
  v_bubble_place := v_ladder_max_place + 1;

  IF v_status = 'RUNNING' THEN
    SELECT count(*), COALESCE(sum(tp.chips), 0)
      INTO v_live_count, v_total_chips
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text = 'playing'
       AND tp.eliminated_at IS NULL;
  ELSIF v_status IN ('COMPLETING','COMPLETED') THEN
    SELECT count(DISTINCT p.user_id) INTO v_live_count
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.source = 'final_table_deal';
  ELSE
    RAISE EXCEPTION 'tournament % cannot execute or replay a deal from status %',
      p_tournament_id, v_t.status USING ERRCODE = '55000';
  END IF;

  IF v_live_count < 2 OR v_live_count > v_table_size THEN
    RAISE EXCEPTION 'tournament % has % dealt/live players outside final-table size %',
      p_tournament_id, v_live_count, v_table_size USING ERRCODE = '55000';
  END IF;

  -- Late registration can grow the final field after an early bust already
  -- received a then-correct position. Normalize the locked eliminated tail
  -- before pricing its fixed places. The DB-owned elimination_sequence is the
  -- durable chronology witness: the latest elimination gets live_count+1 and
  -- the earliest gets field_size. Mutable wall clocks and stale place numbers
  -- are never used to reconstruct history. The consolidated predecessor owns
  -- the sequence column, allocator, unique index and transition trigger.
  IF v_status = 'RUNNING' THEN
    IF EXISTS (
      SELECT 1 FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND (
           (tp.status::text = 'playing' AND tp.eliminated_at IS NULL
             AND (tp.position IS NOT NULL OR tp.elimination_sequence IS NOT NULL))
           OR
           (NOT (tp.status::text = 'playing' AND tp.eliminated_at IS NULL)
             AND (tp.status::text <> 'eliminated'
               OR tp.eliminated_at IS NULL
               OR tp.position IS NULL
               OR tp.position < 2
               OR tp.position > v_field_size
               OR tp.elimination_sequence IS NULL
               OR tp.elimination_sequence <= 0))
         )
    ) OR (SELECT count(DISTINCT tp.elimination_sequence)
            FROM public.tournament_players tp
           WHERE tp.tournament_id = p_tournament_id
             AND tp.status::text = 'eliminated'
             AND tp.eliminated_at IS NOT NULL)
          <> v_field_size - v_live_count
    THEN
      RAISE EXCEPTION
        'tournament % roster lacks complete unique elimination-sequence evidence',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    UPDATE public.tournament_players tp
       SET position = NULL
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text = 'eliminated'
       AND tp.eliminated_at IS NOT NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> v_field_size - v_live_count THEN
      RAISE EXCEPTION 'tournament % normalized % of % eliminated standings',
        p_tournament_id, v_rows, v_field_size - v_live_count
        USING ERRCODE = 'P0404';
    END IF;

    WITH ranked AS (
      SELECT tp.id,
             (v_live_count + row_number() OVER (
               ORDER BY COALESCE(public.fn_ca_tournament_bust_at(tp.tournament_id, tp.user_id), tp.eliminated_at) DESC NULLS LAST, tp.elimination_sequence DESC NULLS LAST, tp.id ASC))::integer
               AS normalized_position
        FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.status::text = 'eliminated'
         AND tp.eliminated_at IS NOT NULL
    )
    UPDATE public.tournament_players tp
       SET position = ranked.normalized_position
      FROM ranked
     WHERE tp.id = ranked.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> v_field_size - v_live_count THEN
      RAISE EXCEPTION 'tournament % could not finish tail normalization',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  ELSIF EXISTS (
    SELECT 1
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text = 'eliminated'
       AND (tp.eliminated_at IS NULL OR tp.elimination_sequence IS NULL
         OR tp.elimination_sequence <= 0)
  ) OR (SELECT count(DISTINCT tp.elimination_sequence)
          FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id
           AND tp.status::text = 'eliminated')
        <> (SELECT count(*)
              FROM public.tournament_players tp
             WHERE tp.tournament_id = p_tournament_id
               AND tp.status::text = 'eliminated') THEN
    RAISE EXCEPTION
      'tournament % replay lacks complete unique elimination-sequence evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- Bubble protection is part of the locked tournament prize pool. It exists
  -- only when the durable eliminated tail already contains the one player at
  -- max(cash place)+1. If that place is still among the players making this
  -- deal, nobody bubbled and the full remaining pool is chopped. A completed
  -- bubble is exact prior pool evidence; partial or differently-owned state is
  -- never resumed.
  IF COALESCE(v_t.bubble_protection, false)
     AND v_field_size > v_ladder_max_place THEN
    IF v_t.buy_in_amount IS NULL
       OR v_t.buy_in_amount::text IN ('NaN','Infinity','-Infinity')
       OR v_t.buy_in_amount <= 0
       OR v_t.buy_in_amount IS DISTINCT FROM round(v_t.buy_in_amount, 2) THEN
      RAISE EXCEPTION 'tournament % has an invalid bubble-protection buy-in %',
        p_tournament_id, v_t.buy_in_amount USING ERRCODE = '22003';
    END IF;

    IF v_bubble_place > v_live_count THEN
      SELECT count(*)
        INTO v_bubble_candidate_count
        FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.position = v_bubble_place
         AND tp.status::text = 'eliminated'
         AND tp.eliminated_at IS NOT NULL
         AND tp.elimination_sequence IS NOT NULL
         AND tp.elimination_sequence > 0;
      SELECT tp.user_id
        INTO v_bubble_user_id
        FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.position = v_bubble_place
         AND tp.status::text = 'eliminated'
         AND tp.eliminated_at IS NOT NULL
         AND tp.elimination_sequence IS NOT NULL
         AND tp.elimination_sequence > 0
       ORDER BY tp.id
       LIMIT 1;
      IF v_bubble_candidate_count <> 1 OR v_bubble_user_id IS NULL THEN
        RAISE EXCEPTION
          'tournament % lacks one durable stone-bubble finisher at place %',
          p_tournament_id, v_bubble_place USING ERRCODE = 'P0404';
      END IF;
      v_has_bubble := true;
      v_bubble_amount := v_t.buy_in_amount::numeric(15,2);
      v_bubble_entitlement_cents := round(v_bubble_amount * 100)::bigint;
    END IF;
  END IF;

  SELECT count(*)
    INTO v_bubble_obligation_count
    FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id
     AND o.kind = 'bubble_protection';
  SELECT count(*), COALESCE(sum(p.amount), 0)
    INTO v_evidence_count, v_evidence
    FROM public.tournament_payouts p
   WHERE p.tournament_id = p_tournament_id
     AND p.source = 'bubble_protection';

  IF NOT v_has_bubble THEN
    IF v_bubble_obligation_count <> 0 OR v_evidence_count <> 0 THEN
      RAISE EXCEPTION
        'tournament % has bubble state without an eligible eliminated bubble',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  ELSIF v_bubble_obligation_count = 0 AND v_evidence_count = 0 THEN
    v_bubble_paid_cents := 0;
  ELSIF v_bubble_obligation_count = 1 AND v_evidence_count = 0 THEN
    -- A prior atomic attempt may have shaped the canonical debt before any
    -- wallet movement. That state is safe to resume, but only while it is
    -- exactly unpaid and has no orphaned obligation-key credit witness.
    SELECT * INTO v_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'bubble_protection';
    SELECT count(*) INTO v_rows
      FROM public.wallet_credit_idempotency k
     WHERE k.key LIKE
       'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':%';
    IF v_ob.id IS NULL
       OR v_ob.place IS NOT NULL
       OR v_ob.user_id IS DISTINCT FROM v_bubble_user_id
       OR v_ob.amount_owed IS DISTINCT FROM v_bubble_amount
       OR v_ob.amount_paid IS DISTINCT FROM 0::numeric
       OR v_ob.source IS DISTINCT FROM v_bubble_obligation_source
       OR v_ob.adjustment_id IS NOT NULL
       OR v_ob.settled_at IS NOT NULL
       OR v_rows <> 0 THEN
      RAISE EXCEPTION
        'tournament % has partial or mismatched unpaid bubble-protection state',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
    v_bubble_paid_cents := 0;
  ELSIF v_bubble_obligation_count = 1 AND v_evidence_count = 1 THEN
    SELECT * INTO v_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'bubble_protection';
    SELECT count(*) INTO v_rows
      FROM public.wallet_credit_idempotency k
     WHERE k.key =
       'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':0';
    IF v_ob.id IS NULL
       OR v_ob.place IS NOT NULL
       OR v_ob.user_id IS DISTINCT FROM v_bubble_user_id
       OR v_ob.amount_owed IS DISTINCT FROM v_bubble_amount
       OR v_ob.amount_paid IS DISTINCT FROM v_bubble_amount
       OR v_ob.source IS DISTINCT FROM v_bubble_obligation_source
       OR v_ob.adjustment_id IS NOT NULL
       OR v_ob.settled_at IS NULL
       OR v_evidence IS DISTINCT FROM v_bubble_amount
       OR v_rows <> 1
       OR (SELECT count(*)
             FROM public.wallet_credit_idempotency k
            WHERE k.key LIKE
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':%')
          <> 1
       OR NOT EXISTS (
         SELECT 1
           FROM public.tournament_payouts p
           JOIN public.wallet_credit_idempotency k
             ON k.key = p.idempotency_key
            AND k.user_id = p.user_id
            AND k.amount = p.amount
          WHERE p.tournament_id = p_tournament_id
            AND p.source = 'bubble_protection'
            AND p."position" IS NULL
            AND p.user_id = v_bubble_user_id
            AND p.amount = v_bubble_amount
            AND p.idempotency_key =
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':0'
       ) THEN
      RAISE EXCEPTION
        'tournament % has partial or mismatched bubble-protection evidence',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
    v_bubble_paid_cents := v_bubble_entitlement_cents;
  ELSE
    RAISE EXCEPTION
      'tournament % has incomplete bubble-protection evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  v_bubble_shortfall_cents :=
    v_bubble_entitlement_cents - v_bubble_paid_cents;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_ladder) e
      LEFT JOIN public.tournament_players tp
        ON tp.tournament_id = p_tournament_id
       AND tp.position = (e->>'place')::integer
     WHERE (e->>'place')::integer > v_live_count
       AND (e->>'cents')::bigint > 0
       AND (tp.id IS NULL OR tp.status::text <> 'eliminated'
         OR tp.eliminated_at IS NULL)
  ) THEN
    RAISE EXCEPTION
      'tournament % has a positive eliminated-place entitlement without its exact finisher',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'place', q.place,
           'user_id', q.user_id,
           'amount', q.amount,
           'cents', q.cents,
           'evidence_cents', q.evidence_cents
         ) ORDER BY q.place), '[]'::jsonb)
    INTO v_fixed
    FROM (
      SELECT (e->>'place')::integer AS place,
             tp.user_id,
             (e->>'amount')::numeric(15,2) AS amount,
             (e->>'cents')::bigint AS cents,
             COALESCE(sum(round(p.amount * 100)::bigint), 0)::bigint
               AS evidence_cents
        FROM jsonb_array_elements(v_ladder) e
        JOIN public.tournament_players tp
          ON tp.tournament_id = p_tournament_id
         AND tp.position = (e->>'place')::integer
        LEFT JOIN public.tournament_payouts p
          ON p.tournament_id = p_tournament_id
         AND p."position" = (e->>'place')::integer
         AND p.user_id = tp.user_id
         AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
         AND p.source <> 'final_table_deal'
         AND p.source <> 'bubble_protection'
       WHERE (e->>'place')::integer > v_live_count
         AND (e->>'cents')::bigint > 0
       GROUP BY (e->>'place')::integer, tp.user_id,
                (e->>'amount')::numeric(15,2), (e->>'cents')::bigint
    ) q;

  SELECT jsonb_array_length(v_fixed),
         COALESCE(sum((e->>'cents')::bigint), 0)::bigint,
         COALESCE(sum((e->>'evidence_cents')::bigint), 0)::bigint
    INTO v_fixed_count, v_fixed_entitlement_cents, v_fixed_paid_cents
    FROM jsonb_array_elements(v_fixed) e;

  -- Pool evidence before the deal must be exact evidence for one of those
  -- fixed eliminated places. Unpositioned, live-place, non-ITM and wrong-user
  -- rows cannot silently shrink the amount being chopped.
  IF EXISTS (
    SELECT 1
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
       AND p.source <> 'final_table_deal'
       AND NOT (
         (p.source = 'bubble_protection'
          AND v_has_bubble
          AND p."position" IS NULL
          AND p.user_id = v_bubble_user_id
          AND p.amount = v_bubble_amount)
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_fixed) e
            WHERE (e->>'place')::integer = p."position"
              AND (e->>'user_id')::uuid = p.user_id
         )
       )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_fixed) e
     WHERE (e->>'evidence_cents')::bigint < 0
        OR (e->>'evidence_cents')::bigint > (e->>'cents')::bigint
  ) THEN
    RAISE EXCEPTION
      'tournament % has payout evidence outside an exact fixed-place entitlement',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT COALESCE(sum(round(p.amount * 100)::bigint), 0)::bigint
    INTO v_prior_paid_cents
    FROM public.tournament_payouts p
   WHERE p.tournament_id = p_tournament_id
     AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
     AND COALESCE(p.source, '') <> 'final_table_deal';

  IF v_prior_paid_cents < 0 OR v_prior_paid_cents > v_pool_cents
     OR v_prior_paid_cents <>
          v_fixed_paid_cents + v_bubble_paid_cents THEN
    RAISE EXCEPTION 'tournament % records % prior prize cents against a % cent pool',
      p_tournament_id, v_prior_paid_cents, v_pool_cents
      USING ERRCODE = '23514';
  END IF;
  v_fixed_shortfall_cents := v_fixed_entitlement_cents - v_fixed_paid_cents;
  IF v_fixed_shortfall_cents < 0 OR v_bubble_shortfall_cents < 0
     OR v_prior_paid_cents + v_fixed_shortfall_cents
          + v_bubble_shortfall_cents > v_pool_cents THEN
    RAISE EXCEPTION 'tournament % has invalid fixed-place or bubble reserve',
      p_tournament_id USING ERRCODE = '23514';
  END IF;
  v_undistributed_cents :=
    v_pool_cents - v_prior_paid_cents - v_fixed_shortfall_cents
      - v_bubble_shortfall_cents;

  -- COMPLETING/COMPLETED is an evidence-only replay. It cannot infer a deal
  -- from mutable chip counts or silently convert a normal finish into a deal.
  IF v_status IN ('COMPLETING','COMPLETED') THEN
    IF v_has_bubble
       AND v_bubble_paid_cents <> v_bubble_entitlement_cents THEN
      RAISE EXCEPTION
        'tournament % replay lacks its exact pool-funded bubble receipt',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.source = 'final_table_deal'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'final_table_deal'
    ) THEN
      RAISE EXCEPTION 'tournament % is % without a durable final-table-deal receipt',
        p_tournament_id, v_status USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.source = 'final_table_deal'
         AND (p."position" IS NOT NULL OR p.amount <= 0)
    ) THEN
      RAISE EXCEPTION 'tournament % has malformed final-table-deal payout rows',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM (
          SELECT p.user_id, count(*) AS n, sum(p.amount) AS amount,
                 min(p.idempotency_key) AS idempotency_key
            FROM public.tournament_payouts p
           WHERE p.tournament_id = p_tournament_id
             AND p.source = 'final_table_deal'
           GROUP BY p.user_id
        ) e
        LEFT JOIN public.tournament_players tp
          ON tp.tournament_id = p_tournament_id AND tp.user_id = e.user_id
        LEFT JOIN public.tournament_obligations o
          ON o.tournament_id = p_tournament_id
         AND o.kind = 'final_table_deal'
         AND o.place IS NULL
         AND o.user_id = e.user_id
       WHERE e.n <> 1
          OR tp.id IS NULL
          OR tp.position IS NULL
          OR tp.position < 1
          OR tp.position > v_live_count
          OR tp.prize IS DISTINCT FROM e.amount
          OR (tp.position = 1 AND tp.status::text <> 'winner')
          OR (tp.position > 1 AND tp.status::text <> 'eliminated')
          OR o.id IS NULL
          OR o.amount_owed IS DISTINCT FROM e.amount
          OR o.amount_paid IS DISTINCT FROM e.amount
          OR o.source IS DISTINCT FROM 'final_table_deal'
          OR o.adjustment_id IS NOT NULL
          OR o.settled_at IS NULL
          OR e.idempotency_key IS DISTINCT FROM
             'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':0'
          OR (SELECT count(*)
                FROM public.wallet_credit_idempotency k
               WHERE k.key LIKE
                 'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%')
             <> 1
          OR NOT EXISTS (
            SELECT 1
              FROM public.wallet_credit_idempotency k
             WHERE k.key = e.idempotency_key
               AND k.user_id = e.user_id
               AND k.amount = e.amount
          )
    ) OR EXISTS (
      SELECT 1
        FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'final_table_deal'
         AND (o.place IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM public.tournament_payouts p
            WHERE p.tournament_id = p_tournament_id
              AND p.source = 'final_table_deal'
              AND p.user_id = o.user_id
         ))
    ) THEN
      RAISE EXCEPTION 'tournament % final-table-deal obligations, evidence and standings disagree',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    IF (SELECT count(*) FROM public.tournament_obligations o
         WHERE o.tournament_id = p_tournament_id AND o.kind = 'place')
         <> v_fixed_count
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_fixed) e
           LEFT JOIN public.tournament_obligations o
             ON o.tournament_id = p_tournament_id
            AND o.kind = 'place'
            AND o.place = (e->>'place')::integer
          WHERE o.id IS NULL
             OR o.user_id IS DISTINCT FROM (e->>'user_id')::uuid
             OR o.amount_owed IS DISTINCT FROM (e->>'amount')::numeric
             OR o.amount_paid IS DISTINCT FROM (e->>'amount')::numeric
             OR o.settled_at IS NULL
             OR (e->>'evidence_cents')::bigint <> (e->>'cents')::bigint
       ) THEN
      RAISE EXCEPTION
        'tournament % fixed-place obligations or evidence are not fully settled',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    IF (SELECT count(*) FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id
           AND tp.position BETWEEN 1 AND v_field_size) <> v_field_size
       OR EXISTS (
         SELECT 1 FROM generate_series(1, v_field_size) g(place)
          WHERE NOT EXISTS (
            SELECT 1 FROM public.tournament_players tp
             WHERE tp.tournament_id = p_tournament_id
               AND tp.position = g.place
          )
       )
       OR EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND (tp.position IS NULL OR tp.position < 1
              OR tp.position > v_field_size)
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND tp.position = 1
            AND tp.status::text = 'winner'
            AND tp.eliminated_at IS NULL
            AND tp.elimination_sequence IS NULL
       )
       OR EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND tp.position > 1
            AND (tp.status::text <> 'eliminated'
              OR tp.eliminated_at IS NULL
              OR tp.elimination_sequence IS NULL
              OR tp.elimination_sequence <= 0)
       )
       OR EXISTS (
         SELECT 1
           FROM (
             SELECT tp.position,
                    (1 + row_number() OVER (
                      ORDER BY COALESCE(public.fn_ca_tournament_bust_at(tp.tournament_id, tp.user_id), tp.eliminated_at) DESC NULLS LAST, tp.elimination_sequence DESC NULLS LAST, tp.id ASC))::integer
                      AS expected_position
               FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.status::text = 'eliminated'
           ) ranked
          WHERE ranked.position IS DISTINCT FROM ranked.expected_position
       )
       OR EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND tp.prize IS DISTINCT FROM COALESCE((
              SELECT sum(p.amount)
                FROM public.tournament_payouts p
               WHERE p.tournament_id = p_tournament_id
                 AND p.user_id = tp.user_id
                 AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
            ), 0)
       ) THEN
      RAISE EXCEPTION 'tournament % replay has incomplete final standings',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    SELECT count(*) INTO v_vote_count
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.position BETWEEN 1 AND v_live_count
       AND EXISTS (
         SELECT 1 FROM public.tournament_deal_votes v
          WHERE v.tournament_id = p_tournament_id
            AND v.user_id = tp.user_id
       );
    IF v_vote_count <> v_live_count THEN
      RAISE EXCEPTION 'tournament % replay has only % of % durable deal votes',
        p_tournament_id, v_vote_count, v_live_count USING ERRCODE = 'P0404';
    END IF;

    SELECT COALESCE(sum(round(p.amount * 100)::bigint), 0)::bigint
      INTO v_distributed_cents
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.source = 'final_table_deal';
    IF v_prior_paid_cents + v_distributed_cents <> v_pool_cents THEN
      RAISE EXCEPTION 'tournament % replay accounts for % of % prize cents',
        p_tournament_id, v_prior_paid_cents + v_distributed_cents, v_pool_cents
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'place', tp.position,
             'user_id', tp.user_id,
             'amount', p.amount
           ) ORDER BY tp.position), '[]'::jsonb)
      INTO v_payouts
      FROM public.tournament_payouts p
      JOIN public.tournament_players tp
        ON tp.tournament_id = p_tournament_id AND tp.user_id = p.user_id
     WHERE p.tournament_id = p_tournament_id
       AND p.source = 'final_table_deal';

    SELECT p.amount INTO v_winner_amount
      FROM public.tournament_payouts p
      JOIN public.tournament_players tp
        ON tp.tournament_id = p_tournament_id AND tp.user_id = p.user_id
     WHERE p.tournament_id = p_tournament_id
       AND p.source = 'final_table_deal'
       AND tp.position = 1;

    RETURN jsonb_build_object(
      'ok', true,
      'fully_settled', true,
      'status', v_status,
      'payouts', v_payouts,
      'winner_amount', v_winner_amount,
      'money_path', 'fn_settle_tournament_final_table_deal');
  END IF;

  IF v_status <> 'RUNNING' THEN
    RAISE EXCEPTION 'tournament % cannot execute a deal from status %',
      p_tournament_id, v_t.status USING ERRCODE = '55000';
  END IF;
  IF COALESCE(v_t.final_table_deal_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'tournament % does not have final-table deals enabled',
      p_tournament_id USING ERRCODE = '55000';
  END IF;
  IF v_undistributed_cents <= 0 THEN
    RAISE EXCEPTION 'tournament % has no undistributed prize money',
      p_tournament_id USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id AND p.source = 'final_table_deal'
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'final_table_deal'
  ) THEN
    RAISE EXCEPTION 'RUNNING tournament % already has final-table-deal state',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF v_total_chips IS NULL
     OR v_total_chips::text IN ('NaN','Infinity','-Infinity')
     OR v_total_chips <= 0
     OR EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.tournament_id = p_tournament_id
          AND tp.status::text = 'playing'
          AND tp.eliminated_at IS NULL
          AND (tp.chips IS NULL OR tp.chips < 0)
     ) THEN
    RAISE EXCEPTION 'tournament % has invalid live chip evidence',
      p_tournament_id USING ERRCODE = '22003';
  END IF;

  -- A fresh deal may not omit an unresolved roster row or overwrite an
  -- existing standing. Prior eliminated positions must already occupy exactly
  -- the contiguous tail after the players who are about to chop.
  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND NOT (tp.status::text = 'playing' AND tp.eliminated_at IS NULL)
       AND (tp.status::text <> 'eliminated' OR tp.position IS NULL
         OR tp.eliminated_at IS NULL
         OR tp.position <= v_live_count OR tp.position > v_field_size)
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text = 'playing' AND tp.eliminated_at IS NULL
       AND tp.position IS NOT NULL
  ) OR (SELECT count(*) FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id
           AND tp.position BETWEEN v_live_count + 1 AND v_field_size)
       <> v_field_size - v_live_count
  THEN
    RAISE EXCEPTION 'tournament % roster does not carry a complete pre-deal standing tail',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- A pre-existing place debt is accepted only when its owner, amount paid
  -- and payout evidence describe one exact fixed entitlement. A historical
  -- smaller amount_owed may be raised to the canonical structure amount below;
  -- paid evidence may never be rewritten or inferred from the prize cache.
  IF EXISTS (
    SELECT 1
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place'
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_fixed) e
          WHERE (e->>'place')::integer = o.place
            AND (e->>'user_id')::uuid = o.user_id
            AND o.amount_owed IS NOT NULL
            AND o.amount_paid IS NOT NULL
            AND o.amount_owed::text NOT IN ('NaN','Infinity','-Infinity')
            AND o.amount_paid::text NOT IN ('NaN','Infinity','-Infinity')
            AND o.amount_owed = round(o.amount_owed, 2)
            AND o.amount_paid = round(o.amount_paid, 2)
            AND o.amount_paid >= 0
            AND o.amount_owed >= o.amount_paid
            AND o.amount_owed <= (e->>'amount')::numeric
            AND round(o.amount_paid * 100)::bigint =
                (e->>'evidence_cents')::bigint
       )
  ) THEN
    RAISE EXCEPTION 'tournament % has an incompatible fixed-place obligation',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tournament_obligations o
      JOIN public.wallet_credit_idempotency k
        ON k.key LIKE
           'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%'
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place'
       AND NOT EXISTS (
         SELECT 1
           FROM public.tournament_payouts p
          WHERE p.idempotency_key = k.key
            AND p.tournament_id = p_tournament_id
            AND p.user_id = k.user_id
            AND p.amount = k.amount
            AND p."position" = o.place
       )
  ) THEN
    RAISE EXCEPTION
      'tournament % has a fixed-place wallet key without exact payout evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- An alive player cannot already own prize-bank payout evidence. That would
  -- make the remaining pool valid in aggregate but the recipient debt wrong.
  IF EXISTS (
    SELECT 1
      FROM public.tournament_payouts p
      JOIN public.tournament_players tp
        ON tp.tournament_id = p.tournament_id AND tp.user_id = p.user_id
     WHERE p.tournament_id = p_tournament_id
       AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
       AND tp.status::text = 'playing' AND tp.eliminated_at IS NULL
       AND p.amount > 0
  ) THEN
    RAISE EXCEPTION 'tournament % has prior prize evidence for a live deal player',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- Lock the current table layout after the three canonical money sets. The
  -- active seats must be exactly the live roster and must all be on one live
  -- tournament table.
  PERFORM 1 FROM public.tables tb
   WHERE tb.tournament_id = p_tournament_id
   ORDER BY tb.id FOR UPDATE;
  PERFORM 1
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id = s.table_id
   WHERE tb.tournament_id = p_tournament_id
   ORDER BY s.id
   FOR UPDATE OF s;

  SELECT count(DISTINCT s.table_id), count(*), count(DISTINCT s.user_id)
    INTO v_live_table_count, v_live_seat_count, v_live_seated_users
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id = s.table_id
   WHERE tb.tournament_id = p_tournament_id
     AND lower(tb.status::text) IN ('running','waiting')
     AND s.left_at IS NULL
     AND s.user_id IS NOT NULL;
  IF v_live_table_count <> 1
     OR v_live_seat_count <> v_live_count
     OR v_live_seated_users <> v_live_count
     OR EXISTS (
       (SELECT tp.user_id
          FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id
           AND tp.status::text = 'playing' AND tp.eliminated_at IS NULL)
       EXCEPT
       (SELECT s.user_id
          FROM public.table_seats s
          JOIN public.tables tb ON tb.id = s.table_id
         WHERE tb.tournament_id = p_tournament_id
           AND lower(tb.status::text) IN ('running','waiting')
           AND s.left_at IS NULL AND s.user_id IS NOT NULL)
     ) OR EXISTS (
       (SELECT s.user_id
          FROM public.table_seats s
          JOIN public.tables tb ON tb.id = s.table_id
         WHERE tb.tournament_id = p_tournament_id
           AND lower(tb.status::text) IN ('running','waiting')
           AND s.left_at IS NULL AND s.user_id IS NOT NULL)
       EXCEPT
       (SELECT tp.user_id
          FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id
           AND tp.status::text = 'playing' AND tp.eliminated_at IS NULL)
     ) THEN
    RAISE EXCEPTION 'tournament % live roster is not seated together at one final table',
      p_tournament_id USING ERRCODE = '55000';
  END IF;

  PERFORM 1 FROM public.tournament_deal_votes v
   WHERE v.tournament_id = p_tournament_id
   ORDER BY v.user_id FOR SHARE;
  SELECT count(*) INTO v_vote_count
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.status::text = 'playing' AND tp.eliminated_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.tournament_deal_votes v
        WHERE v.tournament_id = p_tournament_id AND v.user_id = tp.user_id
     );
  IF v_vote_count <> v_live_count THEN
    RAISE EXCEPTION 'tournament % has only % of % required live-player votes',
      p_tournament_id, v_vote_count, v_live_count USING ERRCODE = '55000';
  END IF;

  -- Snapshot only real locked roster input, after canonical tail normalization.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',tp.user_id,'club_id',tp.club_id,
    'chips',tp.chips,'registered_at',extract(epoch FROM tp.registered_at))
    ORDER BY tp.chips DESC,tp.registered_at ASC NULLS LAST,tp.user_id),'[]'::jsonb)
    INTO v_modern_input FROM public.tournament_players tp
    WHERE tp.tournament_id=p_tournament_id AND tp.status='playing' AND tp.eliminated_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',tp.id,'user_id',tp.user_id,
    'club_id',tp.club_id,'position',tp.position,'eliminated_at',extract(epoch FROM tp.eliminated_at),
    'elimination_sequence',tp.elimination_sequence) ORDER BY tp.position),'[]'::jsonb)
    INTO v_modern_tail FROM public.tournament_players tp
    WHERE tp.tournament_id=p_tournament_id AND tp.position>v_live_count;
  SELECT DISTINCT s.table_id INTO STRICT v_modern_table
    FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
    WHERE tb.tournament_id=p_tournament_id AND lower(tb.status::text) IN ('running','waiting')
      AND s.left_at IS NULL AND s.user_id IS NOT NULL;

  -- Price in integer cents. Each proportional share is floored; the exact
  -- residual goes to the deterministic chip leader (rank 1).
  FOR v_row IN
    SELECT tp.user_id, tp.chips, tp.registered_at
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text = 'playing' AND tp.eliminated_at IS NULL
     ORDER BY tp.chips DESC, tp.registered_at ASC NULLS LAST, tp.user_id ASC
  LOOP
    v_rank := v_rank + 1;
    v_share_cents := public.fn_ca_unit_floor_cents(
      floor(
        (v_row.chips::numeric * v_undistributed_cents::numeric) / v_total_chips
      )::bigint,
      public.fn_ca_tournament_unit_cents(p_tournament_id));
    IF v_share_cents <= 0 THEN
      RAISE EXCEPTION 'tournament % chip chop gives rank % a nonpositive share',
        p_tournament_id, v_rank USING ERRCODE = '23514';
    END IF;
    v_distributed_cents := v_distributed_cents + v_share_cents;
    v_shares := v_shares || jsonb_build_object(
      'place', v_rank,
      'user_id', v_row.user_id,
      'cents', v_share_cents);
    IF v_rank = 1 THEN v_leader := v_row.user_id; END IF;
  END LOOP;

  v_remainder_cents := v_undistributed_cents - v_distributed_cents;
  IF v_remainder_cents < 0 OR v_leader IS NULL THEN
    RAISE EXCEPTION 'tournament % produced an invalid deal residual of % cents',
      p_tournament_id, v_remainder_cents USING ERRCODE = '23514';
  END IF;

  -- Add the residual before the first write. Every recipient has one final
  -- amount and one obligation settlement.
  SELECT COALESCE(jsonb_agg(
           CASE WHEN e->>'user_id' = v_leader::text
                THEN jsonb_set(e, '{cents}',
                     to_jsonb((e->>'cents')::bigint + v_remainder_cents))
                ELSE e END
           ORDER BY (e->>'place')::integer
         ), '[]'::jsonb)
    INTO v_shares
    FROM jsonb_array_elements(v_shares) e;

  -- A stone-bubble debt, when one already exists, is part of the same complete
  -- transaction shape. It is pool-funded and user-keyed (position NULL).
  -- Complete historical evidence was proved above; only a genuinely absent
  -- row may be created here.
  IF v_has_bubble AND v_bubble_obligation_count = 0 THEN
    INSERT INTO public.tournament_obligations
      (tournament_id, kind, place, user_id, amount_owed, amount_paid,
       source, settled_at)
    VALUES
      (p_tournament_id, 'bubble_protection', NULL, v_bubble_user_id,
       v_bubble_amount, 0, v_bubble_obligation_source, NULL);
  END IF;

  -- Shape every positive fixed-place debt first. Existing evidence seeds
  -- amount_paid exactly; amount_owed becomes the canonical locked entitlement.
  -- No wallet can move until the bubble, this set and every deal share below
  -- all exist.
  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           (e->>'amount')::numeric(15,2) AS amount,
           ((e->>'evidence_cents')::numeric / 100)::numeric(15,2)
             AS evidence
      FROM jsonb_array_elements(v_fixed) e
     ORDER BY (e->>'place')::integer
  LOOP
    UPDATE public.tournament_obligations o
       SET amount_owed = v_row.amount,
           user_id = v_row.user_id,
           source = COALESCE(o.source, 'engine.fn_settle_tournament_places'),
           updated_at = v_now,
           settled_at = CASE WHEN v_row.evidence = v_row.amount
                             THEN COALESCE(o.settled_at, v_now)
                             ELSE NULL END
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place'
       AND o.place = v_row.place;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      INSERT INTO public.tournament_obligations
        (tournament_id, kind, place, user_id, amount_owed, amount_paid,
         source, settled_at)
      VALUES
        (p_tournament_id, 'place', v_row.place, v_row.user_id, v_row.amount,
         v_row.evidence, 'engine.fn_settle_tournament_places',
         CASE WHEN v_row.evidence = v_row.amount THEN v_now ELSE NULL END);
    ELSIF v_rows <> 1 THEN
      RAISE EXCEPTION 'tournament %, place % matched % fixed obligations',
        p_tournament_id, v_row.place, v_rows USING ERRCODE = '23505';
    END IF;
  END LOOP;

  -- Shape every positive deal share. The full positive fixed-place plus
  -- deal-share debt set is durable in this transaction before the first payer.
  INSERT INTO public.tournament_obligations
    (tournament_id, kind, place, user_id, amount_owed, amount_paid, source)
  SELECT p_tournament_id,
         'final_table_deal',
         NULL,
         (e->>'user_id')::uuid,
         ((e->>'cents')::numeric / 100)::numeric(15,2),
         0,
         'final_table_deal'
    FROM jsonb_array_elements(v_shares) e
   ORDER BY (e->>'place')::integer;

  PERFORM 1
    FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id
     AND o.kind IN ('bubble_protection','place','final_table_deal')
   ORDER BY o.kind, o.place NULLS LAST, o.user_id, o.id
   FOR UPDATE;

  IF (v_has_bubble AND (
        (SELECT count(*) FROM public.tournament_obligations o
          WHERE o.tournament_id = p_tournament_id
            AND o.kind = 'bubble_protection') <> 1
        OR NOT EXISTS (
          SELECT 1 FROM public.tournament_obligations o
           WHERE o.tournament_id = p_tournament_id
             AND o.kind = 'bubble_protection'
             AND o.place IS NULL
             AND o.user_id = v_bubble_user_id
             AND o.amount_owed = v_bubble_amount
             AND o.amount_paid =
                 (v_bubble_paid_cents::numeric / 100)::numeric(15,2)
             AND o.source = v_bubble_obligation_source
             AND o.adjustment_id IS NULL
             AND ((v_bubble_paid_cents = v_bubble_entitlement_cents
                    AND o.settled_at IS NOT NULL)
               OR (v_bubble_paid_cents = 0 AND o.settled_at IS NULL))
        )
      ))
     OR (NOT v_has_bubble AND EXISTS (
       SELECT 1 FROM public.tournament_obligations o
        WHERE o.tournament_id = p_tournament_id
          AND o.kind = 'bubble_protection'
     ))
     OR (SELECT count(*) FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'place') <> v_fixed_count
     OR EXISTS (
       SELECT 1
         FROM public.tournament_obligations o
        WHERE o.tournament_id = p_tournament_id
          AND o.kind = 'place'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_fixed) e
             WHERE (e->>'place')::integer = o.place
               AND (e->>'user_id')::uuid = o.user_id
               AND (e->>'amount')::numeric IS NOT DISTINCT FROM o.amount_owed
               AND ((e->>'evidence_cents')::numeric / 100)::numeric(15,2)
                   IS NOT DISTINCT FROM o.amount_paid
               AND ((o.amount_paid = o.amount_owed AND o.settled_at IS NOT NULL)
                 OR (o.amount_paid < o.amount_owed AND o.settled_at IS NULL))
          )
     )
     OR (SELECT count(*) FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'final_table_deal') <> v_live_count
     OR EXISTS (
       SELECT 1
         FROM public.tournament_obligations o
        WHERE o.tournament_id = p_tournament_id
          AND o.kind = 'final_table_deal'
          AND (
            o.place IS NOT NULL
            OR o.amount_paid <> 0
            OR o.source IS DISTINCT FROM 'final_table_deal'
            OR o.settled_at IS NOT NULL
            OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_shares) e
               WHERE (e->>'user_id')::uuid = o.user_id
                 AND ((e->>'cents')::numeric / 100)::numeric(15,2)
                     IS NOT DISTINCT FROM o.amount_owed
            )
          )
    ) THEN
    RAISE EXCEPTION
      'tournament % could not shape the complete bubble, fixed-place and deal debt set',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT e.prize_balance INTO STRICT v_modern_escrow_before
    FROM public.tournament_escrow e WHERE e.tournament_id=p_tournament_id AND e.enforced FOR UPDATE;
  v_modern_required:=(v_fixed_shortfall_cents+v_bubble_shortfall_cents+v_undistributed_cents)::numeric/100;
  IF v_modern_required<0 OR v_modern_escrow_before IS DISTINCT FROM v_modern_required THEN
    RAISE EXCEPTION 'canonical final deal lacks exact pre-credit custody';
  END IF;

  -- The complete positive obligation set now exists and is locked. Settle an
  -- eligible pool-funded bubble first, then each fixed place, still inside the
  -- same transaction as the chop. Any later refusal rolls every earlier wallet
  -- credit, payout, obligation and standing back together.
  IF v_has_bubble THEN
    v_result := public.fn_ca_settle_tournament_bubble_raw(
      p_tournament_id, v_bubble_user_id, v_bubble_amount);
    IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE
       OR COALESCE((v_result->>'fully_settled')::boolean, false) IS NOT TRUE
       OR (v_result->>'amount_owed')::numeric IS DISTINCT FROM v_bubble_amount
       OR (v_result->>'amount_paid')::numeric IS DISTINCT FROM v_bubble_amount
       OR COALESCE((v_result->>'remaining')::numeric, v_bubble_amount) <> 0 THEN
      RAISE EXCEPTION 'tournament % bubble protection did not settle in full',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  END IF;

  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           (e->>'amount')::numeric(15,2) AS amount
      FROM jsonb_array_elements(v_fixed) e
     ORDER BY (e->>'place')::integer
  LOOP
    v_result := public.fn_ca_settle_tournament_place_raw(
      p_tournament_id, v_row.place, v_row.user_id, v_row.amount);
    IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE
       OR COALESCE((v_result->>'fully_settled')::boolean, false) IS NOT TRUE
       OR (v_result->>'amount_owed')::numeric IS DISTINCT FROM v_row.amount
       OR (v_result->>'amount_paid')::numeric IS DISTINCT FROM v_row.amount THEN
      RAISE EXCEPTION 'tournament %, fixed place % did not settle in full',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;

    SELECT count(*), COALESCE(sum(p.amount), 0)
      INTO v_evidence_count, v_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.user_id = v_row.user_id
       AND p."position" = v_row.place
       AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
       AND p.source <> 'final_table_deal';
    IF v_evidence_count < 1 OR v_evidence IS DISTINCT FROM v_row.amount THEN
      RAISE EXCEPTION 'tournament %, fixed place % lacks exact full evidence',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;
  END LOOP;

  v_distributed_cents := 0;
  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           (e->>'cents')::bigint AS cents
      FROM jsonb_array_elements(v_shares) e
     ORDER BY (e->>'place')::integer
  LOOP
    v_amount := (v_row.cents::numeric / 100)::numeric(15,2);
    IF v_amount <= 0 OR v_amount IS DISTINCT FROM round(v_amount, 2) THEN
      RAISE EXCEPTION 'tournament % derived invalid deal amount % for rank %',
        p_tournament_id, v_amount, v_row.place USING ERRCODE = '22003';
    END IF;

    v_result := public.fn_ca_settle_final_table_deal_share_raw(
      p_tournament_id, v_row.user_id, v_amount);
    IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE
       OR COALESCE((v_result->>'fully_settled')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'tournament % rank % returned an incomplete deal share',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;

    SELECT * INTO v_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'final_table_deal'
       AND o.place IS NULL
       AND o.user_id = v_row.user_id;
    SELECT count(*), COALESCE(sum(p.amount), 0)
      INTO v_evidence_count, v_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.user_id = v_row.user_id
       AND p.source = 'final_table_deal'
       AND p."position" IS NULL;
    IF v_ob.id IS NULL
       OR v_ob.amount_owed IS DISTINCT FROM v_amount
       OR v_ob.amount_paid IS DISTINCT FROM v_amount
       OR v_ob.source IS DISTINCT FROM 'final_table_deal'
       OR v_ob.adjustment_id IS NOT NULL
       OR v_ob.settled_at IS NULL
       OR v_evidence_count <> 1
       OR v_evidence IS DISTINCT FROM v_amount
       OR NOT EXISTS (
         SELECT 1
           FROM public.tournament_payouts p
           JOIN public.wallet_credit_idempotency k
             ON k.key = p.idempotency_key
            AND k.user_id = p.user_id
            AND k.amount = p.amount
          WHERE p.tournament_id = p_tournament_id
            AND p.user_id = v_row.user_id
            AND p.source = 'final_table_deal'
            AND p."position" IS NULL
            AND p.amount = v_amount
            AND p.idempotency_key =
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':0'
       )
       OR (SELECT count(*)
             FROM public.wallet_credit_idempotency k
            WHERE k.key LIKE
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':%')
          <> 1 THEN
      RAISE EXCEPTION 'tournament % rank % did not write one exact payout row',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;

    v_distributed_cents := v_distributed_cents + v_row.cents;
    v_payouts := v_payouts || jsonb_build_object(
      'place', v_row.place,
      'user_id', v_row.user_id,
      'amount', v_amount);
    IF v_row.place = 1 THEN v_winner_amount := v_amount; END IF;
  END LOOP;

  IF v_distributed_cents <> v_undistributed_cents
     OR v_prior_paid_cents + v_fixed_shortfall_cents
        + v_bubble_shortfall_cents + v_distributed_cents <> v_pool_cents
     OR (SELECT COALESCE(sum(round(p.amount * 100)::bigint), 0)::bigint
           FROM public.tournament_payouts p
          WHERE p.tournament_id = p_tournament_id
            AND NOT (COALESCE(p.source, '') = ANY (v_not_pool)))
        <> v_pool_cents THEN
    RAISE EXCEPTION 'tournament % deal distributed % of % remaining cents',
      p_tournament_id, v_distributed_cents, v_undistributed_cents
      USING ERRCODE = '23514';
  END IF;

  -- The final standings and presentation cache commit with the money. Existing
  -- eliminated standings were proved above and are never rebuilt from clocks.
  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           ((e->>'cents')::numeric / 100)::numeric(15,2) AS amount
      FROM jsonb_array_elements(v_shares) e
     ORDER BY (e->>'place')::integer DESC
  LOOP
    UPDATE public.tournament_players
       SET position = v_row.place,
           prize = v_row.amount,
           status = CASE WHEN v_row.place = 1
                         THEN 'winner'
                         ELSE 'eliminated' END,
           eliminated_at = CASE WHEN v_row.place = 1 THEN NULL ELSE v_now END
     WHERE tournament_id = p_tournament_id
       AND user_id = v_row.user_id
       AND status::text = 'playing'
       AND eliminated_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'tournament % could not stamp one standing for rank %',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;
  END LOOP;

  -- Prize is presentation cache, never payment evidence. Every eliminated
  -- tail row starts at zero; positive fixed places then receive their full
  -- locked structure entitlement, not merely the amount that happened to be
  -- paid before this transaction.
  UPDATE public.tournament_players tp
     SET prize = 0
   WHERE tp.tournament_id = p_tournament_id
     AND tp.position > v_live_count;
  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           (e->>'amount')::numeric(15,2) AS amount
      FROM jsonb_array_elements(v_fixed) e
     ORDER BY (e->>'place')::integer
  LOOP
    UPDATE public.tournament_players tp
       SET prize = v_row.amount
     WHERE tp.tournament_id = p_tournament_id
       AND tp.position = v_row.place
       AND tp.user_id = v_row.user_id
       AND tp.status::text = 'eliminated';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'tournament % could not stamp fixed prize place %',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;
  END LOOP;

  IF v_has_bubble THEN
    UPDATE public.tournament_players tp
       SET prize = v_bubble_amount
     WHERE tp.tournament_id = p_tournament_id
       AND tp.position = v_bubble_place
       AND tp.user_id = v_bubble_user_id
       AND tp.status::text = 'eliminated'
       AND tp.eliminated_at IS NOT NULL
       AND tp.elimination_sequence IS NOT NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'tournament % could not stamp its stone-bubble prize cache',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  END IF;

  -- Keep RUNNING until every canonical payment and standing is proved below.
  -- Only fn_claim_tournament_finish may claim the lifecycle transition.

  -- Prove the exact durable state after every write. Any discrepancy aborts
  -- the statement and therefore every share credited above.
  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           ((e->>'cents')::numeric / 100)::numeric(15,2) AS amount
      FROM jsonb_array_elements(v_shares) e
     ORDER BY (e->>'place')::integer
  LOOP
    SELECT * INTO v_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'final_table_deal'
       AND o.place IS NULL
       AND o.user_id = v_row.user_id;
    SELECT count(*), COALESCE(sum(p.amount), 0)
      INTO v_evidence_count, v_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.source = 'final_table_deal'
       AND p."position" IS NULL
       AND p.user_id = v_row.user_id;
    IF v_ob.id IS NULL
       OR v_ob.amount_owed IS DISTINCT FROM v_row.amount
       OR v_ob.amount_paid IS DISTINCT FROM v_row.amount
       OR v_ob.source IS DISTINCT FROM 'final_table_deal'
       OR v_ob.settled_at IS NULL
       OR v_evidence_count <> 1
       OR v_evidence IS DISTINCT FROM v_row.amount
       OR NOT EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND tp.user_id = v_row.user_id
            AND tp.position = v_row.place
            AND tp.prize IS NOT DISTINCT FROM v_row.amount
            AND tp.status::text = CASE WHEN v_row.place = 1 THEN 'winner' ELSE 'eliminated' END
       ) THEN
      RAISE EXCEPTION 'tournament % failed post-deal proof at rank %',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT (e->>'place')::integer AS place,
           (e->>'user_id')::uuid AS user_id,
           (e->>'amount')::numeric(15,2) AS amount
      FROM jsonb_array_elements(v_fixed) e
     ORDER BY (e->>'place')::integer
  LOOP
    SELECT * INTO v_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place'
       AND o.place = v_row.place;
    SELECT count(*), COALESCE(sum(p.amount), 0)
      INTO v_evidence_count, v_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.user_id = v_row.user_id
       AND p."position" = v_row.place
       AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
       AND p.source <> 'final_table_deal';
    IF v_ob.id IS NULL
       OR v_ob.user_id IS DISTINCT FROM v_row.user_id
       OR v_ob.amount_owed IS DISTINCT FROM v_row.amount
       OR v_ob.amount_paid IS DISTINCT FROM v_row.amount
       OR v_ob.settled_at IS NULL
       OR v_evidence_count < 1
       OR v_evidence IS DISTINCT FROM v_row.amount
       OR NOT EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND tp.user_id = v_row.user_id
            AND tp.position = v_row.place
            AND tp.prize IS NOT DISTINCT FROM v_row.amount
            AND tp.status::text = 'eliminated'
            AND tp.eliminated_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'tournament % failed fixed-place proof at place %',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;
  END LOOP;

  IF v_has_bubble THEN
    SELECT count(*) INTO v_bubble_obligation_count
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'bubble_protection';
    SELECT * INTO v_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'bubble_protection'
       AND o.place IS NULL
       AND o.user_id = v_bubble_user_id;
    SELECT count(*), COALESCE(sum(p.amount), 0)
      INTO v_evidence_count, v_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.source = 'bubble_protection';
    SELECT count(*) INTO v_rows
      FROM public.wallet_credit_idempotency k
     WHERE k.key =
       'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':0';
    IF v_bubble_obligation_count <> 1
       OR v_ob.id IS NULL
       OR v_ob.amount_owed IS DISTINCT FROM v_bubble_amount
       OR v_ob.amount_paid IS DISTINCT FROM v_bubble_amount
       OR v_ob.source IS DISTINCT FROM v_bubble_obligation_source
       OR v_ob.adjustment_id IS NOT NULL
       OR v_ob.settled_at IS NULL
       OR v_evidence_count <> 1
       OR v_evidence IS DISTINCT FROM v_bubble_amount
       OR v_rows <> 1
       OR (SELECT count(*)
             FROM public.wallet_credit_idempotency k
            WHERE k.key LIKE
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':%')
          <> 1
       OR NOT EXISTS (
         SELECT 1
           FROM public.tournament_payouts p
           JOIN public.wallet_credit_idempotency k
             ON k.key = p.idempotency_key
            AND k.user_id = p.user_id
            AND k.amount = p.amount
          WHERE p.tournament_id = p_tournament_id
            AND p.source = 'bubble_protection'
            AND p."position" IS NULL
            AND p.user_id = v_bubble_user_id
            AND p.amount = v_bubble_amount
            AND p.idempotency_key =
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':0'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id
            AND tp.user_id = v_bubble_user_id
            AND tp.position = v_bubble_place
            AND tp.prize IS NOT DISTINCT FROM v_bubble_amount
            AND tp.status::text = 'eliminated'
            AND tp.eliminated_at IS NOT NULL
            AND tp.elimination_sequence IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'tournament % failed pool-funded bubble proof',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  END IF;

  IF (SELECT count(*) FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id AND tp.position IS NOT NULL)
       <> v_field_size
     OR EXISTS (
       SELECT 1 FROM generate_series(1, v_field_size) g(place)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id AND tp.position = g.place
        )
     )
     OR EXISTS (
       SELECT 1
         FROM public.tournament_players tp
        WHERE tp.tournament_id = p_tournament_id
          AND tp.status::text = 'eliminated'
          AND (tp.eliminated_at IS NULL OR tp.elimination_sequence IS NULL
            OR tp.elimination_sequence <= 0)
     )
     OR EXISTS (
       SELECT 1
         FROM (
           SELECT tp.position,
                  (1 + row_number() OVER (
                    ORDER BY COALESCE(public.fn_ca_tournament_bust_at(tp.tournament_id, tp.user_id), tp.eliminated_at) DESC NULLS LAST, tp.elimination_sequence DESC NULLS LAST, tp.id ASC))::integer
                    AS expected_position
             FROM public.tournament_players tp
            WHERE tp.tournament_id = p_tournament_id
              AND tp.status::text = 'eliminated'
         ) ranked
        WHERE ranked.position IS DISTINCT FROM ranked.expected_position
     )
     OR EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.tournament_id = p_tournament_id
          AND tp.prize IS DISTINCT FROM COALESCE((
            SELECT sum(p.amount)
              FROM public.tournament_payouts p
             WHERE p.tournament_id = p_tournament_id
               AND p.user_id = tp.user_id
               AND NOT (COALESCE(p.source, '') = ANY (v_not_pool))
          ), 0)
     ) THEN
    RAISE EXCEPTION 'tournament % did not finish with one standing per roster row',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- Publish the immutable v2 header only after all original canonical proofs.
  SELECT jsonb_agg(jsonb_build_object('kind',q.kind,'place',q.place,
    'user_id',q.user_id,'club_id',tp.club_id,'cents',q.cents) ORDER BY q.place)
    INTO v_modern_plan FROM (
      SELECT 'place' kind,(x->>'place')::integer place,(x->>'user_id')::uuid user_id,
        round((x->>'amount')::numeric*100)::bigint cents FROM jsonb_array_elements(v_fixed) x
      UNION ALL
      SELECT 'final_table_deal',(x->>'place')::integer,(x->>'user_id')::uuid,
        (x->>'cents')::bigint FROM jsonb_array_elements(v_shares) x
    ) q JOIN public.tournament_players tp
      ON tp.tournament_id=p_tournament_id AND tp.user_id=q.user_id;
  IF v_has_bubble THEN
    SELECT * INTO STRICT v_ob FROM public.tournament_obligations
     WHERE tournament_id=p_tournament_id AND kind='bubble_protection';
  END IF;
  IF (SELECT prize_balance FROM public.tournament_escrow WHERE tournament_id=p_tournament_id)
      IS DISTINCT FROM v_modern_escrow_before-v_modern_required THEN
    RAISE EXCEPTION 'canonical final deal lost exact custody delta';
  END IF;
  INSERT INTO public.tournament_final_table_deal_batches(
    tournament_id,plan_fingerprint,plan,prior_standings_fingerprint,
    live_input_snapshot,live_input_fingerprint,field_count,live_count,
    structure_place_count,place_line_count,deal_line_count,place_amount,deal_amount,
    amount_owed,bubble_contract_required,bubble_obligation_id,bubble_user_id,bubble_source,
    bubble_amount_owed,bubble_amount_paid_before,amount_moved,
    escrow_prize_before,escrow_prize_after,deal_table_id,chip_leader,source,settled_at,contract_version)
  VALUES(p_tournament_id,md5(v_modern_plan::text),v_modern_plan,md5(v_modern_tail::text),
    v_modern_input,md5(v_modern_input::text),v_field_size,v_live_count,
    jsonb_array_length(v_ladder),v_fixed_count,v_live_count,v_fixed_entitlement_cents::numeric/100,
    v_undistributed_cents::numeric/100,
    (v_fixed_entitlement_cents+v_undistributed_cents)::numeric/100,v_has_bubble,
    CASE WHEN v_has_bubble THEN v_ob.id ELSE NULL END,
    CASE WHEN v_has_bubble THEN v_bubble_user_id ELSE NULL END,
    CASE WHEN v_has_bubble THEN v_ob.source ELSE NULL END,
    v_bubble_amount,v_bubble_paid_cents::numeric/100,v_modern_required,
    v_modern_escrow_before,0,v_modern_table,v_leader,
    'engine.fn_settle_tournament_final_table_deal',transaction_timestamp(),2);
  PERFORM public.fn_ca_verify_terminal_final_deal_batch(p_tournament_id,false);
  v_modern_claim:=public.fn_claim_tournament_finish(
    p_tournament_id,v_leader,'engine.fn_settle_tournament_final_table_deal');
  IF COALESCE((v_modern_claim->>'ok')::boolean,false) IS NOT TRUE
    OR v_modern_claim->>'finish_kind' IS DISTINCT FROM 'final_table_deal'
    OR (v_modern_claim->>'winner_user_id')::uuid IS DISTINCT FROM v_leader
    OR v_modern_claim->>'status' IS DISTINCT FROM 'COMPLETING'
    OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament_id AND status='COMPLETING')
    OR NOT EXISTS(SELECT 1 FROM public.tournament_finish_receipts f
      WHERE f.tournament_id=p_tournament_id AND f.finish_kind='final_table_deal'
       AND f.winner_user_id=v_leader) THEN
    RAISE EXCEPTION 'canonical final deal finish claim refused: %',v_modern_claim;
  END IF;
  v_status:='COMPLETING';
  RETURN jsonb_build_object(
    'ok', true,
    'fully_settled', true,
    'status', v_status,
    'payouts', v_payouts,
    'winner_amount', v_winner_amount,
    'money_path', 'fn_settle_tournament_final_table_deal');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_settle_tournament_places(p_tournament_id uuid, p_observed_winner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_t record;
  v_ladder jsonb;
  v_payouts jsonb := '[]'::jsonb;
  v_status text;
  v_live_count integer;
  v_field_size integer;
  v_eliminated_count integer;
  v_sequenced_count integer;
  v_bubble_place integer;
  v_bubble_user_id uuid;
  v_bubble_amount numeric := 0;
  v_bubble_payout_count integer := 0;
  v_bubble_paid numeric := 0;
  v_bubble_ob_count integer := 0;
  v_bubble_ob public.tournament_obligations%ROWTYPE;
  v_bubble_result jsonb;
  v_winner public.tournament_players%ROWTYPE;
  v_row record;
  v_place integer;
  v_amount numeric;
  v_user_id uuid;
  v_ob public.tournament_obligations%ROWTYPE;
  v_evidence numeric;
  v_evidence_count integer;
  v_total_expected numeric := 0;
  v_winner_amount numeric := 0;
  v_result jsonb;
  v_guarantee_result jsonb;
  v_rows integer;
  v_unwitnessed_busts integer;
  v_misplaced_busts integer;
  v_original_witness jsonb;
  v_original_standings jsonb;
BEGIN
  -- Every rolling and terminal money authority enters one transaction lane
  -- before it can own an event, obligation, bank, or recipient row.
  PERFORM public.fn_ca_lock_settlement_lane_global();
  IF p_tournament_id IS NULL OR p_observed_winner_id IS NULL THEN
    RAISE EXCEPTION 'place settlement requires tournament and observed winner ids'
      USING ERRCODE = '22004';
  END IF;

  -- Canonical lock order. Re-locks inside owner-only callees are rows already
  -- owned by this transaction and therefore cannot invert a wait dependency.
  SELECT t.id, t.status, t.variant, t.tournament_type, t.is_premium_spin,
         t.satellite_target_id, t.satellite_target, t.prize_pool,
         t.bubble_protection, t.buy_in_amount, t.guaranteed_prize,
         t.prize_pool_finalized
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % does not exist', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;
  v_status := upper(COALESCE(v_t.status,''));
  IF v_status NOT IN ('RUNNING','COMPLETING','COMPLETED') THEN
    RAISE EXCEPTION 'tournament % cannot settle from status %',
      p_tournament_id, v_t.status USING ERRCODE = '55000';
  END IF;
  IF lower(COALESCE(v_t.variant,'')) = 'satellite'
     OR upper(COALESCE(v_t.tournament_type,'')) = 'SATELLITE'
     OR v_t.satellite_target_id IS NOT NULL
     OR v_t.satellite_target IS NOT NULL THEN
    RAISE EXCEPTION 'tournament % is a satellite, not an ordinary cash ladder',
      p_tournament_id USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_payouts p
              WHERE p.tournament_id = p_tournament_id
                AND lower(COALESCE(p.source,'')) = 'final_table_deal')
     OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                 WHERE o.tournament_id = p_tournament_id
                   AND o.kind = 'final_table_deal') THEN
    RAISE EXCEPTION
      'tournament % carries final-table-deal evidence; use the deal authority',
      p_tournament_id USING ERRCODE = '55000';
  END IF;

  -- Funding the advertised guarantee is part of this settlement transaction,
  -- not a best-effort request made by the game process immediately beforehand.
  -- fn_apply_prize_guarantee re-locks the row already owned here and either
  -- debits the event-owned bank plus finalizes the pool, or raises. Prove its
  -- receipt against the refreshed row before deriving even the first place; a
  -- refusal therefore rolls back the overlay, every payout and the finish.
  IF v_t.prize_pool IS NULL
     OR v_t.prize_pool::text IN ('NaN','Infinity','-Infinity')
     OR v_t.prize_pool < 0
     OR v_t.prize_pool IS DISTINCT FROM round(v_t.prize_pool, 2) THEN
    RAISE EXCEPTION 'tournament % has invalid whole-cent prize pool %',
      p_tournament_id, v_t.prize_pool USING ERRCODE = '22003';
  END IF;
  IF v_t.guaranteed_prize IS NOT NULL
     AND (v_t.guaranteed_prize::text IN ('NaN','Infinity','-Infinity')
       OR v_t.guaranteed_prize < 0
       OR v_t.guaranteed_prize IS DISTINCT FROM round(v_t.guaranteed_prize, 2)) THEN
    RAISE EXCEPTION 'tournament % has invalid whole-cent guarantee %',
      p_tournament_id, v_t.guaranteed_prize USING ERRCODE = '22003';
  END IF;
  v_guarantee_result := public.fn_apply_prize_guarantee(
    p_tournament_id, 'engine.fn_settle_tournament_places');
  IF COALESCE((v_guarantee_result->>'ok')::boolean, false) IS NOT TRUE
     OR (COALESCE((v_guarantee_result->>'overlay')::numeric,0) > 0
         AND COALESCE(
           (v_guarantee_result->>'overlay_journaled')::boolean,false)
             IS NOT TRUE) THEN
    RAISE EXCEPTION 'tournament % guarantee funding refused: %',
      p_tournament_id, v_guarantee_result USING ERRCODE = 'P0404';
  END IF;

  SELECT t.id, t.status, t.variant, t.tournament_type, t.is_premium_spin,
         t.satellite_target_id, t.satellite_target, t.prize_pool,
         t.bubble_protection, t.buy_in_amount, t.guaranteed_prize,
         t.prize_pool_finalized
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF COALESCE(v_t.prize_pool_finalized, false) IS NOT TRUE
     OR v_t.prize_pool IS NULL
     OR v_t.prize_pool::text IN ('NaN','Infinity','-Infinity')
     OR v_t.prize_pool IS DISTINCT FROM round(v_t.prize_pool, 2)
     OR v_t.prize_pool < COALESCE(v_t.guaranteed_prize, 0)
     OR v_guarantee_result->>'prize_pool' IS NULL
     OR (v_guarantee_result->>'prize_pool')::numeric IS DISTINCT FROM v_t.prize_pool THEN
    RAISE EXCEPTION
      'tournament % guarantee funding did not produce one finalized locked pool: result %, pool %, guarantee %, finalized %',
      p_tournament_id, v_guarantee_result, v_t.prize_pool,
      v_t.guaranteed_prize, v_t.prize_pool_finalized USING ERRCODE = 'P0404';
  END IF;

  PERFORM 1 FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
   ORDER BY tp.id FOR UPDATE;
  SELECT count(*) INTO v_field_size
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;
  IF EXISTS (SELECT 1 FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.status::text = 'registered') THEN
    RAISE EXCEPTION 'tournament % still has a registered unresolved player',
      p_tournament_id USING ERRCODE = '55000';
  END IF;

  -- The helper counts the final field, so derive only after the complete
  -- roster has joined the canonical tournament -> roster lock sequence.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'place',a.place,'amount',a.amount) ORDER BY a.place),'[]'::jsonb)
    INTO v_ladder
    FROM public.fn_ca_tournament_place_amounts(p_tournament_id) a;
  IF jsonb_array_length(v_ladder) = 0 THEN
    RAISE EXCEPTION 'tournament % derived an empty ladder', p_tournament_id
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_live_count FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.status::text IN ('playing','winner');
  IF v_live_count > 1 THEN
    RAISE EXCEPTION 'tournament % still has % live players',
      p_tournament_id, v_live_count USING ERRCODE = '55000';
  ELSIF v_live_count = 1 THEN
    SELECT tp.* INTO v_winner FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text IN ('playing','winner');
  ELSE
    -- The observed last survivor may already have crossed through
    -- `eliminated` in an all-in race. The committed transition sequence, not
    -- a wall clock, proves that this row was the final elimination.
    SELECT tp.* INTO v_winner FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.user_id = p_observed_winner_id
       AND tp.status::text = 'eliminated'
       AND tp.elimination_sequence IS NOT NULL;
    IF FOUND AND EXISTS (
      SELECT 1 FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.id <> v_winner.id
         AND tp.elimination_sequence = v_winner.elimination_sequence
    ) THEN
      RAISE EXCEPTION
        'tournament % has an ambiguous final elimination witness',
        p_tournament_id USING ERRCODE = '23505';
    END IF;
    IF FOUND AND EXISTS (
      SELECT 1 FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.status::text = 'eliminated'
         AND (tp.elimination_sequence IS NULL
              OR tp.elimination_sequence > v_winner.elimination_sequence)
    ) THEN
      v_winner := NULL;
    END IF;
  END IF;
  IF v_winner.id IS NULL OR v_winner.user_id IS DISTINCT FROM p_observed_winner_id THEN
    RAISE EXCEPTION 'observed winner % does not match locked winner % for tournament %',
      p_observed_winner_id, v_winner.user_id, p_tournament_id
      USING ERRCODE = '55000';
  END IF;

  -- Lock the whole set once, before validation or the ascending-place walk.
  PERFORM 1 FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id
   ORDER BY o.kind, o.place NULLS LAST, o.id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
       AND (o.place IS NULL OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_ladder) a
          WHERE (a->>'place')::integer = o.place))
  ) THEN
    RAISE EXCEPTION
      'tournament % has a place obligation outside its derived ladder',
      p_tournament_id USING ERRCODE = '55000';
  END IF;

  IF v_status = 'COMPLETED' THEN
    IF v_winner.status::text <> 'winner' OR v_winner.position <> 1 THEN
      RAISE EXCEPTION
        'COMPLETED tournament % is not an exact replay: winner is not durable',
        p_tournament_id USING ERRCODE = '55000';
    END IF;
  ELSE
    -- Recorded finish positions are the engine's live witness. Never rebuild
    -- an all-busted field from timestamps. Promotion may fill first place, but
    -- it cannot displace another recorded first or vacate a ladder place.
    IF EXISTS (SELECT 1 FROM public.tournament_players tp
                WHERE tp.tournament_id = p_tournament_id
                  AND tp.position = 1
                  AND tp.user_id <> v_winner.user_id) THEN
      RAISE EXCEPTION 'tournament % assigns first place to another player',
        p_tournament_id USING ERRCODE = '23505';
    END IF;
    IF v_winner.position IS NOT NULL AND v_winner.position <> 1
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_ladder) a
                    WHERE (a->>'place')::integer = v_winner.position) THEN
      RAISE EXCEPTION
        'promoting winner % would vacate cash place % in tournament %',
        v_winner.user_id, v_winner.position, p_tournament_id
        USING ERRCODE = '55000';
    END IF;
    UPDATE public.tournament_players
       SET status = 'winner', position = 1,
           eliminated_at = NULL, elimination_sequence = NULL
     WHERE id = v_winner.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION
        'tournament % could not promote exactly one winner',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    v_original_witness:=smarter_private.breakfast_standings_witness(p_tournament_id,p_observed_winner_id);
    v_original_standings:=COALESCE(smarter_private.spin_original_standings_witness(p_tournament_id,p_observed_winner_id),
      smarter_private.spin_archived_first_standings(p_tournament_id,p_observed_winner_id));
    IF v_original_witness IS NULL AND v_original_standings IS NULL THEN
    -- Final numeric positions are derived from the transition witness, not
    -- from the field size that happened to exist when each player busted.
    -- This is the root fix for late registration enlarging the field after an
    -- early elimination. Existing money evidence is never relabelled: a
    -- legacy event whose paid place would move fails closed for explicit
    -- adjudication instead of rewriting settled history.
    SELECT count(*), count(tp.elimination_sequence),
           count(DISTINCT tp.elimination_sequence)
      INTO v_eliminated_count, v_sequenced_count, v_rows
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text = 'eliminated';
    IF v_eliminated_count <> v_field_size - 1
       OR v_sequenced_count <> v_eliminated_count
       OR v_rows <> v_eliminated_count THEN
      RAISE EXCEPTION
        'tournament % has no complete durable elimination sequence (%/% of %)',
        p_tournament_id, v_sequenced_count, v_rows, v_eliminated_count
        USING ERRCODE = 'P0404';
    END IF;

    /* A BUST IS RANKED BY WHEN IT HAPPENED (2026-09-11). Places were
       numbered in elimination_sequence order, which a trigger stamps when
       the knockout door RECORDS a bust, so a bust the door recorded hours
       late was paid a place it did not finish in. Each eliminated row is now
       ranked by when its bust happened, derived in the statement that uses
       it from what the door proved: the commit time of the accepted hand of
       the player's latest 'eliminated' knockout generation, plus one
       microsecond per earlier rank in that hand (smaller hand-start stack
       first, then user id - the rule the door stamps eliminated_at with).
       Busts in different hands are ordered by those hands' commit times.
       The hand-history prune deletes a horse-only hand's commit row after
       its retention window, and only a PENDING generation protects it; the
       generation rows themselves are never pruned, so a hand whose commit
       is gone is timed by when its first generation was captured (the
       earliest created_at of that hand's generations, written before the
       commit) - one time for the whole hand, so the same-hand stack rank
       still decides within it - never by when a bust was recorded. A row
       with no such witness keeps its eliminated_at; a row with neither is
       refused, never guessed. Equal times fall back to
       elimination_sequence, then id. elimination_sequence alone still names
       the last elimination, and so the winner, above. The same order decides
       whether anything moves, so a ladder already in true order is left
       exactly as it is. */
    WITH busts AS (
      SELECT tp.id, tp.position, tp.elimination_sequence,
             COALESCE((
               SELECT COALESCE(a.committed_at,
                               (SELECT min(g.created_at)
                                  FROM public.tournament_knockout_candidates g
                                 WHERE g.tournament_id = c.tournament_id
                                   AND g.table_id = c.table_id
                                   AND g.hand_number = c.hand_number
                                   AND g.hand_id = c.hand_id))
                      + (SELECT count(*)
                           FROM public.tournament_knockout_candidates s
                          WHERE s.tournament_id = c.tournament_id
                            AND s.table_id = c.table_id
                            AND s.hand_number = c.hand_number
                            AND s.hand_id = c.hand_id
                            AND (s.stack_before, s.eliminated_user_id)
                                < (c.stack_before, c.eliminated_user_id))::integer
                        * interval '1 microsecond'
                 FROM (SELECT k.tournament_id, k.table_id, k.hand_number,
                              k.hand_id, k.stack_before, k.eliminated_user_id
                         FROM public.tournament_knockout_candidates k
                        WHERE k.tournament_id = tp.tournament_id
                          AND k.eliminated_user_id = tp.user_id
                          AND k.state = 'eliminated'
                        ORDER BY k.hand_number DESC, k.id DESC
                        LIMIT 1) c
                 LEFT JOIN public.hand_atomic_commits a
                   ON a.table_id = c.table_id
                  AND a.hand_number = c.hand_number
                  AND a.hand_id = c.hand_id
             ), tp.eliminated_at) AS bust_at
        FROM public.tournament_players tp
       WHERE tp.tournament_id = p_tournament_id
         AND tp.status::text = 'eliminated'
    ),
    ranked AS (
      SELECT b.id, b.position, b.bust_at,
             row_number() OVER (
               ORDER BY b.bust_at DESC, b.elimination_sequence DESC, b.id ASC
             )::integer + 1 AS expected_position
        FROM busts b
    )
    SELECT count(*) FILTER (WHERE ranked.bust_at IS NULL),
           count(*) FILTER (WHERE ranked.position IS DISTINCT FROM ranked.expected_position)
      INTO v_unwitnessed_busts, v_misplaced_busts
      FROM ranked;
    IF v_unwitnessed_busts > 0 THEN
      RAISE EXCEPTION
        'tournament % has % eliminated player(s) with no bust witness and no eliminated_at',
        p_tournament_id, v_unwitnessed_busts USING ERRCODE = 'P0404';
    END IF;

    IF v_misplaced_busts > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.tournament_payouts p
         WHERE p.tournament_id = p_tournament_id
           AND p."position" IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.tournament_obligations o
         WHERE o.tournament_id = p_tournament_id
           AND o.kind = 'place'
      ) THEN
        /* Paid places are never relabelled. A COMPLETING event whose
           places are exactly the recording-order ladder was settled by the
           rule this replaces, and is replayed as it was paid, not refused. */
        IF v_status <> 'COMPLETING' OR EXISTS (
          SELECT 1
            FROM (
              SELECT tp.position,
                     row_number() OVER (
                       ORDER BY tp.elimination_sequence DESC, tp.id ASC
                     )::integer + 1 AS expected_position
                FROM public.tournament_players tp
               WHERE tp.tournament_id = p_tournament_id
                 AND tp.status::text = 'eliminated'
            ) recorded
           WHERE recorded.position IS DISTINCT FROM recorded.expected_position
        ) THEN
          RAISE EXCEPTION
            'tournament % needs a late-entry position normalization but already carries settled place evidence',
            p_tournament_id USING ERRCODE = 'P0404';
        END IF;
      ELSE
        UPDATE public.tournament_players tp
           SET position = NULL
         WHERE tp.tournament_id = p_tournament_id
           AND tp.status::text = 'eliminated';

        WITH busts AS (
        SELECT tp.id, tp.position, tp.elimination_sequence,
               COALESCE((
                 SELECT COALESCE(a.committed_at,
                                 (SELECT min(g.created_at)
                                    FROM public.tournament_knockout_candidates g
                                   WHERE g.tournament_id = c.tournament_id
                                     AND g.table_id = c.table_id
                                     AND g.hand_number = c.hand_number
                                     AND g.hand_id = c.hand_id))
                        + (SELECT count(*)
                             FROM public.tournament_knockout_candidates s
                            WHERE s.tournament_id = c.tournament_id
                              AND s.table_id = c.table_id
                              AND s.hand_number = c.hand_number
                              AND s.hand_id = c.hand_id
                              AND (s.stack_before, s.eliminated_user_id)
                                  < (c.stack_before, c.eliminated_user_id))::integer
                          * interval '1 microsecond'
                   FROM (SELECT k.tournament_id, k.table_id, k.hand_number,
                                k.hand_id, k.stack_before, k.eliminated_user_id
                           FROM public.tournament_knockout_candidates k
                          WHERE k.tournament_id = tp.tournament_id
                            AND k.eliminated_user_id = tp.user_id
                            AND k.state = 'eliminated'
                          ORDER BY k.hand_number DESC, k.id DESC
                          LIMIT 1) c
                   LEFT JOIN public.hand_atomic_commits a
                     ON a.table_id = c.table_id
                    AND a.hand_number = c.hand_number
                    AND a.hand_id = c.hand_id
               ), tp.eliminated_at) AS bust_at
          FROM public.tournament_players tp
         WHERE tp.tournament_id = p_tournament_id
           AND tp.status::text = 'eliminated'
        ),
        ranked AS (
          SELECT b.id,
                 row_number() OVER (
                   ORDER BY b.bust_at DESC, b.elimination_sequence DESC, b.id ASC
                 )::integer + 1 AS expected_position
            FROM busts b
        )
        UPDATE public.tournament_players tp
           SET position = ranked.expected_position
          FROM ranked
         WHERE tp.id = ranked.id;
      END IF;
    END IF;
    END IF;
  END IF;

  -- Derive the single pool-funded bubble promise after standings are final.
  -- The percentage helper has already reserved this exact amount from its
  -- ladder. Satellites never enter this authority: their bubble is paid the
  -- residual that cannot buy a full seat by the satellite settle path.
  SELECT max((a->>'place')::integer) + 1
    INTO v_bubble_place
    FROM jsonb_array_elements(v_ladder) a;
  IF COALESCE(v_t.bubble_protection, false)
     AND v_bubble_place IS NOT NULL
     AND v_bubble_place <= v_field_size THEN
    IF v_t.buy_in_amount IS NULL
       OR v_t.buy_in_amount::text IN ('NaN','Infinity','-Infinity')
       OR v_t.buy_in_amount <= 0
       OR v_t.buy_in_amount IS DISTINCT FROM round(v_t.buy_in_amount, 2) THEN
      RAISE EXCEPTION 'tournament % has invalid bubble buy-in %',
        p_tournament_id, v_t.buy_in_amount USING ERRCODE = '22003';
    END IF;
    v_bubble_amount := round(v_t.buy_in_amount, 2);
    IF v_bubble_amount > v_t.prize_pool THEN
      RAISE EXCEPTION 'tournament % bubble amount % exceeds pool %',
        p_tournament_id, v_bubble_amount, v_t.prize_pool
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*), min(tp.user_id::text)::uuid
      INTO v_rows, v_bubble_user_id
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.position = v_bubble_place
       AND tp.status::text = 'eliminated';
    IF v_rows <> 1 OR v_bubble_user_id IS NULL THEN
      RAISE EXCEPTION 'tournament % has no single eliminated stone bubble at place %',
        p_tournament_id, v_bubble_place USING ERRCODE = 'P0404';
    END IF;
  END IF;

  SELECT count(*), COALESCE(sum(p.amount), 0)
    INTO v_bubble_payout_count, v_bubble_paid
    FROM public.tournament_payouts p
   WHERE p.tournament_id = p_tournament_id
     AND p.source = 'bubble_protection';
  SELECT count(*) INTO v_bubble_ob_count
    FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id
     AND o.kind = 'bubble_protection';

  IF v_bubble_amount = 0 THEN
    IF v_bubble_payout_count <> 0 OR v_bubble_paid <> 0
       OR v_bubble_ob_count <> 0 THEN
      RAISE EXCEPTION 'tournament % carries bubble evidence but no bubble is due',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  ELSE
    IF v_bubble_paid > v_bubble_amount
       OR EXISTS (
         SELECT 1 FROM public.tournament_payouts p
          WHERE p.tournament_id = p_tournament_id
            AND p.source = 'bubble_protection'
            AND (p.user_id IS DISTINCT FROM v_bubble_user_id
              OR p."position" IS NOT NULL
              OR p.amount IS NULL
              OR p.amount::text IN ('NaN','Infinity','-Infinity')
              OR p.amount <= 0
              OR p.amount IS DISTINCT FROM round(p.amount, 2)
              OR p.idempotency_key IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM public.wallet_credit_idempotency k
                 WHERE k.key = p.idempotency_key
                   AND k.user_id = p.user_id
                   AND k.amount = p.amount))) THEN
      RAISE EXCEPTION 'tournament % has malformed bubble payout evidence',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;

    SELECT * INTO v_bubble_ob
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'bubble_protection'
       AND o.user_id = v_bubble_user_id;
    IF v_bubble_ob_count > 0
       AND (v_bubble_ob_count <> 1 OR v_bubble_ob.id IS NULL
         OR v_bubble_ob.place IS NOT NULL
         OR v_bubble_ob.amount_owed IS DISTINCT FROM v_bubble_amount
         OR v_bubble_ob.amount_paid IS DISTINCT FROM v_bubble_paid
         OR v_bubble_ob.amount_paid < 0
         OR v_bubble_ob.amount_paid > v_bubble_ob.amount_owed
         OR (v_bubble_ob.amount_paid = v_bubble_ob.amount_owed) IS DISTINCT FROM
            (v_bubble_ob.settled_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'tournament % has malformed bubble obligation evidence',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
    IF v_bubble_ob_count = 0
       AND (v_bubble_payout_count <> 0 OR v_bubble_paid <> 0) THEN
      RAISE EXCEPTION 'tournament % has bubble money without its debt record',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
    IF v_status = 'COMPLETED'
       AND (v_bubble_ob_count <> 1
         OR v_bubble_paid IS DISTINCT FROM v_bubble_amount
         OR v_bubble_ob.amount_paid IS DISTINCT FROM v_bubble_amount
         OR v_bubble_ob.settled_at IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public.tournament_players tp
            WHERE tp.tournament_id = p_tournament_id
              AND tp.user_id = v_bubble_user_id
              AND tp.position = v_bubble_place
              AND tp.prize IS NOT DISTINCT FROM v_bubble_amount)) THEN
      RAISE EXCEPTION 'COMPLETED tournament % has no exact bubble replay',
        p_tournament_id USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Anything paid from the prize bank outside the derived ladder makes a full
  -- structure payout unsafe. Bounty/seat sources belong to other authorities.
  IF EXISTS (
    SELECT 1 FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND COALESCE(p.source,'') NOT IN
           ('bounty','own_bounty','mystery_bounty','mystery_bounty_residual',
            'bounty_residual','satellite_seat','bubble_protection')
       AND (p."position" IS NULL OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_ladder) a
          WHERE (a->>'place')::integer = p."position"))
  ) THEN
    RAISE EXCEPTION 'tournament % has prize evidence outside its derived ladder',
      p_tournament_id USING ERRCODE = '55000';
  END IF;

  -- Obligation-shaped wallet identity with no exact payout row is mixed
  -- evidence. It is checked globally before any place can move.
  IF EXISTS (
    SELECT 1
      FROM public.tournament_obligations o
      JOIN public.wallet_credit_idempotency k
        ON k.key LIKE 'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%'
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'
       AND NOT EXISTS (
         SELECT 1 FROM public.tournament_payouts p
          WHERE p.idempotency_key = k.key
            AND p.tournament_id = p_tournament_id
            AND p.user_id = k.user_id AND p.amount = k.amount)
  ) THEN
    RAISE EXCEPTION
      'tournament % has wallet-credit identity without payout evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- Preflight every place before settling the first one.
  FOR v_row IN
    SELECT (a->>'place')::integer AS place,
           (a->>'amount')::numeric AS amount, tp.user_id,
           tp.prize AS cached_prize
      FROM jsonb_array_elements(v_ladder) a
      LEFT JOIN public.tournament_players tp
        ON tp.tournament_id = p_tournament_id
       AND tp.position = (a->>'place')::integer
     ORDER BY (a->>'place')::integer
  LOOP
    v_place := v_row.place; v_amount := v_row.amount; v_user_id := v_row.user_id;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'tournament % has no finisher for cash place %',
        p_tournament_id, v_place USING ERRCODE = '23502';
    END IF;
    IF v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount < 0
       OR v_amount IS DISTINCT FROM round(v_amount,2) THEN
      RAISE EXCEPTION 'tournament % derived invalid amount % for place %',
        p_tournament_id, v_amount, v_place USING ERRCODE = '22003';
    END IF;
    v_total_expected := v_total_expected + v_amount;
    IF v_place = 1 THEN v_winner_amount := v_amount; END IF;
    IF v_status = 'COMPLETED'
       AND v_row.cached_prize IS DISTINCT FROM v_amount THEN
      RAISE EXCEPTION
        'COMPLETED tournament %, place % has stale prize cache % (expected %)',
        p_tournament_id, v_place, v_row.cached_prize, v_amount
        USING ERRCODE = '55000';
    END IF;

    -- Each payout row is also required to name an exact wallet-credit identity.
    IF EXISTS (
      SELECT 1 FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id AND p."position" = v_place
         AND (p.user_id IS DISTINCT FROM v_user_id OR p.amount IS NULL
           OR p.amount::text IN ('NaN','Infinity','-Infinity') OR p.amount < 0
           OR p.amount IS DISTINCT FROM round(p.amount,2)
           OR p.idempotency_key IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.wallet_credit_idempotency k
              WHERE k.key = p.idempotency_key AND k.user_id = p.user_id
                AND k.amount = p.amount))
    ) THEN
      RAISE EXCEPTION
        'tournament %, place % has mixed/malformed/wrong-recipient evidence',
        p_tournament_id, v_place USING ERRCODE = 'P0404';
    END IF;
    SELECT count(*), COALESCE(sum(p.amount),0)
      INTO v_evidence_count, v_evidence
      FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id AND p."position" = v_place;
    v_evidence := round(v_evidence,2);
    IF v_evidence > v_amount THEN
      RAISE EXCEPTION 'tournament %, place % records % above entitlement %',
        p_tournament_id, v_place, v_evidence, v_amount USING ERRCODE = '23514';
    END IF;

    v_ob := NULL;
    SELECT * INTO v_ob FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place' AND o.place = v_place;
    IF FOUND THEN
      IF v_ob.user_id IS DISTINCT FROM v_user_id OR v_ob.amount_owed IS NULL
         OR v_ob.amount_paid IS NULL
         OR v_ob.amount_owed::text IN ('NaN','Infinity','-Infinity')
         OR v_ob.amount_paid::text IN ('NaN','Infinity','-Infinity')
         OR v_ob.amount_owed IS DISTINCT FROM round(v_ob.amount_owed,2)
         OR v_ob.amount_paid IS DISTINCT FROM round(v_ob.amount_paid,2)
         OR v_ob.amount_owed < 0 OR v_ob.amount_paid < 0
         OR v_ob.amount_paid > v_ob.amount_owed
         OR v_ob.amount_owed > v_amount
         OR v_ob.amount_paid IS DISTINCT FROM v_evidence THEN
        RAISE EXCEPTION 'tournament %, place % has incompatible obligation',
          p_tournament_id, v_place USING ERRCODE = 'P0404';
      END IF;
    END IF;

    IF v_amount = 0 THEN
      -- Zero-valued ladder places are standings, not debts.
      IF v_evidence <> 0 OR (v_ob.id IS NOT NULL
         AND (v_ob.amount_owed <> 0 OR v_ob.amount_paid <> 0)) THEN
        RAISE EXCEPTION 'zero-value place % in tournament % carries money evidence',
          v_place, p_tournament_id USING ERRCODE = '23514';
      END IF;
    ELSIF v_status = 'COMPLETED' THEN
      IF v_ob.id IS NULL OR v_ob.amount_owed IS DISTINCT FROM v_amount
         OR v_ob.amount_paid IS DISTINCT FROM v_amount
         OR v_evidence IS DISTINCT FROM v_amount THEN
        RAISE EXCEPTION 'COMPLETED tournament %, place % is not an exact replay',
          p_tournament_id, v_place USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;

  IF round(v_total_expected + v_bubble_amount, 2)
       IS DISTINCT FROM v_t.prize_pool THEN
    RAISE EXCEPTION
      'tournament % ladder % plus bubble % does not equal locked pool %',
      p_tournament_id, v_total_expected, v_bubble_amount, v_t.prize_pool
      USING ERRCODE = '23514';
  END IF;

  IF v_status <> 'COMPLETED' THEN
    -- Materialize the bubble and the entire positive ladder before the first
    -- wallet credit. The payment walk is driven from one complete locked debt
    -- set, so failure on any recipient rolls every obligation and credit back.
    IF v_bubble_amount > 0 AND v_bubble_ob_count = 0 THEN
      INSERT INTO public.tournament_obligations
        (tournament_id,kind,place,user_id,amount_owed,amount_paid,source,settled_at)
      VALUES
        (p_tournament_id,'bubble_protection',NULL,v_bubble_user_id,
         v_bubble_amount,0,'engine.fn_settle_tournament_places',NULL)
      RETURNING * INTO v_bubble_ob;
      v_bubble_ob_count := 1;
    END IF;

    FOR v_row IN
      SELECT (a->>'place')::integer AS place,
             (a->>'amount')::numeric AS amount, tp.user_id
        FROM jsonb_array_elements(v_ladder) a
        JOIN public.tournament_players tp
          ON tp.tournament_id = p_tournament_id
         AND tp.position = (a->>'place')::integer
       WHERE (a->>'amount')::numeric > 0
       ORDER BY (a->>'place')::integer
    LOOP
      SELECT COALESCE(sum(p.amount),0) INTO v_evidence
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p."position" = v_row.place;

      IF v_original_witness IS NOT NULL AND EXISTS(SELECT 1 FROM public.tournament_obligations o
        WHERE o.tournament_id=p_tournament_id AND o.kind='place' AND o.place=v_row.place
        AND o.amount_owed=v_row.amount AND o.amount_paid=v_row.amount AND o.settled_at IS NOT NULL) THEN
        v_rows:=1; -- Preserve already-paid original obligation metadata.
      ELSE
      UPDATE public.tournament_obligations o
         SET amount_owed = v_row.amount,
             source = COALESCE(o.source, 'engine.fn_settle_tournament_places'),
             updated_at = now()
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'place' AND o.place = v_row.place;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      END IF;
      IF v_rows = 0 THEN
        INSERT INTO public.tournament_obligations
          (tournament_id,kind,place,user_id,amount_owed,amount_paid,source,settled_at)
        VALUES
          (p_tournament_id,'place',v_row.place,v_row.user_id,v_row.amount,
           v_evidence,'engine.fn_settle_tournament_places',
           CASE WHEN v_evidence = v_row.amount THEN now() ELSE NULL END);
      ELSIF v_rows <> 1 THEN
        RAISE EXCEPTION 'tournament %, place % matched % obligations',
          p_tournament_id, v_row.place, v_rows USING ERRCODE = '23505';
      END IF;
    END LOOP;

    -- Re-lock/prove the complete set immediately before any raw payer runs.
    PERFORM 1 FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind IN ('bubble_protection','place')
     ORDER BY o.kind, o.place NULLS LAST, o.id FOR UPDATE;

    IF v_bubble_amount > 0 THEN
      v_bubble_result := public.fn_ca_settle_tournament_bubble_raw(
        p_tournament_id, v_bubble_user_id, v_bubble_amount);
    END IF;

    FOR v_row IN
      SELECT (a->>'place')::integer AS place,
             (a->>'amount')::numeric AS amount, tp.user_id
        FROM jsonb_array_elements(v_ladder) a
        JOIN public.tournament_players tp
          ON tp.tournament_id = p_tournament_id
         AND tp.position = (a->>'place')::integer
       WHERE (a->>'amount')::numeric > 0
       ORDER BY (a->>'place')::integer
    LOOP
      v_result := public.fn_ca_settle_tournament_place_raw(
        p_tournament_id,v_row.place,v_row.user_id,v_row.amount);
      IF COALESCE((v_result->>'fully_settled')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'tournament %, place % returned a partial settlement',
          p_tournament_id, v_row.place USING ERRCODE = 'P0404';
      END IF;
    END LOOP;

    -- tournament_players.prize is presentation cache, stamped only from the
    -- successfully settled DB ladder and in this same transaction.
    UPDATE public.tournament_players SET prize = 0
     WHERE tournament_id = p_tournament_id;
    FOR v_row IN SELECT (a->>'place')::integer AS place,
                         (a->>'amount')::numeric AS amount
                   FROM jsonb_array_elements(v_ladder) a
    LOOP
      UPDATE public.tournament_players SET prize = v_row.amount
       WHERE tournament_id = p_tournament_id AND position = v_row.place;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'could not stamp one prize cache for tournament %, place %',
          p_tournament_id, v_row.place USING ERRCODE = 'P0404';
      END IF;
    END LOOP;

    IF v_bubble_amount > 0 THEN
      UPDATE public.tournament_players
         SET prize = v_bubble_amount
       WHERE tournament_id = p_tournament_id
         AND user_id = v_bubble_user_id
         AND position = v_bubble_place;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION
          'could not stamp one bubble prize cache for tournament %, place %',
          p_tournament_id, v_bubble_place USING ERRCODE = 'P0404';
      END IF;
    END IF;

    IF v_status = 'RUNNING' THEN
      UPDATE public.tournaments SET status = 'COMPLETING'
       WHERE id = p_tournament_id AND status = 'RUNNING';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'tournament % lost its RUNNING finish claim',
          p_tournament_id USING ERRCODE = '55000';
      END IF;
      v_status := 'COMPLETING';
    END IF;
  END IF;

  IF v_bubble_amount > 0 AND v_status = 'COMPLETED' THEN
    -- Exact replay only: the completed preflight above proved this call cannot
    -- move money, while the raw helper proves every durable receipt again.
    v_bubble_result := public.fn_ca_settle_tournament_bubble_raw(
      p_tournament_id, v_bubble_user_id, v_bubble_amount);
  END IF;

  IF v_bubble_amount > 0 AND NOT EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.user_id = v_bubble_user_id
       AND tp.position = v_bubble_place
       AND tp.prize IS NOT DISTINCT FROM v_bubble_amount
  ) THEN
    RAISE EXCEPTION
      'post-settlement bubble prize-cache proof failed for tournament %, place %',
      p_tournament_id, v_bubble_place USING ERRCODE = 'P0404';
  END IF;

  -- Prove the durable end-state and build the presentation-only receipt.
  FOR v_row IN
    SELECT (a->>'place')::integer AS place,
           (a->>'amount')::numeric AS amount, tp.user_id,
           tp.prize AS cached_prize
      FROM jsonb_array_elements(v_ladder) a
      JOIN public.tournament_players tp
        ON tp.tournament_id = p_tournament_id
       AND tp.position = (a->>'place')::integer
     ORDER BY (a->>'place')::integer
  LOOP
    IF v_row.cached_prize IS DISTINCT FROM v_row.amount THEN
      RAISE EXCEPTION 'post-settlement prize-cache proof failed for tournament %, place %',
        p_tournament_id, v_row.place USING ERRCODE = 'P0404';
    END IF;
    IF v_row.amount > 0 THEN
      v_ob := NULL;
      SELECT * INTO v_ob FROM public.tournament_obligations o
       WHERE o.tournament_id = p_tournament_id
         AND o.kind = 'place' AND o.place = v_row.place;
      SELECT COALESCE(sum(p.amount),0) INTO v_evidence
        FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p."position" = v_row.place AND p.user_id = v_row.user_id;
      IF v_ob.id IS NULL OR v_ob.user_id IS DISTINCT FROM v_row.user_id
         OR v_ob.amount_owed IS DISTINCT FROM v_row.amount
         OR v_ob.amount_paid IS DISTINCT FROM v_row.amount
         OR v_evidence IS DISTINCT FROM v_row.amount THEN
        RAISE EXCEPTION 'post-settlement proof failed for tournament %, place %',
          p_tournament_id, v_row.place USING ERRCODE = 'P0404';
      END IF;
    END IF;
    v_payouts := v_payouts || jsonb_build_object(
      'place',v_row.place,'user_id',v_row.user_id,'amount',v_row.amount);
  END LOOP;

  v_original_witness:=smarter_private.breakfast_standings_witness(p_tournament_id,p_observed_winner_id);
  v_original_standings:=COALESCE(smarter_private.spin_original_standings_witness(p_tournament_id,p_observed_winner_id),
      smarter_private.spin_archived_first_standings(p_tournament_id,p_observed_winner_id));
  RETURN jsonb_build_object(
    'ok',true,
    'fully_settled',true,
    'status',v_status,
    'payouts',v_payouts,
    'bubble_protection',CASE WHEN v_bubble_amount > 0 THEN
      jsonb_build_object('user_id',v_bubble_user_id,'position',v_bubble_place,
                         'amount',v_bubble_amount)
      ELSE 'null'::jsonb END,
    'winner_amount',v_winner_amount) || CASE WHEN v_original_witness IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('original_witness',v_original_witness) END || CASE WHEN v_original_standings IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('original_standings',v_original_standings) END;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_escrow_apply(p_tournament_id uuid, p_what text, p_gross_in numeric DEFAULT 0, p_fee_entries_in numeric DEFAULT 0, p_satellite_fee_in numeric DEFAULT 0, p_bounty_in numeric DEFAULT 0, p_overlay_in numeric DEFAULT 0, p_satellite_in numeric DEFAULT 0, p_prize_out numeric DEFAULT 0, p_bounty_out numeric DEFAULT 0, p_fee_out numeric DEFAULT 0, p_refund numeric DEFAULT 0, p_reserve_out numeric DEFAULT 0, p_reserve_in numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.tournament_escrow%ROWTYPE;
  v_spin boolean; e record; v_sat_fee numeric;
  v_prize_in numeric; v_tot numeric; r_p numeric := 0; r_b numeric := 0; r_f numeric := 0;
  v_outflow boolean := COALESCE(p_prize_out, 0) > 0 OR COALESCE(p_bounty_out, 0) > 0 OR COALESCE(p_fee_out, 0) > 0 OR COALESCE(p_refund, 0) > 0;
  r_out numeric := 0; r_in numeric := 0;
  v_sp_prize numeric; v_sp_bounty numeric;
BEGIN
  SELECT * INTO v FROM public.tournament_escrow WHERE tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT (COALESCE(t.variant, '') = 'spin' OR COALESCE(t.is_premium_spin, false)) INTO v_spin
      FROM public.tournaments t WHERE t.id = p_tournament_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    SELECT * INTO e FROM public.fn_ca_tournament_escrow(p_tournament_id);
    SELECT COALESCE(sum(rr.rake_amount), 0) INTO v_sat_fee FROM public.rake_records rr
     WHERE rr.tournament_id = p_tournament_id AND rr.is_tournament AND rr.source = 'fn_award_satellite_seat';
    v_prize_in := e.prize_in; v_tot := e.prize_in + e.satellite_in + e.bounty_in + e.fee_in;
    IF v_tot > 0 THEN
      r_p := round(e.refund_out * (e.prize_in + e.satellite_in) / v_tot, 2);
      r_b := round(e.refund_out * e.bounty_in / v_tot, 2);
    ELSE
      r_p := e.refund_out;
    END IF;
    r_f := round(e.refund_out - r_p - r_b, 2);
    /* PHASE 5.2: a spin's prize bank also moves through the reserve.
       2026-09-07: read from spin_reserve_ledger, not from the chip_ledger
       spin_entry / spin_prize legs it used to read. Those legs are the DERIVED
       record and one pair of them went missing: on 2026-09-06 at 12:50:38 both
       legs of tournament afa045db landed as `adjustment` rows into
       settlement_suspense with a NULL entity, their intended category
       surviving only inside the description text. The escrow therefore never
       learned that 60.00 had been drawn for a 60.00 prize, and
       fn_settle_tournament_obligation refused the winner's last 4.80 as
       escrow_short - for a day, with an open critical alert nobody could act
       on. spin_reserve_ledger is the record the pool balance itself moved by;
       it cannot be missing while the money has moved. Verified across 18,318
       escrow rows: 0 disagree with it, 1 was missing the legs entirely. */
    SELECT COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'contribution'), 0),
           COALESCE(-sum(l.amount) FILTER (WHERE l.kind = 'jackpot_draw'), 0)
      INTO r_out, r_in
      FROM public.spin_reserve_ledger l
     WHERE l.tournament_id = p_tournament_id
       AND l.kind IN ('contribution', 'jackpot_draw');
    INSERT INTO public.tournament_escrow
      (tournament_id, enforced, gross_in, fee_entries_in, satellite_fee_in, bounty_in, overlay_in, satellite_in,
       prize_out, bounty_out, fee_out, refund_prize, refund_bounty, refund_fee, reserve_out, reserve_in,
       prize_balance, bounty_balance, fee_balance, opened_from)
    VALUES
      (p_tournament_id, true,
       round(e.prize_in + e.bounty_in + (e.fee_in - v_sat_fee), 2), round(e.fee_in - v_sat_fee, 2), round(v_sat_fee, 2),
       e.bounty_in, e.overlay_in, e.satellite_in, e.prize_out, e.bounty_out, e.fee_out, r_p, r_b, r_f, round(r_out, 2), round(r_in, 2),
       round(e.prize_balance - r_out + r_in, 2), e.bounty_balance, e.fee_balance,
       'shadow at first sight (' || p_what || ')')
    ON CONFLICT (tournament_id) DO NOTHING;
    RETURN;
  END IF;

  IF COALESCE(p_refund, 0) > 0 THEN
    v_prize_in := v.gross_in - v.fee_entries_in - v.bounty_in + v.satellite_in;
    v_tot := v.gross_in + v.satellite_in + v.satellite_fee_in;
    IF v_tot > 0 THEN
      r_p := round(p_refund * v_prize_in / v_tot, 2);
      r_b := round(p_refund * v.bounty_in / v_tot, 2);
    ELSE
      SELECT s.prize, s.bounty INTO v_sp_prize, v_sp_bounty
        FROM public.tournaments t2
        CROSS JOIN LATERAL public.fn_tournament_entry_split(t2.buy_in_amount, t2.buy_in_fee, t2.bounty_amount,
               COALESCE(t2.is_bounty, false) OR COALESCE(t2.is_pko, false) OR COALESCE(t2.is_mystery_bounty, false)) s
       WHERE t2.id = p_tournament_id;
      IF COALESCE(v_sp_prize, 0) + COALESCE(v_sp_bounty, 0) > 0 THEN
        r_p := round(p_refund * v_sp_prize / (v_sp_prize + v_sp_bounty + (SELECT COALESCE(t3.buy_in_fee, 0) FROM public.tournaments t3 WHERE t3.id = p_tournament_id)), 2);
        r_b := round(p_refund * v_sp_bounty / (v_sp_prize + v_sp_bounty + (SELECT COALESCE(t3.buy_in_fee, 0) FROM public.tournaments t3 WHERE t3.id = p_tournament_id)), 2);
      ELSE
        r_p := p_refund;
      END IF;
    END IF;
    r_f := round(p_refund - r_p - r_b, 2);
  END IF;

  UPDATE public.tournament_escrow
     SET gross_in = gross_in + COALESCE(p_gross_in, 0),
         fee_entries_in = fee_entries_in + COALESCE(p_fee_entries_in, 0),
         satellite_fee_in = satellite_fee_in + COALESCE(p_satellite_fee_in, 0),
         bounty_in = bounty_in + COALESCE(p_bounty_in, 0),
         overlay_in = overlay_in + COALESCE(p_overlay_in, 0),
         satellite_in = satellite_in + COALESCE(p_satellite_in, 0),
         prize_out = prize_out + COALESCE(p_prize_out, 0),
         bounty_out = bounty_out + COALESCE(p_bounty_out, 0),
         fee_out = fee_out + COALESCE(p_fee_out, 0),
         refund_prize = refund_prize + r_p, refund_bounty = refund_bounty + r_b, refund_fee = refund_fee + r_f,
         reserve_out = reserve_out + COALESCE(p_reserve_out, 0), reserve_in = reserve_in + COALESCE(p_reserve_in, 0),
         updated_at = now()
   WHERE tournament_id = p_tournament_id;
  UPDATE public.tournament_escrow
     SET prize_balance  = round((gross_in - fee_entries_in - bounty_in) + overlay_in + satellite_in - reserve_out + reserve_in - prize_out - refund_prize, 2),
         bounty_balance = round(bounty_in - bounty_out - refund_bounty, 2),
         fee_balance    = round(fee_entries_in + satellite_fee_in - fee_out - refund_fee, 2)
   WHERE tournament_id = p_tournament_id
   RETURNING * INTO v;

  IF v.enforced AND v_outflow
     AND (v.prize_balance < -0.005 OR v.bounty_balance < -0.005 OR v.fee_balance < -0.005) THEN
    RAISE EXCEPTION 'escrow_short: tournament % cannot pay this % - it would leave prize %, bounty %, fee % (chip standard Phase 5.1: an event pays only what it holds)',
      p_tournament_id, p_what, v.prize_balance, v.bounty_balance, v.fee_balance
      USING ERRCODE = 'P0403';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_ca_escrow_on_overlay_leg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Explicit rows only: the autoledger twin (description 'auto-ledgered ...')
  -- of the same debit is not a second overlay. None has been written since
  -- the lock trigger was fixed on 09-03; the shadow still skips them.
  IF COALESCE(NEW.description, '') LIKE 'auto-ledgered%' THEN RETURN NULL; END IF;
  PERFORM public.fn_ca_escrow_apply(NEW.to_entity_id, 'overlay', p_overlay_in => round(NEW.amount, 2));
  RETURN NULL;
END;
$function$
;
CREATE TRIGGER overlay_escrow AFTER INSERT ON chip_ledger FOR EACH ROW WHEN (NEW.category='overlay' AND NEW.to_type='prize_liability') EXECUTE FUNCTION fn_ca_escrow_on_overlay_leg();
CREATE TRIGGER start_overlay BEFORE UPDATE OF status ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_ca_fund_overlay_on_lock();
