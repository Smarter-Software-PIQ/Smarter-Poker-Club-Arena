-- 20261102181258: kept run-out in either write order (receipt before saved run-out).
\set ON_ERROR_STOP 1
DELETE FROM rabbit_hunt_owned_runouts;
DELETE FROM rabbit_hunt_offers;
DELETE FROM rabbit_hunt_reveals;
-- Auto Run: both receipts land BEFORE the saved run-out.
INSERT INTO rabbit_hunt_reveals(user_id,table_id,hand_number) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333',41),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','33333333-3333-3333-3333-333333333333',41);
DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM rabbit_hunt_owned_runouts), 'nothing to copy yet'; END $$;
INSERT INTO rabbit_hunt_offers(table_id,hand_number,cards,board_len,eligible_user_ids) VALUES
  ('33333333-3333-3333-3333-333333333333',41,
   '[{"rank":"A","suit":"s"},{"rank":"K","suit":"h"},{"rank":"2","suit":"c"},{"rank":"9","suit":"d"},{"rank":"T","suit":"s"}]'::jsonb,
   3, ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[]);
DO $$ BEGIN
  ASSERT (SELECT cards FROM rabbit_hunt_owned_runouts WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND hand_number=41)
         = '[{"rank":"A","suit":"s"},{"rank":"K","suit":"h"}]'::jsonb, 'receipt first: exact sold slice kept';
  ASSERT NOT EXISTS (SELECT 1 FROM rabbit_hunt_owned_runouts WHERE user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'receipt first: not dealt in owns nothing';
END $$;
-- The engine's upsert writes the same hand again: still one row, first kept.
INSERT INTO rabbit_hunt_offers(table_id,hand_number,cards,board_len,eligible_user_ids) VALUES
  ('33333333-3333-3333-3333-333333333333',41,
   '[{"rank":"3","suit":"s"},{"rank":"4","suit":"h"},{"rank":"5","suit":"c"},{"rank":"6","suit":"d"},{"rank":"7","suit":"s"}]'::jsonb,
   3, ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[])
ON CONFLICT (table_id,hand_number) DO UPDATE SET cards = EXCLUDED.cards;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM rabbit_hunt_owned_runouts) = 1, 'upsert does not duplicate';
  ASSERT (SELECT cards->0->>'rank' FROM rabbit_hunt_owned_runouts) = 'A', 'the first kept slice is never overwritten';
END $$;
-- Saved run-out first, then the receipt: still exactly one row (old path).
INSERT INTO rabbit_hunt_offers(table_id,hand_number,cards,board_len,eligible_user_ids) VALUES
  ('33333333-3333-3333-3333-333333333333',42,
   '[{"rank":"Q","suit":"s"},{"rank":"J","suit":"h"},{"rank":"2","suit":"c"},{"rank":"9","suit":"d"},{"rank":"T","suit":"s"}]'::jsonb,
   0, ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[]);
INSERT INTO rabbit_hunt_reveals(user_id,table_id,hand_number) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333',42);
DO $$ BEGIN
  ASSERT (SELECT jsonb_array_length(cards) FROM rabbit_hunt_owned_runouts WHERE hand_number=42) = 5, 'offer first: whole run-out from preflop';
  ASSERT (SELECT count(*) FROM rabbit_hunt_owned_runouts) = 2;
  ASSERT NOT has_function_privilege('authenticated','public.fn_rabbit_hunt_keep_runouts_for_offer()','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.fn_rabbit_hunt_keep_runouts_for_offer()','EXECUTE');
END $$;
-- A signed-in account with no profile row: the staff check is NULL, and must refuse.
SET test.role = 'authenticated';
SET test.viewer = '99999999-9999-9999-9999-999999999999';
DO $$ BEGIN
  ASSERT public.fn_is_platform_admin() IS NULL, 'fixture: staff check is NULL without a profile';
  BEGIN PERFORM fn_staff_rabbit_hunt_receipts('alice'); ASSERT false, 'no-profile caller read receipts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_staff_correct_rabbit_hunt_charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333',41,NULL,'a long enough reason for audit'); ASSERT false, 'no-profile caller corrected';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET test.viewer = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
DO $$ BEGIN ASSERT (fn_staff_rabbit_hunt_receipts('alice')->>'found')::boolean, 'staff still served'; END $$;
SELECT 'RABBIT_HUNT_EITHER_ORDER_OK';
