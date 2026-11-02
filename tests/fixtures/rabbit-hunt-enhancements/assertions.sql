\set ON_ERROR_STOP 1
-- ---------- privileges ----------
DO $$ BEGIN
  ASSERT has_function_privilege('authenticated','public.fn_rabbit_hunt_charge_preview()','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.fn_rabbit_hunt_charge_preview()','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.fn_rabbit_hunt_owned_runout(uuid,bigint)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.rabbit_hunt_owned_runouts','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.fn_rabbit_hunt_charge_correction_core(uuid,uuid,bigint,uuid,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.fn_rabbit_hunt_charge_correction_core(uuid,uuid,bigint,uuid,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.fn_staff_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.fn_staff_rabbit_hunt_receipts(text)','EXECUTE');
END $$;

-- ---------- 1. price preview, in the charge order ----------
DO $$ BEGIN ASSERT fn_rabbit_hunt_charge_preview() = '{"source":"signed_out"}'::jsonb; END $$;
SET test.viewer = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DO $$ DECLARE p jsonb := fn_rabbit_hunt_charge_preview(); BEGIN
  ASSERT p->>'source' = 'lifetime_vip' AND (p->>'unlimited')::boolean AND (p->>'cost_diamonds')::int = 0, p::text; END $$;
SET test.viewer = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
INSERT INTO feature_purchases(id,user_id,feature,uses_remaining,expires_at,created_at,source) VALUES
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rabbit_hunt',2,now()+interval '3 days',now()-interval '1 day','daily_bonus'),
 ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rabbit_hunt',1,null,now()-interval '2 day','purchase');
INSERT INTO vip_feature_usage_monthly(user_id,feature,month,usage_count) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rabbit_hunt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),97);
DO $$ DECLARE p jsonb := fn_rabbit_hunt_charge_preview(); BEGIN
  ASSERT p->>'source' = 'credit' AND p->>'credit_source' = 'daily_bonus' AND p->>'credit_expires_at' IS NOT NULL
     AND (p->>'credits_left')::int = 3 AND (p->>'vip_remaining')::int = 3, 'expiring credit first: ' || p::text; END $$;
UPDATE feature_purchases SET uses_remaining = 0 WHERE id = 'eeeeeeee-0000-0000-0000-000000000001';
DO $$ DECLARE p jsonb := fn_rabbit_hunt_charge_preview(); BEGIN
  ASSERT p->>'source' = 'vip_allowance' AND (p->>'vip_remaining')::int = 3, 'allowance before a non-expiring credit: ' || p::text; END $$;
UPDATE vip_feature_usage_monthly SET usage_count = 100;
DO $$ DECLARE p jsonb := fn_rabbit_hunt_charge_preview(); BEGIN
  ASSERT p->>'source' = 'credit' AND p->>'credit_expires_at' IS NULL AND (p->>'vip_remaining')::int = 0, 'allowance spent, then a pack: ' || p::text; END $$;
UPDATE feature_purchases SET uses_remaining = 0;
DO $$ DECLARE p jsonb := fn_rabbit_hunt_charge_preview(); BEGIN
  ASSERT p->>'source' = 'diamonds' AND (p->>'cost_diamonds')::int = 5 AND (p->>'affordable')::boolean, p::text; END $$;
SET test.viewer = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
INSERT INTO feature_pricing VALUES ('rabbit_hunt', 7);
DO $$ DECLARE p jsonb := fn_rabbit_hunt_charge_preview(); BEGIN
  ASSERT p->>'source' = 'diamonds' AND (p->>'cost_diamonds')::int = 7 AND NOT (p->>'affordable')::boolean
     AND NOT (p->>'is_vip')::boolean AND p->'vip_remaining' = 'null'::jsonb, p::text;
  ASSERT NOT (p ? 'cards'); END $$;
RESET test.viewer;

-- ---------- 2. owned run-outs ----------
DO $$ BEGIN
  ASSERT (SELECT jsonb_array_length(cards) FROM rabbit_hunt_owned_runouts WHERE hand_number = 7) = 5, 'backfill of a pre-migration reveal';
END $$;
INSERT INTO rabbit_hunt_offers(table_id,hand_number,cards,board_len,eligible_user_ids,created_at) VALUES
 ('22222222-2222-2222-2222-222222222222',8,'[{"rank":"2","suit":"spades"},{"rank":"3","suit":"hearts"},{"rank":"4","suit":"clubs"},{"rank":"5","suit":"diamonds"},{"rank":"6","suit":"spades"}]',3,ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid],now());
INSERT INTO rabbit_hunt_reveals(user_id,table_id,hand_number) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',8),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222',8);
DO $$ BEGIN
  ASSERT (SELECT cards FROM rabbit_hunt_owned_runouts WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND hand_number=8)
       = '[{"rank":"2","suit":"spades"},{"rank":"3","suit":"hearts"}]'::jsonb, 'exactly the cards sold (5 - board_len)';
  ASSERT NOT EXISTS (SELECT 1 FROM rabbit_hunt_owned_runouts WHERE user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'a player not dealt in owns nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM rabbit_hunt_owned_runouts WHERE user_id='cccccccc-cccc-cccc-cccc-cccccccccccc'), 'dealt in but did not buy: owns nothing';
END $$;
DELETE FROM rabbit_hunt_offers;   -- the shared run-out is pruned
SET test.viewer = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$ DECLARE r jsonb := fn_rabbit_hunt_owned_runout('22222222-2222-2222-2222-222222222222', 8); BEGIN
  ASSERT (r->>'owned')::boolean AND jsonb_array_length(r->'cards') = 2 AND (r->>'board_len')::int = 3, 'kept after the prune: ' || r::text; END $$;
SET test.viewer = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DO $$ BEGIN ASSERT fn_rabbit_hunt_owned_runout('22222222-2222-2222-2222-222222222222', 8) = '{"owned":false}'::jsonb, 'never another player''s cards'; END $$;
RESET test.viewer;
DO $$ BEGIN ASSERT fn_rabbit_hunt_owned_runout('22222222-2222-2222-2222-222222222222', 8) = '{"owned":false}'::jsonb; END $$;

-- ---------- 3. correction doors ----------
INSERT INTO feature_purchases(id,user_id,feature,uses_remaining,expires_at,created_at,source) VALUES
 ('eeeeeeee-0000-0000-0000-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rabbit_hunt',0,now()+interval '3 days',now()-interval '3 days','daily_bonus');
INSERT INTO digital_purchase_receipts(user_id,request_id,purchase_kind,request_payload,result,created_at)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       extensions.uuid_generate_v5(extensions.uuid_ns_url(), format('["club-arena.rabbit-hunt.v1","%s",%s,"%s"]','22222222-2222-2222-2222-222222222222',h,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
       'rabbit_hunt','{}', r::jsonb, now()-interval '1 hour'
  FROM (VALUES (7,'{"success":true,"source":"purchased","credit_source":"daily_bonus","consumed":true}'),
               (8,'{"success":true,"source":"vip_monthly","consumed":true}')) v(h,r);
SET test.role = 'authenticated';
SET test.viewer = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ BEGIN
  BEGIN PERFORM fn_staff_correct_rabbit_hunt_charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',7,'eeeeeeee-0000-0000-0000-000000000009','a long enough reason for audit'); ASSERT false, 'a player corrected a charge';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_staff_rabbit_hunt_receipts('alice'); ASSERT false, 'a player read receipts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_correct_rabbit_hunt_charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',7,'eeeeeeee-0000-0000-0000-000000000009','me','a long enough reason for audit'); ASSERT false, 'service door open to a player';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET test.viewer = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
DO $$ DECLARE r jsonb; l jsonb; BEGIN
  l := fn_staff_rabbit_hunt_receipts('ALICE');
  ASSERT (l->>'found')::boolean AND l->'player'->>'username' = 'alice' AND jsonb_array_length(l->'charges') = 2
     AND jsonb_array_length(l->'credits') = 3, l::text;
  ASSERT NOT (l::text ~ '"rank"'), 'no cards in the staff listing';
  ASSERT fn_staff_rabbit_hunt_receipts('1001')->'player'->>'id' = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'by player number';
  ASSERT fn_staff_rabbit_hunt_receipts('nobody') = '{"found":false}'::jsonb;
  r := fn_staff_correct_rabbit_hunt_charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',7,'eeeeeeee-0000-0000-0000-000000000009','Staff correction of a test-consumed credit use');
  ASSERT r->>'ok' = 'true' AND r->>'correction' = 'credit_use_restored', r::text;
  ASSERT (SELECT operator FROM rabbit_hunt_charge_corrections WHERE hand_number = 7) = 'staff staffer (dddddddd-dddd-dddd-dddd-dddddddddddd)';
  ASSERT fn_staff_correct_rabbit_hunt_charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',7,'eeeeeeee-0000-0000-0000-000000000009','Staff correction of a test-consumed credit use')->>'replayed' = 'true';
  ASSERT (SELECT uses_remaining FROM feature_purchases WHERE id='eeeeeeee-0000-0000-0000-000000000009') = 1, 'applied once';
  l := fn_staff_rabbit_hunt_receipts('alice');
  ASSERT (SELECT count(*) FROM jsonb_array_elements(l->'charges') c WHERE c->'correction' <> 'null'::jsonb) = 1, 'listing shows the correction';
END $$;
SET test.role = 'service_role';
DO $$ DECLARE r jsonb; BEGIN
  r := fn_correct_rabbit_hunt_charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',8,NULL,'service','Service correction of a test allowance count');
  ASSERT r->>'ok' = 'true' AND r->>'correction' = 'monthly_usage_released', 'service door unchanged: ' || r::text;
END $$;
RESET test.role; RESET test.viewer;
\echo RABBIT_HUNT_ENHANCEMENTS_ASSERTIONS_OK
