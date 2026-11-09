import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('schema_evidence', Path(__file__).with_name('schema-evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def receipt():
    return {'schema': evidence.SCHEMA, 'migrations': [['20261108041131', 'net_guarantee']],
            'functions': {signature: 'a' * 64 for signature in evidence.SIGNATURES}}


class SchemaEvidenceTests(unittest.TestCase):
    def test_export_binding_does_not_change_schema_comparison(self):
        before = receipt()
        after = dict(before, dumpSha256='b' * 64)
        evidence.compare(before, after)

    def test_existing_manual_migration_is_preserved(self):
        current = receipt()
        current['migrations'].append(['manual', 'training_api_indexes.sql'])
        evidence.validate(current)
        with self.assertRaises(ValueError):
            evidence.compare(current, receipt())

    def test_installed_version_name_set_must_match(self):
        variants = [[], [['20261108041131', 'renamed']],
                    [['20261108041132', 'net_guarantee']],
                    [['20261108041131', 'net_guarantee'], ['20261109000000', 'later']]]
        for migrations in variants:
            with self.subTest(migrations=migrations), self.assertRaises(ValueError):
                changed = dict(receipt(), migrations=migrations)
                evidence.compare(receipt(), changed)

    def test_function_body_change_and_missing_signature_are_refused(self):
        changed = receipt()
        changed['functions'][evidence.SIGNATURES[0]] = 'b' * 64
        with self.assertRaises(ValueError):
            evidence.compare(receipt(), changed)
        del changed['functions'][evidence.SIGNATURES[0]]
        with self.assertRaises(ValueError):
            evidence.compare(receipt(), changed, body_only=True)

    def test_body_only_restored_copy_requires_every_body(self):
        restored = dict(receipt(), migrations=None)
        evidence.compare(receipt(), restored, body_only=True)
        with self.assertRaises(ValueError):
            evidence.compare(receipt(), restored)

    def test_dump_binding_rejects_wrong_or_unbound_file(self):
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / 'schema.dump'
            dump.write_bytes(b'qualified dump')
            bound = dict(receipt(), dumpSha256=hashlib.sha256(dump.read_bytes()).hexdigest())
            evidence.compare(bound, receipt(), dump=dump)
            dump.write_bytes(b'changed dump')
            with self.assertRaises(ValueError):
                evidence.compare(bound, receipt(), dump=dump)
            with self.assertRaises(ValueError):
                evidence.compare(receipt(), receipt(), dump=dump)

    def test_capture_hashes_bodies_and_uses_read_only_bounded_query(self):
        bodies = {signature: 'definition ' + signature for signature in evidence.SIGNATURES}
        result = subprocess.CompletedProcess([], 0, json.dumps(
            {'migrations': receipt()['migrations'], 'functions': bodies}), '')
        with patch.object(evidence.subprocess, 'run', return_value=result) as run:
            captured = evidence.capture()
        self.assertEqual(captured['functions'][evidence.SIGNATURES[0]],
                         hashlib.sha256(bodies[evidence.SIGNATURES[0]].encode()).hexdigest())
        self.assertIn('default_transaction_read_only=on', run.call_args.kwargs['env']['PGOPTIONS'])
        self.assertEqual(run.call_args.kwargs['timeout'], 30)
        self.assertNotIn('definition ', json.dumps(captured))

    def test_capture_canonicalizes_database_collation_for_legacy_versions(self):
        bodies = {signature: 'body' for signature in evidence.SIGNATURES}
        migrations = [['20260819_ca_player_stats_full_rpc', 'legacy'], ['20260819000506', 'dated']]
        result = subprocess.CompletedProcess([], 0, json.dumps(
            {'migrations': migrations, 'functions': bodies}), '')
        with patch.object(evidence.subprocess, 'run', return_value=result):
            captured = evidence.capture()
        self.assertEqual(captured['migrations'], sorted(migrations))

    def test_missing_body_and_failed_query_cannot_be_captured(self):
        bodies = {signature: 'body' for signature in evidence.SIGNATURES}
        bodies[evidence.SIGNATURES[0]] = None
        result = subprocess.CompletedProcess([], 0, json.dumps(
            {'migrations': receipt()['migrations'], 'functions': bodies}), '')
        with patch.object(evidence.subprocess, 'run', return_value=result), self.assertRaises(ValueError):
            evidence.capture()
        result = subprocess.CompletedProcess([], 1, '', 'secret connection diagnostic')
        with patch.object(evidence.subprocess, 'run', return_value=result), self.assertRaisesRegex(ValueError, '^Schema evidence query failed$'):
            evidence.capture()

    def test_malformed_hash_and_duplicate_migration_are_refused(self):
        changed = receipt()
        changed['functions'][evidence.SIGNATURES[0]] = 'invalid'
        with self.assertRaises(ValueError):
            evidence.validate(changed)
        changed = receipt()
        changed['migrations'] *= 2
        with self.assertRaises(ValueError):
            evidence.validate(changed)


if __name__ == '__main__':
    unittest.main()
