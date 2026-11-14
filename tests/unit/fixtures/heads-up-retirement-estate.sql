-- Disposable relations and representative terminal history for the production unwind.
CREATE TABLE public.club_welcome_package_receipts (club_id uuid, operation_id uuid, actor_id uuid, package_version text, result jsonb, completed_at timestamptz);
CREATE TABLE public.club_welcome_reset_receipts (club_id uuid, operation_id uuid, actor_id uuid, result jsonb, completed_at timestamptz);
CREATE TABLE public.clubs (id uuid, name text, description text, owner_id uuid, is_union boolean, club_id integer, is_public boolean, updated_at timestamptz, union_id uuid, chip_treasury numeric, promo_balance numeric, status text, bbj_enabled boolean, game_type text, bbj_rake_enabled boolean, spins_enabled boolean, lifecycle_status text, retired_at timestamptz, asset text);
CREATE TABLE public.club_welcome_package_items (club_id uuid, slot_key text, entity_kind text, entity_id uuid, retired_at timestamptz, reset_operation_id uuid);
CREATE TABLE public.club_welcome_package_funding (club_id uuid, destination text, amount numeric, balance_after numeric);
CREATE TABLE public.bbj_pools (id uuid, club_id uuid, union_id uuid, updated_at timestamptz, main_balance numeric, backup_balance numeric, promo_balance numeric, status text, total_contributed numeric, total_paid_out numeric, hit_count integer);
CREATE TABLE public.spin_bonus_pools (id uuid, club_id uuid, balance numeric, updated_at timestamptz, seeded_amount numeric, is_active boolean, deactivated_at timestamptz);
CREATE TABLE public.tournament_schedules (id uuid, union_id uuid, club_id uuid, name text, description text, active boolean, updated_at timestamptz);
CREATE TABLE public.tournament_schedule_spawns (id bigint, schedule_id uuid, tournament_id uuid);
CREATE TABLE public.tournaments (id uuid, name text, description text, game_type text, variant text, buy_in_amount numeric, buy_in_fee numeric, status text, current_players integer, max_players integer, starting_chips integer, updated_at timestamptz, club_id uuid, started_at timestamptz, ended_at timestamptz, min_players integer, tournament_type text, union_id uuid, satellite_target uuid, satellite_target_id uuid, table_size integer, schedule_id uuid, restart_source_id uuid);
CREATE TABLE public.tournament_cancellation_receipts (tournament_id uuid, actor_id uuid, source_player_count integer, source_player_ids uuid[], refunded_count integer, refunded_registration_ids uuid[], refund_line_count integer, ticket_return_count integer, ticket_return_ids uuid[], total_ticket_returned numeric, zero_refund_count integer, zero_refund_registration_ids uuid[], total_refunded numeric, fees_reversed numeric, total_rake_before numeric, total_rake_after numeric, source_seat_count integer, source_seat_ids uuid[], released_seat_count integer, fee_reversal_ids uuid[], receipt jsonb);
CREATE TABLE public.tables (id uuid, club_id uuid, name text, game_type text, max_players integer, current_players integer, status text, updated_at timestamptz, tournament_schedule boolean, starting_chips integer, tournament_id uuid, union_id uuid, cluster_id uuid, role text, lifecycle text);
CREATE TABLE public.cash_games (id uuid, club_id uuid, union_id uuid, name text, variant text, enabled boolean, state text, updated_at timestamptz, closed_at timestamptz, closed_by uuid);
CREATE TABLE public.table_seats (id uuid, table_id uuid, user_id uuid, stack numeric, left_at timestamptz, status text, club_id uuid);
CREATE TABLE public.table_sessions (id uuid, table_id uuid, club_id uuid, is_active boolean, left_at timestamptz);
CREATE TABLE public.table_waitlist (id uuid, table_id uuid, user_id uuid, position integer, status text);
CREATE TABLE public.cash_game_waitlist (id uuid, game_id uuid, user_id uuid, status text, updated_at timestamptz);
CREATE TABLE public.tournament_players (id uuid, tournament_id uuid, user_id uuid, chips integer, status text, position integer, table_id uuid, club_id uuid);
CREATE TABLE public.hand_history (id uuid, table_id uuid, tournament_id uuid, source text, seed text, started_at timestamptz, ended_at timestamptz, board jsonb);
CREATE TABLE public.cash_seat_moves (id uuid, game_id uuid, reason text, state text);
CREATE TABLE public.cash_seat_change_requests (id uuid, game_id uuid, user_id uuid, status text);
CREATE TABLE public.managed_game_schedules (schedule_id uuid, actor_id uuid, game_kind text, game_id uuid, status text, result jsonb, completed_at timestamptz);
CREATE TABLE public.bbj_contributions (id uuid, pool_id uuid, club_id uuid, table_id uuid, amount numeric);
CREATE TABLE public.bbj_payouts (id uuid, pool_id uuid, table_id uuid, metadata jsonb);
CREATE TABLE public.wallet_credit_idempotency (key text, user_id uuid, amount numeric);
CREATE TABLE public.wheel_pools (host_id uuid, spins bigint, intake_diamonds numeric, chips_minted numeric, chips_paid numeric, diamonds_paid numeric, updated_at timestamptz);
CREATE TABLE public.diamond_game_pools (host_id uuid, rounds bigint, intake_diamonds numeric, chips_minted numeric, chips_paid numeric, reserved_chips numeric, updated_at timestamptz);
CREATE TABLE public.wheel_configs (host_id uuid, enabled boolean, updated_at timestamptz, updated_by uuid);
CREATE TABLE public.diamond_game_configs (host_id uuid, enabled boolean, updated_at timestamptz, updated_by uuid);
CREATE TABLE public.chip_transactions (id uuid, club_id uuid, amount numeric, transaction_type text, notes text, metadata jsonb, balance_after numeric, table_id uuid);
CREATE TABLE public.club_creation_requests (user_id uuid, club_id uuid);
CREATE TABLE public.union_clubs (id uuid, union_id uuid, club_id uuid);
CREATE TABLE auth.users (id uuid, role character varying, email character varying, updated_at timestamptz);
CREATE TABLE public.club_members (club_id uuid, user_id uuid, role text, notes text, updated_at timestamptz, status text, chip_balance numeric, diamonds integer, is_active boolean, credit_used numeric, promo_balance numeric, locked_chips integer, held_chips numeric);
CREATE TABLE public.agents (id uuid, user_id uuid, club_id uuid, role text, status text, credit_used numeric, promo_balance numeric, updated_at timestamptz);
CREATE TABLE public.tournament_escrow (tournament_id uuid, prize_balance numeric, bounty_balance numeric, fee_balance numeric, updated_at timestamptz, closed_at timestamptz);
CREATE TABLE public.ca_mint_ledger (id uuid, op_id text, action text, asset text, holder_type text, holder_id uuid, amount numeric, balance_before numeric, balance_after numeric, reason text);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION fn_ca_lock_settlement_lane_global() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION fn_tournament_conservation_delta(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION fn_ca_ledger_declaration_save(text[]) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION fn_ca_ledger_declaration_restore(jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION fn_ca_declare_ledger(text,text,uuid,text,text,text[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION fn_spin_deactivate(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$
  UPDATE spin_bonus_pools SET balance=0 WHERE club_id=$1;
  UPDATE clubs SET chip_treasury=chip_treasury+200 WHERE id=$1;
  SELECT jsonb_build_object('seed_returned',200)
$$;
CREATE FUNCTION fn_spin_move_owner_wallet(uuid,text,text,numeric) RETURNS numeric LANGUAGE sql AS $$
  UPDATE clubs SET chip_treasury=chip_treasury+$4 WHERE id=$1 RETURNING chip_treasury
$$;
CREATE FUNCTION atomic_cancel_tournament(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$
  UPDATE tournaments SET status='CANCELLED' WHERE id=$1;
  SELECT jsonb_build_object('ok',true,'fully_settled',true,'status','CANCELLED','tournament_id',$1,'source_player_count',0)
$$;
CREATE FUNCTION fn_club_retirement_impact(uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('wallet_chips',chip_treasury,'open_obligations',0,'diamonds',0,
    'inventory_items',0,'running_tables',0,'active_tournaments',0) FROM clubs WHERE id=$1
$$;
CREATE FUNCTION fn_retire_settled_club(uuid,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF $3='refuse' THEN RETURN jsonb_build_object('success',false); END IF;
  IF NOT EXISTS (SELECT FROM clubs WHERE id=$1 AND owner_id=auth.uid() AND chip_treasury=0) THEN
    RAISE EXCEPTION 'Owner or treasury mismatch';
  END IF;
  UPDATE clubs SET lifecycle_status='retired' WHERE id=$1;
  RETURN jsonb_build_object('success',true);
END $$;

DO $$
DECLARE
  club uuid := '10000000-0000-0000-0000-000000000001';
  actor uuid := gen_random_uuid();
  played uuid := gen_random_uuid();
  sched uuid := gen_random_uuid();
BEGIN
  INSERT INTO clubs(id,name,description,is_public,asset,owner_id,lifecycle_status,chip_treasury)
    VALUES(club,'Cert HU 12345678','Heads-up rematch certification club (reserved certification accounts only)',false,'chips',actor,'active',99699.90);
  INSERT INTO auth.users(id,email) VALUES(actor,'ca-customization-cert-postdeploy-owner@example.invalid');
  INSERT INTO club_members(club_id,user_id,chip_balance,held_chips,locked_chips,credit_used,promo_balance) VALUES(club,actor,0,0,0,0,0);
  INSERT INTO club_creation_requests VALUES(actor,club);
  INSERT INTO club_welcome_package_receipts(club_id,actor_id) VALUES(club,actor);
  INSERT INTO club_welcome_package_funding(club_id,destination,amount) VALUES(club,'bbj_main',100),(club,'spin_reserve',200);
  INSERT INTO bbj_pools(id,club_id,main_balance) VALUES(gen_random_uuid(),club,100);
  INSERT INTO spin_bonus_pools(id,club_id,balance,seeded_amount) VALUES(gen_random_uuid(),club,200,200);
  INSERT INTO tournament_schedules(id,club_id,active) VALUES(sched,club,true);
  INSERT INTO club_welcome_package_items(club_id,slot_key,entity_kind,entity_id) VALUES(club,'daily','tournament_schedule',sched);
  INSERT INTO tournaments(id,name,club_id,status,schedule_id) VALUES(gen_random_uuid(),'Daily 25 Chip Freezeout',club,'REGISTERING',sched);
  INSERT INTO tournaments(id,name,club_id,status,tournament_type,variant,game_type,buy_in_amount,buy_in_fee,
    min_players,max_players,table_size,starting_chips,ended_at) VALUES
    (played,'NLH Heads-Up 1 Turbo',club,'COMPLETED','SNG','sng','NLH',0.95,0.05,2,2,2,300,now()),
    (gen_random_uuid(),'NLH Heads-Up 1 Turbo',club,'REGISTERING','SNG','sng','NLH',0.95,0.05,2,2,2,300,NULL);
  INSERT INTO tournament_players(tournament_id,user_id) VALUES(played,actor);
  INSERT INTO tournament_escrow(tournament_id,prize_balance,bounty_balance,fee_balance) VALUES(played,0,0,0);
  INSERT INTO hand_history(id,tournament_id) VALUES(gen_random_uuid(),played);
  INSERT INTO ca_mint_ledger(op_id,action,asset,holder_type,holder_id,amount,balance_before,balance_after)
    VALUES('club-opening-grant:'||club,'mint','chips','club',club,100000,0,100000);
  INSERT INTO chip_transactions(club_id,transaction_type,amount,balance_after,metadata)
    VALUES(club,'club_opening_grant',100000,100000,jsonb_build_object('mint_op_id','club-opening-grant:'||club));
END $$;
