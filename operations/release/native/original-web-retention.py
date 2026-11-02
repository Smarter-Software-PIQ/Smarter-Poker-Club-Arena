#!/usr/bin/env python3
"""Fixed original input retention. Read-only; never publishes or renews provenance.

The protected pin seals historical pre-expiry metadata, not a claim that the
expired Actions artifact is currently available. Its exact bytes are carried by
one unpublished draft asset. Generic Actions artifact admission stays unchanged.
"""
import hashlib
import contextlib
import json
import os
import re
from pathlib import Path
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / 'original-web-retention.json').read_text())
REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
PREFIX = '/repos/' + REPO
METADATA_LIMIT = 2 * 1024 * 1024
READ_SECONDS = 120


class RetentionError(RuntimeError):
    pass


def require(ok, code='ORIGINAL_WEB_RETENTION_REFUSED'):
    if not ok:
        raise RetentionError(code)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Transport:
    """Only fixed same-repository authenticated API reads; no raw errors escape."""
    def __init__(self):
        self.opener = urllib.request.build_opener(NoRedirect())
        self.token = os.environ.get('GH_TOKEN')
        require(bool(self.token), 'ORIGINAL_WEB_RETENTION_TOKEN_REQUIRED')

    def open(self, route, binary=False):
        allowed = {PREFIX, PREFIX + '/actions/artifacts/13059295561',
                   PREFIX + '/actions/runs/41244053719', PREFIX + '/releases/430874424',
                   PREFIX + '/releases/assets/699597073'}
        require(route in allowed)
        headers = {'Authorization': 'Bearer ' + self.token,
                   'Accept': 'application/octet-stream' if binary else 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28'}
        request = urllib.request.Request('https://api.github.com' + route, headers=headers)
        try:
            return self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            if binary and error.code == 302:
                location = error.headers.get('Location', '')
                error.close()
                return self.signed(location)
            code = error.code
            error.close()
            if code == 404 and route == PREFIX + '/actions/artifacts/13059295561':
                raise RetentionError('ORIGINAL_WEB_RETENTION_API_404') from None
            label = {PREFIX: 'REPOSITORY', PREFIX + '/actions/runs/41244053719': 'ORIGINAL_RUN',
                     PREFIX + '/actions/artifacts/13059295561': 'ORIGINAL_ARTIFACT',
                     PREFIX + '/releases/430874424': 'DRAFT_RELEASE',
                     PREFIX + '/releases/assets/699597073': 'DRAFT_ASSET'}[route]
            status = str(code) if type(code) is int and 100 <= code <= 599 else 'UNKNOWN'
            raise RetentionError('ORIGINAL_WEB_RETENTION_' + label + '_HTTP_' + status) from None
        except (OSError, ValueError):
            raise RetentionError('ORIGINAL_WEB_RETENTION_TRANSPORT_FAILED') from None

    def signed(self, location):
        parsed = urllib.parse.urlsplit(location)
        require(parsed.scheme == 'https' and parsed.hostname == 'release-assets.githubusercontent.com' and
                parsed.port in (None, 443) and not parsed.username and not parsed.password and
                not parsed.fragment and bool(parsed.query), 'ORIGINAL_WEB_RETENTION_REDIRECT_REFUSED')
        # No Authorization, cookies, credentials, or subsequent redirects.
        try:
            return self.opener.open(urllib.request.Request(location, headers={'Accept': 'application/octet-stream'}), timeout=30)
        except urllib.error.HTTPError as error:
            error.close()
            raise RetentionError('ORIGINAL_WEB_RETENTION_SIGNED_READ_FAILED') from None
        except (OSError, ValueError):
            raise RetentionError('ORIGINAL_WEB_RETENTION_SIGNED_READ_FAILED') from None

    def metadata(self, route):
        with self.open(route) as response:
            require(response.status == 200)
            data = response.read(METADATA_LIMIT + 1)
        require(len(data) <= METADATA_LIMIT)
        try:
            value = json.loads(data)
        except (ValueError, UnicodeError):
            raise RetentionError('ORIGINAL_WEB_RETENTION_METADATA_INVALID') from None
        require(isinstance(value, dict))
        return value


def historical_metadata():
    # Exact protected constants prevent arbitrary manifest/tuple reuse.
    require(PINS['version'] == 1 and PINS['repository'] == REPO and
            PINS['repository_id'] == 1132369872 and PINS['repository_private'] is False and
            PINS['original_run_id'] == 41244053719 and PINS['original_artifact_id'] == 13059295561 and
            PINS['original_source_sha'] == '24b2998349b2aed7f94b3bf9dad55ea81abef36c' and
            PINS['bytes'] == 193214432 and
            PINS['sha256'] == '0646a9647cffb7d23d57c92bb0a0ae1e47ab7f6259eaf3a4ca54e41aa959cf0e' and
            PINS['release_id'] == 430874424 and PINS['asset_id'] == 699597073 and
            PINS['release_tag'] == 'qualification-retention-original-web-13059295561-01a190a0' and
            PINS['uploader_id'] == 254329056)
    data = (HERE / 'original-web-artifact-api.json').read_bytes()
    require(hashlib.sha256(data).hexdigest() == PINS['historical_metadata_sha256'])
    info = json.loads(data)
    run = info['workflow_run']
    require(info['id'] == PINS['original_artifact_id'] and info['expired'] is False and
            info['name'] == 'club-arena-dist-' + PINS['original_source_sha'] and
            info['size_in_bytes'] == PINS['bytes'] and info['digest'] == 'sha256:' + PINS['sha256'] and
            info['expires_at'] == '2026-11-01T21:37:35Z' and
            info['created_at'] == '2026-10-31T21:37:43Z' and
            run['id'] == PINS['original_run_id'] and run['head_sha'] == PINS['original_source_sha'] and
            run['repository_id'] == PINS['repository_id'] and run['head_repository_id'] == PINS['repository_id'] and
            run['head_branch'] == 'main')
    return info


def asset_projection(asset):
    expected = {'id': PINS['asset_id'], 'name': 'artifact.zip', 'state': 'uploaded',
                'size': PINS['bytes'], 'digest': 'sha256:' + PINS['sha256'],
                'content_type': 'application/zip',
                'url': 'https://api.github.com' + PREFIX + '/releases/assets/' + str(PINS['asset_id'])}
    require(all(type(asset.get(key)) is type(value) and asset.get(key) == value for key, value in expected.items()))
    require(asset['uploader']['id'] == PINS['uploader_id'])
    return expected


def admit(transport=None):
    transport = transport or Transport()
    historical = historical_metadata()
    repo = transport.metadata(PREFIX)
    require(type(repo.get('id')) is int and repo['id'] == PINS['repository_id'] and
            repo['full_name'] == REPO and repo['private'] is False)
    run = transport.metadata(PREFIX + '/actions/runs/' + str(PINS['original_run_id']))
    require(type(run.get('id')) is int and run['id'] == PINS['original_run_id'] and
            run['head_sha'] == PINS['original_source_sha'] and run['repository']['id'] == PINS['repository_id'] and
            run['head_repository']['id'] == PINS['repository_id'] and run['event'] == 'push' and
            run['head_branch'] == 'main' and run['status'] == 'completed' and run['conclusion'] == 'success' and
            run['path'] == '.github/workflows/publish-club-arena.yml')
    # Only the fixed original's positively observed provider 404 permits this
    # historical route. Authentication/authorization/network failures never do.
    try:
        transport.metadata(PREFIX + '/actions/artifacts/' + str(PINS['original_artifact_id']))
    except RetentionError as error:
        require(str(error) == 'ORIGINAL_WEB_RETENTION_API_404')
    else:
        raise RetentionError('ORIGINAL_WEB_RETENTION_ORIGINAL_404_REQUIRED')
    release = transport.metadata(PREFIX + '/releases/' + str(PINS['release_id']))
    require(type(release.get('id')) is int and release['id'] == PINS['release_id'] and
            release['tag_name'] == PINS['release_tag'] and release['target_commitish'] == PINS['original_source_sha'] and
            release['draft'] is True and release['published_at'] is None and release['prerelease'] is True and
            release['url'] == 'https://api.github.com' + PREFIX + '/releases/' + str(PINS['release_id']) and
            release['assets_url'] == 'https://api.github.com' + PREFIX + '/releases/' + str(PINS['release_id']) + '/assets' and
            isinstance(release['assets'], list) and len(release['assets']) == 1)
    embedded = asset_projection(release['assets'][0])
    asset = transport.metadata(PREFIX + '/releases/assets/' + str(PINS['asset_id']))
    require(asset_projection(asset) == embedded)
    evidence = {'version': 1, 'basis': 'sealed-historical-pre-expiry-metadata-original-api-404',
                'original_artifact_id': PINS['original_artifact_id'], 'original_run_id': PINS['original_run_id'],
                'release_id': PINS['release_id'], 'asset_id': PINS['asset_id'], 'draft': True,
                'sha256': PINS['sha256'], 'bytes': PINS['bytes'],
                'historical_metadata_sha256': PINS['historical_metadata_sha256']}
    return historical, run, evidence


def stream_exact(response, output, size, digest):
    """Internal bounded transport primitive; production only passes protected pins."""
    path = Path(output)
    require(path.parent.is_dir() and not path.parent.is_symlink())
    parent = path.parent.stat()
    require(parent.st_uid == os.getuid() and stat.S_IMODE(parent.st_mode) == 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    owned = os.fstat(fd)
    success = False
    try:
        total, checksum, started = 0, hashlib.sha256(), time.monotonic()
        with os.fdopen(fd, 'wb') as target:
            while True:
                require(time.monotonic() - started < READ_SECONDS, 'ORIGINAL_WEB_RETENTION_DEADLINE')
                data = response.read(min(1024 * 1024, size - total + 1))
                require(time.monotonic() - started < READ_SECONDS, 'ORIGINAL_WEB_RETENTION_DEADLINE')
                if not data:
                    break
                total += len(data)
                require(total <= size, 'ORIGINAL_WEB_RETENTION_SIZE')
                checksum.update(data)
                target.write(data)
            require(total == size and checksum.hexdigest() == digest, 'ORIGINAL_WEB_RETENTION_DIGEST')
        success = True
    finally:
        if not success:
            try:
                current = path.lstat()
                if (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino):
                    path.unlink()
            except FileNotFoundError:
                pass


def download(output, original_run, original_artifact, transport=None):
    require(original_run == str(PINS['original_run_id']) and original_artifact == str(PINS['original_artifact_id']))
    transport = transport or Transport()
    info, run, before = admit(transport)
    with transport.open(PREFIX + '/releases/assets/' + str(PINS['asset_id']), binary=True) as response:
        require(response.status == 200)
        stream_exact(response, output, PINS['bytes'], PINS['sha256'])
    try:
        _, _, after = admit(transport)
        require(before == after)
    except BaseException:
        Path(output).unlink()
        raise
    return info, run, before


STAGED_NAME = 'original-web-retention'
STAGED_RECEIPT = 'receipt.json'


def staged_context():
    require(os.environ.get('GITHUB_REPOSITORY') == REPO and
            os.environ.get('GITHUB_REPOSITORY_ID') == str(PINS['repository_id']) and
            os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and
            os.environ.get('GITHUB_REF') == 'refs/heads/main' and
            os.environ.get('GITHUB_WORKFLOW_REF') == REPO + '/.github/workflows/schema-manifest-refresh.yml@refs/heads/main',
            'ORIGINAL_WEB_RETENTION_PROTECTED_CONTEXT_REQUIRED')
    sha, run, attempt = (os.environ.get(key, '') for key in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    require(re.fullmatch('[0-9a-f]{40}', sha) and re.fullmatch('[1-9][0-9]*', run) and
            re.fullmatch('[1-9][0-9]*', attempt), 'ORIGINAL_WEB_RETENTION_PROTECTED_CONTEXT_REQUIRED')
    return {'repository': REPO, 'repository_id': PINS['repository_id'],
            'source_sha': sha, 'run_id': run, 'run_attempt': attempt}


def staged_directory():
    root = Path(os.environ['RUNNER_TEMP'])
    require(root.is_absolute() and root.is_dir() and not root.is_symlink())
    directory = root / STAGED_NAME
    require(directory.is_dir() and not directory.is_symlink() and
            directory.stat().st_uid == os.getuid() and stat.S_IMODE(directory.stat().st_mode) == 0o700)
    return directory


@contextlib.contextmanager
def staged_file(name, limit):
    require(name in {'artifact.zip', STAGED_RECEIPT})
    directory = staged_directory()
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fd = None
    try:
        owner = os.fstat(parent)
        require(owner.st_uid == os.getuid() and stat.S_IMODE(owner.st_mode) == 0o700)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1 and
                stat.S_IMODE(before.st_mode) == 0o600 and before.st_size <= limit)
        with os.fdopen(fd, 'rb') as source:
            fd = None
            yield source
            after = os.fstat(source.fileno())
            identity = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
            require(identity(before) == identity(after))
    finally:
        if fd is not None: os.close(fd)
        os.close(parent)


def protect_staged():
    # Actions artifact transport normalizes file permissions. Adopt only the
    # two owned regular files through no-follow FDs, before strict validation.
    staged_context()
    directory = staged_directory()
    require({path.name for path in directory.iterdir()} == {'artifact.zip', STAGED_RECEIPT})
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        owner = os.fstat(parent)
        require(owner.st_uid == os.getuid() and stat.S_IMODE(owner.st_mode) == 0o700)
        for name in ('artifact.zip', STAGED_RECEIPT):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            try:
                value = os.fstat(fd)
                require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1 and
                        stat.S_IMODE(value.st_mode) in {0o600, 0o644})
                os.fchmod(fd, 0o600)
            finally: os.close(fd)
    finally: os.close(parent)


def run_projection(run):
    expected = {'id': PINS['original_run_id'], 'head_sha': PINS['original_source_sha'],
                'repository': {'id': PINS['repository_id']}, 'head_repository': {'id': PINS['repository_id']},
                'event': 'push', 'head_branch': 'main', 'status': 'completed', 'conclusion': 'success',
                'path': '.github/workflows/publish-club-arena.yml'}
    require(all(type(run.get(key)) is type(value) and
                (run[key].get('id') == value['id'] if isinstance(value, dict) else run[key] == value)
                for key, value in expected.items()))
    return expected


def stage():
    context = staged_context()
    require(os.environ.get('GITHUB_JOB') == 'retain-original-web')
    directory = staged_directory()
    require(not list(directory.iterdir()))
    info, run, evidence = download(directory / 'artifact.zip', str(PINS['original_run_id']), str(PINS['original_artifact_id']))
    receipt = {'version': 1, 'context': context, 'original_metadata': info,
               'original_run': run_projection(run), 'retention': evidence}
    path = directory / STAGED_RECEIPT
    with path.open('x') as output:
        os.chmod(path, 0o600)
        json.dump(receipt, output, sort_keys=True, separators=(',', ':'))
        output.write('\n')


def admit_staged():
    context = staged_context()
    directory = staged_directory()
    require({path.name for path in directory.iterdir()} == {'artifact.zip', STAGED_RECEIPT})
    with staged_file(STAGED_RECEIPT, 32768) as source:
        raw = source.read(32769)
    require(len(raw) <= 32768)
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value)
            value[key] = item
        return value
    receipt = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(receipt, dict) and set(receipt) == {'version', 'context', 'original_metadata', 'original_run', 'retention'} and
            type(receipt['version']) is int and receipt['version'] == 1 and receipt['context'] == context)
    info = historical_metadata()
    require(receipt['original_metadata'] == info and receipt['original_run'] == run_projection(receipt['original_run']))
    evidence = receipt['retention']
    require(isinstance(evidence, dict) and evidence == {
        'version': 1, 'basis': 'sealed-historical-pre-expiry-metadata-original-api-404',
        'original_artifact_id': PINS['original_artifact_id'], 'original_run_id': PINS['original_run_id'],
        'release_id': PINS['release_id'], 'asset_id': PINS['asset_id'], 'draft': True,
        'sha256': PINS['sha256'], 'bytes': PINS['bytes'],
        'historical_metadata_sha256': PINS['historical_metadata_sha256']})
    checksum = hashlib.sha256()
    started = time.monotonic()
    with staged_file('artifact.zip', PINS['bytes']) as source:
        size = 0
        while data := source.read(1024 * 1024):
            require(time.monotonic() - started < READ_SECONDS, 'ORIGINAL_WEB_RETENTION_DEADLINE')
            size += len(data)
            require(size <= PINS['bytes'])
            checksum.update(data)
    require(size == PINS['bytes'] and checksum.hexdigest() == PINS['sha256'], 'ORIGINAL_WEB_RETENTION_DIGEST')
    return info, receipt['original_run'], {**evidence, 'current_run_transfer': context}


def download_staged(output, original_run, original_artifact):
    require(original_run == str(PINS['original_run_id']) and original_artifact == str(PINS['original_artifact_id']))
    info, run, evidence = admit_staged()
    created = None
    try:
        with staged_file('artifact.zip', PINS['bytes']) as source:
            stream_exact(source, output, PINS['bytes'], PINS['sha256'])
            value = Path(output).lstat()
            created = (value.st_dev, value.st_ino)
    except BaseException:
        if created is not None:
            value = Path(output).lstat()
            if (value.st_dev, value.st_ino) == created: Path(output).unlink()
        raise
    return info, run, evidence


def main():
    if sys.argv[1:] == ['--admit']:
        admit()
    elif sys.argv[1:] == ['--stage']:
        stage()
    elif sys.argv[1:] == ['--admit-staged']:
        protect_staged()
        admit_staged()
    else:
        require(False)
    print('ORIGINAL_WEB_RETENTION_READ_ONLY_ADMISSION_PASS')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if type(error) is RetentionError else 'ORIGINAL_WEB_RETENTION_FAILED', file=sys.stderr)
        sys.exit(1)
