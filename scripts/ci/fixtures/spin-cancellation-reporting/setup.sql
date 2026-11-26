-- Minimal inert dependencies: actual production reader bodies execute below.
-- No financial writer is mocked or invoked by this reporting-only proof.
CREATE SCHEMA smarter_private;
CREATE TABLE smarter_private.owner_retirement_pool_transfers(tournament_id uuid,asset text,prize numeric,bounty numeric,refund_fee_reserved numeric);
CREATE TABLE tournaments(id uuid PRIMARY KEY,name text,status text,club_id uuid,union_id uuid,ended_at timestamptz,variant text,tournament_type text,buy_in_amount numeric,buy_in_fee numeric,bounty_amount numeric,is_bounty boolean,is_pko boolean,is_mystery_bounty boolean);
CREATE TABLE clubs(id uuid,asset text,is_platform boolean,union_id uuid);
CREATE TABLE wallet_transactions(related_entity_id uuid,type text,category text,amount numeric,user_id uuid);
CREATE TABLE rake_records(tournament_id uuid,is_tournament boolean,rake_amount numeric,pot_size numeric,source text,metadata jsonb);
CREATE TABLE chip_ledger(id uuid,tournament_id uuid,category text,amount numeric,from_type text,from_entity_id uuid,to_type text,to_entity_id uuid,idempotency_key text,metadata jsonb,created_at timestamptz,description text);
CREATE TABLE tournament_guarantee_overlays(tournament_id uuid,amount numeric);
CREATE TABLE tournament_conservation_baseline(tournament_id uuid,amount numeric);
CREATE TABLE tournament_payouts(id uuid,tournament_id uuid,amount numeric,user_id uuid,source text,position integer,metadata jsonb);
CREATE TABLE tournament_satellite_awards(tournament_id uuid,place integer,payout_id uuid,ticket_id uuid,delivery_kind text);
CREATE TABLE tournament_tickets(id uuid,status text,redeemed_at timestamptz);
CREATE TABLE tournament_rake_settlements(tournament_id uuid,amount numeric,settled_at timestamptz);
CREATE TABLE tournament_refund_tranches(tournament_id uuid,amount_paid_now numeric,refund_prize numeric,refund_bounty numeric,refund_fee numeric);
CREATE TABLE spin_reserve_ledger(tournament_id uuid,kind text,amount numeric);
CREATE TABLE tournament_spin_cancellation_unwinds(tournament_id uuid,original_draw_id uuid);
CREATE FUNCTION fn_ca_midway_free_buy_format(uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
CREATE FUNCTION fn_ca_unit_floor_cents(bigint,bigint) RETURNS bigint LANGUAGE sql AS $$SELECT $1$$;
CREATE FUNCTION fn_ca_recovery_fee_cents(bigint,numeric,bigint) RETURNS bigint LANGUAGE sql AS $$SELECT 0::bigint$$;
CREATE FUNCTION fn_ca_tournament_unit_cents(uuid) RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;
CREATE FUNCTION fn_ca_tournament_fee_ratio(numeric,numeric) RETURNS numeric LANGUAGE sql AS $$SELECT 0::numeric$$;
CREATE FUNCTION fn_poker_diamond_tournament_escrow(uuid) RETURNS TABLE(prize_balance numeric,bounty_balance numeric,fee_balance numeric) LANGUAGE sql AS $$SELECT 7::numeric,2::numeric,1::numeric$$;
