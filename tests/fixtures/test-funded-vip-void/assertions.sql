\set ON_ERROR_STOP 1
DO $$
DECLARE r jsonb; n_tx integer := (SELECT count(*) FROM diamond_transactions); d integer;
BEGIN
  ASSERT NOT has_function_privilege('authenticated','public.fn_ca_void_test_funded_vip_purchase(text,text,text,text)','EXECUTE'), 'players cannot void';
  ASSERT NOT has_function_privilege('anon','public.fn_ca_void_test_funded_vip_purchase(text,text,text,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.fn_ca_void_test_funded_vip_purchase(text,text,text,text)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.ca_test_funded_spend_voids','SELECT');

  ASSERT fn_ca_void_test_funded_vip_purchase('vip-f','ops','too short','op-1')->>'reason' = 'invalid_arguments';
  ASSERT fn_ca_void_test_funded_vip_purchase('nope','ops','a reason that is long enough here','op-0')->>'reason' = 'purchase_not_found';

  r := fn_ca_void_test_funded_vip_purchase('vip-p','ops','a reason that is long enough here','op-p');
  ASSERT r->>'reason' = 'not_paid_for_with_admin_minted_test_funding', 'a real purchase was voidable: ' || r::text;
  ASSERT (SELECT is_vip AND vip_tier='monthly' FROM profiles WHERE id='a0000000-0000-4000-8000-000000000002'), 'real VIP untouched';

  d := (SELECT diamonds FROM profiles WHERE id='f0000000-0000-4000-8000-000000000001');
  r := fn_ca_void_test_funded_vip_purchase('vip-f','rabbit hunt lane','Unauthorized admin mint funded this fixture VIP purchase','op-1');
  ASSERT (r->>'ok')::boolean AND NOT (r->>'replayed')::boolean, r::text;
  ASSERT (r->'void'->>'amount')::int = 2000 AND r->'void'->>'recognized_to' = 'revenue:vip_membership'
     AND (r->'void'->>'funding_mint_total')::int = 2009 AND r->'void'->>'reclassified_as' = 'unauthorized_test_funding_not_consumption', r::text;
  ASSERT (r->'void'->'entitlement_before'->>'is_vip')::boolean AND NOT (r->'void'->'entitlement_after'->>'is_vip')::boolean, r::text;
  ASSERT (SELECT NOT is_vip AND vip_tier IS NULL AND vip_expires_at <= now() FROM profiles WHERE id='f0000000-0000-4000-8000-000000000001'), 'entitlement ended';
  ASSERT (SELECT count(*) FROM diamond_transactions) = n_tx, 'no ledger row written: no refund, history unchanged';
  ASSERT (SELECT diamonds FROM profiles WHERE id='f0000000-0000-4000-8000-000000000001') = d, 'no balance moved';

  r := fn_ca_void_test_funded_vip_purchase('vip-f','rabbit hunt lane','Unauthorized admin mint funded this fixture VIP purchase','op-1');
  ASSERT (r->>'replayed')::boolean, 'replay';
  r := fn_ca_void_test_funded_vip_purchase('vip-f','someone else','A second attempt with a different key entirely','op-2');
  ASSERT (r->>'replayed')::boolean AND r->'void'->>'op_id' = 'op-1', 'one void per purchase';
  ASSERT (SELECT count(*) FROM ca_test_funded_spend_voids) = 1;

  ASSERT fn_ca_void_test_funded_vip_purchase('vip-x','ops','a reason that is long enough here','op-1')->>'reason' = 'op_id_used_for_another_purchase';
  r := fn_ca_void_test_funded_vip_purchase('vip-x','ops','a reason that is long enough here','op-x');
  ASSERT r->>'reason' = 'entitlement_changed_since_purchase', r::text;
  ASSERT (SELECT is_vip FROM profiles WHERE id='c0000000-0000-4000-8000-000000000003'), 'extended VIP untouched';

  BEGIN UPDATE ca_test_funded_spend_voids SET reason = reason || ' edited'; ASSERT false, 'void edited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM ca_test_funded_spend_voids; ASSERT false, 'void deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'TEST_FUNDED_VOID_OK';
