-- Isolated funded terminal transport opening. Capital, local controls and final
-- roster/seat topology are synthetic. Entries, reserve draw, fees and settlement
-- use original financial authorities. This is not a hand-engine completion proof.
BEGIN;
SET LOCAL session_replication_role=replica; INSERT INTO public.ca_tournament_start_hold(singleton,operation_id,blocked,reason) VALUES(true,'92090000-0000-4000-8000-000000000001',false,'private native qualification'); INSERT INTO public.ca_mtt_admission_contract(singleton,abi) VALUES(true,'unlimited-mtt-v2'); SET LOCAL session_replication_role=origin;
INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES ('spin_reserve','counted','spin_pools + union spin_reserve_wallet','spin_bonus_pools balance');
-- Original paid-entry and draw source reused as an isolated transport fixture.
-- This commits its local opening; the Execution owner destroys the database.
-- Exact tracked platform source seed omitted by the native schema-only fixture.
INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
DO $all_guards$
BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgenabled='D' AND tgname IN (
 'aa_guard_tournament_completing_claim','zzzz_freeze_finalized_tournament_prize_pool',
 'zzzz_tournament_pool_finalization_window_guard','zzzz_tournaments_atomic_place_completion_guard',
 'zzzzz_tournaments_atomic_final_table_deal_completion_guard','zzzzzz_tournaments_financial_certificate',
 'aaa_guard_atomic_satellite_completion'))<>7 THEN RAISE EXCEPTION 'FAIL captured Stage B guard state drifted'; END IF;
 RAISE NOTICE 'PASS captured seven Stage B completion guards remain disabled; this does not qualify Stage B activation';
END $all_guards$;


DO $fixture_guard$
BEGIN
  IF current_user <> 'postgres'
     OR to_regprocedure('public.fn_spin_draw_and_settle_atomic(uuid,uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.fn_prove_played_spin_launch_recovery(uuid)') IS NULL
     OR to_regprocedure('public.fn_complete_tournament_launch_atomic(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'native Spin launch probe requires the disposable composed rehearsal database';
  END IF;
  IF md5(pg_get_functiondef('public.fn_spin_draw_and_settle_atomic(uuid,uuid,uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM '0f600123b50d02da101b62dfb4e1cbe8'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_spin_book_entry(uuid)'::regprocedure)
       IS DISTINCT FROM '604113bd4172433183cdd1d59af04e0f'
     OR md5(pg_get_functiondef('public.fn_spin_settle_game(uuid,uuid,numeric,integer,numeric,numeric)'::regprocedure)) IS DISTINCT FROM 'b5b6952342da377a5f73c4c0d909d007' THEN
    RAISE EXCEPTION 'native Spin launch money authority fingerprint changed';
  END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
      ('spin_reserve_ledger','spin_reserve_row_requires_exact_journal'),
      ('chip_ledger','zz_ca_escrow_reserve_leg'),
      ('spin_bonus_pools','trg_ca_autoledger'),
      ('tournament_escrow','zz_spin_escrow_is_enforced'),
      ('spin_draw_receipts','spin_draw_receipt_is_immutable')) guards(table_name,trigger_name)
      WHERE NOT EXISTS(SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid=to_regclass('public.'||guards.table_name)
         AND t.tgname=guards.trigger_name AND t.tgenabled='O')) THEN
    RAISE EXCEPTION 'native Spin launch requires enabled money and receipt guards';
  END IF;
END;
$fixture_guard$;

SET LOCAL session_replication_role=replica; INSERT INTO auth.users(id) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d') ON CONFLICT DO NOTHING; INSERT INTO public.users(id,username) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','native_platform_actor') ON CONFLICT DO NOTHING;

INSERT INTO auth.users(id)
SELECT md5('zero-default-spin-launch-user:' || g.i::text)::uuid
  FROM generate_series(1,3) g(i);

INSERT INTO public.profiles(id,username,display_name)
SELECT md5('zero-default-spin-launch-user:' || g.i::text)::uuid,
       'zero_default_spin_launch_' || g.i,
       'Zero Default Spin Launch ' || g.i
  FROM generate_series(1,3) g(i);

INSERT INTO public.clubs(id,name,owner_id,chip_treasury,spins_enabled)
VALUES (
  '92000000-0000-0000-0000-000000000001',
  'Zero Default Spin Launch Probe Club',
  md5('zero-default-spin-launch-user:1')::uuid,
  1000,
  true
);

INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance)
SELECT '92000000-0000-0000-0000-000000000001',
       md5('zero-default-spin-launch-user:' || g.i::text)::uuid,
       CASE WHEN g.i=1 THEN 'owner' ELSE 'player' END,
       'active',
       100
  FROM generate_series(1,3) g(i);

INSERT INTO public.spin_bonus_pools(
  id,club_id,balance,total_deposited,total_drawn,spin_count,bonus_count,
  seeded_amount,ceiling_amount,highest_stake,surplus_returned,is_active,
  owner_kind,offered_max_stake,seed_returned_amount,required_seed_at_activation
) VALUES (
  '92030000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  1000,1000,0,0,0,0,10000,1,0,true,'club',1,0,0
);

INSERT INTO public.users(id,username)
 SELECT md5('zero-default-spin-launch-user:'||i)::uuid,'zero_default_native_user_'||i
 FROM generate_series(1,3) g(i);
INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
 SELECT md5('full-spin-session:'||i)::uuid,md5('zero-default-spin-launch-user:'||i)::uuid,now(),now()
 FROM generate_series(1,3) g(i);
SET LOCAL session_replication_role=origin;
-- A real creator/entry RPC commits before launch begins. Flush its original
-- deferred proofs here, then restore only constraints declared initially deferred.
CREATE FUNCTION pg_temp.spin_full_request_boundary() RETURNS void LANGUAGE plpgsql AS $boundary$
DECLARE c record;
BEGIN
 SET CONSTRAINTS ALL IMMEDIATE;
 FOR c IN SELECT DISTINCT co.conname FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace
  WHERE n.nspname='public' AND co.condeferrable AND co.condeferred ORDER BY co.conname LOOP
  IF EXISTS(SELECT 1 FROM pg_constraint other JOIN pg_namespace n ON n.oid=other.connamespace
   WHERE n.nspname='public' AND other.conname=c.conname AND (NOT other.condeferrable OR NOT other.condeferred))
  THEN RAISE EXCEPTION 'ambiguous constraint mode at simulated request boundary: %',c.conname; END IF;
  EXECUTE format('SET CONSTRAINTS public.%I DEFERRED',c.conname);
 END LOOP;
END $boundary$;
CREATE TEMP TABLE spin_full_game(table_id uuid PRIMARY KEY,receipt jsonb NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT ON spin_full_game TO service_role;
GRANT SELECT ON spin_full_game TO authenticated;
CREATE FUNCTION pg_temp.spin_table_id() RETURNS uuid LANGUAGE sql STABLE
 AS $id$ SELECT table_id FROM spin_full_game $id$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true),
 set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
DO $real_creator$
DECLARE r jsonb; replay jsonb; config jsonb:=jsonb_build_object(
 'club_id','92000000-0000-0000-0000-000000000001','union_id',NULL,
 'name','Native SNG Terminal Transport','game_type','NLH','variant','sng','tournament_type','SNG',
 'buy_in_amount',1,'buy_in_fee',0,'guaranteed_prize',0,'starting_chips',1000,
 'max_players',2,'min_players',2,'table_size',2,'current_players',0,'status','REGISTERING',
 'blind_structure','[{"level":1,"smallBlind":10,"bigBlind":20,"ante":0,"duration":180}]'::jsonb,
 'payout_structure','[{"place":1,"percentage":100}]'::jsonb,
 'start_time',clock_timestamp()+interval '1 day','late_reg_levels',0,'late_reg_mins',0,
 'satellite_target_id',NULL,'satellite_seats',NULL,'short_description',NULL,
 'spin_multiplier',NULL,'spin_locked_tiers',NULL);
BEGIN
 r:=public.fn_create_seat_first_game_atomic('92010000-0000-0000-0000-000000000001',config);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'replayed' IS DISTINCT FROM 'false'
  OR r->'tournament'->>'id' IS DISTINCT FROM '92010000-0000-0000-0000-000000000001'
  OR NULLIF(r->>'table_id','') IS NULL THEN RAISE EXCEPTION 'FAIL actual SNG creator: %',r; END IF;
 INSERT INTO spin_full_game VALUES((r->>'table_id')::uuid,r);
 replay:=public.fn_create_seat_first_game_atomic('92010000-0000-0000-0000-000000000001',config);
 IF replay->>'ok' IS DISTINCT FROM 'true' OR replay->>'replayed' IS DISTINCT FROM 'true'
  OR replay->>'table_id' IS DISTINCT FROM r->>'table_id' THEN RAISE EXCEPTION 'FAIL creator replay: %',replay; END IF;
 RAISE NOTICE 'PASS actual seat-first creator commits and replays the same SNG and table';
END $real_creator$;
RESET ROLE;
SELECT pg_temp.spin_full_request_boundary();

CREATE TEMP TABLE spin_full_registration(user_id uuid PRIMARY KEY,receipt jsonb) ON COMMIT DROP;
GRANT INSERT,SELECT ON spin_full_registration TO authenticated;
SET LOCAL ROLE authenticated;
DO $real_entry$
DECLARE i integer; u uuid; r jsonb;
BEGIN
 FOR i IN 1..2 LOOP
  u:=md5('zero-default-spin-launch-user:'||i)::uuid;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated',
   'session_id',md5('full-spin-session:'||i)::uuid)::text,true);
  r:=public.fn_take_seat_and_buy_in(pg_temp.spin_table_id(),i);
  IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'cost')::numeric IS DISTINCT FROM 1::numeric
   THEN RAISE EXCEPTION 'FAIL actual SNG entry %: %',i,r; END IF;
  INSERT INTO spin_full_registration VALUES(u,r);
  PERFORM pg_temp.spin_full_request_boundary();
 END LOOP;
END $real_entry$;
RESET ROLE;
SET LOCAL session_replication_role=replica;
UPDATE public.tournament_players SET chips=CASE WHEN user_id=md5('zero-default-spin-launch-user:2')::uuid THEN 2000 ELSE 0 END,status=CASE WHEN user_id=md5('zero-default-spin-launch-user:2')::uuid THEN 'playing' ELSE 'eliminated' END,position=CASE WHEN user_id=md5('zero-default-spin-launch-user:1')::uuid THEN 2 ELSE NULL END,elimination_sequence=CASE WHEN user_id=md5('zero-default-spin-launch-user:1')::uuid THEN 1 ELSE NULL END,eliminated_at=CASE WHEN user_id=md5('zero-default-spin-launch-user:1')::uuid THEN now() ELSE NULL END WHERE tournament_id='92010000-0000-0000-0000-000000000001';
UPDATE public.table_seats SET stack=CASE WHEN seat_number=2 THEN 2000 ELSE 0 END WHERE table_id=pg_temp.spin_table_id();
UPDATE public.tournaments SET current_players=1,status='RUNNING',started_at=now()-interval '1 hour',prize_pool_finalized=true,entry_contract_locked=true WHERE id='92010000-0000-0000-0000-000000000001';
SET LOCAL session_replication_role=origin;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
