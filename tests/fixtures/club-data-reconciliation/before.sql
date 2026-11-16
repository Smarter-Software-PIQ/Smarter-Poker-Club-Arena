-- Finalized RA evidence is read when its original accounting source commits.
ALTER TABLE rake_records ADD COLUMN bbj_contribution numeric DEFAULT 0,ADD COLUMN hand_id uuid;
CREATE TABLE rake_attributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rake_record_id uuid,player_id uuid,club_id uuid,hand_id uuid,bbj_attributed_contribution numeric);
CREATE INDEX fixture_ra_record_player ON rake_attributions(rake_record_id,player_id);
CREATE TABLE accounting_cash_accrual_batches(rake_record_id uuid);
CREATE TRIGGER fixture_original_ra_immutable BEFORE UPDATE OR DELETE ON rake_attributions FOR EACH ROW EXECUTE FUNCTION fn_accounting_cash_source_immutable();
INSERT INTO rake_records(id,table_id,bbj_contribution,hand_id) VALUES('eeeeeeee-0000-0000-0000-000000009001','c0000000-0000-0000-0000-000000000001',4.25,'eeeeeeee-0000-0000-0000-000000009011');
INSERT INTO rake_attributions(rake_record_id,player_id,club_id,hand_id,bbj_attributed_contribution) VALUES('eeeeeeee-0000-0000-0000-000000009001','11111111-0000-0000-0000-000000000001','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','eeeeeeee-0000-0000-0000-000000009011',6.25);
UPDATE rake_attributions SET bbj_attributed_contribution=4.25 WHERE rake_record_id='eeeeeeee-0000-0000-0000-000000009001';
INSERT INTO accounting_cash_accrual_batches VALUES('eeeeeeee-0000-0000-0000-000000009001');
INSERT INTO accounting_cash_rake_sources(id,rake_record_id,player_id,club_id,union_id,earned_at,rake_credit) VALUES('eeeeeeee-0000-0000-0000-000000009021','eeeeeeee-0000-0000-0000-000000009001','11111111-0000-0000-0000-000000000001','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','fade0000-0000-0000-0000-000000000001','2026-11-10 12:00Z',8);
INSERT INTO ca_club_acct_seed_log(acct_day,fact_rows,hand_rows) VALUES('2026-11-10',0,0);
