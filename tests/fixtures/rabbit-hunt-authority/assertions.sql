-- Rabbit hunt authority: availability reveals nothing about another player's
-- hand, and a charge correction is bound, audited and applied at most once.
\set ON_ERROR_STOP 1

-- ---------- 1. Availability ----------
SET test.viewer = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$
DECLARE s10 jsonb; s11 jsonb; s999 jsonb;
BEGIN
  s10  := fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 10);
  s11  := fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 11);
  s999 := fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 999);
  ASSERT s10 = s999 AND s11 = s999, format('not dealt in must equal no hand: %s %s %s', s10, s11, s999);
  ASSERT s999 = '{"status":"not_saved"}'::jsonb, s999::text;
  ASSERT NOT (s10 ? 'cards') AND NOT (s10 ? 'expires_at'), 'no hand detail for a non-participant';
END $$;

SET test.viewer = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$
DECLARE s jsonb; c timestamptz;
BEGIN
  SELECT created_at INTO c FROM rabbit_hunt_offers WHERE hand_number = 10;
  s := fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 10);
  ASSERT s->>'status' = 'saved' AND (s->>'expires_at')::timestamptz = c + interval '1 day', s::text;
  ASSERT NOT (s ? 'cards'), 'status never carries cards';
  s := fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 11);
  ASSERT s = '{"status":"expired"}'::jsonb, 'a dealt-in hand older than 1 day reads expired: ' || s::text;
END $$;
RESET test.viewer;
DO $$ BEGIN
  ASSERT fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 10) = '{"status":"signed_out"}'::jsonb;
END $$;

-- With nothing fresh on the platform, a non-participant still learns nothing hand-specific.
UPDATE rabbit_hunt_offers SET created_at = now() - interval '2 hours' WHERE hand_number = 10;
SET test.viewer = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ BEGIN
  ASSERT fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 10) = '{"status":"unavailable"}'::jsonb;
  ASSERT fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111', 999) = '{"status":"unavailable"}'::jsonb;
END $$;
RESET test.viewer;

DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.fn_rabbit_hunt_replay_status(uuid,bigint)', 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.fn_rabbit_hunt_replay_status(uuid,bigint)', 'EXECUTE');
END $$;

-- ---------- 2. Charge correction ----------
DO $$ BEGIN
  ASSERT has_function_privilege('service_role', 'public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)', 'EXECUTE');
  ASSERT NOT has_table_privilege('authenticated', 'public.rabbit_hunt_charge_corrections', 'SELECT');
END $$;

-- The production vector: the engine's request id for (table 80d7c491, hand 54040613, player 9b027798).
INSERT INTO feature_purchases(id,user_id,feature,uses_remaining,expires_at,created_at,source) VALUES
 ('eebd7c7a-8b8b-4c1e-b7a9-04c69c396207','9b027798-9532-403f-a5c1-15554ce2959c','rabbit_hunt',0,now()+interval '2 days',now()-interval '3 days','daily_bonus'),
 ('cccccccc-0000-0000-0000-000000000002','9b027798-9532-403f-a5c1-15554ce2959c','rabbit_hunt',0,now()-interval '1 minute',now()-interval '3 days','daily_bonus'),
 ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','rabbit_hunt',0,now()+interval '2 days',now()-interval '3 days','daily_bonus'),
 ('cccccccc-0000-0000-0000-000000000004','9b027798-9532-403f-a5c1-15554ce2959c','rabbit_hunt',0,now()+interval '2 days',now()-interval '3 days','wheel');
INSERT INTO digital_purchase_receipts(user_id,request_id,purchase_kind,request_payload,result,created_at) VALUES
 ('9b027798-9532-403f-a5c1-15554ce2959c','c5df2de2-7656-5651-afe3-dc91997a1883','rabbit_hunt','{}',
  '{"success":true,"source":"purchased","credit_source":"daily_bonus","uses_remaining":0,"consumed":true}', now()-interval '1 hour');
INSERT INTO rabbit_hunt_reveals(user_id,table_id,hand_number) VALUES
 ('9b027798-9532-403f-a5c1-15554ce2959c','80d7c491-9993-4ec0-b559-758ef21f126c',54040613);

-- Allowance receipts, derived the same way, for hands 21 (this month), 22 (diamonds), 23 (replayed receipt), 24 (last month).
INSERT INTO digital_purchase_receipts(user_id,request_id,purchase_kind,request_payload,result,created_at)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       extensions.uuid_generate_v5(extensions.uuid_ns_url(), format('["club-arena.rabbit-hunt.v1","%s",%s,"%s"]','11111111-1111-1111-1111-111111111111',h,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
       'rabbit_hunt','{}', r::jsonb, at
  FROM (VALUES (21,'{"success":true,"source":"lifetime_vip","consumed":true}', date_trunc('month', now()) + interval '1 hour'),
               (22,'{"success":true,"source":"diamonds","diamonds_spent":5,"consumed":true}', now()),
               (23,'{"success":true,"source":"vip_monthly","consumed":false,"idempotent":true}', now()),
               (24,'{"success":true,"source":"vip_monthly","consumed":true}', date_trunc('month', now()) - interval '1 day')) v(h,r,at);
INSERT INTO rabbit_hunt_reveals(user_id,table_id,hand_number)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',h FROM generate_series(21,24) h;
INSERT INTO vip_feature_usage_monthly(user_id,feature,month,usage_count) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rabbit_hunt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),5);

-- A player cannot call it.
SET test.role = 'authenticated';
DO $$ BEGIN
  BEGIN
    PERFORM fn_correct_rabbit_hunt_charge('9b027798-9532-403f-a5c1-15554ce2959c','80d7c491-9993-4ec0-b559-758ef21f126c',54040613,'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207','me','a reason that is long enough');
    ASSERT false, 'a non-service caller corrected a charge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SET test.role = 'service_role';
DO $$
DECLARE r jsonb; n int;
  dan uuid := '9b027798-9532-403f-a5c1-15554ce2959c'; tbl uuid := '80d7c491-9993-4ec0-b559-758ef21f126c';
  reason text := 'Rabbit hunt live verification consumed this credit (test effect)';
BEGIN
  -- refusals change nothing
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, NULL, 'agent', reason);
  ASSERT r->>'reason' = 'credit_id_required_for_a_purchased_charge', r::text;
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, 'cccccccc-0000-0000-0000-000000000003', 'agent', reason);
  ASSERT r->>'reason' = 'not_this_players_rabbit_hunt_credit', r::text;
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, 'cccccccc-0000-0000-0000-000000000002', 'agent', reason);
  ASSERT r->>'reason' = 'credit_has_expired', r::text;
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, 'cccccccc-0000-0000-0000-000000000004', 'agent', reason);
  ASSERT r->>'reason' = 'credit_source_differs_from_the_charge', r::text;
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207', 'agent', 'too short');
  ASSERT r->>'reason' = 'operator_and_reason_required', r::text;
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040614, 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207', 'agent', reason);
  ASSERT r->>'reason' = 'no_charge_receipt_for_this_reveal', r::text;
  ASSERT (SELECT sum(uses_remaining) FROM feature_purchases) = 0, 'a refusal changed a credit';
  ASSERT NOT EXISTS (SELECT 1 FROM rabbit_hunt_charge_corrections), 'a refusal was recorded';

  -- the exact production request id is found: restores one use, once
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207', 'agent', reason);
  ASSERT r->>'ok' = 'true' AND r->>'replayed' = 'false' AND r->>'correction' = 'credit_use_restored'
     AND r->>'request_id' = 'c5df2de2-7656-5651-afe3-dc91997a1883'
     AND (r->>'value_before')::int = 0 AND (r->>'value_after')::int = 1, r::text;
  ASSERT (SELECT uses_remaining FROM feature_purchases WHERE id = 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207') = 1;
  r := fn_correct_rabbit_hunt_charge(dan, tbl, 54040613, 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207', 'agent', reason);
  ASSERT r->>'ok' = 'true' AND r->>'replayed' = 'true', r::text;
  ASSERT (SELECT uses_remaining FROM feature_purchases WHERE id = 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207') = 1, 'duplicate correction applied twice';
  ASSERT (SELECT count(*) FROM rabbit_hunt_charge_corrections) = 1;
  ASSERT EXISTS (SELECT 1 FROM rabbit_hunt_reveals WHERE user_id = dan AND hand_number = 54040613), 'the reveal itself is kept';
END $$;

DO $$
DECLARE r jsonb; a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; t uuid := '11111111-1111-1111-1111-111111111111';
  reason text := 'Rabbit hunt live verification used this allowance (test effect)';
  m text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM');
BEGIN
  r := fn_correct_rabbit_hunt_charge(a, t, 21, 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207', 'agent', reason);
  ASSERT r->>'reason' = 'credit_id_not_applicable_to_an_allowance_charge', r::text;
  r := fn_correct_rabbit_hunt_charge(a, t, 22, NULL, 'agent', reason);
  ASSERT r->>'reason' = 'source_not_correctable_here', r::text;
  r := fn_correct_rabbit_hunt_charge(a, t, 23, NULL, 'agent', reason);
  ASSERT r->>'reason' = 'the_charge_consumed_nothing', r::text;
  r := fn_correct_rabbit_hunt_charge(a, t, 24, NULL, 'agent', reason);
  ASSERT r->>'reason' = 'no_monthly_usage_to_release', 'last month''s charge must not release this month: ' || r::text;
  DELETE FROM rabbit_hunt_reveals WHERE user_id = a AND hand_number = 21;
  r := fn_correct_rabbit_hunt_charge(a, t, 21, NULL, 'agent', reason);
  ASSERT r->>'reason' = 'no_reveal_receipt_for_this_hand', r::text;
  INSERT INTO rabbit_hunt_reveals(user_id,table_id,hand_number) VALUES (a, t, 21);
  ASSERT (SELECT usage_count FROM vip_feature_usage_monthly WHERE user_id = a AND month = m) = 5;

  r := fn_correct_rabbit_hunt_charge(a, t, 21, NULL, 'agent', reason);
  ASSERT r->>'ok' = 'true' AND r->>'correction' = 'monthly_usage_released' AND r->>'usage_month' = m
     AND (r->>'value_before')::int = 5 AND (r->>'value_after')::int = 4, r::text;
  r := fn_correct_rabbit_hunt_charge(a, t, 21, NULL, 'agent', reason);
  ASSERT r->>'replayed' = 'true', r::text;
  ASSERT (SELECT usage_count FROM vip_feature_usage_monthly WHERE user_id = a AND month = m) = 4, 'duplicate release applied twice';
END $$;

-- Append-only audit.
DO $$ BEGIN
  BEGIN UPDATE rabbit_hunt_charge_corrections SET reason = reason || ' edited'; ASSERT false, 'audit row edited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM rabbit_hunt_charge_corrections; ASSERT false, 'audit row deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM rabbit_hunt_charge_corrections) = 2;
  BEGIN
    INSERT INTO rabbit_hunt_charge_corrections(user_id,table_id,hand_number,request_id,receipt_source,correction,usage_month,value_before,value_after,operator,reason)
    SELECT user_id,table_id,hand_number,request_id,receipt_source,correction,usage_month,value_before-1,value_after-1,operator,reason
      FROM rabbit_hunt_charge_corrections WHERE correction = 'monthly_usage_released';
    ASSERT false, 'a second correction row for one reveal was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET test.role;
\echo RABBIT_HUNT_AUTHORITY_ASSERTIONS_OK
