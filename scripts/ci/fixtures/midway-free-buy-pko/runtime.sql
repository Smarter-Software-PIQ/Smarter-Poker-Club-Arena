BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
-- The real engine presentation update, through both installed trigger bodies.
UPDATE tournaments SET blind_structure=blind_structure,payout_structure=payout_structure,
 spin_reveal_at='2026-11-02T19:00:00Z',spin_reveal_lag_ms=1000;
DO $$BEGIN
 IF (SELECT spin_reveal_lag_ms FROM tournaments) IS DISTINCT FROM 1000 THEN RAISE EXCEPTION 'Spin presentation did not persist'; END IF;
 -- A forged context does not enter the postgres-only private conversion branch.
 PERFORM set_config('app.midway_free_buy_conversion','10000000-0000-0000-0000-000000000001',true);
 IF has_function_privilege(current_user,'fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)','execute')
 OR has_function_privilege(current_user,'fn_ca_convert_midway_free_buy(uuid)','execute')
 OR has_function_privilege(current_user,'fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)','execute') THEN
 RAISE EXCEPTION 'Private conversion or funding exposed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
-- Ordinary non-contract updates still pass for the browser role.
UPDATE tournaments SET spin_reveal_lag_ms=1001;
DO $$BEGIN
 BEGIN
  UPDATE tournaments SET starting_chips=999999;
  RAISE EXCEPTION 'Protected registered contract change accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'This tournament cannot be modified after a player has registered' THEN RAISE; END IF;
 END;
 IF has_function_privilege(current_user,'fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)','execute') THEN
 RAISE EXCEPTION 'Private predicate exposed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: original service-role refusal, corrected engine/browser updates, protected contract refusal, private conversion ACLs and rollback';
