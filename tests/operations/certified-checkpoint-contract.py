"""Scoped publisher proof, terminal receipt and one-shot registration boundaries."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import types
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('certified_db', ROOT/'server/scripts/engine-release-database-proof.py')
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)
ANN = 1793835000076  # 2026-11-04T23:30:00.076Z, within the exact owner interval.
INSTANCE = '1-5835d418'
TOKEN = '35b5aa56-2bc6-45ec-9991-2f5eb2e96a27'

def iso(ms):
    return datetime.fromtimestamp(ms/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def fixture(now=None, early=False):
    now = ANN+330000 if now is None else now
    start = ANN+120000-int(early)
    request = dict(runKey='41999999999-1',targetSha='a'*40,controlSha='b'*40,
        predecessorSha=db.CERTIFIED_PREDECESSOR,instanceId=INSTANCE,announcedAt=iso(ANN),
        ownershipToken=TOKEN,policyId=db.CERTIFIED_POLICY)
    shifted = {key:index for index,key in enumerate(sorted(db.TERMINAL_THAW_TARGETS))}
    shifted.update(complete=True,_targets_snapshotted=True,_target_counts=dict(shifted))
    raw=dict(id=True,phase='counting_down',announced_at=iso(ANN),break_started_at=iso(start),
        break_ends_at=iso(start+300000),reason='Deployment Recovery',ownership_token=TOKEN,
        enforce_freeze=True,declared_by=db.CERTIFIED_PREDECESSOR[:8])
    thaw=dict(freeze_started_at=iso(start),announced_at=iso(ANN),ownership_token=TOKEN,
        contract_version=3,frozen_seconds=(ANN+900000-start)/1000,release_target_at=iso(ANN+900000),
        release_generation=1,shifted=shifted)
    proof=dict(schema='engine-certified-recovery/v1',policyId=db.CERTIFIED_POLICY,request=request,
        profile=copy.deepcopy(db.CERTIFIED_PROFILE),observedAt=iso(now),releaseAt=iso(ANN+900000),
        rawMaintenance=raw,leader=dict(version=db.CERTIFIED_PREDECESSOR,instanceId=INSTANCE,heartbeatAt=iso(now)),
        thaw=thaw,targets=dict(familyCount=15,allCredited=True,complete=True),
        platformFrozen=now<ANN+900000,entryPurchasesFrozen=now<ANN+900000)
    health=dict(running=True,releaseSha=db.CERTIFIED_PREDECESSOR,instanceId=INSTANCE,weeklyPayout=None,
        maintenance=dict(active=True,phase='counting_down',durableConfirmed=True,reason='Deployment Recovery',
            breakEndsAt=start+300000,presentation=dict(break_id=ANN,break_ends_at=ANN+900000)))
    return request,proof,health

class CertifiedContract(unittest.TestCase):
    def test_wire_timestamp_keeps_exact_milliseconds_including_whole_seconds(self):
        for fraction in (0,1,76,999):
            millis=1793835000000+fraction
            expected='2026-11-04T23:30:00.%03dZ'%fraction
            self.assertEqual(db.epoch_milliseconds_iso(millis),expected)
            self.assertEqual(db.certified_epoch(expected),millis)
        for invalid in (True,1793835000076.0,'1793835000076',None):
            with self.assertRaises(ValueError):db.epoch_milliseconds_iso(invalid)

    def test_autoheal_is_fenced_and_restored_only_by_the_original_no_action_owner(self):
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        block=source[source.index('fence_certified_checkpoint_autoheal() {'):source.index('prove_rollback_readiness() {')]
        for case in ('ok','ordinary','unlocked','stop-failed','foreign-fence','intent-remains','restore-failed'):
            with self.subTest(case),tempfile.TemporaryDirectory(prefix='certified-autoheal-') as directory:
                script='''set -euo pipefail
die(){ printf '%s\\n' "$*" >&2; exit 13; }
legacy_entry_read(){ "$@"; }
timeout(){ shift 3; "$@"; }
bounded_break_command(){ shift; "$@"; }
persist_break_deadline(){ printf 'persist\\n' >> "$REQUEST_ROOT/trace"; }
clear_break_deadline(){ printf 'clear\\n' >> "$REQUEST_ROOT/trace"; }
docker(){
 printf '%s\\n' "$*" >> "$REQUEST_ROOT/trace"
 case "$1" in
  stop) [ "$CASE" != stop-failed ] || return 1; printf exited > "$REQUEST_ROOT/status" ;;
  start) [ "$CASE" != restore-failed ] || return 1; printf running > "$REQUEST_ROOT/status" ;;
  container)
   if [ "$4" = '{{.Id}}' ]; then printf '%s\\n' "$CID";
   elif [ "$CASE" = foreign-fence ]; then printf '%s exited\\n' "${CID%a}b";
   else printf '%s %s\\n' "$CID" "$(cat "$REQUEST_ROOT/status")"; fi ;;
  *) return 1;;
 esac
}
LEGACY_CHECKPOINT_PROFILE=eed-240s-certified-release-v1
[ "$CASE" != ordinary ] || LEGACY_CHECKPOINT_PROFILE=eed-80s-v1
LOCK_HELD=1; [ "$CASE" != unlocked ] || LOCK_HELD=0
MUTATION_STARTED=1; CERTIFIED_AUTOHEAL_FENCED=0; CERTIFIED_AUTOHEAL_ID=''
RUN_ID=41999999999-1
'''+block+'''
fence_certified_checkpoint_autoheal
if [ "$CASE" = intent-remains ]; then printf owned > "$REQUEST_ROOT/$RUN_ID.legacy-checkpoint-intent"; fi
restore_certified_checkpoint_autoheal
printf '%s' "$CERTIFIED_AUTOHEAL_FENCED"
'''
                result=subprocess.run(['bash','-c',script],text=True,capture_output=True,timeout=5,
                    env={**os.environ,'CASE':case,'REQUEST_ROOT':directory,'CID':'a'*64})
                trace=(Path(directory)/'trace').read_text() if (Path(directory)/'trace').exists() else ''
                self.assertEqual(result.returncode,0 if case in ('ok','ordinary') else 13,result.stderr)
                if case=='ok':
                    self.assertEqual(result.stdout,'0')
                    self.assertLess(trace.index('persist'),trace.index('stop -t 15'))
                    self.assertLess(trace.index('start '),trace.index('clear'))
                    self.assertEqual((Path(directory)/'status').read_text(),'running')
                elif case in ('ordinary','unlocked'):self.assertEqual(trace,'')
                elif case=='intent-remains':self.assertNotIn('start ',trace)

    def test_completed_fifteen_family_receipt_and_exact_early_native_timer(self):
        for early in (False,True):
            req,proof,health=fixture(early=early)
            with patch.object(db.time,'time',return_value=(ANN+330000)/1000):
                self.assertEqual(db.validate_certified_proof(proof,req,complete=True,minimum_ms=525000,health=health),proof)
                with self.assertRaises(ValueError): db.validate_certified_proof(proof,req,complete=True,minimum_ms=570001)

    def test_foreign_stale_partial_missing_family_and_short_credit_refuse(self):
        cases={
            'foreign request':lambda p:p['request'].update(targetSha='c'*40),
            'foreign token':lambda p:p['thaw'].update(ownership_token='00000000-0000-0000-0000-000000000001'),
            'stale leader':lambda p:p['leader'].update(heartbeatAt=iso(ANN+299999)),
            'short stored leader unnormalized':lambda p:p['leader'].update(version=db.CERTIFIED_PREDECESSOR[:8]),
            'partial':lambda p:p['targets'].update(complete=False),
            'missing family':lambda p:p['thaw']['shifted'].pop('reconnect_presence'),
            'wrong family credit':lambda p:p['thaw']['shifted']['_target_counts'].update(reconnect_presence=999),
            'boolean family':lambda p:p['thaw']['shifted'].update(sit_out_at=True),
            'short credit':lambda p:p['thaw'].update(frozen_seconds=300),
            'raw extended instead of original':lambda p:p['rawMaintenance'].update(break_ends_at=iso(ANN+900000)),
            'release changed':lambda p:p.update(releaseAt=iso(ANN+900001)),
            'already unfrozen':lambda p:p.update(platformFrozen=False),
            'entry unfrozen':lambda p:p.update(entryPurchasesFrozen=False),
        }
        for name,mutate in cases.items():
            req,proof,_=fixture();proof=copy.deepcopy(proof);mutate(proof)
            with self.subTest(name),patch.object(db.time,'time',return_value=(ANN+330000)/1000),self.assertRaises((ValueError,KeyError)):
                db.validate_certified_proof(proof,req,complete=True)

    def test_exact_native_health_uses_future_presentation_and_original_raw_tuple(self):
        req,proof,health=fixture()
        for change in ({'running':False},{'releaseSha':'c'*40},{'instanceId':'1-deadbeef'},
                       {'weeklyPayout':{}},{'maintenance':{**health['maintenance'],'breakEndsAt':ANN+900000}},
                       {'maintenance':{**health['maintenance'],'presentation':{'break_id':ANN,'break_ends_at':ANN+420000}}}):
            with patch.object(db.time,'time',return_value=(ANN+330000)/1000),self.assertRaises(ValueError):
                db.validate_certified_proof(proof,req,complete=True,health={**health,**change})

    def terminal(self,early=False,mutate=None,active=False,future=False):
        now=ANN+901000
        req,proof,_=fixture(now,early)
        row={**copy.deepcopy(proof['thaw']),'thawed_at':iso(ANN+330000),'thawed_by':db.CERTIFIED_PREDECESSOR[:8]}
        if mutate: mutate(row)
        class Reply:
            def __init__(self,data):self.data=json.dumps(data).encode()
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,size):return self.data[:size]
        class Opener:
            def open(self,request,**_):
                if 'engine_maintenance_break?' in request.full_url:return Reply([{'id':True}] if active else [])
                if 'release_target_at=gt.' in request.full_url:return Reply([{'release_target_at':iso(now+1)}] if future else [])
                return Reply([row])
        with patch.object(db.time,'time',return_value=now/1000),patch.object(db,'build_opener',return_value=Opener()),\
             patch.object(db,'read_leader',return_value=(db.CERTIFIED_PREDECESSOR[:8],INSTANCE,1)):
            db.validate_certified_proof(proof,req,complete=True,terminal_instance=INSTANCE)
            return db.verify_terminal_owned_thaw('https://db.invalid','fixture',db.CERTIFIED_PREDECESSOR,INSTANCE,15,
                ANN,ANN+120000,ANN+900000,certified=proof)

    def test_terminal_receipt_keeps_closed_shape_and_original_eed_thaw_provenance(self):
        expected=dict(schema='terminal-owned-thaw/v1',sha=db.CERTIFIED_PREDECESSOR,instanceId=INSTANCE,
            databaseIdle=True,freshLeader=True,ownedV3Thaw=True,announcedAt=ANN,startsAt=ANN+120000,endsAt=ANN+900000)
        self.assertEqual(self.terminal(),expected)
        self.assertEqual(self.terminal(early=True),expected)
        for change in (lambda r:r.update(thawed_by='aaaaaaaa'),lambda r:r.update(frozen_seconds=300),
                       lambda r:r.update(release_target_at=iso(ANN+420000)),lambda r:r.update(ownership_token='0'*36)):
            with self.assertRaises(ValueError):self.terminal(mutate=change)
        with self.assertRaises(ValueError):self.terminal(active=True)
        with self.assertRaises(ValueError):self.terminal(future=True)

    def test_terminal_requires_actual_release_and_both_unfrozen(self):
        req,proof,_=fixture(ANN+900000)
        with patch.object(db.time,'time',return_value=(ANN+900000)/1000),self.assertRaises(ValueError):
            db.validate_certified_proof(proof,req,complete=True,terminal_instance=INSTANCE)
        req,proof,_=fixture(ANN+901000);proof['entryPurchasesFrozen']=True
        with patch.object(db.time,'time',return_value=(ANN+901000)/1000),self.assertRaises(ValueError):
            db.validate_certified_proof(proof,req,complete=True,terminal_instance=INSTANCE)

    def test_lost_registration_response_reads_original_receipt_without_second_post(self):
        req,proof,_=fixture(ANN+10000)
        proof['rawMaintenance'].update(phase='last_hand',break_started_at=None,break_ends_at=None)
        proof['thaw']=None;proof['targets']=dict(familyCount=15,allCredited=False,complete=False)
        proof.update(platformFrozen=False,entryPurchasesFrozen=False)
        contract=dict(schema='engine-certified-recovery-contract/v1',policyId=db.CERTIFIED_POLICY,
            profile=db.CERTIFIED_PROFILE,thawDefinitionMd5=db.CERTIFIED_THAW_MD5,
            notBefore='2026-11-04T23:00:00Z',notAfter='2026-11-05T05:00:00Z')
        calls=[]
        def rpc(_url,_key,name,parameters=None,write=False):
            calls.append((name,write,parameters))
            if name=='fn_engine_certified_recovery_contract':return contract
            if write:raise TimeoutError('lost response')
            return proof
        with tempfile.TemporaryDirectory(prefix='certified-contract-') as directory:
            args=types.SimpleNamespace(sha=db.CERTIFIED_PREDECESSOR,certified_mode='register',
                target_sha=req['targetSha'],control_sha=req['controlSha'],window_announced_ms=ANN,
                certified_request_root=directory,run_id=req['runKey'],instance_id=INSTANCE,
                certified_health_stdin=False,minimum_ms=0)
            with patch.object(db.time,'time',return_value=(ANN+10000)/1000),patch.object(db,'certified_rpc',side_effect=rpc),\
                 patch.object(db,'read_maintenance_promise',return_value={'maintenance':proof['rawMaintenance']}),\
                 patch.object(db,'read_certified_request',side_effect=lambda p:json.loads(p.read_text())):
                self.assertEqual(db.operate_certified(args,'https://db.invalid','fixture'),proof)
                request_file=Path(directory)/(req['runKey']+'.certified-recovery-request')
                original=request_file.read_bytes()
                self.assertEqual(request_file.stat().st_mode&0o777,0o600)
                self.assertEqual(db.operate_certified(args,'https://db.invalid','fixture'),proof)
                self.assertEqual(request_file.read_bytes(),original)
                args.target_sha='c'*40
                with self.assertRaises(ValueError):db.operate_certified(args,'https://db.invalid','fixture')
            self.assertEqual(sum(write for _,write,_ in calls),1)
            self.assertEqual(sum(name=='fn_engine_certified_recovery_proof' for name,_,_ in calls),2)

    def test_positive_absent_registration_uses_ordinary_thaw_after_the_conservative_reservation(self):
        now=ANN+901000
        req,proof,_=fixture(now)
        row={**proof['thaw'],'release_target_at':iso(ANN+420000),'frozen_seconds':300,
            'thawed_at':iso(ANN+330000),'thawed_by':db.CERTIFIED_PREDECESSOR[:8]}
        absent=dict(schema='engine-certified-recovery-absent/v1',policyId=db.CERTIFIED_POLICY,
            runKey=req['runKey'],targetSha=req['targetSha'],controlSha=req['controlSha'],announcedAt=iso(ANN),
            observedAt=iso(now),platformFrozen=False,entryPurchasesFrozen=False)
        contract=dict(schema='engine-certified-recovery-contract/v1',policyId=db.CERTIFIED_POLICY,
            profile=db.CERTIFIED_PROFILE,thawDefinitionMd5=db.CERTIFIED_THAW_MD5,
            notBefore='2026-11-04T23:00:00Z',notAfter='2026-11-05T05:00:00Z')
        class Reply:
            def __init__(self,data):self.data=json.dumps(data).encode()
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,size):return self.data[:size]
        class Opener:
            def open(self,request,**_):
                return Reply([] if 'engine_maintenance_break?' in request.full_url or 'release_target_at=gt.' in request.full_url else [row])
        with tempfile.TemporaryDirectory(prefix='certified-absent-') as directory:
            args=types.SimpleNamespace(sha=db.CERTIFIED_PREDECESSOR,certified_mode='terminal',
                target_sha=req['targetSha'],control_sha=req['controlSha'],window_announced_ms=ANN,
                window_starts_ms=ANN+120000,window_ends_ms=ANN+900000,
                certified_request_root=directory,run_id=req['runKey'],instance_id=INSTANCE,max_heartbeat_age_seconds=15)
            def run(witness):
                with patch.object(db.time,'time',return_value=now/1000),patch.object(db,'build_opener',return_value=Opener()),\
                     patch.object(db,'read_leader',return_value=(db.CERTIFIED_PREDECESSOR[:8],INSTANCE,1)),\
                     patch.object(db,'certified_rpc',side_effect=[contract,witness]):
                    return db.operate_certified(args,'https://db.invalid','fixture')
            self.assertEqual(run(absent)['endsAt'],ANN+900000)
            for invalid in (None,{}, {**absent,'runKey':'123-1'},{**absent,'platformFrozen':True},
                            {**absent,'observedAt':iso(now-5001)},{**absent,'extra':True}):
                with self.assertRaises(ValueError):run(invalid)
            row['frozen_seconds']=299
            with self.assertRaises(ValueError):run(absent)

    def test_definitive_refusal_requires_its_durable_response_and_no_cycle(self):
        now=ANN+901000
        req,_,_=fixture(now)
        absent=dict(schema='engine-certified-recovery-absent/v1',policyId=db.CERTIFIED_POLICY,
            runKey=req['runKey'],targetSha=req['targetSha'],controlSha=req['controlSha'],announcedAt=iso(ANN),
            observedAt=iso(now),platformFrozen=False,entryPurchasesFrozen=False)
        contract=dict(schema='engine-certified-recovery-contract/v1',policyId=db.CERTIFIED_POLICY,
            profile=db.CERTIFIED_PROFILE,thawDefinitionMd5=db.CERTIFIED_THAW_MD5,
            notBefore='2026-11-04T23:00:00Z',notAfter='2026-11-05T05:00:00Z')
        class Reply:
            def __init__(self,data):self.data=json.dumps(data).encode()
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,size):return self.data[:size]
        class Opener:
            def __init__(self,failure):self.failure=failure;self.calls=0
            def open(self,request,**_):
                self.calls+=1
                if self.failure=='unknown':raise TimeoutError('unconfirmed')
                if self.failure=='thaw' and 'announced_at=eq.' in request.full_url:return Reply([{'announced_at':iso(ANN)}])
                if self.failure=='future' and 'release_target_at=gt.' in request.full_url:return Reply([{'release_target_at':iso(now+1)}])
                if self.failure=='active' and 'engine_maintenance_break?' in request.full_url:return Reply([{'id':True}])
                return Reply([])
        with tempfile.TemporaryDirectory(prefix='certified-refused-') as directory:
            args=types.SimpleNamespace(sha=db.CERTIFIED_PREDECESSOR,certified_mode='refused',
                certified_refusal_status='busy',target_sha=req['targetSha'],control_sha=req['controlSha'],
                window_announced_ms=ANN,window_starts_ms=ANN+120000,window_ends_ms=ANN+900000,
                certified_request_root=directory,run_id=req['runKey'],instance_id=INSTANCE,max_heartbeat_age_seconds=15)
            with patch.object(db.time,'time',return_value=(ANN+1000)/1000):
                for unknown in ('unknown','unavailable','pending','accepted'):
                    args.certified_refusal_status=unknown
                    with self.assertRaises(ValueError):db.operate_certified(args,'https://db.invalid','fixture')
                    self.assertFalse(db.certified_refusal_file(args).exists())
                args.certified_refusal_status='busy'
                receipt=db.operate_certified(args,'https://db.invalid','fixture')
                original=db.certified_refusal_file(args).read_bytes()
                self.assertEqual(db.certified_refusal_file(args).stat().st_mode&0o777,0o600)
                with self.assertRaises(FileExistsError):db.operate_certified(args,'https://db.invalid','fixture')
                self.assertEqual(db.certified_refusal_file(args).read_bytes(),original)
            args.certified_mode='terminal'
            def run(failure='',witness=None,leader=None):
                opener=Opener(failure)
                # Isolate host uid only; the actual immutable file is read.
                with patch.object(db.time,'time',return_value=now/1000),patch.object(db,'build_opener',return_value=opener),\
                     patch.object(db,'read_leader',side_effect=leader or [(db.CERTIFIED_PREDECESSOR[:8],INSTANCE,1)]*2),\
                     patch.object(db,'read_certified_request',side_effect=lambda p:json.loads(p.read_text())),\
                     patch.object(db,'certified_rpc',side_effect=[contract,absent if witness is None else witness]):
                    result=db.operate_certified(args,'https://db.invalid','fixture')
                    self.assertEqual(opener.calls,4)
                    return result
            expected=dict(schema='terminal-refused-announcement/v1',sha=db.CERTIFIED_PREDECESSOR,
                instanceId=INSTANCE,databaseIdle=True,freshLeader=True,ownedV3Thaw=False,announcementRefused=True,
                announcedAt=ANN,startsAt=ANN+120000,endsAt=ANN+900000)
            self.assertEqual(run(),expected)
            # Execute the maintained seal's exact equality block, preserving
            # the surrounding native ownership gates covered by the floor suite.
            seal=(ROOT/'server/scripts/engine-release-seal.py').read_text()
            start=seal.index('        database = json.loads(raw)',seal.index('def cmd_prove_expired_recovery_announcement'))
            end=seal.index('        failed_routine_require(runtime ==',start)
            import textwrap
            consumer=compile(textwrap.dedent(seal[start:end]),'<actual-seal-terminal-consumer>','exec')
            def accepts(value,certified=True):
                def require(ok,reason=None):
                    if not ok:raise ValueError('actual seal refused'+(' ('+reason+')' if reason else ''))
                # 2026-11-05: the seal's terminal consumer compares against the
                # sealed desired identity it was handed, not a release constant.
                exec(consumer,{'json':json,'raw':json.dumps(value),'desired':(db.CERTIFIED_PREDECESSOR,'sha256:'+'0'*64),
                    'runtime':{'instanceId':INSTANCE},'window':dict(announcedAt=ANN,startsAt=ANN+120000,endsAt=ANN+900000),
                    'owner':{'certifiedRecovery':{'profileId':'eed-240s-certified-release-v1'} if certified else None},
                    'failed_routine_require':require})
            accepts(expected)
            with self.assertRaises(ValueError):accepts(expected,False)
            for invalid in ({**expected,'ownedV3Thaw':True},{**expected,'sha':'c'*40},{**expected,'extra':True}):
                with self.assertRaises(ValueError):accepts(invalid)
            for failure in ('thaw','future','active'):
                with self.assertRaises(ValueError):run(failure)
            with self.assertRaises(TimeoutError):run('unknown')
            with self.assertRaises(ValueError):run(witness={})
            with self.assertRaises(ValueError):run(leader=[(db.CERTIFIED_PREDECESSOR[:8],INSTANCE,1),('a'*8,INSTANCE,1)])
            for field,value in [('runKey','123-1'),('targetSha','c'*40),('controlSha','c'*40),('status','unavailable'),('observedAt',ANN+120001)]:
                db.certified_refusal_file(args).write_text(json.dumps({**receipt,field:value}))
                with self.assertRaises(ValueError):run()
            db.certified_refusal_file(args).write_bytes(original)
            db.certified_request_file(directory,args.run_id).write_text(json.dumps(req))
            with self.assertRaises(ValueError):run()


if __name__=='__main__':unittest.main()
