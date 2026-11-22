import gzip
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import declaration_guard

TOOLKIT = Path(__file__).resolve().parents[1]
SHA40 = '3529e86663daa427b380a8ab9bd09347270c670e'
SHA_NEXT = '26c2e74930dd0ec05a4a86a62f04e8fe05be04d1'


class TestCapturePipelineWiring(unittest.TestCase):
    def setUp(self):
        base = os.environ.get('HVH_TEST_TMP')
        self.tmp = tempfile.TemporaryDirectory(dir=base)
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_reconcile_census_first_fallback_without_part_files(self):
        cap = self.root / 'cap-reconcile'
        cap.mkdir()
        (cap / 'window-denominators-hands.json').write_text(
            json.dumps({'hands': [{'hand_id': 'h1', 'has_human': True}, {'hand_id': 'h2', 'has_human': False}]})
        )
        (cap / 'human-hand-keys.json').write_text(
            json.dumps({'sourceSha': SHA40, 'hands': [{'h': 'h1', 'k': 'a' * 64}]})
        )
        (cap / 'originals-witness-1.jsonl').write_text(
            json.dumps({'hand': 'h1', 'turnKey': 't1'}) + '\n'
            + json.dumps({'summary': {'hands': 1, 'missing': 0, 'otherRelease': 0, 'decisions': 1, 'reviewStatus': {'reconciled': 1}}}) + '\n'
        )
        r = subprocess.run([sys.executable, '-B', str(TOOLKIT / 'reconcile.py'), str(cap)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual((out['censusHumanHands'], out['censusWithKey'], out['inBoth'], out['censusOnly']), (1, 1, 1, []))
        self.assertFalse((cap / 'human-hand-keys-part3.json').exists())

    def test_analyze_reads_witness_rows_jsonl_and_write_window_artifacts_indexes_and_guards(self):
        obs = self.root / 'obs-3529e866'
        cap = obs / 'capture'
        tm = obs / 'tight-maniac'
        cap.mkdir(parents=True)
        tm.mkdir(parents=True)

        declaration_guard.write_declaration(
            obs,
            {
                'declaredAt': '2026-11-16T02:48:00Z',
                'window': {'startUtc': '2026-11-16T02:48:00Z', 'halfOpen': True},
                'release': {'sha': SHA40, 'instanceId': '1-fb955e00'},
                'method': 'TIGHT-MANIAC-METHOD-v1 af0bd14cbae3d66a',
                'expectations_before_outcomes': 'Grade tight and sustained maniac facing wagers.',
            },
        )

        (cap / 'BOUNDARY.json').write_text(
            json.dumps({
                'effectiveWindow': ['2026-11-16T02:48:00Z', '2026-11-16T04:48:00Z'],
                'preservation': 'closed END 2026-11-16T04:55:00Z',
            })
        )
        (cap / 'window-denominators.json').write_text(
            json.dumps({
                'startUtc': '2026-11-16T02:48:00Z',
                'endUtc': '2026-11-16T04:48:00Z',
                'slices': 120,
                'complete': True,
                'missingSlices': [],
                'handsRead': 500,
                'humanHands': 2,
                'handsFileSha256': '0' * 64,
                'totalsOverReadSlices': {'plo4|cash|normal|ordinary|eligible_mixed|none': 2},
            })
        )
        (cap / 'steps.log').write_text(
            '{"sha256":"' + ('1' * 64) + '","complete":true,"defect":false,"totals":{"committed":10},"reconciliation":{}}\n'
        )
        (cap / 'rule-fires-window.json').write_text(
            json.dumps({'result': {'receipts': 4, 'fires': {'decide': 50, 'horse_exact_memory_read_ok': 49}}})
        )
        (cap / 'reconcile-human-set.json').write_text(
            json.dumps({
                'censusHumanHands': 2,
                'censusWithKey': 2,
                'keyMismatch': [],
                'witnessSummaries': [{'hands': 2, 'missing': 0, 'otherRelease': 0, 'decisions': 2, 'reviewStatus': {'reconciled': 2}}],
            })
        )

        # Write witness-rows.jsonl (NOT witness-rows-parts-1-2.jsonl) to verify bugfix in analyze.py
        wrows = [
            {'hand': 'h1', 'turnKey': 't1', 'variant': 'plo4', 'mode': 'cash', 'humansAble': ['u1']},
            {'hand': 'h2', 'turnKey': 't2', 'variant': 'plo4', 'mode': 'cash', 'humansAble': ['u1']},
        ]
        (obs / 'witness-rows.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in wrows))

        packet_rows = [
            {
                'hand': 'h1',
                'opponent': 'u1',
                'type': 'faces_human_wager',
                'class': 'ordinary',
                'priorExactForHand': True,
                'bound': True,
                'verdict': 'not_graded',
                'absentLike': False,
                'forcedShare': 0.1,
                'prior': {'n': 40, 'vpip': 0.25, 'pfr': 0.15},
                'oneOffLargeBet': False,
                'loosePassive': False,
                'learnedAfterRepair': True,
                'match': {'variant': 'plo4', 'mode': 'cash', 'stage': 'flop'},
                'proposal': {'action': 'call', 'amount': 10},
                'changes': [],
                'final': {'action': 'call', 'amount': 10},
                'execution': {'status': 'intended'},
                'engineRead': {'read': True, 'overFolder': False, 'style': {'participation': 'neutral'}},
            },
            {
                'hand': 'h2',
                'opponent': 'u2',
                'type': 'faces_human_wager',
                'class': 'tight',
                'priorExactForHand': True,
                'bound': True,
                'verdict': 'adjusted',
                'absentLike': False,
                'forcedShare': 0.05,
                'prior': {'n': 60, 'vpip': 0.14, 'pfr': 0.10},
                'oneOffLargeBet': False,
                'loosePassive': False,
                'learnedAfterRepair': True,
                'match': {'variant': 'plo4', 'mode': 'cash', 'stage': 'flop'},
                'proposal': {'action': 'call', 'amount': 10},
                'changes': [{'node': 'tight_respect'}],
                'final': {'action': 'fold', 'amount': 0},
                'execution': {'status': 'intended'},
                'engineRead': {'read': True, 'overFolder': False, 'style': {'participation': 'tight', 'tightOpenerRespect': True}},
            },
        ]
        (tm / 'witnesses.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in packet_rows))

        ra = subprocess.run([sys.executable, '-B', str(TOOLKIT / 'analyze.py'), str(obs)], capture_output=True, text=True)
        self.assertEqual(ra.returncode, 0, ra.stderr)
        rn = json.loads((obs / 'report-numbers.json').read_text())
        self.assertEqual(rn['witness']['decisions'], 2)
        self.assertEqual(rn['witness']['topHuman']['share'], 0.5)
        self.assertFalse(rn['witness']['topHuman']['singlePlayerDominated'])

        # Single-build boundary file -> write_window_artifacts succeeds and renders boundary table
        (cap / 'build-boundaries.json').write_text(
            json.dumps({
                'boundaries': [
                    {
                        'releaseSha': SHA40,
                        'instanceId': '1-fb955e00',
                        'cutoverStartUtc': '2026-11-16T02:45:00Z',
                        'activeFromUtc': '2026-11-16T02:48:00Z',
                        'nextCutoverStartUtc': None,
                        'activeUntilUtc': None,
                    }
                ],
                'handSummary': {'totalHands': 500, 'straddlesMultipleBuilds': False, 'byBuild': {SHA40: 500}, 'bySource': {'hand_history.engine_build': 500}},
            })
        )
        env = {**os.environ, 'HVH_OPERATOR': 'test_op'}
        rw = subprocess.run(
            [
                sys.executable,
                '-B',
                str(TOOLKIT / 'write_window_artifacts.py'),
                str(obs),
                SHA40,
                '1-fb955e00',
                '2026-11-16T02:47:50Z',
                '2026-11-16T04:48:00Z',
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(rw.returncode, 0, rw.stderr)
        meta = json.loads(rw.stdout)
        self.assertIn('REPORT-OBSERVATION.md', meta['created'])
        self.assertIn('### Build boundary table (M9)', (obs / 'REPORT-OBSERVATION.md').read_text())

        # Verify every line in EVIDENCE-INDEX.md matches actual sha256 on disk
        idx_lines = [l for l in (obs / 'EVIDENCE-INDEX.md').read_text().splitlines() if not l.startswith('#')]
        self.assertGreaterEqual(len(idx_lines), 5)
        for line in idx_lines:
            digest, relp = line.split('  ', 1)
            actual = hashlib.sha256((obs / relp).read_bytes()).hexdigest()
            self.assertEqual(digest, actual, relp)

        # Multi-build straddling window is refused
        obs_bad = self.root / 'obs-multi'
        (obs_bad / 'capture').mkdir(parents=True)
        declaration_guard.write_declaration(
            obs_bad,
            {
                'declaredAt': '2026-11-16T02:48:00Z',
                'window': {'startUtc': '2026-11-16T02:48:00Z', 'halfOpen': True},
                'release': {'sha': SHA40, 'instanceId': '1-fb955e00'},
                'method': 'TIGHT-MANIAC-METHOD-v1 af0bd14cbae3d66a',
                'expectations_before_outcomes': 'Must refuse unsplit multi-build windows.',
            },
        )
        (obs_bad / 'capture' / 'window-denominators.json').write_text(
            json.dumps({'startUtc': '2026-11-16T02:48:00Z', 'endUtc': '2026-11-18T12:00:00Z', 'humanHands': 0})
        )
        (obs_bad / 'capture' / 'build-boundaries.json').write_text(
            json.dumps({'boundaries': [], 'handSummary': {'straddlesMultipleBuilds': True, 'distinctServingBuilds': [SHA40, SHA_NEXT]}})
        )
        rw_bad = subprocess.run(
            [
                sys.executable,
                '-B',
                str(TOOLKIT / 'write_window_artifacts.py'),
                str(obs_bad),
                SHA40,
                '1-fb955e00',
                '2026-11-16T02:47:50Z',
                '2026-11-18T12:00:00Z',
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertNotEqual(rw_bad.returncode, 0)
        self.assertIn('straddles multiple engine builds', rw_bad.stderr)

    def test_post_capture_raw_batches_and_host_runner_with_mock_ssh(self):
        cap = self.root / 'cap-raw'
        cap.mkdir()
        keys_file = cap / 'targets.json'
        keys_file.write_text(
            json.dumps({
                'sourceSha': SHA40,
                'hands': [{'h': f'hand-{i}', 'k': f'{i:064x}', 'handNumber': 100 + i} for i in range(1, 5)],
            })
        )
        env = {**os.environ, 'HVH_SHA': SHA40, 'HVH_IMAGE': f'hvh-reader:{SHA40[:10]}', 'HVH_OPERATOR': 'test_op'}
        rb = subprocess.run(
            [sys.executable, '-B', str(TOOLKIT / 'post_capture.py'), 'raw_batches', str(keys_file), str(cap), '2'],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(rb.returncode, 0, rb.stderr)
        rb_info = json.loads(rb.stdout)
        self.assertEqual(len(rb_info['rawBatches']), 2)
        self.assertTrue((cap / 'raw-batch-1.mjs').exists())
        self.assertIn('readHorseJournalHandRecords', (cap / 'raw-batch-1.mjs').read_text())

        # Mock SSH + local fake host dir to verify run-originals-host.sh start + collect (.jsonl.gz)
        fake_host = self.root / 'fake-host'
        fake_bin = self.root / 'bin'
        fake_host.mkdir()
        fake_bin.mkdir()

        mock_ssh = fake_bin / 'mock-ssh.sh'
        mock_ssh.write_text(
            f"""#!/bin/bash
set -e
cmd="$1"
mapped="${{cmd//\\/root\\/hvh-raw-test/{fake_host.as_posix()}}}"
mapped="${{mapped//sudo /}}"
mapped="${{mapped//setsid /}}"
sed -i.bak 's|/root/hvh-raw-test|{fake_host.as_posix()}|g' "{fake_host.as_posix()}/runner.sh" 2>/dev/null || true
rm -f "{fake_host.as_posix()}/runner.sh.bak" 2>/dev/null || true
eval "$mapped"
"""
        )
        mock_ssh.chmod(0o755)

        mock_timeout = fake_bin / 'timeout'
        mock_timeout.write_text('#!/bin/bash\nshift\nexec "$@"\n')
        mock_timeout.chmod(0o755)

        mock_docker = fake_bin / 'docker'
        mock_docker.write_text(
            """#!/bin/bash
cat >/dev/null
echo '{"hand":"hand-1","key":"0001","record":{"kind":"decision"}}'
echo '{"summary":{"hands":2,"missing":0,"records":1}}'
"""
        )
        mock_docker.chmod(0o755)

        # Ensure sha256sum exists in fake_bin on macOS (where shasum -a 256 is native)
        mock_sha = fake_bin / 'sha256sum'
        mock_sha.write_text('#!/bin/bash\nshasum -a 256 "$@"\n')
        mock_sha.chmod(0o755)

        host_env = {
            **env,
            'PATH': f'{fake_bin.as_posix()}:{os.environ["PATH"]}',
            'HVH_SSH_CMD': mock_ssh.as_posix(),
            'HVH_MIN_FREE_KB': '0',
            'HVH_SKIP_HOST_HEALTH': '1',
        }
        st = subprocess.run(
            ['bash', str(TOOLKIT / 'run-originals-host.sh'), 'start', str(cap), '/root/hvh-raw-test'],
            capture_output=True,
            text=True,
            env=host_env,
        )
        self.assertEqual(st.returncode, 0, st.stderr + st.stdout)
        self.assertIn('2 batches', st.stdout)
        self.assertIn('nice -n 19', (cap / 'host-runner.sh').read_text())

        # Wait briefly for detached local runner to finish writing gzipped outputs
        for _ in range(50):
            if (fake_host / 'runner.log').exists() and 'originals-done' in (fake_host / 'runner.log').read_text():
                break
            import time
            time.sleep(0.05)
        self.assertIn('originals-done', (fake_host / 'runner.log').read_text())

        col = subprocess.run(
            ['bash', str(TOOLKIT / 'run-originals-host.sh'), 'collect', str(cap), '/root/hvh-raw-test'],
            capture_output=True,
            text=True,
            env=host_env,
        )
        self.assertEqual(col.returncode, 0, col.stderr + col.stdout)
        gz1 = cap / 'originals-raw-1.jsonl.gz'
        self.assertTrue(gz1.exists())
        self.assertEqual(stat.S_IMODE(gz1.stat().st_mode), 0o400)
        unpacked = gzip.decompress(gz1.read_bytes()).decode('utf-8')
        self.assertIn('"hand":"hand-1"', unpacked)

    def test_read_window_blocks_undeclared_directory_immediately(self):
        obs_undeclared = self.root / 'obs-no-decl'
        obs_undeclared.mkdir()
        r = subprocess.run(
            [
                'bash',
                str(TOOLKIT / 'read-window.sh'),
                SHA40,
                '1-fb955e00',
                str(obs_undeclared),
                '2026-11-20T00:00:00Z',
                '2026-11-20T02:00:00Z',
            ],
            capture_output=True,
            text=True,
            env={**os.environ, 'HVH_OPERATOR': 'test_op'},
        )
        self.assertEqual(r.returncode, 6)
        self.assertIn('declaration_guard failed', r.stderr)

    def test_preserve_host_ensure_reader_and_rollover_with_mock_ssh(self):
        fake_host = self.root / 'fake-preserve'
        fake_bin = self.root / 'pbin'
        fake_host.mkdir()
        fake_bin.mkdir()

        mock_docker = fake_bin / 'docker'
        mock_docker.write_text(
            f"""#!/bin/bash
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  echo "sha256:fakeid {{\\"git.sha\\":\\"{SHA40}-{SHA_NEXT}\\"}}"
  exit 0
fi
exit 0
"""
        )
        mock_docker.chmod(0o755)
        mock_sha = fake_bin / 'sha256sum'
        mock_sha.write_text('#!/bin/bash\nshasum -a 256 "$@"\n')
        mock_sha.chmod(0o755)

        mock_ssh = fake_bin / 'mock-preserve-ssh.sh'
        mock_ssh.write_text(
            f"""#!/bin/bash
set -e
cmd="$1"
mapped="${{cmd//\\/root\\/hvh-work-/{(fake_host / 'hvh-work-').as_posix()}}}"
mapped="${{mapped//sudo /}}"
mapped="${{mapped//setsid /}}"
# replace background preserve-window.sh launch with true so local test does not spawn a background loop
mapped="${{mapped//bash ${(fake_host / 'hvh-work-').as_posix()}*/true}}"
eval "$mapped"
"""
        )
        mock_ssh.chmod(0o755)

        env = {
            **os.environ,
            'PATH': f'{fake_bin.as_posix()}:{os.environ["PATH"]}',
            'HVH_SSH_CMD': mock_ssh.as_posix(),
            'HVH_OPERATOR': 'test_op',
            'HVH_SHA': SHA40,
        }
        # 1. Start old release
        r_start = subprocess.run(
            [
                'bash',
                str(TOOLKIT / 'preserve-host.sh'),
                'start',
                SHA40[:8],
                '2026-11-20T00:00:00Z',
                '2026-11-20T12:00:00Z',
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(r_start.returncode, 0, r_start.stderr + r_start.stdout)
        self.assertIn(f'retained hvh-reader:{SHA40[:10]}', r_start.stdout)

        # 2. Rollover to new release
        r_roll = subprocess.run(
            [
                'bash',
                str(TOOLKIT / 'preserve-host.sh'),
                'rollover',
                SHA40[:8],
                '2026-11-20T04:05:00Z',
                SHA_NEXT,
                '2026-11-20T04:05:00Z',
                '2026-11-20T16:05:00Z',
            ],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(r_roll.returncode, 0, r_roll.stderr + r_roll.stdout)
        self.assertIn(f'rollover complete: closed {SHA40[:8]}', r_roll.stdout)
        self.assertIn(f'reader=hvh-reader:{SHA_NEXT[:10]}', r_roll.stdout)


if __name__ == '__main__':
    unittest.main()
