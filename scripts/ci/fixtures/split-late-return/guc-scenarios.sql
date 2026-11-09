-- Test-only helpers for the transaction-local setting (GUC) save/restore
-- matrix in scripts/ci/test-split-late-return-postgres.py. Loaded after
-- schema.sql, actual-functions.json, wiring.sql and the split return body
-- under test. Nothing here is a migration and nothing touches production.

-- Production trigger shapes (live pg_trigger, 2026-11-09). wiring.sql omits
-- the WHEN clauses; the matrix uses the live ones so a debit never enters the
-- split return, exactly as on production. Firing order (by name) is unchanged.
DROP TRIGGER zzzz_horse_split_late_credit_returns_to_bank ON club_members;
CREATE TRIGGER zzzz_horse_split_late_credit_returns_to_bank AFTER UPDATE OF chip_balance ON club_members FOR EACH ROW
  WHEN (((new.membership_lifecycle_status = 'departed'::text) AND (new.chip_balance > old.chip_balance)))
  EXECUTE FUNCTION fn_ca_horse_split_return_late_credit();
DROP TRIGGER trg_club_members_audit_chip_movement ON club_members;
CREATE TRIGGER trg_club_members_audit_chip_movement AFTER UPDATE OF chip_balance ON club_members FOR EACH ROW
  WHEN ((old.chip_balance IS DISTINCT FROM new.chip_balance))
  EXECUTE FUNCTION fn_club_members_ledger_writer();

INSERT INTO club_members VALUES(md5('club')::uuid,md5('horse2')::uuid,0,'departed',now()),
                               (md5('club')::uuid,md5('player')::uuid,1000,'active',now());
INSERT INTO ca_horse_club_split_receipts VALUES('5b11c1b0-2026-1102-0000-000000000001','departed',md5('horse2')::uuid,md5('club')::uuid);

-- Failure injection. Outside the return's protected block: the split return
-- calls this before it saves anything, so a raise here escapes the trigger.
CREATE OR REPLACE FUNCTION fn_ca_horse_assigned_club(uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.fail_outside_return_block', true) = '1' THEN
    RAISE EXCEPTION 'test_failure_outside_the_return_block';
  END IF;
  RETURN md5('assigned')::uuid;
END$$;
-- Inside the protected block: after the member debit, its journal leg (which
-- sets app.cash_original_debit_ledger) and the bank credit have run.
CREATE FUNCTION sr_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.fail_inside_return_block', true) = '1' THEN
    RAISE EXCEPTION 'test_failure_inside_the_return_block';
  END IF;
  RETURN NEW;
END$$;
CREATE TRIGGER sr_fail_receipt BEFORE INSERT ON chip_transactions FOR EACH ROW EXECUTE FUNCTION sr_fail_receipt();

-- Every key the split return saves, plus the original-debit output its nested
-- member journal writes, plus lock_timeout.
CREATE FUNCTION sr_keys() RETURNS text[] LANGUAGE sql AS $$SELECT ARRAY[
  'app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity',
  'app.ledger_counterparty_label','app.ledger_settlement','app.ledger_idempotency_key',
  'app.ledger_correlation','app.ledger_autoskip_clubs','app.ledger_autoskip_club_members',
  'app.cash_original_debit_ledger','lock_timeout']$$;
CREATE FUNCTION sr_snapshot() RETURNS jsonb LANGUAGE sql AS
  $$SELECT jsonb_object_agg(k, coalesce(current_setting(k, true), '')) FROM unnest(sr_keys()) k$$;
CREATE FUNCTION sr_label(v text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(v, '<null>') || CASE
    WHEN EXISTS (SELECT 1 FROM chip_ledger l JOIN ca_horse_club_split_late_returns s ON s.op_id = l.correlation_id
                  WHERE l.id::text = v) THEN ' (split return leg)'
    WHEN EXISTS (SELECT 1 FROM chip_ledger l WHERE l.id::text = v) THEN ' (caller leg)'
    ELSE '' END$$;
CREATE FUNCTION sr_compare(p_expected jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text; v text; bad text[] := '{}';
BEGIN
  FOREACH k IN ARRAY sr_keys() LOOP
    v := coalesce(current_setting(k, true), '');
    IF v IS DISTINCT FROM p_expected ->> k THEN
      bad := bad || (k || '=' || sr_label(v) || ' expected ' || sr_label(p_expected ->> k));
    END IF;
  END LOOP;
  IF cardinality(bad) > 0 THEN RAISE EXCEPTION 'GUC_LEAK %', array_to_string(bad, '; '); END IF;
END$$;
-- The caller's declared environment (distinct sentinel per key).
CREATE FUNCTION sr_caller_values(p_skip text, p_original text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'app.ledger_category', 'club_bank_claim', 'app.ledger_counterparty', 'club_treasury',
    'app.ledger_counterparty_entity', md5('club')::uuid::text, 'app.ledger_counterparty_label', '',
    'app.ledger_settlement', 'caller-settlement', 'app.ledger_idempotency_key', '',
    'app.ledger_correlation', md5('caller-correlation')::uuid::text, 'app.ledger_autoskip_clubs', '1',
    'app.ledger_autoskip_club_members', p_skip, 'app.cash_original_debit_ledger', p_original,
    'lock_timeout', '3s')$$;
CREATE FUNCTION sr_caller(p_skip text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM jsonb_each_text(sr_caller_values(p_skip, md5('caller-original')::uuid::text)) LOOP
    PERFORM set_config(r.key, r.value, true);
  END LOOP;
END$$;
CREATE FUNCTION sr_expect(p_skip text, p_original text) RETURNS void LANGUAGE sql AS
  $$SELECT sr_compare(sr_caller_values(p_skip, p_original))$$;
-- After a caller's own member UPDATE the original-debit output names the
-- caller's own leg (fn_club_members_ledger_writer's contract), or keeps the
-- caller's value when the caller stood that writer down.
CREATE FUNCTION sr_expected_original(p_skip text, p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_skip = '1' THEN md5('caller-original')::uuid::text
    ELSE (SELECT id::text FROM chip_ledger WHERE to_type = 'player_wallet' AND to_entity_id = p_user
           ORDER BY chain_seq DESC LIMIT 1) END$$;
CREATE FUNCTION sr_session_values() RETURNS jsonb LANGUAGE sql AS
  $$SELECT jsonb_object_agg(k, CASE k WHEN 'lock_timeout' THEN '4s' ELSE 'session:' || k END) FROM unnest(sr_keys()) k$$;
CREATE FUNCTION sr_set_session() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM jsonb_each_text(sr_session_values()) LOOP PERFORM set_config(r.key, r.value, false); END LOOP;
END$$;

-- A payment to a member. When the caller stood the member journal down it
-- writes its own named leg; otherwise the member journal writes it.
CREATE FUNCTION sr_credit(p_user uuid, n numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE club_members SET chip_balance = chip_balance + n WHERE club_id = md5('club')::uuid AND user_id = p_user;
  IF current_setting('app.ledger_autoskip_club_members', true) = '1' THEN
    INSERT INTO chip_ledger(from_type, from_entity_id, to_type, to_entity_id, amount, category, club_id)
    VALUES ('club_treasury', md5('club')::uuid, 'player_wallet', p_user, n, 'club_bank_claim', md5('club')::uuid);
  END IF;
  UPDATE clubs SET chip_treasury = chip_treasury - n WHERE id = md5('club')::uuid;
END$$;
-- The cash-funding original-debit protocol, line for line from
-- atomic_table_{buyin,addon,rebuy}_before_maintenance_announcement_gate
-- (20260917230925, live): clear, debit, read immediately.
CREATE FUNCTION sr_fund(p_user uuid, n numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_new numeric; v_original_ledger uuid;
BEGIN
  PERFORM set_config('app.ledger_category', 'club_bank_claim', true);
  PERFORM set_config('app.ledger_counterparty', 'club_treasury', true);
  PERFORM set_config('app.ledger_counterparty_entity', md5('club')::uuid::text, true);
  PERFORM set_config('app.cash_original_debit_ledger', '', true);
  UPDATE club_members SET chip_balance = chip_balance - n, updated_at = now()
   WHERE user_id = p_user AND club_id = md5('club')::uuid AND chip_balance >= n
   RETURNING chip_balance INTO v_new;
  v_original_ledger := NULLIF(current_setting('app.cash_original_debit_ledger', true), '')::uuid;
  IF v_new IS NULL THEN RAISE EXCEPTION 'insufficient'; END IF;
  UPDATE clubs SET chip_treasury = chip_treasury + n WHERE id = md5('club')::uuid;
  RETURN v_original_ledger;
END$$;
