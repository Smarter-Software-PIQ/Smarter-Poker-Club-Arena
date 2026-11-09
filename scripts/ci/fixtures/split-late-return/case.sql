BEGIN;
SET LOCAL app.ledger_autoskip_club_members='@SKIP@';
SET LOCAL lock_timeout='3s';
SET LOCAL app.cash_original_debit_ledger='caller-original';
SELECT sr_pay(601.94);
SELECT sr_assert(current_setting('app.cash_original_debit_ledger')='caller-original' OR '@SKIP@'='', 'nested return preserves original debit output');
@REPEAT@
SELECT sr_assert((SELECT chip_treasury=1000 FROM clubs),'treasury conserved');
SELECT sr_assert((SELECT chip_balance=0 FROM club_members),'departed wallet zero');
SELECT sr_assert((SELECT count(*)=0 FROM financial_alerts),'return not silently deferred');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT sr_assert((SELECT count(*) FROM chip_ledger)=2*(SELECT count(*) FROM ca_horse_club_split_late_returns),'one payment and return leg each');
SELECT sr_assert((SELECT count(*)=count(DISTINCT idempotency_key) AND bool_and(correlation_id IS NOT NULL) FROM chip_ledger WHERE category='club_bank_claim' AND from_type='player_wallet'),'distinct named return receipts');
SELECT sr_assert(current_setting('lock_timeout')='3s','lock timeout restored');
ROLLBACK;
