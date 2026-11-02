-- Owner November 1: halve future guarantees except the 200 entry / 25K event.
-- Complete the finite set of old-engine rows present at installation while its permanent source
-- policy is deploying. These 81 schedule IDs and original amounts were captured
-- from 136 actual instances; every schedule had exactly one original amount.
-- This is an explicit rollout migration, not a trigger, timer or repair loop.
-- Match original amounts only: already-reduced new-engine rows stay unchanged.
-- Preserve commitments, other schedules, other creation dates and prior starts.
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t JOIN (VALUES  ('01e8c884-bf85-4671-9694-22a1c1471df6'::uuid, 1500::numeric),  ('02c9209a-eb36-4baf-9bca-b698d3d2f99d'::uuid, 2000::numeric),  ('0806f658-7e4f-41aa-913c-a34cf5d46ef2'::uuid, 10000::numeric),  ('099ac5a4-c866-4acb-917c-31337bf468b1'::uuid, 10000::numeric),  ('0a7c1c01-2996-4bb8-a81b-a24945987dfc'::uuid, 500::numeric),  ('0accc4e1-f7c1-4538-ad90-426f26785bcd'::uuid, 5000::numeric),  ('0f115fe4-f53b-46ff-9564-760ddf5c578c'::uuid, 2500::numeric),  ('12326fad-0b14-4dd1-83db-9fa5263ee9a9'::uuid, 500::numeric),  ('146f0820-7a56-4f9b-87bc-64a442fbb838'::uuid, 5000::numeric),  ('147914a8-fc02-4e14-a241-55586f88e186'::uuid, 5000::numeric),  ('17f0783d-ee08-4c2d-a977-cc42515a86f4'::uuid, 500::numeric),  ('1ad3dea7-8d60-4264-b917-284a6fdce1d0'::uuid, 1000::numeric),  ('1c2efa3f-dd71-42cb-ba7d-a4ab334998d1'::uuid, 25000::numeric),  ('1e52edae-3294-4782-b36f-71bf566a433d'::uuid, 5000::numeric),  ('205c4cd8-092c-45ae-ab56-75510eae38b4'::uuid, 5000::numeric),  ('20e8f361-c25b-4d99-998c-aa8009f41cf7'::uuid, 15000::numeric),  ('21dbfd33-83f3-4383-8136-6eae472652fb'::uuid, 2500::numeric),  ('2392cd18-8604-41cc-8037-bcd17c57d2d2'::uuid, 500::numeric),  ('23f7a9ff-914a-4d3e-b803-928671f775fa'::uuid, 500::numeric),  ('26f8799c-af83-4cc6-bc4e-c1bb3d4bad8c'::uuid, 50000::numeric),  ('294809bd-2ea8-453b-8e46-abfa8a2124da'::uuid, 2000::numeric),  ('296696e7-7789-44f7-85bc-35b2911ef5cd'::uuid, 3000::numeric),  ('393a9e29-c41f-466b-b057-51c370a0b160'::uuid, 1000::numeric),  ('39518fc3-ee0b-4e45-83ae-3619aa9a5c07'::uuid, 500::numeric),  ('4079a99b-8525-4728-87aa-4b592102d95f'::uuid, 500::numeric),  ('448ff340-b6bf-49f0-879b-b628113fc682'::uuid, 250::numeric),  ('451dee66-dd4b-4985-9e95-ea9f0d65c061'::uuid, 5000::numeric),  ('476297c0-adfc-412d-a055-9707c8513d78'::uuid, 500::numeric),  ('478200f3-3ea8-48d0-b401-fe8dbd314ae1'::uuid, 1500::numeric),  ('4959bcbf-ad19-4d4f-ba17-6c7e0cea1ce5'::uuid, 10000::numeric),  ('496fe7e6-28a9-4383-9038-692fcf48fa0a'::uuid, 500::numeric),  ('4e2ef56a-ae1a-4c43-86ea-eeedcca7c79a'::uuid, 10000::numeric),  ('4e5de2f8-32bd-44fe-8d02-af062fde992b'::uuid, 10000::numeric),  ('4eb5a3da-6b25-4142-94fe-03b2c8a6ddbe'::uuid, 500::numeric),  ('4fff52fc-2d42-401c-8eb8-09ff268645e3'::uuid, 1500::numeric),  ('574129d4-2592-4732-856e-144bb51bc9f4'::uuid, 2000::numeric),  ('594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid, 500::numeric),  ('5e039757-7396-41db-a92d-90bce0e31c6e'::uuid, 500::numeric),  ('6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid, 500::numeric),  ('6bf5847d-df18-4929-aeb1-bd827f5937b6'::uuid, 3000::numeric),  ('6d29a252-9b04-4f68-9fec-d2fdc0ed0e5f'::uuid, 500::numeric),  ('7a6fcff5-6864-42d7-992a-f9f56a6fd40f'::uuid, 500::numeric),  ('7c598e39-8629-4801-be60-12ff7ff951c4'::uuid, 15000::numeric),  ('7f65be03-8bdf-44eb-babc-5a30eb302f01'::uuid, 500::numeric),  ('8203e2cd-2198-48e3-970f-1d85766e4024'::uuid, 5000::numeric),  ('8490b5a9-d0ab-41cb-a541-94fb54105a0a'::uuid, 500::numeric),  ('857171b5-4a6f-4e81-b279-f14a8c2d645a'::uuid, 1000::numeric),  ('85e1c4bc-6594-4a42-8a63-34ba1c635c70'::uuid, 5000::numeric),  ('89000903-a7fd-41fe-b8a9-308f69773fe7'::uuid, 250::numeric),  ('8a6d9be2-0fee-4f9a-af9d-901e573159f3'::uuid, 5000::numeric),  ('8dfbf0bd-ff1c-47e0-9ded-a7068b817e00'::uuid, 500::numeric),  ('9227156c-351b-4c02-b1ba-23f2269bf318'::uuid, 500::numeric),  ('92af3d78-5a4c-4226-878e-fdf0bfd51db2'::uuid, 2000::numeric),  ('93d5d4be-fad3-4920-baaa-2b07f0d16f6c'::uuid, 500::numeric),  ('95091bcf-72e8-4bbc-8fc0-5aaaa4aba45b'::uuid, 1000::numeric),  ('9a1b9e88-0bee-4f24-a0b6-f4dee36be24b'::uuid, 500::numeric),  ('9b222ac6-cdf5-48d6-b08c-5a8f57eb7b3c'::uuid, 1500::numeric),  ('9d0977ec-5f30-4a28-9beb-fa8e96cafe79'::uuid, 500::numeric),  ('9e781e73-bc37-400b-a2e9-fb9cef8ff859'::uuid, 1000::numeric),  ('a08d4e13-d429-410b-98a2-21a2d1916ad6'::uuid, 2000::numeric),  ('a4e5ac92-019f-415a-b4c4-fb95bc037ecc'::uuid, 250::numeric),  ('a70c1028-1200-4000-9000-000000000001'::uuid, 2500::numeric),  ('a70c1028-1600-4000-9000-000000000001'::uuid, 5000::numeric),  ('a70c1028-2000-4000-9000-000000000001'::uuid, 5000::numeric),  ('b14c7932-f32b-4481-9106-3e78b14623c6'::uuid, 1000::numeric),  ('b410b2e5-053b-40c6-8379-fd43651c824d'::uuid, 10000::numeric),  ('b66e1981-aad5-4aef-9d60-6a081d76250e'::uuid, 1500::numeric),  ('b9c31f19-70df-4b5c-9e8a-04ebaa945f61'::uuid, 250::numeric),  ('bf2420ae-beae-4448-baa1-e0fa1cad4c60'::uuid, 500::numeric),  ('c7c8d9f5-c2dc-47ac-8832-adf4c574419c'::uuid, 2000::numeric),  ('ccb6164a-2db4-400a-8ee0-b6607e880f4e'::uuid, 2500::numeric),  ('cf550599-d0b5-4c77-a028-fc9572be0b56'::uuid, 20000::numeric),  ('d03bfe5d-0c3b-4383-b00b-cf1390df8df1'::uuid, 20000::numeric),  ('d5680451-7f90-4ea3-afb2-a0b88b874b92'::uuid, 2000::numeric),  ('df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid, 500::numeric),  ('df902aca-962f-40f6-a2aa-431e0badf5b2'::uuid, 20000::numeric),  ('e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid, 1500::numeric),  ('e87e6a9c-cacb-4a5e-87b1-bb2c324f7fb6'::uuid, 5000::numeric),  ('f18b03fa-736f-4db7-927d-61804ec51a2d'::uuid, 5000::numeric),  ('f47d91ec-a576-40f5-99cb-cd9bd760d153'::uuid, 500::numeric),  ('f62b4f5e-9cdb-4be3-b96a-2512b8435ce7'::uuid, 500::numeric)) b(schedule_id,old_guarantee) ON t.schedule_id=b.schedule_id WHERE t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee  AND t.created_at >= '2026-11-02 02:31:00+00'::timestamptz   AND t.start_time >= '2026-11-02 06:00:00+00'::timestamptz  AND upper(t.status) IN ('ANNOUNCED','REGISTERING')  AND NOT coalesce(t.prize_pool_finalized,false)  AND NOT coalesce(t.entry_contract_locked,false)  AND NOT (coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=200 AND t.guaranteed_prize=25000)  AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id))
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION pg_temp.reduced_guarantee_copy(p_text text, p_before numeric, p_after numeric)
RETURNS text LANGUAGE plpgsql AS $copy$
DECLARE result text := p_text; old_label text; new_label text; suffix text; i integer;
BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 FOR i IN 1..2 LOOP
  old_label := trim_scale(CASE WHEN i=1 AND p_before>=1000 THEN p_before/1000 ELSE p_before END)::text || CASE WHEN i=1 AND p_before>=1000 THEN 'K' ELSE '' END;
  new_label := trim_scale(CASE WHEN i=1 AND p_after>=1000 THEN p_after/1000 ELSE p_after END)::text || CASE WHEN i=1 AND p_after>=1000 THEN 'K' ELSE '' END;
  FOREACH suffix IN ARRAY ARRAY[' GTD',' Guarantee',' Chip Guarantee',' Diamond Guarantee'] LOOP
   result := regexp_replace(result, '(^|[^0-9.])' || replace(old_label,'.','\.') || suffix, '\1' || new_label || suffix, 'g');
  END LOOP;
  result := replace(result,'Nightly '||old_label,'Nightly '||new_label);
 END LOOP;
 RETURN result;
END $copy$;

WITH baseline(schedule_id, old_guarantee) AS (VALUES
 ('01e8c884-bf85-4671-9694-22a1c1471df6'::uuid, 1500::numeric),
 ('02c9209a-eb36-4baf-9bca-b698d3d2f99d'::uuid, 2000::numeric),
 ('0806f658-7e4f-41aa-913c-a34cf5d46ef2'::uuid, 10000::numeric),
 ('099ac5a4-c866-4acb-917c-31337bf468b1'::uuid, 10000::numeric),
 ('0a7c1c01-2996-4bb8-a81b-a24945987dfc'::uuid, 500::numeric),
 ('0accc4e1-f7c1-4538-ad90-426f26785bcd'::uuid, 5000::numeric),
 ('0f115fe4-f53b-46ff-9564-760ddf5c578c'::uuid, 2500::numeric),
 ('12326fad-0b14-4dd1-83db-9fa5263ee9a9'::uuid, 500::numeric),
 ('146f0820-7a56-4f9b-87bc-64a442fbb838'::uuid, 5000::numeric),
 ('147914a8-fc02-4e14-a241-55586f88e186'::uuid, 5000::numeric),
 ('17f0783d-ee08-4c2d-a977-cc42515a86f4'::uuid, 500::numeric),
 ('1ad3dea7-8d60-4264-b917-284a6fdce1d0'::uuid, 1000::numeric),
 ('1c2efa3f-dd71-42cb-ba7d-a4ab334998d1'::uuid, 25000::numeric),
 ('1e52edae-3294-4782-b36f-71bf566a433d'::uuid, 5000::numeric),
 ('205c4cd8-092c-45ae-ab56-75510eae38b4'::uuid, 5000::numeric),
 ('20e8f361-c25b-4d99-998c-aa8009f41cf7'::uuid, 15000::numeric),
 ('21dbfd33-83f3-4383-8136-6eae472652fb'::uuid, 2500::numeric),
 ('2392cd18-8604-41cc-8037-bcd17c57d2d2'::uuid, 500::numeric),
 ('23f7a9ff-914a-4d3e-b803-928671f775fa'::uuid, 500::numeric),
 ('26f8799c-af83-4cc6-bc4e-c1bb3d4bad8c'::uuid, 50000::numeric),
 ('294809bd-2ea8-453b-8e46-abfa8a2124da'::uuid, 2000::numeric),
 ('296696e7-7789-44f7-85bc-35b2911ef5cd'::uuid, 3000::numeric),
 ('393a9e29-c41f-466b-b057-51c370a0b160'::uuid, 1000::numeric),
 ('39518fc3-ee0b-4e45-83ae-3619aa9a5c07'::uuid, 500::numeric),
 ('4079a99b-8525-4728-87aa-4b592102d95f'::uuid, 500::numeric),
 ('448ff340-b6bf-49f0-879b-b628113fc682'::uuid, 250::numeric),
 ('451dee66-dd4b-4985-9e95-ea9f0d65c061'::uuid, 5000::numeric),
 ('476297c0-adfc-412d-a055-9707c8513d78'::uuid, 500::numeric),
 ('478200f3-3ea8-48d0-b401-fe8dbd314ae1'::uuid, 1500::numeric),
 ('4959bcbf-ad19-4d4f-ba17-6c7e0cea1ce5'::uuid, 10000::numeric),
 ('496fe7e6-28a9-4383-9038-692fcf48fa0a'::uuid, 500::numeric),
 ('4e2ef56a-ae1a-4c43-86ea-eeedcca7c79a'::uuid, 10000::numeric),
 ('4e5de2f8-32bd-44fe-8d02-af062fde992b'::uuid, 10000::numeric),
 ('4eb5a3da-6b25-4142-94fe-03b2c8a6ddbe'::uuid, 500::numeric),
 ('4fff52fc-2d42-401c-8eb8-09ff268645e3'::uuid, 1500::numeric),
 ('574129d4-2592-4732-856e-144bb51bc9f4'::uuid, 2000::numeric),
 ('594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid, 500::numeric),
 ('5e039757-7396-41db-a92d-90bce0e31c6e'::uuid, 500::numeric),
 ('6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid, 500::numeric),
 ('6bf5847d-df18-4929-aeb1-bd827f5937b6'::uuid, 3000::numeric),
 ('6d29a252-9b04-4f68-9fec-d2fdc0ed0e5f'::uuid, 500::numeric),
 ('7a6fcff5-6864-42d7-992a-f9f56a6fd40f'::uuid, 500::numeric),
 ('7c598e39-8629-4801-be60-12ff7ff951c4'::uuid, 15000::numeric),
 ('7f65be03-8bdf-44eb-babc-5a30eb302f01'::uuid, 500::numeric),
 ('8203e2cd-2198-48e3-970f-1d85766e4024'::uuid, 5000::numeric),
 ('8490b5a9-d0ab-41cb-a541-94fb54105a0a'::uuid, 500::numeric),
 ('857171b5-4a6f-4e81-b279-f14a8c2d645a'::uuid, 1000::numeric),
 ('85e1c4bc-6594-4a42-8a63-34ba1c635c70'::uuid, 5000::numeric),
 ('89000903-a7fd-41fe-b8a9-308f69773fe7'::uuid, 250::numeric),
 ('8a6d9be2-0fee-4f9a-af9d-901e573159f3'::uuid, 5000::numeric),
 ('8dfbf0bd-ff1c-47e0-9ded-a7068b817e00'::uuid, 500::numeric),
 ('9227156c-351b-4c02-b1ba-23f2269bf318'::uuid, 500::numeric),
 ('92af3d78-5a4c-4226-878e-fdf0bfd51db2'::uuid, 2000::numeric),
 ('93d5d4be-fad3-4920-baaa-2b07f0d16f6c'::uuid, 500::numeric),
 ('95091bcf-72e8-4bbc-8fc0-5aaaa4aba45b'::uuid, 1000::numeric),
 ('9a1b9e88-0bee-4f24-a0b6-f4dee36be24b'::uuid, 500::numeric),
 ('9b222ac6-cdf5-48d6-b08c-5a8f57eb7b3c'::uuid, 1500::numeric),
 ('9d0977ec-5f30-4a28-9beb-fa8e96cafe79'::uuid, 500::numeric),
 ('9e781e73-bc37-400b-a2e9-fb9cef8ff859'::uuid, 1000::numeric),
 ('a08d4e13-d429-410b-98a2-21a2d1916ad6'::uuid, 2000::numeric),
 ('a4e5ac92-019f-415a-b4c4-fb95bc037ecc'::uuid, 250::numeric),
 ('a70c1028-1200-4000-9000-000000000001'::uuid, 2500::numeric),
 ('a70c1028-1600-4000-9000-000000000001'::uuid, 5000::numeric),
 ('a70c1028-2000-4000-9000-000000000001'::uuid, 5000::numeric),
 ('b14c7932-f32b-4481-9106-3e78b14623c6'::uuid, 1000::numeric),
 ('b410b2e5-053b-40c6-8379-fd43651c824d'::uuid, 10000::numeric),
 ('b66e1981-aad5-4aef-9d60-6a081d76250e'::uuid, 1500::numeric),
 ('b9c31f19-70df-4b5c-9e8a-04ebaa945f61'::uuid, 250::numeric),
 ('bf2420ae-beae-4448-baa1-e0fa1cad4c60'::uuid, 500::numeric),
 ('c7c8d9f5-c2dc-47ac-8832-adf4c574419c'::uuid, 2000::numeric),
 ('ccb6164a-2db4-400a-8ee0-b6607e880f4e'::uuid, 2500::numeric),
 ('cf550599-d0b5-4c77-a028-fc9572be0b56'::uuid, 20000::numeric),
 ('d03bfe5d-0c3b-4383-b00b-cf1390df8df1'::uuid, 20000::numeric),
 ('d5680451-7f90-4ea3-afb2-a0b88b874b92'::uuid, 2000::numeric),
 ('df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid, 500::numeric),
 ('df902aca-962f-40f6-a2aa-431e0badf5b2'::uuid, 20000::numeric),
 ('e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid, 1500::numeric),
 ('e87e6a9c-cacb-4a5e-87b1-bb2c324f7fb6'::uuid, 5000::numeric),
 ('f18b03fa-736f-4db7-927d-61804ec51a2d'::uuid, 5000::numeric),
 ('f47d91ec-a576-40f5-99cb-cd9bd760d153'::uuid, 500::numeric),
 ('f62b4f5e-9cdb-4be3-b96a-2512b8435ce7'::uuid, 500::numeric)
)
UPDATE public.tournaments t
SET guaranteed_prize = round(b.old_guarantee / 2, 2),
    name = pg_temp.reduced_guarantee_copy(t.name,b.old_guarantee,round(b.old_guarantee/2,2)),
    description = pg_temp.reduced_guarantee_copy(t.description,b.old_guarantee,round(b.old_guarantee/2,2)),
    short_description = pg_temp.reduced_guarantee_copy(t.short_description,b.old_guarantee,round(b.old_guarantee/2,2))
FROM baseline b
WHERE t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee
 AND t.created_at >= '2026-11-02 02:31:00+00'::timestamptz

 AND t.start_time >= '2026-11-02 06:00:00+00'::timestamptz
 AND upper(t.status) IN ('ANNOUNCED','REGISTERING')
 AND NOT coalesce(t.prize_pool_finalized,false)
 AND NOT coalesce(t.entry_contract_locked,false)
 AND NOT (coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=200 AND t.guaranteed_prize=25000)
 AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id);
COMMIT;
