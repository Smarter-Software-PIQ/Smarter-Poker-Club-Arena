ALTER TABLE tournaments ADD COLUMN created_at timestamptz;
CREATE TEMP TABLE delayed_existing_before AS SELECT * FROM tournaments;
CREATE TEMP TABLE delayed_expected(id uuid, schedule_id uuid, before numeric, after numeric);
INSERT INTO delayed_expected VALUES
 ('b84fcc96-cf94-4b94-a76b-329d80a7f555','6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78',500,250),
 ('ce952f30-825a-4080-acd0-aa83a4503855','b9c31f19-70df-4b5c-9e8a-04ebaa945f61',250,125),
 ('5435baf9-b626-4a94-8282-e927f02fc30a','207585bc-9ff4-4abe-ad91-cfd1a4bd486c',500,250),
 ('aaf3a0ac-81ba-4b68-8d2d-a9ae75095f72','496fe7e6-28a9-4383-9038-692fcf48fa0a',500,250),
 ('930eee14-faaf-43cf-8f4a-bd8a92c48fd6','a4e5ac92-019f-415a-b4c4-fb95bc037ecc',250,125),
 ('2e51996a-a226-4b0d-8def-4931aa9d4a9c','e6953809-af43-4397-a15c-4ea2ce50aa14',500,250),
 ('4b07b775-26d9-471d-bfd0-fd3f3e86817a','2392cd18-8604-41cc-8037-bcd17c57d2d2',500,250);
INSERT INTO tournaments(id,schedule_id,name,description,short_description,guaranteed_prize,created_at,start_time) SELECT id,schedule_id,before::text||' GTD',before::text||' Guarantee',before::text||' Chip Guarantee',before,'2026-11-02 06:00+00','2026-11-05 06:00+00' FROM delayed_expected;
