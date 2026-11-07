#!/usr/bin/env python3
"""Real shell recovery with isolated Docker/filesystem transport fixtures."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR = (ROOT / 'server/scripts/engine-supervisor.sh').read_text()
UP = (ROOT / 'server/scripts/engine-up.sh').read_text()
EED = 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
IMAGE = 'sha256:' + 'b' * 64
RUN = '41999999999-1'
TARGET = 'a' * 40
CONTROL = 'c' * 40


class CertifiedRecovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='certified-retirement-')
        self.root = Path(self.tmp.name).resolve()
        self.bin = self.root / 'bin'
        self.control = self.root / 'control'
        self.requests = self.root / 'requests'
        for p in (self.bin, self.control, self.requests): p.mkdir()
        self.current = {'containerId': 'd' * 64, 'containerImageId': IMAGE,
                        'containerStartedAt': '2026-11-04T21:47:22.096979074Z',
                        'hostPid': 3018650, 'running': True}
        profile = {'id': 'eed-240s-certified-release-v1', 'noticeMs': 120000,
                   'freezeMs': 780000, 'nativeQueryMs': 240000,
                   'checkpointMs': 320000, 'postReserveMs': 205000}
        self.proof = {'schema': 'engine-certified-recovery/v1',
                      'policyId': '2026-11-04-tournament-fourfold-certified-recovery',
                      'profile': profile, 'releaseAt': '2026-11-05T00:15:00.000Z'}
        self.proof['request'] = {'runKey': RUN, 'targetSha': TARGET, 'controlSha': CONTROL,
            'predecessorSha': EED, 'instanceId': '1-5835d418', 'announcedAt': '2026-11-05T00:00:00.000Z',
            'ownershipToken': '35b5aa56-2bc6-45ec-9991-2f5eb2e96a27', 'policyId': self.proof['policyId']}
        self.intent = {'source': EED, 'instance': '1-5835d418', 'container': self.current['containerId'],
            'containerImageId': IMAGE, 'startedAt': self.current['containerStartedAt'],
            'hostPid': self.current['hostPid'], 'runId': RUN, 'controlSha': CONTROL,
            'nativeCensus': {'candidateSHA': TARGET}, 'certifiedRecovery': self.proof}
        self.marker = {'schema': 'legacy-certified-retirement/v1', 'profile': profile['id'],
            'runId': RUN, 'controlSha': CONTROL, 'targetSha': TARGET, 'sourceSha': EED,
            'instanceId': self.intent['instance'], **{k: v for k, v in self.current.items() if k != 'running'},
            'pid': 1, 'nativeStartTicks': '157263255', 'announcedAt': 1793836800000,
            'ownershipToken': self.proof['request']['ownershipToken'], 'releaseAt': 1793837700000,
            'stage': 'custody_complete_stop_entering', 'attemptedTables': 109, 'verifiedTables': 109,
            'finalCensusZero': True, 'maintenanceGeneration': 5, 'resumeToken': 2}
        self.private(self.requests / (RUN + '.request'), '\n'.join([TARGET, 'url', 'actor', str(self.control), CONTROL, '1793838000']) + '\n')
        self.private(self.control / 'control-sha', CONTROL + '\n')
        self.save()
        self.executable(self.control / 'engine-release-seal.py', f'''#!/bin/sh
case "$2" in
 desired-sha) echo {EED};;
 desired-image-id) echo {IMAGE};;
 desired-legacy-unlabelled) echo false;;
 *) exit 2;;
esac
''')
        self.executable(self.control / 'engine-up.sh', '#!' + sys.executable + '''
import json,os,pathlib
p=pathlib.Path(os.environ['FIXTURE_ROOT'])
with (p/'up.log').open('a') as f:f.write(os.environ.get('ENGINE_UP_CERTIFIED_RETIREMENT','')+'\\n')
d=json.loads((p/'current.json').read_text());d['hostPid']+=1;d['containerStartedAt']='2026-11-05T00:07:00.000000000Z'
(p/'current.json').write_text(json.dumps(d))
''')
        # Host files are private real files. Only UID is virtualized because CI
        # executes as an unprivileged user; adverse UID is exercised below.
        self.executable(self.bin / 'python3', '#!' + sys.executable + '''
import os,sys
if sys.argv[1]=='-':
 code=sys.stdin.read();sys.argv=sys.argv[1:];original=os.fstat
 def fixture_stat(fd):
  values=list(original(fd));values[4]=int(os.environ.get('FIXTURE_UID','0'));return os.stat_result(values)
 os.fstat=fixture_stat
 exec(compile(code,'<actual-runtime-heredoc>','exec'),{'__name__':'__main__'})
else:os.execv(sys.executable,[sys.executable,*sys.argv[1:]])
''')
        self.executable(self.bin / 'timeout', '#!/bin/bash\nwhile [[ "${1:-}" == --* ]]; do shift; done\nshift\nexec "$@"\n')
        self.executable(self.bin / 'logger', '#!/bin/sh\nexit 0\n')
        self.executable(self.bin / 'curl', '#!/bin/sh\nprintf \'%s\\n%s\' \'{"running":true,"releaseSha":"' + EED + '","liveness":"ok","instanceId":"1-5835d418"}\' 200\n')
        self.harness = self.root / 'native.cjs'
        self.harness.write_text('''const fs=require('node:fs'),vm=require('node:vm');
const [code,expected,root]=process.argv.slice(2);
const fake={...fs,openSync(p,f){if(!/^\\/app\\/\\.legacy-certified-retirement-[1-9][0-9]*(-[1-9][0-9]*)?\\.json$/.test(p))throw Error('unexpected marker');return fs.openSync(root+'/marker.json',f)},
fstatSync(fd){const s=fs.fstatSync(fd);s.uid=Number(process.env.FIXTURE_NATIVE_UID||0);return s},
readFileSync(p,e){if(p==='/proc/1/stat')return '1 (node) '+Array.from({length:20},(_,i)=>i===19?(process.env.FIXTURE_TICKS||'157263255'):'0').join(' ');return fs.readFileSync(p,e)}};
vm.runInNewContext(code,{require(n){return n==='node:fs'?fake:require(n)},process:{argv:['node',expected],stdout:process.stdout}});
''')
        # Most Docker reads in this fixture are constant. Avoid loading the
        # process launcher and filesystem libraries for every short inspection.
        self.executable(self.bin / 'docker', '#!' + sys.executable + ''' -S
import json,os,sys
a=sys.argv[1:];root=os.environ['FIXTURE_ROOT']
if a==['info']:sys.exit(0)
if a[:2]==['image','inspect']:
 if '{{json .Config.Env}}' in a:print(json.dumps(['GIT_COMMIT_SHA=''' + EED + '''']))
 sys.exit(0)
if a[:2]==['container','ls']:
 if os.environ.get('FIXTURE_LIST_UNKNOWN'):sys.exit(3)
 sys.exit(0)
if a[:2]==['container','inspect']:
 if os.environ.get('FIXTURE_ABSENT'):sys.exit(1)
 fmt=a[a.index('-f')+1] if '-f' in a else ''
 if a[-1]=='sp-autoheal' and fmt=='{{.Id}} {{.State.Status}}':
  print('e'*64+' running');sys.exit(0)
 with open(os.path.join(root,'current.json')) as f:d=json.load(f)
 if fmt.startswith('{"containerId"'):
  from pathlib import Path
  counter=Path(root)/'reads';count=int(counter.read_text())+1 if counter.exists() else 1;counter.write_text(str(count))
  if os.environ.get('FIXTURE_CHANGED_BOOKEND') and count>=2:d['hostPid']+=1
  print(json.dumps(d));sys.exit(0)
 vals={'{{.State.Status}}':'running','{{.Image}}':d['containerImageId'],'{{.HostConfig.RestartPolicy.Name}}':'always'}
 if fmt in vals:print(vals[fmt])
 elif 'sp.release.sha' in fmt:print(''' + repr(EED) + ''')
 elif 'autoheal' in fmt:print('true')
 elif 'sp.role' in fmt:print('engine')
 sys.exit(0)
if a[0]=='exec':
 if os.environ.get('FIXTURE_EXEC_UNKNOWN'):sys.exit(4)
 i=a.index('-e');os.execvp('node',['node',os.path.join(root,'native.cjs'),a[i+1],a[i+2],root])
if a[0]=='stop':
 with open(os.path.join(root,'stop.log'),'a') as f:f.write(a[-1]+'\\n')
 sys.exit(0)
if a[0] in ('start','update'):sys.exit(0)
sys.exit(5)
''')
        self.env = {**os.environ, 'PATH': str(self.bin) + ':' + os.environ['PATH'],
            'FIXTURE_ROOT': str(self.root), 'ENGINE_CONTROL_DIR': str(self.control),
            'ENGINE_RELEASE_REQUEST_ROOT': str(self.requests), 'ENGINE_CHECKPOINT_RECOVERY_RUN_ID': RUN,
            'ENGINE_SUPERVISOR_LOCK_HELD': '1', 'ENGINE_SUPERVISOR_FORCE_DESIRED': '1',
            'ENGINE_SUPERVISOR_REQUIRE_EXACT_HEALTH': '1',
            'ENGINE_RECOVERY_DEADLINE_EPOCH': str(__import__('time').time_ns()//1_000_000_000+30)}

    def tearDown(self): self.tmp.cleanup()
    def private(self, path, text): path.write_text(text); path.chmod(0o600)
    def executable(self, path, text): path.write_text(text); path.chmod(0o755)
    def save(self):
        self.private(self.requests / (RUN + '.legacy-checkpoint-intent'), json.dumps(self.intent))
        self.private(self.root / 'marker.json', json.dumps(self.marker))
        (self.root / 'current.json').write_text(json.dumps(self.current))
    def run_supervisor(self, source=SUPERVISOR, extra=None):
        return subprocess.run(['bash','-c',source], env={**self.env, **(extra or {})}, text=True,
                              capture_output=True, timeout=20)
    def assert_refused(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.root/'up.log').exists(), result.stdout + result.stderr)
    def test_complete_custody_reconstructs_healthy_same_image_once(self):
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        entries=(self.root/'up.log').read_text().splitlines();self.assertEqual(len(entries),1)
        self.assertEqual(json.loads(entries[0])['nativeStartTicks'],'157263255')
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(len((self.root/'up.log').read_text().splitlines()),1)
    def test_empty_fleet_is_still_a_retirement(self):
        self.marker.update(attemptedTables=0,verifiedTables=0);self.save()
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertTrue((self.root/'up.log').exists())
    def test_missing_marker_never_proves_custody(self):
        (self.root/'marker.json').unlink();self.assert_refused(self.run_supervisor())
    def test_partial_marker_never_proves_custody(self):
        (self.root/'marker.json').write_text('{');self.assert_refused(self.run_supervisor())
    def test_unknown_native_read_never_proves_custody(self):
        self.assert_refused(self.run_supervisor(extra={'FIXTURE_EXEC_UNKNOWN':'1'}))
    def test_marker_binding_and_custody_negatives(self):
        original=copy.deepcopy(self.marker)
        for key,value in [('runId','1-1'),('controlSha','f'*40),('sourceSha','f'*40),('targetSha','f'*40),
            ('containerImageId','sha256:'+'f'*64),('hostPid',3),('nativeStartTicks','999'),
            ('ownershipToken','wrong'),('releaseAt',1793837700001),('verifiedTables',108),
            ('finalCensusZero',False),('stage','preflight'),('extra',True)]:
            with self.subTest(key=key):
                self.marker=copy.deepcopy(original);self.marker[key]=value;self.save()
                self.assert_refused(self.run_supervisor())
    def test_source_files_must_be_private_and_owned(self):
        self.assert_refused(self.run_supervisor(extra={'FIXTURE_UID':'501'}))
        (self.requests/(RUN+'.legacy-checkpoint-intent')).chmod(0o644)
        self.assert_refused(self.run_supervisor())
    def publish_request_as_intent_link(self):
        # Production shape (2026-11-06, run 42190145714-1): launch/wrapper/intake
        # publish <run>.request as a hard link of <run>.intent in a 0700 root.
        self.requests.chmod(0o700)
        os.link(self.requests/(RUN+'.request'), self.requests/(RUN+'.intent'))
        self.assertEqual((self.requests/(RUN+'.request')).stat().st_nlink, 2)
    def test_request_published_as_its_intent_link_is_readable(self):
        self.publish_request_as_intent_link()
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertNotIn('retirement source file is unsafe',result.stderr)
        self.assertEqual(len((self.root/'up.log').read_text().splitlines()),1)
    def test_committed_run_without_checkpoint_restores_through_its_linked_request(self):
        # The exact 04:02 failure: a sealed run with no legacy checkpoint
        # intent must answer 'none' and prove its healthy desired runtime.
        (self.requests/(RUN+'.legacy-checkpoint-intent')).unlink()
        self.publish_request_as_intent_link()
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertNotIn('retirement source file is unsafe',result.stderr)
        self.assertFalse((self.root/'up.log').exists())
    def test_foreign_or_extra_request_links_stay_unsafe(self):
        request=self.requests/(RUN+'.request')
        with self.subTest('foreign alias only'):
            self.requests.chmod(0o700);alias=self.requests/'alias';os.link(request,alias)
            result=self.run_supervisor();self.assert_refused(result)
            self.assertIn('retirement source file is unsafe',result.stderr);alias.unlink()
        with self.subTest('intent plus a third name'):
            self.publish_request_as_intent_link();alias=self.root/'third';os.link(request,alias)
            result=self.run_supervisor();self.assert_refused(result)
            self.assertIn('retirement source file is unsafe',result.stderr)
            alias.unlink();(self.requests/(RUN+'.intent')).unlink()
        with self.subTest('intent link in a shared directory'):
            self.publish_request_as_intent_link();self.requests.chmod(0o750)
            result=self.run_supervisor();self.assert_refused(result)
            self.assertIn('retirement source file is unsafe',result.stderr)
            self.requests.chmod(0o700);(self.requests/(RUN+'.intent')).unlink()
        with self.subTest('intent is a different file'):
            self.requests.chmod(0o700);self.private(self.requests/(RUN+'.intent'),request.read_text())
            alias=self.root/'other';os.link(request,alias)
            result=self.run_supervisor();self.assert_refused(result)
            self.assertIn('retirement source file is unsafe',result.stderr)
    def test_intent_symlink_is_not_original_evidence(self):
        path=self.requests/(RUN+'.legacy-checkpoint-intent')
        actual=self.requests/'other-intent';path.rename(actual);path.symlink_to(actual)
        self.assert_refused(self.run_supervisor())
    def test_marker_must_be_native_owned_and_private(self):
        self.assert_refused(self.run_supervisor(extra={'FIXTURE_NATIVE_UID':'501'}))
        (self.root/'marker.json').chmod(0o644);self.assert_refused(self.run_supervisor())
    def test_changed_native_process_is_not_reconstructed(self):
        self.current['hostPid']+=1;self.save()
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertFalse((self.root/'up.log').exists())
    def test_historical_profile_is_unchanged(self):
        del self.intent['certifiedRecovery'];self.save()
        result=self.run_supervisor();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertFalse((self.root/'up.log').exists())
    def test_malformed_current_identity_is_unknown(self):
        self.current.pop('hostPid');self.save();self.assert_refused(self.run_supervisor())
    def run_stop(self, extra=None):
        start=UP.index("CERTIFIED_OUTGOING_ID=''")
        end=UP.index('# THE REPLACEMENT IS CREATED',start)
        source='''set -euo pipefail
log(){ echo "$*"; }; phase(){ :; }
CONTAINER=club-arena-engine
AUTHORIZED_CLASS=desired
AUTHORIZED_SHA='''+EED+'''
AUTHORIZED_IMAGE_ID='''+IMAGE+'\n'+UP[start:end]+'\nwait "${STOP_OPERATION_PID}"\n'
        witness={k:v for k,v in self.marker.items() if k not in ('schema','stage','attemptedTables','verifiedTables','finalCensusZero','maintenanceGeneration','resumeToken')}
        return subprocess.run(['bash','-c',source], env={**self.env,'ENGINE_UP_CERTIFIED_RETIREMENT':json.dumps(witness),**(extra or {})}, text=True,capture_output=True,timeout=15)
    def test_canonical_stop_uses_immutable_container_id(self):
        result=self.run_stop();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual((self.root/'stop.log').read_text().strip(),self.current['containerId'])
    def test_canonical_stop_refuses_new_pid1_or_changed_bookend(self):
        for extra in ({'FIXTURE_TICKS':'999'},{'FIXTURE_CHANGED_BOOKEND':'1'}):
            with self.subTest(extra=extra):
                (self.root/'reads').unlink(missing_ok=True)
                result=self.run_stop(extra);self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertFalse((self.root/'stop.log').exists())


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--baseline':
        case=CertifiedRecovery();case.setUp()
        try:
            result=case.run_supervisor(Path(sys.argv[2]).read_text())
            assert result.returncode==0,(result.stdout,result.stderr)
            assert not (case.root/'up.log').exists()
            print('REPRODUCED: previous same-image running health path accepts the retired incarnation without reconstruction')
        finally:case.tearDown()
    else:unittest.main()
