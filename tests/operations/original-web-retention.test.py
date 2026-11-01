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
        self.assertIn("retention.download(archive, web_run, web_id)", source)
        self.assertIn("native.validate_web(archive, web, template['supabase_host'])", source)
        self.assertIn("'build_run_id': web_run", source)
        self.assertIn("'original-web-retention.json'", source.replace('operations/release/native/', ''))
        generic = (ROOT / 'operations/release/native/qualify-components.py').read_text()
        self.assertIn("not info['expired']", generic)
        workflow = (ROOT / '.github/workflows/component-fixture-native-smoke.yml').read_text()
        self.assertLess(workflow.index('original-web-retention.py --admit'), workflow.index('actions/setup-node@'))
        admission = workflow.split('      - name: Admit the fixed unpublished original-input carrier read-only\n', 1)[1].split('      - ', 1)[0]
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


if __name__ == '__main__':
    unittest.main()
