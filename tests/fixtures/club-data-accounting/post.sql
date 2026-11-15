-- Rows written AFTER the cutover: the live projection owns them. Each
-- statement is its own transaction, as each money write is in production.
\set K '''a41434bb-8d0c-400a-8f0d-e8b3d65afed4'''
\set F '''a0000000-0000-0000-0000-000000000001'''
\set D '''2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'''
\set U '''fade0000-0000-0000-0000-000000000001'''
\set T1 '''c0000000-0000-0000-0000-000000000001'''
\set T2 '''c0000000-0000-0000-0000-000000000002'''
\set TT1 '''d0000000-0000-0000-0000-000000000001'''
\set TT2 '''d0000000-0000-0000-0000-000000000002'''
\set u1 '''11111111-0000-0000-0000-000000000001'''
\set u2 '''11111111-0000-0000-0000-000000000002'''
\set u3 '''11111111-0000-0000-0000-000000000003'''

INSERT INTO accounting_cash_rake_sources (id, rake_record_id, player_id, club_id, union_id, earned_at, rake_credit) VALUES
  ('5c000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000005', :u1, :K, :U, '2026-11-03 11:00+00', 6.00);
-- A funding admission after the cutover moves a SEEDED fee from K to F.
INSERT INTO accounting_cash_funding_contract_admissions (source_id, original_club_id, funding_club_id)
VALUES ('5c000000-0000-0000-0000-000000000004', :K, :F);
-- The escrow certificate of the seeded shaped hand T1#2 reshapes it.
INSERT INTO smarter_private.posthand_escrow_certificates (table_id, hand_number, original) VALUES
  (:T1, 2, jsonb_build_object('participants', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -6),
     jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', 5))));
INSERT INTO union_pnl_cash_outcomes (table_id, hand_number, hand_id, recognized_at, payload_hash, game_scope, evidence) VALUES
  (:T1, 5, gen_random_uuid(), '2026-11-03 12:00+00', 'h5', jsonb_build_object('game_union_id', :U), '{"status":"ready"}'),
  (:T1, 6, gen_random_uuid(), '2026-11-03 13:30+00', 'h6', jsonb_build_object('game_union_id', :U), '{"status":"ready"}'),
  (:T2, 2, 'aaaa0000-0000-0000-0000-000000000002', '2026-11-03 12:30+00', 'l2', '{}', '{"status":"ready","accepted_rake":"0"}');
INSERT INTO union_pnl_cash_outcome_touches VALUES
  (:T1, 5, '2026-11-03 12:00+00', :U, false, '0.2', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', 1),
     jsonb_build_object('earning_club_id', :D, 'user_id', :u3, 'observed_stack_delta', -1.20),
     -- Dealt in, no chips in and none won: the hand is not The Felt Society's.
     jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', 0))),
  -- Raked, and no participant with an earning club changed stack: the
  -- hand is the table club's (T1's club is the union's house club).
  (:T1, 6, '2026-11-03 13:30+00', :U, false, '0.3', jsonb_build_array(
     jsonb_build_object('user_id', :u3, 'observed_stack_delta', -0.30)));
INSERT INTO union_pnl_cash_outcome_link_resolutions (table_id, hand_number, hand_id, outcome_payload_hash, outcome_evidence_md5,
  roster_source, game_scope, evidence, proof, proof_md5)
SELECT :T2, 2, o.hand_id, o.payload_hash, md5(o.evidence::text), 'manifest', jsonb_build_object('game_union_id', :U),
  jsonb_build_object('participants', jsonb_build_array(
      jsonb_build_object('earning_club_id', :F, 'user_id', :u3, 'observed_stack_delta', 2),
      jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -2))),
  '{"ok":true}', md5('{"ok": true}')
  FROM union_pnl_cash_outcomes o WHERE o.table_id = :T2 AND o.hand_number = 2;
-- A bounty whose receipt the transaction writes AFTER the flow: the flow is
-- projected at commit, when its receipt exists.
BEGIN;
INSERT INTO union_pnl_original_flows VALUES
  ('f1000000-0000-0000-0000-000000000007', pg_current_xact_id(), '2026-11-03 13:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 2, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'category', 'bounty'));
INSERT INTO tournament_accounting_credit_receipts (tournament_id, user_id, asset, amount, ledger_id, credited_club_id)
VALUES (:TT1, :u1, 'chips', 2, 'f1000000-0000-0000-0000-000000000007', :K);
COMMIT;
-- A recognition and its sources in one transaction, recognition first (as
-- fn_recognize_accounting_tournament_fees writes them).
BEGIN;
INSERT INTO accounting_tournament_fee_sources (id, tournament_id, player_id, club_id, union_id, charged_at, rake_credit) VALUES
  ('7f000000-0000-0000-0000-000000000003', :TT2, :u3, :D, :U, '2026-11-03 14:00+00', 2.00);
INSERT INTO accounting_tournament_fee_recognitions VALUES (:TT2, '2026-11-03 15:00+00', 'recognized', 2.00, :U);
INSERT INTO accounting_tournament_recognized_sources VALUES ('7f000000-0000-0000-0000-000000000003', :TT2, '2026-11-03 15:00+00', 'earned', 2.00);
COMMIT;
-- A BBJ share whose projection raises (the reader is down): the share still
-- commits, the failure is recorded. The reader then recovers; the Nov 3 day
-- load reads the share itself (the recipient sat in no hand, so no award).
INSERT INTO fixture_bbj_outage VALUES (true);
INSERT INTO bbj_payouts VALUES ('b0000000-0000-0000-0000-000000000002', :T1, 5, '2026-11-03 12:01+00');
INSERT INTO bbj_payout_recipients (payout_id, user_id, amount, created_at)
VALUES ('b0000000-0000-0000-0000-000000000002', 'bbb00000-0000-0000-0000-0000000000ff', 1.00, '2026-11-03 12:01+00');
DELETE FROM fixture_bbj_outage;
-- A posted prize no receipt owns, after the cutover: recorded as a failure
-- of its day by the live projection, never dropped silently.
INSERT INTO union_pnl_original_flows VALUES
  ('f1000000-0000-0000-0000-00000000000b', NULL, '2026-11-03 16:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 7, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'category', 'tournament_prize'));
-- The 2026-11-09 boundary recertified after the invoice of the week ending
-- there (2026-11-11 09:05): that week keeps the version its invoice used
-- (12.00); the week starting there has no invoice yet and takes the new one.
UPDATE accounting_close_certificates SET value = jsonb_build_object('status', 'ready', 'holdings', jsonb_build_array(
     jsonb_build_object('kind', 'deferred_tournament_result', 'club_id', :F, 'user_id', :u2, 'amount', 15.00,
                        'source_id', 'f0000000-0000-0000-0000-000000000001'))), certified_at = '2026-11-12 00:00+00'
 WHERE kind = 'pnl_boundary' AND period_start = '2026-11-09 08:00+00';
