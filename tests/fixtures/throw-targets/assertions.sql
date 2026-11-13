-- Every throw is recorded once, at whoever sits in the target seat, horse or
-- human; only a charged throw by the caller can be recorded; the horse wrapper
-- binds horses only; no client can read or write the table directly.
DO $$
DECLARE
  r jsonb;
  t constant uuid := '11111111-1111-4111-8111-111111111111';
  ha constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  hb constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  hu constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  n integer;
BEGIN
  -- Horse A (seat 1) throws at horse B (seat 2): the target is a horse.
  r := public.fn_horse_record_throw_target(ha, '00000000-0000-4000-8000-000000000001', t, 2);
  IF r->>'success' <> 'true' OR (r->>'target_user_id')::uuid <> hb THEN
    RAISE EXCEPTION 'horse-to-horse not recorded: %', r;
  END IF;
  -- Horse A throws at the human (seat 3).
  r := public.fn_horse_record_throw_target(ha, '00000000-0000-4000-8000-000000000002', t, 3);
  IF (r->>'target_user_id')::uuid <> hu THEN RAISE EXCEPTION 'horse-to-human: %', r; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- The human throws at horse A through the browser path.
  PERFORM set_config('request.jwt.claim.sub', hu::text, true);
  r := public.fn_record_throw_target('00000000-0000-4000-8000-000000000003', t, 1);
  IF (r->>'target_user_id')::uuid <> ha OR r->>'recorded' <> 'true' THEN
    RAISE EXCEPTION 'human-to-horse: %', r;
  END IF;
  -- Idempotent: the same receipt is never recorded twice.
  r := public.fn_record_throw_target('00000000-0000-4000-8000-000000000003', t, 2);
  IF r->>'recorded' <> 'false' THEN RAISE EXCEPTION 'recorded twice: %', r; END IF;
  -- Someone else's receipt is not this caller's throw.
  r := public.fn_record_throw_target('00000000-0000-4000-8000-000000000001', t, 2);
  IF r->>'error' <> 'Unknown Throw' THEN RAISE EXCEPTION 'foreign receipt accepted: %', r; END IF;
  -- Bad seat refused.
  r := public.fn_record_throw_target('00000000-0000-4000-8000-000000000003', t, 99);
  IF r->>'error' <> 'Invalid Target Seat' THEN RAISE EXCEPTION 'bad seat: %', r; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- An uncharged horse throw is not recorded.
  r := public.fn_horse_record_throw_target(hb, '00000000-0000-4000-8000-000000000009', t, 1);
  IF r->>'error' <> 'Unknown Throw' THEN RAISE EXCEPTION 'uncharged accepted: %', r; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  -- The horse wrapper never binds a person.
  r := public.fn_horse_record_throw_target(hu, '00000000-0000-4000-8000-000000000003', t, 1);
  IF r->>'error' <> 'Not A Horse' THEN RAISE EXCEPTION 'person bound as horse: %', r; END IF;
  -- Anonymous refused.
  r := public.fn_record_throw_target('00000000-0000-4000-8000-000000000003', t, 1);
  IF r->>'error' <> 'Authentication Required' THEN RAISE EXCEPTION 'anon: %', r; END IF;

  SELECT count(*) INTO n FROM public.throw_targets;
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 rows, got %', n; END IF;
  SELECT count(*) INTO n FROM public.throw_targets WHERE thrower_seat IS NULL OR target_user_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'seats not resolved on % rows', n; END IF;

  -- A target seat whose player left records the seat with no player.
  INSERT INTO public.throwable_use_receipts VALUES
    (hu, '00000000-0000-4000-8000-000000000004', 'beer', '{"success":true}');
  PERFORM set_config('request.jwt.claim.sub', hu::text, true);
  r := public.fn_record_throw_target('00000000-0000-4000-8000-000000000004', t, 4);
  IF r->>'success' <> 'true' OR r->'target_user_id' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'left seat: %', r;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- Privileges: clients cannot touch the table; only service_role runs the horse wrapper.
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.throw_targets', 'SELECT')
     OR has_table_privilege('anon', 'public.throw_targets', 'SELECT')
     OR has_table_privilege('authenticated', 'public.throw_targets', 'INSERT') THEN
    RAISE EXCEPTION 'throw_targets is client-readable or writable';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_horse_record_throw_target(uuid,uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_record_throw_target(uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'function grants too wide';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_record_throw_target(uuid,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_horse_record_throw_target(uuid,uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'function grants too narrow';
  END IF;
END $$;
