import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('qualification-input-projections.py')
spec = importlib.util.spec_from_file_location('qualification_projections', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

WORKFLOW = '''name: CI
on: pull_request
permissions:
  contents: read
jobs:
  changes:
    outputs:
      server: ${{ steps.f.outputs.server }}
      unrelated_client_output: ${{ steps.f.outputs.client }}
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/ci/classify-ci-changes.mjs
  accounting_postgres:
    needs: changes
    if: needs.changes.outputs.server
    runs-on: ubuntu-latest
    steps:
      - run: python3 qualify-real.py
  browser:
    runs-on: ubuntu-latest
    steps:
      - run: browser-before
'''


class QualificationProjections(unittest.TestCase):
    def test_unrelated_job_edits_do_not_change_execution_inputs(self):
        before = module.workflow_projection(WORKFLOW)
        self.assertEqual(before, module.workflow_projection(WORKFLOW.replace('browser-before', 'browser-after')))
        self.assertEqual(before, module.workflow_projection(WORKFLOW.replace('steps.f.outputs.client', 'steps.other.outputs.client')))
        self.assertNotEqual(before, module.workflow_projection(WORKFLOW.replace('steps.f.outputs.server', 'steps.other.outputs.server')))
        self.assertNotEqual(before, module.workflow_projection(WORKFLOW.replace('qualify-real.py', 'wrong-command.py')))
        self.assertNotEqual(before, module.workflow_projection(WORKFLOW.replace('contents: read', 'contents: write')))
        self.assertNotEqual(before, module.workflow_projection(WORKFLOW.replace('node scripts/ci/classify-ci-changes.mjs', 'node wrong-classifier.mjs')))

    def test_unknown_or_missing_dependency_structure_cannot_qualify(self):
        for source in [WORKFLOW.replace('needs: changes', 'needs: [changes, another]'),
                       WORKFLOW.replace('  changes:', '  missing:'),
                       WORKFLOW.replace('    needs: changes', '    <<: *unbound\n    needs: changes'),
                       WORKFLOW + '  browser:\n    runs-on: ubuntu-latest\n']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                module.workflow_projection(source)

    def test_admission_projection_retains_relevant_behavior_and_immutable_diff_owner(self):
        with tempfile.TemporaryDirectory(prefix='qualification-projection-') as temporary:
            root = Path(temporary)
            target = root / 'scripts/ci/classify-ci-changes.mjs'
            target.parent.mkdir(parents=True)
            source = """
const yes=()=>({src:true,server:true,tests:true,phase4:true,fixture:true});
export function classifyChangedPaths(paths){if(!paths)return yes();return {...yes(),server:paths.includes('source.sql')};}
export function classifyGitChanges(){return 'immutable';}
export function gitEnvironmentForCwd(){return {};}
"""
            target.write_text(source)
            baseline = module.admission_projection(root, ['source.sql'])
            target.write_text(source.replace("return {...yes(),", "if(paths.includes('unrelated'))return yes();return {...yes(),"))
            self.assertEqual(baseline, module.admission_projection(root, ['source.sql']))
            target.write_text(source.replace("paths.includes('source.sql')", 'false'))
            self.assertNotEqual(baseline, module.admission_projection(root, ['source.sql']))
            target.write_text(source.replace("return 'immutable'", "return 'changed-enumerator'"))
            self.assertNotEqual(baseline, module.admission_projection(root, ['source.sql']))
            target.write_text(source.replace('if(!paths)return yes()', 'if(!paths)return {}'))
            with self.assertRaises(Exception):
                module.admission_projection(root, ['source.sql'])

    def test_actual_projection_reader_rejects_relevant_drift_and_missing_pin(self):
        with tempfile.TemporaryDirectory(prefix='qualification-reader-') as temporary:
            root = Path(temporary)
            workflow = root / '.github/workflows/ci.yml'
            workflow.parent.mkdir(parents=True)
            workflow.write_text(WORKFLOW)
            classifier = root / 'scripts/ci/classify-ci-changes.mjs'
            classifier.parent.mkdir(parents=True)
            classifier.write_text("""
export function classifyChangedPaths(paths){return {src:true,server:true,tests:true,phase4:true,fixture:true};}
export function classifyGitChanges(){return 'immutable';}
export function gitEnvironmentForCwd(){return {};}
""")
            for name, section in module.BINDINGS.items():
                binding = root / name
                binding.parent.mkdir(parents=True, exist_ok=True)
                binding.write_text(json.dumps({section: {path: 'fixture-pin' for path in
                    (module.SELF, module.WORKFLOW_OUTPUT, module.ADMISSION_OUTPUT)}}))
            for name, value in module.expected(root).items():
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_bytes(value)
            module.check(root)
            workflow.write_text(WORKFLOW.replace('browser-before', 'browser-after'))
            module.check(root)
            workflow.write_text(WORKFLOW.replace('qualify-real.py', 'wrong-command.py'))
            with self.assertRaisesRegex(ValueError, 'projection differs'):
                module.check(root)
            workflow.write_text(WORKFLOW)
            name, section = next(iter(module.BINDINGS.items()))
            binding = root / name
            document = json.loads(binding.read_text())
            del document[section][module.SELF]
            binding.write_text(json.dumps(document))
            with self.assertRaisesRegex(ValueError, 'pin missing'):
                module.check(root)

    def test_real_workflow_has_exact_owned_jobs(self):
        projection = module.workflow_projection((module.ROOT / '.github/workflows/ci.yml').read_text())
        self.assertEqual(set(projection['jobs']), {'changes', 'accounting_postgres'})
        self.assertIn('Setup Node 22', projection['jobs']['accounting_postgres'])
        self.assertIn('matrix', projection['jobs']['accounting_postgres'])


if __name__ == '__main__':
    unittest.main()
