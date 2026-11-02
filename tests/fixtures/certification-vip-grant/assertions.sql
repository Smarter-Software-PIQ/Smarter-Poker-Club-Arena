\set ON_ERROR_STOP 1
DO $$ BEGIN
  ASSERT has_function_privilege('service_role','public.fn_ca_certification_vip_grant(uuid,integer,text,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.fn_ca_certification_vip_grant(uuid,integer,text,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.fn_ca_certification_vip_grant(uuid,integer,text,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.fn_ca_certification_vip_end(uuid,text,text)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.ca_certification_vip_grants','SELECT');
END $$;
SET test.role = 'authenticated';
DO $$ BEGIN
  BEGIN PERFORM fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000001',60,'agent','a reason long enough for audit','x'); ASSERT false, 'player granted VIP';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET test.role = 'service_role';
DO $$
DECLARE r jsonb; why text := 'Certification of VIP-only rabbit hunt behavior';
  a uuid := '11111111-0000-0000-0000-000000000001';
BEGIN
  -- refusals change nothing
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000005',60,'agent',why,'r5')->>'reason' = 'not_a_reserved_certification_account', 'real player';
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000004',60,'agent',why,'r4')->>'reason' = 'not_a_reserved_certification_account', 'ad hoc .invalid fixture';
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000003',60,'agent',why,'r3')->>'reason' = 'not_a_reserved_certification_account', 'deleted identity';
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000007',60,'agent',why,'r7')->>'reason' = 'not_a_reserved_certification_account', 'admin';
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000006',60,'agent',why,'r6')->>'reason' = 'account_already_has_a_vip_entitlement', 'lifetime kept';
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000008',60,'agent',why,'r8')->>'reason' = 'account_already_has_a_vip_entitlement', 'subscription kept';
  ASSERT fn_ca_certification_vip_grant(a,0,'agent',why,'z0')->>'reason' = 'minutes_must_be_1_to_180';
  ASSERT fn_ca_certification_vip_grant(a,181,'agent',why,'z1')->>'reason' = 'minutes_must_be_1_to_180';
  ASSERT fn_ca_certification_vip_grant(a,60,'agent','short','z2')->>'reason' = 'operator_and_reason_required';
  ASSERT NOT EXISTS (SELECT 1 FROM profiles WHERE is_vip AND id NOT IN ('11111111-0000-0000-0000-000000000006'));
  ASSERT NOT EXISTS (SELECT 1 FROM ca_certification_vip_grants);
  ASSERT (SELECT vip_tier FROM profiles WHERE id='11111111-0000-0000-0000-000000000006') = 'lifetime';

  -- grant, replay, one open grant
  r := fn_ca_certification_vip_grant(a,60,'agent',why,'g1');
  ASSERT r->>'ok' = 'true' AND r->>'replayed' = 'false', r::text;
  ASSERT (SELECT is_vip AND vip_tier='monthly' AND abs(extract(epoch FROM vip_expires_at - (now()+interval '60 minutes'))) < 5 FROM profiles WHERE id=a);
  ASSERT fn_ca_certification_vip_grant(a,60,'agent',why,'g1')->>'replayed' = 'true';
  ASSERT fn_ca_certification_vip_grant(a,60,'agent',why,'g2')->>'reason' = 'account_already_has_a_vip_entitlement';
  ASSERT fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000002',60,'agent',why,'g1')->>'reason' = 'op_id_belongs_to_another_grant';
  ASSERT (SELECT count(*) FROM ca_certification_vip_grants) = 1;

  -- end: withdraws only this grant, idempotent
  ASSERT fn_ca_certification_vip_end(a,'nope','cleanup')->>'reason' = 'no_such_grant';
  r := fn_ca_certification_vip_end(a,'g1','certification cleanup');
  ASSERT r->>'ok' = 'true' AND r->>'replayed' = 'false', r::text;
  ASSERT (SELECT NOT is_vip AND vip_tier IS NULL AND vip_expires_at <= now() FROM profiles WHERE id=a);
  ASSERT fn_ca_certification_vip_end(a,'g1','certification cleanup')->>'replayed' = 'true';

  -- an end never touches an entitlement the grant did not write
  r := fn_ca_certification_vip_grant('11111111-0000-0000-0000-000000000002',30,'agent',why,'g3');
  UPDATE profiles SET vip_tier='lifetime', vip_expires_at=null WHERE id='11111111-0000-0000-0000-000000000002';
  PERFORM fn_ca_certification_vip_end('11111111-0000-0000-0000-000000000002','g3','certification cleanup');
  ASSERT (SELECT is_vip AND vip_tier='lifetime' FROM profiles WHERE id='11111111-0000-0000-0000-000000000002'), 'real entitlement withdrawn';

  -- a lapsed grant is closed on record before a new one opens
  UPDATE profiles SET is_vip=false, vip_tier=null, vip_expires_at=null WHERE id='11111111-0000-0000-0000-000000000002';
  r := fn_ca_certification_vip_grant(a,5,'agent',why,'g4');
  ASSERT r->>'ok' = 'true', r::text;
END $$;

-- audit integrity
DO $$ BEGIN
  BEGIN DELETE FROM ca_certification_vip_grants; ASSERT false, 'deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE ca_certification_vip_grants SET expires_at = expires_at + interval '1 day' WHERE op_id='g4'; ASSERT false, 'extended';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
  BEGIN UPDATE ca_certification_vip_grants SET end_reason = 'rewritten' WHERE op_id='g1'; ASSERT false, 'rewrote an end';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM ca_certification_vip_grants) = 3;
END $$;
RESET test.role;
\echo CERTIFICATION_VIP_GRANT_ASSERTIONS_OK
