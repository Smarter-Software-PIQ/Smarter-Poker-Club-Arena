-- A = dealt in, B = not dealt in. T = table. Hand 10 fresh, 11 two days old.
INSERT INTO rabbit_hunt_offers(table_id,hand_number,cards,board_len,eligible_user_ids,created_at) VALUES
 ('11111111-1111-1111-1111-111111111111',10,'["Ah","Kd"]',3,ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid],now()-interval '5 minutes'),
 ('11111111-1111-1111-1111-111111111111',11,'["2c","3c","4c"]',2,ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid],now()-interval '2 days');
