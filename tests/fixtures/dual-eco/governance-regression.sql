-- Run before the original regression deliberately damages its invoice.
SELECT assert_eco(EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded' AND offenders=1),'baseline reproduces false missing ECO after complete activity book');
SELECT fn_ca_conservation_sweep();
SELECT assert_eco(EXISTS(SELECT FROM fixture_raised WHERE source='fn_ca_conservation_sweep:fn_union_governance_check' AND jsonb_array_length(metadata->'eco_obligations')=1),'baseline sweep captures already-proven obligation');
\ir ../../../supabase/migrations/20261112140740_eco_governance_reads_finalized_activity_records.sql
SELECT assert_eco(NOT EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'complete actual v2 book is no longer a missing legacy ledger');
TRUNCATE fixture_raised;
SELECT fn_ca_conservation_sweep();
SELECT assert_eco(NOT EXISTS(SELECT FROM fixture_raised WHERE source='fn_ca_conservation_sweep:fn_union_governance_check' AND metadata ? 'eco_obligations'),'sweep does not recreate the false v2 obligation');

-- One genuine missing union must never capture a second, proven union.
INSERT INTO unions SELECT md5('unposted union')::uuid,owner_id,'Unposted','',settings FROM unions LIMIT 1;
INSERT INTO union_clubs SELECT md5('unposted union')::uuid,id FROM clubs;
TRUNCATE fixture_raised;
SELECT fn_ca_conservation_sweep();
SELECT assert_eco(EXISTS(SELECT FROM fixture_raised WHERE source='fn_ca_conservation_sweep:fn_union_governance_check' AND metadata->'eco_obligations'=jsonb_build_array(jsonb_build_object('union_id',md5('unposted union')::uuid,'period_start',fn_union_prev_week_start(),'period_end',fn_union_week_start()))),'mixed sweep captures only genuinely missing original union');
DELETE FROM union_clubs WHERE union_id=md5('unposted union')::uuid;
DELETE FROM unions WHERE id=md5('unposted union')::uuid;

BEGIN;
UPDATE union_accounting_runs SET status='failed';
SELECT assert_eco(EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'partial close remains visible');
ROLLBACK;
BEGIN;
UPDATE settlement_invoices SET message_sent=false;
SELECT assert_eco(EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'undelivered original invoices remain visible');
ROLLBACK;
BEGIN;
UPDATE settlement_invoices SET breakdown=jsonb_set(breakdown,'{eco_components,0,record_id}',to_jsonb(md5('wrong component')::uuid));
SELECT assert_eco(EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'wrong immutable component identity remains visible');
ROLLBACK;
BEGIN;
UPDATE union_accounting_runs SET period_end=period_end+interval '1 hour';
SELECT assert_eco(EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'wrong exact DST period remains visible');
ROLLBACK;
BEGIN;
DELETE FROM union_accounting_runs;
SELECT assert_eco(EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'components without finalized original run remain visible');
INSERT INTO union_eco_ledger(union_id,club_id,period_start,period_end) SELECT union_id,club_id,fn_union_prev_week_start(),fn_union_week_start() FROM union_clubs;
SELECT assert_eco(NOT EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'legacy exact-period detector behavior is preserved');
ROLLBACK;
BEGIN;
UPDATE union_accounting_runs SET status='running';
SELECT assert_eco(NOT EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'running close remains deferred');
ROLLBACK;
BEGIN;
DELETE FROM union_accounting_runs;
INSERT INTO accounting_close_gates SELECT 'union',id,fn_union_prev_week_start(),fn_union_week_start(),now()+interval '1 hour' FROM unions;
SELECT assert_eco(NOT EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'original unstarted future gate remains deferred');
ROLLBACK;
BEGIN;
DELETE FROM union_accounting_runs;
SELECT set_config('test.not_due','yes',true);
SELECT assert_eco(NOT EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'close not yet due remains deferred');
SELECT set_config('test.not_due','no',true);
SELECT set_config('test.launch_waived','yes',true);
SELECT assert_eco(NOT EXISTS(SELECT FROM fn_union_credit_risk_check() WHERE invariant='union_eco_not_recorded'),'existing launch waiver remains effective');
ROLLBACK;
-- Existing exact obligations survive later refresh even after proof succeeds.
INSERT INTO ca_drift_incidents(source,status,metadata) SELECT 'fn_ca_conservation_sweep:fn_union_governance_check','open',m FROM governance_eco;
TRUNCATE fixture_raised;
SELECT fn_ca_conservation_sweep();
SELECT assert_eco(EXISTS(SELECT FROM fixture_raised WHERE source='fn_ca_conservation_sweep:fn_union_governance_check' AND metadata->'eco_obligations'=(SELECT m->'eco_obligations' FROM governance_eco)),'refresh never deletes an existing original obligation');
DELETE FROM ca_drift_incidents;
