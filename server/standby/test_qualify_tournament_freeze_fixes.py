"""Qualification admission tests; no Docker, network or database is contacted."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'qualification', Path(__file__).with_name('qualify-tournament-freeze-fixes.py'))
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class QualificationAdmission(unittest.TestCase):
    def test_running_label_cannot_substitute_for_health_identity(self):
        sha = 'a' * 40
        with patch.object(qualification, 'run', side_effect=['', '10.1.0.0/16', '', json.dumps([{'Config': {'Labels': {'com.smarterpoker.standby.sha': sha}}}])]), \
             patch.object(qualification.urllib.request, 'urlopen',
                          return_value=io.BytesIO(json.dumps({'releaseSha': 'b' * 40}).encode())):
            with self.assertRaisesRegex(RuntimeError, 'running SHA differs'):
                qualification.identity(sha)

    def test_health_cannot_substitute_for_container_label(self):
        sha = 'a' * 40
        with patch.object(qualification, 'run', side_effect=['', '10.1.0.0/16', '', json.dumps([{'Config': {'Labels': {'com.smarterpoker.standby.sha': 'b' * 40}}}])]), \
             patch.object(qualification.urllib.request, 'urlopen',
                          return_value=io.BytesIO(json.dumps({'releaseSha': sha}).encode())):
            with self.assertRaisesRegex(RuntimeError, 'running SHA differs'):
                qualification.identity(sha)

    def test_readback_requires_exact_definition_and_authority(self):
        expected = {'definitionMd5': '77139e22bafa9d6d2d47f54ae25be663',
                    'bodyMd5': '00230601eeb8de97fafcbed4074a782d',
                    'owner': 'postgres', 'acl': '{postgres=X/postgres}',
                    'securityDefiner': True,
                    'config': ['search_path=pg_catalog, public, smarter_private']}
        with patch.object(qualification, 'run', return_value=json.dumps(expected)):
            self.assertEqual(qualification.readback(), expected)
        for field, replacement in [('definitionMd5', 'wrong'), ('owner', 'service_role'),
                                   ('acl', None), ('securityDefiner', False), ('config', [])]:
            with self.subTest(field=field), patch.object(
                    qualification, 'run', return_value=json.dumps({**expected, field: replacement})):
                with self.assertRaisesRegex(RuntimeError, 'definition or authority differs'):
                    qualification.readback()

    def test_missing_instance_or_unhealthy_container_is_refused(self):
        sha = 'a' * 40
        for state, health in [({'Running': False}, {'instanceId': 'one', 'liveness': 'ok'}),
                              ({'Running': True}, {'liveness': 'ok'}),
                              ({'Running': True, 'Health': {'Status': 'unhealthy'}},
                               {'instanceId': 'one', 'liveness': 'ok'})]:
            container = {'Config': {'Labels': {'com.smarterpoker.standby.sha': sha}}, 'State': state}
            with self.subTest(state=state, health=health), patch.object(
                    qualification, 'run', side_effect=['', '10.1.0.0/16', '', json.dumps([container])]), \
                 patch.object(qualification.urllib.request, 'urlopen',
                              return_value=io.BytesIO(json.dumps({'releaseSha': sha, **health}).encode())):
                with self.assertRaisesRegex(RuntimeError, 'healthy instance identity'):
                    qualification.identity(sha)


if __name__ == '__main__':
    unittest.main()
