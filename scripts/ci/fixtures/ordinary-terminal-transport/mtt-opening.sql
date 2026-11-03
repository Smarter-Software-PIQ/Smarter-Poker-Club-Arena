-- Isolated funded terminal transport opening. Capital, local controls and final
-- roster/seat topology are synthetic. Entries, reserve draw, fees and settlement
-- use original financial authorities. This is not a hand-engine completion proof.
BEGIN;
SET LOCAL session_replication_role=replica; INSERT INTO public.ca_tournament_start_hold(singleton,operation_id,blocked,reason) VALUES(true,'92090000-0000-4000-8000-000000000001',false,'private native qualification'); INSERT INTO public.ca_mtt_admission_contract(singleton,abi) VALUES(true,'unlimited-mtt-v2'); SET LOCAL session_replication_role=origin;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='8s';

DO $prerequisites$
BEGIN
  IF current_user<>'postgres' OR inet_server_addr() IS NOT NULL
     OR to_regprocedure('public.fn_register_for_tournament_request(uuid,uuid)') IS NULL
     OR to_regprocedure('public.atomic_cancel_tournament(uuid,uuid)') IS NULL
     OR to_regprocedure('public.fn_award_satellite_seat(uuid,uuid,uuid,text,integer)') IS NULL
     OR to_regprocedure(
          'public.fn_ca_tournament_cancellation_receipt(uuid,uuid)') IS NULL
     OR to_regclass('public.tournament_cancellation_receipts') IS NULL
     OR to_regclass('public.tournament_refund_entitlements') IS NULL
     OR to_regclass('public.tournament_refund_tranches') IS NULL THEN
    RAISE EXCEPTION
      'entrant cancellation probe requires postgres and the complete installed cancellation authority';
  END IF;
END;
$prerequisites$;

-- Restore only the tracked platform source seed omitted by the schema-only rehearsal.
-- Provenance: 20260905203123, exact tuple ('atomic_cancel_tournament', 'DB caller').
INSERT INTO public.ca_settle_sources(source,note)
VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;

-- Only fixture construction is trigger-free. In particular, the cash entry,
-- cancellation, replay verifier, and every immutability attempt below all run
-- with session_replication_role=origin against installed production functions.
SET LOCAL session_replication_role=replica;

INSERT INTO auth.users(id)
VALUES
  ('d1000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002'),
  ('2d1cd6c3-5700-4af9-a271-d4863fdab20d')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.users(id,username)
VALUES
  ('d1000000-0000-4000-8000-000000000001',
   'cancel_cash_entrant_probe'),
  ('d1000000-0000-4000-8000-000000000002',
   'cancel_satellite_entrant_probe'),
  ('2d1cd6c3-5700-4af9-a271-d4863fdab20d','smarterpoker')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.profiles(id,username,display_name)
VALUES
  ('d1000000-0000-4000-8000-000000000001',
   'cancel_cash_entrant_probe','Cancellation Cash Entrant'),
  ('d1000000-0000-4000-8000-000000000002',
   'cancel_satellite_entrant_probe','Cancellation Satellite Entrant')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.clubs(id,club_id,name)
VALUES
  ('d2000000-0000-4000-8000-000000000001',991001,
   'Cancellation Funding Club'),
  ('d2000000-0000-4000-8000-000000000002',991002,
   'Cancellation Fee Recipient Club');

INSERT INTO public.club_members(
  club_id,user_id,role,status,chip_balance,joined_at)
VALUES
  ('d2000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001',
   'player','active',1000,clock_timestamp()-interval '2 days'),
  ('d2000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000001',
   'player','active',200,clock_timestamp()-interval '1 day'),
  ('d2000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000002',
   'player','active',300,clock_timestamp()-interval '1 day');

INSERT INTO public.tournaments(
  id,name,buy_in_amount,buy_in_fee,starting_chips,start_time,status,
  current_players,max_players,current_level,club_id,prize_pool,total_rake,
  bounty_pool,entry_contract_locked,is_rebuy,is_reentry,rebuy_levels,
  late_reg_levels,late_reg_mins)
VALUES
  ('d3000000-0000-4000-8000-000000000001',
   'Full Terminal Source Satellite',100,0,1000,
   clock_timestamp()+interval '1 day','REGISTERING',0,9,1,
   'd2000000-0000-4000-8000-000000000002',0,0,0,false,
   false,false,0,0,0),
  ('d3000000-0000-4000-8000-000000000002',
   'Cancellation Entrant Target',100,0,1000,
   clock_timestamp()+interval '1 day','REGISTERING',0,100,1,
   'd2000000-0000-4000-8000-000000000002',0,0,0,false,
   false,false,0,0,0);

INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
VALUES(
  'd4000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',now(),now()),
  ('d4000000-0000-4000-8000-000000000003',
   'd1000000-0000-4000-8000-000000000002',now(),now());

UPDATE public.tournaments SET satellite_target_id='d3000000-0000-4000-8000-000000000002',
 satellite_target='d3000000-0000-4000-8000-000000000002',satellite_seats=1,
 tournament_type='SATELLITE',variant='satellite'
 WHERE id='d3000000-0000-4000-8000-000000000001';
UPDATE public.tournaments SET format_contract='mtt-v2',max_players=NULL,min_players=3,tournament_type='MTT',variant='mtt',payout_structure='[{"place":1,"percentage":100}]'::jsonb WHERE id='d3000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role=origin;

-- The public production registration door creates the cash player's actual
-- wallet debit, host-club journal, immutable entitlement, target fee record,
-- escrow funding and roster row.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','d1000000-0000-4000-8000-000000000001',
    'role','authenticated',
    'session_id','d4000000-0000-4000-8000-000000000001')::text,
  true);

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE satellite_full_probe_results(
  name text PRIMARY KEY,
  value jsonb NOT NULL
) ON COMMIT DROP;
INSERT INTO satellite_full_probe_results(name,value)
VALUES(
  'registration',
  public.fn_register_for_tournament_request(
    'd3000000-0000-4000-8000-000000000002',
    'd4000000-0000-4000-8000-000000000002'));
RESET ROLE;
GRANT INSERT,SELECT ON satellite_full_probe_results TO service_role;

DO $$ BEGIN IF (SELECT prize_pool FROM public.tournaments WHERE id='d3000000-0000-4000-8000-000000000002')<>100 THEN RAISE EXCEPTION 'funding mismatch'; END IF; END $$;
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES('d1000000-0000-4000-8000-000000000003');
INSERT INTO public.users(id,username) VALUES('d1000000-0000-4000-8000-000000000003','ordinary_terminal_three');
INSERT INTO public.profiles(id,username) VALUES('d1000000-0000-4000-8000-000000000003','ordinary_terminal_three');
INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance,joined_at)
VALUES('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003','player','active',500,now());
INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
VALUES('d4000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000003',now(),now());
SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"d4000000-0000-4000-8000-000000000003"}',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_register_for_tournament_request('d3000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000006');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"d4000000-0000-4000-8000-000000000005"}',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_register_for_tournament_request('d3000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000007');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.tournament_refund_entitlements WHERE tournament_id='d3000000-0000-4000-8000-000000000002' AND gross=100 AND refund_fee=0 AND refund_prize=100)<>3 OR (SELECT prize_pool FROM public.tournaments WHERE id='d3000000-0000-4000-8000-000000000002')<>300 THEN RAISE EXCEPTION 'three real entries not funded'; END IF;
END $$;
-- The three authenticated
-- registration charges above remain the sole funds and entitlement sources.
SET LOCAL session_replication_role=replica;
UPDATE public.tournaments SET status='RUNNING',started_at=clock_timestamp()-interval '1 hour',
 prize_pool_finalized=true,
 entry_contract_locked=true,current_players=1
 WHERE id='d3000000-0000-4000-8000-000000000002';
INSERT INTO public.tables(id,name,tournament_id,status,lifecycle,current_players,game_type,club_id,seat_game_scope,seat_admission_key)
 VALUES('d5000000-0000-4000-8000-000000000001','MTT Terminal Final Table',
 'd3000000-0000-4000-8000-000000000002','running','live',1,'tournament',
 'd2000000-0000-4000-8000-000000000002','table:d5000000-0000-4000-8000-000000000001','tournament:d3000000-0000-4000-8000-000000000002');
UPDATE public.tournament_players SET status='playing',chips=3000,
 table_id='d5000000-0000-4000-8000-000000000001',seat_number=1,
 club_id='d2000000-0000-4000-8000-000000000002'
 WHERE tournament_id='d3000000-0000-4000-8000-000000000002';
INSERT INTO public.table_seats(id,table_id,seat_number,user_id,stack,status,left_at,
 leave_pending,is_sitting_out,is_away,club_id,active_game_scope,active_parent_key)
 VALUES('d6000000-0000-4000-8000-000000000001',
 'd5000000-0000-4000-8000-000000000001',1,
 'd1000000-0000-4000-8000-000000000001',3000,'active',NULL,false,false,false,
 'd2000000-0000-4000-8000-000000000002','table:d5000000-0000-4000-8000-000000000001','tournament:d3000000-0000-4000-8000-000000000002');
UPDATE public.tournament_players SET status='eliminated',chips=0,position=CASE WHEN user_id='d1000000-0000-4000-8000-000000000002' THEN 3 ELSE 2 END,elimination_sequence=CASE WHEN user_id='d1000000-0000-4000-8000-000000000002' THEN 1 ELSE 2 END,eliminated_at=clock_timestamp(),table_id=NULL,seat_number=NULL WHERE tournament_id='d3000000-0000-4000-8000-000000000002' AND user_id<>'d1000000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true),
 set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),
 set_config('app.smarter_data_actor','',true),set_config('app.smarter_manager_request_fenced','',true),
 set_config('app.smarter_tournament_id','',true),set_config('app.smarter_tournament_lease_generation','',true);


SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
