CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS smarter_private;
ALTER TABLE public.club_members ADD COLUMN status text DEFAULT 'active',ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS club_id uuid;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,asset text,union_id uuid);
CREATE TABLE public.agents(club_id uuid,user_id uuid,agent_wallet_balance numeric DEFAULT 0,promo_wallet_balance numeric DEFAULT 1000,updated_at timestamptz,PRIMARY KEY(club_id,user_id));
CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_horse boolean DEFAULT false);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid,status text DEFAULT 'REGISTERING',start_time timestamptz DEFAULT now(),started_at timestamptz,buy_in_amount numeric DEFAULT 18,buy_in_fee numeric DEFAULT 2,bounty_amount numeric DEFAULT 0,is_bounty boolean DEFAULT false,is_pko boolean DEFAULT false,is_mystery_bounty boolean DEFAULT false,is_free_buy boolean DEFAULT false);
ALTER TABLE public.tournament_players ADD COLUMN registered_at timestamptz DEFAULT now();
ALTER TABLE public.table_seats ADD COLUMN occupancy_id uuid DEFAULT gen_random_uuid(),ADD COLUMN joined_at timestamptz DEFAULT clock_timestamp();
CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,wallet_type text,type text,amount numeric,category text,description text,related_entity_id uuid,table_id uuid,hand_id uuid,balance_after numeric,created_at timestamptz DEFAULT now());
CREATE TABLE public.chip_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,from_user_id uuid,to_user_id uuid,amount numeric,transaction_type text,notes text,balance_after numeric,metadata jsonb,created_at timestamptz DEFAULT now());
ALTER TABLE public.chip_ledger ADD COLUMN IF NOT EXISTS tournament_id uuid,ADD COLUMN IF NOT EXISTS table_id uuid,ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE TABLE public.tournament_tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,issued_by uuid,holder_id uuid,value numeric,note text,status text DEFAULT 'issued',redeemed_at timestamptz,cancelled_at timestamptz,created_at timestamptz DEFAULT now(),redemption_mode text DEFAULT 'wallet_chips',source_tournament_id uuid,source_refund_entitlement_id uuid);
CREATE TABLE public.tournament_ticket_entry_targets(ticket_id uuid PRIMARY KEY,tournament_id uuid,club_id uuid,holder_id uuid,issued_by uuid,value numeric,entry_prize numeric,entry_bounty numeric,entry_fee numeric);
CREATE TABLE public.ca_money_rpc_registry(proname text PRIMARY KEY,status text,notes text);
CREATE TABLE public.tournament_obligations(id uuid PRIMARY KEY,amount_paid numeric,amount_owed numeric);
CREATE TABLE public.tournament_refund_entitlements(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,refund_wallet_club_id uuid,gross numeric,source_ledger_id uuid);
CREATE TABLE smarter_private.free_buy_ticket_days(user_id uuid,gaming_day date,used integer DEFAULT 0,allotment integer DEFAULT 5,PRIMARY KEY(user_id,gaming_day));
CREATE TABLE smarter_private.free_buy_ticket_redemptions(registration_id uuid PRIMARY KEY,user_id uuid,tournament_id uuid,gaming_day date,redeemed_at timestamptz DEFAULT now(),returned_at timestamptz,UNIQUE(user_id,tournament_id));
CREATE FUNCTION smarter_private.free_buy_gaming_day(timestamptz) RETURNS date LANGUAGE sql IMMUTABLE AS $$SELECT $1::date$$;
CREATE FUNCTION public.fn_ca_midway_free_buy_format(uuid) RETURNS text LANGUAGE sql STABLE AS $$SELECT CASE WHEN is_free_buy THEN 'regular' END FROM tournaments WHERE id=$1$$;
CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_tournament(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.fn_ca_tournament_unit_cents(uuid) RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
CREATE FUNCTION public.fn_tournament_club_for_user(uuid,uuid,uuid) RETURNS uuid LANGUAGE sql AS $$SELECT COALESCE($3,(SELECT club_id FROM tournaments WHERE id=$2))$$;
CREATE FUNCTION public.fn_ensure_club_wallet(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM club_members WHERE user_id=$1 AND club_id=$2 AND status='active')$$;
CREATE FUNCTION public.fn_player_home_club(uuid,uuid) RETURNS uuid LANGUAGE sql AS $$SELECT club_id FROM club_members WHERE user_id=$1 LIMIT 1$$;
CREATE FUNCTION public.fn_club_cashier_can_transact(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;

-- Minimal journal adapter only: source money owners remain actual captured
-- functions. This does not claim production tally/autoledger qualification.
CREATE FUNCTION public.promo_ticket_fixture_member_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category text:=current_setting('app.ledger_category',true);counterparty text:=current_setting('app.ledger_counterparty',true);entity uuid:=NULLIF(current_setting('app.ledger_counterparty_entity',true),'')::uuid;
BEGIN
 IF NEW.chip_balance=OLD.chip_balance OR current_setting('fixture.skip_journal',true)='1' THEN RETURN NULL; END IF;
 INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id)
 VALUES(CASE WHEN NEW.chip_balance<OLD.chip_balance THEN 'player_wallet' ELSE counterparty END,
 CASE WHEN NEW.chip_balance<OLD.chip_balance THEN NEW.user_id ELSE entity END,
 CASE WHEN NEW.chip_balance<OLD.chip_balance THEN counterparty ELSE 'player_wallet' END,
 CASE WHEN NEW.chip_balance<OLD.chip_balance THEN entity ELSE NEW.user_id END,
 abs(NEW.chip_balance-OLD.chip_balance),category,NEW.club_id,NULLIF(current_setting('app.ledger_tournament',true),'')::uuid);
 RETURN NULL;
END $$;
CREATE TRIGGER promo_ticket_fixture_member_journal AFTER UPDATE OF chip_balance ON club_members FOR EACH ROW EXECUTE FUNCTION promo_ticket_fixture_member_journal();
CREATE FUNCTION public.promo_ticket_fixture_agent_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category text:=current_setting('app.ledger_category',true);cp text:=current_setting('app.ledger_counterparty',true);entity uuid:=NULLIF(current_setting('app.ledger_counterparty_entity',true),'')::uuid;delta numeric;
BEGIN
 IF current_setting('fixture.skip_journal',true)='1' THEN RETURN NULL; END IF;
 delta:=NEW.agent_wallet_balance-OLD.agent_wallet_balance;
 IF delta<>0 THEN
  INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
  VALUES(CASE WHEN delta<0 THEN 'agent_wallet' ELSE cp END,CASE WHEN delta<0 THEN NEW.user_id ELSE entity END,
   CASE WHEN delta<0 THEN cp ELSE 'agent_wallet' END,CASE WHEN delta<0 THEN entity ELSE NEW.user_id END,abs(delta),category,NEW.club_id);
 END IF;RETURN NULL;
END $$;
CREATE TRIGGER promo_ticket_fixture_agent_journal AFTER UPDATE OF promo_wallet_balance,agent_wallet_balance ON agents FOR EACH ROW EXECUTE FUNCTION promo_ticket_fixture_agent_journal();

CREATE TABLE public.fixture_fee_funding(ledger_id uuid PRIMARY KEY,promo numeric);
CREATE FUNCTION public.fn_ca_promo_capture_entry_funding(uuid,numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO fixture_fee_funding VALUES($1,$2) ON CONFLICT(ledger_id) DO UPDATE SET promo=EXCLUDED.promo;END$$;
CREATE TABLE public.fixture_principal_returns(grant_id uuid,reason text,amount numeric,operation_ref text,UNIQUE(grant_id,operation_ref));
CREATE FUNCTION public.fn_ca_promo_return_principal(uuid,text,text,numeric,text DEFAULT NULL) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE g ca_promo_play_through_grants%ROWTYPE;take numeric;
BEGIN
 SELECT * INTO STRICT g FROM ca_promo_play_through_grants WHERE id=$1;
 IF EXISTS(SELECT 1 FROM fixture_principal_returns WHERE grant_id=$1 AND operation_ref=$5) THEN RETURN 0; END IF;
 take:=fn_ca_promo_move_custody(g.club_id,g.user_id,$2,g.user_id,NULL,NULL,$4,$3);
 INSERT INTO fixture_principal_returns VALUES($1,$3,take,$5);RETURN take;
END$$;

-- Registration adapter deliberately calls the actual patched debit primitive.
-- Full entry/rake contract qualification belongs to its maintained native lane.
CREATE FUNCTION public.fn_register_for_tournament_before_terminal_seat_gate(p_tournament uuid,p_seat_first boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE t tournaments%ROWTYPE;uid uuid:=auth.uid();reg uuid:=gen_random_uuid();cost numeric;
BEGIN
 SELECT * INTO t FROM tournaments WHERE id=p_tournament;cost:=t.buy_in_amount+t.buy_in_fee;
 IF current_setting('fixture.refuse_entry',true)='1' THEN RETURN jsonb_build_object('ok',false,'reason','fixture_registration_refused'); END IF;
 PERFORM set_config('app.ledger_category','tournament_buyin',true);PERFORM set_config('app.ledger_counterparty','prize_liability',true);
 PERFORM set_config('app.ledger_counterparty_entity',p_tournament::text,true);PERFORM set_config('app.ledger_tournament',p_tournament::text,true);
 IF NOT atomic_deduct_wallet_and_log(uid,cost,'tournament_buyin','Entry',NULL,NULL,p_tournament) THEN RETURN jsonb_build_object('ok',false,'reason','insufficient_balance');END IF;
 INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES(reg,p_tournament,uid,'registered');
 RETURN jsonb_build_object('ok',true,'cost',cost,'registration_id',reg);
END$$;
CREATE FUNCTION public.fn_register_horse_for_tournament_before_atomic_lifecycle_gate(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT fn_register_for_tournament_before_terminal_seat_gate($1,false)$$;

-- Lock-only source-fund adapter: this isolated fixture has no club/union fund journal.
CREATE FUNCTION public.fn_ca_promo_lock_grant_funds(uuid[]) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
-- Canonical fee-reversal receipt columns used by prospective custody projection.
ALTER TABLE accounting_tournament_fee_sources ADD COLUMN rake_record_id uuid;
ALTER TABLE rake_records ADD COLUMN source text;
CREATE TABLE tournament_unregistration_receipts(registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
CREATE TABLE tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,total_rake_before numeric,total_rake_after numeric,fees_reversed numeric,fee_reversal_ids uuid[]);

CREATE FUNCTION public.fn_club_bank_role(uuid) RETURNS text LANGUAGE sql AS $$SELECT role FROM public.club_members WHERE club_id=$1 AND user_id=auth.uid()$$;
