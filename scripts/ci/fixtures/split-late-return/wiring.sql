REVOKE ALL ON FUNCTION fn_ca_horse_split_return_late_credit() FROM PUBLIC;
CREATE TRIGGER trg_club_members_audit_chip_movement AFTER UPDATE ON club_members FOR EACH ROW EXECUTE FUNCTION fn_club_members_ledger_writer();
CREATE TRIGGER trg_ca_autoledger AFTER UPDATE ON clubs FOR EACH ROW EXECUTE FUNCTION fn_ca_autoledger('chip_treasury=club_treasury','chip_pool=club_treasury');
CREATE TRIGGER zy_ca_tally_balance_move AFTER UPDATE ON club_members FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE TRIGGER zy_ca_tally_balance_move AFTER UPDATE ON clubs FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE TRIGGER trg_ca_chip_ledger_enrich BEFORE INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_chip_ledger_enrich();
CREATE TRIGGER zy_ca_tally_ledger_leg AFTER INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_ledger_leg();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER UPDATE ON clubs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER UPDATE ON club_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER INSERT ON chip_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE TRIGGER zzzz_horse_split_late_credit_returns_to_bank AFTER UPDATE ON club_members FOR EACH ROW EXECUTE FUNCTION fn_ca_horse_split_return_late_credit();
CREATE FUNCTION sr_pay(n numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s text:=coalesce(current_setting('app.ledger_autoskip_club_members',true),'');
BEGIN
 PERFORM fn_ca_declare_ledger('rakeback','club_treasury',md5('club')::uuid,NULL,'payment:'||gen_random_uuid()::text,ARRAY['clubs']);
 IF s='1' THEN
  UPDATE club_members SET chip_balance=chip_balance+n;
  INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('club_treasury',md5('club')::uuid,'player_wallet',md5('horse')::uuid,n,'rakeback',md5('club')::uuid);
 ELSE
  -- Ordinary callers use their declared non-rakeback journal authority.
  PERFORM set_config('app.ledger_category','club_bank_claim',true);
  UPDATE club_members SET chip_balance=chip_balance+n;
 END IF;
 UPDATE clubs SET chip_treasury=chip_treasury-n;
 PERFORM sr_assert(current_setting('app.ledger_autoskip_club_members',true)=s,'member skip restored');
 PERFORM sr_assert(current_setting('app.ledger_category',true)=CASE WHEN s='1' THEN 'rakeback' ELSE 'club_bank_claim' END,'category restored');
 PERFORM sr_assert(current_setting('app.ledger_idempotency_key',true)='','idempotency restored');
END$$;
