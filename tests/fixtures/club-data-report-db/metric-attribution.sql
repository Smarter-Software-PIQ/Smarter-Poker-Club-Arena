-- The throwaway database contains an ordinary club, JAQK, and an authenticated owner.
\set kings 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
\set jaqk 'a0000000-0000-0000-0000-000000000001'
\set owner '00000000-0000-0000-0000-0000000000a1'
\set human '00000000-0000-0000-0000-0000000000b1'
\set horse '00000000-0000-0000-0000-0000000000b2'
\set mixed '00000000-0000-0000-0000-0000000000e1'
\set horseonly '00000000-0000-0000-0000-0000000000e2'
\set humanonly '00000000-0000-0000-0000-0000000000e3'
\set felt '00000000-0000-0000-0000-0000000000e4'
INSERT INTO clubs(id,name,owner_id) VALUES (:'kings','Kings',:'owner');
INSERT INTO club_members(club_id,user_id,role,status) VALUES (:'kings',:'owner','owner','active');
UPDATE profiles SET is_horse=true WHERE id=:'horse';
INSERT INTO ca_horse_club_assignments VALUES (:'horse',:'jaqk');
INSERT INTO tables(id,club_id,name,game_variant,big_blind,status)
VALUES (:'horseonly',:'kings','Horse only','nlh',2,'running'),
       (:'humanonly',:'kings','Human only','nlh',2,'running'),
       (:'felt',:'kings','Felt only','nlh',2,'running');
INSERT INTO tournaments(id,club_id,name,tournament_type,status,start_time)
VALUES (:'mixed',:'kings','Mixed entrants','MTT','RUNNING','2026-10-18');
INSERT INTO table_seats(table_id,user_id,club_id,stack,joined_at)
VALUES (:'felt',:'human',:'kings',12,'2026-10-18 17:00Z');
INSERT INTO ca_club_data_fact_ct(club_id,stat_date,kind,game_id,user_id,fee,winnings)
VALUES (:'kings','2026-10-18','TOURNAMENT',:'mixed',:'horse',90,200),
       (:'kings','2026-10-18','TOURNAMENT',:'mixed',:'human',-4,-10),
       (:'kings','2026-10-18','CASH',:'horseonly',:'horse',100,50),
       (:'kings','2026-10-18','CASH',:'humanonly',:'human',6,22);
INSERT INTO ca_club_data_game_ct(club_id,stat_date,kind,game_id,fee,winnings)
SELECT club_id,stat_date,kind,game_id,sum(fee),sum(winnings)
  FROM ca_club_data_fact_ct WHERE club_id=:'kings'
 GROUP BY club_id,stat_date,kind,game_id;
INSERT INTO ca_club_data_hands_ct(club_id,stat_date,table_id,hands)
VALUES (:'kings','2026-10-18',:'horseonly',30),(:'kings','2026-10-18',:'humanonly',10);
