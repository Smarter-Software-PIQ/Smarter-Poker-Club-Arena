"""Qualification admission tests; no Docker, network or database is contacted."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'qualification', Path(__file__).with_name('qualify-tournament-freeze-fixes.py'))
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class QualificationAdmission(unittest.TestCase):
    def test_postgres_build_resolves_the_running_image_by_repository_digest_and_platform(self):
        image = 'sha256:' + 'a' * 64
        reference = 'public.ecr.aws/supabase/postgres@sha256:' + 'b' * 64
        with patch.object(qualification, 'run', side_effect=[
                f'{image} linux/amd64 {json.dumps([reference])}', f'{image} linux/amd64']) as inspect:
            self.assertEqual(qualification.postgres_build_base(image), (reference, 'linux/amd64'))
            self.assertEqual(inspect.call_args.args[0][-1], reference)
        for digests, resolved in [([image], None), (['postgres:17'], None), ([], None),
                                  ([reference], f'{image} linux/arm64'),
                                  ([reference], 'sha256:' + 'c' * 64 + ' linux/amd64')]:
            responses = [f'{image} linux/amd64 {json.dumps(digests)}']
            if resolved:
                responses.append(resolved)
            with self.subTest(digests=digests, resolved=resolved), patch.object(
                    qualification, 'run', side_effect=responses):
                with self.assertRaisesRegex(RuntimeError, 'no immutable repository digest'):
                    qualification.postgres_build_base(image)

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


class SeedEligibility(unittest.TestCase):
    def test_only_proven_empty_retired_memberships_are_omitted_and_recorded(self):
        seed_spec = importlib.util.spec_from_file_location('seed_extract', Path(__file__).with_name('seed-extract.py'))
        seed = importlib.util.module_from_spec(seed_spec)
        seed_spec.loader.exec_module(seed)
        with patch.object(seed, 'q', return_value=[['club', 'horse', 't']]):
            where, exclusions = seed.playable_memberships('person_is_eligible')
        self.assertIn('person_is_eligible', where)
        self.assertIn("lifecycle_status='retired'", where)
        self.assertIn('coalesce(chip_balance,0)=0', where)
        self.assertIn('s.left_at is null', where)
        self.assertEqual(exclusions, [{'clubId': 'club', 'userId': 'horse', 'reason': 'nonplayable_empty_retired_club_membership'}])
        for eligibility in ['f', '', None]:
            with patch.object(seed, 'q', return_value=[['club', 'horse', eligibility]]):
                with self.assertRaisesRegex(seed.SeedEligibilityError, 'playable, funded, seated, or not retired'):
                    seed.playable_memberships('person_is_eligible')

    def test_membership_query_copy_and_budget_failures_cannot_be_skipped(self):
        seed_spec = importlib.util.spec_from_file_location('seed_extract_failure', Path(__file__).with_name('seed-extract.py'))
        seed = importlib.util.module_from_spec(seed_spec)
        seed_spec.loader.exec_module(seed)
        for failure in ['eligibility', 'budget', 'copy']:
            def query(sql):
                if 'pg_total_relation_size' in sql:
                    return [['public', 'club_members', '1', str(seed.BYTE_CAP + 1 if failure == 'budget' else 20000)]]
                if 'select club_id,user_id' in sql:
                    if failure == 'eligibility':
                        raise RuntimeError('database unreadable')
                    return []
                if 'select count(*)' in sql:
                    return [['1']]
                return []
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder, \
                 patch.object(seed, 'OUT', folder), patch.object(seed, 'q', side_effect=query), \
                 patch.object(seed, 'copy_out', side_effect=RuntimeError('copy unreadable')):
                with self.assertRaises(seed.SeedEligibilityError):
                    seed.main()


if __name__ == '__main__':
    unittest.main()
