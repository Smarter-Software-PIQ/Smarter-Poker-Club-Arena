-- Isolated participants for the original installed financial RPC and projector.
-- The rake leg gets a real shared row lock. Orthogonal reporting readers have
-- empty native results so only the wager/claim and funding legs are measured.
CREATE SCHEMA smarter_private;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(current_setting('test.claim',true),'service_role')$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION smarter_private.f06_wait_table_lane(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE TABLE clubs(id uuid PRIMARY KEY,asset text);
CREATE TABLE tables(id uuid PRIMARY KEY,club_id uuid REFERENCES clubs,tournament_id uuid);
CREATE TABLE profiles(id uuid PRIMARY KEY);
CREATE TABLE player_stats(id uuid,user_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,club_id uuid,
  total_losses numeric(15,2) DEFAULT 0,updated_at timestamptz,UNIQUE(user_id,club_id));
CREATE TABLE club_members(club_id uuid,user_id uuid,chip_balance numeric DEFAULT 0,
  promo_balance numeric DEFAULT 0,promo_playthrough_required numeric DEFAULT 0,
  promo_wagered numeric DEFAULT 0,updated_at timestamptz,PRIMARY KEY(club_id,user_id));
CREATE TABLE chip_ledger(performed_by uuid,from_type text,from_entity_id uuid,to_type text,to_entity_id uuid,
  amount numeric,category text,club_id uuid,description text,idempotency_key text UNIQUE);
CREATE TABLE chip_transactions(id uuid,club_id uuid,to_user_id uuid,amount numeric,
  transaction_type text,notes text,created_at timestamptz);
CREATE TABLE hand_history(id uuid PRIMARY KEY,table_id uuid,hand_number integer,created_at timestamptz,
  players jsonb,winners jsonb,actions jsonb,tournament_id uuid,big_blind numeric);
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,post_commit_payload jsonb,
  post_commit_payload_hash text,post_commit_result jsonb,post_commit_completed_at timestamptz);
CREATE TABLE hand_projection_outbox(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint);
CREATE TABLE table_pending_addons(id uuid);
CREATE TABLE union_pnl_cash_outcomes(table_id uuid,hand_number bigint,evidence jsonb);
CREATE TABLE shared_wallet(amount numeric);
INSERT INTO shared_wallet VALUES(0);
CREATE FUNCTION atomic_distribute_rake(uuid,uuid,uuid,integer,numeric,numeric,numeric,integer,jsonb,uuid,jsonb,text)
RETURNS TABLE(applied boolean,already_processed boolean,rake_record_id uuid) LANGUAGE plpgsql AS $$
BEGIN UPDATE shared_wallet SET amount=amount+$5; RETURN QUERY SELECT true,false,$3; END $$;
CREATE FUNCTION fn_ca_launch_accounting_accepts(uuid,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION fn_process_hand_position_stats(jsonb,jsonb,jsonb) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION ca_project_hand_stats_facts(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE TABLE ca_hand_player_idx(user_id uuid,created_at timestamptz,hand_id uuid,UNIQUE(user_id,hand_id));
CREATE TABLE ca_hand_player_stat(user_id uuid,hand_id uuid,created_at timestamptz,is_cash boolean,tournament_id uuid,
  game_variant text,big_blind numeric,small_blind numeric,n_players integer,seat_position integer,
  my_blind numeric,won_amt numeric,is_winner boolean,invested_actions numeric,aggro_cnt numeric,
  call_cnt numeric,vpip boolean,pfr boolean,folded boolean,three_bet boolean,three_bet_opp boolean,
  faced_three_bet boolean,folded_to_three_bet boolean,cbet_opp boolean,cbet_made boolean,
  faced_cbet boolean,folded_to_cbet boolean,showdown boolean,hand_secs numeric,profit numeric,
  UNIQUE(user_id,hand_id));
CREATE FUNCTION ca_hand_player_facts_one(uuid,uuid) RETURNS SETOF ca_hand_player_stat LANGUAGE sql AS $$SELECT * FROM ca_hand_player_stat WHERE false$$;
