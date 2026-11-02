#!/usr/bin/env python3
"""Local negatives only: no provider, credentials, or production reads."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile
import shutil

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('retention', ROOT / 'operations/release/native/original-web-retention.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def fixtures():
    p = m.PINS
    asset = {'id': p['asset_id'], 'name': 'artifact.zip', 'state': 'uploaded', 'size': p['bytes'],
             'digest': 'sha256:' + p['sha256'], 'content_type': 'application/zip',
             'url': 'https://api.github.com' + m.PREFIX + '/releases/assets/' + str(p['asset_id']),
             'uploader': {'id': p['uploader_id']}}
    release = {'id': p['release_id'], 'tag_name': p['release_tag'], 'target_commitish': p['original_source_sha'],
               'draft': True, 'published_at': None, 'prerelease': True,
               'url': 'https://api.github.com' + m.PREFIX + '/releases/' + str(p['release_id']),
               'assets_url': 'https://api.github.com' + m.PREFIX + '/releases/' + str(p['release_id']) + '/assets',
               'assets': [copy.deepcopy(asset)]}
    run = {'id': p['original_run_id'], 'head_sha': p['original_source_sha'],
           'repository': {'id': p['repository_id']}, 'head_repository': {'id': p['repository_id']},
           'event': 'push', 'head_branch': 'main', 'status': 'completed', 'conclusion': 'success',
           'path': '.github/workflows/publish-club-arena.yml'}
    return {m.PREFIX: {'id': p['repository_id'], 'full_name': m.REPO, 'private': False},
            m.PREFIX + '/actions/runs/41244053719': run,
            m.PREFIX + '/releases/430874424': release,
            m.PREFIX + '/releases/assets/699597073': asset}


class Fake:
    def __init__(self):
        self.values = fixtures()
        self.original_error = 'ORIGINAL_WEB_RETENTION_API_404'

    def metadata(self, route):
        if route.endswith('/actions/artifacts/13059295561'):
            raise m.RetentionError(self.original_error)
        return copy.deepcopy(self.values[route])


class Tests(unittest.TestCase):
    def test_historical_original_is_distinct_and_sealed(self):
        original, run, proof = m.admit(Fake())
        self.assertFalse(original['expired'])  # Historical bytes only.
        self.assertEqual(proof['basis'], 'sealed-historical-pre-expiry-metadata-original-api-404')
        self.assertEqual(proof['original_artifact_id'], 13059295561)
        self.assertNotEqual(proof['asset_id'], original['id'])
        with patch.dict(m.PINS, {'historical_metadata_sha256': '0' * 64}):
            with self.assertRaises(m.RetentionError):
                m.historical_metadata()

    def test_metadata_negative_controls(self):
        negatives = [('/releases/430874424', 'draft', False),
                     ('/releases/430874424', 'published_at', '2026-11-01T22:00:00Z'),
                     ('/releases/430874424', 'target_commitish', '0' * 40),
                     ('/releases/430874424', 'tag_name', 'different'),
                     ('/releases/assets/699597073', 'digest', 'sha256:' + '0' * 64),
                     ('/releases/assets/699597073', 'size', 193214433),
                     ('/releases/assets/699597073', 'state', 'new'),
                     ('/releases/assets/699597073', 'id', True),
                     ('/actions/runs/41244053719', 'conclusion', 'failure'),
                     ('/actions/runs/41244053719', 'event', 'workflow_dispatch'),
                     ('/actions/runs/41244053719', 'path', '.github/workflows/other.yml')]
        for route, key, value in negatives:
            with self.subTest(route=route, key=key):
                fake = Fake(); fake.values[m.PREFIX + route][key] = value
                with self.assertRaises(m.RetentionError):
                    m.admit(fake)
        fake = Fake(); fake.values[m.PREFIX + '/releases/430874424']['assets'] = []
        with self.assertRaises(m.RetentionError):
            m.admit(fake)
        for error in ('ORIGINAL_WEB_RETENTION_API_REFUSED', 'ORIGINAL_WEB_RETENTION_TRANSPORT_FAILED'):
            fake = Fake(); fake.original_error = error
            with self.assertRaises(m.RetentionError):
                m.admit(fake)

    def test_signed_transport_does_not_forward_auth_and_rejects_redirects(self):
        class Opener:
            def __init__(self): self.requests = []
            def open(self, request, timeout):
                self.requests.append(request)
                if len(self.requests) == 1:
                    raise urllib.error.HTTPError(request.full_url, 302, 'redirect',
                          {'Location': 'https://release-assets.githubusercontent.com/asset?signature=fixed'}, None)
                return io.BytesIO(b'fixed')
        with patch.dict(os.environ, {'GH_TOKEN': 'test-only-not-a-secret'}):
            transport = m.Transport()
        transport.opener = Opener()
        response = transport.open(m.PREFIX + '/releases/assets/699597073', binary=True)
        self.assertEqual(response.read(), b'fixed')
        self.assertIn('Authorization', transport.opener.requests[0].headers)
        self.assertNotIn('Authorization', transport.opener.requests[1].headers)
        for url in ('http://release-assets.githubusercontent.com/a?q=x',
                    'https://evil.example/a?q=x', 'https://release-assets.githubusercontent.com.evil.example/a?q=x',
                    'https://user:pass@release-assets.githubusercontent.com/a?q=x',
                    'https://release-assets.githubusercontent.com/a?q=x#fragment'):
            with self.assertRaises(m.RetentionError):
                transport.signed(url)
        with self.assertRaises(m.RetentionError):
            transport.open(m.PREFIX + '/arbitrary')

    def test_actual_zip_bytes_corruption_surplus_short_read_and_cleanup(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('index.html', '<p>retained</p>')
        payload = data.getvalue(); digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'exact.zip'
            m.stream_exact(io.BytesIO(payload), output, len(payload), digest)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read('index.html'), b'<p>retained</p>')
            with self.assertRaises(FileExistsError):
                m.stream_exact(io.BytesIO(payload), output, len(payload), digest)
            output.unlink()
            for invalid in (payload[:-1], payload + b'x', payload[:40] + bytes([payload[40] ^ 1]) + payload[41:]):
                with self.assertRaises(m.RetentionError):
                    m.stream_exact(io.BytesIO(invalid), output, len(payload), digest)
                self.assertFalse(output.exists())
            with patch.object(m.time, 'monotonic', side_effect=[0, 0, 0, 0, 121]):
                with self.assertRaisesRegex(m.RetentionError, 'ORIGINAL_WEB_RETENTION_DEADLINE'):
                    m.stream_exact(io.BytesIO(payload), output, len(payload), digest)
            self.assertFalse(output.exists())

    def test_postread_carrier_change_deletes_owned_zip_and_bad_tuple_never_reads(self):
        payload = b'exact retained bytes'
        digest = hashlib.sha256(payload).hexdigest()
        class Response(io.BytesIO):
            status = 200
        class Binary:
            def __init__(self): self.calls = 0
            def open(self, route, binary=False):
                self.calls += 1
                return Response(payload)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'original.zip'
            transport = Binary()
            with self.assertRaises(m.RetentionError):
                m.download(output, 'other', '13059295561', transport)
            self.assertEqual(transport.calls, 0)
            with patch.dict(m.PINS, {'bytes': len(payload), 'sha256': digest}), \
                 patch.object(m, 'admit', side_effect=[({}, {}, {'draft': True}), m.RetentionError('ORIGINAL_WEB_RETENTION_REFUSED')]):
                with self.assertRaises(m.RetentionError):
                    m.download(output, '41244053719', '13059295561', transport)
            self.assertFalse(output.exists())
            self.assertEqual(transport.calls, 1)

    def test_unauthorized_api_and_second_redirect_fail_closed(self):
        class Refused:
            def __init__(self, status): self.status = status
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, self.status, 'private raw error', {}, None)
        with patch.dict(os.environ, {'GH_TOKEN': 'test-only-not-a-secret'}):
            transport = m.Transport()
        for status in (401, 403, 404, 500):
            transport.opener = Refused(status)
            with self.assertRaises(m.RetentionError) as result:
                transport.open(m.PREFIX + '/releases/assets/699597073', binary=True)
            self.assertNotIn('private raw error', str(result.exception))
        transport.opener = Refused(302)
        with self.assertRaises(m.RetentionError):
            transport.signed('https://release-assets.githubusercontent.com/asset?signature=fixed')

    def test_workflow_and_original_tuple_source_wiring(self):
        source = (ROOT / 'operations/release/native/observe-connected-ui.py').read_text()
        self.assertIn("retention.download_staged(archive, web_run, web_id)", source)
        self.assertIn("native.validate_web(archive, web, template['supabase_host'])", source)
        self.assertIn("'build_run_id': web_run", source)
        self.assertIn("'original-web-retention.json'", source.replace('operations/release/native/', ''))
        generic = (ROOT / 'operations/release/native/qualify-components.py').read_text()
        self.assertIn("not info['expired']", generic)
        workflow = (ROOT / '.github/workflows/component-fixture-native-smoke.yml').read_text()
        self.assertLess(workflow.index('original-web-retention.py --admit-staged'), workflow.index('actions/setup-node@'))
        admission = workflow.split('      - name: Admit the fixed original ZIP before private capture or native build\n', 1)[1].split('      - ', 1)[0]
        self.assertEqual([line.strip() for line in admission.splitlines() if line.strip().startswith('if:')],
                         ['if: inputs.connected_ui_observations'])
        self.assertIn('  contents: read\n  actions: read', workflow)
        self.assertIn('python3 -B tests/operations/original-web-retention.test.py', workflow)
        inventory = (ROOT / 'operations/release/ci/fixture-smoke.py').read_text()
        for name in ('original-web-retention.py', 'original-web-retention.json', 'original-web-artifact-api.json'):
            self.assertIn("'" + name + "'", inventory)
        caller = (ROOT / '.github/workflows/schema-manifest-refresh.yml').read_text()
        self.assertIn("web_artifact_run_id: '41244053719'", caller)
        self.assertIn("web_artifact_id: '13059295561'", caller)
        producer = caller.split('  retain-original-web:\n', 1)[1].split('  isolated-connected-ui:', 1)[0]
        self.assertIn('contents: write', producer)
        self.assertIn('actions: read', producer)
        self.assertIn('persist-credentials: false', producer)
        self.assertIn('original-web-retention.py --stage', producer)
        self.assertNotIn('DATABASE_URL', producer)
        self.assertNotIn('npm ', producer)
        self.assertNotIn('fixture-smoke.py', producer)
        self.assertNotIn('uses: ./.github/workflows/', producer)
        self.assertEqual(producer.count('GH_TOKEN:'), 1)
        self.assertIn('needs: retain-original-web', caller)
        self.assertIn('retained_web_artifact_id: ${{ needs.retain-original-web.outputs.artifact_id }}', caller)
        self.assertIn('artifact-ids: ${{ inputs.retained_web_artifact_id }}', workflow)
        self.assertNotIn('github-token:', workflow)
        self.assertNotIn('contents: write', workflow)
        self.assertNotIn('run-id:', workflow)
        self.assertNotIn('GH_TOKEN', admission)



    def test_current_run_transfer_is_context_bound_and_rehashes_original(self):
        payload = b'exact retained bytes'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / m.STAGED_NAME
            path.mkdir(mode=0o700)
            context = {'repository': m.REPO, 'repository_id': m.PINS['repository_id'],
                       'source_sha': 'a' * 40, 'run_id': '123', 'run_attempt': '1'}
            env = {'RUNNER_TEMP': directory, 'GITHUB_REPOSITORY': m.REPO,
                   'GITHUB_REPOSITORY_ID': str(m.PINS['repository_id']), 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                   'GITHUB_REF': 'refs/heads/main', 'GITHUB_WORKFLOW_REF': m.REPO + '/.github/workflows/schema-manifest-refresh.yml@refs/heads/main',
                   'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_JOB': 'retain-original-web'}
            _, run, evidence = m.admit(Fake())
            original = m.historical_metadata()
            def copied(output, *args):
                Path(output).write_bytes(payload)
                Path(output).chmod(0o600)
                return original, run, evidence
            with patch.dict(os.environ, env), patch.object(m, 'download', side_effect=copied):
                m.stage()
            self.assertEqual({p.name for p in path.iterdir()}, {'artifact.zip', 'receipt.json'})
            # The production pin is never changed; this small fixture isolates
            # the same bounded byte-hash transport primitive and trust context.
            with patch.dict(os.environ, env), patch.dict(m.PINS, {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}), \
                 patch.object(m, 'historical_metadata', return_value=original):
                receipt_path = path / 'receipt.json'
                receipt = json.loads(receipt_path.read_text())
                receipt['retention'].update(bytes=m.PINS['bytes'], sha256=m.PINS['sha256'])
                receipt_path.write_text(json.dumps(receipt))
                for member in path.iterdir(): member.chmod(0o644)
                m.protect_staged()
                self.assertTrue(all(member.stat().st_mode & 0o777 == 0o600 for member in path.iterdir()))
                info, observed_run, proof = m.admit_staged()
                self.assertEqual(info, original); self.assertEqual(observed_run, m.run_projection(run))
                self.assertEqual(proof['current_run_transfer'], context)
                output = Path(directory) / 'copy.zip'
                m.download_staged(output, '41244053719', '13059295561')
                self.assertEqual(output.read_bytes(), payload)
                with self.assertRaises(FileExistsError): m.download_staged(output, '41244053719', '13059295561')
                self.assertEqual(output.read_bytes(), payload)
                output.unlink()
                stream = m.stream_exact
                def changed_after_copy(*args):
                    stream(*args)
                    (path / 'artifact.zip').chmod(0o644)
                with patch.object(m, 'stream_exact', side_effect=changed_after_copy), self.assertRaises(m.RetentionError):
                    m.download_staged(output, '41244053719', '13059295561')
                self.assertFalse(output.exists())
                (path / 'artifact.zip').chmod(0o600)

                for key, value in [('GITHUB_RUN_ID', '124'), ('GITHUB_RUN_ATTEMPT', '2'),
                                   ('GITHUB_SHA', 'b' * 40), ('GITHUB_REF', 'refs/heads/other'),
                                   ('GITHUB_REPOSITORY_ID', '42'), ('GITHUB_EVENT_NAME', 'pull_request')]:
                    with patch.dict(os.environ, {key: value}), self.assertRaises(m.RetentionError):
                        m.admit_staged()
                for key, value in [('context', context | {'run_id': '124'}),
                                   ('original_metadata', {}), ('original_run', run | {'event': 'workflow_dispatch'}),
                                   ('retention', evidence | {'draft': False}), ('extra', 'private')]:
                    receipt_path.write_text(json.dumps(receipt | {key: value}))
                    with self.assertRaises(m.RetentionError): m.admit_staged()
                receipt_path.write_text(json.dumps(receipt))
                (path / 'artifact.zip').write_bytes(payload[:-1] + b'X')
                with self.assertRaisesRegex(m.RetentionError, 'DIGEST'): m.admit_staged()
                (path / 'artifact.zip').unlink(); (path / 'artifact.zip').symlink_to('/not-followed')
                with self.assertRaises((m.RetentionError, OSError)): m.admit_staged()
                with self.assertRaises((m.RetentionError, OSError)): m.protect_staged()

    def test_closed_api_diagnostics_name_fixed_route_and_http_status(self):
        with patch.dict(os.environ, {'GH_TOKEN': 'test-only-not-a-secret'}):
            transport = m.Transport()
        class Refused:
            def __init__(self, code): self.code = code
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, self.code, 'private raw error', {}, None)
        for status in (401, 403, 404, 500):
            transport.opener = Refused(status)
            with self.assertRaisesRegex(m.RetentionError, 'ORIGINAL_WEB_RETENTION_DRAFT_RELEASE_HTTP_' + str(status)):
                transport.open(m.PREFIX + '/releases/430874424')
        transport.opener = Refused(404)
        with self.assertRaisesRegex(m.RetentionError, '^ORIGINAL_WEB_RETENTION_API_404$'):
            transport.open(m.PREFIX + '/actions/artifacts/13059295561')


if __name__ == '__main__':
    unittest.main()
