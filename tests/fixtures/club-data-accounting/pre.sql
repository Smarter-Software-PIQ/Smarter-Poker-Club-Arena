-- Rows written BEFORE the cutover (20261115020011): the day load owns them.
-- K = KINGS CLUB, F = The Felt Society, D = Deep Stack Society, union = Midway.
\set K '''a41434bb-8d0c-400a-8f0d-e8b3d65afed4'''
\set F '''a0000000-0000-0000-0000-000000000001'''
\set D '''2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'''
\set U '''fade0000-0000-0000-0000-000000000001'''
\set T1 '''c0000000-0000-0000-0000-000000000001'''
\set T2 '''c0000000-0000-0000-0000-000000000002'''
\set TT0 '''d0000000-0000-0000-0000-000000000000'''
\set TT1 '''d0000000-0000-0000-0000-000000000001'''
\set TT2 '''d0000000-0000-0000-0000-000000000002'''
\set u1 '''11111111-0000-0000-0000-000000000001'''
\set u2 '''11111111-0000-0000-0000-000000000002'''
\set u3 '''11111111-0000-0000-0000-000000000003'''

INSERT INTO tables VALUES (:T1, :U), (:T2, :U);
INSERT INTO rake_records VALUES ('e0000000-0000-0000-0000-000000000001', :T1), ('e0000000-0000-0000-0000-000000000002', :T1),
  ('e0000000-0000-0000-0000-000000000003', :T1), ('e0000000-0000-0000-0000-000000000004', :T1), ('e0000000-0000-0000-0000-000000000005', :T1);
INSERT INTO tournament_players VALUES ('f0000000-0000-0000-0000-000000000000', :TT0), ('f0000000-0000-0000-0000-000000000001', :TT1);

-- Cash fees: the last microsecond of the Nov 1 accounting day, the first of
-- Nov 2, a fee whose club a funding admission moved before the cutover, and
-- a Nov 3 fee an admission moves after it.
INSERT INTO accounting_cash_rake_sources (id, rake_record_id, player_id, club_id, union_id, earned_at, rake_credit) VALUES
  ('5c000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', :u1, :K, :U, '2026-11-02 07:59:59.999999+00', 1.00),
  ('5c000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', :u1, :K, :U, '2026-11-02 08:00:00+00', 2.50),
  ('5c000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000003', :u2, :F, :U, '2026-11-02 09:00:00+00', 3.25),
  ('5c000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000004', :u1, :K, :U, '2026-11-03 10:00:00+00', 4.00);
INSERT INTO accounting_cash_funding_contract_admissions (source_id, original_club_id, funding_club_id)
VALUES ('5c000000-0000-0000-0000-000000000003', :F, :D);

-- Tournament fees: one earned, one refunded (not earned).
INSERT INTO accounting_tournament_fee_sources (id, tournament_id, player_id, club_id, union_id, charged_at, rake_credit) VALUES
  ('7f000000-0000-0000-0000-000000000001', :TT1, :u1, :K, :U, '2026-11-02 10:00+00', 5.00),
  ('7f000000-0000-0000-0000-000000000002', :TT1, :u2, :F, :U, '2026-11-02 10:00+00', 1.00);
INSERT INTO accounting_tournament_fee_recognitions VALUES (:TT1, '2026-11-02 12:00+00', 'recognized', 6.00, :U);
INSERT INTO accounting_tournament_recognized_sources VALUES
  ('7f000000-0000-0000-0000-000000000001', :TT1, '2026-11-02 12:00+00', 'earned', 5.00),
  ('7f000000-0000-0000-0000-000000000002', :TT1, '2026-11-02 12:00+00', 'refunded', 1.00);

-- Hands. #1 plain; #2 shaped (its escrow certificate arrives after the
-- cutover); #3 a blocked original whose treasury gift re-attributes it;
-- #4 has no union scope and is not the invoice's. #3 is unraked (accepted
-- rake 0): its players' results count, the club hand count does not.
INSERT INTO union_pnl_cash_outcomes (table_id, hand_number, hand_id, recognized_at, payload_hash, game_scope, evidence) VALUES
  (:T1, 1, gen_random_uuid(), '2026-11-02 09:00+00', 'h1', jsonb_build_object('game_union_id', :U),
   jsonb_build_object('status', 'ready', 'participants', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', 10.00),
     jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', -12.50)))),
  (:T1, 2, gen_random_uuid(), '2026-11-02 09:05+00', 'h2', jsonb_build_object('game_union_id', :U), '{"status":"ready"}'),
  (:T1, 3, gen_random_uuid(), '2026-11-02 09:10+00', 'h3', jsonb_build_object('game_union_id', :U),
   jsonb_build_object('status', 'blocked', 'accepted_rake', '0',
     'participants', jsonb_build_array(
       jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -7),
       jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', 7)),
     'gift_participants', jsonb_build_array(
       jsonb_build_object('earning_club_id', :D, 'user_id', :u3, 'observed_stack_delta', -7),
       jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', 7)))),
  (:T1, 4, gen_random_uuid(), '2026-11-02 09:20+00', 'h4', '{}', '{"status":"ready"}'),
  (:T2, 1, 'aaaa0000-0000-0000-0000-000000000001', '2026-11-02 10:00+00', 'l1', '{}', '{"status":"ready","accepted_rake":"0.5"}');
INSERT INTO union_pnl_cash_outcome_touches VALUES
  (:T1, 1, '2026-11-02 09:00+00', :U, false, '2.5', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', 10.00),
     jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', -12.50))),
  (:T1, 2, '2026-11-02 09:05+00', :U, true, '1', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -5),
     jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', 4))),
  (:T1, 3, '2026-11-02 09:10+00', :U, false, '0', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -7),
     jsonb_build_object('earning_club_id', :F, 'user_id', :u2, 'observed_stack_delta', 7))),
  (:T1, 4, '2026-11-02 09:20+00', NULL, false, '0', jsonb_build_array(
     jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', 99)));
-- A lightning hand linked into the union; its funding owner moves u3 to D.
INSERT INTO union_pnl_cash_outcome_link_resolutions (table_id, hand_number, hand_id, outcome_payload_hash, outcome_evidence_md5,
  roster_source, game_scope, evidence, proof, proof_md5)
SELECT :T2, 1, o.hand_id, o.payload_hash, md5(o.evidence::text), 'lightning_pool', jsonb_build_object('game_union_id', :U),
  jsonb_build_object('participants', jsonb_build_array(
      jsonb_build_object('earning_club_id', :F, 'user_id', :u3, 'observed_stack_delta', 3),
      jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -3.40)),
    'owner_participants', jsonb_build_array(
      jsonb_build_object('earning_club_id', :D, 'user_id', :u3, 'observed_stack_delta', 3),
      jsonb_build_object('earning_club_id', :K, 'user_id', :u1, 'observed_stack_delta', -3.40))),
  '{"ok":true}', md5('{"ok": true}')
  FROM union_pnl_cash_outcomes o WHERE o.table_id = :T2 AND o.hand_number = 1;

-- Ledger flows. A tournament flow counts only when its receipt owns it (the
-- invoice's classification); cash flows are not projected (the cash result
-- is the hands).
INSERT INTO union_pnl_original_flows VALUES
  ('f1000000-0000-0000-0000-000000000001', NULL, '2026-11-02 09:30+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 10, 'from_type', 'player_wallet', 'from_entity_id', :u1,
                      'to_type', 'prize_liability', 'to_entity_id', :TT1, 'category', 'tournament_buyin')),
  ('f1000000-0000-0000-0000-000000000002', NULL, '2026-11-02 13:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 25, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'category', 'tournament_prize')),
  ('f1000000-0000-0000-0000-000000000003', NULL, '2026-11-02 08:30+00', jsonb_build_object('game_union_id', :U, 'tournament_id', NULL),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 100, 'from_type', 'player_wallet', 'from_entity_id', :u1,
                      'to_type', 'table_stack', 'to_entity_id', :T1, 'table_id', :T1, 'category', 'buyin')),
  ('f1000000-0000-0000-0000-000000000004', NULL, '2026-11-02 14:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', NULL),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 110, 'from_type', 'table_stack', 'from_entity_id', :T1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'table_id', :T1, 'category', 'table_cashout')),
  ('f1000000-0000-0000-0000-000000000005', NULL, '2026-11-02 14:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'void', 'club_id', :K, 'amount', 999, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'category', 'tournament_prize')),
  ('f1000000-0000-0000-0000-000000000006', NULL, '2026-11-02 14:00+00', '{}',
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 999, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'category', 'tournament_prize')),
  -- A refund paid as a tranche from F's wallet to u2.
  ('f1000000-0000-0000-0000-000000000008', NULL, '2026-11-02 15:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :F, 'amount', 4, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u2, 'category', 'refund')),
  -- A satellite seat refunded into K's wallet; the seat was funded by D
  -- (owner ruling 2026-11-11), so the return is D's.
  ('f1000000-0000-0000-0000-000000000009', NULL, '2026-11-02 15:30+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 6, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u3, 'category', 'tournament_refund',
                      'idempotency_key', 'tourney:d0000000-0000-0000-0000-000000000001:refund-entitlement:e1000000-0000-0000-0000-000000000009')),
  -- A posted prize no receipt owns is not the invoice's.
  ('f1000000-0000-0000-0000-00000000000a', NULL, '2026-11-02 16:00+00', jsonb_build_object('game_union_id', :U, 'tournament_id', :TT1),
   jsonb_build_object('status', 'posted', 'club_id', :K, 'amount', 999, 'from_type', 'prize_liability', 'from_entity_id', :TT1,
                      'to_type', 'player_wallet', 'to_entity_id', :u1, 'category', 'tournament_prize'));
INSERT INTO tournament_participant_funding_receipts (tournament_id, user_id, asset, amount, ledger_id, funding_club_id)
VALUES (:TT1, :u1, 'chips', 10, 'f1000000-0000-0000-0000-000000000001', :K);
INSERT INTO tournament_accounting_credit_receipts (tournament_id, user_id, asset, amount, ledger_id, credited_club_id)
VALUES (:TT1, :u1, 'chips', 25, 'f1000000-0000-0000-0000-000000000002', :K);
INSERT INTO tournament_refund_tranches (tournament_id, user_id, source_wallet_club_id, credit_ledger_id, amount_paid_now)
VALUES (:TT1, :u2, :F, 'f1000000-0000-0000-0000-000000000008', 4);
INSERT INTO tournament_refund_entitlements (id, tournament_id, user_id, entitlement_kind, refund_wallet_club_id, gross, registration_id)
VALUES ('e1000000-0000-0000-0000-000000000009', :TT1, :u3, 'satellite_seat', :K, 6, 'e2000000-0000-0000-0000-000000000009');
INSERT INTO fixture_satellite_seat_owners VALUES ('e2000000-0000-0000-0000-000000000009', :D);

-- A BBJ felt share to u1 from hand T1#1.
INSERT INTO bbj_payouts VALUES ('b0000000-0000-0000-0000-000000000001', :T1, 1, '2026-11-02 09:01+00');
INSERT INTO bbj_payout_recipients (payout_id, user_id, amount, created_at)
VALUES ('b0000000-0000-0000-0000-000000000001', :u1, 8.00, '2026-11-02 09:01+00');

-- The two week-boundary certificates (deferred entries carried in and out),
-- certified when production's were. The 2026-11-02 one was certified after
-- the invoice of the week ending there (2026-11-10 16:05), so that side has
-- no invoice-exact version; it was certified before the invoice of the week
-- starting there (2026-11-11 09:05), so that side is exact.
INSERT INTO accounting_close_certificates (kind, union_id, period_start, period_end, value, certified_at) VALUES
  ('pnl_boundary', :U, '2026-11-02 08:00+00', '2026-11-02 08:00+00', jsonb_build_object('status', 'ready', 'holdings', jsonb_build_array(
     jsonb_build_object('kind', 'deferred_tournament_result', 'club_id', :K, 'user_id', :u1, 'amount', 30.00,
                        'source_id', 'f0000000-0000-0000-0000-000000000000'),
     jsonb_build_object('kind', 'cash_stack', 'club_id', :K, 'user_id', :u1, 'amount', 500.00,
                        'source_id', 'f0000000-0000-0000-0000-0000000000ff'))), '2026-11-11 01:52:19+00'),
  ('pnl_boundary', :U, '2026-11-09 08:00+00', '2026-11-09 08:00+00', jsonb_build_object('status', 'ready', 'holdings', jsonb_build_array(
     jsonb_build_object('kind', 'deferred_tournament_result', 'club_id', :F, 'user_id', :u2, 'amount', 12.00,
                        'source_id', 'f0000000-0000-0000-0000-000000000001'))), '2026-11-11 03:43:14+00');
