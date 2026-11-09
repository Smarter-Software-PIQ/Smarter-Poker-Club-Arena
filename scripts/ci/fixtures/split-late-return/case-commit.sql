BEGIN;
SET LOCAL app.ledger_autoskip_club_members='1';
SET LOCAL lock_timeout='3s';
SET LOCAL app.cash_original_debit_ledger='caller-original';
SELECT sr_pay(601.94);
SELECT sr_assert(current_setting('app.cash_original_debit_ledger')='caller-original','retry preserves original debit output');
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
