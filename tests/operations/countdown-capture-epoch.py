#!/usr/bin/env python3
"""The break-end capture carries only its epoch (run 41469215622-1, 2026-11-02).

bind_phase1_window runs inside `$(legacy_checkpoint_countdown ...)` and
`$(maintenance_certificate ...)`. When the target is behind protected main,
source_target_is_current prints ENGINE_RELEASE_SUPERSEDED_BY=<sha> to stdout;
that line joined the captured epoch and `set -u` arithmetic died at 16:00:13Z
("<sha>: unbound variable"), leaving an announcement-only owner. These cases
execute the real shell text with stubs; no host, network or Git.
"""
from pathlib import Path
import json
import os
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / 'server/scripts/engine-release-transaction.sh').read_text()
LATEST = 'cc825674732e0b64f9f116b221fe2f245e801a46'
CYCLE = 1793635200  # 2026-11-02 16:00:00Z
EPOCH = '1793635505'
# The host and CI run bash 5; macOS /bin/bash 3.2 rejects empty arrays under set -u.
BASH = next((b for b in ('/opt/homebrew/bin/bash', '/usr/local/bin/bash') if os.path.exists(b)), 'bash')


def function(source, name):
    begin = source.index(name + '() {')
    end = source.index('\n}\n', begin) + 3
    return source[begin:end]


class CountdownCapture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='countdown-capture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shim = self.root / 'seal-shim'
        shim.write_text('#!/usr/bin/env bash\ncase "$1" in\nbind-routine-window) cat >/dev/null; '
                        'echo \'{"window":{"startsAt":%d,"endsAt":%d}}\';;\n*) exit 98;;\nesac\n'
                        % (CYCLE * 1000, (CYCLE + 300) * 1000))
        shim.chmod(0o700)
        self.shim = shim
        stamp = CYCLE * 1000 - 120000
        self.health = json.dumps({'maintenance': {'active': True, 'phase': 'counting_down', 'presentation': {
            'break_id': stamp, 'break_ends_at': stamp + 420000, 'scheduled_ends_at': stamp + 420000}}})

    def capture(self, bind_text):
        # Production runs `set -euo pipefail` under bash 5. macOS bash 3.2 also
        # treats an empty array as unbound under -u, so -u is enabled for the
        # arithmetic that crashed in production rather than for the whole script.
        script = 'set -eo pipefail\n' + bind_text + f"""
PHASE1_CYCLE_START={CYCLE}; LOCK_HELD=1; RUN_ID=41469215622-1; REPO_DIR=/nonexistent
RELEASE_SEAL={shlex.quote(str(self.shim))}
legacy_entry_read() {{ "$@"; }}
timeout() {{ shift 3; "$@"; }}
acquire_engine_lock() {{ :; }}; release_engine_lock() {{ :; }}
source_target_is_current() {{ echo "ENGINE_RELEASE_SUPERSEDED_BY={LATEST}"; echo "[engine-release-transaction] FORWARD TARGET BEHIND MAIN" >&2; }}
countdown() {{ bind_phase1_window {shlex.quote(self.health)} || return 1; echo {EPOCH}; }}
END="$(countdown)"
printf 'CAPTURED<%s>\\n' "$END"
set -u
echo $((END * 1000)) >/dev/null
echo ARITHMETIC_OK
"""
        return subprocess.run([BASH, '-c', script], capture_output=True, text=True, timeout=10)

    def test_current_capture_is_only_the_epoch(self):
        r = self.capture(function(SOURCE, 'bind_phase1_window'))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('CAPTURED<%s>' % EPOCH, r.stdout)
        self.assertIn('ARITHMETIC_OK', r.stdout)

    def test_previous_text_reproduces_the_cutover_crash(self):
        old = function(SOURCE, 'bind_phase1_window').replace('  source_target_is_current >&2\n', '  source_target_is_current\n')
        self.assertNotEqual(old, function(SOURCE, 'bind_phase1_window'))
        r = self.capture(old)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('ENGINE_RELEASE_SUPERSEDED_BY=' + LATEST, r.stdout)
        self.assertIn(LATEST + ': unbound variable', r.stderr)
        self.assertNotIn('ARITHMETIC_OK', r.stdout)

    def test_owner_binding_reuses_fetched_main_and_propagates_source_refusal(self):
        stamp=1793824762499; end=stamp+420000
        health=json.dumps({'maintenance':{'active':True,'phase':'counting_down','reason':'Deployment Recovery',
            'presentation':{'break_id':stamp,'break_ends_at':end-1,'scheduled_ends_at':end-1}}})
        # The actual seal behavior is exercised by engine-hourly-maintenance;
        # this native shell case proves owner routing, source mode and capture.
        self.shim.write_text('#!/usr/bin/env bash\ncase "$1" in\nbind-recovery-window) cat >/dev/null; '
            'echo \'{"window":{"startsAt":%d,"endsAt":%d}}\';;\n*) exit 98;;\nesac\n' % (stamp+120000,end))
        for source_status,held in ((0,1),(23,1),(0,0),(23,0)):
            script='set -eo pipefail\n'+function(SOURCE,'bind_phase1_window')+f"""
PHASE1_CYCLE_START=0; LOCK_HELD={held}; RUN_ID=41904788070-1; REPO_DIR=/nonexistent
SHA={'a'*40}; CONTROL_SHA={'b'*40}; ACTIVATION_FLOOR_OWNER_WINDOW=original-owner
RELEASE_SEAL={shlex.quote(str(self.shim))}; DATABASE_PROOF=promise; ENV_FILE=/unused
legacy_entry_read() {{ "$@"; }}
timeout() {{ shift 3; "$@"; }}
floor_reservation_stamp() {{ echo {stamp}; }}
promise() {{ echo PROMISE_READ >&2; echo '{{}}'; }}
acquire_engine_lock() {{ LOCK_HELD=1; echo LOCK_ACQUIRED >&2; }}
release_engine_lock() {{ LOCK_HELD=0; echo LOCK_RELEASED >&2; }}
source_target_is_current() {{ test "$1" = local-main || return 91; echo SOURCE_LOCAL_MAIN >&2; return {source_status}; }}
countdown() {{ bind_phase1_window {shlex.quote(health)} || return $?; echo "$PHASE1_OBSERVED_WINDOW_END"; }}
END="$(countdown)"
echo "CAPTURED<$END>"
"""
            result=subprocess.run([BASH,'-c',script],capture_output=True,text=True,timeout=10)
            self.assertIn('SOURCE_LOCAL_MAIN',result.stderr)
            self.assertEqual(result.returncode,source_status,result.stderr)
            self.assertEqual('LOCK_RELEASED' in result.stderr,held==0)
            if source_status==0:
                self.assertEqual(result.stdout.strip(),f'CAPTURED<{end-1}>')
                self.assertLess(result.stderr.index('SOURCE_LOCAL_MAIN'),result.stderr.index('PROMISE_READ'))
            else:
                self.assertNotIn('CAPTURED<',result.stdout)
                self.assertNotIn('PROMISE_READ',result.stderr)
        announcement=function(SOURCE,'request_recovery_window')
        self.assertLess(announcement.index('source_target_is_current\n'),announcement.index('reserve-recovery-window'))
        locked=SOURCE[SOURCE.index("  acquire_engine_lock 'maintenance cutover'"):]
        self.assertLess(locked.index('source_target_is_current\n'),locked.index('legacy_checkpoint_countdown'))

    def test_owner_wait_ends_at_original_promise_without_reannouncement(self):
        stamp=1793824762499
        for disposition,now,reservation_status,expected in [
                ('never-entered',stamp+999999,91,0),('announced',stamp+419999,0,0),
                ('announced',stamp+420000,0,47),('announced',stamp+420001,0,47),
                ('announced',stamp+1000,91,47)]:
            script='set -euo pipefail\n'+function(SOURCE,'assert_owner_recovery_window_live')+f"""
ACTIVATION_FLOOR_OWNER_WINDOW=original-owner; FLOOR_DISPOSITION={disposition}
floor_reservation_stamp() {{ echo {stamp}; return {reservation_status}; }}
date() {{ echo {now}; }}
die() {{ echo "$*" >&2; exit 47; }}
assert_owner_recovery_window_live
echo ORIGINAL_WAIT_CONTINUES
"""
            result=subprocess.run([BASH,'-c',script],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,expected,(disposition,now,result.stderr))
            self.assertEqual('ORIGINAL_WAIT_CONTINUES' in result.stdout,expected==0)
            if disposition=='announced' and now>=stamp+420000:self.assertIn('original owner recovery window expired',result.stderr)
        self.assertIn('while :; do\n  assert_owner_recovery_window_live\n',SOURCE)

    def guard(self, value):
        begin = SOURCE.index('    # Only a bare epoch is a break end; anything else refuses before mutation.')
        end = SOURCE.index('    LEGACY_ENTRY_BREAK_END_EPOCH="$LEGACY_COUNTDOWN_END"', begin)
        script = 'set -euo pipefail\nbounded_sleep() { :; }\nLEGACY_ENTRY_DEADLINE_MS=1\n' \
            'for _ in 1; do\n LEGACY_COUNTDOWN_END=' + shlex.quote(value) + '\n' + SOURCE[begin:end] + \
            '    echo ADMITTED\ndone\n'
        return subprocess.run([BASH, '-c', script], capture_output=True, text=True, timeout=10)

    def test_polluted_epoch_refuses_before_entry(self):
        r = self.guard('ENGINE_RELEASE_SUPERSEDED_BY=%s\n%s' % (LATEST, EPOCH))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn('ADMITTED', r.stdout)
        self.assertIn('non-epoch value; refused before entry', r.stderr)

    def test_bare_epoch_is_admitted(self):
        r = self.guard(EPOCH)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('ADMITTED', r.stdout)

    def test_locked_recheck_requires_the_admitted_epoch(self):
        self.assertIn('if [ "$LEGACY_COUNTDOWN_END" != "$LEGACY_ENTRY_BREAK_END_EPOCH" ]; then\n'
                      '      legacy_entry_trace refused countdown_epoch_mismatch', SOURCE)


if __name__ == '__main__':
    unittest.main()
