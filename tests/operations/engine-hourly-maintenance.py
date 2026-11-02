#!/usr/bin/env python3
"""Canonical cycle/transaction admission in isolated Git/state; no host or network."""
from pathlib import Path
from argparse import Namespace
from contextlib import redirect_stdout, redirect_stderr
import importlib.util
import io
import copy
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('hourly_seal', ROOT/'server/scripts/engine-release-seal.py')
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)
IMAGE = 'sha256:'+'a'*64
AT = 1793489400  # 2026-10-31 23:30Z; real UTC hours retain Chicago DST identity.


class HourlyCycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hourly-cycle-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root/'repo'; self.repo.mkdir()
        empty = self.root/'empty.gitconfig'; empty.write_text('')
        self.env = {k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        self.env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=str(empty))
        # Canonical seal helpers and shell children inherit os.environ rather
        # than self.git's explicit env. A push hook's GIT_DIR otherwise makes
        # their `git -C fixture` commands inspect the pushing repository.
        environment = patch.dict(os.environ, self.env, clear=True)
        environment.start(); self.addCleanup(environment.stop)
        self.git('init','-q')
        self.git('-c','user.name=Cycle Fixture','-c','user.email=cycle@example.invalid','commit','--allow-empty','-qm','previous release')
        path = self.repo/seal.SCHEDULE_POLICY_PATH; path.parent.mkdir(parents=True)
        path.write_bytes((ROOT/seal.SCHEDULE_POLICY_PATH).read_bytes())
        self.git('add','.'); self.git('-c','user.name=Cycle Fixture','-c','user.email=cycle@example.invalid','commit','-qm','source policy')
        self.sha = self.git('rev-parse','HEAD')
        self.git('update-ref','refs/remotes/origin/main',self.sha)
        for name,value in {'STATE_DIR':self.root/'state','STATE_FILE':self.root/'state/seal.json',
                           'AUDIT_FILE':self.root/'state/audit.jsonl','RESULT_DIR':self.root/'state/results',
                           'LOCK_FILE':self.root/'state/lock'}.items():
            p = patch.object(seal,name,value); p.start(); self.addCleanup(p.stop)
        self.clock = patch.object(seal.time,'time',return_value=AT).start()
        self.addCleanup(patch.stopall)
        seal.ensure_dirs()
        seal.write_state({'schema':1,'generation':1,'desired':{'sha':self.sha,'imageId':IMAGE},
                          'highWaterSha':self.sha,'committedRuns':{},'pending':None,'finalization':None})

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.repo),*args],env=self.env,text=True).strip()

    def reserve(self,run='101-1'):
        out=io.StringIO()
        with redirect_stdout(out):
            seal.cmd_reserve_routine_cycle(Namespace(repo=str(self.repo),sha=self.sha,control_sha=self.sha,run_id=run))
        return json.loads(out.getvalue())

    def bind_window(self,c,delay_ms=0,reason='Scheduled Engine Maintenance'):
        stamp=(c['startsAt']-120)*1000+delay_ms
        starts=stamp+120000; ends=starts+300000
        phase='last_hand' if int(self.clock.return_value*1000)<starts else 'counting_down'
        h={'releaseSha':seal.load_state()['desired']['sha'],'running':True,'weeklyPayout':None,
           'maintenance':{'active':True,'durableConfirmed':True,'phase':phase,'reason':reason,
             'breakEndsAt':ends if phase=='counting_down' else None,
             'schedule':{'timeZone':'America/Chicago','frequency':'phase1-hourly','policyId':seal.SCHEDULE_POLICY_ID,
                         'startHour':None,'startMinute':0,'durationMs':300000,'hourlyCashFreeze':True},
             'presentation':{'active':True,'phase':phase,'reason':reason,'break_id':stamp,
                             'break_ends_at':ends,'scheduled_ends_at':ends}}}
        out=io.StringIO()
        with patch.object(seal.sys,'stdin',io.StringIO(json.dumps(h))), redirect_stdout(out):
            seal.cmd_bind_routine_window(Namespace(repo=str(self.repo),run_id=c['runId']))
        return json.loads(out.getvalue())

    def assert_refused(self,call):
        before=seal.STATE_FILE.read_bytes()
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): call()
        self.assertEqual(seal.STATE_FILE.read_bytes(),before)

    def test_global_cycle_rejects_other_runs_and_target_pushes(self):
        c=self.reserve(); self.assertEqual(c['startsAt']%3600,0)
        ordinary=Namespace(engine_lock_fd=9,run_id='102-1',sha=self.sha,control_sha=self.sha,invocation_id='b'*32)
        before=seal.STATE_FILE.read_bytes()
        with patch.object(seal,'require_engine_lock'),redirect_stdout(io.StringIO()) as untouched:
            seal.cmd_resolve_failed_routine(ordinary)
        self.assertEqual(untouched.getvalue().strip(),'not-needed');self.assertEqual(seal.STATE_FILE.read_bytes(),before)
        self.assert_refused(lambda:seal.cmd_check_routine_owner(Namespace(run_id='102-1')))
        self.assert_refused(lambda:self.reserve('102-1'))
        (self.repo/'new-source').write_text('new target same cycle')
        self.git('add','.'); self.git('-c','user.name=Cycle Fixture','-c','user.email=cycle@example.invalid','commit','-qm','next target')
        self.sha=self.git('rev-parse','HEAD'); self.git('update-ref','refs/remotes/origin/main',self.sha)
        self.assert_refused(lambda:self.reserve('103-1'))

    def test_replay_keeps_cycle_and_expiry_never_slides(self):
        c=self.reserve(); before=seal.STATE_FILE.read_bytes()
        self.clock.return_value=AT+60
        self.assertEqual(self.reserve(),c); self.assertEqual(seal.STATE_FILE.read_bytes(),before)
        self.clock.return_value=c['startsAt']+361
        self.assert_refused(self.reserve)
        self.assert_refused(lambda:self.reserve('102-1'))

    def test_restored_runtime_terminal_failure_does_not_release_cycle(self):
        c=self.reserve()
        result={'schema':1,'runId':'101-1','result':'failed','sha':self.sha,'controlSha':self.sha,
                'invocationId':'a'*32,'transactionExitStatus':1,'recoveredDesiredSha':self.sha,
                'recoveredDesiredImageId':IMAGE,'completedAt':AT}
        with seal.SealLock():
            state=seal.load_state(); seal.finish_routine_failure(state,'101-1',result)
        self.assertEqual(seal.load_state()['routineMaintenanceCycles'][str(c['startsAt'])]['status'],'reserved')
        self.clock.return_value=c['endsAt']+3600
        self.assert_refused(lambda:self.reserve('102-1')); self.assert_refused(self.reserve)

    def test_current_protected_completion_revokes_old_target(self):
        p=self.repo/seal.SCHEDULE_POLICY_PATH; doc=json.loads(p.read_text())
        doc.update(phase1Status='complete',completionEvidence='Verified Phase1 source evidence fixture')
        p.write_text(json.dumps(doc)); self.git('add','.')
        self.git('-c','user.name=Cycle Fixture','-c','user.email=cycle@example.invalid','commit','-qm','verified completion')
        self.git('update-ref','refs/remotes/origin/main',self.git('rev-parse','HEAD'))
        self.assert_refused(self.reserve)

    def test_birth_or_already_released_receipt_cannot_claim_cycle_success(self):
        c=self.reserve()
        state=seal.load_state(); state['routineMaintenanceCycles'][str(c['startsAt'])].update(status='sealed',result={'runId':'101-1','result':'already-released','sha':self.sha})
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): seal.routine_cycles(state)

    def test_prepare_same_sha_requires_current_cycle_without_weakening_token(self):
        c=self.reserve()
        args=Namespace(repo=str(self.repo),sha=self.sha,image=IMAGE,mode='deploy',run_id='101-1',
                       run_url='https://github.com/fixture/repo/actions/runs/101',actor='fixture',reason='Owner scheduled Phase1 cycle')
        with patch.object(seal,'image_identity',return_value=(IMAGE,self.sha,True)):
            self.assert_refused(lambda:seal.cmd_prepare(args))
            self.clock.return_value=c['startsAt']
            self.bind_window(c)
            out=io.StringIO()
            with redirect_stdout(out): seal.cmd_prepare(args)
            state=seal.load_state()
            self.assertEqual(state['pending']['sha'],self.sha)
            self.assertFalse(state['pending']['used'])
            self.assertEqual(state['routineMaintenanceCycles'][str(c['startsAt'])]['status'],'reserved')
            token=out.getvalue().strip()
            self.clock.return_value=c['endsAt']
            with patch.object(seal.sys,'stdin',io.StringIO(token)):
                self.assert_refused(lambda:seal.cmd_authorize(Namespace(image=IMAGE,token_stdin=True)))
            self.clock.return_value=c['startsAt']
            with patch.object(seal.sys,'stdin',io.StringIO(token)), redirect_stdout(io.StringIO()) as authorized:
                seal.cmd_authorize(Namespace(image=IMAGE,token_stdin=True))
            self.assertTrue(authorized.getvalue().startswith('pending '), 'same-SHA cutover must consume the prepared candidate token')
            self.assertTrue(seal.load_state()['pending']['used'])

    def test_canonical_commit_and_full_result_alone_seal_the_cycle(self):
        c=self.reserve(); self.clock.return_value=c['startsAt']
        self.bind_window(c)
        meta=dict(repo=str(self.repo),sha=self.sha,image=IMAGE,mode='deploy',run_id='101-1',
                  run_url='https://github.com/fixture/repo/actions/runs/101',actor='fixture',reason='Owner scheduled Phase1 cycle')
        with patch.object(seal,'image_identity',return_value=(IMAGE,self.sha,True)), \
             patch.object(seal,'container_identity',return_value=('running',IMAGE)), \
             patch.object(seal,'require_horse_journal_runtime'):
            out=io.StringIO()
            with redirect_stdout(out): seal.cmd_prepare(Namespace(**meta))
            token=out.getvalue().strip()
            with patch.object(seal.sys,'stdin',io.StringIO(token)), redirect_stdout(io.StringIO()):
                seal.cmd_authorize(Namespace(image=IMAGE,token_stdin=True))
            # One-use remains real for the identical desired image.
            with patch.object(seal.sys,'stdin',io.StringIO(token)):
                self.assert_refused(lambda:seal.cmd_authorize(Namespace(image=IMAGE,token_stdin=True)))
            identity=dict(container='fixture',container_id='a'*64,started_at='2026-11-01T00:00:01Z')
            with redirect_stdout(io.StringIO()): seal.cmd_commit(Namespace(**meta,**identity))
            self.assertEqual(seal.load_state()['routineMaintenanceCycles'][str(c['startsAt'])]['status'],'committed')
            self.assert_refused(lambda:self.reserve('102-1'))
            result=Namespace(sha=self.sha,image_id=IMAGE,run_id='101-1',control_sha=self.sha,
                             result='sealed',instance_id='1-abcdef12',invocation_id='a'*32,
                             recover_orphan_finalization_fd=None,**{k:v for k,v in identity.items() if k!='container'})
            with redirect_stdout(io.StringIO()): seal.cmd_record_result(result)
            self.assertEqual(seal.routine_cycles(seal.load_state())[str(c['startsAt'])]['status'],'sealed')
            self.clock.return_value=c['endsAt']+1
            next_cycle=self.reserve('102-1')
            self.assertGreater(next_cycle['startsAt'],c['startsAt'])
            self.assertEqual(self.reserve()['status'],'sealed')

    def restoration_case(self, status):
        old=self.sha
        path=self.repo/seal.SCHEDULE_POLICY_PATH; doc=json.loads(path.read_text())
        doc.update(phase1Status=status,completionEvidence='Verified Phase1 completion source evidence fixture')
        path.write_text(json.dumps(doc)); self.git('add','.')
        self.git('-c','user.name=Cycle Fixture','-c','user.email=cycle@example.invalid','commit','-qm','verified daily restoration')
        self.sha=self.git('rev-parse','HEAD'); self.git('update-ref','refs/remotes/origin/main',self.sha)
        actual={'releaseSha':old,'running':True,'maintenance':{'schedule':{'timeZone':'America/Chicago',
            'frequency':'phase1-hourly','policyId':seal.SCHEDULE_POLICY_ID,'startHour':None,
            'startMinute':0,'durationMs':300000,'hourlyCashFreeze':True}}}
        with patch.object(seal.sys,'stdin',io.StringIO(json.dumps(actual))), redirect_stdout(io.StringIO()):
            seal.cmd_restoration_needed(Namespace(repo=str(self.repo),sha=self.sha))
        c=self.reserve(); self.assertEqual(c['kind'],'daily-restoration')
        self.clock.return_value=c['startsAt']
        self.bind_window(c)
        meta=dict(repo=str(self.repo),sha=self.sha,image=IMAGE,mode='deploy',run_id='101-1',
                  run_url='https://github.com/fixture/repo/actions/runs/101',actor='fixture',reason='Verified Phase1 daily restoration')
        with patch.object(seal,'image_identity',return_value=(IMAGE,self.sha,True)), \
             patch.object(seal,'container_identity',return_value=('running',IMAGE)), \
             patch.object(seal,'require_horse_journal_runtime'):
            out=io.StringIO()
            with redirect_stdout(out): seal.cmd_prepare(Namespace(**meta))
            with patch.object(seal.sys,'stdin',io.StringIO(out.getvalue())), redirect_stdout(io.StringIO()):
                seal.cmd_authorize(Namespace(image=IMAGE,token_stdin=True))
            identity=dict(container='fixture',container_id='a'*64,started_at='2026-11-01T00:00:01Z')
            with redirect_stdout(io.StringIO()): seal.cmd_commit(Namespace(**meta,**identity))
            with redirect_stdout(io.StringIO()):
                seal.cmd_record_result(Namespace(sha=self.sha,image_id=IMAGE,run_id='101-1',control_sha=self.sha,
                    result='sealed',instance_id='1-abcdef12',invocation_id='a'*32,recover_orphan_finalization_fd=None,
                    **{k:v for k,v in identity.items() if k!='container'}))
        self.clock.return_value=c['endsAt']+3600
        self.assertEqual(self.reserve('102-1'),{'status':'daily'})
        self.assertEqual(len(seal.load_state()['routineMaintenanceCycles']),1)
        actual['releaseSha']=self.sha; actual['maintenance']['schedule'].update(frequency='daily',startHour=4,hourlyCashFreeze=False)
        with patch.object(seal.sys,'stdin',io.StringIO(json.dumps(actual))), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            seal.cmd_restoration_needed(Namespace(repo=str(self.repo),sha=self.sha))

    def test_verified_completion_restores_daily_once(self):
        self.restoration_case('complete')

    def test_explicit_off_restores_daily_once(self):
        self.restoration_case('off')

    def test_first_adoption_uses_fixed58_and_existing_one_hour_ledger(self):
        state=seal.load_state(); old=self.git('rev-parse','HEAD^')
        state['desired']['sha']=old; state['highWaterSha']=old; seal.write_state(state)
        c=self.reserve(); self.clock.return_value=c['startsAt']-119
        args=Namespace(repo=str(self.repo),sha=self.sha,control_sha=self.sha,run_id='101-1',
                       cause='urgent',scheduled_cycle_start=c['startsAt'],include_eligibility=True)
        out=io.StringIO()
        with redirect_stdout(out): seal.cmd_reserve_recovery_window(args)
        self.assertEqual(int(out.getvalue()),(c['startsAt']-119)*1000)
        path=seal.STATE_DIR/'engine-recovery-window-101-1.json'
        before=path.read_bytes()
        self.clock.return_value=c['startsAt']-60
        out=io.StringIO()
        with redirect_stdout(out): seal.cmd_reserve_recovery_window(args)
        self.assertEqual(out.getvalue().strip(),'unavailable')
        self.assertEqual(path.read_bytes(),before)
        # An unrelated recent canonical reservation still blocks announcement.
        self.clock.return_value=c['startsAt']-118
        path.unlink()
        (seal.STATE_DIR/'engine-recovery-window-99-1.json').write_text(json.dumps({'announcedAt':(c['startsAt']-1800)*1000}))
        out=io.StringIO()
        with redirect_stdout(out): seal.cmd_reserve_recovery_window(args)
        self.assertTrue(out.getvalue().startswith('rate-limited:'))
        self.assertFalse(path.exists())

    def test_actual_notice_keeps_full_lead_and_cannot_slide(self):
        c=self.reserve(); self.clock.return_value=c['startsAt']-120+0.025
        bound=self.bind_window(c,25); w=bound['window']
        self.assertEqual(w['announcedAt'],(c['startsAt']-120)*1000+25)
        self.assertEqual(w['startsAt']-w['announcedAt'],120000)
        self.assertEqual(w['endsAt']-w['startsAt'],300000)
        self.clock.return_value+=1
        self.assert_refused(lambda:self.bind_window(c,1000))

    def test_notice_too_late_for00minute_is_refused(self):
        c=self.reserve(); self.clock.return_value=c['startsAt']-59
        self.assert_refused(lambda:self.bind_window(c,61000))

    def custody_refusal(self, health):
        import shlex
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        init=source[source.index('# Temporary hourly authority'):source.index('seconds_to_next_break() {')]
        census=source[source.index('legacy_census_fits() {'):source.index('# The database half of a drained hand boundary')]
        marker=self.root/'cycle-mutated'
        shim=self.root/'seal-shim'
        shim.write_text('#!/usr/bin/env bash\ncase "$1" in\ncheck-routine-owner) echo none;;\nget) echo eed06fe51dea622069c661a6213d5b031ff3a9e3;;\nschedule-policy) cat '+shlex.quote(str(ROOT/seal.SCHEDULE_POLICY_PATH))+';;\nreserve-routine-cycle) touch '+shlex.quote(str(marker))+'; exit 99;;\n*) exit 98;;\nesac\n')
        shim.chmod(0o700)
        script='set -euo pipefail\n'+init+census+f"""
LOCK_HELD=1; RUN_ID=101-1; SHA={self.sha}; CONTROL_SHA={self.sha}; REPO_DIR={shlex.quote(str(self.repo))}
RELEASE_SEAL={shlex.quote(str(shim))}
CHECKPOINT_EED_SHA=eed06fe51dea622069c661a6213d5b031ff3a9e3
LEGACY_CENSUS_MS_PER_HEAP_MB=12; LEGACY_CENSUS_ALLOWANCE_MS=30300
legacy_entry_read() {{ "$@"; }}
timeout() {{ shift 3; "$@"; }}
newer_release_in_flight() {{ return 1; }}
die() {{ printf '%s\\n' "$*" >&2; exit 1; }}
curl() {{ printf '%s\\n200' {shlex.quote(json.dumps(health))}; }}
initialise_phase1_cycle
"""
        r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=5,env=self.env)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('full retained-owner checkpoint',r.stderr)
        self.assertFalse(marker.exists(),'cycle state mutated before false/unknown custody admission')

    def test_eed_false_fit_refuses_before_cycle_mutation(self):
        self.custody_refusal({'releaseSha':'eed06fe51dea622069c661a6213d5b031ff3a9e3','memory':{'heapUsedMb':4000}})

    def test_eed_unknown_fit_refuses_before_cycle_mutation(self):
        self.custody_refusal({'releaseSha':'eed06fe51dea622069c661a6213d5b031ff3a9e3','memory':{}})

    def test_late_fit_loss_cannot_switch_to_unqualified_drained_route(self):
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        begin=source.index('switch_to_drained_predecessor_cutover() {')
        fn=source[begin:source.index('\nif [',begin)]
        script='set -euo pipefail\n'+fn+"\nPHASE1_POLICY_OWNED=1; LEGACY_CHECKPOINT_REQUIRED=1; DRAINED_PREDECESSOR_CUTOVER=0; die() { echo REFUSED; exit 1; }; switch_to_drained_predecessor_cutover; echo UNSAFE\n"
        r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=5)
        self.assertEqual(r.returncode,1); self.assertEqual(r.stdout.strip(),'REFUSED')

    def test_actual_shell_coordinator_preserves_same_sha_noop_off_policy(self):
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        functions=source[source.index('# Temporary hourly authority'):source.index('seconds_to_next_break() {')]
        script='set -euo pipefail\n'+functions+'''\nLOCK_HELD=1
phase1_reset_required && exit 19
printf 'NOOP\n'
'''
        r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=5)
        self.assertEqual(r.returncode,0,r.stderr); self.assertEqual(r.stdout.strip(),'NOOP')


    def failed_owner_fixture(self):
        failure={'schema':1,'runId':seal.FAILED_ROUTINE_RUN,'result':'failed',
            'sha':seal.FAILED_ROUTINE_SHA,'controlSha':seal.FAILED_ROUTINE_SHA,
            'invocationId':'a'*32,'transactionExitStatus':1,'recoveredDesiredSha':seal.FAILED_ROUTINE_DESIRED,
            'recoveredDesiredImageId':seal.FAILED_ROUTINE_IMAGE,'completedAt':seal.FAILED_ROUTINE_COMPLETED}
        self.fixture_digest=seal.failed_routine_digest(failure)
        p=patch.object(seal,'FAILED_ROUTINE_DIGEST',self.fixture_digest);p.start();self.addCleanup(p.stop)
        cycle={'kind':'hourly-reset','policyId':seal.SCHEDULE_POLICY_ID,
            'policyDigest':'203626ce907eed185e27fac659cc391b16d6b5814fe446b4c0257207d2ba0578',
            'startsAt':seal.FAILED_ROUTINE_START,'endsAt':seal.FAILED_ROUTINE_START+300,
            'runId':seal.FAILED_ROUTINE_RUN,'sha':seal.FAILED_ROUTINE_SHA,'controlSha':seal.FAILED_ROUTINE_SHA,
            'status':'reserved','failure':failure}
        state=seal.load_state();state.update(desired={'sha':seal.FAILED_ROUTINE_DESIRED,'imageId':seal.FAILED_ROUTINE_IMAGE},
            highWaterSha=seal.FAILED_ROUTINE_DESIRED,routineMaintenanceCycles={str(seal.FAILED_ROUTINE_START):cycle})
        seal.write_state(state);seal.write_json_atomic(seal.result_path(seal.FAILED_ROUTINE_RUN),failure)
        self.clock.return_value=seal.FAILED_ROUTINE_START+4000
        self.resolver_args=Namespace(engine_lock_fd=9,run_id='202-1',sha=self.sha,control_sha=self.sha,invocation_id='b'*32)
        self.proof_patches={}
        for name,value in {
            'require_engine_lock':None,'failed_routine_current':{'requestDigest':'c'*64,'unit':{'InvocationID':'b'*32}},
            'failed_routine_source_proof':dict(seal.FAILED_ROUTINE_SOURCES),
            'failed_routine_history':{'journalDigest':'d'*64,'atMicros':seal.FAILED_ROUTINE_COMPLETED*1000000},
            'failed_routine_native_proof':{'exact-old-unit':'inactive-empty'},
            'failed_routine_runtime':{'containerId':'e'*64,'startedAt':'2026-11-01T22:00:00Z','instanceId':'1-abcdef12'},
            'failed_routine_database':None}.items():
            p=patch.object(seal,name,return_value=value);self.proof_patches[name]=p.start();self.addCleanup(p.stop)
        # The production helper requires root-owned real files. This fixture's
        # private directory is user-owned; keep its actual bytes/CAS and isolate
        # only the ownership boundary, never the resolution transition.
        p=patch.object(seal,'failed_routine_bytes',side_effect=lambda path,limit=65536:Path(path).read_bytes())
        p.start();self.addCleanup(p.stop)
        p=patch.object(seal.os,'geteuid',return_value=0);p.start();self.addCleanup(p.stop)
        return copy.deepcopy(cycle),copy.deepcopy(failure)

    def resolve_failed_owner(self):
        with redirect_stdout(io.StringIO()):seal.cmd_resolve_failed_routine(self.resolver_args)

    def test_exact_failed_custody_resolution_preserves_failure_and_consumed_cycle(self):
        cycle,failure=self.failed_owner_fixture();before=seal.load_state()
        self.resolve_failed_owner();state=seal.load_state()
        self.assertEqual(state['routineMaintenanceCycles'],before['routineMaintenanceCycles'])
        self.assertEqual(seal.load_failure(seal.FAILED_ROUTINE_RUN),failure)
        self.assertEqual(state['desired'],before['desired']);self.assertEqual(state['generation'],before['generation'])
        self.assertEqual(state['committedRuns'],{});self.assertEqual(state['highWaterSha'],before['highWaterSha'])
        self.assertFalse(seal.routine_owner_unresolved(state,cycle))
        self.assert_refused(lambda:seal.cmd_reserve_routine_cycle(Namespace(repo=str(self.repo),
            sha=seal.FAILED_ROUTINE_SHA,control_sha=seal.FAILED_ROUTINE_SHA,run_id=seal.FAILED_ROUTINE_RUN)))
        with patch.object(seal,'image_identity',return_value=(seal.FAILED_ROUTINE_IMAGE,seal.FAILED_ROUTINE_SHA,True)):
            self.assert_refused(lambda:seal.cmd_prepare(Namespace(repo=str(self.repo),sha=seal.FAILED_ROUTINE_SHA,
                image=seal.FAILED_ROUTINE_IMAGE,mode='deploy',run_id='204-1',
                run_url='https://github.com/fixture/repo/actions/runs/204',actor='fixture',reason='No failed-source replay')))
        state=seal.load_state()
        self.assert_refused(lambda:seal.finish_routine_failure(state,seal.FAILED_ROUTINE_RUN,{**failure,'invocationId':'d'*32}))
        # The occupied old hour cannot become another reset. A later distinct
        # cycle still needs the ordinary source-policy reserve path.
        current=self.reserve('203-1');self.assertGreater(current['startsAt'],seal.FAILED_ROUTINE_START)
        self.assertEqual(seal.load_state()['routineMaintenanceCycles'][str(seal.FAILED_ROUTINE_START)],cycle)

    def test_failed_custody_requires_every_fresh_proof_and_actual_lock(self):
        self.failed_owner_fixture()
        for name,call in self.proof_patches.items():
            with self.subTest(name=name):
                call.side_effect=lambda *a,**k:seal.die('fixture refused or unknown')
                self.assert_refused(self.resolve_failed_owner)
                self.assertNotIn('routineFailureResolutions',seal.load_state())
                call.side_effect=None

    def test_failed_custody_refuses_changed_authority_before_compare_and_swap(self):
        self.failed_owner_fixture()
        for field,value in [('pending',{'fixture':'unknown'}),('finalization',{'fixture':'unknown'})]:
            with self.subTest(field=field):
                before=seal.STATE_FILE.read_bytes();state=json.loads(before);state[field]=value;seal.write_state(state)
                self.assert_refused(self.resolve_failed_owner);seal.STATE_FILE.write_bytes(before)
        runtime=self.proof_patches['failed_routine_runtime']
        runtime.side_effect=[{'instanceId':'1-abcdef12'},{'instanceId':'1-deadbeef'}]
        self.assert_refused(self.resolve_failed_owner)
        self.assertFalse(list(seal.RESULT_DIR.glob('*.custody-resolution.json')))

    def test_failed_custody_receipt_and_audit_crashes_resume_without_replaying_old_run(self):
        cycle,_=self.failed_owner_fixture();original=seal.STATE_FILE.read_bytes()
        with patch.object(seal,'audit_once',side_effect=OSError('fixture interrupted before audit')):
            with self.assertRaises(OSError):self.resolve_failed_owner()
        self.assertEqual(seal.STATE_FILE.read_bytes(),original)
        self.assertEqual(len(list(seal.RESULT_DIR.glob('*.custody-resolution.json'))),1)
        with patch.object(seal,'write_state',side_effect=OSError('fixture interrupted before seal replace')):
            with self.assertRaises(OSError):self.resolve_failed_owner()
        self.assertEqual(seal.STATE_FILE.read_bytes(),original)
        # A boot/new native invocation has a new immutable witness and audit
        # identity; the interrupted first audit must not block it forever.
        self.resolver_args.invocation_id='c'*32
        self.proof_patches['failed_routine_current'].return_value={'requestDigest':'c'*64,'unit':{'InvocationID':'c'*32}}
        self.resolve_failed_owner();after=seal.STATE_FILE.read_bytes();audit=seal.AUDIT_FILE.read_bytes()
        self.assertEqual(len(list(seal.RESULT_DIR.glob('*.custody-resolution.json'))),2)
        self.resolve_failed_owner()
        self.assertEqual(seal.STATE_FILE.read_bytes(),after);self.assertEqual(seal.AUDIT_FILE.read_bytes(),audit)
        self.assertEqual(seal.routine_cycles(seal.load_state())[str(seal.FAILED_ROUTINE_START)],cycle)

    def test_failed_custody_resolution_tamper_never_clears_global_owner(self):
        cycle,_=self.failed_owner_fixture();self.resolve_failed_owner();good=seal.STATE_FILE.read_bytes()
        for field,value in [('result','sealed'),('failureDigest','0'*64),('originalCycle',{}),('verifiedByRunId',seal.FAILED_ROUTINE_RUN)]:
            with self.subTest(field=field):
                state=json.loads(good);state['routineFailureResolutions'][seal.FAILED_ROUTINE_RUN][field]=value
                seal.write_state(state)
                with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):seal.routine_cycles(seal.load_state())
        seal.STATE_FILE.write_bytes(good)
        receipt=next(seal.RESULT_DIR.glob('*.custody-resolution.json'));receipt.write_text('{}')
        with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):seal.routine_owner_unresolved(seal.load_state(),cycle)

    def test_failed_custody_exact_journal_and_native_process_unknowns_refuse(self):
        failure={'invocationId':'a'*32,'completedAt':seal.FAILED_ROUTINE_COMPLETED}
        digest=seal.failed_routine_digest(failure)
        row={'MESSAGE':seal.FAILED_ROUTINE_LITERAL,'_SYSTEMD_UNIT':f'club-arena-engine-release-v1@{seal.FAILED_ROUTINE_RUN}.service',
             '_SYSTEMD_INVOCATION_ID':'a'*32,'__REALTIME_TIMESTAMP':str(seal.FAILED_ROUTINE_COMPLETED*1000000)}
        with patch.object(seal,'FAILED_ROUTINE_DIGEST',digest),patch.object(seal,'failed_routine_command',return_value=json.dumps(row)) as command:
            first=seal.failed_routine_history(failure,seal.time.monotonic()+10)
            self.assertEqual(first['atMicros'],seal.FAILED_ROUTINE_COMPLETED*1000000)
            reordered=json.dumps(dict(reversed(list(row.items()))))
            self.assertNotEqual(seal.hashlib.sha256(json.dumps(row).encode()).hexdigest(),seal.hashlib.sha256(reordered.encode()).hexdigest())
            command.return_value=reordered
            self.assertEqual(seal.failed_routine_history(failure,seal.time.monotonic()+10),first)
            self.assertEqual(first['journalDigest'],seal.failed_routine_digest(row))
            for bad in [[],[row,row],[{**row,'MESSAGE':'different'}],[{**row,'_SYSTEMD_INVOCATION_ID':'b'*32}],
                        [{**row,'__REALTIME_TIMESTAMP':str((seal.FAILED_ROUTINE_START-120)*1000000)}]]:
                command.return_value='\n'.join(json.dumps(v) for v in bad)
                with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):seal.failed_routine_history(failure,seal.time.monotonic()+10)
        source=(ROOT/'server/scripts/engine-release-transaction.sh').read_text()
        start=source.index("acquire_engine_lock 'duplicate certification'")
        self.assertLess(source.index('resolve-failed-routine',start),source.index('check-routine-owner',start))
        self.assertIn('--engine-lock-fd 9',source[start:source.index('check-routine-owner',start)])
        self.assertLess(source.index('resolve-failed-routine',start),source.index('resolve-terminal-routine-failures',start))
        self.assertLess(source.index('resolve-terminal-routine-failures',start),source.index('check-routine-owner',start))
        self.assertEqual(seal.FAILED_ROUTINE_SOURCES['engine-release-transaction.sh'],
            '3b3c60aef43e521d886a6de04b0e9022e66fc66d6af5822f2b56af0a11214c39')
        def native(command,deadline,limit=32768):
            if command[0]=='busctl':
                if 'GetUnit' in command:
                    selected_unit[0]=command[-1];return 'o /org/freedesktop/systemd1/unit/fixture'
                if 'get-property' in command:return 's '+json.dumps(selected_unit[0])
                return 'a(sus) 0'
            unit=command[2];extension=unit.rsplit('.',1)[1];prefix='release' if '-release-' in unit else 'intake'
            values={'LoadState':'loaded','ActiveState':'inactive','SubState':'dead','UnitFileState':'disabled',
                'Job':'','FragmentPath':f'/etc/systemd/system/club-arena-engine-{prefix}-v1@.{extension}','DropInPaths':''}
            if extension=='service':values.update(MainPID='0',ControlPID='0',ControlGroup='',Slice='system-'+unit.split('@',1)[0].replace('-',r'\x2d')+'.slice')
            return '\n'.join(k+'='+v for k,v in values.items())
        selected_unit=[None]
        with patch.object(seal,'failed_routine_command',side_effect=native),patch.object(seal,'require_absent'):
            self.assertEqual(len(seal.failed_routine_native_proof(seal.time.monotonic()+10)),3)
        for reply in ['a(sus) 1 "/system.slice/private" 42 "private"','a(sus) 0 unexpected','', 'unavailable']:
            def unproved(command,deadline,limit=32768):return reply if 'GetUnitProcesses' in command else native(command,deadline,limit)
            with patch.object(seal,'failed_routine_command',side_effect=unproved),patch.object(seal,'require_absent'),redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                seal.failed_routine_native_proof(seal.time.monotonic()+10)
        self.assertEqual(seal.failed_routine_command(['python3','-c','print("bounded")'],seal.time.monotonic()+2,16),'bounded')
        for command,deadline,limit in [(['python3','-c','print("x"*17)'],seal.time.monotonic()+2,16),
                (['python3','-c','import time;time.sleep(1)'],seal.time.monotonic()+.05,16),
                (['python3','-c','import sys;sys.stderr.write("x"*8193)'],seal.time.monotonic()+2,16)]:
            with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):seal.failed_routine_command(command,deadline,limit)

    def test_failed_custody_database_proof_is_finite_get_only_and_refuses_unknown(self):
        spec=importlib.util.spec_from_file_location('failed_routine_database',ROOT/'server/scripts/engine-release-database-proof.py')
        db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
        class Response:
            def __init__(self,raw):self.raw=raw
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,limit):return self.raw[:limit]
        class Opener:
            def __init__(self,raw):self.raw=raw;self.requests=[]
            def open(self,request,timeout):
                self.requests.append((request,timeout));return Response(self.raw)
        for raw,allowed in [(b'[]',True),(b'null',False),(b'{}',False),(b'[{"id":true}]',False),(b' '*4097,False)]:
            opener=Opener(raw)
            with patch.object(db,'read_leader',return_value=('eed06fe5','1-abcdef12',2)),patch.object(db,'build_opener',return_value=opener):
                if allowed:db.verify_failed_routine_idle('https://'+db.PROJECT_HOST,'fixture-key','1-abcdef12',15)
                else:
                    with self.assertRaises(ValueError):db.verify_failed_routine_idle('https://'+db.PROJECT_HOST,'fixture-key','1-abcdef12',15)
            self.assertEqual(len(opener.requests),1);request,timeout=opener.requests[0]
            self.assertEqual(request.get_method(),'GET');self.assertEqual(timeout,1.5)
            self.assertIn('/rest/v1/engine_maintenance_break?',request.full_url)
        with patch.object(db,'read_leader',return_value=('eed06fe5','1-other',2)),patch.object(db,'build_opener') as network,self.assertRaises(ValueError):
            db.verify_failed_routine_idle('https://'+db.PROJECT_HOST,'fixture-key','1-abcdef12',15)
        network.assert_not_called()

    def test_unloaded_failed_custody_requires_positive_manager_kernel_and_metadata_proofs(self):
        unit=f'club-arena-engine-intake-v1@{seal.FAILED_ROUTINE_RUN}.service'
        context={'MainPID':'0','ControlPID':'0','ControlGroup':'',
                 'Slice':r'system-club\x2darena\x2dengine\x2dintake\x2dv1.slice'}
        group='/system.slice/'+context['Slice']+'/'+unit
        no_unit=seal.FailedRoutineProcessLookup(1,b'',('Call failed: Unit '+unit+' not loaded.').encode())
        def command(args,deadline,limit=32768):
            if 'GetUnit' in args:raise no_unit
            if 'ListUnitsByPatterns' in args:return 'a(ssssssouso) 0'
            if '-.slice' in args:return 'ControlGroup=/'
            raise AssertionError(args)
        with patch.object(seal,'failed_routine_command',side_effect=command) as native, \
             patch.object(seal,'failed_routine_unit_snapshot',return_value=context), \
             patch.object(seal,'failed_routine_cgroup_empty',return_value='absent') as kernel:
            self.assertEqual(seal.failed_routine_service_empty(unit,context,seal.time.monotonic()+10),'unloaded-manager-cgroup-empty')
            kernel.assert_called_once();self.assertEqual(kernel.call_args.args[0],group)
            self.assertEqual(sum('ListUnitsByPatterns' in call.args[0] for call in native.call_args_list),2)
        for stderr in [b'Call failed: Access denied',b'',b'Call failed: Connection refused']:
            with patch.object(seal,'failed_routine_command',side_effect=seal.FailedRoutineProcessLookup(1,b'',stderr)), \
                 patch.object(seal,'failed_routine_cgroup_empty') as kernel,redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                seal.failed_routine_service_empty(unit,context,seal.time.monotonic()+10)
            kernel.assert_not_called()
        for field,value in [('Slice','system-foreign.slice'),('ControlGroup','/system.slice/foreign'),('MainPID','22'),('ControlPID','22')]:
            with self.subTest(field=field),patch.object(seal,'failed_routine_command',side_effect=command), \
                 patch.object(seal,'failed_routine_unit_snapshot',return_value=context),redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                seal.failed_routine_service_empty(unit,{**context,field:value},seal.time.monotonic()+10)
        for reply in ['', 'a(ssssssouso) 1', 'as 0', 'a(ssssssouso) 0 unexpected']:
            def malformed(args,deadline,limit=32768):return reply if 'ListUnitsByPatterns' in args else command(args,deadline,limit)
            with patch.object(seal,'failed_routine_command',side_effect=malformed),redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                seal.failed_routine_service_empty(unit,context,seal.time.monotonic()+10)
        with patch.object(seal,'failed_routine_command',side_effect=command), \
             patch.object(seal,'failed_routine_cgroup_empty',return_value='populated-zero'), \
             patch.object(seal,'failed_routine_unit_snapshot',return_value={**context,'ControlPID':'1'}), \
             redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
            seal.failed_routine_service_empty(unit,context,seal.time.monotonic()+10)

    def test_failed_custody_kernel_reader_does_not_turn_permissions_or_missing_events_into_absence(self):
        group='/system.slice/system-fixture.slice/fixture@1.service'
        directory=Namespace(st_uid=0,st_mode=seal.stat.S_IFDIR|0o755)
        regular=Namespace(st_uid=0,st_mode=seal.stat.S_IFREG|0o644)
        def info(fd):return regular if fd==14 else directory
        def read_with(opens,raw=b'populated 0\nfrozen 0\n',metadata=info):
            with patch.object(seal.os,'open',side_effect=opens),patch.object(seal.os,'fstat',side_effect=metadata), \
                 patch.object(seal.os,'read',return_value=raw),patch.object(seal.os,'close'):
                return seal.failed_routine_cgroup_empty(group,seal.time.monotonic()+10)
        self.assertEqual(read_with([10,11,12,13,14]),'populated-zero')
        self.assertEqual(read_with([10,11,12,FileNotFoundError(seal.errno.ENOENT,'gone')]),'absent')
        for failure in [PermissionError(seal.errno.EACCES,'unreadable'),OSError(seal.errno.ELOOP,'symlink'),
                        OSError(seal.errno.ENOTDIR,'not directory'),FileNotFoundError('unknown errno')]:
            with self.subTest(failure=type(failure).__name__),redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                read_with([10,11,12,failure])
        with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
            read_with([10,11,12,13,FileNotFoundError(seal.errno.ENOENT,'missing events')])
        for raw in [b'populated 1\n',b'populated 0\npopulated 0\n',b'populated 0 extra\n',b'',b'x'*1025]:
            with self.subTest(raw=raw[:32]),redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):read_with([10,11,12,13,14],raw)
        for metadata in [lambda fd:Namespace(st_uid=1,st_mode=seal.stat.S_IFDIR|0o755),
                         lambda fd:Namespace(st_uid=0,st_mode=seal.stat.S_IFDIR|0o777)]:
            with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):read_with([10,11,12,13,14],metadata=metadata)
        workflow=(ROOT/'.github/workflows/engine-build-resource-proof.yml').read_text()
        self.assertIn('tests/operations/failed-routine-custody-systemd-fixture.py --require-linux',workflow)
        fixture=(ROOT/'tests/operations/failed-routine-custody-systemd-fixture.py').read_text()
        self.assertIn("route == 'unloaded-manager-cgroup-empty'",fixture)
        self.assertIn('genuine_lookup_refusal(unit)',fixture)
        spec=importlib.util.spec_from_file_location('failed_routine_cleanup',ROOT/'tests/operations/failed-routine-custody-systemd-fixture.py')
        native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
        fixture_unit='failed-routine-fixture.slice';fixture_group=Path('/sys/fs/cgroup/system.slice')/fixture_unit
        with patch.object(native,'fixture_manager_row',return_value=None) as manager, \
             patch.object(native,'owned_group_state',return_value='absent'),patch.object(native,'run') as stop:
            self.assertEqual(native.retire_fixture_unit(fixture_unit,fixture_group,(fixture_group,),(fixture_unit,)),'already-absent')
            self.assertEqual(manager.call_count,2);stop.assert_not_called()
        with patch.object(native,'fixture_manager_row',side_effect=PermissionError('unknown manager')), \
             patch.object(native,'owned_group_state',return_value='absent'),patch.object(native,'run') as stop,self.assertRaises(PermissionError):
            native.retire_fixture_unit(fixture_unit,fixture_group,(fixture_group,),(fixture_unit,))
        stop.assert_not_called()
        with patch.object(native,'fixture_manager_row',return_value={'activeState':'active','subState':'active'}), \
             patch.object(native,'owned_group_state',return_value='empty'), \
             patch.object(native,'run',side_effect=subprocess.CalledProcessError(1,['systemctl','stop',fixture_unit])),self.assertRaises(subprocess.CalledProcessError):
            native.retire_fixture_unit(fixture_unit,fixture_group,(fixture_group,),(fixture_unit,))


if __name__ == '__main__':
    unittest.main()
