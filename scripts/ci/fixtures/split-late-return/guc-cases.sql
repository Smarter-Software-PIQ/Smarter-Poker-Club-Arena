-- Transaction-local setting cases for the split late return. Each case is
-- strict: it raises GUC_LEAK naming every key whose value a split return
-- changed for its caller, and fails on any wrong ledger or correlation
-- outcome. @SKIP@ is the caller's app.ledger_autoskip_club_members ('1' for a
-- caller that journals its own payment, '' for an ordinary caller).

-- @case several_returns_keep_caller_keys both
BEGIN;
SELECT sr_caller('@SKIP@');
SELECT sr_credit(md5('horse')::uuid, 10);
SELECT sr_expect('@SKIP@', sr_expected_original('@SKIP@', md5('horse')::uuid));
SELECT sr_credit(md5('horse')::uuid, 20);
SELECT sr_expect('@SKIP@', sr_expected_original('@SKIP@', md5('horse')::uuid));
SELECT sr_credit(md5('horse2')::uuid, 30);
SELECT sr_expect('@SKIP@', sr_expected_original('@SKIP@', md5('horse2')::uuid));
SELECT sr_assert((SELECT count(*) = 3 FROM ca_horse_club_split_late_returns), 'three returns');
SELECT sr_assert((SELECT count(*) = 0 FROM financial_alerts), 'no return deferred');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- @case reader_right_after_departed_credit both
-- The writer's documented reader protocol (clear, UPDATE, read) applied to a
-- credit that lands on a departed record. No live function reads after a
-- credit (the three live readers read after their own debit); this case
-- measures what such a reader would see.
BEGIN;
SELECT sr_caller('@SKIP@');
SELECT set_config('app.cash_original_debit_ledger', '', true);
SELECT sr_credit(md5('horse')::uuid, 10);
SELECT sr_expect('@SKIP@', CASE WHEN '@SKIP@' = '1' THEN '' ELSE sr_expected_original('', md5('horse')::uuid) END);
ROLLBACK;

-- @case cash_funding_reads_own_debit_around_returns ordinary
-- Live cash funding (buy-in, add-on, rebuy) interleaved with split returns in
-- one transaction: each funding read must name its own debit leg, and every
-- later leg must carry the caller's correlation, not a return's.
BEGIN;
SELECT sr_caller('');
CREATE TEMP TABLE sr_reads(n int, amount numeric, leg uuid) ON COMMIT DROP;
INSERT INTO sr_reads SELECT 1, 5, sr_fund(md5('player')::uuid, 5);
SELECT sr_credit(md5('horse')::uuid, 10);
INSERT INTO sr_reads SELECT 2, 7, sr_fund(md5('player')::uuid, 7);
SELECT sr_credit(md5('horse2')::uuid, 11);
SELECT sr_credit(md5('horse')::uuid, 12);
INSERT INTO sr_reads SELECT 3, 9, sr_fund(md5('player')::uuid, 9);
SELECT sr_assert((SELECT count(*) = 3 AND bool_and(l.id IS NOT NULL AND l.from_type = 'player_wallet'
                    AND l.from_entity_id = md5('player')::uuid AND l.amount = r.amount)
                  FROM sr_reads r LEFT JOIN chip_ledger l ON l.id = r.leg), 'each funding read names its own debit leg');
SELECT sr_assert(NOT EXISTS (SELECT 1 FROM sr_reads r JOIN chip_ledger l ON l.id = r.leg
                   JOIN ca_horse_club_split_late_returns s ON s.op_id = l.correlation_id), 'no funding read names a return leg');
SELECT sr_assert((SELECT bool_and(l.correlation_id = md5('caller-correlation')::uuid) FROM sr_reads r JOIN chip_ledger l ON l.id = r.leg),
                 'funding legs carry the caller correlation');
SELECT sr_assert((SELECT count(*) = 3 FROM ca_horse_club_split_late_returns), 'three returns');
SELECT sr_assert((SELECT count(*) = 0 FROM chip_ledger l WHERE l.from_type = 'club_treasury' AND l.correlation_id IS DISTINCT FROM md5('caller-correlation')::uuid),
                 'payment legs carry the caller correlation');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- @case caught_failure_inside_return both
-- The return fails after its debit leg set the original-debit output; its own
-- handler catches it and defers the credit.
BEGIN;
SELECT sr_caller('@SKIP@');
SET LOCAL test.fail_inside_return_block = '1';
SELECT sr_credit(md5('horse2')::uuid, 30);
SET LOCAL test.fail_inside_return_block = '';
SELECT sr_expect('@SKIP@', sr_expected_original('@SKIP@', md5('horse2')::uuid));
SELECT sr_assert((SELECT count(*) = 1 FROM financial_alerts WHERE source = 'horse_split.late_return_deferred'), 'deferred, not raised');
SELECT sr_assert((SELECT count(*) = 0 FROM ca_horse_club_split_late_returns), 'no return recorded');
SELECT sr_assert((SELECT chip_balance = 30 FROM club_members WHERE user_id = md5('horse2')::uuid), 'credit stayed on the record');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- @case uncaught_failure_caught_by_caller both
-- A failure escapes the return (raised before its save) and the caller's own
-- exception block catches it. Nothing may differ from just before the call.
BEGIN;
SELECT sr_caller('@SKIP@');
SELECT sr_credit(md5('horse')::uuid, 10);
SELECT set_config('sr.before', sr_snapshot()::text, true);
DO $$BEGIN
  PERFORM set_config('test.fail_outside_return_block', '1', true);
  BEGIN
    PERFORM sr_credit(md5('horse2')::uuid, 30);
    RAISE EXCEPTION 'the return failure did not propagate';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'test_failure_outside_the_return_block' THEN RAISE; END IF;
  END;
  PERFORM set_config('test.fail_outside_return_block', '', true);
END$$;
SELECT sr_compare(current_setting('sr.before')::jsonb);
SELECT sr_assert((SELECT chip_balance = 0 FROM club_members WHERE user_id = md5('horse2')::uuid), 'caught failure rolled the credit back');
SELECT sr_assert((SELECT count(*) = 1 FROM ca_horse_club_split_late_returns), 'only the first return');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- @case uncaught_failure_aborts_transaction both
-- Nobody catches it: the transaction aborts and the session keeps its values.
SELECT sr_set_session();
BEGIN;
SELECT sr_caller('@SKIP@');
SELECT sr_credit(md5('horse')::uuid, 10);
SET LOCAL test.fail_outside_return_block = '1';
\set ON_ERROR_STOP off
SELECT sr_credit(md5('horse2')::uuid, 30);
\set ON_ERROR_STOP on
ROLLBACK;
SELECT sr_compare(sr_session_values());
SELECT sr_assert((SELECT count(*) = 0 FROM ca_horse_club_split_late_returns), 'aborted transaction kept nothing');

-- @case outer_commit both
-- Several returns, committed through the deferred balance invariant; after
-- the commit the session's values are intact and the next funding read names
-- its own leg.
SELECT sr_set_session();
BEGIN;
SELECT sr_caller('@SKIP@');
SELECT sr_credit(md5('horse')::uuid, 10);
SELECT sr_credit(md5('horse')::uuid, 20);
SELECT sr_credit(md5('horse2')::uuid, 30);
COMMIT;
SELECT sr_compare(sr_session_values());
SELECT sr_assert((SELECT count(*) = 3 FROM ca_horse_club_split_late_returns), 'three committed returns');
SELECT sr_assert((SELECT chip_treasury = 1000 FROM clubs), 'treasury conserved');
SELECT sr_assert((SELECT sum(chip_balance) = 0 FROM club_members WHERE membership_lifecycle_status = 'departed'), 'departed wallets zero');
SELECT sr_assert((SELECT count(*) = 6 FROM chip_ledger), 'one payment leg and one return leg each');
BEGIN;
SELECT sr_caller('');
SELECT set_config('sr.read', sr_fund(md5('player')::uuid, 5)::text, true);
SELECT sr_assert(current_setting('sr.read') = (SELECT id::text FROM chip_ledger WHERE from_entity_id = md5('player')::uuid ORDER BY chain_seq DESC LIMIT 1),
                 'first funding read after the commit names its own leg');
COMMIT;
SELECT sr_compare(sr_session_values());
