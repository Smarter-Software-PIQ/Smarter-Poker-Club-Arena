-- Owner November 1: halve future guarantees from midnight Chicago, except 200/25k.
-- Exact pre-change IDs/amounts captured 2026-11-02 02:20-02:31 UTC prevent repeated
-- halving and avoid changing newly spawned instances already reduced by engine.
-- Already entered, locked, finalized and in-progress events retain commitments.
-- No wallet, payout, entry price, schedule time or horse tournament change.
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

WITH baseline(id, old_guarantee) AS (VALUES
 ('e842cd87-9419-402a-98fd-2451c627bb5f'::uuid, 500::numeric),
 ('0251fba4-dcc2-41f0-aec2-9cd567785c3d'::uuid, 500.00::numeric),
 ('0418daad-05a5-4aa7-9728-5bf1a3ac12cc'::uuid, 500.00::numeric),
 ('04746fce-4bad-4547-96ac-7e87b398648c'::uuid, 5000.00::numeric),
 ('047da62c-3337-48f7-a3d2-22f0a802f14e'::uuid, 2000.00::numeric),
 ('04ba4cca-c6a1-45a3-bd3c-5150b43e963b'::uuid, 500.00::numeric),
 ('069ccf16-2b6f-4eb1-b980-a875860c4b44'::uuid, 5000.00::numeric),
 ('0778af66-7924-44dd-b537-56af19adf1ad'::uuid, 2000.00::numeric),
 ('077ae84a-0f9f-4bde-b02d-a071a2651176'::uuid, 500.00::numeric),
 ('0ae8dd91-4ed7-407d-a4ce-7a5f81116435'::uuid, 2000.00::numeric),
 ('107643a6-62dc-46a1-9e98-167356ad7ebc'::uuid, 10000.00::numeric),
 ('1573766d-ff72-4ec2-a312-61dce4ca17ed'::uuid, 2000.00::numeric),
 ('180eb727-a14c-41ca-8e09-8bd391e0e08a'::uuid, 5000.00::numeric),
 ('18897dc9-5c0a-4cdf-993b-5ca08f81fc09'::uuid, 2000.00::numeric),
 ('1999c22d-6bd6-4f8d-a1e4-2f55dc686b34'::uuid, 500.00::numeric),
 ('1b69c820-6824-423c-a8ff-1fade391aaab'::uuid, 500.00::numeric),
 ('1c7d2e41-5667-4abc-a35d-7c2231ba8fcc'::uuid, 500.00::numeric),
 ('1d37e73b-82b3-46de-b50b-21686911d3d0'::uuid, 500.00::numeric),
 ('1e93d1da-e69d-44a8-804c-20a1981c671e'::uuid, 500.00::numeric),
 ('1fa6a742-d293-4cd6-af7c-026ca43a45d3'::uuid, 20000.00::numeric),
 ('22a1e0b7-3b08-45f3-b058-7c006683691b'::uuid, 500.00::numeric),
 ('239af86d-28f5-4aba-916f-2c5f848faba5'::uuid, 500.00::numeric),
 ('2454947f-6c07-48ab-96fe-8c3222d0d17c'::uuid, 250.00::numeric),
 ('2637de9d-f209-4dcb-9fe2-39f75c9c3fac'::uuid, 2500.00::numeric),
 ('2715e941-9151-49db-b929-409af0776e69'::uuid, 1000.00::numeric),
 ('27a0e710-47e3-444f-aca9-97968c1d9ad1'::uuid, 500.00::numeric),
 ('287d27d3-8c0d-4213-a9f2-b8cc51353cbc'::uuid, 5000.00::numeric),
 ('2bcc3b07-6b81-4eea-aa87-13885c48dcf6'::uuid, 500.00::numeric),
 ('2c4e3b5a-857a-4a5e-b93a-190957ba1fb0'::uuid, 250.00::numeric),
 ('2e6103f3-8199-417b-b87c-5c2bd129655b'::uuid, 5000.00::numeric),
 ('2f767681-2e15-4bfa-8246-78eeabe27ba9'::uuid, 500.00::numeric),
 ('30e0d9b4-e259-4463-8af7-763164659499'::uuid, 1000.00::numeric),
 ('351aeff3-4bea-4ba1-bb26-46c081b230c1'::uuid, 500.00::numeric),
 ('353b8c1c-ecae-4bc6-8c47-c07b0f9af64d'::uuid, 1500.00::numeric),
 ('37ad7860-3743-46e6-9a39-6701aa1b648a'::uuid, 500.00::numeric),
 ('38f72ba8-9b81-4be5-bd05-3639f0f1b725'::uuid, 5000.00::numeric),
 ('3a5ca6de-0860-4b55-9c26-21f20b50d57f'::uuid, 2000.00::numeric),
 ('4182b303-20b4-4d96-8b18-9d32286ca6bf'::uuid, 500.00::numeric),
 ('436ae9a1-4b4d-49d8-b9f4-e26026a9072d'::uuid, 2500.00::numeric),
 ('450e6c55-bd7c-4e6d-8f30-864c826f02cc'::uuid, 10000.00::numeric),
 ('46346e83-40c0-41ca-a957-480d2ca2630f'::uuid, 250.00::numeric),
 ('4677293a-fec9-4f03-a69f-06dd217109e0'::uuid, 250.00::numeric),
 ('4b13be57-a237-46d5-9f38-06e396ffca26'::uuid, 500.00::numeric),
 ('4d07672c-c35a-4a5c-beba-0ff6da577726'::uuid, 500.00::numeric),
 ('4f21a098-c2b5-4580-b89f-dde1127091c0'::uuid, 20000.00::numeric),
 ('4f7097ce-a323-44e6-a750-60ac2f0ff66f'::uuid, 2000.00::numeric),
 ('504f2f92-035a-4731-ac44-a2b0c377ffc6'::uuid, 10000.00::numeric),
 ('516e1a75-baec-4e03-9121-4e8e0fcc30b1'::uuid, 1000.00::numeric),
 ('536afd10-a224-4b15-b580-066f7c631f7a'::uuid, 500.00::numeric),
 ('5377b488-2fce-4f10-b441-5cea349cfadc'::uuid, 5000.00::numeric),
 ('599454b3-1651-4f02-acdb-b2acedde6520'::uuid, 500.00::numeric),
 ('5bf0f32b-0db2-4eef-bf88-98e232aaafe3'::uuid, 500.00::numeric),
 ('5eae647d-11e8-4194-992a-1b4660a2df38'::uuid, 1500.00::numeric),
 ('5ebe7c2e-06b5-48d0-92f6-69afa8242e6f'::uuid, 5000.00::numeric),
 ('600ddf66-9937-4810-b1ec-4224824b53a1'::uuid, 5000.00::numeric),
 ('61e7d8c7-2c21-4bfa-b298-fb7ce4a68d16'::uuid, 500.00::numeric),
 ('640826a5-34bc-4be0-9122-bee5430e7476'::uuid, 500.00::numeric),
 ('67bc20fe-474c-4551-9c6d-fba2b4b2b4e7'::uuid, 15000.00::numeric),
 ('6b81036a-59cf-4374-a4ab-d7ef2702988d'::uuid, 2500.00::numeric),
 ('6c38d6e5-1558-4504-8375-002fb6cf586c'::uuid, 2500.00::numeric),
 ('6eab3859-fdde-42a5-8e94-b9b6f527fc9d'::uuid, 10000.00::numeric),
 ('703b8a66-42e5-4011-bf36-ed6fa0270dea'::uuid, 5000.00::numeric),
 ('70a48cd5-5498-4375-a42a-321c2608068d'::uuid, 1000.00::numeric),
 ('70d04475-d124-4bf0-b970-6a9bc049b636'::uuid, 1500.00::numeric),
 ('762a4e75-5fe9-42cf-8655-0794195dff6d'::uuid, 500.00::numeric),
 ('77b33193-4d9f-4982-9afe-d5daf5462e5e'::uuid, 1500.00::numeric),
 ('7dd82116-6c15-4728-9cc6-a640486a3c44'::uuid, 1500.00::numeric),
 ('8043843b-7623-4aa0-973a-6a8349458bf0'::uuid, 500.00::numeric),
 ('80bd2484-7eaf-41b5-869f-37482b3b589e'::uuid, 500.00::numeric),
 ('80c063a5-13c6-4826-aa0d-0fde538219fb'::uuid, 1500.00::numeric),
 ('83815033-02a7-4e25-adde-cad5992ec8bb'::uuid, 5000.00::numeric),
 ('861c1dab-b976-43ae-b9dd-f2582f0edf5d'::uuid, 1500.00::numeric),
 ('8785c24a-13ea-40bb-91e7-426275babd80'::uuid, 1500.00::numeric),
 ('8963955f-e504-4eb3-8f8b-fb8d2a309f2e'::uuid, 500.00::numeric),
 ('896cf989-f85f-4d4f-9e57-5d853db8864a'::uuid, 3000.00::numeric),
 ('8d6504fc-401d-48ed-8af4-d6ade92682ec'::uuid, 3000.00::numeric),
 ('8dc0bd10-5e90-4531-bd6a-41b09732302f'::uuid, 250.00::numeric),
 ('929f4b0c-a126-4b92-960a-529f4842c515'::uuid, 250.00::numeric),
 ('92b3acdb-eddd-4162-b8ee-58ea18b90abd'::uuid, 1000.00::numeric),
 ('984990c0-723e-4fa8-9b80-afacdd783516'::uuid, 10000.00::numeric),
 ('98e38de4-64a5-4e64-92ea-fa20c7fd247f'::uuid, 500.00::numeric),
 ('9b52a58f-7944-4416-b141-26c5336f9d35'::uuid, 50000.00::numeric),
 ('a121c5f3-91db-491e-bac6-14730c2896ab'::uuid, 5000.00::numeric),
 ('a38e811c-2835-4366-a3f6-0f8c823018c2'::uuid, 5000.00::numeric),
 ('a743e016-4212-49ff-99c7-f9c2c09776a2'::uuid, 500.00::numeric),
 ('a874ec97-1edf-47f3-aa13-1f51e7baa921'::uuid, 500.00::numeric),
 ('a9d99aa6-0130-4e77-80ed-185bd93d74dc'::uuid, 5000.00::numeric),
 ('ab634fbe-96eb-4ac5-91ed-d4ae75803e7e'::uuid, 2500.00::numeric),
 ('ae6c4465-6493-427e-ab3c-32d8649caa5b'::uuid, 15000.00::numeric),
 ('af1f3c08-4865-42dc-971b-56c55b9d00b0'::uuid, 5000.00::numeric),
 ('b12640cd-f5a3-43e3-866e-8cb4f185b757'::uuid, 1500.00::numeric),
 ('b71a9ee0-5c48-45ae-a59d-4a08007669cc'::uuid, 500.00::numeric),
 ('b8ce73f7-1425-44ae-bbb5-4f73638a321e'::uuid, 1000.00::numeric),
 ('bc44115c-b016-4e0a-8fd3-3fa3a958fe44'::uuid, 1000.00::numeric),
 ('bc8150f7-e744-465a-a3bf-8a6e6804e2a1'::uuid, 1000.00::numeric),
 ('bd391faa-0b48-42fc-a50a-a3f9d1eab746'::uuid, 2500.00::numeric),
 ('bd65307b-2c39-42ef-9c82-2b5adc2edfec'::uuid, 2000.00::numeric),
 ('c02d5201-f2a6-42ac-ab07-abf62330f4e4'::uuid, 500.00::numeric),
 ('c5a82e34-9e1f-4ba8-b8d1-8a0b7c36b70a'::uuid, 1000.00::numeric),
 ('c5b0062a-746f-4bc8-8d6b-4dda50488a17'::uuid, 10000.00::numeric),
 ('c6a0efb2-c668-48fd-a954-7c56e389a9fe'::uuid, 5000.00::numeric),
 ('cade61c8-ded2-4ef2-927b-057f0033e143'::uuid, 1000.00::numeric),
 ('ccdd9b28-ecfa-4330-8ea6-37a6d6fe3ea1'::uuid, 25000.00::numeric),
 ('ce5f511b-6128-4765-a1c6-3e0750374776'::uuid, 10000.00::numeric),
 ('cf18122e-a471-4eda-9469-52f29aad5d9e'::uuid, 500.00::numeric),
 ('d2a02215-d396-4d61-a342-9c6039276899'::uuid, 1000.00::numeric),
 ('d64ae23b-4fc2-46f9-8aa0-e4d0b1565179'::uuid, 1000.00::numeric),
 ('d9fe912b-0c47-4729-8ef9-c1d57c0333b1'::uuid, 1000.00::numeric),
 ('daeeaee3-b4cb-411b-8811-fe4d94da9851'::uuid, 500.00::numeric),
 ('dc780747-cbda-4e3b-8c5a-d7bc53114eff'::uuid, 1500.00::numeric),
 ('dd05714e-ffcd-4ca4-ad36-b4d6082aa117'::uuid, 5000.00::numeric),
 ('e24f2f82-c8e6-4141-8ff2-93f082947c02'::uuid, 1000.00::numeric),
 ('e6314e46-6732-4281-aaeb-0b8c137c09fc'::uuid, 500.00::numeric),
 ('e6e1267f-8692-4ac6-adfd-1a30cc7df50d'::uuid, 2500.00::numeric),
 ('e80d7b46-3a75-4de8-bc5b-35dea87eec9b'::uuid, 1000.00::numeric),
 ('e8a45c28-5420-4f4d-9db2-3dc97960cee8'::uuid, 500.00::numeric),
 ('e8cdf1dc-ce3f-44b5-95c5-7511825530cd'::uuid, 1000.00::numeric),
 ('ec1f3ef4-0b2d-4225-9e54-f3e011569a0e'::uuid, 500.00::numeric),
 ('ee04d9ce-4cfc-4df8-8c9e-b46c6ddbfd0a'::uuid, 500.00::numeric),
 ('f4c55c66-e65f-4435-a2ea-3f06ca5af8b4'::uuid, 500.00::numeric),
 ('f58a0c8b-82fc-42bd-9081-8d8d10345051'::uuid, 2000.00::numeric),
 ('f64f0c23-c095-48d0-9489-568559333d19'::uuid, 1000.00::numeric),
 ('f8f16d71-8483-4847-8b79-74f071ca66ea'::uuid, 500.00::numeric),
 ('f976e0cd-04e5-418d-902f-9b7d74170df4'::uuid, 10000.00::numeric),
 ('fb026772-5b56-4349-bc29-6219fed21ebb'::uuid, 20000.00::numeric),
 ('fb2d3bb5-f092-4b9a-80dd-517b9ec04ee9'::uuid, 500.00::numeric),
 ('fc740de9-d2df-40d9-a488-c3d416083d39'::uuid, 5000.00::numeric),
 ('fcd2acea-b037-49a5-b379-44b6ba48fdf0'::uuid, 500.00::numeric),
 ('fdd8a8f4-75ec-4117-95a8-a619f539cb6f'::uuid, 2000.00::numeric),
 ('fe27ad42-f94d-48cf-a0e1-2f6194a31c95'::uuid, 5000.00::numeric),
 ('fe5b2ed3-1efb-4bd0-a256-203a88eace3f'::uuid, 500.00::numeric)
)
UPDATE public.tournaments t
SET guaranteed_prize = round(b.old_guarantee / 2, 2),
    name = pg_temp.reduced_guarantee_copy(t.name,b.old_guarantee,round(b.old_guarantee/2,2)),
    description = pg_temp.reduced_guarantee_copy(t.description,b.old_guarantee,round(b.old_guarantee/2,2)),
    short_description = pg_temp.reduced_guarantee_copy(t.short_description,b.old_guarantee,round(b.old_guarantee/2,2))
FROM baseline b
WHERE t.id=b.id AND t.guaranteed_prize=b.old_guarantee
 AND t.start_time >= '2026-11-02 06:00:00+00'::timestamptz
 AND upper(t.status) IN ('ANNOUNCED','REGISTERING')
 AND NOT coalesce(t.prize_pool_finalized,false)
 AND NOT coalesce(t.entry_contract_locked,false)
 AND NOT (coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=200 AND t.guaranteed_prize=25000)
 AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id);
COMMIT;
