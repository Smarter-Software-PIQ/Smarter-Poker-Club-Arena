CREATE TEMP TABLE final_census_existing_before AS SELECT * FROM tournaments;
CREATE TEMP TABLE final_census_expected(id uuid, schedule_id uuid, before numeric, after numeric);
INSERT INTO final_census_expected VALUES
 ('571ca6f0-746b-4d7a-803f-847015e05c90'::uuid,'17f0783d-ee08-4c2d-a977-cc42515a86f4'::uuid,500::numeric,250::numeric),
 ('1e6b4fc1-1884-4542-a051-180dab1f2700'::uuid,'bf2420ae-beae-4448-baa1-e0fa1cad4c60'::uuid,500::numeric,250::numeric),
 ('7a0844fe-fba1-4d9a-93e5-ddf07ff9558f'::uuid,'857171b5-4a6f-4e81-b279-f14a8c2d645a'::uuid,1000::numeric,500::numeric),
 ('60165084-54f6-41fe-8e59-79c5594f1007'::uuid,'a70c1028-1200-4000-9000-000000000001'::uuid,2500::numeric,1500::numeric),
 ('b6615477-9668-4a26-878e-e866141e79c5'::uuid,'9e781e73-bc37-400b-a2e9-fb9cef8ff859'::uuid,1000::numeric,500::numeric);
INSERT INTO tournaments(id,schedule_id,name,description,short_description,guaranteed_prize,created_at,start_time) SELECT id,schedule_id,before::text||' GTD',before::text||' Guarantee',before::text||' Chip Guarantee',before,'2026-11-02 06:00+00','2026-11-05 06:00+00' FROM final_census_expected;
