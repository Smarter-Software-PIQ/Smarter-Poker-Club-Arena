"""Fresh stopped-bank custody after exact original preparation cancellation."""
import hashlib
import json
import re
import uuid


def qualify(root, out, cmd, command, run, probe, require, results):
 fixture=(root/'scripts/ci/probes/f06-shared-hand-lane/stopped-bank-fixture.sql').read_text()
 fixture=fixture.replace('INSERT INTO tournament_players VALUES(', 'INSERT INTO tournament_players(id,tournament_id,table_id,user_id,seat_number,chips,status) VALUES(')
 run('cancelled-bank-fixture',fixture)
 service="SET request.jwt.claims='{\"role\":\"service_role\"}';SET app.smarter_data_actor='service';"
 preimage=json.loads((root/'scripts/ci/probes/f06-shared-hand-lane/stopped-cancelled-preimage.json').read_text())
 # Earlier maintained historical qualification supplies all actual dependencies.
 # Only the later SQLSTATE classification differs from its snapshot postimage.
 run('cancelled-bank-current-source',preimage['definition'])
 run('cancelled-bank-current-identity',"SELECT md5(prosrc)||'|'||pg_get_userbyid(proowner)||'|'||proacl::text FROM pg_proc WHERE oid='smarter_private.f06_mixed_custody_snapshot(uuid,uuid,jsonb)'::regprocedure;",preimage['source_md5']+'|postgres|{postgres=X/postgres}')
 # A fresh physical capture follows this original dealer's acknowledged
 # preparation cancellation; the completed-hand number correctly stays 12.
 cancelled = """
 UPDATE engine_tournament_leases SET heartbeat_at=clock_timestamp() WHERE tournament_id=md5('sb-event')::uuid;
 INSERT INTO smarter_private.f06_hand_permits(permit_id,tournament_id,table_id,lifecycle,hand_number,custody_id,generation,state)
 SELECT md5('sb-cancelled')::uuid,tournament_id,id,f06_lifecycle,13,md5('sb-allocation')::uuid,md5('sb-old')::uuid,'reserved'
 FROM tables WHERE id=md5('sb-table')::uuid;
 SET app.smarter_data_actor='tournament-manager';
 DO $$ BEGIN
 PERFORM set_config('app.smarter_tournament_id',md5('sb-event')::uuid::text,true);
 PERFORM set_config('app.smarter_tournament_lease_generation',md5('sb-old')::uuid::text,true);
 PERFORM fn_f06_cancel_prepared_hand(md5('sb-event')::uuid,md5('sb-old')::uuid,md5('sb-table')::uuid,
 (SELECT f06_lifecycle FROM tables WHERE id=md5('sb-table')::uuid),md5('sb-cancelled')::uuid,13,md5('sb-allocation')::uuid);
 END $$;
 SET app.smarter_data_actor='service';
 UPDATE engine_tournament_leases SET heartbeat_at=clock_timestamp()-interval '31 seconds' WHERE tournament_id=md5('sb-event')::uuid;
 UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,stopped_capture,cancelled_preparation}',
 jsonb_build_object('tournament_id',md5('sb-event')::uuid,'lease_generation',md5('sb-old')::uuid,
 'table_id',md5('sb-table')::uuid,'lifecycle',(SELECT f06_lifecycle::text FROM tables WHERE id=md5('sb-table')::uuid),
 'permit_id',md5('sb-cancelled')::uuid,'hand_number','13','custody_id',md5('sb-allocation')::uuid));
 """
 pending = """
 UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,permit}',
 jsonb_build_object('binding',local_proof#>'{engines,0,bank_custody,stopped_capture,cancelled_preparation}','phase','terminated'));
 UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,stopped_capture,pending_preparation_cancellation}',
 local_proof#>'{engines,0,bank_custody,stopped_capture,cancelled_preparation}')#-'{engines,0,bank_custody,stopped_capture,cancelled_preparation}';
 """
 without_receipt=re.sub(r' PERFORM fn_f06_cancel_prepared_hand\(.*?;','',cancelled,flags=re.S)
 require(without_receipt!=cancelled,'Missing cancellation RPC counterfactual')
 probe('cancelled-bank-red-original',service+cancelled+'SELECT fixture_stopped_prepare();',error='F06_STOPPED_BANK_ORIGINAL_CHANGED')
 probe('cancelled-bank-red-lost-ack',service+cancelled+pending+'SELECT fixture_stopped_prepare();',error='F06_STOPPED_BANK_ORIGINAL_CHANGED')

 migration=root/'supabase/migrations/20261106160107_a_stopped_bank_capture_retains_its_acknowledged_preparation_.sql'
 for label,change in [
 ('body',"CREATE OR REPLACE FUNCTION smarter_private.f06_mixed_custody_snapshot(t uuid,g uuid,local_proof jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $$SELECT '{}'::jsonb$$;"),
 ('acl',"GRANT EXECUTE ON FUNCTION smarter_private.f06_mixed_custody_snapshot(uuid,uuid,jsonb) TO authenticated;"),
 ('owner',"ALTER FUNCTION smarter_private.f06_mixed_custody_snapshot(uuid,uuid,jsonb) OWNER TO service_role;"),
 ]: probe('cancelled-bank-installer-refuses-'+label,change+migration.read_text(),error='F06_STOPPED_CANCELLED_DEPENDENCY_DRIFT')
 run('cancelled-bank-install',migration.read_text())
 probe('cancelled-bank-acknowledged-capture',service+cancelled+'SELECT fixture_stopped_prepare();')
 probe('cancelled-bank-lost-ack-receipt-proves-original',service+cancelled+pending+'SELECT fixture_stopped_prepare();')
 probe('cancelled-bank-intent-without-commit-refused',service+without_receipt+pending+'SELECT fixture_stopped_prepare();',error='CANCELLED_ORIGINAL_UNPROVEN')
 for label,change in [
 ('missing-original',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,permit}','null');"),
 ('wrong-original-phase',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,permit,phase}','\"reserved\"');"),
 ('wrong-original-binding',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,permit,binding,permit_id}',to_jsonb(gen_random_uuid()));"),
 ]: probe('cancelled-bank-intent-refuses-'+label,service+cancelled+pending+change+'SELECT fixture_stopped_prepare();',error='CANCELLED_ORIGINAL_UNPROVEN')
 next_cancelled=cancelled.replace('sb-cancelled','sb-cancelled-next').replace(',13,',',14,').replace("'13'","'14'")
 probe('cancelled-bank-several-acknowledgements',service+cancelled+next_cancelled+'SELECT fixture_stopped_prepare();')
 for label,change,reason in [
 ('missing-binding',"UPDATE fixture_stopped_bank_input SET local_proof=local_proof#-'{engines,0,bank_custody,stopped_capture,cancelled_preparation}';",'ORIGINAL_CHANGED'),
 ('missing-receipt',"ALTER TABLE smarter_private.f06_prepared_hand_cancellations DISABLE TRIGGER f06_prepared_cancellation_immutable;DELETE FROM smarter_private.f06_prepared_hand_cancellations WHERE permit_id=md5('sb-cancelled')::uuid;",'CANCELLED_ORIGINAL_UNPROVEN'),
 ('wrong-permit',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,stopped_capture,cancelled_preparation,permit_id}',to_jsonb(gen_random_uuid()));",'CANCELLED_ORIGINAL_UNPROVEN'),
 ('wrong-lifecycle',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,stopped_capture,cancelled_preparation,lifecycle}','\"999\"');",'CANCELLED_ORIGINAL_UNPROVEN'),
 ('wrong-generation',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,stopped_capture,cancelled_preparation,lease_generation}',to_jsonb(gen_random_uuid()));",'CANCELLED_ORIGINAL_UNPROVEN'),
 ('wrong-custody',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,stopped_capture,cancelled_preparation,custody_id}',to_jsonb(gen_random_uuid()));",'CANCELLED_ORIGINAL_UNPROVEN'),
 ('wrong-completed-hand',"UPDATE fixture_stopped_bank_input SET local_proof=jsonb_set(local_proof,'{engines,0,bank_custody,hand_number}','11');",'ORIGINAL_CHANGED'),
 ('newer-permit',"INSERT INTO smarter_private.f06_hand_permits(permit_id,tournament_id,table_id,lifecycle,hand_number,custody_id,generation,state) SELECT md5('sb-later')::uuid,tournament_id,table_id,lifecycle,14,custody_id,generation,'never_started' FROM smarter_private.f06_hand_permits WHERE permit_id=md5('sb-cancelled')::uuid;",'ORIGINAL_CHANGED'),
 ]: probe('cancelled-bank-refuses-'+label,service+cancelled+change+'SELECT fixture_stopped_prepare();',error=reason)
 # The same immutable receipt, not only observation, admits its selected
 # successor and preserves the actual captured balance under exact replay.
 run('cancelled-bank-cancellation-commits-before-readback',service+cancelled)
 run('cancelled-bank-observe',service+pending+"UPDATE fixture_stopped_bank_input SET expected=fixture_stopped_prepare()->'canonical';")
 run('cancelled-bank-commit',service+"UPDATE fixture_stopped_bank_input SET receipt=fixture_stopped_prepare(expected)->'receipt';")
 run('cancelled-bank-commit-replay',service+"SELECT fixture_stopped_prepare(expected)->'receipt'=(SELECT receipt FROM fixture_stopped_bank_input) FROM fixture_stopped_bank_input;",'t')
 lease=(root/'supabase/migrations/20260908042900_tournament_leases_have_fencing_generations.sql').read_text()
 release=re.search(r'CREATE OR REPLACE FUNCTION public.release_tournament_leases_v2\(.*?\$function\$;',lease,re.S)
 require(release is not None,'Native owner release missing')
 run('cancelled-bank-native-release',release[0])
 run('cancelled-bank-release',service+"SELECT release_tournament_leases_v2('sb-process',jsonb_build_array(jsonb_build_object('tournament_id',md5('sb-event')::uuid,'lease_generation',md5('sb-old')::uuid))); ")
 run('cancelled-bank-successor-claim',"SELECT granted FROM claim_tournament_lease_v2(md5('sb-event')::uuid,'sb-successor','aaaaa222',md5('sb-new')::uuid);",'t')
 event=uuid.UUID(hashlib.md5(b'sb-event').hexdigest());generation=uuid.UUID(hashlib.md5(b'sb-new').hexdigest())
 manager=service+f"SET app.smarter_data_actor='tournament-manager';SET app.smarter_tournament_id='{event}';SET app.smarter_tournament_lease_generation='{generation}';"
 args="md5('sb-event')::uuid,md5('sb-new')::uuid,md5('sb-transfer')::uuid,(SELECT receipt FROM fixture_stopped_bank_input)"
 run('cancelled-bank-successor-admits',manager+'SELECT fn_f06_admit_mixed_manager_custody('+args+');')
 run('cancelled-bank-successor-completes',manager+'SELECT fn_f06_complete_mixed_manager_custody('+args+');')
 banks=json.loads(run('cancelled-bank-values-preserved',"SELECT time_bank_snapshot->'players' FROM engine_presence_parked WHERE table_id=md5('sb-table')::uuid;"))
 require(next(iter(banks.values()))['remainingSeconds']==7,'Cancelled preparation changed captured bank')
 run('cancelled-bank-completion-replay',manager+'SELECT fn_f06_complete_mixed_manager_custody('+args+');')
 results['stoppedCancelled']={'passed':True,'actualPreparationCancellation':True,'sameOriginalWatermark':True,'lostCancellationAck':True,'uncommittedIntentRefused':True,'sourceSha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [migration,root/'scripts/ci/probes/f06-shared-hand-lane/stopped-cancelled-preimage.json',root/'scripts/ci/probes/f06-shared-hand-lane/stopped_cancelled_qualification.py']}}
