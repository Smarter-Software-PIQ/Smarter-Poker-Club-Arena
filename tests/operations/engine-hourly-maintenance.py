#!/usr/bin/env python3
"""Canonical cycle/transaction admission in isolated Git/state; no host or network."""
from pathlib import Path
from argparse import Namespace
from contextlib import redirect_stdout, redirect_stderr
import importlib.util
import io
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


if __name__ == '__main__':
    unittest.main()
