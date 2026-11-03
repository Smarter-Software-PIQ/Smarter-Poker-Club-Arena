-- Isolated funded terminal transport opening. Capital, local controls and final
-- roster/seat topology are synthetic. Entries, reserve draw, fees and settlement
-- use original financial authorities. This is not a hand-engine completion proof.
BEGIN;
SET LOCAL session_replication_role=replica; INSERT INTO public.ca_tournament_start_hold(singleton,operation_id,blocked,reason) VALUES(true,'92090000-0000-4000-8000-000000000001',false,'private native qualification'); INSERT INTO public.ca_mtt_admission_contract(singleton,abi) VALUES(true,'unlimited-mtt-v2'); SET LOCAL session_replication_role=origin;
INSERT INTO public.ca_chip_store_coverage SELECT * FROM jsonb_populate_record(NULL::public.ca_chip_store_coverage,'{"notes": "retirement holding", "store": "chip_retirement", "added_at": "2026-09-11T16:10:27.128168+00:00", "treatment": "noncirculating", "counted_by": null}'::jsonb);
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

INSERT INTO public.accounting_agreement_history(entity_type,entity_key,club_id,subject_user_id,event_type,observed_at,transaction_id,after_terms) SELECT 'club_members',cm.club_id::text||':'||cm.user_id::text,cm.club_id,cm.user_id,'INSERT',transaction_timestamp()-interval '1 day',txid_current(),to_jsonb(cm) FROM public.club_members cm WHERE cm.club_id='92000000-0000-0000-0000-000000000001'; INSERT INTO public.club_wallets(club_id) VALUES('92000000-0000-0000-0000-000000000001');
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
 'name','Native SPIN Terminal Transport','game_type','NLH','variant','spin','tournament_type','SPIN',
 'buy_in_amount',1,'buy_in_fee',0,'guaranteed_prize',0,'starting_chips',1000,
 'max_players',3,'min_players',3,'table_size',3,'current_players',0,'status','REGISTERING',
 'blind_structure','[{"level":1,"smallBlind":10,"bigBlind":20,"ante":0,"duration":180}]'::jsonb,
 'payout_structure','[{"place":1,"percentage":100}]'::jsonb,
 'start_time',clock_timestamp()+interval '1 day','late_reg_levels',0,'late_reg_mins',0,
 'satellite_target_id',NULL,'satellite_seats',NULL,'short_description',NULL,
 'spin_multiplier',NULL,'spin_locked_tiers',NULL);
BEGIN
 r:=public.fn_create_seat_first_game_atomic('92010000-0000-0000-0000-000000000001',config);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'replayed' IS DISTINCT FROM 'false'
  OR r->'tournament'->>'id' IS DISTINCT FROM '92010000-0000-0000-0000-000000000001'
  OR NULLIF(r->>'table_id','') IS NULL THEN RAISE EXCEPTION 'FAIL actual Spin creator: %',r; END IF;
 INSERT INTO spin_full_game VALUES((r->>'table_id')::uuid,r);
 replay:=public.fn_create_seat_first_game_atomic('92010000-0000-0000-0000-000000000001',config);
 IF replay->>'ok' IS DISTINCT FROM 'true' OR replay->>'replayed' IS DISTINCT FROM 'true'
  OR replay->>'table_id' IS DISTINCT FROM r->>'table_id' THEN RAISE EXCEPTION 'FAIL creator replay: %',replay; END IF;
 RAISE NOTICE 'PASS actual seat-first creator commits and replays the same Spin and table';
END $real_creator$;
RESET ROLE;
SELECT pg_temp.spin_full_request_boundary();

CREATE TEMP TABLE spin_full_registration(user_id uuid PRIMARY KEY,receipt jsonb) ON COMMIT DROP;
GRANT INSERT,SELECT ON spin_full_registration TO authenticated;
SET LOCAL ROLE authenticated;
DO $real_entry$
DECLARE i integer; u uuid; r jsonb;
BEGIN
 FOR i IN 1..3 LOOP
  u:=md5('zero-default-spin-launch-user:'||i)::uuid;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated',
   'session_id',md5('full-spin-session:'||i)::uuid)::text,true);
  r:=public.fn_take_seat_and_buy_in(pg_temp.spin_table_id(),i);
  IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'cost')::numeric IS DISTINCT FROM 1::numeric
   THEN RAISE EXCEPTION 'FAIL actual Spin entry %: %',i,r; END IF;
  INSERT INTO spin_full_registration VALUES(u,r);
  PERFORM pg_temp.spin_full_request_boundary();
 END LOOP;
END $real_entry$;
RESET ROLE;
DO $funding$
DECLARE facts jsonb;
BEGIN
 facts:=jsonb_build_object(
  'wallets_exact',(SELECT count(*)=3 FROM public.club_members WHERE club_id='92000000-0000-0000-0000-000000000001' AND chip_balance=99),
  'escrow',(SELECT jsonb_build_object('gross_in',gross_in,'prize_balance',prize_balance,'fee_balance',fee_balance,
    'reserve_out',reserve_out,'reserve_in',reserve_in,'fee_entries_in',fee_entries_in) FROM public.tournament_escrow
    WHERE tournament_id='92010000-0000-0000-0000-000000000001'),
  'entitlements_exact',(SELECT count(*)=3 FROM public.tournament_refund_entitlements WHERE tournament_id='92010000-0000-0000-0000-000000000001'
   AND entitlement_kind='wallet_charge' AND gross=1 AND refund_prize=1 AND refund_fee=0 AND source_ledger_id IS NOT NULL),
  'source_journals_exact',(SELECT count(*)=3 FROM public.chip_ledger WHERE tournament_id='92010000-0000-0000-0000-000000000001' AND category='tournament_buyin' AND amount=1),
  'paid_seats_exact',(SELECT count(*)=3 FROM public.table_seats WHERE table_id=pg_temp.spin_table_id() AND left_at IS NULL AND stack=1000),
  'paid_roster_exact',(SELECT count(*)=3 FROM public.tournament_players WHERE tournament_id='92010000-0000-0000-0000-000000000001'
    AND status='playing' AND chips=1000 AND table_id=pg_temp.spin_table_id()),
  'reserve',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'amount',amount) ORDER BY kind) FROM public.spin_reserve_ledger
    WHERE tournament_id='92010000-0000-0000-0000-000000000001'),
  'spin_journals',(SELECT jsonb_agg(jsonb_build_object('category',category,'amount',amount) ORDER BY category) FROM public.chip_ledger
    WHERE tournament_id='92010000-0000-0000-0000-000000000001' AND category IN ('spin_entry','spin_prize')),
  'rake',(SELECT jsonb_agg(rake_amount ORDER BY id) FROM public.rake_records WHERE tournament_id='92010000-0000-0000-0000-000000000001'));
 IF facts->>'wallets_exact' IS DISTINCT FROM 'true'
  OR facts->>'entitlements_exact' IS DISTINCT FROM 'true'
  OR facts->>'source_journals_exact' IS DISTINCT FROM 'true'
  OR facts->>'paid_seats_exact' IS DISTINCT FROM 'true'
  OR facts->>'paid_roster_exact' IS DISTINCT FROM 'true'
  OR facts->'escrow' IS DISTINCT FROM '{"gross_in":3,"prize_balance":0,"fee_balance":0.24,"reserve_out":2.76,"reserve_in":0,"fee_entries_in":0.24}'::jsonb
  OR facts->'reserve' IS DISTINCT FROM '[{"kind":"contribution","amount":2.76}]'::jsonb
  OR facts->'spin_journals' IS DISTINCT FROM '[{"category":"spin_entry","amount":2.76}]'::jsonb
  OR facts->'rake' IS DISTINCT FROM '[0.24]'::jsonb
  OR EXISTS(SELECT 1 FROM public.spin_draw_receipts WHERE tournament_id='92010000-0000-0000-0000-000000000001')
 THEN RAISE EXCEPTION 'FAIL actual three-seat purchase/entry booking facts: %',facts; END IF;
 RAISE NOTICE 'SPIN_ENTRY_FACTS %',facts;
 RAISE NOTICE 'PASS three actual seat purchases fund three wallets and 3000 play chips; third seat books 2.76 reserve contribution and 0.24 fee before draw';
END $funding$;
CREATE FUNCTION pg_temp.spin_replay_state(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public','pg_temp'
AS $state$
  SELECT jsonb_build_object(
    'pool',(SELECT jsonb_build_object(
      'balance',p.balance,'total_deposited',p.total_deposited,
      'total_drawn',p.total_drawn,'spin_count',p.spin_count,
      'bonus_count',p.bonus_count,'seeded_amount',p.seeded_amount,
      'seed_returned_amount',p.seed_returned_amount)
      FROM public.spin_bonus_pools p
      WHERE p.id='92030000-0000-0000-0000-000000000001'),
    'reserve',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.kind,r.id)
      FROM public.spin_reserve_ledger r WHERE r.tournament_id=p_tournament_id),
    'journal',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.category,l.id)
      FROM public.chip_ledger l WHERE l.tournament_id=p_tournament_id
        AND l.category IN ('spin_entry','spin_prize')),
    'rake',(SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.id)
      FROM public.rake_records rr WHERE rr.tournament_id=p_tournament_id),
    'escrow',(SELECT to_jsonb(e) FROM public.tournament_escrow e
      WHERE e.tournament_id=p_tournament_id),
    'contract',(SELECT jsonb_build_object(
      'spin_multiplier',t.spin_multiplier,'prize_pool',t.prize_pool,
      'spin_locked_tiers',t.spin_locked_tiers,
      'blind_structure',t.blind_structure,'payout_structure',t.payout_structure,
      'is_premium_spin',t.is_premium_spin)
      FROM public.tournaments t WHERE t.id=p_tournament_id));
$state$;

SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true),
 set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),
 set_config('app.smarter_data_actor','',true),set_config('app.smarter_manager_request_fenced','',true),
 set_config('app.smarter_tournament_id','',true),set_config('app.smarter_tournament_lease_generation','',true);
SET LOCAL ROLE service_role;
SELECT set_config('request.headers','{"x-smarter-data-actor":"service","x-smarter-data-protocol":"1"}',true),
 set_config('request.method','POST',true),set_config('request.path','rpc/claim_tournament_lease_v2',true);
SELECT smarter_private.fn_smarter_data_api_pre_request();
SELECT public.claim_tournament_lease_v2('92010000-0000-0000-0000-000000000001',
 'native-full-spin','native-current-spin-proof','92050000-0000-4000-8000-000000000001',30);
DO $begin_launch$
DECLARE r jsonb;
BEGIN
 r:=public.fn_begin_tournament_launch_atomic('92010000-0000-0000-0000-000000000001',
  '92040000-0000-4000-8000-000000000001',now()-interval '3 hours','92050000-0000-4000-8000-000000000001');
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'claimed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'FAIL actual lease-bound begin launch: %',r; END IF;
END $begin_launch$;
RESET ROLE;
DO $launch_receipt$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournament_launch_receipts WHERE tournament_id='92010000-0000-0000-0000-000000000001'
  AND launch_id='92040000-0000-4000-8000-000000000001' AND lease_generation='92050000-0000-4000-8000-000000000001' AND completed_at IS NULL)
 THEN RAISE EXCEPTION 'FAIL canonical begin launch omitted the immutable receipt'; END IF;
 RAISE NOTICE 'PASS actual lease claim and begin launch own the three-hour interrupted Spin';
END $launch_receipt$;

DO $zero_default$ BEGIN
 IF (SELECT spin_multiplier FROM public.tournaments
     WHERE id='92010000-0000-0000-0000-000000000001') IS DISTINCT FROM 0::numeric
  OR current_setting('session_replication_role') <> 'origin' THEN
  RAISE EXCEPTION 'FAIL fresh Spin must use the real zero default with native guards';
 END IF;
END $zero_default$;
DO $notice$ BEGIN RAISE NOTICE 'PASS Spin zero_default'; END $notice$;

CREATE FUNCTION pg_temp.native_spin_rules() RETURNS jsonb LANGUAGE sql AS $rules$
 SELECT jsonb_build_object('version',1,'buy_in',1,'seats',3,'rake_rate',0.08,
  'starting_chips',1000,'tiers',jsonb_agg(jsonb_build_object(
   'multiplier',multiplier,'freq',freq,'reserveThresholdX',0,
   'blind_structure',(SELECT jsonb_agg(jsonb_build_object('level',i,'smallBlind',i*10,
    'bigBlind',i*20,'ante',0,'duration',180) || CASE WHEN i=12 THEN
     jsonb_build_object('spinContinuation',jsonb_build_object('version',1,'anchorLevel',12,
      'anchorBigBlind',240,'growth',1.4,'roundBigTo',10)) ELSE '{}'::jsonb END ORDER BY i)
      FROM generate_series(1,12) g(i)),
   'payout_structure',CASE WHEN multiplier=10 THEN
    jsonb_build_array(jsonb_build_object('place',1,'percentage',80),
                     jsonb_build_object('place',2,'percentage',20))
    ELSE jsonb_build_array(jsonb_build_object('place',1,'percentage',100)) END)
   ORDER BY multiplier)) FROM (VALUES (2,181),(10,19)) tiers(multiplier,freq);
$rules$;

CREATE FUNCTION pg_temp.native_spin_call(rules jsonb DEFAULT pg_temp.native_spin_rules())
RETURNS jsonb LANGUAGE sql AS $call$
 SELECT public.fn_spin_draw_and_settle_atomic(
  '92010000-0000-0000-0000-000000000001','92040000-0000-4000-8000-000000000001',
  '92050000-0000-4000-8000-000000000001',rules);
$call$;

CREATE FUNCTION pg_temp.native_spin_state() RETURNS jsonb LANGUAGE sql AS $snapshot$
 SELECT jsonb_build_array(
  pg_temp.spin_replay_state('92010000-0000-0000-0000-000000000001'),
  (SELECT to_jsonb(r) FROM public.spin_draw_receipts r
   WHERE tournament_id='92010000-0000-0000-0000-000000000001'));
$snapshot$;

CREATE FUNCTION pg_temp.spin_full_state() RETURNS jsonb LANGUAGE plpgsql AS $state$
DECLARE t record; rows jsonb; result jsonb:='{}';
BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname LOOP
  EXECUTE format('SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.%I x',t.relname) INTO rows;
  result:=result||jsonb_build_object(t.relname,rows);
 END LOOP;
 RETURN result;
END $state$;
CREATE FUNCTION pg_temp.spin_full_cancel_refused(label text) RETURNS void LANGUAGE plpgsql AS $refusal$
DECLARE before_state jsonb:=pg_temp.spin_full_state(); refused boolean:=false;
BEGIN
 BEGIN PERFORM public.atomic_cancel_tournament('92010000-0000-0000-0000-000000000001',NULL);
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Tournament has started or committed awards; resume or settle it instead of cancelling' THEN RAISE; END IF;
  refused:=true;
 END;
 IF NOT refused OR pg_temp.spin_full_state() IS DISTINCT FROM before_state
 THEN RAISE EXCEPTION 'FAIL %: cancellation was admitted or changed state',label; END IF;
 RAISE NOTICE 'PASS %',label;
END $refusal$;

-- A positive projection without a funded draw remains invalid, with no money.
SAVEPOINT projected_without_funding;
SET LOCAL session_replication_role=replica;
UPDATE public.tournaments SET spin_multiplier=2
 WHERE id='92010000-0000-0000-0000-000000000001';
SET LOCAL session_replication_role=origin;
DO $positive_unfunded$
DECLARE before_state jsonb:=pg_temp.native_spin_state(); result jsonb;
BEGIN
 result:=pg_temp.native_spin_call();
 IF result->>'ok' IS DISTINCT FROM 'false'
  OR result->>'reason' IS DISTINCT FROM 'projected_spin_draw_has_no_funding_proof'
  OR pg_temp.native_spin_state() IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'FAIL positive unfunded Spin projection was accepted: %',result;
 END IF;
END $positive_unfunded$;
DO $notice$ BEGIN RAISE NOTICE 'PASS Spin positive_unfunded'; END $notice$;
ROLLBACK TO SAVEPOINT projected_without_funding;

CREATE FUNCTION pg_temp.native_spin_final_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$
BEGIN
 IF NEW.tournament_id='92010000-0000-0000-0000-000000000001' THEN
  IF NEW.receipt->>'ok' IS DISTINCT FROM 'true'
   OR (SELECT count(*) FROM public.spin_reserve_ledger WHERE tournament_id=NEW.tournament_id)<>2
   OR (SELECT count(*) FROM public.chip_ledger WHERE tournament_id=NEW.tournament_id
       AND category IN ('spin_entry','spin_prize'))<>2
   OR (SELECT count(*) FROM public.rake_records WHERE tournament_id=NEW.tournament_id)<>1
   OR NOT EXISTS(SELECT 1 FROM public.tournament_escrow e WHERE e.tournament_id=NEW.tournament_id
       AND reserve_out=2.76 AND reserve_in=(NEW.receipt->>'prize_pool')::numeric
       AND fee_entries_in=.24 AND prize_balance=(NEW.receipt->>'prize_pool')::numeric) THEN
    RAISE EXCEPTION 'FAIL immutable receipt fault did not follow exact native money writes';
  END IF;
  RAISE EXCEPTION 'expected final immutable receipt fault' USING ERRCODE='ZX002';
 END IF;
 RETURN NEW;
END;
$fault$;
CREATE TRIGGER native_spin_final_receipt_fault AFTER INSERT ON public.spin_draw_receipts
FOR EACH ROW EXECUTE FUNCTION pg_temp.native_spin_final_receipt_fault();

DO $rollback$
DECLARE before_state jsonb:=pg_temp.spin_full_state(); refused boolean:=false; v_result jsonb;
BEGIN
 BEGIN v_result:=pg_temp.native_spin_call(); EXCEPTION WHEN SQLSTATE 'ZX002' THEN refused:=true; END;
 IF NOT refused OR pg_temp.spin_full_state() IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'FAIL immutable Spin receipt failure retained partial money or receipt: %',v_result;
 END IF;
END;
$rollback$;
DO $notice$ BEGIN RAISE NOTICE 'PASS Spin rollback'; END $notice$;
DROP TRIGGER native_spin_final_receipt_fault ON public.spin_draw_receipts;
DROP FUNCTION pg_temp.native_spin_final_receipt_fault();

-- Fail after the current wrapper has written money, receipt AND the row stamp.
CREATE FUNCTION pg_temp.native_spin_projection_fault() RETURNS trigger
LANGUAGE plpgsql AS $fault$
DECLARE receipt jsonb;
BEGIN
 IF NEW.id='92010000-0000-0000-0000-000000000001'
  AND COALESCE(OLD.spin_multiplier,0)=0 AND NEW.spin_multiplier>0 THEN
  SELECT r.receipt INTO receipt FROM public.spin_draw_receipts r
   WHERE r.tournament_id=NEW.id;
  IF receipt->>'ok' IS DISTINCT FROM 'true'
   OR receipt->>'rule_provenance' IS DISTINCT FROM 'at_draw'
   OR NEW.spin_multiplier IS DISTINCT FROM (receipt->>'multiplier')::numeric
   OR NEW.prize_pool IS DISTINCT FROM (receipt->>'prize_pool')::numeric
   OR NEW.blind_structure::jsonb IS DISTINCT FROM receipt->'blind_structure'
   OR NEW.payout_structure::jsonb IS DISTINCT FROM receipt->'payout_structure'
   OR NEW.spin_locked_tiers IS DISTINCT FROM receipt->'locked'
   OR NEW.is_premium_spin IS DISTINCT FROM OLD.is_premium_spin
   OR (SELECT count(*) FROM public.spin_reserve_ledger WHERE tournament_id=NEW.id)<>2
   OR (SELECT count(*) FROM public.chip_ledger WHERE tournament_id=NEW.id
       AND category IN ('spin_entry','spin_prize'))<>2
   OR (SELECT count(*) FROM public.rake_records WHERE tournament_id=NEW.id)<>1
   OR NOT EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id=NEW.id
      AND reserve_out=2.76 AND reserve_in=NEW.prize_pool
      AND fee_entries_in=.24 AND prize_balance=NEW.prize_pool) THEN
    RAISE EXCEPTION 'FAIL row-stamp fault was reached without the exact native funded contract';
  END IF;
  RAISE EXCEPTION 'expected final Spin row-stamp fault' USING ERRCODE='ZX003';
 END IF;
 RETURN NEW;
END $fault$;
CREATE TRIGGER native_spin_projection_fault AFTER UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION pg_temp.native_spin_projection_fault();
DO $projection_rollback$
DECLARE before_state jsonb:=pg_temp.spin_full_state(); refused boolean:=false;
BEGIN
 BEGIN PERFORM pg_temp.native_spin_call(); EXCEPTION WHEN SQLSTATE 'ZX003' THEN refused:=true; END;
 IF NOT refused OR pg_temp.spin_full_state() IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'FAIL late Spin row-stamp failure retained partial money, receipt or projection';
 END IF;
END $projection_rollback$;
DO $notice$ BEGIN RAISE NOTICE 'PASS Spin projection_rollback'; END $notice$;
DROP TRIGGER native_spin_projection_fault ON public.tournaments;
DROP FUNCTION pg_temp.native_spin_projection_fault();

CREATE TEMP TABLE native_spin_result(receipt jsonb NOT NULL, durable_state jsonb NOT NULL);
DO $native$
DECLARE first_receipt jsonb; replay_receipt jsonb; before_state jsonb; refused boolean:=false;
BEGIN
 first_receipt:=pg_temp.native_spin_call();
 IF first_receipt->>'ok' IS DISTINCT FROM 'true' OR first_receipt->>'replay' IS DISTINCT FROM 'false'
  OR (first_receipt->>'multiplier')::numeric NOT IN (2,10)
  OR (first_receipt->>'prize_pool')::numeric IS DISTINCT FROM (first_receipt->>'multiplier')::numeric
  OR (first_receipt->>'house_rake')::numeric IS DISTINCT FROM .24
  OR (first_receipt->>'operator_shortfall')::numeric IS DISTINCT FROM 0
  OR (first_receipt->>'pool_covered')::numeric IS DISTINCT FROM (first_receipt->>'prize_pool')::numeric
  OR NOT EXISTS(SELECT 1 FROM public.spin_bonus_pools
     WHERE id='92030000-0000-0000-0000-000000000001'
       AND balance=1002.76-(first_receipt->>'prize_pool')::numeric
       AND total_deposited=1002.76 AND total_drawn=(first_receipt->>'prize_pool')::numeric
       AND spin_count=1)
  OR (SELECT count(*) FROM public.spin_draw_receipts WHERE tournament_id='92010000-0000-0000-0000-000000000001')<>1 THEN
  RAISE EXCEPTION 'FAIL funded immutable Spin receipt: %',first_receipt;
 END IF;
 before_state:=pg_temp.native_spin_state();
 replay_receipt:=pg_temp.native_spin_call(jsonb_set(pg_temp.native_spin_rules(),'{starting_chips}','999'));
 IF replay_receipt IS DISTINCT FROM first_receipt||'{"replay":true}'::jsonb
  OR pg_temp.native_spin_state() IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'FAIL response-loss retry changed funded receipt or financial state';
 END IF;
 IF (public.fn_spin_draw_and_settle_atomic(
  '92010000-0000-0000-0000-000000000001','92040000-0000-4000-8000-000000000001',
  '92050000-0000-4000-8000-000000000099',pg_temp.native_spin_rules())->>'reason') IS DISTINCT FROM 'launch_lease_lost'
  OR pg_temp.native_spin_state() IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'FAIL stale owner used the immutable receipt';
 END IF;
 BEGIN DELETE FROM public.spin_draw_receipts WHERE tournament_id='92010000-0000-0000-0000-000000000001';
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 IF NOT refused OR pg_temp.native_spin_state() IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'FAIL privileged receipt mutation was accepted';
 END IF;
 INSERT INTO native_spin_result VALUES(first_receipt,before_state);
END;
$native$;
DO $notice$ BEGIN RAISE NOTICE 'PASS Spin native'; END $notice$;


-- The atomic SQL authority must stamp every contract field itself.
-- No client/engine UPDATE is allowed to make this acceptance assertion pass.
DO $automatic_projection$
DECLARE receipt jsonb;
BEGIN
 SELECT r.receipt INTO receipt FROM native_spin_result r;
 IF receipt->>'rule_provenance' IS DISTINCT FROM 'at_draw'
  OR NOT EXISTS(SELECT 1 FROM public.tournaments t
   WHERE t.id='92010000-0000-0000-0000-000000000001'
    AND t.spin_multiplier=(receipt->>'multiplier')::numeric
    AND t.prize_pool=(receipt->>'prize_pool')::numeric
    AND t.spin_locked_tiers IS NOT DISTINCT FROM receipt->'locked'
    AND t.blind_structure::jsonb=receipt->'blind_structure'
    AND t.payout_structure::jsonb=receipt->'payout_structure') THEN
  RAISE EXCEPTION 'FAIL atomic draw omitted its at_draw row projection';
 END IF;
END $automatic_projection$;
DO $notice$ BEGIN RAISE NOTICE 'PASS Spin automatic_projection'; END $notice$;
DO $$ DECLARE r jsonb; BEGIN r:=public.fn_complete_tournament_launch_atomic('92010000-0000-0000-0000-000000000001','92040000-0000-4000-8000-000000000001','92050000-0000-4000-8000-000000000001'); IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'real launch failed %',r; END IF; END $$;
SET LOCAL session_replication_role=replica;
UPDATE public.tournament_players SET chips=CASE WHEN user_id=md5('zero-default-spin-launch-user:3')::uuid THEN 3000 ELSE 0 END,status=CASE WHEN user_id=md5('zero-default-spin-launch-user:3')::uuid THEN 'playing' ELSE 'eliminated' END,position=CASE WHEN user_id=md5('zero-default-spin-launch-user:1')::uuid THEN 3 WHEN user_id=md5('zero-default-spin-launch-user:2')::uuid THEN 2 ELSE NULL END,elimination_sequence=CASE WHEN user_id=md5('zero-default-spin-launch-user:1')::uuid THEN 1 WHEN user_id=md5('zero-default-spin-launch-user:2')::uuid THEN 2 ELSE NULL END,eliminated_at=CASE WHEN user_id=md5('zero-default-spin-launch-user:3')::uuid THEN NULL ELSE now() END WHERE tournament_id='92010000-0000-0000-0000-000000000001';
UPDATE public.table_seats SET stack=CASE WHEN seat_number=3 THEN 3000 ELSE 0 END WHERE table_id=pg_temp.spin_table_id();
UPDATE public.tournaments SET current_players=1,prize_pool_finalized=true,entry_contract_locked=true WHERE id='92010000-0000-0000-0000-000000000001';
SET LOCAL session_replication_role=origin;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
