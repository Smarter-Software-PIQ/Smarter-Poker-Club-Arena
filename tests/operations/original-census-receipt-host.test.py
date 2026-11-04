import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('receipt', 'scripts/ci/original-census-receipt-host.py')
receipt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipt)


class OriginalReceipt(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.lock = Path(self.folder.name) / 'lock'
        self.lock.write_text('unchanged')
        self.lock.chmod(0o600)
        self.current = ['c' * 64, 'sha256:' + 'd' * 64, '2026-11-04T16:14:36.000000Z', 42, True, receipt.ENGINE]
        self.intent = dict(runId=receipt.RUN, source=receipt.ENGINE, instance=receipt.INSTANCE,
                           retryAllowed=False, container=self.current[0], startedAt=self.current[2],
                           hostPid=42, nativeCensus=dict(path=receipt.MODULE, sourceSHA256=receipt.SOURCE))
        self.result = dict(schema='original-census-diagnostics/v1', observationOnly=True,
                           runId=receipt.RUN, expectedSha=receipt.ENGINE, instanceId=receipt.INSTANCE,
                           sourceSHA256=receipt.SOURCE, inspectorClosed=True, diagnostics={})
        self.source = b'qualified fixture source'

    def observe(self, identities=None, result=None, raw=None):
        result = self.result if result is None else result
        raw = json.dumps(self.intent).encode() if raw is None else raw
        with patch.object(receipt, 'LOCK', str(self.lock)), patch.object(receipt, 'read_intent', return_value=raw), \
                patch.object(receipt, 'identity', side_effect=identities or [self.current, self.current]), \
                patch.object(receipt.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=json.dumps(result).encode())) as run:
            observed = receipt.observe(receipt.ENGINE, self.source, hashlib.sha256(self.source).hexdigest())
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ['docker','exec','-i',self.current[0],'env','-u','NODE_OPTIONS','-u','NODE_PATH','node','--no-inspect','--input-type=module','-',receipt.ENGINE,'legacy_census_receipt'])
            self.assertEqual(run.call_args.kwargs['timeout'],75)
            return observed

    def test_exact_original_container_and_intent_are_bound_without_rewriting_lock(self):
        observed = self.observe()
        self.assertEqual(observed['containerId'],self.current[0])
        self.assertEqual(observed['imageId'],self.current[1])
        self.assertEqual(self.lock.read_text(),'unchanged')

    def test_foreign_or_changed_identities_refuse(self):
        for key, value in [('runId','other'),('source','f'*40),('instance','foreign'),('retryAllowed',True),('hostPid',43)]:
            altered=copy.deepcopy(self.intent);altered[key]=value
            with self.subTest(key=key), self.assertRaises(ValueError): self.observe(raw=json.dumps(altered).encode())
        for index in range(6):
            altered=list(self.current);altered[index]=False if index==4 else 'foreign'
            with self.subTest(index=index),self.assertRaises(ValueError): self.observe(identities=[self.current,altered])
        for key in ['path','sourceSHA256']:
            altered=copy.deepcopy(self.intent);altered['nativeCensus'][key]='foreign'
            with self.subTest(native=key),self.assertRaises(ValueError): self.observe(raw=json.dumps(altered).encode())

    def test_unclosed_or_extra_result_fields_cannot_be_exported(self):
        for result in [{**self.result,'inspectorClosed':False},{**self.result,'private':'never export'}]:
            with self.assertRaises(ValueError): self.observe(result=result)

    def test_missing_or_contended_lock_refuses_before_inspector_entry(self):
        with patch.object(receipt, 'LOCK', str(self.lock)), patch.object(receipt.fcntl, 'flock', side_effect=BlockingIOError), \
                patch.object(receipt, 'identity') as inspect:
            with self.assertRaises(BlockingIOError): receipt.observe(receipt.ENGINE,self.source,hashlib.sha256(self.source).hexdigest())
            inspect.assert_not_called()
        self.lock.unlink()
        with self.assertRaises(FileNotFoundError): self.observe()


if __name__ == '__main__':
    unittest.main()
