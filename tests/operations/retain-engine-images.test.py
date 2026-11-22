#!/usr/bin/env python3
"""Exercise server/scripts/retain-engine-images.sh against a stateful Docker shim."""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'server/scripts/retain-engine-images.sh'


def find_bash4() -> str:
    candidates = [
        '/opt/homebrew/bin/bash',
        '/usr/local/bin/bash',
        shutil.which('bash') or '/bin/bash',
    ]
    for path in candidates:
        if not path or not Path(path).is_file():
            continue
        out = subprocess.run(
            [path, '-c', 'echo "${BASH_VERSINFO[0]}"'],
            text=True,
            capture_output=True,
        )
        if out.returncode == 0 and out.stdout.strip().isdigit() and int(out.stdout.strip()) >= 4:
            return path
    raise RuntimeError('Bash 4+ is required to run retain-engine-images.sh')


BASH4 = find_bash4()


def sha40(prefix: str) -> str:
    return (prefix + ('0' * 40))[:40]


def img_id(prefix: str) -> str:
    return 'sha256:' + (prefix + ('0' * 64))[:64]


FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

state_path = Path(os.environ['FAKE_DOCKER_STATE'])
state = json.loads(state_path.read_text())
args = sys.argv[1:]
state['calls'].append(args)


def save():
    state_path.write_text(json.dumps(state))


def fail(msg):
    save()
    print(msg, file=sys.stderr)
    sys.exit(1)


if not args:
    fail('missing docker subcommand')

# Forbid container deletion or force-removal of images.
if args[0] == 'rm' or (args[0] == 'container' and len(args) > 1 and args[1] == 'rm'):
    fail(f'forbidden container deletion: {args}')

if args[0] == 'ps':
    # docker ps -a --no-trunc --format '{{.Image}}\t{{.ID}}\t{{.Status}}'
    fmt = ''
    if '--format' in args:
        fmt = args[args.index('--format') + 1]
    fmt = fmt.replace('\\t', '\t')
    for c in state['containers']:
        line = (
            fmt.replace('{{.Image}}', c['image'])
            .replace('{{.ID}}', c['id'])
            .replace('{{.Status}}', c['status'])
        )
        print(line)
    save()
    sys.exit(0)

if args[0] == 'container' and len(args) >= 2 and args[1] == 'inspect':
    fmt = args[args.index('-f') + 1] if '-f' in args else args[args.index('--format') + 1]
    target = args[-1]
    match = next((c for c in state['containers'] if c['id'] == target or c.get('name') == target), None)
    if match is None:
        fail(f'Error: No such container: {target}')
    if 'sp.release.sha' in fmt:
        print(match.get('release_sha', ''))
    elif fmt == '{{.Image}}':
        print(match['image_id'])
    else:
        fail(f'unexpected container inspect format: {fmt}')
    save()
    sys.exit(0)

if args[0] == 'image' and len(args) >= 2 and args[1] == 'ls':
    fmt = args[args.index('--format') + 1].replace('\\t', '\t')
    if '--filter' in args and 'dangling=true' in args:
        for d in state['dangling']:
            print(fmt.replace('{{.ID}}', d['id']))
    else:
        for t in state['tags']:
            repo, tag = t['ref'].split(':', 1)
            line = (
                fmt.replace('{{.Repository}}', repo)
                .replace('{{.Tag}}', tag)
                .replace('{{.ID}}', t['id'])
            )
            print(line)
    save()
    sys.exit(0)

if args[0] == 'image' and len(args) >= 2 and args[1] == 'inspect':
    fmt = args[args.index('-f') + 1] if '-f' in args else args[args.index('--format') + 1]
    target = args[-1]
    entry = next((d for d in state['dangling'] if d['id'] == target), None)
    if entry is None:
        entry = next((t for t in state['tags'] if t['ref'] == target or t['id'] == target), None)
    if entry is None:
        fail(f'Error: No such image: {target}')
    if 'org.opencontainers.image.revision' in fmt:
        print(entry.get('revision', ''))
    elif 'com.smarterpoker.engine.build-contract' in fmt:
        print(entry.get('contract', ''))
    elif fmt == '{{.Id}}':
        print(entry['id'])
    else:
        fail(f'unexpected image inspect format: {fmt}')
    save()
    sys.exit(0)

if args[0] == 'image' and len(args) >= 2 and args[1] == 'rm':
    if '-f' in args or '--force' in args:
        fail(f'forbidden force removal: {args}')
    target = args[-1]
    # Simulate real Docker refusal when any container holds the image.
    held_refs = {c['image']: c for c in state['containers']}
    held_ids = {c['image_id']: c for c in state['containers']}
    tag_entry = next((t for t in state['tags'] if t['ref'] == target), None)
    dang_entry = next((d for d in state['dangling'] if d['id'] == target), None)
    if tag_entry is not None:
        if target in held_refs or tag_entry['id'] in held_ids:
            c = held_refs.get(target) or held_ids[tag_entry['id']]
            fail(f"Error response from daemon: conflict: unable to remove repository reference {target} (must force) - container {c['id'][:12]} is using its referenced image")
        state['tags'] = [t for t in state['tags'] if t['ref'] != target]
        state['removed'].append(target)
        save()
        sys.exit(0)
    if dang_entry is not None:
        if target in held_ids:
            c = held_ids[target]
            fail(f"Error response from daemon: conflict: unable to delete {target} (must be forced) - image is being used by stopped container {c['id'][:12]}")
        state['dangling'] = [d for d in state['dangling'] if d['id'] != target]
        state['removed'].append(target)
        save()
        sys.exit(0)
    fail(f'Error: No such image: {target}')

fail(f'unexpected docker invocation: {args}')
'''


class RetainEngineImagesTests(unittest.TestCase):
    def run_retention(self, *, desired_sha: str, leases: dict[str, str], docker_state: dict):
        with tempfile.TemporaryDirectory(prefix='retain-engine-images-') as tmp:
            root = Path(tmp).resolve()
            control = root / 'control'
            control.mkdir()
            script_copy = control / 'retain-engine-images.sh'
            shutil.copy2(SCRIPT, script_copy)
            script_copy.chmod(0o755)

            seal = control / 'engine-release-seal.py'
            seal.write_text(
                f'#!/usr/bin/env python3\n'
                f'import sys\n'
                f'assert sys.argv[1:] == ["get", "desired-sha"], sys.argv\n'
                f'print({desired_sha!r})\n'
            )
            seal.chmod(0o755)

            lease_root = root / 'leases'
            lease_root.mkdir(mode=0o700)
            for name, sha in leases.items():
                (lease_root / name).write_text(sha + '\n')

            bin_dir = root / 'bin'
            bin_dir.mkdir()

            def write_shim(name: str, content: str):
                p = bin_dir / name
                p.write_text(content)
                p.chmod(p.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

            write_shim('id', '#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi\n')
            write_shim(
                'timeout',
                '#!/usr/bin/env python3\n'
                'import os, sys\n'
                'args = sys.argv[1:]\n'
                'i = 0\n'
                'while i < len(args) and args[i].startswith("-"):\n'
                '    i += 1\n'
                'i += 1  # skip duration\n'
                'os.execvp(args[i], args[i:])\n',
            )
            write_shim('flock', '#!/bin/sh\nexit 0\n')
            write_shim('docker', FAKE_DOCKER)

            state_file = root / 'docker-state.json'
            docker_state = dict(docker_state)
            docker_state.setdefault('calls', [])
            docker_state.setdefault('removed', [])
            state_file.write_text(json.dumps(docker_state))

            env = dict(os.environ)
            env['PATH'] = f"{bin_dir}:{os.path.dirname(BASH4)}:/usr/bin:/bin"
            env['FAKE_DOCKER_STATE'] = str(state_file)
            env['ENGINE_RELEASE_IMAGE_LEASE_ROOT'] = str(lease_root)
            env['ENGINE_BUILD_LOCK_FILE'] = str(root / 'build.lock')
            env['IMAGE_REPO'] = 'club-arena-engine'
            env['CONTAINER'] = 'club-arena-engine'

            proc = subprocess.run(
                [BASH4, str(script_copy)],
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
            )
            final_state = json.loads(state_file.read_text())
            return proc, final_state

    def test_skips_container_referenced_images_and_removes_other_obsolete_tags(self):
        desired = sha40('aaaa0001')
        running = sha40('bbbb0002')
        leased = sha40('cccc0003')
        rollbacks = [sha40(f'1111000{i}') for i in range(1, 6)]

        # Unleased obsolete tags beyond the 5 rollback slots:
        exited_tag_sha = sha40('586e75fe')
        exited_by_id_sha = sha40('66660006')
        obsolete_1 = sha40('77770007')
        obsolete_2 = sha40('88880008')

        # Candidate tags: one held by an exited container, one unreferenced.
        cand_held = f'club-arena-engine:{sha40("99990009")}-candidate-42'
        cand_free = f'club-arena-engine:{sha40("99990010")}-candidate-43'

        # Dangling images:
        dangling_held = img_id('dddd0001')
        dangling_free = img_id('dddd0002')
        dangling_protected = img_id('dddd0003')
        dangling_foreign = img_id('dddd0004')

        exited_cid_tag = 'e380c9e43add' + ('0' * 52)
        exited_cid_id = 'f123456789ab' + ('0' * 52)
        exited_cid_cand = 'c123456789ab' + ('0' * 52)
        exited_cid_dang = 'd123456789ab' + ('0' * 52)

        state = {
            'containers': [
                {
                    'name': 'club-arena-engine',
                    'id': '111111111111' + ('0' * 52),
                    'image': f'club-arena-engine:{running}',
                    'image_id': img_id('bbbb0002'),
                    'status': 'Up 3 hours (healthy)',
                    'release_sha': running,
                },
                {
                    'id': exited_cid_tag,
                    'image': f'club-arena-engine:{exited_tag_sha}',
                    'image_id': img_id('586e75fe'),
                    'status': 'Exited (0) 19 days ago',
                },
                {
                    # Container created from short image ID rather than repo:tag
                    'id': exited_cid_id,
                    'image': '666600060000',
                    'image_id': img_id('66660006'),
                    'status': 'Exited (137) 5 days ago',
                },
                {
                    'id': exited_cid_cand,
                    'image': cand_held,
                    'image_id': img_id('99990009'),
                    'status': 'Exited (1) 2 days ago',
                },
                {
                    'id': exited_cid_dang,
                    'image': dangling_held,
                    'image_id': dangling_held,
                    'status': 'Exited (0) 10 days ago',
                },
            ],
            'tags': [
                {'ref': f'club-arena-engine:{desired}', 'id': img_id('aaaa0001')},
                {'ref': f'club-arena-engine:{running}', 'id': img_id('bbbb0002')},
                {'ref': f'club-arena-engine:{leased}', 'id': img_id('cccc0003')},
                *[{'ref': f'club-arena-engine:{r}', 'id': img_id(f'1111000{i}')} for i, r in enumerate(rollbacks, 1)],
                {'ref': f'club-arena-engine:{exited_tag_sha}', 'id': img_id('586e75fe')},
                {'ref': f'club-arena-engine:{exited_by_id_sha}', 'id': img_id('66660006')},
                {'ref': f'club-arena-engine:{obsolete_1}', 'id': img_id('77770007')},
                {'ref': f'club-arena-engine:{obsolete_2}', 'id': img_id('88880008')},
                {'ref': cand_held, 'id': img_id('99990009')},
                {'ref': cand_free, 'id': img_id('99990010')},
            ],
            'dangling': [
                {'id': dangling_held, 'revision': sha40('eeee0001'), 'contract': 'clean-server-archive-v1'},
                {'id': dangling_free, 'revision': sha40('eeee0002'), 'contract': 'clean-server-archive-v1'},
                {'id': dangling_protected, 'revision': desired, 'contract': 'clean-server-archive-v1'},
                {'id': dangling_foreign, 'revision': sha40('eeee0004'), 'contract': 'other-contract'},
            ],
        }

        proc, final_state = self.run_retention(
            desired_sha=desired,
            leases={'99999-1.lease': leased},
            docker_state=state,
        )

        self.assertEqual(proc.returncode, 0, f'stdout={proc.stdout}\nstderr={proc.stderr}')

        # (a) Referenced unleased tags/candidates/dangling are skipped with clear notice.
        self.assertIn(f'club-arena-engine:{exited_tag_sha}', proc.stdout)
        self.assertIn(exited_cid_tag, proc.stdout)
        self.assertIn('Exited (0) 19 days ago', proc.stdout)

        self.assertIn(f'club-arena-engine:{exited_by_id_sha}', proc.stdout)
        self.assertIn(exited_cid_id, proc.stdout)
        self.assertIn('Exited (137) 5 days ago', proc.stdout)

        self.assertIn(cand_held, proc.stdout)
        self.assertIn(exited_cid_cand, proc.stdout)

        self.assertIn(dangling_held, proc.stdout)
        self.assertIn(exited_cid_dang, proc.stdout)
        self.assertIn('skipped 4 container-referenced image(s)', proc.stdout)

        # (b) Unreferenced obsolete tags, candidate, and dangling image ARE removed.
        self.assertEqual(
            set(final_state['removed']),
            {
                f'club-arena-engine:{obsolete_1}',
                f'club-arena-engine:{obsolete_2}',
                cand_free,
                dangling_free,
            },
        )
        self.assertIn('removed 4;', proc.stdout)

        # (c) Sealed, running, leased, 5 rollback tags, referenced images, and foreign dangling stay intact.
        remaining_refs = {t['ref'] for t in final_state['tags']}
        expected_kept_refs = {
            f'club-arena-engine:{desired}',
            f'club-arena-engine:{running}',
            f'club-arena-engine:{leased}',
            *{f'club-arena-engine:{r}' for r in rollbacks},
            f'club-arena-engine:{exited_tag_sha}',
            f'club-arena-engine:{exited_by_id_sha}',
            cand_held,
        }
        self.assertEqual(remaining_refs, expected_kept_refs)

        remaining_dangling = {d['id'] for d in final_state['dangling']}
        self.assertEqual(remaining_dangling, {dangling_held, dangling_protected, dangling_foreign})

    def test_clean_host_with_no_skipped_images_keeps_clean_summary(self):
        desired = sha40('aaaa0001')
        rollbacks = [sha40(f'1111000{i}') for i in range(1, 6)]
        obsolete = sha40('77770007')

        state = {
            'containers': [
                {
                    'name': 'club-arena-engine',
                    'id': '111111111111' + ('0' * 52),
                    'image': f'club-arena-engine:{desired}',
                    'image_id': img_id('aaaa0001'),
                    'status': 'Up 1 hour (healthy)',
                    'release_sha': desired,
                },
            ],
            'tags': [
                {'ref': f'club-arena-engine:{desired}', 'id': img_id('aaaa0001')},
                *[{'ref': f'club-arena-engine:{r}', 'id': img_id(f'1111000{i}')} for i, r in enumerate(rollbacks, 1)],
                {'ref': f'club-arena-engine:{obsolete}', 'id': img_id('77770007')},
            ],
            'dangling': [],
        }

        proc, final_state = self.run_retention(
            desired_sha=desired,
            leases={},
            docker_state=state,
        )
        self.assertEqual(proc.returncode, 0, f'stdout={proc.stdout}\nstderr={proc.stderr}')
        self.assertEqual(final_state['removed'], [f'club-arena-engine:{obsolete}'])
        self.assertIn('retained sealed, running, leased, and 5 rollback engine tag(s); removed 1', proc.stdout)
        self.assertNotIn('skipped', proc.stdout)


if __name__ == '__main__':
    unittest.main()
