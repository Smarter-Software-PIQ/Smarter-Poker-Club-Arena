CREATE TEMP TABLE pre_adoption_existing_before AS SELECT * FROM tournaments;
CREATE TEMP TABLE pre_adoption_expected(id uuid, schedule_id uuid, before numeric, after numeric);
INSERT INTO pre_adoption_expected VALUES
 ('4b235295-d4d9-4f8c-b1b4-e5f2fc195dc2'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),
 ('6eb99ddf-8e57-4b39-8a30-9151dbcaa350'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric),
 ('dea1331d-a6d2-4163-9f0a-8291607b427e'::uuid,'e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid,1500::numeric,750::numeric);
INSERT INTO tournaments(id,schedule_id,name,description,short_description,guaranteed_prize,created_at,start_time) SELECT id,schedule_id,before::text||' GTD',before::text||' Guarantee',before::text||' Chip Guarantee',before,'2026-11-02 06:00+00','2026-11-05 06:00+00' FROM pre_adoption_expected;
