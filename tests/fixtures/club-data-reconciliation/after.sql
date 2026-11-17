-- The pre-accrual update was accepted; finalized source mutation stays refused.
DO $test$ BEGIN
 BEGIN UPDATE rake_attributions SET bbj_attributed_contribution=99 WHERE rake_record_id='eeeeeeee-0000-0000-0000-000000009001';
 RAISE EXCEPTION 'financial source mutation unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $test$;
-- Live source, followed by an original funded-club admission.
INSERT INTO rake_records(id,table_id,bbj_contribution,hand_id) VALUES('eeeeeeee-0000-0000-0000-000000009002','c0000000-0000-0000-0000-000000000001',2.50,'eeeeeeee-0000-0000-0000-000000009012');
INSERT INTO rake_attributions(rake_record_id,player_id,club_id,hand_id,bbj_attributed_contribution) VALUES('eeeeeeee-0000-0000-0000-000000009002','11111111-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000009012',2.50);
INSERT INTO accounting_cash_rake_sources(id,rake_record_id,player_id,club_id,union_id,earned_at,rake_credit) VALUES('eeeeeeee-0000-0000-0000-000000009022','eeeeeeee-0000-0000-0000-000000009002','11111111-0000-0000-0000-000000000002','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','fade0000-0000-0000-0000-000000000001','2026-11-10 13:00Z',5);
INSERT INTO accounting_cash_funding_contract_admissions(source_id,funding_club_id) VALUES('eeeeeeee-0000-0000-0000-000000009022','a0000000-0000-0000-0000-000000000001');
-- Original result and award readers, not wallet residuals.
INSERT INTO union_pnl_cash_outcomes VALUES('c0000000-0000-0000-0000-000000000001',991,'eeeeeeee-0000-0000-0000-000000009011',pg_current_xact_id(),'2026-11-10 12:00Z','recon-original','{"game_union_id":"fade0000-0000-0000-0000-000000000001"}','{"status":"ready","participants":[{"user_id":"11111111-0000-0000-0000-000000000001","earning_club_id":"a41434bb-8d0c-400a-8f0d-e8b3d65afed4","observed_stack_delta":-12.25},{"user_id":"11111111-0000-0000-0000-000000000002","earning_club_id":"a0000000-0000-0000-0000-000000000001","observed_stack_delta":-7.50}]}');
INSERT INTO union_pnl_cash_outcome_touches VALUES('c0000000-0000-0000-0000-000000000001',991,'2026-11-10 12:00Z','fade0000-0000-0000-0000-000000000001',false,'13','[{"user_id":"11111111-0000-0000-0000-000000000001","earning_club_id":"a41434bb-8d0c-400a-8f0d-e8b3d65afed4","observed_stack_delta":-12.25},{"user_id":"11111111-0000-0000-0000-000000000002","earning_club_id":"a0000000-0000-0000-0000-000000000001","observed_stack_delta":-7.50}]');
INSERT INTO bbj_payouts VALUES('bbbbbbbb-0000-0000-0000-000000009001','c0000000-0000-0000-0000-000000000001',991,'2026-11-10 12:05Z');
INSERT INTO bbj_payout_recipients(payout_id,user_id,amount,created_at) VALUES('bbbbbbbb-0000-0000-0000-000000009001','11111111-0000-0000-0000-000000000001',2,'2026-11-10 12:05Z');
