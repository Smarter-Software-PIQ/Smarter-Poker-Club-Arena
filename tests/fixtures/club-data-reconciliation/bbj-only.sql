-- BBJ-only accepted hands have no finalized rake source. Qualification only;
-- existing posted headline amounts are neither changed nor refused.
INSERT INTO bbj_pools VALUES('bbbbbbbb-0000-0000-0000-000000009100','fade0000-0000-0000-0000-000000000001',NULL);
INSERT INTO hand_atomic_commits VALUES
 ('c0000000-0000-0000-0000-000000000001',9101,'eeeeeeee-0000-0000-0000-000000009101','2026-11-09 12:00Z','2026-11-12 08:00:00.001Z','{"rake":null,"bbj_contribution":{"amount":1}}'),
 ('c0000000-0000-0000-0000-000000000001',9102,'eeeeeeee-0000-0000-0000-000000009102','2026-11-13 12:00Z',NULL,'{"rake":null,"bbj_contribution":{"amount":1}}'),
 ('c0000000-0000-0000-0000-000000000001',9103,'eeeeeeee-0000-0000-0000-000000009103','2026-11-14 12:00Z',NULL,'{"rake":null,"bbj_contribution":{"amount":1}}');
INSERT INTO union_pnl_cash_outcomes(table_id,hand_number,hand_id,recognized_at,payload_hash,game_scope,evidence) VALUES
 ('c0000000-0000-0000-0000-000000000001',9101,'eeeeeeee-0000-0000-0000-000000009101','2026-11-09 12:00Z','bbj-only-original','{"game_union_id":"fade0000-0000-0000-000000000001"}','{"participants":[]}'),
 ('c0000000-0000-0000-0000-000000000001',9102,'eeeeeeee-0000-0000-0000-000000009102','2026-11-13 12:00Z','other-union-original','{"game_union_id":"fade0000-0000-0000-0000-000000000002"}','{"participants":[]}'),
 ('c0000000-0000-0000-0000-000000000001',9103,'eeeeeeee-0000-0000-0000-000000009103','2026-11-14 12:00Z','standalone-original','{"game_union_id":null}','{"participants":[]}');
INSERT INTO bbj_contributions(pool_id,hand_id,table_id,hand_number,amount,created_at) VALUES
 ('bbbbbbbb-0000-0000-0000-000000009100','eeeeeeee-0000-0000-0000-000000009101','c0000000-0000-0000-0000-000000000001',9101,1,'2026-11-12 07:59:59.999Z');
DO $test$
DECLARE k constant uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
BEGIN
 IF fn_ca_club_acct_bbj_gap_days(k,'2026-11-09','2026-11-14') IS DISTINCT FROM ARRAY['2026-11-09'::date,'2026-11-11'::date] THEN
  RAISE EXCEPTION 'BBJ-only acceptance/late banking dates differ';END IF;
 IF fn_ca_club_acct_bbj_gap_days(k,'2026-11-10','2026-11-10')<>ARRAY[]::date[] THEN RAISE EXCEPTION 'intermediate day incorrectly masked';END IF;
 IF fn_ca_club_acct_bbj_gap_days(k,'2026-11-12','2026-11-12')<>ARRAY[]::date[] THEN RAISE EXCEPTION 'completion clock mislabeled as bank clock';END IF;
 IF fn_ca_club_acct_bbj_gap_days(k,'2026-11-13','2026-11-14')<>ARRAY[]::date[] THEN RAISE EXCEPTION 'other union or standalone masked this union';END IF;
END $test$;
-- With no outcome, the original bank pool is sufficient to identify the union.
INSERT INTO hand_atomic_commits VALUES('c0000000-0000-0000-0000-000000000001',9104,'eeeeeeee-0000-0000-0000-000000009104','2026-11-10 12:30Z','2026-11-10 12:31Z','{"rake":null,"bbj_contribution":{"amount":1}}');
INSERT INTO bbj_contributions(pool_id,hand_id,table_id,hand_number,amount,created_at) VALUES
 ('bbbbbbbb-0000-0000-0000-000000009100','eeeeeeee-0000-0000-0000-000000009104','c0000000-0000-0000-0000-000000000001',9104,1,'2026-11-10 12:30:01Z');
DO $test$ DECLARE r jsonb;BEGIN
 r:=ca_club_data_screen_union_basis('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-10','2026-11-10');
 IF (r#>>'{summary,fee}')::numeric<>8 OR (r#>>'{summary,total_winnings}')::numeric<>-10.25
  OR r#>>'{summary,reconciliation,complete}'<>'false'
  OR r#>'{summary,reconciliation,bbj_gross}' IS DISTINCT FROM 'null'::jsonb
  OR r#>'{summary,reconciliation,bbj_awards}' IS DISTINCT FROM 'null'::jsonb
  OR r#>'{summary,reconciliation,bbj_net}' IS DISTINCT FROM 'null'::jsonb
  OR r#>>'{accounting_coverage,complete}'<>'true' THEN RAISE EXCEPTION 'unsupported BBJ changed/refused posted headline or certified zero: %',r;END IF;
END $test$;
-- Genuinely unknown original union is unavailable only on its accepted date.
INSERT INTO hand_atomic_commits VALUES('c0000000-0000-0000-0000-000000000001',9105,'eeeeeeee-0000-0000-0000-000000009105','2026-11-15 12:00Z',NULL,'{"rake":null,"bbj_contribution":{"amount":1}}');
DO $test$ BEGIN
 IF fn_ca_club_acct_bbj_gap_days('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-15','2026-11-16') IS DISTINCT FROM ARRAY['2026-11-15'::date] THEN RAISE EXCEPTION 'unknown original scope became global pending coverage';END IF;
END $test$;
-- Retained unproven payload shapes must be safe to index; this does not claim
-- the normal accepted-hand RPC permits malformed or zero-amount rake objects.
INSERT INTO hand_atomic_commits VALUES
 ('c0000000-0000-0000-0000-000000000001',9106,'eeeeeeee-0000-0000-0000-000000009106','2026-10-01 12:00Z','2026-10-01 12:01Z','{"bbj_contribution":{"amount":1}}'),
 ('c0000000-0000-0000-0000-000000000001',9107,'eeeeeeee-0000-0000-0000-000000009107','2026-10-01 12:00Z','2026-10-01 12:01Z','{"rake":{"amount":0},"bbj_contribution":{"amount":1}}'),
 ('c0000000-0000-0000-0000-000000000001',9108,'eeeeeeee-0000-0000-0000-000000009108','2026-10-01 12:00Z','2026-10-01 12:01Z','{"rake":{"amount":"unknown"},"bbj_contribution":{"amount":1}}');
-- Representative exclusion/scoping shape, not a financial stress threshold.
INSERT INTO hand_atomic_commits
 SELECT 'c0000000-0000-0000-0000-000000000001',100000+g,md5('positive-rake-decoy:'||g)::uuid,
 '2026-10-01 00:00Z'::timestamptz+g*interval '1 second','2026-10-01 00:00Z'::timestamptz+(g+1)*interval '1 second',
 '{"rake":{"amount":1},"bbj_contribution":{"amount":1}}'::jsonb FROM generate_series(1,20000)g;
INSERT INTO hand_atomic_commits
 SELECT 'c0000000-0000-0000-0000-000000000001',200000+g,md5('completed-sparse-decoy:'||g)::uuid,
 '2026-10-01 00:00Z'::timestamptz+g*interval '1 second','2026-10-01 00:00Z'::timestamptz+(g+1)*interval '1 second',
 '{"rake":null,"bbj_contribution":{"amount":1}}'::jsonb FROM generate_series(1,1000)g;
ANALYZE hand_atomic_commits;
