BEGIN;
-- Actual helper, invoice issuer and board; synthetic original qualified facts.
-- Positive net loss means players lost. Full weekly net is never another bill.
CREATE OR REPLACE FUNCTION assert_weekly_results(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END$$;
SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
INSERT INTO ca_settlements SELECT 'union_rakeback_close','fade0000-0000-0000-0000-000000000001','final',
 'fade0000-0000-0000-0000-000000000001:2026-10-26T07:00:00Z..2026-11-02T08:00:00Z','{}'
 WHERE NOT EXISTS(SELECT FROM ca_settlements WHERE settlement_type='union_rakeback_close');
SELECT fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
SELECT assert_weekly_results((SELECT breakdown#>'{weekly_player_results}'=jsonb_build_object(
 'version',1,'cash_net_loss',-100,'tournament_net_loss',100,'total_net_loss',0,
 'rakeback_credit',70,'eco_charge',7,'weekly_net_due_to_union',-63,
 'sign_convention','positive_club_owes_union') FROM settlement_invoices WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000001'),
 'actual issuer records cash/tournament signs, total, rakeback and independent ECO');
SELECT assert_weekly_results((SELECT net_amount=7 AND breakdown->>'outstanding'='-7.00'
 AND from_entity_type='club' AND to_entity_type='union' AND notes LIKE '%Not An Additional Payment Request%'
 FROM settlement_invoices WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000001'),
 'external bill remains 7 while full weekly net is -63; delivery notes carry the distinction');
SELECT assert_weekly_results((ca_union_statement_board('fade0000-0000-0000-0000-000000000001','2026-11-02')#>>'{clubs,0,weekly_player_results,cash_net_loss}')::numeric=-100,
 'authorized board projects the immutable invoice activity snapshot');
CREATE TEMP TABLE protected_weekly_component_bytes AS SELECT jsonb_agg(to_jsonb(c)ORDER BY id)j FROM smarter_private.union_eco_components c;
UPDATE settlement_invoices SET message_sent=true WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000001';
CREATE TEMP TABLE protected_weekly_invoice_bytes AS SELECT to_jsonb(i)j FROM settlement_invoices i WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000001';
SELECT fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
SELECT assert_weekly_results((SELECT to_jsonb(i)=(SELECT j FROM protected_weekly_invoice_bytes)FROM settlement_invoices i WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000001')
 AND (SELECT jsonb_agg(to_jsonb(c)ORDER BY id)=(SELECT j FROM protected_weekly_component_bytes)FROM smarter_private.union_eco_components c),
 'retry preserves delivered invoice, original components and external amount byte-for-byte');
SELECT assert_weekly_results(NOT(smarter_private.union_eco_invoice_components('fade0000-0000-0000-0000-000000000001',md5('missing club')::uuid,'2026-10-26 07:00Z','2026-11-02 08:00Z')?'weekly_player_results'),
 'missing historical components never invent an activity split');
SELECT assert_weekly_results(NOT has_function_privilege('authenticated','smarter_private.union_eco_invoice_components(uuid,uuid,timestamptz,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('anon','smarter_private.union_eco_invoice_components(uuid,uuid,timestamptz,timestamptz)','EXECUTE'), 'private original facts remain inaccessible directly');

SAVEPOINT changed_input;
UPDATE native_eco_facts SET cash_pnl=cash_pnl+1;
DO $$ BEGIN
 BEGIN
  PERFORM fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
  RAISE EXCEPTION 'FAIL: changed input accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'union_invoice_original_player_results_disagree' THEN RAISE;END IF;
 END;
END $$;
ROLLBACK TO changed_input;
SELECT assert_weekly_results((SELECT to_jsonb(i)=(SELECT j FROM protected_weekly_invoice_bytes)FROM settlement_invoices i WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000001'),
 'changed current inputs refuse without restating original invoice');

ROLLBACK;
