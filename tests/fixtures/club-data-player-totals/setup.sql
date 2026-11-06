ALTER TABLE profiles ADD COLUMN alias text, ADD COLUMN display_name text, ADD COLUMN first_name text, ADD COLUMN last_name text, ADD COLUMN full_name text;
CREATE TABLE unions(id uuid PRIMARY KEY);
CREATE TABLE ca_horse_club_assignments(horse_id uuid,club_id uuid);
CREATE TABLE ca_club_data_fact_ct(club_id uuid,stat_date date,kind text,game_id uuid,user_id uuid,fee numeric,winnings numeric,last_at timestamptz);
CREATE VIEW ca_stats_club_data_fact_ct AS SELECT f.* FROM ca_club_data_fact_ct f WHERE NOT EXISTS(SELECT 1 FROM ca_horse_club_assignments a WHERE a.horse_id=f.user_id);
CREATE VIEW ca_club_data_game_ct AS SELECT club_id,stat_date,kind,game_id,sum(fee) fee,sum(winnings) winnings FROM ca_club_data_fact_ct GROUP BY club_id,stat_date,kind,game_id;
CREATE FUNCTION fn_ca_club_data_clubs(uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[$1] $$;
CREATE FUNCTION fn_ca_club_data_facts_from() RETURNS date LANGUAGE sql AS $$SELECT '2026-01-01'::date$$;
CREATE FUNCTION fn_arena_name(text,text,text,text,text,text) RETURNS text LANGUAGE sql AS $$SELECT coalesce($1,$2,$3,$4,$5,$6)$$;
CREATE FUNCTION fn_ca_club_data_scope(uuid) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN session_user='postgres' OR auth.uid()='10000000-0000-0000-0000-000000000001'::uuid THEN 'club' WHEN auth.uid()='10000000-0000-0000-0000-000000000003'::uuid THEN 'downline' END $$;
CREATE FUNCTION fn_ca_club_data_downline(uuid,uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY['10000000-0000-0000-0000-000000000002'::uuid] $$;
CREATE FUNCTION ca_club_member_fee_totals(uuid,date,date,uuid) RETURNS TABLE(cash_fees numeric,tournament_fees numeric,total_fees numeric) LANGUAGE sql AS $$SELECT 0::numeric,0::numeric,0::numeric$$;
INSERT INTO clubs VALUES('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','Kings Club','10000000-0000-0000-0000-000000000001');
INSERT INTO profiles(id,username) VALUES('10000000-0000-0000-0000-000000000001','Alice'),('10000000-0000-0000-0000-000000000002','Bob');
INSERT INTO tables(id,club_id,name,game_variant,big_blind,small_blind) VALUES('20000000-0000-0000-0000-000000000001','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','Cash','nlh',2,1);
INSERT INTO tournaments(id,name,tournament_type,status) VALUES
('30000000-0000-0000-0000-000000000001','Finished','MTT','COMPLETED'),
('30000000-0000-0000-0000-000000000002','Running','MTT','RUNNING'),
('30000000-0000-0000-0000-000000000003','Sit And Go','SNG','COMPLETED');
INSERT INTO ca_club_data_fact_ct SELECT 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05',k,g::uuid,u::uuid,f,w,'2026-11-05T18:00:00Z' FROM (VALUES
('CASH','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1.234::numeric,-100::numeric),
('CASH','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',2.345,50),
('TOURNAMENT','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',4,70),
('TOURNAMENT','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',4,-20),
('TOURNAMENT','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',2,-30),
('TOURNAMENT','30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',1,10),
('CASH','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',0.5,0),
('CASH','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',500,500)
) v(k,g,u,f,w);
INSERT INTO ca_horse_club_assignments VALUES('10000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001');
INSERT INTO table_seats(table_id,user_id,club_id,stack,joined_at) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',80,'2026-11-06T05:59:00Z');
