-- Include projected duplicates whose raw PK differs only in source club.
INSERT INTO ca_horse_club_assignments VALUES
('70000000-0000-0000-0000-000000000001','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3');
INSERT INTO ca_horse_fleet_register VALUES
('70000000-0000-0000-0000-000000000002',now()),
('70000000-0000-0000-0000-000000000001',now());
INSERT INTO profiles(id,username,is_horse) VALUES
('70000000-0000-0000-0000-000000000001','Assigned',true),
('70000000-0000-0000-0000-000000000002','Retired',true);
INSERT INTO ca_club_data_fact_ct(club_id,stat_date,kind,game_id,user_id,fee,winnings,last_at,src)
SELECT c, CURRENT_DATE-d, 'TOURNAMENT','00000000-0000-0000-0000-0000000000e1',u,f,w,(CURRENT_DATE-d)::timestamp AT TIME ZONE 'America/Chicago',s
FROM (VALUES
('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,'70000000-0000-0000-0000-000000000001'::uuid,2::numeric,3::numeric,0::smallint),
('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',5,7,0),
('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','70000000-0000-0000-0000-000000000002',11,13,0),
('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','70000000-0000-0000-0000-000000000003',17,-19,0),
('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','70000000-0000-0000-0000-000000000003',23,29,1)
) v(c,u,f,w,s), unnest(ARRAY[0,13,14,27])d;
