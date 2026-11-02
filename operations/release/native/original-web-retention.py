#!/usr/bin/env python3
"""Fixed original input retention. Read-only; never publishes or renews provenance.

The protected pin seals historical pre-expiry metadata, not a claim that the
expired Actions artifact is currently available. Its exact bytes are carried by
one unpublished draft asset. Generic Actions artifact admission stays unchanged.
"""
import hashlib
import json
import os
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
            if code == 404:
                raise RetentionError('ORIGINAL_WEB_RETENTION_API_404') from None
            raise RetentionError('ORIGINAL_WEB_RETENTION_API_REFUSED') from None
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


def main():
    require(sys.argv[1:] == ['--admit'])
    # Caller job context owns eligibility. This fixed reader has no writes,
    # mutation APIs, configurable route, downloads, or permission escalation.
    admit()
    print('ORIGINAL_WEB_RETENTION_READ_ONLY_ADMISSION_PASS')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if type(error) is RetentionError else 'ORIGINAL_WEB_RETENTION_FAILED', file=sys.stderr)
        sys.exit(1)
