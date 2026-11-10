SET check_function_bodies=off;
-- Only the new ECO commercial/calculation/record/invoice layer is under test.
-- Existing qualified P&L and earned-rake proof contracts are fixed synthetic
-- boundary inputs, not a claim to requalify the unchanged original week engine.
DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon')THEN CREATE ROLE anon;END IF;IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated')THEN CREATE ROLE authenticated;END IF;IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role')THEN CREATE ROLE service_role;END IF;END$$;
CREATE SCHEMA auth;CREATE SCHEMA smarter_private;CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.uid()RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION auth.role()RETURNS text LANGUAGE sql STABLE AS $$SELECT 'service_role'::text$$;
CREATE FUNCTION public.ca_can_oversee_union(uuid)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT current_setting('test.denied',true)IS DISTINCT FROM 'yes'$$;
CREATE TABLE unions(id uuid PRIMARY KEY,owner_id uuid,name text,description text,settings jsonb);
CREATE TABLE clubs(id uuid PRIMARY KEY,name text,code text,slug text);
CREATE TABLE union_admins(union_id uuid,user_id uuid);
CREATE TABLE union_clubs(union_id uuid,club_id uuid);
CREATE TABLE club_members(club_id uuid,user_id uuid,role text);
CREATE TABLE union_eco_ledger(union_id uuid,club_id uuid,period_start timestamptz,period_end timestamptz,eco_base numeric,eco_rate numeric,eco_amount numeric,eco_base_mode text,cash_players_won numeric,total_rake_generated numeric,rake_earned numeric,club_commission_rate numeric,include_horses boolean,settlement_id uuid,computed_at timestamptz DEFAULT now(),PRIMARY KEY(union_id,club_id,period_start));
CREATE TABLE union_accounting_runs(scope_kind text,scope_id uuid,period_start timestamptz,period_end timestamptz,status text,result jsonb);
CREATE TABLE ca_settlements(settlement_type text,union_id uuid,state text,external_ref text,totals jsonb);
CREATE TABLE settlement_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,union_id uuid,period_number integer,year integer,start_at timestamptz,end_at timestamptz,status text,created_at timestamptz DEFAULT now());
CREATE TABLE settlement_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,period_id uuid,invoice_type text,invoice_number text,from_entity_type text,from_entity_id text,to_entity_type text,to_entity_id text,gross_amount numeric,net_amount numeric,deductions numeric,breakdown jsonb,status text,chips_transferred boolean,due_at timestamptz,notes text,message_sent boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX native_invoice_identity ON settlement_invoices(club_id,period_id,invoice_type)WHERE invoice_type='union_weekly_squareup';
CREATE TABLE union_presettlements(union_id uuid,club_id uuid,amount numeric,received_at timestamptz,applied_settlement_id uuid);
CREATE TABLE union_settlement_floor(union_id uuid,earliest_period_start timestamptz);
CREATE TABLE native_eco_facts(club_id uuid PRIMARY KEY,cash_pnl numeric,tournament_pnl numeric,cash_earned numeric,tournament_earned numeric);
CREATE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION smarter_private.original_inventory_basis_generation()RETURNS text LANGUAGE sql AS $$SELECT 'native-unchanged-financial-proof-contract'::text$$;
CREATE FUNCTION fn_union_eco_terms_evidence(uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','ready','segments',jsonb_build_array(jsonb_build_object('terms',jsonb_build_object('eco_enabled',true,'eco_include_horses',true,'eco_base_mode','club_cash_profit','eco_rate',.1))))$$;
CREATE FUNCTION fn_require_union_pnl_evidence(uuid,timestamptz,timestamptz)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.unqualified',true)='yes'THEN RAISE EXCEPTION 'union_pnl_basis_uncertified';END IF;END$$;
CREATE FUNCTION fn_union_pnl_qualified_clubs(uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN PERFORM fn_require_union_pnl_evidence($1,$2,$3);SELECT jsonb_build_object('report_version',1,'status','ready','basis_certified',true,'issues','[]'::jsonb,'eco_commercial_terms_evidence',fn_union_eco_terms_evidence($1,$2,$3),'clubs',COALESCE(jsonb_agg(jsonb_build_object('club_id',club_id,'cash_player_pnl',cash_pnl,'tournament_player_pnl',tournament_pnl,'rake_earned',cash_earned+tournament_earned,'cash_rake',cash_earned,'tournament_rake',tournament_earned,'rake_paid',cash_earned+tournament_earned,'realized_net',cash_pnl+tournament_pnl,'stack_delta',0,'eco_base',cash_earned+tournament_earned-cash_pnl,'eco_amount',round(-.1*(cash_earned+tournament_earned-cash_pnl),2))ORDER BY club_id),'[]'))INTO r FROM native_eco_facts;RETURN r;END$$;
CREATE FUNCTION fn_union_club_rake_basis(uuid,timestamptz,timestamptz,boolean DEFAULT true)RETURNS TABLE(club_id uuid,game_type text,rake_in numeric,rate numeric,payout numeric)LANGUAGE sql AS $$SELECT club_id,'cash',cash_earned,1::numeric,cash_earned FROM native_eco_facts UNION ALL SELECT club_id,'mtt',tournament_earned,1::numeric,tournament_earned FROM native_eco_facts$$;
CREATE FUNCTION fn_ca_launch_accounting_start(text,uuid,timestamptz)RETURNS timestamptz LANGUAGE sql AS $$SELECT $3$$;
CREATE FUNCTION fn_union_setting(uuid,text,numeric)RETURNS numeric LANGUAGE sql AS $$SELECT $3$$;
CREATE FUNCTION fn_union_prev_week_start(timestamptz)RETURNS timestamptz LANGUAGE sql AS $$SELECT fn_union_week_start($1-interval '7 days')$$;
CREATE FUNCTION fn_next_invoice_number(uuid,timestamptz)RETURNS text LANGUAGE sql AS $$SELECT gen_random_uuid()::text$$;
CREATE FUNCTION fn_deliver_accounting_invoice(uuid)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"delivered":0,"new_deliveries":0}'::jsonb$$;
INSERT INTO unions VALUES('fade0000-0000-0000-0000-000000000001',md5('native owner')::uuid,'Native Union','Original','{"eco_enabled":true,"eco_base_mode":"club_cash_profit","eco_rate":0.10,"eco_include_horses":true,"unrelated":42}');
INSERT INTO clubs VALUES(md5('native club')::uuid,'Native Club','N','native-club');
INSERT INTO union_clubs SELECT 'fade0000-0000-0000-0000-000000000001',id FROM clubs;
INSERT INTO native_eco_facts SELECT id,100,-100,20,50 FROM clubs;
