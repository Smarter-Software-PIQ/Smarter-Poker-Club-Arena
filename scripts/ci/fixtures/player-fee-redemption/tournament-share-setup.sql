-- Minimal source-receipt shape; production's own synchronous rollup trigger
-- is loaded by the harness, so every future receipt reaches both readers.
CREATE TABLE public.accounting_tournament_fee_sources(club_id uuid,player_id uuid,charged_at timestamptz,rake_credit numeric);
ALTER TABLE public.ca_club_member_tournament_fee_daily ADD COLUMN entries bigint DEFAULT 0, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.ca_club_member_tournament_fee_daily ADD PRIMARY KEY(club_id,user_id,day);
-- The existing fixture already contains this historical daily fee.
INSERT INTO public.accounting_tournament_fee_sources VALUES
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','69f2cefa-017d-49f3-ac3e-61505633747c','2026-10-23 12:00Z',3.50);
ALTER TABLE public.accounting_tournament_fee_sources ADD COLUMN tournament_id uuid DEFAULT '12345678-1000-0000-0000-000000000001';
CREATE TABLE public.tournaments(id uuid,game_type text);
INSERT INTO tournaments VALUES('12345678-1000-0000-0000-000000000001','nlh'),('12345678-1000-0000-0000-000000000002','plo');
CREATE TABLE public.club_member_daily_facts_state(singleton boolean,initialized boolean);
INSERT INTO club_member_daily_facts_state VALUES(true,true);
-- Empty non-fee dependencies isolate the real statistics consumer's fee path.
CREATE FUNCTION public.ca_member_record_chicago_facts(uuid,uuid,date,date)
 RETURNS TABLE(club_id uuid,user_id uuid,game_variant text,hands bigint,wins bigint,vpip_hands bigint,pfr_hands bigint,tb_hands bigint,faced_tb bigint,folded_tb bigint,cb_hands bigint,cb_opps bigint,fees numeric,net numeric,is_mtt boolean,played_on date)
 LANGUAGE sql AS $$ SELECT NULL::uuid,NULL::uuid,NULL::text,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::numeric,0::numeric,false,NULL::date WHERE false $$;
CREATE FUNCTION public.ca_member_record_daily_facts(uuid,uuid,date,date)
 RETURNS TABLE(club_id uuid,user_id uuid,game_variant text,hands bigint)
 LANGUAGE sql AS $$ SELECT NULL::uuid,NULL::uuid,NULL::text,0::bigint WHERE false $$;
CREATE FUNCTION public.ca_club_member_jackpot_money(uuid,uuid,timestamptz,timestamptz,text) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.ca_club_member_tournament_money(uuid,uuid,timestamptz,timestamptz) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE TABLE public.chip_ledger(amount numeric,tournament_id uuid,club_id uuid,to_entity_id uuid,to_type text,from_entity_id uuid,from_type text,status text,created_at timestamptz);
