-- Complete final guarantee terms for captured exact instances created by the
-- old engine while its replacement was blocked. The permanent producer fix is
-- TournamentGuaranteePolicy.ts (protected PRs 9264 and 9296).
-- Preserve the final nightly 10K, 1.5K, Six-Card 500 and 200-entry/25K terms.
-- Exact IDs, schedule identities and original amounts make this finite and
-- idempotent. No wallet, payout, tournament participation or schedule edits.
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t JOIN (VALUES  ('4b235295-d4d9-4f8c-b1b4-e5f2fc195dc2'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),  ('6eb99ddf-8e57-4b39-8a30-9151dbcaa350'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric),  ('dea1331d-a6d2-4163-9f0a-8291607b427e'::uuid,'e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid,1500::numeric,750::numeric),  ('9b3bb8b5-d53a-4767-abcb-b3e50d5e5a1e'::uuid,'b14c7932-f32b-4481-9106-3e78b14623c6'::uuid,1000::numeric,500::numeric),  ('9c02af53-41f9-42b4-b13b-92a12a3163d1'::uuid,'047e6702-90de-4045-a6a6-7b05263d4ee6'::uuid,500::numeric,250::numeric),  ('96a8dce3-d1a4-4b7e-a17d-6aed923c5412'::uuid,'393a9e29-c41f-466b-b057-51c370a0b160'::uuid,1000::numeric,500::numeric),  ('c5698c57-9a06-4213-97de-2f1189985599'::uuid,'a70c1028-1600-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),  ('ead07649-6cdf-4e61-bd62-7de0daec1d8a'::uuid,'147914a8-fc02-4e14-a241-55586f88e186'::uuid,5000::numeric,2500::numeric),  ('efc9fac3-e855-4c1f-8493-bc50924990f1'::uuid,'95091bcf-72e8-4bbc-8fc0-5aaaa4aba45b'::uuid,1000::numeric,500::numeric),  ('5022c4f0-04d3-4325-8b1f-303fee1f6ac7'::uuid,'ccb6164a-2db4-400a-8ee0-b6607e880f4e'::uuid,2500::numeric,1500::numeric),  ('61dd067b-5d15-47c3-9875-dd42322ae39e'::uuid,'02c9209a-eb36-4baf-9bca-b698d3d2f99d'::uuid,2000::numeric,1000::numeric),  ('32434bd6-ec1d-458b-b94e-96019b29d01e'::uuid,'4507f521-ec9a-4bb0-b634-eefee9cbfe18'::uuid,1500::numeric,750::numeric),  ('ed02ec14-cb84-4441-99c4-01c2e0e00a66'::uuid,'a70c1028-2000-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),  ('22ca8fa1-2522-425e-b71b-b67379b09c65'::uuid,'f1610468-286e-43bb-914a-7ad2067cfe37'::uuid,2500::numeric,1500::numeric),  ('bd3e878a-4439-4504-b9a7-4ea2b663cf72'::uuid,'478200f3-3ea8-48d0-b401-fe8dbd314ae1'::uuid,1500::numeric,750::numeric),  ('c0b77808-07ee-4b8d-b3e0-3c47e7380adc'::uuid,'27a215fa-420a-4e10-b03a-033317d5e556'::uuid,2000::numeric,1000::numeric),  ('4aaef0ed-327e-46a6-9fae-e467fc53859b'::uuid,'b66e1981-aad5-4aef-9d60-6a081d76250e'::uuid,1500::numeric,750::numeric),  ('7d210de4-936c-4773-8ec3-01741215c64a'::uuid,'1ad3dea7-8d60-4264-b917-284a6fdce1d0'::uuid,1000::numeric,500::numeric),  ('b6c06429-14b3-4b87-96ae-8992a1636914'::uuid,'6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid,500::numeric,250::numeric),  ('297875f5-36da-46e4-992c-990b084a35c7'::uuid,'496fe7e6-28a9-4383-9038-692fcf48fa0a'::uuid,500::numeric,250::numeric),  ('6344c90c-f4fb-4bd6-89fe-b3688c50362b'::uuid,'bb6338d1-a3e4-4f53-b6d7-e3dd556dcf0c'::uuid,500::numeric,250::numeric),  ('20adeee3-f118-4843-bc27-75a4dc437a8c'::uuid,'2392cd18-8604-41cc-8037-bcd17c57d2d2'::uuid,500::numeric,250::numeric),  ('db3dac3a-1e51-4571-b622-2f5a07d96db6'::uuid,'17f0783d-ee08-4c2d-a977-cc42515a86f4'::uuid,500::numeric,250::numeric),  ('17b1dd81-89db-43f6-acaf-e6d8c2d2df4c'::uuid,'bf2420ae-beae-4448-baa1-e0fa1cad4c60'::uuid,500::numeric,250::numeric),  ('b50c136d-b969-4ff7-85d6-dbb2ced21ab7'::uuid,'857171b5-4a6f-4e81-b279-f14a8c2d645a'::uuid,1000::numeric,500::numeric),  ('2b3a8bab-1fc5-44bf-953e-4acf9a0152c8'::uuid,'a70c1028-1200-4000-9000-000000000001'::uuid,2500::numeric,1500::numeric),  ('3efc584a-5dcf-4ae3-ade0-40a2b4f9f22b'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),  ('4f11d60c-a162-4929-8aa6-5b7f51aeca6c'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric),  ('b6fe0031-9de5-4802-b7e0-73038ca1784c'::uuid,'e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid,1500::numeric,750::numeric),  ('ed36effc-2e92-44ec-aa39-8f4d4c90cb59'::uuid,'b14c7932-f32b-4481-9106-3e78b14623c6'::uuid,1000::numeric,500::numeric),  ('6a670a80-614e-4f3c-b180-890d65bdc2ab'::uuid,'3d45dab2-7c54-4ca7-a83d-a6690fd6981a'::uuid,1000::numeric,500::numeric),  ('90ec79b5-e267-4725-b377-e2129de6f5e7'::uuid,'574129d4-2592-4732-856e-144bb51bc9f4'::uuid,2000::numeric,1000::numeric),  ('b0f3bc67-7ffc-4f83-b538-c47dd3e693ee'::uuid,'a70c1028-1600-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),  ('bf02027d-2921-45f0-b963-de03f9d2a100'::uuid,'393a9e29-c41f-466b-b057-51c370a0b160'::uuid,1000::numeric,500::numeric),  ('672854b7-6e81-46b4-897d-eb4822eeaec3'::uuid,'147914a8-fc02-4e14-a241-55586f88e186'::uuid,5000::numeric,2500::numeric),  ('8ad5b03e-6b9d-4c4b-ac56-835d5ac6a7c0'::uuid,'95091bcf-72e8-4bbc-8fc0-5aaaa4aba45b'::uuid,1000::numeric,500::numeric),  ('cae95515-1ad9-41b5-ae9b-3907051832c2'::uuid,'ccb6164a-2db4-400a-8ee0-b6607e880f4e'::uuid,2500::numeric,1500::numeric),  ('46a6d62f-b75e-48c0-bd77-4383f00bb42e'::uuid,'02c9209a-eb36-4baf-9bca-b698d3d2f99d'::uuid,2000::numeric,1000::numeric),  ('140cb040-486e-4313-a7fd-3d408726d865'::uuid,'94e8f417-2bcb-4904-8cce-4630c059c0d4'::uuid,3000::numeric,1500::numeric),  ('239ff085-536e-4cbf-a43e-969cfdea3c13'::uuid,'a70c1028-2000-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),  ('5e8bfdcc-4711-4857-a73f-c6809c4831dc'::uuid,'d5d5b72a-ba81-4223-9431-16e13224150d'::uuid,2000::numeric,1000::numeric),  ('d99078c6-52ae-4e25-8246-5a3f36b5bd45'::uuid,'83dffbc7-92dc-46e9-b05c-2a9bd774e321'::uuid,3000::numeric,1500::numeric),  ('9de4c506-4000-4d13-87df-1fb8c9d9384e'::uuid,'478200f3-3ea8-48d0-b401-fe8dbd314ae1'::uuid,1500::numeric,750::numeric),  ('6c40dfe0-9472-4048-abe6-d663c6ab4379'::uuid,'142d9121-d441-451d-b9a2-426c26d52ab9'::uuid,3000::numeric,1500::numeric),  ('f35f319f-07f9-4589-b5b6-8d38c8666beb'::uuid,'b66e1981-aad5-4aef-9d60-6a081d76250e'::uuid,1500::numeric,750::numeric),  ('1ce499e5-b8da-430d-bcb5-371a035165af'::uuid,'12ddf8de-844b-478f-b3d3-1dba9f8d463d'::uuid,500::numeric,250::numeric),  ('8cf40b63-ea8c-4a94-97a2-ae3751afd86a'::uuid,'1ad3dea7-8d60-4264-b917-284a6fdce1d0'::uuid,1000::numeric,500::numeric),  ('d57d7175-9c22-426f-a7ca-788671e41bb9'::uuid,'6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid,500::numeric,250::numeric)) AS b(id,schedule_id,old_guarantee,new_guarantee) ON t.id=b.id WHERE t.id=b.id AND t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee  AND t.created_at >= '2026-11-02 06:00+00'::timestamptz  AND t.start_time >= '2026-11-02 06:00+00'::timestamptz  AND upper(t.status) IN ('ANNOUNCED','REGISTERING')  AND NOT coalesce(t.prize_pool_finalized,false)  AND NOT coalesce(t.entry_contract_locked,false)  AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id))
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

WITH baseline(id,schedule_id,old_guarantee,new_guarantee) AS (VALUES
 ('4b235295-d4d9-4f8c-b1b4-e5f2fc195dc2'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),
 ('6eb99ddf-8e57-4b39-8a30-9151dbcaa350'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric),
 ('dea1331d-a6d2-4163-9f0a-8291607b427e'::uuid,'e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid,1500::numeric,750::numeric),
 ('9b3bb8b5-d53a-4767-abcb-b3e50d5e5a1e'::uuid,'b14c7932-f32b-4481-9106-3e78b14623c6'::uuid,1000::numeric,500::numeric),
 ('9c02af53-41f9-42b4-b13b-92a12a3163d1'::uuid,'047e6702-90de-4045-a6a6-7b05263d4ee6'::uuid,500::numeric,250::numeric),
 ('96a8dce3-d1a4-4b7e-a17d-6aed923c5412'::uuid,'393a9e29-c41f-466b-b057-51c370a0b160'::uuid,1000::numeric,500::numeric),
 ('c5698c57-9a06-4213-97de-2f1189985599'::uuid,'a70c1028-1600-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),
 ('ead07649-6cdf-4e61-bd62-7de0daec1d8a'::uuid,'147914a8-fc02-4e14-a241-55586f88e186'::uuid,5000::numeric,2500::numeric),
 ('efc9fac3-e855-4c1f-8493-bc50924990f1'::uuid,'95091bcf-72e8-4bbc-8fc0-5aaaa4aba45b'::uuid,1000::numeric,500::numeric),
 ('5022c4f0-04d3-4325-8b1f-303fee1f6ac7'::uuid,'ccb6164a-2db4-400a-8ee0-b6607e880f4e'::uuid,2500::numeric,1500::numeric),
 ('61dd067b-5d15-47c3-9875-dd42322ae39e'::uuid,'02c9209a-eb36-4baf-9bca-b698d3d2f99d'::uuid,2000::numeric,1000::numeric),
 ('32434bd6-ec1d-458b-b94e-96019b29d01e'::uuid,'4507f521-ec9a-4bb0-b634-eefee9cbfe18'::uuid,1500::numeric,750::numeric),
 ('ed02ec14-cb84-4441-99c4-01c2e0e00a66'::uuid,'a70c1028-2000-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),
 ('22ca8fa1-2522-425e-b71b-b67379b09c65'::uuid,'f1610468-286e-43bb-914a-7ad2067cfe37'::uuid,2500::numeric,1500::numeric),
 ('bd3e878a-4439-4504-b9a7-4ea2b663cf72'::uuid,'478200f3-3ea8-48d0-b401-fe8dbd314ae1'::uuid,1500::numeric,750::numeric),
 ('c0b77808-07ee-4b8d-b3e0-3c47e7380adc'::uuid,'27a215fa-420a-4e10-b03a-033317d5e556'::uuid,2000::numeric,1000::numeric),
 ('4aaef0ed-327e-46a6-9fae-e467fc53859b'::uuid,'b66e1981-aad5-4aef-9d60-6a081d76250e'::uuid,1500::numeric,750::numeric),
 ('7d210de4-936c-4773-8ec3-01741215c64a'::uuid,'1ad3dea7-8d60-4264-b917-284a6fdce1d0'::uuid,1000::numeric,500::numeric),
 ('b6c06429-14b3-4b87-96ae-8992a1636914'::uuid,'6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid,500::numeric,250::numeric),
 ('297875f5-36da-46e4-992c-990b084a35c7'::uuid,'496fe7e6-28a9-4383-9038-692fcf48fa0a'::uuid,500::numeric,250::numeric),
 ('6344c90c-f4fb-4bd6-89fe-b3688c50362b'::uuid,'bb6338d1-a3e4-4f53-b6d7-e3dd556dcf0c'::uuid,500::numeric,250::numeric),
 ('20adeee3-f118-4843-bc27-75a4dc437a8c'::uuid,'2392cd18-8604-41cc-8037-bcd17c57d2d2'::uuid,500::numeric,250::numeric),
 ('db3dac3a-1e51-4571-b622-2f5a07d96db6'::uuid,'17f0783d-ee08-4c2d-a977-cc42515a86f4'::uuid,500::numeric,250::numeric),
 ('17b1dd81-89db-43f6-acaf-e6d8c2d2df4c'::uuid,'bf2420ae-beae-4448-baa1-e0fa1cad4c60'::uuid,500::numeric,250::numeric),
 ('b50c136d-b969-4ff7-85d6-dbb2ced21ab7'::uuid,'857171b5-4a6f-4e81-b279-f14a8c2d645a'::uuid,1000::numeric,500::numeric),
 ('2b3a8bab-1fc5-44bf-953e-4acf9a0152c8'::uuid,'a70c1028-1200-4000-9000-000000000001'::uuid,2500::numeric,1500::numeric),
 ('3efc584a-5dcf-4ae3-ade0-40a2b4f9f22b'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),
 ('4f11d60c-a162-4929-8aa6-5b7f51aeca6c'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric),
 ('b6fe0031-9de5-4802-b7e0-73038ca1784c'::uuid,'e25b7f77-07ed-4cbd-9077-3adafc1381e0'::uuid,1500::numeric,750::numeric),
 ('ed36effc-2e92-44ec-aa39-8f4d4c90cb59'::uuid,'b14c7932-f32b-4481-9106-3e78b14623c6'::uuid,1000::numeric,500::numeric),
 ('6a670a80-614e-4f3c-b180-890d65bdc2ab'::uuid,'3d45dab2-7c54-4ca7-a83d-a6690fd6981a'::uuid,1000::numeric,500::numeric),
 ('90ec79b5-e267-4725-b377-e2129de6f5e7'::uuid,'574129d4-2592-4732-856e-144bb51bc9f4'::uuid,2000::numeric,1000::numeric),
 ('b0f3bc67-7ffc-4f83-b538-c47dd3e693ee'::uuid,'a70c1028-1600-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),
 ('bf02027d-2921-45f0-b963-de03f9d2a100'::uuid,'393a9e29-c41f-466b-b057-51c370a0b160'::uuid,1000::numeric,500::numeric),
 ('672854b7-6e81-46b4-897d-eb4822eeaec3'::uuid,'147914a8-fc02-4e14-a241-55586f88e186'::uuid,5000::numeric,2500::numeric),
 ('8ad5b03e-6b9d-4c4b-ac56-835d5ac6a7c0'::uuid,'95091bcf-72e8-4bbc-8fc0-5aaaa4aba45b'::uuid,1000::numeric,500::numeric),
 ('cae95515-1ad9-41b5-ae9b-3907051832c2'::uuid,'ccb6164a-2db4-400a-8ee0-b6607e880f4e'::uuid,2500::numeric,1500::numeric),
 ('46a6d62f-b75e-48c0-bd77-4383f00bb42e'::uuid,'02c9209a-eb36-4baf-9bca-b698d3d2f99d'::uuid,2000::numeric,1000::numeric),
 ('140cb040-486e-4313-a7fd-3d408726d865'::uuid,'94e8f417-2bcb-4904-8cce-4630c059c0d4'::uuid,3000::numeric,1500::numeric),
 ('239ff085-536e-4cbf-a43e-969cfdea3c13'::uuid,'a70c1028-2000-4000-9000-000000000001'::uuid,5000::numeric,2500::numeric),
 ('5e8bfdcc-4711-4857-a73f-c6809c4831dc'::uuid,'d5d5b72a-ba81-4223-9431-16e13224150d'::uuid,2000::numeric,1000::numeric),
 ('d99078c6-52ae-4e25-8246-5a3f36b5bd45'::uuid,'83dffbc7-92dc-46e9-b05c-2a9bd774e321'::uuid,3000::numeric,1500::numeric),
 ('9de4c506-4000-4d13-87df-1fb8c9d9384e'::uuid,'478200f3-3ea8-48d0-b401-fe8dbd314ae1'::uuid,1500::numeric,750::numeric),
 ('6c40dfe0-9472-4048-abe6-d663c6ab4379'::uuid,'142d9121-d441-451d-b9a2-426c26d52ab9'::uuid,3000::numeric,1500::numeric),
 ('f35f319f-07f9-4589-b5b6-8d38c8666beb'::uuid,'b66e1981-aad5-4aef-9d60-6a081d76250e'::uuid,1500::numeric,750::numeric),
 ('1ce499e5-b8da-430d-bcb5-371a035165af'::uuid,'12ddf8de-844b-478f-b3d3-1dba9f8d463d'::uuid,500::numeric,250::numeric),
 ('8cf40b63-ea8c-4a94-97a2-ae3751afd86a'::uuid,'1ad3dea7-8d60-4264-b917-284a6fdce1d0'::uuid,1000::numeric,500::numeric),
 ('d57d7175-9c22-426f-a7ca-788671e41bb9'::uuid,'6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid,500::numeric,250::numeric)
)
UPDATE public.tournaments t
SET guaranteed_prize=b.new_guarantee,
 name=pg_temp.reduced_guarantee_copy(t.name,b.old_guarantee,b.new_guarantee),
 description=pg_temp.reduced_guarantee_copy(t.description,b.old_guarantee,b.new_guarantee),
 short_description=pg_temp.reduced_guarantee_copy(t.short_description,b.old_guarantee,b.new_guarantee)
FROM baseline b
WHERE t.id=b.id AND t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee
 AND t.created_at >= '2026-11-02 06:00+00'::timestamptz
 AND t.start_time >= '2026-11-02 06:00+00'::timestamptz
 AND upper(t.status) IN ('ANNOUNCED','REGISTERING')
 AND NOT coalesce(t.prize_pool_finalized,false)
 AND NOT coalesce(t.entry_contract_locked,false)
 AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id);
COMMIT;
