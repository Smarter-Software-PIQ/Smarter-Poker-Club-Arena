"""Finite blob hydration for isolated historical-source qualification only."""
from concurrent.futures import ThreadPoolExecutor
import os
import signal
import subprocess
import time


def hydrate_historical_sources(root, revisions, paths, budget_seconds=10, allow_fetch=True):
    """Fetch this fixture's missing pinned blobs once, never during behavior proof."""
    if not 0 < budget_seconds <= (90 if allow_fetch else 10):
        raise ValueError('Historical fixture hydration budget refused')
    deadline = time.monotonic() + budget_seconds
    cleanup_reserve = min(0.25, budget_seconds / 4)
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_NO_LAZY_FETCH='1', GIT_NO_REPLACE_OBJECTS='1', LC_ALL='C')
    def git(*args, data=None):
        remaining = deadline - time.monotonic()
        if remaining <= cleanup_reserve:
            raise RuntimeError('Historical fixture hydration deadline exhausted')
        command = ['git', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-C', str(root), *args]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env, start_new_session=True)
        def terminate_group():
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        try:
            stdout, stderr = process.communicate(input=data, timeout=remaining - cleanup_reserve)
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, command, stdout, stderr)
            return stdout
        except BaseException:
            terminate_group()
            # A transport helper may still own stdout/stderr after Git exits.
            # Join only our isolated process group under the reserved cleanup bound.
            process.communicate(timeout=cleanup_reserve)
            raise
        finally:
            terminate_group()
    revisions = sorted(set(revisions))
    if not revisions or any(len(rev) != 40 or any(ch not in '0123456789abcdef' for ch in rev)
                            for rev in revisions):
        raise ValueError('Historical fixture revision is not immutable')
    data = ('\n'.join(revisions) + '\n').encode()
    identities = git('cat-file', '--batch-check=%(objectname) %(objecttype)', data=data)
    if identities.decode().splitlines() != [rev + ' commit' for rev in revisions]:
        raise ValueError('Historical fixture commit unavailable')

    def pinned_tree(revision):
        objects = set()
        for record in git('ls-tree', '-rz', revision, '--', *paths).split(b'\0'):
            if not record: continue
            metadata, path = record.split(b'\t', 1)
            mode, kind, oid = metadata.decode().split()
            if kind != 'blob' or path.decode() not in paths or mode not in {'100644', '100755'}:
                raise ValueError('Historical fixture object shape refused')
            objects.add(oid)
        return objects

    # Immutable trees have independent paths. Read four at once under the
    # original shared deadline, including every child's cleanup reserve.
    with ThreadPoolExecutor(max_workers=4) as readers:
        objects = set().union(*readers.map(pinned_tree, revisions))
    if not objects or len(objects) > 128:
        raise ValueError('Historical fixture object closure refused')
    ordered = sorted(objects)
    data = ('\n'.join(ordered) + '\n').encode()
    def missing():
        rows = git('cat-file', '--batch-check', data=data).decode().splitlines()
        if len(rows) != len(ordered): raise ValueError('Historical fixture inventory incomplete')
        absent = []
        for oid, row in zip(ordered, rows):
            fields = row.split()
            if fields == [oid, 'missing']: absent.append(oid)
            elif len(fields) != 3 or fields[:2] != [oid, 'blob'] or not fields[2].isdigit() or not 0 < int(fields[2]) < 1048576:
                raise ValueError('Historical fixture blob identity refused')
        return absent
    absent = missing()
    if absent:
        if not allow_fetch:
            raise ValueError('Historical fixture source unavailable before network-free behavior')
        if git('config', '--bool', '--get', 'remote.origin.promisor').strip() != b'true':
            raise ValueError('Historical fixture missing objects without configured promisor')
        git('-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-tags',
            '--no-write-fetch-head', '--no-recurse-submodules', 'origin', '--stdin',
            data=('\n'.join(absent) + '\n').encode())
        if missing(): raise ValueError('Historical fixture hydration incomplete')
    return len(absent)
